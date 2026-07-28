// Generatore "fold": foglio piegato e forato ("paper folding", classico dei
// test di ragionamento spaziale). Un foglio quadrato viene piegato una o più
// volte, poi si fa uno o più buchi che attraversano TUTTI gli strati; la
// domanda è come appare il foglio una volta riaperto.
//
// d1 — una sola piega, buchi lontani dalla cordonatura: ogni buco si sdoppia.
// d2 — una piega con un buco proprio SULLA linea di piega (regola sottile: quel
//      buco non si sdoppia), oppure due pieghe con un buco solo.
// d3 — due pieghe con 2-3 buchi, oppure una piega con 3 buchi misti: al massimo
//      5 buchi sul foglio aperto, per restare contabili a colpo d'occhio.
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
// LEGGIBILITÀ (il punto debole storico di questo tipo). Tre regole di ferro:
//  1. la linea di piega è SEMPRE disegnata (CellSpec.crease): senza vederla il
//     quesito diventa spot-the-difference invece che ragionamento spaziale;
//  2. la carta ancora presente è una tessera piena, quella ripiegata via quasi
//     niente: la sagoma del foglio piegato si legge a colpo d'occhio;
//  3. mai più di 4 pannelli (stanno in una riga sola) e mai più di 5 buchi.
//
// Vincoli di generazione (scartano le domande che il disegno non saprebbe
// raccontare): ogni piega deve nascondere almeno 2 caselle; nessun'altra piega
// deve produrre la stessa carta visibile (altrimenti la sequenza è
// sotto-determinata); i distrattori devono distinguersi dalla risposta a
// occhio, non per una cella sola.
//
// Distrattori (mai casuali): specchiatura rispetto all'asse sbagliato, apertura
// parziale (dimentica una piega), buchi non specchiati (restano dove sono
// stati fatti), un buco in meno, una specchiatura di troppo.

import type { CellSpec, ChoiceVisual, Difficulty, Question, ShapeSpec } from '../types';
import { pick, randInt, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

// ---------------------------------------------------------------------------
// Geometria delle pieghe
// ---------------------------------------------------------------------------

/** V = piega verticale, H = orizzontale, D = diagonale ↘, A = antidiagonale ↗ */
type Axis = 'V' | 'H' | 'D' | 'A';
/** 'R' (rotazione di 180°) NON è una piega: serve solo a costruire distrattori. */
type Sym = Axis | 'R';
type Side = 1 | -1;

const AXES: Axis[] = ['V', 'H', 'D', 'A'];
const SIDES: Side[] = [1, -1];

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

const KEY = (s: number[]) => s.join(',');

// ---------------------------------------------------------------------------
// Costruzione delle sequenze di pieghe
// ---------------------------------------------------------------------------

const PERP: Record<Axis, Axis> = { V: 'H', H: 'V', D: 'A', A: 'D' };

/**
 * Sequenza di k pieghe fisicamente valide: ogni piega deve essere un asse di
 * simmetria del pezzo corrente.
 *  - 1ª piega: uno dei 4 assi del quadrato.
 *  - 2ª piega: l'asse perpendicolare (V↔H, D↔A), unica che ripiega a metà.
 * Tre pieghe non si usano più: sulla griglia 3×3 la terza piega toglierebbe una
 * sola casella (invisibile a occhio) e servirebbe un quinto pannello.
 */
function makeFolds(rng: Rng, k: number, family?: 'ortho' | 'diag'): Fold[] {
  const fam = family ?? pick(rng, ['ortho', 'diag'] as const);
  const first: Axis = fam === 'ortho' ? pick(rng, ['V', 'H'] as const) : pick(rng, ['D', 'A'] as const);
  const folds: Fold[] = [{ axis: first, keep: pick(rng, SIDES) }];
  if (k >= 2) folds.push({ axis: PERP[first], keep: pick(rng, SIDES) });
  return folds;
}

/**
 * Una sequenza di pieghe è "raccontabile" solo se ogni passo si vede e si legge
 * in un modo solo:
 *  - la piega deve nascondere almeno 2 caselle, o comunque un quarto del foglio
 *    (una sola casella su nove che cambia è spot-the-difference, non
 *    ragionamento: è per questo che le tre pieghe non ci sono più);
 *  - nessun ALTRO asse deve lasciare esattamente la stessa carta visibile,
 *    altrimenti il disegno è compatibile con due pieghe diverse (e quindi con
 *    due risposte diverse).
 */
function foldsReadable(n: number, folds: Fold[]): boolean {
  for (let k = 0; k < folds.length; k++) {
    const prev = region(n, folds, k);
    const cur = region(n, folds, k + 1);
    const hidden = prev.length - cur.length;
    if (cur.length < 2) return false;
    if (hidden < 2 && hidden * 4 < n * n) return false;
    const key = KEY(cur);
    for (const axis of AXES) {
      if (axis === folds[k].axis) continue;
      for (const keep of SIDES) {
        const alt = [...folds.slice(0, k), { axis, keep }];
        if (KEY(region(n, alt, k + 1)) === key) return false;
      }
    }
  }
  return true;
}

/** tutti i sottoinsiemi di `k` caselle presi da `cells` */
function combos(cells: number[], k: number): number[][] {
  if (k === 0) return [[]];
  const out: number[][] = [];
  for (let i = 0; i <= cells.length - k; i++)
    for (const rest of combos(cells.slice(i + 1), k - 1)) out.push([cells[i], ...rest]);
  return out;
}

type Want = 'free' | 'crease' | 'mix' | 'any';

/**
 * Tutti gli insiemi di buchi ammessi: nessuna sovrapposizione fra le copie (così
 * il conto "2 + 1 = 3" della spiegazione è sempre vero), totale di buchi entro i
 * limiti di leggibilità, composizione richiesta rispetto alla cordonatura.
 */
function punchSets(
  n: number,
  folds: Fold[],
  sizes: number[],
  min: number,
  max: number,
  want: Want
): number[][] {
  const reg = region(n, folds);
  const out: number[][] = [];
  for (const k of sizes) {
    for (const set of combos(reg, k)) {
      const open = openSheet(n, folds, set);
      if (open.length < min || open.length > max) continue;
      const sum = set.reduce((s, i) => s + multiplicity(n, folds, i), 0);
      if (sum !== open.length) continue; // buchi che si sovrappongono: conto illeggibile
      const nc = set.filter((i) => onCrease(n, folds, i)).length;
      if (want === 'free' && nc > 0) continue;
      if (want === 'crease' && nc === 0) continue;
      if (want === 'mix' && (nc === 0 || nc === set.length)) continue;
      out.push(set);
    }
  }
  return out;
}

/** costruisce pieghe valide + buchi ammessi, o lancia (ci pensa retry) */
function assemble(
  rng: Rng,
  n: number,
  nFolds: number,
  fam: 'ortho' | 'diag' | undefined,
  sizes: number[],
  min: number,
  max: number,
  want: Want
): Spec {
  const folds = makeFolds(rng, nFolds, fam);
  if (!foldsReadable(n, folds)) throw new Error('sequenza di pieghe illeggibile');
  const sets = punchSets(n, folds, sizes, min, max, want);
  if (!sets.length) throw new Error('nessun insieme di buchi utile');
  return { n, folds, punches: pick(rng, sets) };
}

// ---------------------------------------------------------------------------
// Varianti per difficoltà (ognuna è uno "scheletro" visivo diverso)
// ---------------------------------------------------------------------------

/** d1: una piega sola, buchi lontani dalla cordonatura, 2 o 4 buchi in tutto */
function specD1(rng: Rng): Spec {
  const n = randInt(rng, 0, 3) === 0 ? 2 : 3; // un quarto di fogli 2×2, più grandi da vedere
  const fam = pick(rng, ['ortho', 'diag'] as const);
  const sizes = n === 2 ? [1] : [1, 2];
  return assemble(rng, n, 1, fam, sizes, 2, 4, 'free');
}

/**
 * d2: entra in scena la cordonatura (un buco sulla linea non si sdoppia) oppure
 * la seconda piega. Mai le due cose insieme: quello è il livello 3.
 */
function specD2(rng: Rng): Spec {
  const kind = randInt(rng, 0, 3);
  // A/B: 3×3, una piega, un buco sulla linea + uno libero → 3-5 buchi
  if (kind <= 1) return assemble(rng, 3, 1, kind === 0 ? 'ortho' : 'diag', [2, 3], 3, 5, 'mix');
  // C: 3×3, due pieghe, un buco solo → 2 o 4 buchi
  if (kind === 2) return assemble(rng, 3, 2, undefined, [1], 2, 4, 'any');
  // D: 2×2, una piega, due buchi di cui uno sulla linea → 3 buchi
  return assemble(rng, 2, 1, 'diag', [2], 3, 4, 'mix');
}

/** d3: due pieghe con più buchi, oppure una piega con tre buchi misti. Max 5 buchi. */
function specD3(rng: Rng): Spec {
  const kind = randInt(rng, 0, 4);
  // A/B/C: 3×3, due pieghe, 2-3 buchi → 4 o 5 buchi (spesso una trama simmetrica)
  if (kind <= 2) return assemble(rng, 3, 2, kind === 0 ? 'diag' : 'ortho', [2, 3], 4, 5, 'any');
  // D/E: 3×3, una piega, 3 buchi di cui almeno uno sulla linea → 4 o 5 buchi
  return assemble(rng, 3, 1, kind === 3 ? 'ortho' : 'diag', [3], 4, 5, 'crease');
}

// ---------------------------------------------------------------------------
// Distrattori: errori tipici, costruiti (mai casuali)
// ---------------------------------------------------------------------------

type Kind = 'asse' | 'parziale' | 'nessuna' | 'meno' | 'piu';

interface Cand {
  kind: Kind;
  set: number[];
}

/** due caselle che si toccano (anche in diagonale) */
function touching(n: number, a: number, b: number): boolean {
  return Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 && Math.abs((a % n) - (b % n)) <= 1;
}

/** caselle in cui due trame di buchi differiscono */
function diffCells(a: number[], b: number[]): number[] {
  const A = new Set(a);
  const B = new Set(b);
  return [...new Set([...a, ...b])].filter((i) => A.has(i) !== B.has(i)).sort((x, y) => x - y);
}

/**
 * Un distrattore è utile solo se si distingue dalla risposta GUARDANDOLO.
 *  - a d3 deve cambiare almeno due caselle lontane fra loro, oppure cambiare il
 *    numero di buchi di almeno due (4 buchi contro 2 si vede subito): mai un
 *    solo buco spostato di un posto, sarebbe un gioco di differenze;
 *  - a d1/d2 una differenza di una casella sola si accetta solo su trame
 *    piccole, dove il numero di buchi si conta in un colpo d'occhio.
 */
function distinguishable(n: number, difficulty: Difficulty, correct: number[], set: number[]): boolean {
  const diff = diffCells(correct, set);
  if (!diff.length) return false;
  const gap = Math.abs(correct.length - set.length);
  const spread = diff.some((a, i) => diff.slice(i + 1).some((b) => !touching(n, a, b)));
  if (difficulty === 3) {
    if (diff.length < 2) return false;
    return gap >= 2 || spread;
  }
  if (diff.length === 1) return correct.length <= 3;
  // stesso numero di buchi e un solo buco spostato di una casella: troppo simile
  // (sulla griglia 2×2 tutte le caselle si toccano, lì la regola non si applica)
  if (n === 3 && gap === 0 && diff.length === 2) return spread;
  return true;
}

function buildCandidates(
  n: number,
  difficulty: Difficulty,
  folds: Fold[],
  punches: number[],
  correct: number[]
): Cand[] {
  const out: Cand[] = [];
  const push = (kind: Kind, raw: number[]) => {
    const set = [...new Set(raw)].sort((a, b) => a - b);
    // trame troppo fitte: contarle è fatica, non ragionamento
    if (!set.length || set.length > Math.min(n * n, 6)) return;
    if (!distinguishable(n, difficulty, correct, set)) return;
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
  for (const m of AXES as Sym[]) push('piu', [...correct, ...correct.map((i) => reflect(n, m, i))]);
  return out;
}

/** preferenze di plausibilità: numero più basso = distrattore più tentatore */
const PREF: Record<Difficulty, Record<Kind, number>> = {
  1: { asse: 0, nessuna: 1, meno: 2, piu: 3, parziale: 4 },
  2: { asse: 0, parziale: 1, meno: 2, nessuna: 3, piu: 4 },
  3: { parziale: 0, asse: 1, meno: 2, piu: 3, nessuna: 4 },
};

/**
 * Sceglie la COPPIA di distrattori, non due volte uno solo: conta che siano
 * errori tipici diversi fra loro (più istruttivo) e che le tre opzioni si
 * distinguano a vicenda, non solo dalla risposta giusta.
 */
function pickDistractors(rng: Rng, n: number, difficulty: Difficulty, cands: Cand[]): [number[], number[]] {
  // stesso insieme trovato da più errori: tieni il più tentatore
  const byKey = new Map<string, Cand>();
  for (const c of cands) {
    const prev = byKey.get(KEY(c.set));
    if (!prev || PREF[difficulty][c.kind] < PREF[difficulty][prev.kind]) byKey.set(KEY(c.set), c);
  }
  const list = [...byKey.values()];
  if (list.length < 2) throw new Error('distrattori insufficienti');

  let best: { pair: [number[], number[]]; score: number } | null = null;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      // due distrattori quasi uguali fra loro sprecano un'opzione
      const apart = diffCells(a.set, b.set).length >= (difficulty === 3 ? 2 : 1);
      const score =
        PREF[difficulty][a.kind] +
        PREF[difficulty][b.kind] +
        (a.kind === b.kind ? 2 : 0) +
        (apart ? 0 : 12) +
        rng();
      if (!best || score < best.score) best = { pair: [a.set, b.set], score };
    }
  }
  if (!best || best.score >= 12) throw new Error('distrattori troppo simili fra loro');
  return best.pair;
}

// ---------------------------------------------------------------------------
// Resa visiva
//   carta presente → tessera piena azzurra
//   carta ripiegata via → puntino vuoto (la sagoma del foglio piegato si vede)
//   buco → disco colorato
//   linea di piega → tratteggio giallo disegnato sopra la cella (crease)
// ---------------------------------------------------------------------------

/** carta ancora sotto le dita: tessera piena */
const PAPER: ShapeSpec = { shape: 'square', fillMode: 'solid', size: 0.94, color: 6 };
/** zona non più coperta dalla carta (ripiegata via): posto vuoto */
const AWAY: ShapeSpec = { shape: 'dot', fillMode: 'outline', size: 0.6, color: 6 };
/** buco: disco pieno, colore acceso, ben diverso dalla tessera */
function holeShape(color: number): ShapeSpec {
  return { shape: 'circle', fillMode: 'solid', size: 0.66, color };
}

/** colori dei buchi: mai l'azzurro della carta, il ciano del bordo, l'ambra della piega */
const HOLE_COLORS = [1, 2, 4, 5, 7];

interface CellOpts {
  crease?: Axis;
  label?: string;
  highlight?: boolean;
}

function sheetCell(
  n: number,
  holes: number[],
  covered: number[] | null,
  color: number,
  opts: CellOpts = {}
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
  if (opts.crease) cell.crease = opts.crease;
  if (opts.label) cell.label = opts.label;
  if (opts.highlight) cell.highlight = true;
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

/** come si chiamano le caselle attraversate dalla piega (quelle a un solo strato) */
function creaseText(n: number, axis: Axis): string {
  if (n !== 3) return axis === 'D' ? 'la diagonale ↘' : 'la diagonale ↗';
  if (axis === 'V') return 'la colonna di mezzo';
  if (axis === 'H') return 'la riga di mezzo';
  return axis === 'D' ? 'la diagonale ↘' : 'la diagonale ↗';
}

/**
 * Su griglia dispari (o con le pieghe in diagonale) alcune caselle stanno
 * proprio sopra la piega e restano a un solo strato: se il testo non lo dice,
 * il modello ingenuo "la prima riga finisce sulla seconda" porta a una risposta
 * sbagliata pur ragionando bene.
 */
function creaseNote(n: number, folds: Fold[]): string {
  const named = [...new Set(folds.map((f) => f.axis))].filter((axis) => {
    for (let i = 0; i < n * n; i++) if (sideOf(n, axis, i) === 0) return true;
    return false;
  });
  if (!named.length) return 'Il tratteggio è la piega: tutto quello che sta da una parte finisce sopra l\'altra. ';
  return `Il tratteggio è la piega: le caselle che ci stanno sopra (${named
    .map((a) => creaseText(n, a))
    .join(' e ')}) non si spostano. `;
}

const N_WORD = ['zero', 'un', 'due', 'tre'];

/** descrizione della trama finale, quando è riconoscibile a colpo d'occhio */
const PATTERNS: Record<string, string> = {
  '0,2,6,8': ', ai quattro angoli',
  '1,3,5,7': ', al centro dei quattro lati',
  '0,2,4,6,8': ', ai quattro angoli e al centro',
  '1,3,4,5,7': ': una croce',
  '0,2,3,5,6,8': ': la colonna di sinistra e quella di destra',
  '0,1,2,6,7,8': ': la riga in alto e quella in basso',
  '3,4,5': ': tutta la riga centrale',
  '1,4,7': ': tutta la colonna centrale',
  '0,4,8': ': tutta la diagonale ↘',
  '2,4,6': ': tutta la diagonale ↗',
  '0,8': ', sui due angoli della diagonale ↘',
  '2,6': ', sui due angoli della diagonale ↗',
  '0,2': ', nei due angoli in alto',
  '6,8': ', nei due angoli in basso',
  '0,6': ', nei due angoli di sinistra',
  '2,8': ', nei due angoli di destra',
};

function patternNote(n: number, holes: number[]): string {
  if (n !== 3) return holes.length === 4 ? ', uno per angolo' : '';
  return PATTERNS[KEY(holes)] ?? '';
}

function explain(spec: Spec, correct: number[]): string {
  const { n, folds, punches } = spec;
  const nb = punches.length;
  const creased = punches.filter((i) => onCrease(n, folds, i));
  const steps = folds
    .map((f, i) => `${folds.length > 1 ? `Piega ${i + 1}` : 'La piega'}: ${foldText(f)}.`)
    .join(' ');
  let t = `${steps} ${creaseNote(n, folds)}`;
  t +=
    nb === 1
      ? 'Il buco attraversa tutti gli strati, '
      : `I ${N_WORD[nb]} buchi attraversano tutti gli strati, `;
  t += "così riaprendo ogni buco ricompare specchiato dall'altra parte della piega";
  t += creased.length
    ? `, tranne ${creased.length === 1 ? 'quello fatto proprio SULLA linea, che resta uno solo' : 'quelli fatti proprio SULLA linea, che non si sdoppiano'}. `
    : '. ';
  const mults = punches.map((i) => multiplicity(n, folds, i));
  t += nb > 1 ? `Conto: ${mults.join(' + ')} = ${correct.length}. ` : `Quell'unico buco ne fa ${correct.length}. `;
  t += `Il foglio aperto ha ${correct.length} buchi${patternNote(n, correct)}.`;
  return t;
}

/** il prompt dice esplicitamente che il tratteggio è la piega: è la chiave di lettura */
function makePrompt(rng: Rng, nFolds: number, nPunches: number): string {
  const linea = nFolds === 1 ? 'la linea tratteggiata' : 'le linee tratteggiate';
  const sulla = nFolds === 1 ? 'sulla linea tratteggiata' : 'sulle linee tratteggiate';
  const buco = nPunches === 1 ? 'un buco' : 'i buchi';
  return pick(rng, [
    `Il foglio si piega lungo ${linea}, poi si ${nPunches === 1 ? 'fa un buco' : 'fanno i buchi'}: come sarà una volta riaperto?`,
    `Pieghiamo il foglio ${sulla}, facciamo ${buco} e riapriamo tutto: quale foglio viene fuori?`,
    `${nFolds === 1 ? 'La linea tratteggiata mostra' : 'Le linee tratteggiate mostrano'} dove passa la piega: come sarà il foglio riaperto?`,
  ]);
}

// ---------------------------------------------------------------------------

function build(rng: Rng, difficulty: Difficulty): Question {
  const spec = difficulty === 1 ? specD1(rng) : difficulty === 2 ? specD2(rng) : specD3(rng);
  const { n, folds, punches } = spec;
  const correct = openSheet(n, folds, punches);
  if (correct.length < 2) throw new Error('troppo pochi buchi');

  const cands = buildCandidates(n, difficulty, folds, punches, correct);
  const [w1, w2] = pickDistractors(rng, n, difficulty, cands);
  const color = pick(rng, HOLE_COLORS);

  // Al massimo 4 pannelli, sempre su una riga sola, ognuno con la sua etichetta:
  // foglio → piega (con il tratteggio della piega successiva) → carta bucata → ?
  const F = folds.length;
  const panels: CellSpec[] = [
    sheetCell(n, [], null, color, { crease: folds[0].axis, label: 'foglio' }),
    sheetCell(n, [], region(n, folds, 1), color, {
      crease: folds[Math.min(1, F - 1)].axis,
      label: F === 1 ? 'piegato' : '1ª piega',
    }),
    sheetCell(n, punches, region(n, folds), color, {
      crease: folds[F - 1].axis,
      label: F === 1 ? 'buchi' : '2ª e buchi',
      highlight: true,
    }),
    { shapes: [], unknown: true, label: 'riaperto?' },
  ];

  const asChoice = (holes: number[]): ChoiceVisual => ({ kind: 'cell', cell: sheetCell(n, holes, null, color) });
  const { choices, correctIndex } = placeChoices(rng, asChoice(correct), [asChoice(w1), asChoice(w2)]);

  return {
    qtype: 'fold',
    difficulty,
    prompt: makePrompt(rng, F, punches.length),
    payload: { kind: 'cells', rows: [panels], arrows: true },
    choices,
    correctIndex,
    explanation: explain(spec, correct),
  };
}

export function genFold(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => build(rng, difficulty), 60);
}

// utilità esportate per gli script di verifica (non usate dal gioco)
export const _internals = { reflect, sideOf, region, openSheet, multiplicity, onCrease, makeFolds, foldsReadable };
