/** Runtime audio engine consumed by `resolveParams` (see render/resolve.ts).
 *  Lives in refs (never the store). A loaded music file is decoded once into a
 *  peak-normalized RMS energy envelope; `sample()` reads that envelope at clip
 *  time, so preview and export are deterministic (the envelope is precomputed,
 *  not a live FFT). The engine also plays the track and exposes a position clock
 *  so the live preview can drive clip time from playback — visuals pulse with
 *  what you hear, while export samples the same envelope at i/fps. */

import type { Modulator, ModSource } from "../store/types";

export interface SignalBank {
  /** Sampled modulation value in 0..1 for `modulator` at a point in the clip.
   *
   *  DETERMINISM CONTRACT: `clipSeconds` is CLIP TIME — seconds into the source
   *  clip — NEVER a frame index. Live `frameRef` free-runs and pauses during
   *  export; export `i` restarts at 0. Clip seconds is the one axis both the
   *  live and export paths share, so a modulator keyed on it makes preview ==
   *  export. Any caller passing a frame index breaks that guarantee. */
  sample(modulator: Modulator, sources: ModSource[], clipSeconds: number): number;
}

/** The full runtime audio engine (superset of SignalBank). The render funnel +
 *  exporter only need `sample`; the App drives load/playback through the rest. */
export interface AudioEngine extends SignalBank {
  /** Decode + analyze a music file into an envelope keyed by `mediaId`, make it
   *  the active track, and (optionally) start playback. Returns the duration. */
  loadTrack(mediaId: string, file: File, autoplay?: boolean): Promise<{ duration: number }>;
  unload(mediaId: string): void;
  has(mediaId: string): boolean;
  play(): void;
  stop(): void;
  setPlaying(playing: boolean): void;
  readonly playing: boolean;
  /** Active-track playback position in seconds (loops), or null if nothing is
   *  playing — the render loop uses this as clip time when present. */
  position(): number | null;
  duration(): number | null;
  dispose(): void;
}

export const ENV_RATE = 120; // envelope samples per second (~8.3ms hop)
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Mono-mix + windowed RMS into a peak-normalized 0..1 envelope at ENV_RATE.
 *  Pure (no Web Audio) so it is unit-testable with synthetic channel data. */
export function computeEnvelope(channels: Float32Array[], sampleRate: number): Float32Array {
  const numCh = channels.length;
  const len = numCh > 0 ? channels[0].length : 0;
  const hop = Math.max(1, Math.floor(sampleRate / ENV_RATE));
  const hops = Math.max(1, Math.floor(len / hop));
  const env = new Float32Array(hops);
  let peak = 0;
  for (let h = 0; h < hops; h++) {
    const start = h * hop;
    const end = Math.min(len, start + hop);
    let sumSq = 0;
    for (let i = start; i < end; i++) {
      let s = 0;
      for (let c = 0; c < numCh; c++) s += channels[c][i];
      s /= numCh;
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / Math.max(1, end - start));
    env[h] = rms;
    if (rms > peak) peak = rms;
  }
  if (peak > 0) for (let h = 0; h < hops; h++) env[h] /= peak;
  return env;
}

/** Deterministic trailing-window read of a precomputed envelope. Pure: depends
 *  only on (env, rate, duration, clipSeconds, responsiveness) — never call order
 *  or wall clock — which is what makes preview == export. Loops on duration. */
export function sampleEnvelope(
  env: Float32Array,
  rate: number,
  duration: number,
  clipSeconds: number,
  responsiveness: number,
): number {
  if (env.length === 0) return 0;
  const t = duration > 0 ? ((clipSeconds % duration) + duration) % duration : Math.max(0, clipSeconds);
  // High responsiveness = snappy (small window); low = smooth (large window).
  const winSec = lerp(0.4, 0.015, clamp01(responsiveness));
  const end = Math.min(env.length - 1, Math.floor(t * rate));
  if (end < 0) return 0;
  const start = Math.max(0, Math.floor((t - winSec) * rate));
  let sum = 0;
  let n = 0;
  for (let i = start; i <= end; i++) {
    sum += env[i];
    n++;
  }
  return n > 0 ? clamp01(sum / n) : 0;
}

interface EnvelopeEntry {
  env: Float32Array; // peak-normalized RMS, 0..1, at ENV_RATE
  rate: number;
  duration: number;
  buffer: AudioBuffer;
}

type AudioCtor = typeof AudioContext;

function getAudioContext(): AudioContext | null {
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}

class WebAudioEngine implements AudioEngine {
  private ctx: AudioContext | null = null;
  private envelopes = new Map<string, EnvelopeEntry>();
  private activeId: string | null = null;

  private node: AudioBufferSourceNode | null = null;
  private startedAt = 0; // ctx time when the active node started
  private _playing = false;

  get playing(): boolean {
    return this._playing;
  }

  has(mediaId: string): boolean {
    return this.envelopes.has(mediaId);
  }

  duration(): number | null {
    const e = this.activeId ? this.envelopes.get(this.activeId) : null;
    return e ? e.duration : null;
  }

  async loadTrack(mediaId: string, file: File, autoplay = true): Promise<{ duration: number }> {
    const ctx = (this.ctx ??= getAudioContext());
    if (!ctx) throw new Error("Web Audio not available");
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);

    const bytes = await file.arrayBuffer();
    // decodeAudioData with the callback signature for broad support.
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(bytes, resolve, reject);
    });

    const channels: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    this.envelopes.set(mediaId, {
      env: computeEnvelope(channels, buffer.sampleRate),
      rate: ENV_RATE,
      duration: buffer.duration,
      buffer,
    });
    this.activeId = mediaId;
    this.stop();
    if (autoplay) this.play();
    return { duration: buffer.duration };
  }

  unload(mediaId: string): void {
    if (this.activeId === mediaId) this.stop();
    this.envelopes.delete(mediaId);
    if (this.activeId === mediaId) this.activeId = null;
  }

  play(): void {
    const ctx = this.ctx;
    const e = this.activeId ? this.envelopes.get(this.activeId) : null;
    if (!ctx || !e) return;
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    this.stop();
    const node = ctx.createBufferSource();
    node.buffer = e.buffer;
    node.loop = true;
    node.connect(ctx.destination);
    node.start();
    this.node = node;
    this.startedAt = ctx.currentTime;
    this._playing = true;
  }

  stop(): void {
    if (this.node) {
      try {
        this.node.stop();
      } catch {
        /* already stopped */
      }
      this.node.disconnect();
      this.node = null;
    }
    this._playing = false;
  }

  setPlaying(playing: boolean): void {
    if (playing) this.play();
    else this.stop();
  }

  position(): number | null {
    if (!this._playing || !this.ctx) return null;
    const e = this.activeId ? this.envelopes.get(this.activeId) : null;
    if (!e || e.duration <= 0) return null;
    return (this.ctx.currentTime - this.startedAt) % e.duration;
  }

  sample(modulator: Modulator, sources: ModSource[], clipSeconds: number): number {
    const src = sources.find((s) => s.id === modulator.sourceId);
    const mediaId = src?.audio?.mediaId;
    if (!mediaId) return 0;
    const e = this.envelopes.get(mediaId);
    if (!e) return 0;
    return sampleEnvelope(e.env, e.rate, e.duration, clipSeconds, modulator.responsiveness);
  }

  dispose(): void {
    this.stop();
    this.envelopes.clear();
    this.activeId = null;
    if (this.ctx) {
      void this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}

export function createSignalBank(): AudioEngine {
  return new WebAudioEngine();
}
