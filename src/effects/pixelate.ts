import type { EffectImpl } from "./index";
import { blockAvg, to255 } from "./util";

/** Block-average pixelation — mosaic of solid cells, no quantization. */
export const pixelateEffect: EffectImpl = {
  name: "pixelate",
  label: "pixelate",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    const out = dst.createImageData(w, h);
    const od = out.data;
    const size = Math.max(1, Math.round(p.pixelSize));

    for (let y0 = 0; y0 < h; y0 += size) {
      for (let x0 = 0; x0 < w; x0 += size) {
        const [r, g, b] = blockAvg(data, w, h, x0, y0, size);
        const R = to255(r);
        const G = to255(g);
        const B = to255(b);
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
