/** Axis-aligned bounds and snapping maths. */
import type { ItemBase } from '../core/types';
export interface Box { x: number; y: number; width: number; height: number }

export function itemBounds(i: ItemBase): Box {
  const hw = (i.width * Math.abs(i.scaleX)) / 2, hh = (i.height * Math.abs(i.scaleY)) / 2;
  const a = (i.rotation * Math.PI) / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
  const ex = hw * c + hh * s, ey = hw * s + hh * c;
  return { x: i.x - ex, y: i.y - ey, width: ex * 2, height: ey * 2 };
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
