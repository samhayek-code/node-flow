/** Main-thread WebGPU renderer. P1-B starts here: upload a source frame to a
 *  GPU texture and present it through a fullscreen pass. The effect/composite
 *  passes (linear-light) and motion grow on top of this seed; the Canvas2D
 *  renderer stays the default + fallback (createRenderer in ../renderer.ts). */

import { requestGpu, type GpuContext } from "./gpu";

/** Fullscreen-triangle blit. Samples the uploaded source and writes it to the
 *  swapchain. The texture is sampled raw (no color math yet); the effect pass
 *  this seeds will do its work in linear light before the final present. */
const BLIT_WGSL = /* wgsl */ `
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_2d<f32>;

struct VsOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var out: VsOut;
  out.pos = vec4(p[i], 0.0, 1.0);
  // Flip Y: texture origin is top-left, clip-space Y is up.
  out.uv = vec2((p[i].x + 1.0) * 0.5, (1.0 - p[i].y) * 0.5);
  return out;
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
  return textureSample(tex, samp, in.uv);
}
`;

export class WebGPURenderer {
  readonly backend = "webgpu" as const;

  private gpu: GpuContext;
  private ctx: GPUCanvasContext;
  private pipeline: GPURenderPipeline;
  private sampler: GPUSampler;
  private srcTex: GPUTexture | null = null;
  private bindGroup: GPUBindGroup | null = null;
  private srcW = 0;
  private srcH = 0;

  private constructor(gpu: GpuContext, ctx: GPUCanvasContext, pipeline: GPURenderPipeline, sampler: GPUSampler) {
    this.gpu = gpu;
    this.ctx = ctx;
    this.pipeline = pipeline;
    this.sampler = sampler;
  }

  /** Acquire a device, configure the canvas's WebGPU context, and build the
   *  blit pipeline. Returns null on any failure so the caller falls back. */
  static async create(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<WebGPURenderer | null> {
    const gpu = await requestGpu();
    if (!gpu) return null;
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) return null;
    ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: "opaque" });

    const module = gpu.device.createShaderModule({ code: BLIT_WGSL });
    const pipeline = gpu.device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs" },
      fragment: { module, entryPoint: "fs", targets: [{ format: gpu.format }] },
      primitive: { topology: "triangle-list" },
    });
    const sampler = gpu.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    return new WebGPURenderer(gpu, ctx, pipeline, sampler);
  }

  private ensureTexture(w: number, h: number): void {
    if (this.srcTex && this.srcW === w && this.srcH === h) return;
    this.srcTex?.destroy();
    this.srcTex = this.gpu.device.createTexture({
      size: [w, h],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.srcW = w;
    this.srcH = h;
    this.bindGroup = this.gpu.device.createBindGroup({
      layout: this.pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.sampler },
        { binding: 1, resource: this.srcTex.createView() },
      ],
    });
  }

  /** Upload a source canvas (already drawn at w×h) and present it. */
  blit(source: HTMLCanvasElement | OffscreenCanvas, w: number, h: number): void {
    const device = this.gpu.device;
    this.ensureTexture(w, h);
    device.queue.copyExternalImageToTexture({ source }, { texture: this.srcTex! }, [w, h]);

    const encoder = device.createCommandEncoder();
    const view = this.ctx.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: "clear", storeOp: "store" },
      ],
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
  }
}
