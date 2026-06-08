/** The single param funnel. Both render entry points (live loop + exporter) call
 *  `resolveFrame`, so every backend receives identical, finished `Params`.
 *  Order is FIXED: resolve modulators -> scale pixel params -> inject raw. */

import type { Params } from "../params";
import type { RenderParams } from "./renderer";
import type { Modulator, ModSource, ModParam } from "../store/types";
import type { SignalBank } from "../audio/signalBank";

export interface FrameCtx {
  frame: number; // monotonic render-space index (for source.draw / generated source)
  clipTime: number; // SECONDS into the source clip — the determinism key (NOT frameRef)
  fps: number; // resolution fps (live: 60; export: settings.exportFps)
  scale: number; // 1 in preview; export multiplies pixel params by this
  raw: boolean; // injected here, last — pulled out of Params
}

/** Per-param [min, max] ranges, lifted verbatim from the Leva control defs in
 *  controls.ts. Used to size modulator depth (span) and clamp the result. */
const RANGES: Record<ModParam, [number, number]> = {
  motionThreshold: [0, 0.5], // controls.ts:118
  trailDecay: [0, 0.99], // controls.ts:119
  boxScale: [0, 100], // controls.ts:126
  minBlobSize: [0, 100], // controls.ts:127
  maxBlobSize: [0, 100], // controls.ts:128
  mergeDistance: [0, 320], // controls.ts:130
  boxPadding: [0, 60], // controls.ts:131
  boxSmoothing: [0, 0.95], // controls.ts:133
  boxWidth: [0.5, 6], // controls.ts:137
  pixelSize: [1, 40], // controls.ts:159
  levels: [2, 16], // controls.ts:160
  connectorMaxDist: [20, 1200], // controls.ts:144
  connectorWidth: [0.5, 6], // controls.ts:147
  connectorCurve: [-1, 1], // controls.ts:145
};

/** Full travel of a modulatable param's range — scales a -1..1 signal × depth
 *  into param units. */
export function span(target: ModParam): number {
  const [lo, hi] = RANGES[target];
  return hi - lo;
}

/** Clamp a resolved value to its param's declared range. */
export function clampParam(target: ModParam, v: number): number {
  const [lo, hi] = RANGES[target];
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Scale pixel-denominated params by a multiplicative factor (1 in preview, the
 * export scale otherwise) so the rendered look is preserved across resolutions.
 * Cell-count and unitless params (motionGrid, minBlobSize, levels, decay…) are
 * resolution-independent already. Ported from encoder.ts:40-52, converted from
 * the `scaleParams(params, exportWidth)` form to a scale-factor form.
 */
export function scaleParams(params: Params, scale: number): Params {
  if (Math.abs(scale - 1) < 1e-3) return params;
  return {
    ...params,
    pixelSize: Math.max(1, Math.round(params.pixelSize * scale)),
    boxPadding: params.boxPadding * scale,
    mergeDistance: params.mergeDistance * scale,
    connectorMaxDist: params.connectorMaxDist * scale,
    boxWidth: params.boxWidth * scale,
    connectorWidth: params.connectorWidth * scale,
  };
}

/** EFFECTIVE value = base + Σ enabled modulators, sampled deterministically at
 *  clipTime. Pure. Never writes back to the store (modulation does NOT mutate
 *  base). Zero-cost identity when there are no modulators. */
export function resolveParams(
  base: Params,
  mods: Modulator[],
  sources: ModSource[],
  ctx: FrameCtx,
  sig: SignalBank,
): Params {
  if (!mods.length) return base;
  const out: Params = { ...base };
  for (const m of mods) {
    if (!m.enabled) continue;
    const s = sig.sample(m, sources, ctx.clipTime); // -1..1, O(1) array lookup
    out[m.target] = clampParam(
      m.target,
      (base[m.target] as number) + s * m.depth * span(m.target),
    ) as never;
  }
  return out;
}

/** The contract both render entry points call. Order is FIXED:
 *  resolve -> scale -> raw-inject. */
export function resolveFrame(
  base: Params,
  mods: Modulator[],
  sources: ModSource[],
  ctx: FrameCtx,
  sig: SignalBank,
): RenderParams {
  const modulated = resolveParams(base, mods, sources, ctx, sig);
  const scaled = ctx.scale === 1 ? modulated : scaleParams(modulated, ctx.scale);
  return ctx.raw ? { ...scaled, raw: true } : scaled;
}
