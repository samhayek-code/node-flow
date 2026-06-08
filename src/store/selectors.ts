/** Derivations over ProjectDoc. One source for dims and lock state, replacing
 *  the four duplicated vars (locked, lockedRef, lockedDims, lockedDimsRef). */

import type { ProjectDoc } from "./types";

export const selectLocked = (d: ProjectDoc) => d.source.kind === "file";

export const selectEffectiveDims = (d: ProjectDoc) =>
  d.source.kind === "file" && d.source.w && d.source.h
    ? { w: d.source.w, h: d.source.h }
    : {
        w: Math.max(16, Math.round(d.params.renderWidth)),
        h: Math.max(16, Math.round(d.params.renderHeight)),
      };
