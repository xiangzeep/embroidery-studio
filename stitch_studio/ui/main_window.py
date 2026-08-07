"""
Main Window
Central application window with dock panels, toolbar, menu bar,
and the embroidery canvas.
"""

import os
import traceback
from copy import copy
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partial

import cv2
import numpy as np

from PySide6.QtWidgets import (
    QMainWindow, QDockWidget, QToolBar, QStatusBar,
    QFileDialog, QMessageBox, QProgressDialog, QApplication,
    QLabel, QSizePolicy, QWidget, QVBoxLayout
)
from PySide6.QtCore import Qt, QThread, Signal, QTimer
from PySide6.QtGui import QAction, QActionGroup, QKeySequence, QIcon
from shapely import intersects_xy
from shapely.geometry import Polygon
from shapely.affinity import scale as shapely_scale, translate as shapely_translate

from ..core.thread_db import ThreadDatabase
from ..core.project import Project, Layer, Region, StitchSettings
from ..core.image_engine import ImageEngine, FlowFieldEngine
from ..core.recognition_engine import RecognitionEngine
from ..core.stitch_engine import StitchEngine, CrossStitchOwnershipContext
from ..core.export_engine import ExportEngine, SUPPORTED_FORMATS
from ..i18n import tr

from .canvas import EmbroideryCanvas
from .panels import ThreadPanel, LayerPanel, PropertiesPanel, ImagePanel, StatsPanel


class StitchWorker(QThread):
    """Background thread for stitch generation."""
    progress = Signal(int, int)  # current, total

    def __init__(self, project, stitch_engine, image=None, flow_field=None):
        super().__init__()
        self.project = project
        self.engine = stitch_engine
        self.image = image
        self.flow_field = flow_field
        self.failure_message = None

    def run(self):
        try:
            total_regions = sum(len(l.regions) for l in self.project.layers)
            region_jobs = [
                (layer, region)
                for layer in self.project.layers
                if layer.visible
                for region in layer.regions
                if region.visible
            ]
            cross_jobs = [
                (layer, region)
                for layer, region in region_jobs
                if (
                    region.stitch_settings.fill_mode == "cross_stitch"
                    and not getattr(region, "is_cross_stitch_overlay", False)
                )
            ]
            other_jobs = [
                (layer, region)
                for layer, region in region_jobs
                if (
                    region.stitch_settings.fill_mode != "cross_stitch"
                    or getattr(region, "is_cross_stitch_overlay", False)
                )
            ]
            ownership_contexts = {}
            if cross_jobs and all(
                getattr(region, "is_cross_stitch_overlay", False)
                for _, region in other_jobs
            ):
                work_items = self._cross_stitch_work_items(region_jobs, self.engine)
            else:
                ownership_contexts = self._build_cross_stitch_ownership_contexts(
                    self.engine,
                    cross_jobs,
                )
                work_items = [
                    (layer, region, [region], region, None)
                    for layer, region in cross_jobs
                ]
                work_items.extend(self._photo_stitch_work_items(other_jobs))

            done = total_regions - sum(len(item[2]) for item in work_items)

            worker_count = self._generation_worker_count(len(work_items))
            if worker_count <= 1:
                for _, target, members, working_region, ownership_context in work_items:
                    paths = self.engine.generate_region_paths(
                        working_region,
                        self.image,
                        self.flow_field,
                        ownership_context=(
                            ownership_context
                            or ownership_contexts.get(working_region.uid)
                        ),
                    )
                    self._store_group_paths(target, members, paths)
                    done += len(members)
                    self.progress.emit(done, total_regions)
            else:
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    future_to_item = {
                        executor.submit(
                            self.engine.generate_region_paths,
                            working_region,
                            self.image,
                            self.flow_field,
                            ownership_context=(
                                ownership_context
                                or ownership_contexts.get(working_region.uid)
                            ),
                        ): (target, members)
                        for _, target, members, working_region, ownership_context in work_items
                    }
                    for future in as_completed(future_to_item):
                        target, members = future_to_item[future]
                        paths = future.result()
                        self._store_group_paths(target, members, paths)
                        done += len(members)
                        self.progress.emit(done, total_regions)
        except Exception as e:
            self.failure_message = f"{e}\n{traceback.format_exc()}"

    @staticmethod
    def _photo_stitch_work_items(region_jobs):
        """Merge same-thread masks when all professional settings match."""
        groups = {}
        for layer, region in region_jobs:
            mask = region.mask
            shape = tuple(mask.shape) if mask is not None else None
            settings_key = tuple(sorted(region.stitch_settings.to_dict().items()))
            separate_outline = region.stitch_settings.fill_mode in (
                "run",
                "satin",
                "contour",
            )
            preserve_disconnected_detail = (
                getattr(region, "semantic_kind", "") == "protected_highlight"
            )
            key = (
                id(layer),
                shape,
                settings_key,
                (
                    region.uid
                    if separate_outline or preserve_disconnected_detail
                    else None
                ),
            )
            groups.setdefault(key, []).append((layer, region))

        work_items = []
        for entries in groups.values():
            layer = entries[0][0]
            members = [region for _, region in entries]
            target = max(
                members,
                key=lambda region: (
                    int(np.count_nonzero(region.mask))
                    if region.mask is not None else 0
                ),
            )
            if len(members) == 1 or target.mask is None:
                working_region = target
            else:
                combined = np.zeros(target.mask.shape, dtype=np.uint8)
                for region in members:
                    if region.mask is not None and region.mask.shape == combined.shape:
                        combined[region.mask > 0] = 255
                working_region = copy(target)
                working_region.mask = combined
                working_region.polygon = None
            work_items.append((layer, target, members, working_region, None))
        return work_items

    @classmethod
    def _cross_stitch_work_items(cls, region_jobs, engine):
        """Keep shared cross-fill ownership separate from run-detail overlays."""
        fills = [
            (layer, region)
            for layer, region in region_jobs
            if (
                region.stitch_settings.fill_mode == "cross_stitch"
                and not getattr(region, "is_cross_stitch_overlay", False)
            )
        ]
        overlays = [
            (layer, region)
            for layer, region in region_jobs
            if getattr(region, "is_cross_stitch_overlay", False)
        ]
        ownership_contexts = cls._build_cross_stitch_ownership_contexts(engine, fills)
        fill_items = [
            (layer, region, [region], region, ownership_contexts.get(region.uid))
            for layer, region in fills
        ]
        overlay_items = [
            (layer, region, [region], region, None)
            for layer, region in overlays
        ]
        return fill_items + overlay_items

    @staticmethod
    def _generation_worker_count(job_count: int) -> int:
        if job_count <= 1:
            return 1
        cpu_count = os.cpu_count() or 1
        return max(1, min(job_count, cpu_count))

    @staticmethod
    def _cross_stitch_priority(layer, region=None) -> float:
        if getattr(region, "is_detail_region", False):
            return 5.0
        if region is None and getattr(layer, "is_detail_layer", False):
            return 5.0
        color = (
            getattr(region, "design_color_rgb", None)
            or getattr(layer, "design_color_rgb", None)
            or layer.thread_color_rgb
        )
        luminance = 0.299 * color[0] + 0.587 * color[1] + 0.114 * color[2]
        return 3.0 if luminance < 72.0 else 1.0

    @classmethod
    def _build_cross_stitch_ownership_context(cls, engine, region_jobs):
        """Build one complete shared ownership context for compatible regions."""
        if len(region_jobs) < 2 or not all(
            region.stitch_settings.fill_mode == "cross_stitch"
            for _, region in region_jobs
        ):
            return None

        priorities = [
            (region, cls._cross_stitch_priority(layer, region))
            for layer, region in region_jobs
        ]
        base_masks = engine.build_cross_stitch_ownership_masks(priorities)
        if not base_masks:
            return None

        source_groups = {}
        source_keys = {}
        for layer, region in region_jobs:
            if layer.thread_uid:
                physical_key = ("thread", layer.thread_uid)
            else:
                physical_key = ("color", tuple(layer.effective_color_rgb()))
            source_keys[region.uid] = physical_key
            source_region = (region.mask > 0).astype(np.uint8) * 255
            if physical_key in source_groups:
                np.maximum(
                    source_groups[physical_key],
                    source_region,
                    out=source_groups[physical_key],
                )
            else:
                source_groups[physical_key] = np.array(source_region, copy=True)
        source_masks = {
            region.uid: source_groups[source_keys[region.uid]]
            for _, region in region_jobs
        }

        dense_masks = None
        if any(
            region.stitch_settings.cross_method == "auto"
            or region.stitch_settings.cross_method.startswith("dense_upright")
            for _, region in region_jobs
        ):
            reference = region_jobs[0][1].stitch_settings
            half_pattern_mm = reference.cross_pattern_size_mm / 2.0
            dense_masks = engine.build_cross_stitch_ownership_masks(
                priorities,
                grid_offset_shift_mm=(half_pattern_mm, half_pattern_mm),
            )
            if not dense_masks:
                raise ValueError("Dense cross stitch ownership builder returned no masks")

        return CrossStitchOwnershipContext.from_ownership_masks(
            base_masks,
            dense_masks,
            source_masks,
        )

    @staticmethod
    def _cross_stitch_grid_key(region):
        """Return the allocation inputs that must match for one shared grid."""
        settings = region.stitch_settings
        return (
            tuple(region.mask.shape) if region.mask is not None else None,
            round(float(settings.cross_pattern_size_mm), 6),
            bool(settings.cross_align_grid),
            round(float(settings.cross_grid_offset_x_mm), 6),
            round(float(settings.cross_grid_offset_y_mm), 6),
        )

    @classmethod
    def _build_cross_stitch_ownership_contexts(cls, engine, region_jobs):
        """Create contexts only for compatible multi-region cross-stitch grids."""
        groups = {}
        for layer, region in region_jobs:
            if (
                region.stitch_settings.fill_mode != "cross_stitch"
                or getattr(region, "is_cross_stitch_overlay", False)
                or region.mask is None
            ):
                continue
            groups.setdefault(cls._cross_stitch_grid_key(region), []).append((layer, region))

        contexts = {}
        for entries in groups.values():
            context = cls._build_cross_stitch_ownership_context(engine, entries)
            if context is not None:
                contexts.update({region.uid: context for _, region in entries})
        return contexts

    @staticmethod
    def _store_region_paths(region, paths):
        region.stitch_paths = paths
        region.stitch_points = [pt for path in paths for pt in path]

    @classmethod
    def _store_group_paths(cls, target, members, paths):
        for region in members:
            if region is not target:
                region.stitch_paths = []
                region.stitch_points = []
        cls._store_region_paths(target, paths)


class QuantizeWorker(QThread):
    """Background image quantization and segmentation worker."""
    progress = Signal(str)
    result_ready = Signal(object)
    error = Signal(str)

    def __init__(
        self,
        source_image,
        image_settings,
        quant_settings,
        palette_threads,
        generation_mode,
    ):
        super().__init__()
        self.source_image = source_image
        self.image_settings = image_settings
        self.quant_settings = quant_settings
        self.palette_threads = list(palette_threads)
        self.generation_mode = generation_mode

    def run(self):
        try:
            self.progress.emit(tr("status.adjusting"))
            processed = ImageEngine.apply_adjustments(
                self.source_image,
                self.image_settings,
            )

            self.progress.emit(tr("status.matching"))
            recognition = RecognitionEngine.recognize(
                processed,
                self.palette_threads,
                self.quant_settings,
            )

            self.progress.emit(tr("status.layers"))
            layers = ImageEngine.build_layers_from_recognition(
                recognition,
                self.palette_threads,
                processed,
                self.generation_mode,
                self.quant_settings,
            )
            diagnostics = RecognitionEngine.build_design_diagnostics(
                processed,
                recognition,
            )
            regions = [
                (region.design_color_id, region.mask)
                for layer in layers
                for region in layer.regions
                if region.mask is not None
            ]

            self.result_ready.emit({
                "processed": processed,
                "thread_map": (
                    recognition.thread_map
                    if recognition.thread_map is not None
                    else recognition.design_map
                ),
                "used_indices": sorted({
                    color.nearest_thread_index
                    for color in recognition.design_colors
                    if color.nearest_thread_index is not None
                }),
                "regions": regions,
                "layers": layers,
                "recognition": recognition,
                "recognition_diagnostics": diagnostics,
            })
        except Exception as e:
            self.error.emit(f"{e}\n{traceback.format_exc()}")


class MainWindow(QMainWindow):
    """Main application window for Stitch Studio."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle(tr("app.title"))
        self.setMinimumSize(1200, 800)
        self.resize(1600, 1000)

        # Core state
        self.project = Project()
        self.thread_db = ThreadDatabase()
        self.thread_db.load()
        self.image_engine = ImageEngine()
        self.stitch_engine = StitchEngine()
        self.flow_engine = FlowFieldEngine()
        self.export_engine = ExportEngine()

        # Computed data
        self._flow_field = None
        self._orientation_field = None
        self._coherence_field = None
        self._worker = None
        self._quant_worker = None
        self._pending_export_path = None

        # Build UI
        self._create_actions()
        self._create_canvas()
        self._create_menus()
        self._create_toolbar()
        self._create_panels()
        self._create_statusbar()
        self._connect_signals()

        # Restore layout
        self._apply_default_layout()
        self._set_generation_mode(self.project.generation_mode)

    # ========== UI CONSTRUCTION ==========

    def _create_actions(self):
        self.act_new = QAction(tr("action.new_project"), self)
        self.act_new.setShortcut(QKeySequence.New)
        self.act_new.triggered.connect(self._new_project)

        self.act_open = QAction(tr("action.open_project"), self)
        self.act_open.setShortcut(QKeySequence.Open)
        self.act_open.triggered.connect(self._open_project)

        self.act_save = QAction(tr("action.save_project"), self)
        self.act_save.setShortcut(QKeySequence.Save)
        self.act_save.triggered.connect(self._save_project)

        self.act_save_as = QAction(tr("action.save_as"), self)
        self.act_save_as.setShortcut(QKeySequence("Ctrl+Shift+S"))
        self.act_save_as.triggered.connect(self._save_project_as)

        self.act_load_image = QAction(tr("action.load_image"), self)
        self.act_load_image.setShortcut(QKeySequence("Ctrl+I"))
        self.act_load_image.triggered.connect(self._load_image)

        self.act_export = QAction(tr("action.export"), self)
        self.act_export.setShortcut(QKeySequence("Ctrl+E"))
        self.act_export.triggered.connect(self._export_pattern)

        self.act_export_layer = QAction(tr("action.export_layer"), self)
        self.act_export_layer.triggered.connect(self._export_selected_layer)

        self.act_quantize = QAction(tr("action.quantize"), self)
        self.act_quantize.setShortcut(QKeySequence("Ctrl+Q"))
        self.act_quantize.triggered.connect(self._quantize_and_segment)

        self.generation_mode_actions = QActionGroup(self)
        self.generation_mode_actions.setExclusive(True)

        self.act_photo_stitch_mode = QAction(tr("image.photo"), self, checkable=True)
        self.act_photo_stitch_mode.setToolTip(tr("image.photo_tip"))
        self.act_photo_stitch_mode.triggered.connect(
            lambda checked: self._set_generation_mode("photo_stitch") if checked else None
        )

        self.act_cross_stitch_mode = QAction(tr("image.cross"), self, checkable=True)
        self.act_cross_stitch_mode.setToolTip(tr("image.cross_tip"))
        self.act_cross_stitch_mode.triggered.connect(
            lambda checked: self._set_generation_mode("cross_stitch") if checked else None
        )

        self.generation_mode_actions.addAction(self.act_photo_stitch_mode)
        self.generation_mode_actions.addAction(self.act_cross_stitch_mode)

        self.act_gen_stitches = QAction(tr("action.generate_stitches"), self)
        self.act_gen_stitches.setShortcut(QKeySequence("Ctrl+G"))
        self.act_gen_stitches.triggered.connect(self._generate_stitches)

        self.act_fit_view = QAction(tr("action.fit"), self)
        self.act_fit_view.setShortcut(QKeySequence("F"))
        self.act_fit_view.triggered.connect(lambda: self.canvas.fit_to_content())

    def _create_menus(self):
        menu_bar = self.menuBar()

        # File menu
        file_menu = menu_bar.addMenu(tr("menu.file"))
        file_menu.addAction(self.act_new)
        file_menu.addAction(self.act_open)
        file_menu.addAction(self.act_save)
        file_menu.addAction(self.act_save_as)
        file_menu.addSeparator()
        file_menu.addAction(self.act_load_image)
        file_menu.addSeparator()
        file_menu.addAction(self.act_export)
        file_menu.addAction(self.act_export_layer)
        file_menu.addSeparator()
        file_menu.addAction(tr("action.exit"), self.close, QKeySequence("Ctrl+W"))

        # Process menu
        proc_menu = menu_bar.addMenu(tr("menu.process"))
        proc_menu.addAction(self.act_quantize)
        proc_menu.addAction(self.act_gen_stitches)
        proc_menu.addSeparator()
        proc_menu.addAction(tr("action.compute_flow"), self._compute_flow_field)

        # View menu
        self.view_menu = menu_bar.addMenu(tr("menu.view"))
        self.view_menu.addAction(self.act_fit_view)
        self.view_menu.addSeparator()

        self.act_show_image = QAction(tr("action.show_image"), self, checkable=True, checked=True)
        self.act_show_image.toggled.connect(self.canvas.set_show_image)
        self.view_menu.addAction(self.act_show_image)

        self.act_show_stitches = QAction(tr("action.show_stitches"), self, checkable=True, checked=True)
        self.act_show_stitches.toggled.connect(self.canvas.set_show_stitches)
        self.view_menu.addAction(self.act_show_stitches)

        self.act_show_points = QAction(tr("action.show_points"), self, checkable=True, checked=False)
        self.act_show_points.toggled.connect(self.canvas.set_show_stitch_points)
        self.view_menu.addAction(self.act_show_points)

        self.act_show_regions = QAction(tr("action.show_regions"), self, checkable=True, checked=True)
        self.act_show_regions.toggled.connect(self.canvas.set_show_regions)
        self.view_menu.addAction(self.act_show_regions)

        self.view_menu.addSeparator()
        # Panel visibility
        self._dock_actions = []  # populated after docks are created

        # Help menu
        help_menu = menu_bar.addMenu(tr("menu.help"))
        help_menu.addAction(tr("action.about"), self._show_about)
        help_menu.addAction(tr("action.shortcuts"), self._show_shortcuts)

    def _create_toolbar(self):
        toolbar = QToolBar(tr("toolbar.main"))
        toolbar.setMovable(False)
        self.addToolBar(toolbar)

        toolbar.addAction(self.act_load_image)
        toolbar.addSeparator()
        toolbar.addAction(self.act_quantize)
        toolbar.addAction(self.act_gen_stitches)
        toolbar.addSeparator()
        toolbar.addAction(self.act_export)
        toolbar.addSeparator()
        toolbar.addAction(self.act_fit_view)

        # Image opacity slider
        toolbar.addSeparator()
        toolbar.addWidget(QLabel(tr("toolbar.image")))
        from PySide6.QtWidgets import QSlider
        self.toolbar_opacity = QSlider(Qt.Horizontal)
        self.toolbar_opacity.setRange(0, 100)
        self.toolbar_opacity.setValue(50)
        self.toolbar_opacity.setMaximumWidth(120)
        self.toolbar_opacity.setToolTip(tr("toolbar.image_opacity"))
        self._pending_image_opacity = None
        self._image_opacity_timer = QTimer(self)
        self._image_opacity_timer.setSingleShot(True)
        self._image_opacity_timer.setInterval(33)
        self._image_opacity_timer.timeout.connect(self._flush_image_opacity)
        self.toolbar_opacity.valueChanged.connect(self._queue_image_opacity)
        self.toolbar_opacity.sliderPressed.connect(
            self._begin_image_opacity_interaction
        )
        self.toolbar_opacity.sliderReleased.connect(
            self._finish_image_opacity_interaction
        )
        toolbar.addWidget(self.toolbar_opacity)

    def _begin_image_opacity_interaction(self):
        self.canvas.cancel_boundary_edit()
        self.canvas.begin_image_opacity_interaction()

    def _finish_image_opacity_interaction(self):
        self._flush_image_opacity()
        self.canvas.end_image_opacity_interaction()

    def _queue_image_opacity(self, value: int):
        self._pending_image_opacity = max(0.0, min(1.0, float(value) / 100.0))
        if not self._image_opacity_timer.isActive():
            self._image_opacity_timer.start()

    def _flush_image_opacity(self):
        if self._pending_image_opacity is None:
            return
        opacity = self._pending_image_opacity
        self._pending_image_opacity = None
        self.canvas.set_image_opacity(opacity)

    def _create_canvas(self):
        self.canvas = EmbroideryCanvas(self)
        self.setCentralWidget(self.canvas)

    def _create_panels(self):
        # Thread Panel
        self.dock_threads = QDockWidget(tr("dock.thread"), self)
        self.thread_panel = ThreadPanel(self.thread_db)
        self.dock_threads.setWidget(self.thread_panel)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.dock_threads)

        # Layer Panel
        self.dock_layers = QDockWidget(tr("dock.layers"), self)
        self.layer_panel = LayerPanel()
        self.dock_layers.setWidget(self.layer_panel)
        self.addDockWidget(Qt.RightDockWidgetArea, self.dock_layers)

        # Properties Panel
        self.dock_props = QDockWidget(tr("dock.properties"), self)
        self.props_panel = PropertiesPanel()
        self.dock_props.setWidget(self.props_panel)
        self.addDockWidget(Qt.RightDockWidgetArea, self.dock_props)

        # Image Panel
        self.dock_image = QDockWidget(tr("dock.image"), self)
        self.image_panel = ImagePanel()
        self.dock_image.setWidget(self.image_panel)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.dock_image)

        # Stats Panel
        self.dock_stats = QDockWidget(tr("dock.stats"), self)
        self.stats_panel = StatsPanel()
        self.dock_stats.setWidget(self.stats_panel)
        self.addDockWidget(Qt.RightDockWidgetArea, self.dock_stats)

        # Add toggle actions to View menu
        self.view_menu.addAction(self.dock_threads.toggleViewAction())
        self.view_menu.addAction(self.dock_layers.toggleViewAction())
        self.view_menu.addAction(self.dock_props.toggleViewAction())
        self.view_menu.addAction(self.dock_image.toggleViewAction())
        self.view_menu.addAction(self.dock_stats.toggleViewAction())

    def _create_statusbar(self):
        self.statusbar = QStatusBar()
        self.setStatusBar(self.statusbar)

        self.status_pos = QLabel(tr("status.position").format(x=0.0, y=0.0))
        self.status_zoom = QLabel(tr("status.zoom").format(zoom=100))
        self.status_info = QLabel(tr("status.ready"))

        self.statusbar.addWidget(self.status_info, 1)
        self.statusbar.addPermanentWidget(self.status_pos)
        self.statusbar.addPermanentWidget(self.status_zoom)

    def _connect_signals(self):
        # Canvas signals
        self.canvas.position_changed.connect(
            lambda x, y: self.status_pos.setText(
                tr("status.position").format(x=x, y=y)
            )
        )
        self.canvas.zoom_changed.connect(
            lambda z: self.status_zoom.setText(
                tr("status.zoom").format(zoom=z * 100)
            )
        )
        self.canvas.object_selected.connect(self._on_canvas_object_selected)
        self.canvas.object_scale_requested.connect(self._scale_stitch_object)
        self.canvas.object_move_requested.connect(self._move_stitch_object)
        self.canvas.object_resize_requested.connect(self._resize_stitch_object)
        self.canvas.boundary_edit_requested.connect(self._start_boundary_edit)
        self.canvas.boundary_edit_applied.connect(self._apply_boundary_edit)

        # Layer panel
        self.layer_panel.layer_selected.connect(self._on_layer_selected)
        self.layer_panel.layer_visibility_changed.connect(self._on_visibility_changed)
        self.layer_panel.layer_order_changed.connect(self._refresh_canvas)
        self.layer_panel.request_regenerate.connect(self._generate_stitches)

        # Properties panel
        self.props_panel.settings_changed.connect(self._on_settings_changed)

        # Image panel
        self.image_panel.image_changed.connect(self._on_image_settings_changed)
        self.image_panel.quantize_requested.connect(self._quantize_and_segment)
        self.image_panel.recognition_preview_requested.connect(
            self._show_recognition_preview
        )
        self.image_panel.production_preview_requested.connect(
            self._show_production_preview
        )
        self.image_panel.btn_photo_stitch.toggled.connect(
            lambda checked: self._set_generation_mode("photo_stitch") if checked else None
        )
        self.image_panel.btn_cross_stitch.toggled.connect(
            lambda checked: self._set_generation_mode("cross_stitch") if checked else None
        )

        # Thread panel
        self.thread_panel.threads_changed.connect(self._on_threads_changed)

    def _apply_default_layout(self):
        # Stack panels nicely
        self.tabifyDockWidget(self.dock_threads, self.dock_image)
        self.dock_image.raise_()
        self.tabifyDockWidget(self.dock_layers, self.dock_props)
        self.tabifyDockWidget(self.dock_props, self.dock_stats)
        self.dock_layers.raise_()

    def _set_generation_mode(self, mode: str):
        """Synchronize the prominent mode controls with the project state."""
        mode = "cross_stitch" if mode == "cross_stitch" else "photo_stitch"
        self.project.generation_mode = mode

        self.act_photo_stitch_mode.blockSignals(True)
        self.act_cross_stitch_mode.blockSignals(True)
        try:
            self.act_photo_stitch_mode.setChecked(mode == "photo_stitch")
            self.act_cross_stitch_mode.setChecked(mode == "cross_stitch")
        finally:
            self.act_photo_stitch_mode.blockSignals(False)
            self.act_cross_stitch_mode.blockSignals(False)

        if hasattr(self, "image_panel"):
            self.image_panel.btn_photo_stitch.blockSignals(True)
            self.image_panel.btn_cross_stitch.blockSignals(True)
            try:
                self.image_panel.set_generation_mode(mode)
            finally:
                self.image_panel.btn_photo_stitch.blockSignals(False)
                self.image_panel.btn_cross_stitch.blockSignals(False)

        if mode == "cross_stitch":
            self.act_quantize.setText(tr("status.quantize_cross"))
            self.status_info.setText(tr("status.mode_cross"))
        else:
            self.act_quantize.setText(tr("status.quantize_photo"))
            self.status_info.setText(tr("status.mode_photo"))

    # ========== ACTIONS ==========

    def _new_project(self):
        if self.project.modified:
            reply = QMessageBox.question(
                self, tr("dialog.new_project"),
                tr("dialog.unsaved_continue"),
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.No:
                return

        self.project = Project()
        self.canvas.clear_all()
        self.layer_panel.set_project(self.project)
        self.image_panel.set_recognition_preview_available(False)
        self._flow_field = None
        self.status_info.setText(tr("status.new_project"))

    def _open_project(self):
        path, _ = QFileDialog.getOpenFileName(
            self, tr("dialog.open_project"), "",
            "Stitch Studio Project (*.ssp);;All Files (*)"
        )
        if not path:
            return

        try:
            self.project = Project()
            self.project.load(path)
            self.layer_panel.set_project(self.project)
            self.image_panel.set_recognition_preview_available(False)

            if self.project.source_image is not None:
                size = (self.project.image_settings.output_width_mm,
                        self.project.image_settings.output_height_mm)
                self.canvas.set_background_image(self.project.source_image, size)
                self.image_panel.set_image_settings(self.project.image_settings)
                self.image_panel.set_quant_settings(self.project.quant_settings)
                self._set_generation_mode(self.project.generation_mode)
                self.dock_image.raise_()

            self._refresh_canvas()
            self.status_info.setText(tr("status.opened").format(path=path))
        except Exception as e:
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.load_failed").format(error=e)
            )

    def _save_project(self):
        if not self.project.filepath:
            self._save_project_as()
            return
        try:
            self.project.image_settings = self.image_panel.get_image_settings()
            self.project.quant_settings = self.image_panel.get_quant_settings()
            self.project.generation_mode = self.image_panel.get_generation_mode()
            self.project.save()
            self.status_info.setText(tr("status.saved").format(path=self.project.filepath))
        except Exception as e:
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.save_failed").format(error=e)
            )

    def _save_project_as(self):
        path, _ = QFileDialog.getSaveFileName(
            self, tr("dialog.save_as"), self.project.name + ".ssp",
            "Stitch Studio Project (*.ssp)"
        )
        if path:
            self.project.image_settings = self.image_panel.get_image_settings()
            self.project.quant_settings = self.image_panel.get_quant_settings()
            self.project.generation_mode = self.image_panel.get_generation_mode()
            self.project.save(path)
            self.status_info.setText(tr("status.saved").format(path=path))

    def _load_image(self):
        path, _ = QFileDialog.getOpenFileName(
            self, tr("dialog.load_image"), "",
            "Images (*.png *.jpg *.jpeg *.bmp *.tiff *.webp);;All Files (*)"
        )
        if not path:
            return

        try:
            image = self.image_engine.load_image(path)
            self.project.source_image = image
            self.project.source_image_path = path
            self.project.name = os.path.splitext(os.path.basename(path))[0]
            self.project.recognition_diagnostics = None
            self.image_panel.set_recognition_preview_available(False)

            # Auto-set output size proportional to image
            h, w = image.shape[:2]
            max_dim = 150  # mm
            if w >= h:
                self.project.image_settings.output_width_mm = max_dim
                self.project.image_settings.output_height_mm = max_dim * h / w
            else:
                self.project.image_settings.output_height_mm = max_dim
                self.project.image_settings.output_width_mm = max_dim * w / h

            self.image_panel.set_image_settings(self.project.image_settings)
            self.dock_image.raise_()

            # Apply adjustments and show
            self._apply_image_and_show()

            self.setWindowTitle(f"Stitch Studio — {self.project.name}")
            self.status_info.setText(
                tr("status.loaded_image").format(path=path, width=w, height=h)
            )

        except Exception as e:
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.image_load_failed").format(error=e)
            )

    def _apply_image_and_show(self):
        """Apply image adjustments and display on canvas."""
        if self.project.source_image is None:
            return

        settings = self.image_panel.get_image_settings()
        processed = self.image_engine.apply_adjustments(
            self.project.source_image, settings
        )
        self.project.processed_image = processed

        size = (settings.output_width_mm, settings.output_height_mm)
        self.canvas.set_background_image(processed, size)
        self.canvas.fit_to_content()

    def _quantize_and_segment(self):
        """Run color quantization and segmentation."""
        if self.project.source_image is None:
            QMessageBox.warning(
                self, tr("dialog.no_image"), tr("dialog.no_image_body")
            )
            return
        if self._quant_worker is not None:
            self.status_info.setText(tr("status.processing_busy"))
            return

        try:
            # Get settings
            img_settings = self.image_panel.get_image_settings()
            quant_settings = self.image_panel.get_quant_settings()
            self._set_generation_mode(self.image_panel.get_generation_mode())

            # Get palette from thread DB
            all_threads = self.thread_db.get_all_threads()
            if not all_threads:
                QMessageBox.warning(
                    self, tr("dialog.no_threads"), tr("dialog.no_threads_body")
                )
                return

            self.status_info.setText(tr("status.processing_start"))
            self.act_quantize.setEnabled(False)
            self.image_panel.btn_quantize.setEnabled(False)
            self._quant_worker = QuantizeWorker(
                self.project.source_image.copy(),
                img_settings,
                quant_settings,
                all_threads,
                self.project.generation_mode,
            )
            self._quant_worker.progress.connect(self.status_info.setText)
            self._quant_worker.result_ready.connect(
                lambda result, settings=img_settings: self._on_quantize_done(result, settings)
            )
            self._quant_worker.error.connect(self._on_quantize_error)
            self._quant_worker.finished.connect(self._finish_quantize_worker)
            self._quant_worker.start()

        except Exception as e:
            self._finish_quantize_worker()
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.quantize_failed").format(
                    error=f"{e}\n{traceback.format_exc()}"
                )
            )

    def _on_quantize_done(self, result, img_settings):
        processed = result["processed"]
        thread_map = result["thread_map"]
        used_indices = result["used_indices"]
        regions = result["regions"]
        layers = result["layers"]
        recognition = result.get("recognition")
        diagnostics = result.get("recognition_diagnostics")

        self.project.processed_image = processed
        self.project.quantized_map = thread_map
        self.project.layers = layers
        self.project.recognition_diagnostics = diagnostics
        self.project.modified = True

        # Update UI
        self.layer_panel.set_project(self.project)

        self.image_panel.set_recognition_preview_available(diagnostics is not None)
        self._show_production_preview()
        self.status_info.setText(
            tr("status.quantized").format(
                colors=len(used_indices),
                regions=len(regions),
                layers=len(layers),
                color_fidelity=(
                    recognition.thread_metrics.perceptual_similarity * 100.0
                    if recognition is not None else 0.0
                ),
                edge_fidelity=(
                    recognition.thread_metrics.boundary_recall * 100.0
                    if recognition is not None else 0.0
                ),
                detail_fidelity=(
                    recognition.thread_metrics.detail_recall * 100.0
                    if recognition is not None else 0.0
                ),
                subject_fidelity=(
                    recognition.subject_metrics.perceptual_similarity * 100.0
                    if recognition is not None else 0.0
                ),
            )
        )

    def _show_production_preview(self):
        """Restore the actual embroidery-layer preview after design QA."""
        processed = self.project.processed_image
        if processed is None:
            return

        img_settings = self.image_panel.get_image_settings()
        img_h, img_w = processed.shape[:2]
        out_w = img_settings.output_width_mm * 10
        out_h = img_settings.output_height_mm * 10
        mask_scale = min(out_w / img_w, out_h / img_h)

        self.canvas.clear_all()
        self.canvas.set_background_image(
            processed,
            (img_settings.output_width_mm, img_settings.output_height_mm)
        )
        for layer in self.project.layers:
            for region in layer.regions:
                if region.mask is not None:
                    self.canvas.set_region_mask(
                        region.uid,
                        region.mask,
                        layer.thread_color_rgb,
                        mask_scale,
                        getattr(region, "polygon", None),
                    )
        self.canvas.fit_to_content()

    def _show_recognition_preview(self, mode: str):
        """Display source-faithful design QA without physical thread remapping."""
        diagnostics = getattr(self.project, "recognition_diagnostics", None)
        if diagnostics is None:
            return

        previews = {
            "design": diagnostics.design_preview_rgb,
            "layers": diagnostics.layer_preview_rgb,
            "difference": diagnostics.difference_heatmap_rgb,
        }
        preview = previews.get(mode, diagnostics.design_preview_rgb)
        img_settings = self.image_panel.get_image_settings()
        self.canvas.clear_all()
        self.canvas.set_background_image(
            preview,
            (img_settings.output_width_mm, img_settings.output_height_mm),
        )
        self.canvas.fit_to_content()

    def _on_quantize_error(self, msg):
        QMessageBox.critical(
            self, tr("dialog.error"),
            tr("dialog.quantize_failed").format(error=msg)
        )

    def _finish_quantize_worker(self):
        self.act_quantize.setEnabled(True)
        self.image_panel.btn_quantize.setEnabled(True)
        self._quant_worker = None

    def _compute_flow_field(self):
        """Compute orientation/flow field from the image."""
        if self.project.processed_image is None:
            QMessageBox.warning(
                self, tr("dialog.no_image"), tr("dialog.no_processed_image_body")
            )
            return

        self.status_info.setText(tr("status.flow"))
        QApplication.processEvents()

        try:
            img = self.project.processed_image
            orientation, coherence = self.flow_engine.compute_structure_tensor(img, sigma=2.0)
            orientation = self.flow_engine.smooth_orientation(orientation, n_iters=5, sigma=3.0)

            import numpy as np
            flow_x = np.cos(orientation)
            flow_y = np.sin(orientation)

            self._flow_field = (flow_x, flow_y)
            self._orientation_field = orientation
            self._coherence_field = coherence

            self.status_info.setText(tr("status.flow_done"))

        except Exception as e:
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.flow_failed").format(error=e)
            )

    def _generate_stitches(self):
        """Generate stitches for all layers (background thread)."""
        if self._worker is not None and self._worker.isRunning():
            self.status_info.setText(tr("status.generating"))
            return
        if not self.project.layers:
            QMessageBox.warning(
                self, tr("dialog.no_layers"), tr("dialog.no_layers_body")
            )
            return

        self.status_info.setText(tr("status.generating"))

        # Set px_per_mm based on image and output size
        if self.project.processed_image is not None:
            img_settings = self.image_panel.get_image_settings()
            h, w = self.project.processed_image.shape[:2]
            px_per_mm = w / img_settings.output_width_mm
            self.stitch_engine.px_per_mm = px_per_mm

        self._worker = StitchWorker(
            self.project, self.stitch_engine,
            self.project.processed_image, self._flow_field
        )
        self._worker.progress.connect(self._on_stitch_progress)
        self._worker.finished.connect(self._on_stitch_worker_finished)
        self._worker.start()

    def _on_stitch_progress(self, current, total):
        self.status_info.setText(
            tr("status.generating_progress").format(current=current, total=total)
        )
        QApplication.processEvents()

    def _on_stitch_done(self):
        self._refresh_canvas()
        self.act_show_regions.setChecked(False)
        self._update_stats()
        self.layer_panel.refresh()
        self.status_info.setText(tr("status.generated"))
        if self._pending_export_path:
            path = self._pending_export_path
            self._pending_export_path = None
            self._write_export_pattern(path)

    def _on_stitch_worker_finished(self):
        """Handle results only after QThread has completely stopped."""
        worker = self._worker
        if worker is None:
            return
        failure_message = worker.failure_message
        self._worker = None
        if failure_message:
            self._on_stitch_error(failure_message)
        else:
            self._on_stitch_done()

    def _on_stitch_error(self, msg):
        QMessageBox.critical(
            self, tr("dialog.error"),
            tr("dialog.stitch_failed").format(error=msg)
        )
        self._pending_export_path = None

    def _export_pattern(self):
        """Export to embroidery file format."""
        if not self.project.layers:
            QMessageBox.warning(
                self, tr("dialog.no_pattern"), tr("dialog.no_pattern_body")
            )
            return

        # Build filter string
        filters = ";;".join(
            f"{desc} (*.{ext})" for ext, desc in SUPPORTED_FORMATS.items()
        )

        path, sel_filter = QFileDialog.getSaveFileName(
            self, tr("dialog.export_pattern"),
            self.project.name, filters
        )
        if not path:
            return

        if not self.export_engine.has_stitches(self.project):
            self._pending_export_path = path
            self._generate_stitches()
            self.status_info.setText(tr("status.generating_for_export"))
            return

        self._write_export_pattern(path)

    def _write_export_pattern(self, path: str):
        """Write a prepared pattern after explicit or automatic generation."""
        try:
            written_files = self.export_engine.export(self.project, path)
            self.status_info.setText(tr("status.exported").format(path=path))
            file_list = "\n".join(written_files)
            QMessageBox.information(
                self, tr("dialog.export_complete"),
                tr("dialog.export_complete_body").format(files=file_list)
            )
        except Exception as e:
            QMessageBox.critical(
                self, tr("dialog.error"),
                tr("dialog.export_failed").format(error=e)
            )

    def _export_selected_layer(self):
        """Export only the selected layer."""
        item = self.layer_panel.layer_tree.currentItem()
        if not item:
            QMessageBox.warning(
                self, tr("dialog.no_selection"), tr("dialog.no_selection_body")
            )
            return

        uid = item.data(0, Qt.UserRole)
        layer = self.project.get_layer(uid)
        if not layer:
            return

        filters = ";;".join(
            f"{desc} (*.{ext})" for ext, desc in SUPPORTED_FORMATS.items()
        )
        path, _ = QFileDialog.getSaveFileName(
            self, tr("dialog.export_layer").format(name=layer.name),
            f"{self.project.name}_{layer.name}", filters
        )
        if path:
            try:
                self.export_engine.export_layer(layer, path)
                self.status_info.setText(tr("status.exported_layer").format(path=path))
            except Exception as e:
                QMessageBox.critical(
                    self, tr("dialog.error"),
                    tr("dialog.export_failed").format(error=e)
                )

    # ========== SIGNAL HANDLERS ==========

    def _on_layer_selected(self, uid):
        """When user selects a layer or region, show its properties."""
        self.canvas.select_object(uid)

        # Check if it's a layer
        layer = self.project.get_layer(uid)
        if layer:
            self.props_panel.set_settings(uid, layer.default_stitch_settings)
            return

        # Check if it's a region
        for l in self.project.layers:
            region = l.get_region(uid)
            if region:
                self.props_panel.set_settings(uid, region.stitch_settings)
                return

    def _on_canvas_object_selected(self, uid):
        self.layer_panel.select_uid(uid)
        self._on_layer_selected(uid)

    def _scale_stitch_object(self, uid: str, factor: float):
        """Scale editable source geometry so regeneration and saving retain it."""
        layer = self.project.get_layer(uid)
        if layer is not None:
            entries = [(layer, region) for region in layer.regions if region.visible]
        else:
            found = self._find_region_with_layer(uid)
            entries = [found] if found else []
        if not entries:
            return

        polygon_entries = [
            (candidate_layer, region)
            for candidate_layer, region in entries
            if region.polygon is not None and not region.polygon.is_empty
        ]
        if not polygon_entries:
            for _, region in entries:
                region.scale_stitches(factor)
            affected_layers = {
                id(candidate_layer): candidate_layer
                for candidate_layer, _ in entries
            }
        else:
            bounds = [
                region.polygon.bounds for _, region in polygon_entries
            ]
            min_x = min(item[0] for item in bounds)
            min_y = min(item[1] for item in bounds)
            max_x = max(item[2] for item in bounds)
            max_y = max(item[3] for item in bounds)
            source_shape = (
                self.project.processed_image.shape[:2]
                if self.project.processed_image is not None
                else next(
                    (
                        region.mask.shape
                        for _, region in polygon_entries
                        if region.mask is not None
                    ),
                    None,
                )
            )
            effective_factor = factor
            if source_shape is not None and factor > 1.0:
                source_h, source_w = source_shape
                geometry_w = max_x - min_x
                geometry_h = max_y - min_y
                if geometry_w > 0.0:
                    effective_factor = min(
                        effective_factor,
                        source_w / geometry_w,
                    )
                if geometry_h > 0.0:
                    effective_factor = min(
                        effective_factor,
                        source_h / geometry_h,
                    )
            origin = ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0)
            for _, region in polygon_entries:
                region.polygon = shapely_scale(
                    region.polygon,
                    xfact=effective_factor,
                    yfact=effective_factor,
                    origin=origin,
                )
            if source_shape is not None:
                scaled_bounds = [
                    region.polygon.bounds for _, region in polygon_entries
                ]
                scaled_min_x = min(item[0] for item in scaled_bounds)
                scaled_min_y = min(item[1] for item in scaled_bounds)
                scaled_max_x = max(item[2] for item in scaled_bounds)
                scaled_max_y = max(item[3] for item in scaled_bounds)
                source_h, source_w = source_shape
                shift_x = (
                    -scaled_min_x
                    if scaled_min_x < 0.0
                    else source_w - scaled_max_x
                    if scaled_max_x > source_w
                    else 0.0
                )
                shift_y = (
                    -scaled_min_y
                    if scaled_min_y < 0.0
                    else source_h - scaled_max_y
                    if scaled_max_y > source_h
                    else 0.0
                )
                if shift_x or shift_y:
                    for _, region in polygon_entries:
                        region.polygon = shapely_translate(
                            region.polygon,
                            xoff=shift_x,
                            yoff=shift_y,
                        )
            for _, region in polygon_entries:
                self._sync_region_mask_to_polygon(region)
            regenerated = self._regenerate_changed_regions(
                [region for _, region in polygon_entries]
            )
            affected_layers = {
                id(candidate_layer): candidate_layer
                for candidate_layer, _ in entries + regenerated
            }
            for _, region in entries:
                if region.polygon is None or region.polygon.is_empty:
                    region.scale_stitches(factor)

        self.project.modified = True
        for candidate_layer, region in polygon_entries:
            self._refresh_region_mask(candidate_layer, region)
        for affected_layer in affected_layers.values():
            self._refresh_layer_stitches(affected_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(tr("status.scaled").format(factor=factor))

    def _move_stitch_object(self, uid: str, dx: float, dy: float):
        """Move editable source geometry so regeneration and saving retain it."""
        layer = self.project.get_layer(uid)
        if layer is not None:
            entries = [(layer, region) for region in layer.regions if region.visible]
        else:
            found = self._find_region_with_layer(uid)
            entries = [found] if found else []
        if not entries:
            return

        mask_scale = self._current_mask_scale()
        source_shape = (
            self.project.processed_image.shape[:2]
            if self.project.processed_image is not None
            else next(
                (
                    region.mask.shape
                    for _, region in entries
                    if region.mask is not None
                ),
                None,
            )
        )
        polygon_bounds = [
            region.polygon.bounds
            for _, region in entries
            if region.polygon is not None and not region.polygon.is_empty
        ]
        source_dx = dx / mask_scale
        source_dy = dy / mask_scale
        if source_shape is not None and polygon_bounds:
            source_h, source_w = source_shape
            source_dx = min(
                max(source_dx, -min(bounds[0] for bounds in polygon_bounds)),
                source_w - max(bounds[2] for bounds in polygon_bounds),
            )
            source_dy = min(
                max(source_dy, -min(bounds[1] for bounds in polygon_bounds)),
                source_h - max(bounds[3] for bounds in polygon_bounds),
            )
        scene_dx = source_dx * mask_scale
        scene_dy = source_dy * mask_scale
        polygon_entries = []
        for candidate_layer, region in entries:
            if region.polygon is not None and not region.polygon.is_empty:
                region.polygon = shapely_translate(
                    region.polygon,
                    xoff=source_dx,
                    yoff=source_dy,
                )
                self._sync_region_mask_to_polygon(region)
                polygon_entries.append((candidate_layer, region))
            else:
                region.translate_stitches(scene_dx, scene_dy)

        if not polygon_entries:
            self.project.modified = True
            self.canvas.select_object(uid)
            self.layer_panel.select_uid(uid)
            self.status_info.setText(
                tr("status.moved").format(dx=scene_dx, dy=scene_dy)
            )
            return

        regenerated = self._regenerate_changed_regions(
            [region for _, region in polygon_entries]
        )
        affected_layers = {
            id(candidate_layer): candidate_layer
            for candidate_layer, _ in entries + regenerated
        }
        self.project.modified = True
        for candidate_layer, region in polygon_entries:
            self._refresh_region_mask(candidate_layer, region)
        for affected_layer in affected_layers.values():
            self._refresh_layer_stitches(affected_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(
            tr("status.moved").format(dx=scene_dx, dy=scene_dy)
        )

    def _resize_stitch_object(self, uid: str, scene_bounds):
        """Resize a region/layer to the mouse-provided scene bounds and regenerate."""
        regenerated = []
        layer = self.project.get_layer(uid)
        if layer:
            regenerated = self._resize_layer_regions(layer, scene_bounds)
            affected_layer = layer
            affected_region = None
        else:
            found = self._find_region_with_layer(uid)
            if not found:
                return
            layer, region = found
            geometry_changed = self._resize_region_polygon(region, scene_bounds)
            if geometry_changed:
                regenerated = self._regenerate_region(layer, region)
            affected_layer = layer
            affected_region = region

        self.project.modified = True
        if affected_region is None:
            self._refresh_layer_region_masks(affected_layer)
        else:
            self._refresh_region_mask(affected_layer, affected_region)
        self._refresh_layer_stitches(affected_layer)
        for regenerated_layer, _ in regenerated:
            if regenerated_layer is not affected_layer:
                self._refresh_layer_stitches(regenerated_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(tr("status.resized"))

    def _resize_layer_regions(self, layer: Layer, scene_bounds):
        """Atomically update a layer before regenerating its stitch paths."""
        old_bounds = layer.stitch_bounds()
        if old_bounds is None:
            return []
        sx, sy, dx, dy = self._scene_bounds_transform(old_bounds, scene_bounds)

        # Phase one: every editable region must expose its final source mask
        # before shared cell ownership is computed for any of them.
        mask_scale = self._current_mask_scale()
        origin = (old_bounds[0] / mask_scale, old_bounds[1] / mask_scale)
        polygon_regions = []
        fallback_regions = []
        for region in layer.regions:
            if (
                getattr(region, "polygon", None) is not None
                and not region.polygon.is_empty
            ):
                region.polygon = shapely_scale(
                    region.polygon,
                    xfact=sx,
                    yfact=sy,
                    origin=origin,
                )
                region.polygon = shapely_translate(
                    region.polygon,
                    xoff=dx / mask_scale,
                    yoff=dy / mask_scale,
                )
                self._sync_region_mask_to_polygon(region)
                polygon_regions.append(region)
            else:
                fallback_regions.append(region)

        # Phase two: derive contexts from the completed project state once,
        # including compatible regions in other layers that share its grid.
        regenerated = self._regenerate_changed_regions(polygon_regions)
        for region in fallback_regions:
            region.scale_stitches(sx, origin=(old_bounds[0], old_bounds[1]))
        return regenerated

    def _resize_region_polygon(self, region: Region, scene_bounds):
        polygon = getattr(region, "polygon", None)
        if polygon is None or polygon.is_empty:
            region_bounds = region.stitch_bounds()
            if region_bounds is None:
                return
            sx, sy, dx, dy = self._scene_bounds_transform(region_bounds, scene_bounds)
            region.scale_stitches(sx, origin=(region_bounds[0], region_bounds[1]))
            region.translate_stitches(dx, dy)
            return False

        mask_scale = self._current_mask_scale()
        old_minx, old_miny, old_maxx, old_maxy = polygon.bounds
        new_left, new_top, new_right, new_bottom = scene_bounds
        new_bounds = (
            new_left / mask_scale,
            new_top / mask_scale,
            new_right / mask_scale,
            new_bottom / mask_scale,
        )
        old_w = max(old_maxx - old_minx, 1e-6)
        old_h = max(old_maxy - old_miny, 1e-6)
        new_w = max(new_bounds[2] - new_bounds[0], 1e-6)
        new_h = max(new_bounds[3] - new_bounds[1], 1e-6)
        resized = shapely_scale(
            polygon,
            xfact=new_w / old_w,
            yfact=new_h / old_h,
            origin=(old_minx, old_miny),
        )
        resized = shapely_translate(
            resized,
            xoff=new_bounds[0] - old_minx,
            yoff=new_bounds[1] - old_miny,
        )
        if not resized.is_valid:
            resized = resized.buffer(0)
        if not resized.is_empty:
            region.polygon = resized
            self._sync_region_mask_to_polygon(region)
            return True
        return False

    @staticmethod
    def _scene_bounds_transform(old_bounds, new_bounds):
        old_left, old_top, old_right, old_bottom = old_bounds
        new_left, new_top, new_right, new_bottom = new_bounds
        old_w = max(old_right - old_left, 1e-6)
        old_h = max(old_bottom - old_top, 1e-6)
        sx = max(new_right - new_left, 1e-6) / old_w
        sy = max(new_bottom - new_top, 1e-6) / old_h
        return sx, sy, new_left - old_left, new_top - old_top

    def _cross_stitch_ownership_contexts(self):
        """Rebuild shared ownership after local geometry or mask changes."""
        region_jobs = [
            (layer, region)
            for layer in self.project.layers
            for region in layer.regions
        ]
        return StitchWorker._build_cross_stitch_ownership_contexts(
            self.stitch_engine,
            region_jobs,
        )

    def _regenerate_region(self, layer: Layer, region: Region):
        return self._regenerate_changed_regions([region])

    def _regenerate_changed_regions(self, changed_regions):
        """Regenerate changed regions and every fill sharing their ownership grid."""
        if not changed_regions:
            return []
        ownership_contexts = self._cross_stitch_ownership_contexts()
        changed_uids = {region.uid for region in changed_regions}
        changed_context_ids = {
            id(ownership_contexts[uid])
            for uid in changed_uids
            if uid in ownership_contexts
        }
        regenerated = []
        for candidate_layer in self.project.layers:
            for candidate in candidate_layer.regions:
                context = ownership_contexts.get(candidate.uid)
                if candidate.uid in changed_uids or (
                    context is not None
                    and id(context) in changed_context_ids
                ):
                    self._regenerate_region_with_context(
                        candidate,
                        context,
                    )
                    regenerated.append((candidate_layer, candidate))
        return regenerated

    def _regenerate_region_with_context(self, region: Region, ownership_context):
        """Generate one region with a context already built for this project state."""
        paths = self.stitch_engine.generate_region_paths(
            region,
            self.project.processed_image,
            self._flow_field,
            ownership_context=ownership_context,
        )
        region.stitch_paths = paths
        region.stitch_points = [pt for path in paths for pt in path]

    def _refresh_region_masks(self):
        for layer in self.project.layers:
            for region in layer.regions:
                self._refresh_region_mask(layer, region)

    def _refresh_layer_region_masks(self, layer: Layer):
        for region in layer.regions:
            self._refresh_region_mask(layer, region)

    def _refresh_region_mask(self, layer: Layer, region: Region):
        if region.mask is not None:
            self.canvas.set_region_mask(
                region.uid,
                region.mask,
                layer.thread_color_rgb,
                self._current_mask_scale(),
                getattr(region, "polygon", None),
            )

    @staticmethod
    def _rasterize_polygon_mask(polygon, shape):
        """Rasterize polygon coverage at pixel centers into an existing mask shape."""
        raster = np.zeros(shape, dtype=np.uint8)
        geometries = getattr(polygon, "geoms", [polygon])
        for geometry in geometries:
            if geometry.is_empty or not hasattr(geometry, "exterior"):
                continue
            exterior = np.rint(
                np.asarray(geometry.exterior.coords, dtype=np.float64)
            ).astype(np.int32)
            cv2.fillPoly(raster, [exterior], 255)
            for interior in geometry.interiors:
                hole = np.rint(
                    np.asarray(interior.coords, dtype=np.float64)
                ).astype(np.int32)
                cv2.fillPoly(raster, [hole], 0)
        rows, columns = np.where(raster > 0)
        if len(columns):
            inside = intersects_xy(polygon, columns + 0.5, rows + 0.5)
            raster[rows[~inside], columns[~inside]] = 0
        return raster

    def _sync_region_mask_to_polygon(self, region: Region):
        """Keep editable geometry and source occupancy synchronized."""
        polygon = getattr(region, "polygon", None)
        if region.mask is None or polygon is None or polygon.is_empty:
            return
        region.mask = self._rasterize_polygon_mask(polygon, region.mask.shape)

    def _start_boundary_edit(self, uid: str):
        """Start interactive Bezier boundary editing for a single region."""
        found = self._find_region_with_layer(uid)
        if not found:
            self.status_info.setText(tr("status.boundary_single"))
            return
        layer, region = found
        polygon = getattr(region, "polygon", None)
        if polygon is None or polygon.is_empty:
            self.status_info.setText(tr("status.boundary_missing"))
            return

        self.canvas.start_boundary_edit(uid, polygon, self._current_mask_scale())
        self.canvas.select_object(uid)
        self.status_info.setText(tr("status.boundary_editing"))

    def _apply_boundary_edit(self, uid: str, source_points):
        """Store an edited polygon and regenerate only the affected region."""
        found = self._find_region_with_layer(uid)
        if not found or len(source_points) < 3:
            return
        layer, region = found

        polygon = Polygon(source_points)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.is_empty:
            self.status_info.setText(tr("status.boundary_empty"))
            return

        region.polygon = polygon
        self._sync_region_mask_to_polygon(region)
        regenerated = self._regenerate_region(layer, region)

        self._refresh_region_mask(layer, region)

        self.project.modified = True
        self._refresh_layer_stitches(layer)
        for regenerated_layer, _ in regenerated:
            if regenerated_layer is not layer:
                self._refresh_layer_stitches(regenerated_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(tr("status.boundary_updated"))

    def _find_region_with_layer(self, uid: str):
        for layer in self.project.layers:
            region = layer.get_region(uid)
            if region:
                return layer, region
        return None

    def _current_mask_scale(self) -> float:
        if self.project.processed_image is None:
            return 1.0
        img_settings = self.image_panel.get_image_settings()
        img_h, img_w = self.project.processed_image.shape[:2]
        out_w = img_settings.output_width_mm * 10
        return out_w / img_w

    def _on_visibility_changed(self, uid, visible):
        if uid in self.canvas._layer_groups:
            self.canvas._layer_groups[uid].setVisible(visible)
        layer = self.project.get_layer(uid)
        if layer is not None and visible:
            self._refresh_layer_stitches(layer)

    def _on_settings_changed(self, uid, settings):
        """When stitch settings change, mark project modified."""
        self.project.modified = True

    def _on_image_settings_changed(self):
        """Re-apply image adjustments when sliders change."""
        self._apply_image_and_show()

    def _on_threads_changed(self):
        """Thread database was modified."""
        pass  # Could re-quantize if desired

    def _refresh_canvas(self):
        """Redraw all stitch paths on the canvas."""
        for layer in self.project.layers:
            self._refresh_layer_stitches(layer)

    def _refresh_layer_stitches(self, layer: Layer):
        """Redraw one layer's stitch graphics from project data."""
        if not layer.visible:
            if hasattr(self.canvas, "clear_layer_stitches"):
                self.canvas.clear_layer_stitches(layer.uid)
            return

        regions_data = self._layer_regions_data(layer)
        if regions_data:
            self.canvas.set_layer_stitches(
                layer.uid,
                regions_data,
                z_value=100.0 - float(layer.order),
            )
        elif hasattr(self.canvas, "clear_layer_stitches"):
            self.canvas.clear_layer_stitches(layer.uid)

    @staticmethod
    def _layer_regions_data(layer: Layer):
        regions_data = []
        for region in layer.regions:
            if region.stitch_points and region.visible:
                regions_data.append({
                    'uid': region.uid,
                    'points': region.stitch_points,
                    'paths': getattr(region, 'stitch_paths', None),
                    'color': layer.effective_color_rgb(),
                })
        return regions_data

    def _update_stats(self):
        """Update pattern statistics display."""
        try:
            stats = self.export_engine.get_stats(self.project)
            self.stats_panel.update_stats(stats)
        except Exception:
            pass

    # ========== HELP ==========

    def _show_about(self):
        QMessageBox.about(
            self, tr("dialog.about_title"),
            tr("dialog.about_body")
        )

    def _show_shortcuts(self):
        QMessageBox.information(
            self, tr("dialog.shortcuts_title"),
            tr("dialog.shortcuts_body")
        )

    def closeEvent(self, event):
        if self.project.modified:
            reply = QMessageBox.question(
                self, tr("dialog.quit"),
                tr("dialog.save_before_quit"),
                QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel
            )
            if reply == QMessageBox.Save:
                self._save_project()
            elif reply == QMessageBox.Cancel:
                event.ignore()
                return

        self.thread_db.save()
        event.accept()
