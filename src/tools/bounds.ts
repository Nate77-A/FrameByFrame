/** Axis-aligned bounds and snapping maths. */
import type { ItemBase } from '../core/types';
export interface Box { x: number; y: number; width: number; height: number }

export interface Pt { x: number; y: number }
type Placed = Pick<ItemBase, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY' | 'anchor'>;

export const anchorOf = (i: Placed): Pt => i.anchor ?? { x: i.width / 2, y: i.height / 2 };

/** Item coordinates to canvas coordinates. */
export function toWorld(i: Placed, p: Pt): Pt {
  const a = anchorOf(i), r = (i.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = (p.x - a.x) * i.scaleX, dy = (p.y - a.y) * i.scaleY;
  return { x: i.x + dx * c - dy * s, y: i.y + dx * s + dy * c };
}
/** Canvas coordinates to item coordinates. */
export function toLocal(i: Placed, p: Pt): Pt {
  const a = anchorOf(i), r = (i.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const dx = p.x - i.x, dy = p.y - i.y;
  return { x: a.x + (dx * c + dy * s) / i.scaleX, y: a.y + (-dx * s + dy * c) / i.scaleY };
}
/** New anchor, with x / y adjusted so the item does not move on the canvas. */
export function withAnchor(i: Placed, anchor: Pt) {
  const w = toWorld(i, anchor);
  return { anchor, x: w.x, y: w.y };
}
export function boxPoints(b: Box): Pt[] {
  const xs = [b.x, b.x + b.width / 2, b.x + b.width], ys = [b.y, b.y + b.height / 2, b.y + b.height];
  return ys.flatMap((y) => xs.map((x) => ({ x, y })));
}

/** Canvas-aligned bounds of a rectangle inside the item (the whole item by default). */
export function itemBounds(i: Placed, box: Box = { x: 0, y: 0, width: i.width, height: i.height }): Box {
  const pts = [[box.x, box.y], [box.x + box.width, box.y], [box.x + box.width, box.y + box.height], [box.x, box.y + box.height]]
    .map(([x, y]) => toWorld(i, { x, y }));
  const x = Math.min(...pts.map((p) => p.x)), y = Math.min(...pts.map((p) => p.y));
  return { x, y, width: Math.max(...pts.map((p) => p.x)) - x, height: Math.max(...pts.map((p) => p.y)) - y };
}
export const rectsOverlap = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export function unionBox(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
}

/** Offset that moves a box's edges or centre onto the nearest target line, if one is within range. */
export function snapAxis(lo: number, size: number, targets: number[], range: number): number {
  let best = 0, dist = range;
  for (const v of [lo, lo + size / 2, lo + size]) {
    for (const t of targets) {
      const d = Math.abs(t - v);
      if (d < dist) { dist = d; best = t - v; }
    }
  }
  return best;
}
export function gridLines(lo: number, size: number, step: number): number[] {
  const a = Math.round(lo / step) * step, b = Math.round((lo + size) / step) * step;
  return [a, a + step, b, b - step];
}
