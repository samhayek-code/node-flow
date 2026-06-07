import type { Blob, Connector } from "./types";
import type { Params } from "../params";

/** Link every pair of blob centroids within `connectorMaxDist`. Rendering
 *  (straight vs curved) happens in compose; this only decides what connects. */
export function buildConnectors(blobs: Blob[], p: Params): Connector[] {
  if (p.connectorStyle === "none" || blobs.length < 2) return [];
  const maxD = p.connectorMaxDist;
  const out: Connector[] = [];
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i];
      const b = blobs[j];
      const d = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (d > maxD) continue;
      out.push({
        ax: a.cx,
        ay: a.cy,
        bx: b.cx,
        by: b.cy,
        strength: 1 - d / maxD,
      });
    }
  }
  return out;
}
