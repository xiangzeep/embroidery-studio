"""
UI Panels
Dock-able panels for the main window:
- ThreadPanel: manage thread packs & colors
- LayerPanel: layer list, ordering, visibility
- PropertiesPanel: stitch settings for selected region/layer
- ImagePanel: image adjustment controls
- StatsPanel: pattern statistics
"""

from PySide6.QtWidgets import (
    QWidget, QVBoxLayout, QHBoxLayout, QGridLayout,
    QLabel, QSlider, QSpinBox, QDoubleSpinBox, QComboBox,
    QCheckBox, QPushButton, QToolButton, QGroupBox, QScrollArea,
    QListWidget, QListWidgetItem, QTabWidget, QFileDialog,
    QColorDialog, QLineEdit, QTextEdit, QSplitter, QFrame,
    QTreeWidget, QTreeWidgetItem, QHeaderView, QMenu,
    QMessageBox, QInputDialog, QSizePolicy
)
from PySide6.QtCore import Qt, Signal, QSize
from PySide6.QtGui import QColor, QIcon, QPixmap, QPainter, QBrush, QPen, QAction

from ..core.thread_db import ThreadDatabase, ThreadPack, ThreadColor, ThreadType
from ..core.project import (
    Project, Layer, Region, StitchSettings, ImageSettings,
    QuantizationSettings, FillMode, StitchDirection
)


def _color_icon(r, g, b, size=16):
    """Create a small color swatch icon."""
    pixmap = QPixmap(size, size)
    pixmap.fill(QColor(r, g, b))
    painter = QPainter(pixmap)
    painter.setPen(QPen(QColor(80, 80, 80), 1))
    painter.drawRect(0, 0, size - 1, size - 1)
    painter.end()
    return QIcon(pixmap)


# ============================================================
# THREAD PANEL
# ============================================================

class ThreadPanel(QWidget):
    """Thread pack and color management panel."""

    threads_changed = Signal()

    def __init__(self, thread_db: ThreadDatabase, parent=None):
        super().__init__(parent)
        self.db = thread_db
        self._build_ui()
        self._refresh()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)

        # Pack selector
        pack_bar = QHBoxLayout()
        self.pack_combo = QComboBox()
        self.pack_combo.currentIndexChanged.connect(self._on_pack_changed)
        pack_bar.addWidget(self.pack_combo, 1)

        btn_add_pack = QToolButton()
        btn_add_pack.setText("+")
        btn_add_pack.setToolTip("New Pack")
        btn_add_pack.clicked.connect(self._add_pack)
        pack_bar.addWidget(btn_add_pack)

        btn_del_pack = QToolButton()
        btn_del_pack.setText("−")
        btn_del_pack.setToolTip("Delete Pack")
        btn_del_pack.clicked.connect(self._delete_pack)
        pack_bar.addWidget(btn_del_pack)

        layout.addLayout(pack_bar)

        # Import / Export
        io_bar = QHBoxLayout()
        btn_import_json = QPushButton("Import JSON")
        btn_import_json.clicked.connect(self._import_json)
        btn_import_csv = QPushButton("Import CSV")
        btn_import_csv.clicked.connect(self._import_csv)
        btn_export_json = QPushButton("Export JSON")
        btn_export_json.clicked.connect(self._export_json)
        btn_export_csv = QPushButton("Export CSV")
        btn_export_csv.clicked.connect(self._export_csv)
        io_bar.addWidget(btn_import_json)
        io_bar.addWidget(btn_import_csv)
        io_bar.addWidget(btn_export_json)
        io_bar.addWidget(btn_export_csv)
        layout.addLayout(io_bar)

        # Thread list
        self.thread_tree = QTreeWidget()
        self.thread_tree.setHeaderLabels(["Color", "Name", "Type", "Cat#"])
        self.thread_tree.setColumnWidth(0, 30)
        self.thread_tree.setColumnWidth(1, 100)
        self.thread_tree.setRootIsDecorated(False)
        self.thread_tree.setSelectionMode(QTreeWidget.ExtendedSelection)
        self.thread_tree.itemDoubleClicked.connect(self._edit_thread)
        layout.addWidget(self.thread_tree, 1)

        # Thread actions
        act_bar = QHBoxLayout()
        btn_add = QPushButton("Add Thread")
        btn_add.clicked.connect(self._add_thread)
        btn_del = QPushButton("Remove")
        btn_del.clicked.connect(self._remove_selected)
        btn_edit = QPushButton("Edit")
        btn_edit.clicked.connect(self._edit_selected)
        act_bar.addWidget(btn_add)
        act_bar.addWidget(btn_edit)
        act_bar.addWidget(btn_del)
        layout.addLayout(act_bar)

        # Pack info
        self.pack_info = QLabel("")
        self.pack_info.setStyleSheet("color: gray; font-size: 10px;")
        layout.addWidget(self.pack_info)

    def _refresh(self):
        self.pack_combo.blockSignals(True)
        self.pack_combo.clear()
        for p in self.db.packs:
            self.pack_combo.addItem(f"{p.name} ({len(p.threads)})", p.uid)
        self.pack_combo.blockSignals(False)
        self._on_pack_changed()

    def _current_pack(self):
        idx = self.pack_combo.currentIndex()
        if idx < 0 or idx >= len(self.db.packs):
            return None
        return self.db.packs[idx]

    def _on_pack_changed(self):
        self.thread_tree.clear()
        pack = self._current_pack()
        if not pack:
            self.pack_info.setText("")
            return

        for t in pack.threads:
            item = QTreeWidgetItem()
            r, g, b = t.color_rgb
            item.setIcon(0, _color_icon(r, g, b))
            item.setText(1, t.name)
            item.setText(2, t.thread_type)
            item.setText(3, t.catalog_number)
            item.setData(0, Qt.UserRole, t.uid)
            self.thread_tree.addTopLevelItem(item)

        self.pack_info.setText(
            f"{pack.name} • {pack.brand} • {len(pack.threads)} threads"
        )

    def _add_pack(self):
        name, ok = QInputDialog.getText(self, "New Thread Pack", "Pack name:")
        if ok and name:
            pack = ThreadPack(name=name)
            self.db.add_pack(pack)
            self.db.save()
            self._refresh()
            self.threads_changed.emit()

    def _delete_pack(self):
        pack = self._current_pack()
        if not pack:
            return
        reply = QMessageBox.question(
            self, "Delete Pack",
            f"Delete '{pack.name}' with {len(pack.threads)} threads?"
        )
        if reply == QMessageBox.Yes:
            self.db.remove_pack(pack.uid)
            self.db.save()
            self._refresh()
            self.threads_changed.emit()

    def _add_thread(self):
        pack = self._current_pack()
        if not pack:
            return

        color = QColorDialog.getColor(Qt.white, self, "Choose Thread Color")
        if not color.isValid():
            return

        name, ok = QInputDialog.getText(self, "Thread Name", "Name:")
        if not ok:
            return

        types = [t.value for t in ThreadType]
        type_str, ok = QInputDialog.getItem(self, "Thread Type", "Type:", types, 0, False)
        if not ok:
            return

        thread = ThreadColor(
            name=name,
            color_rgb=(color.red(), color.green(), color.blue()),
            thread_type=type_str,
            brand=pack.brand,
        )
        pack.add_thread(thread)
        self.db.save()
        self._on_pack_changed()
        self.threads_changed.emit()

    def _remove_selected(self):
        pack = self._current_pack()
        if not pack:
            return
        for item in self.thread_tree.selectedItems():
            uid = item.data(0, Qt.UserRole)
            pack.remove_thread(uid)
        self.db.save()
        self._on_pack_changed()
        self.threads_changed.emit()

    def _edit_selected(self):
        items = self.thread_tree.selectedItems()
        if items:
            self._edit_thread(items[0], 0)

    def _edit_thread(self, item, column=0):
        pack = self._current_pack()
        if not pack:
            return
        uid = item.data(0, Qt.UserRole)
        thread = pack.get_thread(uid)
        if not thread:
            return

        color = QColorDialog.getColor(
            QColor(*thread.color_rgb), self, "Edit Thread Color"
        )
        if color.isValid():
            thread.color_rgb = (color.red(), color.green(), color.blue())

        name, ok = QInputDialog.getText(self, "Edit Name", "Name:", text=thread.name)
        if ok:
            thread.name = name

        self.db.save()
        self._on_pack_changed()
        self.threads_changed.emit()

    def _import_json(self):
        path, _ = QFileDialog.getOpenFileName(self, "Import Thread Pack", "", "JSON (*.json)")
        if path:
            self.db.import_pack_json(path)
            self.db.save()
            self._refresh()
            self.threads_changed.emit()

    def _import_csv(self):
        path, _ = QFileDialog.getOpenFileName(self, "Import Thread Pack", "", "CSV (*.csv)")
        if path:
            self.db.import_pack_csv(path)
            self.db.save()
            self._refresh()
            self.threads_changed.emit()

    def _export_json(self):
        pack = self._current_pack()
        if not pack:
            return
        path, _ = QFileDialog.getSaveFileName(self, "Export Thread Pack", pack.name + ".json", "JSON (*.json)")
        if path:
            self.db.export_pack_json(pack.uid, path)

    def _export_csv(self):
        pack = self._current_pack()
        if not pack:
            return
        path, _ = QFileDialog.getSaveFileName(self, "Export Thread Pack", pack.name + ".csv", "CSV (*.csv)")
        if path:
            self.db.export_pack_csv(pack.uid, path)


# ============================================================
# LAYER PANEL
# ============================================================

class LayerPanel(QWidget):
    """Layer list with visibility, ordering, selection."""

    layer_selected = Signal(str)  # layer UID
    layer_visibility_changed = Signal(str, bool)
    layer_order_changed = Signal()
    request_regenerate = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.project: Project = None
        self._build_ui()

    def _build_ui(self):
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)

        # Title
        title_bar = QHBoxLayout()
        title_bar.addWidget(QLabel("Layers"))
        btn_regen = QPushButton("⟳ Regenerate")
        btn_regen.setToolTip("Regenerate all stitches")
        btn_regen.clicked.connect(self.request_regenerate.emit)
        title_bar.addWidget(btn_regen)
        layout.addLayout(title_bar)

        # Layer tree
        self.layer_tree = QTreeWidget()
        self.layer_tree.setHeaderLabels(["👁", "Color", "Name", "Regions", "Stitches"])
        self.layer_tree.setColumnWidth(0, 30)
        self.layer_tree.setColumnWidth(1, 30)
        self.layer_tree.setColumnWidth(2, 100)
        self.layer_tree.setColumnWidth(3, 50)
        self.layer_tree.setRootIsDecorated(True)
        self.layer_tree.itemClicked.connect(self._on_item_clicked)
        self.layer_tree.setContextMenuPolicy(Qt.CustomContextMenu)
        self.layer_tree.customContextMenuRequested.connect(self._context_menu)
        layout.addWidget(self.layer_tree, 1)

        # Layer actions
        btn_bar = QHBoxLayout()
        btn_up = QPushButton("↑")
        btn_up.setToolTip("Move Up")
        btn_up.setMaximumWidth(40)
        btn_up.clicked.connect(lambda: self._move_layer(-1))
        btn_down = QPushButton("↓")
        btn_down.setToolTip("Move Down")
        btn_down.setMaximumWidth(40)
        btn_down.clicked.connect(lambda: self._move_layer(1))
        btn_del = QPushButton("Delete")
        btn_del.clicked.connect(self._delete_layer)
        btn_merge = QPushButton("Merge")
        btn_merge.setToolTip("Merge selected layers")
        btn_merge.clicked.connect(self._merge_layers)
        btn_bar.addWidget(btn_up)
        btn_bar.addWidget(btn_down)
        btn_bar.addWidget(btn_del)
        btn_bar.addWidget(btn_merge)
        layout.addLayout(btn_bar)

    def set_project(self, project: Project):
        self.project = project
        self.refresh()

    def refresh(self):
        self.layer_tree.clear()
        if not self.project:
            return

        for layer in self.project.layers:
            item = QTreeWidgetItem()
            item.setCheckState(0, Qt.Checked if layer.visible else Qt.Unchecked)
            r, g, b = layer.thread_color_rgb
            item.setIcon(1, _color_icon(r, g, b))
            item.setText(2, layer.name)
            item.setText(3, str(len(layer.regions)))

            total_stitches = sum(
                len(r.stitch_points) if r.stitch_points else 0
                for r in layer.regions
            )
            item.setText(4, str(total_stitches))
            item.setData(0, Qt.UserRole, layer.uid)
            item.setData(0, Qt.UserRole + 1, "layer")

            # Add region children
            for region in layer.regions:
                child = QTreeWidgetItem(item)
                child.setCheckState(0, Qt.Checked if region.visible else Qt.Unchecked)
                child.setIcon(1, _color_icon(r, g, b, 12))
                child.setText(2, region.name)
                child.setText(3, region.stitch_settings.fill_mode)
                child.setText(4, str(len(region.stitch_points)) if region.stitch_points else "0")
                child.setData(0, Qt.UserRole, region.uid)
                child.setData(0, Qt.UserRole + 1, "region")

            self.layer_tree.addTopLevelItem(item)

        self.layer_tree.expandAll()

    def select_uid(self, uid: str):
        """Select a layer or region row without changing project state."""
        for i in range(self.layer_tree.topLevelItemCount()):
            item = self.layer_tree.topLevelItem(i)
            if item.data(0, Qt.UserRole) == uid:
                self.layer_tree.setCurrentItem(item)
                return
            for j in range(item.childCount()):
                child = item.child(j)
                if child.data(0, Qt.UserRole) == uid:
                    self.layer_tree.setCurrentItem(child)
                    return

    def _on_item_clicked(self, item, column):
        uid = item.data(0, Qt.UserRole)
        item_type = item.data(0, Qt.UserRole + 1)

        if column == 0:  # visibility toggle
            checked = item.checkState(0) == Qt.Checked
            if item_type == "layer" and self.project:
                layer = self.project.get_layer(uid)
                if layer:
                    layer.visible = checked
                    self.layer_visibility_changed.emit(uid, checked)
            elif item_type == "region" and self.project:
                # Find parent layer
                parent = item.parent()
                if parent:
                    layer_uid = parent.data(0, Qt.UserRole)
                    layer = self.project.get_layer(layer_uid)
                    if layer:
                        region = layer.get_region(uid)
                        if region:
                            region.visible = checked
        else:
            self.layer_selected.emit(uid)

    def _move_layer(self, direction):
        item = self.layer_tree.currentItem()
        if not item or not self.project:
            return
        uid = item.data(0, Qt.UserRole)
        self.project.move_layer(uid, direction)
        self.refresh()
        self.layer_order_changed.emit()

    def _delete_layer(self):
        item = self.layer_tree.currentItem()
        if not item or not self.project:
            return
        uid = item.data(0, Qt.UserRole)
        item_type = item.data(0, Qt.UserRole + 1)

        if item_type == "layer":
            self.project.remove_layer(uid)
        elif item_type == "region":
            parent = item.parent()
            if parent:
                layer_uid = parent.data(0, Qt.UserRole)
                layer = self.project.get_layer(layer_uid)
                if layer:
                    layer.remove_region(uid)
        self.refresh()

    def _merge_layers(self):
        # Merge all selected layers into the first one
        pass  # TODO

    def _context_menu(self, pos):
        item = self.layer_tree.itemAt(pos)
        if not item:
            return
        menu = QMenu(self)
        menu.addAction("Rename", lambda: self._rename_item(item))
        menu.addAction("Duplicate", lambda: self._duplicate_item(item))
        menu.addAction("Delete", self._delete_layer)
        menu.exec(self.layer_tree.mapToGlobal(pos))

    def _rename_item(self, item):
        uid = item.data(0, Qt.UserRole)
        name, ok = QInputDialog.getText(self, "Rename", "New name:", text=item.text(2))
        if ok and self.project:
            layer = self.project.get_layer(uid)
            if layer:
                layer.name = name
            else:
                for l in self.project.layers:
                    r = l.get_region(uid)
                    if r:
                        r.name = name
                        break
            self.refresh()

    def _duplicate_item(self, item):
        pass  # TODO


# ============================================================
# PROPERTIES PANEL
# ============================================================

class PropertiesPanel(QWidget):
    """Stitch settings editor for selected layer/region."""

    settings_changed = Signal(str, object)  # uid, StitchSettings

    def __init__(self, parent=None):
        super().__init__(parent)
        self._current_uid = ""
        self._current_settings: StitchSettings = None
        self._blocking = False
        self._build_ui()

    def _build_ui(self):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(4, 4, 4, 4)

        # --- Fill Mode ---
        grp_fill = QGroupBox("Fill Mode")
        fl = QVBoxLayout(grp_fill)
        self.combo_fill = QComboBox()
        self.combo_fill.addItems([
            "run", "scanline", "contour", "flow_guided", "satin",
            "radial", "spiral", "stipple", "cross_stitch", "none"
        ])
        self.combo_fill.currentTextChanged.connect(self._on_changed)
        fl.addWidget(self.combo_fill)
        layout.addWidget(grp_fill)

        # --- Direction ---
        grp_dir = QGroupBox("Stitch Direction")
        dl = QGridLayout(grp_dir)
        dl.addWidget(QLabel("Mode:"), 0, 0)
        self.combo_dir = QComboBox()
        self.combo_dir.addItems([
            "fixed_angle", "image_gradient", "contour_follow",
            "radial_from_center", "manual"
        ])
        self.combo_dir.currentTextChanged.connect(self._on_changed)
        dl.addWidget(self.combo_dir, 0, 1)

        dl.addWidget(QLabel("Angle (°):"), 1, 0)
        self.spin_angle = QDoubleSpinBox()
        self.spin_angle.setRange(0, 360)
        self.spin_angle.setSingleStep(5)
        self.spin_angle.valueChanged.connect(self._on_changed)
        dl.addWidget(self.spin_angle, 1, 1)

        self.slider_angle = QSlider(Qt.Horizontal)
        self.slider_angle.setRange(0, 360)
        self.slider_angle.valueChanged.connect(lambda v: self.spin_angle.setValue(v))
        dl.addWidget(self.slider_angle, 2, 0, 1, 2)
        layout.addWidget(grp_dir)

        # --- Stitch Length ---
        grp_len = QGroupBox("Stitch Length (mm)")
        ll = QGridLayout(grp_len)

        ll.addWidget(QLabel("Length:"), 0, 0)
        self.spin_length = QDoubleSpinBox()
        self.spin_length.setRange(0.5, 12.0)
        self.spin_length.setSingleStep(0.1)
        self.spin_length.setDecimals(1)
        self.spin_length.valueChanged.connect(self._on_changed)
        ll.addWidget(self.spin_length, 0, 1)

        self.slider_length = QSlider(Qt.Horizontal)
        self.slider_length.setRange(5, 120)
        self.slider_length.valueChanged.connect(lambda v: self.spin_length.setValue(v / 10))
        ll.addWidget(self.slider_length, 1, 0, 1, 2)

        ll.addWidget(QLabel("Min:"), 2, 0)
        self.spin_len_min = QDoubleSpinBox()
        self.spin_len_min.setRange(0.5, 12.0)
        self.spin_len_min.setSingleStep(0.1)
        self.spin_len_min.setDecimals(1)
        self.spin_len_min.valueChanged.connect(self._on_changed)
        ll.addWidget(self.spin_len_min, 2, 1)

        ll.addWidget(QLabel("Max:"), 3, 0)
        self.spin_len_max = QDoubleSpinBox()
        self.spin_len_max.setRange(0.5, 12.0)
        self.spin_len_max.setSingleStep(0.1)
        self.spin_len_max.setDecimals(1)
        self.spin_len_max.valueChanged.connect(self._on_changed)
        ll.addWidget(self.spin_len_max, 3, 1)

        ll.addWidget(QLabel("Randomize:"), 4, 0)
        self.slider_random = QSlider(Qt.Horizontal)
        self.slider_random.setRange(0, 100)
        self.slider_random.valueChanged.connect(self._on_changed)
        ll.addWidget(self.slider_random, 4, 1)
        layout.addWidget(grp_len)

        # --- Density ---
        grp_density = QGroupBox("Density & Spacing")
        ddl = QGridLayout(grp_density)

        ddl.addWidget(QLabel("Row Spacing (mm):"), 0, 0)
        self.spin_spacing = QDoubleSpinBox()
        self.spin_spacing.setRange(0.1, 5.0)
        self.spin_spacing.setSingleStep(0.05)
        self.spin_spacing.setDecimals(2)
        self.spin_spacing.valueChanged.connect(self._on_changed)
        ddl.addWidget(self.spin_spacing, 0, 1)

        self.slider_spacing = QSlider(Qt.Horizontal)
        self.slider_spacing.setRange(10, 500)
        self.slider_spacing.valueChanged.connect(lambda v: self.spin_spacing.setValue(v / 100))
        ddl.addWidget(self.slider_spacing, 1, 0, 1, 2)

        ddl.addWidget(QLabel("Density multiplier:"), 2, 0)
        self.spin_density = QDoubleSpinBox()
        self.spin_density.setRange(0.1, 5.0)
        self.spin_density.setSingleStep(0.1)
        self.spin_density.setDecimals(1)
        self.spin_density.valueChanged.connect(self._on_changed)
        ddl.addWidget(self.spin_density, 2, 1)

        self.slider_density = QSlider(Qt.Horizontal)
        self.slider_density.setRange(10, 500)
        self.slider_density.valueChanged.connect(lambda v: self.spin_density.setValue(v / 100))
        ddl.addWidget(self.slider_density, 3, 0, 1, 2)
        layout.addWidget(grp_density)

        # --- Underlay ---
        grp_under = QGroupBox("Underlay")
        ul = QGridLayout(grp_under)
        self.chk_underlay = QCheckBox("Enable Underlay")
        self.chk_underlay.stateChanged.connect(self._on_changed)
        ul.addWidget(self.chk_underlay, 0, 0, 1, 2)

        ul.addWidget(QLabel("Angle Offset:"), 1, 0)
        self.spin_under_angle = QDoubleSpinBox()
        self.spin_under_angle.setRange(0, 180)
        self.spin_under_angle.setSingleStep(15)
        self.spin_under_angle.valueChanged.connect(self._on_changed)
        ul.addWidget(self.spin_under_angle, 1, 1)

        ul.addWidget(QLabel("Density:"), 2, 0)
        self.spin_under_density = QDoubleSpinBox()
        self.spin_under_density.setRange(0.1, 2.0)
        self.spin_under_density.setSingleStep(0.1)
        self.spin_under_density.setDecimals(1)
        self.spin_under_density.valueChanged.connect(self._on_changed)
        ul.addWidget(self.spin_under_density, 2, 1)
        layout.addWidget(grp_under)

        # --- Contour ---
        grp_contour = QGroupBox("Contour")
        cl = QGridLayout(grp_contour)
        cl.addWidget(QLabel("Contour Rows:"), 0, 0)
        self.spin_contour_count = QSpinBox()
        self.spin_contour_count.setRange(0, 20)
        self.spin_contour_count.valueChanged.connect(self._on_changed)
        cl.addWidget(self.spin_contour_count, 0, 1)

        cl.addWidget(QLabel("Offset (mm):"), 1, 0)
        self.spin_contour_offset = QDoubleSpinBox()
        self.spin_contour_offset.setRange(0.1, 5.0)
        self.spin_contour_offset.setSingleStep(0.1)
        self.spin_contour_offset.setDecimals(1)
        self.spin_contour_offset.valueChanged.connect(self._on_changed)
        cl.addWidget(self.spin_contour_offset, 1, 1)
        layout.addWidget(grp_contour)

        # --- Pull Compensation ---
        grp_pull = QGroupBox("Pull Compensation")
        pl = QGridLayout(grp_pull)
        pl.addWidget(QLabel("Expand (mm):"), 0, 0)
        self.spin_pull = QDoubleSpinBox()
        self.spin_pull.setRange(0, 2.0)
        self.spin_pull.setSingleStep(0.05)
        self.spin_pull.setDecimals(2)
        self.spin_pull.valueChanged.connect(self._on_changed)
        pl.addWidget(self.spin_pull, 0, 1)
        layout.addWidget(grp_pull)

        # --- Flow Field ---
        grp_flow = QGroupBox("Flow Field (for flow_guided)")
        ffl = QGridLayout(grp_flow)
        ffl.addWidget(QLabel("Strength:"), 0, 0)
        self.slider_flow_str = QSlider(Qt.Horizontal)
        self.slider_flow_str.setRange(0, 100)
        self.slider_flow_str.valueChanged.connect(self._on_changed)
        ffl.addWidget(self.slider_flow_str, 0, 1)

        ffl.addWidget(QLabel("Smoothing:"), 1, 0)
        self.slider_flow_smooth = QSlider(Qt.Horizontal)
        self.slider_flow_smooth.setRange(1, 100)
        self.slider_flow_smooth.valueChanged.connect(self._on_changed)
        ffl.addWidget(self.slider_flow_smooth, 1, 1)
        layout.addWidget(grp_flow)

        layout.addStretch()
        scroll.setWidget(container)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(scroll)

    def set_settings(self, uid: str, settings: StitchSettings):
        """Populate UI from a StitchSettings object."""
        self._blocking = True
        self._current_uid = uid
        self._current_settings = settings

        self.combo_fill.setCurrentText(settings.fill_mode)
        self.combo_dir.setCurrentText(settings.direction_mode)
        self.spin_angle.setValue(settings.angle_deg)
        self.slider_angle.setValue(int(settings.angle_deg))
        self.spin_length.setValue(settings.stitch_length_mm)
        self.slider_length.setValue(int(settings.stitch_length_mm * 10))
        self.spin_len_min.setValue(settings.stitch_length_min_mm)
        self.spin_len_max.setValue(settings.stitch_length_max_mm)
        self.slider_random.setValue(int(settings.randomize_length * 100))
        self.spin_spacing.setValue(settings.row_spacing_mm)
        self.slider_spacing.setValue(int(settings.row_spacing_mm * 100))
        self.spin_density.setValue(settings.density)
        self.slider_density.setValue(int(settings.density * 100))
        self.chk_underlay.setChecked(settings.underlay)
        self.spin_under_angle.setValue(settings.underlay_angle_offset)
        self.spin_under_density.setValue(settings.underlay_density)
        self.spin_contour_count.setValue(settings.contour_count)
        self.spin_contour_offset.setValue(settings.contour_offset_mm)
        self.spin_pull.setValue(settings.pull_compensation_mm)
        self.slider_flow_str.setValue(int(settings.flow_strength * 100))
        self.slider_flow_smooth.setValue(int(settings.flow_smoothing * 10))

        self._blocking = False

    def _on_changed(self, *args):
        if self._blocking or not self._current_settings:
            return

        s = self._current_settings
        s.fill_mode = self.combo_fill.currentText()
        s.direction_mode = self.combo_dir.currentText()
        s.angle_deg = self.spin_angle.value()
        s.stitch_length_mm = self.spin_length.value()
        s.stitch_length_min_mm = self.spin_len_min.value()
        s.stitch_length_max_mm = self.spin_len_max.value()
        s.randomize_length = self.slider_random.value() / 100.0
        s.row_spacing_mm = self.spin_spacing.value()
        s.density = self.spin_density.value()
        s.underlay = self.chk_underlay.isChecked()
        s.underlay_angle_offset = self.spin_under_angle.value()
        s.underlay_density = self.spin_under_density.value()
        s.contour_count = self.spin_contour_count.value()
        s.contour_offset_mm = self.spin_contour_offset.value()
        s.pull_compensation_mm = self.spin_pull.value()
        s.flow_strength = self.slider_flow_str.value() / 100.0
        s.flow_smoothing = self.slider_flow_smooth.value() / 10.0

        self.settings_changed.emit(self._current_uid, s)


# ============================================================
# IMAGE PANEL
# ============================================================

class ImagePanel(QWidget):
    """Image adjustment and quantization controls."""

    image_changed = Signal()
    quantize_requested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self._settings = ImageSettings()
        self._quant = QuantizationSettings()
        self._blocking = False
        self._build_ui()

    def _build_ui(self):
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)

        container = QWidget()
        layout = QVBoxLayout(container)
        layout.setContentsMargins(4, 4, 4, 4)

        # --- Image Adjustments ---
        grp_adj = QGroupBox("Image Adjustments")
        al = QGridLayout(grp_adj)

        self._sliders = {}
        adjustments = [
            ("Brightness", "brightness", -100, 100, 0),
            ("Contrast", "contrast", 10, 300, 100),
            ("Saturation", "saturation", 0, 300, 100),
            ("Sharpness", "sharpness", 0, 200, 0),
            ("Blur", "blur", 0, 100, 0),
        ]

        for row, (label, key, lo, hi, default) in enumerate(adjustments):
            al.addWidget(QLabel(label + ":"), row, 0)
            slider = QSlider(Qt.Horizontal)
            slider.setRange(lo, hi)
            slider.setValue(default)
            slider.valueChanged.connect(self._on_image_changed)
            al.addWidget(slider, row, 1)
            val_label = QLabel(str(default))
            val_label.setMinimumWidth(35)
            slider.valueChanged.connect(lambda v, lbl=val_label: lbl.setText(str(v)))
            al.addWidget(val_label, row, 2)
            self._sliders[key] = slider

        btn_reset = QPushButton("Reset Adjustments")
        btn_reset.clicked.connect(self._reset_adjustments)
        al.addWidget(btn_reset, len(adjustments), 0, 1, 3)
        layout.addWidget(grp_adj)

        # --- Output Size ---
        grp_size = QGroupBox("Output Size")
        sl = QGridLayout(grp_size)

        sl.addWidget(QLabel("Width (mm):"), 0, 0)
        self.spin_width = QDoubleSpinBox()
        self.spin_width.setRange(10, 2000)
        self.spin_width.setValue(100)
        self.spin_width.valueChanged.connect(self._on_image_changed)
        sl.addWidget(self.spin_width, 0, 1)

        sl.addWidget(QLabel("Height (mm):"), 1, 0)
        self.spin_height = QDoubleSpinBox()
        self.spin_height.setRange(10, 2000)
        self.spin_height.setValue(100)
        self.spin_height.valueChanged.connect(self._on_image_changed)
        sl.addWidget(self.spin_height, 1, 1)

        self.chk_lock_ratio = QCheckBox("Lock Aspect Ratio")
        self.chk_lock_ratio.setChecked(True)
        sl.addWidget(self.chk_lock_ratio, 2, 0, 1, 2)
        layout.addWidget(grp_size)

        # --- Quantization ---
        grp_quant = QGroupBox("Color Quantization")
        ql = QGridLayout(grp_quant)

        ql.addWidget(QLabel("Colors:"), 0, 0)
        self.spin_colors = QSpinBox()
        self.spin_colors.setRange(2, 64)
        self.spin_colors.setValue(16)
        ql.addWidget(self.spin_colors, 0, 1)

        self.slider_colors = QSlider(Qt.Horizontal)
        self.slider_colors.setRange(2, 64)
        self.slider_colors.setValue(16)
        self.slider_colors.valueChanged.connect(self.spin_colors.setValue)
        self.spin_colors.valueChanged.connect(self.slider_colors.setValue)
        ql.addWidget(self.slider_colors, 1, 0, 1, 2)

        ql.addWidget(QLabel("Method:"), 2, 0)
        self.combo_method = QComboBox()
        self.combo_method.addItems(["kmeans_lab", "median_cut", "octree"])
        ql.addWidget(self.combo_method, 2, 1)

        ql.addWidget(QLabel("Min Region (px²):"), 3, 0)
        self.spin_min_area = QSpinBox()
        self.spin_min_area.setRange(1, 10000)
        self.spin_min_area.setValue(40)
        ql.addWidget(self.spin_min_area, 3, 1)

        ql.addWidget(QLabel("Smooth Kernel:"), 4, 0)
        self.spin_kernel = QSpinBox()
        self.spin_kernel.setRange(1, 21)
        self.spin_kernel.setSingleStep(2)
        self.spin_kernel.setValue(5)
        ql.addWidget(self.spin_kernel, 4, 1)

        self.chk_smooth = QCheckBox("Smooth Regions")
        self.chk_smooth.setChecked(True)
        ql.addWidget(self.chk_smooth, 5, 0, 1, 2)

        self.chk_dither = QCheckBox("Dithering")
        ql.addWidget(self.chk_dither, 6, 0, 1, 2)

        btn_quantize = QPushButton("⟳ Quantize & Segment")
        btn_quantize.setStyleSheet("font-weight: bold; padding: 8px;")
        btn_quantize.clicked.connect(self.quantize_requested.emit)
        ql.addWidget(btn_quantize, 7, 0, 1, 2)

        layout.addWidget(grp_quant)
        layout.addStretch()

        scroll.setWidget(container)
        main = QVBoxLayout(self)
        main.setContentsMargins(0, 0, 0, 0)
        main.addWidget(scroll)

    def get_image_settings(self) -> ImageSettings:
        s = ImageSettings()
        s.brightness = self._sliders["brightness"].value() / 100.0
        s.contrast = self._sliders["contrast"].value() / 100.0
        s.saturation = self._sliders["saturation"].value() / 100.0
        s.sharpness = self._sliders["sharpness"].value() / 100.0
        s.blur = self._sliders["blur"].value() / 10.0
        s.output_width_mm = self.spin_width.value()
        s.output_height_mm = self.spin_height.value()
        return s

    def get_quant_settings(self) -> QuantizationSettings:
        q = QuantizationSettings()
        q.n_colors = self.spin_colors.value()
        q.method = self.combo_method.currentText()
        q.min_region_area_px = self.spin_min_area.value()
        q.morphology_kernel_size = self.spin_kernel.value()
        q.smooth_regions = self.chk_smooth.isChecked()
        q.dither = self.chk_dither.isChecked()
        return q

    def set_image_settings(self, s: ImageSettings):
        self._blocking = True
        self._sliders["brightness"].setValue(int(s.brightness * 100))
        self._sliders["contrast"].setValue(int(s.contrast * 100))
        self._sliders["saturation"].setValue(int(s.saturation * 100))
        self._sliders["sharpness"].setValue(int(s.sharpness * 100))
        self._sliders["blur"].setValue(int(s.blur * 10))
        self.spin_width.setValue(s.output_width_mm)
        self.spin_height.setValue(s.output_height_mm)
        self._blocking = False

    def set_quant_settings(self, q: QuantizationSettings):
        self._blocking = True
        self.spin_colors.setValue(q.n_colors)
        self.combo_method.setCurrentText(q.method)
        self.spin_min_area.setValue(q.min_region_area_px)
        self.spin_kernel.setValue(q.morphology_kernel_size)
        self.chk_smooth.setChecked(q.smooth_regions)
        self.chk_dither.setChecked(q.dither)
        self._blocking = False

    def _on_image_changed(self):
        if not self._blocking:
            self.image_changed.emit()

    def _reset_adjustments(self):
        defaults = {"brightness": 0, "contrast": 100, "saturation": 100,
                     "sharpness": 0, "blur": 0}
        for key, val in defaults.items():
            self._sliders[key].setValue(val)


# ============================================================
# STATS PANEL
# ============================================================

class StatsPanel(QWidget):
    """Display pattern statistics."""

    def __init__(self, parent=None):
        super().__init__(parent)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(4, 4, 4, 4)

        self.text = QTextEdit()
        self.text.setReadOnly(True)
        self.text.setMaximumHeight(200)
        layout.addWidget(self.text)

    def update_stats(self, stats: dict):
        lines = [
            f"Total stitches: {stats.get('total_stitches', 0):,}",
            f"Jump stitches: {stats.get('total_jumps', 0):,}",
            f"Trim commands: {stats.get('total_trims', 0):,}",
            f"Color changes: {stats.get('color_changes', 0)}",
            f"Colors used: {stats.get('n_colors', 0)}",
            f"Size: {stats.get('width_mm', 0):.1f} × {stats.get('height_mm', 0):.1f} mm",
            f"Thread length: {stats.get('thread_length_m', 0):.1f} m",
        ]
        self.text.setText("\n".join(lines))
