import { expect, type Page } from '@playwright/test';

export async function open(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  await expect(page.getByTestId('stage').locator('canvas').first()).toBeVisible();
  await page.waitForFunction(() => (window as never as { __scene?: unknown }).__scene);
  return errors;
}
/** Map artboard coordinates to page coordinates. */
export async function point(page: Page, x: number, y: number) {
  return page.evaluate(([x, y]) => {
    const scene = (window as any).__scene;
    const c = scene.stage.container().getBoundingClientRect();
    return { x: c.left + scene.stage.x() + x * scene.stage.scaleX(), y: c.top + scene.stage.y() + y * scene.stage.scaleY() };
  }, [x, y]);
}
export async function line(page: Page, pts: [number, number][]) {
  const a = await point(page, ...pts[0]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  for (const p of pts.slice(1)) { const q = await point(page, ...p); await page.mouse.move(q.x, q.y, { steps: 8 }); }
  await page.mouse.up();
}
export const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true }).click();
