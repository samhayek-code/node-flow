import type { EffectImpl } from "./index";

/** CRT-style horizontal scanlines. `pixelSize` sets line spacing. */
export const scanlinesEffect: EffectImpl = {
  name: "scanlines",
  label: "scanlines",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    const gap = Math.max(2, Math.round(p.pixelSize));
    const half = Math.max(1, Math.floor(gap / 2));
    for (let y = 0; y < h; y++) {
      const dark = y % gap < half ? 1 : 0.4;
      let o = y * w * 4;
      for (let x = 0; x < w; x++) {
        od[o] = data[o] * dark;
        od[o + 1] = data[o + 1] * dark;
        od[o + 2] = data[o + 2] * dark;
        od[o + 3] = 255;
        o += 4;
      }
    }
    dst.putImageData(out, 0, 0);
  },
};
