import { useCallback, useEffect, useRef, useState } from "react";
import { Leva } from "leva";
import { Renderer } from "./render/compose";
import { createState } from "./pipeline/types";
import type { FrameSource } from "./pipeline/source";
import { GeneratedSource, createFileSource, createWebcamSource } from "./pipeline/source";
import { useNodeVideoControls } from "./ui/controls";
import { DEFAULT_PARAMS, DEFAULT_EXPORT } from "./params";
import type { Params, ExportSettings, EffectType, BoxShape, ConnectorStyle } from "./params";
import "./app.css";

const PRESET_KEYS = [...Object.keys(DEFAULT_PARAMS), ...Object.keys(DEFAULT_EXPORT)];

const LEVA_THEME = {
  sizes: { rootWidth: "344px", rowHeight: "30px", titleBarHeight: "44px" },
  fontSizes: { root: "13px" },
  fonts: {
    sans: "Geist Variable, ui-sans-serif, system-ui, sans-serif",
    mono: "Geist Mono Variable, ui-monospace, monospace",
  },
  radii: { lg: "12px" },
} as const;

const PALETTE = ["#ffffff", "#6ea8fe", "#ff6b6b", "#ffd166", "#06d6a0", "#f72585", "#4cc9f0", "#80ffdb", "#ff9e00", "#b5179e"];
const RAND_EFFECTS: EffectType[] = ["dither", "halftone", "ascii", "pixelate", "threshold", "scanlines", "edges", "chromatic", "solarize"];
const RAND_SHAPES: BoxShape[] = ["rect", "circle", "ellipse", "diamond"];
const RAND_CONNECTORS: ConnectorStyle[] = ["curved", "straight", "none"];
const pickOne = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randf = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Randomize the aesthetic params (leaves structural/perf and export settings alone). */
function randomLook(): Partial<Params> {
  return {
    effect: pickOne(RAND_EFFECTS),
    effectScope: Math.random() < 0.7 ? "blobs" : "full",
    pixelSize: Math.round(randf(2, 12)),
    levels: Math.round(randf(2, 6)),
    mono: Math.random() < 0.3,
    invert: Math.random() < 0.2,
    effectColor: pickOne(PALETTE),
    boxShape: pickOne(RAND_SHAPES),
    boxScale: Math.round(randf(80, 160)),
    boxColor: pickOne(PALETTE),
    connectorStyle: pickOne(RAND_CONNECTORS),
    connectorCurve: Number(randf(-0.5, 0.5).toFixed(2)),
    connectorColor: pickOne(PALETTE),
    trailDecay: Number(randf(0.3, 0.9).toFixed(2)),
    motionThreshold: Number(randf(0.02, 0.12).toFixed(3)),
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
  const paramsRef = useRef<Params & ExportSettings>({ ...DEFAULT_PARAMS, ...DEFAULT_EXPORT });
  const frameRef = useRef(0);
  const exportingRef = useRef(false);

  const [hud, setHud] = useState({ source: "generated", w: 0, h: 0, blobs: 0, fps: 0 });
  const [transport, setTransport] = useState({ seekable: false, time: 0, duration: 0, playing: true });
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exportProgress, setExportProgress] = useState<number | null>(null);

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
    flash("Source: generated");
  }, [swapSource, flash]);

  const loadFile = useCallback(
    async (file: File) => {
      setLoading(true);
      try {
        const src = await createFileSource(file);
        swapSource(src);
        flash(`Loaded ${file.name}`);
      } catch {
        flash("Could not load that video");
      } finally {
        setLoading(false);
      }
    },
    [swapSource, flash],
  );

  const useWebcam = useCallback(async () => {
    setLoading(true);
    try {
      swapSource(await createWebcamSource());
      flash("Source: webcam");
    } catch {
      flash("Webcam unavailable or denied");
    } finally {
      setLoading(false);
    }
  }, [swapSource, flash]);

  const togglePlay = useCallback(() => {
    const s = sourceRef.current;
    s.setPlaying(!s.playing);
  }, []);

  const onScrub = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    void sourceRef.current.seekTo(Number(e.target.value));
  }, []);

  const savePreset = useCallback(() => {
    const p = paramsRef.current as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of PRESET_KEYS) out[k] = p[k];
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
      const p = paramsRef.current;
      await exportVideo({
        source: sourceRef.current,
        params: p,
        settings: p,
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

  const { values, set } = useNodeVideoControls({
    onExport: runExport,
    onSavePreset: savePreset,
    onLoadPreset: () => presetInputRef.current?.click(),
  });

  useEffect(() => {
    paramsRef.current = values;
  }, [values]);

  const loadPresetFile = useCallback(
    async (file: File) => {
      try {
        const parsed = JSON.parse(await file.text());
        const patch: Record<string, unknown> = {};
        for (const k of PRESET_KEYS) if (k in parsed) patch[k] = parsed[k];
        set(patch as never);
        flash("Preset loaded");
      } catch {
        flash("Invalid preset file");
      }
    },
    [set, flash],
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
      const p = paramsRef.current;
      const src = sourceRef.current;
      const w = Math.max(16, Math.round(p.renderWidth));
      const h = Math.max(16, Math.round(w / (src.aspect || 16 / 9)));
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
  const rangeBg = `linear-gradient(to right, #6ea8fe ${pct}%, rgba(255,255,255,0.14) ${pct}%)`;

  return (
    <div
      style={styles.shell}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="nv-topbar">
        <span className="nv-wordmark">
          node<b>·</b>flow
        </span>
        <span className="nv-chip">{hud.source}</span>
        <div className="nv-stats">
          <span>
            {hud.w}×{hud.h}
          </span>
          <span>{hud.blobs} blobs</span>
          <span>{hud.fps} fps</span>
        </div>
      </header>

      <div style={styles.body}>
        <aside style={styles.sidebar}>
          <div className="nv-toolbar">
            <button
              className="nv-rand"
              onClick={() => {
                set(randomLook() as never);
                flash("Randomized ✨");
              }}
            >
              ✦ Randomize
            </button>
            <div className="nv-sources">
              <button className="nv-src nv-src-gen" onClick={useGenerated}>
                Generated
              </button>
              <button className="nv-src nv-src-file" onClick={() => fileInputRef.current?.click()}>
                File
              </button>
              <button className="nv-src nv-src-cam" onClick={useWebcam}>
                Webcam
              </button>
            </div>
          </div>
          <div className="nv-leva-scroll">
            <Leva fill flat titleBar={{ title: "Controls" }} theme={LEVA_THEME} />
          </div>
        </aside>

        <div style={styles.main}>
          <div style={styles.stage}>
            <canvas ref={canvasRef} style={styles.canvas} />
            {dragging && <div style={styles.dropHint}>Drop video to use as source</div>}
            {loading && (
              <div style={styles.loadingOverlay}>
                <div className="nv-spinner" />
                <div style={{ marginTop: 14, fontSize: 14 }}>Decoding video…</div>
              </div>
            )}
          </div>

          <footer className="nv-transport">
            {transport.seekable ? (
              <>
                <button
                  className="nv-btn nv-btn-icon"
                  onClick={togglePlay}
                  aria-label={transport.playing ? "Pause" : "Play"}
                >
                  {transport.playing ? "❚❚" : "▶"}
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
                />
                <span className="nv-time">
                  {formatTime(transport.time)} / {formatTime(transport.duration)}
                </span>
              </>
            ) : (
              <span className="nv-hint">
                {hud.source === "webcam"
                  ? "Webcam is live — no timeline to scrub."
                  : "Generated source — drag in a video to scrub a timeline, or export this pattern as-is."}
              </span>
            )}
            <button className="nv-btn" onClick={runExport} disabled={exportProgress !== null}>
              Export .mp4
            </button>
          </footer>
        </div>
      </div>

      {exportProgress !== null && (
        <div style={styles.overlay}>
          <div style={styles.modal} role="status" aria-live="polite">
            <div style={{ fontSize: 15, marginBottom: 12 }}>
              Rendering frames… {Math.round(exportProgress * 100)}%
            </div>
            <div style={styles.track}>
              <div style={{ ...styles.fill, width: `${exportProgress * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      <div role="status" aria-live="polite">
        {toast && <div style={styles.toast}>{toast}</div>}
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

const styles: Record<string, React.CSSProperties> = {
  shell: { position: "relative", height: "100%", display: "flex", flexDirection: "column" },
  body: { flex: 1, minHeight: 0, display: "flex" },
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column" },
  sidebar: {
    width: 360,
    flexShrink: 0,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid rgba(255,255,255,0.08)",
    background: "#0d0d0f",
  },
  stage: {
    flex: 1,
    minHeight: 0,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    background: "radial-gradient(circle at 50% 30%, #131316, #0a0a0b 70%)",
  },
  canvas: {
    maxWidth: "100%",
    maxHeight: "100%",
    objectFit: "contain",
    borderRadius: 8,
    boxShadow: "0 24px 70px rgba(0,0,0,0.55)",
    background: "#000",
  },
  dropHint: {
    position: "absolute",
    inset: 28,
    border: "2px dashed rgba(255,255,255,0.5)",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    background: "rgba(10,10,12,0.6)",
    pointerEvents: "none",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(10,10,12,0.55)",
    color: "#e7e7ea",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.6)",
  },
  modal: {
    width: 360,
    padding: 24,
    borderRadius: 12,
    background: "#17171a",
    border: "1px solid rgba(255,255,255,0.1)",
  },
  track: { height: 8, borderRadius: 4, background: "rgba(255,255,255,0.12)", overflow: "hidden" },
  fill: { height: "100%", background: "#6ea8fe", transition: "width 0.1s linear" },
  toast: {
    position: "absolute",
    bottom: 92,
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 16px",
    borderRadius: 9,
    background: "rgba(20,20,24,0.95)",
    border: "1px solid rgba(255,255,255,0.12)",
    fontSize: 14,
  },
};
