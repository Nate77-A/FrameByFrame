/** Decoded audio lives here, not in the document; clips refer to it by id (spec §5.0). */
import { uid } from '../core/doc';

export interface AudioAsset { id: string; blob: Blob; buffer: AudioBuffer; peaks: Float32Array }
const assets = new Map<string, AudioAsset>();
let context: AudioContext | null = null;

export function audioContext(): AudioContext {
  context ??= new AudioContext({ latencyHint: 'interactive' });
  return context;
}

/** Min/max pairs per bucket for drawing waveforms. */
export function computePeaks(data: Float32Array, buckets: number): Float32Array {
  const out = new Float32Array(buckets * 2);
  const size = data.length / buckets;
  for (let b = 0; b < buckets; b++) {
    let min = 0, max = 0;
    const end = Math.min(data.length, Math.floor((b + 1) * size));
    for (let i = Math.floor(b * size); i < end; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
    out[b * 2] = min; out[b * 2 + 1] = max;
  }
  return out;
}

export async function addAudio(blob: Blob, id = uid()): Promise<AudioAsset> {
  const bytes = await blob.arrayBuffer();
  const buffer = await audioContext().decodeAudioData(bytes);
  const asset = { id, blob, buffer, peaks: computePeaks(buffer.getChannelData(0), Math.min(4000, Math.ceil(buffer.duration * 200))) };
  assets.set(id, asset);
  return asset;
}
export const getAudio = (id: string) => assets.get(id);
export const clearAudio = () => assets.clear();

/** 16-bit WAV, used to store synthesised effects inside the project. */
export function encodeWav(buf: AudioBuffer): Blob {
  const ch = buf.numberOfChannels, n = buf.length, bytes = n * ch * 2;
  const v = new DataView(new ArrayBuffer(44 + bytes));
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, bytes, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = Math.max(-1, Math.min(1, data[c][i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
  }
  return new Blob([v], { type: 'audio/wav' });
}
