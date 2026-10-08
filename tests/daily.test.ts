// La sfida del giorno (src/lib/daily.ts): il numero cambia a mezzanotte di
// Roma e lo stesso seme dà a tutti le stesse domande.

import { describe, expect, it } from 'vitest';
import { numeroSfida, semeSfida } from '../src/lib/daily';
import { LiveQuestions } from '../src/lib/questions/live';
import { PACK_TYPES } from '../src/lib/questions';
import { difficultyForRound } from '../src/lib/engine/engine';

describe('numero della sfida', () => {
  it('il 9/10/2026 è la #1, e prima non si scende sotto 1', () => {
    expect(numeroSfida(Date.UTC(2026, 9, 9, 12))).toBe(1);
    expect(numeroSfida(Date.UTC(2026, 9, 10, 12))).toBe(2);
    expect(numeroSfida(Date.UTC(2026, 9, 8, 12))).toBe(1);
    expect(numeroSfida(Date.UTC(2025, 0, 1))).toBe(1);
  });

  it('cambia a mezzanotte di Roma, non a quella di Greenwich', () => {
    // 22:30 UTC del 10/10 = 00:30 dell'11/10 a Roma (ora legale, +2)
    expect(numeroSfida(Date.UTC(2026, 9, 10, 22, 30))).toBe(3);
    expect(numeroSfida(Date.UTC(2026, 9, 10, 21, 30))).toBe(2);
  });

  it('regge il cambio dell’ora: nessun giorno saltato o ripetuto', () => {
    // l'ora legale finisce il 25/10/2026: a mezzogiorno di ogni giorno il
    // numero deve crescere esattamente di uno
    let prima = numeroSfida(Date.UTC(2026, 9, 20, 11));
    for (let g = 21; g <= 31; g++) {
      const n = numeroSfida(Date.UTC(2026, 9, g, 11));
      expect(n).toBe(prima + 1);
      prima = n;
    }
  });
});

describe('seme della sfida', () => {
  it('è un intero positivo a 31 bit, diverso da un giorno all’altro', () => {
    const semi = new Set<number>();
    for (let n = 1; n <= 400; n++) {
      const s = semeSfida(n);
      expect(Number.isInteger(s) && s >= 0 && s < 2 ** 31).toBe(true);
      semi.add(s);
    }
    expect(semi.size).toBe(400);
  });

  it('stesso seme, stesse domande; posizione delle risposte comunque casuale', () => {
    const seme = semeSfida(7);
    const a = new LiveQuestions(seme, { types: PACK_TYPES.logic });
    const b = new LiveQuestions(seme, { types: PACK_TYPES.logic });
    for (let i = 0; i < 10; i++) {
      const d = difficultyForRound(i, 10);
      const qa = a.next(d);
      const qb = b.next(d);
      expect(qb.qtype).toBe(qa.qtype);
      expect(qb.payload).toEqual(qa.payload);
      // le stesse tre risposte, magari in un altro ordine
      expect(new Set(qb.choices.map((c) => JSON.stringify(c)))).toEqual(new Set(qa.choices.map((c) => JSON.stringify(c))));
      expect(JSON.stringify(qb.choices[qb.correctIndex])).toBe(JSON.stringify(qa.choices[qa.correctIndex]));
    }
  });
});
