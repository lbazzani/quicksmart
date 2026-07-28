// Generatore "matrix": matrice logica 3×3 in stile Raven, ultima cella incognita.
// Difficoltà 1: un solo attributo varia (rotazione per colonna, conteggio per
// colonna o ciclo di colori a quadrato latino). 2: due attributi indipendenti
// (uno legato alla riga, uno alla colonna). 3: regole sottili (conteggio =
// somma della riga, presenza/assenza in XOR, rotazione diagonale con
// distrattore quasi identico). I distrattori violano UNA regola in modo
// plausibile (attributo della riga/colonna sbagliata, un passo indietro,
// conteggio ±1), mai a caso.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];
const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
const POOL: ShapeName[] = [...PLAIN, ...ROTATABLE];
const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

/** nome italiano con articolo, per le spiegazioni */
const IT: Record<ShapeName, string> = {
  circle: 'il cerchio',
  square: 'il quadrato',
  triangle: 'il triangolo',
  diamond: 'il rombo',
  star: 'la stella',
  pentagon: 'il pentagono',
  hexagon: "l'esagono",
  arrow: 'la freccia',
  heart: 'il cuore',
  cross: 'la croce',
  moon: 'la luna',
  dot: 'il puntino',
};

const FILL_IT: Record<string, string> = { solid: 'pieno', outline: 'solo contorno', half: 'colorato a metà' };

type Fill = 'solid' | 'outline' | 'half';

/** cella con n copie identiche di una forma */
function mono(shape: ShapeName, color: number, opts: { rot?: number; fill?: Fill; count?: number } = {}): CellSpec {
  const spec: ShapeSpec = { shape, color, fillMode: opts.fill ?? 'solid' };
  if (opts.rot) spec.rot = opts.rot;
  const n = opts.count ?? 1;
  return { shapes: Array.from({ length: n }, () => ({ ...spec })), layout: n > 1 ? 'grid' : 'auto' };
}

/** matrice 3×3 da una funzione cella; l'ultima cella diventa l'incognita */
function grid(at: (r: number, c: number) => CellSpec): CellSpec[][] {
  const rows = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => at(r, c)));
  rows[2][2] = { shapes: [], unknown: true };
  return rows;
}

interface Built {
  rows: CellSpec[][];
  correct: CellSpec;
  /** distrattore A: attributo dalla riga/colonna sbagliata o passo indietro */
  dA: CellSpec;
  /** distrattore B: altro errore plausibile (passo in più, conteggio ±1, …) */
  dB: CellSpec;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Difficoltà 1: un solo attributo varia
// ---------------------------------------------------------------------------

function buildD1(rng: Rng): Built {
  const kind = randInt(rng, 0, 2);

  if (kind === 0) {
    // rotazione lungo le colonne (righe tutte uguali)
    const shape = pick(rng, ROTATABLE);
    const color = randInt(rng, 0, 7);
    const step = pick(rng, [45, 90, 135]);
    const start = pick(rng, [0, 45, 90]);
    const at = (c: number) => mono(shape, color, { rot: normRot(start + c * step) });
    return {
      rows: grid((_r, c) => at(c)),
      correct: at(2),
      dA: at(1), // un passo in meno: è la cella della colonna centrale
      dB: mono(shape, color, { rot: normRot(start + 3 * step) }), // un passo in più
      explanation: `Regola unica: da una colonna alla successiva la figura ruota di ${step}° in senso orario (ogni riga ripete lo stesso schema). Nella cella mancante ${IT[shape]} ha una rotazione di ${normRot(start + 2 * step)}°.`,
    };
  }

  if (kind === 1) {
    // conteggio lungo le righe: +1 a ogni colonna
    const shape = pick(rng, PLAIN);
    const color = randInt(rng, 0, 7);
    const base = randInt(rng, 1, 3);
    const at = (c: number) => mono(shape, color, { count: base + c });
    return {
      rows: grid((_r, c) => at(c)),
      correct: at(2),
      dA: at(1), // una figura in meno
      dB: mono(shape, color, { count: base + 3 }), // una figura in più
      explanation: `Regola unica: in ogni riga il numero di figure cresce di uno a ogni colonna (${base}, ${base + 1}, ${base + 2}). Nella cella mancante servono ${base + 2} figure.`,
    };
  }

  // ciclo di colori: quadrato latino, colore(r,c) = colors[(r+c) % 3]
  const shape = pick(rng, PLAIN);
  const colors = pickN(rng, COLORS, 3);
  const at = (r: number, c: number) => mono(shape, colors[(r + c) % 3]);
  return {
    rows: grid(at),
    correct: at(2, 2), // colors[1]
    dA: mono(shape, colors[0]), // colore della cella accanto (colonna sbagliata)
    dB: mono(shape, colors[2]), // colore dell'altra cella della riga
    explanation: `Regola unica: i tre colori scalano di una posizione a ogni riga, così in ogni riga e in ogni colonna ciascun colore compare una sola volta. Nella cella mancante va l'unico colore che ancora manca nell'ultima riga.`,
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 2: due attributi indipendenti (uno per riga, uno per colonna)
// ---------------------------------------------------------------------------

function buildD2(rng: Rng): Built {
  const kind = randInt(rng, 0, 4);

  if (kind === 0) {
    // forma costante per riga + rotazione per colonna
    const shapes = shuffle(rng, [...ROTATABLE]);
    const color = randInt(rng, 0, 7);
    const step = pick(rng, [45, 90]);
    const start = pick(rng, [0, 45]);
    const at = (r: number, c: number) => mono(shapes[r], color, { rot: normRot(start + c * step) });
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(1, 2), // forma della riga sbagliata
      dB: at(2, 1), // rotazione un passo indietro
      explanation: `Due regole insieme: la forma resta la stessa lungo ogni riga, mentre la rotazione cresce di ${step}° a ogni colonna. Serve quindi la forma della terza riga (${IT[shapes[2]]}) con la rotazione della terza colonna (${normRot(start + 2 * step)}°).`,
    };
  }

  if (kind === 1) {
    // forma per riga + colore per colonna
    const shapes = pickN(rng, POOL, 3);
    const cols = pickN(rng, COLORS, 3);
    const at = (r: number, c: number) => mono(shapes[r], cols[c]);
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(1, 2), // forma della riga sbagliata
      dB: at(2, 1), // colore della colonna sbagliata
      explanation: `Due regole insieme: ogni riga ha la sua forma e ogni colonna il suo colore. La cella mancante combina la forma della terza riga (${IT[shapes[2]]}) con il colore della terza colonna.`,
    };
  }

  if (kind === 2) {
    // forma per riga + conteggio per colonna
    const shapes = pickN(rng, PLAIN, 3);
    const color = randInt(rng, 0, 7);
    const base = randInt(rng, 1, 2);
    const at = (r: number, c: number) => mono(shapes[r], color, { count: base + c });
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(1, 2), // forma della riga sbagliata
      dB: at(2, 1), // conteggio della colonna precedente
      explanation: `Due regole insieme: ogni riga ha la sua forma, e il numero di figure cresce lungo le colonne (${base}, ${base + 1}, ${base + 2}). Mancano ${base + 2} copie della figura della terza riga (${IT[shapes[2]]}).`,
    };
  }

  if (kind === 3) {
    // colore per riga + rotazione per colonna
    const shape = pick(rng, ROTATABLE);
    const rowColors = pickN(rng, COLORS, 3);
    const step = pick(rng, [45, 90]);
    const start = pick(rng, [0, 45]);
    const at = (r: number, c: number) => mono(shape, rowColors[r], { rot: normRot(start + c * step) });
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(1, 2), // colore della riga sbagliata
      dB: at(2, 1), // rotazione un passo indietro
      explanation: `Due regole insieme: ogni riga ha il suo colore, mentre la rotazione cresce di ${step}° a ogni colonna. La cella mancante ha il colore della terza riga e la rotazione della terza colonna (${normRot(start + 2 * step)}°).`,
    };
  }

  // riempimento per riga + colore per colonna
  const shape = pick(rng, POOL);
  const fills = shuffle(rng, ['solid', 'outline', 'half'] as Fill[]);
  const cols = pickN(rng, COLORS, 3);
  const at = (r: number, c: number) => mono(shape, cols[c], { fill: fills[r] });
  return {
    rows: grid(at),
    correct: at(2, 2),
    dA: at(1, 2), // riempimento della riga sbagliata
    dB: at(2, 1), // colore della colonna sbagliata
    explanation: `Due regole insieme: ogni riga ha il suo riempimento (${FILL_IT[fills[0]]}, ${FILL_IT[fills[1]]}, ${FILL_IT[fills[2]]}) e ogni colonna il suo colore. La cella mancante unisce il riempimento della terza riga (${FILL_IT[fills[2]]}) e il colore della terza colonna.`,
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 3: regole sottili
// ---------------------------------------------------------------------------

function buildD3(rng: Rng): Built {
  const kind = randInt(rng, 0, 2);

  if (kind === 0) {
    // conteggio = somma della riga: terza cella = prime due sommate
    const shape = pick(rng, PLAIN);
    const rowColors = pickN(rng, COLORS, 3);
    const pairs = Array.from({ length: 3 }, () => [randInt(rng, 1, 3), randInt(rng, 1, 3)] as const);
    const sums = pairs.map(([a, b]) => a + b);
    // guardia anti-ambiguità: la progressione della terza colonna non deve
    // "prevedere" un distrattore (somma ± 1), altrimenti sarebbe difendibile
    const predicted = 2 * sums[1] - sums[0];
    if (predicted === sums[2] - 1 || predicted === sums[2] + 1) throw new Error('configurazione ambigua');
    const at = (r: number, c: number) =>
      mono(shape, rowColors[r], { count: c === 2 ? sums[r] : pairs[r][c] });
    const [a3, b3] = pairs[2];
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: mono(shape, rowColors[2], { count: sums[2] - 1 }), // errore di conto: -1
      dB: mono(shape, rowColors[2], { count: sums[2] + 1 }), // errore di conto: +1
      explanation: `Il trucco: in ogni riga il numero di figure della terza cella è la SOMMA delle prime due. Nell'ultima riga ${a3} + ${b3} = ${sums[2]}, quindi servono ${sums[2]} figure. Le altre opzioni sbagliano il conto di uno.`,
    };
  }

  if (kind === 1) {
    // presenza/assenza in XOR: la terza cella contiene le figure presenti in
    // UNA sola delle prime due (ogni riga mostra: solo X, solo Y, X e Y insieme)
    const [sx, sy] = pickN(rng, POOL, 2);
    const [cx, cy] = pickN(rng, COLORS, 2);
    const X: ShapeSpec = { shape: sx, color: cx, fillMode: 'solid' };
    const Y: ShapeSpec = { shape: sy, color: cy, fillMode: 'solid' };
    const TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
      [0, 1, 1],
      [1, 0, 1],
      [1, 1, 0],
    ];
    const rowsPres = Array.from({ length: 3 }, () => pickN(rng, TRIPLES, 2)); // [presenze di X, presenze di Y]
    const cellOf = (hasX: boolean, hasY: boolean): CellSpec => ({
      shapes: [...(hasX ? [{ ...X }] : []), ...(hasY ? [{ ...Y }] : [])],
      layout: 'row',
    });
    const at = (r: number, c: number) => cellOf(rowsPres[r][0][c] === 1, rowsPres[r][1][c] === 1);
    const has: [boolean, boolean] = [rowsPres[2][0][2] === 1, rowsPres[2][1][2] === 1];
    const others = ([[true, false], [false, true], [true, true]] as Array<[boolean, boolean]>).filter(
      ([a, b]) => a !== has[0] || b !== has[1]
    );
    const desc = (h: [boolean, boolean]) =>
      h[0] && h[1] ? `${IT[sx]} e ${IT[sy]} insieme` : h[0] ? `soltanto ${IT[sx]}` : `soltanto ${IT[sy]}`;
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: cellOf(others[0][0], others[0][1]), // combinazione già presente nella riga
      dB: cellOf(others[1][0], others[1][1]), // l'altra combinazione della riga
      explanation: `Il trucco: in ogni riga la terza cella contiene solo le figure presenti in UNA delle prime due celle; se una figura compare in entrambe, sparisce (regola XOR). Ogni riga mostra quindi: soltanto ${IT[sx]}, soltanto ${IT[sy]} e le due insieme. Nell'ultima riga manca ${desc(has)}; le altre opzioni ripetono celle già visibili nella riga.`,
    };
  }

  // rotazione diagonale: la rotazione cresce sia lungo le righe sia lungo le
  // colonne (rot = (riga + colonna) × passo) + colore per riga; il distrattore
  // principale è quasi identico (un passo indietro)
  const shape = pick(rng, ROTATABLE);
  const rowColors = pickN(rng, COLORS, 3);
  const step = pick(rng, [45, 90]);
  const start = pick(rng, [0, 45]);
  const at = (r: number, c: number) => mono(shape, rowColors[r], { rot: normRot(start + (r + c) * step) });
  return {
    rows: grid(at),
    correct: at(2, 2),
    dA: mono(shape, rowColors[2], { rot: normRot(start + 3 * step) }), // un passo indietro: quasi identico
    dB: mono(shape, rowColors[1], { rot: normRot(start + 4 * step) }), // colore della riga sbagliata
    explanation: `Il trucco: la rotazione aumenta di ${step}° sia spostandosi a destra sia scendendo di una riga (regola diagonale), e ogni riga ha il suo colore. Nella cella mancante ${IT[shape]} ruota di ${normRot(start + 4 * step)}° con il colore della terza riga. Attenzione all'opzione quasi uguale: è indietro di un passo.`,
  };
}

// ---------------------------------------------------------------------------

export function genMatrix(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const b = difficulty === 1 ? buildD1(rng) : difficulty === 2 ? buildD2(rng) : buildD3(rng);
    const { choices, correctIndex } = placeChoices(
      rng,
      { kind: 'cell', cell: b.correct },
      [{ kind: 'cell', cell: b.dA }, { kind: 'cell', cell: b.dB }]
    );
    return {
      qtype: 'matrix' as const,
      difficulty,
      prompt: 'Quale figura completa la matrice?',
      payload: { kind: 'cells' as const, rows: b.rows },
      choices,
      correctIndex,
      explanation: b.explanation,
    };
  });
}
