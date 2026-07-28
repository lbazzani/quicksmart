// Generatore "arithgrid": sistema di equazioni con simboli (forme colorate).
// Ogni forma (con il suo colore fisso) vale un intero 1-12; le prime righe
// permettono di ricavare i valori in catena, l'ultima riga è l'incognita.
// d1: 2 equazioni additive con 2 simboli.
// d2: 3 equazioni con sottrazione, valori ricavabili in catena (3 simboli).
// d3: moltiplicazione mista (es. cerchio x quadrato) e ultima riga che combina
//     le tre forme con precedenza degli operatori (prima la moltiplicazione).
// Distrattori costruiti ad arte: valutazione da sinistra a destra (d3),
// scambio dei valori di due simboli, errore di conto di ±1/±2. Mai a caso.

import type { Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

type Op = '+' | '-' | 'x';

/** un simbolo: forma+colore (identità visiva) e il suo valore segreto */
interface Sym {
  spec: ShapeSpec;
  name: string;
  value: number;
}

interface EqRow {
  terms: Sym[];
  ops: Op[];
  result: number;
  /** come si ricava il simbolo nuovo da questa riga (per l'explanation) */
  deduce?: string;
}

const SHAPES: ShapeName[] = [
  'circle', 'square', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross', 'moon',
];

const ITA: Record<string, string> = {
  circle: 'cerchio',
  square: 'quadrato',
  triangle: 'triangolo',
  diamond: 'rombo',
  star: 'stella',
  pentagon: 'pentagono',
  hexagon: 'esagono',
  heart: 'cuore',
  cross: 'croce',
  moon: 'luna',
};

const VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** crea i simboli: forme distinte, colori distinti, stesso colore per tutta la domanda */
function makeSymbols(rng: Rng, values: number[]): Sym[] {
  const shapes = pickN(rng, SHAPES, values.length);
  const colors = pickN(rng, [0, 1, 2, 3, 4, 5, 6, 7], values.length);
  return values.map((v, i) => ({
    spec: { shape: shapes[i], color: colors[i], fillMode: 'solid' as const },
    name: ITA[shapes[i]],
    value: v,
  }));
}

function payloadRow(
  terms: Sym[],
  ops: Op[],
  result: number | string
): { items: (ShapeSpec | string)[]; result: number | string } {
  const items: (ShapeSpec | string)[] = [];
  terms.forEach((t, i) => {
    if (i > 0) items.push(ops[i - 1]);
    items.push({ ...t.spec });
  });
  return { items, result };
}

/** "cerchio + quadrato" (nomi dei simboli) */
function symText(terms: Sym[], ops: Op[]): string {
  return terms.map((t, i) => (i ? ` ${ops[i - 1]} ` : '') + t.name).join('');
}

/** "4 + 5" (valori dei simboli) */
function valText(terms: Sym[], ops: Op[]): string {
  return terms.map((t, i) => (i ? ` ${ops[i - 1]} ` : '') + t.value).join('');
}

/** primi 2 candidati validi: interi positivi, distinti, diversi dalla corretta */
function twoDistractors(correct: number, candidates: number[]): [number, number] {
  const seen = new Set<number>([correct]);
  const out: number[] = [];
  for (const c of candidates) {
    if (Number.isInteger(c) && c > 0 && !seen.has(c)) {
      seen.add(c);
      out.push(c);
      if (out.length === 2) return [out[0], out[1]];
    }
  }
  throw new Error('distrattori insufficienti');
}

function finish(
  rng: Rng,
  difficulty: Difficulty,
  rows: { items: (ShapeSpec | string)[]; result: number | string }[],
  correct: number,
  dists: [number, number],
  explanation: string
): Question {
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(correct) }, [
    { kind: 'text', text: String(dists[0]) },
    { kind: 'text', text: String(dists[1]) },
  ]);
  return {
    qtype: 'arithgrid' as const,
    difficulty,
    prompt: "Quanto vale l'ultima riga?",
    payload: { kind: 'equation' as const, rows },
    choices,
    correctIndex,
    explanation,
  };
}

// ---------------------------------------------------------------------------
// d1: 2 equazioni additive, 2 simboli. Riga 1 fissa A, riga 2 ricava B.
// ---------------------------------------------------------------------------
function makeD1(rng: Rng): Question {
  const [va, vb] = pickN(rng, VALUES, 2);
  const [A, B] = makeSymbols(rng, [va, vb]);

  const n1 = pick(rng, [2, 3]); // A + A (+ A)
  const eq1: EqRow = { terms: Array(n1).fill(A), ops: Array(n1 - 1).fill('+') as Op[], result: n1 * va };
  const eq2: EqRow = chance(rng, 0.5)
    ? { terms: [A, B], ops: ['+'], result: va + vb }
    : { terms: [B, A], ops: ['+'], result: va + vb };

  // ultima riga: solo addizioni, mai identica alle righe date
  const variants: Sym[][] = [[B, B], [B, B, B], [A, B, B], [B, A, B]];
  const qTerms = variants[randInt(rng, 0, 3)];
  const qOps = Array(qTerms.length - 1).fill('+') as Op[];
  const correct = qTerms.reduce((s, t) => s + t.value, 0);

  // distrattori: valori di A e B scambiati; errore di conto ±1/±2
  const swapped = qTerms.reduce((s, t) => s + (t === A ? vb : va), 0);
  const off = pick(rng, [1, 2]);
  const off2 = 3 - off;
  const dists = twoDistractors(correct, [
    ...shuffle(rng, [swapped, correct + off, correct - off]),
    correct + off2,
    correct - off2,
  ]);

  const explanation =
    `Prima riga: ${symText(eq1.terms, eq1.ops)} = ${eq1.result}, quindi ${A.name} = ${eq1.result} : ${n1} = ${va}. ` +
    `Seconda riga: ${symText(eq2.terms, eq2.ops)} = ${eq2.result}, quindi ${B.name} = ${eq2.result} - ${va} = ${vb}. ` +
    `Ultima riga: ${symText(qTerms, qOps)} = ${valText(qTerms, qOps)} = ${correct}.`;

  const rows = [
    payloadRow(eq1.terms, eq1.ops, eq1.result),
    payloadRow(eq2.terms, eq2.ops, eq2.result),
    payloadRow(qTerms, qOps, '?'),
  ];
  return finish(rng, 1, rows, correct, dists, explanation);
}

// ---------------------------------------------------------------------------
// d2: 3 equazioni con sottrazione, catena A → B → C, ultima riga con + e -.
// ---------------------------------------------------------------------------
function makeD2(rng: Rng): Question {
  const [va, vb, vc] = pickN(rng, VALUES, 3);
  const [A, B, C] = makeSymbols(rng, [va, vb, vc]);

  const n1 = pick(rng, [2, 3]);
  const eq1: EqRow = { terms: Array(n1).fill(A), ops: Array(n1 - 1).fill('+') as Op[], result: n1 * va };

  // eq2: sottrazione tra A e B (sempre con risultato positivo)
  const eq2: EqRow =
    va > vb
      ? { terms: [A, B], ops: ['-'], result: va - vb, deduce: `${B.name} = ${va} - ${va - vb} = ${vb}` }
      : { terms: [B, A], ops: ['-'], result: vb - va, deduce: `${B.name} = ${vb - va} + ${va} = ${vb}` };

  // eq3: ricava C da A o B (a volte con un'altra sottrazione)
  const opts3: EqRow[] = [
    { terms: [B, C], ops: ['+'], result: vb + vc, deduce: `${C.name} = ${vb + vc} - ${vb} = ${vc}` },
    { terms: [A, C], ops: ['+'], result: va + vc, deduce: `${C.name} = ${va + vc} - ${va} = ${vc}` },
  ];
  if (vb > vc) opts3.push({ terms: [B, C], ops: ['-'], result: vb - vc, deduce: `${C.name} = ${vb} - ${vb - vc} = ${vc}` });
  if (vc > vb) opts3.push({ terms: [C, B], ops: ['-'], result: vc - vb, deduce: `${C.name} = ${vc - vb} + ${vb} = ${vc}` });
  if (va > vc) opts3.push({ terms: [A, C], ops: ['-'], result: va - vc, deduce: `${C.name} = ${va} - ${va - vc} = ${vc}` });
  const eq3 = pick(rng, opts3);

  // ultima riga: tutti e tre i simboli, un più e un meno, mai valori intermedi negativi
  const qOps = pick(rng, [['+', '-'], ['-', '+']]) as [Op, Op];
  const perms: [Sym, Sym, Sym][] = [
    [A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A],
  ];
  const valid = perms.filter(([x, y, z]) =>
    qOps[0] === '+' ? x.value + y.value - z.value >= 1 : x.value - y.value >= 1
  );
  // anti-scorciatoia: nessun segmento dell'ultima riga deve ricopiare
  // un'equazione data (es. "pentagono - croce" già risolta alla riga 3)
  const subPairs: [Sym, Sym][] = [[eq2.terms[0], eq2.terms[1]]];
  if (eq3.ops[0] === '-') subPairs.push([eq3.terms[0], eq3.terms[1]]);
  const addPair = eq3.ops[0] === '+' ? [eq3.terms[0], eq3.terms[1]] : null;
  const noShortcut = valid.filter(([x, y, z]) => {
    const segs: [Sym, Sym, Op][] = [[x, y, qOps[0]], [y, z, qOps[1]]];
    return segs.every(([s1, s2, op]) =>
      op === '-'
        ? !subPairs.some(([t1, t2]) => t1 === s1 && t2 === s2)
        : !(addPair && addPair.includes(s1) && addPair.includes(s2))
    );
  });
  if (noShortcut.length === 0) throw new Error('nessuna riga finale valida');
  const [X, Y, Z] = pick(rng, noShortcut);
  const evalRow = (v: number[]) => (qOps[0] === '+' ? v[0] + v[1] - v[2] : v[0] - v[1] + v[2]);
  const correct = evalRow([X.value, Y.value, Z.value]);

  // distrattori: scambio dei valori di due simboli nell'ultima riga; ±1/±2
  const qv = [X.value, Y.value, Z.value];
  const swapVals = ([[0, 1], [0, 2], [1, 2]] as const)
    .map(([i, j]) => {
      const w = [...qv];
      [w[i], w[j]] = [w[j], w[i]];
      return evalRow(w);
    })
    .filter((v) => v !== correct && v > 0);
  const swapPick = swapVals.length ? pick(rng, swapVals) : correct + 3;
  const off = pick(rng, [1, 2]);
  const off2 = 3 - off;
  const dists = twoDistractors(correct, [
    ...shuffle(rng, [swapPick, correct + off, correct - off]),
    correct + off2,
    correct - off2,
  ]);

  const explanation =
    `Prima riga: ${symText(eq1.terms, eq1.ops)} = ${eq1.result}, quindi ${A.name} = ${eq1.result} : ${n1} = ${va}. ` +
    `Seconda riga: ${symText(eq2.terms, eq2.ops)} = ${eq2.result}, quindi ${eq2.deduce}. ` +
    `Terza riga: ${symText(eq3.terms, eq3.ops)} = ${eq3.result}, quindi ${eq3.deduce}. ` +
    `Ultima riga: ${symText([X, Y, Z], qOps)} = ${valText([X, Y, Z], qOps)} = ${correct}.`;

  const rows = [
    payloadRow(eq1.terms, eq1.ops, eq1.result),
    payloadRow(eq2.terms, eq2.ops, eq2.result),
    payloadRow(eq3.terms, eq3.ops, eq3.result),
    payloadRow([X, Y, Z], qOps, '?'),
  ];
  return finish(rng, 2, rows, correct, dists, explanation);
}

// ---------------------------------------------------------------------------
// d3: moltiplicazione mista; ultima riga X + Y x Z (precedenza: prima la x).
// ---------------------------------------------------------------------------
function makeD3(rng: Rng): Question {
  // valori piccoli (2-6) così i prodotti restano gestibili a mente
  const [va, vb, vc] = pickN(rng, [2, 3, 4, 5, 6], 3);
  const [A, B, C] = makeSymbols(rng, [va, vb, vc]);

  const eq1: EqRow = { terms: [A, A], ops: ['+'], result: 2 * va };
  const eq2: EqRow = chance(rng, 0.5)
    ? { terms: [A, B], ops: ['x'], result: va * vb }
    : { terms: [B, A], ops: ['x'], result: va * vb };

  const opts3: EqRow[] = [
    { terms: [A, C], ops: ['x'], result: va * vc, deduce: `${C.name} = ${va * vc} : ${va} = ${vc}` },
    { terms: [B, C], ops: ['x'], result: vb * vc, deduce: `${C.name} = ${vb * vc} : ${vb} = ${vc}` },
    { terms: [B, C], ops: ['+'], result: vb + vc, deduce: `${C.name} = ${vb + vc} - ${vb} = ${vc}` },
    { terms: [A, C], ops: ['+'], result: va + vc, deduce: `${C.name} = ${va + vc} - ${va} = ${vc}` },
  ];
  const eq3 = pick(rng, opts3);

  // ultima riga: X + Y x Z — la moltiplicazione NON è al primo posto, così la
  // lettura da sinistra a destra dà un risultato diverso (z ≥ 2 lo garantisce).
  // Anti-scorciatoia: la coppia Y x Z non deve essere un prodotto già dato.
  const mulPairs: Sym[][] = [[A, B]];
  if (eq3.ops[0] === 'x') mulPairs.push([eq3.terms[0], eq3.terms[1]]);
  const perms3 = shuffle(rng, [
    [A, B, C], [A, C, B], [B, A, C], [B, C, A], [C, A, B], [C, B, A],
  ] as [Sym, Sym, Sym][]);
  const found = perms3.find(([, y, z]) => !mulPairs.some((p) => p.includes(y) && p.includes(z)));
  if (!found) throw new Error('nessuna riga finale valida');
  const [X, Y, Z] = found;
  const qOps: [Op, Op] = ['+', 'x'];
  const correct = X.value + Y.value * Z.value;
  const leftToRight = (X.value + Y.value) * Z.value;
  const swapped = Y.value + X.value * Z.value; // X e Y scambiati

  const off = pick(rng, [1, 2]);
  const off2 = 3 - off;
  const dists = twoDistractors(correct, [
    leftToRight, // il distrattore firma: chi ignora la precedenza
    ...shuffle(rng, [swapped, correct + off, correct - off]),
    correct + off2,
    correct - off2,
  ]);

  const explanation =
    `Prima riga: ${A.name} + ${A.name} = ${2 * va}, quindi ${A.name} = ${va}. ` +
    `Seconda riga: ${symText(eq2.terms, eq2.ops)} = ${va * vb}, quindi ${B.name} = ${va * vb} : ${va} = ${vb}. ` +
    `Terza riga: ${symText(eq3.terms, eq3.ops)} = ${eq3.result}, quindi ${eq3.deduce}. ` +
    `Nell'ultima riga la moltiplicazione si calcola PRIMA dell'addizione: ` +
    `${Y.name} x ${Z.name} = ${Y.value} x ${Z.value} = ${Y.value * Z.value}, ` +
    `poi ${X.value} + ${Y.value * Z.value} = ${correct}. ` +
    `Leggendo da sinistra a destra verrebbe ${leftToRight}: è la trappola!`;

  const rows = [
    payloadRow(eq1.terms, eq1.ops, eq1.result),
    payloadRow(eq2.terms, eq2.ops, eq2.result),
    payloadRow(eq3.terms, eq3.ops, eq3.result),
    payloadRow([X, Y, Z], qOps, '?'),
  ];
  return finish(rng, 3, rows, correct, dists, explanation);
}

export function genArithgrid(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) return makeD1(rng);
    if (difficulty === 2) return makeD2(rng);
    return makeD3(rng);
  });
}
