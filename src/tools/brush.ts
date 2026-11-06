/** Stamp-based brush engine with stroke buffer (spec §2.1, §4.2). */
import type { Gradient, Item, RasterItem } from '../core/types';
import { bitmaps, capturePatch, ctx2d, finishPatch, applyPatch, makeCanvas, type Rect } from '../core/bitmaps';
import { celDraft, getCel, uid } from '../core/doc';
import { blendToComposite, getState, type Settings } from '../core/store';
import type { HistoryPatch } from '../core/history';
import { rasterizeItems } from '../render/compositor';
import { sceneRef } from '../render/scene';
import { itemBounds, rectsOverlap } from './bounds';

type TipKind = 'round' | 'grain' | 'blob';
export interface Dynamics {
  kind: TipKind; ratio: number; hardness: number; flow: number; spacing: number;
  jitter: number; sizeJitter: number; angle: number | 'stroke' | 'random'; pressure: number; tilt: number; smoothing: number;
}
export interface Sample { x: number; y: number; pressure: number; tiltX: number; tiltY: number; pen: boolean }

const TIPS_MAX = 512;
const tips = new Map<string, HTMLCanvasElement>();

function maskTip(kind: TipKind, hardness: number, px: number): HTMLCanvasElement {
  const c = makeCanvas(px, px), x = ctx2d(c, true), r = px / 2;
  const g = x.createRadialGradient(r, r, r * Math.min(0.98, hardness), r, r, r);
  g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.beginPath(); x.arc(r, r, r, 0, 7); x.fill();
  if (kind !== 'round') {
    const d = x.getImageData(0, 0, px, px);
    for (let i = 3; i < d.data.length; i += 4) {
      const n = Math.random();
      d.data[i] *= kind === 'grain' ? (n > 0.45 ? n : 0) : n > 0.12 ? 1 : 0.2;
    }
    x.putImageData(d, 0, 0);
  }
  return c;
}
function tintedTip(kind: TipKind, hardness: number, size: number, color: string): HTMLCanvasElement {
  // Bucket sizes so pressure changes reuse the same few tips.
  const px = Math.min(TIPS_MAX, Math.max(4, Math.ceil(size / 4) * 4));
  const key = `${kind}|${hardness.toFixed(2)}|${px}|${color}`;
  let t = tips.get(key);
  if (!t) {
    if (tips.size > 96) tips.clear();
    t = maskTip(kind, hardness, px);
    const x = ctx2d(t);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color; x.fillRect(0, 0, px, px);
    tips.set(key, t);
  }
  return t;
}

export function dynamicsFor(tool: 'pencil' | 'brush' | 'eraser', st: Settings): { d: Dynamics; size: number; opacity: number } {
  if (tool === 'eraser') {
    const e = st.eraser;
    return { size: e.size, opacity: e.opacity, d: { kind: 'round', ratio: 1, hardness: e.hard ? 0.92 : 0.2, flow: 1, spacing: 0.08, jitter: 0, sizeJitter: 0, angle: 0, pressure: 0.3, tilt: 0, smoothing: 0.1 } };
  }
  if (tool === 'pencil') {
    const p = st.pencil;
    const base = { pressure: p.pressure, tilt: p.tilt, smoothing: p.smoothing, jitter: 0, sizeJitter: 0, angle: 0 as Dynamics['angle'], ratio: 1, hardness: p.harden, flow: 1, spacing: 0.08, kind: 'round' as TipKind };
    const styles: Record<typeof p.style, Partial<Dynamics>> = {
      ink: {},
      graphite: { kind: 'grain', flow: 0.5, spacing: 0.1, hardness: Math.min(p.harden, 0.7) },
      calligraphy: { ratio: 0.28, angle: -Math.PI / 4 },
      marker: { ratio: 0.7, angle: 'stroke', hardness: 0.85 },
      softbrush: { hardness: Math.min(p.harden, 0.45), flow: 0.6 },
    };
    return { size: p.size, opacity: p.opacity, d: { ...base, ...styles[p.style] } };
  }
  const b = st.brush;
  const base = { pressure: b.pressure, tilt: b.tilt, smoothing: 0.25, jitter: 0, sizeJitter: 0, angle: 0 as Dynamics['angle'], ratio: 1, hardness: 0.7, flow: b.flow, spacing: b.spacing, kind: 'round' as TipKind };
  const types: Record<typeof b.type, Partial<Dynamics>> = {
    round: {},
    flat: { ratio: 0.3, angle: 'stroke', hardness: 0.9 },
    scatter: { jitter: b.scatter * 1.6, sizeJitter: 0.5, spacing: Math.max(b.spacing, 0.3), angle: 'random', hardness: 0.85 },
    texture: { kind: 'grain', hardness: 0.6, angle: 'random' },
    watercolor: { hardness: 0.15, flow: b.flow * 0.22, sizeJitter: 0.18, jitter: 0.04 },
    inkbleed: { kind: 'blob', hardness: 0.55, jitter: 0.1, sizeJitter: 0.35, angle: 'random' },
  };
  return { size: b.size, opacity: b.opacity, d: { ...base, ...types[b.type] } };
}

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
export function rampColor(g: Gradient, t: number): string {
  const s = [...g.stops].sort((a, b) => a.offset - b.offset);
  const i = s.findIndex((x) => x.offset >= t);
  if (i <= 0) return (i === 0 ? s[0] : s.at(-1)!).color;
  const a = s[i - 1], b = s[i], k = (t - a.offset) / (b.offset - a.offset || 1);
  const [r, g2, b2] = hex(a.color).map((v, n) => Math.round(v + (hex(b.color)[n] - v) * k));
  return `#${((1 << 24) | (r << 16) | (g2 << 8) | b2).toString(16).slice(1)}`;
}

let shared: HTMLCanvasElement | null = null;
const bufferFor = (w: number, h: number) => {
  if (!shared || shared.width !== w || shared.height !== h) { if (shared) shared.width = 0; shared = makeCanvas(w, h); }
  return shared;
};

export class Stroke {
  private buf: HTMLCanvasElement; private ctx: CanvasRenderingContext2D;
  private d: Dynamics; private size: number; private opacity: number;
  private last: { x: number; y: number; p: number } | null = null;
  private sm: { x: number; y: number } | null = null;
  private raw: { x: number; y: number } | null = null;
  private prevMid: { x: number; y: number } | null = null;
  private carry = 0; private dist = 0; private tiltAngle: number | null = null;
  private box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  private color: string; private ramp: Gradient | null; private erase: boolean; private op: GlobalCompositeOperation;
  private started = performance.now();
  raf = 0;

  constructor(private tool: 'pencil' | 'brush' | 'eraser') {
    const s = getState();
    const { width, height } = s.doc.canvas;
    this.buf = bufferFor(width, height);
    this.ctx = ctx2d(this.buf);
    this.ctx.clearRect(0, 0, width, height);
    const dyn = dynamicsFor(tool, s.settings);
    this.d = dyn.d; this.size = dyn.size; this.opacity = dyn.opacity;
    const toBg = tool === 'eraser' && s.settings.eraser.toBackground && !!s.doc.canvas.background;
    this.erase = tool === 'eraser' && !toBg;
    this.color = this.erase ? '#000000' : toBg ? s.doc.canvas.background! : s.color;
    this.ramp = tool !== 'eraser' && s.colorMode === 'gradient' ? s.gradient : null;
    this.op = this.erase ? 'destination-out' : this.ramp ? blendToComposite(this.ramp.blend) : 'source-over';
    sceneRef.current?.setPreview(this.buf, this.opacity, this.op);
  }
  get ageMs() { return performance.now() - this.started; }

  private stamp(x: number, y: number, p: number, dir: number) {
    const d = this.d;
    let size = Math.max(1, this.size * (1 - d.pressure + d.pressure * p * 1));
    if (d.sizeJitter) size *= 1 + (Math.random() - 0.5) * d.sizeJitter * 2;
    if (d.jitter) {
      const r = Math.random() * size * d.jitter, a = Math.random() * 6.283;
      x += Math.cos(a) * r; y += Math.sin(a) * r;
    }
    let color = this.color;
    if (this.ramp) {
      // Ride the ramp back and forth along the stroke, in 32 steps.
      const t = (this.dist / 700) % 2, k = Math.round((t > 1 ? 2 - t : t) * 32) / 32;
      color = rampColor(this.ramp, k);
    }
    const tip = tintedTip(d.kind, d.hardness, size, color);
    const angle = this.tiltAngle ?? (d.angle === 'stroke' ? dir : d.angle === 'random' ? Math.random() * 6.283 : d.angle);
    const c = this.ctx;
    const w = size, h = size * d.ratio;
    c.save();
    c.globalAlpha = d.flow;
    c.translate(x, y);
    if (angle) c.rotate(angle);
    c.drawImage(tip, -w / 2, -h / 2, w, h);
    c.restore();
    const b = this.box, r = size;
    b.x0 = Math.min(b.x0, x - r); b.y0 = Math.min(b.y0, y - r); b.x1 = Math.max(b.x1, x + r); b.y1 = Math.max(b.y1, y + r);
  }

  private walkTo(x: number, y: number, p: number) {
    const l = this.last!;
    const dx = x - l.x, dy = y - l.y, len = Math.hypot(dx, dy);
    if (!len) return;
    const dir = Math.atan2(dy, dx);
    const step = Math.max(0.5, this.size * this.d.spacing);
    let t = step - this.carry;
    while (t <= len) {
      const k = t / len;
      this.dist += step;
      this.stamp(l.x + dx * k, l.y + dy * k, l.p + (p - l.p) * k, dir);
      t += step;
    }
    this.carry = len - (t - step);
    this.last = { x, y, p };
  }

  add(s: Sample) {
    const p = s.pen ? Math.max(0.02, s.pressure) : 1;
    this.raw = { x: s.x, y: s.y };
    if (s.pen && this.d.tilt > 0 && (s.tiltX || s.tiltY)) {
      const lean = Math.min(1, Math.hypot(s.tiltX, s.tiltY) / 60);
      if (this.d.ratio < 1 && lean * this.d.tilt > 0.1) this.tiltAngle = Math.atan2(s.tiltY, s.tiltX) + Math.PI / 2;
    }
    if (!this.sm) {
      this.sm = { x: s.x, y: s.y }; this.last = { x: s.x, y: s.y, p }; this.prevMid = { x: s.x, y: s.y };
      this.stamp(s.x, s.y, p, 0);
    } else {
      const k = 1 - this.d.smoothing * 0.85;
      const prev = this.sm;
      const cur = { x: prev.x + (s.x - prev.x) * k, y: prev.y + (s.y - prev.y) * k };
      this.sm = cur;
      // Quadratic through midpoints keeps fast curves round instead of faceted.
      const mid = { x: (prev.x + cur.x) / 2, y: (prev.y + cur.y) / 2 };
      const a = this.prevMid!;
      const n = Math.max(1, Math.ceil(Math.hypot(mid.x - a.x, mid.y - a.y) / 3));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        this.walkTo(u * u * a.x + 2 * u * t * prev.x + t * t * mid.x, u * u * a.y + 2 * u * t * prev.y + t * t * mid.y, p);
      }
      this.prevMid = mid;
    }
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; sceneRef.current?.drawPreview(); });
  }

  cancel() {
    cancelAnimationFrame(this.raf);
    sceneRef.current?.setPreview(null);
  }

  private dirtyRect(w: number, h: number): Rect | null {
    const b = this.box;
    const x = Math.max(0, Math.floor(b.x0)), y = Math.max(0, Math.floor(b.y0));
    const x1 = Math.min(w, Math.ceil(b.x1)), y1 = Math.min(h, Math.ceil(b.y1));
    return x1 > x && y1 > y ? { x, y, width: x1 - x, height: y1 - y } : null;
  }

  end() {
    cancelAnimationFrame(this.raf);
    // Smoothing lags the pen, so finish exactly where it lifted.
    if (this.raw && this.last) this.walkTo(this.raw.x, this.raw.y, this.last.p);
    const s = getState();
    const r = this.dirtyRect(s.doc.canvas.width, s.doc.canvas.height);
    if (r) {
      if (this.erase) eraseFrom(this.buf, r, this.opacity);
      else paintOnTop(this.buf, r, this.opacity, this.op, this.tool === 'pencil' ? 'Pencil' : this.tool === 'brush' ? 'Paintbrush' : 'Eraser');
    }
    sceneRef.current?.setPreview(null);
    sceneRef.current?.sync();
  }
}

/** Can this item be painted straight into? */
export const paintable = (i: Item | undefined, w: number, h: number): i is RasterItem =>
  !!i && i.type === 'raster' && !i.rotation && i.scaleX === 1 && i.scaleY === 1 && i.opacity === 1
  && i.width === w && i.height === h && i.x === w / 2 && i.y === h / 2;

export const makeRaster = (bitmap: string, w: number, h: number): RasterItem => ({
  id: uid(), type: 'raster', bitmap, rev: 0, x: w / 2, y: h / 2, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1,
});

/** Merge pixels from src into the top raster of the active cel, or a new raster on top. */
export function paintOnTop(src: HTMLCanvasElement, r: Rect, opacity: number, op: GlobalCompositeOperation, label: string, sx = r.x, sy = r.y) {
  const s = getState();
  const { width: w, height: h } = s.doc.canvas;
  const cel = getCel(s.doc, s.frameIndex, s.activeLayerId);
  const top = cel.at(-1);
  const reuse = paintable(top, w, h) ? top : null;
  const bitmap = reuse ? reuse.bitmap : bitmaps.create(w, h);
  const patch = capturePatch(bitmap, r);
  if (!patch) return;
  const c = ctx2d(bitmaps.get(bitmap)!);
  c.save();
  c.globalAlpha = opacity; c.globalCompositeOperation = op;
  c.drawImage(src, sx, sy, r.width, r.height, r.x, r.y, r.width, r.height);
  c.restore();
  finishPatch(patch);
  bitmaps.markDirty(bitmap);
  const hp: HistoryPatch = { apply: (w2) => applyPatch(patch, w2) };
  const frame = s.frameIndex, layer = s.activeLayerId;
  s.commit(label, (d) => {
    const list = celDraft(d, frame, layer);
    if (reuse) (list[list.length - 1] as RasterItem).rev++;
    else list.push(makeRaster(bitmap, w, h));
  }, { patches: reuse ? [hp] : [] });
}

/** The eraser wipes everything on the layer: objects it touches become pixels first (spec §2.1). */
function eraseFrom(mask: HTMLCanvasElement, r: Rect, opacity: number) {
  const s = getState();
  const { width: w, height: h } = s.doc.canvas;
  const cel = getCel(s.doc, s.frameIndex, s.activeLayerId);
  const patches: HistoryPatch[] = [];
  const hide = (bitmap: string) => {
    const c = ctx2d(bitmaps.get(bitmap)!);
    c.save(); c.globalAlpha = opacity; c.globalCompositeOperation = 'destination-out';
    c.drawImage(mask, r.x, r.y, r.width, r.height, r.x, r.y, r.width, r.height);
    c.restore();
    bitmaps.markDirty(bitmap);
  };
  let changed = false;
  const next = cel.map((item): Item => {
    if (!rectsOverlap(itemBounds(item), r)) return item;
    changed = true;
    if (paintable(item, w, h)) {
      const p = capturePatch(item.bitmap, r);
      hide(item.bitmap);
      if (p) { finishPatch(p); patches.push({ apply: (x) => applyPatch(p, x) }); }
      return { ...item, rev: item.rev + 1 };
    }
    const flat = rasterizeItems([item], w, h);
    const bitmap = bitmaps.fromCanvas(flat, w, h);
    hide(bitmap);
    return makeRaster(bitmap, w, h);
  });
  if (!changed) return;
  const frame = s.frameIndex, layer = s.activeLayerId;
  s.commit('Eraser', (d) => { const l = celDraft(d, frame, layer); l.splice(0, l.length, ...next); }, { patches });
}
