// flags — lo stesso patto di onestà degli altri tipi (vedi fairness.test.ts),
// applicato a un tipo i cui "distrattori" sono nomi di paesi, non figure: il
// rischio non è una regola nascosta ma una scorciatoia testuale (nome più
// lungo, ordine alfabetico...) o una distrazione sempre troppo facile/difficile.

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/lib/rng';
import { genFlags } from '../src/lib/questions/flags';
import { FLAG_COUNTRIES, findExactTwin, flagSimilarity, isExactTwin, rankBySimilarity } from '../src/lib/questions/flagsdata';
import type { Difficulty, Question } from '../src/lib/types';

function generate(n: number, seed = 4242): Question[] {
  const rng = mulberry32(seed);
  const out: Question[] = [];
  for (const d of [1, 2, 3] as Difficulty[]) {
    for (let i = 0; i < n; i++) out.push(genFlags(rng, d));
  }
  return out;
}

describe('dataset delle bandiere', () => {
  it('nessun paese duplicato', () => {
    const ids = FLAG_COUNTRIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ogni bandiera a bande ha 2 o 3 colori distinti fra loro solo quando conta', () => {
    for (const c of FLAG_COUNTRIES) {
      if (c.pattern.kind !== 'bands') continue;
      expect(c.pattern.colors.length).toBeGreaterThanOrEqual(2);
      expect(c.pattern.colors.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('flags — il contratto base della domanda', () => {
  const questions = generate(60);

  it('3 opzioni distinte, correctIndex valido, testo in entrambe le lingue', () => {
    for (const q of questions) {
      expect(q.choices).toHaveLength(3);
      expect([0, 1, 2]).toContain(q.correctIndex);
      const keys = q.choices.map((c) => JSON.stringify(c));
      expect(new Set(keys).size).toBe(3);
      expect(q.prompt.it.trim().length).toBeGreaterThan(0);
      expect(q.prompt.en.trim().length).toBeGreaterThan(0);
      expect(q.explanation.it.trim().length).toBeGreaterThan(0);
      expect(q.explanation.en.trim().length).toBeGreaterThan(0);
      for (const c of q.choices) {
        expect(c.kind).toBe('text');
      }
    }
  });

  it('il payload mostra davvero la bandiera del paese giusto', () => {
    for (const q of questions) {
      expect(q.payload.kind).toBe('flag');
      if (q.payload.kind !== 'flag') continue;
      const correct = q.choices[q.correctIndex];
      if (correct.kind !== 'text') continue;
      const country = FLAG_COUNTRIES.find((c) => c.it === correct.text.it);
      expect(country, `nessun paese chiamato "${correct.text.it}"`).toBeDefined();
      expect(q.payload.flag).toEqual(country!.pattern);
    }
  });
});

describe('flags — nessuna scorciatoia cieca sui nomi', () => {
  const N = 500;
  const rng = mulberry32(777);
  const questions = Array.from({ length: N }, (_, i) => genFlags(rng, (((i % 3) + 1) as Difficulty)));

  const heuristics: { name: string; pick: (q: Question) => number | null }[] = [
    {
      name: 'nome più lungo',
      pick: (q) => {
        const lens = q.choices.map((c) => (c.kind === 'text' ? c.text.it.length : 0));
        const max = Math.max(...lens);
        return lens.filter((l) => l === max).length === 1 ? lens.indexOf(max) : null;
      },
    },
    {
      name: 'nome più corto',
      pick: (q) => {
        const lens = q.choices.map((c) => (c.kind === 'text' ? c.text.it.length : 0));
        const min = Math.min(...lens);
        return lens.filter((l) => l === min).length === 1 ? lens.indexOf(min) : null;
      },
    },
    {
      name: 'primo in ordine alfabetico',
      pick: (q) => {
        const names = q.choices.map((c) => (c.kind === 'text' ? c.text.it : ''));
        const sorted = [...names].sort();
        return names.indexOf(sorted[0]);
      },
    },
    {
      name: 'sempre in prima posizione',
      pick: () => 0,
    },
  ];

  for (const h of heuristics) {
    it(`"${h.name}" non rende più del caso`, () => {
      let hits = 0;
      let attempts = 0;
      for (const q of questions) {
        const guess = h.pick(q);
        if (guess === null) continue;
        attempts++;
        if (guess === q.correctIndex) hits++;
      }
      expect(attempts).toBeGreaterThan(50);
      expect(hits / attempts).toBeLessThan(0.45);
    });
  }
});

describe('flags — la difficoltà è vera', () => {
  it('difficoltà 3 sceglie distrattori più simili al bersaglio di difficoltà 1', () => {
    const rng = mulberry32(99);
    let simHard = 0;
    let simEasy = 0;
    const rounds = 200;
    for (let i = 0; i < rounds; i++) {
      const qHard = genFlags(rng, 3 as Difficulty);
      const qEasy = genFlags(rng, 1 as Difficulty);
      const avgSim = (q: Question) => {
        if (q.payload.kind !== 'flag') return 0;
        const correct = q.choices[q.correctIndex];
        if (correct.kind !== 'text') return 0;
        const target = FLAG_COUNTRIES.find((c) => c.it === correct.text.it)!;
        const others = q.choices.filter((_, i) => i !== q.correctIndex);
        const sims = others.map((c) => {
          if (c.kind !== 'text') return 0;
          const country = FLAG_COUNTRIES.find((c2) => c2.it === c.text.it)!;
          return flagSimilarity(target, country);
        });
        return sims.reduce((a, b) => a + b, 0) / sims.length;
      };
      simHard += avgSim(qHard);
      simEasy += avgSim(qEasy);
    }
    expect(simHard / rounds).toBeGreaterThan(simEasy / rounds);
  });

  it('rankBySimilarity riconosce le coppie di bandiere quasi identiche', () => {
    const chad = FLAG_COUNTRIES.find((c) => c.id === 'chad')!;
    const top = rankBySimilarity(chad)[0];
    expect(top.id).toBe('romania');
  });
});

describe('flags — la spiegazione non afferma mai una somiglianza falsa', () => {
  // Bug reale trovato giocando una partita vera: la spiegazione diceva "il Mali
  // si confonde con l'Italia" (falso: il centro è giallo contro bianco) e "la
  // Guinea si confonde con la Bolivia" (falso: bande verticali contro
  // orizzontali). Il colpevole era una soglia sul punteggio di flagSimilarity,
  // che basta condividere 2 colori su 3 (o la stessa terna a orientamento
  // diverso) per superarla. isExactTwin sostituisce la soglia con un confronto
  // esatto: questi casi non devono più risultare gemelli.
  const find = (id: string) => FLAG_COUNTRIES.find((c) => c.id === id)!;

  it.each([
    ['mali', 'italy'],
    ['guinea', 'bolivia'],
    ['poland', 'indonesia'],
    ['poland', 'monaco'],
  ])('%s non è un gemello esatto di %s', (a, b) => {
    expect(isExactTwin(find(a), find(b))).toBe(false);
  });

  it.each([
    ['chad', 'romania'],
    ['mali', 'guinea'],
    ['ireland', 'ivorycoast'],
    ['indonesia', 'monaco'],
  ])('%s È un gemello esatto di %s', (a, b) => {
    expect(isExactTwin(find(a), find(b))).toBe(true);
  });

  it('ogni nota "si confonde con" nella spiegazione generata è un gemello esatto vero', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 400; i++) {
      const q = genFlags(rng, (((i % 3) + 1) as Difficulty));
      const m = q.explanation.it.match(/si confonde spesso con quella di (.+?):/);
      if (!m) continue;
      const correct = q.choices[q.correctIndex];
      if (correct.kind !== 'text') continue;
      const target = FLAG_COUNTRIES.find((c) => c.it === correct.text.it)!;
      const mentioned = FLAG_COUNTRIES.find((c) => c.it === m[1])!;
      expect(isExactTwin(target, mentioned), `${target.it} vs ${mentioned.it}`).toBe(true);
      expect(findExactTwin(target)?.id).toBe(mentioned.id);
    }
  });
});
