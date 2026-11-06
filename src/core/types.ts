/** Project document types (spec §5.0). Everything here is plain, serialisable data. */
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten';

export interface GradientStop { offset: number; color: string }
export interface Gradient {
  kind: 'linear' | 'radial' | 'conic';
  angle: number;
  stops: GradientStop[];
  blend: BlendMode;
}
export type Paint = string | Gradient | null;

/** x / y are the item's centre, so rotating and flipping stay in place. */
export interface ItemBase {
  id: string;
  x: number; y: number;
  width: number; height: number;
  rotation: number;
  scaleX: number; scaleY: number;
  opacity: number;
}
export interface RasterItem extends ItemBase { type: 'raster'; bitmap: string; rev: number }
export interface ImageFilters {
  blur: number; brightness: number; contrast: number;
  grayscale: boolean; sepia: boolean; invert: boolean;
}
export interface ImageItem extends ItemBase { type: 'image'; bitmap: string; filters: ImageFilters }
export type ShapeKind = 'rect' | 'triangle' | 'ellipse' | 'polygon' | 'star';
export interface ShapeItem extends ItemBase {
  type: 'shape';
  shape: ShapeKind;
  sides: number;
  points: number;
  cornerRadius: number;
  fill: Paint;
  stroke: string | null;
  strokeWidth: number;
  shadow: { color: string; blur: number; x: number; y: number } | null;
}
export interface TextItem extends ItemBase {
  type: 'text';
  text: string;
  fontFamily: string; fontSize: number;
  bold: boolean; italic: boolean; underline: boolean; strike: boolean;
  align: 'left' | 'center' | 'right';
  color: string;
  lineHeight: number; letterSpacing: number;
  outline: boolean; outlineColor: string; outlineWidth: number;
  background: string | null;
}
export type Item = RasterItem | ImageItem | ShapeItem | TextItem;

export interface Layer {
  id: string; name: string;
  visible: boolean; locked: boolean; solo: boolean; pinned: boolean;
  opacity: number; blendMode: BlendMode;
}
export interface Frame { id: string; cels: Record<string, Item[]> }

export interface AudioClip {
  id: string; name: string; asset: string; track: number;
  startTime: number; volume: number; mute: boolean; loop: boolean;
  fadeIn: number; fadeOut: number; trimStart: number; trimEnd: number;
}
export interface Guides { v: number[]; h: number[] }

export interface ProjectDoc {
  version: 2;
  canvas: { width: number; height: number; dpi: number; background: string | null };
  fps: number;
  /** Bottom to top. */
  layers: Layer[];
  pinned: Record<string, Item[]>;
  frames: Frame[];
  audioClips: AudioClip[];
  guides: Guides;
  meta: { author: string; created: string; modified: string };
}

export const LIMITS = {
  minZoom: 0.1, maxZoom: 8,
  minDuration: 0.1, maxDuration: 120,
  maxFps: 60, maxHistory: 50, maxImageSide: 4096,
  minTimeline: 180, maxTimeline: 480,
} as const;
