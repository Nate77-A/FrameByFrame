/** Outlines for shape items, written against the small path API that canvas and Konva contexts share. */
import type { ShapeItem } from '../core/types';

interface PathTarget {
  beginPath?(): void; closePath(): void;
  moveTo(x: number, y: number): void; lineTo(x: number, y: number): void;
  arcTo(a: number, b: number, c: number, d: number, r: number): void;
  ellipse?(x: number, y: number, rx: number, ry: number, rot: number, s: number, e: number): void;
}
export interface Pt { x: number; y: number }

export function polygonPoints(s: Pick<ShapeItem, 'shape' | 'sides' | 'points' | 'width' | 'height'>): Pt[] {
  const { width: w, height: h } = s;
  if (s.shape === 'rect') return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  if (s.shape === 'triangle') return [{ x: w / 2, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
  const out: Pt[] = [];
  const n = s.shape === 'star' ? Math.max(3, s.points) * 2 : Math.max(3, s.sides);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = s.shape === 'star' && i % 2 ? 0.45 : 1;
    out.push({ x: w / 2 + (Math.cos(a) * r * w) / 2, y: h / 2 + (Math.sin(a) * r * h) / 2 });
  }
  return out;
}

export function traceShape(ctx: PathTarget, s: ShapeItem): void {
  ctx.beginPath?.();
  if (s.shape === 'ellipse') {
    const { width: w, height: h } = s;
    ctx.ellipse!(w / 2, h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
    ctx.closePath();
    return;
  }
  const pts = polygonPoints(s);
  const r = s.cornerRadius;
  if (r <= 0) {
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  } else {
    // Start between two corners so the first corner can be rounded too.
    const n = pts.length;
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = mid(pts[n - 1], pts[0]);
    ctx.moveTo(start.x, start.y);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const edge = Math.hypot(q.x - p.x, q.y - p.y);
      ctx.arcTo(p.x, p.y, q.x, q.y, Math.min(r, edge / 2));
    }
  }
  ctx.closePath();
}
