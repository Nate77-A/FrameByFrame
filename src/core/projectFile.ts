/** .kanvaso files: a ZIP of project.json, PNG bitmaps and audio (spec §4.6.1, §5.0). */
import type { Item, ProjectDoc } from './types';
import { bitmaps } from './bitmaps';
import { allBitmapIds, migrateDoc } from './doc';
import { addAudio, clearAudio, getAudio } from '../audio/assets';
import { getState } from './store';
import { clearAutosave } from './idb';
import { sceneRef } from '../render/scene';
import { playChime } from '../audio/sfx';

const zipLib = () => import('jszip').then((m) => m.default);

export async function packProject(doc: ProjectDoc): Promise<Blob> {
  const JSZip = await zipLib();
  const zip = new JSZip();
  zip.file('project.json', JSON.stringify({ ...doc, meta: { ...doc.meta, modified: new Date().toISOString() } }));
  await Promise.all([...allBitmapIds(doc)].map(async (id) => zip.file(`bitmaps/${id}.png`, await bitmaps.blob(id))));
  for (const id of new Set(doc.audioClips.map((c) => c.asset))) {
    const a = getAudio(id);
    if (a) zip.file(`audio/${id}`, a.blob);
  }
  // PNG and audio are already compressed, so storing keeps saves quick.
  return zip.generateAsync({ type: 'blob', compression: 'STORE', mimeType: 'application/zip' });
}

function allItems(doc: ProjectDoc): Item[] {
  return [...doc.frames.flatMap((f) => Object.values(f.cels).flat()), ...Object.values(doc.pinned).flat()];
}

export async function unpackProject(file: Blob): Promise<ProjectDoc> {
  const JSZip = await zipLib();
  const zip = await JSZip.loadAsync(file);
  const json = zip.file('project.json');
  if (!json) throw new Error('not a kanvaso project');
  const doc = migrateDoc(JSON.parse(await json.async('string')));
  bitmaps.clear();
  clearAudio();
  const sizes = new Map<string, { w: number; h: number }>();
  for (const it of allItems(doc)) if (it.type === 'raster' || it.type === 'image') sizes.set(it.bitmap, { w: it.width, h: it.height });
  await Promise.all([...sizes].map(async ([id, s]) => {
    const f = zip.file(`bitmaps/${id}.png`);
    if (f) bitmaps.addBlob(id, new Blob([await f.async('arraybuffer')], { type: 'image/png' }), s.w, s.h);
  }));
  await Promise.all([...new Set(doc.audioClips.map((c) => c.asset))].map(async (id) => {
    const f = zip.file(`audio/${id}`);
    if (f) await addAudio(new Blob([await f.async('arraybuffer')]), id);
  }));
  return doc;
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}

type SaveHandle = { createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>; name: string };
let handle: SaveHandle | null = null;
export const forgetHandle = () => { handle = null; };

export async function saveProject(saveAs = false): Promise<void> {
  const s = getState();
  const blob = await packProject(s.doc);
  const name = `${s.fileName}.kanvaso`;
  const picker = (window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<SaveHandle> }).showSaveFilePicker;
  if (picker) {
    try {
      if (saveAs || !handle) handle = await picker({ suggestedName: name, types: [{ description: 'Kanvaso project', accept: { 'application/zip': ['.kanvaso'] } }] });
      const w = await handle.createWritable();
      await w.write(blob); await w.close();
      getState().set({ fileName: handle.name.replace(/\.kanvaso$/, ''), savedRevision: s.revision });
      return done();
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      handle = null;
    }
  }
  downloadBlob(blob, name);
  getState().set({ savedRevision: s.revision });
  done();
}
function done() { getState().toast('Saved! 🎉'); chime(); void clearAutosave().catch(() => {}); }

/** A tiny success sound (spec §8.0). */
export const chime = playChime;

export async function openProject(file: File): Promise<void> {
  const s = getState();
  try {
    const doc = await unpackProject(file);
    forgetHandle();
    s.replaceDoc(doc, file.name.replace(/\.kanvaso$/, ''));
    sceneRef.current?.fit();
    s.toast('Project opened! 🎨');
  } catch (e) {
    console.warn(e);
    s.toast("Oops! That file wouldn't open. Try another one! 🔄");
  }
}
