import type { EffectImpl } from "./index";
import { blockAvg, hexToRgb, luma601, to255 } from "./util";

/** Posterize luminance to `levels` and map it across a duotone ramp from the
 *  background color (dark) to the effect color (light). */
export const thresholdEffect: EffectImpl = {
  name: "threshold",
  label: "threshold",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    const size = Math.max(1, Math.round(p.pixelSize));
    const levels = Math.max(2, Math.round(p.levels));
    const lm1 = levels - 1;
    const [br, bg, bb] = hexToRgb(p.background);
    const [fr, fg, fb] = hexToRgb(p.effectColor);

    for (let y0 = 0; y0 < h; y0 += size) {
      for (let x0 = 0; x0 < w; x0 += size) {
        const [r, g, b] = blockAvg(data, w, h, x0, y0, size);
        const q = Math.round(luma601(r, g, b) * lm1) / lm1;
        const R = to255((br + (fr - br) * q) / 255);
        const G = to255((bg + (fg - bg) * q) / 255);
        const B = to255((bb + (fb - bb) * q) / 255);
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
