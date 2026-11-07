import { useEffect, useMemo, useRef, useState } from 'react';
import { CirclePlay, Download, Plus, RotateCcw, Square } from 'lucide-react';
import { getState, useStore } from '../core/store';
import { Cancelled, evenSize, exportGif, exportPng, exportVideo, type ExportJob, type VideoQuality } from '../export/export';
import { chime, downloadBlob } from '../core/projectFile';
import { computePeaks } from '../audio/assets';
import { previewSfx, renderSfx, sfxBlob, SFX, type Sfx } from '../audio/sfx';
import { addClipFromBlob } from './audioImport';
import { Seg, Slider, Toggle } from './controls';
import { tip } from './Tooltip';

function Modal({ title, children, wide, onClose }: { title: string; children: React.ReactNode; wide?: boolean; onClose(): void }) {
  // Held in a ref: a store update during the same key event must not swap this listener out mid-dispatch.
  const closer = useRef(onClose);
  closer.current = onClose;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') closer.current(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);
  return <div className="backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{children}</div>
  </div>;
}
const close = () => getState().set({ modal: null });

function ExportModal() {
  const s = useStore();
  const format = s.exportFormat;
  const { width: W, height: H } = s.doc.canvas;
  const [name, setName] = useState(s.fileName);
  const [w, setW] = useState(W); const [h, setH] = useState(H);
  const [deflate, setDeflate] = useState(true); const [transparent, setTransparent] = useState(false);
  const [quality, setQuality] = useState<VideoQuality>('high'); const [gifQ, setGifQ] = useState(8);
  const [busy, setBusy] = useState<number | null>(null);
  const cancel = useRef(false);
  const go = async () => {
    cancel.current = false;
    setBusy(0);
    const job: ExportJob = { doc: s.doc, filename: name || 'animation', width: Math.max(1, w), height: Math.max(1, h), onProgress: setBusy, cancelled: () => cancel.current };
    try {
      let note: string | null = null;
      if (format === 'png') await exportPng(job, deflate, transparent);
      else if (format === 'gif') await exportGif(job, gifQ, transparent);
      else note = await exportVideo(job, quality);
      s.toast(note ?? 'Export done! Great work! 🎉');
      chime();
      close();
    } catch (e) {
      if (!(e instanceof Cancelled)) { console.warn(e); s.toast("Oops! The export didn't work. Try again! 🔄"); }
    }
    setBusy(null);
  };
  return <Modal title="Export your animation" onClose={() => { if (busy === null) close(); }}>
    {busy !== null ? <div>
      <div className="bounce-brush" aria-hidden>🖌️</div>
      <p style={{ textAlign: 'center' }}>Making your {format.toUpperCase()}… {Math.round(busy * 100)}%</p>
      <div className="progress" role="progressbar" aria-valuenow={Math.round(busy * 100)}><div style={{ width: `${busy * 100}%` }} /></div>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => { cancel.current = true; }}>Stop</button>
    </div> : <>
      <Seg value={format} options={[['png', 'PNG Sequence'], ['mp4', 'MP4 Video'], ['gif', 'Animated GIF']]} onChange={(exportFormat) => s.set({ exportFormat })} />
      <div className="field"><label>Filename</label><input className="input" aria-label="Filename" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="grid2">
        <div className="field"><label>Width</label><input className="input" aria-label="Width" type="number" value={w} onChange={(e) => { const v = +e.target.value; setW(v); setH(Math.round((v * H) / W)); }} /></div>
        <div className="field"><label>Height</label><input className="input" aria-label="Height" type="number" value={h} onChange={(e) => { const v = +e.target.value; setH(v); setW(Math.round((v * W) / H)); }} /></div>
      </div>
      {format === 'png' && <><Seg label="Compression" value={deflate ? 'deflate' : 'stored'} options={[['stored', 'Stored (faster)'], ['deflate', 'Deflate (smaller)']]} onChange={(v) => setDeflate(v === 'deflate')} />
        <div className="field"><Toggle label="See-through background" on={transparent} onChange={setTransparent} /></div></>}
      {format === 'mp4' && <><Seg<VideoQuality> label="Quality" value={quality} options={[['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['best', 'Best']]} onChange={setQuality} />
        {(evenSize(w) !== w || evenSize(h) !== h) && <p className="label">Videos need even sizes, so this will be {evenSize(w)} × {evenSize(h)}.</p>}</>}
      {format === 'gif' && <><Slider label="Quality" min={1} max={10} value={gifQ} onChange={setGifQ} />
        <div className="field"><Toggle label="See-through background" on={transparent} onChange={setTransparent} /></div>
        {s.doc.fps > 50 && <p className="label">GIFs can look slower above 50 FPS in some apps.</p>}</>}
      <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={close}>Cancel</button><button className="btn primary" data-testid="do-export" onClick={go}>Export!</button></div>
    </>}
  </Modal>;
}

function Wave({ peaks, height = 34 }: { peaks: Float32Array | null; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c || !peaks) return;
    c.width = c.clientWidth * devicePixelRatio; c.height = height * devicePixelRatio;
    const x = c.getContext('2d')!;
    x.strokeStyle = '#53d8fb'; x.beginPath();
    const n = peaks.length / 2;
    for (let i = 0; i < n; i++) {
      const X = (i / n) * c.width + 0.5;
      x.moveTo(X, c.height / 2 + peaks[i * 2] * c.height / 2); x.lineTo(X, c.height / 2 + peaks[i * 2 + 1] * c.height / 2 + 1);
    }
    x.stroke();
  }, [peaks, height]);
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block' }} aria-hidden />;
}
function SfxCard({ sfx }: { sfx: Sfx }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => { void renderSfx(sfx).then((b) => setPeaks(computePeaks(b.getChannelData(0), 160))); }, [sfx]);
  return <div className="card" data-testid={`sfx-${sfx.id}`}>
    <div style={{ fontWeight: 600 }}><span aria-hidden>{sfx.icon}</span> {sfx.name}</div>
    <Wave peaks={peaks} />
    <div className="row">
      <button className="btn small" {...tip(`Listen to ${sfx.name}! ▶️`)} onClick={() => void previewSfx(sfx)}><CirclePlay size={18} /></button>
      <button className="btn small primary" {...tip('Put this sound at the playhead! 🎵')} onClick={async () => { await addClipFromBlob(await sfxBlob(sfx), sfx.name); getState().toast(`${sfx.name} added! 🎵`); }}><Plus size={16} /> Add to Timeline</button>
    </div>
  </div>;
}
function SfxModal() {
  const [q, setQ] = useState('');
  const list = useMemo(() => SFX.filter((s) => `${s.name} ${s.tags}`.toLowerCase().includes(q.toLowerCase())), [q]);
  return <Modal title="🎵 Sound Effects" wide onClose={close}>
    <input className="input" style={{ marginBottom: 10 }} placeholder="Search sounds…" aria-label="Search sounds" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    <div className="sfx-grid">{list.map((s) => <SfxCard key={s.id} sfx={s} />)}</div>
    {!list.length && <p className="hint">No sounds match that. Try "pop"!</p>}
    <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}><button className="btn" onClick={close}>Done</button></div>
  </Modal>;
}

const recorderType = () => ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';

function RecordModal() {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [mic, setMic] = useState('');
  const [state, setState] = useState<'idle' | 'rec' | 'done'>('idle');
  const [time, setTime] = useState(0);
  const [level, setLevel] = useState(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<{ stop(): void } | null>(null);
  useEffect(() => () => live.current?.stop(), []);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: mic ? { deviceId: { exact: mic } } : true });
      setMics((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'));
      const type = recorderType();
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      const c = new AudioContext();
      const an = c.createAnalyser(); an.fftSize = 1024;
      c.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.fftSize);
      const t0 = performance.now();
      let raf = 0;
      const tick = () => {
        an.getByteTimeDomainData(data);
        setTime((performance.now() - t0) / 1000);
        let peak = 0;
        const cv = canvas.current;
        if (cv) {
          const x = cv.getContext('2d')!;
          x.clearRect(0, 0, cv.width, cv.height); x.strokeStyle = '#e94560'; x.lineWidth = 2; x.beginPath();
          data.forEach((v, i) => { const k = (v - 128) / 128; peak = Math.max(peak, Math.abs(k)); const X = (i / data.length) * cv.width, Y = cv.height / 2 + k * cv.height / 2; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
          x.stroke();
        }
        setLevel(peak);
        raf = requestAnimationFrame(tick);
      };
      tick();
      rec.onstop = () => { setClip(new Blob(chunks, { type: rec.mimeType })); setState('done'); };
      rec.start();
      setState('rec');
      live.current = { stop() { cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop(); stream.getTracks().forEach((t) => t.stop()); void c.close(); live.current = null; } };
    } catch { getState().toast('Oops! We need the microphone. Check your browser settings. 🎙'); }
  };
  const ext = clip?.type.includes('mp4') ? 'm4a' : clip?.type.includes('ogg') ? 'ogg' : 'webm';
  return <Modal title="🎙 Record Your Audio" onClose={close}>
    <div className="row" style={{ justifyContent: 'center', gap: 20 }}>
      {state !== 'rec'
        ? <button className="rec-dot" data-testid="record" {...tip('Press to start recording! 🔴')} onClick={start}>Record</button>
        : <button className="rec-dot live" {...tip('Press to stop!')} onClick={() => live.current?.stop()}><Square size={30} fill="#fff" /></button>}
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 26 }} role="timer">{time.toFixed(1)} s</div>
      <div className="meter" role="meter" aria-label="Volume level" aria-valuenow={Math.round(level * 100)}><div style={{ height: `${level * 100}%` }} /></div>
    </div>
    <canvas ref={canvas} width={520} height={70} style={{ width: '100%', height: 70, margin: '10px 0' }} aria-hidden />
    {mics.length > 1 && <div className="field"><label>Microphone</label><select className="input" aria-label="Microphone" value={mic} onChange={(e) => setMic(e.target.value)}>{mics.map((m) => <option key={m.deviceId} value={m.deviceId}>{m.label || 'Microphone'}</option>)}</select></div>}
    <div className="row" style={{ justifyContent: 'flex-end' }}>
      {clip && state === 'done' && <>
        <button className="btn" {...tip('Try again!')} onClick={() => { setClip(null); setTime(0); setState('idle'); }}><RotateCcw size={18} /> Re-record</button>
        <button className="btn" {...tip('Save this as a sound file! 💾')} onClick={() => downloadBlob(clip, `recording.${ext}`)}><Download size={18} /> Save</button>
        <button className="btn primary" {...tip('Put this at the playhead! 🎵')} onClick={async () => { await addClipFromBlob(clip, `Recording ${new Date().toLocaleTimeString()}`); close(); }}><Plus size={18} /> Add to Timeline</button>
      </>}
      <button className="btn" onClick={close}>Close</button>
    </div>
  </Modal>;
}

function About() {
  return <Modal title="About FrAnimator" onClose={close}><p>FrAnimator is a place to draw and bring your pictures to life, one frame at a time. 🎨</p><p>Everything stays on your device. Nothing is uploaded and nobody is watching.</p><div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={close}>Let's draw!</button></div></Modal>;
}
function Help() {
  const rows: [string, string][] = [['Space (tap)', 'Play or pause'], ['Space + drag', 'Slide the canvas'], [', and .', 'Back or forward one frame'], ['Ctrl/⌘ Z', 'Undo'], ['Ctrl/⌘ Shift Z', 'Redo'], ['V P B E U T G I H Z', 'Pick a tool'], ['C', 'Open colors'], ['D', 'Black and white colors'], ['X', 'Swap colors'], ['Delete', 'Delete what you selected'], ['Two fingers', 'Slide and zoom on a tablet']];
  return <Modal title="How it works" onClose={close}>
    <ol style={{ paddingLeft: 22, lineHeight: 1.5 }}><li>Pick a tool on the left and draw!</li><li>Press <b>+ Frame</b> to make the next picture.</li><li>Press Onion 🧅 and switch it on to see your last frame like tracing paper.</li><li>Press ▶️ to watch it move!</li><li>Use 📌 on a layer so a background stays on every frame.</li></ol>
    <table style={{ width: '100%', borderSpacing: '0 4px' }}><tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ fontFamily: 'var(--font-mono)', fontSize: 14 }}>{k}</td><td>{v}</td></tr>)}</tbody></table>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn primary" onClick={close}>Got it!</button></div>
  </Modal>;
}
function ConfirmBox() {
  const c = useStore((s) => s.confirm); const set = useStore((s) => s.set);
  if (!c) return null;
  return <Modal title="Just checking!" onClose={() => set({ confirm: null })}><p>{c.text}</p>
    <div className="row" style={{ justifyContent: 'flex-end' }}><button className="btn" onClick={() => set({ confirm: null })}>No thanks</button><button className="btn primary" data-testid="confirm-yes" onClick={() => { set({ confirm: null }); c.onYes(); }}>{c.yes}</button></div></Modal>;
}

export function Modals() {
  const modal = useStore((s) => s.modal);
  const toasts = useStore((s) => s.toasts);
  return <>
    {modal === 'export' && <ExportModal />}
    {modal === 'sfx' && <SfxModal />}
    {modal === 'record' && <RecordModal />}
    {modal === 'about' && <About />}
    {modal === 'help' && <Help />}
    <ConfirmBox />
    <div className="toasts" role="status">{toasts.map((t) => <div key={t.id} className="toast">{t.text}</div>)}</div>
  </>;
}
