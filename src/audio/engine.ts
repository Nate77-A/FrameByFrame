/** Playback: one clock drives picture and sound so they cannot drift (spec §4.5.3). */
import type { AudioClip, ProjectDoc } from '../core/types';
import { durationOf } from '../core/doc';
import { getState, useStore } from '../core/store';
import { audioContext, getAudio } from './assets';

type Ctx = BaseAudioContext;

/** Schedule every clip on any audio context, live or offline (the MP4 mix reuses this). */
export function scheduleClips(c: Ctx, out: AudioNode, doc: ProjectDoc, from: number, t0: number): AudioScheduledSourceNode[] {
  const total = durationOf(doc);
  const nodes: AudioScheduledSourceNode[] = [];
  for (const clip of doc.audioClips) {
    const a = getAudio(clip.asset);
    if (!a || clip.mute) continue;
    const len = clip.trimEnd - clip.trimStart;
    const end = clip.loop ? total : Math.min(total, clip.startTime + len);
    if (from >= end || clip.startTime >= total) continue;
    const src = c.createBufferSource();
    src.buffer = a.buffer;
    const g = c.createGain();
    const when = t0 + Math.max(0, clip.startTime - from);
    const into = Math.max(0, from - clip.startTime);
    applyFades(g.gain, clip, t0, from, end);
    src.connect(g).connect(out);
    if (clip.loop) {
      src.loop = true; src.loopStart = clip.trimStart; src.loopEnd = clip.trimEnd;
      src.start(when, clip.trimStart + (into % len));
      src.stop(t0 + (end - from));
    } else src.start(when, clip.trimStart + into, end - clip.startTime - into);
    nodes.push(src);
  }
  return nodes;
}
function applyFades(p: AudioParam, clip: AudioClip, t0: number, from: number, end: number) {
  const at = (t: number) => t0 + Math.max(0, t - from);
  const v = clip.volume;
  const s = clip.startTime;
  const level = (t: number) => {
    let k = 1;
    if (clip.fadeIn > 0) k = Math.min(k, (t - s) / clip.fadeIn);
    if (clip.fadeOut > 0) k = Math.min(k, (end - t) / clip.fadeOut);
    return Math.max(0, k) * v;
  };
  const a = Math.max(from, s);
  p.setValueAtTime(level(a), at(a));
  if (clip.fadeIn > 0 && a < s + clip.fadeIn) p.linearRampToValueAtTime(v, at(s + clip.fadeIn));
  if (clip.fadeOut > 0) { p.setValueAtTime(Math.max(0, level(Math.max(a, end - clip.fadeOut))), at(Math.max(a, end - clip.fadeOut))); p.linearRampToValueAtTime(0, at(end)); }
}

let raf = 0;
let live: { nodes: AudioScheduledSourceNode[]; gain: GainNode } | null = null;

function silence() {
  live?.nodes.forEach((n) => { try { n.stop(); } catch { /* already ended */ } });
  live?.gain.disconnect();
  live = null;
}

function start() {
  const s = getState();
  const c = audioContext();
  void c.resume();
  const fps = s.doc.fps, count = s.doc.frames.length;
  let from = s.frameIndex >= count - 1 ? 0 : s.frameIndex;
  // Before the audio device starts, currentTime stands still, so use the system clock.
  const now = () => (c.state === 'running' ? c.currentTime : performance.now() / 1000);
  const begin = () => {
    silence();
    const gain = c.createGain();
    gain.connect(c.destination);
    const t = c.currentTime + 0.04;
    live = { gain, nodes: scheduleClips(c, gain, s.doc, from / fps, t) };
    return now() + 0.04;
  };
  let t0 = begin();
  let wasRunning = c.state === 'running';
  const tick = () => {
    const st = getState();
    if (!st.playing) return;
    if (!wasRunning && c.state === 'running') { wasRunning = true; t0 = begin(); }
    const f = from + Math.floor(Math.max(0, now() - t0) * st.doc.fps);
    if (f >= count) {
      if (st.loop) { from = 0; t0 = begin(); st.setFrame(0); }
      else { st.set({ playing: false }); return; }
    } else if (f !== st.frameIndex) st.setFrame(f);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function installPlayback(): () => void {
  return useStore.subscribe((s, p) => {
    if (s.playing === p.playing) return;
    cancelAnimationFrame(raf);
    silence();
    if (s.playing) start();
  });
}
