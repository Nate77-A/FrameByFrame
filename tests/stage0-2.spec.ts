import { expect, test } from '@playwright/test';
import { line, open, tool } from './helpers';

/** Read the composited colour of an artboard pixel through the same compositor exports use. */
const pixel = (page: any, x: number, y: number) => page.evaluate(async ([x, y]: number[]) => {
  const { useStore } = await import('/src/core/store.ts');
  const { renderFrame } = await import('/src/render/compositor.ts');
  const s = useStore.getState();
  const c = document.createElement('canvas');
  await renderFrame(s.doc, s.frameIndex, c, { width: s.doc.canvas.width, height: s.doc.canvas.height });
  return [...c.getContext('2d')!.getImageData(x, y, 1, 1).data];
}, [x, y]);

test('stage 0: shell renders with white paper and a tooltip', async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByTestId('timeline')).toBeVisible();
  await expect(await pixel(page, 400, 300)).toEqual([255, 255, 255, 255]);
  await page.getByRole('button', { name: 'Eraser' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Wipes away pixels');
  expect(errors).toEqual([]);
});

test('stage 2: pencil paints, undo and redo restore pixels', async ({ page }) => {
  const errors = await open(page);
  await line(page, [[100, 100], [300, 100]]);
  expect((await pixel(page, 200, 100))[0]).toBeLessThan(60);
  await page.getByTestId('undo').click();
  expect((await pixel(page, 200, 100))[0]).toBe(255);
  await page.getByTestId('redo').click();
  expect((await pixel(page, 200, 100))[0]).toBeLessThan(60);
  expect(errors).toEqual([]);
});

test('stage 2: a second stroke undoes alone, using its pixel patch', async ({ page }) => {
  await open(page);
  await line(page, [[100, 100], [300, 100]]);
  await line(page, [[100, 200], [300, 200]]);
  await page.getByTestId('undo').click();
  expect((await pixel(page, 200, 200))[0]).toBe(255);
  expect((await pixel(page, 200, 100))[0]).toBeLessThan(60);
});

test('stage 2: every brush type draws, and eraser wipes', async ({ page }) => {
  const errors = await open(page);
  await tool(page, 'Paintbrush');
  let y = 40;
  for (const t of ['Round', 'Flat', 'Scatter', 'Texture', 'Watercolor', 'Ink Bleed']) {
    await page.getByRole('button', { name: t, exact: true }).click();
    await line(page, [[50, y], [350, y]]);
    y += 50;
  }
  expect((await pixel(page, 200, 40))[0]).toBeLessThan(120);
  await tool(page, 'Eraser');
  await line(page, [[100, 40], [300, 40]]);
  expect((await pixel(page, 200, 40))[0]).toBe(255);
  expect(errors).toEqual([]);
});

test('stage 2: a stroke over a shape lands on top; eraser cuts the shape', async ({ page }) => {
  await open(page);
  await tool(page, 'Shape');
  await page.evaluate(async () => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().set({ color: '#ff0000' }); });
  await line(page, [[100, 100], [300, 300]]);
  expect(await pixel(page, 200, 200)).toEqual([255, 0, 0, 255]);
  await tool(page, 'Pencil');
  await page.evaluate(async () => { const { useStore } = await import('/src/core/store.ts'); useStore.getState().set({ color: '#0000ff' }); });
  await line(page, [[120, 200], [280, 200]]);
  const blue = await pixel(page, 200, 200);
  expect(blue[2]).toBeGreaterThan(200); expect(blue[0]).toBeLessThan(60);
  await tool(page, 'Eraser');
  await line(page, [[150, 150], [250, 150]]);
  expect((await pixel(page, 200, 150)).slice(0, 3)).toEqual([255, 255, 255]);
  await page.getByTestId('undo').click();
  expect(await pixel(page, 200, 150)).toEqual([255, 0, 0, 255]);
});

test('stage 1+2: drawing survives a .kanvaso save and reopen', async ({ page }) => {
  await open(page);
  await line(page, [[100, 100], [300, 100]]);
  const bytes = await page.evaluate(async () => {
    const { packProject } = await import('/src/core/projectFile.ts');
    const { useStore } = await import('/src/core/store.ts');
    const b = await packProject(useStore.getState().doc);
    return [...new Uint8Array(await b.arrayBuffer())];
  });
  await page.evaluate(async (b) => {
    const { unpackProject } = await import('/src/core/projectFile.ts');
    const { newProject } = await import('/src/core/doc.ts');
    const { useStore } = await import('/src/core/store.ts');
    useStore.getState().replaceDoc(newProject());
    const doc = await unpackProject(new Blob([new Uint8Array(b)]));
    useStore.getState().replaceDoc(doc);
  }, bytes);
  expect((await pixel(page, 200, 100))[0]).toBeLessThan(60);
});

test('stage 1: menus, export modal and window toggles', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'File' }).click();
  await page.getByRole('menuitem', { name: /Export MP4/ }).click();
  await expect(page.getByRole('dialog')).toContainText('Quality');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Window' }).click();
  await page.getByRole('menuitemcheckbox', { name: /Status Bar/ }).click();
  await expect(page.locator('.status')).toHaveCount(0);
});
