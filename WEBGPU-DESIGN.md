# P1-B WebGPU Render Pipeline — Canonical Design

Lead graphics architect synthesis of four investigations. Decisions are final; where investigations conflicted I picked one and say why. API claims are grounded against current WebGPU/WebCodecs (Chrome/Edge ≥113, Safari 26+, Firefox desktop 141+; verified June 2026) and the actual Node-Flow source.

The north star, stated once so it governs every tradeoff below: **the win is two things — a GPU effect pass that unblocks 1080p≥60 / 4K-usable, and linear-light blending that fixes the current gamma bug. Everything that does not serve those two is cut or deferred.** The current preview is already 60fps at 960×540; the only CPU wall is `getImageData(0,0,w,h)` + a scalar JS effect loop (`compose.ts:133-134`), which goes ~16× at 4K. That single line is what we are removing.

---

## 1. Architecture decisions

| # | Decision | Verdict | Why (grounded) |
|---|----------|---------|----------------|
| **A1** | **Live preview: WebGPU in a Web Worker, OffscreenCanvas.** | Worker. | Keeps Leva drags + React at 60fps while 4K composites. `supports.offscreenCanvas()` already exists (`browser.ts:11`). The HUD reads only `blobs.length` every 500ms (`App.tsx:414-415`), so the worker round-trip is invisible. |
| **A2** | **Export: dedicated *main-thread* WebGPU device, NOT the worker.** | Main thread. | The `VideoEncoder`/`mp4-muxer`/`encodeQueueSize` backpressure all live on the main thread (`encoder.ts:76-124`); routing frames through `postMessage` 360× for a 6s clip is pure latency and reintroduces ordering hazards the current synchronous loop avoids. Export is throughput-bound, offline, and already blocks the UI behind a progress bar. This kills P1-B's single hardest risk (frame-perfect-through-async-worker) by not building it. |
| **A3** | **Both paths share the same `WebGPURenderer` class, WGSL, and `resolveFrame` funnel.** | Shared core. | Parity lives in `resolveFrame` + the WGSL, not in the threading. `resolveFrame` needs **zero** changes — it already hands every backend finished `RenderParams`. |
| **A4** | **Motion: GPU compute. Blobs/connectors: CPU, in the worker, byte-identical.** | Hybrid. | Connected-components + greedy merge + temporal id tracking is serial pointer-chasing — porting to GPU is weeks and still needs a readback for stateful ids. The motion grid is tiny (~96×54 = 5184 floats ≈ 20 KB). Readback bandwidth is a non-issue; only round-trip latency (~0.5–2ms) matters, hidden by pipelining (§3). Keep `detectBlobs`/`buildConnectors`/`createState` verbatim in the worker. |
| **A5** | **Blobs are CPU-readback, pipelined one frame late for preview; synchronous for export.** | Split by path. | Preview: map frame N−1's staging buffer while GPU computes N → masks lag motion by one frame (~16ms), imperceptible. Export: `await mapAsync` per frame → frame-N-blobs-on-frame-N, deterministic. One `sync` flag selects. |
| **A6** | **Overlays (connectors + boxes): 2D canvas layer over the GPU canvas, NOT WGSL.** | 2D layer. | Sub-millisecond `Path2D` strokes, resolution-independent. Reuse `drawConnectors`/`drawBoxes`/`shapePath`/`strokeCorners` verbatim on a layered 2D canvas. |
| **A7** | **`importExternalTexture(VideoFrame)` for video; `copyExternalImageToTexture(ImageBitmap)` fallback (Firefox); WGSL-or-2D for generated source.** | Per-source upload. | `importExternalTexture` zero-copy but expires at task end + only `textureSampleBaseClampToEdge` (fine — all effects sample level-0 clamped). Firefox → ImageBitmap + copy. Generated source: keep `GeneratedSource.draw` in a worker OffscreenCanvas, copy in — zero parity risk. |
| **A8** | **ascii stays CPU permanently; halftone/chromatic GPU but perceptual-parity only.** | Hybrid effects. | `fillText` glyph rasterization has no clean fragment-shader analog. halftone/chromatic port but AA + linear-light differ — accept perceptual, not pixel, parity. |

---

## 2. Contracts (TypeScript)

### 2.1 Widened `Renderer` interface

```ts
// src/render/renderer.ts (P1-B shape)
import type { Params } from "../params";
import type { Blob } from "../pipeline/types";

export type RenderParams = Params & { raw?: boolean };

/** Transferable per-frame source. Replaces HTMLVideoElement (neither transferable
 *  nor constructible in a worker). The main thread produces one each tick. */
export type SourceFrame =
  | VideoFrame      // file/webcam → zero-copy importExternalTexture
  | ImageBitmap     // generated, or VideoFrame downconverted for Firefox → copyExternalImageToTexture
  | OffscreenCanvas; // generated drawn worker-side (no transfer needed)

export interface RenderInput {
  frame: SourceFrame | null;  // null ⇒ worker draws the generated source itself
  w: number;
  h: number;
  frameIndex: number;
  p: RenderParams;            // already resolved + scaled by resolveFrame
  sync?: boolean;             // true ⇒ export path: synchronous blob readback (§3, A5)
}

export interface Renderer {
  readonly backend: "canvas2d" | "webgpu";
  init(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  resize(w: number, h: number): void;
  render(input: RenderInput): Promise<Blob[]>;
  resetState(): void;         // source swap → createState()
  dispose(): void;
}
```

`createRenderer` gains a main-thread adapter probe **before** any `transferControlToOffscreen` (irreversible — see R2). `createExportRenderer` builds the main-thread GPU renderer directly (no worker, A2).

### 2.2 `GpuEffect` contract (mirrors `EffectImpl`)

```ts
// src/render/webgpu/effects/types.ts
export interface GpuEffect {
  readonly name: EffectType;
  readonly label: string;
  /** WGSL fragment in LINEAR light. @group(0)=shared scene (sceneTex -srgb view,
   *  sampler, Global uniform), @group(1)=this effect's uniform + optional LUT. */
  readonly wgsl: string;
  writeUniforms(p: RenderParams, w: number, h: number, view: Float32Array): void;
  readonly uniformSize: number;
  buildResources?(device: GPUDevice): GpuEffectResources | null;
}
```

Adding an effect = drop a file exporting a `GpuEffect`, register in `GPU_EFFECTS: Record<EffectType, GpuEffect>`. Same ergonomics as `EFFECTS`.

### 2.3 Worker message protocol

```ts
export type ToWorker =
  | { type: "init"; canvas: OffscreenCanvas; dpr: number }   // transfer: [canvas]
  | { type: "resize"; w: number; h: number }
  | { type: "reset-state" }
  | { type: "frame"; id: number; frame: SourceFrame | null; w: number; h: number; frameIndex: number; p: RenderParams }
  | { type: "dispose" };

export type FromWorker =
  | { type: "init-ok"; adapterInfo: string }
  | { type: "init-failed"; reason: string }
  | { type: "frame-done"; id: number; blobs: Blob[] }
  | { type: "error"; id: number | null; message: string };
```

Only `SourceFrame` and the initial `OffscreenCanvas` use the transfer list; everything else structured-clones cheaply.

### 2.4 `FrameSource` extension (main thread keeps the `HTMLVideoElement`)

```ts
toSourceFrame(): Promise<{ frame: SourceFrame | null; transfer: Transferable[] }>;
// generated → { frame:null, transfer:[] }
// video, external-texture supported → { frame: new VideoFrame(videoEl), transfer:[vf] }
// video, Firefox → { frame: await createImageBitmap(videoEl), transfer:[bmp] }
```

Caller must `.close()` the `VideoFrame` after transfer/drop (R1).

---

## 3. Pass graph (per frame, linear light, matches `compose.ts` order)

Textures: `texSrc` (rgba8unorm + `-srgb` view → hardware sRGB→linear on read), `prev/next Luma` + `prev/next Trail` (ping-pong storage), `staging[0..1]` (MAP_READ trail readback double-buffer), `texComposite` (rgba16float linear working space), canvas swapchain (final blit through `-srgb` view = the ONE sRGB encode).

```
0. UPLOAD source → texSrc (importExternalTexture | copyExternalImageToTexture | generated-draw)
   ── RAW BYPASS (p.raw): blit texSrc → canvas, postMessage([]), done ──
1. COMPUTE motion.wgsl: downsample, Rec.601 luma (on NON-LINEAR view — detect in gamma), frame-diff
   vs prevLuma, trail = max(m, prevTrail*decay). Ping-pong. First frame seeds prevLuma=luma.
2. READBACK trail: copyBufferToBuffer → staging[N%2]; preview maps staging[(N-1)%2] (one frame late),
   export awaits staging[N%2].mapAsync (frame-perfect). → detectBlobs → buildConnectors (CPU, verbatim).
3. RENDER PASS A → texComposite (rgba16float linear): fullscreen tri; base = sample texSrc (linear);
   out = mix(base, effectFS(uv), coverage) where coverage = full | max over blobs of SDF*life.
4. BLIT texComposite (linear 16f) → canvas (-srgb view) ← the ONLY sRGB encode.
5. OVERLAYS (2D layer): drawConnectors + drawBoxes verbatim from compose.ts:181-258.
6. postMessage frame-done with blobs → main thread HUD.
```

Only structural changes vs `compose.ts`: base+effect fuse into one fragment pass (for SDF masking), and the sRGB encode defers to the final blit (for linear light).

---

## 4. Parity plan

**Parity = perceptual/structural, per-effect-bucket, gated by a self-test. Not pixel-diff** — because fixing the gamma bug *changes the output* by design (today's effects lerp sRGB bytes; linear is correct and brighter in averaged regions).

| Bucket | Effects | Target |
|--------|---------|--------|
| **A — true** | pixelate, threshold, scanlines, solarize, invert | MAE < 2/255 |
| **B — careful** | dither, edges | MAE < 6/255 (dither: index Bayer by CELL coords, not pixel) |
| **C — perceptual** | halftone, chromatic | SSIM > 0.98 / eyeball |
| **CPU (excluded)** | ascii | stays Canvas2D forever |

**Gamma fix, precisely:** decode sRGB→linear on read (`-srgb` view), all effect/blend math in linear (rgba16float), encode once on final blit. Never double-encode. **Exception:** motion detection stays in gamma (sample non-linear view for luma) so `detectBlobs` thresholds match `motion.ts:56`. **Detect in gamma, render in linear.**

**Self-test (rollout gate, first GPU init):** render one fixed frame through both backends, diff per-bucket against thresholds. Bucket A/B failure → fall back to Canvas2D for the session + toast. Makes default-on provably safe on the user's actual hardware.

---

## 5. Phased plan (each shippable behind `?gpu=1` / localStorage flag; auto-fallback always on)

**G1 — Worker + device + Renderer scaffold + fallback · L.** Source renders via WebGPU in a worker at 60fps, main thread free; unsupported browsers transparently Canvas2D. No effects yet (raw-bypass path end-to-end + motion compute + CPU blob readback + 2D overlays).
- NEW `src/render/webgpu/{workerHandle,render-worker,protocol}.ts`, `shaders/motion.wgsl.ts`
- MODIFIED `renderer.ts` (widen §2.1 + adapter-probe factory), `pipeline/source.ts` (`toSourceFrame`), `pipeline/motion.ts:9-11` (OffscreenCanvas), `App.tsx` (init + one-catch fallback + async loop)
- REUSED VERBATIM (worker-side): `blobs.ts`, `connectors.ts`, `types.ts`

**G2 — WGSL effects port · L** ← the performance + quality story. Bucket A+B+C effects in WGSL, linear light, `GpuEffect` contract. Delivers 1080p≥60 / 4K-usable + the gamma fix.
- NEW `webgpu/effects/{types + 7 effects}.wgsl.ts`, `shaders/effect_composite.wgsl.ts`, `selftest.ts`
- ascii routed CPU (A8); cell effects need `size×size` average loop gated `if size>1`/export for parity

**G3 — Motion on GPU + CPU blob readback + overlays · M.** Hardens G1 scaffolding: pipelined readback (preview one-frame-late), gamma-space detection-luma, full overlay parity (verbatim reuse).

**G4 — Export via GPU path · M.** Main-thread `WebGPURenderer` (A2), synchronous blob readback (`sync:true`, A5), `new VideoFrame(offscreenCanvas)` after `await device.queue.onSubmittedWorkDone()`.
- NEW `webgpu/renderer.ts` (main-thread `WebGPURenderer`, `initForExport`)
- MODIFIED `encoder.ts:84-117` (`createExportRenderer` + VideoFrame snapshot; keep codec/muxer/backpressure)
- Canvas route inherits canvas color space (lower risk); if texture→buffer→VideoFrame, tag `colorSpace` bt709/iec61966-2-1.

---

## 6. Risks + cuts

**Top risks:** (1) `VideoFrame` lifetime leaks → `MAX_IN_FLIGHT=1`, drop+`.close()` stale frames. (2) `transferControlToOffscreen` irreversible → main-thread `requestAdapter()` probe BEFORE transfer (highest-severity). (3) `importExternalTexture` expiry mid-pass → pipelined readback maps the PREVIOUS frame, no await between import and submit. (4) linear-vs-gamma detection drift → detect in gamma, render in linear. (5) cell-effect block-average divergence → explicit average loop gated `if size>1`/export.

**Explicit CUTS for v1:** GPU connected-components (CPU verbatim, ~20KB readback); worker-driven export (main-thread GPU, A2); ascii in WGSL (CPU forever); GPU overlay pass (2D verbatim); `device.lost` auto-recovery (toast + session fallback is enough); `MAX_IN_FLIGHT>1`; manual RGB→YUV in WGSL / MSAA / H.264 VUI / exact Gaussian preBlur.

**Highest-leverage decision:** export stays synchronous on a main-thread GPU device; the worker is a live-preview-only transport with eventually-consistent blobs and frame-dropping backpressure. That removes the two hardest problems (frame-perfect-async-export, per-frame blob round-trip) from the build entirely; every milestone G1–G4 ships independently behind the flag with Canvas2D as the always-on fallback.

`resolve.ts` requires **zero changes** — the funnel already feeds the GPU backend correctly.
