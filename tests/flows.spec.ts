/** Stage 8 end-to-end flows, including real pen and touch input. */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BufferSource, Input, ALL_FORMATS } from 'mediabunny';
import { line, open, point, tool } from './helpers';

const st = (page: Page, fn: string, ...args: unknown[]) => page.evaluate(async ([fn, args]) => {
  const { useStore } = await import('/src/core/store.ts');
  return new Function('s', 'args', `return (${fn})(s, ...args)`)(useStore.getState(), args);
}, [fn, args] as const);

function wav(seconds = 1): Buffer {
  const rate = 44100, n = rate * seconds, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2764) * 12000), 44 + i * 2);
  return b;
}
const menu = async (page: Page, top: string, item: RegExp) => { await page.getByRole('button', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item }).click(); };
async function importWav(page: Page) {
  const path = join(tmpdir(), `beep-${Date.now()}.wav`);
  writeFileSync(path, wav());
  const chooser = page.waitForEvent('filechooser');
  await menu(page, 'File', /Import Audio/);
  await (await chooser).setFiles(path);
  await page.waitForFunction(async () => { const { useStore } = await import('/src/core/store.ts'); return useStore.getState().doc.audioClips.length > 0; });
}
const pen = (page: Page, pts: { x: number; y: number; pressure?: number; type?: string; id?: number }[], kinds?: string[]) => page.evaluate(([pts, kinds]) => {
  const el = document.querySelector('[data-testid=stage]')!;
  (pts as any[]).forEach((p, i) => {
    const type = kinds ? (kinds as string[])[i] : i === 0 ? 'pointerdown' : i === (pts as any[]).length - 1 ? 'pointerup' : 'pointermove';
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: p.x, clientY: p.y, pressure: p.pressure ?? 0.5, pointerType: p.type ?? 'pen', pointerId: p.id ?? 7, button: 0, buttons: 1 }));
  });
}, [pts, kinds] as const);
const count = (page: Page) => st(page, `(s) => (s.doc.frames[s.frameIndex].cels[s.activeLayerId] || []).length`) as Promise<number>;

test('flow 1: new, draw, add, duplicate, play, export GIF', async ({ page }) => {
  const errors = await open(page);
  await menu(page, 'File', /^New/);
  await line(page, [[100, 100], [300, 200]]);
  await page.getByTestId('add-frame').click();
  await line(page, [[100, 300], [300, 200]]);
  await page.getByTestId('dup-frame').click();
  await st(page, '(s) => s.setDuration(0.5)');
  await page.getByTestId('play').click();
  await page.waitForTimeout(300);
  await page.getByTestId('play').click();
  await menu(page, 'File', /Animated GIF/);
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-export').click();
  const d = readFileSync(await (await dl).path());
  expect(d.subarray(0, 6).toString()).toBe('GIF89a');
  expect(d.length).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('flow 2: import audio, trim, play, and export an MP4 with sound', async ({ page }) => {
  const errors = await open(page);
  await importWav(page);
  await expect(page.getByRole('slider', { name: 'Trim out' })).toBeVisible();
  await page.getByRole('slider', { name: 'Trim out' }).fill('0.5');
  expect(await st(page, '(s) => s.doc.audioClips[0].trimEnd')).toBe(0.5);
  await page.getByTestId('play').click();
  await page.waitForTimeout(250);
  await page.getByTestId('play').click();
  await st(page, '(s) => s.setDuration(1)');
  await line(page, [[100, 100], [300, 300]]);
  await menu(page, 'File', /MP4 Video/);
  const dl = page.waitForEvent('download');
  await page.getByTestId('do-export').click();
  const file = await dl;
  const bytes = readFileSync(await file.path());
  const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
  const v = await input.getPrimaryVideoTrack();
  const a = await input.getPrimaryAudioTrack();
  const packets = (await v!.computePacketStats()).packetCount;
  console.log(`export: ${file.suggestedFilename()} ${bytes.length} bytes, video ${v?.codec} ${packets} frames, audio ${a?.codec ?? 'none'}`);
  expect(packets).toBe(12);
  expect(v!.displayWidth).toBe(800);
  expect(await input.computeDuration()).toBeCloseTo(1, 1);
  expect(a, 'exported video should carry the audio track').not.toBeNull();
  expect(errors).toEqual([]);
});

test('flow 3: iPad landscape keeps the desktop layout, all tools reachable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await open(page);
  await expect(page.getByLabel('Properties')).toBeVisible();
  await expect(page.getByTestId('timeline')).toBeVisible();
  for (const name of ['Select', 'Pencil', 'Paintbrush', 'Eraser', 'Shape', 'Text', 'Paint Bucket', 'Eyedropper', 'Hand', 'Zoom', 'Color']) {
    const b = await page.getByRole('button', { name, exact: true }).boundingBox();
    expect(b!.width).toBeGreaterThanOrEqual(44);
    expect(b!.y + b!.height, `${name} should be on screen`).toBeLessThanOrEqual(768 - 240 - 24);
  }
});

test('flow 4: iPad portrait uses a bottom bar, sheet and timeline overlay', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await open(page);
  await expect(page.getByTestId('timeline')).toHaveCount(0);
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline')).toBeVisible();
  await page.getByTestId('tab-timeline').click();
  await expect(page.getByTestId('timeline')).toHaveCount(0);
  await page.getByRole('button', { name: 'Paintbrush' }).click();
  await expect(page.getByRole('heading', { name: /Paintbrush/ })).toBeVisible();
  const box = await page.getByLabel('Properties').boundingBox();
  expect(box!.y).toBeGreaterThan(300);
});

test('pen: pressure changes width, and palm touches do not draw', async ({ page }) => {
  await open(page);
  await st(page, `(s) => s.setSetting('pencil', { size: 40, pressure: 1, smoothing: 0 })`);
  const a = await point(page, 100, 100), b = await point(page, 300, 100), c = await point(page, 100, 300), d = await point(page, 300, 300);
  const steps = (p: typeof a, q: typeof a, pressure: number) => Array.from({ length: 12 }, (_, i) => ({ x: p.x + ((q.x - p.x) * i) / 11, y: p.y, pressure }));
  await pen(page, steps(a, b, 0.1));
  await pen(page, steps(c, d, 1));
  const thick = await page.evaluate(async () => {
    const { useStore } = await import('/src/core/store.ts');
    const { renderFrame } = await import('/src/render/compositor.ts');
    const s = useStore.getState();
    const cv = document.createElement('canvas');
    await renderFrame(s.doc, s.frameIndex, cv, { width: 800, height: 600 });
    const x = cv.getContext('2d')!;
    const span = (X: number, Y0: number) => { let n = 0; for (let y = Y0 - 40; y < Y0 + 40; y++) if (x.getImageData(X, y, 1, 1).data[0] < 128) n++; return n; };
    return [span(200, 100), span(200, 300)];
  });
  expect(thick[1]).toBeGreaterThan(thick[0] * 3);
  const before = await st(page, '(s) => s.doc') ;
  void before;
  const rev = await st(page, '(s) => s.revision');
  await pen(page, [{ x: a.x, y: a.y + 300, type: 'touch', id: 9 }, { x: b.x, y: a.y + 300, type: 'touch', id: 9 }, { x: b.x, y: a.y + 300, type: 'touch', id: 9 }]);
  expect(await st(page, '(s) => s.revision')).toBe(rev);
});

test('touch: finger draws until a pen appears; pinch zooms and cancels the stroke', async ({ page }) => {
  await open(page);
  const a = await point(page, 100, 100), b = await point(page, 300, 100);
  await pen(page, [{ ...a, type: 'touch', id: 1 }, { ...b, type: 'touch', id: 1 }, { ...b, type: 'touch', id: 1 }]);
  expect(await count(page)).toBe(1);
  const rev = await st(page, '(s) => s.revision');
  const z0 = await st(page, '(s) => s.zoom') as number;
  await pen(page, [
    { x: 400, y: 300, type: 'touch', id: 1 }, { x: 500, y: 300, type: 'touch', id: 2 },
    { x: 340, y: 300, type: 'touch', id: 1 }, { x: 560, y: 300, type: 'touch', id: 2 },
    { x: 340, y: 300, type: 'touch', id: 1 }, { x: 560, y: 300, type: 'touch', id: 2 },
  ], ['pointerdown', 'pointerdown', 'pointermove', 'pointermove', 'pointerup', 'pointerup']);
  expect(await st(page, '(s) => s.zoom')).toBeGreaterThan(z0 * 1.5);
  expect(await st(page, '(s) => s.revision')).toBe(rev);
});

test('tapping Space plays, holding Space and dragging pans', async ({ page }) => {
  await open(page);
  const p = await point(page, 200, 200);
  const x0 = await st(page, '(s) => s.panX') as number;
  await page.keyboard.down('Space');
  await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x + 60, p.y, { steps: 3 }); await page.mouse.up();
  await page.keyboard.up('Space');
  expect(await st(page, '(s) => s.panX')).toBeGreaterThan(x0 + 40);
  expect(await st(page, '(s) => s.playing')).toBe(false);
  expect(await count(page)).toBe(0);
});

test('auto-save offers the work back after a reload', async ({ page }) => {
  await open(page);
  await line(page, [[100, 100], [300, 100]]);
  await page.evaluate(async () => { const { autosaveNow } = await import('/src/core/autosave.ts'); await autosaveNow(); });
  page.on('dialog', (d) => d.accept());
  await page.reload();
  await expect(page.getByRole('dialog')).toContainText('Bring it back');
  await page.getByTestId('confirm-yes').click();
  await page.waitForTimeout(150);
  expect(await count(page)).toBe(1);
});

test('memory: cold bitmaps are compressed and still render correctly', async ({ page }) => {
  await open(page);
  const out = await page.evaluate(async () => {
    const { bitmaps, ctx2d } = await import('/src/core/bitmaps.ts');
    const { renderFrame } = await import('/src/render/compositor.ts');
    const { makeRaster } = await import('/src/tools/brush.ts');
    const { newProject } = await import('/src/core/doc.ts');
    const { useStore } = await import('/src/core/store.ts');
    const W = 1920, H = 1080;
    const doc = newProject(W, H, 12, 5);
    doc.layers.forEach((l) => { l.pinned = false; });
    bitmaps.budget = 64 * 1024 * 1024;
    doc.frames.forEach((f, i) => doc.layers.forEach((l) => {
      const id = bitmaps.create(W, H);
      const c = ctx2d(bitmaps.get(id)!); c.fillStyle = '#ff0000'; c.fillRect(i * 10, 0, 40, 40);
      f.cels[l.id] = [makeRaster(id, W, H)];
    }));
    await bitmaps.trim();
    const after = bitmaps.stats();
    useStore.getState().replaceDoc(doc);
    const cv = document.createElement('canvas');
    await renderFrame(doc, 7, cv, { width: W, height: H });
    const px = [...cv.getContext('2d')!.getImageData(75, 10, 1, 1).data];
    return { after, px };
  });
  expect(out.after.hotBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(out.after.total).toBe(120);
  expect(out.px).toEqual([255, 0, 0, 255]);
});

test('every control has a tooltip and an accessible name', async ({ page }) => {
  await open(page);
  const scan = () => page.evaluate(() => [...document.querySelectorAll('button,input,select,textarea')].filter((e) => {
    const el = e as HTMLElement;
    const named = el.getAttribute('aria-label') || el.textContent?.trim();
    const tipped = el.closest('[data-tooltip]');
    return !(named && tipped);
  }).map((e) => e.outerHTML.slice(0, 90)));
  const seen: string[] = [...await scan()];
  for (const t of ['Paintbrush', 'Eraser', 'Shape', 'Text', 'Paint Bucket', 'Eyedropper', 'Hand', 'Zoom', 'Color']) { await page.getByRole('button', { name: t, exact: true }).click(); seen.push(...await scan()); }
  await page.getByRole('button', { name: 'File', exact: true }).click(); seen.push(...await scan()); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Edit', exact: true }).click(); seen.push(...await scan());
  expect([...new Set(seen)]).toEqual([]);
});
