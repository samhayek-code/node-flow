import { useControls, folder, button } from "leva";
import { useEffect, useRef } from "react";
import type { Params } from "../params";
import { DEFAULT_PARAMS } from "../params";

export interface ControlCallbacks {
  onSavePreset: () => void;
  onLoadPreset: () => void;
}

// Builders that attach a friendly label + hover hint to each control.
const n = (value: number, min: number, max: number, step: number, label: string, hint: string) => ({
  value,
  min,
  max,
  step,
  label,
  hint,
});
const sel = <T extends string | number>(value: T, options: T[], label: string, hint: string) => ({
  value,
  options,
  label,
  hint,
});
const bool = (value: boolean, label: string, hint: string) => ({ value, label, hint });
const color = (value: string, label: string, hint: string) => ({ value, label, hint });

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r2 = (x: number) => Number(x.toFixed(2));

const fset = (color: string, collapsed = true) => ({ color, collapsed });

/** Wires the full parameter set into a grouped, labelled Leva panel and returns
 *  the live values plus a `set` function (used by preset loading + macros). */
export function useNodeVideoControls(callbacks: ControlCallbacks, locked: boolean) {
  const cb = useRef(callbacks);
  cb.current = callbacks;

  // Holds the latest `set` so macro onChange handlers can drive other params.
  const setRef = useRef<((patch: Record<string, unknown>) => void) | null>(null);
  const apply = (patch: Record<string, unknown>) => setRef.current?.(patch);

  const [values, set] = useControls(() => ({
    Global: folder({
      responsiveness: {
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Responsiveness",
        hint: "One knob for snappiness — sensitivity, trail length, and box easing together.",
        onChange: (v: number, _p: string, ctx: { initial: boolean }) => {
          if (ctx.initial) return;
          apply({
            motionThreshold: Number(lerp(0.14, 0.02, v).toFixed(3)),
            trailDecay: r2(lerp(0.92, 0.4, v)),
            boxSmoothing: r2(lerp(0.75, 0.05, v)),
          });
        },
      },
      density: {
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Density",
        hint: "More and finer blobs, with longer-range connections.",
        onChange: (v: number, _p: string, ctx: { initial: boolean }) => {
          if (ctx.initial) return;
          apply({
            motionGrid: Math.round(lerp(48, 200, v)),
            maxBlobs: Math.round(lerp(4, 30, v)),
            connectorMaxDist: Math.round(lerp(120, 600, v)),
          });
        },
      },
      boldness: {
        value: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
        label: "Boldness",
        hint: "Chunkier effect cells, thicker outlines and links, larger shapes.",
        onChange: (v: number, _p: string, ctx: { initial: boolean }) => {
          if (ctx.initial) return;
          apply({
            pixelSize: Math.round(lerp(2, 14, v)),
            boxWidth: Number(lerp(0.5, 4, v).toFixed(1)),
            connectorWidth: Number(lerp(0.5, 3.5, v).toFixed(1)),
            boxScale: Math.round(lerp(80, 160, v)),
          });
        },
      },
    }, fset("#3b82f6", false)),
    Render: folder(
      {
        renderWidth: { ...n(DEFAULT_PARAMS.renderWidth, 64, 3840, 2, "Width", "Canvas width in px. Locked to the source when a video is loaded."), render: () => !locked },
        renderHeight: { ...n(DEFAULT_PARAMS.renderHeight, 64, 3840, 2, "Height", "Canvas height in px. Locked to the source when a video is loaded."), render: () => !locked },
        background: color(DEFAULT_PARAMS.background, "Background", "Color behind the video and effects."),
      },
      fset("#94a3b8"),
    ),
    Motion: folder(
      {
        motionGrid: n(DEFAULT_PARAMS.motionGrid, 16, 240, 1, "Detail", "Motion-grid columns. Higher = finer detail and more, smaller blobs."),
        motionThreshold: n(DEFAULT_PARAMS.motionThreshold, 0, 0.5, 0.005, "Threshold", "How much a cell must change to count as motion. Lower = more sensitive."),
        trailDecay: n(DEFAULT_PARAMS.trailDecay, 0, 0.99, 0.01, "Trail length", "How long motion lingers after it stops. Higher = longer fading trails."),
        preBlur: n(DEFAULT_PARAMS.preBlur, 0, 6, 0.5, "Pre-blur", "Blur before detection to cut noise and video grain."),
      },
      fset("#2dd4bf"),
    ),
    Blobs: folder(
      {
        minBlobSize: n(DEFAULT_PARAMS.minBlobSize, 1, 80, 1, "Min size", "Smallest motion cluster to track, in grid cells. Filters out specks."),
        maxBlobSize: n(DEFAULT_PARAMS.maxBlobSize, 0.02, 1, 0.01, "Max size", "Largest blob allowed, as a share of the frame. 1 = no cap."),
        boxScale: n(DEFAULT_PARAMS.boxScale, 30, 300, 5, "Size %", "Scale each shape around its center. 100% = the detected size."),
        maxBlobs: n(DEFAULT_PARAMS.maxBlobs, 1, 40, 1, "Max count", "How many blobs can be tracked at once (largest win)."),
        mergeDistance: n(DEFAULT_PARAMS.mergeDistance, 0, 320, 1, "Merge distance", "Blobs whose centers are closer than this (px) fuse into one."),
        boxPadding: n(DEFAULT_PARAMS.boxPadding, 0, 60, 1, "Padding", "Extra space added around each detected region (px)."),
        boxShape: sel(DEFAULT_PARAMS.boxShape, ["rect", "circle", "ellipse", "diamond"], "Shape", "Outline and effect-mask shape. Circle/diamond are pure; ellipse follows the box."),
        boxSmoothing: n(DEFAULT_PARAMS.boxSmoothing, 0, 0.95, 0.01, "Smoothing", "Ease shape movement frame to frame. Higher = smoother but laggier."),
        showBoxes: bool(DEFAULT_PARAMS.showBoxes, "Show outlines", "Draw the blob outlines on top of the video."),
        cornerTicks: bool(DEFAULT_PARAMS.cornerTicks, "Corner ticks", "Corner brackets instead of a full rectangle (rectangle shape only)."),
        boxColor: color(DEFAULT_PARAMS.boxColor, "Outline color", "Stroke color of the outlines."),
        boxWidth: n(DEFAULT_PARAMS.boxWidth, 0.5, 6, 0.5, "Outline width", "Outline stroke width (px)."),
      },
      fset("#fbbf24"),
    ),
    Connectors: folder(
      {
        connectorStyle: sel(DEFAULT_PARAMS.connectorStyle, ["curved", "straight", "none"], "Style", "Lines drawn between nearby blob centers."),
        connectorMaxDist: n(DEFAULT_PARAMS.connectorMaxDist, 20, 1200, 10, "Max link length", "Only connect blobs within this distance (px)."),
        connectorCurve: n(DEFAULT_PARAMS.connectorCurve, -1, 1, 0.05, "Curve", "Bow amount for curved links. 0 = straight."),
        connectorColor: color(DEFAULT_PARAMS.connectorColor, "Color", "Line and node color."),
        connectorWidth: n(DEFAULT_PARAMS.connectorWidth, 0.5, 6, 0.5, "Width", "Line thickness (px)."),
      },
      fset("#a78bfa"),
    ),
    Effect: folder({
      effect: sel(
        DEFAULT_PARAMS.effect,
        ["dither", "halftone", "ascii", "pixelate", "threshold", "scanlines", "edges", "chromatic", "solarize", "none"],
        "Type",
        "Pixel effect rendered into the blobs (or the whole frame).",
      ),
      effectScope: sel(DEFAULT_PARAMS.effectScope, ["blobs", "full"], "Apply to", "Inside the blob shapes only, or the entire frame."),
      pixelSize: n(DEFAULT_PARAMS.pixelSize, 1, 40, 1, "Cell size", "Size of dots / cells / shift for the effect (px)."),
      levels: n(DEFAULT_PARAMS.levels, 2, 16, 1, "Levels", "Color steps for dither/threshold; sensitivity for edges/solarize."),
      mono: bool(DEFAULT_PARAMS.mono, "Monochrome", "Collapse the effect to a single color."),
      invert: bool(DEFAULT_PARAMS.invert, "Invert", "Invert the effect output."),
      effectColor: color(DEFAULT_PARAMS.effectColor, "Color", "Foreground color for mono / ascii / halftone / edges."),
    }, fset("#f472b6", false)),
    Presets: folder(
      {
        "Save preset…": button(() => cb.current.onSavePreset()),
        "Load preset…": button(() => cb.current.onLoadPreset()),
      },
      fset("#9ca3af"),
    ),
  }), [locked]);

  useEffect(() => {
    setRef.current = set as unknown as (patch: Record<string, unknown>) => void;
  }, [set]);
  // Ensure it's available before the first effect flush too.
  setRef.current = set as unknown as (patch: Record<string, unknown>) => void;

  return { values: values as unknown as Params, set };
}
