/** Shared types for the motion/blob pipeline. */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tracked region of motion. Coordinates are in render-canvas pixels. */
export interface Blob {
  id: number;
  /** Smoothed bounding box in render pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Centroid in render pixels. */
  cx: number;
  cy: number;
  /** Number of active grid cells. */
  area: number;
  /** Summed motion energy across the blob's cells (0..1 per cell). */
  energy: number;
  /** Frames this blob has survived; used to fade boxes in/out. */
  age: number;
}

/** Per-cell, trail-decayed motion field on a coarse grid. */
export interface MotionField {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** length cols*rows, values 0..1 after trail decay. */
  trail: Float32Array;
}

export interface Connector {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  /** 0..1 strength used for opacity. */
  strength: number;
}

/** Persistent state threaded across frames. Reset before an export run. */
export interface PipelineState {
  /** Previous frame luminance grid (cols*rows), for frame differencing. */
  prevLuma: Float32Array | null;
  /** Trail accumulation grid (cols*rows). */
  trail: Float32Array | null;
  gridCols: number;
  gridRows: number;
  /** Blobs carried from the previous frame for temporal tracking. */
  tracked: Blob[];
  nextId: number;
}

export function createState(): PipelineState {
  return {
    prevLuma: null,
    trail: null,
    gridCols: 0,
    gridRows: 0,
    tracked: [],
    nextId: 1,
  };
}
