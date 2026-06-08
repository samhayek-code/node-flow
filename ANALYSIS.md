# Node-Flow → industry-grade creative tooling

A deep analysis of where Node-Flow stands and what it takes to be a tool professional
creatives reach for. No code changed — these are notes.

Sources reviewed: the codebase itself; Interface Craft (Storyboard Animation, DialKit,
Design Critique — Josh Puckett); the impeccable design laws; the Remotion reference;
CLAUDE.md design playbooks; and fresh research on GPU rendering, keyframing systems,
and pro export pipelines (links at the end).

---

## Verdict

Node-Flow today is a **polished single-purpose instrument** — one of the better-crafted
hobby-grade web tools you'll see. The UI is genuinely strong: dark/grain aesthetic,
hairline structure, mono technical labels, color-coded sections, a real export pipeline.

But "industry-grade for professional creatives" is a different bar. Three structural
truths separate it from that bar:

1. **It has no time dimension.** Every parameter is a constant for the whole clip.
   Professional motion tools are *fundamentally* about change over time (keyframes,
   curves, automation). This is the single biggest gap.
2. **It's CPU/Canvas2D on the main thread.** That caps resolution, frame-rate, and
   effect complexity — exactly the ceilings pros hit first.
3. **It's a viewer, not a document.** No undo, no project files, no layers/stacking.
   Pros work in revisable documents, not disposable sessions.

Everything else (export breadth, reliability, distribution, the Leva ceiling) is real
but secondary to those three.

---

## The 5 highest-leverage moves

In priority order. Each is a "this is why a pro would switch" move.

1. **A timeline with parameter keyframes + easing.** Animate any param over time.
   This is the defining capability of the category (After Effects, Cavalry, Rive) and
   the thing Node-Flow most conspicuously lacks. Even a minimal version — keyframes per
   param + an easing curve + an LFO/audio modulator — changes what the tool *is*.
2. **Move the render pipeline to the GPU (WebGL2 now, WebGPU next) in a Web Worker via
   OffscreenCanvas.** Removes the resolution/fps ceiling, unblocks the UI, unlocks
   real effects (blur, bloom, displacement, feedback). WebGPU integrates with WebCodecs
   with no GPU↔CPU copy — ideal for video.
3. **A real document model: undo/redo + project files + autosave.** Make the work
   safe to do. This is table stakes pros assume without thinking.
4. **Export breadth: alpha/transparency, image sequences (PNG), audio passthrough,
   4K, and streamed (not in-memory) output.** The difference between "fun to play with"
   and "usable in my pipeline."
5. **Effect stacking + layers (non-destructive).** One effect at a time is a toy
   constraint. Stacks with blend modes are how creatives actually compose.

---

## Detailed analysis by dimension

Severity: **[C]** critical to the "pro" claim · **[H]** high · **[M]** medium · **[L]** low.

### 1. Creative capability — the time dimension  **[C]**

- **No keyframing / automation.** Params are static. *Target:* per-parameter keyframes
  on a timeline, with an easing/graph editor (bezier + presets). Reference models:
  After Effects' Graph Editor and Rive/Cavalry easing. Remotion's `interpolate()` /
  `spring()` is a clean mental model for frame→value mapping and is worth borrowing
  directly (the export already runs frame-by-frame, so it's a natural fit).
- **No modulators.** Beyond manual keyframes, the high-art payoff is **audio-reactivity**
  (FFT → drive size/threshold/effect) and **LFOs** (sine/noise oscillators on any param).
  For a tool that makes music visuals and generative art, this is huge and differentiating.
- **No path/expression layer.** Lower priority, but linking params (e.g. "connector
  width follows blob energy") is what makes Cavalry feel procedural.

### 2. Performance & rendering  **[C]**

- **Whole pipeline is main-thread CPU Canvas2D.** Per frame: full-frame `getImageData`,
  JS pixel loops (`blockAvg`, dither quantize), `putImageData`. Measured ~75fps at
  960×540, ~37–44fps on a 1080p-ish portrait clip, and 4K would be unusable. This is
  the ceiling pros hit immediately.
- **No OffscreenCanvas / Web Worker.** Heavy frames jank the UI; export blocks
  interaction. *Target:* render in a worker via OffscreenCanvas; keep the main thread
  for UI only.
- **No GPU.** Canvas2D can't do real blur/bloom/displacement/feedback shaders, and
  caps resolution. *Target:* WebGL2 fragment-shader effect passes now; WebGPU compute
  for motion-diff + effects next. Research shows WebGPU is ~100×+ for this class and,
  critically, integrates with WebCodecs with **no GPU↔CPU copy** — the right long-term
  substrate for a video tool.
- **Per-frame allocations** (`createImageData` each effect frame; motion `Float32Array`s).
  GC pressure. *Target:* reuse buffers; double-buffer.
- *Note:* the CPU/Canvas2D choice was deliberate (hackable JS effects). The honest
  framing: that was right for v1 and is now the main thing standing between this and pro.
  Keep the pluggable-effect ergonomics, but the substrate needs to become GPU.

### 3. Color & output fidelity  **[H]**

- **Implicit sRGB, 8-bit, gamma-space blending.** Dither quantization and box compositing
  happen in gamma space, not linear — technically incorrect (visible banding/!color
  shifts in gradients). *Target:* process in linear light, dither in linear, output sRGB.
- **No color management** (no working-space choice, no display transform). Pros doing
  deliverables care. At minimum: document sRGB, get blending linear.
- **UI color** also violates a couple impeccable laws worth fixing: pure `#000`/`#fff`
  appear (impeccable: never pure black/white; tint neutrals toward the brand hue; prefer
  OKLCH). Low-stakes but it's the kind of detail that reads as "crafted."

### 4. Export pipeline  **[H]**

- **Format breadth.** Only H.264 mp4. Missing, in rough priority: **alpha/transparency**
  (VP9-alpha/WebM or ProRes 4444 — essential for compositing into other tools),
  **image sequences (PNG/EXR)** (the lingua franca of pro pipelines), **audio passthrough**
  (file-source audio is dropped today), **H.265/VP9/AV1/WebM/GIF**, and **quality/CRF**
  control vs. raw bitrate.
- **In-memory muxing** (`ArrayBufferTarget`) holds the whole file in RAM → caps long/4K
  exports. *Target:* stream to disk via the File System Access API (`createWritableStream`)
  or `StreamTarget`.
- **No render queue / batch / cancel.** Pros export many variants. A queue + cancel +
  per-job settings is expected.
- **File-source export uses per-frame `seekTo`** (works, but slow and seek-precision
  dependent). *Target:* WebCodecs `VideoDecoder` fed from a demuxer for true frame-accurate
  decode (already flagged in the README).

### 5. Document & state model  **[C]**

- **No undo/redo.** Every change is destructive. *Target:* a command/history stack
  (or a state store with time-travel — zustand+immer, or a small custom undo manager).
  This also forces a cleaner single source of truth than today's refs+Leva+React mix.
- **No project files / autosave / recent.** Presets save params JSON only — not the
  source, keyframes, or export config. *Target:* a `.nodeflow` project (source reference,
  params, keyframes, export settings, version), autosave to IndexedDB, recent-files list.
- **No layers / effect stacking.** Single effect, single source. *Target:* a layer/stack
  model (multiple effects with blend modes; eventually multiple sources/masks). This is
  the non-destructive workflow pros assume.

### 6. Architecture & code health  **[H]**

- **`App.tsx` is a ~600-line god component** (render loop, zoom/pan, export, presets,
  Leva DOM-decoration, transport, drag-drop). *Target:* extract hooks — `useRenderLoop`,
  `useZoomPan`, `useExport`, `useSource`, `useLevaDecoration` — and split components.
- **Leva is being fought, not used.** Folder icons/colors are injected by a
  `MutationObserver` that walks Leva's hashed-class DOM and matches title text. It has
  already broken twice (the `disabled`-prop value-parse bug; the nested-container wrapper
  bug). It works, but it's load-bearing fragility. *Target (medium-term):* a purpose-built
  control panel. It's a real lift, but it's the ceiling on UI quality, per-control color,
  custom widgets (curve editors, XY pads, the timeline), and removes the DOM hacks.
- **No tests, no CI.** *Target:* unit tests for pipeline math (motion/blobs/connectors,
  effect determinism), a visual-regression harness on `compose` output (golden frames),
  an E2E that asserts a valid mp4 comes out, and a GitHub Action running typecheck +
  lint + test + build on PR. For "industry-grade," this is non-negotiable.
- **Type escapes.** Several `as never` / `as unknown` casts around Leva `set` and the
  DOM decoration. Fine pragmatically; a custom panel removes most of them.
- **Effects plugin model is good** (the `EffectImpl` contract + registry is the strongest
  part of the architecture). Preserve this ergonomic when moving to GPU — a `GpuEffect`
  contract (shader + uniforms) mirroring today's `EffectImpl`.

### 7. Reliability & trust  **[H]**

- **No error boundary.** A render exception white-screens the app (already seen: the
  0-dimension `drawImage` error killed the loop). *Target:* a React error boundary +
  a try/catch around the render tick that surfaces a recoverable error, not a crash.
- **Browser support is silent.** Export needs WebCodecs (Chrome/Edge). Safari/Firefox
  users get a dead button. *Target:* feature-detect and message clearly; degrade the
  preview where possible.
- **No telemetry/crash reporting** (e.g. Sentry) and no performance budget. Pros forgive
  bugs that are acknowledged; they abandon tools that silently fail.

### 8. UX for professionals  **[H]**

Run through the Interface Craft critique lenses, the pro-tool gaps are:

- **No keyboard shortcuts / command palette.** Pros live on the keyboard (space = play,
  `[`/`]` = trim, `⌘Z` = undo, number keys = tools). A command palette (⌘K) is now an
  expected pro affordance.
- **Fixed panels.** The 340px sidebar isn't resizable/collapsible/dockable. Pros tune
  their workspace.
- **No onboarding / templates / sample gallery.** First run drops you into a generated
  pattern with no "here's what's possible." A few built-in preset *looks* (thumbnails)
  and a sample clip would teach the tool in seconds. (You floated this earlier — it's
  also an activation/retention lever.)
- **No inspector for the selected blob/element.** Per-element control (lock, label,
  pin a blob) is a natural pro need once there are layers.
- **Feedback & reward gaps** (Interface Craft "uncommon care"): export success could
  show a thumbnail + reveal-in-folder; randomize could animate the transition between
  looks; empty/error/loading states can carry more personality.

### 9. Motion & interaction polish  **[M]** (from Interface Craft + impeccable)

The app is a real-time instrument, so *its own* motion should feel as considered as the
art it makes:

- **Spring-first micro-interactions.** Interface Craft: prefer spring physics over
  duration easing; impeccable: ease-out-expo, no bounce/elastic, never animate layout
  properties. Apply to: panel expand/collapse, modal enter, source-switch crossfade,
  randomize transition, toast.
- **DialKit-style "live tuning" feel.** The whole product *is* DialKit conceptually.
  Lean into it: value scrubbing with momentum, snap points, double-click-to-reset,
  alt-drag for fine control, visual feedback on the canvas while dragging a param.
- **Storyboard the canvas transitions.** Source load, raw-toggle, and export-start are
  "scenes" — give them short, named, choreographed transitions rather than hard cuts.
- **Zoom-to-cursor** (currently center-zoom) and inertial pan — the expected feel for a
  canvas tool (Figma standard).

### 10. Distribution  **[M]**

- **No PWA / offline.** Low effort, high signal: installable, works offline, feels like
  an app. A creative tool that runs offline at native-ish speed is taken more seriously.
- **No desktop wrapper.** A Tauri build gives native file access (big/streamed exports),
  local-file performance, and a real app icon — without leaving the web codebase.
- **No sharing/embedding.** Shareable look-links (encode params in a URL) and an embed
  mode would seed a community and a preset ecosystem.

---

## Aesthetic / craft notes (impeccable + Interface Craft critique)

The UI is already good; these are the "great vs. good" deltas:

- **Kill pure `#000`/`#fff`** in tokens; tint neutrals toward the blue brand hue (OKLCH,
  chroma 0.005–0.01). The canvas art can stay true black; the *chrome* shouldn't be.
- **Typographic scale.** Confirm ≥1.25 ratio between steps (wordmark → labels → values).
  Mono for technical/numeric (good already), sans for everything else.
- **Motion law:** audit every transition for ease-out-expo, no layout animation,
  correct transform-origin, interruptible. The grain is good; keep `backdrop-filter`
  off anything over the live canvas (already learned that the hard way).
- **Uncommon care list to mine:** export-complete reveal, randomize crossfade,
  per-blob hover affordance, first-run state, "what changed" feedback when a macro moves
  a group of sliders.

---

## Suggested phasing (if we pursue this)

**P0 — make it trustworthy (foundation).**
Error boundary + render-loop guard · undo/redo + single state store · project files +
autosave · tests + CI · browser-support messaging. *Nothing fancy; everything pros assume.*

**P1 — make it pro-capable (the differentiators).**
Timeline + parameter keyframes + easing · audio-reactivity / LFO modulators ·
GPU render pipeline (WebGL2) in a worker · export breadth (alpha, PNG sequence, audio,
streamed output).

**P2 — make it a platform.**
Effect stacks + layers + blend modes · custom control panel (retire Leva) · command
palette + shortcuts + dockable panels · WebGPU substrate · PWA + Tauri desktop ·
shareable look-links + preset gallery.

Sequence rationale: P0 first because a tool that loses work or white-screens never earns
pro trust, regardless of features. P1 is the "why switch." P2 is the moat.

---

## Sources

- Interface Craft (Josh Puckett): Storyboard Animation, DialKit, Design Critique —
  `~/.claude/skills/interface-craft/`
- impeccable design laws — `~/.claude/skills/impeccable/SKILL.md`
- Web Interface Guidelines — `~/.claude/skills/web-design-guidelines/`
- Remotion reference (frame-based `interpolate`/`spring`, sequences) —
  `~/Desktop/Code/claude-learn/reference/video/remotion.md`
- WebGPU vs WebGL performance & WebCodecs integration —
  https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu ·
  https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API
- Keyframe/easing models — After Effects keyframe interpolation
  (https://helpx.adobe.com/after-effects/using/keyframe-interpolation.html) ·
  Cavalry Time Editor (https://docs.cavalry.scenegroup.co/) · Rive easing
- Canvas/WebGL/WebGPU trade-offs —
  https://www.svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025
