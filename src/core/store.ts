/** Central Zustand store: the undoable document plus all UI state. */
import { create } from 'zustand';
import { produce, setAutoFreeze } from 'immer';
import type { AudioClip, BlendMode, Gradient, Item, Layer, ProjectDoc, ShapeKind } from './types';
import { LIMITS } from './types';
import { bitmaps } from './bitmaps';
import { History, type HistoryPatch } from './history';
import { celDraft, clampDuration, frameCountFor, frameHasContent, getCel, makeFrame, makeLayer, newProject, uid } from './doc';

setAutoFreeze(true);

export type ToolId = 'select' | 'pencil' | 'brush' | 'eraser' | 'shape' | 'text' | 'bucket' | 'eyedropper' | 'hand' | 'zoom';
export type PencilStyle = 'ink' | 'graphite' | 'calligraphy' | 'marker' | 'softbrush';
export type BrushType = 'round' | 'flat' | 'scatter' | 'texture' | 'watercolor' | 'inkbleed';
export type ModalKind = 'about' | 'help' | 'export' | 'sfx' | 'record' | null;

export const defaultSettings = {
  pencil: { style: 'ink' as PencilStyle, size: 6, opacity: 1, pressure: 0.7, tilt: 0.3, smoothing: 0.3, harden: 0.9 },
  brush: { type: 'round' as BrushType, size: 24, opacity: 1, flow: 0.8, pressure: 0.7, tilt: 0.3, spacing: 0.1, scatter: 0.5 },
  eraser: { size: 30, opacity: 1, hard: true, toBackground: false },
  shape: { kind: 'rect' as ShapeKind, sides: 6, points: 5, cornerRadius: 0, strokeWidth: 4, noFill: false, noStroke: true },
  text: {
    fontFamily: 'Baloo 2', fontSize: 48, bold: false, italic: false, underline: false, strike: false,
    align: 'left' as const, lineHeight: 1.2, letterSpacing: 0, outline: false, outlineColor: '#000000', outlineWidth: 2, background: null as string | null,
  },
  bucket: { gradient: false, tolerance: 0.15, mode: 'region' as 'shape' | 'region' | 'all' },
  eyedropper: { sample: 1 as 1 | 3 | 5, allLayers: true },
  hand: { speed: 1 },
  zoom: { step: 0.25 },
};
export type Settings = typeof defaultSettings;

export const defaultGradient: Gradient = {
  kind: 'linear', angle: 0, blend: 'normal',
  stops: [{ offset: 0, color: '#e94560' }, { offset: 0.5, color: '#ffb347' }, { offset: 1, color: '#53d8fb' }],
};

export interface Toast { id: number; text: string }
export interface Confirm { text: string; yes: string; onYes: () => void }

interface State {
  doc: ProjectDoc;
  /** Bumps on every document or pixel change; drives auto-save and redraws. */
  revision: number;
  savedRevision: number;
  fileName: string;
  canUndo: boolean; canRedo: boolean;

  tool: ToolId;
  settings: Settings;
  color: string; bgColor: string; colorMode: 'solid' | 'gradient'; gradient: Gradient;
  colorOpen: boolean;

  frameIndex: number; activeLayerId: string;
  selection: string[]; selectedClipId: string | null;
  zoom: number; panX: number; panY: number;
  cursor: { x: number; y: number } | null;

  playing: boolean; loop: boolean; timelineZoom: number; timelineHeight: number;
  onion: { on: boolean; before: number; after: number; opacity: number };
  grid: { show: boolean; size: number; snap: boolean; snapObjects: boolean; rulers: boolean };
  panels: { tools: boolean; properties: boolean; timeline: boolean; status: boolean };
  sheet: 'none' | 'properties' | 'timeline';
  modal: ModalKind; exportFormat: 'png' | 'mp4' | 'gif';
  toasts: Toast[]; confirm: Confirm | null; compact: boolean;
}

interface Actions {
  commit(label: string, recipe: (d: ProjectDoc) => void, opts?: { patches?: HistoryPatch[]; key?: string }): void;
  undo(): void; redo(): void;
  replaceDoc(doc: ProjectDoc, fileName?: string): void;
  set(p: Partial<State>): void;
  setSetting<K extends keyof Settings>(tool: K, patch: Partial<Settings[K]>): void;
  togglePanel(k: keyof State['panels']): void;
  toast(text: string): void;
  ask(text: string, yes: string, onYes: () => void): void;

  addFrame(): void; duplicateFrame(): void; deleteFrame(): void; moveFrame(from: number, to: number): void;
  setFrame(i: number): void; setFps(fps: number): void; setDuration(seconds: number): void;
  addLayer(): void; deleteLayer(id: string): void; duplicateLayer(id: string): void;
  updateLayer(id: string, patch: Partial<Layer>, label?: string): void; moveLayer(from: number, to: number): void;
  togglePin(id: string): void;

  updateItems(ids: string[], patch: Partial<Item> | ((i: Item) => Partial<Item>), label?: string, key?: string): void;
  deleteSelection(): void; reorderSelection(how: 'front' | 'forward' | 'backward' | 'back'): void;
  addItem(item: Item, layerId?: string): void;

  addClip(c: Omit<AudioClip, 'id' | 'track'>): void;
  updateClip(id: string, patch: Partial<AudioClip>, key?: string): void; deleteClip(id: string): void;
  zoomTo(z: number, anchorX?: number, anchorY?: number): void;
}

export type Store = State & Actions;
export const history = new History();

/** Deep-copy cel content, cloning pixels so the two copies can be painted independently. */
export function cloneItems(items: Item[]): Item[] {
  return items.map((i) => {
    const c = { ...i, id: uid() };
    if (c.type === 'raster') c.bitmap = bitmaps.clone(c.bitmap);
    return c;
  });
}

export const blendToComposite = (b: BlendMode): GlobalCompositeOperation => (b === 'normal' ? 'source-over' : b);

export const COMPACT_QUERY = '(max-width: 900px), (orientation: portrait) and (max-width: 1024px)';
const initialDoc = newProject();

export const useStore = create<Store>((set, get) => {
  const applyHistory = (doc: ProjectDoc | null) => {
    if (!doc) return;
    const s = get();
    const ids = new Set(doc.layers.map((l) => l.id));
    set({
      doc, revision: s.revision + 1,
      frameIndex: Math.min(s.frameIndex, doc.frames.length - 1),
      activeLayerId: ids.has(s.activeLayerId) ? s.activeLayerId : doc.layers.at(-1)!.id,
      selection: [], canUndo: history.undoStack.length > 0, canRedo: history.redoStack.length > 0,
    });
  };
  const frameOps = (label: string, recipe: (d: ProjectDoc) => void, frameIndex?: number) => {
    get().commit(label, recipe);
    if (frameIndex !== undefined) set({ frameIndex, selection: [] });
  };
  return {
    doc: initialDoc, revision: 0, savedRevision: 0, fileName: 'my-animation',
    canUndo: false, canRedo: false,
    tool: 'pencil', settings: defaultSettings,
    color: '#000000', bgColor: '#ffffff', colorMode: 'solid', gradient: defaultGradient, colorOpen: false,
    frameIndex: 0, activeLayerId: initialDoc.layers[1].id,
    selection: [], selectedClipId: null,
    zoom: 1, panX: 0, panY: 0, cursor: null,
    playing: false, loop: true, timelineZoom: 1, timelineHeight: 240,
    onion: { on: false, before: 1, after: 1, opacity: 0.35 },
    grid: { show: false, size: 32, snap: false, snapObjects: false, rulers: false },
    panels: { tools: true, properties: true, timeline: true, status: true },
    sheet: 'none', modal: null, exportFormat: 'png',
    toasts: [], confirm: null, compact: typeof matchMedia === 'function' && matchMedia(COMPACT_QUERY).matches,

    commit(label, recipe, opts) {
      const s = get();
      const after = produce(s.doc, recipe);
      if (after === s.doc && !opts?.patches?.length) return;
      history.push({ label, before: s.doc, after, patches: opts?.patches ?? [], key: opts?.key, time: performance.now() });
      set({ doc: after, revision: s.revision + 1, canUndo: true, canRedo: false });
    },
    undo: () => applyHistory(history.undo()),
    redo: () => applyHistory(history.redo()),
    replaceDoc(doc, fileName) {
      history.clear();
      set((s) => ({
        doc, fileName: fileName ?? 'my-animation', revision: s.revision + 1, savedRevision: s.revision + 1,
        frameIndex: 0, activeLayerId: doc.layers.at(-1)!.id, selection: [], selectedClipId: null,
        canUndo: false, canRedo: false, playing: false,
      }));
    },
    set: (p) => set(p),
    setSetting: (tool, patch) => set((s) => ({ settings: { ...s.settings, [tool]: { ...s.settings[tool], ...patch } } })),
    togglePanel: (k) => set((s) => ({ panels: { ...s.panels, [k]: !s.panels[k] } })),
    toast(text) {
      const id = Date.now() + Math.random();
      set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
    },
    ask: (text, yes, onYes) => set({ confirm: { text, yes, onYes } }),

    addFrame() {
      const i = get().frameIndex + 1;
      frameOps('Add frame', (d) => { d.frames.splice(i, 0, makeFrame()); }, i);
    },
    duplicateFrame() {
      const s = get(); const i = s.frameIndex + 1;
      const src = s.doc.frames[s.frameIndex];
      const copy = { ...makeFrame(), cels: Object.fromEntries(Object.entries(src.cels).map(([k, v]) => [k, cloneItems(v)])) };
      frameOps('Duplicate frame', (d) => { d.frames.splice(i, 0, copy); }, i);
    },
    deleteFrame() {
      const s = get();
      if (s.doc.frames.length <= 1) { get().toast('You need at least one frame! 🎞️'); return; }
      const i = s.frameIndex;
      frameOps('Delete frame', (d) => { d.frames.splice(i, 1); }, Math.min(i, s.doc.frames.length - 2));
    },
    moveFrame(from, to) {
      if (from === to) return;
      frameOps('Move frame', (d) => { const [f] = d.frames.splice(from, 1); d.frames.splice(to, 0, f); }, to);
    },
    setFrame(i) {
      const s = get();
      const n = Math.max(0, Math.min(s.doc.frames.length - 1, i));
      if (n !== s.frameIndex) set({ frameIndex: n, selection: [] });
    },
    setFps(fps) {
      const v = Math.max(1, Math.min(LIMITS.maxFps, Math.round(fps)));
      get().commit('Change FPS', (d) => { d.fps = v; }, { key: 'fps' });
    },
    setDuration(seconds) {
      const s = get();
      const n = frameCountFor(clampDuration(seconds), s.doc.fps);
      const cur = s.doc.frames.length;
      const apply = () => {
        get().commit('Change duration', (d) => {
          if (n < cur) d.frames.length = n;
          else for (let i = cur; i < n; i++) d.frames.push(makeFrame());
        }, { key: 'duration' });
        set({ frameIndex: Math.min(get().frameIndex, n - 1) });
      };
      const lost = s.doc.frames.slice(n).filter(frameHasContent).length;
      if (lost) get().ask(`This removes ${lost} frame${lost > 1 ? 's' : ''} with drawings. Keep going?`, 'Remove them', apply);
      else apply();
    },

    addLayer() {
      const l = makeLayer(`Layer ${get().doc.layers.length + 1}`);
      const at = get().doc.layers.findIndex((x) => x.id === get().activeLayerId) + 1;
      get().commit('Add layer', (d) => { d.layers.splice(at, 0, l); });
      set({ activeLayerId: l.id });
    },
    deleteLayer(id) {
      const s = get();
      if (s.doc.layers.length <= 1) { get().toast('You need at least one layer! 🥞'); return; }
      const i = s.doc.layers.findIndex((l) => l.id === id);
      get().commit('Delete layer', (d) => {
        d.layers.splice(i, 1); delete d.pinned[id];
        d.frames.forEach((f) => { delete f.cels[id]; });
      });
      if (s.activeLayerId === id) set({ activeLayerId: get().doc.layers[Math.max(0, i - 1)].id, selection: [] });
    },
    duplicateLayer(id) {
      const s = get();
      const i = s.doc.layers.findIndex((l) => l.id === id);
      const src = s.doc.layers[i];
      const l = { ...src, id: uid(), name: `${src.name} copy`, solo: false };
      const pinnedCopy = cloneItems(s.doc.pinned[id] ?? []);
      const celCopies = s.doc.frames.map((f) => (f.cels[id] ? cloneItems(f.cels[id]) : null));
      get().commit('Duplicate layer', (d) => {
        d.layers.splice(i + 1, 0, l);
        if (pinnedCopy.length) d.pinned[l.id] = pinnedCopy;
        d.frames.forEach((f, n) => { const c = celCopies[n]; if (c) f.cels[l.id] = c; });
      });
      set({ activeLayerId: l.id });
    },
    updateLayer(id, patch, label = 'Change layer') {
      get().commit(label, (d) => { const l = d.layers.find((x) => x.id === id); if (l) Object.assign(l, patch); }, { key: `layer-${id}-${Object.keys(patch)[0]}` });
    },
    moveLayer(from, to) {
      if (from === to) return;
      get().commit('Move layer', (d) => { const [l] = d.layers.splice(from, 1); d.layers.splice(to, 0, l); });
    },
    togglePin(id) {
      const s = get();
      const layer = s.doc.layers.find((l) => l.id === id)!;
      const items = getCel(s.doc, s.frameIndex, id);
      get().commit(layer.pinned ? 'Unpin layer' : 'Pin layer', (d) => {
        const l = d.layers.find((x) => x.id === id)!;
        if (l.pinned) { d.frames[s.frameIndex].cels[id] = [...items]; delete d.pinned[id]; }
        else { d.pinned[id] = [...items]; }
        l.pinned = !l.pinned;
      });
      set({ selection: [] });
    },

    updateItems(ids, patch, label = 'Change object', key) {
      const s = get();
      get().commit(label, (d) => {
        for (const layer of d.layers) {
          const list = layer.pinned ? d.pinned[layer.id] : d.frames[s.frameIndex].cels[layer.id];
          list?.forEach((it) => {
            if (ids.includes(it.id)) Object.assign(it, typeof patch === 'function' ? patch(it) : patch);
          });
        }
      }, { key });
    },
    deleteSelection() {
      const s = get();
      if (s.selectedClipId) { get().deleteClip(s.selectedClipId); return; }
      if (!s.selection.length) return;
      get().commit('Delete', (d) => {
        for (const layer of d.layers) {
          const list = layer.pinned ? d.pinned[layer.id] : d.frames[s.frameIndex].cels[layer.id];
          if (!list) continue;
          for (let i = list.length - 1; i >= 0; i--) if (s.selection.includes(list[i].id)) list.splice(i, 1);
        }
      });
      set({ selection: [] });
    },
    reorderSelection(how) {
      const s = get();
      get().commit('Change order', (d) => {
        const list = celDraft(d, s.frameIndex, s.activeLayerId);
        const picked = list.filter((i) => s.selection.includes(i.id));
        if (how === 'front' || how === 'back') {
          const rest = list.filter((i) => !s.selection.includes(i.id));
          list.splice(0, list.length, ...(how === 'front' ? [...rest, ...picked] : [...picked, ...rest]));
        } else {
          const order = how === 'forward' ? [...picked].reverse() : picked;
          for (const it of order) {
            const i = list.findIndex((x) => x.id === it.id);
            const j = how === 'forward' ? i + 1 : i - 1;
            if (j >= 0 && j < list.length) { const [m] = list.splice(i, 1); list.splice(j, 0, m); }
          }
        }
      });
    },
    addItem(item, layerId) {
      const s = get();
      const id = layerId ?? s.activeLayerId;
      get().commit('Add object', (d) => { celDraft(d, s.frameIndex, id).push(item); });
    },

    addClip(c) {
      const s = get();
      const len = c.trimEnd - c.trimStart;
      const clash = (t: number) => s.doc.audioClips.some((o) => o.track === t && o.startTime < c.startTime + len && c.startTime < o.startTime + (o.trimEnd - o.trimStart));
      let track = 0;
      while (clash(track)) track++;
      const clip: AudioClip = { ...c, id: uid(), track };
      get().commit('Add sound', (d) => { d.audioClips.push(clip); });
      set({ selectedClipId: clip.id, selection: [] });
    },
    updateClip(id, patch, key) {
      get().commit('Change sound', (d) => { const c = d.audioClips.find((x) => x.id === id); if (c) Object.assign(c, patch); }, { key: key ?? `clip-${id}-${Object.keys(patch)[0]}` });
    },
    deleteClip(id) {
      get().commit('Delete sound', (d) => { d.audioClips = d.audioClips.filter((c) => c.id !== id); });
      set({ selectedClipId: null });
    },
    zoomTo(z, ax, ay) {
      const s = get();
      const zoom = Math.max(LIMITS.minZoom, Math.min(LIMITS.maxZoom, z));
      if (ax === undefined || ay === undefined) { set({ zoom }); return; }
      const k = zoom / s.zoom;
      set({ zoom, panX: ax - (ax - s.panX) * k, panY: ay - (ay - s.panY) * k });
    },
  };
});

export const store = useStore;
export const getState = useStore.getState;
export const activeLayer = (s: State): Layer | undefined => s.doc.layers.find((l) => l.id === s.activeLayerId);
export const currentItems = (s: State): Item[] => getCel(s.doc, s.frameIndex, s.activeLayerId);
