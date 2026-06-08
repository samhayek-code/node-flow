/** Pure macro derivation. Imported by the store AND project-load so children
 *  recompute identically. Lerp tables lifted verbatim from controls.ts:64-111. */

import type { Params } from "../params";
import type { MacroState } from "./types";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const r2 = (x: number) => Number(x.toFixed(2));

/** Maps a macro position (0..1) to the base-param children it drives. */
export function deriveMacro(key: keyof MacroState, v: number): Partial<Params> {
  switch (key) {
    case "responsiveness":
      return {
        motionThreshold: Number(lerp(0.14, 0.02, v).toFixed(3)),
        trailDecay: r2(lerp(0.92, 0.4, v)),
        boxSmoothing: r2(lerp(0.75, 0.05, v)),
      };
    case "density":
      return {
        motionGrid: Math.round(lerp(48, 200, v)),
        maxBlobs: Math.round(lerp(4, 30, v)),
        connectorMaxDist: Math.round(lerp(120, 600, v)),
      };
    case "boldness":
      return {
        pixelSize: Math.round(lerp(2, 14, v)),
        boxWidth: Number(lerp(0.5, 4, v).toFixed(1)),
        connectorWidth: Number(lerp(0.5, 3.5, v).toFixed(1)),
      };
    case "size":
      return { boxScale: Math.round(v * 100) };
  }
}
