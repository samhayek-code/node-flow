/** Central parameter shape. Single source of truth shared by the Leva UI,
 *  the live preview loop, and the offline exporter. */

export type ConnectorStyle = "none" | "straight" | "curved";
export type EffectType =
  | "none"
  | "dither"
  | "halftone"
  | "ascii"
  | "pixelate"
  | "threshold"
  | "scanlines"
  | "edges"
  | "chromatic"
  | "solarize";
export type EffectScope = "blobs" | "full";
export type SourceKind = "generated" | "file" | "webcam";
export type BoxShape = "rect" | "circle" | "ellipse" | "diamond";

export interface Params {
  // Render
  renderWidth: number;
  renderHeight: number;
  background: string;

  // Motion
  motionGrid: number; // columns in the coarse motion grid
  motionThreshold: number; // 0..1 luminance-diff floor for an "active" cell
  trailDecay: number; // 0..1, higher = longer trails
  preBlur: number; // px blur applied before differencing

  // Blobs
  boxScale: number; // primary Size, 0..100 (100 ≈ short edge of the canvas)
  minBlobSize: number; // Min size as a % of the primary Size (0..100)
  maxBlobSize: number; // Max size as a % of the primary Size (0..100)
  maxBlobs: number;
  mergeDistance: number; // px; blobs closer than this merge
  boxPadding: number; // px added around each box
  boxShape: BoxShape; // rect, circle, ellipse, or diamond
  boxSmoothing: number; // 0..1 lerp toward new geometry (0 = instant, 0.9 = sluggish)
  boxColor: string;
  boxWidth: number;
  showBoxes: boolean;
  cornerTicks: boolean;

  // Connectors
  connectorStyle: ConnectorStyle;
  connectorMaxDist: number; // px max link length
  connectorColor: string;
  connectorWidth: number;
  connectorCurve: number; // bow amount for curved style

  // Effect
  effect: EffectType;
  effectScope: EffectScope;
  pixelSize: number; // cell size for cell-based effects
  levels: number; // quantization levels for dither/threshold
  mono: boolean; // collapse to luminance
  invert: boolean;
  effectColor: string; // foreground for mono/ascii/halftone

  // View
  raw: boolean; // bypass the pipeline and show the raw source (UI toggle, not a Leva control)
}

export interface ExportSettings {
  exportScale: number; // fraction of the render dimensions (0.25 / 0.5 / 1 / 2)
  exportFps: number;
  exportSeconds: number;
  exportBitrateMbps: number;
}

export const DEFAULT_EXPORT: ExportSettings = {
  exportScale: 1,
  exportFps: 30,
  exportSeconds: 6,
  exportBitrateMbps: 12,
};

export const DEFAULT_PARAMS: Params = {
  renderWidth: 960,
  renderHeight: 540,
  background: "#000000",

  motionGrid: 96,
  motionThreshold: 0.035,
  trailDecay: 0.82,
  preBlur: 1,

  boxScale: 40,
  minBlobSize: 30,
  maxBlobSize: 100,
  maxBlobs: 12,
  mergeDistance: 40,
  boxPadding: 10,
  boxShape: "rect",
  boxSmoothing: 0.35,
  boxColor: "#ffffff",
  boxWidth: 1.5,
  showBoxes: true,
  cornerTicks: false,

  connectorStyle: "curved",
  connectorMaxDist: 320,
  connectorColor: "#ffffff",
  connectorWidth: 1,
  connectorCurve: 0.25,

  effect: "dither",
  effectScope: "blobs",
  pixelSize: 4,
  levels: 3,
  mono: false,
  invert: false,
  effectColor: "#ffffff",

  raw: false,
};
