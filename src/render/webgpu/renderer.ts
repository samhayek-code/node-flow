/** Main-thread WebGPU renderer. P1-B grows here: upload a source frame, run the
 *  effect pass, present. Effects replicate the Canvas2D byte math exactly for
 *  tight parity (linear-light is reserved for the blend/composite step that masks
 *  effects to blobs — added next). Canvas2D stays the default + fallback. */

import { requestGpu, type GpuContext } from "./gpu";
import type { EffectType, Params } from "../../params";
import { hexToRgb } from "../../effects/util";

/** Effect ids consumed by the WGSL switch. Effects not yet ported fall back to
 *  passthrough (0); the App routes those to Canvas2D for now. */
const EFFECT_ID: Partial<Record<EffectType, number>> = {
  none: 0,
  pixelate: 1,
  threshold: 2,
  solarize: 3,
  scanlines: 4,
  dither: 5,
  chromatic: 6,
  edges: 7,
  halftone: 8,
  // ascii stays CPU (glyph rasterization, design A8) — not in this map.
};

export function gpuSupportsEffect(e: EffectType): boolean {
  return EFFECT_ID[e] !== undefined;
}

/** Fullscreen-triangle effect pass. textureLoad (not textureSample) reads exact
 *  texels so cell averages match Canvas2D's ImageData byte math. */
// Bayer 4x4, pre-normalized (v+0.5)/16 to match effects/util.ts BAYER4.
const EFFECT_WGSL = /* wgsl */ `
struct U {
  w: u32, h: u32, size: u32, levels: u32,
  effectType: u32, invert: u32, mono: u32, pad1: u32,
  bg: vec4<f32>,
  fg: vec4<f32>,
};
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: U;

const BAYER = array<f32, 16>(
  0.03125, 0.53125, 0.15625, 0.65625,
  0.78125, 0.28125, 0.90625, 0.40625,
  0.21875, 0.71875, 0.09375, 0.59375,
  0.96875, 0.46875, 0.84375, 0.34375
);

fn luma601(c: vec3<f32>) -> f32 { return c.r * 0.299 + c.g * 0.587 + c.b * 0.114; }
// Match JS Math.round (ties toward +inf) so quantizers stay byte-exact.
fn jround(x: f32) -> f32 { return floor(x + 0.5); }

fn loadAt(x: i32, y: i32) -> vec3<f32> {
  let cx = clamp(x, 0, i32(u.w) - 1);
  let cy = clamp(y, 0, i32(u.h) - 1);
  return textureLoad(tex, vec2<i32>(cx, cy), 0).rgb;
}

fn blockAvg(px: i32, py: i32, size: i32) -> vec3<f32> {
  let w = i32(u.w);
  let h = i32(u.h);
  let x0 = (px / size) * size;
  let y0 = (py / size) * size;
  let x1 = min(w, x0 + size);
  let y1 = min(h, y0 + size);
  var s = vec3<f32>(0.0);
  var n = 0.0;
  for (var y = y0; y < y1; y = y + 1) {
    for (var x = x0; x < x1; x = x + 1) {
      s = s + textureLoad(tex, vec2<i32>(x, y), 0).rgb;
      n = n + 1.0;
    }
  }
  if (n <= 0.0) { return vec3<f32>(0.0); }
  return s / n;
}

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  return vec4(p[i], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragPos: vec4<f32>) -> @location(0) vec4<f32> {
  let px = i32(fragPos.x);
  let py = i32(fragPos.y);
  let size = max(1, i32(u.size));
  let et = u.effectType;
  let lm1 = f32(max(2u, u.levels) - 1u);
  var col: vec3<f32>;

  if (et == 1u) { // pixelate
    col = blockAvg(px, py, size);
  } else if (et == 2u) { // threshold (duotone posterize)
    let avg = blockAvg(px, py, size);
    let q = jround(luma601(avg) * lm1) / lm1;
    col = mix(u.bg.rgb, u.fg.rgb, q);
  } else if (et == 3u) { // solarize
    let c = textureLoad(tex, vec2<i32>(px, py), 0).rgb;
    let thr = 0.35 + 0.4 * min(1.0, (f32(u.levels) - 2.0) / 14.0);
    col = select(c, vec3<f32>(1.0) - c, c > vec3<f32>(thr));
  } else if (et == 4u) { // scanlines
    let c = textureLoad(tex, vec2<i32>(px, py), 0).rgb;
    let gap = max(2, i32(u.size));
    let half = max(1, gap / 2);
    let dark = select(0.4, 1.0, (py % gap) < half);
    col = c * dark;
  } else if (et == 5u) { // dither (ordered Bayer, per channel or mono)
    let avg = blockAvg(px, py, size);
    let cellRow = py / size;
    let cellCol = px / size;
    let t = BAYER[(cellRow & 3) * 4 + (cellCol & 3)] - 0.5;
    if (u.mono == 1u) {
      let q = clamp(jround(luma601(avg) * lm1 + t), 0.0, lm1) / lm1;
      col = vec3<f32>(q);
    } else {
      col = vec3<f32>(
        clamp(jround(avg.r * lm1 + t), 0.0, lm1) / lm1,
        clamp(jround(avg.g * lm1 + t), 0.0, lm1) / lm1,
        clamp(jround(avg.b * lm1 + t), 0.0, lm1) / lm1,
      );
    }
  } else if (et == 6u) { // chromatic aberration
    let shift = max(1, size);
    col = vec3<f32>(
      loadAt(px + shift, py).r,
      textureLoad(tex, vec2<i32>(px, py), 0).g,
      loadAt(px - shift, py).b,
    );
  } else if (et == 7u) { // sobel edges (duotone)
    let gain = 1.0 + f32(u.levels) * 0.5;
    let tl = luma601(loadAt(px - 1, py - 1));
    let tc = luma601(loadAt(px, py - 1));
    let tr = luma601(loadAt(px + 1, py - 1));
    let ml = luma601(loadAt(px - 1, py));
    let mr = luma601(loadAt(px + 1, py));
    let bl = luma601(loadAt(px - 1, py + 1));
    let bc = luma601(loadAt(px, py + 1));
    let brr = luma601(loadAt(px + 1, py + 1));
    let gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + brr;
    let gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + brr;
    let mag = min(1.0, sqrt(gx * gx + gy * gy) * gain);
    col = mix(u.bg.rgb, u.fg.rgb, mag);
  } else if (et == 8u) { // halftone (one dot per cell)
    let x0 = (px / size) * size;
    let y0 = (py / size) * size;
    let avg = blockAvg(px, py, size);
    let l = luma601(avg);
    let maxR = f32(size) * 0.62;
    let radius = maxR * sqrt(l);
    let cx = f32(x0) + f32(size) * 0.5;
    let cy = f32(y0) + f32(size) * 0.5;
    let d = distance(vec2<f32>(f32(px) + 0.5, f32(py) + 0.5), vec2<f32>(cx, cy));
    // smoothstep edge approximates Canvas2D's anti-aliased arc fill.
    let cov = select(0.0, 1.0 - smoothstep(radius - 0.7, radius + 0.7, d), radius >= 0.35);
    let dotCol = select(avg, u.fg.rgb, u.mono == 1u);
    col = mix(u.bg.rgb, dotCol, cov);
  } else { // none / passthrough
    col = textureLoad(tex, vec2<i32>(px, py), 0).rgb;
  }

  if (u.invert == 1u && et != 0u) { col = vec3<f32>(1.0) - col; }
  return vec4(col, 1.0);
}
`;

export class WebGPURenderer {
  readonly backend = "webgpu" as const;

  private gpu: GpuContext;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private uniformBuf: GPUBuffer;
  private canvas: OffscreenCanvas;
  private srcTex: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private srcW = 0;
  private srcH = 0;

  private constructor(
    gpu: GpuContext,
    ctx: GPUCanvasContext,
    pipeline: GPURenderPipeline,
    uniformBuf: GPUBuffer,
    canvas: OffscreenCanvas,
  ) {
    this.gpu = gpu;
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.uniformBuf = uniformBuf;
    this.canvas = canvas;
  }

  /** Acquire a device, build the effect pipeline on an internal OffscreenCanvas.
   *  Returns null on any failure so the caller falls back to Canvas2D. */
  static async create(): Promise<WebGPURenderer | null> {
    const gpu = await requestGpu();
    if (!gpu) return null;
    const canvas = new OffscreenCanvas(16, 16);
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) return null;
    ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: "opaque" });

    const module = gpu.device.createShaderModule({ code: EFFECT_WGSL });
    const pipeline = gpu.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: gpu.format }] },
      primitive: { topology: "triangle-list" },
    });
    const uniformBuf = gpu.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    return new WebGPURenderer(gpu, ctx, pipeline, uniformBuf, canvas);
  }

  /** The offscreen canvas the effect is rendered into — drawImage'd by compose. */
  output(): OffscreenCanvas {
    return this.canvas;
  }

  private ensureTexture(w: number, h: number): void {
    if (this.srcTex && this.srcW === w && this.srcH === h) return;
    this.srcTex?.destroy();
    this.srcTex = this.gpu.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.srcW = w;
    this.srcH = h;
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.srcTex.createView() },
        { binding: 1, resource: { buffer: this.uniformBuf } },
      ],
    });
  }

  private writeUniform(p: Params, w: number, h: number): void {
    const ab = new ArrayBuffer(64);
    const u32 = new Uint32Array(ab);
    const f32 = new Float32Array(ab);
    u32[0] = w;
    u32[1] = h;
    u32[2] = Math.max(1, Math.round(p.pixelSize));
    u32[3] = Math.max(2, Math.round(p.levels));
    u32[4] = EFFECT_ID[p.effect] ?? 0;
    u32[5] = p.invert ? 1 : 0;
    u32[6] = p.mono ? 1 : 0;
    const [br, bg, bb] = hexToRgb(p.background);
    const [fr, fg, fb] = hexToRgb(p.effectColor);
    f32[8] = br / 255;
    f32[9] = bg / 255;
    f32[10] = bb / 255;
    f32[11] = 1;
    f32[12] = fr / 255;
    f32[13] = fg / 255;
    f32[14] = fb / 255;
    f32[15] = 1;
    this.gpu.device.queue.writeBuffer(this.uniformBuf, 0, ab);
  }

  /** Upload a source canvas (drawn at w×h) and present it with the effect applied
   *  full-frame. Blob masking + linear-light compositing arrive in the next step. */
  renderEffect(source: HTMLCanvasElement | OffscreenCanvas, w: number, h: number, p: Params): void {
    const device = this.gpu.device;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ensureTexture(w, h);
    device.queue.copyExternalImageToTexture({ source }, { texture: this.srcTex! }, [w, h]);
    this.writeUniform(p, w, h);

    const encoder = device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" }],
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, this.bindGroup!);
    pass.draw(3);
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  dispose(): void {
    this.srcTex?.destroy();
    this.srcTex = null;
    this.bindGroup = null;
    this.uniformBuf.destroy();
  }
}
