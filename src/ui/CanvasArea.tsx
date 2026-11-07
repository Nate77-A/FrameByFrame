import { useEffect, useRef, useState } from 'react';
import { Layers, LocateFixed, Magnet, Grid3x3, Ruler } from 'lucide-react';
import { useStore, currentItems } from '../core/store';
import type { TextItem } from '../core/types';
import { Scene, sceneRef } from '../render/scene';
import { applyText, attachInput } from '../tools/input';
import { itemBounds } from '../tools/bounds';
import { Toggle } from './controls';
import { tip } from './Tooltip';
import { Rulers } from './Rulers';

function ZoomPill() {
  const zoom = useStore((s) => s.zoom); const zoomTo = useStore((s) => s.zoomTo);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn pill" {...tip('Zoom: how close you are to your picture!')} onClick={() => setOpen(!open)}>{Math.round(zoom * 100)}%</button>
      {open && <div className="pop" style={{ top: 42, right: 0 }}>
        <input type="range" aria-label="Zoom" min={10} max={800} value={Math.round(zoom * 100)} onChange={(e) => zoomCenter(zoomTo, +e.target.value / 100)} />
        <div className="row">{[25, 50, 100, 200, 400].map((z) => <button key={z} className="btn small" onClick={() => zoomCenter(zoomTo, z / 100)}>{z}%</button>)}</div>
        <button className="btn small" onClick={() => { sceneRef.current?.fit(); setOpen(false); }}>Fit to screen</button>
      </div>}
    </div>
  );
}
function zoomCenter(zoomTo: (z: number, x: number, y: number) => void, z: number) {
  const st = sceneRef.current?.stage;
  zoomTo(z, (st?.width() ?? 0) / 2, (st?.height() ?? 0) / 2);
}
function SizePill() {
  const c = useStore((s) => s.doc.canvas); const commit = useStore((s) => s.commit);
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(c.width); const [h, setH] = useState(c.height);
  const apply = () => {
    const width = Math.max(16, Math.min(4096, Math.round(w))), height = Math.max(16, Math.min(4096, Math.round(h)));
    commit('Resize canvas', (d) => { d.canvas.width = width; d.canvas.height = height; });
    setOpen(false);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn pill" {...tip('Canvas size: click to change how big your paper is!')} onClick={() => { setW(c.width); setH(c.height); setOpen(!open); }}>{c.width} × {c.height}</button>
      {open && <div className="pop" style={{ top: 42, right: 0 }}>
        <div className="grid2">
          <div className="field"><label>Width</label><input className="input" aria-label="Canvas width" type="number" value={w} onChange={(e) => setW(+e.target.value)} /></div>
          <div className="field"><label>Height</label><input className="input" aria-label="Canvas height" type="number" value={h} onChange={(e) => setH(+e.target.value)} /></div>
        </div>
        <div className="row field">
          <span className="label" style={{ margin: 0 }}>Paper</span>
          <input className="color-dot" type="color" aria-label="Paper color" value={c.background ?? '#ffffff'} onChange={(e) => { const v = e.target.value; commit('Paper color', (d) => { d.canvas.background = v; }, { key: 'paper' }); }} />
          <Toggle label="See-through" on={!c.background} onChange={(on) => commit('Paper color', (d) => { d.canvas.background = on ? null : '#ffffff'; })} />
        </div>
        <button className="btn primary" onClick={apply}>Set</button>
      </div>}
    </div>
  );
}
function CanvasToggles() {
  const grid = useStore((s) => s.grid); const set = useStore((s) => s.set);
  const onion = useStore((s) => s.onion);
  const anchor = useStore((s) => s.anchorMode);
  const g = (p: Partial<typeof grid>) => set({ grid: { ...grid, ...p } });
  return (<>
    <Toggle label={<Grid3x3 size={18} />} on={grid.show} onChange={(show) => g({ show })} help="Show a helpful grid! ▦" />
    <Toggle label={<Ruler size={18} />} on={grid.rulers} onChange={(rulers) => g({ rulers })} help="Rulers: drag from them to add guide lines! 📏" />
    <Toggle label={<Magnet size={18} />} on={grid.snap || grid.snapObjects} onChange={(on) => g(on ? (grid.show ? { snap: true } : { snapObjects: true }) : { snap: false, snapObjects: false })} help="Snap: things jump neatly to the grid and to each other! 🧲" />
    <Toggle label={<Layers size={18} />} on={onion.on} onChange={(on) => set({ onion: { ...onion, on } })} help="Onion skin: see the frames before and after, like tracing paper! 🧅" />
    <Toggle label={<LocateFixed size={18} />} on={anchor} onChange={(on) => set({ anchorMode: on, ...(on ? { tool: 'select' as const } : {}) })} help="Anchor point: drag the red target to choose where an object turns from! 🎯" />
  </>);
}
function TextEditor({ item, onDone }: { item: TextItem; onDone(): void }) {
  const zoom = useStore((s) => s.zoom); const panX = useStore((s) => s.panX); const panY = useStore((s) => s.panY);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const k = zoom * Math.abs(item.scaleY);
  const box = itemBounds({ ...item, rotation: 0 });
  const left = panX + box.x * zoom, top = panY + box.y * zoom;
  return <textarea ref={ref} className="text-editor" aria-label="Type your text" defaultValue={item.text}
    style={{ left, top, width: Math.max(160, item.width + 60), height: item.height + item.fontSize, fontFamily: item.fontFamily, fontSize: item.fontSize, lineHeight: item.lineHeight, color: item.color, transform: `scale(${k})`, fontWeight: item.bold ? 700 : 400 }}
    onBlur={(e) => { applyText(item.id, e.target.value); onDone(); }}
    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) e.currentTarget.blur(); }} />;
}

export function CanvasArea() {
  const host = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editItem = useStore((s) => (editing ? currentItems(s).find((i) => i.id === editing) : undefined));
  const rulers = useStore((s) => s.grid.rulers);
  useEffect(() => {
    const scene = new Scene(host.current!);
    sceneRef.current = scene;
    const stop = attachInput(host.current!, scene, ring.current!);
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(host.current!);
    const edit = (e: Event) => setEditing((e as CustomEvent<string>).detail);
    window.addEventListener('franimator:edit-text', edit);
    void document.fonts?.ready.then(() => { sceneRef.current?.sync(); });
    return () => { window.removeEventListener('franimator:edit-text', edit); ro.disconnect(); stop(); scene.destroy(); sceneRef.current = null; };
  }, []);
  return (
    <div className="canvas-area" data-testid="canvas-area">
      {rulers && <Rulers />}
      <div ref={host} className="stage-host" data-testid="stage" style={rulers ? { inset: '20px 0 0 20px' } : undefined} aria-label="Drawing canvas" role="application" />
      <div ref={ring} style={{ position: 'absolute', display: 'none', borderRadius: '50%', border: '1.5px solid rgba(0,0,0,.7)', boxShadow: '0 0 0 1px rgba(255,255,255,.8)', pointerEvents: 'none', zIndex: 4 }} />
      {editItem?.type === 'text' && <TextEditor item={editItem} onDone={() => setEditing(null)} />}
      <div className="float-tl" style={rulers ? { top: 30, left: 30 } : undefined}><CanvasToggles /></div>
      <div className="float-tr" style={rulers ? { top: 30 } : undefined}><SizePill /><ZoomPill /></div>
    </div>
  );
}
