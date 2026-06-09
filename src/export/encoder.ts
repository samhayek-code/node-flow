import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { Canvas2DRenderer } from "../render/compose";
import { resolveFrame } from "../render/resolve";
import { createState } from "../pipeline/types";
import { createSignalBank } from "../audio/signalBank";
import type { FrameSource } from "../pipeline/source";
import type { Params, ExportSettings } from "../params";
import type { Modulator, ModSource } from "../store/types";
import type { SignalBank } from "../audio/signalBank";
import type { WebGPURenderer } from "../render/webgpu/renderer";

export interface ExportOptions {
  source: FrameSource;
  /** Base params; renderWidth/renderHeight are the export source (scale-1) dims. */
  params: Params;
  settings: ExportSettings;
  /** Modulation routes (P1-A). Empty/omitted = the zero-cost identity path. */
  modulators?: Modulator[];
  modSources?: ModSource[];
  signalBank?: SignalBank;
  /** GPU effect accelerator (P1-B). Effects match Canvas2D exactly, so exports
   *  stay deterministic; omitted = CPU effects. */
  gpu?: WebGPURenderer | null;
  onProgress: (value: number) => void;
}

// Tried in order; first config the browser accepts wins. Covers up to 4K.
const CODEC_CANDIDATES = ["avc1.640034", "avc1.640033", "avc1.640028", "avc1.4d0028", "avc1.42001f"];

async function pickCodec(width: number, height: number, bitrate: number, framerate: number) {
  for (const codec of CODEC_CANDIDATES) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate,
        framerate,
      });
      if (supported) return codec;
    } catch {
      /* try next */
    }
  }
  throw new Error("No supported H.264 encoder configuration");
}

/** Render the configured clip and return the finished mp4 bytes (no download). */
export async function renderToMp4(opts: ExportOptions): Promise<ArrayBuffer> {
  const { source, params, settings, onProgress } = opts;
  const modulators = opts.modulators ?? [];
  const modSources = opts.modSources ?? [];
  const sig = opts.signalBank ?? createSignalBank();
  if (typeof VideoEncoder === "undefined") {
    throw new Error("WebCodecs not available — use Chrome/Edge");
  }

  // Export at the render dimensions scaled by the chosen factor.
  let width = Math.round(params.renderWidth * settings.exportScale);
  let height = Math.round(params.renderHeight * settings.exportScale);
  width -= width % 2; // H.264 requires even dimensions
  height -= height % 2;

  const fps = settings.exportFps;
  const totalFrames = Math.max(1, Math.round(settings.exportSeconds * fps));
  const bitrate = Math.round(settings.exportBitrateMbps * 1_000_000);
  const codec = await pickCodec(width, height, bitrate, fps);
  // Scale factor is the ACTUAL even-snapped ratio (width/renderWidth), NOT
  // settings.exportScale — the H.264 even-dimension snap perturbs it sub-pixel,
  // and resolveFrame must scale by what we actually render at to stay WYSIWYG.
  const scale = width / Math.max(1, params.renderWidth);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width, height },
    fastStart: "in-memory",
  });

  let failure: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      failure = failure ?? (e as Error);
    },
  });
  encoder.configure({ codec, width, height, bitrate, framerate: fps });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const renderer = new Canvas2DRenderer();
  renderer.setGpuEffect(opts.gpu ?? null);
  const state = createState();
  const frameDur = 1_000_000 / fps;
  const dur = source.duration;

  source.setPlaying(false);
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (failure) throw failure;
      const tSec = i / fps;
      // Loop finite footage if the export runs longer than the clip.
      const clipTime = dur && dur > 0 ? tSec % dur : tSec;
      await source.seekTo(clipTime);
      // Same funnel as the live loop: resolve modulators at clipTime, scale, render.
      const p = resolveFrame(
        params,
        modulators,
        modSources,
        { frame: i, clipTime, fps, scale, raw: false },
        sig,
      );
      await renderer.render(ctx, width, height, source, i, p, state, true);

      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(i * frameDur),
        duration: Math.round(frameDur),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      // Keep the encoder queue bounded so memory stays flat on long exports.
      if (encoder.encodeQueueSize > 8) {
        while (encoder.encodeQueueSize > 4) {
          await new Promise<void>((r) => setTimeout(r, 4));
        }
      }
      onProgress((i + 1) / totalFrames);
    }
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (encoder.state !== "closed") encoder.close();
    source.setPlaying(true);
  }

  return muxer.target.buffer;
}

/** Render the clip and trigger a browser download of the mp4. */
export async function exportVideo(opts: ExportOptions): Promise<void> {
  const buffer = await renderToMp4(opts);
  const blob = new Blob([buffer], { type: "video/mp4" });
  triggerDownload(blob, `node-flow-${Date.now()}.mp4`);
}

/** Render every frame to a PNG and download them as a single .zip (store mode —
 *  PNGs are already compressed). Lossless frames for compositing in an NLE/AE. */
export async function exportPngSequence(opts: ExportOptions): Promise<void> {
  const { source, params, settings, onProgress } = opts;
  const modulators = opts.modulators ?? [];
  const modSources = opts.modSources ?? [];
  const sig = opts.signalBank ?? createSignalBank();

  let width = Math.round(params.renderWidth * settings.exportScale);
  let height = Math.round(params.renderHeight * settings.exportScale);
  width -= width % 2;
  height -= height % 2;
  const scale = width / Math.max(1, params.renderWidth);
  const fps = settings.exportFps;
  const totalFrames = Math.max(1, Math.round(settings.exportSeconds * fps));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: settings.transparent })!;

  const renderer = new Canvas2DRenderer();
  renderer.setGpuEffect(opts.gpu ?? null);
  const state = createState();
  const dur = source.duration;
  const pad = String(totalFrames).length;
  const files: Record<string, Uint8Array> = {};

  source.setPlaying(false);
  try {
    for (let i = 0; i < totalFrames; i++) {
      const tSec = i / fps;
      const clipTime = dur && dur > 0 ? tSec % dur : tSec;
      await source.seekTo(clipTime);
      const p = resolveFrame(params, modulators, modSources, { frame: i, clipTime, fps, scale, raw: false }, sig);
      await renderer.render(ctx, width, height, source, i, p, state, true);
      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"),
      );
      files[`frame_${String(i).padStart(pad, "0")}.png`] = new Uint8Array(await blob.arrayBuffer());
      onProgress((i + 1) / totalFrames);
    }
  } finally {
    source.setPlaying(true);
  }

  const { zipSync } = await import("fflate");
  const zipped = zipSync(files, { level: 0 });
  triggerDownload(new Blob([zipped], { type: "application/zip" }), `node-flow-frames-${Date.now()}.zip`);
}

function triggerDownload(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
