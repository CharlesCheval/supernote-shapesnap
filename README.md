# ShapeSnap — Supernote plugin

Draw a **rectangle**, a **circle**, an **arrow**, a **curly brace**, a **square root** or **coordinate axes** and lift the pen. The stroke is replaced by a perfect shape. You can also require a short **hold** at the end of the stroke:

- **Pen style:** it uses the active pen (type, color, width).
- **Resizing:** the shape appears lasso-selected, ready to be resized.
- **Circles:** always perfect, even from a slightly oval stroke. Ellipses are never created.
- **Rectangles:** strokes tilted less than 12° are snapped to the page axes. Beyond that, the rectangle keeps its tilt.
- **Arrows:** draw a straight line, then its head at the end, without lifting the pen (a triangle, a V, or barb → tip → barb). The result is a clean shaft with a solid triangular head whose size depends only on the pen width, never on the drawn head. A shaft within the **Arrow snapping** angle (default 8°) of horizontal or vertical is snapped to it; otherwise it keeps its direction.
- **Curly braces:** `{`, `}`, over- or under-braces, in one stroke. The clean brace keeps the drawn length and depth, and is straightened when within 12° of the page axes.
- **Square roots:** a √ drawn upright in one stroke (short stroke down, long rise, bar to the right). The bar keeps the drawn length, so it covers what is written under it, however tall.
- **Coordinate axes:** draw an "L" (one vertical and one horizontal leg, each at least 90 px). The corner becomes the origin; each leg becomes an axis in the direction it was drawn, with a tick every 5 mm and a solid arrow head.
- **Normal writing:** a stroke without a pause is left untouched.

The plugin adds no toolbar button. Its settings live under **Settings → Apps → Plugins → ShapeSnap**.

## Settings

| Setting | Purpose |
|---|---|
| Hold duration | Pause required at the end of the stroke, 0 to 1000 ms (default 0: snap as soon as the pen lifts) |
| Stillness | Jitter allowed during the hold (default 12 px) |
| Tolerance | How neat the drawing must be, 1 (strict) to 5 (lenient) |
| Shape icons | Tap an icon to turn that shape on (black) or off (grey): rectangle, circle, arrow, brace, square root, axes |
| Arrow snapping | Arrows within this angle of horizontal or vertical are straightened, 0 to 20° (default 8°, 0 = never) |
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
  - Otherwise, open shapes are tried in turn (`src/symbols.ts` for the maths ones):
    - brace: the stroke bulges to one side of its start → end chord, with flat arms at about half depth and a sharp point in the middle (an arc or a "<" is rejected);
    - square root: lowest point, then a straight rise at 45–89°, then a horizontal bar to the right, with a short straight stroke before the lowest point (a check mark has no bar and is rejected);
    - axes: two straight legs at a right angle, within 7° of the page axes;
  - an arrow: the tip is the first point farthest from the start; the start → tip shaft must be straight (slight bowing allowed); what is drawn after the tip must be small, go back behind the tip and reach both sides of the shaft. The whole arrow is one polyline (`GEO_polygon`), 30° barbs, length `30 px + 4 px per pen pixel`. Geometries cannot be filled, so the polyline zigzags across the head with rungs closer than the line width, which merge into a solid head.
- **Replacement:** the shape is inserted with `insertGeometry`. What happens to the hand-drawn stroke depends on the **Stroke removal** setting:

  | Mode | Stroke | Undo history |
  |---|---|---|
  | `number` (default) | deleted by element number (`deletePageElements`), even when drawn over writing or other shapes; needs file access. Only the stroke that matches (ink pen, same first and last point) is ever deleted | **reset** |
  | `keep` | left under the shape | kept |

  Measured on a Manta (3.29 beta): `deletePageElements` and `modifyPageElements` clear Supernote's undo history, while `insertGeometry` and lasso operations keep it.

  An earlier `lasso` mode deleted the stroke through a plugin-driven lasso to keep the undo history. It was removed in 0.9.0: it left the stroke behind whenever the shape was drawn over writing, and driving the lasso could clash with the user's own lasso selection. Saved `lasso` settings switch to `number`.
- If the file or page changes while a stroke is being processed, the plugin cancels without editing anything.
- **Lasso tool:** the host sends lasso paths through the same pen-up event, as a stroke with `penType` 4 (measured on a Manta, undocumented). While the lasso tool is active, the lasso APIs (`getLassoRect`…) answer "not allowed" (code 102), so they cannot detect it. ShapeSnap therefore only touches strokes drawn with a known ink pen (`penType` 1, 10, 11, 15 from the SDK, and 16 for the ink pen, measured; `src/guard.ts`); anything else is ignored. As a second guard, a stroke is also ignored when a lasso selection exists when the pen lifts. The plugin never drives the lasso itself.
- **Point sources:** points are read in page pixels, then as raw pen (EMR) coordinates, which do not depend on the reported page size (zoom, landscape).
- **Timeout:** each stroke is processed within 8 s, so a stuck host call can never block the following strokes.

## Install and build

1. Download `ShapeSnap.snplg` from the [latest release](https://github.com/CharlesCheval/supernote-shapesnap/releases/latest) and copy it to the device's `MyStyle` folder (USB, Supernote Partner or Browse & Access).
2. Open **Settings → Apps → Plugins → Add plugin**.
3. The first snapped shape asks for file access (**Always allow**), needed to delete the hand-drawn stroke. The `keep` mode needs no permission.

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
