/**
 * Synthesized pool-hall sound effects — no audio assets, pure WebAudio.
 *
 * The AudioContext is created lazily on the first user gesture (browsers block
 * autoplay), and every effect is a tiny graph of oscillators / filtered noise
 * so the whole engine ships in ~3KB. Volumes are scaled by impact speed where
 * it matters (ball clicks, cushion thuds) so a soft safety shot sounds soft.
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let muted = false;

const MUTE_KEY = 'billiard.muted';

export function isMuted(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem(MUTE_KEY) === '1';
}

export function setMuted(m: boolean) {
  muted = m;
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  } catch {
    /* private mode */
  }
  if (master) master.gain.value = m ? 0 : 1;
}

/** Call from a pointer handler so the context starts inside a user gesture. */
export function unlockAudio() {
  if (typeof window === 'undefined') return;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    muted = isMuted();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    // 1s of white noise reused by every percussive effect.
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
}

function env(at: number, peak: number, decay: number): GainNode {
  const g = ctx!.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), at + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  g.connect(master!);
  return g;
}

function noise(at: number, peak: number, decay: number, freq: number, q = 1, type: BiquadFilterType = 'bandpass') {
  if (!ctx || !noiseBuf) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  src.connect(f).connect(env(at, peak, decay));
  src.start(at, Math.random() * 0.5, decay + 0.05);
}

function tone(at: number, peak: number, decay: number, f0: number, f1 = f0, type: OscillatorType = 'sine') {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), at + decay);
  o.connect(env(at, peak, decay));
  o.start(at);
  o.stop(at + decay + 0.05);
}

const now = () => ctx?.currentTime ?? 0;
const ready = () => !!ctx && !muted;

/** Phenolic ball-on-ball click. `v` 0..1 impact strength. */
export function sfxClick(v: number) {
  if (!ready()) return;
  const t = now();
  const s = Math.min(1, Math.max(0.12, v));
  noise(t, 0.55 * s, 0.035, 2400 + 1800 * s, 1.2, 'highpass');
  tone(t, 0.30 * s, 0.05, 2100 + 700 * s, 1500, 'triangle');
}

/** Rubber cushion thud. */
export function sfxCushion(v: number) {
  if (!ready()) return;
  const t = now();
  const s = Math.min(1, Math.max(0.1, v));
  noise(t, 0.30 * s, 0.07, 260, 0.8, 'lowpass');
  tone(t, 0.18 * s, 0.08, 180, 90, 'sine');
}

/** Ball dropping into a leather pocket: thump + short rattle. */
export function sfxPocket() {
  if (!ready()) return;
  const t = now();
  tone(t, 0.5, 0.12, 190, 70, 'sine');
  noise(t + 0.015, 0.28, 0.1, 700, 0.7, 'lowpass');
  noise(t + 0.1, 0.16, 0.12, 420, 0.7, 'lowpass');
}

/** Cue tip striking the cue ball. */
export function sfxStrike(power: number) {
  if (!ready()) return;
  const t = now();
  const s = Math.min(1, Math.max(0.2, power));
  noise(t, 0.5 * s, 0.025, 3200, 1.4, 'highpass');
  tone(t, 0.22 * s, 0.04, 1400, 900, 'triangle');
}

/** Short ascending major sting. */
export function sfxWin() {
  if (!ready()) return;
  const t = now();
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    tone(t + i * 0.11, 0.22, 0.32, f, f, 'triangle'),
  );
}

/** Soft descending sting. */
export function sfxLose() {
  if (!ready()) return;
  const t = now();
  [392, 311.13, 261.63].forEach((f, i) => tone(t + i * 0.14, 0.18, 0.36, f, f, 'triangle'));
}

/** Gentle UI tick (pocket called, button). */
export function sfxTick() {
  if (!ready()) return;
  tone(now(), 0.12, 0.05, 880, 660, 'sine');
}
