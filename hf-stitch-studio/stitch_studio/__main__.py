"""
Stitch Studio - Entry Point
Run with: python -m stitch_studio
"""

import sys
import os


def main():
    # PySide6 imports
    from PySide6.QtWidgets import QApplication
    from PySide6.QtCore import Qt
    from PySide6.QtGui import QPalette, QColor

    app = QApplication(sys.argv)
    app.setApplicationName("Stitch Studio")
    app.setApplicationVersion("1.0.0")
    app.setOrganizationName("StitchStudio")

    # Apply dark theme
    _apply_dark_theme(app)

    # Create and show main window
    from .ui.main_window import MainWindow
    window = MainWindow()
    window.show()

    sys.exit(app.exec())


def _apply_dark_theme(app):
    """Apply a professional dark theme to the application."""
    from PySide6.QtGui import QPalette, QColor
    from PySide6.QtCore import Qt

    palette = QPalette()

    # Base colors
    dark = QColor(45, 45, 45)
    darker = QColor(35, 35, 35)
    darkest = QColor(25, 25, 25)
    light = QColor(200, 200, 200)
    mid = QColor(80, 80, 80)
    highlight = QColor(42, 130, 218)
    link = QColor(56, 252, 196)

    palette.setColor(QPalette.Window, dark)
    palette.setColor(QPalette.WindowText, light)
    palette.setColor(QPalette.Base, darker)
    palette.setColor(QPalette.AlternateBase, dark)
    palette.setColor(QPalette.ToolTipBase, darkest)
    palette.setColor(QPalette.ToolTipText, light)
    palette.setColor(QPalette.Text, light)
    palette.setColor(QPalette.Button, dark)
    palette.setColor(QPalette.ButtonText, light)
    palette.setColor(QPalette.BrightText, QColor(255, 255, 255))
    palette.setColor(QPalette.Link, link)
    palette.setColor(QPalette.Highlight, highlight)
    palette.setColor(QPalette.HighlightedText, QColor(255, 255, 255))
    palette.setColor(QPalette.Disabled, QPalette.WindowText, mid)
    palette.setColor(QPalette.Disabled, QPalette.Text, mid)
    palette.setColor(QPalette.Disabled, QPalette.ButtonText, mid)
    palette.setColor(QPalette.Mid, mid)

    app.setPalette(palette)

    # Additional stylesheet refinements
    app.setStyleSheet("""
        QToolTip {
            background-color: #232323;
            color: #cccccc;
            border: 1px solid #555555;
            padding: 4px;
        }
        QDockWidget::title {
            background-color: #353535;
            padding: 6px;
            font-weight: bold;
        }
        QGroupBox {
            border: 1px solid #555555;
            border-radius: 4px;
            margin-top: 12px;
            padding-top: 8px;
            font-weight: bold;
        }
        QGroupBox::title {
            subcontrol-origin: margin;
            left: 10px;
            padding: 0 4px;
        }
        QPushButton {
            background-color: #404040;
            border: 1px solid #555555;
            border-radius: 3px;
            padding: 4px 12px;
            min-height: 22px;
        }
        QPushButton:hover {
            background-color: #505050;
            border-color: #2a82da;
        }
        QPushButton:pressed {
            background-color: #2a82da;
        }
        QSlider::groove:horizontal {
            height: 6px;
            background: #404040;
            border-radius: 3px;
        }
        QSlider::handle:horizontal {
            background: #2a82da;
            width: 14px;
            height: 14px;
            margin: -4px 0;
            border-radius: 7px;
        }
        QSlider::handle:horizontal:hover {
            background: #3a92ea;
        }
        QTreeWidget {
            background-color: #2d2d2d;
            border: 1px solid #555555;
        }
        QTreeWidget::item:hover {
            background-color: #3a3a3a;
        }
        QTreeWidget::item:selected {
            background-color: #2a82da;
        }
        QComboBox {
            background-color: #404040;
            border: 1px solid #555555;
            border-radius: 3px;
            padding: 3px 8px;
        }
        QSpinBox, QDoubleSpinBox {
            background-color: #353535;
            border: 1px solid #555555;
            border-radius: 3px;
            padding: 2px;
        }
        QScrollArea {
            border: none;
        }
        QStatusBar {
            background-color: #2d2d2d;
            border-top: 1px solid #555555;
        }
        QMenuBar {
            background-color: #353535;
        }
        QMenuBar::item:selected {
            background-color: #2a82da;
        }
        QMenu {
            background-color: #353535;
            border: 1px solid #555555;
        }
        QMenu::item:selected {
            background-color: #2a82da;
        }
    """)


if __name__ == "__main__":
    main()
