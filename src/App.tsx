import { useCallback, useEffect, useRef, useState } from "react";
import { Leva } from "leva";
import { Shuffle, Download, Sparkles, Film, Play, Pause, Workflow, Boxes, Activity, Maximize2, Eye, EyeOff, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import slidersIcon from "lucide-static/icons/sliders-horizontal.svg";
import monitorIcon from "lucide-static/icons/monitor.svg";
import activityIcon from "lucide-static/icons/activity.svg";
import shapesIcon from "lucide-static/icons/shapes.svg";
import splineIcon from "lucide-static/icons/spline.svg";
import wandIcon from "lucide-static/icons/wand-2.svg";
import filmIcon from "lucide-static/icons/film.svg";
import bookmarkIcon from "lucide-static/icons/bookmark.svg";
import { Renderer } from "./render/compose";
import { createState } from "./pipeline/types";
import type { FrameSource } from "./pipeline/source";
import { GeneratedSource, createFileSource } from "./pipeline/source";
import { useNodeVideoControls } from "./ui/controls";
import { DEFAULT_PARAMS, DEFAULT_EXPORT } from "./params";
import type { Params, ExportSettings, EffectType, BoxShape, ConnectorStyle } from "./params";
import "./app.css";

const PARAM_KEYS = Object.keys(DEFAULT_PARAMS).filter((k) => k !== "raw");
const EXPORT_KEYS = Object.keys(DEFAULT_EXPORT);

const LEVA_THEME = {
  colors: {
    elevation1: "#0b0b0d",
    elevation2: "#141418",
    elevation3: "#1d1d22",
    accent1: "#2f6fed",
    accent2: "#3b82f6",
    accent3: "#60a5fa",
    highlight1: "#6e6e77",
    highlight2: "#a8a8b0",
    highlight3: "#f2f2f4",
    vivid1: "#3b82f6",
  },
  sizes: {
    controlWidth: "126px",
    numberInputMinWidth: "62px",
    rowHeight: "30px",
    folderTitleHeight: "32px",
  },
  fontSizes: { root: "12.5px" },
  fonts: {
    sans: "Geist Variable, ui-sans-serif, system-ui, sans-serif",
    mono: "Geist Mono Variable, ui-monospace, monospace",
  },
  space: { rowGap: "8px", md: "10px" },
  radii: { xs: "2px", sm: "2px", lg: "2px" },
} as const;

/** Color + lucide icon per Leva folder, applied to the title by text match. */
const FOLDER_DECOR: Record<string, { color: string; icon: string }> = {
  Global: { color: "#3b82f6", icon: slidersIcon },
  Render: { color: "#94a3b8", icon: monitorIcon },
  Motion: { color: "#2dd4bf", icon: activityIcon },
  Blobs: { color: "#fbbf24", icon: shapesIcon },
  Connectors: { color: "#a78bfa", icon: splineIcon },
  Effect: { color: "#f472b6", icon: wandIcon },
  Export: { color: "#34d399", icon: filmIcon },
  Presets: { color: "#9ca3af", icon: bookmarkIcon },
};

const PALETTE = ["#ffffff", "#6ea8fe", "#ff6b6b", "#ffd166", "#06d6a0", "#f72585", "#4cc9f0", "#80ffdb", "#ff9e00", "#b5179e"];
const RAND_EFFECTS: EffectType[] = ["dither", "halftone", "ascii", "pixelate", "threshold", "scanlines", "edges", "chromatic", "solarize"];
const RAND_SHAPES: BoxShape[] = ["rect", "circle", "ellipse", "diamond"];
const RAND_CONNECTORS: ConnectorStyle[] = ["curved", "straight", "none"];
const pickOne = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randf = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Randomize aesthetic params plus the Global macros (which cascade to their
 *  groups — so motion/density/boldness move too). */
function randomLook(): Record<string, number | string | boolean> {
  return {
    responsiveness: Number(randf(0.25, 0.9).toFixed(2)),
    density: Number(randf(0.3, 0.85).toFixed(2)),
    boldness: Number(randf(0.25, 0.85).toFixed(2)),
    effect: pickOne(RAND_EFFECTS),
    effectScope: Math.random() < 0.7 ? "blobs" : "full",
    levels: Math.round(randf(2, 6)),
    mono: Math.random() < 0.3,
    invert: Math.random() < 0.2,
    effectColor: pickOne(PALETTE),
    boxShape: pickOne(RAND_SHAPES),
    boxColor: pickOne(PALETTE),
    connectorStyle: pickOne(RAND_CONNECTORS),
    connectorCurve: Number(randf(-0.5, 0.5).toFixed(2)),
    connectorColor: pickOne(PALETTE),
  };
}

function formatTime(s: number): string {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const presetInputRef = useRef<HTMLInputElement>(null);

  const sourceRef = useRef<FrameSource>(new GeneratedSource());
  const rendererRef = useRef(new Renderer());
  const stateRef = useRef(createState());
  const paramsRef = useRef<Params>({ ...DEFAULT_PARAMS });
  const frameRef = useRef(0);
  const exportingRef = useRef(false);
  const rawRef = useRef(false);
  const setLevaRef = useRef<((patch: Record<string, unknown>) => void) | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const lockedRef = useRef(false);
  const lockedDimsRef = useRef({ w: 960, h: 540 });

  const [hud, setHud] = useState({ source: "generated", w: 0, h: 0, blobs: 0, fps: 0 });
  const [transport, setTransport] = useState({ seekable: false, time: 0, duration: 0, playing: true });
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [raw, setRaw] = useState(false);
  const [locked, setLocked] = useState(false);
  const [lockedDims, setLockedDims] = useState({ w: 960, h: 540 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [showExport, setShowExport] = useState(false);
  const [exportCfg, setExportCfg] = useState<ExportSettings>(DEFAULT_EXPORT);
  const exportCfgRef = useRef<ExportSettings>(DEFAULT_EXPORT);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const swapSource = useCallback((next: FrameSource) => {
    sourceRef.current.dispose();
    sourceRef.current = next;
    stateRef.current = createState();
    frameRef.current = 0;
  }, []);

  const useGenerated = useCallback(() => {
    swapSource(new GeneratedSource());
    lockedRef.current = false;
    setLocked(false);
    flash("Source: generated");
  }, [swapSource, flash]);

  const loadFile = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const src = await createFileSource(file);
        swapSource(src);
        // Lock render dimensions to the video (fit to a sane preview size).
        const vw = src.video.videoWidth || 1280;
        const vh = src.video.videoHeight || 720;
        const fit = Math.min(1, 1280 / Math.max(vw, vh));
        const rw = Math.max(2, Math.round((vw * fit) / 2) * 2);
        const rh = Math.max(2, Math.round((vh * fit) / 2) * 2);
        lockedDimsRef.current = { w: rw, h: rh };
        lockedRef.current = true;
        setLockedDims({ w: rw, h: rh });
        setLevaRef.current?.({ renderWidth: rw, renderHeight: rh });
        setLocked(true);
        flash(`Loaded ${file.name}`);
      } catch {
        flash("Could not load that video");
      } finally {
        setLoading(false);
      }
    },
    [swapSource, flash],
  );

  const togglePlay = useCallback(() => {
    const s = sourceRef.current;
    s.setPlaying(!s.playing);
  }, []);

  const toggleRaw = useCallback(() => {
    rawRef.current = !rawRef.current;
    setRaw(rawRef.current);
  }, []);

  const updateExport = useCallback((patch: Partial<ExportSettings>) => {
    setExportCfg((c) => {
      const next = { ...c, ...patch };
      exportCfgRef.current = next;
      return next;
    });
  }, []);

  const onScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    void sourceRef.current.seekTo(Number(e.target.value));
  }, []);

  const savePreset = useCallback(() => {
    const p = paramsRef.current as unknown as Record<string, unknown>;
    const ex = exportCfgRef.current as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PARAM_KEYS) out[k] = p[k];
    for (const k of EXPORT_KEYS) out[k] = ex[k];
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `node-flow-preset-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }, []);

  const runExport = useCallback(async () => {
    if (exportProgress !== null) return;
    setExportProgress(0);
    exportingRef.current = true;
    try {
      const { exportVideo } = await import("./export/encoder");
      const d = lockedRef.current
        ? lockedDimsRef.current
        : { w: paramsRef.current.renderWidth, h: paramsRef.current.renderHeight };
      await exportVideo({
        source: sourceRef.current,
        params: { ...paramsRef.current, renderWidth: d.w, renderHeight: d.h },
        settings: exportCfgRef.current,
        onProgress: (v) => setExportProgress(v),
      });
      flash("Export complete");
    } catch (err) {
      flash(`Export failed: ${(err as Error).message}`);
    } finally {
      exportingRef.current = false;
      setExportProgress(null);
    }
  }, [exportProgress, flash]);

  const confirmExport = useCallback(() => {
    setShowExport(false);
    void runExport();
  }, [runExport]);

  const { values, set } = useNodeVideoControls(
    {
      onSavePreset: savePreset,
      onLoadPreset: () => presetInputRef.current?.click(),
    },
    locked,
  );
  setLevaRef.current = set;

  useEffect(() => {
    paramsRef.current = values;
  }, [values]);

  // Decorate Leva folder titles with a color + lucide icon, matched by text.
  useEffect(() => {
    const root = document.querySelector(".nv-leva-scroll");
    if (!root) return;
    const decorate = () => {
      const seen = new Set<string>();
      root.querySelectorAll("*").forEach((el) => {
        const direct = Array.from(el.childNodes)
          .filter((nn) => nn.nodeType === 3)
          .map((nn) => nn.textContent?.trim() ?? "")
          .join("");
        const d = FOLDER_DECOR[direct];
        if (!d || seen.has(direct)) return;
        seen.add(direct);
        const he = el as HTMLElement;
        if (he.dataset.nvFolder) return;
        he.dataset.nvFolder = "1";
        he.classList.add("nv-folder");
        he.style.setProperty("--nv-fc", d.color);
        he.style.setProperty("--nv-fi", `url("${d.icon}")`);
      });
    };
    decorate();
    const obs = new MutationObserver(decorate);
    obs.observe(root, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const loadPresetFile = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text());
        const patch: Record<string, unknown> = {};
        for (const k of PARAM_KEYS) if (k in parsed) patch[k] = parsed[k];
        set(patch as never);
        const ex: Record<string, unknown> = {};
        for (const k of EXPORT_KEYS) if (k in parsed) ex[k] = parsed[k];
        updateExport(ex as Partial<ExportSettings>);
        flash("Preset loaded");
      } catch {
        flash("Invalid preset file");
      }
    },
    [set, flash, updateExport],
  );

  // The render loop.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let lastHud = performance.now();
    let lastTransport = 0;
    let frames = 0;

    const loop = () => {
      if (exportingRef.current) {
        raf = requestAnimationFrame(loop);
        return;
      }
      const base = paramsRef.current;
      const p = rawRef.current ? { ...base, raw: true } : base;
      const src = sourceRef.current;
      const w = lockedRef.current ? lockedDimsRef.current.w : Math.max(16, Math.round(p.renderWidth));
      const h = lockedRef.current ? lockedDimsRef.current.h : Math.max(16, Math.round(p.renderHeight));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }

      const blobs = rendererRef.current.render(ctx, w, h, src, frameRef.current, p, stateRef.current);
      frameRef.current++;
      frames++;

      const now = performance.now();
      if (now - lastHud >= 500) {
        setHud({ source: src.kind, w, h, blobs: blobs.length, fps: Math.round((frames * 1000) / (now - lastHud)) });
        frames = 0;
        lastHud = now;
      }
      if (now - lastTransport >= 100) {
        lastTransport = now;
        setTransport({
          seekable: src.seekable,
          time: src.currentTime,
          duration: src.duration ?? 0,
          playing: src.playing,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Scroll-to-zoom over the stage (native listener so we can preventDefault).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.15, z * (e.deltaY < 0 ? 1.12 : 0.89))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onStageDown = (e: React.MouseEvent) => {
    if (zoom <= 1.01) return;
    dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onStageMove = (e: React.MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
  };
  const onStageUp = () => {
    dragRef.current = null;
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file && file.type.startsWith("video/")) loadFile(file);
      else if (file) flash("Drop a video file");
    },
    [loadFile, flash],
  );

  const pct = transport.duration > 0 ? (transport.time / transport.duration) * 100 : 0;
  const rangeBg = `linear-gradient(to right, #3b82f6 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;

  return (
    <div
      className="nv-shell"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="nv-topbar">
        <span className="nv-wordmark">
          <Workflow className="nv-mark" size={19} strokeWidth={2.2} />
          node<b>·</b>flow
        </span>
        <span className="nv-chip">{hud.source}</span>
        <div className="nv-topright">
          <button className="nv-toggle" data-active={raw || undefined} onClick={toggleRaw} aria-pressed={raw}>
            {raw ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
            Raw
          </button>
          <div className="nv-stats">
            <span className="nv-stat">
              <Maximize2 size={13} strokeWidth={2} />
              {hud.w}×{hud.h}
            </span>
            <span className="nv-stat">
              <Boxes size={13} strokeWidth={2} />
              {hud.blobs}
            </span>
            <span className="nv-stat">
              <Activity size={13} strokeWidth={2} />
              {hud.fps} fps
            </span>
          </div>
        </div>
      </header>

      <div className="nv-body">
        <aside className="nv-sidebar">
          <div className="nv-section">
            <div className="nv-label">Source</div>
            <div className="nv-sources">
              <button className="nv-src nv-src-gen" onClick={useGenerated}>
                <Sparkles size={15} strokeWidth={2} />
                Generated
              </button>
              <button className="nv-src nv-src-file" onClick={() => fileInputRef.current?.click()}>
                <Film size={15} strokeWidth={2} />
                File
              </button>
            </div>
          </div>

          <div className="nv-leva-scroll">
            <Leva fill flat titleBar={false} theme={LEVA_THEME} />
          </div>

          <div className="nv-section nv-rand-section">
            <button
              className="nv-rand"
              onClick={() => {
                set(randomLook() as never);
                flash("Randomized ✨");
              }}
            >
              <Shuffle size={16} strokeWidth={2.4} />
              Randomize
            </button>
          </div>
        </aside>

        <div className="nv-main">
          <div
            className="nv-stage"
            ref={stageRef}
            onMouseDown={onStageDown}
            onMouseMove={onStageMove}
            onMouseUp={onStageUp}
            onMouseLeave={onStageUp}
            style={{ cursor: zoom > 1.01 ? (dragRef.current ? "grabbing" : "grab") : "default" }}
          >
            <canvas
              ref={canvasRef}
              className="nv-canvas"
              style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
            />
            {dragging && <div className="nv-drophint">Drop video to use as source</div>}
            {loading && (
              <div className="nv-loading">
                <div className="nv-spinner" />
                <div>Decoding video…</div>
              </div>
            )}
            <div className="nv-zoom">
              <button className="nv-zoom-btn" onClick={() => setZoom((z) => Math.max(0.15, z * 0.9))} aria-label="Zoom out">
                <ZoomOut size={14} strokeWidth={2} />
              </button>
              <span className="nv-zoom-val">{Math.round(zoom * 100)}%</span>
              <button className="nv-zoom-btn" onClick={() => setZoom((z) => Math.min(8, z * 1.1))} aria-label="Zoom in">
                <ZoomIn size={14} strokeWidth={2} />
              </button>
              <button
                className="nv-zoom-btn"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                aria-label="Fit to screen"
              >
                <Maximize size={14} strokeWidth={2} />
              </button>
            </div>
          </div>

          <footer className="nv-transport">
            {transport.seekable ? (
              <>
                <button
                  className="nv-icon-btn"
                  onClick={togglePlay}
                  aria-label={transport.playing ? "Pause" : "Play"}
                >
                  {transport.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
                </button>
                <input
                  className="nv-range"
                  type="range"
                  min={0}
                  max={transport.duration}
                  step={0.01}
                  value={Math.min(transport.time, transport.duration)}
                  onChange={onScrub}
                  style={{ background: rangeBg }}
                  aria-label="Seek"
                  aria-valuetext={`${formatTime(transport.time)} of ${formatTime(transport.duration)}`}
                />
                <span className="nv-time">
                  {formatTime(transport.time)} / {formatTime(transport.duration)}
                </span>
              </>
            ) : (
              <span className="nv-hint">
                Generated source — drag in a video to scrub a timeline, or export this pattern.
              </span>
            )}
            <button className="nv-export" onClick={() => setShowExport(true)} disabled={exportProgress !== null}>
              <Download size={16} strokeWidth={2.2} />
              Export .mp4
            </button>
          </footer>
        </div>
      </div>

      {showExport && (
        <div className="nv-overlay" onClick={() => setShowExport(false)}>
          <div className="nv-modal nv-export-modal" onClick={(e) => e.stopPropagation()}>
            <div className="nv-modal-title">Export settings</div>
            <div className="nv-field nv-field-col">
              <span>Resolution</span>
              <div className="nv-scale-grid">
                {[0.25, 0.5, 1, 2].map((s) => {
                  const bw = locked ? lockedDims.w : values.renderWidth;
                  const bh = locked ? lockedDims.h : values.renderHeight;
                  const w = Math.round((bw * s) / 2) * 2;
                  const h = Math.round((bh * s) / 2) * 2;
                  return (
                    <button
                      key={s}
                      className="nv-scale-btn"
                      data-active={exportCfg.exportScale === s || undefined}
                      onClick={() => updateExport({ exportScale: s })}
                    >
                      <b>{Math.round(s * 100)}%</b>
                      <span>
                        {w}×{h}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="nv-field">
              <span>FPS</span>
              <select name="exportFps" value={exportCfg.exportFps} onChange={(e) => updateExport({ exportFps: Number(e.target.value) })}>
                <option value={24}>24</option>
                <option value={30}>30</option>
                <option value={60}>60</option>
              </select>
            </label>
            <label className="nv-field">
              <span>Duration (s)</span>
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                name="exportSeconds"
                value={exportCfg.exportSeconds}
                onChange={(e) => updateExport({ exportSeconds: Number(e.target.value) })}
              />
            </label>
            <label className="nv-field">
              <span>Bitrate (Mbps)</span>
              <input
                type="number"
                min={1}
                max={60}
                step={1}
                name="exportBitrateMbps"
                value={exportCfg.exportBitrateMbps}
                onChange={(e) => updateExport({ exportBitrateMbps: Number(e.target.value) })}
              />
            </label>
            <div className="nv-filesize">
              ≈ {((exportCfg.exportBitrateMbps * exportCfg.exportSeconds) / 8).toFixed(1)} MB estimated
            </div>
            <div className="nv-modal-actions">
              <button className="nv-btn-ghost" onClick={() => setShowExport(false)}>
                Cancel
              </button>
              <button className="nv-export" onClick={confirmExport}>
                <Download size={16} strokeWidth={2.2} />
                Render .mp4
              </button>
            </div>
          </div>
        </div>
      )}

      {exportProgress !== null && (
        <div className="nv-overlay">
          <div className="nv-modal" role="status" aria-live="polite">
            <div className="nv-modal-title">Rendering frames… {Math.round(exportProgress * 100)}%</div>
            <div className="nv-track">
              <div className="nv-fill" style={{ width: `${exportProgress * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite">
        {toast && <div className="nv-toast">{toast}</div>}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        hidden
        onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])}
      />
      <input
        ref={presetInputRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => e.target.files?.[0] && loadPresetFile(e.target.files[0])}
      />
    </div>
  );
}
