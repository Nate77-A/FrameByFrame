/** One factory turns document items into Konva nodes for the stage, thumbnails and exports alike. */
import Konva from 'konva';
import type { Gradient, Item, Paint, ShapeItem, TextItem } from '../core/types';
import { bitmaps, ctx2d, makeCanvas } from '../core/bitmaps';
import { blendToComposite } from '../core/store';
import { traceShape } from './geometry';

export function gradientCanvas(g: Gradient, w: number, h: number): HTMLCanvasElement {
  const c = makeCanvas(w, h);
  const x = ctx2d(c);
  let fill: CanvasGradient;
  const a = (g.angle * Math.PI) / 180;
  if (g.kind === 'radial') fill = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
  else if (g.kind === 'conic') fill = x.createConicGradient(a, w / 2, h / 2);
  else {
    const len = (Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a))) / 2;
    fill = x.createLinearGradient(w / 2 - Math.cos(a) * len, h / 2 - Math.sin(a) * len, w / 2 + Math.cos(a) * len, h / 2 + Math.sin(a) * len);
  }
  [...g.stops].sort((p, q) => p.offset - q.offset).forEach((s) => fill.addColorStop(s.offset, s.color));
  x.fillStyle = fill;
  x.fillRect(0, 0, w, h);
  return c;
}

const paintAttrs = (p: Paint, w: number, h: number): Konva.ShapeConfig => {
  if (p === null) return {};
  if (typeof p === 'string') return { fill: p };
  return { fillPatternImage: gradientCanvas(p, Math.max(1, Math.abs(w)), Math.max(1, Math.abs(h))) as unknown as HTMLImageElement, fillPriority: 'pattern' };
};

const fontStyle = (t: TextItem) => [t.italic ? 'italic' : '', t.bold ? 'bold' : ''].filter(Boolean).join(' ') || 'normal';
const textDecoration = (t: TextItem) => [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ');

const textNode = (t: TextItem) => new Konva.Text({
  text: t.text || ' ', fontFamily: t.fontFamily, fontSize: t.fontSize, fontStyle: fontStyle(t),
  textDecoration: textDecoration(t), align: t.align, fill: t.color, lineHeight: t.lineHeight, letterSpacing: t.letterSpacing,
  ...(t.outline ? { stroke: t.outlineColor, strokeWidth: t.outlineWidth, fillAfterStrokeEnabled: true } : {}),
});

/** Text is always sized to fit its content; scaling happens through the transform. */
export function measureText(t: TextItem): { width: number; height: number } {
  const n = textNode(t);
  const size = { width: Math.ceil(n.width()) + 4, height: Math.ceil(n.height()) };
  n.destroy();
  return size;
}

function buildNode(item: Item): Konva.Node {
  const base = {
    id: item.id, x: item.x, y: item.y, rotation: item.rotation, scaleX: item.scaleX, scaleY: item.scaleY,
    opacity: item.opacity, offsetX: item.width / 2, offsetY: item.height / 2, listening: false,
  };
  switch (item.type) {
    case 'raster':
    case 'image': {
      const canvas = bitmaps.get(item.bitmap);
      const node = new Konva.Image({ ...base, image: (canvas ?? undefined) as unknown as HTMLImageElement, width: item.width, height: item.height });
      if (item.type === 'image' && canvas) applyFilters(node, item.filters);
      return node;
    }
    case 'shape': {
      const s = item as ShapeItem;
      const gradient = s.fill && typeof s.fill !== 'string' ? s.fill : null;
      return new Konva.Shape({
        ...base, width: s.width, height: s.height,
        ...paintAttrs(s.fill, s.width, s.height),
        ...(s.stroke && s.strokeWidth > 0 ? { stroke: s.stroke, strokeWidth: s.strokeWidth } : {}),
        ...(s.shadow ? { shadowColor: s.shadow.color, shadowBlur: s.shadow.blur, shadowOffsetX: s.shadow.x, shadowOffsetY: s.shadow.y } : {}),
        ...(gradient && gradient.blend !== 'normal' ? { globalCompositeOperation: blendToComposite(gradient.blend) } : {}),
        sceneFunc(ctx: Konva.Context, shape: Konva.Shape) { traceShape(ctx, s); ctx.fillStrokeShape(shape); },
      });
    }
    case 'text': {
      const g = new Konva.Group({ ...base });
      if (item.background) g.add(new Konva.Rect({ width: item.width, height: item.height, fill: item.background, cornerRadius: 6, listening: false }));
      const n = textNode(item);
      n.setAttrs({ x: 2, listening: false });
      g.add(n);
      return g;
    }
  }
}

function applyFilters(node: Konva.Image, f: { blur: number; brightness: number; contrast: number; grayscale: boolean; sepia: boolean; invert: boolean }) {
  const list: (typeof Konva.Filters.Blur)[] = [];
  if (f.blur > 0) { list.push(Konva.Filters.Blur); node.blurRadius(f.blur); }
  if (f.brightness !== 0) { list.push(Konva.Filters.Brighten); node.brightness(f.brightness); }
  if (f.contrast !== 0) { list.push(Konva.Filters.Contrast); node.contrast(f.contrast); }
  if (f.grayscale) list.push(Konva.Filters.Grayscale);
  if (f.sepia) list.push(Konva.Filters.Sepia);
  if (f.invert) list.push(Konva.Filters.Invert);
  if (list.length) { node.cache(); node.filters(list); }
}

export function createNode(item: Item): Konva.Node { return buildNode(item); }
