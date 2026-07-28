// Generatore "fold": foglio piegato e forato ("paper folding", classico dei
// test di ragionamento spaziale). Un foglio quadrato viene piegato una o più
// volte, poi si fa uno o più buchi che attraversano TUTTI gli strati; la
// domanda è come appare il foglio una volta riaperto.
//
// d1 — una sola piega: ogni buco si specchia una volta (1 buco → 2).
// d2 — due pieghe (1 buco → 4) oppure una piega con un buco proprio SULLA
//      linea di piega (regola sottile: quel buco non si sdoppia).
// d3 — tre pieghe (fino a 4-8 buchi) oppure due pieghe con 2-3 buchi di cui
//      alcuni sulle linee di piega: conteggi diversi per ogni buco.
//
// Modello: il foglio è una griglia n×n di possibili posizioni (n = 2 o 3). Una
// piega è la riflessione rispetto a un asse di simmetria del pezzo di carta
// CORRENTE (verticale, orizzontale, diagonale, antidiagonale): il pezzo resta
// un rettangolo/triangolo la cui metà si ribalta esattamente sull'altra. Le
// caselle attraversate dalla piega (valore di lato 0) stanno sulla cordonatura:
// un buco lì dentro resta uno solo. Riaprire = ripercorrere le pieghe a
// ritroso unendo, a ogni passo, l'insieme dei buchi con la sua immagine
// specchiata. Tutta l'aritmetica è verificata cella per cella, mai stimata.
//
// Distrattori (mai casuali): specchiatura rispetto all'asse sbagliato, apertura
// parziale (dimentica una piega), buchi non specchiati (restano dove sono
// stati fatti), un buco in meno, una specchiatura di troppo.

import type { CellSpec, ChoiceVisual, Difficulty, Question, QuestionType, ShapeSpec } from '../types';
import { pick, randInt, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

/** 'fold' non è ancora dentro QuestionType: lo registrerà il coordinatore. */

// ---------------------------------------------------------------------------
// Geometria delle pieghe
// ---------------------------------------------------------------------------

/** V = piega verticale, H = orizzontale, D = diagonale ↘, A = antidiagonale ↙ */
type Axis = 'V' | 'H' | 'D' | 'A';
/** 'R' (rotazione di 180°) NON è una piega: serve solo a costruire distrattori. */
type Sym = Axis | 'R';
type Side = 1 | -1;

interface Fold {
  axis: Axis;
  /** metà di carta che resta visibile: segno del "lato" conservato */
  keep: Side;
}

interface Spec {
  n: number;
  folds: Fold[];
  /** indici delle caselle bucate sul foglio piegato */
  punches: number[];
}

/** immagine speculare della casella i sulla griglia n×n */
function reflect(n: number, m: Sym, i: number): number {
  const r = Math.floor(i / n);
  const c = i % n;
  switch (m) {
    case 'V':
      return r * n + (n - 1 - c);
    case 'H':
      return (n - 1 - r) * n + c;
    case 'D':
      return c * n + r;
    case 'A':
      return (n - 1 - c) * n + (n - 1 - r);
    case 'R':
      return (n - 1 - r) * n + (n - 1 - c);
  }
}

/**
 * Da che parte dell'asse sta la casella: >0 / <0 ai due lati, 0 sulla piega.
 * La riflessione corrispondente cambia il segno di questo valore.
 */
function sideOf(n: number, axis: Axis, i: number): number {
  const r = Math.floor(i / n);
  const c = i % n;
  switch (axis) {
    case 'V':
      return 2 * c - (n - 1);
    case 'H':
      return 2 * r - (n - 1);
    case 'D':
      return r - c;
    case 'A':
      return r + c - (n - 1);
  }
}

/** caselle coperte dalla carta dopo le prime `k` pieghe */
function region(n: number, folds: Fold[], k = folds.length): number[] {
  const out: number[] = [];
  for (let i = 0; i < n * n; i++) {
    let ok = true;
    for (let f = 0; f < k; f++) if (folds[f].keep * sideOf(n, folds[f].axis, i) < 0) ok = false;
    if (ok) out.push(i);
  }
  return out;
}

/** riapertura: si torna indietro piega per piega unendo l'immagine specchiata */
function openWith(n: number, syms: Sym[], punches: number[]): number[] {
  let set = new Set(punches);
  for (let i = syms.length - 1; i >= 0; i--) {
    const next = new Set(set);
    for (const x of set) next.add(reflect(n, syms[i], x));
    set = next;
  }
  return [...set].sort((a, b) => a - b);
}

function openSheet(n: number, folds: Fold[], punches: number[]): number[] {
  return openWith(n, folds.map((f) => f.axis), punches);
}

/** true se la casella è attraversata da almeno una piega (buco che non si sdoppia) */
function onCrease(n: number, folds: Fold[], i: number): boolean {
  return folds.some((f) => sideOf(n, f.axis, i) === 0);
}

/** quanti buchi genera, da solo, un buco fatto in questa casella */
function multiplicity(n: number, folds: Fold[], i: number): number {
  return openSheet(n, folds, [i]).length;
}

// ---------------------------------------------------------------------------
// Costruzione delle sequenze di pieghe
// ---------------------------------------------------------------------------

const PERP: Record<Axis, Axis> = { V: 'H', H: 'V', D: 'A', A: 'D' };

/**
 * Sequenza di k pieghe fisicamente valide: ogni piega deve essere un asse di
 * simmetria del pezzo corrente.
 *  - 1ª piega: uno dei 4 assi del quadrato.
 *  - 2ª piega: l'asse perpendicolare (V↔H, D↔A), unica che ripiega a metà.
 *  - 3ª piega: solo dopo V+H (il pezzo è un quadratino) ed è la diagonale di
 *    quel quadratino: D per i quarti in alto-sx / basso-dx, A per gli altri.
 */
function makeFolds(rng: Rng, k: number, family?: 'ortho' | 'diag'): Fold[] {
  // con 3 pieghe la terza esiste solo dopo V+H: la famiglia diagonale non regge
  const fam = k >= 3 ? 'ortho' : family ?? pick(rng, ['ortho', 'diag'] as const);
  const first: Axis = fam === 'ortho' ? pick(rng, ['V', 'H'] as const) : pick(rng, ['D', 'A'] as const);
  const folds: Fold[] = [{ axis: first, keep: pick(rng, [1, -1] as const) }];
  if (k >= 2) folds.push({ axis: PERP[first], keep: pick(rng, [1, -1] as const) });
  if (k >= 3) {
    const kv = folds.find((f) => f.axis === 'V')!.keep;
    const kh = folds.find((f) => f.axis === 'H')!.keep;
    folds.push({ axis: kv === kh ? 'D' : 'A', keep: pick(rng, [1, -1] as const) });
  }
  return folds;
}

/** caselle bucabili con la moltiplicità richiesta */
function punchable(n: number, folds: Fold[], want: 'free' | 'crease' | 'any', minMult = 2): number[] {
  return region(n, folds).filter((i) => {
    const crease = onCrease(n, folds, i);
    if (want === 'free' && crease) return false;
    if (want === 'crease' && !crease) return false;
    return multiplicity(n, folds, i) >= minMult;
  });
}

// ---------------------------------------------------------------------------
// Varianti per difficoltà (ognuna è uno "scheletro" visivo diverso)
// ---------------------------------------------------------------------------

/** tutti i sottoinsiemi di `k` caselle presi da `cells` */
function combos(cells: number[], k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (let i = 0; i <= cells.length - k; i++)
    for (const rest of combos(cells.slice(i + 1), k - 1)) out.push([cells[i], ...rest]);
  return out;
}

/** foglio, famiglia di pieghe, quanti buchi: le varianti "una piega sola" di d1 */
const D1_VARIANTS: Array<{ n: number; fam: 'ortho' | 'diag' | 'any'; k: number }> = [
  { n: 2, fam: 'ortho', k: 1 }, // 2×2, piega dritta, 1 buco → 2
  { n: 2, fam: 'ortho', k: 1 },
  { n: 2, fam: 'diag', k: 1 }, // 2×2, piega in diagonale → 2
  { n: 2, fam: 'diag', k: 1 },
  { n: 2, fam: 'ortho', k: 2 }, // 2×2, due buchi → 4 (tutto il foglio)
  { n: 3, fam: 'ortho', k: 1 }, // 3×3, piega dritta → 2
  { n: 3, fam: 'ortho', k: 1 },
  { n: 3, fam: 'diag', k: 1 }, // 3×3, piega in diagonale → 2
  { n: 3, fam: 'diag', k: 1 },
  { n: 3, fam: 'ortho', k: 2 }, // 3×3, due buchi → 4
  { n: 3, fam: 'ortho', k: 2 },
  { n: 3, fam: 'diag', k: 2 }, // 3×3, due buchi in diagonale → 4
  { n: 3, fam: 'diag', k: 2 },
  { n: 3, fam: 'any', k: 3 }, // 3×3, tre buchi → 6 (stessa regola, più conti)
];

function specD1(rng: Rng): Spec {
  const v = pick(rng, D1_VARIANTS);
  const fam = v.fam === 'any' ? pick(rng, ['ortho', 'diag'] as const) : v.fam;
  const folds = makeFolds(rng, 1, fam);
  // a d1 mai buchi sulla linea di piega: la regola resta una sola, "tutto si sdoppia"
  const free = punchable(v.n, folds, 'free');
  if (free.length < v.k) throw new Error('caselle libere insufficienti');
  return { n: v.n, folds, punches: pick(rng, combos(free, v.k)) };
}

function specD2(rng: Rng): Spec {
  const kind = randInt(rng, 0, 6);
  // A: 3×3, due pieghe dritte, 1 buco libero         → 4 buchi
  // B: 3×3, due pieghe diagonali, 1 buco libero      → 4 buchi
  // C: 3×3, una piega, 1 buco libero + 1 sulla piega → 3 buchi (regola sottile)
  // D: 3×3, due pieghe, buco SULLA piega             → 2 buchi (regola sottile)
  // E: 2×2, due pieghe dritte, 1 buco                → 4 buchi
  // F: 2×2, due pieghe diagonali, 1 buco             → 2 buchi
  // G: 3×3, una piega, DUE buchi sulla piega         → 2 buchi (regola sottile)
  if (kind === 0 || kind === 1) {
    const folds = makeFolds(rng, 2, kind === 0 ? 'ortho' : 'diag');
    const free = punchable(3, folds, 'free', 4);
    if (!free.length) throw new Error('nessuna casella libera');
    return { n: 3, folds, punches: [pick(rng, free)] };
  }
  if (kind === 2) {
    const folds = makeFolds(rng, 1);
    const free = punchable(3, folds, 'free');
    const crease = punchable(3, folds, 'crease', 1);
    if (!free.length || !crease.length) throw new Error('varianti insufficienti');
    return { n: 3, folds, punches: [pick(rng, free), pick(rng, crease)].sort((a, b) => a - b) };
  }
  if (kind === 3) {
    const folds = makeFolds(rng, 2);
    const crease = punchable(3, folds, 'crease', 2);
    if (!crease.length) throw new Error('nessuna casella sulla piega');
    return { n: 3, folds, punches: [pick(rng, crease)] };
  }
  if (kind === 6) {
    const folds = makeFolds(rng, 1);
    const crease = punchable(3, folds, 'crease', 1);
    if (crease.length < 2) throw new Error('poche caselle sulla piega');
    return { n: 3, folds, punches: pick(rng, combos(crease, 2)) };
  }
  const folds = makeFolds(rng, 2, kind === 4 ? 'ortho' : 'diag');
  const cells = punchable(2, folds, 'any', 2);
  if (!cells.length) throw new Error('nessuna casella bucabile');
  return { n: 2, folds, punches: [pick(rng, cells)] };
}

function specD3(rng: Rng): Spec {
  const kind = randInt(rng, 0, 4);
  // A: 3×3, TRE pieghe, 1 buco                     → 4 buchi (angoli o lati)
  // B: 3×3, TRE pieghe, 2 buchi                    → 5 o 8 buchi
  // C: 3×3, due pieghe dritte, 2 buchi             → 4-6 buchi
  // D: 3×3, due pieghe diagonali, 2 buchi          → 4-6 buchi
  // E: 3×3, due pieghe, 3 buchi                    → 5-7 buchi
  if (kind === 0 || kind === 1) {
    const folds = makeFolds(rng, 3);
    const strong = punchable(3, folds, 'any', 4);
    if (!strong.length) throw new Error('nessuna casella utile');
    if (kind === 0) return { n: 3, folds, punches: [pick(rng, strong)] };
    const pairs = combos(region(3, folds), 2).filter((p) => p.some((i) => strong.includes(i)));
    if (!pairs.length) throw new Error('nessuna coppia utile');
    return { n: 3, folds, punches: pick(rng, pairs) };
  }
  if (kind === 2 || kind === 3) {
    const folds = makeFolds(rng, 2, kind === 2 ? 'ortho' : 'diag');
    // coppie che aprono almeno 4 buchi: sotto è roba da d2
    const pairs = combos(region(3, folds), 2).filter((p) => openSheet(3, folds, p).length >= 4);
    if (!pairs.length) throw new Error('nessuna coppia utile');
    return { n: 3, folds, punches: pick(rng, pairs) };
  }
  const folds = makeFolds(rng, 2);
  const triples = combos(region(3, folds), 3).filter((p) => {
    const k = openSheet(3, folds, p).length;
    return k >= 5 && k <= 7;
  });
  if (!triples.length) throw new Error('nessuna terna utile');
  return { n: 3, folds, punches: pick(rng, triples) };
}

// ---------------------------------------------------------------------------
// Distrattori: errori tipici, costruiti (mai casuali)
// ---------------------------------------------------------------------------

type Kind = 'asse' | 'parziale' | 'nessuna' | 'meno' | 'piu';

interface Cand {
  kind: Kind;
  set: number[];
}

const KEY = (s: number[]) => s.join(',');

function buildCandidates(n: number, folds: Fold[], punches: number[], correct: number[]): Cand[] {
  const out: Cand[] = [];
  const ck = KEY(correct);
  const push = (kind: Kind, raw: number[]) => {
    const set = [...new Set(raw)].sort((a, b) => a - b);
    if (!set.length || set.length > n * n || KEY(set) === ck) return;
    out.push({ kind, set });
  };

  // 1. si specchia rispetto all'asse sbagliato (una piega letta male)
  const syms: Sym[] = ['V', 'H', 'D', 'A', 'R'];
  for (let i = 0; i < folds.length; i++) {
    for (const m of syms) {
      if (m === folds[i].axis) continue;
      const maps: Sym[] = folds.map((f) => f.axis as Sym);
      maps[i] = m;
      push('asse', openWith(n, maps, punches));
    }
  }
  // 2. apertura parziale: dimentica di riaprire le prime pieghe
  for (let j = 1; j < folds.length; j++) push('parziale', openWith(n, folds.slice(j).map((f) => f.axis), punches));
  // 3. i buchi restano dove sono stati fatti (nessuna specchiatura)
  push('nessuna', punches);
  // 4. un buco in meno: si dimentica una delle copie
  const copies = correct.filter((i) => !punches.includes(i));
  for (const x of copies.length ? copies : correct) push('meno', correct.filter((y) => y !== x));
  // 5. una specchiatura di troppo (continua a specchiare oltre le pieghe fatte)
  for (const m of ['V', 'H', 'D', 'A'] as Sym[]) push('piu', [...correct, ...correct.map((i) => reflect(n, m, i))]);
  return out;
}

/** preferenze di plausibilità: numero più basso = distrattore più tentatore */
const PREF: Record<Difficulty, Record<Kind, number>> = {
  1: { asse: 0, nessuna: 1, meno: 2, piu: 3, parziale: 4 },
  2: { asse: 0, parziale: 1, meno: 2, nessuna: 3, piu: 4 },
  3: { parziale: 0, asse: 1, meno: 2, piu: 3, nessuna: 4 },
};

function pickDistractors(rng: Rng, difficulty: Difficulty, cands: Cand[]): [number[], number[]] {
  const byKind = new Map<Kind, number[][]>();
  const seen = new Set<string>();
  for (const c of cands) {
    const k = KEY(c.set);
    if (seen.has(k)) continue;
    seen.add(k);
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind)!.push(c.set);
  }
  if (seen.size < 2) throw new Error('distrattori insufficienti');
  const order = [...byKind.keys()]
    .map((k) => ({ k, w: PREF[difficulty][k] + rng() }))
    .sort((a, b) => a.w - b.w)
    .map((x) => x.k);
  const first = pick(rng, byKind.get(order[0])!);
  for (const k of order.slice(1)) {
    const alt = byKind.get(k)!.filter((s) => KEY(s) !== KEY(first));
    if (alt.length) return [first, pick(rng, alt)];
  }
  const same = byKind.get(order[0])!.filter((s) => KEY(s) !== KEY(first));
  if (!same.length) throw new Error('distrattori insufficienti');
  return [first, pick(rng, same)];
}

// ---------------------------------------------------------------------------
// Resa visiva: ogni casella del foglio è un pallino
// ---------------------------------------------------------------------------

/** carta senza buco: anellino sottile */
const PAPER: ShapeSpec = { shape: 'dot', fillMode: 'outline', size: 0.7, color: 6 };
/** zona non più coperta dalla carta (piegata via): puntino quasi invisibile */
const AWAY: ShapeSpec = { shape: 'dot', fillMode: 'solid', size: 0.22, color: 6 };
/** buco: disco pieno e ben più grande dell'anellino */
function holeShape(color: number): ShapeSpec {
  return { shape: 'circle', fillMode: 'solid', size: 0.62, color };
}

/** colori dei buchi: tutti tranne i due azzurri, che sono il colore della carta */
const HOLE_COLORS = [1, 2, 3, 4, 5, 7];

function sheetCell(
  n: number,
  holes: number[],
  covered: number[] | null,
  color: number,
  highlight = false
): CellSpec {
  const H = new Set(holes);
  const C = covered ? new Set(covered) : null;
  const shapes: ShapeSpec[] = [];
  for (let i = 0; i < n * n; i++) {
    if (H.has(i)) shapes.push(holeShape(color));
    else if (!C || C.has(i)) shapes.push({ ...PAPER });
    else shapes.push({ ...AWAY });
  }
  const cell: CellSpec = { shapes, layout: 'grid' };
  if (highlight) cell.highlight = true;
  return cell;
}

// ---------------------------------------------------------------------------
// Testi italiani
// ---------------------------------------------------------------------------

function foldText(f: Fold): string {
  if (f.axis === 'V')
    return f.keep === 1 ? 'la metà sinistra si ribalta sopra la destra' : 'la metà destra si ribalta sopra la sinistra';
  if (f.axis === 'H')
    return f.keep === 1
      ? 'la metà in alto si ribalta sopra quella in basso'
      : 'la metà in basso si ribalta sopra quella in alto';
  if (f.axis === 'D')
    return f.keep === 1
      ? 'la parte in alto a destra si ribalta lungo la diagonale ↘'
      : 'la parte in basso a sinistra si ribalta lungo la diagonale ↘';
  return f.keep === 1
    ? 'la parte in alto a sinistra si ribalta lungo la diagonale ↗'
    : 'la parte in basso a destra si ribalta lungo la diagonale ↗';
}

const N_WORD = ['zero', 'una', 'due', 'tre'];

/** descrizione della trama finale, quando è riconoscibile a colpo d'occhio */
const PATTERNS: Record<string, string> = {
  '0,2,6,8': ', ai quattro angoli',
  '1,3,5,7': ', al centro dei quattro lati',
  '0,2,4,6,8': ', ai quattro angoli e al centro',
  '1,3,4,5,7': ', al centro e sui quattro lati',
  '0,1,2,3,5,6,7,8': ': tutte le caselle tranne quella centrale',
  '0,2,3,5,6,8': ': la colonna di sinistra e quella di destra',
  '0,1,2,6,7,8': ': la riga in alto e quella in basso',
  '3,4,5': ': tutta la riga centrale',
  '1,4,7': ': tutta la colonna centrale',
  '0,8': ', sui due angoli della diagonale ↘',
  '2,6': ', sui due angoli della diagonale ↗',
  '0,2': ', nei due angoli in alto',
  '6,8': ', nei due angoli in basso',
  '0,6': ', nei due angoli di sinistra',
  '2,8': ', nei due angoli di destra',
};

function patternNote(n: number, holes: number[]): string {
  if (n !== 3) return holes.length === 4 ? ', uno per angolo' : '';
  return PATTERNS[holes.join(',')] ?? '';
}

function explain(spec: Spec, correct: number[]): string {
  const { n, folds, punches } = spec;
  const steps = folds.map((f, i) => `${i + 1}) ${foldText(f)}`).join('; ');
  const nb = punches.length;
  const creased = punches.filter((i) => onCrease(n, folds, i));
  let t = `Il foglio viene piegato ${N_WORD[folds.length]} volt${folds.length === 1 ? 'a' : 'e'}: ${steps}. `;
  t +=
    nb === 1
      ? 'Poi si fa un buco che passa attraverso tutti gli strati. '
      : `Poi si fanno ${N_WORD[nb]} buchi che passano attraverso tutti gli strati. `;
  t += "Riaprendo si torna indietro piega dopo piega e ogni buco ricompare specchiato dall'altra parte della piega";
  t += creased.length ? ', tranne quelli fatti proprio SULLA linea di piega, che restano uno solo. ' : '. ';
  const mults = punches.map((i) => multiplicity(n, folds, i));
  if (nb > 1) t += `Qui i buchi valgono ${mults.join(' + ')} = ${correct.length} in tutto. `;
  else t += `Qui quell'unico buco ne fa ${correct.length}. `;
  t += `Il foglio aperto ha ${correct.length} buchi${patternNote(n, correct)}.`;
  return t;
}

const PROMPTS = [
  'Il foglio viene piegato e poi bucato: come apparirà una volta riaperto?',
  'Pieghiamo il foglio, facciamo i buchi e riapriamo tutto: quale foglio otteniamo?',
  'Come sarà il foglio quando lo riapriremo?',
];

// ---------------------------------------------------------------------------

function build(rng: Rng, difficulty: Difficulty): Question {
  const spec = difficulty === 1 ? specD1(rng) : difficulty === 2 ? specD2(rng) : specD3(rng);
  const { n, folds, punches } = spec;
  const correct = openSheet(n, folds, punches);
  if (correct.length < 2) throw new Error('troppo pochi buchi');
  if (n === 3 && correct.length > 8) throw new Error('troppi buchi');
  // i buchi non devono sovrapporsi fra loro: così il conto della spiegazione
  // (2 + 4 + 1 = 7) è sempre vero e la trama resta leggibile
  const sum = punches.reduce((s, i) => s + multiplicity(n, folds, i), 0);
  if (sum !== correct.length) throw new Error('buchi sovrapposti');

  const [w1, w2] = pickDistractors(rng, difficulty, buildCandidates(n, folds, punches, correct));
  const color = pick(rng, HOLE_COLORS);

  // riga dei passi: foglio intero → dopo ogni piega → piegato e bucato → ?
  const steps: CellSpec[] = [sheetCell(n, [], null, color)];
  for (let k = 1; k <= folds.length; k++) steps.push(sheetCell(n, [], region(n, folds, k), color));
  steps.push(sheetCell(n, punches, region(n, folds), color, true));
  steps.push({ shapes: [], unknown: true });
  // con 3×3 e 2-3 pieghe si va a capo: celle più grandi = pallini leggibili
  const rows = steps.length > 4 && n === 3 ? [steps.slice(0, 3), steps.slice(3)] : [steps];

  const asChoice = (holes: number[]): ChoiceVisual => ({ kind: 'cell', cell: sheetCell(n, holes, null, color) });
  const { choices, correctIndex } = placeChoices(rng, asChoice(correct), [asChoice(w1), asChoice(w2)]);

  return {
    qtype: 'fold',
    difficulty,
    prompt: pick(rng, PROMPTS),
    payload: { kind: 'cells', rows, arrows: true },
    choices,
    correctIndex,
    explanation: explain(spec, correct),
  };
}

export function genFold(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => build(rng, difficulty), 30);
}

// utilità esportate per gli script di verifica (non usate dal gioco)
export const _internals = { reflect, sideOf, region, openSheet, multiplicity, onCrease, makeFolds };
