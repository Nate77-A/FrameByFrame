/** Color sub-panel (spec §4.2.11): HSB/RGB sliders, hex, wheel, swatches and gradient editor. */
import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useStore } from '../core/store';
import type { BlendMode, Gradient } from '../core/types';
import { Seg, Slider } from './controls';
import { tip } from './Tooltip';

export const KIDS_PALETTE = [
  '#000000', '#ffffff', '#7f8c8d', '#bdc3c7', '#e94560', '#ff6b6b', '#ff9ec7', '#ff4fa3',
  '#ff7f27', '#ffb347', '#ffd84d', '#fff3a0', '#a8e063', '#4cd964', '#1abc9c', '#0b6e4f',
  '#53d8fb', '#2d9cdb', '#1b4fd8', '#0f3460', '#c9a7ff', '#9b59b6', '#6c3483', '#3b1d6e',
  '#f5cba7', '#d7a06a', '#a0642b', '#5d3a1a', '#ff5733', '#c0392b', '#f1c40f', '#2ecc71',
];

export function hexToRgb(h: string) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; }
export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
export function rgbToHsv(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx] as [number, number, number];
}
export function hsvToRgb(h: number, s: number, v: number) {
  const f = (n: number) => { const k = (n + h / 60) % 6; return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255; };
  return [f(5), f(3), f(1)] as [number, number, number];
}

function Wheel({ hue, onHue }: { hue: number; onHue(h: number): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const pick = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    onHue((Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2) * 180 / Math.PI + 450) % 360);
  };
  const a = ((hue - 90) * Math.PI) / 180;
  return (
    <div ref={ref} style={{ width: 120, height: 120, borderRadius: '50%', position: 'relative', margin: '0 auto 8px', touchAction: 'none', background: 'conic-gradient(red,yellow,lime,cyan,blue,magenta,red)' }}
      {...tip('Color wheel: spin around the rainbow! 🌈')}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e); }}
      onPointerMove={(e) => { if (e.buttons) pick(e); }}>
      <div style={{ position: 'absolute', inset: 22, borderRadius: '50%', background: 'var(--bg-secondary)' }} />
      <div style={{ position: 'absolute', width: 18, height: 18, borderRadius: '50%', border: '3px solid #fff', left: 60 + Math.cos(a) * 49 - 9, top: 60 + Math.sin(a) * 49 - 9 }} />
    </div>
  );
}

function GradientEditor() {
  const g = useStore((s) => s.gradient);
  const set = useStore((s) => s.set);
  const [sel, setSel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);
  const put = (patch: Partial<Gradient>) => set({ gradient: { ...g, ...patch } });
  const css = [...g.stops].sort((a, b) => a.offset - b.offset).map((s) => `${s.color} ${s.offset * 100}%`).join(',');
  const stop = g.stops[Math.min(sel, g.stops.length - 1)];
  const moveStop = (i: number, e: React.PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    const offset = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    put({ stops: g.stops.map((s, n) => (n === i ? { ...s, offset } : s)) });
  };
  return (
    <>
      <Seg label="Type" value={g.kind} options={[['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']]} onChange={(kind) => put({ kind })} />
      {g.kind !== 'radial' && <Slider label="Angle" min={0} max={360} value={g.angle} onChange={(angle) => put({ angle })} format={(v) => `${v}°`} />}
      <div ref={bar} style={{ height: 30, borderRadius: 10, background: `linear-gradient(90deg,${css})`, position: 'relative', margin: '6px 12px 24px' }} {...tip('Drag the dots to slide your colors!')}>
        {g.stops.map((s, i) => (
          <div key={i} role="slider" aria-label={`Color stop ${i + 1}`} aria-valuenow={Math.round(s.offset * 100)} style={{ position: 'absolute', left: `${s.offset * 100}%`, top: 22, width: 24, height: 24, marginLeft: -12, borderRadius: '50%', background: s.color, touchAction: 'none', border: `3px solid ${i === sel ? '#53d8fb' : '#fff'}` }}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setSel(i); }}
            onPointerMove={(e) => { if (e.buttons) moveStop(i, e); }} />
        ))}
      </div>
      <div className="row">
        <input className="color-dot" type="color" data-tooltip="Pick the color of this dot!" aria-label="Stop color" value={stop.color} onChange={(e) => put({ stops: g.stops.map((s, n) => (n === sel ? { ...s, color: e.target.value } : s)) })} />
        <button className="btn small" {...tip('Add another color!')} onClick={() => put({ stops: [...g.stops, { offset: 0.5, color: '#ffffff' }] })}><Plus size={18} /></button>
        <button className="btn small" disabled={g.stops.length < 3} {...tip('Remove this color')} onClick={() => { put({ stops: g.stops.filter((_, i) => i !== sel) }); setSel(0); }}><X size={18} /></button>
      </div>
      <Seg<BlendMode> label="Blend" value={g.blend} options={[['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay']]} onChange={(blend) => put({ blend })} />
    </>
  );
}

export function ColorPanel() {
  const color = useStore((s) => s.color);
  const mode = useStore((s) => s.colorMode);
  const set = useStore((s) => s.set);
  const [r, g, b] = hexToRgb(color);
  const [h0, sat, val] = rgbToHsv(r, g, b);
  // Hue is lost on greys, so remember the last one.
  const [hue, setHue] = useState(h0);
  const h = sat > 0 && val > 0 ? h0 : hue;
  const setHsv = (nh: number, ns: number, nv: number) => { setHue(nh); set({ color: rgbToHex(...hsvToRgb(nh, ns, nv)) }); };
  const [hex, setHex] = useState<string | null>(null);
  return (
    <section aria-label="Colors" style={{ marginBottom: 14 }}>
      <h3>🎨 Colors</h3>
      <div className="row" style={{ marginBottom: 8 }}>
        <div style={{ width: 54, height: 54, borderRadius: 14, border: '3px solid #fff', background: color }} aria-hidden />
        <input className="input" style={{ flex: 1, fontFamily: 'var(--font-mono)' }} data-tooltip="Type a color code, like #ff0000!" aria-label="Hex color" value={hex ?? color} onChange={(e) => { setHex(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) set({ color: e.target.value.toLowerCase() }); }} onBlur={() => setHex(null)} />
      </div>
      <Seg value={mode} options={[['solid', 'Solid'], ['gradient', 'Rainbow Ramp']]} onChange={(colorMode) => set({ colorMode })} />
      {mode === 'solid' ? (
        <>
          <Wheel hue={h} onHue={(nh) => setHsv(nh, sat || 1, val || 1)} />
          <Slider label="Hue" min={0} max={360} value={Math.round(h)} onChange={(v) => setHsv(v, sat, val)} />
          <Slider label="Saturation" min={0} max={100} value={Math.round(sat * 100)} onChange={(v) => setHsv(h, v / 100, val)} />
          <Slider label="Brightness" min={0} max={100} value={Math.round(val * 100)} onChange={(v) => setHsv(h, sat, v / 100)} />
          <Slider label="Red" min={0} max={255} value={r} onChange={(v) => set({ color: rgbToHex(v, g, b) })} />
          <Slider label="Green" min={0} max={255} value={g} onChange={(v) => set({ color: rgbToHex(r, v, b) })} />
          <Slider label="Blue" min={0} max={255} value={b} onChange={(v) => set({ color: rgbToHex(r, g, v) })} />
          <div className="swatch-grid" role="group" aria-label="Color swatches">
            {KIDS_PALETTE.map((c) => <button key={c} aria-label={c} data-tooltip={`Paint with ${c}`} style={{ background: c }} onClick={() => set({ color: c })} />)}
          </div>
        </>
      ) : <GradientEditor />}
    </section>
  );
}
