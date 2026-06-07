import type { EffectImpl } from "./index";
import { BAYER4, blockAvg, clampInt, luma601, to255 } from "./util";

/** Ordered (Bayer) dithering on a pixelSize cell grid, quantized to `levels`
 *  per channel. The signature blocky colored-dot look of the reference. */
export const ditherEffect: EffectImpl = {
  name: "dither",
  label: "dither",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    const size = Math.max(1, Math.round(p.pixelSize));
    const levels = Math.max(2, Math.round(p.levels));
    const lm1 = levels - 1;

    let cellRow = 0;
    for (let y0 = 0; y0 < h; y0 += size, cellRow++) {
      let cellCol = 0;
      for (let x0 = 0; x0 < w; x0 += size, cellCol++) {
        const [r, g, b] = blockAvg(data, w, h, x0, y0, size);
        const t = BAYER4[cellRow & 3][cellCol & 3] - 0.5;

        let R: number;
        let G: number;
        let B: number;
        if (p.mono) {
          const q = clampInt(Math.round(luma601(r, g, b) * lm1 + t), 0, lm1) / lm1;
          R = G = B = to255(q);
        } else {
          R = to255(clampInt(Math.round(r * lm1 + t), 0, lm1) / lm1);
          G = to255(clampInt(Math.round(g * lm1 + t), 0, lm1) / lm1);
          B = to255(clampInt(Math.round(b * lm1 + t), 0, lm1) / lm1);
        }

        const x1 = Math.min(w, x0 + size);
        const y1 = Math.min(h, y0 + size);
        for (let y = y0; y < y1; y++) {
          let o = (y * w + x0) * 4;
          for (let x = x0; x < x1; x++) {
            od[o] = R;
            od[o + 1] = G;
            od[o + 2] = B;
            od[o + 3] = 255;
            o += 4;
          }
        }
      }
    }
    dst.putImageData(out, 0, 0);
  },
};
