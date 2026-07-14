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
import numpy as np
from typing import Optional, List, Dict, Tuple


class StitchPathItem(QGraphicsPathItem):
    """Renders a sequence of stitch points as a vector path."""

    def __init__(self, points: List[Tuple[float, float]], color: QColor,
                 stitch_width: float = 0.8, parent=None):
        super().__init__(parent)
        self.points = points
        self.stitch_color = color
        self.stitch_width = stitch_width
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


class RegionMaskItem(QGraphicsPixmapItem):
    """Semi-transparent overlay showing a region mask."""

    def __init__(self, mask: np.ndarray, color: QColor, opacity: float = 0.3,
                 scale: float = 1.0, parent=None):
        super().__init__(parent)
        h, w = mask.shape
        # Create RGBA image
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[:, :, 0] = color.red()
        rgba[:, :, 1] = color.green()
        rgba[:, :, 2] = color.blue()
        rgba[:, :, 3] = (mask > 0).astype(np.uint8) * int(255 * opacity)

        img = QImage(rgba.data, w, h, w * 4, QImage.Format_RGBA8888)
        # Keep ref to prevent gc
        self._img_data = rgba
        pixmap = QPixmap.fromImage(img)
        self.setPixmap(pixmap)
        self.setTransformationMode(Qt.SmoothTransformation)
        if scale != 1.0:
            self.setScale(scale)


class EmbroideryCanvas(QGraphicsView):
    """Main canvas for viewing and editing embroidery patterns."""

    region_clicked = Signal(str)  # region UID
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
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setMinimumSize(400, 300)

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

        # Scene items
        self._bg_item: Optional[QGraphicsPixmapItem] = None
        self._layer_groups: Dict[str, QGraphicsItemGroup] = {}
        self._mask_items: Dict[str, RegionMaskItem] = {}
        self._grid_items: List[QGraphicsLineItem] = []

        # Scale: 1 scene unit = 1/10 mm (matching pyembroidery)
        self._units_per_mm = 10.0

        # Background
        self.setBackgroundBrush(QBrush(QColor(50, 50, 50)))

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
        self.fitInView(self.scene.sceneRect(), Qt.KeepAspectRatio)

    def set_layer_stitches(self, layer_uid: str, regions_data: List[dict]):
        """
        Set stitch paths for a layer.
        regions_data: list of {'uid': str, 'points': [(x,y),...], 'color': (r,g,b)}
        """
        # Remove existing
        if layer_uid in self._layer_groups:
            self.scene.removeItem(self._layer_groups[layer_uid])
            del self._layer_groups[layer_uid]

        group = self.scene.createItemGroup([])
        group.setZValue(0)

        for rd in regions_data:
            color = QColor(*rd['color'])
            points = rd.get('points', [])
            paths = rd.get('paths') or ([points] if points else [])
            if not paths:
                continue

            if self._show_stitches:
                for path in paths:
                    if len(path) >= 2:
                        path_item = StitchPathItem(path, color, stitch_width=0.8)
                        group.addToGroup(path_item)

            if self._show_stitch_points:
                for path in paths:
                    for x, y in path[::3]:  # every 3rd point for performance
                        dot = StitchDotItem(x, y, 0.5, color)
                        group.addToGroup(dot)

        self._layer_groups[layer_uid] = group

    def set_region_mask(self, region_uid: str, mask: np.ndarray,
                        color: Tuple[int, int, int], scale: float = 1.0):
        """Show a semi-transparent region mask overlay."""
        if region_uid in self._mask_items:
            self.scene.removeItem(self._mask_items[region_uid])

        if self._show_regions:
            qcolor = QColor(*color)
            item = RegionMaskItem(mask, qcolor, opacity=0.2, scale=scale)
            item.setZValue(-50)
            self.scene.addItem(item)
            self._mask_items[region_uid] = item

    def clear_all(self):
        """Clear all items from the scene."""
        self.scene.clear()
        self._bg_item = None
        self._layer_groups.clear()
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
        self.fitInView(rect, Qt.KeepAspectRatio)
        self._zoom = self.transform().m11()
        self.zoom_changed.emit(self._zoom)

    def zoom_in(self):
        self.scale(1.2, 1.2)
        self._zoom *= 1.2
        self.zoom_changed.emit(self._zoom)

    def zoom_out(self):
        self.scale(1 / 1.2, 1 / 1.2)
        self._zoom /= 1.2
        self.zoom_changed.emit(self._zoom)

    def reset_zoom(self):
        self.resetTransform()
        self._zoom = 1.0
        self.zoom_changed.emit(self._zoom)

    # --- Events ---

    def wheelEvent(self, event: QWheelEvent):
        factor = 1.15
        if event.angleDelta().y() > 0:
            self.scale(factor, factor)
            self._zoom *= factor
        else:
            self.scale(1 / factor, 1 / factor)
            self._zoom /= factor
        self.zoom_changed.emit(self._zoom)

    def mousePressEvent(self, event: QMouseEvent):
        if event.button() == Qt.MiddleButton or (
            event.button() == Qt.LeftButton and
            event.modifiers() & Qt.AltModifier
        ):
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

    def keyPressEvent(self, event: QKeyEvent):
        if event.key() == Qt.Key_F:
            self.fit_to_content()
        elif event.key() == Qt.Key_Plus or event.key() == Qt.Key_Equal:
            self.zoom_in()
        elif event.key() == Qt.Key_Minus:
            self.zoom_out()
        elif event.key() == Qt.Key_0:
            self.reset_zoom()
        else:
            super().keyPressEvent(event)

    def contextMenuEvent(self, event):
        menu = QMenu(self)
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
