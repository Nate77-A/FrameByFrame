/** Pointer pipeline, deliberately outside React so pen input runs at full speed (spec §2.0). */
import type Konva from 'konva';
import type { Item, ShapeItem } from '../core/types';
import { celDraft, getCel, shownLayers } from '../core/doc';
import { getState, currentItems } from '../core/store';
import type { Scene } from '../render/scene';
import { measureText } from '../render/nodes';
import { Stroke, type Sample } from './brush';
import { bucketAt, canEditLayer, eyedropperAt, shapeItem, textItem } from './actions';
import { boxPoints, gridLines, snapAxis, toLocal, toWorld, unionBox, withAnchor, type Box } from './bounds';
import { contentBox, pivotPatch, visualBounds } from '../render/content';

export const keyState = { space: false, spacePanned: false };
type Drag =
  | { kind: 'stroke'; stroke: Stroke }
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number; t: number }
  | { kind: 'shape'; x0: number; y0: number; item: ShapeItem | null }
  | { kind: 'rotate'; item: Item; pre: Partial<Item>; pivot: { x: number; y: number }; start: number; rot: number }
  | { kind: 'anchor'; item: Item; pt: { x: number; y: number }; snaps: { x: number; y: number }[] }
  | { kind: 'move'; ids: string[]; start: { x: number; y: number }; items: Item[]; box: Box; dx: number; dy: number; moved: boolean; targetsX: number[]; targetsY: number[] };

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function emitEditText(id: string) { window.dispatchEvent(new CustomEvent('franimator:edit-text', { detail: id })); }

export function attachInput(el: HTMLDivElement, scene: Scene, ring: HTMLDivElement): () => void {
  let drag: Drag | null = null;
  let dragId: number | null = null;
  let penSeen = false;
  let inertia = 0;
  let lastTap = { id: '', t: 0 };
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cx: number; cy: number } | null = null;

  const panBy = (dx: number, dy: number) => { scene.touched = true; const s = getState(); s.set({ panX: s.panX + dx, panY: s.panY + dy }); };

  function sample(e: PointerEvent): Sample {
    const p = scene.toWorld(e.clientX, e.clientY);
    let { tiltX, tiltY } = e;
    // Safari reports the Pencil's angle as altitude/azimuth.
    const a = e as PointerEvent & { altitudeAngle?: number; azimuthAngle?: number };
    if (!tiltX && !tiltY && a.altitudeAngle !== undefined && a.azimuthAngle !== undefined && a.altitudeAngle < Math.PI / 2) {
      const lean = ((Math.PI / 2 - a.altitudeAngle) * 180) / Math.PI;
      tiltX = Math.cos(a.azimuthAngle) * lean; tiltY = Math.sin(a.azimuthAngle) * lean;
    }
    return { x: p.x, y: p.y, pressure: e.pressure, tiltX, tiltY, pen: e.pointerType === 'pen' };
  }

  function cancelDrag() {
    if (drag?.kind === 'stroke') drag.stroke.cancel();
    if (drag?.kind === 'shape') scene.setGhost(null);
    if (drag?.kind === 'move') scene.request();
    drag = null; dragId = null;
  }

  function beginSelect(e: PointerEvent) {
    const s = getState();
    if (scene.onHandle(e.clientX, e.clientY)) return;
    const hit = scene.hit(e.clientX, e.clientY);
    if (!hit) { if (!e.shiftKey) s.set({ selection: [], selectedClipId: null }); return; }
    const now = performance.now();
    if (hit.item.type === 'text' && lastTap.id === hit.item.id && now - lastTap.t < 400) { emitEditText(hit.item.id); return; }
    lastTap = { id: hit.item.id, t: now };
    let sel = s.selection;
    if (hit.layerId !== s.activeLayerId) sel = [];
    if (e.shiftKey) sel = sel.includes(hit.item.id) ? sel.filter((i) => i !== hit.item.id) : [...sel, hit.item.id];
    else if (!sel.includes(hit.item.id)) sel = [hit.item.id];
    s.set({ selection: sel, activeLayerId: hit.layerId, selectedClipId: null });
    scene.sync();
    const list = getCel(s.doc, s.frameIndex, hit.layerId);
    const items = list.filter((i) => sel.includes(i.id));
    if (!items.length) return;
    const others = list.filter((i) => !sel.includes(i.id)).map(visualBounds);
    const { width: W, height: H } = s.doc.canvas;
    drag = {
      kind: 'move', ids: sel, start: scene.toWorld(e.clientX, e.clientY), items, box: unionBox(items.map(visualBounds)), dx: 0, dy: 0, moved: false,
      targetsX: [0, W / 2, W, ...s.doc.guides.v, ...others.flatMap((b) => [b.x, b.x + b.width / 2, b.x + b.width])],
      targetsY: [0, H / 2, H, ...s.doc.guides.h, ...others.flatMap((b) => [b.y, b.y + b.height / 2, b.y + b.height])],
    };
  }

  /**
   * Runs before Konva sees the press. Konva's own rotate handle always turns around the
   * selection box's centre, so turning a single object is done here, around its anchor.
   */
  function grab(e: PointerEvent) {
    const s = getState();
    const item = scene.liveSelected();
    if (!item || s.playing || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const p = scene.toWorld(e.clientX, e.clientY);
    const pivot = scene.anchorWorld(item);
    let next: Drag | null = null;
    if (s.anchorMode && Math.hypot(p.x - pivot.x, p.y - pivot.y) * s.zoom < 22) {
      next = { kind: 'anchor', item, pt: pivot, snaps: boxPoints(contentBox(item)).map((b) => toWorld(item, b)) };
    } else if (scene.handleName(e.clientX, e.clientY).includes('rotater')) {
      const pre = pivotPatch(item);
      const node = scene.findNode(item.id)!;
      if (pre.anchor) { node.offset(pre.anchor); node.position(pivot); }
      next = { kind: 'rotate', item, pre, pivot, start: Math.atan2(p.y - pivot.y, p.x - pivot.x), rot: item.rotation };
    }
    if (!next) return;
    e.stopPropagation();
    drag = next; dragId = e.pointerId;
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  }

  function turn(e: PointerEvent, d: Extract<Drag, { kind: 'rotate' }>) {
    const p = scene.toWorld(e.clientX, e.clientY);
    let r = d.item.rotation + ((Math.atan2(p.y - d.pivot.y, p.x - d.pivot.x) - d.start) * 180) / Math.PI;
    if (e.shiftKey) r = Math.round(r / 15) * 15;
    else { const near = Math.round(r / 45) * 45; if (Math.abs(near - r) < 3) r = near; }
    d.rot = ((r + 540) % 360) - 180 || 0;
    scene.findNode(d.item.id)?.rotation(d.rot);
    scene.transformer.forceUpdate();
    scene.stage.batchDraw();
  }

  function moveSelection(e: PointerEvent, d: Extract<Drag, { kind: 'move' }>) {
    const s = getState();
    const p = scene.toWorld(e.clientX, e.clientY);
    let dx = p.x - d.start.x, dy = p.y - d.start.y;
    const range = 6 / s.zoom;
    if (Math.hypot(dx, dy) * s.zoom > 3) d.moved = true;
    if (s.grid.snap) {
      dx += snapAxis(d.box.x + dx, d.box.width, gridLines(d.box.x + dx, d.box.width, s.grid.size), s.grid.size / 2);
      dy += snapAxis(d.box.y + dy, d.box.height, gridLines(d.box.y + dy, d.box.height, s.grid.size), s.grid.size / 2);
    } else if (s.grid.snapObjects) {
      dx += snapAxis(d.box.x + dx, d.box.width, d.targetsX, range);
      dy += snapAxis(d.box.y + dy, d.box.height, d.targetsY, range);
    }
    d.dx = dx; d.dy = dy;
    const orig = new Map(d.items.map((i) => [i.id, i]));
    scene.nudge(d.ids, (it) => { const o = orig.get(it.id)!; return { x: o.x + dx, y: o.y + dy }; });
  }

  function down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button > 1) return;
    cancelAnimationFrame(inertia);
    const s = getState();
    if (s.playing) s.set({ playing: false });
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) {
        cancelDrag();
        const [a, b] = [...touches.values()];
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        return;
      }
      // Palm rejection: once a pen is in use, a resting hand must not draw.
      if (penSeen && !['hand', 'zoom', 'select'].includes(s.tool)) return;
    }
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    const handOn = s.tool === 'hand' || keyState.space || e.button === 1;
    if (handOn) {
      if (keyState.space) keyState.spacePanned = true;
      drag = { kind: 'pan', x: e.clientX, y: e.clientY, vx: 0, vy: 0, t: performance.now() };
    } else {
      const p = scene.toWorld(e.clientX, e.clientY);
      switch (s.tool) {
        case 'pencil': case 'brush': case 'eraser':
          if (canEditLayer()) { const st = new Stroke(s.tool); st.add(sample(e)); drag = { kind: 'stroke', stroke: st }; }
          break;
        case 'shape':
          if (canEditLayer()) drag = { kind: 'shape', x0: p.x, y0: p.y, item: null };
          break;
        case 'text': {
          const hit = scene.hit(e.clientX, e.clientY);
          if (hit?.item.type === 'text') { s.set({ activeLayerId: hit.layerId }); emitEditText(hit.item.id); break; }
          if (canEditLayer()) { const t = textItem(p.x, p.y); s.addItem(t); requestAnimationFrame(() => emitEditText(t.id)); }
          break;
        }
        case 'bucket': void bucketAt(p.x, p.y, e.clientX, e.clientY); break;
        case 'eyedropper': void eyedropperAt(p.x, p.y); break;
        case 'zoom': {
          scene.touched = true;
          const l = scene.toLocal(e.clientX, e.clientY);
          s.zoomTo(s.zoom * (e.altKey ? 1 / (1 + s.settings.zoom.step) : 1 + s.settings.zoom.step), l.x, l.y);
          break;
        }
        case 'select': beginSelect(e); break;
      }
    }
    if (drag) { dragId = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch { /* synthetic events */ } }
  }

  function move(e: PointerEvent) {
    updateRing(e);
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && touches.size >= 2) {
        const [a, b] = [...touches.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const s = getState();
        scene.touched = true;
        const l = scene.toLocal(cx, cy);
        s.zoomTo(s.zoom * (dist / (pinch.dist || 1)), l.x, l.y);
        panBy(cx - pinch.cx, cy - pinch.cy);
        pinch = { dist, cx, cy };
        return;
      }
    }
    const s = getState();
    if (dragId === null || e.pointerId !== dragId || !drag) {
      if (e.pointerType !== 'touch') {
        const p = scene.toWorld(e.clientX, e.clientY);
        s.set({ cursor: { x: Math.round(p.x), y: Math.round(p.y) } });
      }
      return;
    }
    switch (drag.kind) {
      case 'stroke': {
        // getCoalescedEvents is missing on older Safari, so it is feature-detected.
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
        (list.length ? list : [e]).forEach((c) => (drag as { stroke: Stroke }).stroke.add(sample(c)));
        break;
      }
      case 'pan': {
        const k = s.tool === 'hand' ? s.settings.hand.speed : 1;
        const dx = (e.clientX - drag.x) * k, dy = (e.clientY - drag.y) * k;
        const now = performance.now(), dt = Math.max(1, now - drag.t);
        drag.vx = (dx / dt) * 16; drag.vy = (dy / dt) * 16;
        drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
        panBy(dx, dy);
        break;
      }
      case 'shape': {
        const p = scene.toWorld(e.clientX, e.clientY);
        drag.item = shapeItem(drag.x0, drag.y0, p.x, p.y, e.shiftKey);
        scene.setGhost(drag.item);
        break;
      }
      case 'move': moveSelection(e, drag); break;
      case 'rotate': turn(e, drag); break;
      case 'anchor': {
        const p = scene.toWorld(e.clientX, e.clientY);
        // Corners, edges and centre are sticky, so the usual spots are easy to hit.
        const near = drag.snaps.find((q) => Math.hypot(q.x - p.x, q.y - p.y) * s.zoom < 10);
        drag.pt = near ?? p;
        scene.placeMarker(drag.pt);
        break;
      }
    }
  }

  function up(e: PointerEvent) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (e.pointerId !== dragId || !drag) return;
    const d = drag;
    drag = null; dragId = null;
    const s = getState();
    if (e.type === 'pointercancel') { drag = d; dragId = e.pointerId; cancelDrag(); return; }
    switch (d.kind) {
      case 'stroke': d.stroke.end(); break;
      case 'pan': {
        let { vx, vy } = d;
        if (reduceMotion() || performance.now() - d.t > 80) break;
        const step = () => {
          vx *= 0.92; vy *= 0.92;
          if (Math.hypot(vx, vy) < 0.3) return;
          panBy(vx, vy);
          inertia = requestAnimationFrame(step);
        };
        inertia = requestAnimationFrame(step);
        break;
      }
      case 'shape': {
        const item = d.item ?? shapeItem(d.x0 - 60, d.y0 - 60, d.x0 + 60, d.y0 + 60, false);
        scene.setGhost(null);
        s.addItem(item);
        break;
      }
      case 'rotate': s.updateItems([d.item.id], { ...d.pre, rotation: d.rot } as Partial<Item>, 'Rotate'); break;
      case 'anchor': {
        const anchor = toLocal(d.item, d.pt);
        s.updateItems([d.item.id], withAnchor(d.item, anchor) as Partial<Item>, 'Move anchor');
        break;
      }
      case 'move': {
        if (!d.moved) { scene.request(); break; }
        const orig = new Map(d.items.map((i) => [i.id, i]));
        s.updateItems(d.ids, (it) => { const o = orig.get(it.id)!; return { x: o.x + d.dx, y: o.y + d.dy }; }, 'Move');
        break;
      }
    }
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    scene.touched = true;
    const s = getState();
    const l = scene.toLocal(e.clientX, e.clientY);
    s.zoomTo(s.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), l.x, l.y);
  }

  function updateRing(e: PointerEvent) {
    const s = getState();
    const size = s.tool === 'pencil' ? s.settings.pencil.size : s.tool === 'brush' ? s.settings.brush.size : s.tool === 'eraser' ? s.settings.eraser.size : 0;
    const d = size * s.zoom;
    if (!size || d < 6 || e.pointerType === 'touch') { ring.style.display = 'none'; return; }
    const p = scene.toLocal(e.clientX, e.clientY);
    ring.style.cssText = `display:block;width:${d}px;height:${d}px;left:${p.x - d / 2}px;top:${p.y - d / 2}px`;
  }
  const leave = () => { ring.style.display = 'none'; getState().set({ cursor: null }); };

  /** The Transformer changed nodes directly; write the results back as one undo step. */
  scene.onTransformEnd = () => {
    const s = getState();
    const nodes = scene.transformer.nodes() as Konva.Node[];
    const attrs = new Map(nodes.map((n) => [n.id(), { x: n.x(), y: n.y(), rotation: n.rotation(), scaleX: n.scaleX(), scaleY: n.scaleY() }]));
    s.commit('Transform', (d) => {
      for (const l of shownLayers(d)) {
        const list = l.pinned ? d.pinned[l.id] : d.frames[s.frameIndex].cels[l.id];
        list?.forEach((it) => { const a = attrs.get(it.id); if (a) Object.assign(it, a); });
      }
    });
  };

  // Konva's handles also start on these, so keep them away while we own the gesture.
  const shield = (e: Event) => { if (drag?.kind === 'rotate' || drag?.kind === 'anchor') e.stopPropagation(); };
  el.addEventListener('mousedown', shield, true);
  el.addEventListener('touchstart', shield, true);
  el.addEventListener('pointerdown', grab, true);
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return () => {
    el.removeEventListener('mousedown', shield, true);
    el.removeEventListener('touchstart', shield, true);
    el.removeEventListener('pointerdown', grab, true);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
    scene.onTransformEnd = null;
  };
}

/** Finish inline text editing: keep the text, or drop the object if it was left empty. */
export function applyText(id: string, text: string) {
  const s = getState();
  if (!text.trim()) { s.commit('Delete text', (d) => { const l = celDraft(d, s.frameIndex, s.activeLayerId); const i = l.findIndex((x) => x.id === id); if (i >= 0) l.splice(i, 1); }); return; }
  const cur = currentItems(s).find((i) => i.id === id);
  if (cur?.type !== 'text' || cur.text === text) return;
  s.updateItems([id], { text, ...measureText({ ...cur, text }) } as Partial<Item>, 'Edit text');
}
