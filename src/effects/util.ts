/** Shared helpers for cell-based effects. */

/** Average RGB of a `size`-square block, returned as 0..1 channels. */
export function blockAvg(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  x0: number,
  y0: number,
  size: number,
): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const x1 = Math.min(w, x0 + size);
  const y1 = Math.min(h, y0 + size);
  for (let y = y0; y < y1; y++) {
    let o = (y * w + x0) * 4;
    for (let x = x0; x < x1; x++) {
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      count++;
      o += 4;
    }
  }
  const inv = count > 0 ? 1 / (count * 255) : 0;
  return [r * inv, g * inv, b * inv];
}

export const luma601 = (r: number, g: number, b: number) => r * 0.299 + g * 0.587 + b * 0.114;

export const to255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export const clampInt = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const int = parseInt(n || "000000", 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

/** 4x4 Bayer matrix, normalized to (0..1). Used for ordered dithering. */
export const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));
