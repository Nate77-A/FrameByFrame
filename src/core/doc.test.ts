import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { celDraft, durationOf, EMPTY_ITEMS, frameCountFor, getCel, makeLayer, migrateDoc, newProject, shownLayers } from './doc';
import { History } from './history';

describe('document', () => {
  it('derives duration from frames', () => {
    const d = newProject();
    expect(d.frames.length).toBe(60);
    expect(durationOf(d)).toBe(5);
    expect(frameCountFor(0.1, 12)).toBe(2);
    expect(frameCountFor(0.1, 10)).toBe(1); // no float rounding up to 2
  });
  it('shares pinned cels between frames', () => {
    const d = newProject();
    const bg = d.layers[0];
    const next = produce(d, (x) => { celDraft(x, 3, bg.id).push({ id: 'a' } as never); });
    expect(getCel(next, 0, bg.id)).toHaveLength(1);
    expect(getCel(next, 59, bg.id)).toHaveLength(1);
    const ch = d.layers[1];
    const n2 = produce(d, (x) => { celDraft(x, 3, ch.id).push({ id: 'b' } as never); });
    expect(getCel(n2, 3, ch.id)).toHaveLength(1);
    expect(getCel(n2, 4, ch.id)).toBe(EMPTY_ITEMS);
  });
  it('honours solo', () => {
    const d = newProject();
    d.layers.push({ ...makeLayer('x'), solo: true });
    expect(shownLayers(d).map((l) => l.name)).toEqual(['x']);
  });
  it('rejects bad files', () => {
    expect(() => migrateDoc({ version: 1 })).toThrow();
    expect(() => migrateDoc(null)).toThrow();
    expect(migrateDoc(JSON.parse(JSON.stringify(newProject()))).version).toBe(2);
  });
});

describe('history', () => {
  const mk = (n: number) => ({ ...newProject(), fps: n });
  const e = (a: number, b: number, key?: string, time = 0) => ({ label: '', before: mk(a), after: mk(b), patches: [], key, time });
  it('undoes and redoes, clearing redo on new edits', () => {
    const h = new History(3);
    h.push(e(1, 2));
    expect(h.undo()?.fps).toBe(1);
    expect(h.redo()?.fps).toBe(2);
    h.undo(); h.push(e(1, 3));
    expect(h.redo()).toBeNull();
  });
  it('is a ring buffer', () => {
    const h = new History(2);
    h.push(e(1, 2)); h.push(e(2, 3)); h.push(e(3, 4));
    expect(h.undoStack).toHaveLength(2);
  });
  it('merges slider drags', () => {
    const h = new History();
    h.push(e(1, 2, 'k', 0)); h.push(e(2, 3, 'k', 100)); h.push(e(3, 4, 'k', 2000));
    expect(h.undoStack).toHaveLength(2);
    expect(h.undoStack[0].after.fps).toBe(3);
  });
  it('replays patches in reverse on undo', () => {
    const h = new History(); const log: string[] = [];
    const p = (n: string) => ({ apply: (w: string) => log.push(n + w) });
    h.push({ ...e(1, 2), patches: [p('a'), p('b')] });
    h.undo(); h.redo();
    expect(log).toEqual(['bbefore', 'abefore', 'aafter', 'bafter']);
  });
});
