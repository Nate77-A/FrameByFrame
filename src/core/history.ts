/** Undo history: document pointers (cheap thanks to Immer) plus pixel patches (spec §7.0). */
import type { ProjectDoc } from './types';
import { LIMITS } from './types';

export interface HistoryPatch { apply(which: 'before' | 'after'): void }
export interface Entry { label: string; before: ProjectDoc; after: ProjectDoc; patches: HistoryPatch[]; key?: string; time: number }

export class History {
  undoStack: Entry[] = [];
  redoStack: Entry[] = [];
  constructor(private limit: number = LIMITS.maxHistory) {}

  push(e: Entry): void {
    this.redoStack = [];
    const last = this.undoStack.at(-1);
    // A slider drag is one undo step: merge repeats of the same key arriving close together.
    if (e.key && last?.key === e.key && e.time - last.time < 600 && !e.patches.length && !last.patches.length) {
      last.after = e.after; last.time = e.time;
      return;
    }
    this.undoStack.push(e);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
  }
  undo(): ProjectDoc | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    [...e.patches].reverse().forEach((p) => p.apply('before'));
    this.redoStack.push(e);
    return e.before;
  }
  redo(): ProjectDoc | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.patches.forEach((p) => p.apply('after'));
    this.undoStack.push(e);
    return e.after;
  }
  clear(): void { this.undoStack = []; this.redoStack = []; }
}
