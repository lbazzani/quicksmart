import { describe, expect, it } from 'vitest';
import {
  NOBODY_PENALTY,
  baseValue,
  correctPoints,
  decayedValue,
  mutePenalty,
  soloTimeoutPenalty,
  streakMultiplier,
  wrongPenalty,
} from '../src/lib/scoring';
import { difficultyForRound } from '../src/lib/engine/engine';

describe('scoring', () => {
  it('valori base per difficoltà', () => {
    expect(baseValue(1)).toBe(100);
    expect(baseValue(2)).toBe(200);
    expect(baseValue(3)).toBe(300);
  });

  it('decay del 30% a ogni errore', () => {
    expect(decayedValue(2, 0)).toBe(200);
    expect(decayedValue(2, 1)).toBe(140);
    expect(decayedValue(2, 2)).toBe(98);
    expect(decayedValue(3, 1)).toBe(210);
  });

  it('moltiplicatore streak a soglie 3/5/8', () => {
    expect(streakMultiplier(0)).toBe(1);
    expect(streakMultiplier(2)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.25);
    expect(streakMultiplier(4)).toBe(1.25);
    expect(streakMultiplier(5)).toBe(1.5);
    expect(streakMultiplier(7)).toBe(1.5);
    expect(streakMultiplier(8)).toBe(2);
    expect(streakMultiplier(20)).toBe(2);
  });

  it('punti risposta corretta: base + bonus velocità × streak', () => {
    // tutta la finestra rimanente → +50%
    expect(correctPoints(200, 1, 1)).toBe(300);
    // niente tempo rimasto → solo base
    expect(correctPoints(200, 0, 1)).toBe(200);
    // metà finestra → +25%
    expect(correctPoints(200, 0.5, 1)).toBe(250);
    // streak 3 → ×1.25
    expect(correctPoints(200, 0, 3)).toBe(250);
    // frazioni fuori range vengono clampate
    expect(correctPoints(100, 1.7, 1)).toBe(150);
    expect(correctPoints(100, -2, 1)).toBe(100);
  });

  it('penalità (ritarate dopo i test in famiglia: pungere, non castigare)', () => {
    expect(wrongPenalty(200)).toBe(-60);
    expect(wrongPenalty(140)).toBe(-42);
    expect(mutePenalty(200)).toBe(-80);
    expect(soloTimeoutPenalty(1)).toBe(-25);
    expect(soloTimeoutPenalty(3)).toBe(-75);
    expect(NOBODY_PENALTY).toBe(-10);
  });

  it('rampa di difficoltà nei round', () => {
    // partita da 10 round: 3 facili, 3-4 medie, resto difficili
    const plan = Array.from({ length: 10 }, (_, i) => difficultyForRound(i, 10));
    expect(plan.slice(0, 3)).toEqual([1, 1, 1]);
    expect(plan[4]).toBe(2);
    expect(plan[9]).toBe(3);
    // partita aperta: parte facile e sale
    expect(difficultyForRound(0, null)).toBe(1);
    expect(difficultyForRound(5, null)).toBe(2);
    expect(difficultyForRound(12, null)).toBe(3);
  });
});
