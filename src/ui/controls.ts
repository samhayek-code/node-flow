import { useControls, folder, button } from "leva";
import { useRef } from "react";
import type { Params } from "../params";
import { DEFAULT_PARAMS } from "../params";
import type { MacroState } from "../store/types";
import { useStore, bridge, DEFAULT_MACROS } from "../store/store";

export interface ControlCallbacks {
  onSaveProject: () => void;
  onOpenProject: () => void;
}

type LevaCtx = { initial: boolean };

/** Edge A (Leva -> store). A genuine user edit dispatches into the store and
 *  becomes undoable. Echoes from a programmatic writeback (bridge.writebackActive)
 *  are ignored — the store is already authoritative for those. The store's
 *  before===after no-op guard is the backstop if Leva ever defers an echo past
 *  the synchronous writeback window. */
const onParam =
  <K extends keyof Params>(key: K) =>
  (v: Params[K], _path: string, ctx: LevaCtx) => {
    if (ctx.initial || bridge.writebackActive) return;
    useStore.getState().setParam(key, v);
  };

const onMacro =
  (key: keyof MacroState) =>
  (v: number, _path: string, ctx: LevaCtx) => {
    if (ctx.initial || bridge.writebackActive) return;
    useStore.getState().setMacro(key, v);
  };

// Builders: a friendly label + hover hint + the store dispatch, per control.
const n = <K extends keyof Params>(
  key: K,
  value: number,
  min: number,
  max: number,
  step: number,
  label: string,
  hint: string,
  extra: Record<string, unknown> = {},
) => ({ value, min, max, step, label, hint, onChange: onParam(key), ...extra });

const sel = <K extends keyof Params>(
  key: K,
  value: Params[K],
  options: Params[K][],
  label: string,
  hint: string,
) => ({ value, options, label, hint, onChange: onParam(key) });

const bool = <K extends keyof Params>(key: K, value: boolean, label: string, hint: string) => ({
  value,
  label,
  hint,
  onChange: onParam(key),
});

const color = <K extends keyof Params>(key: K, value: string, label: string, hint: string) => ({
  value,
  label,
  hint,
  onChange: onParam(key),
});

const macro = (key: keyof MacroState, value: number, label: string, hint: string) => ({
  value,
  min: 0,
  max: 1,
  step: 0.01,
  label,
  hint,
  onChange: onMacro(key),
});

const fset = (color: string, collapsed = true) => ({ color, collapsed });

/** Wires the full parameter set into a grouped, labelled Leva panel. Every
 *  control dispatches into the store (Edge A); the returned `set` drives Leva
 *  programmatically (Edge C: undo/redo/load/macro/preset reflection). */
export function useNodeVideoControls(callbacks: ControlCallbacks, locked: boolean) {
  const cb = useRef(callbacks);
  cb.current = callbacks;

  const [, set] = useControls(
    () => ({
      Canvas: folder(
        {
          renderWidth: n(
            "renderWidth",
            DEFAULT_PARAMS.renderWidth,
            64,
            3840,
            2,
            "Width",
            "Canvas width in px. Locked to the source when a video is loaded.",
            { render: () => !locked },
          ),
          renderHeight: n(
            "renderHeight",
            DEFAULT_PARAMS.renderHeight,
            64,
            3840,
            2,
            "Height",
            "Canvas height in px. Locked to the source when a video is loaded.",
            { render: () => !locked },
          ),
          background: color("background", DEFAULT_PARAMS.background, "Background", "Color behind the video and effects."),
        },
        fset("#94a3b8", false),
      ),
      Global: folder(
        {
          responsiveness: macro(
            "responsiveness",
            DEFAULT_MACROS.responsiveness,
            "Responsiveness",
            "One knob for snappiness — sensitivity, trail length, and box easing together.",
          ),
          density: macro("density", DEFAULT_MACROS.density, "Density", "More and finer blobs, with longer-range connections."),
          boldness: macro(
            "boldness",
            DEFAULT_MACROS.boldness,
            "Boldness",
            "Chunkier effect cells, thicker outlines and links, larger shapes.",
          ),
          size: macro("size", DEFAULT_MACROS.size, "Size", "Overall blob size."),
        },
        fset("#3b82f6", false),
      ),
      Motion: folder(
        {
          motionGrid: n("motionGrid", DEFAULT_PARAMS.motionGrid, 16, 240, 1, "Detail", "Motion-grid columns. Higher = finer detail and more, smaller blobs."),
          motionThreshold: n("motionThreshold", DEFAULT_PARAMS.motionThreshold, 0, 0.5, 0.005, "Threshold", "How much a cell must change to count as motion. Lower = more sensitive."),
          trailDecay: n("trailDecay", DEFAULT_PARAMS.trailDecay, 0, 0.99, 0.01, "Trail length", "How long motion lingers after it stops. Higher = longer fading trails."),
          preBlur: n("preBlur", DEFAULT_PARAMS.preBlur, 0, 6, 0.5, "Pre-blur", "Blur before detection to cut noise and video grain."),
        },
        fset("#2dd4bf"),
      ),
      Blobs: folder(
        {
          boxScale: n("boxScale", DEFAULT_PARAMS.boxScale, 0, 100, 1, "Size", "Overall blob size, as a % of the canvas short edge."),
          minBlobSize: n("minBlobSize", DEFAULT_PARAMS.minBlobSize, 0, 100, 1, "Min size", "Smallest a blob can be, as a % of Size."),
          maxBlobSize: n("maxBlobSize", DEFAULT_PARAMS.maxBlobSize, 0, 100, 1, "Max size", "Largest a blob can be, as a % of Size."),
          maxBlobs: n("maxBlobs", DEFAULT_PARAMS.maxBlobs, 1, 40, 1, "Max count", "How many blobs can be tracked at once (largest win)."),
          mergeDistance: n("mergeDistance", DEFAULT_PARAMS.mergeDistance, 0, 320, 1, "Merge distance", "Blobs whose centers are closer than this (px) fuse into one."),
          boxPadding: n("boxPadding", DEFAULT_PARAMS.boxPadding, 0, 60, 1, "Padding", "Extra space added around each detected region (px)."),
          boxShape: sel("boxShape", DEFAULT_PARAMS.boxShape, ["rect", "circle", "ellipse", "diamond"], "Shape", "Outline and effect-mask shape. Circle/diamond are pure; ellipse follows the box."),
          boxSmoothing: n("boxSmoothing", DEFAULT_PARAMS.boxSmoothing, 0, 0.95, 0.01, "Smoothing", "Ease shape movement frame to frame. Higher = smoother but laggier."),
          showBoxes: bool("showBoxes", DEFAULT_PARAMS.showBoxes, "Show outlines", "Draw the blob outlines on top of the video."),
          cornerTicks: bool("cornerTicks", DEFAULT_PARAMS.cornerTicks, "Corner ticks", "Corner brackets instead of a full rectangle (rectangle shape only)."),
          boxColor: color("boxColor", DEFAULT_PARAMS.boxColor, "Outline color", "Stroke color of the outlines."),
          boxWidth: n("boxWidth", DEFAULT_PARAMS.boxWidth, 0.5, 6, 0.5, "Outline width", "Outline stroke width (px)."),
        },
        fset("#fbbf24"),
      ),
      Connectors: folder(
        {
          connectorStyle: sel("connectorStyle", DEFAULT_PARAMS.connectorStyle, ["curved", "straight", "none"], "Style", "Lines drawn between nearby blob centers."),
          connectorMaxDist: n("connectorMaxDist", DEFAULT_PARAMS.connectorMaxDist, 20, 1200, 10, "Max link length", "Only connect blobs within this distance (px)."),
          connectorCurve: n("connectorCurve", DEFAULT_PARAMS.connectorCurve, -1, 1, 0.05, "Curve", "Bow amount for curved links. 0 = straight."),
          connectorColor: color("connectorColor", DEFAULT_PARAMS.connectorColor, "Color", "Line and node color."),
          connectorWidth: n("connectorWidth", DEFAULT_PARAMS.connectorWidth, 0.5, 6, 0.5, "Width", "Line thickness (px)."),
        },
        fset("#a78bfa"),
      ),
      Effect: folder(
        {
          effect: sel(
            "effect",
            DEFAULT_PARAMS.effect,
            ["dither", "halftone", "ascii", "pixelate", "threshold", "scanlines", "edges", "chromatic", "solarize", "none"],
            "Type",
            "Pixel effect rendered into the blobs (or the whole frame).",
          ),
          effectScope: sel("effectScope", DEFAULT_PARAMS.effectScope, ["blobs", "full"], "Apply to", "Inside the blob shapes only, or the entire frame."),
          pixelSize: n("pixelSize", DEFAULT_PARAMS.pixelSize, 1, 40, 1, "Cell size", "Size of dots / cells / shift for the effect (px)."),
          levels: n("levels", DEFAULT_PARAMS.levels, 2, 16, 1, "Levels", "Color steps for dither/threshold; sensitivity for edges/solarize."),
          mono: bool("mono", DEFAULT_PARAMS.mono, "Monochrome", "Collapse the effect to a single color."),
          invert: bool("invert", DEFAULT_PARAMS.invert, "Invert", "Invert the effect output."),
          effectColor: color("effectColor", DEFAULT_PARAMS.effectColor, "Color", "Foreground color for mono / ascii / halftone / edges."),
        },
        fset("#f472b6", false),
      ),
      Project: folder(
        {
          "Save project…": button(() => cb.current.onSaveProject()),
          "Open project…": button(() => cb.current.onOpenProject()),
        },
        fset("#9ca3af"),
      ),
    }),
    [locked],
  );

  return { set };
}
