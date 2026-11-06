/**
 * Pixel storage, kept outside the Immer document (spec §2.1).
 * Canvases are mutated in place and stay "hot" while recently used. Colder ones are
 * dropped to PNG blobs so long animations do not exhaust iPad canvas memory.
 */
import { uid } from './doc';

interface Entry {
  id: string; width: number; height: number;
  canvas: HTMLCanvasElement | null;
  blob: Blob | null;      // up to date unless `dirty`
  dirty: boolean;
  used: number;
  loading: Promise<void> | null;
}

export const makeCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h));
  return c;
};
export const ctx2d = (c: HTMLCanvasElement, read = false): CanvasRenderingContext2D =>
  c.getContext('2d', read ? { willReadFrequently: true } : undefined)!;

const toBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), 'image/png'));

export class BitmapStore {
  private map = new Map<string, Entry>();
  private tick = 0;
  /** Decoded pixels allowed in memory. iPad Safari caps total canvas memory. */
  budget = 512 * 1024 * 1024;
  onLoaded: (() => void) | null = null;

  private bytes(e: Entry) { return e.canvas ? e.width * e.height * 4 : 0; }

  create(width: number, height: number, id = uid()): string {
    this.map.set(id, { id, width, height, canvas: makeCanvas(width, height), blob: null, dirty: true, used: ++this.tick, loading: null });
    this.schedule();
    return id;
  }
  fromCanvas(src: CanvasImageSource, width: number, height: number): string {
    const id = this.create(width, height);
    ctx2d(this.map.get(id)!.canvas!).drawImage(src, 0, 0, width, height);
    return id;
  }
  /** Register a saved image without decoding it yet. */
  addBlob(id: string, blob: Blob, width: number, height: number): void {
    this.map.set(id, { id, width, height, canvas: null, blob, dirty: false, used: 0, loading: null });
  }
  has(id: string) { return this.map.has(id); }
  size(id: string) { const e = this.map.get(id); return e ? { width: e.width, height: e.height } : null; }

  /** Decoded canvas, or null while it is cold (a decode starts in the background). */
  get(id: string): HTMLCanvasElement | null {
    const e = this.map.get(id);
    if (!e) return null;
    e.used = ++this.tick;
    if (!e.canvas) void this.load(e);
    return e.canvas;
  }
  markDirty(id: string): void { const e = this.map.get(id); if (e) { e.dirty = true; e.used = ++this.tick; this.schedule(); } }

  private load(e: Entry): Promise<void> {
    return (e.loading ??= (async () => {
      const bmp = await createImageBitmap(e.blob!);
      const c = makeCanvas(e.width, e.height);
      ctx2d(c).drawImage(bmp, 0, 0, e.width, e.height);
      bmp.close();
      e.canvas = c; e.loading = null;
      this.onLoaded?.();
      this.schedule();
    })());
  }
  /** Wait until every id is decoded, for exports and frame switches. */
  async ensure(ids: Iterable<string>): Promise<void> {
    const waits: Promise<void>[] = [];
    for (const id of ids) {
      const e = this.map.get(id);
      if (e) { e.used = ++this.tick; if (!e.canvas) waits.push(this.load(e)); }
    }
    await Promise.all(waits);
  }
  /** PNG for saving. Unchanged bitmaps reuse their cached blob, keeping auto-save cheap. */
  async blob(id: string): Promise<Blob> {
    const e = this.map.get(id);
    if (!e) throw new Error(`missing bitmap ${id}`);
    if (e.dirty || !e.blob) {
      await this.load0(e);
      e.dirty = false;
      e.blob = await toBlob(e.canvas!);
    }
    return e.blob;
  }
  private async load0(e: Entry) { if (!e.canvas) await this.load(e); }

  clone(id: string): string {
    const e = this.map.get(id);
    if (!e) return id;
    const nid = uid();
    if (e.canvas) {
      this.map.set(nid, { ...e, id: nid, canvas: null, used: ++this.tick, loading: null, blob: e.dirty ? null : e.blob });
      const n = this.map.get(nid)!;
      n.canvas = makeCanvas(e.width, e.height);
      ctx2d(n.canvas).drawImage(e.canvas, 0, 0);
      this.schedule();
    } else this.map.set(nid, { ...e, id: nid, used: 0, loading: null });
    return nid;
  }
  clear(): void { for (const e of this.map.values()) if (e.canvas) e.canvas.width = 0; this.map.clear(); }

  private timer: ReturnType<typeof setTimeout> | null = null;
  private schedule() { this.timer ??= setTimeout(() => { this.timer = null; void this.trim(); }, 1000); }

  /** Compress least-recently-used canvases until we are back under budget. */
  async trim(): Promise<void> {
    const hot = [...this.map.values()].filter((e) => e.canvas).sort((a, b) => a.used - b.used);
    let total = hot.reduce((n, e) => n + this.bytes(e), 0);
    for (const e of hot) {
      if (total <= this.budget) break;
      const stamp = e.used;
      if (e.dirty || !e.blob) { e.blob = await toBlob(e.canvas!); e.dirty = false; }
      if (e.used !== stamp || !e.canvas) continue; // it was used while encoding
      total -= this.bytes(e);
      e.canvas.width = 0; e.canvas = null;
    }
  }
  stats() {
    const all = [...this.map.values()];
    return { total: all.length, hot: all.filter((e) => e.canvas).length, hotBytes: all.reduce((n, e) => n + this.bytes(e), 0) };
  }
}
export const bitmaps = new BitmapStore();

export interface Rect { x: number; y: number; width: number; height: number }

/** A rectangle of pixels before and after an edit; undo needs nothing else. */
export interface PixelPatch { bitmap: string; x: number; y: number; before: HTMLCanvasElement; after: HTMLCanvasElement | null }

export function capturePatch(bitmap: string, r: Rect): PixelPatch | null {
  const src = bitmaps.get(bitmap);
  if (!src) return null;
  const before = makeCanvas(r.width, r.height);
  ctx2d(before).drawImage(src, -r.x, -r.y);
  return { bitmap, x: r.x, y: r.y, before, after: null };
}
export function finishPatch(p: PixelPatch): void {
  const src = bitmaps.get(p.bitmap)!;
  p.after = makeCanvas(p.before.width, p.before.height);
  ctx2d(p.after).drawImage(src, -p.x, -p.y);
}
export function applyPatch(p: PixelPatch, which: 'before' | 'after'): void {
  const dst = bitmaps.get(p.bitmap);
  const src = p[which];
  if (!dst || !src) return;
  const c = ctx2d(dst);
  c.clearRect(p.x, p.y, src.width, src.height);
  c.drawImage(src, p.x, p.y);
  bitmaps.markDirty(p.bitmap);
}
