/** Crash protection: every 30 s, if anything changed, keep a copy in IndexedDB (spec §4.6.1). */
import { getState } from './store';
import { packProject, unpackProject } from './projectFile';
import { tx } from './idb';
import { sceneRef } from '../render/scene';

/** Bytes rather than a Blob: WebKit can refuse to store Blobs in IndexedDB. */
interface Snapshot { bytes: ArrayBuffer; time: number; name: string }

export async function autosaveNow(): Promise<void> {
  const s = getState();
  const bytes = await (await packProject(s.doc)).arrayBuffer();
  await tx('readwrite', (st) => st.put({ bytes, time: Date.now(), name: s.fileName } satisfies Snapshot, 'latest'));
}

export function startAutosave(intervalMs = 30000): () => void {
  let seen = getState().revision;
  let busy = false;
  void navigator.storage?.persist?.();
  const t = setInterval(async () => {
    const r = getState().revision;
    if (r === seen || busy || getState().playing) return;
    busy = true;
    try { await autosaveNow(); seen = r; }
    catch (e) { console.warn('auto-save failed', e); }
    busy = false;
  }, intervalMs);
  return () => clearInterval(t);
}

/** After a crash or closed tab, offer the last auto-save back. */
export async function offerRestore(): Promise<void> {
  let snap: Snapshot | undefined;
  try { snap = await tx('readonly', (s) => s.get('latest')); } catch { return; }
  if (!snap?.bytes) return;
  const s = getState();
  const when = new Date(snap.time).toLocaleString();
  s.ask(`We found your drawing from ${when}. Bring it back?`, 'Yes, restore it!', async () => {
    try {
      s.replaceDoc(await unpackProject(new Blob([snap!.bytes])), snap!.name);
      sceneRef.current?.fit();
    } catch { s.toast("Oops! That auto-save couldn't be opened. 🔄"); }
  });
}
