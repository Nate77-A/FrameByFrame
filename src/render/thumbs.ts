/** Cel thumbnails, cached per item list: an unchanged cel keeps the same array, so the cache is exact. */
import type { Item, ProjectDoc } from '../core/types';
import { bitmaps, ctx2d, makeCanvas } from '../core/bitmaps';
import { bitmapIds } from '../core/doc';
import { drawItems } from './compositor';

const cache = new WeakMap<Item[], HTMLCanvasElement>();
const queue = new Set<Item[]>();
let timer: ReturnType<typeof setTimeout> | null = null;
let onReady: () => void = () => {};
export const setThumbListener = (f: () => void) => { onReady = f; };
const TH = 72;

async function pump(doc: ProjectDoc) {
  timer = null;
  const batch = [...queue].slice(0, 12);
  for (const items of batch) {
    queue.delete(items);
    await bitmaps.ensure(items.flatMap((i) => bitmapIds([i])));
    const k = TH / doc.canvas.height;
    const c = makeCanvas(doc.canvas.width * k, TH);
    drawItems(ctx2d(c), items, doc.canvas.width, doc.canvas.height, k);
    cache.set(items, c);
  }
  if (batch.length) onReady();
  if (queue.size) timer = setTimeout(() => void pump(doc), 16);
}

export function thumbFor(items: Item[], doc: ProjectDoc): HTMLCanvasElement | null {
  const hit = cache.get(items);
  if (hit) return hit;
  if (!queue.has(items)) {
    queue.add(items);
    if (queue.size > 400) queue.delete(queue.values().next().value!);
  }
  // Debounced so a burst of edits only redraws once (spec §7.0).
  timer ??= setTimeout(() => void pump(doc), 200);
  return null;
}
