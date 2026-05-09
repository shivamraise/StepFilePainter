# STEP Face Color Editor

A zero-dependency, single-file browser app for painting per-face colors on STEP/IGES CAD files and exporting the result as a standards-compliant STEP file.

No install, no build step — just open `step-color-editor.html` in a browser.

![STEP Face Color Editor](https://github.com/shivamraise/StepFilePainter/raw/main/preview.png)

## Features

- **Drag & drop** `.stp`, `.step`, or `.p21` files to load
- **Per-face painting** — right-click or right-drag to paint individual faces
- **HSV color picker** with hex input and color presets
- **Favorites** — save your palette; the HTML file stores them internally so they persist across sessions
- **Color palette panel** — lists all unique colors in the model with face counts; click a swatch to bulk-recolor all faces of that color
- **Undo / redo** — `Ctrl+Z` / `Ctrl+Y` with full support for bulk operations
- **3D navigation** — orbit (middle-drag), pan (left-drag), scroll-to-zoom
- **Ortho / perspective** camera toggle
- **Wireframe** and **edge overlay** toggles
- **Hide / show** individual faces
- **Export STEP** — writes colors back as standard AP214/AP242 `OVER_RIDING_STYLED_ITEM` entities, readable by Onshape, CATIA, FreeCAD, and other STEP-aware tools

## Usage

1. Open `step-color-editor.html` in any modern browser (Chrome/Edge recommended for File System Access API support).
2. Drop a `.step` file onto the drop zone, or click to browse.
3. Pick a color with the HSV picker or type a hex value.
4. **Right-click** a face to paint it; **right-drag** to paint multiple faces in a stroke.
5. Click **Export STEP** to download the colored file.

To save your favorites palette, click **Save** next to the Favorites row — it overwrites the HTML file itself with the updated color list.

## How colors are exported

The exporter appends a chain of STEP entities for each painted face:

```
COLOUR_RGB → FILL_AREA_STYLE_COLOUR → FILL_AREA_STYLE
  → SURFACE_STYLE_FILL_AREA → SURFACE_SIDE_STYLE → SURFACE_STYLE_USAGE
  → PRESENTATION_STYLE_ASSIGNMENT → OVER_RIDING_STYLED_ITEM
```

This is the standard AP214/AP242 mechanism and is compatible with Onshape, FreeCAD, CATIA, SolidWorks, and Altium 3D imports.

## Tech stack

| Library | Version | Purpose |
|---|---|---|
| [Three.js](https://threejs.org) | r128 | 3D rendering, raycasting |
| [occt-import-js](https://github.com/kovacsv/occt-import-js) | 0.0.22 | OpenCascade WASM — STEP parsing & tessellation |

Both are loaded from CDN on first use. After that, the app works offline.

## Browser support

Chrome 89+, Edge 89+, Firefox 90+. The File System Access API (for in-place Save) requires Chrome/Edge; Firefox falls back to a download prompt.

## License

MIT
