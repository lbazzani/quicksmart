// Generatore "oddone": una riga di celle che seguono tutte una regola comune
// tranne UNA (l'intrusa). Difficoltà 1: regola diretta (orientamento dritto vs
// diagonale, o conteggio degli elementi). 2: proprietà astratta (parità del
// conteggio, coppie di gemelle, coppia pieno+vuoto). 3: la regola vera è
// nascosta da una falsa pista (forme, colori e conteggi variano apposta).
//
// Anti-ambiguità: ogni proprietà che NON fa parte della regola è o costante su
// tutte le celle, o distinta su tutte le celle, o presente almeno 2 volte per
// valore — mai "uguale ovunque tranne una", così solo l'intrusa è isolabile.
// I distrattori sono 2 celle conformi copiate esattamente dalla riga.

import type { CellSpec, ChoiceVisual, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
const COUNTABLE: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'heart', 'dot'];
const ALL_COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

const IT: Record<ShapeName, string> = {
  circle: 'cerchio',
  square: 'quadrato',
  triangle: 'triangolo',
  diamond: 'rombo',
  star: 'stella',
  pentagon: 'pentagono',
  hexagon: 'esagono',
  arrow: 'freccia',
  heart: 'cuore',
  cross: 'croce',
  moon: 'luna',
  dot: 'pallino',
};

interface Built {
  cells: CellSpec[];
  intruderIdx: number;
  /** spiegazione della regola (il "trucco") */
  rule: string;
}

// ---------------------------------------------------------------------------
// Difficoltà 1 — 5 celle, una regola semplice
// ---------------------------------------------------------------------------

/** Tutte le figure ruotate di un quarto di giro esatto, una sola in diagonale. */
function buildStraightVsDiagonal(rng: Rng): Built {
  const n = 5;
  const shape = pick(rng, ['arrow', 'moon'] as const);
  const fillMode = pick(rng, ['solid', 'outline'] as const);
  // colori: tutti uguali oppure tutti diversi (mai "quasi tutti uguali")
  const colors = chance(rng, 0.5)
    ? Array<number>(n).fill(randInt(rng, 0, 7))
    : pickN(rng, ALL_COLORS, n);
  const straights = shuffle(rng, [0, 90, 180, 270]); // 4 conformi, tutte distinte
  const intruderIdx = randInt(rng, 0, n - 1);
  const diag = pick(rng, [45, 135, 225, 315]);
  const cells: CellSpec[] = [];
  let s = 0;
  for (let i = 0; i < n; i++) {
    const rot = i === intruderIdx ? diag : straights[s++];
    cells.push({ shapes: [{ shape, rot, color: colors[i], fillMode }], layout: 'auto' });
  }
  const rule =
    shape === 'arrow'
      ? "Tutte le frecce puntano dritte (su, giù, a destra o a sinistra): solo l'intrusa è inclinata in diagonale."
      : "Tutte le lune sono ruotate di un quarto di giro esatto (0°, 90°, 180° o 270°): solo l'intrusa è inclinata in diagonale (45° in più).";
  return { cells, intruderIdx, rule };
}

/** Tutte le celle con lo stesso numero di figure, una con una in più/in meno. */
function buildCount(rng: Rng): Built {
  const n = 5;
  const shape = pick(rng, COUNTABLE);
  const k = randInt(rng, 2, 4);
  const kBad = k + pick(rng, [-1, 1]); // 1..5, sempre diverso da k
  const colors = pickN(rng, ALL_COLORS, n); // tutti diversi: il colore non isola nessuno
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells = colors.map((color, i): CellSpec => ({
    shapes: Array.from({ length: i === intruderIdx ? kBad : k }, () => ({
      shape,
      color,
      size: 0.5,
      fillMode: 'solid' as const,
    })),
    layout: 'row',
  }));
  const rule = `Ogni casella contiene esattamente ${k} figure: i colori cambiano apposta, ma è il numero che conta. L'intrusa ne contiene ${kBad}.`;
  return { cells, intruderIdx, rule };
}

// ---------------------------------------------------------------------------
// Difficoltà 2 — 6 celle, proprietà astratta
// ---------------------------------------------------------------------------

/** Numero di figure sempre pari (o sempre dispari), una sola di parità opposta. */
function buildParity(rng: Rng): Built {
  const n = 6;
  const even = chance(rng, 0.5);
  const vals = even ? [2, 4] : [3, 5];
  // 5 celle conformi: ogni valore compare almeno 2 volte (nessuna isolata dal conteggio)
  const confCounts = shuffle(rng, [vals[0], vals[0], vals[1], vals[1], pick(rng, vals)]);
  const bad = even ? 3 : 4; // in mezzo ai valori conformi: non è né il massimo né il minimo
  const shape = pick(rng, COUNTABLE);
  const colors = pickN(rng, ALL_COLORS, n);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const count = i === intruderIdx ? bad : confCounts[c++];
    cells.push({
      shapes: Array.from({ length: count }, () => ({ shape, color: colors[i], size: 0.42, fillMode: 'solid' as const })),
      layout: 'row',
    });
  }
  const rule = even
    ? "In ogni casella il numero di figure è pari (2 o 4): solo l'intrusa ne ha 3, un numero dispari."
    : "In ogni casella il numero di figure è dispari (3 o 5): solo l'intrusa ne ha 4, un numero pari.";
  return { cells, intruderIdx, rule };
}

/** Ogni cella contiene due figure gemelle, l'intrusa due figure diverse. */
function buildTwins(rng: Rng): Built {
  const n = 6;
  const confShapes = pickN(rng, PLAIN, 5); // 5 coppie, forme tutte diverse tra le celle
  const rest = PLAIN.filter((s) => !confShapes.includes(s));
  // l'intrusa usa forme già viste (più subdolo) oppure forme nuove
  const [x, y] = chance(rng, 0.5) ? pickN(rng, confShapes, 2) : pickN(rng, rest, 2);
  const colors = pickN(rng, ALL_COLORS, n);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const color = colors[i];
    if (i === intruderIdx) {
      cells.push({
        shapes: [
          { shape: x, color, size: 0.55, fillMode: 'solid' },
          { shape: y, color, size: 0.55, fillMode: 'solid' },
        ],
        layout: 'row',
      });
    } else {
      const shape = confShapes[c++];
      cells.push({
        shapes: [
          { shape, color, size: 0.55, fillMode: 'solid' },
          { shape, color, size: 0.55, fillMode: 'solid' },
        ],
        layout: 'row',
      });
    }
  }
  const rule = `In ogni casella le due figure sono gemelle (identiche): solo l'intrusa contiene due figure diverse tra loro (${IT[x]} e ${IT[y]}).`;
  return { cells, intruderIdx, rule };
}

/** In ogni cella una figura piena e una vuota (in qualsiasi ordine), l'intrusa no. */
function buildFillPair(rng: Rng): Built {
  const n = 6;
  const shapes = pickN(rng, PLAIN, n); // forme tutte diverse
  const colors = pickN(rng, ALL_COLORS, n);
  // ordine pieno/vuoto bilanciato: ogni ordine compare almeno 2 volte tra le conformi
  const orders = shuffle(rng, [true, true, false, false, chance(rng, 0.5)]);
  const bothMode = pick(rng, ['solid', 'outline'] as const);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let o = 0;
  for (let i = 0; i < n; i++) {
    const base = { shape: shapes[i], color: colors[i], size: 0.55 };
    if (i === intruderIdx) {
      cells.push({
        shapes: [{ ...base, fillMode: bothMode }, { ...base, fillMode: bothMode }],
        layout: 'row',
      });
    } else {
      const solidFirst = orders[o++];
      cells.push({
        shapes: [
          { ...base, fillMode: solidFirst ? 'solid' : 'outline' },
          { ...base, fillMode: solidFirst ? 'outline' : 'solid' },
        ],
        layout: 'row',
      });
    }
  }
  const rule =
    bothMode === 'solid'
      ? "In ogni casella una figura è piena e l'altra è solo contorno (l'ordine non conta): nell'intrusa sono entrambe piene."
      : "In ogni casella una figura è piena e l'altra è solo contorno (l'ordine non conta): nell'intrusa sono entrambe vuote.";
  return { cells, intruderIdx, rule };
}

// ---------------------------------------------------------------------------
// Difficoltà 3 — 6 celle, regola vera nascosta da una falsa pista
// ---------------------------------------------------------------------------

/** Forme e colori variano a caso, ma il conteggio è sempre dispari tranne uno. */
function buildHiddenParity(rng: Rng): Built {
  const n = 6;
  // conformi: 3 o 5 figure, ogni valore almeno 2 volte; intrusa: 4 (né max né min)
  const confCounts = shuffle(rng, [3, 3, 5, 5, pick(rng, [3, 5])]);
  const shapes = pickN(rng, COUNTABLE, n); // falsa pista: forme tutte diverse
  const colors = pickN(rng, ALL_COLORS, n); // falsa pista: colori tutti diversi
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const count = i === intruderIdx ? 4 : confCounts[c++];
    cells.push({
      shapes: Array.from({ length: count }, () => ({
        shape: shapes[i],
        color: colors[i],
        size: 0.4,
        fillMode: 'solid' as const,
      })),
      layout: 'row',
    });
  }
  const rule =
    "Forme e colori diversi sono una falsa pista: la vera regola è il conteggio. Ogni casella ha un numero dispari di figure (3 o 5); solo l'intrusa ne ha 4, un numero pari.";
  return { cells, intruderIdx, rule };
}

/** La figura piccola è sempre la copia in miniatura della grande, tranne una. */
function buildEcho(rng: Rng): Built {
  const n = 6;
  const bigs = pickN(rng, PLAIN, n); // grandi tutte diverse (falsa pista)
  const rest = PLAIN.filter((s) => !bigs.includes(s));
  const small = pick(rng, rest); // la piccola sbagliata è una forma mai vista come grande
  const colors = pickN(rng, ALL_COLORS, n);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells = bigs.map((shape, i): CellSpec => ({
    shapes: [
      { shape, color: colors[i], size: 0.85, fillMode: 'solid' },
      { shape: i === intruderIdx ? small : shape, color: colors[i], size: 0.4, fillMode: 'solid' },
    ],
    layout: 'row',
  }));
  const rule = `In ogni casella la figura piccola è la copia in miniatura di quella grande; solo nell'intrusa la piccola (${IT[small]}) è diversa dalla grande (${IT[bigs[intruderIdx]]}). Le forme e i colori che cambiano servono solo a confondere.`;
  return { cells, intruderIdx, rule };
}

/** In ogni cella esattamente una figura è vuota, nell'intrusa nessuna o due. */
function buildOutlineCount(rng: Rng): Built {
  const n = 6;
  // conteggi 3 o 4 (falsa pista), ogni valore almeno 2 volte; anche l'intrusa usa 3 o 4
  const confCounts = shuffle(rng, [3, 3, 4, 4, pick(rng, [3, 4])]);
  const intruderCount = pick(rng, [3, 4]);
  const zeroOutline = chance(rng, 0.5); // intrusa: nessuna vuota oppure due vuote
  const shapes = pickN(rng, PLAIN, n);
  const colors = pickN(rng, ALL_COLORS, n);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const count = i === intruderIdx ? intruderCount : confCounts[c++];
    const fills: Array<'solid' | 'outline'> = Array(count).fill('solid');
    if (i === intruderIdx) {
      if (!zeroOutline) {
        const [a, b] = pickN(rng, Array.from({ length: count }, (_, j) => j), 2);
        fills[a] = 'outline';
        fills[b] = 'outline';
      }
    } else {
      fills[randInt(rng, 0, count - 1)] = 'outline';
    }
    cells.push({
      shapes: fills.map((fillMode) => ({ shape: shapes[i], color: colors[i], size: 0.42, fillMode })),
      layout: 'row',
    });
  }
  const rule = zeroOutline
    ? "In ogni casella esattamente una figura è vuota (solo contorno) e le altre sono piene; l'intrusa non ne ha nessuna vuota. Numero di figure, forme e colori cambiano apposta per depistarti."
    : "In ogni casella esattamente una figura è vuota (solo contorno) e le altre sono piene; l'intrusa ne ha due vuote. Numero di figure, forme e colori cambiano apposta per depistarti.";
  return { cells, intruderIdx, rule };
}

// ---------------------------------------------------------------------------

function build(rng: Rng, difficulty: Difficulty): Built {
  if (difficulty === 1) return pick(rng, [buildStraightVsDiagonal, buildCount])(rng);
  if (difficulty === 2) return pick(rng, [buildParity, buildTwins, buildFillPair])(rng);
  return pick(rng, [buildHiddenParity, buildEcho, buildOutlineCount])(rng);
}

const cloneCell = (c: CellSpec): CellSpec => JSON.parse(JSON.stringify(c));

export function genOddone(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const { cells, intruderIdx, rule } = build(rng, difficulty);
    const correct: ChoiceVisual = { kind: 'cell', cell: cloneCell(cells[intruderIdx]) };
    // distrattori: 2 celle conformi copiate esattamente dalla riga
    const conformi = cells.map((_, i) => i).filter((i) => i !== intruderIdx);
    const [a, b] = pickN(rng, conformi, 2);
    const { choices, correctIndex } = placeChoices(rng, correct, [
      { kind: 'cell', cell: cloneCell(cells[a]) },
      { kind: 'cell', cell: cloneCell(cells[b]) },
    ]);
    return {
      qtype: 'oddone' as const,
      difficulty,
      prompt: "Quale figura è l'intrusa?",
      payload: { kind: 'cells' as const, rows: [cells] },
      choices,
      correctIndex,
      explanation: `L'intrusa è la ${intruderIdx + 1}ª casella della riga. ${rule}`,
    };
  });
}
