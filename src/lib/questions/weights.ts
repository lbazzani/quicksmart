// Generatore "weights": catene di equivalenze fra forme — "quanto vale?".
//
// Complementare a "balance": qui le bilance sono SEMPRE in equilibrio (tilt 0) e
// funzionano come un tabellone del cambio ("1 sole = 3 lune"); la domanda non è
// mai un confronto di peso ma una CONVERSIONE lungo la catena:
//   "quante X valgono UN Y?", "quanti Y valgono N X?", "quante X in tutto?".
//
// Difficoltà 1: una o due conversioni con numeri piccoli (moltiplica, dividi,
// somma). 2: catene a tre livelli, una divisione intermedia, gruppi misti su un
// piatto. 3: rapporti non unitari (serve il minimo comune multiplo), sistemi a
// due incognite da risolvere per eliminazione, mcm esplicito.
//
// I pesi interni sono INTERI e ogni bilancia viene verificata: se i due piatti
// non valgono uguale la generazione fallisce invece di produrre una domanda
// sbagliata. Le risposte sono sempre intere e uniche.
//
// Distrattori: errori tipici e mai casuali — sommare invece di moltiplicare,
// fermarsi al livello intermedio (rispondere nella "valuta" sbagliata),
// dimenticare la divisione, incrociare i moltiplicatori, off-by-one.

import type { CountedShapes, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

interface ShapeInfo {
  shape: ShapeName;
  name: string; // "luna"
  plural: string; // "lune"
  un: string; // articolo indeterminativo: "un"/"una"
  pl: string; // articolo determinativo plurale: "i"/"le"/"gli"
  quanti: string; // "Quanti"/"Quante"
}

const SHAPES: ShapeInfo[] = [
  { shape: 'circle', name: 'cerchio', plural: 'cerchi', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'square', name: 'quadrato', plural: 'quadrati', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'triangle', name: 'triangolo', plural: 'triangoli', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'star', name: 'stella', plural: 'stelle', un: 'una', pl: 'le', quanti: 'Quante' },
  { shape: 'moon', name: 'luna', plural: 'lune', un: 'una', pl: 'le', quanti: 'Quante' },
  { shape: 'heart', name: 'cuore', plural: 'cuori', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'diamond', name: 'rombo', plural: 'rombi', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'hexagon', name: 'esagono', plural: 'esagoni', un: 'un', pl: 'gli', quanti: 'Quanti' },
  { shape: 'pentagon', name: 'pentagono', plural: 'pentagoni', un: 'un', pl: 'i', quanti: 'Quanti' },
  { shape: 'cross', name: 'croce', plural: 'croci', un: 'una', pl: 'le', quanti: 'Quante' },
];

const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

// ---------------------------------------------------------------------------
// testo
// ---------------------------------------------------------------------------

/** "1 luna" / "3 lune" */
function cnt(n: number, s: ShapeInfo): string {
  return `${n} ${n === 1 ? s.name : s.plural}`;
}

/** "un sole" / "una luna" */
function uno(s: ShapeInfo): string {
  return `${s.un} ${s.name}`;
}

/** "UN sole" / "UNA luna" (con enfasi, per i prompt) */
function UNO(s: ShapeInfo): string {
  return `${s.un.toUpperCase()} ${s.name}`;
}

/** accordo del verbo: "1 luna VALE", "3 lune VALGONO" */
function val(n: number): string {
  return n === 1 ? 'vale' : 'valgono';
}

// ---------------------------------------------------------------------------
// bilance (sempre in equilibrio, verificate sui pesi interni)
// ---------------------------------------------------------------------------

type Scale = { left: CountedShapes[]; right: CountedShapes[]; tilt: -1 | 0 | 1 };
type Group = { s: ShapeInfo; color: number; n: number };
type Weights = Map<ShapeName, number>;

function g(s: ShapeInfo, color: number, n: number): Group {
  return { s, color, n };
}

function counted(gs: Group[]): CountedShapes[] {
  return gs.map((x) => ({ shape: x.s.shape, color: x.color, count: x.n }));
}

/** "2 soli e 1 luna" */
function groupsText(gs: Group[]): string {
  return gs.map((x) => cnt(x.n, x.s)).join(' e ');
}

/**
 * Equivalenza fra due gruppi: la bilancia è in equilibrio per costruzione.
 * Il lato su cui finisce ciascun gruppo è casuale (non cambia il significato).
 * Lancia se i pesi interni non coincidono: è la rete di sicurezza contro
 * un'aritmetica sbagliata nel generatore.
 */
function eqScale(rng: Rng, w: Weights, a: Group[], b: Group[]): Scale {
  const tot = (gs: Group[]) => gs.reduce((sum, x) => sum + x.n * (w.get(x.s.shape) ?? NaN), 0);
  // confronto negato: intercetta anche il NaN di una forma senza peso dichiarato
  if (!(tot(a) === tot(b))) throw new Error('equivalenza incoerente nel generatore weights');
  return chance(rng, 0.5)
    ? { left: counted(a), right: counted(b), tilt: 0 }
    : { left: counted(b), right: counted(a), tilt: 0 };
}

// ---------------------------------------------------------------------------
// distrattori
// ---------------------------------------------------------------------------

/**
 * Sceglie 2 distrattori fra i candidati (già ordinati per plausibilità):
 * interi positivi, diversi dalla risposta e fra loro, di ordine di grandezza
 * credibile. I fallback finali servono solo a non fallire mai su numeri piccoli.
 */
function chooseDistractors(rng: Rng, correct: number, candidates: number[]): [number, number] {
  const seen = new Set<number>([correct]);
  const pool: number[] = [];
  const max = correct * 6 + 8;
  for (const c of [...candidates, correct + 1, correct - 1, correct + 2, correct * 2, correct + 3]) {
    if (!Number.isFinite(c) || !Number.isInteger(c)) continue;
    if (c < 1 || c > max || seen.has(c)) continue;
    seen.add(c);
    pool.push(c);
  }
  if (pool.length < 2) throw new Error('distrattori insufficienti');
  // fra i più plausibili se ce ne sono, per non usare sempre gli stessi due
  const head = pool.slice(0, Math.min(4, pool.length));
  const [a, b] = pickN(rng, head, 2);
  return [a, b];
}

// ---------------------------------------------------------------------------
// aritmetica
// ---------------------------------------------------------------------------

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b;
}

/** "4, 8, 12" — i multipli di p fino a limite compreso */
function multiples(p: number, limit: number): string {
  const out: number[] = [];
  for (let k = p; k <= limit; k += p) out.push(k);
  return out.join(', ');
}

// ---------------------------------------------------------------------------
// modello di una domanda già risolta
// ---------------------------------------------------------------------------

interface Built {
  scales: Scale[];
  prompt: string;
  answer: number;
  /** candidati distrattori in ordine di plausibilità */
  wrong: number[];
  explanation: string;
}

function finish(rng: Rng, difficulty: Difficulty, b: Built): Question {
  const [w1, w2] = chooseDistractors(rng, b.answer, b.wrong);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(b.answer) }, [
    { kind: 'text', text: String(w1) },
    { kind: 'text', text: String(w2) },
  ]);
  return {
    qtype: 'weights',
    difficulty,
    prompt: b.prompt,
    payload: { kind: 'balance', scales: b.scales },
    choices,
    correctIndex,
    explanation: b.explanation,
  };
}

// ---------------------------------------------------------------------------
// difficoltà 1 — una conversione, al massimo due passi con numeri piccoli
// ---------------------------------------------------------------------------

/** 1 A = k B → "quante B valgono m A?" (moltiplicare) */
function d1Mul(rng: Rng): Built {
  const [A, B] = pickN(rng, SHAPES, 2);
  const [cA, cB] = pickN(rng, COLORS, 2);
  const k = randInt(rng, 2, 5);
  const m = randInt(rng, 2, 3);
  const w: Weights = new Map([
    [A.shape, k],
    [B.shape, 1],
  ]);
  return {
    scales: [eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, k)])],
    prompt: `${B.quanti} ${B.plural} valgono ${cnt(m, A)}?`,
    answer: k * m,
    wrong: [k + m, k, k * (m + 1), k * m - k, m],
    explanation:
      `La bilancia è in equilibrio: ${cnt(1, A)} ${val(1)} ${cnt(k, B)}. ` +
      `Allora ${cnt(m, A)} valgono ${m} volte tanto: ${m}×${k} = ${cnt(k * m, B)}.`,
  };
}

/** a A = a·k B → "quante B valgono UN A?" (dividere) */
function d1Div(rng: Rng): Built {
  const [A, B] = pickN(rng, SHAPES, 2);
  const [cA, cB] = pickN(rng, COLORS, 2);
  const a = randInt(rng, 2, 3);
  const k = randInt(rng, 2, 4);
  const w: Weights = new Map([
    [A.shape, k],
    [B.shape, 1],
  ]);
  return {
    scales: [eqScale(rng, w, [g(A, cA, a)], [g(B, cB, a * k)])],
    prompt: `${B.quanti} ${B.plural} valgono ${UNO(A)}?`,
    answer: k,
    wrong: [a * k, k + 1, k - 1, a * k - a, a + k],
    explanation:
      `I due piatti valgono uguale: ${cnt(a, A)} valgono ${cnt(a * k, B)}. ` +
      `Divido tutto per ${a}: ${uno(A)} ${val(1)} ${a * k}÷${a} = ${cnt(k, B)}.`,
  };
}

/** 1 A = a B, 1 B = b C → "quante C valgono UN A?" (catena, moltiplicare) */
function d1ChainDown(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const a = randInt(rng, 2, 4);
  const b = randInt(rng, 2, 3);
  const w: Weights = new Map([
    [A.shape, a * b],
    [B.shape, b],
    [C.shape, 1],
  ]);
  return {
    scales: [
      eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, a)]),
      eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
    ],
    prompt: `${C.quanti} ${C.plural} valgono ${UNO(A)}?`,
    answer: a * b,
    wrong: [a + b, a * b + a, a, b],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, B)}, e ${cnt(1, B)} ${val(1)} ${cnt(b, C)}. ` +
      `Quindi ${uno(A)} vale ${a} gruppi da ${b}: ${a}×${b} = ${cnt(a * b, C)}.`,
  };
}

/** stessa catena, domanda inversa: "quanti A valgono N C?" (dividere) */
function d1ChainUp(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const a = randInt(rng, 2, 3);
  const b = randInt(rng, 2, 3);
  const m = randInt(rng, 2, 3);
  const unit = a * b;
  const N = unit * m;
  const w: Weights = new Map([
    [A.shape, unit],
    [B.shape, b],
    [C.shape, 1],
  ]);
  return {
    scales: [
      eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, a)]),
      eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
    ],
    prompt: `${A.quanti} ${A.plural} valgono ${N} ${C.plural}?`,
    answer: m,
    wrong: [unit, a * m, N - unit, m + 1],
    explanation:
      `Prima il cambio: ${cnt(1, A)} ${val(1)} ${cnt(a, B)} = ${cnt(unit, C)}. ` +
      `Poi divido: ${N}÷${unit} = ${cnt(m, A)}.`,
  };
}

/** 1 A = a C, 1 B = b C → "quante C valgono in tutto un A e un B?" (sommare) */
function d1Sum(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const a = randInt(rng, 2, 5);
  let b = randInt(rng, 2, 5);
  if (b === a) b = a === 5 ? 2 : a + 1;
  const w: Weights = new Map([
    [A.shape, a],
    [B.shape, b],
    [C.shape, 1],
  ]);
  return {
    scales: [
      eqScale(rng, w, [g(A, cA, 1)], [g(C, cC, a)]),
      eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
    ],
    prompt: `${C.quanti} ${C.plural} valgono in tutto ${uno(A)} e ${uno(B)}?`,
    answer: a + b,
    wrong: [a * b, Math.abs(a - b), Math.max(a, b), a + b + 1],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, C)} e ${cnt(1, B)} ${val(1)} ${cnt(b, C)}. ` +
      `Messi insieme: ${a}+${b} = ${cnt(a + b, C)}.`,
  };
}

// ---------------------------------------------------------------------------
// difficoltà 2 — tre livelli, divisione intermedia, gruppi misti
// ---------------------------------------------------------------------------

/** terne con prodotto ≤ 24 (catena a tre passi leggibile) */
const TRIPLES_24 = [
  [2, 2, 2],
  [2, 2, 3],
  [2, 3, 2],
  [3, 2, 2],
  [2, 3, 3],
  [3, 3, 2],
  [3, 2, 3],
  [2, 2, 4],
  [4, 2, 2],
  [2, 4, 2],
  [3, 4, 2],
  [2, 4, 3],
  [4, 3, 2],
  [3, 2, 4],
] as const;

/** terne con prodotto ≤ 18 (per la domanda inversa, che moltiplica ancora) */
const TRIPLES_18 = TRIPLES_24.filter(([a, b, c]) => a * b * c <= 18);

/** 1 A = a B, 1 B = b C, 1 C = c D → "quante D valgono UN A?" */
function d2Chain3Down(rng: Rng): Built {
  const [A, B, C, D] = pickN(rng, SHAPES, 4);
  const [cA, cB, cC, cD] = pickN(rng, COLORS, 4);
  const [a, b, c] = pick(rng, TRIPLES_24);
  const w: Weights = new Map([
    [A.shape, a * b * c],
    [B.shape, b * c],
    [C.shape, c],
    [D.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, a)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
    eqScale(rng, w, [g(C, cC, 1)], [g(D, cD, c)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${D.quanti} ${D.plural} valgono ${UNO(A)}?`,
    answer: a * b * c,
    wrong: [a + b + c, a * b, b * c, a * c, a * b * c + c],
    explanation:
      `Metto in fila i cambi: ${cnt(1, A)} = ${cnt(a, B)}, ${cnt(1, B)} = ${cnt(b, C)}, ` +
      `${cnt(1, C)} = ${cnt(c, D)}. Si moltiplica lungo la catena: ` +
      `${a}×${b}×${c} = ${cnt(a * b * c, D)}.`,
  };
}

/** stessa catena a 3 livelli, domanda inversa */
function d2Chain3Up(rng: Rng): Built {
  const [A, B, C, D] = pickN(rng, SHAPES, 4);
  const [cA, cB, cC, cD] = pickN(rng, COLORS, 4);
  const [a, b, c] = pick(rng, TRIPLES_18);
  const unit = a * b * c;
  const m = unit <= 12 ? randInt(rng, 2, 3) : 2;
  const N = unit * m;
  const w: Weights = new Map([
    [A.shape, unit],
    [B.shape, b * c],
    [C.shape, c],
    [D.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, a)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
    eqScale(rng, w, [g(C, cC, 1)], [g(D, cD, c)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${A.quanti} ${A.plural} valgono ${N} ${D.plural}?`,
    answer: m,
    wrong: [unit, a * m, a * b * m, N - unit, m + 1],
    explanation:
      `${cnt(1, A)} ${val(1)} ${a}×${b}×${c} = ${cnt(unit, D)}. ` +
      `Con ${N} ${D.plural} faccio ${N}÷${unit} = ${cnt(m, A)}.`,
  };
}

/** p A = p·u B (serve dividere), 1 B = c C → "quante C valgono UN A?" */
function d2ChainDiv(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const p = randInt(rng, 2, 3);
  const u = randInt(rng, 2, 4);
  const c = randInt(rng, 2, 3);
  const w: Weights = new Map([
    [A.shape, u * c],
    [B.shape, c],
    [C.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, p)], [g(B, cB, p * u)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, c)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${UNO(A)}?`,
    answer: u * c,
    wrong: [p * u * c, u + c, p * u, u, u * c + c],
    explanation:
      `Attenzione al primo cambio: ${cnt(p, A)} valgono ${cnt(p * u, B)}, quindi ` +
      `${uno(A)} ${val(1)} ${p * u}÷${p} = ${cnt(u, B)}. ` +
      `E ${cnt(1, B)} ${val(1)} ${cnt(c, C)}: in tutto ${u}×${c} = ${cnt(u * c, C)}.`,
  };
}

/** 1 A = 1 B + k C (piatto misto), 1 B = d C → "quante C valgono UN A?" */
function d2Combo(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const k = randInt(rng, 1, 2);
  const d = randInt(rng, 2, 5);
  const w: Weights = new Map([
    [A.shape, d + k],
    [B.shape, d],
    [C.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, 1), g(C, cC, k)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, d)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${UNO(A)}?`,
    answer: d + k,
    wrong: [k * d, d, 2 * d, d - k, d + k + 1],
    explanation:
      `Sul piatto misto ${cnt(1, A)} ${val(1)} ${cnt(1, B)} più ${cnt(k, C)}. ` +
      `Siccome ${cnt(1, B)} ${val(1)} ${cnt(d, C)}, sostituisco: ${d}+${k} = ${cnt(d + k, C)}.`,
  };
}

/** 1 A = a C, 1 B = b C → "quante C valgono in tutto m A e n B?" */
function d2SumMul(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const a = randInt(rng, 2, 4);
  let b = randInt(rng, 2, 4);
  if (b === a) b = a === 4 ? 2 : a + 1;
  const m = randInt(rng, 2, 3);
  const n = m === 2 ? pick(rng, [1, 3]) : pick(rng, [1, 2]);
  const answer = m * a + n * b;
  const w: Weights = new Map([
    [A.shape, a],
    [B.shape, b],
    [C.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(C, cC, a)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, b)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono in tutto ${cnt(m, A)} e ${cnt(n, B)}?`,
    answer,
    wrong: [n * a + m * b, a + b, m * a, n * b, answer + 1],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, C)}, quindi ${cnt(m, A)} valgono ${m}×${a} = ${m * a}. ` +
      `${cnt(1, B)} ${val(1)} ${cnt(b, C)}, quindi ${cnt(n, B)} ${val(n)} ${n}×${b} = ${n * b}. ` +
      `Sommo: ${m * a}+${n * b} = ${cnt(answer, C)}.`,
  };
}

// ---------------------------------------------------------------------------
// difficoltà 3 — rapporti non unitari, sistemi, mcm
// ---------------------------------------------------------------------------

interface ChainNU {
  p: number;
  q: number;
  r: number;
  t: number;
  /** quanti A si devono prendere perché il cambio torni intero */
  n: number;
  ans: number;
}

/**
 * Catene con rapporti NON unitari: p A = q B e r B = t C. Per convertire serve
 * il minimo comune multiplo di q e r (il "ponte" in B): con L = mcm(q,r),
 * n = p·L/q pezzi di A valgono esattamente ans = t·L/r pezzi di C.
 */
function buildNonUnitChains(): ChainNU[] {
  const out: ChainNU[] = [];
  for (let p = 2; p <= 4; p++) {
    for (let q = p + 1; q <= 6; q++) {
      if (gcd(p, q) !== 1) continue; // altrimenti la relazione si semplifica
      for (let r = 2; r <= 4; r++) {
        if (r === q) continue; // niente aggancio diretto: il ponte deve costare qualcosa
        for (let t = r + 1; t <= 6; t++) {
          if (gcd(r, t) !== 1) continue;
          const L = lcm(q, r);
          const n = (p * L) / q;
          const ans = (t * L) / r;
          if (n < 2 || n > 12 || ans < 3 || ans > 24 || ans === n) continue;
          out.push({ p, q, r, t, n, ans });
        }
      }
    }
  }
  return out;
}

const NON_UNIT_CHAINS = buildNonUnitChains();

/** p A = q B, r B = t C → "quante C valgono n A?" (serve il mcm sul ponte B) */
function d3NonUnitChain(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const { p, q, r, t, n, ans } = pick(rng, NON_UNIT_CHAINS);
  const mid = lcm(q, r); // il "ponte": quante B corrispondono a n A
  const f1 = mid / q; // di quanto va ingrandita la prima bilancia
  const f2 = mid / r; // e la seconda
  // pesi interi: C = p·r, B = p·t, A = q·t
  const w: Weights = new Map([
    [A.shape, q * t],
    [B.shape, p * t],
    [C.shape, p * r],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, p)], [g(B, cB, q)]),
    eqScale(rng, w, [g(B, cB, r)], [g(C, cC, t)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${n} ${A.plural}?`,
    answer: ans,
    wrong: [mid, q * t, ans + 1, ans - 1, n + t],
    explanation:
      `Nessuna bilancia parla di UN pezzo solo: il ponte sono ${cnt(mid, B)}, ` +
      `il minimo comune multiplo di ${q} e ${r}. ` +
      `Da ${cnt(p, A)} = ${cnt(q, B)}${f1 > 1 ? `, tutto ×${f1}` : ''}: ${cnt(n, A)} = ${cnt(mid, B)}. ` +
      `Da ${cnt(r, B)} = ${cnt(t, C)}${f2 > 1 ? `, tutto ×${f2}` : ''}: ${cnt(mid, B)} = ${cnt(ans, C)}. ` +
      `Quindi ${cnt(n, A)} valgono ${cnt(ans, C)}.`,
  };
}

/** coefficienti dei piatti misti: al massimo 3 forme per piatto */
const SYS_COEFFS = [
  [1, 1],
  [1, 2],
  [2, 1],
] as const;

/**
 * Sistema a due incognite: x₁A + y₁B = z₁C e x₂A + y₂B = z₂C.
 * Due coppie di coefficienti diverse hanno sempre determinante ≠ 0, quindi la
 * soluzione è unica; i pesi sono scelti prima, così i totali sono interi.
 */
function d3System(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const wB = randInt(rng, 2, 3);
  const wA = randInt(rng, wB + 1, 7);
  const [e1, e2] = pickN(rng, SYS_COEFFS, 2);
  let [x1, y1] = e1;
  let [x2, y2] = e2;
  let z1 = x1 * wA + y1 * wB;
  let z2 = x2 * wA + y2 * wB;
  const w: Weights = new Map([
    [A.shape, wA],
    [B.shape, wB],
    [C.shape, 1],
  ]);
  // eliminazione delle B: moltiplico le righe per portarle allo stesso numero di B
  const L = lcm(y1, y2);
  let k1 = L / y1;
  let k2 = L / y2;
  if (k1 * x1 - k2 * x2 < 0) {
    // sottraggo sempre la riga con MENO A, così i conti restano positivi
    [x1, y1, z1, k1, x2, y2, z2, k2] = [x2, y2, z2, k2, x1, y1, z1, k1];
  }
  const dA = k1 * x1 - k2 * x2;
  const dz = k1 * z1 - k2 * z2;
  if (dA <= 0 || dz / dA !== wA) throw new Error('sistema degenere nel generatore weights');
  const row1 = [g(A, cA, x1), g(B, cB, y1)];
  const row2 = [g(A, cA, x2), g(B, cB, y2)];
  const scales = [
    eqScale(rng, w, row1, [g(C, cC, z1)]),
    eqScale(rng, w, row2, [g(C, cC, z2)]),
  ];
  const scaled: string[] = [];
  if (k1 > 1) scaled.push(`la riga "${groupsText(row1)}" per ${k1}`);
  if (k2 > 1) scaled.push(`la riga "${groupsText(row2)}" per ${k2}`);
  const step = scaled.length
    ? `Moltiplico ${scaled.join(' e ')}, così tutte e due arrivano a ${cnt(L, B)}: ` +
      `${cnt(k1 * x1, A)} + ${cnt(L, B)} = ${cnt(k1 * z1, C)} e ${cnt(k2 * x2, A)} + ${cnt(L, B)} = ${cnt(k2 * z2, C)}. `
    : `Le due bilance hanno già lo stesso numero di ${B.plural}. `;
  const tail =
    dA === 1
      ? `resta ${cnt(1, A)} = ${cnt(dz, C)}: ${uno(A)} ${val(1)} ${cnt(wA, C)}`
      : `resta ${cnt(dA, A)} = ${cnt(dz, C)}, quindi ${uno(A)} ${val(1)} ${dz}÷${dA} = ${cnt(wA, C)}`;
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${UNO(A)}?`,
    answer: wA,
    wrong: [wB, wA + wB, z1 - z2, wA + 1, wA - 1],
    explanation:
      `Due bilance, due incognite. ` +
      step +
      `Tolgo una riga dall'altra: ${B.pl} ${B.plural} spariscono e ${tail}. ` +
      `Controprova: ${cnt(1, B)} ${val(1)} ${cnt(wB, C)}.`,
  };
}

/** coppie (p,q) in cui nessuno dei due è multiplo dell'altro: serve il mcm vero */
function buildLcmPairs(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let p = 2; p <= 6; p++) {
    for (let q = 2; q <= 6; q++) {
      if (p === q || p % q === 0 || q % p === 0) continue;
      if (lcm(p, q) > 20) continue;
      out.push([p, q]);
    }
  }
  return out;
}

const LCM_PAIRS = buildLcmPairs();

/** 1 A = p C, 1 B = q C → "il gruppo più piccolo di C cambiabile in A o in B" */
function d3Lcm(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const [p, q] = pick(rng, LCM_PAIRS);
  const L = lcm(p, q);
  const w: Weights = new Map([
    [A.shape, p],
    [B.shape, q],
    [C.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(C, cC, p)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, q)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt:
      `Un gruppo di ${C.plural} si può cambiare tutto in ${A.plural} oppure tutto in ${B.plural}. ` +
      `${C.quanti} ${C.plural} servono come minimo?`,
    answer: L,
    wrong: [p * q, p + q, Math.max(p, q), L + Math.min(p, q)],
    explanation:
      `Ogni ${A.name} vale ${cnt(p, C)}: con ${A.pl} ${A.plural} si arriva a ${multiples(p, L)} ${C.plural}. ` +
      `Ogni ${B.name} ne vale ${q}: ${multiples(q, L)}. ` +
      `Il primo numero che compare in tutte e due le file è ${L}, il minimo comune multiplo di ${p} e ${q}.`,
  };
}

/** p A = p·u B, 1 B = c C → "quante C valgono in tutto m A e n B?" */
function d3MixedTotal(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const p = randInt(rng, 2, 3);
  const u = randInt(rng, 2, 3);
  const c = randInt(rng, 2, 3);
  const m = randInt(rng, 2, 3);
  const n = randInt(rng, 1, 3);
  const midB = m * u + n; // tutto convertito in B
  const answer = midB * c;
  const w: Weights = new Map([
    [A.shape, u * c],
    [B.shape, c],
    [C.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, p)], [g(B, cB, p * u)]),
    eqScale(rng, w, [g(B, cB, 1)], [g(C, cC, c)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono in tutto ${cnt(m, A)} e ${cnt(n, B)}?`,
    answer,
    wrong: [(m * p * u + n) * c, m * u * c, (u + n) * c, m * u + n * c, answer + c],
    explanation:
      `${cnt(p, A)} valgono ${cnt(p * u, B)}, quindi ${uno(A)} ${val(1)} ${p * u}÷${p} = ${cnt(u, B)}. ` +
      `Allora ${cnt(m, A)} valgono ${m}×${u} = ${m * u} ${B.plural}, che con ${cnt(n, B)} fanno ${cnt(midB, B)}. ` +
      `Infine ${cnt(1, B)} ${val(1)} ${cnt(c, C)}: ${midB}×${c} = ${cnt(answer, C)}.`,
  };
}

/** terne (a, v, c) per la catena a 3 livelli con divisione: a·v·c ≤ 12 */
const DEEP_TRIPLES = [
  [2, 2, 2],
  [2, 2, 3],
  [2, 3, 2],
  [3, 2, 2],
] as const;

/** 1 A = a B, b B = b·v C, 1 C = c D → "quanti A valgono N D?" */
function d3DeepUp(rng: Rng): Built {
  const [A, B, C, D] = pickN(rng, SHAPES, 4);
  const [cA, cB, cC, cD] = pickN(rng, COLORS, 4);
  const [a, v, c] = pick(rng, DEEP_TRIPLES);
  const b = randInt(rng, 2, 3);
  const m = randInt(rng, 2, 3);
  const unit = a * v * c;
  const N = unit * m;
  const w: Weights = new Map([
    [A.shape, unit],
    [B.shape, v * c],
    [C.shape, c],
    [D.shape, 1],
  ]);
  const scales = [
    eqScale(rng, w, [g(A, cA, 1)], [g(B, cB, a)]),
    eqScale(rng, w, [g(B, cB, b)], [g(C, cC, b * v)]),
    eqScale(rng, w, [g(C, cC, 1)], [g(D, cD, c)]),
  ];
  shuffle(rng, scales);
  return {
    scales,
    prompt: `${A.quanti} ${A.plural} valgono ${N} ${D.plural}?`,
    answer: m,
    wrong: [unit, a * m, a * v * m, N - unit, m + 1],
    explanation:
      `La bilancia di mezzo va semplificata: ${cnt(b, B)} valgono ${cnt(b * v, C)}, cioè ` +
      `${cnt(1, B)} ${val(1)} ${cnt(v, C)}. Allora ${cnt(1, A)} = ${cnt(a, B)} = ` +
      `${cnt(a * v, C)} = ${cnt(unit, D)}. Infine ${N}÷${unit} = ${cnt(m, A)}.`,
  };
}

// ---------------------------------------------------------------------------

const D1 = [d1Mul, d1Div, d1ChainDown, d1ChainUp, d1Sum];
const D2 = [d2Chain3Down, d2Chain3Up, d2ChainDiv, d2Combo, d2SumMul];
const D3 = [d3NonUnitChain, d3System, d3Lcm, d3MixedTotal, d3DeepUp];

export function genWeights(rng: Rng, difficulty: Difficulty): Question {
  const variants = difficulty === 1 ? D1 : difficulty === 2 ? D2 : D3;
  return retry(() => finish(rng, difficulty, pick(rng, variants)(rng)));
}
