import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleHelp, Menu, Mic, Music, Redo2, Undo2 } from 'lucide-react';
import { useStore, getState } from '../core/store';
import { openProject, saveProject, forgetHandle } from '../core/projectFile';
import { clearAutosave } from '../core/idb';
import { bitmaps } from '../core/bitmaps';
import { clearAudio } from '../audio/assets';
import { newProject } from '../core/doc';
import { importImage } from '../tools/actions';
import { importAudioFile } from './audioImport';
import { sceneRef } from '../render/scene';
import { copySel, cutSel, hasClip, pasteSel, selectAll } from './clipboard';
import { tip } from './Tooltip';

function Dropdown({ label, help, children, icon }: { label: string; help: string; children: (close: () => void) => ReactNode; icon?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [open]);
  const keys = (e: React.KeyboardEvent) => {
    const items = [...ref.current!.querySelectorAll<HTMLElement>('[role=menuitem],[role=menuitemcheckbox]')].filter((b) => !(b as HTMLButtonElement).disabled);
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { setOpen(false); ref.current?.querySelector<HTMLElement>('button')?.focus(); e.stopPropagation(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) setOpen(true); else items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <div ref={ref} style={{ position: 'relative' }} onKeyDown={keys}>
      <button className="btn small" aria-haspopup="menu" aria-expanded={open} {...tip(help)} aria-label={label} onClick={() => setOpen(!open)}>{icon ?? label}</button>
      {open && <div className="menu-pop" role="menu" aria-label={label}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
function Item({ label, kbd, help, onClick, disabled, checked }: { label: string; kbd?: string; help: string; onClick(): void; disabled?: boolean; checked?: boolean }) {
  return (
    <button className="menu-item" role={checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={checked} disabled={disabled} data-tooltip={help} onClick={onClick}>
      <span>{checked !== undefined ? (checked ? '☑ ' : '☐ ') : ''}{label}</span>{kbd && <kbd>{kbd}</kbd>}
    </button>
  );
}
const mod = /Mac|iPad|iPhone/.test(navigator.platform) ? '⌘' : 'Ctrl+';

export function pickFile(accept: string, then: (f: File) => void) {
  const i = document.createElement('input');
  i.type = 'file'; i.accept = accept;
  i.onchange = () => { if (i.files?.[0]) then(i.files[0]); };
  i.click();
}

export function newProjectFlow() {
  const s = getState();
  const go = () => {
    bitmaps.clear(); clearAudio(); forgetHandle(); void clearAutosave().catch(() => {});
    s.replaceDoc(newProject());
    sceneRef.current?.fit();
  };
  if (s.revision !== s.savedRevision) s.ask('Start a new project? Unsaved work will be gone.', 'Start fresh', go);
  else go();
}
export const openFlow = () => pickFile('.franimator,.kanvaso,application/zip', (f) => void openProject(f));

function FileMenu() {
  const set = useStore((s) => s.set);
  const exp = (exportFormat: 'png' | 'mp4' | 'gif', c: () => void) => { set({ modal: 'export', exportFormat }); c(); };
  return <Dropdown label="File" help="File: new, open, save and share your work! 📁">{(c) => <>
    <Item label="New" help="Start a brand new project! ✨" onClick={() => { c(); newProjectFlow(); }} />
    <Item label="Open…" kbd={`${mod}O`} help="Open a project you saved before! 📂" onClick={() => { c(); openFlow(); }} />
    <Item label="Save" kbd={`${mod}S`} help="Keep your work safe! 💾" onClick={() => { c(); void saveProject(); }} />
    <Item label="Save As…" kbd={`${mod}⇧S`} help="Save a copy with a new name!" onClick={() => { c(); void saveProject(true); }} />
    <div className="menu-sep" />
    <Item label="Import Image…" help="Bring a picture onto your canvas! 🖼️" onClick={() => { c(); pickFile('image/*', (f) => void importImage(f).catch(() => getState().toast("Oops! That picture wouldn't load. 🔄"))); }} />
    <Item label="Import Audio…" help="Bring a sound into your timeline! 🎵" onClick={() => { c(); pickFile('audio/*,.m4a,.ogg', (f) => void importAudioFile(f)); }} />
    <div className="menu-sep" />
    <Item label="Export PNG Sequence…" help="Every frame as a picture, in a ZIP! 🖼️" onClick={() => exp('png', c)} />
    <Item label="Export MP4 Video…" help="Make a movie with sound! 🎬" onClick={() => exp('mp4', c)} />
    <Item label="Export Animated GIF…" help="Make a looping GIF to share! 🌀" onClick={() => exp('gif', c)} />
  </>}</Dropdown>;
}
function EditMenu() {
  const { undo, redo, canUndo, canRedo } = useStore();
  const has = useStore((s) => s.selection.length > 0);
  const set = useStore((s) => s.set);
  return <Dropdown label="Edit" help="Edit: undo, copy, paste and more! ✂️">{(c) => <>
    <Item label="Undo" kbd={`${mod}Z`} disabled={!canUndo} help="Go back one step! ↩️" onClick={() => { undo(); c(); }} />
    <Item label="Redo" kbd={`${mod}⇧Z`} disabled={!canRedo} help="Go forward one step! ↪️" onClick={() => { redo(); c(); }} />
    <div className="menu-sep" />
    <Item label="Cut" kbd={`${mod}X`} disabled={!has} help="Take this away and keep a copy! ✂️" onClick={() => { cutSel(); c(); }} />
    <Item label="Copy" kbd={`${mod}C`} disabled={!has} help="Make a copy! 📋" onClick={() => { copySel(); c(); }} />
    <Item label="Paste" kbd={`${mod}V`} disabled={!hasClip()} help="Put your copy here! 📌" onClick={() => { pasteSel(); c(); }} />
    <div className="menu-sep" />
    <Item label="Select All" kbd={`${mod}A`} help="Pick everything on this layer!" onClick={() => { selectAll(); c(); }} />
    <Item label="Deselect" help="Let go of everything!" onClick={() => { set({ selection: [] }); c(); }} />
  </>}</Dropdown>;
}
function WindowMenu() {
  const s = useStore();
  return <Dropdown label="Window" help="Window: show or hide the panels! 🪟">{() => <>
    <Item label="Tools Panel" checked={s.panels.tools} help="The tools on the left" onClick={() => s.togglePanel('tools')} />
    <Item label="Properties Panel" checked={s.panels.properties} help="The settings on the right" onClick={() => s.togglePanel('properties')} />
    <Item label="Timeline Panel" checked={s.panels.timeline} help="The frames along the bottom" onClick={() => s.togglePanel('timeline')} />
    <Item label="Audio Sound Effects" checked={s.modal === 'sfx'} help="Fun sounds to add! 🎵" onClick={() => s.set({ modal: s.modal === 'sfx' ? null : 'sfx' })} />
    <Item label="Record Your Audio" checked={s.modal === 'record'} help="Use your voice! 🎙" onClick={() => s.set({ modal: s.modal === 'record' ? null : 'record' })} />
    <Item label="Status Bar" checked={s.panels.status} help="The little info bar at the bottom" onClick={() => s.togglePanel('status')} />
    <Item label="Grid & Rulers" checked={s.grid.show} help="Lines to help you line things up" onClick={() => s.set({ grid: { ...s.grid, show: !s.grid.show, rulers: !s.grid.show } })} />
  </>}</Dropdown>;
}

export function TopBar() {
  const { undo, redo, canUndo, canRedo, set, compact } = useStore();
  return (
    <header className="topbar">
      <button className="logo" {...tip('FrAnimator! Click to learn about this app.')} onClick={() => set({ modal: 'about' })}>Fr<b>Animator</b></button>
      {compact
        ? <Dropdown label="Menu" help="All the menus!" icon={<Menu size={22} />}>{() => <div className="row" style={{ padding: 4 }}><FileMenu /><EditMenu /><WindowMenu /></div>}</Dropdown>
        : <><FileMenu /><EditMenu /><WindowMenu /></>}
      <div className="sep" />
      <button className="btn" disabled={!canUndo} data-testid="undo" {...tip('Undo: go back one step! ↩️')} onClick={undo}><Undo2 size={22} /></button>
      <button className="btn" disabled={!canRedo} data-testid="redo" {...tip('Redo: go forward one step! ↪️')} onClick={redo}><Redo2 size={22} /></button>
      <div className="spacer" />
      <button className="btn" {...tip('Sound effects: add fun sounds! 🎵')} onClick={() => set({ modal: 'sfx' })}><Music size={22} color="#a8e063" /></button>
      <button className="btn" {...tip('Record your own voice! 🎙')} onClick={() => set({ modal: 'record' })}><Mic size={22} color="#e94560" /></button>
      <button className="btn" {...tip('Help: how everything works! ❓')} onClick={() => set({ modal: 'help' })}><CircleHelp size={22} /></button>
    </header>
  );
}
