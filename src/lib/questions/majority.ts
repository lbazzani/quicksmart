// Generatore "majority": gruppi di figure a confronto — dove ce ne sono di più?
//
// Nato dai test in famiglia: serviva un gioco che si capisse al primo sguardo
// sul telefono, senza regole da imparare. Qui la consegna è una sola e la
// risposta si trova contando, non interpretando.
//
// d1 — 2 gruppi di figure tutte uguali dentro al gruppo: "Quale gruppo ha più
//      figure?" (o "Sono uguali": il pareggio esiste, così contare serve sempre).
// d2 — 3 gruppi misti: si conta UNA forma ("In quale gruppo ci sono più stelle?").
// d3 — come d2 ma il bersaglio è forma+colore ("più stelle gialle?"), e la
//      stessa forma compare anche in un altro colore: chi conta solo la forma
//      cade nella trappola.
//
// Regole di onestà (ereditate da pattern.ts):
//  - ogni conteggio è RICONTATO scorrendo le righe costruite, mai stimato;
//  - il gruppo vincente stacca TUTTI gli altri di almeno 2: chi perde il conto
//    di uno non cambia risposta;
//  - righe da 5 celle al massimo: a 56px si contano ancora bene sul telefono;
//  - quando il criterio è un colore, mai due colori confondibili nella stessa
//    domanda (pickColors usa le coppie CONFUSABLE di ../colors).

import type { CellSpec, ChoiceVisual, Difficulty, Question, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';
import { SHAPES, artPl, cap, col, pickColors, type ColorInfo, type ShapeInfo } from './vocab';

const GROUP_LABEL = ['Gruppo 1', 'Gruppo 2', 'Gruppo 3'];
/** etichetta vuota ma presente: tiene le celle della riga allineate */
const NO_LABEL = ' ';

/** scarto minimo del gruppo vincente da ogni altro */
const GAP = 2;

function rowOf(shapes: ShapeSpec[], group: number): CellSpec[] {
  return shapes.map((s, i) => ({ shapes: [s], label: i === 0 ? GROUP_LABEL[group] : NO_LABEL }));
}

function groupsPayload(rows: CellSpec[][]): Question['payload'] {
  return { kind: 'cells', rows, groups: true };
}

const groupChoice = (i: number): ChoiceVisual => ({ kind: 'text', text: GROUP_LABEL[i] });

/** conta nella riga le figure che soddisfano il predicato (sempre ricontato) */
function countRow(row: CellSpec[], p: (s: ShapeSpec) => boolean): number {
  return row.reduce((n, cell) => n + cell.shapes.filter(p).length, 0);
}

// ---------------------------------------------------------------------------
// d1 — due gruppi omogenei: quale ha più figure? (o sono uguali)
// ---------------------------------------------------------------------------

function d1TwoGroups(rng: Rng): Question {
  const [sa, sb] = pickN(rng, SHAPES, 2);
  const [ca, cb] = pickColors(rng, 2);
  const tie = chance(rng, 0.34);
  let na: number;
  let nb: number;
  if (tie) {
    na = nb = randInt(rng, 3, 5);
  } else {
    na = randInt(rng, 4, 5);
    nb = randInt(rng, 2, na - GAP);
    if (chance(rng, 0.5)) [na, nb] = [nb, na];
  }
  const rows = [
    rowOf(Array.from({ length: na }, () => ({ shape: sa.shape, color: ca.idx })), 0),
    rowOf(Array.from({ length: nb }, () => ({ shape: sb.shape, color: cb.idx })), 1),
  ];
  // ricontato sul disegno, non sui piani
  const ra = countRow(rows[0], () => true);
  const rb = countRow(rows[1], () => true);
  if (ra !== na || rb !== nb) throw new Error('conteggio incoerente');

  const pari: ChoiceVisual = { kind: 'text', text: 'Sono uguali' };
  const correct = ra === rb ? pari : groupChoice(ra > rb ? 0 : 1);
  const distractors = (ra === rb ? [groupChoice(0), groupChoice(1)] : [groupChoice(ra > rb ? 1 : 0), pari]) as [
    ChoiceVisual,
    ChoiceVisual,
  ];
  const { choices, correctIndex } = placeChoices(rng, correct, distractors);

  const descr = (s: ShapeInfo, c: ColorInfo, n: number) => `${n} ${s.many} ${col(c, s.f)}`;
  return {
    qtype: 'majority',
    difficulty: 1,
    prompt: 'Quale gruppo ha più figure?',
    payload: groupsPayload(rows),
    choices,
    correctIndex,
    explanation:
      `Basta contare le due file. Nel Gruppo 1 ci sono ${descr(sa, ca, ra)}, nel Gruppo 2 ${descr(sb, cb, rb)}: ` +
      (ra === rb
        ? 'sono pari, nessuno dei due vince.'
        : `vince il Gruppo ${ra > rb ? 1 : 2} con ${Math.max(ra, rb) - Math.min(ra, rb)} figure in più.`),
  };
}

// ---------------------------------------------------------------------------
// d2/d3 — tre gruppi misti: dove ci sono più figure bersaglio?
// ---------------------------------------------------------------------------

/**
 * Piano dei conteggi bersaglio nei 3 gruppi: il vincitore stacca gli altri di
 * almeno GAP, e nessun gruppo è vuoto di bersagli a d2 (un gruppo senza stelle
 * quando la domanda chiede le stelle sembra un errore di stampa).
 */
function targetPlan(rng: Rng, rowLen: number, minLoser: number): { counts: number[]; winner: number } {
  const win = randInt(rng, minLoser + GAP + 1, rowLen - 1); // almeno 1 riempitivo anche nel gruppo pieno
  const losers = [randInt(rng, minLoser, win - GAP), randInt(rng, minLoser, win - GAP)];
  const winner = randInt(rng, 0, 2);
  const counts = [...losers.slice(0, winner), win, ...losers.slice(winner)];
  return { counts, winner };
}

function d2MostShape(rng: Rng): Question {
  const rowLen = 5;
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const T = sh[0]; // bersaglio
  const { counts, winner } = targetPlan(rng, rowLen, 1);

  const rows = counts.map((n, g) => {
    const cells: ShapeSpec[] = [
      ...Array.from({ length: n }, () => ({ shape: T.shape, color: cl[0].idx })),
      ...Array.from({ length: rowLen - n }, () => {
        const other = pick(rng, sh.slice(1));
        return { shape: other.shape, color: cl[sh.indexOf(other)].idx };
      }),
    ];
    return rowOf(shuffle(rng, cells), g);
  });

  const found = rows.map((r) => countRow(r, (s) => s.shape === T.shape));
  found.forEach((n, g) => {
    if (n !== counts[g]) throw new Error('conteggio incoerente');
  });

  const others = [0, 1, 2].filter((g) => g !== winner) as [number, number];
  const { choices, correctIndex } = placeChoices(rng, groupChoice(winner), [
    groupChoice(others[0]),
    groupChoice(others[1]),
  ]);
  return {
    qtype: 'majority',
    difficulty: 2,
    prompt: `In quale gruppo ci sono più ${T.many}?`,
    payload: groupsPayload(rows),
    choices,
    correctIndex,
    explanation:
      `Le altre figure non contano: si contano solo ${artPl(T)} ${T.many}, gruppo per gruppo. ` +
      `${cap(found.map((n, g) => `${n} nel Gruppo ${g + 1}`).join(', '))}. ` +
      `Vince il Gruppo ${winner + 1} con ${counts[winner] - Math.max(...found.filter((_, g) => g !== winner))} in più.`,
  };
}

function d3MostShapeColor(rng: Rng): Question {
  const rowLen = 5;
  const sh = pickN(rng, SHAPES, 2);
  const cl = pickColors(rng, 3);
  const T = sh[0]; // forma bersaglio
  const CT = cl[0]; // colore bersaglio
  const CB = cl[1]; // stessa forma, altro colore: la trappola
  const { counts, winner } = targetPlan(rng, rowLen - 1, 0);

  const rows = counts.map((n, g) => {
    const rest = rowLen - n;
    // almeno una figura-trappola per gruppo: la forma giusta nel colore sbagliato
    const traps = randInt(rng, 1, Math.max(1, rest - 1));
    const cells: ShapeSpec[] = [
      ...Array.from({ length: n }, () => ({ shape: T.shape, color: CT.idx })),
      ...Array.from({ length: traps }, () => ({ shape: T.shape, color: CB.idx })),
      ...Array.from({ length: rest - traps }, () => ({ shape: sh[1].shape, color: cl[2].idx })),
    ];
    return rowOf(shuffle(rng, cells), g);
  });

  const isTarget = (s: ShapeSpec) => s.shape === T.shape && s.color === CT.idx;
  const found = rows.map((r) => countRow(r, isTarget));
  found.forEach((n, g) => {
    if (n !== counts[g]) throw new Error('conteggio incoerente');
  });
  // la trappola deve fare la differenza: contando la sola forma il vincitore
  // non deve essere così netto (altrimenti tanto vale ignorare il colore)
  const byShape = rows.map((r) => countRow(r, (s) => s.shape === T.shape));
  const shapeWinner = byShape.indexOf(Math.max(...byShape));
  if (shapeWinner === winner && byShape[winner] - Math.max(...byShape.filter((_, g) => g !== winner)) >= GAP) {
    throw new Error('trappola inefficace: vince anche contando solo la forma');
  }

  const others = [0, 1, 2].filter((g) => g !== winner) as [number, number];
  const { choices, correctIndex } = placeChoices(rng, groupChoice(winner), [
    groupChoice(others[0]),
    groupChoice(others[1]),
  ]);
  return {
    qtype: 'majority',
    difficulty: 3,
    prompt: `In quale gruppo ci sono più ${T.many} ${col(CT, T.f)}?`,
    payload: groupsPayload(rows),
    choices,
    correctIndex,
    explanation:
      `Attenzione: in ogni gruppo ci sono anche ${T.many} ${col(CB, T.f)}, che non valgono. ` +
      `Contando solo ${artPl(T)} ${T.many} ${col(CT, T.f)}: ` +
      `${found.map((n, g) => `${n} nel Gruppo ${g + 1}`).join(', ')}. ` +
      `Vince il Gruppo ${winner + 1}.`,
  };
}

export function genMajority(rng: Rng, difficulty: Difficulty): Question {
  const make = difficulty === 1 ? d1TwoGroups : difficulty === 2 ? d2MostShape : d3MostShapeColor;
  return retry(() => make(rng), 40);
}
