/** Crash protection: every 30 s, if anything changed, keep a copy in IndexedDB (spec §4.6.1). */
import { getState } from './store';
import { packProject, unpackProject } from './projectFile';

const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('kanvaso', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('autosave');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = run(db.transaction('autosave', mode).objectStore('autosave'));
    q.onsuccess = () => { res(q.result); db.close(); };
    q.onerror = () => { rej(q.error); db.close(); };
  });
}
interface Snapshot { blob: Blob; time: number; name: string }

export async function autosaveNow(): Promise<void> {
  const s = getState();
  const blob = await packProject(s.doc);
  await tx('readwrite', (st) => st.put({ blob, time: Date.now(), name: s.fileName } satisfies Snapshot, 'latest'));
}
export const clearAutosave = () => tx('readwrite', (s) => s.delete('latest'));

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
  if (!snap) return;
  const s = getState();
  const when = new Date(snap.time).toLocaleString();
  s.ask(`We found your drawing from ${when}. Bring it back?`, 'Yes, restore it!', async () => {
    try {
      s.replaceDoc(await unpackProject(snap!.blob), snap!.name);
      (await import('../render/scene')).sceneRef.current?.fit();
    } catch { s.toast("Oops! That auto-save couldn't be opened. 🔄"); }
  });
}
