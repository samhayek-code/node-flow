import type { Blob, MotionField, PipelineState, Rect } from "./types";
import type { Params } from "../params";

interface RawBlob {
  rect: Rect;
  cx: number;
  cy: number;
  area: number;
  energy: number;
}

/** 8-connected flood fill over active cells → grouped raw blobs in pixel space. */
function findComponents(field: MotionField, threshold: number): RawBlob[] {
  const { cols, rows, cellW, cellH, trail } = field;
  const n = cols * rows;
  const labels = new Int32Array(n).fill(-1);
  const stack: number[] = [];
  const blobs: RawBlob[] = [];

  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || trail[start] <= threshold) continue;

    labels[start] = start;
    stack.length = 0;
    stack.push(start);

    let minC = cols;
    let minR = rows;
    let maxC = 0;
    let maxR = 0;
    let area = 0;
    let energy = 0;
    let wx = 0;
    let wy = 0;

    while (stack.length) {
      const idx = stack.pop()!;
      const c = idx % cols;
      const r = (idx - c) / cols;
      const e = trail[idx];

      area++;
      energy += e;
      wx += (c + 0.5) * e;
      wy += (r + 0.5) * e;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (labels[ni] === -1 && trail[ni] > threshold) {
            labels[ni] = start;
            stack.push(ni);
          }
        }
      }
    }

    const inv = energy > 0 ? 1 / energy : 0;
    blobs.push({
      rect: {
        x: minC * cellW,
        y: minR * cellH,
        w: (maxC - minC + 1) * cellW,
        h: (maxR - minR + 1) * cellH,
      },
      cx: wx * inv * cellW,
      cy: wy * inv * cellH,
      area,
      energy,
    });
  }
  return blobs;
}

function centerDist(a: RawBlob, b: RawBlob): number {
  return Math.hypot(a.cx - b.cx, a.cy - b.cy);
}

/** Greedily merge raw blobs whose centroids fall within `mergeDistance`. */
function mergeBlobs(blobs: RawBlob[], mergeDistance: number): RawBlob[] {
  if (mergeDistance <= 0) return blobs;
  const out = [...blobs];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (centerDist(out[i], out[j]) < mergeDistance) {
          out[i] = union(out[i], out[j]);
          out.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}

function union(a: RawBlob, b: RawBlob): RawBlob {
  const x = Math.min(a.rect.x, b.rect.x);
  const y = Math.min(a.rect.y, b.rect.y);
  const w = Math.max(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - x;
  const h = Math.max(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - y;
  const energy = a.energy + b.energy;
  return {
    rect: { x, y, w, h },
    cx: (a.cx * a.energy + b.cx * b.energy) / (energy || 1),
    cy: (a.cy * a.energy + b.cy * b.energy) / (energy || 1),
    area: a.area + b.area,
    energy,
  };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Detect blobs for the current frame and reconcile them with the previous
 * frame's tracked blobs (stable ids + geometry smoothing). Mutates state.tracked.
 */
export function detectBlobs(
  field: MotionField,
  renderW: number,
  renderH: number,
  state: PipelineState,
  p: Params,
): Blob[] {
  const maxCells = p.maxBlobSize * field.cols * field.rows;
  let raw = findComponents(field, p.motionThreshold);
  raw = raw.filter((b) => b.area >= p.minBlobSize && b.area <= maxCells);
  raw = mergeBlobs(raw, p.mergeDistance);
  raw.sort((a, b) => b.area - a.area);
  raw = raw.slice(0, Math.max(1, p.maxBlobs));

  const pad = p.boxPadding;
  const matchDist = Math.max(60, renderW * 0.18);
  const smooth = Math.min(0.95, Math.max(0, p.boxSmoothing));
  const FADE_IN = 0.16; // presence gained per frame while tracked
  const FADE_OUT = 0.1; // presence lost per frame once a blob disappears
  const prev = state.tracked;
  const used = new Set<number>();
  const result: Blob[] = [];

  for (const b of raw) {
    // Padded, clamped target box.
    const tx = Math.max(0, b.rect.x - pad);
    const ty = Math.max(0, b.rect.y - pad);
    const tw = Math.min(renderW - tx, b.rect.w + pad * 2);
    const th = Math.min(renderH - ty, b.rect.h + pad * 2);

    // Nearest unused previous blob within matchDist.
    let best = -1;
    let bestD = matchDist;
    for (let i = 0; i < prev.length; i++) {
      if (used.has(i)) continue;
      const d = Math.hypot(prev[i].cx - b.cx, prev[i].cy - b.cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }

    if (best >= 0) {
      const pb = prev[best];
      used.add(best);
      result.push({
        id: pb.id,
        x: lerp(tx, pb.x, smooth),
        y: lerp(ty, pb.y, smooth),
        w: lerp(tw, pb.w, smooth),
        h: lerp(th, pb.h, smooth),
        cx: lerp(b.cx, pb.cx, smooth),
        cy: lerp(b.cy, pb.cy, smooth),
        area: b.area,
        energy: b.energy,
        age: pb.age + 1,
        life: Math.min(1, pb.life + FADE_IN),
      });
    } else {
      result.push({
        id: state.nextId++,
        x: tx,
        y: ty,
        w: tw,
        h: th,
        cx: b.cx,
        cy: b.cy,
        area: b.area,
        energy: b.energy,
        age: 0,
        life: FADE_IN,
      });
    }
  }

  // Keep unmatched blobs around briefly, fading out, so boxes don't pop.
  for (let i = 0; i < prev.length; i++) {
    if (used.has(i)) continue;
    const life = prev[i].life - FADE_OUT;
    if (life > 0.03) result.push({ ...prev[i], life, age: prev[i].age + 1 });
  }

  state.tracked = result;
  return result;
}
