import type { MotionField, PipelineState } from "./types";
import type { Params } from "../params";

/** Reusable offscreen canvas for downsampling to the motion grid. */
let gridCanvas: HTMLCanvasElement | null = null;
let gridCtx: CanvasRenderingContext2D | null = null;

function ensureGrid(cols: number, rows: number): CanvasRenderingContext2D {
  if (!gridCanvas) {
    gridCanvas = document.createElement("canvas");
    gridCtx = gridCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (gridCanvas.width !== cols || gridCanvas.height !== rows) {
    gridCanvas.width = cols;
    gridCanvas.height = rows;
  }
  return gridCtx!;
}

/**
 * Downsample the work frame to a coarse grid, difference it against the
 * previous frame, and fold the result into a trail-decayed motion field.
 * Mutates `state` (prevLuma, trail).
 */
export function updateMotion(
  work: HTMLCanvasElement,
  renderW: number,
  renderH: number,
  state: PipelineState,
  p: Params,
): MotionField {
  const cols = Math.max(8, Math.round(p.motionGrid));
  const rows = Math.max(8, Math.round(cols * (renderH / renderW)));
  const n = cols * rows;

  const ctx = ensureGrid(cols, rows);
  ctx.filter = p.preBlur > 0 ? `blur(${p.preBlur}px)` : "none";
  ctx.clearRect(0, 0, cols, rows);
  ctx.drawImage(work, 0, 0, renderW, renderH, 0, 0, cols, rows);
  ctx.filter = "none";
  const pixels = ctx.getImageData(0, 0, cols, rows).data;

  // Reset persistent buffers if the grid size changed.
  if (state.gridCols !== cols || state.gridRows !== rows || !state.trail) {
    state.prevLuma = null;
    state.trail = new Float32Array(n);
    state.gridCols = cols;
    state.gridRows = rows;
    state.tracked = [];
  }

  const luma = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    // Rec. 601 luma, normalized 0..1.
    luma[i] = (pixels[o] * 0.299 + pixels[o + 1] * 0.587 + pixels[o + 2] * 0.114) / 255;
  }

  const trail = state.trail!;
  const prev = state.prevLuma;
  const decay = Math.min(0.999, Math.max(0, p.trailDecay));
  const threshold = Math.max(0, p.motionThreshold);

  for (let i = 0; i < n; i++) {
    const diff = prev ? Math.abs(luma[i] - prev[i]) : 0;
    const m = diff > threshold ? diff : 0;
    // Instantaneous motion sets a floor; old energy decays beneath it.
    trail[i] = Math.max(m, trail[i] * decay);
  }

  state.prevLuma = luma;

  return {
    cols,
    rows,
    cellW: renderW / cols,
    cellH: renderH / rows,
    trail,
  };
}
