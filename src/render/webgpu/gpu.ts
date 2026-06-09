/** WebGPU device acquisition. Returns null whenever WebGPU is unavailable or
 *  fails to initialize, so every caller can fall back to Canvas2D. */

export interface GpuContext {
  adapter: GPUAdapter;
  device: GPUDevice;
  /** Preferred swapchain format for this platform (bgra8unorm or rgba8unorm). */
  format: GPUTextureFormat;
}

export async function requestGpu(): Promise<GpuContext | null> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    const format = navigator.gpu.getPreferredCanvasFormat();
    return { adapter, device, format };
  } catch {
    return null;
  }
}
