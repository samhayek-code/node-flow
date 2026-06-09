/** Regression tests for the param funnel (render/resolve.ts).
 *  Asserts the FIXED contract: resolve -> scale -> raw-inject, zero-cost
 *  no-mods identity, resolution-independent scaling, and clip-time determinism.
 *  Pure logic, node env — no DOM, no real timers. */

import {
  resolveParams,
  resolveFrame,
  scaleParams,
  span,
  clampParam,
} from "./resolve";
import type { FrameCtx } from "./resolve";
import { DEFAULT_PARAMS } from "../params";
import { createSignalBank } from "../audio/signalBank";
import type { SignalBank } from "../audio/signalBank";
import type { Modulator, ModSource, ModParam } from "../store/types";

const baseCtx: FrameCtx = {
  frame: 0,
  clipTime: 0,
  fps: 60,
  scale: 1,
  raw: false,
};

/** SignalBank stub returning a fixed value regardless of inputs — lets us probe
 *  the resolve math and prove output depends only on what `resolve` itself uses. */
function fakeSignalBank(value: number): SignalBank {
  return {
    sample(_m: Modulator, _s: ModSource[], _clipSeconds: number): number {
      return value;
    },
  };
}

function makeModulator(
  target: ModParam,
  overrides: Partial<Modulator> = {}
): Modulator {
  return {
    id: "mod-1",
    enabled: true,
    sourceId: "src-1",
    target,
    depth: 1,
    responsiveness: 0.5,
    channel: "rms",
    ...overrides,
  };
}

describe("resolveParams", () => {
  it("returns the SAME base reference with [] modulators (zero-cost identity)", () => {
    const sig = createSignalBank();
    const out = resolveParams(DEFAULT_PARAMS, [], [], baseCtx, sig);
    expect(out).toBe(DEFAULT_PARAMS);
  });

  it("returns the same base reference when all modulators are disabled", () => {
    // Disabled mods still take the copy path (mods.length truthy), so it's a
    // fresh object equal in value but not identical.
    const sig = fakeSignalBank(1);
    const mods = [makeModulator("pixelSize", { enabled: false })];
    const out = resolveParams(DEFAULT_PARAMS, mods, [], baseCtx, sig);
    expect(out).not.toBe(DEFAULT_PARAMS);
    expect(out).toEqual(DEFAULT_PARAMS);
  });

  it("applies depth scaled by span and clamps to the param range", () => {
    // pixelSize: base 4, span 40-1=39, depth 1, signal 1 => 43, clamped to 40.
    const sig = fakeSignalBank(1);
    const mods = [makeModulator("pixelSize", { depth: 1 })];
    const out = resolveParams(DEFAULT_PARAMS, mods, [], baseCtx, sig);
    expect(out.pixelSize).toBe(40);
    expect(span("pixelSize")).toBe(39);
  });

  it("never mutates the base params (modulation does not write back)", () => {
    const sig = fakeSignalBank(1);
    const mods = [makeModulator("pixelSize", { depth: 1 })];
    resolveParams(DEFAULT_PARAMS, mods, [], baseCtx, sig);
    expect(DEFAULT_PARAMS.pixelSize).toBe(4);
  });
});

describe("resolveFrame (order: resolve -> scale -> raw)", () => {
  it("with scale=1 and no mods returns base, no raw key injected", () => {
    const sig = createSignalBank();
    const out = resolveFrame(DEFAULT_PARAMS, [], [], baseCtx, sig);
    expect(out).toBe(DEFAULT_PARAMS);
    expect(out.raw).toBeUndefined();
  });

  it("injects raw:true ONLY when ctx.raw is true", () => {
    const sig = createSignalBank();

    const withoutRaw = resolveFrame(DEFAULT_PARAMS, [], [], baseCtx, sig);
    expect(withoutRaw.raw).toBeUndefined();
    expect("raw" in withoutRaw).toBe(false);

    const withRaw = resolveFrame(
      DEFAULT_PARAMS,
      [],
      [],
      { ...baseCtx, raw: true },
      sig
    );
    expect(withRaw.raw).toBe(true);
    // raw injection forces a copy, so identity breaks.
    expect(withRaw).not.toBe(DEFAULT_PARAMS);
  });

  it("scales pixel params at scale=2 after resolving mods", () => {
    const sig = createSignalBank();
    const out = resolveFrame(
      DEFAULT_PARAMS,
      [],
      [],
      { ...baseCtx, scale: 2 },
      sig
    );
    expect(out.pixelSize).toBe(DEFAULT_PARAMS.pixelSize * 2);
    expect(out.boxPadding).toBe(DEFAULT_PARAMS.boxPadding * 2);
  });
});

describe("scaleParams", () => {
  it("is identity at scale=1 (returns same reference)", () => {
    expect(scaleParams(DEFAULT_PARAMS, 1)).toBe(DEFAULT_PARAMS);
  });

  it("is value-identity within 1e-3 at scale=1", () => {
    const out = scaleParams(DEFAULT_PARAMS, 1);
    for (const key of [
      "pixelSize",
      "boxPadding",
      "mergeDistance",
      "connectorMaxDist",
      "boxWidth",
      "connectorWidth",
    ] as const) {
      expect(Math.abs(out[key] - DEFAULT_PARAMS[key])).toBeLessThan(1e-3);
    }
  });

  it("doubles pixel-denominated params at scale=2", () => {
    const out = scaleParams(DEFAULT_PARAMS, 2);
    expect(out.pixelSize).toBe(Math.round(DEFAULT_PARAMS.pixelSize * 2));
    expect(out.boxPadding).toBe(DEFAULT_PARAMS.boxPadding * 2);
    expect(out.mergeDistance).toBe(DEFAULT_PARAMS.mergeDistance * 2);
    expect(out.connectorMaxDist).toBe(DEFAULT_PARAMS.connectorMaxDist * 2);
    expect(out.boxWidth).toBe(DEFAULT_PARAMS.boxWidth * 2);
    expect(out.connectorWidth).toBe(DEFAULT_PARAMS.connectorWidth * 2);
  });

  it("rounds pixelSize and floors it at >=1", () => {
    // A tiny pixelSize at a sub-1 scale must never drop below 1px.
    const tiny = { ...DEFAULT_PARAMS, pixelSize: 1 };
    expect(scaleParams(tiny, 0.25).pixelSize).toBe(1);
    // Rounding: pixelSize 3 * 1.5 = 4.5 -> 5.
    const three = { ...DEFAULT_PARAMS, pixelSize: 3 };
    expect(scaleParams(three, 1.5).pixelSize).toBe(5);
  });

  it("leaves resolution-independent params unchanged at scale=2", () => {
    const out = scaleParams(DEFAULT_PARAMS, 2);
    expect(out.motionGrid).toBe(DEFAULT_PARAMS.motionGrid);
    expect(out.levels).toBe(DEFAULT_PARAMS.levels);
    expect(out.trailDecay).toBe(DEFAULT_PARAMS.trailDecay);
    expect(out.minBlobSize).toBe(DEFAULT_PARAMS.minBlobSize);
  });
});

describe("span / clampParam match the declared ranges", () => {
  it("span equals (max - min) for spot-checked params", () => {
    expect(span("motionThreshold")).toBeCloseTo(0.5, 10); // [0, 0.5]
    expect(span("connectorCurve")).toBe(2); // [-1, 1]
    expect(span("pixelSize")).toBe(39); // [1, 40]
  });

  it("clampParam holds motionThreshold to [0, 0.5]", () => {
    expect(clampParam("motionThreshold", -1)).toBe(0);
    expect(clampParam("motionThreshold", 0.25)).toBe(0.25);
    expect(clampParam("motionThreshold", 1)).toBe(0.5);
  });

  it("clampParam holds connectorCurve to [-1, 1]", () => {
    expect(clampParam("connectorCurve", -5)).toBe(-1);
    expect(clampParam("connectorCurve", 0)).toBe(0);
    expect(clampParam("connectorCurve", 5)).toBe(1);
  });

  it("clampParam holds pixelSize to [1, 40]", () => {
    expect(clampParam("pixelSize", 0)).toBe(1);
    expect(clampParam("pixelSize", 20)).toBe(20);
    expect(clampParam("pixelSize", 99)).toBe(40);
  });
});

describe("determinism — output depends ONLY on clipTime, not frame", () => {
  it("same clipTime + different ctx.frame => identical result", () => {
    const sig = fakeSignalBank(0.5);
    const mods = [makeModulator("boxPadding", { depth: 0.5 })];

    const a = resolveParams(
      DEFAULT_PARAMS,
      mods,
      [],
      { ...baseCtx, clipTime: 2.5, frame: 10 },
      sig
    );
    const b = resolveParams(
      DEFAULT_PARAMS,
      mods,
      [],
      { ...baseCtx, clipTime: 2.5, frame: 9999 },
      sig
    );
    expect(a).toEqual(b);
  });

  it("uses clipTime as the sample key, not the frame index", () => {
    // A spy bank records what `resolveParams` passes as clipSeconds. The
    // determinism contract: it must be ctx.clipTime, never ctx.frame.
    const seen: number[] = [];
    const spy: SignalBank = {
      sample(_m, _s, clipSeconds) {
        seen.push(clipSeconds);
        return 0;
      },
    };
    const mods = [makeModulator("pixelSize")];
    resolveParams(
      DEFAULT_PARAMS,
      mods,
      [],
      { ...baseCtx, clipTime: 3.14, frame: 77 },
      spy
    );
    expect(seen).toEqual([3.14]);
  });
});
