import { addAudio } from '../audio/assets';
import { getState } from '../core/store';

export async function addClipFromBlob(blob: Blob, name: string) {
  const a = await addAudio(blob);
  const s = getState();
  s.addClip({ name, asset: a.id, startTime: s.frameIndex / s.doc.fps, volume: 1, mute: false, loop: false, fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: a.buffer.duration });
}
export async function importAudioFile(f: File) {
  try { await addClipFromBlob(f, f.name); }
  catch { getState().toast("Oops! That sound wouldn't load. Try another one! 🔄"); }
}
