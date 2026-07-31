// Generatore "flags": mostra una bandiera disegnata a bande/disco (vedi
// FlagSpec in ../types e il renderer in src/components/visuals.tsx) e chiede
// di riconoscere il paese fra 3 nomi.
//
// A differenza dei tipi di logica, qui la difficoltà non nasce da una regola
// nascosta ma da QUALI due paesi sbagliati si offrono: rankBySimilarity (in
// ./flagsdata) ordina tutti i paesi per quanto la loro bandiera somiglia a
// quella mostrata. Difficoltà 3 pesca i distrattori dal terzo più simile (le
// bandiere davvero confondibili, es. Ciad/Romania): serve la memoria precisa
// dei colori, non basta il colpo d'occhio. Difficoltà 1 pesca dal terzo meno
// simile: chi ha un'idea anche vaga elimina i due estranei senza sforzo.

import type { ChoiceVisual, Difficulty, Question } from '../types';
import { pick, pickN, type Rng } from '../rng';
import { L } from '../localize';
import { placeChoices, retry } from './qutils';
import { FLAG_COUNTRIES, findExactTwin, rankBySimilarity, type FlagCountry } from './flagsdata';

function textChoice(c: FlagCountry): ChoiceVisual {
  return { kind: 'text', text: L(c.it, c.en) };
}

/** i paesi ammessi per questo round, dal più simile al meno simile al bersaglio, divisi in 3 terzi */
function tierFor(difficulty: Difficulty, ranked: FlagCountry[]): FlagCountry[] {
  const n = ranked.length;
  const third = Math.max(2, Math.ceil(n / 3));
  if (difficulty === 3) return ranked.slice(0, third);
  if (difficulty === 1) return ranked.slice(-third);
  return ranked.slice(Math.floor(n / 3), Math.floor(n / 3) + third);
}

export function genFlags(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const target = pick(rng, FLAG_COUNTRIES);
    const ranked = rankBySimilarity(target);
    const tier = tierFor(difficulty, ranked);
    const pool = tier.length >= 2 ? tier : ranked;
    const [d1, d2] = pickN(rng, pool, 2);

    const correct = textChoice(target);
    const { choices, correctIndex } = placeChoices(rng, correct, [textChoice(d1), textChoice(d2)]);

    const twin = findExactTwin(target);
    const twinNote = twin
      ? {
          it: ` Si confonde spesso con quella di ${twin.it}: sono identiche a colpo d'occhio.`,
          en: ` It's often confused with ${twin.en}'s flag: they look identical at a glance.`,
        }
      : { it: '', en: '' };

    return {
      qtype: 'flags' as const,
      difficulty,
      prompt: L('Di quale paese è questa bandiera?', 'Which country does this flag belong to?'),
      payload: { kind: 'flag', flag: target.pattern },
      choices,
      correctIndex,
      explanation: L(
        `È la bandiera di ${target.it}.${twinNote.it}`,
        `This is the flag of ${target.en}.${twinNote.en}`
      ),
    };
  });
}
