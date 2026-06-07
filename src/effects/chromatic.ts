import type { EffectImpl } from "./index";

/** Chromatic aberration: split the R and B channels horizontally by `pixelSize`. */
export const chromaticEffect: EffectImpl = {
  name: "chromatic",
  label: "chromatic",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    const shift = Math.max(1, Math.round(p.pixelSize));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 4;
        const xr = Math.min(w - 1, x + shift);
        const xb = Math.max(0, x - shift);
        od[o] = data[(row + xr) * 4]; // red pulled from the right
        od[o + 1] = data[o + 1]; // green stays
        od[o + 2] = data[(row + xb) * 4 + 2]; // blue pulled from the left
        od[o + 3] = 255;
      }
    }
    dst.putImageData(out, 0, 0);
  },
};
