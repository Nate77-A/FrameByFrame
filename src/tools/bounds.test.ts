import { expect, it } from 'vitest';
import { gridLines, itemBounds, rectsOverlap, snapAxis, unionBox } from './bounds';

const it0 = { id: '', x: 50, y: 50, width: 100, height: 20, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1 };
it('bounds account for rotation and flip', () => {
  expect(itemBounds(it0)).toEqual({ x: 0, y: 40, width: 100, height: 20 });
  const r = itemBounds({ ...it0, rotation: 90, scaleX: -1 });
  expect(r.width).toBeCloseTo(20); expect(r.height).toBeCloseTo(100);
});
it('overlap and union', () => {
  expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
  expect(rectsOverlap({ x: 0, y: 0, width: 11, height: 10 }, { x: 10, y: 0, width: 5, height: 5 })).toBe(true);
  expect(unionBox([{ x: 0, y: 0, width: 1, height: 1 }, { x: 5, y: 5, width: 1, height: 1 }])).toEqual({ x: 0, y: 0, width: 6, height: 6 });
});
it('snaps edges and centres only within range', () => {
  expect(snapAxis(98, 10, [100], 6)).toBe(2);
  expect(snapAxis(96, 10, [100], 6)).toBe(-1); // centre 101 is closest
  expect(snapAxis(50, 10, [100], 6)).toBe(0);
  expect(gridLines(33, 10, 32)).toContain(32);
});
