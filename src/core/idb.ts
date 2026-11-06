/** Thin IndexedDB wrapper for the auto-save slot. */
const open = () => new Promise<IDBDatabase>((res, rej) => {
  const r = indexedDB.open('kanvaso', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('autosave');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
export async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const q = run(db.transaction('autosave', mode).objectStore('autosave'));
    q.onsuccess = () => { res(q.result); db.close(); };
    q.onerror = () => { rej(q.error); db.close(); };
  });
}
export const clearAutosave = () => tx('readwrite', (s) => s.delete('latest'));
