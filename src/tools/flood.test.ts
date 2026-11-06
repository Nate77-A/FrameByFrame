import { describe, expect, it } from 'vitest';
import { dilate, floodMask } from './flood';

const img = (w: number, h: number, wall: (x: number, y: number) => boolean) => {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (wall(x, y)) { d[(y * w + x) * 4 + 3] = 255; }
  return d;
};
describe('floodMask', () => {
  it('stays inside a closed outline', () => {
    const d = img(20, 20, (x, y) => x === 5 || x === 15 || y === 5 || y === 15);
    const r = floodMask(d, 20, 20, 10, 10, 0);
    expect(r.count).toBe(9 * 9);
    expect([r.minX, r.maxX, r.minY, r.maxY]).toEqual([6, 14, 6, 14]);
  });
  it('leaks through a gap, and honours tolerance', () => {
    const d = img(20, 20, (x, y) => (x === 5 || x === 15 || y === 5 || y === 15) && !(x === 5 && y === 10));
    expect(floodMask(d, 20, 20, 10, 10, 0).count).toBe(81 + 1 + 45);
    const g = new Uint8ClampedArray([100, 0, 0, 255, 110, 0, 0, 255, 200, 0, 0, 255]);
    expect(floodMask(g, 3, 1, 0, 0, 0.02).count).toBe(1);
    expect(floodMask(g, 3, 1, 0, 0, 0.05).count).toBe(2);
  });
  it('fills all matching pixels when not contiguous', () => {
    const d = img(10, 1, (x) => x % 2 === 0);
    expect(floodMask(d, 10, 1, 0, 0, 0, false).count).toBe(5);
    expect(floodMask(d, 10, 1, 0, 0, 0, true).count).toBe(1);
  });
  it('ignores out-of-bounds clicks and grows by a pixel', () => {
    const d = img(5, 5, () => false);
    expect(floodMask(d, 5, 5, -1, 0, 0).count).toBe(0);
    const a = img(5, 5, (x, y) => !(x === 2 && y === 2));
    const r = floodMask(a, 5, 5, 2, 2, 0);
    dilate(r, 5, 5);
    expect(r.mask.reduce((n, v) => n + v, 0)).toBe(5);
  });
});
