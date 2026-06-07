import type { EffectType } from "../params";
import { ditherEffect } from "./dither";
import { halftoneEffect } from "./halftone";
import { asciiEffect } from "./ascii";
import { pixelateEffect } from "./pixelate";
import { thresholdEffect } from "./threshold";
import { scanlinesEffect } from "./scanlines";
import { edgesEffect } from "./edges";
import { chromaticEffect } from "./chromatic";
import { solarizeEffect } from "./solarize";

/**
 * An effect draws a processed version of `src` into `dst` (same dimensions).
 * `dst` is a full-frame offscreen canvas; compose masks it to blob regions
 * afterward when effectScope === "blobs". To add an effect: implement this
 * contract in a new file and register it in EFFECTS below.
 */
export interface EffectImpl {
  name: EffectType;
  label: string;
  render(dst: CanvasRenderingContext2D, src: ImageData, p: import("../params").Params): void;
}

const noneEffect: EffectImpl = {
  name: "none",
  label: "none",
  render(dst, src) {
    dst.putImageData(src, 0, 0);
  },
};

export const EFFECTS: Record<EffectType, EffectImpl> = {
  none: noneEffect,
  dither: ditherEffect,
  halftone: halftoneEffect,
  ascii: asciiEffect,
  pixelate: pixelateEffect,
  threshold: thresholdEffect,
  scanlines: scanlinesEffect,
  edges: edgesEffect,
  chromatic: chromaticEffect,
  solarize: solarizeEffect,
};

export const EFFECT_OPTIONS = Object.fromEntries(
  Object.values(EFFECTS).map((e) => [e.label, e.name]),
) as Record<string, EffectType>;
