/** Backend-agnostic renderer seam. Canvas2D is the only backend in P0; the
 *  WebGPU swap (P1-B) is a one-line factory change. Every backend is fed an
 *  already-resolved, already-scaled `Params` via `resolveFrame`, so backends
 *  never re-implement modulation or scaling. */

import type { Params } from "../params";
import type { FrameSource } from "../pipeline/source";
import type { Blob, PipelineState } from "../pipeline/types";

/** A finished, render-ready param set: base Params after modulation + scaling,
 *  with the transient `raw` bypass injected by `resolveFrame` (never on the
 *  persisted/undoable Params). Backends read `p.raw`; nothing else carries it. */
export type RenderParams = Params & { raw?: boolean };

export interface Renderer {
  readonly backend: "canvas2d" | "webgpu";
  /** Async one-time setup. Canvas2D resolves instantly; WebGPU requests a device / spins a worker. */
  init?(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  resize?(w: number, h: number): void;
  /** p is ALREADY resolved + scaled. Backends never see modulators. Returns blobs for the HUD. */
  render(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    source: FrameSource,
    frameIndex: number,
    p: RenderParams,
    state: PipelineState,
  ): Blob[];
  dispose?(): void;
}

export async function createRenderer(
  prefer: "auto" | "webgpu" | "canvas2d" = "canvas2d",
): Promise<Renderer> {
  if (prefer !== "canvas2d" && "gpu" in navigator) {
    try {
      // @ts-expect-error webgpu backend lands in P1-B
      const { WebGPURenderer } = await import("./webgpu/renderer");
      const r = new WebGPURenderer();
      await r.init?.();
      return r;
    } catch {
      /* fall through */
    }
  }
  const { Canvas2DRenderer } = await import("./compose");
  return new Canvas2DRenderer();
}
