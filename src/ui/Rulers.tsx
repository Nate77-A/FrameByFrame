/** Rulers along the canvas; dragging from one drops a guide line (spec §4.3). */
import { useEffect, useRef } from 'react';
import { getState, useStore } from '../core/store';
import { ctx2d } from '../core/bitmaps';
import { sceneRef } from '../render/scene';
import { tip } from './Tooltip';

const T = 20;
function draw(c: HTMLCanvasElement, horizontal: boolean) {
  const s = getState();
  const ratio = devicePixelRatio;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * ratio; c.height = rect.height * ratio;
  const x = ctx2d(c);
  x.scale(ratio, ratio);
  x.fillStyle = '#16213e'; x.fillRect(0, 0, rect.width, rect.height);
  x.fillStyle = x.strokeStyle = '#a0a0c0'; x.font = '10px sans-serif';
  const pan = horizontal ? s.panX : s.panY, len = horizontal ? rect.width : rect.height;
  const step = [10, 25, 50, 100, 200, 500, 1000].find((v) => v * s.zoom >= 60) ?? 2000;
  x.beginPath();
  for (let v = Math.floor(-pan / s.zoom / step) * step; v * s.zoom + pan < len; v += step) {
    const p = Math.round(v * s.zoom + pan) + 0.5;
    if (horizontal) { x.moveTo(p, 10); x.lineTo(p, T); x.fillText(String(v), p + 3, 10); }
    else { x.moveTo(10, p); x.lineTo(T, p); x.save(); x.translate(9, p - 3); x.rotate(-Math.PI / 2); x.fillText(String(v), 0, 0); x.restore(); }
  }
  x.stroke();
}

function Bar({ horizontal }: { horizontal: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const zoom = useStore((s) => s.zoom); const panX = useStore((s) => s.panX); const panY = useStore((s) => s.panY);
  useEffect(() => { if (ref.current) draw(ref.current, horizontal); }, [zoom, panX, panY, horizontal]);
  const drop = (e: React.PointerEvent) => {
    const p = sceneRef.current?.toWorld(e.clientX, e.clientY);
    if (!p) return;
    const s = getState();
    const r = ref.current!.getBoundingClientRect();
    const inside = horizontal ? e.clientY > r.bottom + 4 : e.clientX > r.right + 4;
    if (!inside) return;
    s.commit('Add guide', (d) => { (horizontal ? d.guides.h : d.guides.v).push(Math.round(horizontal ? p.y : p.x)); });
  };
  return <canvas ref={ref} {...tip('Ruler: drag from here to add a guide line! 📏')} onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)} onPointerUp={drop}
    onDoubleClick={() => getState().commit('Clear guides', (d) => { d.guides = { v: [], h: [] }; })}
    style={horizontal ? { position: 'absolute', left: T, right: 0, top: 0, height: T, width: `calc(100% - ${T}px)`, zIndex: 6, touchAction: 'none' } : { position: 'absolute', left: 0, top: T, bottom: 0, width: T, height: `calc(100% - ${T}px)`, zIndex: 6, touchAction: 'none' }} />;
}
export const Rulers = () => <><Bar horizontal /><Bar horizontal={false} /></>;
