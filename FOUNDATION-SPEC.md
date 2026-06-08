# NODE-FLOW — CANONICAL FOUNDATION SPEC (P0)

Status: source of truth for implementation. Supersedes the three proposals. Every signature here is verified against the current code at `/Users/samhayek/Desktop/Code/node-flow/src`.

---

## 1. DECISIONS

**Store: zustand + immer + `subscribeWithSelector`, with a hand-rolled command stack for undo.** zustand because the render loop must read params synchronously off a ref-mirror (a vanilla `subscribe`, zero re-renders) while ~5 UI widgets read slices via hooks — zustand serves both from one store; `useSyncExternalStore` would force me to hand-write the selector/equality layer that `subscribeWithSelector` already gives, and that layer is exactly what autosave-debounce and the Leva writeback need. immer (~3.3KB) because the project doc nests three levels (`project.params`, `project.modulators[].audio`) and shallow-spread reducers there are a footgun for structural sharing. The ~4.4KB cost is noise in a WebCodecs tool. zundo is explicitly rejected: it snapshots whole slices, has no edit-class awareness, cannot coalesce a slider drag, and will record the store→Leva writeback as a fresh undo entry — the precise failure we must engineer against.

**Undo: hand-rolled command stack of before/after `ProjectDoc` snapshots, with two-layer coalescing.** Whole-doc snapshots (not patches) because `ProjectDoc` is a few KB of primitives with no media; structural sharing is automatic when reducers spread only the touched slice, and 100 snapshots cost nothing. Coalescing is pointer-bracketed first (wrap the Leva panel in `onPointerDownCapture`/`onPointerUpCapture` → one undo entry per drag) with a 350ms same-label time-window as fallback for keyboard/number-field edits Leva fires with no pointer bracket. This answers the hard constraint that Leva exposes no `onEditEnd`.

**Trade-offs accepted.** (1) Leva-as-slave-view is the load-bearing fragility — bidirectional sync against a panel that owns its own input state. We break the cycle with an epoch guard (not a boolean — Leva's `set` flush is synchronous today but a boolean races if Leva ever batches) plus surgical key-diffed writeback plus never-writeback-mid-drag. This is where bugs will live, and it's the strongest argument for the deferred custom panel. (2) Macros become persisted, undoable state — `controls.ts` loses the lerp math (moves to a pure `deriveMacro`), in exchange for fixing the preset desync and making a macro drag one atomic undo step. (3) The render loop reads a ref-mirror, not React, so "current params" lives in two places (ref for loop, store for UI) — same store, no divergence, but the mental model must stay clear.

---

## 2. CONTRACTS

### 2.1 Type-surface fixes (land first, before the store)

In `src/params.ts`: **delete `raw` from `Params`** (line 63) and from `DEFAULT_PARAMS` (line 117). `raw` is not a Leva control and `paramsRef.current.raw` is always false today — it's a structural lie. It becomes `view.raw`, injected only by `resolveFrame`.

`renderWidth`/`renderHeight` stay in `Params` but are never read raw by the render path — `selectEffectiveDims` overrides them when a file source locks dims.

> NOTE FOR P0 PHASE-0 MODULE BUILD: do NOT remove `raw` yet — that is Phase 1 step 1, done together with `compose.ts`/`encoder.ts`/`App.tsx`. Phase-0 modules are written against the CURRENT `Params` (which still has `raw`). When `raw` is later removed, `resolveFrame`'s return type becomes `RenderParams = Params & { raw?: boolean }` and `Renderer.render` + `compose.ts` are updated together.

### 2.2 Store state shape

```ts
// src/store/types.ts
import type { Params, ExportSettings, SourceKind } from "../params";

/* ---------- modulation (P1-A substrate; v1 ships "audio" only) ---------- */
export type ModSourceKind = "audio" | "lfo" | "keyframe";

export interface ModSource {
  id: string;
  kind: ModSourceKind;
  audio?: { mediaId: string; fileName: string; duration: number };
  // lfo?: { shape: "sine" | "saw" | "tri"; hz: number; phase: number };  // later
}

export type ModParam = keyof ModulatableParams;

export interface Modulator {
  id: string;
  enabled: boolean;
  sourceId: string;            // -> ModSource.id
  target: ModParam;            // numeric params only, type-enforced
  depth: number;               // -1..1, the per-route "Depth" knob
  responsiveness: number;      // 0..1, signal smoothing/attack
  channel?: "rms" | "low" | "mid" | "high";  // audio band; default "rms"
}

/** Modulation is valid only on numeric params with a known range. */
export type ModulatableParams = Pick<Params,
  | "motionThreshold" | "trailDecay" | "boxScale" | "minBlobSize" | "maxBlobSize"
  | "mergeDistance" | "boxPadding" | "boxSmoothing" | "boxWidth"
  | "pixelSize" | "levels" | "connectorMaxDist" | "connectorWidth" | "connectorCurve"
>;

/* ---------- macros: promoted to first-class persisted state ---------- */
export interface MacroState {
  responsiveness: number;  // 0..1
  density: number;
  boldness: number;
  size: number;
}

/* ---------- source metadata (serializable; live FrameSource stays a ref) ---------- */
export interface SourceMeta {
  kind: SourceKind;            // "generated" | "file" | "webcam"
  fileName?: string;           // file only — re-link target
  w?: number;
  h?: number;
  duration?: number | null;
}

/* ---------- the persisted, undoable document ---------- */
export interface ProjectDoc {
  schemaVersion: 1;
  params: Params;              // base params, raw removed (Phase 1)
  macros: MacroState;
  modSources: ModSource[];
  modulators: Modulator[];
  source: SourceMeta;
  export: ExportSettings;
}

/* ---------- transient view (not persisted in .nodeflow, not undoable) ---------- */
export interface ViewState {
  raw: boolean;                // pulled OUT of Params
  zoom: number;
  pan: { x: number; y: number };
}

/* ---------- transient UI chrome (never persisted, never undoable) ---------- */
export interface UiState {
  dragging: boolean;
  loading: boolean;
  toast: string | null;
  exportProgress: number | null;
  showExport: boolean;
  needsRelink: boolean;        // file-source project loaded, media not yet re-linked
}
```

Runtime refs stay refs, **never in the store**: `canvasRef`, `sourceRef`, `rendererRef`, `stateRef` (pipeline `PipelineState`), `frameRef`, `exportingRef`, input/stage refs, and the new `signalBankRef` (decoded audio envelopes). Putting a `FrameSource` or `Float32Array` in immer breaks draft proxying and buys nothing.

### 2.3 Store action API

```ts
// src/store/store.ts
export interface StoreApi {
  project: ProjectDoc;
  view: ViewState;
  ui: UiState;

  // --- internal (not public) ---
  _writebackEpoch: number;     // bumped when WE drive Leva
  _seenEpoch: number;          // last epoch absorbed by the Leva->store bridge
  _history: History;

  // === PARAM EDITS (undoable, coalesced by key) ===
  setParam<K extends keyof Params>(key: K, value: Params[K]): void;
  patchParams(patch: Partial<Params>, label?: string): void;   // preset/randomize: one txn

  // === MACRO EDITS (undoable; fan-out is ONE atomic txn) ===
  setMacro(key: keyof MacroState, value: number): void;

  // === MODULATORS (undoable) ===
  addModSource(s: Omit<ModSource, "id">): string;              // returns id
  removeModSource(id: string): void;
  addModulator(m: Omit<Modulator, "id">): string;
  updateModulator(id: string, patch: Partial<Modulator>): void;
  removeModulator(id: string): void;

  // === STRUCTURAL (undoable; carries a runtime-reset effect) ===
  setSource(meta: SourceMeta): void;

  // === EXPORT (undoable, coalesced) ===
  patchExport(patch: Partial<ExportSettings>): void;

  // === LIFECYCLE ===
  loadProject(doc: ProjectDoc): void;   // .nodeflow open / autosave restore; clears history
  resetProject(): void;

  // === UNDO/REDO + drag bracketing ===
  undo(): void;
  redo(): void;
  beginDrag(): void;
  endDrag(): void;

  // === TRANSIENT (never undoable) ===
  setView(patch: Partial<ViewState>): void;
  setUi(patch: Partial<UiState>): void;
}
```

Rule: every mutation that lands in `ProjectDoc` routes through `_history` (which calls immer `set`). `view`/`ui` mutate directly via plain `set`.

### 2.4 History / undo API

```ts
// src/store/history.ts
export interface History {
  record(label: string, mut: (d: Draft<ProjectDoc>) => void): void;   // coalesces by label+window
  commitOnce(label: string, mut: (d: Draft<ProjectDoc>) => void): void; // never coalesces (structural/multi-key)
  beginDrag(): void;   // pointer-down: opens a coalescing window, captures baseline
  endDrag(): void;     // pointer-up: seals ONE entry spanning the drag
  undo(): void;
  redo(): void;
  clear(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  /** store->Leva reflection hook, wired once in App after Leva mounts (§3). */
  writeback?: (doc: ProjectDoc) => void;
}

// Internal model:
//   interface Entry { label: string; before: ProjectDoc; after: ProjectDoc; }
//   COALESCE_MS = 350; MAX_DEPTH = 100;
// beginDrag captures `before`; record() mutates live but does NOT push while dragOpen;
// endDrag pushes one {before, after}. Outside a drag, record() coalesces same-label
// edits within COALESCE_MS by extending the top entry's `after`. commitOnce always pushes.
// undo/redo restore a snapshot AND call writeback(doc) under an epoch bump (§3).
//
// DETERMINISM/TEST NOTE: record() is a NO-OP when before === after (structural equality of
// the touched slice). This is belt-and-suspenders against the writeback echo (Risk #1).
// Time source for COALESCE_MS may use performance.now() at runtime, but expose an injectable
// clock so tests are deterministic.
```

### 2.5 `resolveFrame` / `resolveParams` — the single param funnel

This is the core invariant. **One funnel, two call sites, identical `Renderer.render` input.** The renderer never sees modulators, macros, locks, or audio — only a finished `Params`.

```ts
// src/render/resolve.ts
import type { Params } from "../params";
import type { Modulator, ModSource } from "../store/types";
import type { SignalBank } from "../audio/signalBank";

export interface FrameCtx {
  frame: number;       // monotonic render-space index (for source.draw / generated source)
  clipTime: number;    // SECONDS into the source clip — the determinism key (NOT frameRef)
  fps: number;         // resolution fps (live: 60; export: settings.exportFps)
  scale: number;       // 1 in preview; export multiplies pixel params by this
  raw: boolean;        // injected here, last — pulled out of Params
}

/** EFFECTIVE value = base + Σ enabled modulators, sampled deterministically at clipTime.
 *  Pure. Never writes back to the store (modulation does NOT mutate base). */
export function resolveParams(
  base: Params, mods: Modulator[], sources: ModSource[], ctx: FrameCtx, sig: SignalBank,
): Params {
  if (!mods.length) return base;
  const out: Params = { ...base };
  for (const m of mods) {
    if (!m.enabled) continue;
    const s = sig.sample(m, sources, ctx.clipTime);          // -1..1, O(1) array lookup
    out[m.target] = clampParam(m.target, (base[m.target] as number) + s * m.depth * span(m.target)) as never;
  }
  return out;
}

/** The contract both render entry points call. Order is FIXED: resolve -> scale -> raw-inject. */
export function resolveFrame(
  base: Params, mods: Modulator[], sources: ModSource[], ctx: FrameCtx, sig: SignalBank,
): Params {
  const modulated = resolveParams(base, mods, sources, ctx, sig);
  const scaled = ctx.scale === 1 ? modulated : scaleParams(modulated, ctx.scale);  // existing logic, scale-factor form
  return ctx.raw ? { ...scaled, raw: true } : scaled;
}
```

**Modulators live in `ProjectDoc.modulators` + `ProjectDoc.modSources`** (persisted, undoable). The decoded audio envelope lives in a runtime `SignalBank` (refs), keyed by `mediaId`, rebuilt on file load — never persisted in full (optionally a downscaled envelope is cached in the `.nodeflow` so preview works before re-link).

**Determinism rule (the single biggest P1-A trap):** modulators sample `ctx.clipTime` only — never `frameRef`. `clipTime = src.seekable ? src.currentTime : ctx.frame / ctx.fps`. Live `frameRef` free-runs and pauses during export; export `i` restarts at 0. The exporter already seeks on `tSec = i/fps` (verified `encoder.ts:104`) and the live source exposes `currentTime`, so clip time is the one axis both paths share. `SignalBank.sample` must accept clip seconds, not a frame index.

`scaleParams` is reworked from the current `scaleParams(params, exportWidth)` (verified hoisted at `encoder.ts:71`, frame-invariant) to a scale-factor form `scaleParams(params, scale)` and **moved inside the export loop** so it composes after per-frame resolve. Span/clamp tables (`span(target)`, `clampParam(target, v)`) come from the param ranges defined in `controls.ts` (lift the min/max for each `ModulatableParams` key).

### 2.6 Renderer interface (P1-B WebGPU swap)

Extract the exact current signature (verified identical at `App.tsx:353` and `encoder.ts:105`). Adopt the forward-fit deltas now, on Canvas2D, so the WebGPU swap is a one-line factory change later.

```ts
// src/render/renderer.ts
import type { Params } from "../params";
import type { FrameSource } from "../pipeline/source";
import type { Blob, PipelineState } from "../pipeline/types";

export interface Renderer {
  readonly backend: "canvas2d" | "webgpu";
  /** Async one-time setup. Canvas2D resolves instantly; WebGPU requests a device / spins a worker. */
  init?(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<void>;
  resize?(w: number, h: number): void;
  /** p is ALREADY resolved + scaled. Backends never see modulators. Returns blobs for the HUD. */
  render(
    ctx: CanvasRenderingContext2D,
    w: number, h: number,
    source: FrameSource,
    frameIndex: number,
    p: Params,
    state: PipelineState,
  ): Blob[];
  dispose?(): void;
}

export async function createRenderer(prefer: "auto" | "webgpu" | "canvas2d" = "canvas2d"): Promise<Renderer> {
  if (prefer !== "canvas2d" && "gpu" in navigator) {
    try { const { WebGPURenderer } = await import("./webgpu/renderer"); const r = new WebGPURenderer(); await r.init?.(/*…*/); return r; }
    catch { /* fall through */ }
  }
  const { Canvas2DRenderer } = await import("./compose");
  return new Canvas2DRenderer();
}
```

**P0 scope:** rename `compose.ts`'s exported class `Renderer` → `Canvas2DRenderer implements Renderer`, add `backend = "canvas2d"`, keep the `render` signature byte-identical. Swap points: `App.tsx:106` and `encoder.ts:93` → `createRenderer()`. The `init`/`resize`/`dispose` hooks are no-ops on Canvas2D today.

> PHASE-0 NOTE: `renderer.ts` defines the interface + factory only. The `compose.ts` rename is Phase 1 step 2 (do not touch `compose.ts` in Phase 0). The factory's dynamic `import("./compose")` resolves once `Canvas2DRenderer` is exported in Phase 1; in Phase 0 it is unused. The `import("./webgpu/renderer")` is also Phase 2 — leave the dynamic import as-is (it is never executed with the default `"canvas2d"` arg, so it does not break the build; if the type-checker complains about the missing module, suppress with a localized `// @ts-expect-error webgpu backend lands in P1-B` on that import line only).

Deferred to P1-B (documented, not built now): the worker path needs the renderer to own its canvas (`init(canvas)`, drop the per-frame `ctx` arg), a transferable `SourceFrame = VideoFrame | ImageBitmap | OffscreenCanvas` instead of an `HTMLVideoElement`, and async `render`. These are bigger edits to `compose.ts`; do NOT do them in P0 — the interface above is the bridge shape, and widening it for the worker is a localized change when WebGPU lands because every consumer already goes through `resolveFrame → render`.

### 2.7 `.nodeflow` project schema

```ts
// src/project/schema.ts
export const NODEFLOW_VERSION = 1;

export interface NodeflowFile {
  format: "nodeflow";
  schemaVersion: number;
  app: { name: "node-flow"; version: string };
  savedAt: string;            // ISO
  doc: ProjectDoc;            // params + macros + modSources + modulators + source meta + export
  audioEnvelopes?: Record<string, string>;  // mediaId -> base64 Float32 envelope (small; lets preview work pre-relink)
  // raw media is NEVER embedded — only metadata + a re-link flow
}

export function serializeProject(doc: ProjectDoc, envelopes?: Record<string, string>): NodeflowFile;
export function deserializeProject(raw: unknown): ProjectDoc;  // tolerant: fills missing keys from DEFAULT_*, runs migrate() ladder
```

Generated source round-trips perfectly (pure function of frame). File source stores `{kind:"file", fileName, w, h, duration}` only → re-link flow on open. `savePreset`/`loadPresetFile` (`App.tsx`) become a degenerate subset of project save (params + export).

### 2.8 Persistence API (IndexedDB autosave + FS Access save/open + recent)

```ts
// src/project/persistence.ts
export interface RecentEntry { id: string; name: string; savedAt: number; thumbnail?: string; }

// --- IndexedDB autosave (no library; raw IDB, one DB "nodeflow", stores "current" + "recent") ---
export function startAutosave(getDoc: () => ProjectDoc): () => void;  // debounced 800ms subscription; returns unsubscribe
export async function loadAutosave(): Promise<ProjectDoc | null>;
export async function listRecent(limit?: number): Promise<RecentEntry[]>;
export async function putRecent(file: NodeflowFile, thumbnail?: string): Promise<void>;

// --- File System Access (Chrome/Edge) with <a download> + <input type=file> fallback ---
export async function saveProjectToDisk(file: NodeflowFile): Promise<void>;   // showSaveFilePicker or download fallback
export async function openProjectFromDisk(): Promise<ProjectDoc>;             // showOpenFilePicker or hidden input fallback
```

```ts
// src/util/browser.ts — capability detection, used to gate features and pick fallbacks
export const supports = {
  fsAccess: () => "showSaveFilePicker" in window,
  webCodecs: () => typeof VideoEncoder !== "undefined",
  webGPU: () => "gpu" in navigator,
  offscreenCanvas: () => typeof OffscreenCanvas !== "undefined",
  webAudio: () => "AudioContext" in window || "webkitAudioContext" in window,
};
```

Autosave fires off the history-commit hook (so coalescing debounces it for free) plus the 800ms timer. On boot: `loadAutosave()` → `loadProject()` if present (clears history — a restored session starts a fresh undo timeline), else `DEFAULT_*`. Recents prune to last N on save; thumbnail = a downscaled canvas snapshot captured at save time.

### 2.9 Macro derivation + helpers (moved out of `controls.ts`)

```ts
// src/store/macros.ts — pure; imported by the store AND project-load so children recompute identically
export function deriveMacro(key: keyof MacroState, v: number): Partial<Params>;
// responsiveness -> { motionThreshold, trailDecay, boxSmoothing }
// density        -> { motionGrid, maxBlobs, connectorMaxDist }
// boldness       -> { pixelSize, boxWidth, connectorWidth }
// size           -> { boxScale }
// (exact lerp tables lifted verbatim from controls.ts:64-111)

// src/store/selectors.ts
export const selectLocked = (d: ProjectDoc) => d.source.kind === "file";
export const selectEffectiveDims = (d: ProjectDoc) =>
  d.source.kind === "file" && d.source.w && d.source.h
    ? { w: d.source.w, h: d.source.h }
    : { w: Math.max(16, Math.round(d.params.renderWidth)), h: Math.max(16, Math.round(d.params.renderHeight)) };
```

`selectEffectiveDims` collapses the four duplicated vars (`locked`, `lockedRef`, `lockedDims`, `lockedDimsRef`) to one derivation. Both render seams and the export sizing read it; Leva's `render: () => !locked` reads `selectLocked`.

---

## 3. LEVA BRIDGE

Leva stays the control surface. The store sits **above** Leva and owns truth. Two directed edges, one epoch guard.

```
   (A) Leva onChange ──▶ store.setParam / setMacro      [genuine user edit -> undoable]
LEVA ◀───────────────────────────────────────── STORE
   (C) history.writeback ──▶ set(changedKeys)           [undo / load / randomize / macro fan-out reflection]
```

**Edge A — Leva → store.** Refactor `controls.ts` so every control carries `onChange` dispatching into the store. Replace the current `useEffect([values])` mirror in `App.tsx` entirely.

```ts
// controls.ts
const onParam = <K extends keyof Params>(key: K) =>
  (v: Params[K], _path: string, ctx: { initial: boolean }) => {
    const s = useStore.getState();
    if (ctx.initial) return;
    if (s._writebackEpoch !== s._seenEpoch) {           // this onChange is OUR echo from Edge C
      useStore.setState({ _seenEpoch: s._writebackEpoch }); // absorb, do NOT record
      useStore.setState((d) => { d.project.params[key] = v; }); // keep base in sync silently
      return;
    }
    s.setParam(key, v);                                 // real user edit -> coalesced undo
  };
```

**Edge C — store → Leva.** Keep Leva's `set`. The history `writeback` hook bumps `_writebackEpoch` then calls `set` with only the keys that changed (surgical diff — Leva doesn't thrash unchanged rows).

```ts
// App.tsx — wire once, after Leva mounts (NOT during render; fixes the render-phase ref writes)
const { set } = useNodeVideoControls(callbacks, locked);
useEffect(() => {
  const h = useStore.getState()._history;
  h.writeback = (doc) => {
    useStore.setState((s) => { s._writebackEpoch = s._writebackEpoch + 1; });
    set({ ...doc.params, ...doc.macros });              // Leva re-fires onChange -> Edge A absorbs via epoch
  };
  return () => { h.writeback = undefined; };
}, [set]);
```

**Cycle break — epoch, not boolean.** Edge C bumps `_writebackEpoch`; Edge A sees `epoch !== seenEpoch`, absorbs the echo (syncs base silently, never records a history entry), and advances `_seenEpoch`. Epoch counters tolerate Leva coalescing or dropping a flush in a way a boolean's flip/unflip cannot. Belt and suspenders: `history.record` is a no-op when `before === after`, so even a leaked echo can't create a phantom entry. **Writeback never fires mid-drag** (undo isn't invoked while `dragOpen`), sidestepping Leva's "value in flight" fight.

**Macros survive, gain an inverse.** The current one-way `setRef`/`apply` fan-out (verified `controls.ts:41-42`, `54-113`) is deleted. Macro `onChange` becomes a thin `store.setMacro(key, v)`. `setMacro` writes the macro position AND `deriveMacro(key, v)` children in **one `commitOnce` transaction** → one undo entry rewinds the macro slider and its three children together. The resulting child values reflect back into the Leva child sliders via Edge C. Macros now persist into presets and `.nodeflow`, killing the preset desync where macro positions were lost.

**Folder-decoration MutationObserver survives untouched.** It is cosmetic DOM-injection over Leva (`App.tsx:258-309`), independent of where param truth lives — no change in P0. Adding a "Modulation" folder in P1-A means one new `FOLDER_DECOR` entry. Known fragility (folder rename breaks text matching; a future custom panel reimplements decoration natively) — flagged, not fixed.

**Render-phase side-effects removed.** `setLevaRef.current = set` (`App.tsx:251`) and the inline `setRef.current = set` (`controls.ts:178`) both move into effects. `paramsRef` and the `[values]` effect are deleted — the loop reads a vanilla store subscription mirror:

```ts
// App.tsx
const projRef = useRef(useStore.getState().project);
const viewRef = useRef(useStore.getState().view);
useEffect(() => useStore.subscribe((s) => { projRef.current = s.project; viewRef.current = s.view; }), []);
```

---

## 4. FORWARD-FIT

**P1-A (audio modulation).** The store already holds `modSources` + `modulators` (persisted, undoable) and the renderer is fed through `resolveFrame`. Shipping audio = build `SignalBank` (decode file → per-band RMS envelope as a `Float32Array` keyed by clip seconds), add the two-knob UI (Responsiveness/Depth) in a new Leva "Modulation" folder, and flip `resolveParams` from its zero-cost no-mods identity to the fold. No seam moves. The determinism guard (`clipTime` only) is baked into `FrameCtx`'s signature so no caller can pass wall-clock. LFO/keyframe later = one new `ModSource.kind` branch in `SignalBank.sample`; the `modulators[]` array already *is* the mod-matrix (source × target × depth).

**P1-B (WebGPU renderer).** The `Renderer` interface is extracted in P0 with Canvas2D as the default behind `createRenderer(flag)`. Because `resolveFrame` hands every backend already-resolved, already-scaled `Params`, the WebGPU renderer never re-implements modulation or scaling — P1-A and P1-B stay orthogonal. The documented worker deltas (renderer owns canvas via `init`, transferable `SourceFrame`, async `render`) are a localized widening of the interface when WebGPU lands; every consumer already routes through the funnel, so the swap is a factory line plus the new backend class. Canvas2D remains the fallback when `supports.webGPU()` is false.

**P1-C (export breadth: alpha / PNG-sequence / audio / 4K).** Minimal store impact. The export loop already calls the identical `resolveFrame → render` path per frame, so any new output target (alpha-preserving encode, per-frame PNG, audio mux) wraps the same resolved frame. 4K is already covered by `scaleParams` + the codec ladder (verified `encoder.ts:15`). New options are additive fields on `ExportSettings` (persisted, undoable via `patchExport`) and new branches in the encoder — no funnel change.

---

## 5. INTEGRATION PLAN

Legend: **[NEW]** create · **[MOD]** modify. Each numbered step is independently shippable and keeps the app working. Steps 1–3 are pure refactors gated on "preview == export unchanged."

### Phase 0 — Parallelizable (new isolated modules, no App.tsx coupling yet)

These have no dependency on each other and can be built concurrently. None is wired in until Phase 1.

- **[NEW] `src/store/types.ts`** — all interfaces in §2.2.
- **[NEW] `src/store/macros.ts`** — `deriveMacro` (lerp tables lifted verbatim from `controls.ts:64-111`).
- **[NEW] `src/store/selectors.ts`** — `selectLocked`, `selectEffectiveDims`.
- **[NEW] `src/store/history.ts`** — command stack (§2.4): `record`/`commitOnce`/`beginDrag`/`endDrag`/`undo`/`redo`/`clear`, 350ms coalescing, 100-depth.
- **[NEW] `src/store/store.ts`** — zustand + immer + `subscribeWithSelector`; the action surface in §2.3; routes doc mutations through history.
- **[NEW] `src/render/resolve.ts`** — `FrameCtx`, `resolveParams` (no-mods identity initially), `resolveFrame`, and the scale-factor `scaleParams` (ported from `encoder.ts:40-52`), plus `span`/`clampParam` from the `controls.ts` ranges.
- **[NEW] `src/render/renderer.ts`** — `Renderer` interface + `createRenderer` factory.
- **[NEW] `src/util/browser.ts`** — `supports` capability util.
- **[NEW] `src/project/schema.ts`** — `NodeflowFile`, serialize/deserialize, `migrate` ladder (v1 identity).
- **[NEW] `src/project/persistence.ts`** — IndexedDB autosave + FS Access save/open + recents.
- **[NEW] `src/audio/signalBank.ts`** — stub for P1-A: `SignalBank` interface + a no-op `sample` returning 0 (so `resolveParams` compiles before audio ships).

### Phase 1 — Sequential (the risky middle; order matters)

Each depends on the prior. Do not parallelize.

1. **[MOD] `src/params.ts`** — delete `raw` from `Params` and `DEFAULT_PARAMS`. Smallest change; removes the structural lie, unblocks a clean `Params`. Introduce `RenderParams = Params & { raw?: boolean }` (in `resolve.ts`); `resolveFrame` returns it; `Renderer.render`/`compose.ts` read `p.raw` off `RenderParams`.
2. **[MOD] `src/render/compose.ts`** — rename class `Renderer` → `Canvas2DRenderer implements Renderer`, add `backend = "canvas2d"`, keep `render` signature byte-identical (param typed `RenderParams`). `p.raw` read at line 113 is unchanged (it's injected by `resolveFrame`).
3. **[MOD] `src/export/encoder.ts`** — import `createRenderer`; move `scaleParams` into the per-frame loop as `resolveFrame(..., {scale})`; add `macros`, `modSources`, `modulators`, `signalBank` to `ExportOptions`; key resolve on `clipTime = i/fps`. **Gate: exported mp4 byte-identical to pre-change (no-mods path).**
4. **[MOD] `src/ui/controls.ts`** — every control gets `onChange: onParam(key)`; macros become `onMacro(key) → store.setMacro`; delete `setRef`/`apply`/the inline `setRef.current = set` (`controls.ts:42, 174-178`); `deriveMacro` now owns the lerps. Keep the render-time `cb.current` for preset buttons or move to a ref-in-effect.
5. **[MOD] `src/App.tsx` — store wiring.** Add `projRef`/`viewRef` mirrors + the `useStore.subscribe` effect. **Delete:** `paramsRef` + its `[values]` effect (253-255), `setLevaRef` (251), `rawRef` + `raw` state (collapse to `view.raw`), `lockedRef`/`locked`/`lockedDimsRef`/`lockedDims` (→ `selectEffectiveDims`/`selectLocked`), `exportCfgRef`/`exportCfg` (→ `project.export`). Render loop reads `projRef.current` + `resolveFrame` at the live seam (was `App.tsx:343-353`). **Gate: live preview visually unchanged.**
6. **[MOD] `src/App.tsx` — Edge C writeback + undo.** Wire `history.writeback` in an effect; add `onPointerDownCapture={beginDrag}`/`onPointerUpCapture={endDrag}` on the Leva panel container; bind ⌘Z/⌘⇧Z → `store.undo/redo`. **Gate: a writeToLeva must not grow history (write the test before building on it).**
7. **[MOD] `src/App.tsx` — structural dispatch + autosave + project files.** Source swap routes through `setSource` (undoable) and a subscription on `project.source` identity re-runs the runtime reset (`stateRef = createState()`, `frameRef = 0` — currently only `swapSource` does this at `App.tsx:141`). Wire `startAutosave`; on boot `loadAutosave() → loadProject`; convert `savePreset`/`loadPresetFile` to the project subset; add re-link flow on file-source load.

### Phase 2 — P1 features (drop into stable seams)

8. **[MOD] `src/audio/signalBank.ts`** + Modulation Leva folder + flip `resolveParams` to the fold (P1-A).
9. **[NEW] `src/render/webgpu/renderer.ts`** behind the `createRenderer("auto")` flag (P1-B).
10. Export breadth options on `ExportSettings` + encoder branches (P1-C).

---

## 6. RISKS

**1 — The Edge A/C cycle records its own writeback echoes (make-or-break of step 6).** If undo's store→Leva reflection re-enters as a fresh user edit, every undo spawns a phantom history entry and undo "sticks." *Mitigation:* monotonic epoch guard (not boolean — Leva's flush is sync today but a boolean races if Leva ever batches), absorb-don't-record on epoch mismatch, plus `record` is a no-op when `before === after`. Write the test first: `writeback(doc)` → assert `history.length` unchanged, before building step 7 on top.

**2 — Modulation determinism: sampling the wrong time axis.** A modulator keyed on the free-running `frameRef` (pauses during export) instead of `clipTime` (shared by both paths) makes preview ≠ export — invisible until you open the exported file. *Mitigation:* `FrameCtx.clipTime` is the only time a modulator may read; `SignalBank.sample` takes clip seconds, never a frame index; review/lint for `frameRef` access inside `signalBank.ts`. For generated source (`duration === null`, `currentTime === 0`), `clipTime = frame / fps` — itself a pure function of frame, so it still matches.

**3 — `scaleParams` × modulation ordering (step 3).** Resolve modulators on the unscaled base first, THEN scale pixel params. Wrong order double-scales or mis-scales modulated pixel values. *Mitigation:* the order is baked into `resolveFrame` (resolve → scale → raw-inject) so both backends receive resolved-then-scaled params and neither can reorder it.

**4 — Drag coalescing misses (step 6).** Leva exposes no pointer-up; a slider drag fires dozens of `onChange`s. If coalescing fails, one drag = dozens of undo steps. *Mitigation:* pointer-bracket the Leva panel (`onPointerDownCapture`/`Up` → `beginDrag`/`endDrag`) as primary; 350ms same-label time-window as fallback for keyboard/number-field edits with no pointer bracket.

**5 — Structural-edit reset not flowing through dispatch (step 7).** Undoing a source swap must re-run `createState()` + `frameRef = 0`, or stale `prevLuma`/`trail`/`tracked` glitch the first post-undo frames. A pure-param store can't do this. *Mitigation:* `setSource` is undoable; a subscription watching `project.source` reference identity owns the runtime reset side-effect — never reset implicitly. Same subscription drives the file-source re-link prompt.

---

**Files this spec governs.** Modified: `src/params.ts`, `src/ui/controls.ts`, `src/App.tsx`, `src/render/compose.ts`, `src/export/encoder.ts`. New: `src/store/{types,store,history,macros,selectors}.ts`, `src/render/{resolve,renderer}.ts`, `src/project/{schema,persistence}.ts`, `src/audio/signalBank.ts`, `src/util/browser.ts`.
