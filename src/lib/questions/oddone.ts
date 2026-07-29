// Generatore "oddone": una riga di celle che seguono tutte una regola comune
// tranne UNA (l'intrusa). Difficoltà 1: regola diretta (orientamento dritto vs
// diagonale, o conteggio degli elementi). 2: proprietà astratta (parità del
// conteggio, coppie di gemelle, coppia pieno+vuoto). 3: la regola vera è
// nascosta da una falsa pista (forme, colori e conteggi variano apposta).
//
// Anti-ambiguità: ogni proprietà che NON fa parte della regola è o costante su
// tutte le celle, o distinta su tutte le celle, o presente almeno 2 volte per
// valore — mai "uguale ovunque tranne una", così solo l'intrusa è isolabile.
//
// Le tre opzioni sono l'intrusa più 2 celle conformi prese dalla riga, e QUALI
// due celle conformi è la decisione più delicata del tipo. Prendendone due a
// caso si somigliavano fra loro — è la regola a renderle simili — e l'intrusa
// restava l'unica a staccarsi: bastava "scegli quella diversa dalle altre due"
// per vincere sempre, con la riga ridotta a decorazione.
//
// La regola nuova è che OGNI opzione deve poter dire "sono io quella diversa":
// l'intrusa lo dice per la regola, un distrattore perché è l'unico di quel
// colore, l'altro perché è l'unico di quella forma o di quella grandezza. Per
// riuscirci le proprietà-civetta (colori, grandezze, forme) vanno a GRUPPI
// invece che tutte diverse, e la coppia si sceglie con `everyoneStandsOut`.
// Tre indizi che si contraddicono: per sapere quale proprietà conta davvero
// bisogna tornare a leggere la riga.

import type { CellSpec, ChoiceVisual, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

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
  /**
   * Vincolo che la riga impone alla coppia di distrattori. Ce ne sono due tipi:
   *  - `everyoneStandsOut`: ogni opzione deve avere una sua ragione per sembrare
   *    "quella diversa dalle altre due" (è il vincolo principale);
   *  - `allCountsApart` / `balancedCountSplit`: tolgono di mezzo il conteggio
   *    come indizio gratuito, perché contare le figure delle TRE OPZIONI e
   *    prendere quella col numero diverso è la versione visibile della stessa
   *    scorciatoia.
   */
  pairOk?: (a: CellSpec, b: CellSpec, intruder: CellSpec) => boolean;
}

const count = (c: CellSpec) => c.shapes.length;

/** i tre conteggi tutti diversi: nessuno "si stacca", il confronto non dice niente */
const allCountsApart = (a: CellSpec, b: CellSpec, i: CellSpec) =>
  count(a) !== count(b) && count(a) !== count(i) && count(b) !== count(i);

/**
 * Quando il conteggio NON è la regola ma solo una falsa pista (l'intrusa ne
 * rompe un'altra), non basta che "quella con un numero di figure diverso dalle
 * altre due" non sia mai la risposta: sarebbe un indizio al contrario, buono a
 * scartare un'opzione e tirare a caso fra le altre due. Deve indicare l'intrusa
 * esattamente una volta su tre, come il caso. Si estrae quindi in anticipo dove
 * deve cadere il "diverso": sull'intrusa, su un distrattore, o su nessuno.
 */
function balancedCountSplit(rng: Rng): (a: CellSpec, b: CellSpec, i: CellSpec) => boolean {
  // Il bersaglio è: "il diverso è l'intrusa" una volta su tre, cioè il livello
  // del caso. Si estrae più spesso (2 su 3) perché è la richiesta più difficile
  // da soddisfare — pretende due conformi con lo STESSO conteggio che siano
  // anche una l'unica di quel colore e l'altra l'unica di quella forma — e
  // quindi viene scartata più spesso: quello che conta è il mix che sopravvive.
  if (chance(rng, 2 / 3)) {
    // il diverso è l'intrusa (e chi conta e basta indovina, 1 volta su 3)
    return (a, b, i) => count(a) === count(b) && count(a) !== count(i);
  }
  // il diverso è un distrattore: chi conta e basta sbaglia
  return (a, b, i) => count(a) !== count(b) && (count(a) === count(i) || count(b) === count(i));
}

// ---------------------------------------------------------------------------
// Disposizione delle figure dentro una cella
// ---------------------------------------------------------------------------

/**
 * Passo della disposizione usata dal renderer (src/components/visuals.tsx):
 * una figura sola sta al centro, 'row' le mette in fila (passo minimo 45, per
 * leggibilità), 'grid' su 2 colonne fino a 4 figure e su 3 oltre.
 *
 * Serve saperlo qui per due motivi concreti:
 *  1) in fila, da 3 figure in su il passo 45 sfonda la cella (5 figure occupano
 *     225 unità su 100): le figure ai lati finiscono FUORI e non si vedono, e
 *     un quesito di conteggio con figure invisibili è irrisolvibile. Le celle
 *     da contare vanno quindi disposte in griglia;
 *  2) il passo della griglia cambia con il numero di figure (50 fino a 4, 33
 *     oltre): senza compensare, una cella da 5 le disegnerebbe più piccole di
 *     una da 4 e la differenza di GRANDEZZA tradirebbe il conteggio senza
 *     bisogno di contare.
 */
function layoutStep(n: number, layout: CellSpec['layout']): number {
  if (n <= 1 && layout !== 'row' && layout !== 'grid') return 100;
  if (layout === 'row') return Math.max(100 / n, 45);
  const cols = n <= 4 ? 2 : 3;
  return 100 / Math.max(cols, Math.ceil(n / cols));
}

/** lato con cui ogni figura viene DISEGNATA davvero, in unità di cella */
function drawnSizes(c: CellSpec): number[] {
  const step = layoutStep(c.shapes.length, c.layout);
  return c.shapes.map((s) => Math.round((s.size ?? 0.8) * step));
}

/** grandezza a schermo di ogni figura nelle celle da contare */
const INK = 28;

/** cella con n figure da contare: in griglia (mai tagliate) e tutte grandi uguali */
function countedCell(shapes: ShapeSpec[]): CellSpec {
  const n = shapes.length;
  const layout: CellSpec['layout'] = n === 1 ? 'auto' : 'grid';
  const size = +(INK / layoutStep(n, layout)).toFixed(2);
  return { shapes: shapes.map((s) => ({ ...s, size })), layout };
}

/**
 * Conteggi di una regola sulla PARITÀ: due valori conformi (ciascuno usato
 * almeno due volte nella riga, così nessuna cella conforme resta isolata) e il
 * conteggio dell'intrusa, di parità opposta.
 *
 * La posizione dell'intrusa nella classifica dei tre numeri che finiranno fra
 * le opzioni (il più piccolo, quello di mezzo, il più grande) si estrae PRIMA
 * di scegliere i valori: con i conformi fissi a {3,5} e l'intrusa a 4 la
 * risposta sarebbe sempre quella con un numero intermedio di figure, e
 * "scegli la via di mezzo" sarebbe la scorciatoia successiva.
 */
function parityCounts(rng: Rng, even: boolean): { lo: number; hi: number; bad: number } {
  const conforming = even ? [2, 4, 6] : [1, 3, 5];
  const opposite = even ? [1, 3, 5] : [2, 4, 6];
  const combos: { lo: number; hi: number; bad: number; pos: number }[] = [];
  for (let i = 0; i < conforming.length; i++) {
    for (let j = i + 1; j < conforming.length; j++) {
      for (const bad of opposite) {
        const lo = conforming[i];
        const hi = conforming[j];
        combos.push({ lo, hi, bad, pos: bad < lo ? 0 : bad > hi ? 2 : 1 });
      }
    }
  }
  const pos = randInt(rng, 0, 2);
  return pick(rng, combos.filter((c) => c.pos === pos));
}

/** i 5 conteggi conformi della riga: ogni valore almeno 2 volte, ordine mescolato */
const conformingCounts = (rng: Rng, lo: number, hi: number) =>
  shuffle(rng, [lo, lo, hi, hi, pick(rng, [lo, hi])]);

// ---------------------------------------------------------------------------
// Scelta dei due distrattori
// ---------------------------------------------------------------------------

/**
 * I tratti che si colgono a colpo d'occhio confrontando due celle, senza
 * guardare la riga: quante figure, che forme, che colori, piene o vuote, quanto
 * grandi (grandezza DISEGNATA, non il numero nel descrittore), come sono girate.
 */
function traits(c: CellSpec): string[] {
  const uniq = (v: (string | number)[]) => [...new Set(v.map(String))].sort().join('+');
  return [
    String(c.shapes.length), // quante figure
    uniq(c.shapes.map((s) => s.shape)), // che forme
    uniq(c.shapes.map((s) => s.color ?? 0)), // che colori
    uniq(c.shapes.map((s) => s.fillMode ?? 'solid')), // piene o vuote
    uniq(drawnSizes(c)), // quanto grandi (grandezza disegnata)
    uniq(c.shapes.map((s) => normRot(s.rot ?? 0))), // come girate
    String(new Set(c.shapes.map((s) => s.shape)).size), // quante forme diverse dentro
    String(c.shapes.filter((s) => s.fillMode === 'outline').length), // quante vuote
  ];
}

/** quale delle tre opzioni si stacca sul tratto k (null se non se ne stacca una sola) */
function standsOut(t: string[][], k: number): number | null {
  for (let i = 0; i < 3; i++) {
    const o = [0, 1, 2].filter((j) => j !== i);
    if (t[o[0]][k] === t[o[1]][k] && t[i][k] !== t[o[0]][k]) return i;
  }
  return null;
}

/**
 * Il vincolo che uccide la scorciatoia: OGNI opzione deve poter dire "sono io
 * quella diversa". L'intrusa lo dice per la regola (è il suo mestiere); i due
 * distrattori devono poterlo dire per altri due tratti — uno è l'unico di quel
 * colore, l'altro l'unica di quella forma o di quella grandezza. Tre indizi che
 * si contraddicono: chi guarda solo le opzioni non sa a quale credere e deve
 * tornare alla riga, dove un solo tratto isola davvero una casella.
 */
function everyoneStandsOut(a: CellSpec, b: CellSpec, i: CellSpec): boolean {
  const t = [a, b, i].map(traits);
  const pointed = new Set<number>();
  for (let k = 0; k < t[0].length; k++) {
    const o = standsOut(t, k);
    if (o !== null) pointed.add(o);
  }
  return pointed.size === 3;
}

/**
 * Valori assegnati a `n` celle a GRUPPI: ogni valore usato compare almeno due
 * volte, così nessuna cella è isolata da quella proprietà (sarebbe un falso
 * intruso), e restano abbastanza gruppi perché fra tre opzioni una possa essere
 * l'unica di quel valore.
 */
function grouped<T>(rng: Rng, pool: readonly T[], n: number, k: number): T[] {
  const vals = pickN(rng, pool, k);
  return shuffle(rng, Array.from({ length: n }, (_, i) => vals[i % k]));
}

/** quanto è lungo il descrittore di una cella (dettaglio interno, non si vede) */
const bulk = (c: CellSpec) => JSON.stringify(c).length;

/** su quanti tratti visibili due celle si distinguono */
function visualGap(a: CellSpec, b: CellSpec): number {
  const ta = traits(a);
  const tb = traits(b);
  return ta.reduce((n, t, i) => n + (t === tb[i] ? 0 : 1), 0);
}

/**
 * Sceglie le due celle conformi da mettere accanto all'intrusa.
 *
 * Prima erano due conformi a caso, ed era la falla: le celle conformi si
 * somigliano fra loro (è la regola a renderle simili) mentre l'intrusa si
 * stacca, quindi "scegli l'opzione diversa dalle altre due" vinceva senza mai
 * guardare la riga. Qui si pretende il contrario: fra tutte le coppie di
 * conformi si tiene quella più diversa al suo interno, così chi confronta solo
 * le tre opzioni vede tre celle tutte diverse fra loro e non ha nessun
 * appiglio; per sapere quale sia l'intrusa deve capire quale regola vale nella
 * riga e verificare chi la rompe.
 *
 * Tre passaggi: il vincolo dichiarato dalla regola (`pairOk`, di solito
 * `everyoneStandsOut`), poi il massimo numero di tratti VISIBILI di differenza
 * fra le due conformi (forme, colori, quantità, pieno/vuoto, grandezza,
 * inclinazione: quello che vede una bambina), e infine il pareggio sul `bulk`.
 * L'ordine non è casuale: la scorciatoia si toglie cambiando quello che si
 * VEDE, e solo dopo si mette a tacere anche la spia interna con cui il test la
 * misura.
 */
function chooseDistractors(
  rng: Rng,
  cells: CellSpec[],
  intruderIdx: number,
  pairOk?: (a: CellSpec, b: CellSpec, intruder: CellSpec) => boolean
): [number, number] | null {
  const intruder = cells[intruderIdx];
  const conf = cells.map((_, i) => i).filter((i) => i !== intruderIdx);
  const pairs: [number, number][] = [];
  for (let i = 0; i < conf.length; i++) {
    for (let j = i + 1; j < conf.length; j++) pairs.push([conf[i], conf[j]]);
  }
  const usable = pairs.filter(
    ([i, j]) =>
      visualGap(cells[i], cells[j]) > 0 && (!pairOk || pairOk(cells[i], cells[j], intruder))
  );
  if (!usable.length) return null;
  const best = Math.max(...usable.map(([i, j]) => visualGap(cells[i], cells[j])));
  const top = usable.filter(([i, j]) => visualGap(cells[i], cells[j]) === best);
  // Ultimo requisito, fra coppie già equivalenti per tutto ciò che si vede: le
  // tre opzioni devono avere tre descrittori di lunghezza diversa. La lunghezza
  // del descrittore non è una cosa che si guarda (dipende anche da quanto è
  // lungo il NOME della forma), ma è la spia con cui tools/shortcut-test cerca
  // "l'opzione diversa dalle altre due": tre lunghezze diverse la lasciano muta,
  // senza indicare né l'intrusa né — al rovescio — un distrattore. Se nessuna
  // coppia ci riesce si scarta la riga e se ne genera un'altra.
  const mute = top.filter(([i, j]) => new Set([bulk(cells[i]), bulk(cells[j]), bulk(intruder)]).size === 3);
  return mute.length ? pick(rng, mute) : null;
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

/**
 * Tutte le celle con lo stesso numero di figure, una con una in più/in meno.
 *
 * Qui il conteggio È la regola, quindi fra le tre opzioni l'intrusa sarà per
 * forza l'unica con un numero di figure diverso: non si può togliere. Si toglie
 * invece il suo VALORE di indizio, dando alle altre due opzioni un motivo
 * altrettanto buono per sembrare "quella diversa". La riga usa due sole forme e
 * due soli colori, a gruppi (3 e 2, così nessuna casella resta isolata da forma
 * o colore), e i distrattori si scelgono incrociati (vedi `crossedDecoys`):
 *   - l'intrusa è l'unica con un numero di figure diverso  → dice "sono io";
 *   - un distrattore è l'unico con quella forma            → dice "sono io";
 *   - l'altro è l'unico con quel colore                    → dice "sono io".
 * Tre risposte in contraddizione: per sapere quale proprietà conta bisogna
 * leggere la riga, dove solo il conteggio isola una casella sola.
 */
function buildCount(rng: Rng): Built {
  const n = 5;
  const [s1, s2] = pickN(rng, COUNTABLE, 2);
  const [c1, c2] = pickN(rng, ALL_COLORS, 2);
  const k = randInt(rng, 2, 4);
  const kBad = k + pick(rng, [-1, 1]); // 1..5, sempre diverso da k
  // le 4 combinazioni forma×colore più una ripetuta: ogni forma e ogni colore
  // compaiono almeno 2 volte, e la coppia incrociata esiste sempre
  const combos: [ShapeName, number][] = [
    [s1, c1],
    [s1, c2],
    [s2, c1],
    [s2, c2],
  ];
  const plan = shuffle(rng, [...combos, pick(rng, combos)]);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells = plan.map(([shape, color], i) =>
    countedCell(
      Array.from({ length: i === intruderIdx ? kBad : k }, () => ({
        shape,
        color,
        fillMode: 'solid' as const,
      }))
    )
  );
  const rule =
    `Ogni casella contiene esattamente ${k} figure: le forme (${IT[s1]} e ${IT[s2]}) e i colori si ripetono ` +
    `a gruppi apposta, per confondere, ma è il numero che conta. L'intrusa ne contiene ${kBad}.`;
  return { cells, intruderIdx, rule, pairOk: everyoneStandsOut };
}

// ---------------------------------------------------------------------------
// Difficoltà 2 — 6 celle, proprietà astratta
// ---------------------------------------------------------------------------

/** Numero di figure sempre pari (o sempre dispari), una sola di parità opposta. */
function buildParity(rng: Rng): Built {
  const n = 6;
  const even = chance(rng, 0.5);
  const { lo, hi, bad } = parityCounts(rng, even);
  const confCounts = conformingCounts(rng, lo, hi);
  const shape = pick(rng, COUNTABLE);
  const colors = pickN(rng, ALL_COLORS, n);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const count = i === intruderIdx ? bad : confCounts[c++];
    cells.push(
      countedCell(
        Array.from({ length: count }, () => ({ shape, color: colors[i], fillMode: 'solid' as const }))
      )
    );
  }
  const rule = even
    ? `In ogni casella il numero di figure è pari (${lo} o ${hi}): solo l'intrusa ne ha ${bad}, un numero dispari.`
    : `In ogni casella il numero di figure è dispari (${lo} o ${hi}): solo l'intrusa ne ha ${bad}, un numero pari.`;
  return { cells, intruderIdx, rule, pairOk: allCountsApart };
}

/** due grandezze di coppia, a gruppi: una in più delle proprietà "civetta" */
const PAIR_SIZES = [0.62, 0.42];

/**
 * Due "tagli" della coppia grande+piccola. Cambia solo la grande: la piccola
 * resta della stessa misura in tutte le celle, perché è quella che va
 * riconosciuta e rimpicciolirla ancora la renderebbe illeggibile a 56px.
 */
const ECHO_SCALES: [number, number][] = [
  [0.88, 0.42],
  [0.64, 0.42],
];

/**
 * Ogni cella contiene due figure gemelle, l'intrusa due figure diverse.
 *
 * Colori e grandezze vanno a gruppi (non più tutti diversi) proprio perché fra
 * le tre opzioni ce ne sia sempre una che è l'unica di quel colore e una che è
 * l'unica di quella grandezza: senza, l'unica a staccarsi sarebbe l'intrusa e
 * bastava scegliere lei.
 */
function buildTwins(rng: Rng): Built {
  const n = 6;
  const confShapes = pickN(rng, PLAIN, 5); // 5 coppie, forme tutte diverse tra le celle
  const rest = PLAIN.filter((s) => !confShapes.includes(s));
  // l'intrusa usa forme già viste (più subdolo) oppure forme nuove
  const [x, y] = chance(rng, 0.5) ? pickN(rng, confShapes, 2) : pickN(rng, rest, 2);
  const colors = grouped(rng, ALL_COLORS, n, 3); // 3 colori × 2 celle
  const sizes = grouped(rng, PAIR_SIZES, n, 2); // 2 grandezze × 3 celle
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const color = colors[i];
    const size = sizes[i];
    if (i === intruderIdx) {
      cells.push({
        shapes: [
          { shape: x, color, size, fillMode: 'solid' },
          { shape: y, color, size, fillMode: 'solid' },
        ],
        layout: 'row',
      });
    } else {
      const shape = confShapes[c++];
      cells.push({
        shapes: [
          { shape, color, size, fillMode: 'solid' },
          { shape, color, size, fillMode: 'solid' },
        ],
        layout: 'row',
      });
    }
  }
  const rule = `In ogni casella le due figure sono gemelle (identiche): solo l'intrusa contiene due figure diverse tra loro (${IT[x]} e ${IT[y]}). Colori e grandezze cambiano a gruppi solo per confondere.`;
  return { cells, intruderIdx, rule, pairOk: everyoneStandsOut };
}

/** In ogni cella una figura piena e una vuota (in qualsiasi ordine), l'intrusa no. */
function buildFillPair(rng: Rng): Built {
  const n = 6;
  const shapes = pickN(rng, PLAIN, n); // forme tutte diverse
  const colors = grouped(rng, ALL_COLORS, n, 3); // a gruppi: una civetta in più
  const sizes = grouped(rng, PAIR_SIZES, n, 2);
  // ordine pieno/vuoto bilanciato: ogni ordine compare almeno 2 volte tra le conformi
  const orders = shuffle(rng, [true, true, false, false, chance(rng, 0.5)]);
  const bothMode = pick(rng, ['solid', 'outline'] as const);
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let o = 0;
  for (let i = 0; i < n; i++) {
    const base = { shape: shapes[i], color: colors[i], size: sizes[i] };
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
  return { cells, intruderIdx, rule, pairOk: everyoneStandsOut };
}

// ---------------------------------------------------------------------------
// Difficoltà 3 — 6 celle, regola vera nascosta da una falsa pista
// ---------------------------------------------------------------------------

/** Forme e colori variano a caso, ma la parità del conteggio no — tranne una. */
function buildHiddenParity(rng: Rng): Built {
  const n = 6;
  const even = chance(rng, 0.5);
  const { lo, hi, bad } = parityCounts(rng, even);
  const confCounts = conformingCounts(rng, lo, hi);
  const shapes = pickN(rng, COUNTABLE, n); // falsa pista: forme tutte diverse
  const colors = pickN(rng, ALL_COLORS, n); // falsa pista: colori tutti diversi
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells: CellSpec[] = [];
  let c = 0;
  for (let i = 0; i < n; i++) {
    const count = i === intruderIdx ? bad : confCounts[c++];
    cells.push(
      countedCell(
        Array.from({ length: count }, () => ({
          shape: shapes[i],
          color: colors[i],
          fillMode: 'solid' as const,
        }))
      )
    );
  }
  const rule =
    `Forme e colori diversi sono una falsa pista: la vera regola è il conteggio. ` +
    `Ogni casella ha un numero ${even ? 'pari' : 'dispari'} di figure (${lo} o ${hi}); ` +
    `solo l'intrusa ne ha ${bad}, un numero ${even ? 'dispari' : 'pari'}.`;
  return { cells, intruderIdx, rule, pairOk: allCountsApart };
}

/** La figura piccola è sempre la copia in miniatura della grande, tranne una. */
function buildEcho(rng: Rng): Built {
  const n = 6;
  const bigs = pickN(rng, PLAIN, n); // grandi tutte diverse (falsa pista)
  const rest = PLAIN.filter((s) => !bigs.includes(s));
  const small = pick(rng, rest); // la piccola sbagliata è una forma mai vista come grande
  const colors = grouped(rng, ALL_COLORS, n, 3); // colori a gruppi: seconda civetta
  const scales = grouped(rng, ECHO_SCALES, n, 2); // due "tagli" di coppia: terza civetta
  const intruderIdx = randInt(rng, 0, n - 1);
  const cells = bigs.map((shape, i): CellSpec => ({
    shapes: [
      { shape, color: colors[i], size: scales[i][0], fillMode: 'solid' },
      { shape: i === intruderIdx ? small : shape, color: colors[i], size: scales[i][1], fillMode: 'solid' },
    ],
    layout: 'row',
  }));
  const rule = `In ogni casella la figura piccola è la copia in miniatura di quella grande; solo nell'intrusa la piccola (${IT[small]}) è diversa dalla grande (${IT[bigs[intruderIdx]]}). Le forme, i colori e le grandezze che cambiano servono solo a confondere.`;
  return { cells, intruderIdx, rule, pairOk: everyoneStandsOut };
}

/** In ogni cella esattamente una figura è vuota, nell'intrusa nessuna o due. */
function buildOutlineCount(rng: Rng): Built {
  const n = 6;
  // Conteggi: falsa pista pura. Nella riga variano (due valori, ognuno almeno
  // 2 volte, così nessuna casella è isolata dal conteggio) e anche l'intrusa
  // usa uno dei due; i distrattori si scelgono con `balancedCountSplit`, che
  // fa cadere "quella con un conteggio diverso" a rotazione sull'intrusa, su un
  // distrattore o su nessuno. L'unica cosa che separa davvero le tre opzioni
  // resta quante figure sono vuote — cioè la regola.
  const [lo, hi] = pickN(rng, [3, 4, 5], 2).sort((a, b) => a - b);
  const confCounts = conformingCounts(rng, lo, hi);
  const intruderCount = pick(rng, [lo, hi]);
  const zeroOutline = chance(rng, 0.5); // intrusa: nessuna vuota oppure due vuote
  // forme e colori a gruppi: servono a dare a ciascun distrattore un motivo per
  // essere "l'unico diverso" (l'unico di quella forma, l'unico di quel colore)
  const shapes = grouped(rng, PLAIN, n, 3);
  const colors = grouped(rng, ALL_COLORS, n, 3);
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
    cells.push(countedCell(fills.map((fillMode) => ({ shape: shapes[i], color: colors[i], fillMode }))));
  }
  const rule = zeroOutline
    ? "In ogni casella esattamente una figura è vuota (solo contorno) e le altre sono piene; l'intrusa non ne ha nessuna vuota. Numero di figure, forme e colori cambiano apposta per depistarti."
    : "In ogni casella esattamente una figura è vuota (solo contorno) e le altre sono piene; l'intrusa ne ha due vuote. Numero di figure, forme e colori cambiano apposta per depistarti.";
  const split = balancedCountSplit(rng);
  return {
    cells,
    intruderIdx,
    rule,
    // il conteggio è una falsa pista e deve restare tale (`split`); il resto
    // delle proprietà deve dare a ciascuna opzione la sua ragione per sembrare
    // "quella diversa" (`everyoneStandsOut`)
    pairOk: (a, b, i) => split(a, b, i) && everyoneStandsOut(a, b, i),
  };
}

// ---------------------------------------------------------------------------

type Builder = (rng: Rng) => Built;

const D1: Builder[] = [buildStraightVsDiagonal, buildCount];
const D2: Builder[] = [buildParity, buildTwins, buildFillPair];
const D3: Builder[] = [buildHiddenParity, buildEcho, buildOutlineCount];

const cloneCell = (c: CellSpec): CellSpec => JSON.parse(JSON.stringify(c));

function assemble(rng: Rng, difficulty: Difficulty, built: Built): Question {
  const { cells, intruderIdx, rule, pairOk } = built;
  const correct: ChoiceVisual = { kind: 'cell', cell: cloneCell(cells[intruderIdx]) };
  // distrattori: 2 celle conformi copiate dalla riga, scelte perché nessuna
  // delle tre opzioni sia l'unica a staccarsi (altrimenti si indovina senza
  // guardare la riga)
  const chosen = chooseDistractors(rng, cells, intruderIdx, pairOk);
  if (!chosen) throw new Error('nessuna coppia di distrattori utilizzabile');
  const [a, b] = chosen;
  const { choices, correctIndex } = placeChoices(rng, correct, [
    { kind: 'cell', cell: cloneCell(cells[a]) },
    { kind: 'cell', cell: cloneCell(cells[b]) },
  ]);
  return {
    qtype: 'oddone',
    difficulty,
    prompt: "Quale figura è l'intrusa?",
    payload: { kind: 'cells', rows: [cells] },
    choices,
    correctIndex,
    explanation: `L'intrusa è la ${intruderIdx + 1}ª casella della riga. ${rule}`,
  };
}

export function genOddone(rng: Rng, difficulty: Difficulty): Question {
  const pool = difficulty === 1 ? D1 : difficulty === 2 ? D2 : D3;
  // la variante si sceglie UNA volta sola: se una riga non offre una coppia di
  // distrattori valida si riprova con la stessa variante, altrimenti quelle più
  // esigenti sparirebbero dal repertorio (e la partita diventerebbe monotona)
  const make = pick(rng, pool);
  try {
    return retry(() => assemble(rng, difficulty, make(rng)), 40);
  } catch {
    for (const alt of shuffle(rng, pool.filter((m) => m !== make))) {
      try {
        return retry(() => assemble(rng, difficulty, alt(rng)), 20);
      } catch {
        continue;
      }
    }
    throw new Error('nessuna variante di oddone utilizzabile');
  }
}
