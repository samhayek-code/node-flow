/** Runtime audio-envelope bank consumed by `resolveParams` (see render/resolve.ts).
 *  Lives in refs (never the store): decoded per-band RMS envelopes keyed by
 *  mediaId. P1-A builds the real decode + fold; this file is the P0 stub so the
 *  param funnel type-checks and runs (zero-cost no-mods identity) before audio ships. */

import type { Modulator, ModSource } from "../store/types";

export interface SignalBank {
  /** Sampled modulation value in -1..1 for `modulator` at a point in the clip.
   *
   *  DETERMINISM CONTRACT: `clipSeconds` is CLIP TIME — seconds into the source
   *  clip — NEVER a frame index. Live `frameRef` free-runs and pauses during
   *  export; export `i` restarts at 0. Clip seconds is the one axis both the
   *  live and export paths share, so a modulator keyed on it makes preview ==
   *  export. Any caller passing a frame index breaks that guarantee. */
  sample(
    modulator: Modulator,
    sources: ModSource[],
    clipSeconds: number,
  ): number;
}

/** No-op bank: `sample` always returns 0, so `resolveParams` collapses to its
 *  base-params identity until P1-A wires real envelopes. */
class NullSignalBank implements SignalBank {
  sample(
    _modulator: Modulator,
    _sources: ModSource[],
    _clipSeconds: number,
  ): number {
    return 0;
  }
}

export function createSignalBank(): SignalBank {
  return new NullSignalBank();
}
