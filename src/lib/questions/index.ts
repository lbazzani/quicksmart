// Registro dei generatori + generazione dell'archivio domande.

import type { Difficulty, GamePack, Question, QuestionType } from '../types';
import { mulberry32, type Rng } from '../rng';
import { hashQuestion } from './qutils';
import { genSequence } from './sequence';
import { genMatrix } from './matrix';
import { genOddone } from './oddone';
import { genNumseries } from './numseries';
import { genRotation } from './rotation';
import { genDice } from './dice';
import { genClock } from './clock';
import { genBalance } from './balance';
import { genAnalogy } from './analogy';
import { genArithgrid } from './arithgrid';
import { genFold } from './fold';
import { genPaths } from './paths';
import { genSets } from './sets';
import { genMirror } from './mirror';
import { genDomino } from './domino';
import { genSymmetry } from './symmetry';
import { genWeights } from './weights';
import { genPattern } from './pattern';
import { genMajority } from './majority';
import { genPairs } from './pairs';
import { genFlags } from './flags';

export const GENERATORS: Record<QuestionType, (rng: Rng, d: Difficulty) => Question> = {
  sequence: genSequence,
  matrix: genMatrix,
  oddone: genOddone,
  numseries: genNumseries,
  rotation: genRotation,
  dice: genDice,
  clock: genClock,
  balance: genBalance,
  analogy: genAnalogy,
  arithgrid: genArithgrid,
  fold: genFold,
  paths: genPaths,
  sets: genSets,
  mirror: genMirror,
  domino: genDomino,
  symmetry: genSymmetry,
  weights: genWeights,
  pattern: genPattern,
  majority: genMajority,
  pairs: genPairs,
  flags: genFlags,
};

/**
 * Tipi sospesi dal gioco: restano nel codice e nei test, ma non vengono pescati.
 *
 * Ci si finisce per un motivo solo: la domanda non è un gioco onesto per chi la
 * riceve. Un audit alla cieca ce ne ha mandati tre (si poteva ragionare bene e
 * sbagliare comunque); `fold`, `symmetry` e `domino` erano rientrati dopo le
 * correzioni custodite da tests/fairness.test.ts.
 *
 * `fold` e `domino` sono di nuovo fuori dopo i test in famiglia (luglio 2026):
 * stavolta non per l'equità ma per la comprensibilità — il foglio piegato non
 * si capisce sul telefono e le tessere risultano troppo complicate. Rientrano
 * solo con una presentazione ripensata e riprovata dal vivo.
 */
export const QUARANTINED: QuestionType[] = ['fold', 'domino'];

/**
 * Tipi che esistono solo dentro il proprio pacchetto (vedi GamePack in
 * ../types) e non entrano MAI nella rotazione di logica di default: 'flags'
 * è un gioco a sé, non un ventesimo tipo mescolato agli altri diciannove.
 */
export const STANDALONE: QuestionType[] = ['flags'];

/** tutti i tipi esistenti, inclusi quelli in quarantena e quelli standalone (per test e audit) */
export const ALL_QUESTION_TYPES = Object.keys(GENERATORS) as QuestionType[];

/** i tipi che il pacchetto "logica" pesca davvero */
export const QUESTION_TYPES = ALL_QUESTION_TYPES.filter(
  (t) => !QUARANTINED.includes(t) && !STANDALONE.includes(t)
);

/** i tipi ammessi per ciascun pacchetto di gioco (vedi GamePack in ../types) */
export const PACK_TYPES: Record<GamePack, QuestionType[]> = {
  logic: QUESTION_TYPES,
  flags: ['flags'],
};

/**
 * Genera l'archivio: `perTypePerDifficulty` domande per ciascun tipo e
 * difficoltà, con dedup per hash. Deterministico dato il seed.
 */
export function generateBank(seed: number, perTypePerDifficulty: number): Question[] {
  const out: Question[] = [];
  const seen = new Set<string>();
  for (const qtype of QUESTION_TYPES) {
    for (const d of [1, 2, 3] as Difficulty[]) {
      const rng = mulberry32(seed ^ (qtype.length * 7919) ^ (d * 104729) ^ hash32(qtype));
      let made = 0;
      let attempts = 0;
      while (made < perTypePerDifficulty && attempts < perTypePerDifficulty * 30) {
        attempts++;
        try {
          const q = GENERATORS[qtype](rng, d);
          q.hash = hashQuestion(q);
          if (seen.has(q.hash)) continue;
          seen.add(q.hash);
          out.push(q);
          made++;
        } catch {
          // generazione fallita (opzioni duplicate dopo i retry): riprova
        }
      }
    }
  }
  return out;
}

function hash32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
