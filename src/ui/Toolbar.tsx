import { Droplet, Eraser, Hand, MousePointer2, PaintBucket, Paintbrush, Palette, Pencil, Shapes, Type, ZoomIn } from 'lucide-react';
import { useStore, type ToolId } from '../core/store';
import { tip } from './Tooltip';

export const TOOLS: { id: ToolId; name: string; key: string; color: string; Icon: typeof Pencil; help: string }[] = [
  { id: 'select', name: 'Select', key: 'V', color: '#53d8fb', Icon: MousePointer2, help: 'Select: Pick things up to move, turn or resize them! 👆' },
  { id: 'pencil', name: 'Pencil', key: 'P', color: '#ffb347', Icon: Pencil, help: 'Pencil: Draw neat lines, just like a real pencil! ✏️' },
  { id: 'brush', name: 'Paintbrush', key: 'B', color: '#e94560', Icon: Paintbrush, help: 'Paintbrush: Paint big, juicy strokes of color! 🖌️' },
  { id: 'eraser', name: 'Eraser', key: 'E', color: '#ff9ec7', Icon: Eraser, help: 'Eraser: Wipes away pixels like a real eraser! 🧽' },
  { id: 'shape', name: 'Shape', key: 'U', color: '#a8e063', Icon: Shapes, help: 'Shape: Drag to make squares, circles, stars and more! ⭐' },
  { id: 'text', name: 'Text', key: 'T', color: '#c9a7ff', Icon: Type, help: 'Text: Click and type your words! 🔤' },
  { id: 'bucket', name: 'Paint Bucket', key: 'G', color: '#53d8fb', Icon: PaintBucket, help: 'Paint Bucket: Fill a whole area with one click! 🪣' },
  { id: 'eyedropper', name: 'Eyedropper', key: 'I', color: '#ffb347', Icon: Droplet, help: 'Eyedropper: Copy a color from your picture! 💧' },
  { id: 'hand', name: 'Hand', key: 'H', color: '#ffd9a0', Icon: Hand, help: 'Hand: Slide your picture around! ✋' },
  { id: 'zoom', name: 'Zoom', key: 'Z', color: '#a8e063', Icon: ZoomIn, help: 'Zoom: Get closer to your picture! Hold Alt to go back. 🔍' },
];

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const set = useStore((s) => s.set);
  const color = useStore((s) => s.color);
  const bg = useStore((s) => s.bgColor);
  const open = useStore((s) => s.colorOpen);
  const compact = useStore((s) => s.compact);
  return (
    <nav className="toolbar" aria-label="Tools">
      {TOOLS.map(({ id, name, key, color: c, Icon, help }) => (
        <button key={id} className={`tool ${tool === id ? 'on' : ''}`} aria-pressed={tool === id} aria-label={name} data-tooltip={`${help} (${key})`}
          onClick={() => set({ tool: id, selection: id === 'select' ? useStore.getState().selection : [], ...(compact ? { sheet: 'properties' as const } : {}) })}>
          <Icon size={26} color={c} strokeWidth={2.2} />
        </button>
      ))}
      <button className={`tool ${open ? 'on' : ''}`} aria-pressed={open} aria-label="Color" data-tooltip="Color: Pick your colors and rainbows! 🎨 (C)"
        onClick={() => set({ colorOpen: !open, ...(compact ? { sheet: 'properties' as const } : {}) })}>
        <Palette size={26} color="#ff7bbd" strokeWidth={2.2} />
      </button>
      <div className="swatches">
        <button className="swatch-chip" style={{ right: 0, bottom: 0, background: bg }} {...tip('Back color. Press X to swap!')} onClick={() => set({ color: bg, bgColor: color })} />
        <button className="swatch-chip" style={{ left: 0, top: 0, background: color }} {...tip('Your drawing color! Tap to open colors. 🎨')} onClick={() => set({ colorOpen: true })} />
      </div>
    </nav>
  );
}
