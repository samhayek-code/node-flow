import { useControls, folder, button } from "leva";
import { useEffect, useRef } from "react";
import type { Params, ExportSettings } from "../params";
import { DEFAULT_PARAMS, DEFAULT_EXPORT } from "../params";

export interface ControlCallbacks {
  onGenerated: () => void;
  onPickFile: () => void;
  onWebcam: () => void;
  onExport: () => void;
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

const COLLAPSED = { collapsed: true };

/** Wires the full parameter set into a grouped, labelled Leva panel and returns
 *  the live values plus a `set` function (used by preset loading). */
export function useNodeVideoControls(callbacks: ControlCallbacks) {
  const cb = useRef(callbacks);
  cb.current = callbacks;

  const [values, set] = useControls(() => ({
    Source: folder({
      "Use generated": button(() => cb.current.onGenerated()),
      "Open video…": button(() => cb.current.onPickFile()),
      Webcam: button(() => cb.current.onWebcam()),
    }),
    Render: folder(
      {
        renderWidth: n(DEFAULT_PARAMS.renderWidth, 320, 1920, 20, "Preview width", "Internal render resolution in px. Lower = faster preview; export uses its own size."),
        background: color(DEFAULT_PARAMS.background, "Background", "Color behind the video and effects."),
      },
      COLLAPSED,
    ),
    Motion: folder(
      {
        motionGrid: n(DEFAULT_PARAMS.motionGrid, 16, 240, 1, "Detail", "Motion-grid columns. Higher = finer detail and more, smaller blobs."),
        motionThreshold: n(DEFAULT_PARAMS.motionThreshold, 0, 0.5, 0.005, "Threshold", "How much a cell must change to count as motion. Lower = more sensitive."),
        trailDecay: n(DEFAULT_PARAMS.trailDecay, 0, 0.99, 0.01, "Trail length", "How long motion lingers after it stops. Higher = longer fading trails."),
        preBlur: n(DEFAULT_PARAMS.preBlur, 0, 6, 0.5, "Pre-blur", "Blur before detection to cut noise and video grain."),
      },
      COLLAPSED,
    ),
    Blobs: folder(
      {
        minBlobSize: n(DEFAULT_PARAMS.minBlobSize, 1, 80, 1, "Min size", "Smallest motion cluster to track, in grid cells. Filters out specks."),
        maxBlobSize: n(DEFAULT_PARAMS.maxBlobSize, 0.02, 1, 0.01, "Max size", "Largest blob allowed, as a share of the frame. 1 = no cap."),
        maxBlobs: n(DEFAULT_PARAMS.maxBlobs, 1, 40, 1, "Max count", "How many blobs can be tracked at once (largest win)."),
        mergeDistance: n(DEFAULT_PARAMS.mergeDistance, 0, 320, 1, "Merge distance", "Blobs whose centers are closer than this (px) fuse into one."),
        boxPadding: n(DEFAULT_PARAMS.boxPadding, 0, 60, 1, "Padding", "Extra space added around each detected region (px)."),
        boxScale: n(DEFAULT_PARAMS.boxScale, 0.3, 3, 0.05, "Size", "Scale each shape around its center. 1 = detected size."),
        boxShape: sel(DEFAULT_PARAMS.boxShape, ["rect", "circle", "ellipse", "diamond"], "Shape", "Outline and effect-mask shape. Circle/diamond are pure; ellipse follows the box."),
        boxSmoothing: n(DEFAULT_PARAMS.boxSmoothing, 0, 0.95, 0.01, "Smoothing", "Ease shape movement frame to frame. Higher = smoother but laggier."),
        showBoxes: bool(DEFAULT_PARAMS.showBoxes, "Show outlines", "Draw the blob outlines on top of the video."),
        cornerTicks: bool(DEFAULT_PARAMS.cornerTicks, "Corner ticks", "Corner brackets instead of a full rectangle (rectangle shape only)."),
        boxColor: color(DEFAULT_PARAMS.boxColor, "Outline color", "Stroke color of the outlines."),
        boxWidth: n(DEFAULT_PARAMS.boxWidth, 0.5, 6, 0.5, "Outline width", "Outline stroke width (px)."),
      },
      COLLAPSED,
    ),
    Connectors: folder(
      {
        connectorStyle: sel(DEFAULT_PARAMS.connectorStyle, ["curved", "straight", "none"], "Style", "Lines drawn between nearby blob centers."),
        connectorMaxDist: n(DEFAULT_PARAMS.connectorMaxDist, 20, 1200, 10, "Max link length", "Only connect blobs within this distance (px)."),
        connectorCurve: n(DEFAULT_PARAMS.connectorCurve, -1, 1, 0.05, "Curve", "Bow amount for curved links. 0 = straight."),
        connectorColor: color(DEFAULT_PARAMS.connectorColor, "Color", "Line and node color."),
        connectorWidth: n(DEFAULT_PARAMS.connectorWidth, 0.5, 6, 0.5, "Width", "Line thickness (px)."),
      },
      COLLAPSED,
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
    }),
    Export: folder(
      {
        exportWidth: n(DEFAULT_EXPORT.exportWidth, 480, 2560, 20, "Width", "Output width (px). Height follows the source aspect."),
        exportFps: sel(DEFAULT_EXPORT.exportFps, [24, 30, 60], "FPS", "Frames per second of the exported file."),
        exportSeconds: n(DEFAULT_EXPORT.exportSeconds, 1, 60, 1, "Duration (s)", "Clip length. File footage loops if this exceeds its length."),
        exportBitrateMbps: n(DEFAULT_EXPORT.exportBitrateMbps, 1, 60, 1, "Bitrate (Mbps)", "Higher = better quality and larger files."),
        "Export .mp4": button(() => cb.current.onExport()),
      },
      COLLAPSED,
    ),
    Presets: folder(
      {
        "Save preset…": button(() => cb.current.onSavePreset()),
        "Load preset…": button(() => cb.current.onLoadPreset()),
      },
      COLLAPSED,
    ),
  }));

  const setRef = useRef(set);
  useEffect(() => {
    setRef.current = set;
  }, [set]);

  return { values: values as unknown as Params & ExportSettings, set };
}
