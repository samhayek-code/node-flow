import type { Params, ExportSettings, SourceKind } from "../params";

/* ---------- modulation (P1-A substrate; v1 ships "audio" only) ---------- */
export type ModSourceKind = "audio" | "lfo" | "keyframe";

export interface ModSource {
  id: string;
  kind: ModSourceKind;
  audio?: { mediaId: string; fileName: string; duration: number };
  // lfo?: { shape: "sine" | "saw" | "tri"; hz: number; phase: number };  // later
}

export type ModParam = keyof ModulatableParams;

export interface Modulator {
  id: string;
  enabled: boolean;
  sourceId: string; // -> ModSource.id
  target: ModParam; // numeric params only, type-enforced
  depth: number; // -1..1, the per-route "Depth" knob
  responsiveness: number; // 0..1, signal smoothing/attack
  channel?: "rms" | "low" | "mid" | "high"; // audio band; default "rms"
}

/** Modulation is valid only on numeric params with a known range. */
export type ModulatableParams = Pick<
  Params,
  | "motionThreshold"
  | "trailDecay"
  | "boxScale"
  | "minBlobSize"
  | "maxBlobSize"
  | "mergeDistance"
  | "boxPadding"
  | "boxSmoothing"
  | "boxWidth"
  | "pixelSize"
  | "levels"
  | "connectorMaxDist"
  | "connectorWidth"
  | "connectorCurve"
>;

/* ---------- macros: promoted to first-class persisted state ---------- */
export interface MacroState {
  responsiveness: number; // 0..1
  density: number;
  boldness: number;
  size: number;
}

/* ---------- source metadata (serializable; live FrameSource stays a ref) ---------- */
export interface SourceMeta {
  kind: SourceKind; // "generated" | "file" | "webcam"
  fileName?: string; // file only — re-link target
  w?: number;
  h?: number;
  duration?: number | null;
}

/* ---------- the persisted, undoable document ---------- */
export interface ProjectDoc {
  schemaVersion: 1;
  params: Params; // base params, raw removed (Phase 1)
  macros: MacroState;
  modSources: ModSource[];
  modulators: Modulator[];
  source: SourceMeta;
  export: ExportSettings;
}

/* ---------- transient view (not persisted in .nodeflow, not undoable) ---------- */
export interface ViewState {
  raw: boolean; // pulled OUT of Params
  zoom: number;
  pan: { x: number; y: number };
}

/* ---------- transient UI chrome (never persisted, never undoable) ---------- */
export interface UiState {
  dragging: boolean;
  loading: boolean;
  toast: string | null;
  exportProgress: number | null;
  showExport: boolean;
  needsRelink: boolean; // file-source project loaded, media not yet re-linked
}
