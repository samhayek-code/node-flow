import type { EffectImpl } from "./index";
import { blockAvg, luma601, to255 } from "./util";

/** Halftone: one dot per cell, radius scaled by cell brightness. */
export const halftoneEffect: EffectImpl = {
  name: "halftone",
  label: "halftone",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    dst.fillStyle = p.background;
    dst.fillRect(0, 0, w, h);

    const size = Math.max(3, Math.round(p.pixelSize));
    const maxR = size * 0.62;

    for (let y0 = 0; y0 < h; y0 += size) {
      for (let x0 = 0; x0 < w; x0 += size) {
        const [r, g, b] = blockAvg(data, w, h, x0, y0, size);
        const l = luma601(r, g, b);
        const radius = maxR * Math.sqrt(l); // dot area ∝ brightness
        if (radius < 0.35) continue;
        dst.fillStyle = p.mono ? p.effectColor : `rgb(${to255(r)},${to255(g)},${to255(b)})`;
        dst.beginPath();
        dst.arc(x0 + size / 2, y0 + size / 2, radius, 0, Math.PI * 2);
        dst.fill();
      }
    }
  },
};
