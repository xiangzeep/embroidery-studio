# embroidery-studio

A fully client-side web app that converts simple images into embroidery machine files (DST / PES / JEF / EXP / VP3) and previews generated stitches in the browser. Uploaded images are processed locally and are not sent to a server.

## Features

- 100% client-side execution with static Next.js export support.
- WASM-based image processing with OpenCV.js.
- shadcn/ui and Tailwind CSS v4 based UI.
- Canvas 2D and Three.js previews.
- Pyodide plus pyembroidery based embroidery file export.

## Technology Stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js 16 App Router / React 19 / TypeScript |
| Style | Tailwind CSS v4 / shadcn/ui |
| Image Processing | OpenCV.js (WASM) |
| Vectorization | imagetracerjs |
| Stitch Generation | TypeScript implementation for Run / Satin / Fill |
| Embroidery Export | Pyodide + pyembroidery |
| Preview | Canvas 2D / Three.js |

## Pipeline

```text
Image input
  -> color quantization with OpenCV.js k-means
  -> color-region segmentation
  -> vectorization with imagetracerjs
  -> stitch object classification: Run / Satin / Fill
  -> stitch path generation
  -> embroidery file export through Pyodide + pyembroidery
```

See [docs/pipeline.md](./docs/pipeline.md) for pipeline notes.

## Setup

```bash
npm install
npm run dev          # http://localhost:3000
npm run build        # write static output to ./out
```

## Scope

Best suited for logos, line art, icons, and simple low-color graphics. It is not intended to be a stable automatic digitizer for complex photos.
