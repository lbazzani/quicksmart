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

/**
 * Va chiamata DENTRO il gestore di un tocco: iOS crea e riattiva l'AudioContext
 * solo durante un gesto dell'utente, altrimenti resta muto per tutta la partita.
 */
export function unlockAudio() {
  const a = ac();
  if (!a) return;
  if (a.state === 'suspended') a.resume().catch(() => {});
  // un suono impercettibile "apre" davvero l'output su Safari
  try {
    const osc = a.createOscillator();
    const g = a.createGain();
    g.gain.value = 0.0001;
    osc.connect(g).connect(a.destination);
    osc.start();
    osc.stop(a.currentTime + 0.02);
  } catch {
    // se non parte, pazienza: l'audio è un extra
  }
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
  /** serie di risposte giuste: sale, invece di risolversi come "correct" */
  streak: () => {
    [523, 659, 784, 988, 1175].forEach((f, i) => tone(f, i * 0.075, 0.16, 'triangle', 0.13));
  },
  /** qualcuno entra in squadra */
  join: () => {
    tone(587, 0, 0.1, 'sine', 0.09);
    tone(880, 0.08, 0.16, 'sine', 0.09);
  },
  fanfare: () => {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(f, i * 0.14, 0.22, 'triangle', 0.13));
  },
  tick: () => tone(880, 0, 0.05, 'sine', 0.05),
};
