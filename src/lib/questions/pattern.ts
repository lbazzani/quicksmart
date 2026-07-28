// Generatore "pattern": trame su griglia (4×4, 4×5, 5×5) in cui qualcosa si
// CONTA oppure si PREVEDE.
//
// d1 — conteggio attento di UNA sola proprietà (forma, colore, pieno/vuoto,
//      grande/piccolo) su 12-16 celle mescolate, oppure "quale forma vince".
// d2 — cella mancante con trama a scacchiera / righe-colonne / scorrimento di 1,
//      oppure conteggio in due passaggi (differenza fra due gruppi, forma+colore).
// d3 — trame posizionali non ovvie (quadrato latino, doppia diagonale, tripla
//      regola, scorrimento di 2-3) e conteggi di proprietà composte.
//
// Regole di qualità rispettate qui dentro:
//  - ogni conteggio è RICONTATO scorrendo la griglia costruita (mai stimato);
//  - i distrattori sono errori tipici: ±1/±2, il gruppo sbagliato, una sola
//    delle due proprietà, la riga/colonna vicina, lo scorrimento sbagliato;
//  - le trame delle celle mancanti sono sempre deducibili da tutte le altre
//    celle visibili (nessuna regola alternativa altrettanto semplice regge).

import type {
  CellSpec,
  ChoiceVisual,
  Difficulty,
  Question,
  QuestionType,
  ShapeName,
  ShapeSpec,
} from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

/** 'pattern' non è ancora dentro QuestionType: lo registrerà il coordinatore. */

// ---------------------------------------------------------------------------
// Vocabolario italiano (forme, colori, aggettivi) con accordi di genere/numero
// ---------------------------------------------------------------------------

interface ShapeInfo {
  shape: ShapeName;
  one: string; // "stella"
  many: string; // "stelle"
  f: boolean; // femminile
}

/** solo forme ben distinguibili anche in una cella piccola (56px) */
const SHAPES: ShapeInfo[] = [
  { shape: 'star', one: 'stella', many: 'stelle', f: true },
  { shape: 'circle', one: 'cerchio', many: 'cerchi', f: false },
  { shape: 'square', one: 'quadrato', many: 'quadrati', f: false },
  { shape: 'triangle', one: 'triangolo', many: 'triangoli', f: false },
  { shape: 'heart', one: 'cuore', many: 'cuori', f: false },
  { shape: 'diamond', one: 'rombo', many: 'rombi', f: false },
  { shape: 'moon', one: 'luna', many: 'lune', f: true },
  { shape: 'cross', one: 'croce', many: 'croci', f: true },
];

interface ColorInfo {
  idx: number; // indice nella PALETTE del renderer
  ms: string;
  fs: string;
  mp: string;
  fp: string;
  /** famiglia cromatica: due colori della stessa famiglia non vanno mai insieme */
  fam: string;
}

const COLORS: ColorInfo[] = [
  { idx: 0, ms: 'celeste', fs: 'celeste', mp: 'celesti', fp: 'celesti', fam: 'blu' },
  { idx: 6, ms: 'blu', fs: 'blu', mp: 'blu', fp: 'blu', fam: 'blu' },
  { idx: 1, ms: 'rosa', fs: 'rosa', mp: 'rosa', fp: 'rosa', fam: 'rosso' },
  { idx: 5, ms: 'rosso', fs: 'rossa', mp: 'rossi', fp: 'rosse', fam: 'rosso' },
  { idx: 2, ms: 'viola', fs: 'viola', mp: 'viola', fp: 'viola', fam: 'viola' },
  { idx: 4, ms: 'verde', fs: 'verde', mp: 'verdi', fp: 'verdi', fam: 'verde' },
  { idx: 3, ms: 'giallo', fs: 'gialla', mp: 'gialli', fp: 'gialle', fam: 'caldo' },
  { idx: 7, ms: 'arancione', fs: 'arancione', mp: 'arancioni', fp: 'arancioni', fam: 'caldo' },
];

const ORD = ['prima', 'seconda', 'terza', 'quarta', 'quinta'];

const FILL_ADJ = {
  solid: { ms: 'pieno', fs: 'piena', mp: 'pieni', fp: 'piene' },
  outline: { ms: 'vuoto', fs: 'vuota', mp: 'vuoti', fp: 'vuote' },
} as const;

const SIZE_ADJ = {
  big: { ms: 'grande', fs: 'grande', mp: 'grandi', fp: 'grandi' },
  small: { ms: 'piccolo', fs: 'piccola', mp: 'piccoli', fp: 'piccole' },
} as const;

interface Agr {
  ms: string;
  fs: string;
  mp: string;
  fp: string;
}

/** accorda un aggettivo con genere (f) e numero (pl) */
function agr(a: Agr, f: boolean, pl = true): string {
  return pl ? (f ? a.fp : a.mp) : f ? a.fs : a.ms;
}

const col = (c: ColorInfo, f: boolean, pl = true) => agr(c, f, pl);
const quanti = (s: ShapeInfo) => (s.f ? 'Quante' : 'Quanti');
const artPl = (s: ShapeInfo) => (s.f ? 'le' : 'i');
const unArt = (s: ShapeInfo) => (s.f ? 'una' : 'un');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** n colori distinti e di famiglie diverse (mai rosso+rosa, blu+celeste, …) */
function pickColors(rng: Rng, n: number): ColorInfo[] {
  const out: ColorInfo[] = [];
  const used = new Set<string>();
  for (const c of shuffle(rng, [...COLORS])) {
    if (used.has(c.fam)) continue;
    used.add(c.fam);
    out.push(c);
    if (out.length === n) return out;
  }
  throw new Error('colori distinguibili insufficienti');
}

// ---------------------------------------------------------------------------
// Helper di griglia + conteggi VERIFICATI
// ---------------------------------------------------------------------------

type Grid = CellSpec[][];
type Fill = 'solid' | 'outline';

const BIG = 0.92;
const SMALL = 0.5;

function mk(shape: ShapeName, color: number, fill: Fill = 'solid', size?: number): ShapeSpec {
  const s: ShapeSpec = { shape, color, fillMode: fill };
  if (size !== undefined) s.size = size;
  return s;
}

function gridFrom(rows: number, cols: number, at: (r: number, c: number) => ShapeSpec): Grid {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c): CellSpec => ({ shapes: [at(r, c)] }))
  );
}

function toGrid(cells: ShapeSpec[], rows: number, cols: number): Grid {
  if (cells.length !== rows * cols) throw new Error('celle ≠ righe×colonne');
  return Array.from({ length: rows }, (_, r) =>
    cells.slice(r * cols, (r + 1) * cols).map((s): CellSpec => ({ shapes: [s] }))
  );
}

/** sostituisce una cella con l'incognita "?" */
function hide(g: Grid, r: number, c: number): Grid {
  return g.map((row, ri) =>
    row.map((cell, ci) => (ri === r && ci === c ? ({ shapes: [], unknown: true } as CellSpec) : cell))
  );
}

type Pred = (s: ShapeSpec) => boolean;

/** conta scorrendo davvero la griglia (mai a occhio) */
function countIf(g: Grid, p: Pred): number {
  let n = 0;
  for (const row of g) for (const cell of row) for (const s of cell.shapes) if (p(s)) n++;
  return n;
}

function perRow(g: Grid, p: Pred): number[] {
  return g.map((row) => row.reduce((n, cell) => n + cell.shapes.filter(p).length, 0));
}

/** "2 + 0 + 3 + 1 = 6" */
function sumLine(v: number[]): string {
  return `${v.join(' + ')} = ${v.reduce((a, b) => a + b, 0)}`;
}

const isShape = (s: ShapeInfo): Pred => (x) => x.shape === s.shape;
const isColor = (c: ColorInfo): Pred => (x) => x.color === c.idx;
const isFill = (f: Fill): Pred => (x) => (x.fillMode ?? 'solid') === f;
const isBig = (big: boolean): Pred => (x) => ((x.size ?? 0.8) > 0.7) === big;

/** distribuisce `total` in k parti, ognuna fra min e max */
function splitTotal(rng: Rng, total: number, k: number, min: number, max: number): number[] {
  const parts = new Array<number>(k).fill(min);
  let rest = total - k * min;
  if (rest < 0 || rest > k * (max - min)) throw new Error('ripartizione impossibile');
  let guard = 0;
  while (rest > 0 && guard++ < 800) {
    const i = randInt(rng, 0, k - 1);
    if (parts[i] < max) {
      parts[i]++;
      rest--;
    }
  }
  if (rest > 0) throw new Error('ripartizione impossibile');
  return parts;
}

/**
 * Due distrattori numerici: prima quelli "concettuali" (conteggio del gruppo
 * sbagliato, di una sola proprietà, totale senza sottrazione), poi ±1/±2.
 */
function numChoices(rng: Rng, correct: number, prefer: number[]): [ChoiceVisual, ChoiceVisual] {
  const out: number[] = [];
  const add = (v: number) => {
    if (Number.isInteger(v) && v >= 1 && v !== correct && !out.includes(v) && out.length < 2) out.push(v);
  };
  for (const v of prefer) add(v);
  for (const v of [correct + 1, correct - 1, correct + 2, correct - 2, correct + 3]) add(v);
  if (out.length < 2) throw new Error('distrattori numerici insufficienti');
  shuffle(rng, out);
  return [
    { kind: 'text', text: String(out[0]) },
    { kind: 'text', text: String(out[1]) },
  ];
}

const cellChoice = (s: ShapeSpec): ChoiceVisual => ({ kind: 'cell', cell: { shapes: [s] } });

/** posizione dell'incognita: mai nella prima riga/colonna, così la trama "parte" visibile */
function hiddenPos(rng: Rng, rows: number, cols: number): [number, number] {
  return [randInt(rng, 1, rows - 1), randInt(rng, 1, cols - 1)];
}

function where(r: number, c: number): string {
  return `Il ? sta nella ${ORD[r]} riga e nella ${ORD[c]} colonna.`;
}

// ---------------------------------------------------------------------------
// d1 — conteggio attento di una sola proprietà
// ---------------------------------------------------------------------------

/** dimensioni per le griglie da contare */
function countDims(rng: Rng, small: boolean): [number, number] {
  const opts: [number, number][] = small
    ? [
        [3, 4],
        [4, 4],
        [3, 5],
      ]
    : [
        [4, 4],
        [4, 5],
      ];
  return pick(rng, opts);
}

/** d1a — "Quante stelle ci sono in tutto?" (3 forme mescolate, un colore ciascuna) */
function d1CountShape(rng: Rng): Question {
  const [rows, cols] = countDims(rng, true);
  const total = rows * cols;
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const parts = splitTotal(rng, total, 3, 3, 8);
  const cells: ShapeSpec[] = [];
  sh.forEach((s, i) => {
    for (let k = 0; k < parts[i]; k++) cells.push(mk(s.shape, cl[i].idx));
  });
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const ti = randInt(rng, 0, 2);
  const T = sh[ti];
  const n = countIf(g, isShape(T));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const others = sh.filter((_, i) => i !== ti);
  const oc = others.map((s) => countIf(g, isShape(s)));

  const [d1, d2] = numChoices(rng, n, oc);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: 1,
    prompt: `${quanti(T)} ${T.many} ci sono in tutto?`,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Il trucco è contare con ordine, una riga alla volta, senza saltare avanti e indietro: ` +
      `${sumLine(perRow(g, isShape(T)))}. ${cap(artPl(T))} ${T.many} sono ${n}; ` +
      `${artPl(others[0])} ${others[0].many} (${oc[0]}) e ${artPl(others[1])} ${others[1].many} (${oc[1]}) ` +
      `servono solo a confondere.`,
  };
}

/** d1b — "Quante figure verdi ci sono?" (una sola forma, 3 colori) */
function d1CountColor(rng: Rng): Question {
  const [rows, cols] = countDims(rng, true);
  const total = rows * cols;
  const S = pick(rng, SHAPES);
  const cl = pickColors(rng, 3);
  const parts = splitTotal(rng, total, 3, 3, 8);
  const cells: ShapeSpec[] = [];
  cl.forEach((c, i) => {
    for (let k = 0; k < parts[i]; k++) cells.push(mk(S.shape, c.idx));
  });
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const ti = randInt(rng, 0, 2);
  const T = cl[ti];
  const n = countIf(g, isColor(T));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const others = cl.filter((_, i) => i !== ti);
  const oc = others.map((c) => countIf(g, isColor(c)));

  const [d1, d2] = numChoices(rng, n, oc);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: 1,
    prompt: `Quante figure ${col(T, true)} ci sono in tutto?`,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Le forme sono tutte uguali: conta solo il colore, riga per riga. ` +
      `Figure ${col(T, true)}: ${sumLine(perRow(g, isColor(T)))}. ` +
      `(Le ${col(others[0], true)} sono ${oc[0]}, le ${col(others[1], true)} sono ${oc[1]}.)`,
  };
}

/** d1c — "Quante figure vuote ci sono?" (pieno/vuoto mescolati) */
function d1CountFill(rng: Rng): Question {
  const [rows, cols] = countDims(rng, true);
  const total = rows * cols;
  const sh = pickN(rng, SHAPES, randInt(rng, 1, 2));
  const cl = pickColors(rng, randInt(rng, 1, 2));
  const target: Fill = chance(rng, 0.5) ? 'outline' : 'solid';
  const nTarget = randInt(rng, 5, total - 5);
  const fills: Fill[] = [];
  for (let i = 0; i < total; i++) fills.push(i < nTarget ? target : target === 'solid' ? 'outline' : 'solid');
  shuffle(rng, fills);
  const cells = fills.map((f) => mk(pick(rng, sh).shape, pick(rng, cl).idx, f));
  const g = toGrid(cells, rows, cols);

  const n = countIf(g, isFill(target));
  if (n !== nTarget) throw new Error('conteggio incoerente');
  const other = total - n;
  const adjT = agr(FILL_ADJ[target], true);
  const adjO = agr(FILL_ADJ[target === 'solid' ? 'outline' : 'solid'], true);

  const [d1, d2] = numChoices(rng, n, [other]);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: 1,
    prompt: `Quante figure ${adjT}${target === 'outline' ? ' (solo il contorno)' : ''} ci sono?`,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Qui non conta né la forma né il colore: guarda solo se la figura è piena o solo contorno. ` +
      `Figure ${adjT}, riga per riga: ${sumLine(perRow(g, isFill(target)))}. ` +
      `Le ${adjO} sono ${other}: l'errore classico è contare il gruppo sbagliato.`,
  };
}

/** d1d — "Quante figure grandi ci sono?" */
function d1CountSize(rng: Rng): Question {
  const [rows, cols] = countDims(rng, true);
  const total = rows * cols;
  const sh = pickN(rng, SHAPES, randInt(rng, 1, 2));
  const cl = pickColors(rng, randInt(rng, 1, 2));
  const wantBig = chance(rng, 0.5);
  const nTarget = randInt(rng, 5, total - 5);
  const flags: boolean[] = [];
  for (let i = 0; i < total; i++) flags.push(i < nTarget ? wantBig : !wantBig);
  shuffle(rng, flags);
  const cells = flags.map((big) => mk(pick(rng, sh).shape, pick(rng, cl).idx, 'solid', big ? BIG : SMALL));
  const g = toGrid(cells, rows, cols);

  const n = countIf(g, isBig(wantBig));
  if (n !== nTarget) throw new Error('conteggio incoerente');
  const other = total - n;
  const adjT = agr(wantBig ? SIZE_ADJ.big : SIZE_ADJ.small, true);
  const adjO = agr(wantBig ? SIZE_ADJ.small : SIZE_ADJ.big, true);

  const [d1, d2] = numChoices(rng, n, [other]);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: 1,
    prompt: `Quante figure ${adjT} ci sono?`,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Conta solo la grandezza, riga per riga: ${sumLine(perRow(g, isBig(wantBig)))}. ` +
      `Le figure ${adjT} sono ${n}, quelle ${adjO} sono ${other} (in tutto ${total} celle).`,
  };
}

/** d1e — "Quale forma compare più volte?" (scarto garantito ≥ 2) */
function d1MostFrequent(rng: Rng): Question {
  const [rows, cols] = countDims(rng, true);
  const total = rows * cols;
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const parts = splitTotal(rng, total, 3, 3, 8);
  // garantisce un vincitore netto: scarto ≥ 2 dal secondo
  for (let guard = 0; guard < 20; guard++) {
    const sorted = [...parts].sort((a, b) => b - a);
    if (sorted[0] - sorted[1] >= 2) break;
    const i0 = parts.indexOf(sorted[0]);
    const i1 = parts.findIndex((v, i) => i !== i0 && v === sorted[1]);
    parts[i0]++;
    parts[i1]--;
  }
  if (Math.min(...parts) < 2) throw new Error('gruppo troppo piccolo');
  const cells: ShapeSpec[] = [];
  sh.forEach((s, i) => {
    for (let k = 0; k < parts[i]; k++) cells.push(mk(s.shape, cl[i].idx));
  });
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const counts = sh.map((s) => countIf(g, isShape(s)));
  const best = Math.max(...counts);
  const second = [...counts].sort((a, b) => b - a)[1];
  if (best - second < 2 || counts.filter((c) => c === best).length !== 1) throw new Error('vincitore non netto');
  const wi = counts.indexOf(best);
  const W = sh[wi];
  const others = sh.filter((_, i) => i !== wi);

  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: W.many }, [
    { kind: 'text', text: others[0].many },
    { kind: 'text', text: others[1].many },
  ]);
  return {
    qtype: 'pattern',
    difficulty: 1,
    prompt: 'Quale forma compare più volte?',
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Bisogna contare tutti e tre i gruppi, non fidarsi dell'impressione: ` +
      sh.map((s, i) => `${artPl(s)} ${s.many} sono ${counts[i]}`).join(', ') +
      `. Vincono ${artPl(W)} ${W.many} con ${best}.`,
  };
}

// ---------------------------------------------------------------------------
// Conteggio di una proprietà COMPOSTA (usato da d2 con forma+colore e da d3)
// ---------------------------------------------------------------------------

interface CompositeSetup {
  prompt: string;
  /** sintagma per la spiegazione: "figure piene", "stelle", "figure verdi" */
  aLabel: string;
  bLabel: string;
  /** costruisce una forma che soddisfa/non soddisfa le due proprietà */
  make: (a: boolean, b: boolean) => ShapeSpec;
  predA: Pred;
  predB: Pred;
  /** frase finale personalizzata ("piene E grandi insieme") */
  both: string;
}

function compositeCount(rng: Rng, difficulty: Difficulty, rows: number, cols: number, st: CompositeSetup): Question {
  const total = rows * cols;
  const n11 = randInt(rng, 3, 5);
  const n10 = randInt(rng, 2, 4);
  let n01 = randInt(rng, 2, 4);
  if (n01 === n10) n01 = n10 === 4 ? 2 : n10 + 1; // countA ≠ countB
  const n00 = total - n11 - n10 - n01;
  if (n00 < 2) throw new Error('griglia non bilanciata');

  const cells: ShapeSpec[] = [];
  const push = (n: number, a: boolean, b: boolean) => {
    for (let i = 0; i < n; i++) cells.push(st.make(a, b));
  };
  push(n11, true, true);
  push(n10, true, false);
  push(n01, false, true);
  push(n00, false, false);
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const both = (s: ShapeSpec) => st.predA(s) && st.predB(s);
  const nBoth = countIf(g, both);
  const nA = countIf(g, st.predA);
  const nB = countIf(g, st.predB);
  if (nBoth !== n11 || nA !== n11 + n10 || nB !== n11 + n01) throw new Error('conteggio incoerente');

  const [d1, d2] = numChoices(rng, nBoth, [nA, nB]);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(nBoth) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty,
    prompt: st.prompt,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Attenzione alla trappola: in tutto ci sono ${nA} ${st.aLabel} e ${nB} ${st.bLabel}, ` +
      `ma vanno contate solo le figure che sono ${st.both}: sono ${nBoth} ` +
      `(riga per riga: ${sumLine(perRow(g, both))}). Chi guarda una caratteristica sola risponde ${nA} o ${nB}.`,
  };
}

/** d2 — "Quante stelle verdi ci sono?" (forma E colore) */
function d2ShapeColor(rng: Rng): Question {
  const [rows, cols] = countDims(rng, false);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const [T, S1, S2] = sh;
  const [C, K1, K2] = cl;
  return compositeCount(rng, 2, rows, cols, {
    prompt: `${quanti(T)} ${T.many} ${col(C, T.f)} ci sono?`,
    aLabel: T.many,
    bLabel: `figure ${col(C, true)}`,
    both: `${T.many} E ${col(C, T.f)} insieme`,
    make: (a, b) =>
      mk(a ? T.shape : pick(rng, [S1, S2]).shape, b ? C.idx : pick(rng, [K1, K2]).idx),
    predA: isShape(T),
    predB: isColor(C),
  });
}

/** d3 — proprietà composta con due caratteristiche fra forma/colore/pieno/grande */
function d3Composite(rng: Rng): Question {
  const [rows, cols] = countDims(rng, false);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const [T, S1, S2] = sh;
  const [C, K1, K2] = cl;
  const otherShape = () => pick(rng, [S1, S2]).shape;
  const otherColor = () => pick(rng, [K1, K2]).idx;
  const anyShape = () => pick(rng, sh).shape;
  const anyColor = () => pick(rng, cl).idx;

  const kind = randInt(rng, 0, 4);
  const wantFill: Fill = chance(rng, 0.5) ? 'solid' : 'outline';
  const notFill: Fill = wantFill === 'solid' ? 'outline' : 'solid';
  const wantBig = chance(rng, 0.5);
  const fillAdjF = agr(FILL_ADJ[wantFill], true);
  const sizeAdjF = agr(wantBig ? SIZE_ADJ.big : SIZE_ADJ.small, true);
  const sz = (big: boolean) => (big ? BIG : SMALL);

  if (kind === 0) {
    // pieno/vuoto E grande/piccolo
    return compositeCount(rng, 3, rows, cols, {
      prompt: `Quante figure sono ${fillAdjF} E ${sizeAdjF} allo stesso tempo?`,
      aLabel: `figure ${fillAdjF}`,
      bLabel: `figure ${sizeAdjF}`,
      both: `${fillAdjF} E ${sizeAdjF} insieme`,
      make: (a, b) => mk(anyShape(), anyColor(), a ? wantFill : notFill, sz(b ? wantBig : !wantBig)),
      predA: isFill(wantFill),
      predB: isBig(wantBig),
    });
  }
  if (kind === 1) {
    // forma E pieno/vuoto
    return compositeCount(rng, 3, rows, cols, {
      prompt: `${quanti(T)} ${T.many} ${agr(FILL_ADJ[wantFill], T.f)} ci sono?`,
      aLabel: T.many,
      bLabel: `figure ${fillAdjF}`,
      both: `${T.many} E ${agr(FILL_ADJ[wantFill], T.f)} insieme`,
      make: (a, b) => mk(a ? T.shape : otherShape(), anyColor(), b ? wantFill : notFill),
      predA: isShape(T),
      predB: isFill(wantFill),
    });
  }
  if (kind === 2) {
    // forma E grandezza
    return compositeCount(rng, 3, rows, cols, {
      prompt: `${quanti(T)} ${T.many} ${agr(wantBig ? SIZE_ADJ.big : SIZE_ADJ.small, T.f)} ci sono?`,
      aLabel: T.many,
      bLabel: `figure ${sizeAdjF}`,
      both: `${T.many} E ${agr(wantBig ? SIZE_ADJ.big : SIZE_ADJ.small, T.f)} insieme`,
      make: (a, b) => mk(a ? T.shape : otherShape(), anyColor(), 'solid', sz(b ? wantBig : !wantBig)),
      predA: isShape(T),
      predB: isBig(wantBig),
    });
  }
  if (kind === 3) {
    // colore E grandezza
    return compositeCount(rng, 3, rows, cols, {
      prompt: `Quante figure ${col(C, true)} e ${sizeAdjF} ci sono?`,
      aLabel: `figure ${col(C, true)}`,
      bLabel: `figure ${sizeAdjF}`,
      both: `${col(C, true)} E ${sizeAdjF} insieme`,
      make: (a, b) => mk(anyShape(), a ? C.idx : otherColor(), 'solid', sz(b ? wantBig : !wantBig)),
      predA: isColor(C),
      predB: isBig(wantBig),
    });
  }
  // colore E pieno/vuoto
  return compositeCount(rng, 3, rows, cols, {
    prompt: `Quante figure ${col(C, true)} e ${fillAdjF} ci sono?`,
    aLabel: `figure ${col(C, true)}`,
    bLabel: `figure ${fillAdjF}`,
    both: `${col(C, true)} E ${fillAdjF} insieme`,
    make: (a, b) => mk(anyShape(), a ? C.idx : otherColor(), b ? wantFill : notFill),
    predA: isColor(C),
    predB: isFill(wantFill),
  });
}

// ---------------------------------------------------------------------------
// d2 — differenza fra due gruppi
// ---------------------------------------------------------------------------

function d2Difference(rng: Rng): Question {
  const [rows, cols] = countDims(rng, false);
  const total = rows * cols;
  const byColor = chance(rng, 0.5);
  const diff = randInt(rng, 2, 4);
  let nB = randInt(rng, 3, 5);
  // il conteggio del secondo gruppo non deve coincidere con la differenza:
  // altrimenti "ho contato solo le blu" darebbe per caso la risposta giusta
  if (nB === diff) nB = nB === 5 ? 3 : nB + 1;
  const nA = nB + diff;
  const nC = total - nA - nB;
  if (nC < 2) throw new Error('terzo gruppo troppo piccolo');

  const sh = pickN(rng, SHAPES, byColor ? 1 : 3);
  const cl = pickColors(rng, 3);
  const cells: ShapeSpec[] = [];
  const push = (n: number, gi: number) => {
    for (let i = 0; i < n; i++) {
      cells.push(byColor ? mk(sh[0].shape, cl[gi].idx) : mk(sh[gi].shape, cl[gi].idx));
    }
  };
  push(nA, 0);
  push(nB, 1);
  push(nC, 2);
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const pA = byColor ? isColor(cl[0]) : isShape(sh[0]);
  const pB = byColor ? isColor(cl[1]) : isShape(sh[1]);
  const cA = countIf(g, pA);
  const cB = countIf(g, pB);
  if (cA !== nA || cB !== nB || cA - cB !== diff) throw new Error('conteggio incoerente');

  const label = (i: number) =>
    byColor ? `figure ${col(cl[i], true)}` : `${sh[i].many} ${col(cl[i], sh[i].f)}`;
  const prompt = byColor
    ? `Quante figure ${col(cl[0], true)} ci sono in più rispetto a quelle ${col(cl[1], true)}?`
    : `${quanti(sh[0])} ${sh[0].many} ci sono in più rispetto ${sh[1].f ? 'alle' : 'ai'} ${sh[1].many}?`;

  const [d1, d2] = numChoices(rng, diff, [cA, cB]);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(diff) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: 2,
    prompt,
    payload: { kind: 'cells', rows: g },
    choices,
    correctIndex,
    explanation:
      `Servono due conteggi e una sottrazione. ${cap(label(0))}: ${sumLine(perRow(g, pA))}. ` +
      `${cap(label(1))}: ${sumLine(perRow(g, pB))}. La domanda chiede QUANTE IN PIÙ, ` +
      `quindi ${cA} − ${cB} = ${diff} (rispondere ${cA} vuol dire essersi dimenticati della sottrazione).`,
  };
}

// ---------------------------------------------------------------------------
// d2/d3 — celle mancanti: trame posizionali
// ---------------------------------------------------------------------------

/** d2 — scacchiera di due forme + un colore per riga */
function d2Checker(rng: Rng): Question {
  const rows = randInt(rng, 4, 5);
  const cols = randInt(rng, 4, 5);
  const [A, B] = pickN(rng, SHAPES, 2);
  const rc = pickColors(rng, rows);
  const at = (r: number, c: number) => mk((r + c) % 2 === 0 ? A.shape : B.shape, rc[r].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const correct = at(rm, cm);
  const here = (rm + cm) % 2 === 0 ? A : B;
  const there = (rm + cm) % 2 === 0 ? B : A;
  const ro = rm - 1;

  const dist: [ChoiceVisual, ChoiceVisual] = [
    cellChoice(mk(there.shape, rc[rm].idx)), // ha sbagliato l'alternanza
    cellChoice(mk(here.shape, rc[ro].idx)), // ha preso il colore della riga sopra
  ];
  const { choices, correctIndex } = placeChoices(rng, cellChoice(correct), dist);
  return {
    qtype: 'pattern',
    difficulty: 2,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Ci sono due regole. 1) Le forme si alternano come su una scacchiera: ogni cella è diversa da quelle ` +
      `sopra, sotto, a destra e a sinistra, ma uguale a quelle in diagonale. 2) Il colore dipende dalla riga: ` +
      `ogni riga ha il suo. ${where(rm, cm)} Quella riga è ${col(rc[rm], true, false)}, e lì tocca ` +
      `${unArt(here)} ${here.one}: quindi ${unArt(here)} ${here.one} ${col(rc[rm], here.f, false)}.`,
  };
}

/** d2 — la forma dipende dalla colonna, il colore dalla riga */
function d2RowCol(rng: Rng): Question {
  const rows = randInt(rng, 4, 5);
  const cols = randInt(rng, 4, 5);
  const cs = pickN(rng, SHAPES, cols);
  const rc = pickColors(rng, rows);
  const at = (r: number, c: number) => mk(cs[c].shape, rc[r].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);

  const dist: [ChoiceVisual, ChoiceVisual] = [
    cellChoice(mk(cs[cm - 1].shape, rc[rm].idx)), // forma della colonna accanto
    cellChoice(mk(cs[cm].shape, rc[rm - 1].idx)), // colore della riga sopra
  ];
  const { choices, correctIndex } = placeChoices(rng, cellChoice(at(rm, cm)), dist);
  return {
    qtype: 'pattern',
    difficulty: 2,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Guarda separatamente le colonne e le righe: ogni colonna ha sempre la stessa forma dall'alto in basso, ` +
      `ogni riga ha sempre lo stesso colore da sinistra a destra. ${where(rm, cm)} ` +
      `Quella è la colonna ${cs[cm].f ? 'delle' : 'dei'} ${cs[cm].many} e la riga ${col(rc[rm], true, false)}: ` +
      `ci va ${unArt(cs[cm])} ${cs[cm].one} ${col(rc[rm], cs[cm].f, false)}.`,
  };
}

/** simboli forma+colore usati nelle trame a scorrimento e nel quadrato latino */
function symbols(rng: Rng, k: number): { info: ShapeInfo; color: ColorInfo }[] {
  const sh = pickN(rng, SHAPES, k);
  const cl = pickColors(rng, k);
  return sh.map((info, i) => ({ info, color: cl[i] }));
}

const symSpec = (s: { info: ShapeInfo; color: ColorInfo }) => mk(s.info.shape, s.color.idx);
const symName = (s: { info: ShapeInfo; color: ColorInfo }) =>
  `${s.info.one} ${col(s.color, s.info.f, false)}`;

/** trame a scorrimento: la riga sotto ripete la riga sopra spostata di `shift` */
function shiftPattern(rng: Rng, difficulty: Difficulty, shift: number, rows: number, cols: number): Question {
  const k = cols;
  const sym = symbols(rng, k);
  const idx = (r: number, c: number) => ((c - shift * r) % k + k * 10) % k;
  const at = (r: number, c: number) => symSpec(sym[idx(r, c)]);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const ci = idx(rm, cm);

  // errori tipici: la figura della cella sopra, uno scorrimento sbagliato, il vicino di sinistra
  const cands = [idx(rm - 1, cm), ((cm - 1 * rm) % k + k * 10) % k, ((cm + 1 - shift * rm) % k + k * 10) % k, ((ci + 2) % k + k) % k];
  const picked: number[] = [];
  for (const v of cands) if (v !== ci && !picked.includes(v) && picked.length < 2) picked.push(v);
  if (picked.length < 2) throw new Error('distrattori insufficienti');

  const { choices, correctIndex } = placeChoices(rng, cellChoice(at(rm, cm)), [
    cellChoice(symSpec(sym[picked[0]])),
    cellChoice(symSpec(sym[picked[1]])),
  ]);
  const prev = sym[idx(rm, cm - 1 < 0 ? cols - 1 : cm - 1)];
  return {
    qtype: 'pattern',
    difficulty,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Ogni riga contiene le stesse ${k} figure della riga sopra, ma spostate di ${shift} ` +
      `${shift === 1 ? 'posto' : 'posti'} verso destra (chi esce a destra rientra a sinistra). ` +
      `Detto in un altro modo: scendendo di una riga e spostandosi di ${shift} ` +
      `${shift === 1 ? 'colonna' : 'colonne'} a destra si ritrova sempre la stessa figura. ` +
      `${where(rm, cm)} Nella sua riga, subito prima del ?, c'è ${symName(prev)}: dopo tocca a ` +
      `${symName(sym[ci])}.`,
  };
}

const d2Shift = (rng: Rng) => shiftPattern(rng, 2, 1, randInt(rng, 4, 5), randInt(rng, 4, 5));
const d3Shift = (rng: Rng) => shiftPattern(rng, 3, pick(rng, [2, 3]), randInt(rng, 4, 5), 5);

/** d3 — quadrato latino 4×4: ogni forma una volta per riga e per colonna */
function d3Latin(rng: Rng): Question {
  const k = 4;
  const sym = symbols(rng, k);
  // tutte le strutture di ordine 4 sono isotope a Z4 oppure a Z2×Z2
  const base = chance(rng, 0.5)
    ? (r: number, c: number) => (r + c) % k
    : (r: number, c: number) => r ^ c;
  const rp = shuffle(rng, [0, 1, 2, 3]);
  const cp = shuffle(rng, [0, 1, 2, 3]);
  const sp = shuffle(rng, [0, 1, 2, 3]);
  const L = (r: number, c: number) => sp[base(rp[r], cp[c])];
  const at = (r: number, c: number) => symSpec(sym[L(r, c)]);
  const rm = randInt(rng, 0, k - 1);
  const cm = randInt(rng, 0, k - 1);
  const g = gridFrom(k, k, at);

  // verifica: ogni riga e ogni colonna contengono tutti i simboli una volta sola
  for (let i = 0; i < k; i++) {
    const rowSet = new Set(Array.from({ length: k }, (_, j) => L(i, j)));
    const colSet = new Set(Array.from({ length: k }, (_, j) => L(j, i)));
    if (rowSet.size !== k || colSet.size !== k) throw new Error('quadrato latino non valido');
  }

  const correct = L(rm, cm);
  const wrong = shuffle(
    rng,
    Array.from({ length: k }, (_, i) => i).filter((i) => i !== correct)
  ).slice(0, 2);
  const rowOthers = Array.from({ length: k }, (_, c) => L(rm, c)).filter((s) => s !== correct);
  const colOthers = Array.from({ length: k }, (_, r) => L(r, cm)).filter((s) => s !== correct);

  const { choices, correctIndex } = placeChoices(rng, cellChoice(at(rm, cm)), [
    cellChoice(symSpec(sym[wrong[0]])),
    cellChoice(symSpec(sym[wrong[1]])),
  ]);
  return {
    qtype: 'pattern',
    difficulty: 3,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Qui non c'è una successione da indovinare: in ogni riga e in ogni colonna ciascuna delle 4 figure ` +
      `compare esattamente una volta. Si ragiona per esclusione. ${where(rm, cm)} ` +
      `Nella sua riga ci sono già ${rowOthers.map((s) => symName(sym[s])).join(', ')}: manca solo ` +
      `${symName(sym[correct])}. Controprova: nella sua colonna ci sono ` +
      `${colOthers.map((s) => symName(sym[s])).join(', ')}, e ${symName(sym[correct])} non c'è ancora.`,
  };
}

/** d3 — doppia diagonale: la forma segue riga+colonna, il colore segue colonna−riga */
function d3DoubleDiagonal(rng: Rng): Question {
  const rows = randInt(rng, 4, 5);
  const cols = randInt(rng, 4, 5);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const si = (r: number, c: number) => (r + c) % 3;
  const ki = (r: number, c: number) => (((c - r) % 3) + 3) % 3;
  const at = (r: number, c: number) => mk(sh[si(r, c)].shape, cl[ki(r, c)].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const S = sh[si(rm, cm)];
  const K = cl[ki(rm, cm)];

  const dist: [ChoiceVisual, ChoiceVisual] = [
    cellChoice(mk(sh[(si(rm, cm) + 1) % 3].shape, K.idx)), // forma della diagonale accanto
    cellChoice(mk(S.shape, cl[(ki(rm, cm) + 1) % 3].idx)), // colore della diagonale accanto
  ];
  const { choices, correctIndex } = placeChoices(rng, cellChoice(at(rm, cm)), dist);
  return {
    qtype: 'pattern',
    difficulty: 3,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Le due regole viaggiano su diagonali opposte. Le FORME si ripetono lungo le diagonali che salgono ` +
      `verso destra (↗): ${sh.map((s) => s.many).join(', ')} e poi da capo. I COLORI invece si ripetono ` +
      `lungo le diagonali che scendono verso destra (↘). ${where(rm, cm)} Seguendo la sua diagonale ↗ ` +
      `tocca ${unArt(S)} ${S.one}, seguendo la sua diagonale ↘ il colore è ${col(K, S.f, false)}: ` +
      `${unArt(S)} ${S.one} ${col(K, S.f, false)}.`,
  };
}

/** d3 — tre regole insieme: forma per riga, colore per colonna, pieno/vuoto a scacchiera */
function d3TripleRule(rng: Rng): Question {
  const rows = randInt(rng, 4, 5);
  const cols = randInt(rng, 4, 5);
  const rs = pickN(rng, SHAPES, rows);
  const cc = pickColors(rng, cols);
  const startSolid = chance(rng, 0.5);
  const fillAt = (r: number, c: number): Fill => (((r + c) % 2 === 0) === startSolid ? 'solid' : 'outline');
  const at = (r: number, c: number) => mk(rs[r].shape, cc[c].idx, fillAt(r, c));
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const S = rs[rm];
  const K = cc[cm];
  const F = fillAt(rm, cm);
  const notF: Fill = F === 'solid' ? 'outline' : 'solid';

  const variants: ChoiceVisual[] = [
    cellChoice(mk(S.shape, K.idx, notF)), // ha ignorato la scacchiera pieno/vuoto
    cellChoice(mk(S.shape, cc[cm - 1].idx, F)), // colore della colonna accanto
    cellChoice(mk(rs[rm - 1].shape, K.idx, F)), // forma della riga sopra
  ];
  const two = shuffle(rng, variants).slice(0, 2) as [ChoiceVisual, ChoiceVisual];
  const { choices, correctIndex } = placeChoices(rng, cellChoice(at(rm, cm)), two);
  return {
    qtype: 'pattern',
    difficulty: 3,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(g, rm, cm) },
    choices,
    correctIndex,
    explanation:
      `Tre regole lavorano insieme: la FORMA dipende dalla riga, il COLORE dalla colonna, e pieno/vuoto ` +
      `si alternano come su una scacchiera. ${where(rm, cm)} La sua riga è la riga ` +
      `${artPl(S) === 'le' ? 'delle' : 'dei'} ${S.many}, la sua colonna è quella ${col(K, true, false)}, ` +
      `e le celle vicine (sopra, sotto e di lato) sono ${agr(FILL_ADJ[notF], true)}: quindi ci va ${unArt(S)} ${S.one} ` +
      `${col(K, S.f, false)} ${agr(FILL_ADJ[F], S.f, false)}.`,
  };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const D1: Array<(rng: Rng) => Question> = [
  d1CountShape,
  d1CountColor,
  d1CountFill,
  d1CountSize,
  d1MostFrequent,
];

const D2: Array<(rng: Rng) => Question> = [
  d2Checker,
  d2RowCol,
  d2Shift,
  d2Difference,
  d2ShapeColor,
];

const D3: Array<(rng: Rng) => Question> = [
  d3Latin,
  d3DoubleDiagonal,
  d3TripleRule,
  d3Shift,
  d3Composite,
];

export function genPattern(rng: Rng, difficulty: Difficulty): Question {
  const pool = difficulty === 1 ? D1 : difficulty === 2 ? D2 : D3;
  return retry(() => pick(rng, pool)(rng));
}
