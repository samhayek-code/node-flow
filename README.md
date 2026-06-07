# Node-Flow

A motion-blob tracking video tool. Feed it a video, it detects regions of
motion, wraps them in tracked boxes, links them with connectors, and renders a
pixel effect inside each region. Tune everything live, then export a
frame-perfect mp4.

Inspired by Maxime Heckel's `blob-tracking` experiment, rebuilt as an
extensible Canvas2D pipeline you can hack on.

**Live:** https://node-flow-roan.vercel.app · **Source:** https://github.com/samhayek-code/node-flow

## Run

```bash
npm install
npm run dev      # http://localhost:5179
npm run build    # typecheck + production build to dist/
```

Use **Chrome or Edge** — export relies on WebCodecs.

## Use it

1. Pick a source: drag a video onto the canvas, or use the **Source** buttons
   (generated test pattern, open a file, webcam).
2. Tune the panel on the right.
3. For file sources, use the bottom transport bar to play/pause and scrub.
4. **Export .mp4** (transport bar or the Export folder) renders a frame-perfect
   clip and downloads it.

## How it works

The pipeline runs every frame at a reduced internal resolution, then scales to
display. The same render function drives both the live preview and the offline
export, so what you see is what you get.

```
source frame
  → motion        coarse-grid frame differencing + trail decay   (pipeline/motion.ts)
  → blobs         connected-components clustering + tracking      (pipeline/blobs.ts)
  → connectors    links between blob centroids                    (pipeline/connectors.ts)
  → effect        cell-based pixel effect, masked to blobs        (effects/*)
  → compose       base + effect + connectors + boxes              (render/compose.ts)
```

Export decouples from real-time playback: it seeks the source to each exact
frame time, runs the identical pipeline at export resolution (pixel-denominated
params scale up so the look is preserved), and encodes via WebCodecs +
`mp4-muxer` (`export/encoder.ts`).

## Controls

- **Render** — internal resolution, background color.
- **Motion** — grid density, threshold (how much change counts as motion),
  trail decay (how long motion lingers), pre-blur.
- **Blobs** — min size, **max size** (cap as a share of the frame), max count,
  merge distance, padding, **scale** (grow or shrink shapes around their center),
  **shape** (rectangle, circle, ellipse, or diamond), smoothing, stroke style,
  corner ticks.
- **Connectors** — curved / straight / none, max link distance, curve, color.
- **Effect** — dither / halftone / ascii / pixelate / threshold / scanlines /
  edges / chromatic / solarize / none, scope (blobs-only vs full frame), pixel
  size, levels, mono, invert, color.
- **Export** — resolution, fps, duration, bitrate.
- **Presets** — save the current settings to JSON, load them back.

## Add your own effect

Each effect is one file implementing a single contract: draw a processed
version of `src` into `dst` (same dimensions). Compose handles masking to blob
regions and the invert pass.

```ts
// src/effects/myeffect.ts
import type { EffectImpl } from "./index";

export const myEffect: EffectImpl = {
  name: "myeffect",
  label: "my effect",
  render(dst, src, p) {
    // read src.data, draw into dst (a CanvasRenderingContext2D)
  },
};
```

Then register it in `src/effects/index.ts` (add to `EFFECTS`) and add the name
to the `effect` dropdown options and the `EffectType` union in `src/params.ts`.
`src/effects/util.ts` has helpers (`blockAvg`, `luma601`, `BAYER4`, `hexToRgb`).

## Project structure

```
src/
  params.ts             parameter shape + defaults (single source of truth)
  pipeline/             source, motion, blobs, connectors, types
  effects/              effect registry + one file per effect
  render/compose.ts     the shared render core
  export/encoder.ts     WebCodecs + mp4-muxer offline export
  ui/controls.ts        Leva control panel
  App.tsx               canvas, render loop, drag-drop, presets, export
```

## Notes

- **Export needs WebCodecs** (Chrome/Edge). The rest works anywhere.
- **File export** seeks the clip frame-by-frame and loops it if the export
  duration exceeds the clip length.
- **Webcam export** is best-effort — live streams can't be seeked, so it
  captures the current frame rather than a deterministic timeline.
- Rendering is CPU (Canvas2D) by design, for hackable effects. Offline export
  removes the speed pressure; if a future effect needs GPU, it can swap to a
  WebGL2 substrate behind the same place in `compose.ts`.
