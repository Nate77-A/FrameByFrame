/** The live Konva stage. It only reflects store state; edits go through the store (spec §2.1). */
import Konva from 'konva';
import type { Item, ShapeItem } from '../core/types';
import { bitmaps, ctx2d, makeCanvas } from '../core/bitmaps';
import { getCel, shownLayers } from '../core/doc';
import { blendToComposite, currentItems, getState, useStore, type Store } from '../core/store';
import { createNode } from './nodes';
import { renderFrame } from './compositor';
import { traceShape } from './geometry';
import { pivotPatch } from './content';
import type { Pt } from '../tools/bounds';

interface LayerView {
  konva: Konva.Layer;
  nodes: Map<string, { node: Konva.Node; item: Item }>;
  items: Item[] | null;
}
const hitCtx = ctx2d(makeCanvas(1, 1));
const THEME = { accent: '#53d8fb', hot: '#e94560', grid: 'rgba(83,120,200,.28)', guide: '#ff4fa3' };

function checker(): HTMLCanvasElement {
  const c = makeCanvas(24, 24); const x = ctx2d(c);
  x.fillStyle = '#fff'; x.fillRect(0, 0, 24, 24);
  x.fillStyle = '#d6d9e4'; x.fillRect(0, 0, 12, 12); x.fillRect(12, 12, 12, 12);
  return c;
}

Konva.showWarnings = false;

export class Scene {
  stage: Konva.Stage;
  private paper = new Konva.Rect({ listening: false, shadowColor: '#000', shadowBlur: 24, shadowOpacity: 0.45 });
  private bg = new Konva.Layer({ listening: false });
  private onion = new Konva.Layer({ listening: false });
  private overlay = new Konva.Layer();
  private gridShape: Konva.Shape;
  transformer: Konva.Transformer;
  private ghost: Konva.Node | null = null;
  /** Shows the selected object's anchor point. Input handles grabbing it. */
  private marker = new Konva.Group({ listening: false, visible: false });
  private views = new Map<string, LayerView>();
  private preview = new Konva.Image({ image: undefined, listening: false });
  private previewLayer: string | null = null;
  private frameSeen = -1;
  private raf = 0;
  private unsub: () => void;
  private onionTimer: ReturnType<typeof setTimeout> | null = null;
  private onionKey = '';
  onTransformEnd: (() => void) | null = null;
  /** Set once the user pans or zooms, so resizing stops refitting their view. */
  touched = false;

  constructor(private container: HTMLDivElement) {
    this.stage = new Konva.Stage({ container, width: container.clientWidth || 800, height: container.clientHeight || 600 });
    this.bg.add(this.paper);
    this.stage.add(this.bg, this.onion, this.overlay);
    this.gridShape = new Konva.Shape({ listening: false, sceneFunc: (ctx) => this.drawGrid(ctx) });
    this.transformer = new Konva.Transformer({
      rotateEnabled: true, flipEnabled: true, keepRatio: false, ignoreStroke: true,
      enabledAnchors: ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-center', 'bottom-right'],
      anchorSize: 14, anchorCornerRadius: 7, anchorStroke: THEME.accent, anchorFill: '#fff', anchorStrokeWidth: 2.5,
      borderStroke: THEME.accent, borderStrokeWidth: 2, rotateAnchorOffset: 34, rotateAnchorCursor: 'grab', rotationSnaps: [0, 45, 90, 135, 180, 225, 270, 315], rotationSnapTolerance: 4,
      boundBoxFunc: (o, n) => (Math.abs(n.width) < 4 || Math.abs(n.height) < 4 ? o : n),
    });
    this.transformer.on('transformend', () => this.onTransformEnd?.());
    this.transformer.on('transform', () => this.syncMarker());
    this.marker.add(
      new Konva.Circle({ radius: 9, stroke: THEME.hot, strokeWidth: 3, fill: 'rgba(255,255,255,.75)' }),
      new Konva.Line({ points: [-14, 0, 14, 0], stroke: THEME.hot, strokeWidth: 2 }),
      new Konva.Line({ points: [0, -14, 0, 14], stroke: THEME.hot, strokeWidth: 2 }),
    );
    this.overlay.add(this.gridShape, this.transformer, this.marker);
    bitmaps.onLoaded = () => { this.views.forEach((v) => (v.items = null)); this.request(); };
    this.fit();
    this.unsub = useStore.subscribe((s, p) => this.onStore(s, p));
    this.sync();
    if (typeof window !== 'undefined') (window as unknown as { __scene?: Scene }).__scene = this;
  }
  destroy() { this.unsub(); cancelAnimationFrame(this.raf); this.stage.destroy(); }

  private onStore(s: Store, p: Store) {
    if (s.doc !== p.doc || s.frameIndex !== p.frameIndex || s.zoom !== p.zoom || s.panX !== p.panX || s.panY !== p.panY
      || s.selection !== p.selection || s.grid !== p.grid || s.tool !== p.tool || s.onion !== p.onion
      || s.revision !== p.revision || s.anchorMode !== p.anchorMode || s.playing !== p.playing || s.activeLayerId !== p.activeLayerId) this.request();
  }
  request() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.sync(); }); }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const { width: oldW, height: oldH } = this.stage.size();
    this.stage.size({ width: r.width, height: r.height });
    const s = getState();
    if (!this.touched) this.fit();
    else s.set({ panX: s.panX + (r.width - oldW) / 2, panY: s.panY + (r.height - oldH) / 2 });
    this.request();
  }
  /** Centre the artboard, shrinking it to fit if needed. */
  fit() {
    this.touched = false;
    const s = getState();
    const { width: vw, height: vh } = this.stage.size();
    // Keep the artboard below the floating buttons so they never cover its corners.
    const top = 58, bottom = 16;
    const z = Math.min(1, Math.min((vw - 40) / s.doc.canvas.width, (vh - top - bottom) / s.doc.canvas.height));
    const zoom = Math.max(0.1, z);
    s.set({ zoom, panX: (vw - s.doc.canvas.width * zoom) / 2, panY: top + (vh - top - bottom - s.doc.canvas.height * zoom) / 2 });
  }
  toWorld(clientX: number, clientY: number) {
    const r = this.container.getBoundingClientRect();
    const s = getState();
    return { x: (clientX - r.left - s.panX) / s.zoom, y: (clientY - r.top - s.panY) / s.zoom };
  }
  toLocal(clientX: number, clientY: number) {
    const r = this.container.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }
  /** True if the pointer is on a transform handle, which Konva then handles itself. */
  onHandle(clientX: number, clientY: number): boolean {
    const p = this.toLocal(clientX, clientY);
    return !!this.overlay.getIntersection(p);
  }

  private view(id: string): LayerView {
    let v = this.views.get(id);
    if (!v) {
      v = { konva: new Konva.Layer({ listening: false }), nodes: new Map(), items: null };
      this.stage.add(v.konva);
      this.views.set(id, v);
    }
    return v;
  }

  private syncCel(id: string, v: LayerView, items: Item[]) {
    if (v.items === items) return;
    const old = v.nodes;
    v.nodes = new Map();
    v.konva.removeChildren();
    let missing = false;
    for (const item of items) {
      const prev = old.get(item.id);
      let node: Konva.Node;
      if (prev && prev.item === item && !this.needsImage(prev.node, item)) { node = prev.node; old.delete(item.id); }
      else node = createNode(item);
      if (this.needsImage(node, item)) missing = true;
      v.konva.add(node as Konva.Shape);
      v.nodes.set(item.id, { node, item });
    }
    old.forEach((o) => o.node.destroy());
    if (this.previewLayer === id) v.konva.add(this.preview);
    v.items = missing ? null : items;
  }
  private needsImage(n: Konva.Node, item: Item) {
    return (item.type === 'raster' || item.type === 'image') && !(n as Konva.Image).image();
  }

  /** Bring every Konva object in line with the store. */
  sync() {
    const s = getState();
    const { doc, frameIndex, zoom, panX, panY } = s;
    const { width: w, height: h, background } = doc.canvas;
    this.stage.scale({ x: zoom, y: zoom });
    this.stage.position({ x: panX, y: panY });

    this.paper.setAttrs({ x: 0, y: 0, width: w, height: h, shadowBlur: 24 / zoom });
    if (background) { this.paper.fillPriority('color'); this.paper.fill(background); }
    else { this.paper.fillPriority('pattern'); this.paper.fillPatternImage(checker() as unknown as HTMLImageElement); }

    const live = new Set(doc.layers.map((l) => l.id));
    this.views.forEach((v, id) => { if (!live.has(id)) { v.konva.destroy(); this.views.delete(id); } });
    this.bg.moveToBottom();
    const shown = new Set(shownLayers(doc).map((l) => l.id));
    doc.layers.forEach((l) => {
      const v = this.view(l.id);
      v.konva.moveToTop();
      v.konva.visible(shown.has(l.id));
      v.konva.clip({ x: 0, y: 0, width: w, height: h });
      v.konva.imageSmoothingEnabled(zoom < 2);
      this.syncCel(l.id, v, getCel(doc, frameIndex, l.id));
      const el = v.konva.getNativeCanvasElement();
      el.style.opacity = String(l.opacity);
      el.style.mixBlendMode = l.blendMode === 'normal' ? '' : blendToComposite(l.blendMode);
    });
    this.onion.moveToTop();
    this.overlay.moveToTop();
    this.syncOnion();

    const nodes = s.tool === 'select' && !s.playing
      ? s.selection.map((id) => this.findNode(id)).filter((n): n is Konva.Node => !!n)
      : [];
    this.transformer.nodes(nodes);
    this.transformer.forceUpdate();
    this.syncMarker();
    this.gridShape.visible(s.grid.show || doc.guides.v.length + doc.guides.h.length > 0);
    this.stage.batchDraw();
    this.frameSeen = frameIndex;
  }

  /** The selected item, read from its node so it stays right during a drag. */
  liveSelected(): Item | null {
    const s = getState();
    if (s.tool !== 'select' || s.playing || s.selection.length !== 1) return null;
    for (const v of this.views.values()) {
      const e = v.nodes.get(s.selection[0]);
      if (e) {
        const n = e.node;
        return { ...e.item, x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() };
      }
    }
    return null;
  }
  private syncMarker(at?: Pt) {
    const s = getState();
    const item = this.liveSelected();
    this.marker.visible(!!item);
    if (!item) return;
    const pos = at ?? this.anchorWorld(item);
    const k = (s.anchorMode ? 1.15 : 0.7) / s.zoom;
    this.marker.setAttrs({ x: pos.x, y: pos.y, scaleX: k, scaleY: k, opacity: s.anchorMode ? 1 : 0.6 });
    this.overlay.batchDraw();
  }
  placeMarker(p: Pt) { this.syncMarker(p); }
  anchorWorld(item: Item): Pt {
    const patch = pivotPatch(item) as { x?: number; y?: number };
    return { x: patch.x ?? item.x, y: patch.y ?? item.y };
  }
  /** Which Transformer handle, if any, is under the pointer. */
  handleName(clientX: number, clientY: number): string {
    return this.overlay.getIntersection(this.toLocal(clientX, clientY))?.name() ?? '';
  }

  findNode(id: string): Konva.Node | null {
    for (const v of this.views.values()) { const e = v.nodes.get(id); if (e) return e.node; }
    return null;
  }

  private drawGrid(ctx: Konva.Context) {
    const s = getState();
    const { width: w, height: h } = s.doc.canvas;
    const c = ctx._context;
    c.lineWidth = 1 / s.zoom;
    if (s.grid.show && s.grid.size * s.zoom >= 4) {
      c.strokeStyle = THEME.grid;
      c.beginPath();
      for (let x = s.grid.size; x < w; x += s.grid.size) { c.moveTo(x, 0); c.lineTo(x, h); }
      for (let y = s.grid.size; y < h; y += s.grid.size) { c.moveTo(0, y); c.lineTo(w, y); }
      c.stroke();
    }
    c.strokeStyle = THEME.guide;
    c.beginPath();
    s.doc.guides.v.forEach((x) => { c.moveTo(x, -9999); c.lineTo(x, 9999); });
    s.doc.guides.h.forEach((y) => { c.moveTo(-9999, y); c.lineTo(9999, y); });
    c.stroke();
  }

  // ---- previews -------------------------------------------------------
  setPreview(canvas: HTMLCanvasElement | null, opacity = 1, op: GlobalCompositeOperation = 'source-over') {
    const s = getState();
    this.preview.remove();
    if (!canvas) { this.previewLayer = null; this.stage.batchDraw(); return; }
    this.previewLayer = s.activeLayerId;
    const v = this.view(s.activeLayerId);
    this.preview.setAttrs({ image: canvas, width: canvas.width, height: canvas.height, opacity, globalCompositeOperation: op, x: 0, y: 0 });
    v.konva.add(this.preview);
    v.konva.batchDraw();
  }
  drawPreview() { if (this.previewLayer) this.view(this.previewLayer).konva.batchDraw(); }

  setGhost(item: Item | null) {
    this.ghost?.destroy(); this.ghost = null;
    if (item) { this.ghost = createNode(item); this.overlay.add(this.ghost as Konva.Shape); this.ghost.moveToBottom(); }
    this.overlay.batchDraw();
  }

  /** Move nodes without touching the store, for smooth dragging. */
  nudge(ids: string[], at: (item: Item) => { x: number; y: number }) {
    ids.forEach((id) => {
      for (const v of this.views.values()) {
        const e = v.nodes.get(id);
        if (e) e.node.position(at(e.item));
      }
    });
    this.transformer.forceUpdate();
    this.syncMarker();
    this.stage.batchDraw();
  }

  // ---- hit testing ----------------------------------------------------
  /** Top-most item under a canvas point, across visible unlocked layers. */
  hit(clientX: number, clientY: number): { item: Item; layerId: string } | null {
    const s = getState();
    const local = this.toLocal(clientX, clientY);
    for (const l of [...shownLayers(s.doc)].reverse()) {
      if (l.locked) continue;
      const items = getCel(s.doc, s.frameIndex, l.id);
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        const node = this.findNode(item.id);
        if (!node) continue;
        const p = node.getAbsoluteTransform().copy().invert().point(local);
        if (p.x < 0 || p.y < 0 || p.x > item.width || p.y > item.height) continue;
        if (item.type === 'raster') {
          const c = bitmaps.get(item.bitmap);
          if (!c) continue;
          // Forgiving 9-pixel check, so thin lines are easy to grab.
          const d = ctx2d(c, true).getImageData(Math.max(0, Math.floor(p.x) - 4), Math.max(0, Math.floor(p.y) - 4), 9, 9).data;
          let any = false;
          for (let k = 3; k < d.length; k += 4) if (d[k] > 16) { any = true; break; }
          if (!any) continue;
        } else if (item.type === 'shape') {
          const path = new Path2D();
          traceShape(path, item as ShapeItem);
          if (!hitCtx.isPointInPath(path, p.x, p.y)) continue;
        }
        return { item, layerId: l.id };
      }
    }
    return null;
  }

  // ---- onion skin -----------------------------------------------------
  private syncOnion() {
    const s = getState();
    const key = s.onion.on && !s.playing ? `${s.frameIndex}|${s.revision}|${s.onion.before}|${s.onion.after}|${s.onion.opacity}` : 'off';
    if (key === this.onionKey) return;
    this.onionKey = key;
    if (this.onionTimer) clearTimeout(this.onionTimer);
    if (key === 'off') { this.onion.destroyChildren(); this.onion.batchDraw(); return; }
    this.onionTimer = setTimeout(() => void this.renderOnion(key), 40);
  }
  private async renderOnion(key: string) {
    const s = getState();
    const { doc, frameIndex: f, onion } = s;
    const w = doc.canvas.width, h = doc.canvas.height;
    const out: Konva.Image[] = [];
    const add = async (i: number, dist: number, count: number, tint: string) => {
      if (i < 0 || i >= doc.frames.length) return;
      const c = makeCanvas(w / 2, h / 2);
      await renderFrame(doc, i, c, { width: c.width, height: c.height, movingOnly: true });
      const x = ctx2d(c);
      x.globalCompositeOperation = 'source-atop';
      x.fillStyle = tint; x.globalAlpha = 0.65; x.fillRect(0, 0, c.width, c.height);
      out.push(new Konva.Image({ image: c as unknown as HTMLImageElement, width: w, height: h, listening: false, opacity: onion.opacity * (1 - (dist - 1) / count) }));
    };
    for (let d = onion.before; d >= 1; d--) await add(f - d, d, onion.before, '#e94560');
    for (let d = onion.after; d >= 1; d--) await add(f + d, d, onion.after, '#3ecf6e');
    if (key !== this.onionKey) { out.forEach((n) => n.destroy()); return; }
    this.onion.destroyChildren();
    this.onion.clip({ x: 0, y: 0, width: w, height: h });
    out.forEach((n) => this.onion.add(n));
    this.onion.batchDraw();
  }
  frameShown() { return this.frameSeen; }
}

export const sceneRef: { current: Scene | null } = { current: null };
export const activeItems = () => currentItems(getState());
