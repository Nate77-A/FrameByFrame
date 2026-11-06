/** Timeline (spec §4.5). The grid is one canvas so 7,200 frames stay smooth; only visible cells are drawn. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, Lock, LockOpen, Minus, Pause, Pin, Play, Plus, Repeat, SlidersHorizontal, Target, Trash2, Volume2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { AudioClip, BlendMode, Layer } from '../core/types';
import { LIMITS } from '../core/types';
import { durationOf, getCel } from '../core/doc';
import { getState, useStore } from '../core/store';
import { getAudio } from '../audio/assets';
import { setThumbListener, thumbFor } from '../render/thumbs';
import { Percent, Seg, Slider } from './controls';
import { tip } from './Tooltip';

const RULER = 24, ROW = 46, CELL = 48, GRAB = 12;
const COLORS = { bg: '#121a33', row: '#16213e', alt: '#182547', cell: '#1f2f5c', line: 'rgba(160,160,192,.14)', text: '#a0a0c0', play: '#e94560', on: '#53d8fb', clip: '#2b5ea8', clipSel: '#53d8fb', wave: '#cfe8ff', pin: '#37306b' };

const view = { scrollX: 0, scrollY: 0, reorderFrom: -1, reorderTo: -1 };
const lanesOf = (clips: AudioClip[]) => Math.max(1, ...clips.map((c) => c.track + 2));
const cellWidth = () => CELL * getState().timelineZoom;
const clipLen = (c: AudioClip) => c.trimEnd - c.trimStart;

function drawGrid(c: HTMLCanvasElement) {
  const s = getState();
  const { doc, frameIndex, activeLayerId } = s;
  const ratio = devicePixelRatio || 1;
  const W = c.clientWidth, H = c.clientHeight;
  if (c.width !== Math.round(W * ratio)) c.width = Math.round(W * ratio);
  if (c.height !== Math.round(H * ratio)) c.height = Math.round(H * ratio);
  const x = c.getContext('2d')!;
  x.setTransform(ratio, 0, 0, ratio, 0, 0);
  x.fillStyle = COLORS.bg; x.fillRect(0, 0, W, H);
  const cw = cellWidth();
  const n = doc.frames.length;
  const first = Math.max(0, Math.floor(view.scrollX / cw));
  const last = Math.min(n - 1, Math.ceil((view.scrollX + W) / cw));
  const fx = (i: number) => i * cw - view.scrollX;
  const layers = [...doc.layers].reverse();
  const ty = (r: number) => RULER + r * ROW - view.scrollY;

  x.save(); x.beginPath(); x.rect(0, RULER, W, H - RULER); x.clip();
  layers.forEach((l, r) => {
    const y = ty(r);
    if (y > H || y + ROW < RULER) return;
    x.fillStyle = l.id === activeLayerId ? COLORS.alt : COLORS.row;
    x.fillRect(0, y, W, ROW - 1);
    if (l.pinned) {
      const left = Math.max(0, fx(0));
      x.fillStyle = COLORS.pin;
      x.beginPath(); x.roundRect(left + 2, y + 3, Math.max(0, fx(n) - left - 4), ROW - 7, 8); x.fill();
      const items = getCel(doc, 0, l.id);
      const th = items.length ? thumbFor(items, doc) : null;
      if (th) x.drawImage(th, left + 8, y + 5, (ROW - 11) * (th.width / th.height), ROW - 11);
      x.fillStyle = COLORS.text; x.font = '14px "Baloo 2", sans-serif';
      x.fillText('📌 On every frame', left + 8 + (th ? 72 : 0), y + 27);
      return;
    }
    for (let i = first; i <= last; i++) {
      const X = fx(i);
      const items = doc.frames[i].cels[l.id];
      if (i % 2 === 0 && cw > 8) { x.fillStyle = 'rgba(255,255,255,.015)'; x.fillRect(X, y, cw, ROW - 1); }
      if (items?.length) {
        if (cw >= 22) {
          x.fillStyle = '#fff';
          const th = thumbFor(items, doc);
          const h = ROW - 9, w = Math.min(cw - 3, h * (doc.canvas.width / doc.canvas.height));
          x.fillRect(X + (cw - w) / 2, y + 3, w, h);
          if (th) x.drawImage(th, X + (cw - w) / 2, y + 3, w, h);
        } else { x.fillStyle = COLORS.on; x.fillRect(X + 1, y + 16, Math.max(1, cw - 2), 12); }
      } else if (cw >= 22) { x.fillStyle = COLORS.cell; x.beginPath(); x.arc(X + cw / 2, y + ROW / 2, 2.5, 0, 7); x.fill(); }
    }
  });
  // audio lanes
  const lanes = lanesOf(doc.audioClips);
  for (let t = 0; t < lanes; t++) {
    const y = ty(layers.length + t);
    x.fillStyle = COLORS.row; x.fillRect(0, y, W, ROW - 1);
  }
  const pxPerSec = cw * doc.fps;
  for (const clip of doc.audioClips) {
    const y = ty(layers.length + clip.track);
    const X = clip.startTime * pxPerSec - view.scrollX;
    const w = (clip.loop ? Math.max(durationOf(doc) - clip.startTime, clipLen(clip)) : clipLen(clip)) * pxPerSec;
    if (X > W || X + w < 0) continue;
    x.save();
    x.beginPath(); x.roundRect(X, y + 3, w, ROW - 7, 8); x.clip();
    x.fillStyle = clip.mute ? '#3a3f5c' : COLORS.clip; x.fillRect(X, y, w, ROW);
    const a = getAudio(clip.asset);
    if (a) {
      const mid = y + ROW / 2 - 2, amp = (ROW - 14) / 2, buckets = a.peaks.length / 2, dur = a.buffer.duration;
      x.strokeStyle = COLORS.wave; x.lineWidth = 1; x.beginPath();
      const startPx = Math.max(0, Math.floor(-X));
      for (let px = startPx; px < Math.min(w, W - X); px += 2) {
        let t = px / pxPerSec;
        if (clip.loop) t %= clipLen(clip);
        const b = Math.min(buckets - 1, Math.floor(((clip.trimStart + t) / dur) * buckets));
        x.moveTo(X + px + 0.5, mid + a.peaks[b * 2] * amp * clip.volume); x.lineTo(X + px + 0.5, mid + a.peaks[b * 2 + 1] * amp * clip.volume);
      }
      x.stroke();
    }
    // fade curves
    x.fillStyle = 'rgba(0,0,0,.35)';
    if (clip.fadeIn) { x.beginPath(); x.moveTo(X, y + 3); x.lineTo(X + clip.fadeIn * pxPerSec, y + 3); x.lineTo(X, y + ROW - 4); x.fill(); }
    if (clip.fadeOut) { x.beginPath(); x.moveTo(X + w, y + 3); x.lineTo(X + w - clip.fadeOut * pxPerSec, y + 3); x.lineTo(X + w, y + ROW - 4); x.fill(); }
    x.fillStyle = '#fff'; x.font = '14px "Baloo 2", sans-serif'; x.fillText(clip.name, X + 12, y + 16, Math.max(0, w - 20));
    x.restore();
    if (clip.id === s.selectedClipId) {
      x.strokeStyle = COLORS.clipSel; x.lineWidth = 2;
      x.beginPath(); x.roundRect(X, y + 3, w, ROW - 7, 8); x.stroke();
      x.fillStyle = COLORS.clipSel;
      x.fillRect(X + 1, y + 13, 5, ROW - 27); x.fillRect(X + w - 6, y + 13, 5, ROW - 27);
    }
  }
  x.restore();

  // ruler
  x.fillStyle = '#0f1730'; x.fillRect(0, 0, W, RULER);
  const every = [1, 2, 5, 10, 20, 50, 100, 200, 500].find((v) => v * cw >= 44) ?? 1000;
  x.fillStyle = COLORS.text; x.font = '14px "JetBrains Mono", monospace'; x.strokeStyle = COLORS.line;
  for (let i = first - (first % every); i <= last; i += every) {
    const X = fx(i);
    x.fillText(String(i + 1), X + 3, 16);
    x.beginPath(); x.moveTo(X + 0.5, 12); x.lineTo(X + 0.5, H); x.stroke();
  }
  // current frame
  const px = fx(frameIndex);
  x.fillStyle = 'rgba(233,69,96,.16)'; x.fillRect(px, RULER, cw, H - RULER);
  x.fillStyle = COLORS.play; x.fillRect(px + Math.min(cw, 2) / 2, 0, 2, H);
  x.beginPath(); x.roundRect(px - 2, 2, Math.max(cw + 4, 22), 20, 7); x.fill();
  x.fillStyle = '#fff'; x.font = '14px "JetBrains Mono", monospace'; x.fillText(String(frameIndex + 1), px + 3, 17);
  if (view.reorderTo >= 0) { x.fillStyle = COLORS.on; x.fillRect(fx(view.reorderTo) - 2, RULER, 4, H); }
}

function LayerRow({ layer, index, count, startDrag }: { layer: Layer; index: number; count: number; startDrag(e: React.PointerEvent, index: number): void }) {
  const active = useStore((s) => s.activeLayerId === layer.id);
  const { set, updateLayer, togglePin } = useStore.getState();
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const icon = (on: boolean) => `tl-icon ${on ? 'on' : ''}`;
  return (
    <div className={`tl-head ${active ? 'active' : ''}`} style={{ height: ROW }} onClick={() => set({ activeLayerId: layer.id, selection: [] })}>
      {editing
        ? <input autoFocus className="input" style={{ minHeight: 32, flex: 1, minWidth: 0 }} aria-label="Layer name" defaultValue={layer.name} onBlur={(e) => { updateLayer(layer.id, { name: e.target.value || layer.name }, 'Rename layer'); setEditing(false); }} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }} />
        : <span className="name" {...tip('Double-click to rename. Drag to move this layer up or down! 🥞')} onDoubleClick={() => setEditing(true)} onPointerDown={(e) => count > 1 && startDrag(e, index)}>{layer.name}</span>}
      <button className={icon(!layer.visible)} {...tip('Show or hide this layer! 👁')} onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { visible: !layer.visible }, 'Toggle layer'); }}>{layer.visible ? <Eye size={17} /> : <EyeOff size={17} />}</button>
      <button className={icon(layer.locked)} {...tip("Locks this layer so you don't draw on it by accident! 🔒")} onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }, 'Lock layer'); }}>{layer.locked ? <Lock size={17} /> : <LockOpen size={17} />}</button>
      <button className={icon(layer.solo)} {...tip('Solo: show only this layer! 🎯')} onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { solo: !layer.solo }, 'Solo layer'); }}><Target size={17} /></button>
      <button className={icon(layer.pinned)} {...tip('Pin: one drawing on every frame, great for backgrounds! 📌')} onClick={(e) => { e.stopPropagation(); togglePin(layer.id); }}><Pin size={17} /></button>
      <button className={icon(menu)} {...tip('Layer opacity and blending')} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><SlidersHorizontal size={17} /></button>
      {menu && <div className="pop" style={{ left: 8, bottom: 8, position: 'fixed', width: 260 }} onClick={(e) => e.stopPropagation()}>
        <Percent label={`${layer.name} opacity`} value={layer.opacity} onChange={(opacity) => updateLayer(layer.id, { opacity }, 'Layer opacity')} />
        <Seg<BlendMode> label="Blend mode" value={layer.blendMode} options={[['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten']]} onChange={(blendMode) => updateLayer(layer.id, { blendMode }, 'Layer blend')} />
        <button className="btn small" onClick={() => setMenu(false)}>Done</button>
      </div>}
    </div>
  );
}

function Badge({ label, help, children }: { label: string; help: string; children: (close: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn pill small" aria-label={label} data-tooltip={help} onClick={() => setOpen(!open)}>{label}</button>
      {open && <div className="pop" style={{ position: 'fixed', bottom: 'calc(var(--tl-h, 240px) - 8px)', minWidth: 240 }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

function Bar() {
  const s = useStore(useShallow((x) => ({ playing: x.playing, loop: x.loop, fps: x.doc.fps, zoom: x.timelineZoom, n: x.doc.frames.length, onion: x.onion, activeLayerId: x.activeLayerId })));
  const a = useStore.getState();
  const dur = s.n / s.fps;
  return (
    <div className="tl-bar">
      <button className="btn small" data-testid="play" {...tip('Play or pause your animation! (Space) ▶️')} onClick={() => a.set({ playing: !getState().playing })}>{s.playing ? <Pause size={20} color="#ffb347" /> : <Play size={20} color="#a8e063" />}</button>
      <button className={`btn small ${s.loop ? 'on' : ''}`} {...tip('Loop: start again when it reaches the end! 🔁')} onClick={() => a.set({ loop: !s.loop })}><Repeat size={18} /></button>
      <Badge label={`FPS: ${s.fps}`} help="Frames per second: how fast the animation plays!">{() => <>
        <input className="input" type="number" aria-label="Frames per second" min={1} max={60} value={s.fps} onChange={(e) => a.setFps(+e.target.value || 1)} />
        <div className="row" style={{ marginTop: 6 }}>{[1, 3, 6, 12, 24, 30, 60].map((f) => <button key={f} className="btn small" onClick={() => a.setFps(f)}>{f}</button>)}</div>
      </>}</Badge>
      <Badge label={`Duration: ${dur.toFixed(1)} s`} help="How long your animation lasts!">{(close) => <DurationForm dur={dur} close={close} />}</Badge>
      <div className="sep" />
      <button className="btn small" data-testid="add-frame" {...tip('Add a new blank frame! ➕')} onClick={a.addFrame}><Plus size={18} /> Frame</button>
      <button className="btn small" data-testid="dup-frame" {...tip('Copy this frame! ⧉')} onClick={a.duplicateFrame}><Copy size={18} /></button>
      <button className="btn small" data-testid="del-frame" {...tip('Delete this frame 🗑')} onClick={a.deleteFrame}><Trash2 size={18} /></button>
      <div className="sep" />
      <button className="btn small" data-testid="add-layer" {...tip('Add a new layer! 🥞')} onClick={a.addLayer}><Plus size={18} /> Layer</button>
      <button className="btn small" {...tip('Copy this layer!')} onClick={() => a.duplicateLayer(s.activeLayerId)}><Copy size={18} /></button>
      <button className="btn small" {...tip('Delete this layer')} onClick={() => a.deleteLayer(s.activeLayerId)}><Trash2 size={18} /></button>
      <div className="sep" />
      <Badge label="🧅 Onion" help="Onion skin settings: how many ghost frames to show!">{() => <>
        <Slider label="Frames before" min={0} max={5} value={s.onion.before} onChange={(before) => a.set({ onion: { ...s.onion, before, on: true } })} />
        <Slider label="Frames after" min={0} max={5} value={s.onion.after} onChange={(after) => a.set({ onion: { ...s.onion, after, on: true } })} />
        <Percent label="Strength" value={s.onion.opacity} onChange={(opacity) => a.set({ onion: { ...s.onion, opacity, on: true } })} />
      </>}</Badge>
      <div className="spacer" />
      <button className="btn small" {...tip('Make frames smaller')} onClick={() => a.set({ timelineZoom: Math.max(0.1, s.zoom - 0.25) })}><Minus size={16} /></button>
      <input type="range" style={{ width: 110, flex: 'none' }} aria-label="Timeline zoom" {...{ 'data-tooltip': 'Timeline zoom: make frames bigger or smaller!' }} min={10} max={400} value={Math.round(s.zoom * 100)} onChange={(e) => a.set({ timelineZoom: +e.target.value / 100 })} />
      <button className="btn small" {...tip('Make frames bigger')} onClick={() => a.set({ timelineZoom: Math.min(4, s.zoom + 0.25) })}><Plus size={16} /></button>
    </div>
  );
}
function DurationForm({ dur, close }: { dur: number; close(): void }) {
  const [v, setV] = useState(dur);
  const apply = () => { getState().setDuration(v); close(); };
  return (<>
    <Slider label="Seconds" min={LIMITS.minDuration} max={LIMITS.maxDuration} step={0.1} value={v} onChange={setV} format={(n) => `${n.toFixed(1)} s`} />
    <div className="row"><input className="input" style={{ flex: 1 }} aria-label="Duration in seconds" type="number" step={0.1} min={0.1} max={120} value={v} onChange={(e) => setV(+e.target.value)} /><button className="btn primary small" onClick={apply}>Set</button></div>
  </>);
}

export function Timeline({ overlay = false }: { overlay?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const heads = useRef<HTMLDivElement>(null);
  const height = useStore((s) => s.timelineHeight);
  const layers = useStore((s) => s.doc.layers);
  const clips = useStore((s) => s.doc.audioClips);
  const raf = useRef(0);
  const paint = () => { if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; if (ref.current) drawGrid(ref.current); }); };
  const rows = [...layers].reverse();

  const clampScroll = () => {
    const s = getState(), W = grid.current?.clientWidth ?? 0, H = grid.current?.clientHeight ?? 0;
    view.scrollX = Math.max(0, Math.min(view.scrollX, s.doc.frames.length * cellWidth() + 80 - W));
    view.scrollY = Math.max(0, Math.min(view.scrollY, (s.doc.layers.length + lanesOf(s.doc.audioClips)) * ROW + RULER - H));
    if (heads.current) heads.current.style.transform = `translateY(${-view.scrollY}px)`;
  };
  useEffect(() => {
    setThumbListener(paint);
    const stop = useStore.subscribe((s, p) => {
      if (s.frameIndex !== p.frameIndex && grid.current) {
        // Keep the playhead on screen.
        const cw = cellWidth(), X = s.frameIndex * cw - view.scrollX, W = grid.current.clientWidth;
        if (X < 0 || X + cw > W) { view.scrollX = Math.max(0, s.frameIndex * cw - W * 0.25); clampScroll(); }
      }
      if (s.doc !== p.doc || s.frameIndex !== p.frameIndex || s.activeLayerId !== p.activeLayerId || s.timelineZoom !== p.timelineZoom || s.selectedClipId !== p.selectedClipId || s.revision !== p.revision) paint();
    });
    const ro = new ResizeObserver(paint);
    ro.observe(grid.current!);
    paint();
    return () => { stop(); ro.disconnect(); cancelAnimationFrame(raf.current); raf.current = 0; };
  }, []);
  useLayoutEffect(() => { document.documentElement.style.setProperty('--tl-h', `${height}px`); }, [height]);

  const startLayerDrag = (e: React.PointerEvent, index: number) => {
    const startY = e.clientY;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointerup', up);
      const delta = Math.round((ev.clientY - startY) / ROW);
      if (delta) {
        const n = getState().doc.layers.length;
        // Rows are listed top-down, the document bottom-up.
        const from = n - 1 - index, to = Math.max(0, Math.min(n - 1, from - delta));
        getState().moveLayer(from, to);
      }
    };
    el.addEventListener('pointerup', up);
  };

  type Mode = { kind: 'scrub' } | { kind: 'cell'; frame: number; x: number; y: number; sx: number; sy: number; touch: boolean; reorder: boolean; scroll: boolean; timer: ReturnType<typeof setTimeout> | null }
    | { kind: 'clip'; clip: AudioClip; part: 'body' | 'left' | 'right'; x: number; y: number; moved: boolean };
  const mode = useRef<Mode | null>(null);

  const frameAt = (px: number) => Math.floor((px + view.scrollX) / cellWidth());

  const clipAt = (px: number, py: number) => {
    const s = getState();
    const cw = cellWidth(), pps = cw * s.doc.fps;
    const track = Math.floor((py - RULER + view.scrollY) / ROW) - s.doc.layers.length;
    if (track < 0) return null;
    for (const c of [...s.doc.audioClips].reverse()) {
      if (c.track !== track) continue;
      const X = c.startTime * pps - view.scrollX, w = (c.loop ? Math.max(durationOf(s.doc) - c.startTime, clipLen(c)) : clipLen(c)) * pps;
      if (px >= X && px <= X + w) {
        const grab = Math.min(GRAB, w / 3);
        return { clip: c, part: (px - X < grab ? 'left' : X + w - px < grab ? 'right' : 'body') as 'left' | 'right' | 'body' };
      }
    }
    return { clip: null, part: 'body' as const };
  };

  const down = (e: React.PointerEvent) => {
    const r = grid.current!.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const s = getState();
    grid.current!.setPointerCapture(e.pointerId);
    if (py < RULER) { mode.current = { kind: 'scrub' }; s.set({ playing: false }); s.setFrame(frameAt(px)); return; }
    const hit = clipAt(px, py);
    if (hit) {
      if (hit.clip) { s.set({ selectedClipId: hit.clip.id, selection: [] }); mode.current = { kind: 'clip', clip: hit.clip, part: hit.part, x: e.clientX, y: e.clientY, moved: false }; }
      else { s.set({ selectedClipId: null }); s.setFrame(frameAt(px)); mode.current = { kind: 'scrub' }; }
      return;
    }
    const row = Math.floor((py - RULER + view.scrollY) / ROW);
    const layer = rows[row];
    const frame = frameAt(px);
    if (layer) s.set({ activeLayerId: layer.id, selectedClipId: null });
    s.set({ playing: false });
    s.setFrame(frame);
    const touch = e.pointerType === 'touch';
    const m: Mode = { kind: 'cell', frame, x: e.clientX, y: e.clientY, sx: view.scrollX, sy: view.scrollY, touch, reorder: false, scroll: false, timer: null };
    // On touch, dragging scrolls; hold first to pick a frame up.
    if (touch) m.timer = setTimeout(() => { m.reorder = !m.scroll; }, 300);
    mode.current = m;
  };
  const move = (e: React.PointerEvent) => {
    const m = mode.current;
    if (!m) return;
    const r = grid.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const s = getState();
    if (m.kind === 'scrub') { s.setFrame(frameAt(px)); return; }
    if (m.kind === 'cell') {
      const dx = e.clientX - m.x, dy = e.clientY - m.y;
      if (m.touch && !m.reorder && Math.hypot(dx, dy) > 8) m.scroll = true;
      if (m.touch && m.scroll) { view.scrollX = m.sx - dx; view.scrollY = m.sy - dy; clampScroll(); paint(); return; }
      if (!m.touch && Math.abs(dx) > 6) m.reorder = true;
      if (m.reorder) { view.reorderFrom = m.frame; view.reorderTo = Math.max(0, Math.min(s.doc.frames.length, Math.round((px + view.scrollX) / cellWidth()))); paint(); }
      return;
    }
    const pps = cellWidth() * s.doc.fps, dt = (e.clientX - m.x) / pps;
    const snap = (t: number) => Math.round(t * s.doc.fps) / s.doc.fps;
    const c = m.clip;
    if (Math.abs(e.clientX - m.x) > 2) m.moved = true;
    const key = `clipdrag-${c.id}`;
    if (m.part === 'body') {
      const track = Math.max(0, c.track + Math.round((e.clientY - m.y) / ROW));
      s.updateClip(c.id, { startTime: Math.max(0, snap(c.startTime + dt)), track }, key);
    } else if (m.part === 'left') {
      const d = Math.max(-c.trimStart, Math.min(clipLen(c) - 0.05, dt));
      const start = Math.max(0, snap(c.startTime + d));
      s.updateClip(c.id, { startTime: start, trimStart: c.trimStart + (start - c.startTime) }, key);
    } else {
      const max = getAudio(c.asset)?.buffer.duration ?? c.trimEnd;
      s.updateClip(c.id, { trimEnd: Math.max(c.trimStart + 0.05, Math.min(max, c.trimEnd + dt)) }, key);
    }
  };
  const up = () => {
    const m = mode.current;
    mode.current = null;
    if (m?.kind === 'cell') {
      if (m.timer) clearTimeout(m.timer);
      if (m.reorder && view.reorderTo >= 0) {
        const to = view.reorderTo > m.frame ? view.reorderTo - 1 : view.reorderTo;
        view.reorderTo = view.reorderFrom = -1;
        getState().moveFrame(m.frame, to);
        paint();
      }
    }
  };
  const wheel = (e: React.WheelEvent) => {
    view.scrollX += e.deltaX || (e.shiftKey ? e.deltaY : 0);
    if (!e.shiftKey) view.scrollY += e.deltaY;
    clampScroll(); paint();
  };

  const resize = (e: React.PointerEvent) => {
    const el = e.currentTarget; el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = height;
    const mv = (ev: PointerEvent) => getState().set({ timelineHeight: Math.max(LIMITS.minTimeline, Math.min(LIMITS.maxTimeline, h0 - (ev.clientY - y0))) });
    const end = () => { el.removeEventListener('pointermove', mv as EventListener); el.removeEventListener('pointerup', end); };
    el.addEventListener('pointermove', mv as EventListener);
    el.addEventListener('pointerup', end);
  };
  const lanes = lanesOf(clips);
  return (
    <section className={`timeline ${overlay ? 'overlay' : ''}`} style={{ height }} aria-label="Timeline" data-testid="timeline">
      {!overlay && <div className="tl-resize" role="separator" aria-orientation="horizontal" aria-label="Resize timeline" {...{ 'data-tooltip': 'Drag to make the timeline taller or shorter!' }} onPointerDown={resize} />}
      <Bar />
      <div className="tl-body">
        <div className="tl-heads">
          <div ref={heads}>
            <div style={{ height: RULER }} />
            {rows.map((l, i) => <LayerRow key={l.id} layer={l} index={i} count={rows.length} startDrag={startLayerDrag} />)}
            {Array.from({ length: lanes }, (_, i) => (
              <div key={i} className="tl-head" style={{ height: ROW, color: 'var(--text-secondary)' }}><Volume2 size={15} style={{ marginRight: 6 }} /><span style={{ fontSize: 14 }}>Audio {i + 1}</span></div>
            ))}
          </div>
        </div>
        <div ref={grid} className="tl-grid" data-testid="timeline-grid" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} role="application" aria-label="Frames and sounds. Use comma and period to step through frames.">
          <canvas ref={ref} />
        </div>
      </div>
    </section>
  );
}
