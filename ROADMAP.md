# Node-Flow build roadmap

The plan to take Node-Flow from a polished single-purpose tool to industry-grade
creative tooling. Derived from `ANALYSIS.md` and prioritized to your direction:

- **GPU pipeline** — elevated; **WebGPU-first** (most modern), Canvas2D as the fallback
- **Audio-reactivity** — elevated, but **simple to start**: a music file + two knobs
  (Responsiveness, Depth), on an engine we can expand later
- **Export breadth** — included but kept lean
- **Layers / effect stacks, custom control panel** — deferred (kept as notes, not dropped)

This file is the source of truth for the build. Each task is scoped to ship and verify
on its own.

---

## Guiding principles

1. **Preserve the WYSIWYG core.** One pure render path drives both preview and export.
   Every change keeps that invariant (exports match preview).
2. **Keep effects pluggable.** The `EffectImpl` contract is the best part of the
   architecture. The GPU work mirrors it as `GpuEffect`; new capabilities don't break
   the "one file per effect" ergonomic.
3. **Substrate-agnostic features.** Parameter automation (audio/LFO/keyframes) sets
   *values*; it must not care whether the renderer is Canvas2D or GPU. Build it once.
4. **Ship behind flags for risky swaps.** The GPU pipeline lands behind a flag with the
   Canvas2D path intact until it reaches visual parity.
5. **Tests + CI from here on.** Every task adds/extends tests; CI must stay green.
   No more "white-screen on a render error" surprises.
6. **Atomic commits, verify each task in-browser** before moving on (per the Long Builds
   protocol). The spec — this file — is the source of truth, not chat history.

Effort key: **S** ≈ hours · **M** ≈ half-day · **L** ≈ 1–2 days · **XL** ≈ multi-day.

---

## Recommended sequence (why this order)

1. **P0 Foundation** first — specifically the **state store**, because the modulation
   engine, undo, and project files all depend on a single source of truth. A tool that
   loses work or white-screens never earns pro trust regardless of features.
2. **Audio-reactivity / modulation (P1-A)** next — it's your top want, it's *contained*,
   and it's substrate-agnostic, so it works on today's Canvas2D and survives the GPU swap.
   High delight, moderate risk.
3. **GPU pipeline (P1-B)** — the biggest infrastructural change; **WebGPU-first** with
   the existing Canvas2D path as the fallback. Do it once the foundation is solid and the
   contained audio win is banked. Behind a flag until parity.
4. **Export breadth (P1-C)** — lean additions, partly easier once the GPU path exists.

You can reorder B and A if GPU feels more urgent; they don't conflict (A modulates
params, B swaps the renderer).

---

## P0 — Foundation (make it trustworthy)

The unglamorous layer pros assume. Do this before the big features.

### F1 — State store + undo/redo  · L
- **Goal:** one source of truth; `⌘Z` / `⌘⇧Z` work everywhere.
- **Scope:** introduce a store (zustand + immer, or a small custom store) holding params,
  source meta, export cfg, and (later) modulators. Bridge Leva: Leva `onChange` → store;
  store → Leva `set`. Command/history stack with coalescing for slider drags.
- **Files:** new `src/state/store.ts`, `src/state/history.ts`; refactor `App.tsx` refs +
  `ui/controls.ts` to read/write the store.
- **Accept:** every param change is undoable/redoable; refs+scattered React state for
  params are gone; keyboard shortcuts wired.
- **Risk:** Leva has its own store; keep the bridge thin. (This is also where a future
  custom panel would slot in — see P2.)

### F2 — Error boundary + render-loop guard  · S
- **Goal:** a render exception degrades gracefully, never white-screens.
- **Scope:** React error boundary around the app shell; try/catch around the render tick
  that pauses the loop and shows a recoverable overlay ("Rendering paused — reset").
- **Files:** new `src/ui/ErrorBoundary.tsx`; guard in the loop in `App.tsx`.
- **Accept:** force a render error → recoverable overlay + working reset, loop resumes.

### F3 — Project files + autosave  · L
- **Goal:** work is safe and resumable.
- **Scope:** `.nodeflow` JSON (version, source metadata, params, modulators, export cfg).
  Save/Open via File System Access API (fallback to download/upload). Autosave to
  IndexedDB; restore on reload; recent-files list. Media can't be embedded — store source
  metadata and **prompt to re-link** on open (generated source is fully serializable).
- **Files:** new `src/state/project.ts`, `src/state/persistence.ts`; UI in Source section.
- **Accept:** reload restores the last session; save→open round-trips a project; re-link
  flow works for file sources.

### F4 — Tests + CI  · M
- **Goal:** changes can't silently break the pipeline or export.
- **Scope:** Vitest. Unit tests for pipeline determinism (motion/blobs/connectors,
  effect output hashes). A **golden-frame** test: render N frames of the generated source
  through `compose`, hash, compare. Export smoke test: `renderToMp4` → valid `ftyp` +
  non-trivial size. ESLint + Prettier. GitHub Action: typecheck + lint + test + build on PR.
- **Files:** `src/**/*.test.ts`, `.github/workflows/ci.yml`, eslint/prettier config.
- **Accept:** CI green on push; pipeline + export covered; a deliberate regression fails CI.

### F5 — Browser-support gating  · S
- **Goal:** no dead buttons on unsupported browsers.
- **Scope:** feature-detect WebCodecs/OffscreenCanvas; banner if the preview/export can't
  run; gate the Export button with a clear message + what to use instead.
- **Accept:** Safari/Firefox show clear messaging; Chrome/Edge unaffected.

---

## P1-A — Audio-reactivity (simple now, extensible later)  ★ top priority

The headline feature, scoped small to start: drop in a **music file**, get two knobs —
**Responsiveness** and **Depth** — and the visuals move to the sound. Built on a general
**modulation engine** (effective value = base + modulators) so we can later add per-band
targeting, LFOs, mic input, and keyframes without rework.

### A1 — Modulation engine  · M
- **Goal:** any numeric param can be driven by a signal, deterministically.
- **Scope:** a `Modulator` type `{ source, target: ParamKey, amount, mode }` and a pure
  `resolveParams(base, mods, ctx)` step (`ctx = { time, audioFrame }`) in the render loop.
  Substrate-agnostic — outputs the same `Params` the renderer consumes. Deterministic
  (driven by frame time, not wall-clock) so preview and export match. Keep it general even
  though v1 only ships one source (audio); LFO/keyframe sources slot in later.
- **Files:** new `src/modulation/`.
- **Accept:** a hardcoded modulator drives a param identically in preview and export.

### A2 — Audio analysis from a music file  · L
- **Goal:** turn a dropped-in track into a usable signal.
- **Scope:** load a **separate audio/music file** (v1 source). **Preview:** WebAudio
  `AnalyserNode` (FFT) → overall level + bass/mid/treble, smoothed. **Export determinism:**
  decode the file and run offline FFT per frame timestamp (not the live analyser) so the
  rendered mp4 matches. Both paths share the band-extraction math; only the FFT source
  differs. (Video-track audio and mic come later — same interface.)
- **Files:** `src/audio/analyser.ts` (live), `src/audio/offline.ts` (export).
- **Accept:** load a track → the engine gets a smoothed signal; preview and export produce
  identical motion.

### A3 — Simple Audio controls (Responsiveness + Depth)  · S
- **Goal:** two knobs, instant payoff.
- **Scope:** an **Audio** section: load-track button + a level meter, **Responsiveness**
  (attack/release smoothing — how snappily it reacts) and **Depth** (overall modulation
  amount). Ship a sensible **default mapping** (audio level/bass → a small set of params,
  e.g. Size + threshold) so it "just works" with two controls. Lives in the current Leva
  panel for now.
- **Accept:** load a music file, raise Depth, and the visuals visibly pulse to the track;
  Responsiveness changes how tight/loose it feels; it survives export unchanged.

> **Control panel:** keep **Leva** for now (bridge it to the P0 store). The two audio
> knobs fit it fine. A custom panel is deferred (see notes) — it's what later makes a full
> mod-matrix / curve editor / timeline first-class and removes the DOM-hacks.

> **Expand later (deferred):** a full **mod-matrix** (any source → any param), per-band
> targeting, **LFO** modulators, **mic** input (preview-only), and **keyframes/timeline**
> all plug into the A1 engine. The engine is built to accept them; ship when we want depth.

---

## P1-B — GPU render pipeline (WebGPU)  ★ very important

The performance ceiling-lift, on the current-generation API. **WebGPU-first**; the
existing Canvas2D pipeline stays as the **fallback** for browsers without WebGPU (we reuse
what's built — no third path). Lands behind a flag until visual parity, then becomes the
default where supported.

*Why WebGPU over WebGL2:* compute shaders, far lower CPU overhead, and **zero-copy** interop
with WebCodecs `VideoFrame` (no GPU↔CPU round-trip for video). You're already Chrome/Edge-
only for export, so narrower support costs little, and non-WebGPU browsers get the Canvas2D
preview. Supported today in Chrome/Edge and Safari 18+; Firefox rolling out → fallback.

### G1 — WebGPU + worker scaffolding  · L
- **Scope:** OffscreenCanvas → Web Worker; WebGPU device/context; a fullscreen-quad
  render-pass framework with ping-pong textures; upload source frames via
  `importExternalTexture` / `copyExternalImageToTexture` from `VideoFrame`/`ImageBitmap`.
  Feature-detect → fall back to the Canvas2D renderer. Main thread does UI only.
- **Files:** new `src/render/gpu/` (worker, device, passes); a `Renderer` interface so
  Canvas2D and WebGPU are swappable behind a flag.
- **Accept:** source renders via WebGPU in a worker at 60fps, main thread free; unsupported
  browsers transparently use Canvas2D.

### G2 — Port effects to WGSL  · L
- **Scope:** a `GpuEffect` contract (WGSL fragment shader + uniforms) mirroring
  `EffectImpl`. Port dither, halftone, pixelate, threshold, scanlines, edges, chromatic,
  solarize, invert. Process in **linear light**, output sRGB (fixes today's gamma-space
  blending — see ANALYSIS color note).
- **Accept:** every effect at parity-or-better; target 1080p ≥60fps, 4K usable.

### G3 — Motion / blobs / overlays on the GPU path  · M
- **Scope:** frame-diff in a shader (or compute pass); read back a **downscaled** motion
  texture for CPU connected-components blob extraction (sequential — cheap from a tiny
  readback). Vector overlays (boxes, connectors, shapes) on a 2D layer over the GPU canvas.
- **Accept:** blob tracking + connectors + boxes at full visual parity with Canvas2D.

### G4 — Export through the GPU path  · M
- **Scope:** export renders frames through the WebGPU pipeline → `VideoFrame` → encoder,
  frame-perfect. WebGPU↔WebCodecs interop avoids the readback the Canvas2D path needs.
- **Accept:** exported mp4 matches the GPU preview; WYSIWYG holds. Canvas2D retained as the
  fallback for non-WebGPU environments.

---

## P1-C — Export breadth (kept lean)

Only the high-value formats. Explicitly skipping render queues, H.265/AV1, ProRes, EXR.

### E1 — Alpha / transparent export  · M
- **Scope:** render with a transparent background; export WebM (VP9 alpha, or VP8-alpha).
- **Accept:** a transparent-background clip composites cleanly into another tool.

### E2 — PNG image sequence  · S
- **Scope:** export frames as numbered PNGs in a `.zip`. Highest value-to-effort ratio for
  pro pipelines; no codec complexity.
- **Accept:** a `.zip` of `frame-0001.png …` at the chosen resolution.

### E3 — Audio passthrough  · M
- **Scope:** when the source is a file with audio, mux its audio (trimmed to the export
  range) into the exported mp4.
- **Accept:** exported mp4 carries the source audio, in sync.

### E4 — 4K + quality control  · S
- **Scope:** ensure the existing %-based export reaches 4K on the GPU path; add a
  quality/CRF-style control alongside bitrate; keep the filesize estimate honest.
- **Accept:** a 4K export succeeds via the GPU path.

---

## Deferred — notes, not now

Captured so they're not lost. Revisit after P1.

- **Timeline + keyframes** — extends the P1-A modulation engine with a time→value curve
  modulator + a graph/curve editor. The engine is being built to accept this; the timeline
  UI is the remaining work. High value; natural next step after audio.
- **Full modulation depth** — also extends the P1-A engine: a mod-matrix (any source → any
  param), per-band audio targeting, LFO modulators, and mic input (preview-only). Ships
  when the simple two-knob version proves the concept.
- **Layers + effect stacks + blend modes** *(you asked to defer)* — non-destructive
  compositing: multiple effects with blend modes, eventually multiple sources/masks. The
  single-effect model is the current ceiling on composition. Big but high-impact.
- **Custom control panel (retire Leva)** — removes the MutationObserver DOM-hacking,
  enables native curve editors / XY pads / the mod-matrix / per-control color, and a
  resizable/dockable workspace. Unlocks UI quality but is a real lift.
- **Command palette (⌘K) + full keyboard shortcuts + dockable panels.**
- **PWA + Tauri desktop** — offline + native file performance + bigger/streamed exports.
- **Shareable look-links + preset gallery** — encode params/modulators in a URL; seed a
  community.

---

## Milestones

- **M1 — Trustworthy** (P0 done): undo, autosave, no crashes, CI green.
- **M2 — Reactive** (P1-A done): drop in a music file, two knobs make the visuals move,
  deterministic in export. *The first "whoa" demo.*
- **M3 — Fast** (P1-B done): WebGPU pipeline at 1080p ≥60fps / 4K usable, parity,
  default where supported (Canvas2D fallback).
- **M4 — Deliverable** (P1-C done): alpha, PNG sequence, audio, 4K out.

After M4, Node-Flow is credibly pro-grade for solo motion/generative work; the deferred
list (timeline, layers, custom panel, desktop) is the path to a platform.
