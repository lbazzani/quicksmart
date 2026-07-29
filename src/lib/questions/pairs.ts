// Generatore "pairs": tutte le figure sono in coppia, una sola è rimasta sola.
//
// Anche questo nasce dai test in famiglia: un gioco da capire al volo sul
// telefono. La consegna dice ESPLICITAMENTE che cosa rende gemelle due figure
// (lezione di fairness: la regola decisiva si legge prima di rispondere).
//
// d1 — 3 coppie + 1 solitaria, ogni coppia con forma E colore tutti suoi:
//      la solitaria salta all'occhio appena si accoppia il resto.
// d2 — 4 coppie + 1: la stessa forma compare in DUE colori diversi, quindi
//      gemella = stessa forma E stesso colore, accoppiare a occhio non basta.
// d3 — 5 coppie + 1: entra in gioco anche pieno/vuoto; la solitaria differisce
//      da una coppia soltanto per il riempimento.
//
// Onestà:
//  - il disegno viene RICONTATO: esattamente una figura senza gemella, tutte
//    le altre esattamente in coppia (per la chiave dichiarata nel prompt);
//  - due specie mai distinguibili dal solo colore se i colori si confondono
//    (pickColors), e a d3 mai distinguibili dal solo riempimento su colori
//    simili — la chiave visiva è sempre netta;
//  - i distrattori sono figure che nel disegno la gemella CE L'HANNO: l'errore
//    di chi si ferma alla prima somiglianza.

import type { CellSpec, Difficulty, Question, ShapeSpec } from '../types';
import { chance, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';
import { FILL_ADJ, SHAPES, agr, col, pickColors, unArt, type ColorInfo, type ShapeInfo } from './vocab';

type Fill = 'solid' | 'outline';

interface Kind {
  info: ShapeInfo;
  color: ColorInfo;
  fill: Fill;
}

const spec = (k: Kind): ShapeSpec => ({ shape: k.info.shape, color: k.color.idx, fillMode: k.fill });
const keyOf = (k: Kind) => `${k.info.shape}|${k.color.idx}|${k.fill}`;

/** "una stella gialla (vuota)" — il nome parlato della figura */
function name(k: Kind, withFill: boolean): string {
  const base = `${unArt(k.info)} ${k.info.one} ${col(k.color, k.info.f, false)}`;
  return withFill ? `${base} ${agr(FILL_ADJ[k.fill], k.info.f, false)}` : base;
}

/** dispone le figure su righe bilanciate da al massimo 4 celle (66px: si vedono bene) */
function toRows(rng: Rng, all: Kind[]): { rows: CellSpec[][]; cells: Kind[] } {
  const cells = shuffle(rng, [...all]);
  const nRows = Math.ceil(cells.length / 4);
  const base = Math.floor(cells.length / nRows);
  let extra = cells.length % nRows;
  const rows: CellSpec[][] = [];
  let i = 0;
  for (let r = 0; r < nRows; r++) {
    const len = base + (extra-- > 0 ? 1 : 0);
    rows.push(cells.slice(i, i + len).map((k) => ({ shapes: [spec(k)] })));
    i += len;
  }
  return { rows, cells };
}

/** esattamente una specie compare 1 volta, tutte le altre esattamente 2 */
function recount(cells: Kind[], single: Kind): void {
  const tally = new Map<string, number>();
  for (const k of cells) tally.set(keyOf(k), (tally.get(keyOf(k)) ?? 0) + 1);
  for (const [key, n] of tally) {
    if (key === keyOf(single) ? n !== 1 : n !== 2) throw new Error('coppie incoerenti');
  }
}

/** due specie devono distinguersi con un colpo d'occhio onesto */
function guardKinds(kinds: Kind[]): void {
  for (let i = 0; i < kinds.length; i++) {
    for (let j = i + 1; j < kinds.length; j++) {
      const a = kinds[i];
      const b = kinds[j];
      if (keyOf(a) === keyOf(b)) throw new Error('specie duplicata');
      // pickColors garantisce colori mai confondibili: qui basta che due specie
      // non differiscano per il SOLO riempimento con la stessa forma e colore…
      // che è esattamente la trappola voluta a d3, quindi ammessa ma mai fra
      // due COPPIE (solo fra la solitaria e una coppia, e il prompt avverte).
    }
  }
}

function build(rng: Rng, difficulty: Difficulty, kinds: Kind[], single: Kind, promptRule: string): Question {
  guardKinds([...kinds, single]);
  const all = [...kinds.flatMap((k) => [k, k]), single];
  const { rows, cells } = toRows(rng, all);
  recount(cells, single);

  const withFill = difficulty === 3;
  const [d1, d2] = pickN(rng, kinds, 2);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'cell', cell: { shapes: [spec(single)] } }, [
    { kind: 'cell', cell: { shapes: [spec(d1)] } },
    { kind: 'cell', cell: { shapes: [spec(d2)] } },
  ]);
  return {
    qtype: 'pairs',
    difficulty,
    prompt: `Ogni figura ha la sua gemella (${promptRule}), una sola è rimasta sola: quale?`,
    payload: { kind: 'cells', rows },
    choices,
    correctIndex,
    explanation:
      `Accoppia le figure una alla volta: ${kinds
        .slice(0, 3)
        .map((k) => `due ${k.info.many} ${col(k.color, k.info.f)}${withFill ? ` ${agr(FILL_ADJ[k.fill], k.info.f)}` : ''}`)
        .join(', ')}${kinds.length > 3 ? '…' : ''}. ` +
      `Alla fine resta ${name(single, withFill)}, senza gemella.`,
  };
}

function d1Pairs(rng: Rng): Question {
  const sh = pickN(rng, SHAPES, 4);
  const cl = pickColors(rng, 4);
  const kinds: Kind[] = sh.slice(0, 3).map((info, i) => ({ info, color: cl[i], fill: 'solid' }));
  const single: Kind = { info: sh[3], color: cl[3], fill: 'solid' };
  return build(rng, 1, kinds, single, 'stessa forma e stesso colore');
}

function d2Pairs(rng: Rng): Question {
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 5);
  // la stessa forma in due colori: gemella = forma E colore
  const kinds: Kind[] = [
    { info: sh[0], color: cl[0], fill: 'solid' },
    { info: sh[0], color: cl[1], fill: 'solid' },
    { info: sh[1], color: cl[2], fill: 'solid' },
    { info: sh[2], color: cl[3], fill: 'solid' },
  ];
  // la solitaria condivide la forma con una coppia, ma in un colore tutto suo
  const single: Kind = { info: sh[randInt(rng, 0, 1)], color: cl[4], fill: 'solid' };
  return build(rng, 2, shuffle(rng, kinds), single, 'stessa forma e stesso colore');
}

function d3Pairs(rng: Rng): Question {
  const sh = pickN(rng, SHAPES, 4);
  const cl = pickColors(rng, 5);
  const kinds: Kind[] = [
    { info: sh[0], color: cl[0], fill: 'solid' },
    { info: sh[0], color: cl[1], fill: chance(rng, 0.5) ? 'outline' : 'solid' },
    { info: sh[1], color: cl[2], fill: 'outline' },
    { info: sh[2], color: cl[3], fill: 'solid' },
    { info: sh[3], color: cl[4], fill: chance(rng, 0.5) ? 'outline' : 'solid' },
  ];
  // la trappola: stessa forma e stesso colore di una coppia, riempimento opposto
  const trapOn = kinds[randInt(rng, 2, 4)];
  const single: Kind = {
    info: trapOn.info,
    color: trapOn.color,
    fill: trapOn.fill === 'solid' ? 'outline' : 'solid',
  };
  return build(rng, 3, shuffle(rng, kinds), single, 'stessa forma, stesso colore e stesso riempimento');
}

export function genPairs(rng: Rng, difficulty: Difficulty): Question {
  const make = difficulty === 1 ? d1Pairs : difficulty === 2 ? d2Pairs : d3Pairs;
  return retry(() => make(rng), 40);
}
