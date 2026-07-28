// Generatore "pattern": trame su griglia in cui qualcosa si CONTA oppure si
// PREVEDE.
//
// d1 — conteggio attento di UNA sola proprietà (forma, colore, pieno/vuoto,
//      grande/piccolo) su una griglia PICCOLA (max 12 celle) con le figure
//      uguali RAGGRUPPATE, oppure "quale forma vince".
// d2 — cella mancante con trama a scacchiera / righe-colonne / scorrimento di 1,
//      oppure conteggio in due passaggi (differenza fra due gruppi, forma+colore).
// d3 — trame posizionali non ovvie (quadrato latino, doppia diagonale, tripla
//      regola, scorrimento di 2-3) e conteggi di proprietà composte.
//
// Regole di qualità, tutte verificabili DALL'ESTERNO guardando solo le domande
// prodotte (i controlli sono anche qui dentro, e fanno scartare la domanda):
//  1) ogni conteggio è RICONTATO scorrendo la griglia costruita (mai stimato);
//  2) in un quesito di conteggio ogni distrattore dista ALMENO 2 dalla risposta:
//     chi ha capito il compito e perde il conto di uno non trova mai la sua
//     svista fra le opzioni (era il difetto più grave: 7 al posto di 6);
//  3) quando la domanda nomina un colore, due colori della griglia non hanno mai
//     lo stesso numero di figure (il controconteggio resta una prova valida);
//  4) due colori che a 56px si somigliano (CONFUSABLE in ../colors) non stanno
//     mai nella stessa domanda: nessuna risposta si gioca su una sfumatura;
//  5) a d1 la griglia ha al massimo 12 celle e le figure dello stesso tipo sono
//     vicine, così contare è un compito onesto e non una caccia al tesoro;
//  6) le trame delle celle mancanti sono deducibili da tutte le celle visibili.

import type {
  CellSpec,
  ChoiceVisual,
  Difficulty,
  Question,
  ShapeName,
  ShapeSpec,
} from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { COLOR_NAMES, tooSimilar } from '../colors';
import { placeChoices, retry, balancedNumericDistractors } from './qutils';

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

interface Agr {
  ms: string;
  fs: string;
  mp: string;
  fp: string;
}

interface ColorInfo extends Agr {
  idx: number; // indice nella PALETTE del renderer
}

/**
 * Flessioni dei nomi colore. I NOMI arrivano da ../colors (COLOR_NAMES): qui si
 * aggiunge solo l'accordo di genere e numero, così una domanda non chiamerà mai
 * "blu" quello che un'altra chiama "azzurro".
 */
const INFLECTION: Record<string, [string, string, string, string]> = {
  ciano: ['ciano', 'ciano', 'ciano', 'ciano'],
  rosa: ['rosa', 'rosa', 'rosa', 'rosa'],
  viola: ['viola', 'viola', 'viola', 'viola'],
  giallo: ['giallo', 'gialla', 'gialli', 'gialle'],
  verde: ['verde', 'verde', 'verdi', 'verdi'],
  rosso: ['rosso', 'rossa', 'rossi', 'rosse'],
  azzurro: ['azzurro', 'azzurra', 'azzurri', 'azzurre'],
  arancione: ['arancione', 'arancione', 'arancioni', 'arancioni'],
};

const COLORS: ColorInfo[] = COLOR_NAMES.map((name, idx) => {
  const [ms, fs, mp, fp] = INFLECTION[name] ?? [name, name, name, name];
  return { idx, ms, fs, mp, fp };
});

const ORD = ['prima', 'seconda', 'terza', 'quarta', 'quinta'];

const FILL_ADJ = {
  solid: { ms: 'pieno', fs: 'piena', mp: 'pieni', fp: 'piene' },
  outline: { ms: 'vuoto', fs: 'vuota', mp: 'vuoti', fp: 'vuote' },
} as const;

const SIZE_ADJ = {
  big: { ms: 'grande', fs: 'grande', mp: 'grandi', fp: 'grandi' },
  small: { ms: 'piccolo', fs: 'piccola', mp: 'piccoli', fp: 'piccole' },
} as const;

/** accorda un aggettivo con genere (f) e numero (pl) */
function agr(a: Agr, f: boolean, pl = true): string {
  return pl ? (f ? a.fp : a.mp) : f ? a.fs : a.ms;
}

const col = (c: ColorInfo, f: boolean, pl = true) => agr(c, f, pl);
const quanti = (s: ShapeInfo) => (s.f ? 'Quante' : 'Quanti');
const artPl = (s: ShapeInfo) => (s.f ? 'le' : 'i');
const unArt = (s: ShapeInfo) => (s.f ? 'una' : 'un');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * n colori distinti e mai somiglianti fra loro (CONFUSABLE di ../colors).
 * Con quelle esclusioni il massimo ottenibile è 4: le trame che avrebbero
 * bisogno di più colori usano meno righe/colonne, oppure distinguono i simboli
 * anche per forma.
 */
function pickColors(rng: Rng, n: number): ColorInfo[] {
  const out: ColorInfo[] = [];
  for (const c of shuffle(rng, [...COLORS])) {
    if (out.some((o) => tooSimilar(o.idx, c.idx))) continue;
    out.push(c);
    if (out.length === n) return out;
  }
  throw new Error(`colori distinguibili insufficienti (${n})`);
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

/** quante figure per ogni colore presente nella griglia */
function colorTally(g: Grid): Map<number, number> {
  const m = new Map<number, number>();
  for (const row of g)
    for (const cell of row)
      for (const s of cell.shapes) {
        const k = s.color ?? 0;
        m.set(k, (m.get(k) ?? 0) + 1);
      }
  return m;
}

/** nessuna coppia di colori somiglianti nella stessa domanda */
function guardColors(g: Grid, extra: ShapeSpec[] = []): void {
  const set = new Set<number>(colorTally(g).keys());
  for (const s of extra) set.add(s.color ?? 0);
  const c = [...set];
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++)
      if (tooSimilar(c[i], c[j])) throw new Error(`colori confondibili insieme: ${c[i]}/${c[j]}`);
}

/** due colori con lo stesso numero di figure renderebbero ambiguo il conteggio */
function guardColorCounts(g: Grid): void {
  const v = [...colorTally(g).values()];
  if (new Set(v).size !== v.length) throw new Error('due colori a pari conteggio');
}

// ---------------------------------------------------------------------------
// Ripartizioni e opzioni numeriche dei quesiti di CONTEGGIO
// ---------------------------------------------------------------------------

/** distanza minima fra la risposta e ogni distrattore in un conteggio */
const GAP = 2;

/** tutti gli insiemi di k numeri DIVERSI fra min e max che sommano a total */
function partitionSets(total: number, k: number, min: number, max: number): number[][] {
  const out: number[][] = [];
  const rec = (from: number, left: number, rest: number, acc: number[]) => {
    if (rest === 0) {
      if (left === 0) out.push([...acc]);
      return;
    }
    for (let v = from; v <= max; v++) {
      if (v * rest > left) break; // i valori successivi sono ancora più grandi
      acc.push(v);
      rec(v + 1, left - v, rest - 1, acc);
      acc.pop();
    }
  };
  rec(min, total, k, []);
  return out;
}

/**
 * Piano di conteggio: quante figure per gruppo e QUALE gruppo si conta.
 * Invariante: il gruppo da contare dista almeno GAP da ogni altro gruppo, e
 * tutti i gruppi hanno numeri diversi fra loro. Così il "conteggio del gruppo
 * sbagliato" è un distrattore lecito e non capita mai a distanza 1.
 */
function countPlan(
  rng: Rng,
  total: number,
  k: number,
  min: number,
  max: number,
  mode: 'any' | 'max' = 'any'
): { parts: number[]; ti: number } {
  const clear = (s: number[], i: number) => s.every((w, j) => j === i || Math.abs(w - s[i]) >= GAP);
  const sets = partitionSets(total, k, min, max).filter((s) =>
    mode === 'max' ? clear(s, s.length - 1) : s.some((_, i) => clear(s, i))
  );
  if (!sets.length) throw new Error(`nessuna ripartizione contabile (${total} in ${k})`);
  const set = pick(rng, sets);
  const parts = shuffle(rng, [...set]);
  if (mode === 'max') return { parts, ti: parts.indexOf(Math.max(...parts)) };
  const cands = parts.map((_, i) => i).filter((i) => clear(parts, i));
  return { parts, ti: pick(rng, cands) };
}

/**
 * Due distrattori numerici: prima gli errori "concettuali" (il conteggio del
 * gruppo sbagliato, di una sola delle due proprietà, il totale senza
 * sottrazione), poi valori vicini — ma MAI a distanza 1 dalla risposta.
 */
function countChoices(
  rng: Rng,
  correct: number,
  prefer: number[],
  maxAnswer: number
): [ChoiceVisual, ChoiceVisual] {
  // mai "1": in una griglia piena di figure nessuno conterebbe una sola cosa.
  // GAP: una svista di uno non deve trovare casa fra le opzioni.
  const usable = (v: number) =>
    Number.isInteger(v) && v >= 2 && v <= maxAnswer && Math.abs(v - correct) >= GAP;

  // Tutti gli errori plausibili, concettuali e di conteggio, da entrambi i lati.
  const pool = [
    ...prefer,
    ...[2, 3, 4].map((d) => correct - d),
    ...[2, 3, 4].map((d) => correct + d),
  ].filter(usable);

  // La risposta deve finire tanto in mezzo quanto agli estremi: se i distrattori
  // stessero sempre sopra (come accade nei conteggi di intersezione, dove la
  // risposta è per forza minore dei conteggi parziali) basterebbe scegliere il
  // numero più piccolo per vincere senza contare niente.
  const balanced = balancedNumericDistractors(rng, correct, pool, GAP);
  if (!balanced) throw new Error('distrattori numerici insufficienti');

  // fra due candidati equivalenti si preferisce l'errore concettuale
  const out = [...balanced];
  const preferred = prefer.filter(usable);
  for (const p of preferred) {
    if (out.includes(p)) continue;
    const swap = out.findIndex((v) => v !== p && Math.sign(v - correct) === Math.sign(p - correct));
    if (swap >= 0) out[swap] = p;
  }
  shuffle(rng, out);
  return [
    { kind: 'text', text: String(out[0]) },
    { kind: 'text', text: String(out[1]) },
  ];
}

interface CountQuestion {
  rng: Rng;
  difficulty: Difficulty;
  grid: Grid;
  prompt: string;
  correct: number;
  /** errori concettuali da offrire come distrattori, se abbastanza lontani */
  prefer: number[];
  explanation: string;
  /** la domanda nomina un colore: i conteggi per colore devono essere diversi */
  colorCriterion?: boolean;
}

/**
 * Risposta minima di un conteggio. Sotto il 5 non esistono due numeri più
 * piccoli plausibili (il 2 è il minimo offribile e la distanza minima è 2),
 * quindi la risposta finirebbe sempre a essere la più piccola delle tre e
 * basterebbe scegliere quella per vincere senza contare nulla.
 */
const MIN_COUNT_ANSWER = 5;

/** unico punto in cui nasce un quesito di conteggio: qui valgono tutti i controlli */
function countQuestion(q: CountQuestion): Question {
  guardColors(q.grid);
  if (q.colorCriterion) guardColorCounts(q.grid);
  if (q.correct < MIN_COUNT_ANSWER) throw new Error('conteggio troppo piccolo per distrattori equilibrati');
  const maxAnswer = q.grid.length * q.grid[0].length;
  const [d1, d2] = countChoices(q.rng, q.correct, q.prefer, maxAnswer);
  const { choices, correctIndex } = placeChoices(q.rng, { kind: 'text', text: String(q.correct) }, [d1, d2]);
  return {
    qtype: 'pattern',
    difficulty: q.difficulty,
    prompt: q.prompt,
    payload: { kind: 'cells', rows: q.grid },
    choices,
    correctIndex,
    explanation: q.explanation,
  };
}

/** unico punto in cui nasce una domanda "quale figura va nella cella mancante" */
function cellQuestion(
  rng: Rng,
  difficulty: Difficulty,
  grid: Grid,
  hidden: [number, number],
  correct: ShapeSpec,
  distractors: [ShapeSpec, ShapeSpec],
  explanation: string
): Question {
  guardColors(grid, [correct, ...distractors]);
  const { choices, correctIndex } = placeChoices(rng, cellChoice(correct), [
    cellChoice(distractors[0]),
    cellChoice(distractors[1]),
  ]);
  return {
    qtype: 'pattern',
    difficulty,
    prompt: 'Quale figura va nella cella mancante?',
    payload: { kind: 'cells', rows: hide(grid, hidden[0], hidden[1]) },
    choices,
    correctIndex,
    explanation,
  };
}

const cellChoice = (s: ShapeSpec): ChoiceVisual => ({ kind: 'cell', cell: { shapes: [s] } });

/**
 * Mette le figure dello stesso gruppo tutte VICINE (blocchi contigui, in ordine
 * di lettura, con l'ordine dei blocchi mescolato). Contare diventa scorrere una
 * fila, non cercare figure sparse: chi ragiona bene arriva al numero giusto.
 */
function groupedCells(rng: Rng, blocks: ShapeSpec[][]): ShapeSpec[] {
  return shuffle(
    rng,
    blocks.map((b) => shuffle(rng, [...b]))
  ).flat();
}

/** posizione dell'incognita: mai nella prima riga/colonna, così la trama "parte" visibile */
function hiddenPos(rng: Rng, rows: number, cols: number): [number, number] {
  return [randInt(rng, 1, rows - 1), randInt(rng, 1, cols - 1)];
}

function where(r: number, c: number): string {
  return `Il ? sta nella ${ORD[r]} riga e nella ${ORD[c]} colonna.`;
}

// ---------------------------------------------------------------------------
// d1 — conteggio attento di una sola proprietà (max 12 celle, figure vicine)
// ---------------------------------------------------------------------------

/** griglie piccole: 3×3, 3×4 o 4×3 — non più di 12 figure da contare */
function d1Dims(rng: Rng, minCells = 9): [number, number] {
  const opts: [number, number][] = [
    [3, 3],
    [3, 4],
    [4, 3],
  ];
  return pick(rng, opts.filter(([r, c]) => r * c >= minCells));
}

/** limite superiore ragionevole per un gruppo */
const maxPart = (total: number) => Math.min(total - 2, 9);

/** d1a — "Quante stelle ci sono in tutto?" (2-3 forme, una per colore) */
function d1CountShape(rng: Rng): Question {
  const [rows, cols] = d1Dims(rng);
  const total = rows * cols;
  const k = total >= 12 ? pick(rng, [2, 3]) : 2;
  const { parts, ti } = countPlan(rng, total, k, 2, maxPart(total));
  const sh = pickN(rng, SHAPES, k);
  const cl = pickColors(rng, k);
  const g = toGrid(
    groupedCells(
      rng,
      parts.map((n, i) => Array.from({ length: n }, () => mk(sh[i].shape, cl[i].idx)))
    ),
    rows,
    cols
  );

  const T = sh[ti];
  const n = countIf(g, isShape(T));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const others = sh.filter((_, i) => i !== ti);
  const oc = others.map((s) => countIf(g, isShape(s)));

  return countQuestion({
    rng,
    difficulty: 1,
    grid: g,
    prompt: `${quanti(T)} ${T.many} ci sono in tutto?`,
    correct: n,
    prefer: oc,
    colorCriterion: false,
    explanation:
      `${cap(artPl(T))} ${T.many} stanno tutt${T.f ? 'e' : 'i'} in un blocco: ` +
      `basta contarl${T.f ? 'e' : 'i'} con ordine, una riga alla volta. ` +
      `${sumLine(perRow(g, isShape(T)))}, quindi ${n}. ` +
      cap(others.map((s, i) => `${artPl(s)} ${s.many} sono ${oc[i]}`).join(', ')) +
      `: sono lì solo per confondere.`,
  });
}

/** d1b — "Quante figure verdi ci sono?" (una sola forma, 2-3 colori) */
function d1CountColor(rng: Rng): Question {
  const [rows, cols] = d1Dims(rng);
  const total = rows * cols;
  const k = total >= 12 ? pick(rng, [2, 3]) : 2;
  const { parts, ti } = countPlan(rng, total, k, 2, maxPart(total));
  const S = pick(rng, SHAPES);
  const cl = pickColors(rng, k);
  const g = toGrid(
    groupedCells(
      rng,
      parts.map((n, i) => Array.from({ length: n }, () => mk(S.shape, cl[i].idx)))
    ),
    rows,
    cols
  );

  const T = cl[ti];
  const n = countIf(g, isColor(T));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const others = cl.filter((_, i) => i !== ti);
  const oc = others.map((c) => countIf(g, isColor(c)));

  return countQuestion({
    rng,
    difficulty: 1,
    grid: g,
    prompt: `Quante figure ${col(T, true)} ci sono in tutto?`,
    correct: n,
    prefer: oc,
    colorCriterion: true,
    explanation:
      `Le forme sono tutte uguali: conta solo il colore. Le figure ${col(T, true)} stanno vicine, ` +
      `riga per riga sono ${sumLine(perRow(g, isColor(T)))}. ` +
      cap(others.map((c, i) => `le ${col(c, true)} sono ${oc[i]}`).join(', ')) + '.',
  });
}

/** d1c — "Quante figure vuote ci sono?" (pieno/vuoto, raggruppate) */
function d1CountFill(rng: Rng): Question {
  const [rows, cols] = d1Dims(rng);
  const total = rows * cols;
  const { parts, ti } = countPlan(rng, total, 2, 2, maxPart(total));
  const target: Fill = chance(rng, 0.5) ? 'outline' : 'solid';
  const other: Fill = target === 'solid' ? 'outline' : 'solid';
  const sh = pickN(rng, SHAPES, randInt(rng, 1, 2));
  const cl = pickColors(rng, randInt(rng, 1, 2));
  const deco = (f: Fill) => mk(pick(rng, sh).shape, pick(rng, cl).idx, f);
  const g = toGrid(
    groupedCells(rng, [
      Array.from({ length: parts[ti] }, () => deco(target)),
      Array.from({ length: parts[1 - ti] }, () => deco(other)),
    ]),
    rows,
    cols
  );

  const n = countIf(g, isFill(target));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const nOther = total - n;
  const adjT = agr(FILL_ADJ[target], true);
  const adjO = agr(FILL_ADJ[other], true);

  return countQuestion({
    rng,
    difficulty: 1,
    grid: g,
    prompt: `Quante figure ${adjT}${target === 'outline' ? ' (solo il contorno)' : ''} ci sono?`,
    correct: n,
    prefer: [nOther],
    colorCriterion: false,
    explanation:
      `Qui non conta né la forma né il colore: guarda solo se la figura è piena o è solo contorno. ` +
      `Le figure ${adjT} stanno tutte vicine: ${sumLine(perRow(g, isFill(target)))}, quindi ${n}. ` +
      `Le ${adjO} sono ${nOther}: l'errore classico è contare il gruppo sbagliato.`,
  });
}

/** d1d — "Quante figure grandi ci sono?" */
function d1CountSize(rng: Rng): Question {
  const [rows, cols] = d1Dims(rng);
  const total = rows * cols;
  const { parts, ti } = countPlan(rng, total, 2, 2, maxPart(total));
  const wantBig = chance(rng, 0.5);
  const sh = pickN(rng, SHAPES, randInt(rng, 1, 2));
  const cl = pickColors(rng, randInt(rng, 1, 2));
  const deco = (big: boolean) => mk(pick(rng, sh).shape, pick(rng, cl).idx, 'solid', big ? BIG : SMALL);
  const g = toGrid(
    groupedCells(rng, [
      Array.from({ length: parts[ti] }, () => deco(wantBig)),
      Array.from({ length: parts[1 - ti] }, () => deco(!wantBig)),
    ]),
    rows,
    cols
  );

  const n = countIf(g, isBig(wantBig));
  if (n !== parts[ti]) throw new Error('conteggio incoerente');
  const nOther = total - n;
  const adjT = agr(wantBig ? SIZE_ADJ.big : SIZE_ADJ.small, true);
  const adjO = agr(wantBig ? SIZE_ADJ.small : SIZE_ADJ.big, true);

  return countQuestion({
    rng,
    difficulty: 1,
    grid: g,
    prompt: `Quante figure ${adjT} ci sono?`,
    correct: n,
    prefer: [nOther],
    colorCriterion: false,
    explanation:
      `Conta solo la grandezza: le figure ${adjT} stanno tutte vicine. ` +
      `${sumLine(perRow(g, isBig(wantBig)))}, quindi ${n}. ` +
      `Le figure ${adjO} sono ${nOther} (in tutto ${total} celle).`,
  });
}

/** d1e — "Quale forma compare più volte?" (scarto garantito ≥ 2) */
function d1MostFrequent(rng: Rng): Question {
  const [rows, cols] = d1Dims(rng, 12);
  const total = rows * cols;
  const { parts, ti } = countPlan(rng, total, 3, 2, maxPart(total), 'max');
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const g = toGrid(
    groupedCells(
      rng,
      parts.map((n, i) => Array.from({ length: n }, () => mk(sh[i].shape, cl[i].idx)))
    ),
    rows,
    cols
  );

  const counts = sh.map((s) => countIf(g, isShape(s)));
  const best = Math.max(...counts);
  const second = [...counts].sort((a, b) => b - a)[1];
  if (best - second < GAP || counts.filter((c) => c === best).length !== 1) throw new Error('vincitore non netto');
  const W = sh[ti];
  if (counts[ti] !== best) throw new Error('vincitore incoerente');
  const others = sh.filter((_, i) => i !== ti);

  guardColors(g);
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
      `Ogni forma sta tutta in un blocco: conta i tre blocchi invece di fidarti dell'impressione. ` +
      cap(sh.map((s, i) => `${artPl(s)} ${s.many} sono ${counts[i]}`).join(', ')) +
      `. Vincono ${artPl(W)} ${W.many} con ${best}, ${best - second} in più della seconda forma.`,
  };
}

// ---------------------------------------------------------------------------
// Conteggio di una proprietà COMPOSTA (d2 forma+colore, d3 due caratteristiche)
// ---------------------------------------------------------------------------

/** griglie dei conteggi di d2/d3: più grandi, ma mai oltre 20 celle */
function countDims2(rng: Rng): [number, number] {
  return pick(rng, [
    [4, 4],
    [4, 5],
  ] as [number, number][]);
}

interface Filler {
  /** un colore diverso da quello chiesto, già dosato per non pareggiare conteggi */
  otherColor: () => number;
}

interface CompositeSetup {
  prompt: string;
  /** sintagma per la spiegazione: "figure piene", "stelle", "figure verdi" */
  aLabel: string;
  bLabel: string;
  /** costruisce una figura che soddisfa/non soddisfa le due proprietà */
  make: (a: boolean, b: boolean, f: Filler) => ShapeSpec;
  predA: Pred;
  predB: Pred;
  /** frase finale personalizzata ("piene E grandi insieme") */
  both: string;
  /** quale delle due proprietà è il colore chiesto dalla domanda */
  colorSide?: 'a' | 'b';
  /** i due colori usati quando la proprietà di colore è falsa */
  otherColors?: [ColorInfo, ColorInfo];
}

/**
 * Divide m figure fra due colori: quantità diverse fra loro e diverse da
 * `avoid`, e mai un colore con una figura sola (sembrerebbe un errore di stampa).
 */
function splitNoTie(rng: Rng, m: number, avoid: number): number {
  const ok: number[] = [];
  for (let x = 2; x <= m - 2; x++) if (x !== m - x && x !== avoid && m - x !== avoid) ok.push(x);
  if (!ok.length) throw new Error('colori di contorno non ripartibili');
  return pick(rng, ok);
}

function compositeCount(rng: Rng, difficulty: Difficulty, rows: number, cols: number, st: CompositeSetup): Question {
  const total = rows * cols;
  const n11 = randInt(rng, 3, 5);
  const n10 = randInt(rng, 2, 4);
  let n01 = randInt(rng, 2, 4);
  if (n01 === n10) n01 = n10 === 4 ? 2 : n10 + 1; // countA ≠ countB
  const n00 = total - n11 - n10 - n01;
  if (n00 < 2) throw new Error('griglia non bilanciata');

  // i due distrattori concettuali (nA e nB) distano n10 e n01 dalla risposta:
  // entrambi ≥ 2, quindi nessuno cade a distanza 1
  if (n10 < GAP || n01 < GAP) throw new Error('distrattori troppo vicini');

  // colore: le figure che NON hanno il colore chiesto vengono divise fra i due
  // colori di contorno in modo che nessun colore pareggi con un altro
  let pool: number[] = [];
  if (st.colorSide && st.otherColors) {
    const withColor = st.colorSide === 'a' ? n11 + n10 : n11 + n01;
    const m = total - withColor;
    const x = splitNoTie(rng, m, withColor);
    pool = shuffle(rng, [
      ...Array<number>(x).fill(st.otherColors[0].idx),
      ...Array<number>(m - x).fill(st.otherColors[1].idx),
    ]);
  }
  const filler: Filler = {
    otherColor: () => {
      const v = pool.pop();
      if (v === undefined) throw new Error('riempitivo colore esaurito');
      return v;
    },
  };

  const cells: ShapeSpec[] = [];
  const push = (n: number, a: boolean, b: boolean) => {
    for (let i = 0; i < n; i++) cells.push(st.make(a, b, filler));
  };
  push(n11, true, true);
  push(n10, true, false);
  push(n01, false, true);
  push(n00, false, false);
  if (pool.length) throw new Error('riempitivo colore non consumato');
  shuffle(rng, cells);
  const g = toGrid(cells, rows, cols);

  const both = (s: ShapeSpec) => st.predA(s) && st.predB(s);
  const nBoth = countIf(g, both);
  const nA = countIf(g, st.predA);
  const nB = countIf(g, st.predB);
  if (nBoth !== n11 || nA !== n11 + n10 || nB !== n11 + n01) throw new Error('conteggio incoerente');

  return countQuestion({
    rng,
    difficulty,
    grid: g,
    prompt: st.prompt,
    correct: nBoth,
    prefer: [nA, nB],
    colorCriterion: st.colorSide !== undefined,
    explanation:
      `Attenzione alla trappola: in tutto ci sono ${nA} ${st.aLabel} e ${nB} ${st.bLabel}, ` +
      `ma vanno contate solo le figure che sono ${st.both}: sono ${nBoth} ` +
      `(riga per riga: ${sumLine(perRow(g, both))}). Chi guarda una caratteristica sola risponde ${nA} o ${nB}.`,
  });
}

/** d2 — "Quante stelle verdi ci sono?" (forma E colore) */
function d2ShapeColor(rng: Rng): Question {
  const [rows, cols] = countDims2(rng);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const [T, S1, S2] = sh;
  const [C, K1, K2] = cl;
  return compositeCount(rng, 2, rows, cols, {
    prompt: `${quanti(T)} ${T.many} ${col(C, T.f)} ci sono?`,
    aLabel: T.many,
    bLabel: `figure ${col(C, true)}`,
    both: `${T.many} E ${col(C, T.f)} insieme`,
    make: (a, b, f) => mk(a ? T.shape : pick(rng, [S1, S2]).shape, b ? C.idx : f.otherColor()),
    predA: isShape(T),
    predB: isColor(C),
    colorSide: 'b',
    otherColors: [K1, K2],
  });
}

/** d3 — proprietà composta con due caratteristiche fra forma/colore/pieno/grande */
function d3Composite(rng: Rng): Question {
  const [rows, cols] = countDims2(rng);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const [T, S1, S2] = sh;
  const [C, K1, K2] = cl;
  const otherShape = () => pick(rng, [S1, S2]).shape;
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
      make: (a, b, f) => mk(anyShape(), a ? C.idx : f.otherColor(), 'solid', sz(b ? wantBig : !wantBig)),
      predA: isColor(C),
      predB: isBig(wantBig),
      colorSide: 'a',
      otherColors: [K1, K2],
    });
  }
  // colore E pieno/vuoto
  return compositeCount(rng, 3, rows, cols, {
    prompt: `Quante figure ${col(C, true)} e ${fillAdjF} ci sono?`,
    aLabel: `figure ${col(C, true)}`,
    bLabel: `figure ${fillAdjF}`,
    both: `${col(C, true)} E ${fillAdjF} insieme`,
    make: (a, b, f) => mk(anyShape(), a ? C.idx : f.otherColor(), b ? wantFill : notFill),
    predA: isColor(C),
    predB: isFill(wantFill),
    colorSide: 'a',
    otherColors: [K1, K2],
  });
}

// ---------------------------------------------------------------------------
// d2 — differenza fra due gruppi
// ---------------------------------------------------------------------------

function d2Difference(rng: Rng): Question {
  const [rows, cols] = countDims2(rng);
  const total = rows * cols;
  const byColor = chance(rng, 0.5);

  // Si scelgono insieme la differenza e i tre gruppi, con tre paletti:
  //  - i tre gruppi hanno numeri diversi (nessun pareggio fra colori);
  //  - "ho contato solo il secondo gruppo" dista almeno 2 dalla risposta;
  //  - il terzo gruppo non è mai vuoto.
  const opts: [number, number][] = [];
  for (let diff = 2; diff <= 4; diff++) {
    for (let b = 3; b <= 8; b++) {
      const a = b + diff;
      const c = total - a - b;
      if (Math.abs(b - diff) >= GAP && c >= 3 && c !== a && c !== b) opts.push([diff, b]);
    }
  }
  if (!opts.length) throw new Error('nessuna differenza utilizzabile');
  const [diff, nB] = pick(rng, opts);
  const nA = nB + diff;
  const nC = total - nA - nB;

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

  return countQuestion({
    rng,
    difficulty: 2,
    grid: g,
    prompt,
    correct: diff,
    prefer: [cA, cB],
    colorCriterion: true,
    explanation:
      `Servono due conteggi e una sottrazione. ${cap(label(0))}: ${sumLine(perRow(g, pA))}. ` +
      `${cap(label(1))}: ${sumLine(perRow(g, pB))}. La domanda chiede QUANTE IN PIÙ, ` +
      `quindi ${cA} − ${cB} = ${diff} (rispondere ${cA} vuol dire essersi dimenticati della sottrazione).`,
  });
}

// ---------------------------------------------------------------------------
// d2/d3 — celle mancanti: trame posizionali
// ---------------------------------------------------------------------------

/** d2 — scacchiera di due forme + un colore per riga */
function d2Checker(rng: Rng): Question {
  // 4 righe: un colore per riga (di più non se ne distinguono), e con meno di 4
  // righe l'alternanza a scacchiera non sarebbe più l'unica regola possibile
  const rows = 4;
  const cols = randInt(rng, 4, 5);
  const [A, B] = pickN(rng, SHAPES, 2);
  const rc = pickColors(rng, rows);
  const at = (r: number, c: number) => mk((r + c) % 2 === 0 ? A.shape : B.shape, rc[r].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const here = (rm + cm) % 2 === 0 ? A : B;
  const there = (rm + cm) % 2 === 0 ? B : A;
  const ro = rm - 1;

  return cellQuestion(
    rng,
    2,
    g,
    [rm, cm],
    at(rm, cm),
    [
      mk(there.shape, rc[rm].idx), // ha sbagliato l'alternanza
      mk(here.shape, rc[ro].idx), // ha preso il colore della riga sopra
    ],
    `Ci sono due regole. 1) Le forme si alternano come su una scacchiera: ogni cella è diversa da quelle ` +
      `sopra, sotto, a destra e a sinistra, ma uguale a quelle in diagonale. 2) Il colore dipende dalla riga: ` +
      `ogni riga ha il suo. ${where(rm, cm)} Quella riga è ${col(rc[rm], true, false)}, e lì tocca ` +
      `${unArt(here)} ${here.one}: quindi ${unArt(here)} ${here.one} ${col(rc[rm], here.f, false)}.`
  );
}

/** d2 — la forma dipende dalla colonna, il colore dalla riga */
function d2RowCol(rng: Rng): Question {
  const rows = 4; // un colore per riga: 4 è il massimo di colori distinguibili
  const cols = randInt(rng, 4, 5);
  const cs = pickN(rng, SHAPES, cols);
  const rc = pickColors(rng, rows);
  const at = (r: number, c: number) => mk(cs[c].shape, rc[r].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);

  return cellQuestion(
    rng,
    2,
    g,
    [rm, cm],
    at(rm, cm),
    [
      mk(cs[cm - 1].shape, rc[rm].idx), // forma della colonna accanto
      mk(cs[cm].shape, rc[rm - 1].idx), // colore della riga sopra
    ],
    `Guarda separatamente le colonne e le righe: ogni colonna ha sempre la stessa forma dall'alto in basso, ` +
      `ogni riga ha sempre lo stesso colore da sinistra a destra. ${where(rm, cm)} ` +
      `Quella è la colonna ${cs[cm].f ? 'delle' : 'dei'} ${cs[cm].many} e la riga ${col(rc[rm], true, false)}: ` +
      `ci va ${unArt(cs[cm])} ${cs[cm].one} ${col(rc[rm], cs[cm].f, false)}.`
  );
}

/**
 * Simboli forma+colore delle trame a scorrimento e del quadrato latino.
 * Le forme sono tutte diverse: quando servono più di 4 simboli i colori si
 * ripetono (mai due colori simili), e a distinguerli resta la forma.
 */
function symbols(rng: Rng, k: number): { info: ShapeInfo; color: ColorInfo }[] {
  const sh = pickN(rng, SHAPES, k);
  const cl = pickColors(rng, Math.min(k, 4));
  return sh.map((info, i) => ({ info, color: cl[i % cl.length] }));
}

const symSpec = (s: { info: ShapeInfo; color: ColorInfo }) => mk(s.info.shape, s.color.idx);
const symName = (s: { info: ShapeInfo; color: ColorInfo }) =>
  `${s.info.one} ${col(s.color, s.info.f, false)}`;
/** "una stella rossa" (con l'articolo, per le frasi discorsive) */
const symArt = (s: { info: ShapeInfo; color: ColorInfo }) => `${unArt(s.info)} ${symName(s)}`;

/** trame a scorrimento: la riga sotto ripete la riga sopra spostata di `shift` */
function shiftPattern(rng: Rng, difficulty: Difficulty, shift: number, rows: number, cols: number): Question {
  const k = cols;
  const sym = symbols(rng, k);
  const idx = (r: number, c: number) => (((c - shift * r) % k) + k * 10) % k;
  const at = (r: number, c: number) => symSpec(sym[idx(r, c)]);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const ci = idx(rm, cm);

  // errori tipici: la figura della cella sopra, uno scorrimento sbagliato, il vicino di sinistra
  const cands = [
    idx(rm - 1, cm),
    (((cm - 1 * rm) % k) + k * 10) % k,
    (((cm + 1 - shift * rm) % k) + k * 10) % k,
    (((ci + 2) % k) + k) % k,
  ];
  const picked: number[] = [];
  for (const v of cands) if (v !== ci && !picked.includes(v) && picked.length < 2) picked.push(v);
  if (picked.length < 2) throw new Error('distrattori insufficienti');

  const prev = sym[idx(rm, cm - 1 < 0 ? cols - 1 : cm - 1)];
  return cellQuestion(
    rng,
    difficulty,
    g,
    [rm, cm],
    at(rm, cm),
    [symSpec(sym[picked[0]]), symSpec(sym[picked[1]])],
    `Ogni riga contiene le stesse ${k} figure della riga sopra, ma spostate di ${shift} ` +
      `${shift === 1 ? 'posto' : 'posti'} verso destra (chi esce a destra rientra a sinistra). ` +
      `Detto in un altro modo: scendendo di una riga e spostandosi di ${shift} ` +
      `${shift === 1 ? 'colonna' : 'colonne'} a destra si ritrova sempre la stessa figura. ` +
      `${where(rm, cm)} Nella sua riga, subito prima del ?, c'è ${symArt(prev)}: dopo tocca a ` +
      `${symArt(sym[ci])}.`
  );
}

/** griglie delle trame posizionali: mai oltre 20 celle, altrimenti a 56px si legge male */
function patternDims(rng: Rng): [number, number] {
  return pick(rng, [
    [4, 4],
    [4, 5],
    [5, 4],
  ] as [number, number][]);
}

const d2Shift = (rng: Rng) => {
  const [rows, cols] = patternDims(rng);
  return shiftPattern(rng, 2, 1, rows, cols);
};
const d3Shift = (rng: Rng) => shiftPattern(rng, 3, pick(rng, [2, 3]), 4, 5);

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

  return cellQuestion(
    rng,
    3,
    g,
    [rm, cm],
    at(rm, cm),
    [symSpec(sym[wrong[0]]), symSpec(sym[wrong[1]])],
    `Qui non c'è una successione da indovinare: in ogni riga e in ogni colonna ciascuna delle 4 figure ` +
      `compare esattamente una volta. Si ragiona per esclusione. ${where(rm, cm)} ` +
      `Nella sua riga ci sono già ${rowOthers.map((s) => symArt(sym[s])).join(', ')}: manca solo ` +
      `${symArt(sym[correct])}. Controprova: nella sua colonna ci sono ` +
      `${colOthers.map((s) => symArt(sym[s])).join(', ')}, e ${symArt(sym[correct])} non c'è ancora.`
  );
}

/** d3 — doppia diagonale: la forma segue riga+colonna, il colore segue colonna−riga */
function d3DoubleDiagonal(rng: Rng): Question {
  const [rows, cols] = patternDims(rng);
  const sh = pickN(rng, SHAPES, 3);
  const cl = pickColors(rng, 3);
  const si = (r: number, c: number) => (r + c) % 3;
  const ki = (r: number, c: number) => (((c - r) % 3) + 3) % 3;
  const at = (r: number, c: number) => mk(sh[si(r, c)].shape, cl[ki(r, c)].idx);
  const [rm, cm] = hiddenPos(rng, rows, cols);
  const g = gridFrom(rows, cols, at);
  const S = sh[si(rm, cm)];
  const K = cl[ki(rm, cm)];

  return cellQuestion(
    rng,
    3,
    g,
    [rm, cm],
    at(rm, cm),
    [
      mk(sh[(si(rm, cm) + 1) % 3].shape, K.idx), // forma della diagonale accanto
      mk(S.shape, cl[(ki(rm, cm) + 1) % 3].idx), // colore della diagonale accanto
    ],
    `Le due regole viaggiano su diagonali opposte. Le FORME si ripetono lungo le diagonali che salgono ` +
      `verso destra (↗): ${sh.map((s) => s.many).join(', ')} e poi da capo. I COLORI invece si ripetono ` +
      `lungo le diagonali che scendono verso destra (↘). ${where(rm, cm)} Seguendo la sua diagonale ↗ ` +
      `tocca ${unArt(S)} ${S.one}, seguendo la sua diagonale ↘ il colore è ${col(K, S.f, false)}: ` +
      `${unArt(S)} ${S.one} ${col(K, S.f, false)}.`
  );
}

/** d3 — tre regole insieme: forma per riga, colore per colonna, pieno/vuoto a scacchiera */
function d3TripleRule(rng: Rng): Question {
  const rows = randInt(rng, 4, 5);
  const cols = 4; // un colore per colonna: 4 è il massimo di colori distinguibili
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

  const variants: ShapeSpec[] = [
    mk(S.shape, K.idx, notF), // ha ignorato la scacchiera pieno/vuoto
    mk(S.shape, cc[cm - 1].idx, F), // colore della colonna accanto
    mk(rs[rm - 1].shape, K.idx, F), // forma della riga sopra
  ];
  const two = shuffle(rng, variants).slice(0, 2) as [ShapeSpec, ShapeSpec];

  return cellQuestion(
    rng,
    3,
    g,
    [rm, cm],
    at(rm, cm),
    two,
    `Tre regole lavorano insieme: la FORMA dipende dalla riga, il COLORE dalla colonna, e pieno/vuoto ` +
      `si alternano come su una scacchiera. ${where(rm, cm)} La sua riga è la riga ` +
      `${artPl(S) === 'le' ? 'delle' : 'dei'} ${S.many}, la sua colonna è quella ${col(K, true, false)}, ` +
      `e le celle vicine (sopra, sotto e di lato) sono ${agr(FILL_ADJ[notF], true)}: quindi ci va ${unArt(S)} ${S.one} ` +
      `${col(K, S.f, false)} ${agr(FILL_ADJ[F], S.f, false)}.`
  );
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
  // il tipo di quesito si sceglie UNA volta: se una griglia non passa i
  // controlli si riprova con lo stesso tipo, senza sbilanciare il repertorio
  const make = pick(rng, pool);
  try {
    return retry(() => make(rng), 60);
  } catch {
    // alcune varianti (i conteggi in due passaggi) faticano a raggiungere una
    // risposta abbastanza grande da avere distrattori equilibrati: si ripiega
    // su un'altra variante della stessa difficoltà invece di rinunciare
    for (const alt of shuffle(rng, pool.filter((m) => m !== make))) {
      try {
        return retry(() => alt(rng), 30);
      } catch {
        continue;
      }
    }
    throw new Error('nessuna variante di pattern utilizzabile');
  }
}
