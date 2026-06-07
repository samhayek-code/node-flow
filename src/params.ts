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
  background: string;

  // Motion
  motionGrid: number; // columns in the coarse motion grid
  motionThreshold: number; // 0..1 luminance-diff floor for an "active" cell
  trailDecay: number; // 0..1, higher = longer trails
  preBlur: number; // px blur applied before differencing

  // Blobs
  minBlobSize: number; // min active cells for a blob
  maxBlobSize: number; // max blob area as a fraction of the grid (1 = no cap)
  maxBlobs: number;
  mergeDistance: number; // px; blobs closer than this merge
  boxPadding: number; // px added around each box
  boxScale: number; // box size as a percent of the detected region (100 = detected)
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
}

export interface ExportSettings {
  exportWidth: number;
  exportFps: number;
  exportSeconds: number;
  exportBitrateMbps: number;
}

export const DEFAULT_EXPORT: ExportSettings = {
  exportWidth: 1280,
  exportFps: 30,
  exportSeconds: 6,
  exportBitrateMbps: 12,
};

export const DEFAULT_PARAMS: Params = {
  renderWidth: 960,
  background: "#0a0a0b",

  motionGrid: 96,
  motionThreshold: 0.035,
  trailDecay: 0.82,
  preBlur: 1,

  minBlobSize: 6,
  maxBlobSize: 1,
  maxBlobs: 12,
  mergeDistance: 40,
  boxPadding: 10,
  boxScale: 100,
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
};
