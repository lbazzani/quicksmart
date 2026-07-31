// Generatore "matrix": matrice logica 3×3 in stile Raven, ultima cella incognita.
// Difficoltà 1: un solo attributo varia — rotazione per colonna, conteggio per
// colonna, quadrato latino di colori, quadrato latino di FORME, dimensione
// crescente/decrescente lungo una direzione, quadrato latino di RIEMPIMENTI,
// riempimento legato a una sola direzione, conteggio con passo e direzione
// variabili. 2: due attributi indipendenti (uno legato alla riga, uno alla
// colonna), oppure due cicli di lunghezza 3 che scorrono in versi opposti,
// oppure rotazione che cresce lungo le righe e cala lungo le colonne. 3: regole
// sottili (conteggio = somma della riga, conteggio = differenza della riga,
// presenza/assenza in XOR, rotazione diagonale con distrattore quasi identico,
// tre attributi con tre regole diverse). I distrattori violano UNA regola in
// modo plausibile (attributo della riga/colonna sbagliata, un passo indietro,
// conteggio ±1), mai a caso.

import type { CellSpec, Difficulty, LocalizedText, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { L } from '../localize';
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

/** English name, article included (English "the" needs no gender/number agreement) */
const EN: Record<ShapeName, string> = {
  circle: 'the circle',
  square: 'the square',
  triangle: 'the triangle',
  diamond: 'the diamond',
  star: 'the star',
  pentagon: 'the pentagon',
  hexagon: 'the hexagon',
  arrow: 'the arrow',
  heart: 'the heart',
  cross: 'the cross',
  moon: 'the moon',
  dot: 'the dot',
};

const FILL_IT: Record<string, string> = { solid: 'pieno', outline: 'solo contorno', half: 'colorato a metà' };
const FILL_EN: Record<string, string> = { solid: 'full', outline: 'outline', half: 'half-filled' };

type Fill = 'solid' | 'outline' | 'half';
const FILLS: Fill[] = ['solid', 'outline', 'half'];

/**
 * Terne di conteggi ammesse (tutte fra 1 e 6, così le figure restano contabili
 * a colpo d'occhio): passo +1/-1 e passo +2/-2, in salita e in discesa.
 */
const COUNT_TRIPLES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 2, 3],
  [2, 3, 4],
  [3, 4, 5],
  [4, 5, 6],
  [1, 3, 5],
  [2, 4, 6],
  [3, 2, 1],
  [4, 3, 2],
  [5, 4, 3],
  [6, 5, 4],
  [5, 3, 1],
  [6, 4, 2],
];

/** cella con n copie identiche di una forma */
function mono(
  shape: ShapeName,
  color: number,
  opts: { rot?: number; fill?: Fill; count?: number; size?: number; arrange?: 'grid' | 'row' } = {}
): CellSpec {
  const spec: ShapeSpec = { shape, color, fillMode: opts.fill ?? 'solid' };
  if (opts.rot) spec.rot = opts.rot;
  if (opts.size !== undefined) spec.size = opts.size;
  const n = opts.count ?? 1;
  return {
    shapes: Array.from({ length: n }, () => ({ ...spec })),
    layout: n > 1 ? opts.arrange ?? 'grid' : 'auto',
  };
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
  explanation: LocalizedText;
}

// ---------------------------------------------------------------------------
// Difficoltà 1: un solo attributo varia
// ---------------------------------------------------------------------------

function buildD1(rng: Rng): Built {
  const kind = randInt(rng, 0, 7);

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
      explanation: L(
        `Regola unica: da una colonna alla successiva la figura ruota di ${step}° in senso orario (ogni riga ripete lo stesso schema). Nella cella mancante ${IT[shape]} ha una rotazione di ${normRot(start + 2 * step)}°.`,
        `One rule only: from one column to the next, the shape rotates ${step}° clockwise (every row repeats the same pattern). In the missing cell, ${EN[shape]} is rotated ${normRot(start + 2 * step)}°.`
      ),
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
      explanation: L(
        `Regola unica: in ogni riga il numero di figure cresce di uno a ogni colonna (${base}, ${base + 1}, ${base + 2}). Nella cella mancante servono ${base + 2} figure.`,
        `One rule only: in every row, the number of shapes grows by one with each column (${base}, ${base + 1}, ${base + 2}). The missing cell needs ${base + 2} shapes.`
      ),
    };
  }

  if (kind === 2) {
    // ciclo di colori: quadrato latino, colore(r,c) = colors[(r+c) % 3]
    const shape = pick(rng, PLAIN);
    const colors = pickN(rng, COLORS, 3);
    const at = (r: number, c: number) => mono(shape, colors[(r + c) % 3]);
    return {
      rows: grid(at),
      correct: at(2, 2), // colors[1]
      dA: mono(shape, colors[0]), // colore della cella accanto (colonna sbagliata)
      dB: mono(shape, colors[2]), // colore dell'altra cella della riga
      explanation: L(
        `Regola unica: i tre colori scalano di una posizione a ogni riga, così in ogni riga e in ogni colonna ciascun colore compare una sola volta. Nella cella mancante va l'unico colore che ancora manca nell'ultima riga.`,
        `One rule only: the three colors shift by one position with each row, so every color appears exactly once in every row and column. The missing cell needs the one color still missing from the last row.`
      ),
    };
  }

  if (kind === 3) {
    // quadrato latino di FORME: le tre forme scorrono di un posto a ogni riga
    const shapes = pickN(rng, POOL, 3);
    const color = randInt(rng, 0, 7);
    const shift = chance(rng, 0.5) ? 1 : 2; // verso di scorrimento
    const idx = (r: number, c: number) => (r + shift * c) % 3;
    const at = (r: number, c: number) => mono(shapes[idx(r, c)], color);
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(2, 1), // la forma della cella accanto (colonna sbagliata)
      dB: at(2, 0), // la forma dell'altra cella della riga
      explanation: L(
        `Regola unica: le tre forme scorrono di un posto a ogni riga, così in ogni riga e in ogni colonna ciascuna forma compare una sola volta. Nell'ultima riga ci sono già ${IT[shapes[idx(2, 0)]]} e ${IT[shapes[idx(2, 1)]]}: manca ${IT[shapes[idx(2, 2)]]}. Le altre due opzioni ripetono una forma già presente nella riga.`,
        `One rule only: the three shapes shift by one spot with each row, so every shape appears exactly once in every row and column. The last row already has ${EN[shapes[idx(2, 0)]]} and ${EN[shapes[idx(2, 1)]]}: ${EN[shapes[idx(2, 2)]]} is missing. The other two options repeat a shape already in the row.`
      ),
    };
  }

  if (kind === 4) {
    // dimensione crescente (o calante) lungo una sola direzione
    const shape = pick(rng, POOL);
    const color = randInt(rng, 0, 7);
    const grow = chance(rng, 0.5);
    const byRow = chance(rng, 0.5); // true: cambia scendendo, false: cambia verso destra
    const sz = (k: number) => +(grow ? 0.34 + 0.2 * k : 0.94 - 0.2 * k).toFixed(2);
    const at = (r: number, c: number) => mono(shape, color, { size: sz(byRow ? r : c) });
    const dir = byRow ? 'scendendo di una riga' : 'passando da una colonna alla successiva';
    const uguali = byRow ? 'le celle di una stessa riga sono tutte uguali' : 'tutte le righe sono uguali';
    const dirEn = byRow ? 'going down a row' : 'moving to the next column';
    const ugualiEn = byRow ? 'the cells in the same row are all identical' : 'every row looks the same';
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: mono(shape, color, { size: sz(1) }), // la dimensione del gradino precedente
      dB: mono(shape, color, { size: sz(3) }), // un gradino di troppo
      explanation: L(
        `Regola unica: cambia solo la dimensione. ${dir[0].toUpperCase() + dir.slice(1)} la figura ${grow ? 'cresce' : 'si rimpicciolisce'} sempre dello stesso passo, mentre ${uguali}. Nella cella mancante va ${IT[shape]} al terzo gradino: un passo ${grow ? 'più grande' : 'più piccolo'} ${byRow ? 'della cella sopra' : 'della cella accanto'}. Un'opzione ripete il gradino precedente, l'altra ne fa uno di troppo.`,
        `One rule only: only the size changes. ${dirEn[0].toUpperCase() + dirEn.slice(1)}, the shape ${grow ? 'grows' : 'shrinks'} by the same amount each time, while ${ugualiEn}. The missing cell needs ${EN[shape]} at the third step: one step ${grow ? 'bigger' : 'smaller'} than ${byRow ? 'the cell above' : 'the cell before it'}. One option repeats the previous step, the other overshoots by one.`
      ),
    };
  }

  if (kind === 5) {
    // quadrato latino di RIEMPIMENTI (pieno / contorno / metà)
    const shape = pick(rng, POOL);
    const color = randInt(rng, 0, 7);
    const fills = shuffle(rng, [...FILLS]);
    const shift = chance(rng, 0.5) ? 1 : 2;
    const idx = (r: number, c: number) => (r + shift * c) % 3;
    const at = (r: number, c: number) => mono(shape, color, { fill: fills[idx(r, c)] });
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: at(2, 1), // riempimento della cella accanto
      dB: at(2, 0), // riempimento dell'altra cella della riga
      explanation: L(
        `Regola unica: forma e colore non cambiano mai, cambia solo il riempimento. Nella prima riga l'ordine è ${FILL_IT[fills[idx(0, 0)]]} → ${FILL_IT[fills[idx(0, 1)]]} → ${FILL_IT[fills[idx(0, 2)]]}, e a ogni riga lo stesso giro scorre di un posto. Così in ogni riga e in ogni colonna ciascun riempimento compare una sola volta: nell'ultima riga manca "${FILL_IT[fills[idx(2, 2)]]}".`,
        `One rule only: the shape and color never change, only the fill does. In the first row the order is ${FILL_EN[fills[idx(0, 0)]]} → ${FILL_EN[fills[idx(0, 1)]]} → ${FILL_EN[fills[idx(0, 2)]]}, and with each row the same cycle shifts by one spot. So every fill appears exactly once in every row and column: the last row is missing "${FILL_EN[fills[idx(2, 2)]]}".`
      ),
    };
  }

  if (kind === 6) {
    // riempimento legato a una sola direzione (righe identiche o colonne identiche)
    const shape = pick(rng, POOL);
    const color = randInt(rng, 0, 7);
    const fills = shuffle(rng, [...FILLS]);
    const byRow = chance(rng, 0.5);
    const at = (r: number, c: number) => mono(shape, color, { fill: fills[byRow ? r : c] });
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: mono(shape, color, { fill: fills[1] }), // riempimento della riga/colonna di mezzo
      dB: mono(shape, color, { fill: fills[0] }), // riempimento della prima riga/colonna
      explanation: L(
        byRow
          ? `Regola unica: il riempimento dipende solo dalla riga (le tre celle di una stessa riga sono identiche): prima riga ${FILL_IT[fills[0]]}, seconda ${FILL_IT[fills[1]]}, terza ${FILL_IT[fills[2]]}. Nella cella mancante serve quindi il riempimento della terza riga (${FILL_IT[fills[2]]}); le altre opzioni prendono il riempimento da una riga sbagliata.`
          : `Regola unica: il riempimento dipende solo dalla colonna (le tre righe sono identiche): prima colonna ${FILL_IT[fills[0]]}, seconda ${FILL_IT[fills[1]]}, terza ${FILL_IT[fills[2]]}. Nella cella mancante serve quindi il riempimento della terza colonna (${FILL_IT[fills[2]]}); le altre opzioni prendono il riempimento da una colonna sbagliata.`,
        byRow
          ? `One rule only: the fill depends only on the row (the three cells in a row are identical): first row ${FILL_EN[fills[0]]}, second ${FILL_EN[fills[1]]}, third ${FILL_EN[fills[2]]}. The missing cell needs the third row's fill (${FILL_EN[fills[2]]}); the other options take the fill from the wrong row.`
          : `One rule only: the fill depends only on the column (the three rows are identical): first column ${FILL_EN[fills[0]]}, second ${FILL_EN[fills[1]]}, third ${FILL_EN[fills[2]]}. The missing cell needs the third column's fill (${FILL_EN[fills[2]]}); the other options take the fill from the wrong column.`
      ),
    };
  }

  // conteggio con passo e direzione variabili (in salita o in discesa, di 1 o di 2)
  const shape = pick(rng, PLAIN);
  const color = randInt(rng, 0, 7);
  const triple = pick(rng, COUNT_TRIPLES);
  const byRow = chance(rng, 0.5); // true: il conteggio cambia scendendo
  const arrange: 'grid' | 'row' = Math.max(...triple) <= 3 && chance(rng, 0.5) ? 'row' : 'grid';
  const at = (r: number, c: number) => mono(shape, color, { count: triple[byRow ? r : c], arrange });
  const step = triple[1] - triple[0];
  // distrattore B: un passo di troppo; se sfora, un errore di conto di uno
  const dBn = [triple[2] + step, triple[2] + 1, triple[2] - 1, triple[0]].find(
    (n) => n >= 1 && n <= 6 && n !== triple[2] && n !== triple[1]
  );
  if (dBn === undefined) throw new Error('conteggio senza distrattore valido');
  return {
    rows: grid(at),
    correct: at(2, 2),
    dA: mono(shape, color, { count: triple[1], arrange }), // il conteggio del passo precedente
    dB: mono(shape, color, { count: dBn, arrange }),
    explanation: L(
      `Regola unica: ${byRow ? 'scendendo di una riga' : 'passando da una colonna alla successiva'} il numero di figure ${step > 0 ? 'cresce' : 'cala'} di ${Math.abs(step)} (${triple.join(', ')}), mentre ${byRow ? 'le celle di una stessa riga sono tutte uguali' : 'tutte le righe sono uguali'}. Nella cella mancante servono ${triple[2]} figure.`,
      `One rule only: ${byRow ? 'going down a row' : 'moving to the next column'}, the number of shapes ${step > 0 ? 'grows' : 'shrinks'} by ${Math.abs(step)} (${triple.join(', ')}), while ${byRow ? 'the cells in the same row are all identical' : 'every row looks the same'}. The missing cell needs ${triple[2]} shapes.`
    ),
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 2: due attributi indipendenti (uno per riga, uno per colonna)
// ---------------------------------------------------------------------------

function buildD2(rng: Rng): Built {
  const kind = randInt(rng, 0, 6);

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
      explanation: L(
        `Due regole insieme: la forma resta la stessa lungo ogni riga, mentre la rotazione cresce di ${step}° a ogni colonna. Serve quindi la forma della terza riga (${IT[shapes[2]]}) con la rotazione della terza colonna (${normRot(start + 2 * step)}°).`,
        `Two rules together: the shape stays the same across each row, while the rotation grows by ${step}° with each column. So we need the third row's shape (${EN[shapes[2]]}) with the third column's rotation (${normRot(start + 2 * step)}°).`
      ),
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
      explanation: L(
        `Due regole insieme: ogni riga ha la sua forma e ogni colonna il suo colore. La cella mancante combina la forma della terza riga (${IT[shapes[2]]}) con il colore della terza colonna.`,
        `Two rules together: each row has its own shape and each column its own color. The missing cell combines the third row's shape (${EN[shapes[2]]}) with the third column's color.`
      ),
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
      explanation: L(
        `Due regole insieme: ogni riga ha la sua forma, e il numero di figure cresce lungo le colonne (${base}, ${base + 1}, ${base + 2}). Mancano ${base + 2} copie della figura della terza riga (${IT[shapes[2]]}).`,
        `Two rules together: each row has its own shape, and the number of shapes grows across the columns (${base}, ${base + 1}, ${base + 2}). The missing cell needs ${base + 2} copies of the third row's shape (${EN[shapes[2]]}).`
      ),
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
      explanation: L(
        `Due regole insieme: ogni riga ha il suo colore, mentre la rotazione cresce di ${step}° a ogni colonna. La cella mancante ha il colore della terza riga e la rotazione della terza colonna (${normRot(start + 2 * step)}°).`,
        `Two rules together: each row has its own color, while the rotation grows by ${step}° with each column. The missing cell has the third row's color and the third column's rotation (${normRot(start + 2 * step)}°).`
      ),
    };
  }

  if (kind === 4) {
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
      explanation: L(
        `Due regole insieme: ogni riga ha il suo riempimento (${FILL_IT[fills[0]]}, ${FILL_IT[fills[1]]}, ${FILL_IT[fills[2]]}) e ogni colonna il suo colore. La cella mancante unisce il riempimento della terza riga (${FILL_IT[fills[2]]}) e il colore della terza colonna.`,
        `Two rules together: each row has its own fill (${FILL_EN[fills[0]]}, ${FILL_EN[fills[1]]}, ${FILL_EN[fills[2]]}) and each column its own color. The missing cell combines the third row's fill (${FILL_EN[fills[2]]}) with the third column's color.`
      ),
    };
  }

  if (kind === 5) {
    // due cicli di lunghezza 3 che scorrono in versi OPPOSTI: le forme scalano
    // in un verso, i colori nell'altro (due quadrati latini sovrapposti)
    const shapes = pickN(rng, POOL, 3);
    const cols = pickN(rng, COLORS, 3);
    const shapeFirst = chance(rng, 0.5);
    const si = (r: number, c: number) => (r + (shapeFirst ? 1 : 2) * c) % 3;
    const ci = (r: number, c: number) => (r + (shapeFirst ? 2 : 1) * c) % 3;
    const at = (r: number, c: number) => mono(shapes[si(r, c)], cols[ci(r, c)]);
    return {
      rows: grid(at),
      correct: at(2, 2),
      // forma giusta ma colore preso dalla cella accanto (ciclo dei colori sbagliato)
      dA: mono(shapes[si(2, 2)], cols[ci(2, 1)]),
      // colore giusto ma forma presa dalla riga sopra (ciclo delle forme sbagliato)
      dB: mono(shapes[si(1, 2)], cols[ci(2, 2)]),
      explanation: L(
        `Due regole insieme, e i due cicli girano in versi opposti: le forme scalano di un posto in una direzione, i colori nell'altra. Il risultato è che in ogni riga e in ogni colonna compaiono tutte e tre le forme e tutti e tre i colori, una volta sola. Nella cella mancante servono la forma che manca nell'ultima riga (${IT[shapes[si(2, 2)]]}) e il colore che manca nell'ultima riga. Le due opzioni sbagliate ne azzeccano solo uno dei due.`,
        `Two rules together, cycling in opposite directions: the shapes shift by one spot one way, the colors the other way. The result is that all three shapes and all three colors each appear exactly once in every row and column. The missing cell needs the shape missing from the last row (${EN[shapes[si(2, 2)]]}) and the color missing from the last row. Each wrong option gets only one of the two right.`
      ),
    };
  }

  // rotazione che cresce verso destra e cala scendendo (regola "a specchio")
  // + un colore per riga
  const shape = pick(rng, ROTATABLE);
  const rowColors = pickN(rng, COLORS, 3);
  const step = pick(rng, [45, 90, 135]);
  const start = pick(rng, [0, 45, 90]);
  const rot = (r: number, c: number) => normRot(start + (c - r) * step);
  const at = (r: number, c: number) => mono(shape, rowColors[r], { rot: rot(r, c) });
  return {
    rows: grid(at),
    correct: at(2, 2),
    dA: mono(shape, rowColors[2], { rot: rot(2, 1) }), // colore giusto, rotazione un passo indietro
    dB: mono(shape, rowColors[1], { rot: rot(2, 2) }), // rotazione giusta, colore della riga sbagliata
    explanation: L(
      `Due regole insieme: ogni riga ha il suo colore, e la rotazione cresce di ${step}° andando verso destra ma cala di ${step}° scendendo di una riga. Nella cella mancante ${IT[shape]} torna quindi alla rotazione di ${normRot(start)}° (la stessa della cella in alto a sinistra e di quella centrale) con il colore della terza riga. Un'opzione è indietro di un passo, l'altra ha il colore della riga sbagliata.`,
      `Two rules together: each row has its own color, and the rotation grows by ${step}° moving right but shrinks by ${step}° going down a row. So in the missing cell ${EN[shape]} goes back to a rotation of ${normRot(start)}° (the same as the top-left cell and the center one) with the third row's color. One option is one step behind, the other has the wrong row's color.`
    ),
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 3: regole sottili
// ---------------------------------------------------------------------------

function buildD3(rng: Rng): Built {
  const kind = randInt(rng, 0, 4);

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
      explanation: L(
        `Il trucco: in ogni riga il numero di figure della terza cella è la SOMMA delle prime due. Nell'ultima riga ${a3} + ${b3} = ${sums[2]}, quindi servono ${sums[2]} figure. Le altre opzioni sbagliano il conto di uno.`,
        `The trick: in every row, the third cell's shape count is the SUM of the first two. In the last row, ${a3} + ${b3} = ${sums[2]}, so it needs ${sums[2]} shapes. The other options are off by one.`
      ),
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
    // ogni riga usa una coppia DIVERSA di tripli: righe mai identiche e almeno
    // una riga visibile contiene [1,1,0] (celle sovrapposte), che distingue la
    // regola XOR dalla semplice unione (altrimenti l'item sarebbe ambiguo)
    const pairings = shuffle(rng, [
      [TRIPLES[0], TRIPLES[1]],
      [TRIPLES[0], TRIPLES[2]],
      [TRIPLES[1], TRIPLES[2]],
    ]);
    const rowsPres = pairings.map((p) => shuffle(rng, [...p])); // [presenze di X, presenze di Y]
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
    const descEn = (h: [boolean, boolean]) =>
      h[0] && h[1] ? `${EN[sx]} and ${EN[sy]} together` : h[0] ? `only ${EN[sx]}` : `only ${EN[sy]}`;
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: cellOf(others[0][0], others[0][1]), // combinazione già presente nella riga
      dB: cellOf(others[1][0], others[1][1]), // l'altra combinazione della riga
      explanation: L(
        `Il trucco: in ogni riga la terza cella contiene solo le figure presenti in UNA delle prime due celle; se una figura compare in entrambe, sparisce (regola XOR). Ogni riga mostra quindi: soltanto ${IT[sx]}, soltanto ${IT[sy]} e le due insieme. Nell'ultima riga manca ${desc(has)}; le altre opzioni ripetono celle già visibili nella riga.`,
        `The trick: in every row, the third cell only contains shapes that appear in ONE of the first two cells; if a shape is in both, it disappears (the XOR rule). So every row shows: only ${EN[sx]}, only ${EN[sy]}, and the two together. The last row is missing ${descEn(has)}; the other options repeat cells already visible in the row.`
      ),
    };
  }

  if (kind === 2) {
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
      explanation: L(
        `Il trucco: la rotazione aumenta di ${step}° sia spostandosi a destra sia scendendo di una riga (regola diagonale), e ogni riga ha il suo colore. Nella cella mancante ${IT[shape]} ruota di ${normRot(start + 4 * step)}° con il colore della terza riga. Attenzione all'opzione quasi uguale: è indietro di un passo.`,
        `The trick: the rotation increases by ${step}° both moving right and going down a row (a diagonal rule), and each row has its own color. In the missing cell, ${EN[shape]} is rotated ${normRot(start + 4 * step)}° with the third row's color. Watch out for the option that looks almost identical: it's one step behind.`
      ),
    };
  }

  if (kind === 3) {
    // conteggio = DIFFERENZA della riga: terza cella = prima meno seconda
    const shape = pick(rng, PLAIN);
    const rowColors = pickN(rng, COLORS, 3);
    // prime due righe: differenza ≥ 1; ultima riga: differenza ≥ 2 (così il
    // distrattore "uno in meno" resta una cella disegnabile, con almeno 1 figura)
    const mkPair = (minDiff: number): readonly [number, number] => {
      const a = randInt(rng, 2 + minDiff, 6);
      return [a, randInt(rng, 1, a - minDiff)] as const;
    };
    const pairs = [mkPair(1), mkPair(1), mkPair(2)];
    const diffs = pairs.map(([a, b]) => a - b);
    if (pairs.every(([a, b]) => a === pairs[0][0] && b === pairs[0][1])) throw new Error('righe identiche');
    // guardia anti-ambiguità 1: la progressione della terza colonna non deve
    // "prevedere" un distrattore (differenza ± 1 o somma)
    const predicted = 2 * diffs[1] - diffs[0];
    const [a3, b3] = pairs[2];
    const sum3 = a3 + b3;
    if (predicted === diffs[2] - 1 || predicted === diffs[2] + 1 || predicted === sum3)
      throw new Error('configurazione ambigua');
    // guardia anti-ambiguità 2: se nelle righe visibili "a − b" coincide sempre
    // con "a ÷ b", anche la divisione spiegherebbe la matrice
    const alsoDiv = ([a, b]: readonly [number, number]) => b > 1 && a % b === 0 && a / b === a - b;
    if (alsoDiv(pairs[0]) && alsoDiv(pairs[1]) && !alsoDiv(pairs[2])) throw new Error('regola alternativa: divisione');
    const at = (r: number, c: number) =>
      mono(shape, rowColors[r], { count: c === 2 ? diffs[r] : pairs[r][c] });
    // distrattore principale: chi somma invece di sottrarre (se la cella resta
    // leggibile), altrimenti un errore di conto di uno
    const dBn = sum3 <= 6 ? sum3 : diffs[2] + 1;
    return {
      rows: grid(at),
      correct: at(2, 2),
      dA: mono(shape, rowColors[2], { count: diffs[2] - 1 }), // errore di conto: -1
      dB: mono(shape, rowColors[2], { count: dBn }),
      explanation: L(
        `Il trucco: in ogni riga il numero di figure della terza cella è la DIFFERENZA fra le prime due (la prima meno la seconda). Nell'ultima riga ${a3} − ${b3} = ${diffs[2]}, quindi servono ${diffs[2]} figure. ${sum3 <= 6 ? `Attenzione all'opzione con ${sum3} figure: è la somma, non la differenza.` : `Le altre opzioni sbagliano il conto di uno.`}`,
        `The trick: in every row, the third cell's shape count is the DIFFERENCE between the first two (the first minus the second). In the last row, ${a3} − ${b3} = ${diffs[2]}, so it needs ${diffs[2]} shapes. ${sum3 <= 6 ? `Watch out for the option with ${sum3} shapes: that's the sum, not the difference.` : `The other options are off by one.`}`
      ),
    };
  }

  // tre attributi, tre regole diverse: la forma dipende dalla riga, il colore
  // dalla colonna, il riempimento scorre in diagonale (quadrato latino)
  const shapes = pickN(rng, POOL, 3);
  const cols = pickN(rng, COLORS, 3);
  const fills = shuffle(rng, [...FILLS]);
  const shift = chance(rng, 0.5) ? 1 : 2;
  const fi = (r: number, c: number) => (r + shift * c) % 3;
  const at = (r: number, c: number) => mono(shapes[r], cols[c], { fill: fills[fi(r, c)] });
  return {
    rows: grid(at),
    correct: at(2, 2),
    dA: mono(shapes[2], cols[2], { fill: fills[fi(2, 1)] }), // riempimento della cella accanto
    dB: mono(shapes[1], cols[2], { fill: fills[fi(2, 2)] }), // forma della riga sbagliata
    explanation: L(
      `Il trucco: qui lavorano tre regole diverse insieme. La forma dipende dalla riga, il colore dipende dalla colonna e il riempimento scorre in diagonale, comparendo una volta sola per riga e per colonna. La cella mancante prende quindi la forma della terza riga (${IT[shapes[2]]}), il colore della terza colonna e l'unico riempimento che manca nell'ultima riga (${FILL_IT[fills[fi(2, 2)]]}). Ogni opzione sbagliata ne azzecca due su tre.`,
      `The trick: three different rules are at work here. The shape depends on the row, the color depends on the column, and the fill cycles diagonally, appearing exactly once per row and column. The missing cell takes the third row's shape (${EN[shapes[2]]}), the third column's color, and the one fill still missing from the last row (${FILL_EN[fills[fi(2, 2)]]}). Each wrong option gets two out of three right.`
    ),
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
      prompt: L('Quale figura completa la matrice?', 'Which shape completes the matrix?'),
      payload: { kind: 'cells' as const, rows: b.rows },
      choices,
      correctIndex,
      explanation: b.explanation,
    };
  });
}
