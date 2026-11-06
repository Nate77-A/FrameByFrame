/** Context-sensitive properties panel (spec §4.4). */
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Bold, FlipHorizontal, FlipVertical, Italic, Strikethrough, Trash2, Underline } from 'lucide-react';
import { currentItems, useStore, type BrushType, type PencilStyle } from '../core/store';
import type { AudioClip, ImageItem, Item, ShapeItem, ShapeKind, TextItem } from '../core/types';
import { getAudio } from '../audio/assets';
import { itemBounds } from '../tools/bounds';
import { measureText } from '../render/nodes';
import { ColorField, Num, Percent, Seg, Slider, Toggle } from './controls';
import { ColorPanel } from './ColorPanel';
import { tip } from './Tooltip';

export const FONTS = ['Baloo 2', 'Fredoka', 'Comic Neue', 'Nunito', 'system-ui'];
const SHAPES: [ShapeKind, string][] = [['rect', 'Rectangle'], ['triangle', 'Triangle'], ['ellipse', 'Oval'], ['polygon', 'Polygon'], ['star', 'Star']];

function PencilProps() {
  const p = useStore((s) => s.settings.pencil); const put = useStore((s) => s.setSetting);
  const up = (v: Partial<typeof p>) => put('pencil', v);
  return (<><h3>✏️ Pencil</h3>
    <Seg<PencilStyle> label="Style" value={p.style} options={[['ink', 'Ink Pen'], ['graphite', 'Graphite'], ['calligraphy', 'Calligraphy'], ['marker', 'Marker'], ['softbrush', 'Brush']]} onChange={(style) => up({ style })} />
    <Slider label="Size" min={1} max={500} value={p.size} onChange={(size) => up({ size })} help="How thick your line is!" />
    <Percent label="Opacity" value={p.opacity} onChange={(opacity) => up({ opacity })} help="See-through or solid? You choose!" />
    <Percent label="Pressure" value={p.pressure} onChange={(pressure) => up({ pressure })} help="Press harder for a thicker line (with a stylus)! ✍️" />
    <Percent label="Tilt" value={p.tilt} onChange={(tilt) => up({ tilt })} help="Lean your stylus to change the line!" />
    <Percent label="Smoothing" value={p.smoothing} onChange={(smoothing) => up({ smoothing })} help="Smooths out wobbly lines!" />
    <Percent label="Harden" value={p.harden} onChange={(harden) => up({ harden })} help="Sharp edges or soft edges?" />
  </>);
}
function BrushProps() {
  const b = useStore((s) => s.settings.brush); const put = useStore((s) => s.setSetting);
  const up = (v: Partial<typeof b>) => put('brush', v);
  return (<><h3>🖌️ Paintbrush</h3>
    <Seg<BrushType> label="Brush" value={b.type} options={[['round', 'Round'], ['flat', 'Flat'], ['scatter', 'Scatter'], ['texture', 'Texture'], ['watercolor', 'Watercolor'], ['inkbleed', 'Ink Bleed']]} onChange={(type) => up({ type })} />
    <Slider label="Size" min={1} max={500} value={b.size} onChange={(size) => up({ size })} />
    <Percent label="Opacity" value={b.opacity} onChange={(opacity) => up({ opacity })} />
    <Percent label="Flow" value={b.flow} onChange={(flow) => up({ flow })} help="How much paint comes out!" />
    <Percent label="Pressure" value={b.pressure} onChange={(pressure) => up({ pressure })} />
    <Percent label="Tilt" value={b.tilt} onChange={(tilt) => up({ tilt })} />
    <Slider label="Spacing" min={0.01} max={1} step={0.01} value={b.spacing} onChange={(spacing) => up({ spacing })} format={(v) => `${Math.round(v * 100)}%`} help="How far apart the paint dabs are!" />
    {b.type === 'scatter' && <Percent label="Scatter" value={b.scatter} onChange={(scatter) => up({ scatter })} help="How far the dabs fly apart!" />}
  </>);
}
function EraserProps() {
  const e = useStore((s) => s.settings.eraser); const put = useStore((s) => s.setSetting);
  const up = (v: Partial<typeof e>) => put('eraser', v);
  return (<><h3>🧽 Eraser</h3>
    <Slider label="Size" min={1} max={500} value={e.size} onChange={(size) => up({ size })} />
    <Percent label="Opacity" value={e.opacity} onChange={(opacity) => up({ opacity })} />
    <Seg label="Edge" value={e.hard ? 'hard' : 'soft'} options={[['hard', 'Hard'], ['soft', 'Soft']]} onChange={(v) => up({ hard: v === 'hard' })} />
    <Seg label="Erase to" value={e.toBackground ? 'bg' : 'clear'} options={[['clear', 'Transparent'], ['bg', 'Background']]} onChange={(v) => up({ toBackground: v === 'bg' })} />
  </>);
}
function ShapeProps() {
  const c = useStore((s) => s.settings.shape); const put = useStore((s) => s.setSetting);
  const up = (v: Partial<typeof c>) => put('shape', v);
  return (<><h3>⭐ Shape</h3>
    <Seg<ShapeKind> label="Shape" value={c.kind} options={SHAPES} onChange={(kind) => up({ kind })} />
    {c.kind === 'polygon' && <Slider label="Sides" min={3} max={12} value={c.sides} onChange={(sides) => up({ sides })} />}
    {c.kind === 'star' && <Slider label="Points" min={3} max={12} value={c.points} onChange={(points) => up({ points })} />}
    {(c.kind === 'rect' || c.kind === 'triangle' || c.kind === 'polygon') && <Slider label="Corner radius" min={0} max={100} value={c.cornerRadius} onChange={(cornerRadius) => up({ cornerRadius })} />}
    <Slider label="Outline width" min={0} max={50} value={c.strokeWidth} onChange={(strokeWidth) => up({ strokeWidth })} />
    <div className="row"><Toggle label="Filled" on={!c.noFill} onChange={(v) => up({ noFill: !v })} /><Toggle label="Outline" on={!c.noStroke} onChange={(v) => up({ noStroke: !v })} /></div>
    <p className="label" style={{ marginTop: 8 }}>Fill uses your color. Outline uses your back color. Hold Shift for perfect squares and circles.</p>
  </>);
}
function fontControls(v: Pick<TextItem, 'fontFamily' | 'fontSize' | 'bold' | 'italic' | 'underline' | 'strike' | 'align' | 'lineHeight' | 'letterSpacing' | 'outline' | 'outlineColor' | 'outlineWidth' | 'background'>, up: (p: Partial<TextItem>) => void) {
  return (<>
    <div className="field"><label>Font</label>
      <select className="input" aria-label="Font" value={v.fontFamily} onChange={(e) => up({ fontFamily: e.target.value })}>{FONTS.map((f) => <option key={f}>{f}</option>)}</select></div>
    <Slider label="Size" min={8} max={300} value={v.fontSize} onChange={(fontSize) => up({ fontSize })} format={(n) => `${n} pt`} />
    <div className="row field">
      <Toggle label={<Bold size={18} />} on={v.bold} onChange={(bold) => up({ bold })} help="Bold" />
      <Toggle label={<Italic size={18} />} on={v.italic} onChange={(italic) => up({ italic })} help="Italic" />
      <Toggle label={<Underline size={18} />} on={v.underline} onChange={(underline) => up({ underline })} help="Underline" />
      <Toggle label={<Strikethrough size={18} />} on={v.strike} onChange={(strike) => up({ strike })} help="Strikethrough" />
    </div>
    <div className="row field">
      <Toggle label={<AlignLeft size={18} />} on={v.align === 'left'} onChange={() => up({ align: 'left' })} help="Line up on the left" />
      <Toggle label={<AlignCenter size={18} />} on={v.align === 'center'} onChange={() => up({ align: 'center' })} help="Line up in the middle" />
      <Toggle label={<AlignRight size={18} />} on={v.align === 'right'} onChange={() => up({ align: 'right' })} help="Line up on the right" />
    </div>
    <Slider label="Line height" min={0.8} max={3} step={0.05} value={v.lineHeight} onChange={(lineHeight) => up({ lineHeight })} />
    <Slider label="Letter spacing" min={-5} max={40} value={v.letterSpacing} onChange={(letterSpacing) => up({ letterSpacing })} />
    <div className="row field"><Toggle label="Outline" on={v.outline} onChange={(outline) => up({ outline })} /><Toggle label="Background" on={!!v.background} onChange={(on) => up({ background: on ? '#ffd84d' : null })} /></div>
    {v.outline && <><ColorField label="Outline color" value={v.outlineColor} onChange={(outlineColor) => up({ outlineColor })} /><Slider label="Outline width" min={1} max={20} value={v.outlineWidth} onChange={(outlineWidth) => up({ outlineWidth })} /></>}
    {v.background && <ColorField label="Background color" value={v.background} onChange={(background) => up({ background })} />}
  </>);
}
function TextProps() {
  const t = useStore((s) => s.settings.text); const put = useStore((s) => s.setSetting);
  return <><h3>🔤 Text</h3>{fontControls(t, (p) => put('text', p as never))}<p className="label">Click the canvas to add text. Your drawing color colors the words.</p></>;
}
function BucketProps() {
  const b = useStore((s) => s.settings.bucket); const put = useStore((s) => s.setSetting);
  const up = (v: Partial<typeof b>) => put('bucket', v);
  return (<><h3>🪣 Paint Bucket</h3>
    <Seg label="Fill mode" value={b.gradient ? 'gradient' : 'solid'} options={[['solid', 'Solid'], ['gradient', 'Gradient']]} onChange={(v) => up({ gradient: v === 'gradient' })} />
    <Percent label="Tolerance" value={b.tolerance} onChange={(tolerance) => up({ tolerance })} help="How close a color must be to get filled!" />
    <Seg label="Fill type" value={b.mode} options={[['shape', 'Inside shape'], ['region', 'Whole region'], ['all', 'All same color']]} onChange={(mode) => up({ mode })} />
  </>);
}
function DropperProps() {
  const e = useStore((s) => s.settings.eyedropper); const put = useStore((s) => s.setSetting);
  return (<><h3>💧 Eyedropper</h3>
    <Seg label="Sample" value={e.sample} options={[[1, 'Point'], [3, '3×3'], [5, '5×5']]} onChange={(sample) => put('eyedropper', { sample })} />
    <Seg label="From" value={e.allLayers ? 'all' : 'active'} options={[['active', 'Active layer'], ['all', 'All layers']]} onChange={(v) => put('eyedropper', { allLayers: v === 'all' })} />
  </>);
}
function HandProps() {
  const h = useStore((s) => s.settings.hand); const put = useStore((s) => s.setSetting);
  return (<><h3>✋ Hand</h3><Seg label="Pan speed" value={h.speed} options={[[0.5, 'Slow'], [1, 'Normal'], [1.75, 'Fast']]} onChange={(speed) => put('hand', { speed })} />
    <p className="label">You can also hold Space and drag, or use two fingers.</p></>);
}
function ZoomProps() {
  const z = useStore((s) => s.settings.zoom); const put = useStore((s) => s.setSetting);
  return (<><h3>🔍 Zoom</h3><Seg label="Zoom step" value={z.step} options={[[0.1, '10%'], [0.25, '25%'], [0.5, '50%']]} onChange={(step) => put('zoom', { step })} />
    <p className="label">Click to zoom in. Alt+Click zooms out. Scroll or pinch works too.</p></>);
}

function ObjectProps({ items }: { items: Item[] }) {
  const update = useStore((s) => s.updateItems);
  const reorder = useStore((s) => s.reorderSelection);
  const remove = useStore((s) => s.deleteSelection);
  const ids = items.map((i) => i.id);
  const one = items.length === 1 ? items[0] : null;
  const box = one ? itemBounds({ ...one, rotation: 0 }) : null;
  const up = (patch: Partial<Item>, key: string) => update(ids, patch, 'Change object', `prop-${ids[0]}-${key}`);
  const title = !one ? `${items.length} things` : one.type === 'shape' ? '⭐ Shape' : one.type === 'text' ? '🔤 Text' : one.type === 'image' ? '🖼️ Picture' : '✏️ Drawing';
  return (<><h3>{title}</h3>
    {one && box && <div className="grid2">
      <Num label="X" value={box.x} onChange={(v) => up({ x: v + box.width / 2 }, 'x')} />
      <Num label="Y" value={box.y} onChange={(v) => up({ y: v + box.height / 2 }, 'y')} />
      <Num label="Width" value={box.width} min={1} onChange={(v) => up({ scaleX: Math.sign(one.scaleX) * (v / one.width) }, 'w')} />
      <Num label="Height" value={box.height} min={1} onChange={(v) => up({ scaleY: Math.sign(one.scaleY) * (v / one.height) }, 'h')} />
    </div>}
    {one && <Slider label="Rotation" min={-180} max={180} value={Math.round(one.rotation)} onChange={(rotation) => up({ rotation }, 'rot')} format={(v) => `${v}°`} />}
    {one && <Percent label="Opacity" value={one.opacity} onChange={(opacity) => up({ opacity }, 'op')} />}
    <div className="row field">
      <button className="btn small" {...tip('Flip side to side!')} onClick={() => update(ids, (i) => ({ scaleX: -i.scaleX }), 'Flip')}><FlipHorizontal size={18} /></button>
      <button className="btn small" {...tip('Flip upside down!')} onClick={() => update(ids, (i) => ({ scaleY: -i.scaleY }), 'Flip')}><FlipVertical size={18} /></button>
      <button className="btn small" {...tip('Bring to the very front')} onClick={() => reorder('front')}><ArrowUpToLine size={18} /></button>
      <button className="btn small" {...tip('Bring forward one step')} onClick={() => reorder('forward')}><ArrowUp size={18} /></button>
      <button className="btn small" {...tip('Send back one step')} onClick={() => reorder('backward')}><ArrowDown size={18} /></button>
      <button className="btn small" {...tip('Send to the very back')} onClick={() => reorder('back')}><ArrowDownToLine size={18} /></button>
      <button className="btn small" {...tip('Delete this!')} onClick={remove}><Trash2 size={18} /></button>
    </div>
    {one?.type === 'shape' && <ShapeObject item={one} />}
    {one?.type === 'text' && <TextObject item={one} />}
    {one?.type === 'image' && <ImageObject item={one} />}
  </>);
}
function ShapeObject({ item }: { item: ShapeItem }) {
  const update = useStore((s) => s.updateItems);
  const up = (p: Partial<ShapeItem>, k: string) => update([item.id], p as Partial<Item>, 'Change shape', `shape-${item.id}-${k}`);
  return (<>
    {typeof item.fill === 'string' && <ColorField label="Fill" value={item.fill} onChange={(fill) => up({ fill }, 'fill')} />}
    {item.fill === null && <button className="btn small field" onClick={() => up({ fill: '#ffd84d' }, 'fill')}>Add a fill</button>}
    {item.fill !== null && typeof item.fill !== 'string' && <p className="label">Filled with a rainbow ramp.</p>}
    <ColorField label="Outline" value={item.stroke ?? '#000000'} onChange={(stroke) => up({ stroke }, 'stroke')} />
    <Slider label="Outline width" min={0} max={50} value={item.stroke ? item.strokeWidth : 0} onChange={(strokeWidth) => up({ strokeWidth, stroke: item.stroke ?? '#000000' }, 'sw')} />
    {item.shape === 'polygon' && <Slider label="Sides" min={3} max={12} value={item.sides} onChange={(sides) => up({ sides }, 'sides')} />}
    {item.shape === 'star' && <Slider label="Points" min={3} max={12} value={item.points} onChange={(points) => up({ points }, 'pts')} />}
    {item.shape !== 'ellipse' && item.shape !== 'star' && <Slider label="Corner radius" min={0} max={100} value={item.cornerRadius} onChange={(cornerRadius) => up({ cornerRadius }, 'cr')} />}
    <div className="row field"><Toggle label="Shadow" on={!!item.shadow} onChange={(on) => up({ shadow: on ? { color: '#000000', blur: 12, x: 6, y: 6 } : null }, 'sh')} /></div>
    {item.shadow && <Slider label="Shadow blur" min={0} max={60} value={item.shadow.blur} onChange={(blur) => up({ shadow: { ...item.shadow!, blur } }, 'shb')} />}
  </>);
}
function TextObject({ item }: { item: TextItem }) {
  const update = useStore((s) => s.updateItems);
  const up = (p: Partial<TextItem>) => {
    const next = { ...item, ...p };
    update([item.id], { ...p, ...measureText(next) } as Partial<Item>, 'Change text', `text-${item.id}-${Object.keys(p)[0]}`);
  };
  return (<>
    <div className="field"><label>Words</label><textarea className="input" aria-label="Words" style={{ padding: 8 }} value={item.text} onChange={(e) => up({ text: e.target.value })} /></div>
    <ColorField label="Color" value={item.color} onChange={(color) => up({ color })} />
    {fontControls(item, up)}
  </>);
}
function ImageObject({ item }: { item: ImageItem }) {
  const update = useStore((s) => s.updateItems);
  const f = item.filters;
  const up = (p: Partial<ImageItem['filters']>) => update([item.id], { filters: { ...f, ...p } } as Partial<Item>, 'Change filter', `filter-${item.id}-${Object.keys(p)[0]}`);
  return (<>
    <Slider label="Blur" min={0} max={40} value={f.blur} onChange={(blur) => up({ blur })} />
    <Slider label="Brightness" min={-1} max={1} step={0.02} value={f.brightness} onChange={(brightness) => up({ brightness })} />
    <Slider label="Contrast" min={-100} max={100} value={f.contrast} onChange={(contrast) => up({ contrast })} />
    <div className="row field">
      <Toggle label="Gray" on={f.grayscale} onChange={(grayscale) => up({ grayscale })} />
      <Toggle label="Sepia" on={f.sepia} onChange={(sepia) => up({ sepia })} />
      <Toggle label="Invert" on={f.invert} onChange={(invert) => up({ invert })} />
    </div>
  </>);
}
function AudioProps({ clip }: { clip: AudioClip }) {
  const update = useStore((s) => s.updateClip);
  const remove = useStore((s) => s.deleteClip);
  const len = getAudio(clip.asset)?.buffer.duration ?? clip.trimEnd;
  const up = (p: Partial<AudioClip>) => update(clip.id, p);
  const secs = (v: number) => `${v.toFixed(2)} s`;
  return (<><h3>🎵 Sound</h3>
    <div className="field"><label>Name</label><input className="input" aria-label="Clip name" value={clip.name} onChange={(e) => up({ name: e.target.value })} /></div>
    <Percent label="Volume" value={clip.volume} onChange={(volume) => up({ volume })} />
    <Slider label="Trim in" min={0} max={Math.max(0, clip.trimEnd - 0.05)} step={0.01} value={clip.trimStart} onChange={(trimStart) => up({ trimStart })} format={secs} />
    <Slider label="Trim out" min={clip.trimStart + 0.05} max={len} step={0.01} value={clip.trimEnd} onChange={(trimEnd) => up({ trimEnd })} format={secs} />
    <Slider label="Fade in" min={0} max={5} step={0.05} value={clip.fadeIn} onChange={(fadeIn) => up({ fadeIn })} format={secs} />
    <Slider label="Fade out" min={0} max={5} step={0.05} value={clip.fadeOut} onChange={(fadeOut) => up({ fadeOut })} format={secs} />
    <div className="row field">
      <Toggle label="Loop" on={clip.loop} onChange={(loop) => up({ loop })} help="Repeat until the animation ends!" />
      <Toggle label="Mute" on={clip.mute} onChange={(mute) => up({ mute })} help="Silence this sound" />
      <button className="btn small" {...tip('Delete this sound')} onClick={() => remove(clip.id)}><Trash2 size={18} /></button>
    </div>
    <p className="label">Length: {secs(clip.trimEnd - clip.trimStart)}</p>
  </>);
}

export function PropertiesBody() {
  const tool = useStore((s) => s.tool);
  const colorOpen = useStore((s) => s.colorOpen);
  const selection = useStore((s) => s.selection);
  const clip = useStore((s) => s.doc.audioClips.find((c) => c.id === s.selectedClipId));
  const items = useStore((s) => currentItems(s));
  const picked = items.filter((i) => selection.includes(i.id));
  let body = null;
  if (clip) body = <AudioProps clip={clip} />;
  else if (picked.length) body = <ObjectProps items={picked} />;
  else switch (tool) {
    case 'pencil': body = <PencilProps />; break;
    case 'brush': body = <BrushProps />; break;
    case 'eraser': body = <EraserProps />; break;
    case 'shape': body = <ShapeProps />; break;
    case 'text': body = <TextProps />; break;
    case 'bucket': body = <BucketProps />; break;
    case 'eyedropper': body = <DropperProps />; break;
    case 'hand': body = <HandProps />; break;
    case 'zoom': body = <ZoomProps />; break;
    default: body = <div className="hint"><big>🎨</big>Pick a tool or select something!</div>;
  }
  return <>{colorOpen && <ColorPanel />}{body}</>;
}
