# ShapeSnap — Supernote plugin

Draw a **rectangle** or a **circle** and lift the pen. The stroke is replaced by a perfect shape. You can also require a short **hold** at the end of the stroke:

- **Pen style:** it uses the active pen (type, color, width).
- **Resizing:** the shape appears lasso-selected, ready to be resized.
- **Circles:** always perfect, even from a slightly oval stroke. Ellipses are never created.
- **Rectangles:** strokes tilted less than 12° are snapped to the page axes. Beyond that, the rectangle keeps its tilt.
- **Normal writing:** a stroke without a pause is left untouched.

The plugin adds no toolbar button. Its settings live under **Settings → Apps → Plugins → ShapeSnap**.

## Settings

| Setting | Purpose |
|---|---|
| Hold duration | Pause required at the end of the stroke, 0 to 1000 ms (default 0: snap as soon as the pen lifts) |
| Stillness | Jitter allowed during the hold (default 12 px) |
| Tolerance | How neat the drawing must be, 1 (strict) to 5 (lenient) |
| Rectangles / Circles | Enable each shape |
| Select after snapping | Show the lasso on the new shape |

The **Last stroke** box shows three things:

- the measured hold duration;
- the decision;
- the recognition metrics for each point source: size, closing gap, corners, rectangle and circle fit errors.

## How it works

- **Hold detection:**
  - Main method: pen motion events (`registerMotionListener`), which carry timestamps.
  - Fallback: count the still points at the end of the stroke.
- **Recognition** (`src/recognize.ts`, unit-tested with simulated hand-drawn shapes):
  - The stroke is resampled, and any overshoot past the starting point is cut off.
  - Sharp corners are counted along the loop.
  - A circle (least squares) and a minimum-area rectangle are fitted to the loop.
  - It is a rectangle if there are about 4 corners and a small rectangle error. It is a circle if there are no corners and a small circle error.
- **Replacement:** the shape is inserted with `insertGeometry`. What happens to the hand-drawn stroke depends on the **Stroke removal** setting:

  | Mode | Stroke | Undo history |
  |---|---|---|
  | `lasso` (default) | deleted via a lasso (`deleteLassoElements`) when it is alone in its area, otherwise kept; brief flicker. If the stroke cannot be found on the page (e.g. it was a lasso path), no shape is created | kept |
  | `keep` | left under the shape | kept |
  | `number` | always deleted by element number (`deletePageElements`), even over writing or shapes; needs file access | **reset** |

  Measured on a Manta (3.29 beta): `deletePageElements` and `modifyPageElements` clear Supernote's undo history, while `insertGeometry` and lasso operations keep it.
- If the file or page changes while a stroke is being processed, the plugin cancels without editing anything.
- **Lasso tool:** if a lasso selection exists when the pen lifts, the stroke was a selection, not a drawing, and it is ignored.
- **Point sources:** points are read in page pixels, then as raw pen (EMR) coordinates, which do not depend on the reported page size (zoom, landscape).
- **Timeout:** each stroke is processed within 8 s, so a stuck host call can never block the following strokes.

## Install and build

1. Download `ShapeSnap.snplg` from the [latest release](https://github.com/CharlesCheval/supernote-shapesnap/releases/latest) and copy it to the device's `MyStyle` folder (USB, Supernote Partner or Browse & Access).
2. Open **Settings → Apps → Plugins → Add plugin**.
3. The `number` removal mode asks for file access on first use (**Always allow**). The other modes need no permission.

To build from source:

```bash
npm install
npm run build   # -> build/outputs/ShapeSnap.snplg
npx jest
```

## Releasing

Bump `versionName` **and** `versionCode` in `PluginConfig.json` (the device only upgrades when `versionCode` increases), commit, then push a matching tag:

```bash
git tag v<versionName>
git push origin v<versionName>
```

GitHub Actions runs the tests, builds `ShapeSnap.snplg` and attaches it to the release.

## License

[MIT](LICENSE) © Charles Cheval. Not affiliated with Ratta / Supernote.
