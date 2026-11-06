import { expect, test, type Page } from '@playwright/test';
import { line, open, point, tool } from './helpers';
import { readFileSync } from 'node:fs';

const st = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(async ([fn, args]) => {
  const { useStore } = await import('/src/core/store.ts');
  // eslint-disable-next-line no-new-func
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
const setColor = (page: Page, c: string) => st(page, '(s, c) => s.set({ color: c })', c);
const items = (page: Page) => st(page, `(s) => { const l = s.activeLayerId; const f = s.doc.frames[s.frameIndex]; return (f.cels[l] || []).map(i => ({...i})) }`) as Promise<any[]>;
const drawn = async (page: Page, x: number, y: number) => { await tool(page, 'Shape'); await line(page, [[x, y], [x + 100, y + 100]]); };

test('stage 3: select, move, resize via handle, rotate with properties', async ({ page }) => {
  const errors = await open(page);
  await setColor(page, '#ff0000');
  await drawn(page, 100, 100);
  await tool(page, 'Select');
  await line(page, [[150, 150], [350, 250]]);
  let [it] = await items(page);
  expect(it.x).toBeCloseTo(350, -1); expect(it.y).toBeCloseTo(250, -1);
  expect(await pixel(page, 350, 250)).toEqual([255, 0, 0, 255]);
  const rot = page.getByRole('slider', { name: 'Rotation' });
  await rot.fill('45');
  [it] = await items(page);
  expect(it.rotation).toBe(45);
  await page.getByRole('slider', { name: 'Rotation' }).fill('0');
  await page.waitForTimeout(100); // the handles redraw on the next animation frame
  // bottom-right transform handle
  await line(page, [[400, 300], [450, 350]]);
  [it] = await items(page);
  expect(it.scaleX).toBeGreaterThan(1.3);
  expect(errors).toEqual([]);
});

test('stage 3: bucket stays in an outline; eyedropper picks; text; zoom; pan', async ({ page }) => {
  const errors = await open(page);
  await setColor(page, '#000000');
  await line(page, [[100, 100], [300, 100], [300, 300], [100, 300], [100, 100]]);
  await tool(page, 'Paint Bucket');
  await setColor(page, '#00aa00');
  const p = await point(page, 200, 200);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(150);
  expect(await pixel(page, 200, 200)).toEqual([0, 170, 0, 255]);
  expect((await pixel(page, 400, 400)).slice(0, 3)).toEqual([255, 255, 255]);
  await setColor(page, '#123456');
  await tool(page, 'Eyedropper');
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
  expect(await st(page, '(s) => s.color')).toBe('#00aa00');

  await tool(page, 'Text');
  const q = await point(page, 500, 200);
  await page.mouse.click(q.x, q.y);
  const ed = page.getByLabel('Type your text');
  await ed.fill('Wow');
  await ed.press('Escape');
  const list = await items(page);
  expect(list.some((i) => i.type === 'text' && i.text === 'Wow')).toBe(true);

  const z0 = await st(page, '(s) => s.zoom') as number;
  await page.mouse.move(p.x, p.y); await page.mouse.wheel(0, -300);
  await page.waitForTimeout(50);
  expect(await st(page, '(s) => s.zoom')).toBeGreaterThan(z0);
  await tool(page, 'Hand');
  const px0 = await st(page, '(s) => s.panX') as number;
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 80, p.y, { steps: 4 }); await page.mouse.up();
  expect(await st(page, '(s) => s.panX')).toBeGreaterThan(px0 + 50);
  expect(errors).toEqual([]);
});

test('stage 4: frames, pin, playback, reorder, duration, Space', async ({ page }) => {
  const errors = await open(page);
  await line(page, [[100, 100], [200, 100]]);
  await page.getByTestId('add-frame').click();
  expect(await st(page, '(s) => s.frameIndex')).toBe(1);
  expect((await pixel(page, 150, 100))[0]).toBe(255);
  await st(page, `(s) => s.set({ onion: {...s.onion, on: true} })`);
  await page.waitForTimeout(150);
  await line(page, [[100, 200], [200, 200]]);
  await page.getByTestId('dup-frame').click();
  expect((await pixel(page, 150, 200))[0]).toBeLessThan(60);
  // A duplicate is independent
  await tool(page, 'Eraser');
  await line(page, [[100, 200], [200, 200]]);
  expect((await pixel(page, 150, 200))[0]).toBe(255);
  await st(page, '(s) => s.setFrame(1)');
  expect((await pixel(page, 150, 200))[0]).toBeLessThan(60);

  // Pinned background shows on every frame
  await st(page, '(s) => s.set({ activeLayerId: s.doc.layers[0].id, tool: "pencil" })');
  await line(page, [[500, 400], [600, 400]]);
  for (const f of [0, 1, 30]) { await st(page, '(s, f) => s.setFrame(f)', f); expect((await pixel(page, 550, 400))[0]).toBeLessThan(60); }

  // Tap Space plays and advances
  await st(page, '(s) => s.setFrame(0)');
  await page.keyboard.press('Space');
  await page.waitForTimeout(600);
  const f = await st(page, '(s) => s.frameIndex') as number;
  expect(f).toBeGreaterThan(2);
  await page.keyboard.press('Space');
  expect(await st(page, '(s) => s.playing')).toBe(false);

  await st(page, '(s) => s.moveFrame(0, 2)');
  await st(page, '(s) => s.setDuration(1)');
  expect(await st(page, '(s) => s.doc.frames.length')).toBe(12);
  await st(page, '(s) => s.setFps(24)');
  expect(await st(page, '(s) => s.doc.frames.length')).toBe(12);
  await page.getByRole('button', { name: /Duration: 0.5 s/ }).click();
  expect(errors).toEqual([]);
});

test('stage 4: drag a frame on the timeline, and shortening warns', async ({ page }) => {
  await open(page);
  await line(page, [[100, 100], [200, 100]]);
  const ids = await st(page, '(s) => s.doc.frames.slice(0,4).map(f => f.id)') as string[];
  const grid = await page.getByTestId('timeline-grid').boundingBox();
  await page.mouse.move(grid!.x + 24, grid!.y + 60);
  await page.mouse.down();
  await page.mouse.move(grid!.x + 24 + 120, grid!.y + 60, { steps: 6 });
  await page.mouse.up();
  const after = await st(page, '(s) => s.doc.frames.slice(0,4).map(f => f.id)') as string[];
  expect(after[2]).toBe(ids[0]); expect(after[0]).toBe(ids[1]);
  await st(page, '(s) => s.setDuration(0.1)');
  await expect(page.getByRole('dialog')).toContainText('removes');
  await page.getByTestId('confirm-yes').click();
  expect(await st(page, '(s) => s.doc.frames.length')).toBe(2);
});

test('stage 5: sound effects, clip editing, audio import and playback', async ({ page }) => {
  const errors = await open(page);
  await page.getByRole('button', { name: /Sound effects/ }).click();
  await expect(page.locator('[data-testid^=sfx-]')).toHaveCount(10);
  await page.getByLabel('Search sounds').fill('boom');
  await expect(page.locator('[data-testid^=sfx-]')).toHaveCount(1);
  await page.getByTestId('sfx-explosion').getByRole('button', { name: /playhead/ }).click();
  await expect(page.locator('.toast')).toContainText('Explosion added');
  await page.keyboard.press('Escape');
  const clip = await st(page, '(s) => s.doc.audioClips[0]') as any;
  expect(clip.name).toBe('Explosion');
  expect(clip.trimEnd).toBeCloseTo(1.5, 1);
  await expect(page.getByRole('slider', { name: 'Fade out' })).toBeVisible();
  await page.getByRole('slider', { name: 'Fade out' }).fill('0.5');
  expect((await st(page, '(s) => s.doc.audioClips[0].fadeOut') as number)).toBe(0.5);
  // A second overlapping clip takes the next lane
  await st(page, `async (s) => { const {addClipFromBlob} = await import('/src/ui/audioImport.ts'); const {SFX, sfxBlob} = await import('/src/audio/sfx.ts'); await addClipFromBlob(await sfxBlob(SFX[0]), 'x'); }`);
  expect(await st(page, '(s) => s.doc.audioClips[1].track')).toBe(1);
  // Drag the clip on its lane
  const grid = await page.getByTestId('timeline-grid').boundingBox();
  const y = await st(page, `(s) => 24 + s.doc.layers.length * 46 + 23`) as number;
  await page.mouse.move(grid!.x + 40, grid!.y + y); await page.mouse.down();
  await page.mouse.move(grid!.x + 40 + 96, grid!.y + y, { steps: 5 }); await page.mouse.up();
  const start = await st(page, '(s) => s.doc.audioClips[0].startTime') as number;
  expect(start).toBeCloseTo(2 / 12, 3);
  // Saved with the project
  const size = await page.evaluate(async () => {
    const { packProject, unpackProject } = await import('/src/core/projectFile.ts');
    const { getAudio } = await import('/src/audio/assets.ts');
    const { useStore } = await import('/src/core/store.ts');
    const b = await packProject(useStore.getState().doc);
    const doc = await unpackProject(b);
    return getAudio(doc.audioClips[0].asset)?.buffer.length ?? 0;
  });
  expect(size).toBeGreaterThan(40000);
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  expect(errors).toEqual([]);
});

test('stage 6: image import, filters, flip, order', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 100;
    const x = c.getContext('2d')!; x.fillStyle = '#ff0000'; x.fillRect(0, 0, 100, 100); x.fillStyle = '#0000ff'; x.fillRect(100, 0, 100, 100);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!)));
    const { importImage } = await import('/src/tools/actions.ts');
    await importImage(blob);
  });
  await page.waitForTimeout(100);
  expect(await pixel(page, 350, 300)).toEqual([255, 0, 0, 255]);
  await page.getByRole('button', { name: /Flip side/ }).click();
  expect(await pixel(page, 350, 300)).toEqual([0, 0, 255, 255]);
  await page.getByRole('button', { name: 'Gray', exact: true }).click();
  await page.waitForTimeout(100);
  const g = await pixel(page, 350, 300);
  expect(g[0]).toBe(g[2]);
  await page.getByRole('button', { name: 'Invert', exact: true }).click();
  await page.waitForTimeout(100);
  expect((await pixel(page, 350, 300))[0]).toBeGreaterThan(g[0]);
  expect(errors).toEqual([]);
});

test('stage 7: exports download correct files', async ({ page }) => {
  const errors = await open(page);
  await st(page, '(s) => s.setDuration(0.5)');
  await line(page, [[100, 100], [300, 300]]);
  const run = async (name: RegExp) => {
    await page.getByRole('button', { name: 'File' }).click();
    await page.getByRole('menuitem', { name }).click();
    const dl = page.waitForEvent('download');
    await page.getByTestId('do-export').click();
    const d = await dl;
    await expect(page.locator('.toast').last()).toBeVisible();
    return { name: d.suggestedFilename(), data: readFileSync(await d.path()) };
  };
  const png = await run(/PNG Sequence/);
  expect(png.name).toBe('my-animation.zip');
  expect(png.data.subarray(0, 2).toString()).toBe('PK');
  const gif = await run(/Animated GIF/);
  expect(gif.name).toBe('my-animation.gif');
  expect(gif.data.subarray(0, 6).toString()).toBe('GIF89a');
  const vid = await run(/MP4 Video/);
  expect(/\.(mp4|webm)$/.test(vid.name)).toBe(true);
  expect(vid.data.length).toBeGreaterThan(500);
  console.log('video', vid.name, vid.data.length);
  expect(errors).toEqual([]);
});
