/** Floating window listing a layer's objects, front first, to change their order. */
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react';
import type { Item } from '../core/types';
import { bitmaps, ctx2d } from '../core/bitmaps';
import { bitmapIds } from '../core/doc';
import { activeLayer, currentItems, getState, useStore } from '../core/store';
import { flattenRegion } from '../render/compositor';
import { visualBounds } from '../render/content';
import { tip } from './Tooltip';

const ROW = 54;
const SHAPE_NAMES = { rect: 'Rectangle', triangle: 'Triangle', ellipse: 'Oval', polygon: 'Polygon', star: 'Star' };

function nameOf(i: Item): string {
  if (i.type === 'raster') return 'Drawing';
  if (i.type === 'image') return 'Picture';
  if (i.type === 'shape') return SHAPE_NAMES[i.shape];
  return `"${i.text.split('\n')[0]}"`;
}

function Thumb({ item }: { item: Item }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void bitmaps.ensure(bitmapIds([item])).then(() => {
      const c = ref.current;
      if (!live || !c) return;
      const b = visualBounds(item);
      const box = { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.max(1, Math.ceil(b.width)), height: Math.max(1, Math.ceil(b.height)) };
      const k = Math.min(1, 80 / Math.max(box.width, box.height));
      const pic = flattenRegion([item], box, k);
      c.width = c.height = 88;
      const x = ctx2d(c);
      const f = 80 / Math.max(pic.width, pic.height);
      x.drawImage(pic, 44 - (pic.width * f) / 2, 44 - (pic.height * f) / 2, pic.width * f, pic.height * f);
    });
    return () => { live = false; };
  }, [item]);
  return <canvas ref={ref} className="order-thumb" aria-hidden />;
}

export function ObjectOrder() {
  const items = useStore(currentItems);
  const layer = useStore(activeLayer);
  const selection = useStore((s) => s.selection);
  const frame = useStore((s) => s.frameIndex);
  const { set, moveItem } = useStore.getState();
  const [pos, setPos] = useState({ x: Math.max(8, innerWidth - 600), y: 112 });
  const [lift, setLift] = useState<{ row: number; dy: number } | null>(null);
  const rows = [...items].reverse();
  const last = rows.length - 1;
  // Rows run front to back; the document runs back to front.
  const moveRow = (from: number, to: number) => moveItem(last - from, last - to);

  const dragWindow = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const dx = e.clientX - pos.x, dy = e.clientY - pos.y;
    const mv = (ev: PointerEvent) => setPos({ x: Math.max(0, Math.min(innerWidth - 120, ev.clientX - dx)), y: Math.max(0, Math.min(innerHeight - 50, ev.clientY - dy)) });
    const end = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end); };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', end);
  };
  const dragRow = (e: React.PointerEvent, row: number) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY;
    const mv = (ev: PointerEvent) => setLift({ row, dy: ev.clientY - y0 });
    const end = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', end);
      setLift(null);
      const to = Math.max(0, Math.min(last, row + Math.round((ev.clientY - y0) / ROW)));
      moveRow(row, to);
    };
    el.addEventListener('pointermove', mv);
    el.addEventListener('pointerup', end);
  };
  const pick = (e: React.MouseEvent, id: string) => {
    const cur = getState().selection;
    const next = e.shiftKey ? (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]) : [id];
    set({ tool: 'select', selection: next, selectedClipId: null });
  };
  return (
    <section className="order" role="dialog" aria-label="Object Order" style={{ left: pos.x, top: pos.y }}>
      <header onPointerDown={dragWindow}>
        <h2>Object Order</h2>
        <button className="btn small" {...tip('Close this window')} onClick={() => set({ orderOpen: false })}><X size={18} /></button>
      </header>
      <div className="sub">{layer?.name}, frame {layer?.pinned ? 'all' : frame + 1}. Top of the list is in front.</div>
      {!rows.length && <p className="hint" style={{ padding: 16 }}>Nothing on this layer yet!</p>}
      <ul>
        {rows.map((item, r) => (
          <li key={item.id} className={`order-row ${selection.includes(item.id) ? 'on' : ''} ${lift?.row === r ? 'drag' : ''}`} style={lift?.row === r ? { transform: `translateY(${lift.dy}px)` } : undefined} data-testid="order-row">
            <span className="order-grip" data-tooltip="Drag me up or down!" onPointerDown={(e) => dragRow(e, r)}><GripVertical size={18} /></span>
            <button className="order-pick" aria-label={`Select ${nameOf(item)}`} data-tooltip="Click to select this object!" onClick={(e) => pick(e, item.id)}><Thumb item={item} /><span>{nameOf(item)}</span></button>
            <button className="btn small" disabled={r === 0} {...tip('Move forward')} onClick={() => moveRow(r, r - 1)}><ArrowUp size={16} /></button>
            <button className="btn small" disabled={r === last} {...tip('Move back')} onClick={() => moveRow(r, r + 1)}><ArrowDown size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  );
}
