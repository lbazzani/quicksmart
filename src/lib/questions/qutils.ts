// Utility condivise dai generatori di domande.

import type { ChoiceVisual, Question } from '../types';
import type { Rng } from '../rng';

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
