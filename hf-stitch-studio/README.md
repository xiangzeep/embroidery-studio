# Stitch Studio — Image to Embroidery Pattern Designer

A professional desktop application for converting images into embroidery machine files (.DST, .PES, .JEF, and more). Built with PySide6 for a modern UI, vector stitch rendering, and complete control over every aspect of the digitizing process.

---

## Features

### Thread Library System
- **Thread Pack Database** — organize your physical thread inventory into packs (by brand, type, project)
- **Thread Types** — matte, shiny, metallic, neon, UV, glow-in-dark, variegated, silk, cotton, polyester, rayon, wool
- **Import/Export** — JSON and CSV support for sharing and backing up thread collections
- **CIEDE2000 Color Matching** — perceptually accurate color matching when quantizing images to your available threads
- **Add/Edit/Remove** threads with full metadata: name, brand, catalog number, color, type, weight

### Image Processing
- **Image Adjustments** — brightness, contrast, saturation, sharpness, blur with real-time sliders
- **Color Quantization** — K-means clustering in CIELAB color space with automatic palette matching to your thread collection
- **Auto-Segmentation** — connected component analysis with morphological cleanup
- **Output Size Control** — set physical dimensions (mm) with aspect ratio lock
- **Configurable Parameters** — number of colors, minimum region size, smoothing kernel size, dithering

### Stitch Generation Engine (8 Fill Modes)
1. **Scanline** — classic boustrophedon zigzag fill at any angle
2. **Contour** — concentric inward contour fill following region shape
3. **Flow-Guided** — stitches follow image content using structure tensor orientation fields (RK4 streamline integration)
4. **Satin** — zigzag perpendicular to medial axis, auto-adapts width from distance transform
5. **Radial** — rays emanating from region center
6. **Spiral** — Archimedean spiral from center outward
7. **Stipple** — random meandering fill with nearest-neighbor ordering
8. **Cross-Stitch** — decorative X-pattern grid

### Per-Region Stitch Control
- **Fill mode** selector per region
- **Stitch direction** — fixed angle, image gradient, contour-following, radial, manual
- **Angle** — 0°-360° with slider + spinner
- **Stitch length** — average, min, max with length randomization slider
- **Row spacing** — density control with multiplier
- **Underlay** — automatic underlay with configurable angle offset and density
- **Contour rows** — border stitches before fill
- **Pull compensation** — outward expansion to compensate for fabric pull
- **Flow field controls** — strength and smoothing parameters

### Layer System
- **Multi-color layers** — each color is a separate layer with its own regions
- **Layer ordering** — move up/down, controls stitch execution order
- **Per-layer visibility** — toggle layers on/off
- **Region management** — rename, delete, duplicate
- **Tree view** — expandable layers showing child regions with stitch counts

### Vector Canvas
- **GPU-accelerated rendering** via Qt's QGraphicsView
- **Zoom/Pan** — mouse wheel zoom, middle-click/alt-click pan
- **Stitch path rendering** — colored vector paths for each layer
- **Region mask overlay** — semi-transparent color regions
- **Background image** — adjustable opacity
- **Context menu** — toggle visibility of stitches, stitch points, regions, image

### Export
- **DST** — Tajima (universal, works with virtually all machines)
- **PES** — Brother
- **JEF** — Janome
- **VP3** — Pfaff
- **EXP** — Melco
- **HUS** — Husqvarna
- **XXX** — Singer
- **SVG** — vector preview
- **PNG** — raster preview
- Per-layer export support
- Pattern statistics: stitch count, thread length, dimensions, color changes

### Project Management
- **Save/Load** `.ssp` project files (JSON with embedded image)
- **Full state preservation** — all layers, regions, settings, source image
- **Unsaved changes detection** with save prompt

---

## Installation

### Requirements
- Python 3.10+
- Windows, macOS, or Linux

### Quick Install
```bash
# Install dependencies
pip install -r requirements.txt

# Run
python run_stitch_studio.py
# or
python -m stitch_studio
```

### Install as Package
```bash
pip install -e .
stitch-studio  # run from anywhere
```

---

## Quick Start

1. **Launch** the app: `python run_stitch_studio.py`
2. **Set up threads**: In the Thread Library panel (left), add your thread packs via "Add Thread" or import from CSV/JSON
3. **Load an image**: `Ctrl+I` or File → Load Image
4. **Adjust image**: Use the Image & Quantization panel sliders
5. **Set output size**: Enter physical dimensions in mm
6. **Quantize**: Click "Quantize & Segment" — maps image colors to your thread palette and segments into regions
7. **Fine-tune**: Select layers/regions in the Layers panel and adjust stitch settings in the Properties panel
8. **Compute flow field** (optional): Process → Compute Flow Field — enables flow-guided fill mode
9. **Generate stitches**: `Ctrl+G`
10. **Preview**: Zoom/pan on the canvas to inspect stitch paths
11. **Export**: `Ctrl+E` — choose your machine's format (DST, PES, JEF, etc.)

---

## Thread Pack CSV Format

```csv
name,brand,catalog_number,r,g,b,thread_type,weight,quantity,notes
"Bright Red","Madeira","1147",220,30,30,"polyester","40",3,"My favorite red"
"Gold Metallic","Madeira","4002",212,175,55,"metallic","40",1,""
```

Thread types: `matte`, `shiny`, `metallic`, `neon`, `uv`, `glow_in_dark`, `variegated`, `silk`, `cotton`, `polyester`, `rayon`, `wool`, `other`

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+I` | Load Image |
| `Ctrl+Q` | Quantize & Segment |
| `Ctrl+G` | Generate Stitches |
| `Ctrl+E` | Export Pattern |
| `Ctrl+S` | Save Project |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+O` | Open Project |
| `Ctrl+N` | New Project |
| `F` | Fit canvas to content |
| `+` / `-` | Zoom in/out |
| `0` | Reset zoom |
| Middle mouse / Alt+Left | Pan canvas |
| Scroll wheel | Zoom |
| Right click | Context menu |

---

## Architecture

```
stitch_studio/
├── __init__.py
├── __main__.py              # Entry point + dark theme
├── core/
│   ├── thread_db.py         # Thread database (packs, colors, CIEDE2000 matching)
│   ├── project.py           # Project model (layers, regions, settings, save/load)
│   ├── image_engine.py      # Image processing, quantization, segmentation, flow fields
│   ├── stitch_engine.py     # 8 fill mode stitch generators with flow control
│   └── export_engine.py     # pyembroidery export to DST/PES/JEF/VP3/etc.
├── ui/
│   ├── canvas.py            # QGraphicsView vector canvas
│   ├── panels.py            # Thread, Layer, Properties, Image, Stats panels
│   └── main_window.py       # Main window with docks, menus, toolbar
└── data/                    # User data directory
```

### Key Technologies
- **PySide6** (Qt6) — professional desktop UI with dockable panels
- **pyembroidery** — reads/writes 45+ embroidery machine formats
- **scikit-learn** — K-means color quantization
- **scikit-image** — CIELAB color space, CIEDE2000 distance, morphology
- **OpenCV** — connected component segmentation, structure tensor
- **SciPy** — flow field smoothing, interpolation
- **Shapely** — polygon operations for scanline fill
- **NumPy** — array processing, flow field computation

---

## Embroidery Tips

### Recommended Workflow
1. Start with **fewer colors** (8-12) and increase if needed
2. Use **flow-guided fill** for organic shapes (skin, fabric, nature)
3. Use **scanline fill** for geometric areas
4. Use **contour fill** for borders and text
5. Always enable **underlay** for proper fabric stabilization
6. Set **pull compensation** to 0.1-0.2mm for stretchy fabrics
7. Export as **PES** (Brother) or **JEF** (Janome) to preserve color data; **DST** is universal but has no color info

### Thread Order
- Embroider **light colors first**, dark colors last (prevents show-through)
- The layer order in the panel = stitch execution order
- Background/largest areas first, detail layers last

---

## License

MIT — use freely for personal and commercial projects.
