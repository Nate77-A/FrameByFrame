/** Internal clipboard for canvas objects. */
import type { Item } from '../core/types';
import { celDraft, uid } from '../core/doc';
import { cloneItems, currentItems, getState } from '../core/store';

let held: Item[] = [];
export const hasClip = () => held.length > 0;

export function copySel() {
  const s = getState();
  held = currentItems(s).filter((i) => s.selection.includes(i.id));
}
export function cutSel() { copySel(); getState().deleteSelection(); }
export function pasteSel() {
  const s = getState();
  if (!held.length) return;
  const made = cloneItems(held).map((i) => ({ ...i, id: uid(), x: i.x + 20, y: i.y + 20 }));
  s.commit('Paste', (d) => { celDraft(d, s.frameIndex, s.activeLayerId).push(...made); });
  held = made;
  s.set({ tool: 'select', selection: made.map((m) => m.id) });
}
export function selectAll() {
  const s = getState();
  s.set({ tool: 'select', selection: currentItems(s).map((i) => i.id) });
}
