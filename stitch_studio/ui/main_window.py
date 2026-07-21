"""
Main Window
Central application window with dock panels, toolbar, menu bar,
and the embroidery canvas.
"""

import os
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partial

from PySide6.QtWidgets import (
    QMainWindow, QDockWidget, QToolBar, QStatusBar,
    QFileDialog, QMessageBox, QProgressDialog, QApplication,
    QLabel, QSizePolicy, QWidget, QVBoxLayout
)
from PySide6.QtCore import Qt, QThread, Signal, QTimer
from PySide6.QtGui import QAction, QActionGroup, QKeySequence, QIcon
from shapely.geometry import Polygon
from shapely.affinity import scale as shapely_scale, translate as shapely_translate

from ..core.thread_db import ThreadDatabase
from ..core.project import Project, Layer, Region, StitchSettings
from ..core.image_engine import ImageEngine, FlowFieldEngine
from ..core.stitch_engine import StitchEngine
from ..core.export_engine import ExportEngine, SUPPORTED_FORMATS

from .canvas import EmbroideryCanvas
from .panels import ThreadPanel, LayerPanel, PropertiesPanel, ImagePanel, StatsPanel


class StitchWorker(QThread):
    """Background thread for stitch generation."""
    progress = Signal(int, int)  # current, total
    finished = Signal()
    error = Signal(str)

    def __init__(self, project, stitch_engine, image=None, flow_field=None):
        super().__init__()
        self.project = project
        self.engine = stitch_engine
        self.image = image
        self.flow_field = flow_field

    def run(self):
        try:
            total_regions = sum(len(l.regions) for l in self.project.layers)
            jobs = [
                region
                for layer in self.project.layers
                if layer.visible
                for region in layer.regions
                if region.visible
            ]
            done = total_regions - len(jobs)

            worker_count = self._generation_worker_count(len(jobs))
            if worker_count <= 1:
                for region in jobs:
                    self._generate_region(region)
                    done += 1
                    self.progress.emit(done, total_regions)
            else:
                with ThreadPoolExecutor(max_workers=worker_count) as executor:
                    future_to_region = {
                        executor.submit(
                            self.engine.generate_region_paths,
                            region,
                            self.image,
                            self.flow_field,
                        ): region
                        for region in jobs
                    }
                    for future in as_completed(future_to_region):
                        region = future_to_region[future]
                        paths = future.result()
                        self._store_region_paths(region, paths)
                        done += 1
                        self.progress.emit(done, total_regions)
            self.finished.emit()
        except Exception as e:
            self.error.emit(f"{e}\n{traceback.format_exc()}")

    @staticmethod
    def _generation_worker_count(job_count: int) -> int:
        if job_count <= 1:
            return 1
        cpu_count = os.cpu_count() or 1
        return max(1, min(job_count, cpu_count))

    def _generate_region(self, region):
        paths = self.engine.generate_region_paths(
            region, self.image, self.flow_field
        )
        self._store_region_paths(region, paths)

    @staticmethod
    def _store_region_paths(region, paths):
        region.stitch_paths = paths
        region.stitch_points = [pt for path in paths for pt in path]


class MainWindow(QMainWindow):
    """Main application window for Stitch Studio."""

    def __init__(self):
        super().__init__()
        self.setWindowTitle("Stitch Studio — Embroidery Pattern Designer")
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
        self.act_new = QAction("&New Project", self)
        self.act_new.setShortcut(QKeySequence.New)
        self.act_new.triggered.connect(self._new_project)

        self.act_open = QAction("&Open Project...", self)
        self.act_open.setShortcut(QKeySequence.Open)
        self.act_open.triggered.connect(self._open_project)

        self.act_save = QAction("&Save Project", self)
        self.act_save.setShortcut(QKeySequence.Save)
        self.act_save.triggered.connect(self._save_project)

        self.act_save_as = QAction("Save &As...", self)
        self.act_save_as.setShortcut(QKeySequence("Ctrl+Shift+S"))
        self.act_save_as.triggered.connect(self._save_project_as)

        self.act_load_image = QAction("&Load Image...", self)
        self.act_load_image.setShortcut(QKeySequence("Ctrl+I"))
        self.act_load_image.triggered.connect(self._load_image)

        self.act_export = QAction("&Export Embroidery...", self)
        self.act_export.setShortcut(QKeySequence("Ctrl+E"))
        self.act_export.triggered.connect(self._export_pattern)

        self.act_export_layer = QAction("Export Selected &Layer...", self)
        self.act_export_layer.triggered.connect(self._export_selected_layer)

        self.act_quantize = QAction("&Quantize && Segment", self)
        self.act_quantize.setShortcut(QKeySequence("Ctrl+Q"))
        self.act_quantize.triggered.connect(self._quantize_and_segment)

        self.generation_mode_actions = QActionGroup(self)
        self.generation_mode_actions.setExclusive(True)

        self.act_photo_stitch_mode = QAction("Photo Stitch", self, checkable=True)
        self.act_photo_stitch_mode.setToolTip(
            "Continuous fills for smoother photo-like embroidery"
        )
        self.act_photo_stitch_mode.triggered.connect(
            lambda checked: self._set_generation_mode("photo_stitch") if checked else None
        )

        self.act_cross_stitch_mode = QAction("Cross Stitch", self, checkable=True)
        self.act_cross_stitch_mode.setToolTip("Grid-based cross stitch generation")
        self.act_cross_stitch_mode.triggered.connect(
            lambda checked: self._set_generation_mode("cross_stitch") if checked else None
        )

        self.generation_mode_actions.addAction(self.act_photo_stitch_mode)
        self.generation_mode_actions.addAction(self.act_cross_stitch_mode)

        self.act_gen_stitches = QAction("&Generate Stitches", self)
        self.act_gen_stitches.setShortcut(QKeySequence("Ctrl+G"))
        self.act_gen_stitches.triggered.connect(self._generate_stitches)

        self.act_fit_view = QAction("&Fit to Content", self)
        self.act_fit_view.setShortcut(QKeySequence("F"))
        self.act_fit_view.triggered.connect(lambda: self.canvas.fit_to_content())

    def _create_menus(self):
        menu_bar = self.menuBar()

        # File menu
        file_menu = menu_bar.addMenu("&File")
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
        file_menu.addAction("E&xit", self.close, QKeySequence("Ctrl+W"))

        # Process menu
        proc_menu = menu_bar.addMenu("&Process")
        proc_menu.addAction(self.act_quantize)
        proc_menu.addAction(self.act_gen_stitches)
        proc_menu.addSeparator()
        proc_menu.addAction("Compute &Flow Field", self._compute_flow_field)

        # View menu
        self.view_menu = menu_bar.addMenu("&View")
        self.view_menu.addAction(self.act_fit_view)
        self.view_menu.addSeparator()

        self.act_show_image = QAction("Show &Image", self, checkable=True, checked=True)
        self.act_show_image.toggled.connect(self.canvas.set_show_image)
        self.view_menu.addAction(self.act_show_image)

        self.act_show_stitches = QAction("Show &Stitches", self, checkable=True, checked=True)
        self.act_show_stitches.toggled.connect(self.canvas.set_show_stitches)
        self.view_menu.addAction(self.act_show_stitches)

        self.act_show_points = QAction("Show Stitch &Points", self, checkable=True, checked=False)
        self.act_show_points.toggled.connect(self.canvas.set_show_stitch_points)
        self.view_menu.addAction(self.act_show_points)

        self.act_show_regions = QAction("Show &Regions", self, checkable=True, checked=True)
        self.act_show_regions.toggled.connect(self.canvas.set_show_regions)
        self.view_menu.addAction(self.act_show_regions)

        self.view_menu.addSeparator()
        # Panel visibility
        self._dock_actions = []  # populated after docks are created

        # Help menu
        help_menu = menu_bar.addMenu("&Help")
        help_menu.addAction("&About", self._show_about)
        help_menu.addAction("&Keyboard Shortcuts", self._show_shortcuts)

    def _create_toolbar(self):
        toolbar = QToolBar("Main Toolbar")
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
        toolbar.addWidget(QLabel(" Image: "))
        from PySide6.QtWidgets import QSlider
        self.toolbar_opacity = QSlider(Qt.Horizontal)
        self.toolbar_opacity.setRange(0, 100)
        self.toolbar_opacity.setValue(50)
        self.toolbar_opacity.setMaximumWidth(120)
        self.toolbar_opacity.setToolTip("Image opacity")
        self.toolbar_opacity.valueChanged.connect(
            lambda v: self.canvas.set_image_opacity(v / 100.0)
        )
        toolbar.addWidget(self.toolbar_opacity)

    def _create_canvas(self):
        self.canvas = EmbroideryCanvas(self)
        self.setCentralWidget(self.canvas)

    def _create_panels(self):
        # Thread Panel
        self.dock_threads = QDockWidget("Thread Library", self)
        self.thread_panel = ThreadPanel(self.thread_db)
        self.dock_threads.setWidget(self.thread_panel)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.dock_threads)

        # Layer Panel
        self.dock_layers = QDockWidget("Layers", self)
        self.layer_panel = LayerPanel()
        self.dock_layers.setWidget(self.layer_panel)
        self.addDockWidget(Qt.RightDockWidgetArea, self.dock_layers)

        # Properties Panel
        self.dock_props = QDockWidget("Stitch Properties", self)
        self.props_panel = PropertiesPanel()
        self.dock_props.setWidget(self.props_panel)
        self.addDockWidget(Qt.RightDockWidgetArea, self.dock_props)

        # Image Panel
        self.dock_image = QDockWidget("Image & Quantization", self)
        self.image_panel = ImagePanel()
        self.dock_image.setWidget(self.image_panel)
        self.addDockWidget(Qt.LeftDockWidgetArea, self.dock_image)

        # Stats Panel
        self.dock_stats = QDockWidget("Pattern Stats", self)
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

        self.status_pos = QLabel("Position: 0.0, 0.0 mm")
        self.status_zoom = QLabel("Zoom: 100%")
        self.status_info = QLabel("Ready")

        self.statusbar.addWidget(self.status_info, 1)
        self.statusbar.addPermanentWidget(self.status_pos)
        self.statusbar.addPermanentWidget(self.status_zoom)

    def _connect_signals(self):
        # Canvas signals
        self.canvas.position_changed.connect(
            lambda x, y: self.status_pos.setText(f"Position: {x:.1f}, {y:.1f} mm")
        )
        self.canvas.zoom_changed.connect(
            lambda z: self.status_zoom.setText(f"Zoom: {z * 100:.0f}%")
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
            self.act_quantize.setText("Quantize for Cross Stitch")
            self.status_info.setText("Generation mode: Cross Stitch")
        else:
            self.act_quantize.setText("Quantize for Photo Stitch")
            self.status_info.setText("Generation mode: Photo Stitch")

    # ========== ACTIONS ==========

    def _new_project(self):
        if self.project.modified:
            reply = QMessageBox.question(
                self, "New Project",
                "Current project has unsaved changes. Continue?",
                QMessageBox.Yes | QMessageBox.No
            )
            if reply == QMessageBox.No:
                return

        self.project = Project()
        self.canvas.clear_all()
        self.layer_panel.set_project(self.project)
        self._flow_field = None
        self.status_info.setText("New project created")

    def _open_project(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open Project", "",
            "Stitch Studio Project (*.ssp);;All Files (*)"
        )
        if not path:
            return

        try:
            self.project = Project()
            self.project.load(path)
            self.layer_panel.set_project(self.project)

            if self.project.source_image is not None:
                size = (self.project.image_settings.output_width_mm,
                        self.project.image_settings.output_height_mm)
                self.canvas.set_background_image(self.project.source_image, size)
                self.image_panel.set_image_settings(self.project.image_settings)
                self.image_panel.set_quant_settings(self.project.quant_settings)
                self._set_generation_mode(self.project.generation_mode)
                self.dock_image.raise_()

            self._refresh_canvas()
            self.status_info.setText(f"Opened: {path}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to load project:\n{e}")

    def _save_project(self):
        if not self.project.filepath:
            self._save_project_as()
            return
        try:
            self.project.image_settings = self.image_panel.get_image_settings()
            self.project.quant_settings = self.image_panel.get_quant_settings()
            self.project.generation_mode = self.image_panel.get_generation_mode()
            self.project.save()
            self.status_info.setText(f"Saved: {self.project.filepath}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to save:\n{e}")

    def _save_project_as(self):
        path, _ = QFileDialog.getSaveFileName(
            self, "Save Project As", self.project.name + ".ssp",
            "Stitch Studio Project (*.ssp)"
        )
        if path:
            self.project.image_settings = self.image_panel.get_image_settings()
            self.project.quant_settings = self.image_panel.get_quant_settings()
            self.project.generation_mode = self.image_panel.get_generation_mode()
            self.project.save(path)
            self.status_info.setText(f"Saved: {path}")

    def _load_image(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Load Image", "",
            "Images (*.png *.jpg *.jpeg *.bmp *.tiff *.webp);;All Files (*)"
        )
        if not path:
            return

        try:
            image = self.image_engine.load_image(path)
            self.project.source_image = image
            self.project.source_image_path = path
            self.project.name = os.path.splitext(os.path.basename(path))[0]

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
            self.status_info.setText(f"Loaded image: {path} ({w}×{h})")

        except Exception as e:
            QMessageBox.critical(self, "Error", f"Failed to load image:\n{e}")

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
            QMessageBox.warning(self, "No Image", "Please load an image first.")
            return

        self.status_info.setText("Quantizing colors...")
        QApplication.processEvents()

        try:
            # Get settings
            img_settings = self.image_panel.get_image_settings()
            quant_settings = self.image_panel.get_quant_settings()
            self._set_generation_mode(self.image_panel.get_generation_mode())

            # Process image
            processed = self.image_engine.apply_adjustments(
                self.project.source_image, img_settings
            )
            self.project.processed_image = processed

            # Get palette from thread DB
            all_threads = self.thread_db.get_all_threads()
            if not all_threads:
                QMessageBox.warning(self, "No Threads",
                                    "No threads in database. Please add thread packs.")
                return

            # Quantize
            thread_map, used_indices = self.image_engine.quantize_to_palette(
                processed, all_threads, quant_settings
            )
            self.project.quantized_map = thread_map

            # Segment
            regions = self.image_engine.segment_regions(
                thread_map, quant_settings, processed
            )

            # Build layers
            layers = self.image_engine.build_layers_from_regions(
                regions,
                all_threads,
                processed,
                self.project.generation_mode,
            )
            self.project.layers = layers
            self.project.modified = True

            # Update UI
            self.layer_panel.set_project(self.project)

            # Show region masks on canvas
            img_h, img_w = processed.shape[:2]
            out_w = img_settings.output_width_mm * 10  # to scene units
            out_h = img_settings.output_height_mm * 10
            mask_scale = min(out_w / img_w, out_h / img_h)

            self.canvas.clear_all()
            self.canvas.set_background_image(
                processed,
                (img_settings.output_width_mm, img_settings.output_height_mm)
            )

            for layer in layers:
                for region in layer.regions:
                    if region.mask is not None:
                        self.canvas.set_region_mask(
                            region.uid, region.mask,
                            layer.thread_color_rgb, mask_scale,
                            getattr(region, "polygon", None)
                        )

            self.canvas.fit_to_content()

            self.status_info.setText(
                f"Quantized to {len(used_indices)} colors, "
                f"{len(regions)} regions, {len(layers)} layers"
            )

        except Exception as e:
            QMessageBox.critical(self, "Error", f"Quantization failed:\n{e}\n{traceback.format_exc()}")

    def _compute_flow_field(self):
        """Compute orientation/flow field from the image."""
        if self.project.processed_image is None:
            QMessageBox.warning(self, "No Image", "Please load and process an image first.")
            return

        self.status_info.setText("Computing flow field...")
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

            self.status_info.setText("Flow field computed successfully")

        except Exception as e:
            QMessageBox.critical(self, "Error", f"Flow field computation failed:\n{e}")

    def _generate_stitches(self):
        """Generate stitches for all layers (background thread)."""
        if not self.project.layers:
            QMessageBox.warning(self, "No Layers", "Please quantize the image first.")
            return

        self.status_info.setText("Generating stitches...")

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
        self._worker.finished.connect(self._on_stitch_done)
        self._worker.error.connect(self._on_stitch_error)
        self._worker.start()

    def _on_stitch_progress(self, current, total):
        self.status_info.setText(f"Generating stitches... {current}/{total} regions")
        QApplication.processEvents()

    def _on_stitch_done(self):
        self._refresh_canvas()
        self._update_stats()
        self.layer_panel.refresh()
        self.status_info.setText("Stitch generation complete")
        self._worker = None

    def _on_stitch_error(self, msg):
        QMessageBox.critical(self, "Error", f"Stitch generation failed:\n{msg}")
        self._worker = None

    def _export_pattern(self):
        """Export to embroidery file format."""
        if not self.project.layers:
            QMessageBox.warning(self, "No Pattern", "No layers to export.")
            return

        # Build filter string
        filters = ";;".join(
            f"{desc} (*.{ext})" for ext, desc in SUPPORTED_FORMATS.items()
        )

        path, sel_filter = QFileDialog.getSaveFileName(
            self, "Export Embroidery Pattern",
            self.project.name, filters
        )
        if not path:
            return

        try:
            written_files = self.export_engine.export(self.project, path)
            self.status_info.setText(f"Exported: {path}")
            file_list = "\n".join(written_files)
            QMessageBox.information(self, "Export Complete",
                                    f"Pattern exported to:\n{file_list}")
        except Exception as e:
            QMessageBox.critical(self, "Error", f"Export failed:\n{e}")

    def _export_selected_layer(self):
        """Export only the selected layer."""
        item = self.layer_panel.layer_tree.currentItem()
        if not item:
            QMessageBox.warning(self, "No Selection", "Select a layer first.")
            return

        uid = item.data(0, Qt.UserRole)
        layer = self.project.get_layer(uid)
        if not layer:
            return

        filters = ";;".join(
            f"{desc} (*.{ext})" for ext, desc in SUPPORTED_FORMATS.items()
        )
        path, _ = QFileDialog.getSaveFileName(
            self, f"Export Layer: {layer.name}",
            f"{self.project.name}_{layer.name}", filters
        )
        if path:
            try:
                self.export_engine.export_layer(layer, path)
                self.status_info.setText(f"Exported layer: {path}")
            except Exception as e:
                QMessageBox.critical(self, "Error", f"Export failed:\n{e}")

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
        """Scale a generated layer or region and redraw from project data."""
        layer = self.project.get_layer(uid)
        if layer:
            layer.scale_stitches(factor)
            affected_layer = layer
        else:
            region = None
            affected_layer = None
            for candidate_layer in self.project.layers:
                region = candidate_layer.get_region(uid)
                if region:
                    affected_layer = candidate_layer
                    break
            if not region or affected_layer is None:
                return
            region.scale_stitches(factor)

        self.project.modified = True
        self._refresh_layer_stitches(affected_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(f"Scaled selected object: {factor:.2f}x")

    def _move_stitch_object(self, uid: str, dx: float, dy: float):
        """Move a generated layer or region and redraw from project data."""
        layer = self.project.get_layer(uid)
        if layer:
            layer.translate_stitches(dx, dy)
            affected_layer = layer
        else:
            region = None
            affected_layer = None
            for candidate_layer in self.project.layers:
                region = candidate_layer.get_region(uid)
                if region:
                    affected_layer = candidate_layer
                    break
            if not region or affected_layer is None:
                return
            region.translate_stitches(dx, dy)

        self.project.modified = True
        self._refresh_layer_stitches(affected_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText(f"Moved selected object: {dx:.1f}, {dy:.1f}")

    def _resize_stitch_object(self, uid: str, scene_bounds):
        """Resize a region/layer to the mouse-provided scene bounds and regenerate."""
        layer = self.project.get_layer(uid)
        if layer:
            self._resize_layer_regions(layer, scene_bounds)
            affected_layer = layer
            affected_region = None
        else:
            found = self._find_region_with_layer(uid)
            if not found:
                return
            layer, region = found
            self._resize_region_polygon(region, scene_bounds)
            self._regenerate_region(layer, region)
            affected_layer = layer
            affected_region = region

        self.project.modified = True
        if affected_region is None:
            self._refresh_layer_region_masks(affected_layer)
        else:
            self._refresh_region_mask(affected_layer, affected_region)
        self._refresh_layer_stitches(affected_layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText("Resized selected object and regenerated stitches")

    def _resize_layer_regions(self, layer: Layer, scene_bounds):
        old_bounds = layer.stitch_bounds()
        if old_bounds is None:
            return
        sx, sy, dx, dy = self._scene_bounds_transform(old_bounds, scene_bounds)
        for region in layer.regions:
            if getattr(region, "polygon", None) is not None and not region.polygon.is_empty:
                mask_scale = self._current_mask_scale()
                origin = (old_bounds[0] / mask_scale, old_bounds[1] / mask_scale)
                region.polygon = shapely_scale(region.polygon, xfact=sx, yfact=sy, origin=origin)
                region.polygon = shapely_translate(region.polygon, xoff=dx / mask_scale, yoff=dy / mask_scale)
                self._regenerate_region(layer, region)
            else:
                region.scale_stitches(sx, origin=(old_bounds[0], old_bounds[1]))

    def _resize_region_polygon(self, region: Region, scene_bounds):
        polygon = getattr(region, "polygon", None)
        if polygon is None or polygon.is_empty:
            region_bounds = region.stitch_bounds()
            if region_bounds is None:
                return
            sx, sy, dx, dy = self._scene_bounds_transform(region_bounds, scene_bounds)
            region.scale_stitches(sx, origin=(region_bounds[0], region_bounds[1]))
            region.translate_stitches(dx, dy)
            return

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

    @staticmethod
    def _scene_bounds_transform(old_bounds, new_bounds):
        old_left, old_top, old_right, old_bottom = old_bounds
        new_left, new_top, new_right, new_bottom = new_bounds
        old_w = max(old_right - old_left, 1e-6)
        old_h = max(old_bottom - old_top, 1e-6)
        sx = max(new_right - new_left, 1e-6) / old_w
        sy = max(new_bottom - new_top, 1e-6) / old_h
        return sx, sy, new_left - old_left, new_top - old_top

    def _regenerate_region(self, layer: Layer, region: Region):
        paths = self.stitch_engine.generate_region_paths(
            region,
            self.project.processed_image,
            self._flow_field,
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

    def _start_boundary_edit(self, uid: str):
        """Start interactive Bezier boundary editing for a single region."""
        found = self._find_region_with_layer(uid)
        if not found:
            self.status_info.setText("Boundary edit works on a single region.")
            return
        layer, region = found
        polygon = getattr(region, "polygon", None)
        if polygon is None or polygon.is_empty:
            self.status_info.setText("Selected region has no editable vector boundary.")
            return

        self.canvas.start_boundary_edit(uid, polygon, self._current_mask_scale())
        self.canvas.select_object(uid)
        self.status_info.setText("Editing boundary: drag anchors/handles, Enter to apply, Esc to cancel")

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
            self.status_info.setText("Boundary edit produced an empty polygon.")
            return

        region.polygon = polygon
        self._regenerate_region(layer, region)

        self._refresh_region_mask(layer, region)

        self.project.modified = True
        self._refresh_layer_stitches(layer)
        self.canvas.select_object(uid)
        self.layer_panel.refresh()
        self.layer_panel.select_uid(uid)
        self._update_stats()
        self.status_info.setText("Boundary updated and region stitches regenerated")

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
        out_h = img_settings.output_height_mm * 10
        return min(out_w / img_w, out_h / img_h)

    def _on_visibility_changed(self, uid, visible):
        if uid in self.canvas._layer_groups:
            self.canvas._layer_groups[uid].setVisible(visible)

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
            self.canvas.set_layer_stitches(layer.uid, regions_data)
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
                    'color': layer.thread_color_rgb,
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
            self, "About Stitch Studio",
            "<h2>Stitch Studio v1.0</h2>"
            "<p>Image to Embroidery Pattern Converter</p>"
            "<p>Features:</p>"
            "<ul>"
            "<li>Thread pack database with color matching (CIEDE2000)</li>"
            "<li>Image adjustments (brightness, contrast, saturation, etc.)</li>"
            "<li>K-means color quantization in CIELAB space</li>"
            "<li>Multiple fill modes: scanline, contour, flow-guided, satin, "
            "radial, spiral, stipple, cross-stitch</li>"
            "<li>Flow field computation from image structure tensor</li>"
            "<li>Per-region stitch control: direction, length, spacing, density</li>"
            "<li>Underlay and contour row generation</li>"
            "<li>Pull compensation</li>"
            "<li>Export to DST, PES, JEF, VP3, EXP, SVG, PNG</li>"
            "<li>Project save/load</li>"
            "</ul>"
        )

    def _show_shortcuts(self):
        QMessageBox.information(
            self, "Keyboard Shortcuts",
            "Ctrl+I — Load Image\n"
            "Ctrl+Q — Quantize & Segment\n"
            "Ctrl+G — Generate Stitches\n"
            "Ctrl+E — Export Pattern\n"
            "Ctrl+S — Save Project\n"
            "Ctrl+O — Open Project\n"
            "Ctrl+N — New Project\n\n"
            "Canvas:\n"
            "F — Fit to Content\n"
            "+/- — Zoom In/Out\n"
            "0 — Reset Zoom\n"
            "Middle Mouse / Alt+Left — Pan\n"
            "Scroll Wheel — Zoom\n"
            "Right Click — Context Menu\n"
        )

    def closeEvent(self, event):
        if self.project.modified:
            reply = QMessageBox.question(
                self, "Quit",
                "Save changes before quitting?",
                QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel
            )
            if reply == QMessageBox.Save:
                self._save_project()
            elif reply == QMessageBox.Cancel:
                event.ignore()
                return

        self.thread_db.save()
        event.accept()
