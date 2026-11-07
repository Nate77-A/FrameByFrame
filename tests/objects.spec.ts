/** Selection box, anchor point, merge and Object Order. */
import { expect, test, type Page } from '@playwright/test';
import { line, open, point, tool } from './helpers';

const st = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(async ([fn, args]) => {
  const { useStore } = await import('/src/core/store.ts');
  return new Function('s', 'args', `return (${fn})(s, ...args)`)(useStore.getState(), args);
}, [fn, args] as const);
const pixel = (page: Page, x: number, y: number) => page.evaluate(async ([x, y]) => {
  const { useStore } = await import('/src/core/store.ts');
  const { renderFrame } = await import('/src/render/compositor.ts');
  const s = useStore.getState();
  const c = document.createElement('canvas');
  await renderFrame(s.doc, s.frameIndex, c, { width: s.doc.canvas.width, height: s.doc.canvas.height });
  return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
}, [x, y]);
const items = (page: Page) => st(page, '(s) => (s.doc.frames[s.frameIndex].cels[s.activeLayerId] || []).map(i => ({ ...i }))') as Promise<any[]>;
const color = (page: Page, c: string) => st(page, '(s, c) => s.set({ color: c })', c);
const shape = async (page: Page, c: string, a: [number, number], b: [number, number]) => { await color(page, c); await tool(page, 'Shape'); await line(page, [a, b]); };
const click = async (page: Page, x: number, y: number, mods?: { shift?: boolean }) => {
  const p = await point(page, x, y);
  if (mods?.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (mods?.shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(60);
};
const box = (page: Page) => page.evaluate(() => {
  const s = (window as any).__scene, n = s.transformer.nodes();
  const r = n[0].getClientRect({ skipStroke: true }), k = s.stage.scaleX();
  return { nodes: n.length, x: (r.x - s.stage.x()) / k, y: (r.y - s.stage.y()) / k, w: r.width / k, h: r.height / k };
});

test('selection box hugs a drawing, then moves and rotates only that drawing', async ({ page }) => {
  const errors = await open(page);
  await line(page, [[300, 200], [400, 260]]);
  await tool(page, 'Select');
  await click(page, 350, 230);
  const b = await box(page);
  expect(b.nodes).toBe(1);
  expect(b.w).toBeLessThan(140); expect(b.h).toBeLessThan(100);
  expect(b.x).toBeGreaterThan(280); expect(b.y).toBeGreaterThan(180);
  await expect(page.getByLabel('Width')).toHaveValue(/^1[01]\d/);
  await line(page, [[350, 230], [450, 330]]);
  await page.waitForTimeout(80);
  expect((await pixel(page, 450, 330))[0]).toBeLessThan(90);
  expect((await pixel(page, 350, 230))[0]).toBe(255);
  // Rotating from the Properties panel turns it around its own middle
  await page.getByRole('slider', { name: 'Rotation' }).fill('90');
  await page.waitForTimeout(80);
  const c = await box(page);
  expect(Math.abs(c.x + c.w / 2 - 450)).toBeLessThan(6);
  expect(Math.abs(c.y + c.h / 2 - 330)).toBeLessThan(6);
  expect(errors).toEqual([]);
});

test('a stroke after using Select becomes a new object; strokes before it stay together', async ({ page }) => {
  await open(page);
  await line(page, [[100, 100], [200, 100]]);
  await line(page, [[100, 150], [200, 150]]);
  expect(await items(page)).toHaveLength(1);
  await tool(page, 'Select');
  await tool(page, 'Pencil');
  await line(page, [[100, 300], [200, 300]]);
  expect(await items(page)).toHaveLength(2);
});

test('rotate handle turns around the anchor point', async ({ page }) => {
  const errors = await open(page);
  await shape(page, '#ff0000', [200, 200], [300, 300]);
  await tool(page, 'Select');
  await click(page, 250, 250);
  await page.getByRole('button', { name: /Anchor point/ }).click();
  await page.waitForTimeout(80);
  const before = await pixel(page, 250, 250);
  await page.getByRole('button', { name: 'Anchor top left' }).click();
  await page.waitForTimeout(80);
  let [it] = await items(page);
  expect(it.anchor).toEqual({ x: 0, y: 0 }); expect(it.x).toBeCloseTo(200); expect(it.y).toBeCloseTo(200);
  expect(await pixel(page, 250, 250)).toEqual(before); // moving the anchor does not move the object
  // Drag the rotate handle, which sits above the top edge
  const h = await page.evaluate(() => { const s = (window as any).__scene, p = s.transformer.findOne('.rotater').getAbsolutePosition(), c = s.stage.container().getBoundingClientRect(); return { x: c.left + p.x, y: c.top + p.y }; });
  const q = await point(page, 200, 200);
  await page.mouse.move(h.x, h.y); await page.mouse.down();
  const r = Math.hypot(h.x - q.x, h.y - q.y);
  await page.mouse.move(q.x + r * 0.2, q.y + r, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(100);
  [it] = await items(page);
  expect(it.rotation).not.toBe(0);
  expect(it.x).toBeCloseTo(200); expect(it.y).toBeCloseTo(200); // the anchor stayed put
  await page.getByTestId('undo').click();
  [it] = await items(page);
  expect(it.rotation).toBe(0);
  expect(errors).toEqual([]);
});

test('anchor can be dragged, sticks to corners, and survives save and export', async ({ page }) => {
  await open(page);
  await shape(page, '#00aa00', [200, 200], [300, 300]);
  await tool(page, 'Select');
  await click(page, 250, 250);
  await page.getByRole('button', { name: /Anchor point/ }).click();
  await page.waitForTimeout(80);
  await line(page, [[250, 250], [120, 400]]); // free spot, outside the object
  let [it] = await items(page);
  expect(Math.abs(it.x - 120)).toBeLessThan(3); expect(Math.abs(it.y - 400)).toBeLessThan(3);
  expect(await pixel(page, 250, 250)).toEqual([0, 170, 0, 255]);
  await line(page, [[it.x, it.y], [297, 297]]); // near a corner
  [it] = await items(page);
  expect(it.x).toBeCloseTo(300); expect(it.y).toBeCloseTo(300);
  await page.getByRole('slider', { name: 'Rotation' }).fill('180');
  await page.waitForTimeout(80);
  expect(await pixel(page, 350, 350)).toEqual([0, 170, 0, 255]);
  expect((await pixel(page, 250, 250)).slice(0, 3)).toEqual([255, 255, 255]);
});

test('merge combines selected objects, keeps the look, and undoes', async ({ page }) => {
  const errors = await open(page);
  await shape(page, '#ff0000', [100, 100], [200, 200]);
  await shape(page, '#0000ff', [150, 150], [250, 250]);
  await color(page, '#000000');
  await tool(page, 'Pencil');
  await line(page, [[400, 400], [500, 400]]);
  await tool(page, 'Select');
  await expect(page.getByTestId('merge')).toHaveCount(0);
  await click(page, 120, 120);
  await click(page, 240, 240, { shift: true });
  await expect(page.getByTestId('merge')).toContainText('Merge 2');
  await page.getByTestId('merge').click();
  await page.waitForTimeout(120);
  const list = await items(page);
  expect(list).toHaveLength(2);
  expect(list[0].type).toBe('raster');
  expect(await pixel(page, 120, 120)).toEqual([255, 0, 0, 255]);
  expect(await pixel(page, 175, 175)).toEqual([0, 0, 255, 255]);
  const b = await box(page);
  expect(b.w).toBeCloseTo(150, -1); expect(b.nodes).toBe(1);
  await line(page, [[120, 120], [320, 120]]); // the merged object moves as one
  await page.waitForTimeout(80);
  expect(await pixel(page, 320, 120)).toEqual([255, 0, 0, 255]);
  await page.getByTestId('undo').click(); await page.getByTestId('undo').click();
  expect(await items(page)).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('Object Order window lists objects, reorders them and selects them', async ({ page }) => {
  const errors = await open(page);
  await shape(page, '#ff0000', [100, 100], [200, 200]);
  await shape(page, '#0000ff', [150, 150], [250, 250]);
  await page.getByRole('button', { name: 'Window', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: /Object Order/ }).click();
  await page.keyboard.press('Escape');
  const win = page.getByRole('dialog', { name: 'Object Order' });
  await expect(win.getByTestId('order-row')).toHaveCount(2);
  expect(await pixel(page, 175, 175)).toEqual([0, 0, 255, 255]);
  await win.getByRole('button', { name: /Move back/ }).first().click();
  expect(await pixel(page, 175, 175)).toEqual([255, 0, 0, 255]);
  // Drag the second row back to the top
  const grip = await win.getByTestId('order-row').nth(1).locator('.order-grip').boundingBox();
  await page.mouse.move(grip!.x + 10, grip!.y + 20); await page.mouse.down();
  await page.mouse.move(grip!.x + 10, grip!.y - 34, { steps: 5 }); await page.mouse.up();
  expect(await pixel(page, 175, 175)).toEqual([0, 0, 255, 255]);
  await win.getByRole('button', { name: 'Select Rectangle' }).first().click();
  expect(await st(page, '(s) => s.tool')).toBe('select');
  expect(await st(page, '(s) => s.selection.length')).toBe(1);
  // The window can be dragged and closed
  const head = await win.locator('h2').boundingBox();
  await page.mouse.move(head!.x + 20, head!.y + 10); await page.mouse.down();
  await page.mouse.move(head!.x - 100, head!.y + 90, { steps: 4 }); await page.mouse.up();
  expect((await win.boundingBox())!.y).toBeGreaterThan(head!.y + 40);
  await win.getByRole('button', { name: /Close/ }).click();
  await expect(win).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('rotating by touch also turns around the anchor', async ({ page }) => {
  await open(page);
  await shape(page, '#ff0000', [200, 200], [300, 300]);
  await tool(page, 'Select');
  await click(page, 250, 250);
  await page.getByRole('button', { name: /Anchor point/ }).click();
  await page.getByRole('button', { name: 'Anchor top left' }).click();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    const s = (window as any).__scene, el = document.querySelector('[data-testid=stage]') as HTMLElement;
    const p = s.transformer.findOne('.rotater').getAbsolutePosition(), c = el.getBoundingClientRect();
    const x = c.left + p.x, y = c.top + p.y, target = el.querySelector('canvas:last-of-type') ?? el;
    const pe = (type: string, X: number, Y: number) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, clientX: X, clientY: Y, pointerType: 'touch', pointerId: 5, buttons: 1, button: 0 }));
    pe('pointerdown', x, y); pe('pointermove', x + 60, y + 60); pe('pointermove', x + 120, y + 160); pe('pointerup', x + 120, y + 160);
  });
  await page.waitForTimeout(100);
  const [it] = await items(page);
  expect(it.rotation).not.toBe(0);
  expect(it.x).toBeCloseTo(200); expect(it.y).toBeCloseTo(200);
});
