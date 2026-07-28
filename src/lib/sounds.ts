'use client';
// Effetti sonori sintetizzati con WebAudio: zero file, zero download.

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function isMuted(): boolean {
  if (typeof window === 'undefined') return true;
  return localStorage.getItem('qs:muted') === '1';
}

export function setMuted(m: boolean) {
  localStorage.setItem('qs:muted', m ? '1' : '0');
}

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  const a = ac();
  if (!a || isMuted()) return;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + at);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + at + dur);
  osc.connect(g).connect(a.destination);
  osc.start(a.currentTime + at);
  osc.stop(a.currentTime + at + dur + 0.05);
}

export const sfx = {
  countdown: () => tone(660, 0, 0.12, 'square', 0.08),
  go: () => tone(990, 0, 0.25, 'square', 0.1),
  buzz: () => {
    tone(180, 0, 0.18, 'sawtooth', 0.18);
    tone(120, 0.05, 0.22, 'sawtooth', 0.15);
  },
  correct: () => {
    tone(523, 0, 0.12);
    tone(659, 0.1, 0.12);
    tone(784, 0.2, 0.2);
    tone(1047, 0.32, 0.3, 'sine', 0.14);
  },
  wrong: () => {
    tone(330, 0, 0.18, 'sawtooth', 0.1);
    tone(233, 0.15, 0.3, 'sawtooth', 0.12);
  },
  nobody: () => {
    tone(392, 0, 0.2, 'triangle', 0.1);
    tone(311, 0.2, 0.35, 'triangle', 0.1);
  },
  fanfare: () => {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.22, 'triangle', 0.13));
  },
  tick: () => tone(880, 0, 0.05, 'sine', 0.05),
};
