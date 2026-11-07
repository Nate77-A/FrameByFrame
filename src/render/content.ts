/** Where an item's visible pixels are, so selection follows the drawing rather than the whole canvas. */
import type { Item } from '../core/types';
import { bitmaps, ctx2d } from '../core/bitmaps';
import { itemBounds, withAnchor, type Box } from '../tools/bounds';

const cache = new Map<string, Box>();

function scan(c: HTMLCanvasElement): Box | null {
  const { width: w, height: h } = c;
  const d = ctx2d(c, true).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < h; y++) for (let x = 0; x < w; x++, i += 4) {
    if (d[i] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** The visible part of an item, in its own coordinates. */
export function contentBox(i: Item): Box {
  const full = { x: 0, y: 0, width: i.width, height: i.height };
  if (i.type !== 'raster') return full;
  const key = `${i.bitmap}:${i.rev}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = bitmaps.get(i.bitmap);
  if (!c) return full;
  const box = scan(c) ?? full;
  if (cache.size > 500) cache.clear();
  cache.set(key, box);
  return box;
}
export const visualBounds = (i: Item): Box => itemBounds(i, contentBox(i));

/** A drawing with no chosen anchor turns around its visible middle, not the canvas middle. */
export function pivotPatch(i: Item): Partial<Item> {
  if (i.anchor || i.type !== 'raster') return {};
  const b = contentBox(i);
  return withAnchor(i, { x: b.x + b.width / 2, y: b.y + b.height / 2 });
}
