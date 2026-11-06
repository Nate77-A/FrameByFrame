declare module 'gifenc' {
  export function GIFEncoder(): { writeFrame(i: Uint8Array, w: number, h: number, o: Record<string, unknown>): void; finish(): void; bytes(): Uint8Array };
  export function quantize(d: Uint8ClampedArray, n: number, o?: Record<string, unknown>): number[][];
  export function applyPalette(d: Uint8ClampedArray, p: number[][], f?: string): Uint8Array;
}
