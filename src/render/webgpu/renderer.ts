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
};

export function gpuSupportsEffect(e: EffectType): boolean {
  return EFFECT_ID[e] !== undefined;
}

/** Fullscreen-triangle effect pass. textureLoad (not textureSample) reads exact
 *  texels so cell averages match Canvas2D's ImageData byte math. */
const EFFECT_WGSL = /* wgsl */ `
struct U {
  w: u32, h: u32, size: u32, levels: u32,
  effectType: u32, invert: u32, pad0: u32, pad1: u32,
  bg: vec4<f32>,
  fg: vec4<f32>,
};
@group(0) @binding(0) var tex: texture_2d<f32>;
@group(0) @binding(1) var<uniform> u: U;

fn luma601(c: vec3<f32>) -> f32 { return c.r * 0.299 + c.g * 0.587 + c.b * 0.114; }

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
  var col: vec3<f32>;

  if (et == 1u) { // pixelate
    col = blockAvg(px, py, size);
  } else if (et == 2u) { // threshold (duotone posterize)
    let avg = blockAvg(px, py, size);
    let lm1 = f32(max(2u, u.levels) - 1u);
    let q = round(luma601(avg) * lm1) / lm1;
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
  private srcTex: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private srcW = 0;
  private srcH = 0;

  private constructor(gpu: GpuContext, ctx: GPUCanvasContext, pipeline: GPURenderPipeline, uniformBuf: GPUBuffer) {
    this.gpu = gpu;
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.uniformBuf = uniformBuf;
  }

  /** Acquire a device, configure the canvas's WebGPU context, build the effect
   *  pipeline. Returns null on any failure so the caller falls back. */
  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<WebGPURenderer | null> {
    const gpu = await requestGpu();
    if (!gpu) return null;
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
    return new WebGPURenderer(gpu, ctx, pipeline, uniformBuf);
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
