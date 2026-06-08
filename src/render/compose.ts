import type { FrameSource } from "../pipeline/source";
import type { Blob, Connector, PipelineState } from "../pipeline/types";
import type { BoxShape, Params } from "../params";
import type { Renderer, RenderParams } from "./renderer";
import { updateMotion } from "../pipeline/motion";
import { detectBlobs } from "../pipeline/blobs";
import { buildConnectors } from "../pipeline/connectors";
import { EFFECTS } from "../effects";

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Box for a blob: keeps the detected region's aspect, sized by the primary
 *  Size (boxScale, 0..100 of the canvas short edge), and clamped to
 *  [Min%, Max%] of that Size. */
function sizedBox(b: Blob, p: Params, refShort: number): Box {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const sizeRef = (p.boxScale / 100) * refShort;
  const lo = (Math.min(p.minBlobSize, p.maxBlobSize) / 100) * sizeRef;
  const hi = (Math.max(p.minBlobSize, p.maxBlobSize) / 100) * sizeRef;
  const larger = Math.max(b.w, b.h) || 1;
  const k = Math.min(hi, Math.max(lo, larger)) / larger;
  const w = b.w * k;
  const h = b.h * k;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Build the outline/mask path for a shape into the current context. Circle and
 *  diamond are "pure" (a single radius from the larger side); ellipse follows
 *  the box. */
function shapePath(ctx: CanvasRenderingContext2D, shape: BoxShape, b: Box): void {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.beginPath();
  if (shape === "ellipse") {
    ctx.ellipse(cx, cy, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
  } else if (shape === "circle") {
    ctx.arc(cx, cy, Math.max(b.w, b.h) / 2, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    const r = Math.max(b.w, b.h) / 2;
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
  } else {
    ctx.rect(b.x, b.y, b.w, b.h);
  }
}

/** Bounding box of a shape (pure circle/diamond span their larger side). */
function shapeBounds(shape: BoxShape, b: Box): Box {
  if (shape === "circle" || shape === "diamond") {
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    const r = Math.max(b.w, b.h) / 2;
    return { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
  }
  return b;
}

/**
 * Owns the offscreen working canvases and runs the full pipeline into a target
 * context. Pure with respect to (source frame, params, state): the live loop
 * and the offline exporter call this identically, so exports match the preview.
 */
export class Canvas2DRenderer implements Renderer {
  readonly backend = "canvas2d" as const;
  private work: HTMLCanvasElement;
  private workCtx: CanvasRenderingContext2D;
  private fx: HTMLCanvasElement;
  private fxCtx: CanvasRenderingContext2D;

  constructor() {
    [this.work, this.workCtx] = makeCanvas(16, 16);
    [this.fx, this.fxCtx] = makeCanvas(16, 16);
  }

  private resizeWork(w: number, h: number) {
    if (this.work.width !== w || this.work.height !== h) {
      this.work.width = this.fx.width = w;
      this.work.height = this.fx.height = h;
    }
  }

  render(
    out: CanvasRenderingContext2D,
    w: number,
    h: number,
    source: FrameSource,
    frameIndex: number,
    p: RenderParams,
    state: PipelineState,
  ): Blob[] {
    this.resizeWork(w, h);

    // 1. Source → work canvas at render resolution.
    this.workCtx.fillStyle = p.background;
    this.workCtx.fillRect(0, 0, w, h);
    source.draw(this.workCtx, w, h, frameIndex);

    // Raw bypass: show the untouched source, skip the whole pipeline.
    if (p.raw) {
      out.globalAlpha = 1;
      out.drawImage(this.work, 0, 0, w, h);
      return [];
    }

    // 2. Motion + blobs + connectors.
    const motion = updateMotion(this.work, w, h, state, p);
    const blobs = detectBlobs(motion, w, h, state, p);
    const connectors = buildConnectors(blobs, p);
    const refShort = Math.min(w, h);

    // 3. Base layer: the clean source frame.
    out.globalAlpha = 1;
    out.drawImage(this.work, 0, 0, w, h);

    // 4. Effect layer, masked to scope.
    if (p.effect !== "none") {
      const src = this.workCtx.getImageData(0, 0, w, h);
      EFFECTS[p.effect].render(this.fxCtx, src, p);
      if (p.invert) this.invertCanvas(w, h);

      if (p.effectScope === "full") {
        out.drawImage(this.fx, 0, 0, w, h);
      } else {
        for (const b of blobs) {
          const sb = sizedBox(b, p, refShort);
          const db = shapeBounds(p.boxShape, sb);
          const x = Math.max(0, Math.floor(db.x));
          const y = Math.max(0, Math.floor(db.y));
          const bw = Math.min(w - x, Math.ceil(db.x + db.w) - x);
          const bh = Math.min(h - y, Math.ceil(db.y + db.h) - y);
          if (bw <= 0 || bh <= 0) continue;
          out.globalAlpha = b.life;
          if (p.boxShape === "rect") {
            out.drawImage(this.fx, x, y, bw, bh, x, y, bw, bh);
          } else {
            out.save();
            shapePath(out, p.boxShape, sb);
            out.clip();
            out.drawImage(this.fx, x, y, bw, bh, x, y, bw, bh);
            out.restore();
          }
        }
        out.globalAlpha = 1;
      }
    }

    // 5. Vector overlays.
    if (p.connectorStyle !== "none") this.drawConnectors(out, connectors, p);
    if (p.showBoxes) this.drawBoxes(out, blobs, p, refShort);

    return blobs;
  }

  private invertCanvas(w: number, h: number) {
    const img = this.fxCtx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i];
      d[i + 1] = 255 - d[i + 1];
      d[i + 2] = 255 - d[i + 2];
    }
    this.fxCtx.putImageData(img, 0, 0);
  }

  private drawConnectors(out: CanvasRenderingContext2D, links: Connector[], p: Params) {
    out.strokeStyle = p.connectorColor;
    out.fillStyle = p.connectorColor;
    out.lineWidth = p.connectorWidth;
    out.lineCap = "round";
    const r = p.connectorWidth + 1.2;
    for (const l of links) {
      const a = (0.2 + 0.8 * Math.max(0, Math.min(1, l.strength))) * l.life;
      if (a <= 0.012) continue;
      out.globalAlpha = a;
      out.beginPath();
      out.moveTo(l.ax, l.ay);
      if (p.connectorStyle === "curved") {
        const dx = l.bx - l.ax;
        const dy = l.by - l.ay;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const cx = (l.ax + l.bx) / 2 + nx * p.connectorCurve * len;
        const cy = (l.ay + l.by) / 2 + ny * p.connectorCurve * len;
        out.quadraticCurveTo(cx, cy, l.bx, l.by);
      } else {
        out.lineTo(l.bx, l.by);
      }
      out.stroke();
      out.beginPath();
      out.arc(l.ax, l.ay, r, 0, Math.PI * 2);
      out.fill();
      out.beginPath();
      out.arc(l.bx, l.by, r, 0, Math.PI * 2);
      out.fill();
    }
    out.globalAlpha = 1;
  }

  private drawBoxes(out: CanvasRenderingContext2D, blobs: Blob[], p: Params, refShort: number) {
    out.strokeStyle = p.boxColor;
    out.lineWidth = p.boxWidth;
    out.lineJoin = "miter";
    for (const b of blobs) {
      const sb = sizedBox(b, p, refShort);
      out.globalAlpha = b.life;
      if (p.boxShape !== "rect") {
        shapePath(out, p.boxShape, sb);
        out.stroke();
      } else if (p.cornerTicks) {
        this.strokeCorners(out, sb, p.boxWidth);
      } else {
        out.strokeRect(sb.x, sb.y, sb.w, sb.h);
      }
    }
    out.globalAlpha = 1;
  }

  private strokeCorners(out: CanvasRenderingContext2D, b: Box, lw: number) {
    const t = Math.max(6, Math.min(b.w, b.h) * 0.22);
    const x2 = b.x + b.w;
    const y2 = b.y + b.h;
    out.beginPath();
    // top-left
    out.moveTo(b.x, b.y + t);
    out.lineTo(b.x, b.y);
    out.lineTo(b.x + t, b.y);
    // top-right
    out.moveTo(x2 - t, b.y);
    out.lineTo(x2, b.y);
    out.lineTo(x2, b.y + t);
    // bottom-right
    out.moveTo(x2, y2 - t);
    out.lineTo(x2, y2);
    out.lineTo(x2 - t, y2);
    // bottom-left
    out.moveTo(b.x + t, y2);
    out.lineTo(b.x, y2);
    out.lineTo(b.x, y2 - t);
    out.lineWidth = lw;
    out.stroke();
  }
}
