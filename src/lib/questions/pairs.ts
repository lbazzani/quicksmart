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

import type { CellSpec, Difficulty, LocalizedText, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pickN, randInt, shuffle, type Rng } from '../rng';
import { colorNameEn } from '../colors';
import { L } from '../localize';
import { placeChoices, retry } from './qutils';
import { FILL_ADJ, FILL_ADJ_EN, SHAPES, SHAPES_EN, agr, col, pickColors, unArt, type ColorInfo, type ShapeInfo } from './vocab';

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

/** ShapeInfoEn gemella di uno ShapeName (stesso set di SHAPES, indicizzato per nome) */
function shapeEn(shape: ShapeName) {
  return SHAPES_EN.find((s) => s.shape === shape) ?? SHAPES_EN[0];
}

/** "a"/"an" secondo il suono iniziale della parola che segue */
function artFor(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

/** come `name`, in inglese: gli aggettivi vanno prima del nome ("an empty yellow star") */
function nameEn(k: Kind, withFill: boolean): string {
  const color = colorNameEn(k.color.idx);
  const fill = withFill ? FILL_ADJ_EN[k.fill] : undefined;
  const bits = fill ? `${fill} ${color}` : color;
  return `${artFor(fill ?? color)} ${bits} ${shapeEn(k.info.shape).one}`;
}

/** "due stelle gialle (vuote)", in inglese: "two empty yellow stars" */
function twoEn(k: Kind, withFill: boolean): string {
  const color = colorNameEn(k.color.idx);
  const fill = withFill ? FILL_ADJ_EN[k.fill] : undefined;
  return `two ${fill ? `${fill} ` : ''}${color} ${shapeEn(k.info.shape).many}`;
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

function build(rng: Rng, difficulty: Difficulty, kinds: Kind[], single: Kind, promptRule: LocalizedText): Question {
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
    prompt: L(
      `Ogni figura ha la sua gemella (${promptRule.it}), una sola è rimasta sola: quale?`,
      `Every shape has its twin (${promptRule.en}), but only one is left alone: which one?`
    ),
    payload: { kind: 'cells', rows },
    choices,
    correctIndex,
    explanation: L(
      `Accoppia le figure una alla volta: ${kinds
        .slice(0, 3)
        .map((k) => `due ${k.info.many} ${col(k.color, k.info.f)}${withFill ? ` ${agr(FILL_ADJ[k.fill], k.info.f)}` : ''}`)
        .join(', ')}${kinds.length > 3 ? '…' : ''}. ` +
        `Alla fine resta ${name(single, withFill)}, senza gemella.`,
      `Pair up the shapes one at a time: ${kinds
        .slice(0, 3)
        .map((k) => twoEn(k, withFill))
        .join(', ')}${kinds.length > 3 ? '…' : ''}. ` +
        `In the end, ${nameEn(single, withFill)} is left without a twin.`
    ),
  };
}

function d1Pairs(rng: Rng): Question {
  const sh = pickN(rng, SHAPES, 4);
  const cl = pickColors(rng, 4);
  const kinds: Kind[] = sh.slice(0, 3).map((info, i) => ({ info, color: cl[i], fill: 'solid' }));
  const single: Kind = { info: sh[3], color: cl[3], fill: 'solid' };
  return build(rng, 1, kinds, single, L('stessa forma e stesso colore', 'the same shape and color'));
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
  return build(rng, 2, shuffle(rng, kinds), single, L('stessa forma e stesso colore', 'the same shape and color'));
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
  return build(rng, 3, shuffle(rng, kinds), single, L('stessa forma, stesso colore e stesso riempimento', 'the same shape, color, and fill'));
}

export function genPairs(rng: Rng, difficulty: Difficulty): Question {
  const make = difficulty === 1 ? d1Pairs : difficulty === 2 ? d2Pairs : d3Pairs;
  return retry(() => make(rng), 40);
}
