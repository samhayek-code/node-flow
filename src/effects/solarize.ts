import type { EffectImpl } from "./index";

/** Solarization: invert channel values above a midpoint threshold. */
export const solarizeEffect: EffectImpl = {
  name: "solarize",
  label: "solarize",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    // levels (2..16) shifts the fold point across the tonal range.
    const thr = 255 * (0.35 + 0.4 * Math.min(1, (p.levels - 2) / 14));
    for (let i = 0; i < data.length; i += 4) {
      od[i] = data[i] > thr ? 255 - data[i] : data[i];
      od[i + 1] = data[i + 1] > thr ? 255 - data[i + 1] : data[i + 1];
      od[i + 2] = data[i + 2] > thr ? 255 - data[i + 2] : data[i + 2];
      od[i + 3] = 255;
    }
    dst.putImageData(out, 0, 0);
  },
};
