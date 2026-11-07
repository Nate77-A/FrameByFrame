/** Off-screen rendering shared by thumbnails, onion skin and every export format, so they all match. */
import Konva from 'konva';
import type { Item, ProjectDoc } from '../core/types';
import { bitmaps, ctx2d, makeCanvas } from '../core/bitmaps';
import { bitmapIds, getCel, shownLayers } from '../core/doc';
import { blendToComposite } from '../core/store';
import { createNode } from './nodes';

let host: { stage: Konva.Stage; layer: Konva.Layer } | null = null;
function offscreen(w: number, h: number) {
  if (!host) {
    const stage = new Konva.Stage({ container: document.createElement('div'), width: w, height: h });
    const layer = new Konva.Layer({ listening: false });
    stage.add(layer);
    host = { stage, layer };
  }
  host.stage.size({ width: w, height: h });
  return host;
}

const isPlainRaster = (i: Item) =>
  i.type === 'raster' && !i.anchor && !i.rotation && i.scaleX === 1 && i.scaleY === 1 && i.x === i.width / 2 && i.y === i.height / 2;

/** Draw a list of items onto ctx at the given scale. Bitmaps must already be decoded. */
export function drawItems(ctx: CanvasRenderingContext2D, items: Item[], artW: number, artH: number, scale: number): void {
  let run: Item[] = [];
  const flush = () => {
    if (!run.length) return;
    const { layer } = offscreen(artW, artH);
    layer.destroyChildren();
    run.forEach((i) => layer.add(createNode(i) as Konva.Shape));
    const c = layer.toCanvas({ x: 0, y: 0, width: artW, height: artH, pixelRatio: scale });
    ctx.drawImage(c, 0, 0, artW * scale, artH * scale);
    layer.destroyChildren();
    run = [];
  };
  for (const item of items) {
    if (isPlainRaster(item)) {
      flush();
      const src = bitmaps.get((item as { bitmap: string }).bitmap);
      if (!src) continue;
      ctx.save();
      ctx.globalAlpha = item.opacity;
      ctx.drawImage(src, 0, 0, item.width * scale, item.height * scale);
      ctx.restore();
    } else run.push(item);
  }
  flush();
}

/** Pre-decode everything a frame needs. */
export async function prepareFrame(doc: ProjectDoc, frame: number): Promise<void> {
  await bitmaps.ensure(doc.layers.flatMap((l) => bitmapIds(getCel(doc, frame, l.id))));
}

export interface FrameOpts {
  width: number; height: number;
  transparent?: boolean;
  /** Skip pinned layers and paper, as onion skin wants. */
  movingOnly?: boolean;
}

let scratch: HTMLCanvasElement | null = null;

/** Composite one full frame into target. Matches the live view's layer opacity and blend modes. */
export async function renderFrame(doc: ProjectDoc, frame: number, target: HTMLCanvasElement, o: FrameOpts): Promise<void> {
  await prepareFrame(doc, frame);
  const { width, height } = o;
  const scale = width / doc.canvas.width;
  if (target.width !== width) target.width = width;
  if (target.height !== height) target.height = height;
  const ctx = ctx2d(target);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, width, height);
  if (doc.canvas.background && !o.transparent && !o.movingOnly) {
    ctx.fillStyle = doc.canvas.background;
    ctx.fillRect(0, 0, width, height);
  }
  scratch ??= makeCanvas(width, height);
  if (scratch.width !== width || scratch.height !== height) { scratch.width = width; scratch.height = height; }
  const sc = ctx2d(scratch);
  for (const layer of shownLayers(doc)) {
    if (o.movingOnly && layer.pinned) continue;
    const items = getCel(doc, frame, layer.id);
    if (!items.length) continue;
    sc.clearRect(0, 0, width, height);
    drawItems(sc, items, doc.canvas.width, doc.canvas.height, scale);
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = blendToComposite(layer.blendMode);
    ctx.drawImage(scratch, 0, 0);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
}

/** Flatten items into a canvas covering exactly this box, which may reach beyond the artboard. */
export function flattenRegion(items: Item[], box: { x: number; y: number; width: number; height: number }, scale = 1): HTMLCanvasElement {
  const { layer } = offscreen(16, 16);
  layer.destroyChildren();
  items.forEach((i) => layer.add(createNode(i) as Konva.Shape));
  const c = layer.toCanvas({ x: box.x, y: box.y, width: box.width, height: box.height, pixelRatio: scale });
  layer.destroyChildren();
  return c;
}

/** Flatten items into a fresh artboard-sized canvas (used when the eraser touches an object). */
export function rasterizeItems(items: Item[], w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  drawItems(ctx2d(c), items, w, h, 1);
  return c;
}
