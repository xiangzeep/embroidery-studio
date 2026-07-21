"""
Vector Canvas
QGraphicsView-based canvas with zoom, pan, and vector stitch rendering.
Renders layers as colored stitch paths with real-time preview.
"""

from PySide6.QtWidgets import (
    QGraphicsView, QGraphicsScene, QGraphicsItem,
    QGraphicsPathItem, QGraphicsPixmapItem, QGraphicsRectItem,
    QGraphicsEllipseItem, QGraphicsLineItem, QGraphicsItemGroup,
    QMenu, QApplication
)
from PySide6.QtCore import Qt, QRectF, QPointF, Signal, QLineF
from PySide6.QtGui import (
    QPainter, QPen, QColor, QBrush, QPainterPath, QPixmap,
    QImage, QWheelEvent, QMouseEvent, QKeyEvent, QTransform
)
import cv2
import numpy as np
from typing import Optional, List, Dict, Tuple, Any


def _render_region_mask_rgba(
    mask: np.ndarray,
    rgb: Tuple[int, int, int],
    opacity: float = 0.3,
    scale: float = 1.0,
) -> Tuple[np.ndarray, float]:
    """
    Render a region mask for preview without magnifying source-pixel stair steps.

    The segmentation mask is intentionally low resolution. When the canvas
    scales it directly, long diagonal boundaries look bent/jagged. For zoomed
    previews we redraw contours into a higher-resolution alpha mask and leave
    only the fractional remainder as the item scale.
    """
    h, w = mask.shape
    render_scale = 1
    if scale > 1.25:
        render_scale = min(8, max(2, int(np.ceil(scale))))

    out_h = h * render_scale
    out_w = w * render_scale
    rgba = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    rgba[:, :, 0] = rgb[0]
    rgba[:, :, 1] = rgb[1]
    rgba[:, :, 2] = rgb[2]

    alpha_value = int(np.clip(255 * opacity, 0, 255))
    if render_scale == 1:
        alpha = (mask > 0).astype(np.uint8) * alpha_value
    else:
        alpha = _render_mask_alpha_from_contours(mask, alpha_value, render_scale)

    rgba[:, :, 3] = alpha
    return rgba, float(scale) / float(render_scale)


def _render_mask_alpha_from_contours(
    mask: np.ndarray,
    alpha_value: int,
    render_scale: int,
) -> np.ndarray:
    source = ((mask > 0).astype(np.uint8)) * 255
    h, w = source.shape
    alpha = np.zeros((h * render_scale, w * render_scale), dtype=np.uint8)
    contours, hierarchy = cv2.findContours(source, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hierarchy is None:
        return alpha

    hierarchy = hierarchy[0]
    for idx, contour in enumerate(contours):
        if cv2.contourArea(contour) < 1.0:
            continue
        perimeter = cv2.arcLength(contour, True)
        epsilon = max(0.75, 0.004 * perimeter)
        approx = cv2.approxPolyDP(contour, epsilon, True)
        if len(approx) < 3:
            continue
        points = np.rint(approx[:, 0, :] * render_scale).astype(np.int32)
        points = points.reshape(-1, 1, 2)
        fill_value = 0 if hierarchy[idx][3] >= 0 else alpha_value
        cv2.fillPoly(alpha, [points], fill_value, lineType=cv2.LINE_AA)

    return alpha


def _preview_z_for_region_mask(mask: np.ndarray, polygon: Optional[Any] = None) -> float:
    """Draw broad/base preview regions under small details while staying above image."""
    total = max(1, int(mask.size))
    if polygon is not None and not getattr(polygon, "is_empty", True):
        area = float(getattr(polygon, "area", np.count_nonzero(mask)))
    else:
        area = float(np.count_nonzero(mask))
    ratio = float(np.clip(area / total, 0.0, 1.0))
    return -50.0 - ratio * 40.0


class StitchPathItem(QGraphicsPathItem):
    """Renders a sequence of stitch points as a vector path."""

    def __init__(self, points: List[Tuple[float, float]], color: QColor,
                 stitch_width: float = 0.8, parent=None):
        super().__init__(parent)
        self.points = points
        self.stitch_color = color
        self.stitch_width = stitch_width
        self.setCacheMode(QGraphicsItem.DeviceCoordinateCache)
        self._build_path()

    def _build_path(self):
        if not self.points:
            return

        path = QPainterPath()
        path.moveTo(self.points[0][0], self.points[0][1])
        for x, y in self.points[1:]:
            path.lineTo(x, y)

        self.setPath(path)
        pen = QPen(self.stitch_color)
        pen.setWidthF(self.stitch_width)
        pen.setCapStyle(Qt.RoundCap)
        pen.setJoinStyle(Qt.RoundJoin)
        self.setPen(pen)
        self.setBrush(Qt.NoBrush)


class StitchDotItem(QGraphicsEllipseItem):
    """Small dot marking a stitch point."""

    def __init__(self, x, y, radius, color, parent=None):
        super().__init__(x - radius, y - radius, radius * 2, radius * 2, parent)
        self.setBrush(QBrush(color))
        self.setPen(QPen(Qt.NoPen))


class StitchObjectItem(QGraphicsItemGroup):
    """Selectable stitch object for a generated region."""

    def __init__(self, uid: str, layer_uid: str, parent=None):
        super().__init__(parent)
        self.uid = uid
        self.layer_uid = layer_uid
        self.setFlag(QGraphicsItem.ItemIsSelectable, True)
        self.setFlag(QGraphicsItem.ItemIsFocusable, True)
        self.setHandlesChildEvents(False)
        self.setCacheMode(QGraphicsItem.DeviceCoordinateCache)


class BoundaryHandleItem(QGraphicsEllipseItem):
    """Draggable anchor/control handle for editable region boundaries."""

    def __init__(
        self,
        editor: "EmbroideryCanvas",
        index: int,
        role: str,
        pos: QPointF,
        radius: float,
        color: QColor,
        parent=None,
    ):
        hit_radius = max(radius + 3.0, radius * 1.8)
        super().__init__(-hit_radius, -hit_radius, hit_radius * 2, hit_radius * 2, parent)
        self.editor = editor
        self.index = index
        self.role = role
        self.visual_radius_scene = float(radius)
        self.visual_diameter_scene = float(radius) * 2.0
        self.hit_radius_scene = float(hit_radius)
        self._visual_rect = QRectF(-radius, -radius, radius * 2, radius * 2)
        self.setPos(pos)
        self.setBrush(QBrush(color))
        pen = QPen(QColor(255, 255, 255))
        pen.setWidthF(max(0.8, radius * 0.25))
        self.setPen(pen)
        self.setZValue(200)
        self.setFlag(QGraphicsItem.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.ItemIsSelectable, True)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.setCursor(Qt.PointingHandCursor)

    def paint(self, painter: QPainter, option, widget=None):
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setBrush(self.brush())
        painter.setPen(self.pen())
        painter.drawEllipse(self._visual_rect)

    def itemChange(self, change, value):
        if (
            change == QGraphicsItem.ItemPositionHasChanged
            and not self.editor._updating_boundary_handles
        ):
            self.editor._boundary_handle_moved(self)
        return super().itemChange(change, value)


class ResizeHandleItem(QGraphicsEllipseItem):
    """Draggable handle for resizing the selected stitch object."""

    def __init__(
        self,
        editor: "EmbroideryCanvas",
        role: str,
        pos: QPointF,
        parent=None,
    ):
        super().__init__(-5.0, -5.0, 10.0, 10.0, parent)
        self.editor = editor
        self.role = role
        self.setPos(pos)
        self.setBrush(QBrush(QColor(255, 210, 50)))
        pen = QPen(QColor(30, 30, 30))
        pen.setWidthF(1.0)
        self.setPen(pen)
        self.setZValue(230)
        self.setFlag(QGraphicsItem.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.ItemIsSelectable, False)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.setCursor(self._cursor_for_role(role))

    @staticmethod
    def _cursor_for_role(role: str):
        if role in ("nw", "se"):
            return Qt.SizeFDiagCursor
        if role in ("ne", "sw"):
            return Qt.SizeBDiagCursor
        if role in ("n", "s"):
            return Qt.SizeVerCursor
        return Qt.SizeHorCursor

    def itemChange(self, change, value):
        if (
            change == QGraphicsItem.ItemPositionHasChanged
            and not self.editor._updating_resize_handles
        ):
            self.editor._resize_handle_moved(self)
        return super().itemChange(change, value)

    def mousePressEvent(self, event):
        self.editor._begin_resize_drag()
        if event is not None:
            super().mousePressEvent(event)

    def mouseReleaseEvent(self, event):
        self.editor._finish_resize_drag()
        if event is not None:
            super().mouseReleaseEvent(event)


class SelectionBoxItem(QGraphicsRectItem):
    """Draggable selection frame for moving the selected stitch object."""

    def __init__(self, editor: "EmbroideryCanvas", rect: QRectF, parent=None):
        super().__init__(rect, parent)
        self.editor = editor
        self.setZValue(220)
        pen = QPen(QColor(255, 210, 50))
        pen.setWidthF(1.5)
        pen.setCosmetic(True)
        self.setPen(pen)
        fill = QColor(255, 210, 50, 1)
        self.setBrush(QBrush(fill))
        self.setFlag(QGraphicsItem.ItemIsMovable, True)
        self.setFlag(QGraphicsItem.ItemIsSelectable, False)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges, True)
        self.setCursor(Qt.SizeAllCursor)

    def itemChange(self, change, value):
        if change == QGraphicsItem.ItemPositionHasChanged:
            self.editor._selection_box_moved(self)
        return super().itemChange(change, value)

    def mousePressEvent(self, event):
        self.editor._begin_selection_box_drag()
        if event is not None:
            super().mousePressEvent(event)

    def mouseReleaseEvent(self, event):
        self.editor._finish_selection_box_drag()
        if event is not None:
            super().mouseReleaseEvent(event)


class RegionMaskItem(QGraphicsPixmapItem):
    """Semi-transparent overlay showing a region mask."""

    def __init__(self, mask: np.ndarray, color: QColor, opacity: float = 0.3,
                 scale: float = 1.0, parent=None):
        super().__init__(parent)
        rgba, item_scale = _render_region_mask_rgba(
            mask,
            (color.red(), color.green(), color.blue()),
            opacity,
            scale,
        )
        h, w = rgba.shape[:2]
        img = QImage(rgba.data, w, h, w * 4, QImage.Format_RGBA8888)
        # Keep ref to prevent gc
        self._img_data = rgba
        pixmap = QPixmap.fromImage(img)
        self.setPixmap(pixmap)
        self.setTransformationMode(Qt.SmoothTransformation)
        if item_scale != 1.0:
            self.setScale(item_scale)


class RegionPolygonItem(QGraphicsPathItem):
    """Semi-transparent overlay showing a reconstructed vector region boundary."""

    def __init__(self, polygon: Any, color: QColor, opacity: float = 0.3,
                 scale: float = 1.0, parent=None):
        super().__init__(parent)
        self._polygon = polygon
        self._scale = float(scale)
        self._build_path()

        fill = QColor(color)
        fill.setAlpha(int(np.clip(255 * opacity, 0, 255)))
        self.setBrush(QBrush(fill))
        self.setPen(QPen(Qt.NoPen))

    def _build_path(self):
        path = QPainterPath()
        path.setFillRule(Qt.OddEvenFill)

        geometries = getattr(self._polygon, "geoms", None)
        if geometries is None:
            geometries = [self._polygon]

        for geom in geometries:
            if geom.is_empty or not hasattr(geom, "exterior"):
                continue
            self._add_ring_to_path(path, geom.exterior.coords)
            for interior in getattr(geom, "interiors", []):
                self._add_ring_to_path(path, interior.coords)

        self.setPath(path)

    def _add_ring_to_path(self, path: QPainterPath, coords):
        points = list(coords)
        if not points:
            return

        first_x, first_y = points[0]
        path.moveTo(first_x * self._scale, first_y * self._scale)
        for x, y in points[1:]:
            path.lineTo(x * self._scale, y * self._scale)
        path.closeSubpath()


class EmbroideryCanvas(QGraphicsView):
    """Main canvas for viewing and editing embroidery patterns."""

    region_clicked = Signal(str)  # region UID
    object_selected = Signal(str)
    object_scale_requested = Signal(str, float)
    object_move_requested = Signal(str, float, float)
    object_resize_requested = Signal(str, object)
    boundary_edit_requested = Signal(str)
    boundary_edit_applied = Signal(str, object)
    position_changed = Signal(float, float)  # x_mm, y_mm
    zoom_changed = Signal(float)

    def __init__(self, parent=None):
        super().__init__(parent)

        self.scene = QGraphicsScene(self)
        self.setScene(self.scene)

        # View settings
        self.setRenderHints(
            QPainter.Antialiasing |
            QPainter.SmoothPixmapTransform |
            QPainter.TextAntialiasing
        )
        self.setDragMode(QGraphicsView.NoDrag)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setResizeAnchor(QGraphicsView.AnchorUnderMouse)
        self.setViewportUpdateMode(QGraphicsView.BoundingRectViewportUpdate)
        self.setCacheMode(QGraphicsView.CacheBackground)
        self.setOptimizationFlag(QGraphicsView.DontSavePainterState, True)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setMinimumSize(400, 300)
        self.setMouseTracking(True)

        # State
        self._zoom = 1.0
        self._panning = False
        self._pan_start = QPointF()
        self._show_stitches = True
        self._show_stitch_points = False
        self._show_regions = True
        self._show_image = True
        self._show_grid = False
        self._grid_size_mm = 10.0  # grid spacing in mm
        self._base_pan_margin = 200.0
        self._min_zoom = 0.05
        self._max_zoom = 40.0

        # Scene items
        self._bg_item: Optional[QGraphicsPixmapItem] = None
        self._layer_groups: Dict[str, QGraphicsItemGroup] = {}
        self._object_items: Dict[str, StitchObjectItem] = {}
        self._object_layers: Dict[str, str] = {}
        self._mask_items: Dict[str, QGraphicsItem] = {}
        self._grid_items: List[QGraphicsLineItem] = []
        self._selection_box_item: Optional[SelectionBoxItem] = None
        self._resize_handle_items: List[ResizeHandleItem] = []
        self._resize_start_rect: Optional[QRectF] = None
        self._selection_drag_start_pos = QPointF()
        self._updating_resize_handles = False
        self._boundary_edit_uid: Optional[str] = None
        self._boundary_edit_scale = 1.0
        self._boundary_edit_item: Optional[QGraphicsPathItem] = None
        self._boundary_anchor_points: List[QPointF] = []
        self._boundary_controls: List[Tuple[QPointF, QPointF]] = []
        self._boundary_anchor_items: List[BoundaryHandleItem] = []
        self._boundary_control_items: List[BoundaryHandleItem] = []
        self._boundary_control_lines: List[QGraphicsLineItem] = []
        self._updating_boundary_handles = False

        # Scale: 1 scene unit = 1/10 mm (matching pyembroidery)
        self._units_per_mm = 10.0

        # Background
        self.setBackgroundBrush(QBrush(QColor(50, 50, 50)))
        self.scene.selectionChanged.connect(self._on_scene_selection_changed)

    # --- Public API ---

    def set_background_image(self, image: np.ndarray, output_size_mm: Tuple[float, float]):
        """Set the source image as canvas background."""
        if self._bg_item:
            self.scene.removeItem(self._bg_item)
            self._bg_item = None

        h, w = image.shape[:2]
        # Convert to QPixmap
        if image.ndim == 3:
            img = QImage(image.data, w, h, w * 3, QImage.Format_RGB888)
        else:
            img = QImage(image.data, w, h, w, QImage.Format_Grayscale8)

        self._img_data_ref = image.copy()  # prevent gc
        img = QImage(self._img_data_ref.data, w, h, w * 3, QImage.Format_RGB888)
        pixmap = QPixmap.fromImage(img)

        self._bg_item = QGraphicsPixmapItem(pixmap)
        self._bg_item.setTransformationMode(Qt.SmoothTransformation)

        # Scale image to match output size in scene units (1/10mm)
        out_w = output_size_mm[0] * self._units_per_mm
        out_h = output_size_mm[1] * self._units_per_mm
        sx = out_w / w
        sy = out_h / h
        self._bg_item.setScale(min(sx, sy))
        self._bg_item.setZValue(-100)
        self._bg_item.setOpacity(0.5 if self._show_image else 0.0)

        self.scene.addItem(self._bg_item)
        self._update_scene_rect_for_panning()
        self.fitInView(self.scene.itemsBoundingRect(), Qt.KeepAspectRatio)

    def set_layer_stitches(self, layer_uid: str, regions_data: List[dict]):
        """
        Set stitch paths for a layer.
        regions_data: list of {'uid': str, 'points': [(x,y),...], 'color': (r,g,b)}
        """
        # Remove existing
        if layer_uid in self._layer_groups:
            self.scene.removeItem(self._layer_groups[layer_uid])
            del self._layer_groups[layer_uid]
        for uid, item in list(self._object_items.items()):
            if item.layer_uid == layer_uid:
                del self._object_items[uid]
                del self._object_layers[uid]

        group = QGraphicsItemGroup()
        group.setZValue(0)
        group.setCacheMode(QGraphicsItem.DeviceCoordinateCache)
        self.scene.addItem(group)

        for rd in regions_data:
            color = QColor(*rd['color'])
            points = rd.get('points', [])
            paths = rd.get('paths') or ([points] if points else [])
            if not paths:
                continue

            object_item = StitchObjectItem(rd['uid'], layer_uid, parent=group)
            self._object_items[rd['uid']] = object_item
            self._object_layers[rd['uid']] = layer_uid

            if self._show_stitches:
                for path in paths:
                    if len(path) >= 2:
                        path_item = StitchPathItem(path, color, stitch_width=0.8)
                        object_item.addToGroup(path_item)

            if self._show_stitch_points:
                for path in paths:
                    for x, y in path[::3]:  # every 3rd point for performance
                        dot = StitchDotItem(x, y, 0.5, color)
                        object_item.addToGroup(dot)

        self._layer_groups[layer_uid] = group
        self._update_scene_rect_for_panning()
        self._refresh_selection_box()

    def clear_layer_stitches(self, layer_uid: str):
        """Remove stitch graphics for one layer without touching other layers."""
        if layer_uid in self._layer_groups:
            self.scene.removeItem(self._layer_groups[layer_uid])
            del self._layer_groups[layer_uid]
        for uid, item in list(self._object_items.items()):
            if item.layer_uid == layer_uid:
                del self._object_items[uid]
                del self._object_layers[uid]
        self._refresh_selection_box()

    def set_region_mask(self, region_uid: str, mask: np.ndarray,
                        color: Tuple[int, int, int], scale: float = 1.0,
                        polygon: Optional[Any] = None):
        """Show a semi-transparent region mask overlay."""
        if region_uid in self._mask_items:
            self.scene.removeItem(self._mask_items[region_uid])

        if self._show_regions:
            qcolor = QColor(*color)
            if polygon is not None and not polygon.is_empty:
                item = RegionPolygonItem(polygon, qcolor, opacity=1.0, scale=scale)
            else:
                item = RegionMaskItem(mask, qcolor, opacity=1.0, scale=scale)
            item.setZValue(_preview_z_for_region_mask(mask, polygon))
            self.scene.addItem(item)
            self._mask_items[region_uid] = item
            self._update_scene_rect_for_panning()

    def clear_all(self):
        """Clear all items from the scene."""
        self.cancel_boundary_edit()
        self._clear_selection_box()
        self.scene.clear()
        self._bg_item = None
        self._layer_groups.clear()
        self._object_items.clear()
        self._object_layers.clear()
        self._mask_items.clear()
        self._grid_items.clear()

    def set_show_stitches(self, show: bool):
        self._show_stitches = show
        for uid, group in self._layer_groups.items():
            group.setVisible(show)

    def set_show_stitch_points(self, show: bool):
        self._show_stitch_points = show

    def set_show_regions(self, show: bool):
        self._show_regions = show
        for uid, item in self._mask_items.items():
            item.setVisible(show)

    def set_show_image(self, show: bool):
        self._show_image = show
        if self._bg_item:
            self._bg_item.setOpacity(0.5 if show else 0.0)

    def set_image_opacity(self, opacity: float):
        if self._bg_item:
            self._bg_item.setOpacity(opacity)

    def toggle_grid(self, show: bool):
        self._show_grid = show
        for item in self._grid_items:
            item.setVisible(show)

    def fit_to_content(self):
        """Fit the view to show all content."""
        rect = self.scene.itemsBoundingRect()
        if rect.isNull():
            return
        rect.adjust(-50, -50, 50, 50)
        self._update_scene_rect_for_panning()
        self.fitInView(rect, Qt.KeepAspectRatio)
        self._zoom = self.transform().m11()
        self.zoom_changed.emit(self._zoom)

    def zoom_in(self):
        self._zoom_by(1.2)

    def zoom_out(self):
        self._zoom_by(1 / 1.2)

    def reset_zoom(self):
        self.resetTransform()
        self._zoom = 1.0
        self._update_scene_rect_for_panning()
        self.zoom_changed.emit(self._zoom)

    def _zoom_by(self, factor: float):
        current = self.transform().m11()
        if current <= 0:
            current = self._zoom
        target = float(np.clip(current * factor, self._min_zoom, self._max_zoom))
        applied = target / current
        if abs(applied - 1.0) <= 1e-6:
            return
        self.scale(applied, applied)
        self._zoom = self.transform().m11()
        self._update_scene_rect_for_panning()
        self.zoom_changed.emit(self._zoom)

    def select_object(self, uid: str):
        if self.selected_object_uid() == uid:
            self._refresh_selection_box()
            return
        self.scene.clearSelection()
        if uid in self._object_items:
            self._object_items[uid].setSelected(True)
            self._refresh_selection_box()
            return
        for object_uid, item in self._object_items.items():
            if self._object_layers.get(object_uid) == uid:
                item.setSelected(True)
        self._refresh_selection_box()

    def selected_object_uid(self) -> Optional[str]:
        selected = [
            item for item in self.scene.selectedItems()
            if isinstance(item, StitchObjectItem)
        ]
        if not selected:
            return None
        layer_uids = {item.layer_uid for item in selected}
        if len(layer_uids) == 1 and len(selected) > 1:
            return next(iter(layer_uids))
        return selected[0].uid

    def _selected_object_items(self) -> List[StitchObjectItem]:
        return [
            item for item in self.scene.selectedItems()
            if isinstance(item, StitchObjectItem)
        ]

    def _refresh_selection_box(self):
        self._clear_selection_box()
        selected = self._selected_object_items()
        if not selected:
            return

        rect = selected[0].sceneBoundingRect()
        for item in selected[1:]:
            rect = rect.united(item.sceneBoundingRect())
        if rect.isNull() or rect.width() <= 0 or rect.height() <= 0:
            return

        self._selection_box_item = SelectionBoxItem(self, rect)
        self.scene.addItem(self._selection_box_item)

        for role, point in self._resize_handle_positions(rect).items():
            handle = ResizeHandleItem(self, role, point)
            self.scene.addItem(handle)
            self._resize_handle_items.append(handle)

    def _clear_selection_box(self):
        for handle in self._resize_handle_items:
            if handle.scene() is self.scene:
                self.scene.removeItem(handle)
        self._resize_handle_items = []
        if self._selection_box_item is not None and self._selection_box_item.scene() is self.scene:
            self.scene.removeItem(self._selection_box_item)
        self._selection_box_item = None
        self._resize_start_rect = None
        self._selection_drag_start_pos = QPointF()

    @staticmethod
    def _resize_handle_positions(rect: QRectF) -> Dict[str, QPointF]:
        cx = rect.center().x()
        cy = rect.center().y()
        return {
            "nw": rect.topLeft(),
            "n": QPointF(cx, rect.top()),
            "ne": rect.topRight(),
            "e": QPointF(rect.right(), cy),
            "se": rect.bottomRight(),
            "s": QPointF(cx, rect.bottom()),
            "sw": rect.bottomLeft(),
            "w": QPointF(rect.left(), cy),
        }

    def _begin_resize_drag(self):
        if self._selection_box_item is not None:
            self._resize_start_rect = self._selection_box_scene_rect()

    def _resize_handle_moved(self, handle: ResizeHandleItem):
        if self._selection_box_item is None:
            return
        rect = QRectF(self._resize_start_rect or self._selection_box_item.rect())
        pos = handle.pos()

        if "w" in handle.role:
            rect.setLeft(pos.x())
        if "e" in handle.role:
            rect.setRight(pos.x())
        if "n" in handle.role:
            rect.setTop(pos.y())
        if "s" in handle.role:
            rect.setBottom(pos.y())
        if handle.role == "n":
            rect.setTop(pos.y())
        elif handle.role == "s":
            rect.setBottom(pos.y())
        elif handle.role == "w":
            rect.setLeft(pos.x())
        elif handle.role == "e":
            rect.setRight(pos.x())

        rect = rect.normalized()
        if rect.width() < 2.0 or rect.height() < 2.0:
            return
        self._selection_box_item.setRect(rect)
        self._sync_resize_handles(rect, moving=handle)

    def _sync_resize_handles(self, rect: QRectF, moving: Optional[ResizeHandleItem] = None):
        self._updating_resize_handles = True
        try:
            positions = self._resize_handle_positions(rect)
            for handle in self._resize_handle_items:
                if handle is moving:
                    continue
                handle.setPos(positions[handle.role])
        finally:
            self._updating_resize_handles = False

    def _finish_resize_drag(self):
        uid = self.selected_object_uid()
        if uid and self._selection_box_item is not None:
            rect = self._selection_box_item.rect().normalized()
            self.object_resize_requested.emit(
                uid,
                (rect.left(), rect.top(), rect.right(), rect.bottom()),
            )
        self._resize_start_rect = None

    def _selection_box_scene_rect(self) -> QRectF:
        if self._selection_box_item is None:
            return QRectF()
        return self._selection_box_item.mapRectToScene(self._selection_box_item.rect())

    def _begin_selection_box_drag(self):
        if self._selection_box_item is not None:
            self._selection_drag_start_pos = QPointF(self._selection_box_item.pos())

    def _selection_box_moved(self, item: SelectionBoxItem):
        delta = item.pos() - self._selection_drag_start_pos
        rect = item.mapRectToScene(item.rect())
        self._sync_resize_handles(rect)
        self._move_selected_items_preview(delta)

    def _move_selected_items_preview(self, delta: QPointF):
        for item in self._selected_object_items():
            item.setPos(delta)

    def _finish_selection_box_drag(self):
        if self._selection_box_item is None:
            return
        uid = self.selected_object_uid()
        delta = self._selection_box_item.pos() - self._selection_drag_start_pos
        if uid and (abs(delta.x()) > 1e-6 or abs(delta.y()) > 1e-6):
            self.object_move_requested.emit(uid, delta.x(), delta.y())
        self._selection_drag_start_pos = QPointF(self._selection_box_item.pos())

    def start_boundary_edit(self, uid: str, polygon: Any, scale: float = 1.0):
        """Start editing a region polygon with draggable Bezier handles."""
        self.cancel_boundary_edit()
        points = self._polygon_exterior_points(polygon)
        if len(points) < 3:
            return

        self._boundary_edit_uid = uid
        self._boundary_edit_scale = max(float(scale), 1e-6)
        self._boundary_anchor_points = [
            QPointF(float(x) * self._boundary_edit_scale, float(y) * self._boundary_edit_scale)
            for x, y in points
        ]
        self._boundary_controls = self._default_boundary_controls(self._boundary_anchor_points)

        self._boundary_edit_item = QGraphicsPathItem()
        self._boundary_edit_item.setZValue(190)
        pen = QPen(QColor(255, 170, 20))
        pen.setWidthF(2.0)
        pen.setCosmetic(True)
        self._boundary_edit_item.setPen(pen)
        self._boundary_edit_item.setBrush(Qt.NoBrush)
        self.scene.addItem(self._boundary_edit_item)

        self._create_boundary_handles()
        self._rebuild_boundary_edit_path()

    def apply_boundary_edit(self):
        """Emit the edited polygon in source-image pixel coordinates."""
        if not self._boundary_edit_uid or len(self._boundary_anchor_points) < 3:
            return
        uid = self._boundary_edit_uid
        source_points = [
            (p.x() / self._boundary_edit_scale, p.y() / self._boundary_edit_scale)
            for p in self._sample_boundary_curve()
        ]
        self.cancel_boundary_edit()
        self.boundary_edit_applied.emit(uid, source_points)

    def cancel_boundary_edit(self):
        """Remove the active boundary editor without applying changes."""
        for item in self._boundary_anchor_items:
            if item.scene() is self.scene:
                self.scene.removeItem(item)
        for item in self._boundary_control_items:
            if item.scene() is self.scene:
                self.scene.removeItem(item)
        for item in self._boundary_control_lines:
            if item.scene() is self.scene:
                self.scene.removeItem(item)
        if self._boundary_edit_item is not None and self._boundary_edit_item.scene() is self.scene:
            self.scene.removeItem(self._boundary_edit_item)

        self._boundary_edit_uid = None
        self._boundary_edit_scale = 1.0
        self._boundary_edit_item = None
        self._boundary_anchor_points = []
        self._boundary_controls = []
        self._boundary_anchor_items = []
        self._boundary_control_items = []
        self._boundary_control_lines = []

    @staticmethod
    def _polygon_exterior_points(polygon: Any) -> List[Tuple[float, float]]:
        geometries = getattr(polygon, "geoms", None)
        if geometries is not None:
            valid = [geom for geom in geometries if hasattr(geom, "exterior") and not geom.is_empty]
            if not valid:
                return []
            polygon = max(valid, key=lambda geom: geom.area)
        if polygon is None or polygon.is_empty or not hasattr(polygon, "exterior"):
            return []
        points = [(float(x), float(y)) for x, y in polygon.exterior.coords]
        if len(points) > 1 and points[0] == points[-1]:
            points.pop()
        return points

    @staticmethod
    def _default_boundary_controls(points: List[QPointF]) -> List[Tuple[QPointF, QPointF]]:
        controls = []
        count = len(points)
        for idx, start in enumerate(points):
            end = points[(idx + 1) % count]
            controls.append((
                QPointF(start.x() + (end.x() - start.x()) / 3.0,
                        start.y() + (end.y() - start.y()) / 3.0),
                QPointF(start.x() + 2.0 * (end.x() - start.x()) / 3.0,
                        start.y() + 2.0 * (end.y() - start.y()) / 3.0),
            ))
        return controls

    def _create_boundary_handles(self):
        anchor_color = QColor(255, 80, 80)
        control_color = QColor(80, 170, 255)
        self._updating_boundary_handles = True
        try:
            for idx, point in enumerate(self._boundary_anchor_points):
                item = BoundaryHandleItem(self, idx, "anchor", point, 4.0, anchor_color)
                self.scene.addItem(item)
                self._boundary_anchor_items.append(item)

            for idx, (c1, c2) in enumerate(self._boundary_controls):
                line1 = QGraphicsLineItem()
                line1.setZValue(185)
                line2 = QGraphicsLineItem()
                line2.setZValue(185)
                pen = QPen(QColor(80, 170, 255, 150))
                pen.setWidthF(1.0)
                pen.setCosmetic(True)
                line1.setPen(pen)
                line2.setPen(pen)
                self.scene.addItem(line1)
                self.scene.addItem(line2)
                self._boundary_control_lines.extend([line1, line2])

                h1 = BoundaryHandleItem(self, idx, "control1", c1, 3.0, control_color)
                h2 = BoundaryHandleItem(self, idx, "control2", c2, 3.0, control_color)
                self.scene.addItem(h1)
                self.scene.addItem(h2)
                self._boundary_control_items.extend([h1, h2])
        finally:
            self._updating_boundary_handles = False

    def _boundary_handle_moved(self, item: BoundaryHandleItem):
        pos = item.pos()
        if item.role == "anchor":
            old_pos = self._boundary_anchor_points[item.index]
            delta = pos - old_pos
            self._boundary_anchor_points[item.index] = QPointF(pos)
            prev_idx = (item.index - 1) % len(self._boundary_controls)
            c1, c2 = self._boundary_controls[prev_idx]
            self._boundary_controls[prev_idx] = (c1, c2 + delta)
            c1, c2 = self._boundary_controls[item.index]
            self._boundary_controls[item.index] = (c1 + delta, c2)
            self._sync_boundary_control_handles()
        elif item.role == "control1":
            _, c2 = self._boundary_controls[item.index]
            self._boundary_controls[item.index] = (QPointF(pos), c2)
        elif item.role == "control2":
            c1, _ = self._boundary_controls[item.index]
            self._boundary_controls[item.index] = (c1, QPointF(pos))
        self._rebuild_boundary_edit_path()

    def _sync_boundary_control_handles(self):
        self._updating_boundary_handles = True
        try:
            for idx, (c1, c2) in enumerate(self._boundary_controls):
                self._boundary_control_items[idx * 2].setPos(c1)
                self._boundary_control_items[idx * 2 + 1].setPos(c2)
        finally:
            self._updating_boundary_handles = False

    def _rebuild_boundary_edit_path(self):
        if self._boundary_edit_item is None or not self._boundary_anchor_points:
            return
        path = QPainterPath()
        path.moveTo(self._boundary_anchor_points[0])
        count = len(self._boundary_anchor_points)
        for idx in range(count):
            c1, c2 = self._boundary_controls[idx]
            end = self._boundary_anchor_points[(idx + 1) % count]
            path.cubicTo(c1, c2, end)
        path.closeSubpath()
        self._boundary_edit_item.setPath(path)
        self._sync_boundary_control_lines()

    def _sync_boundary_control_lines(self):
        if not self._boundary_control_lines:
            return
        count = len(self._boundary_anchor_points)
        for idx, (c1, c2) in enumerate(self._boundary_controls):
            start = self._boundary_anchor_points[idx]
            end = self._boundary_anchor_points[(idx + 1) % count]
            self._boundary_control_lines[idx * 2].setLine(QLineF(start, c1))
            self._boundary_control_lines[idx * 2 + 1].setLine(QLineF(end, c2))

    def _sample_boundary_curve(self, steps_per_segment: int = 12) -> List[QPointF]:
        samples: List[QPointF] = []
        count = len(self._boundary_anchor_points)
        for idx in range(count):
            p0 = self._boundary_anchor_points[idx]
            c1, c2 = self._boundary_controls[idx]
            p1 = self._boundary_anchor_points[(idx + 1) % count]
            start_step = 0 if idx == 0 else 1
            for step in range(start_step, steps_per_segment + 1):
                t = step / float(steps_per_segment)
                samples.append(self._cubic_point(p0, c1, c2, p1, t))
        if len(samples) > 1 and QLineF(samples[0], samples[-1]).length() < 1e-6:
            samples.pop()
        return samples

    @staticmethod
    def _cubic_point(p0: QPointF, c1: QPointF, c2: QPointF, p1: QPointF, t: float) -> QPointF:
        mt = 1.0 - t
        x = (
            mt * mt * mt * p0.x()
            + 3.0 * mt * mt * t * c1.x()
            + 3.0 * mt * t * t * c2.x()
            + t * t * t * p1.x()
        )
        y = (
            mt * mt * mt * p0.y()
            + 3.0 * mt * mt * t * c1.y()
            + 3.0 * mt * t * t * c2.y()
            + t * t * t * p1.y()
        )
        return QPointF(x, y)

    # --- Events ---

    def wheelEvent(self, event: QWheelEvent):
        factor = 1.15
        if event.angleDelta().y() > 0:
            self._zoom_by(factor)
        else:
            self._zoom_by(1 / factor)
        event.accept()

    def mousePressEvent(self, event: QMouseEvent):
        if event.button() == Qt.LeftButton and self._left_press_hits_interactive_item(event):
            super().mousePressEvent(event)
            return
        if self._boundary_edit_uid and event.button() == Qt.LeftButton:
            super().mousePressEvent(event)
            return
        if self._is_pan_gesture(event.button(), event.modifiers()):
            self._panning = True
            self._pan_start = event.position()
            self.setCursor(Qt.ClosedHandCursor)
            event.accept()
        else:
            super().mousePressEvent(event)

    def mouseMoveEvent(self, event: QMouseEvent):
        if self._panning:
            delta = event.position() - self._pan_start
            self._pan_start = event.position()
            self.horizontalScrollBar().setValue(
                self.horizontalScrollBar().value() - int(delta.x())
            )
            self.verticalScrollBar().setValue(
                self.verticalScrollBar().value() - int(delta.y())
            )
            event.accept()
        else:
            # Report position
            scene_pos = self.mapToScene(event.position().toPoint())
            x_mm = scene_pos.x() / self._units_per_mm
            y_mm = scene_pos.y() / self._units_per_mm
            self.position_changed.emit(x_mm, y_mm)
            super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event: QMouseEvent):
        if self._panning:
            self._panning = False
            self.setCursor(Qt.ArrowCursor)
            event.accept()
        else:
            super().mouseReleaseEvent(event)

    def mouseDoubleClickEvent(self, event: QMouseEvent):
        if event.button() == Qt.LeftButton:
            item = self._stitch_object_at(event.position().toPoint())
            if item is not None:
                self.select_object(item.uid)
                self.boundary_edit_requested.emit(item.uid)
                event.accept()
                return
        super().mouseDoubleClickEvent(event)

    @staticmethod
    def _is_pan_gesture(button, modifiers) -> bool:
        return button == Qt.MiddleButton or button == Qt.LeftButton

    def _left_press_hits_interactive_item(self, event: QMouseEvent) -> bool:
        point = event.position().toPoint()
        for item in self.items(point):
            if isinstance(item, (ResizeHandleItem, SelectionBoxItem, BoundaryHandleItem, StitchObjectItem)):
                return True
        return False

    def _stitch_object_at(self, point) -> Optional[StitchObjectItem]:
        for item in self.items(point):
            current = item
            while current is not None:
                if isinstance(current, StitchObjectItem):
                    return current
                current = current.parentItem()
        return None

    def _update_scene_rect_for_panning(self):
        rect = self.scene.itemsBoundingRect()
        if rect.isNull():
            return

        viewport_scene = self.mapToScene(self.viewport().rect()).boundingRect()
        margin_x = max(
            self._base_pan_margin,
            rect.width() * 0.25,
            viewport_scene.width() * 0.5,
        )
        margin_y = max(
            self._base_pan_margin,
            rect.height() * 0.25,
            viewport_scene.height() * 0.5,
        )
        self.scene.setSceneRect(
            rect.adjusted(-margin_x, -margin_y, margin_x, margin_y)
        )

    def keyPressEvent(self, event: QKeyEvent):
        if self._boundary_edit_uid and event.key() in (Qt.Key_Return, Qt.Key_Enter):
            self.apply_boundary_edit()
        elif self._boundary_edit_uid and event.key() == Qt.Key_Escape:
            self.cancel_boundary_edit()
        elif event.key() == Qt.Key_F:
            self.fit_to_content()
        elif event.key() == Qt.Key_Plus or event.key() == Qt.Key_Equal:
            uid = self.selected_object_uid()
            if uid:
                self.object_scale_requested.emit(uid, 1.1)
            else:
                self.zoom_in()
        elif event.key() == Qt.Key_Minus:
            uid = self.selected_object_uid()
            if uid:
                self.object_scale_requested.emit(uid, 1 / 1.1)
            else:
                self.zoom_out()
        elif event.key() == Qt.Key_0:
            self.reset_zoom()
        elif event.key() == Qt.Key_Escape:
            self.scene.clearSelection()
        elif event.key() in (Qt.Key_Left, Qt.Key_Right, Qt.Key_Up, Qt.Key_Down):
            uid = self.selected_object_uid()
            if uid:
                step = 50.0 if event.modifiers() & Qt.ShiftModifier else 10.0
                dx, dy = 0.0, 0.0
                if event.key() == Qt.Key_Left:
                    dx = -step
                elif event.key() == Qt.Key_Right:
                    dx = step
                elif event.key() == Qt.Key_Up:
                    dy = -step
                elif event.key() == Qt.Key_Down:
                    dy = step
                self.object_move_requested.emit(uid, dx, dy)
            else:
                super().keyPressEvent(event)
        else:
            super().keyPressEvent(event)

    def _on_scene_selection_changed(self):
        self._refresh_selection_box()
        uid = self.selected_object_uid()
        if uid:
            self.object_selected.emit(uid)
            self.region_clicked.emit(uid)

    def contextMenuEvent(self, event):
        menu = QMenu(self)
        selected_uid = self.selected_object_uid()
        if selected_uid:
            if selected_uid in self._object_items:
                menu.addAction(
                    "Edit Boundary",
                    lambda: self.boundary_edit_requested.emit(selected_uid),
                )
                menu.addSeparator()
            menu.addAction(
                "Scale Selected Up",
                lambda: self.object_scale_requested.emit(selected_uid, 1.1),
            )
            menu.addAction(
                "Scale Selected Down",
                lambda: self.object_scale_requested.emit(selected_uid, 1 / 1.1),
            )
            menu.addAction(
                "Move Selected Left",
                lambda: self.object_move_requested.emit(selected_uid, -10.0, 0.0),
            )
            menu.addAction(
                "Move Selected Right",
                lambda: self.object_move_requested.emit(selected_uid, 10.0, 0.0),
            )
            menu.addAction(
                "Move Selected Up",
                lambda: self.object_move_requested.emit(selected_uid, 0.0, -10.0),
            )
            menu.addAction(
                "Move Selected Down",
                lambda: self.object_move_requested.emit(selected_uid, 0.0, 10.0),
            )
            menu.addSeparator()
        menu.addAction("Fit to Content (F)", self.fit_to_content)
        menu.addAction("Zoom In (+)", self.zoom_in)
        menu.addAction("Zoom Out (-)", self.zoom_out)
        menu.addAction("Reset Zoom (0)", self.reset_zoom)
        menu.addSeparator()

        show_img = menu.addAction("Show Image")
        show_img.setCheckable(True)
        show_img.setChecked(self._show_image)
        show_img.toggled.connect(self.set_show_image)

        show_stitch = menu.addAction("Show Stitches")
        show_stitch.setCheckable(True)
        show_stitch.setChecked(self._show_stitches)
        show_stitch.toggled.connect(self.set_show_stitches)

        show_pts = menu.addAction("Show Stitch Points")
        show_pts.setCheckable(True)
        show_pts.setChecked(self._show_stitch_points)
        show_pts.toggled.connect(self.set_show_stitch_points)

        show_reg = menu.addAction("Show Region Masks")
        show_reg.setCheckable(True)
        show_reg.setChecked(self._show_regions)
        show_reg.toggled.connect(self.set_show_regions)

        menu.exec(event.globalPos())
