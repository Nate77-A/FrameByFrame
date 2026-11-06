/** PNG sequence, MP4 and GIF export. All frames come from the shared compositor (spec §4.6.1). */
import type { ProjectDoc } from '../core/types';
import { downloadBlob } from '../core/projectFile';
import { durationOf } from '../core/doc';
import { makeCanvas, ctx2d } from '../core/bitmaps';
import { renderFrame } from '../render/compositor';
import { scheduleClips } from '../audio/engine';

export interface ExportJob {
  doc: ProjectDoc; filename: string; width: number; height: number;
  onProgress(fraction: number, note?: string): void;
  cancelled(): boolean;
}
const yieldToUI = () => new Promise((r) => setTimeout(r));
export class Cancelled extends Error {}

export async function exportPng(j: ExportJob, deflate: boolean, transparent: boolean): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const c = makeCanvas(j.width, j.height);
  const n = j.doc.frames.length;
  for (let i = 0; i < n; i++) {
    if (j.cancelled()) throw new Cancelled();
    await renderFrame(j.doc, i, c, { width: j.width, height: j.height, transparent });
    const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('png'))), 'image/png'));
    zip.file(`frame_${String(i + 1).padStart(4, '0')}.png`, blob);
    j.onProgress(((i + 1) / n) * 0.9);
    await yieldToUI();
  }
  const out = await zip.generateAsync({ type: 'blob', compression: deflate ? 'DEFLATE' : 'STORE' }, (m) => j.onProgress(0.9 + m.percent / 1000));
  downloadBlob(out, `${j.filename}.zip`);
}

export async function exportGif(j: ExportJob, quality: number, transparent: boolean): Promise<void> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const c = makeCanvas(j.width, j.height);
  const gif = GIFEncoder();
  const n = j.doc.frames.length;
  const colors = Math.round(32 + ((quality - 1) / 9) * 224);
  const delay = Math.round(1000 / j.doc.fps);
  for (let i = 0; i < n; i++) {
    if (j.cancelled()) throw new Cancelled();
    await renderFrame(j.doc, i, c, { width: j.width, height: j.height, transparent });
    const { data } = ctx2d(c, true).getImageData(0, 0, j.width, j.height);
    const palette = quantize(data, colors, { format: transparent ? 'rgba4444' : 'rgb565', oneBitAlpha: transparent ? 128 : false });
    const index = applyPalette(data, palette, transparent ? 'rgba4444' : 'rgb565');
    const key = transparent ? palette.findIndex((p: number[]) => p[3] === 0) : -1;
    gif.writeFrame(index, j.width, j.height, { palette, delay, transparent: key >= 0, transparentIndex: Math.max(0, key), dispose: transparent ? 2 : 0 });
    j.onProgress((i + 1) / n);
    await yieldToUI();
  }
  gif.finish();
  downloadBlob(new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), `${j.filename}.gif`);
}

const BITRATE = { low: 1_000_000, medium: 2_500_000, high: 6_000_000, best: 14_000_000 };
export type VideoQuality = keyof typeof BITRATE;

async function mixAudio(doc: ProjectDoc): Promise<AudioBuffer | null> {
  if (!doc.audioClips.some((c) => !c.mute)) return null;
  const rate = 48000;
  const off = new OfflineAudioContext(2, Math.ceil(durationOf(doc) * rate), rate);
  scheduleClips(off, off.destination, doc, 0, 0);
  return off.startRendering();
}

/** H.264 needs even dimensions. */
export const evenSize = (v: number) => Math.max(2, Math.round(v / 2) * 2);

export async function exportVideo(j: ExportJob, quality: VideoQuality): Promise<string | null> {
  const mb = await import('mediabunny');
  const width = evenSize(j.width), height = evenSize(j.height);
  const mp4 = await mb.canEncodeVideo('avc', { width, height, bitrate: BITRATE[quality] });
  const vp9 = !mp4 && (await mb.canEncodeVideo('vp9', { width, height, bitrate: BITRATE[quality] }));
  if (!mp4 && !vp9) throw new Error('video encoding is not available in this browser');
  const audio = await mixAudio(j.doc);
  const audioCodec = mp4 ? 'aac' : 'opus';
  const hasAudio = !!audio && (await mb.canEncodeAudio(audioCodec, { numberOfChannels: 2, sampleRate: 48000, bitrate: 128000 }));

  const target = new mb.BufferTarget();
  const output = new mb.Output({ format: mp4 ? new mb.Mp4OutputFormat() : new mb.WebMOutputFormat(), target });
  const c = makeCanvas(width, height);
  const video = new mb.CanvasSource(c, { codec: mp4 ? 'avc' : 'vp9', bitrate: BITRATE[quality] });
  output.addVideoTrack(video, { frameRate: j.doc.fps });
  const sound = hasAudio ? new mb.AudioBufferSource({ codec: audioCodec, bitrate: 128000 }) : null;
  if (sound) output.addAudioTrack(sound);
  await output.start();
  const n = j.doc.frames.length, dt = 1 / j.doc.fps;
  for (let i = 0; i < n; i++) {
    if (j.cancelled()) { await output.cancel(); throw new Cancelled(); }
    await renderFrame(j.doc, i, c, { width, height });
    await video.add(i * dt, dt);
    j.onProgress(((i + 1) / n) * 0.95);
    await yieldToUI();
  }
  if (sound && audio) await sound.add(audio);
  await output.finalize();
  const ext = mp4 ? 'mp4' : 'webm';
  downloadBlob(new Blob([target.buffer!], { type: `video/${ext}` }), `${j.filename}.${ext}`);
  j.onProgress(1);
  const notes: string[] = [];
  if (!mp4) notes.push('This browser made a WebM video instead of MP4.');
  if (audio && !hasAudio) notes.push('This browser could not add the sound, so the video is silent.');
  return notes.join(' ') || null;
}
