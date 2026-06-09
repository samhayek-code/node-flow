/** Capability detection — gate features and pick fallbacks.
 *  Each check is a function (not an eager const) so it re-evaluates on call
 *  and stays safe under SSR / non-window contexts. */

const hasWindow = typeof window !== "undefined";

export const supports = {
  fsAccess: () => hasWindow && "showSaveFilePicker" in window,
  webCodecs: () => typeof VideoEncoder !== "undefined",
  webGPU: () => typeof navigator !== "undefined" && "gpu" in navigator,
  offscreenCanvas: () => typeof OffscreenCanvas !== "undefined",
  webAudio: () =>
    hasWindow && ("AudioContext" in window || "webkitAudioContext" in window),
};
