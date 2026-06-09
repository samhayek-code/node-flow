import { computeEnvelope, sampleEnvelope, ENV_RATE } from "./signalBank";

describe("computeEnvelope", () => {
  it("tracks loudness: a loud first half reads higher than a quiet second half", () => {
    const sr = 1200; // hop = floor(1200/120) = 10
    const n = 1200; // 1s
    const ch = new Float32Array(n);
    for (let i = 0; i < n; i++) ch[i] = i < n / 2 ? 0.8 : 0.02;
    const env = computeEnvelope([ch], sr);

    expect(env.length).toBe(Math.floor(n / Math.floor(sr / ENV_RATE)));
    // peak-normalized: the loud region is 1.0, quiet ~0.025
    expect(env[0]).toBeCloseTo(1, 5);
    expect(env[env.length - 1]).toBeCloseTo(0.025, 3);
    const max = env.reduce((m, v) => Math.max(m, v), 0);
    expect(max).toBeCloseTo(1, 5);
  });

  it("mono-mixes multiple channels", () => {
    const sr = 1200;
    const n = 120;
    const a = new Float32Array(n).fill(1);
    const b = new Float32Array(n).fill(0); // mix = 0.5 everywhere
    const env = computeEnvelope([a, b], sr);
    // constant mix → flat envelope, peak-normalized to 1 throughout
    for (const v of env) expect(v).toBeCloseTo(1, 5);
  });

  it("handles empty input without throwing", () => {
    expect(computeEnvelope([], 44100).length).toBeGreaterThanOrEqual(1);
  });
});

describe("sampleEnvelope", () => {
  // env pulses: index%10 in [0,1] => 1, else 0; rate 100 => 1.0s duration.
  const rate = 100;
  const env = new Float32Array(100);
  for (let i = 0; i < env.length; i++) env[i] = i % 10 < 2 ? 1 : 0;
  const dur = env.length / rate; // 1.0s

  it("reads high on a pulse and low in a gap (snappy responsiveness)", () => {
    const onPulse = sampleEnvelope(env, rate, dur, 0.005, 1); // index 0 → pulse
    const inGap = sampleEnvelope(env, rate, dur, 0.05, 1); // index 5 → gap
    expect(onPulse).toBeGreaterThan(0.8);
    expect(inGap).toBeLessThan(0.2);
    expect(onPulse).toBeGreaterThan(inGap + 0.5);
  });

  it("is deterministic: same inputs → same output regardless of call order", () => {
    const a = sampleEnvelope(env, rate, dur, 0.37, 0.5);
    sampleEnvelope(env, rate, dur, 0.9, 0.5); // intervening call
    const b = sampleEnvelope(env, rate, dur, 0.37, 0.5);
    expect(b).toBe(a);
  });

  it("loops on duration (export beyond clip length wraps)", () => {
    const t = sampleEnvelope(env, rate, dur, 0.205, 1);
    const wrapped = sampleEnvelope(env, rate, dur, 0.205 + dur, 1);
    const wrapped2 = sampleEnvelope(env, rate, dur, 0.205 + dur * 3, 1);
    expect(wrapped).toBe(t);
    expect(wrapped2).toBe(t);
  });

  it("low responsiveness smooths the peak below high responsiveness", () => {
    // Sample on a pulse that has gaps behind it: the wide (low-responsiveness)
    // trailing window averages those gaps in and reads lower than the snappy one.
    const snappy = sampleEnvelope(env, rate, dur, 0.115, 1); // tiny window, fully on the pulse
    const smooth = sampleEnvelope(env, rate, dur, 0.115, 0); // 0.4s window dilutes with gaps
    expect(snappy).toBeGreaterThan(smooth);
  });

  it("returns 0 for an empty envelope or before the first sample", () => {
    expect(sampleEnvelope(new Float32Array(0), rate, dur, 0.1, 1)).toBe(0);
    expect(sampleEnvelope(env, rate, dur, -5, 1)).toBeGreaterThanOrEqual(0);
  });
});
