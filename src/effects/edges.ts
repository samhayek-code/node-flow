import type { EffectImpl } from "./index";
import { hexToRgb, luma601, to255 } from "./util";

/** Sobel edge detection rendered as a duotone (background → effect color).
 *  `levels` nudges edge sensitivity. */
export const edgesEffect: EffectImpl = {
  name: "edges",
  label: "edges",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      lum[j] = luma601(data[i], data[i + 1], data[i + 2]) / 255;
    }

    const out = dst.createImageData(w, h);
    const od = out.data;
    const [br, bg, bb] = hexToRgb(p.background);
    const [fr, fg, fb] = hexToRgb(p.effectColor);
    const gain = 1 + p.levels * 0.5;

    for (let y = 0; y < h; y++) {
      const ym = y > 0 ? y - 1 : 0;
      const yp = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : 0;
        const xp = x < w - 1 ? x + 1 : w - 1;
        const tl = lum[ym * w + xm];
        const tc = lum[ym * w + x];
        const tr = lum[ym * w + xp];
        const ml = lum[y * w + xm];
        const mr = lum[y * w + xp];
        const bl = lum[yp * w + xm];
        const bc = lum[yp * w + x];
        const brr = lum[yp * w + xp];
        const gx = -tl - 2 * ml - bl + tr + 2 * mr + brr;
        const gy = -tl - 2 * tc - tr + bl + 2 * bc + brr;
        const mag = Math.min(1, Math.hypot(gx, gy) * gain);
        const o = (y * w + x) * 4;
        od[o] = to255((br + (fr - br) * mag) / 255);
        od[o + 1] = to255((bg + (fg - bg) * mag) / 255);
        od[o + 2] = to255((bb + (fb - bb) * mag) / 255);
        od[o + 3] = 255;
      }
    }
    dst.putImageData(out, 0, 0);
  },
};
