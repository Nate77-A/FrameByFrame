import { useEffect } from 'react';
import { Clapperboard, SlidersHorizontal } from 'lucide-react';
import { COMPACT_QUERY, useStore, getState } from '../core/store';
import { offerRestore, startAutosave } from '../core/autosave';
import { openProject, PROJECT_EXT, saveProject } from '../core/projectFile';
import { installPlayback } from '../audio/engine';
import { importImage } from '../tools/actions';
import { keyState } from '../tools/input';
import { sceneRef } from '../render/scene';
import { CanvasArea } from './CanvasArea';
import { PropertiesBody } from './Properties';
import { Timeline } from './Timeline';
import { TooltipLayer } from './Tooltip';
import { Toolbar, TOOLS } from './Toolbar';
import { openFlow, TopBar } from './TopBar';
import { Modals } from './Modals';
import { importAudioFile } from './audioImport';
import { copySel, cutSel, pasteSel, selectAll } from './clipboard';
import { Component, type ReactNode } from 'react';

/** Never show a stack trace to a child (spec §8.0). */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: Error) { console.error(e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <div className="backdrop"><div className="modal"><h2>Oops! Something went wrong.</h2><p>Your auto-save should still be safe. Reload to try again! 🔄</p><button className="btn primary" onClick={() => location.reload()}>Reload</button></div></div>;
  }
}

function Status() {
  const cursor = useStore((s) => s.cursor); const zoom = useStore((s) => s.zoom); const tool = useStore((s) => s.tool);
  const fps = useStore((s) => s.doc.fps); const frame = useStore((s) => s.frameIndex); const n = useStore((s) => s.doc.frames.length);
  return <footer className="status">
    <span>{cursor ? `${cursor.x}, ${cursor.y}` : 'Ready'}</span><span>{Math.round(zoom * 100)}%</span>
    <span>{TOOLS.find((t) => t.id === tool)?.name}</span><span>Frame {frame + 1}/{n}</span><span>{fps} FPS</span>
  </footer>;
}

function useShortcuts() {
  useEffect(() => {
    const typing = (e: Event) => { const t = e.target as HTMLElement; return t.matches?.('input:not([type=range]),textarea,select'); };
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const s = getState();
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta) {
        const run: Record<string, () => void> = {
          z: () => (e.shiftKey ? s.redo() : s.undo()), y: s.redo, s: () => void saveProject(e.shiftKey), o: openFlow,
          c: copySel, x: cutSel, v: pasteSel, a: selectAll,
          '=': () => s.zoomTo(s.zoom * 1.25, ...center()), '+': () => s.zoomTo(s.zoom * 1.25, ...center()), '-': () => s.zoomTo(s.zoom / 1.25, ...center()),
        };
        if (run[k]) { e.preventDefault(); run[k](); }
        return;
      }
      if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { keyState.space = true; keyState.spacePanned = false; } return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { s.deleteSelection(); return; }
      if (e.key === 'Escape') { s.set({ selection: [] }); return; }
      if (e.key === ',') { s.setFrame(s.frameIndex - 1); return; }
      if (e.key === '.') { s.setFrame(s.frameIndex + 1); return; }
      if (k === 'd') { s.set({ color: '#000000', bgColor: '#ffffff' }); return; }
      if (k === 'x') { s.set({ color: s.bgColor, bgColor: s.color }); return; }
      if (k === 'c') { s.set({ colorOpen: !s.colorOpen }); return; }
      const t = TOOLS.find((o) => o.key.toLowerCase() === k);
      if (t) s.set({ tool: t.id, selection: [] });
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || typing(e)) return;
      // A tap plays; a hold-and-drag has already panned (spec §4.5.1).
      if (keyState.space && !keyState.spacePanned) { const s = getState(); s.set({ playing: !s.playing }); }
      keyState.space = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);
}
const center = (): [number, number] => { const st = sceneRef.current?.stage; return [(st?.width() ?? 0) / 2, (st?.height() ?? 0) / 2]; };

function useDrop() {
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      for (const f of e.dataTransfer?.files ?? []) {
        if (PROJECT_EXT.test(f.name)) void openProject(f);
        else if (f.type.startsWith('image/')) void importImage(f).catch(() => getState().toast("Oops! That picture wouldn't load. 🔄"));
        else if (f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a)$/i.test(f.name)) void importAudioFile(f);
      }
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop); };
  }, []);
}
function useCompact() {
  useEffect(() => {
    const q = matchMedia(COMPACT_QUERY);
    const apply = () => getState().set({ compact: q.matches });
    apply();
    q.addEventListener('change', apply);
    return () => q.removeEventListener('change', apply);
  }, []);
}

export function App() {
  const panels = useStore((s) => s.panels); const compact = useStore((s) => s.compact);
  const sheet = useStore((s) => s.sheet); const set = useStore((s) => s.set);
  useShortcuts(); useDrop(); useCompact();
  useEffect(() => {
    const stops = [startAutosave(), installPlayback()];
    void offerRestore();
    const warn = (e: BeforeUnloadEvent) => { const s = getState(); if (s.revision !== s.savedRevision) e.preventDefault(); };
    const oops = (e: PromiseRejectionEvent) => { console.warn(e.reason); getState().toast('Oops! Something went wrong. Try again! 🔄'); };
    window.addEventListener('beforeunload', warn);
    window.addEventListener('unhandledrejection', oops);
    return () => { stops.forEach((f) => f()); window.removeEventListener('beforeunload', warn); window.removeEventListener('unhandledrejection', oops); };
  }, []);
  return (
    <Boundary>
      <div className={`app ${compact ? 'compact' : ''}`}>
        <TopBar />
        <main className="main">
          {panels.tools && !compact && <Toolbar />}
          <CanvasArea />
          {panels.properties && !compact && <aside className="props" aria-label="Properties"><PropertiesBody /></aside>}
          {compact && panels.tools && <Toolbar />}
        </main>
        {compact && <div className="bottom-tabs">
          <button className={`btn small ${sheet === 'properties' ? 'on' : ''}`} data-testid="tab-properties" onClick={() => set({ sheet: sheet === 'properties' ? 'none' : 'properties' })}><SlidersHorizontal size={18} /> Settings</button>
          <button className={`btn small ${sheet === 'timeline' ? 'on' : ''}`} data-testid="tab-timeline" onClick={() => set({ sheet: sheet === 'timeline' ? 'none' : 'timeline' })}><Clapperboard size={18} /> Timeline</button>
        </div>}
        {!compact && panels.timeline && <Timeline />}
        {compact && sheet === 'timeline' && <Timeline overlay />}
        {compact && sheet === 'properties' && <>
          <div className="backdrop" style={{ background: 'transparent', zIndex: 59 }} onPointerDown={() => set({ sheet: 'none' })} />
          <aside className="props sheet" aria-label="Properties"><div className="sheet-handle" onPointerDown={() => set({ sheet: 'none' })} /><PropertiesBody /></aside>
        </>}
        {panels.status && <Status />}
        <TooltipLayer />
        <Modals />
      </div>
    </Boundary>
  );
}
