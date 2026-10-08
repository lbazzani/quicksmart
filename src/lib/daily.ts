// La sfida del giorno: dieci domande uguali per tutti, una partita al giorno.
//
// Perché esiste: il passaparola. Un risultato si confronta solo se le domande
// sono le stesse — è il meccanismo di Wordle: «#12 · 8/10 🟩🟩🟥…» in una chat
// di famiglia fa venire voglia di provarci, un «ho fatto 1800 punti» su
// domande che nessun altro vedrà no.
//
// Come: il motore genera le domande da un seme (LiveQuestions). Qui il seme
// nasce dal numero del giorno invece che da crypto.randomInt, quindi tutte le
// partite dello stesso giorno ricevono la stessa sequenza — domande, round
// speciali e gemelle comprese. Restano casuali solo le POSIZIONI delle
// risposte (live.ts, shuffleRng): «la B è giusta» non si può passare agli altri.
//
// Il giorno è quello italiano: la sfida cambia a mezzanotte di Roma.
// Il file non usa niente di Node né del browser: lo leggono sia l'API sia la home.

import type { GamePack } from './types';

/** giorno della sfida #1 */
const PRIMO_GIORNO = Date.UTC(2026, 9, 9); // 9 ottobre 2026

/** regole fisse: con impostazioni diverse i punteggi non si confronterebbero */
export const SFIDA = {
  rounds: 10,
  buzzWindowSec: 20,
  answerSec: 12,
  pack: 'logic' as GamePack,
} as const;

/** 'YYYY-MM-DD' del giorno italiano in cui cade `ms` */
function giornoRoma(ms: number): string {
  // en-CA formatta come ISO; il fuso fa il resto, ora legale compresa
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(ms));
}

/**
 * Numero della sfida del giorno (1 = 9/10/2026). Mai sotto 1: prima del primo
 * giorno (un orologio sbagliato, una prova in locale) si gioca la #1. Uno 0
 * sarebbe stato peggio di un numero strano: l'API lo leggeva come «non è una
 * sfida» e partiva un allenamento qualunque (visto nel test e2e l'8/10).
 */
export function numeroSfida(ms: number = Date.now()): number {
  const [y, m, d] = giornoRoma(ms).split('-').map(Number);
  return Math.max(1, Math.round((Date.UTC(y, m - 1, d) - PRIMO_GIORNO) / 86_400_000) + 1);
}

/**
 * Seme della sfida `n`. Un rimescolamento di bit e non `n` stesso: semi
 * consecutivi darebbero a mulberry32 partenze troppo simili, e giorni vicini
 * si somiglierebbero.
 */
export function semeSfida(n: number): number {
  let x = Math.imul(n ^ 0x51f15e, 0x9e3779b1) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return x & 0x7fffffff;
}
