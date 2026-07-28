// Generatore "balance": bilance logiche a due piatti con pesi interi coerenti.
// Difficoltà 1: una bilancia in equilibrio (a cerchi = a·k triangoli) → "quanti
// triangoli pesano quanto UN cerchio?". 2: due bilance transitive (A>B, B>C) →
// "quale forma è la più pesante?". 3: 2-3 equivalenze in catena da combinare
// (2 cerchi = 3 triangoli; 1 triangolo = 2 quadrati) con divisione finale.
// I pesi sono assegnati internamente e i tilt DERIVATI dai pesi, mai a mano.
// Distrattori: errori di conto tipici (dimenticare di dividere, sommare invece
// di moltiplicare, off-by-one, leggere la bilancia al contrario). Mai a caso.

import type { CountedShapes, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

interface ShapeInfo {
  shape: ShapeName;
  name: string; // "cerchio"
  plural: string; // "cerchi"
  un: string; // articolo indeterminativo: "un"/"una"
  il: string; // articolo determinativo: "il"/"la"
  del: string; // preposizione articolata: "del"/"della"
  quanti: string; // "Quanti"/"Quante"
}

const SHAPES: ShapeInfo[] = [
  { shape: 'circle', name: 'cerchio', plural: 'cerchi', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'square', name: 'quadrato', plural: 'quadrati', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'triangle', name: 'triangolo', plural: 'triangoli', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'star', name: 'stella', plural: 'stelle', un: 'una', il: 'la', del: 'della', quanti: 'Quante' },
  { shape: 'diamond', name: 'rombo', plural: 'rombi', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'heart', name: 'cuore', plural: 'cuori', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
];

const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

/** "3 cerchi" / "1 cerchio" */
function cnt(n: number, s: ShapeInfo): string {
  return `${n} ${n === 1 ? s.name : s.plural}`;
}

/** "UN cerchio" / "UNA stella" */
function UNO(s: ShapeInfo): string {
  return `${s.un.toUpperCase()} ${s.name}`;
}

type Scale = { left: CountedShapes[]; right: CountedShapes[]; tilt: -1 | 0 | 1 };

/** costruisce una bilancia col tilt DERIVATO dai pesi assegnati (mai incoerente) */
function mkScale(left: CountedShapes[], right: CountedShapes[], weight: (s: ShapeName) => number): Scale {
  const tot = (side: CountedShapes[]) => side.reduce((sum, it) => sum + it.count * weight(it.shape), 0);
  const l = tot(left);
  const r = tot(right);
  return { left, right, tilt: l > r ? -1 : l < r ? 1 : 0 };
}

function pan(s: ShapeInfo, color: number, count: number): CountedShapes[] {
  return [{ shape: s.shape, color, count }];
}

// ---------------------------------------------------------------------------
// d1: una bilancia in equilibrio, rapporto intero tra due forme
// ---------------------------------------------------------------------------
function genD1(rng: Rng): Question {
  const [A, B] = pickN(rng, SHAPES, 2);
  const [cA, cB] = pickN(rng, COLORS, 2);
  // [a, k]: a forme A equilibrano a·k forme B → UN A pesa quanto k B
  const [a, k] = pick(rng, [
    [2, 2],
    [2, 3],
    [2, 4],
    [3, 2],
  ] as const);
  // pesi interni: peso(A) = k, peso(B) = 1 → equilibrio garantito
  const weight = (s: ShapeName) => (s === A.shape ? k : 1);
  const sideA = pan(A, cA, a);
  const sideB = pan(B, cB, a * k);
  const scale = chance(rng, 0.5) ? mkScale(sideA, sideB, weight) : mkScale(sideB, sideA, weight);

  const wrong1 = a * k; // dimentica di dividere per a (legge il totale sul piatto)
  const wrong2 = chance(rng, 0.5) ? k + 1 : k - 1; // off-by-one (k ≥ 2 → mai < 1)

  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(k) }, [
    { kind: 'text', text: String(wrong1) },
    { kind: 'text', text: String(wrong2) },
  ]);
  return {
    qtype: 'balance',
    difficulty: 1,
    prompt: `${B.quanti} ${B.plural} pesano quanto ${UNO(A)}?`,
    payload: { kind: 'balance', scales: [scale] },
    choices,
    correctIndex,
    explanation:
      `La bilancia è in equilibrio: ${cnt(a, A)} pesano quanto ${cnt(a * k, B)}. ` +
      `Dividendo entrambi i piatti per ${a}: ${UNO(A)} pesa quanto ${a * k}÷${a} = ${cnt(k, B)}.`,
  };
}

// ---------------------------------------------------------------------------
// d2: due bilance transitive (H>M e M>L) → forma più pesante
// ---------------------------------------------------------------------------
function genD2(rng: Rng): Question {
  const [H, M, L] = pickN(rng, SHAPES, 3); // pesante, media, leggera
  const [cH, cM, cL] = pickN(rng, COLORS, 3);
  const w = new Map<ShapeName, number>([
    [H.shape, 3],
    [M.shape, 2],
    [L.shape, 1],
  ]);
  const weight = (s: ShapeName) => w.get(s) ?? 0;
  // 1 contro 1, lati casuali: il tilt deriva dai pesi
  const s1 = chance(rng, 0.5)
    ? mkScale(pan(H, cH, 1), pan(M, cM, 1), weight)
    : mkScale(pan(M, cM, 1), pan(H, cH, 1), weight);
  const s2 = chance(rng, 0.5)
    ? mkScale(pan(M, cM, 1), pan(L, cL, 1), weight)
    : mkScale(pan(L, cL, 1), pan(M, cM, 1), weight);
  const scales = chance(rng, 0.5) ? [s1, s2] : [s2, s1];

  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: H.name }, [
    { kind: 'text', text: M.name }, // la forma che "vince" solo un confronto diretto
    { kind: 'text', text: L.name }, // chi legge il tilt al contrario
  ]);
  return {
    qtype: 'balance',
    difficulty: 2,
    prompt: 'Quale forma è la più pesante?',
    payload: { kind: 'balance', scales },
    choices,
    correctIndex,
    explanation:
      `La bilancia pende sempre verso il piatto più pesante. Una bilancia mostra che ` +
      `${H.il} ${H.name} pesa più ${M.del} ${M.name}; l'altra che ${M.il} ${M.name} pesa più ` +
      `${L.del} ${L.name}. Mettendo in fila: ${H.name} > ${M.name} > ${L.name}, ` +
      `quindi la forma più pesante è ${H.il} ${H.name}.`,
  };
}

// ---------------------------------------------------------------------------
// d3: catena di 2-3 equivalenze da combinare, con divisione finale
// ---------------------------------------------------------------------------
function genD3(rng: Rng): Question {
  const three = chance(rng, 0.4);
  // [a, b, d(, e)]: a·S0 = b·S1, 1·S1 = d·S2 (, 1·S2 = e·S3); risposta n intera
  const combo = three
    ? pick(rng, [
        [2, 3, 2, 2], // n = 6
        [3, 2, 3, 2], // n = 4
        [1, 2, 3, 2], // n = 12
        [2, 3, 2, 3], // n = 9
      ] as const)
    : pick(rng, [
        [2, 3, 2], // n = 3 (2 cerchi = 3 triangoli; 1 triangolo = 2 quadrati)
        [2, 3, 4], // n = 6
        [3, 4, 3], // n = 4
        [2, 5, 2], // n = 5
        [1, 2, 3], // n = 6
        [1, 3, 2], // n = 6
        [3, 2, 3], // n = 2
      ] as const);
  const [a, b, d] = combo;
  const e = three ? (combo as readonly number[])[3] : 1;
  const infos = pickN(rng, SHAPES, three ? 4 : 3);
  const cols = pickN(rng, COLORS, infos.length);
  const [S0, S1, S2, S3] = infos;
  const T = three ? S3 : S2; // forma bersaglio della domanda
  const total = b * d * e; // quanti T equilibrano a·S0
  const n = total / a; // risposta (intera per costruzione dei combo)

  // pesi interni in unità della forma più leggera T
  const w = new Map<ShapeName, number>([
    [S0.shape, n],
    [S1.shape, d * e],
    [S2.shape, e],
  ]);
  if (three) w.set(S3.shape, 1);
  const weight = (s: ShapeName) => w.get(s) ?? 0;

  const flip = (l: CountedShapes[], r: CountedShapes[]) =>
    chance(rng, 0.5) ? mkScale(l, r, weight) : mkScale(r, l, weight);
  const scales: Scale[] = [flip(pan(S0, cols[0], a), pan(S1, cols[1], b)), flip(pan(S1, cols[1], 1), pan(S2, cols[2], d))];
  if (three) scales.push(flip(pan(S2, cols[2], 1), pan(S3, cols[3], e)));
  shuffle(rng, scales);

  // distrattori: dimentica la divisione per a / somma invece di moltiplicare; off-by-one
  let wrong1 = a > 1 ? total : b + d + (three ? e : 0);
  if (wrong1 === n) wrong1 = n + d;
  let wrong2 = n + (chance(rng, 0.5) ? 1 : -1);
  if (wrong2 === wrong1 || wrong2 < 1) wrong2 = 2 * n - wrong2; // passa all'altro off-by-one

  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [
    { kind: 'text', text: String(wrong1) },
    { kind: 'text', text: String(wrong2) },
  ]);

  let expl = `Sappiamo che ${cnt(a, S0)} = ${cnt(b, S1)} e ${cnt(1, S1)} = ${cnt(d, S2)}`;
  if (three) expl += ` e ${cnt(1, S2)} = ${cnt(e, S3)}`;
  expl += `. Quindi ${cnt(b, S1)} = ${cnt(b * d, S2)}`;
  if (three) expl += ` = ${cnt(b * d * e, S3)}`;
  expl += `, perciò ${cnt(a, S0)} = ${cnt(total, T)}`;
  expl +=
    a > 1
      ? `: dividendo per ${a}, ${UNO(S0)} pesa quanto ${total}÷${a} = ${cnt(n, T)}.`
      : `, cioè ${UNO(S0)} pesa quanto ${cnt(n, T)}.`;

  return {
    qtype: 'balance',
    difficulty: 3,
    prompt: `${T.quanti} ${T.plural} servono per bilanciare ${UNO(S0)}?`,
    payload: { kind: 'balance', scales },
    choices,
    correctIndex,
    explanation: expl,
  };
}

export function genBalance(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => (difficulty === 1 ? genD1(rng) : difficulty === 2 ? genD2(rng) : genD3(rng)));
}
