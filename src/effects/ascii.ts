import type { EffectImpl } from "./index";
import { blockAvg, luma601, to255 } from "./util";

const RAMP = " .:-=+*#%@";

/** ASCII art: map each cell's brightness to a glyph in the density ramp. */
export const asciiEffect: EffectImpl = {
  name: "ascii",
  label: "ascii",
  render(dst, src, p) {
    const { width: w, height: h, data } = src;
    dst.fillStyle = p.background;
    dst.fillRect(0, 0, w, h);

    const size = Math.max(4, Math.round(p.pixelSize));
    dst.textBaseline = "top";
    dst.font = `${size}px ui-monospace, "SF Mono", Menlo, monospace`;

    for (let y0 = 0; y0 < h; y0 += size) {
      for (let x0 = 0; x0 < w; x0 += size) {
        const [r, g, b] = blockAvg(data, w, h, x0, y0, size);
        const l = luma601(r, g, b);
        const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(l * RAMP.length))];
        if (ch === " ") continue;
        dst.fillStyle = p.mono ? p.effectColor : `rgb(${to255(r)},${to255(g)},${to255(b)})`;
        dst.fillText(ch, x0, y0);
      }
    }
  },
};
