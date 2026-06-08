/** Frame sources feed pixels into the pipeline. Each can draw its current
 *  frame into a 2D context at an arbitrary size. The generated source is a pure
 *  function of frame index, so exports of it are fully reproducible. */

export interface FrameSource {
  readonly kind: string;
  /** Native aspect ratio (w/h). */
  readonly aspect: number;
  /** True once the source can produce frames. */
  readonly ready: boolean;
  /** Clip length in seconds if finite (file), else null (webcam/generated). */
  readonly duration: number | null;
  /** True when the source supports scrubbing (finite, seekable footage). */
  readonly seekable: boolean;
  /** Current playback position in seconds. */
  readonly currentTime: number;
  /** Whether the source is actively advancing frames. */
  readonly playing: boolean;
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, frameIndex: number): void;
  /** Seek to an exact time for deterministic export. Resolves when ready to draw. */
  seekTo(timeSeconds: number): Promise<void>;
  /** Start/stop live playback (live preview uses true; export pauses with false). */
  setPlaying(playing: boolean): void;
  dispose(): void;
}

/** Deterministic moving shapes — the default source. Needs no assets and makes
 *  motion detection easy to verify. */
export class GeneratedSource implements FrameSource {
  readonly kind = "generated";
  readonly aspect = 16 / 9;
  readonly ready = true;
  readonly duration = null;
  readonly seekable = false;
  readonly currentTime = 0;
  readonly playing = true;

  async seekTo(): Promise<void> {}
  setPlaying(): void {}

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, f: number): void {
    const t = f / 60;
    ctx.fillStyle = "#0b0f1a";
    ctx.fillRect(0, 0, w, h);

    // Slow drifting backdrop band for ambient low-frequency motion.
    const bandY = h * (0.5 + 0.18 * Math.sin(t * 0.7));
    const grad = ctx.createLinearGradient(0, bandY - h * 0.2, 0, bandY + h * 0.2);
    grad.addColorStop(0, "rgba(20,40,80,0)");
    grad.addColorStop(0.5, "rgba(40,90,160,0.55)");
    grad.addColorStop(1, "rgba(20,40,80,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, bandY - h * 0.2, w, h * 0.4);

    const shapes = [
      { hue: 12, sx: 0.42, sy: 0.9, r: 0.07, px: 0.9, py: 1.3 },
      { hue: 190, sx: 0.6, sy: 0.5, r: 0.05, px: 1.7, py: 0.8 },
      { hue: 320, sx: 0.3, sy: 1.2, r: 0.06, px: 1.1, py: 2.1 },
      { hue: 90, sx: 0.8, sy: 0.4, r: 0.045, px: 2.3, py: 1.5 },
      { hue: 50, sx: 0.5, sy: 1.6, r: 0.055, px: 0.6, py: 0.5 },
      { hue: 260, sx: 0.7, sy: 0.7, r: 0.05, px: 3.1, py: 2.6 },
      { hue: 150, sx: 0.36, sy: 1.05, r: 0.06, px: 2.0, py: 0.2 },
    ];

    for (const s of shapes) {
      const x = w * (0.5 + 0.4 * Math.sin(t * s.sx * Math.PI + s.px));
      const y = h * (0.5 + 0.38 * Math.sin(t * s.sy * Math.PI + s.py));
      const r = Math.min(w, h) * s.r * (1 + 0.15 * Math.sin(t * 2 + s.px));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `hsla(${s.hue}, 90%, 70%, 0.95)`);
      g.addColorStop(1, `hsla(${s.hue}, 90%, 50%, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  dispose(): void {}
}

/** Wraps an HTMLVideoElement (file object-URL or webcam stream). */
export class VideoElementSource implements FrameSource {
  readonly kind: string;
  readonly video: HTMLVideoElement;
  private objectUrl: string | null = null;

  constructor(video: HTMLVideoElement, kind: string, objectUrl: string | null = null) {
    this.video = video;
    this.kind = kind;
    this.objectUrl = objectUrl;
  }

  get aspect(): number {
    return this.video.videoWidth && this.video.videoHeight
      ? this.video.videoWidth / this.video.videoHeight
      : 16 / 9;
  }

  get ready(): boolean {
    return this.video.readyState >= 2 && this.video.videoWidth > 0;
  }

  get duration(): number | null {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : null;
  }

  get seekable(): boolean {
    return this.duration !== null;
  }

  get currentTime(): number {
    return this.video.currentTime;
  }

  get playing(): boolean {
    return !this.video.paused && !this.video.ended;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.ready) return;
    ctx.drawImage(this.video, 0, 0, w, h);
  }

  setPlaying(playing: boolean): void {
    if (playing) void this.video.play().catch(() => undefined);
    else this.video.pause();
  }

  /** Seek to an exact time and resolve once the frame is decoded and drawable. */
  seekTo(timeSeconds: number): Promise<void> {
    // Webcam / live streams can't seek — draw whatever is current.
    if (this.duration === null) return Promise.resolve();
    const t = Math.max(0, Math.min(this.duration - 1e-3, timeSeconds));
    if (Math.abs(this.video.currentTime - t) < 1e-4) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const onSeeked = () => {
        this.video.removeEventListener("seeked", onSeeked);
        resolve();
      };
      this.video.addEventListener("seeked", onSeeked);
      this.video.currentTime = t;
    });
  }

  dispose(): void {
    try {
      this.video.pause();
    } catch {
      /* noop */
    }
    const stream = this.video.srcObject as MediaStream | null;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.video.removeAttribute("src");
    this.video.load();
  }
}

export async function createFileSource(file: File): Promise<VideoElementSource> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not load video file"));
  });
  await video.play().catch(() => undefined);
  return new VideoElementSource(video, "file", url);
}

export async function createWebcamSource(): Promise<VideoElementSource> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  // Start playback FIRST. For MediaStream sources, frames/metadata only arrive
  // once the element is playing — awaiting loadeddata before play() deadlocks
  // (this was the "stuck on Decoding video…" bug).
  await video.play().catch(() => undefined);
  if (video.videoWidth === 0) {
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("loadedmetadata", done);
        video.removeEventListener("loadeddata", done);
        resolve();
      };
      video.addEventListener("loadedmetadata", done);
      video.addEventListener("loadeddata", done);
      setTimeout(done, 3000); // safety: never hang the UI
    });
  }
  return new VideoElementSource(video, "webcam");
}
