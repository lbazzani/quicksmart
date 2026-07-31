import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/rng';
import { GENERATORS, QUESTION_TYPES } from '../src/lib/questions';
import { LiveQuestions, reshuffleChoices } from '../src/lib/questions/live';
import { skeletonOf } from '../src/lib/questions/skeleton';
import { findTwin } from '../src/lib/questions/twin';
import type { Difficulty } from '../src/lib/types';

describe('rimescolamento delle opzioni', () => {
  it('mantiene la risposta corretta, spostandola di posizione', () => {
    const rng = mulberry32(7);
    const q = GENERATORS.sequence(rng, 2);
    const before = JSON.stringify(q.choices[q.correctIndex]);
    const positions = new Set<number>();
    for (let i = 0; i < 30; i++) {
      const s = reshuffleChoices(q, rng);
      expect(JSON.stringify(s.choices[s.correctIndex])).toBe(before);
      expect(s.choices).toHaveLength(3);
      // le stesse tre opzioni, solo in ordine diverso
      expect(new Set(s.choices.map((c) => JSON.stringify(c)))).toEqual(
        new Set(q.choices.map((c) => JSON.stringify(c)))
      );
      positions.add(s.correctIndex);
    }
    // in 30 rimescolamenti la risposta finisce in tutte e tre le posizioni
    expect(positions.size).toBe(3);
  });
});

describe('LiveQuestions', () => {
  it('produce domande valide di ogni difficoltà', () => {
    const live = new LiveQuestions(123);
    for (const d of [1, 2, 3] as Difficulty[]) {
      for (let i = 0; i < 20; i++) {
        const q = live.next(d);
        expect(q.difficulty).toBe(d);
        expect(q.choices).toHaveLength(3);
        expect([0, 1, 2]).toContain(q.correctIndex);
        expect(q.prompt.it.length).toBeGreaterThan(3);
        expect(q.prompt.en.length).toBeGreaterThan(3);
      }
    }
  });

  it('evita di riproporre strutture appena viste', () => {
    const live = new LiveQuestions(99);
    const skeletons = Array.from({ length: 25 }, () => skeletonOf(live.next(2)));
    // nessuna struttura ripetuta a distanza ravvicinata (finestra di 8)
    for (let i = 0; i < skeletons.length; i++) {
      const window = skeletons.slice(Math.max(0, i - 8), i);
      expect(window).not.toContain(skeletons[i]);
    }
  });

  it('alterna i tipi di domanda invece di insistere su uno solo', () => {
    const live = new LiveQuestions(5);
    const types = new Set(Array.from({ length: 20 }, () => live.next(2).qtype));
    expect(types.size).toBeGreaterThanOrEqual(5);
  });

  it('due partite diverse non giocano le stesse domande', () => {
    const a = new LiveQuestions(1);
    const b = new LiveQuestions(2);
    const qa = Array.from({ length: 12 }, () => JSON.stringify(a.next(2).payload));
    const qb = Array.from({ length: 12 }, () => JSON.stringify(b.next(2).payload));
    const shared = qa.filter((x) => qb.includes(x));
    expect(shared).toHaveLength(0);
  });
});

describe('domande gemelle', () => {
  it('hanno la stessa struttura ma risposta diversa', () => {
    const rng = mulberry32(31);
    let found = 0;
    for (const qtype of ['sequence', 'clock', 'dice', 'numseries'] as const) {
      for (const d of [1, 2, 3] as Difficulty[]) {
        const q = GENERATORS[qtype](rng, d);
        const twin = findTwin(q, rng);
        if (!twin) continue;
        found++;
        expect(skeletonOf(twin)).toBe(skeletonOf(q)); // stessa aria di famiglia
        expect(JSON.stringify(twin.payload)).not.toBe(JSON.stringify(q.payload));
        // la risposta corretta non è la stessa: chi va a memoria sbaglia
        expect(JSON.stringify(twin.choices[twin.correctIndex])).not.toBe(
          JSON.stringify(q.choices[q.correctIndex])
        );
      }
    }
    // sui tipi riconoscibili la gemella si trova quasi sempre
    expect(found).toBeGreaterThanOrEqual(8);
  });
});

describe('varietà dei generatori', () => {
  it('ogni tipo produce almeno 20 domande distinte su 40 tentativi', () => {
    for (const qtype of QUESTION_TYPES) {
      const rng = mulberry32(2024);
      const seen = new Set<string>();
      for (let i = 0; i < 40; i++) {
        try {
          seen.add(JSON.stringify(GENERATORS[qtype](rng, 2).payload));
        } catch {
          // generatore in difficoltà: conta come non prodotta
        }
      }
      expect(seen.size, `tipo ${qtype}`).toBeGreaterThanOrEqual(20);
    }
  });
});
