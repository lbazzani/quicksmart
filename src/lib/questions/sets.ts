// Generatore "sets": insiemi e proprietà condivise (un diagramma di Venn senza
// testo). Ogni riga del disegno è un GRUPPO: le sue caselle condividono una
// proprietà (stessa forma / stesso colore / stesso numero di figure / stesso
// riempimento). La domanda chiede la figura che sta nell'INTERSEZIONE dei
// gruppi (d1-d2) oppure quella che non sta in NESSUN gruppo (d3).
//
// Difficoltà 1: 2 gruppi con proprietà che si vedono a colpo d'occhio (forma,
// colore, riempimento), niente rumore ingannevole, al massimo due figure per
// casella. 2: 2 gruppi in cui c'è sempre di mezzo il CONTEGGIO (bisogna contare
// 1-2-3, non basta guardare) e ogni riga ha un attributo "quasi costante" (2
// caselle su 3 uguali) che sembra la regola e non lo è. 3: tre gruppi da
// intersecare; in una minoranza di round la domanda negativa ("non appartiene a
// nessun gruppo"), che però usa solo DUE gruppi perché costa un giro di
// verifiche in più.
//
// LEGGIBILITÀ (il disegno deve dire quello che dice la consegna):
//  - il payload usa groups:true, così ogni gruppo è dentro la sua cornice e non
//    si legge come una matrice; la prima casella di ogni riga porta l'etichetta
//    "Gruppo 1/2/3" (le altre un'etichetta vuota, per restare allineate).
//  - due valori che a schermo si confondono non possono mai essere l'UNICO
//    segno che separa la risposta da un distrattore (vedi tooClose e
//    pickPalette, che usa le coppie confondibili di src/lib/colors.ts).
//  - da d2 in su le caselle per gruppo sono 3: si arriva a 3 figure per casella
//    e con 4 colonne diventerebbero troppo piccole per contarle.
//
// GARANZIA DI UNICITÀ (il punto delicato di questo tipo di domanda):
//  - dentro un gruppo ogni attributo diverso da quello che lo definisce VARIA
//    (almeno due valori diversi): ogni riga ha quindi UNA sola proprietà comune
//    e si può leggere in un solo modo. Nessuna eccezione — basta un attributo
//    costante in due righe (anche se costante ovunque) perché quelle righe
//    diventino leggibili allo stesso modo e la risposta non sia più unica.
//  - nessuna casella disegnata soddisfa la proprietà di un altro gruppo: i
//    gruppi sono disgiunti e l'intersezione è davvero "vuota" nel disegno.
//  - le 3 opzioni differiscono SOLO negli attributi che definiscono i gruppi:
//    tutto il resto è identico, così nulla di estraneo può discriminarle.
//  - i distrattori violano ESATTAMENTE una proprietà (intersezione) o ne
//    soddisfano esattamente una (domanda negativa): sono gli errori tipici di
//    chi guarda una riga sola.
//
// VINCOLO DI COPERTURA (perché non si venga puniti per aver ragionato bene):
//  chi guarda gli esempi non deduce solo "che cosa hanno in comune": deduce
//  anche che cosa in questa domanda è POSSIBILE. Se il gruppo 1 mostra caselle
//  da 3, 3 e 2 figure e la risposta ne ha una sola, "servono almeno 2 figure" è
//  una regola falsa che gli esempi non smentiscono mai: si ragiona benissimo e
//  si scarta la risposta giusta. Quindi:
//   - ogni valore che la risposta assume (forma, colore, conteggio,
//     riempimento) deve comparire in almeno una casella disegnata;
//   - per gli attributi LIBERI (che non definiscono nessun gruppo, e che perciò
//     sono identici in tutte e tre le opzioni) il valore della risposta deve
//     comparire in OGNI gruppo: nessuna cornice può suggerire "qui una figura
//     così non ci sta".
//  Il vincolo non si può estendere agli attributi che definiscono i gruppi: il
//  colore del gruppo 2 non può comparire nel gruppo 1, altrimenti i gruppi non
//  sarebbero disgiunti. Per quelli la difesa è la consegna, che dice esplicita-
//  mente che la regola di un gruppo è l'unica cosa uguale a tutte le sue
//  caselle e che il resto cambia e non conta.
// Tutte le condizioni sono verificate a runtime: se saltano, si rigenera.
//
// CONTEGGIO LEGGIBILE: tre figure in fila escono dalla casella (il renderer non
// scende sotto il 45% di larghezza per figura) e vengono tagliate ai bordi: si
// conta male proprio quando il conteggio è la regola. Le caselle da 3 figure
// usano quindi la disposizione a griglia (2 sopra, 1 sotto), che sta dentro.

import type { CellSpec, ChoiceVisual, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, shuffle, type Rng } from '../rng';
import { COLOR_NAMES, distinctColors } from '../colors';
import { placeChoices, retry } from './qutils';

type Fill = 'solid' | 'outline' | 'half';
type Attr = 'shape' | 'color' | 'count' | 'fill';
type Val = string | number;

/** una casella: n copie della stessa figura */
interface Item {
  shape: ShapeName;
  color: number;
  count: number;
  fill: Fill;
}

const ATTRS: Attr[] = ['shape', 'color', 'count', 'fill'];

// forme inconfondibili anche in miniatura (pentagono/esagono sarebbero cerchi)
const SHAPES: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'heart', 'cross', 'moon'];
const FILLS: Fill[] = ['solid', 'outline', 'half'];
const COUNTS = [1, 2, 3];

/**
 * Quattro colori che si distinguono a due a due (le coppie che si confondono
 * stanno in src/lib/colors.ts). Qui un colore può essere l'unica differenza fra
 * la risposta e un distrattore: se due opzioni fossero verde acqua e verde, la
 * domanda diventerebbe un test della vista invece che di logica.
 */
function pickPalette(rng: Rng): number[] {
  return distinctColors(rng, 4);
}

/** etichetta stampata sopra la prima casella di ogni gruppo */
const GROUP_LABEL = ['Gruppo 1', 'Gruppo 2', 'Gruppo 3'];
/** etichetta "vuota": tiene le altre caselle allineate a quella intestata */
const NO_LABEL = ' ';

/**
 * Coppie di valori che a schermo si assomigliano troppo: possono comparire nel
 * disegno, ma non possono essere l'UNICA differenza fra la risposta giusta e un
 * distrattore (sarebbe uno spot-the-difference, non un ragionamento).
 * I colori non compaiono qui perché ci pensa già pickPalette: nella stessa
 * domanda non entrano mai due colori confondibili.
 */
function tooClose(a: Attr, x: Val, y: Val): boolean {
  const pair = (p: Val, q: Val) => (x === p && y === q) || (x === q && y === p);
  // "piena" e "colorata a metà" differiscono solo per metà campitura
  if (a === 'fill') return pair('solid', 'half');
  // il rombo è il quadrato girato: in miniatura la differenza è un dettaglio
  if (a === 'shape') return pair('square', 'diamond');
  return false;
}

/**
 * Valori "comodi da guardare" per un attributo che nelle opzioni è solo
 * contorno: 3 figure in una casella sono un terzo della sua larghezza e la
 * campitura a metà è la più faticosa da riconoscere.
 */
function readable(a: Attr, pool: Val[]): Val[] {
  const easy = a === 'count' ? pool.filter((x) => x !== 3) : a === 'fill' ? pool.filter((x) => x !== 'half') : pool;
  return easy.length > 0 ? easy : pool;
}

// ---------------------------------------------------------------------------
// Testi italiani
// ---------------------------------------------------------------------------

const NOUN: Record<ShapeName, string> = {
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

const PLURAL: Record<ShapeName, string> = {
  circle: 'cerchi',
  square: 'quadrati',
  triangle: 'triangoli',
  diamond: 'rombi',
  star: 'stelle',
  pentagon: 'pentagoni',
  hexagon: 'esagoni',
  arrow: 'frecce',
  heart: 'cuori',
  cross: 'croci',
  moon: 'lune',
  dot: 'pallini',
};

const COLOR_NAME = [...COLOR_NAMES];

const FILL_PLURAL: Record<Fill, string> = {
  solid: 'figure piene',
  outline: 'figure vuote (solo il contorno)',
  half: 'figure colorate a metà',
};
const FILL_NOUN: Record<Fill, string> = {
  solid: 'figura piena',
  outline: 'figura vuota (solo il contorno)',
  half: 'figura colorata a metà',
};
const FILL_ADJ: Record<Fill, string> = {
  solid: 'piena',
  outline: 'vuota',
  half: 'colorata a metà',
};

/** "contiene solo …" — che cosa hanno in comune le caselle del gruppo */
function rowClause(a: Attr, v: Val): string {
  if (a === 'shape') return `solo ${PLURAL[v as ShapeName]}`;
  if (a === 'color') return `solo figure di colore ${COLOR_NAME[v as number]}`;
  if (a === 'count') return v === 1 ? 'solo caselle con una figura sola' : `solo caselle con ${v} figure`;
  return `solo ${FILL_PLURAL[v as Fill]}`;
}

/** "deve avere: …" — la caratteristica richiesta, senza problemi di accordo */
function needClause(a: Attr, v: Val): string {
  if (a === 'shape') return `forma di ${NOUN[v as ShapeName]}`;
  if (a === 'color') return `colore ${COLOR_NAME[v as number]}`;
  if (a === 'count') return v === 1 ? 'una figura sola' : `${v} figure`;
  return FILL_NOUN[v as Fill];
}

/** "non è …" — usato dalla domanda negativa */
function negClause(a: Attr, v: Val): string {
  if (a === 'shape') return `non ha la forma di ${NOUN[v as ShapeName]}`;
  if (a === 'color') return `non è di colore ${COLOR_NAME[v as number]}`;
  if (a === 'count') return v === 1 ? 'non ha una figura sola' : `non ha ${v} figure`;
  return `non è ${FILL_ADJ[v as Fill]}`;
}

function join(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Item ↔ attributi ↔ cella
// ---------------------------------------------------------------------------

function getAttr(it: Item, a: Attr): Val {
  return a === 'shape' ? it.shape : a === 'color' ? it.color : a === 'count' ? it.count : it.fill;
}

function withAttr(it: Item, a: Attr, v: Val): Item {
  const n: Item = { ...it };
  if (a === 'shape') n.shape = v as ShapeName;
  else if (a === 'color') n.color = v as number;
  else if (a === 'count') n.count = v as number;
  else n.fill = v as Fill;
  return n;
}

/** dimensione per rendere leggibili 1, 2 o 3 figure nella casella */
const SIZE_BY_COUNT = [0, 0.8, 0.9, 0.92];

function cellOf(it: Item): CellSpec {
  return {
    shapes: Array.from({ length: it.count }, () => ({
      shape: it.shape,
      color: it.color,
      fillMode: it.fill,
      size: SIZE_BY_COUNT[it.count],
    })),
    // 1 e 2 figure stanno in fila dentro la casella; 3 in fila sborderebbero
    // (45% di larghezza ciascuna) e le due esterne verrebbero tagliate a metà:
    // a griglia (2 sopra, 1 sotto) restano intere e si contano davvero
    layout: it.count === 3 ? 'grid' : 'row',
  };
}

/** chiave di uguaglianza fra caselle (le opzioni non devono copiare il disegno) */
function keyOf(it: Item): string {
  return `${it.shape}|${it.color}|${it.count}|${it.fill}`;
}

// ---------------------------------------------------------------------------
// Piano della domanda
// ---------------------------------------------------------------------------

interface Plan {
  /** 'intersect': la figura che sta in tutte le righe. 'none': quella che non sta in nessuna. */
  mode: 'intersect' | 'none';
  /** attributo che definisce ciascun gruppo, nell'ordine delle righe */
  attrs: Attr[];
  /** caselle per riga */
  cols: number;
  /** un attributo di rumore quasi costante per riga (2 caselle su 3 uguali) */
  nearMiss: boolean;
}

// d1: proprietà che si riconoscono guardando, senza contare
const D1_PAIRS: Attr[][] = [
  ['shape', 'color'],
  ['shape', 'fill'],
  ['color', 'fill'],
];
// d2: c'è sempre il conteggio, che va guardato figura per figura
const D2_PAIRS: Attr[][] = [
  ['shape', 'count'],
  ['color', 'count'],
  ['count', 'fill'],
];

function planFor(rng: Rng, difficulty: Difficulty): Plan {
  if (difficulty === 1) {
    const pair = pick(rng, D1_PAIRS);
    const attrs = chance(rng, 0.5) ? [pair[0], pair[1]] : [pair[1], pair[0]];
    return { mode: 'intersect', attrs, cols: chance(rng, 0.25) ? 4 : 3, nearMiss: false };
  }
  if (difficulty === 2) {
    const pair = pick(rng, D2_PAIRS);
    const attrs = chance(rng, 0.5) ? [pair[0], pair[1]] : [pair[1], pair[0]];
    // qui si conta fino a 3 figure per casella: con 4 colonne ogni figura
    // scenderebbe a ~22px e contare diventerebbe un esercizio di vista
    return { mode: 'intersect', attrs, cols: 3, nearMiss: true };
  }
  // d3: quasi sempre tre gruppi da intersecare. La domanda negativa ribalta il
  // compito ("quale NON entra") ed è la più facile da fraintendere: resta una
  // minoranza dei round e usa solo DUE gruppi, così le verifiche da fare sono 6
  // invece di 9.
  if (chance(rng, 0.75)) {
    return { mode: 'intersect', attrs: pickN(rng, ATTRS, 3), cols: 3, nearMiss: chance(rng, 0.8) };
  }
  return { mode: 'none', attrs: pickN(rng, ATTRS, 2), cols: 3, nearMiss: true };
}

// ---------------------------------------------------------------------------
// Costruzione
// ---------------------------------------------------------------------------

function buildPools(rng: Rng, difficulty: Difficulty, attrs: Attr[]): Record<Attr, Val[]> {
  // a d1 gli attributi che fanno solo rumore restano semplici: al massimo due
  // figure per casella e niente riempimento "a metà"
  const easy = difficulty === 1;
  return {
    shape: pickN(rng, SHAPES, 4),
    color: pickPalette(rng),
    count: easy && !attrs.includes('count') ? [1, 2] : [...COUNTS],
    fill: easy && !attrs.includes('fill') ? ['solid', 'outline'] : [...FILLS],
  };
}

/**
 * Distribuisce `n` valori presi da `allowed` in modo che NON siano tutti uguali.
 * `nearMiss` = tutti uguali tranne uno (rumore che somiglia a una regola).
 * `must` = valore che DEVE comparire almeno una volta: è il valore che avranno
 * le opzioni per quell'attributo, e ogni gruppo deve mostrarne un esempio
 * (vincolo di copertura).
 */
function spread(rng: Rng, allowed: Val[], n: number, nearMiss: boolean, must?: Val): Val[] {
  if (allowed.length < 2) throw new Error('valori insufficienti per far variare la proprietà');
  if (must !== undefined && !allowed.includes(must)) throw new Error('il valore da coprire non è disponibile');
  if (nearMiss) {
    // due valori: uno in 2 caselle su 3, l'altro in una sola (il "quasi uguale"
    // che sembra una regola). Il valore da coprire può fare l'una o l'altra
    // parte, così non diventa riconoscibile per posizione.
    const [x, y] =
      must === undefined
        ? pickN(rng, allowed, 2)
        : chance(rng, 0.5)
          ? [must, pick(rng, allowed.filter((z) => z !== must))]
          : [pick(rng, allowed.filter((z) => z !== must)), must];
    const vals = Array<Val>(n).fill(x);
    vals[n - 1] = y;
    return shuffle(rng, vals);
  }
  const base = shuffle(rng, [...allowed]);
  if (must !== undefined) {
    // in testa: il giro base[i % len] lo pesca di sicuro anche se le caselle
    // sono meno dei valori disponibili
    base.splice(base.indexOf(must), 1);
    base.unshift(must);
  }
  return shuffle(rng, Array.from({ length: n }, (_, i) => base[i % base.length]));
}

function buildRow(
  rng: Rng,
  plan: Plan,
  pools: Record<Attr, Val[]>,
  idx: number,
  v: Partial<Record<Attr, Val>>,
  free: Partial<Record<Attr, Val>>
): Item[] {
  const own = plan.attrs[idx];
  const others = ATTRS.filter((a) => a !== own);
  const nmAttr = plan.nearMiss ? pick(rng, others) : null;

  const values: Partial<Record<Attr, Val[]>> = {};
  for (const a of others) {
    // niente casella che soddisfi ANCHE la proprietà di un altro gruppo
    const allowed = pools[a].filter((x) => !(plan.attrs.includes(a) && x === v[a]));
    values[a] = spread(rng, allowed, plan.cols, a === nmAttr, free[a]);
  }

  const items: Item[] = [];
  for (let c = 0; c < plan.cols; c++) {
    let it: Item = { shape: 'circle', color: 0, count: 1, fill: 'solid' };
    it = withAttr(it, own, v[own] as Val);
    for (const a of others) it = withAttr(it, a, (values[a] as Val[])[c]);
    items.push(it);
  }
  if (new Set(items.map((it) => JSON.stringify(it))).size !== items.length) {
    throw new Error('due caselle identiche nello stesso gruppo');
  }
  return items;
}

/** la casella soddisfa la proprietà del gruppo i? */
function inGroup(it: Item, plan: Plan, v: Partial<Record<Attr, Val>>, i: number): boolean {
  const a = plan.attrs[i];
  return getAttr(it, a) === v[a];
}

function buildQuestion(rng: Rng, difficulty: Difficulty): Question {
  const plan = planFor(rng, difficulty);
  const pools = buildPools(rng, difficulty, plan.attrs);

  // valore che definisce ciascun gruppo
  const v: Partial<Record<Attr, Val>> = {};
  for (const a of plan.attrs) v[a] = pick(rng, pools[a]);

  // Attributi LIBERI: non definiscono nessun gruppo, quindi sono identici in
  // tutte e tre le opzioni e non discriminano. Il loro valore si sceglie PRIMA
  // delle righe (comodo da guardare: poche figure, niente campitura a metà) e
  // ogni gruppo dovrà mostrarne un esempio, così nessuna cornice fa pensare
  // "una figura così qui non ci starebbe".
  const free: Partial<Record<Attr, Val>> = {};
  for (const a of ATTRS) {
    if (!plan.attrs.includes(a)) free[a] = pick(rng, readable(a, pools[a]));
  }

  const rows = plan.attrs.map((_, i) => buildRow(rng, plan, pools, i, v, free));

  // --- controllo 1: dentro ogni gruppo solo la proprietà giusta è costante ---
  for (let i = 0; i < rows.length; i++) {
    for (const a of ATTRS) {
      if (a === plan.attrs[i]) continue;
      const vals = rows[i].map((it) => getAttr(it, a));
      if (vals.every((x) => x === vals[0])) {
        throw new Error(`proprietà ambigua nel gruppo ${i}: anche ${a} è costante`);
      }
    }
  }
  // --- controllo 2: i gruppi disegnati sono disgiunti ---
  for (let i = 0; i < rows.length; i++) {
    for (const it of rows[i]) {
      for (let j = 0; j < plan.attrs.length; j++) {
        if (j !== i && inGroup(it, plan, v, j)) throw new Error('una casella appartiene a due gruppi');
      }
    }
  }

  // --- opzioni: differiscono SOLO negli attributi che definiscono i gruppi ---
  // Ogni distrattore differisce dalla risposta per UN attributo: quel solo
  // attributo deve quindi saltare all'occhio, altrimenti la domanda diventa una
  // caccia alle differenze (vedi tooClose).
  /** valori di un attributo davvero disegnati nelle caselle */
  const shown = (a: Attr): Val[] => [...new Set(rows.flat().map((it) => getAttr(it, a)))];
  const drawn = new Set(rows.flat().map(keyOf));

  let correct: Item = { shape: 'circle', color: 0, count: 1, fill: 'solid' };
  for (const a of ATTRS) {
    if (plan.attrs.includes(a)) {
      if (plan.mode === 'intersect') {
        // il valore del gruppo: è sotto gli occhi, uguale in tutta la sua cornice
        correct = withAttr(correct, a, v[a] as Val);
      } else {
        // negativa: un valore diverso da quello del gruppo, ben distinguibile da
        // esso (il distrattore differirà dalla risposta proprio qui) e comunque
        // MOSTRATO nel disegno: se la risposta fosse l'unica figura di un colore
        // mai visto si risponderebbe "quella strana" senza guardare i gruppi
        const far = shown(a).filter((x) => x !== v[a] && !tooClose(a, v[a] as Val, x));
        if (far.length === 0) throw new Error(`nessun valore mostrato e ben distinguibile per ${a}`);
        correct = withAttr(correct, a, pick(rng, far));
      }
    } else {
      // attributo libero: identico in tutte e tre le opzioni, quindi non
      // discrimina. Il valore è già stato scelto (e ogni gruppo ne mostra un
      // esempio, vedi il vincolo di copertura più sotto).
      correct = withAttr(correct, a, free[a] as Val);
    }
  }

  const [g1, g2] = pickN(rng, plan.attrs.map((_, i) => i), 2);
  const makeDistractor = (i: number): Item => {
    const a = plan.attrs[i];
    // domanda negativa: il distrattore entra in UN gruppo solo
    if (plan.mode === 'none') return withAttr(correct, a, v[a] as Val);
    // intersezione: rispetta tutte le regole tranne questa, e il valore "sbagliato"
    // è preferibilmente uno di quelli davvero mostrati nelle altre righe (errore
    // più credibile), purché non si confonda con quello della risposta
    const far = (xs: Val[]) => xs.filter((x) => x !== v[a] && !tooClose(a, v[a] as Val, x));
    const seen = far(shown(a));
    const cand = seen.length > 0 ? seen : far(pools[a]);
    if (cand.length === 0) throw new Error(`nessun valore ben distinguibile per ${a}`);
    // a parità di tutto, un valore che non renda il distrattore la copia di una
    // casella già disegnata (sarebbe una figura "già vista", quindi sospetta)
    const fresh = cand.filter((x) => !drawn.has(keyOf(withAttr(correct, a, x))));
    const use = fresh.length > 0 ? fresh : cand;
    // fra questi, il valore più presente nel disegno: così il distrattore non è
    // "quello strano" e non si può rispondere scegliendo la figura più familiare
    // senza guardare i gruppi
    const freq = (x: Val) => rows.flat().filter((it) => getAttr(it, a) === x).length;
    const top = Math.max(...use.map(freq));
    return withAttr(correct, a, pick(rng, use.filter((x) => freq(x) === top)));
  };
  const d1 = makeDistractor(g1);
  const d2 = makeDistractor(g2);

  // --- controllo 3: unicità della risposta ---
  const nIn = (it: Item) => plan.attrs.filter((_, i) => inGroup(it, plan, v, i)).length;
  const total = plan.attrs.length;
  if (plan.mode === 'intersect') {
    if (nIn(correct) !== total) throw new Error('la risposta non sta in tutti i gruppi');
    if (nIn(d1) !== total - 1 || nIn(d2) !== total - 1) throw new Error('un distrattore non viola esattamente una regola');
  } else {
    if (nIn(correct) !== 0) throw new Error('la risposta sta in un gruppo');
    if (nIn(d1) !== 1 || nIn(d2) !== 1) throw new Error('un distrattore non sta in esattamente un gruppo');
  }

  // --- controllo 4: ogni coppia di opzioni si distingue a colpo d'occhio ---
  const opts = [correct, d1, d2];
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      const diff = ATTRS.filter((a) => getAttr(opts[i], a) !== getAttr(opts[j], a));
      if (diff.length === 0) throw new Error('due opzioni identiche');
      if (diff.length === 1 && tooClose(diff[0], getAttr(opts[i], diff[0]), getAttr(opts[j], diff[0]))) {
        throw new Error('due opzioni separate solo da una differenza impercettibile');
      }
    }
  }

  // --- controllo 5: VINCOLO DI COPERTURA ---
  // Nessun valore della risposta deve essere "impossibile" secondo gli esempi.
  for (const a of ATTRS) {
    const val = getAttr(correct, a);
    if (!shown(a).includes(val)) {
      throw new Error(`copertura: nessun esempio mostra ${a}=${val}, che la risposta richiede`);
    }
    // per gli attributi liberi il controllo è gruppo per gruppo: sono uguali in
    // tutte le opzioni, quindi un gruppo che non li mostra mai non aiuta a
    // scegliere e semina il dubbio ("qui una figura così non c'è mai")
    if (plan.attrs.includes(a)) continue;
    for (let i = 0; i < rows.length; i++) {
      if (!rows[i].some((it) => getAttr(it, a) === val)) {
        throw new Error(`copertura: il gruppo ${i + 1} non mostra mai ${a}=${val}`);
      }
    }
  }

  const plainCells = rows.map((r) => r.map(cellOf));
  const choiceCells = [correct, d1, d2].map(cellOf);
  // nessuna opzione deve essere la copia di una casella già disegnata
  // (confronto sulle celle nude, prima di attaccare le etichette di gruppo)
  const drawnCells = new Set(plainCells.flat().map((c) => JSON.stringify(c)));
  for (const c of choiceCells) {
    if (drawnCells.has(JSON.stringify(c))) throw new Error('opzione identica a una casella del disegno');
  }
  // intestazione del gruppo sulla prima casella; le altre prendono
  // un'etichetta vuota solo per restare allineate alla prima
  const rowCells = plainCells.map((row, i) =>
    row.map((cell, c) => ({ ...cell, label: c === 0 ? GROUP_LABEL[i] : NO_LABEL }))
  );

  const { choices, correctIndex } = placeChoices(rng, { kind: 'cell', cell: choiceCells[0] }, [
    { kind: 'cell', cell: choiceCells[1] },
    { kind: 'cell', cell: choiceCells[2] },
  ] as [ChoiceVisual, ChoiceVisual]);

  const rowsText = plan.attrs.map((a, i) => `il gruppo ${i + 1} contiene ${rowClause(a, v[a] as Val)}`);
  // La consegna dice COME si legge un gruppo, non solo che cosa cercare: la
  // regola è l'unica cosa uguale a tutte le sue caselle, il resto cambia e non
  // conta. Senza questa frase ogni regolarità apparente ("qui sono tutte
  // grandi", "qui non c'è mai una figura sola") sembra una regola da rispettare.
  const meta = chance(rng, 0.5)
    ? 'La regola di un gruppo è la cosa uguale in tutte le sue caselle: il resto cambia e non conta.'
    : 'Ogni gruppo ha una regola: è la cosa uguale in tutte le sue caselle, il resto non conta.';
  const prompt =
    plan.mode === 'none'
      ? // niente doppia negazione: si dice al bambino che cosa cercare e quante
        // figure entrano da qualche parte, così il compito non si può ribaltare
        chance(rng, 0.5)
        ? `${meta} Due figure entrano in un gruppo, una NON entra in nessuno: qual è?`
        : `${meta} Trova la figura che NON va bene per nessun gruppo.`
      : total === 3
        ? chance(rng, 0.5)
          ? `${meta} Quale figura può entrare in tutti e tre i gruppi?`
          : `${meta} Quale figura va bene per tutti e tre i gruppi?`
        : chance(rng, 0.5)
          ? `${meta} Quale figura può entrare in tutti e due i gruppi?`
          : `${meta} Quale figura va bene sia per il Gruppo 1 sia per il Gruppo 2?`;

  const explanation =
    plan.mode === 'intersect'
      ? `Le regole: ${join(rowsText)}. La risposta deve avere tutto insieme: ` +
        `${join(plan.attrs.map((a) => needClause(a, v[a] as Val)))}. ` +
        `Le altre due opzioni rispettano ${total === 3 ? 'solo due regole su tre' : 'una regola sola'}.`
      : `Le regole: ${join(rowsText)}. La risposta giusta è l'unica che non rispetta nessuna regola: ` +
        `${join(plan.attrs.map((a) => negClause(a, v[a] as Val)))}. ` +
        `Le altre due entrano in un gruppo ciascuna.`;

  return {
    qtype: 'sets',
    difficulty,
    prompt,
    // groups: ogni gruppo dentro la sua cornice, così il disegno dice quello che
    // dice la consegna (senza, due righe di caselle si leggono come una matrice)
    payload: { kind: 'cells' as const, rows: rowCells, groups: true },
    choices,
    correctIndex,
    explanation,
  };
}

export function genSets(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => buildQuestion(rng, difficulty), 40);
}
