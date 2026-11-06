/** Procedural sound effects from OfflineAudioContext: no files, no licences (spec §4.7). */
import { audioContext, encodeWav } from './assets';

type Render = (c: OfflineAudioContext, out: AudioNode) => void;
const SR = 44100;

function noise(c: OfflineAudioContext, seconds: number): AudioBufferSourceNode {
  const b = c.createBuffer(1, Math.ceil(seconds * SR), SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = b;
  return s;
}
function env(c: OfflineAudioContext, t: number, a: number, peak: number, d: number) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  return g;
}
function tone(c: OfflineAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t: number, len: number, peak: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + len);
  const g = env(c, t, 0.004, peak, len);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + len + 0.02);
}
function burst(c: OfflineAudioContext, out: AudioNode, type: BiquadFilterType, f0: number, f1: number, t: number, a: number, d: number, peak: number, q = 1) {
  const n = noise(c, a + d + 0.05);
  const f = c.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + d);
  n.connect(f).connect(env(c, t, a, peak, d)).connect(out);
  n.start(t);
}

export interface Sfx { id: string; name: string; icon: string; len: number; tags: string; render: Render }
export const SFX: Sfx[] = [
  { id: 'hit', name: 'Hit / Punch', icon: '👊', len: 0.35, tags: 'impact smack', render: (c, o) => { burst(c, o, 'lowpass', 2500, 200, 0, 0.003, 0.14, 0.9); tone(c, o, 'sine', 170, 50, 0, 0.22, 0.9); } },
  { id: 'swoosh', name: 'Swoosh / Whoosh', icon: '💨', len: 0.6, tags: 'wind fast', render: (c, o) => burst(c, o, 'bandpass', 300, 3200, 0, 0.26, 0.3, 0.9, 1.2) },
  { id: 'bounce', name: 'Bouncing Ball', icon: '🏀', len: 1, tags: 'boing jump', render: (c, o) => { [0, 0.3, 0.52, 0.68].forEach((t, i) => tone(c, o, 'sine', 420 - i * 40, 120, t, 0.13, 0.8 - i * 0.15)); } },
  { id: 'zap', name: 'Electricity / Zap', icon: '⚡', len: 0.6, tags: 'electric shock laser', render: (c, o) => { for (let i = 0; i < 9; i++) tone(c, o, 'sawtooth', 500 + Math.random() * 2600, 200, i * 0.055, 0.05, 0.35); burst(c, o, 'highpass', 3000, 5000, 0, 0.01, 0.45, 0.2); } },
  { id: 'pop', name: 'Pop / Bubble', icon: '🫧', len: 0.2, tags: 'bubble click', render: (c, o) => tone(c, o, 'sine', 240, 1200, 0, 0.09, 0.9) },
  { id: 'coin', name: 'Coin / Collect', icon: '🪙', len: 0.5, tags: 'collect win ding', render: (c, o) => { tone(c, o, 'square', 988, 988, 0, 0.07, 0.3); tone(c, o, 'square', 1319, 1319, 0.07, 0.34, 0.3); } },
  { id: 'explosion', name: 'Explosion', icon: '💥', len: 1.5, tags: 'boom blast', render: (c, o) => { burst(c, o, 'lowpass', 1800, 60, 0, 0.01, 1.4, 1); tone(c, o, 'sine', 90, 28, 0, 1.1, 0.9); } },
  { id: 'door', name: 'Door Creak', icon: '🚪', len: 1.3, tags: 'creak spooky', render: (c, o) => { for (let i = 0; i < 26; i++) { const t = i * 0.046 + Math.random() * 0.012; tone(c, o, 'sawtooth', 150 + i * 5 + Math.random() * 40, 110, t, 0.035, 0.3); } } },
  { id: 'footstep', name: 'Footstep', icon: '👣', len: 0.8, tags: 'walk step', render: (c, o) => { [0, 0.42].forEach((t) => { burst(c, o, 'lowpass', 700, 140, t, 0.004, 0.1, 0.8); tone(c, o, 'sine', 95, 55, t, 0.09, 0.6); }); } },
  { id: 'splash', name: 'Water Splash', icon: '💦', len: 1, tags: 'water drop', render: (c, o) => { burst(c, o, 'bandpass', 900, 3400, 0, 0.03, 0.8, 0.8, 0.8); for (let i = 0; i < 7; i++) tone(c, o, 'sine', 500 + Math.random() * 900, 1500, 0.1 + i * 0.09, 0.06, 0.25); } },
];

const cache = new Map<string, AudioBuffer>();
export async function renderSfx(s: Sfx): Promise<AudioBuffer> {
  const hit = cache.get(s.id);
  if (hit) return hit;
  const c = new OfflineAudioContext(1, Math.ceil(s.len * SR), SR);
  s.render(c, c.destination);
  const b = await c.startRendering();
  cache.set(s.id, b);
  return b;
}
export const sfxBlob = async (s: Sfx) => encodeWav(await renderSfx(s));

export function playBuffer(b: AudioBuffer, gain = 1): AudioBufferSourceNode {
  const c = audioContext();
  void c.resume();
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = b;
  src.connect(g).connect(c.destination);
  src.start();
  return src;
}
export async function previewSfx(s: Sfx) { playBuffer(await renderSfx(s)); }
export function playChime() {
  try {
    const c = audioContext();
    if (c.state !== 'running') return;
    const t = c.currentTime;
    [660, 880].forEach((f, i) => {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.12, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.2);
      o.connect(g).connect(c.destination);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.22);
    });
  } catch { /* sound is only a nicety */ }
}
