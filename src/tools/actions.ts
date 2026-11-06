/** One-shot canvas actions: bucket, eyedropper, shapes, text, images. */
import type { Item, ShapeItem, TextItem } from '../core/types';
import { LIMITS } from '../core/types';
import { bitmaps, ctx2d, makeCanvas } from '../core/bitmaps';
import { getCel, uid } from '../core/doc';
import { getState } from '../core/store';
import { drawItems, prepareFrame, renderFrame } from '../render/compositor';
import { gradientCanvas, measureText } from '../render/nodes';
import { sceneRef } from '../render/scene';
import { dilate, floodMask } from './flood';
import { paintOnTop } from './brush';

const transformDefaults = { rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };

export const canEditLayer = (): boolean => {
  const s = getState();
  const l = s.doc.layers.find((x) => x.id === s.activeLayerId);
  if (l?.locked) { s.toast('This layer is locked! Tap 🔒 to unlock it.'); return false; }
  if (l && !l.visible) { s.toast('This layer is hidden! Tap 👁 to show it.'); return false; }
  return true;
};

export const activePaint = () => {
  const s = getState();
  return s.colorMode === 'gradient' ? s.gradient : s.color;
};

export function shapeItem(x0: number, y0: number, x1: number, y1: number, square: boolean): ShapeItem {
  const s = getState();
  const st = s.settings.shape;
  let w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
  if (square) w = h = Math.max(w, h);
  const left = x1 < x0 ? x0 - w : x0, top = y1 < y0 ? y0 - h : y0;
  return {
    id: uid(), type: 'shape', shape: st.kind, sides: st.sides, points: st.points, cornerRadius: st.cornerRadius,
    fill: st.noFill ? null : activePaint(), stroke: st.noStroke ? null : s.bgColor, strokeWidth: st.strokeWidth, shadow: null,
    x: left + w / 2, y: top + h / 2, width: Math.max(1, w), height: Math.max(1, h), ...transformDefaults,
  };
}

export function textItem(x: number, y: number): TextItem {
  const s = getState();
  const base: TextItem = {
    ...s.settings.text, id: uid(), type: 'text', text: 'Hello!', color: s.color, x, y, width: 10, height: 10, ...transformDefaults,
  };
  return { ...base, ...measureText(base) };
}

export async function bucketAt(x: number, y: number, clientX: number, clientY: number) {
  const s = getState();
  if (!canEditLayer()) return;
  const st = s.settings.bucket;
  const { width: w, height: h } = s.doc.canvas;
  if (st.mode === 'shape') {
    const hit = sceneRef.current?.hit(clientX, clientY);
    if (hit?.item.type === 'shape') { s.updateItems([hit.item.id], { fill: activePaint() } as Partial<Item>, 'Fill shape'); return; }
  }
  const px = Math.floor(x), py = Math.floor(y);
  if (px < 0 || py < 0 || px >= w || py >= h) return;
  await prepareFrame(s.doc, s.frameIndex);
  const flat = makeCanvas(w, h);
  const fx = ctx2d(flat, true);
  drawItems(fx, getCel(s.doc, s.frameIndex, s.activeLayerId), w, h, 1);
  const img = fx.getImageData(0, 0, w, h);
  const res = floodMask(img.data, w, h, px, py, st.tolerance, st.mode !== 'all');
  if (!res.count) return;
  dilate(res, w, h);
  const rw = res.maxX - res.minX + 1, rh = res.maxY - res.minY + 1;
  const useGradient = st.gradient || s.colorMode === 'gradient';
  const fill = useGradient ? gradientCanvas(s.gradient, rw, rh) : makeCanvas(rw, rh);
  const fc = ctx2d(fill, true);
  if (!useGradient) { fc.fillStyle = s.color; fc.fillRect(0, 0, rw, rh); }
  const out = fc.getImageData(0, 0, rw, rh);
  for (let j = 0; j < rh; j++) for (let i = 0; i < rw; i++)
    if (!res.mask[(j + res.minY) * w + i + res.minX]) out.data[(j * rw + i) * 4 + 3] = 0;
  fc.putImageData(out, 0, 0);
  paintOnTop(fill, { x: res.minX, y: res.minY, width: rw, height: rh }, 1, 'source-over', 'Paint bucket', 0, 0);
  sceneRef.current?.sync();
}

export async function eyedropperAt(x: number, y: number) {
  const s = getState();
  const st = s.settings.eyedropper;
  const { width: w, height: h } = s.doc.canvas;
  const flat = makeCanvas(w, h);
  if (st.allLayers) await renderFrame(s.doc, s.frameIndex, flat, { width: w, height: h });
  else { await prepareFrame(s.doc, s.frameIndex); drawItems(ctx2d(flat), getCel(s.doc, s.frameIndex, s.activeLayerId), w, h, 1); }
  const n = st.sample, half = (n - 1) / 2;
  const d = ctx2d(flat, true).getImageData(Math.floor(x) - half, Math.floor(y) - half, n, n).data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < d.length; i += 4) { const k = d[i + 3] / 255; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; a += k; }
  if (!a) { s.toast('Nothing to pick there!'); return; }
  const to = (v: number) => Math.round(v / a).toString(16).padStart(2, '0');
  s.set({ color: `#${to(r)}${to(g)}${to(b)}`, colorMode: 'solid' });
}

/** Add a picture to the active layer, shrinking anything huge (spec §4.3). */
export async function importImage(file: Blob) {
  const s = getState();
  if (!canEditLayer()) return;
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, LIMITS.maxImageSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
  const bitmap = bitmaps.fromCanvas(bmp, w, h);
  bmp.close();
  const { width: cw, height: ch } = s.doc.canvas;
  const fit = Math.min(1, (cw * 0.8) / w, (ch * 0.8) / h);
  const item: Item = {
    id: uid(), type: 'image', bitmap, filters: { blur: 0, brightness: 0, contrast: 0, grayscale: false, sepia: false, invert: false },
    x: cw / 2, y: ch / 2, width: w, height: h, rotation: 0, scaleX: fit, scaleY: fit, opacity: 1,
  };
  s.addItem(item);
  s.set({ tool: 'select', selection: [item.id] });
}
