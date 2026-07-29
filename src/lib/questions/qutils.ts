// Utility condivise dai generatori di domande.

import type { ChoiceVisual, Question } from '../types';
import { pick, shuffle, type Rng } from '../rng';

/** hash FNV-1a stabile del contenuto della domanda (per dedup in archivio) */
export function hashQuestion(q: Omit<Question, 'hash' | 'id'>): string {
  const s = JSON.stringify([q.qtype, q.payload, q.choices, q.correctIndex]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Mescola la risposta corretta con i 2 distrattori in posizione casuale.
 * Lancia se le opzioni non sono distinte (i generatori DEVONO garantirlo).
 */
export function placeChoices(
  rng: Rng,
  correct: ChoiceVisual,
  distractors: [ChoiceVisual, ChoiceVisual]
): { choices: ChoiceVisual[]; correctIndex: 0 | 1 | 2 } {
  const all = [correct, ...distractors];
  const keys = all.map((c) => JSON.stringify(c));
  if (new Set(keys).size !== 3) {
    throw new Error('opzioni duplicate: ' + keys.join(' | '));
  }
  const correctIndex = Math.floor(rng() * 3) as 0 | 1 | 2;
  const choices: ChoiceVisual[] = [];
  const rest = [...distractors];
  for (let i = 0; i < 3; i++) {
    choices.push(i === correctIndex ? correct : (rest.shift() as ChoiceVisual));
  }
  return { choices, correctIndex };
}

/** normalizza una rotazione in [0, 360) */
export function normRot(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * Sceglie due distrattori numerici in modo che la risposta non finisca sempre
 * nella stessa posizione della classifica.
 *
 * Il problema: i distrattori naturali sono "uno in più" e "uno in meno", quindi
 * la risposta è quasi sempre il numero di mezzo — e chi lo scopre risponde
 * senza ragionare. Qui si pesca da un insieme più ampio di errori plausibili
 * scegliendo, a rotazione, due valori sopra, due sotto, o uno per parte.
 *
 * @param correct il valore giusto
 * @param candidates errori plausibili (interi, anche ripetuti: vengono ripuliti)
 * @param minGap distanza minima dalla risposta (2 evita l'off-by-one punitivo)
 * @returns due distrattori distinti, o null se i candidati non bastano
 */
export function balancedNumericDistractors(
  rng: Rng,
  correct: number,
  candidates: number[],
  minGap = 1
): [number, number] | null {
  const ok = [...new Set(candidates)].filter(
    (v) => Number.isFinite(v) && v !== correct && Math.abs(v - correct) >= minGap
  );
  const below = ok.filter((v) => v < correct);
  const above = ok.filter((v) => v > correct);

  // tre disposizioni: risposta in mezzo, risposta più piccola, risposta più grande
  const layouts: Array<[number[], number[]]> = [
    [below, above], // uno sotto e uno sopra → risposta di mezzo
    [above, above], // due sopra → risposta più piccola
    [below, below], // due sotto → risposta più grande
  ];
  // A parità di tutto si preferiscono candidati con lo stesso numero di cifre
  // della risposta: altrimenti la risposta risulta sistematicamente la più
  // lunga (o la più corta) e si riconosce senza leggerla.
  const digits = (v: number) => Math.abs(v).toString().length;
  const sameLength = (list: number[]) => {
    const matching = list.filter((v) => digits(v) === digits(correct));
    return matching.length ? matching : list;
  };

  const order = shuffle(rng, [0, 1, 2]);
  for (const idx of order) {
    const [poolA, poolB] = layouts[idx];
    if (poolA === poolB) {
      if (poolA.length < 2) continue;
      const preferred = sameLength(poolA);
      const picked = shuffle(rng, [...(preferred.length >= 2 ? preferred : poolA)]).slice(0, 2);
      return [picked[0], picked[1]];
    }
    if (poolA.length && poolB.length) {
      return [pick(rng, sameLength(poolA)), pick(rng, sameLength(poolB))];
    }
  }
  return null;
}

/** genera finché `make` produce una domanda valida (placeChoices può lanciare) */
export function retry(make: () => Question, attempts = 20): Question {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return make();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}
