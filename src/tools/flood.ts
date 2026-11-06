/** Scanline flood fill over RGBA pixels. Pure, so it is unit-tested without a canvas. */
export interface FloodResult { mask: Uint8Array; minX: number; minY: number; maxX: number; maxY: number; count: number }

export function floodMask(data: Uint8ClampedArray, w: number, h: number, sx: number, sy: number, tolerance: number, contiguous = true): FloodResult {
  const mask = new Uint8Array(w * h);
  const res: FloodResult = { mask, minX: w, minY: h, maxX: -1, maxY: -1, count: 0 };
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return res;
  const o = (sy * w + sx) * 4;
  const r0 = data[o], g0 = data[o + 1], b0 = data[o + 2], a0 = data[o + 3];
  const tol = Math.round(tolerance * 255);
  const match = (i: number) => {
    const p = i * 4;
    const a = data[p + 3];
    // Fully transparent pixels have meaningless colour, so compare alpha only.
    if (a0 === 0 && a === 0) return true;
    return Math.abs(a - a0) <= tol && Math.abs(data[p] - r0) <= tol && Math.abs(data[p + 1] - g0) <= tol && Math.abs(data[p + 2] - b0) <= tol;
  };
  const mark = (x: number, y: number) => {
    mask[y * w + x] = 1; res.count++;
    if (x < res.minX) res.minX = x; if (x > res.maxX) res.maxX = x;
    if (y < res.minY) res.minY = y; if (y > res.maxY) res.maxY = y;
  };
  if (!contiguous) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (match(y * w + x)) mark(x, y);
    return res;
  }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (mask[y * w + x] || !match(y * w + x)) continue;
    let l = x, r = x;
    while (l > 0 && !mask[y * w + l - 1] && match(y * w + l - 1)) l--;
    while (r < w - 1 && !mask[y * w + r + 1] && match(y * w + r + 1)) r++;
    let up = false, down = false;
    for (let i = l; i <= r; i++) {
      mark(i, y);
      if (y > 0) {
        const m = !mask[(y - 1) * w + i] && match((y - 1) * w + i);
        if (m && !up) stack.push(i, y - 1);
        up = m;
      }
      if (y < h - 1) {
        const m = !mask[(y + 1) * w + i] && match((y + 1) * w + i);
        if (m && !down) stack.push(i, y + 1);
        down = m;
      }
    }
  }
  return res;
}

/** Grow the mask by one pixel so fills tuck under anti-aliased line edges. */
export function dilate(res: FloodResult, w: number, h: number): void {
  const src = res.mask.slice();
  for (let y = Math.max(0, res.minY - 1); y <= Math.min(h - 1, res.maxY + 1); y++) {
    for (let x = Math.max(0, res.minX - 1); x <= Math.min(w - 1, res.maxX + 1); x++) {
      if (src[y * w + x]) continue;
      if ((x > 0 && src[y * w + x - 1]) || (x < w - 1 && src[y * w + x + 1]) || (y > 0 && src[(y - 1) * w + x]) || (y < h - 1 && src[(y + 1) * w + x]))
        res.mask[y * w + x] = 1;
    }
  }
  res.minX = Math.max(0, res.minX - 1); res.minY = Math.max(0, res.minY - 1);
  res.maxX = Math.min(w - 1, res.maxX + 1); res.maxY = Math.min(h - 1, res.maxY + 1);
}
