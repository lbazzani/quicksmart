// Sistema di punteggio di QuickSmart. Funzioni pure, testate in unit test.
// Regole in GAME_DESIGN.md.

import type { Difficulty } from './types';

export const BASE_POINTS: Record<Difficulty, number> = { 1: 100, 2: 200, 3: 300 };

/** penalità flat quando nessuno si prenota (team) */
export const NOBODY_PENALTY = -25;

/** decay del valore della domanda a ogni errore */
export const DECAY_FACTOR = 0.7;

/** finestra di riapertura dopo un errore (team) */
export const REOPEN_WINDOW_MS = 12_000;

export function baseValue(difficulty: Difficulty): number {
  return BASE_POINTS[difficulty];
}

/** valore corrente della domanda dopo `errors` risposte sbagliate */
export function decayedValue(difficulty: Difficulty, errors: number): number {
  return Math.round(BASE_POINTS[difficulty] * Math.pow(DECAY_FACTOR, errors));
}

/** moltiplicatore streak: ×1.25 da 3, ×1.5 da 5, ×2 da 8 risposte giuste di fila */
export function streakMultiplier(streak: number): number {
  if (streak >= 8) return 2;
  if (streak >= 5) return 1.5;
  if (streak >= 3) return 1.25;
  return 1;
}

/**
 * Punti per una risposta corretta.
 * @param value valore corrente della domanda (già decayed)
 * @param remainingFrac frazione di tempo di risposta rimanente (0..1) → bonus fino a +50%
 * @param newStreak streak DOPO questa risposta (inclusa)
 */
export function correctPoints(value: number, remainingFrac: number, newStreak: number): number {
  const frac = Math.min(1, Math.max(0, remainingFrac));
  return Math.round(value * (1 + 0.5 * frac) * streakMultiplier(newStreak));
}

/** penalità per risposta sbagliata: −50% del valore corrente */
export function wrongPenalty(value: number): number {
  return -Math.round(value * 0.5);
}

/** penalità per chi si prenota e non risponde: −60% del valore corrente */
export function mutePenalty(value: number): number {
  return -Math.round(value * 0.6);
}

/** (solo) penalità se il tempo di decisione scade senza buzz: −40% del base */
export function soloTimeoutPenalty(difficulty: Difficulty): number {
  return -Math.round(BASE_POINTS[difficulty] * 0.4);
}
