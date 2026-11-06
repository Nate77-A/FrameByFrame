/** Small chunky form controls shared by every panel. */
import type { ReactNode } from 'react';
import { tip } from './Tooltip';

export function Slider({ label, value, min, max, step = 1, onChange, format, help }: {
  label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; format?(v: number): string; help?: string;
}) {
  return (
    <div className="field" data-tooltip={help ?? label}>
      <label><span>{label}</span><output>{format ? format(value) : value}</output></label>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </div>
  );
}
export const pct = (v: number) => `${Math.round(v * 100)}%`;

export function Percent(p: { label: string; value: number; onChange(v: number): void; help?: string }) {
  return <Slider {...p} min={0} max={1} step={0.01} format={pct} />;
}

export function Num({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange(v: number): void; step?: number; min?: number; max?: number }) {
  return (
    <div className="field" data-tooltip={label}>
      <label>{label}</label>
      <input className="input" type="number" aria-label={label} value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} step={step} min={min} max={max}
        onChange={(e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) onChange(v); }} />
    </div>
  );
}

export function Seg<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: [T, string][]; onChange(v: T): void }) {
  return (
    <div className="field">
      {label && <div className="label">{label}</div>}
      <div className="seg" role="group" aria-label={label}>
        {options.map(([v, text]) => (
          <button key={String(v)} className={v === value ? 'on' : ''} aria-pressed={v === value} data-tooltip={label ? `${label}: ${text}` : text} onClick={() => onChange(v)}>{text}</button>
        ))}
      </div>
    </div>
  );
}

export function Toggle({ label, on, onChange, help }: { label: ReactNode; on: boolean; onChange(v: boolean): void; help?: string }) {
  return <button className={`btn small ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => onChange(!on)} {...(help ? tip(help) : { 'data-tooltip': typeof label === 'string' ? label : undefined })}>{label}</button>;
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange(v: string): void }) {
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label" style={{ margin: 0 }}>{label}</span>
        <input className="color-dot" type="color" aria-label={label} data-tooltip={`${label} color`} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
