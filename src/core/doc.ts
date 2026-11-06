/** Pure helpers for reading and changing a ProjectDoc. No DOM, so unit tests can run them directly. */
import type { Frame, Item, Layer, ProjectDoc } from './types';
import { LIMITS } from './types';

let counter = 0;
export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${(counter++).toString(36)}`;

/** Stable empty list so an empty cel keeps the same identity between renders. */
export const EMPTY_ITEMS: Item[] = Object.freeze([]) as unknown as Item[];

export const makeLayer = (name: string, pinned = false): Layer => ({
  id: uid(), name, visible: true, locked: false, solo: false, pinned, opacity: 1, blendMode: 'normal',
});
export const makeFrame = (): Frame => ({ id: uid(), cels: {} });

export function frameCountFor(duration: number, fps: number): number {
  return Math.max(1, Math.ceil(+(duration * fps).toFixed(6)));
}
export const durationOf = (doc: ProjectDoc): number => doc.frames.length / doc.fps;

export function newProject(width = 800, height = 600, fps = 12, duration = 5): ProjectDoc {
  const now = new Date().toISOString();
  return {
    version: 2,
    canvas: { width, height, dpi: 72, background: '#ffffff' },
    fps,
    layers: [makeLayer('Background', true), makeLayer('Character')],
    pinned: {},
    frames: Array.from({ length: frameCountFor(duration, fps) }, makeFrame),
    audioClips: [],
    guides: { v: [], h: [] },
    meta: { author: '', created: now, modified: now },
  };
}

export function getCel(doc: ProjectDoc, frameIndex: number, layerId: string): Item[] {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (layer?.pinned) return doc.pinned[layerId] ?? EMPTY_ITEMS;
  return doc.frames[frameIndex]?.cels[layerId] ?? EMPTY_ITEMS;
}

/** The writable cel list; call on an Immer draft. */
export function celDraft(doc: ProjectDoc, frameIndex: number, layerId: string): Item[] {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (layer?.pinned) return (doc.pinned[layerId] ??= []);
  return (doc.frames[frameIndex].cels[layerId] ??= []);
}

export function findItem(doc: ProjectDoc, frameIndex: number, id: string): { item: Item; layerId: string } | null {
  for (const layer of doc.layers) {
    const item = getCel(doc, frameIndex, layer.id).find((i) => i.id === id);
    if (item) return { item, layerId: layer.id };
  }
  return null;
}

/** Layers that actually show, honouring Solo. */
export function shownLayers(doc: ProjectDoc): Layer[] {
  const solo = doc.layers.some((l) => l.solo);
  return doc.layers.filter((l) => (solo ? l.solo : l.visible));
}

export const frameHasContent = (f: Frame): boolean => Object.values(f.cels).some((c) => c.length > 0);

export function clampDuration(seconds: number): number {
  return Math.min(LIMITS.maxDuration, Math.max(LIMITS.minDuration, seconds));
}

/** Every bitmap id the document refers to (used for saving and duplicating). */
export function bitmapIds(items: Item[]): string[] {
  return items.flatMap((i) => (i.type === 'raster' || i.type === 'image' ? [i.bitmap] : []));
}
export function allBitmapIds(doc: ProjectDoc): Set<string> {
  const ids = new Set<string>();
  for (const f of doc.frames) for (const c of Object.values(f.cels)) bitmapIds(c).forEach((b) => ids.add(b));
  for (const c of Object.values(doc.pinned)) bitmapIds(c).forEach((b) => ids.add(b));
  return ids;
}

/** Fix up anything an older or hand-edited project may be missing. Throws on unusable input. */
export function migrateDoc(raw: unknown): ProjectDoc {
  const d = raw as Partial<ProjectDoc> | null;
  if (!d || typeof d !== 'object' || d.version !== 2) throw new Error('unsupported project version');
  if (!Array.isArray(d.layers) || !d.layers.length || !Array.isArray(d.frames) || !d.frames.length)
    throw new Error('project has no layers or frames');
  const w = d.canvas?.width, h = d.canvas?.height;
  if (!(typeof w === 'number' && w > 0 && typeof h === 'number' && h > 0)) throw new Error('bad canvas size');
  return {
    ...(d as ProjectDoc),
    pinned: d.pinned ?? {}, audioClips: d.audioClips ?? [],
    guides: d.guides ?? { v: [], h: [] },
    fps: Math.min(LIMITS.maxFps, Math.max(1, d.fps ?? 12)),
  };
}
