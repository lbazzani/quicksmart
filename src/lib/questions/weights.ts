// Generatore "weights": catene di equivalenze fra forme — "quanto vale?".
//
// Complementare a "balance": qui le bilance sono SEMPRE in equilibrio (tilt 0) e
// funzionano come un tabellone del cambio ("1 sole = 3 lune"); la domanda non è
// mai un confronto di peso ma una CONVERSIONE lungo la catena:
//   "quante X valgono UN Y?", "quanti Y valgono N X?", "quante X in tutto?".
//
// Difficoltà 1: una o due conversioni con numeri piccoli (moltiplica, dividi,
// somma). 2: catene a tre livelli, una divisione intermedia, gruppi misti su un
// piatto. 3: SOLO catene di conversione e confronti fra due bilance quasi
// uguali — niente minimo comune multiplo, niente sistemi da risolvere per
// sostituzione: dove i rapporti non sono unitari (2 A = 3 B) lo stesso gruppo
// compare identico sulle due bilance, così il "ponte" si vede invece di doverlo
// calcolare.
//
// I pesi interni sono INTERI e ogni bilancia viene verificata: se i due piatti
// non valgono uguale la generazione fallisce invece di produrre una domanda
// sbagliata. Le risposte sono sempre intere e uniche.
//
// Distrattori: errori tipici e mai casuali — sommare invece di moltiplicare,
// fermarsi al livello intermedio (rispondere nella "valuta" sbagliata),
// dimenticare la divisione, incrociare i moltiplicatori, off-by-one. Mai un
// numero già stampato nel disegno: sembrerebbe da leggere invece che da
// calcolare.

import type { CountedShapes, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { L } from '../localize';
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

/**
 * Stessa tabella in inglese. Niente `un`/`pl`/`quanti`: un nome di forma
 * inglese non ha genere, l'articolo indeterminativo è sempre "a" per queste
 * dieci forme (nessuna comincia per suono vocalico) e "how many" non si
 * accorda mai col numero.
 */
interface ShapeInfoEn {
  name: string; // "diamond"
  plural: string; // "diamonds"
}

const SHAPES_EN: Record<ShapeName, ShapeInfoEn> = {
  circle: { name: 'circle', plural: 'circles' },
  square: { name: 'square', plural: 'squares' },
  triangle: { name: 'triangle', plural: 'triangles' },
  diamond: { name: 'diamond', plural: 'diamonds' },
  star: { name: 'star', plural: 'stars' },
  pentagon: { name: 'pentagon', plural: 'pentagons' },
  hexagon: { name: 'hexagon', plural: 'hexagons' },
  arrow: { name: 'arrow', plural: 'arrows' },
  heart: { name: 'heart', plural: 'hearts' },
  cross: { name: 'cross', plural: 'crosses' },
  moon: { name: 'moon', plural: 'moons' },
  dot: { name: 'dot', plural: 'dots' },
};

/** l'informazione inglese sulla forma, a partire dallo ShapeInfo italiano già scelto */
function shapeEn(s: ShapeInfo): ShapeInfoEn {
  return SHAPES_EN[s.shape];
}

/** "1 moon" / "3 moons" */
function cntEn(n: number, s: ShapeInfoEn): string {
  return `${n} ${n === 1 ? s.name : s.plural}`;
}

/** "a moon" */
function oneEn(s: ShapeInfoEn): string {
  return `a ${s.name}`;
}

/** "ONE moon" (con enfasi, per i prompt — come UNO()) */
function ONE_EN(s: ShapeInfoEn): string {
  return `ONE ${s.name}`;
}

/** accordo del verbo: "1 moon IS worth", "3 moons ARE worth" */
function valEn(n: number): string {
  return n === 1 ? 'is worth' : 'are worth';
}

/**
 * Come `valEn`, ma senza "worth": serve ai prompt del tipo "How many X is/are
 * Y worth?", dove l'importo noto Y va incastrato FRA l'ausiliare e "worth"
 * (altrimenti "How many diamonds are worth 3 stars?" si legge come "quali
 * diamanti valgono 3 stelle", non come la conversione che si vuole chiedere).
 */
function auxEn(n: number): string {
  return n === 1 ? 'is' : 'are';
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

/**
 * Verifica che i due gruppi valgano davvero uguale: è la rete di sicurezza
 * contro un'aritmetica sbagliata nel generatore. Il confronto è negato così da
 * intercettare anche il NaN di una forma senza peso dichiarato.
 */
function checkEq(w: Weights, a: Group[], b: Group[]): void {
  const tot = (gs: Group[]) => gs.reduce((sum, x) => sum + x.n * (w.get(x.s.shape) ?? NaN), 0);
  if (!(tot(a) === tot(b))) throw new Error('equivalenza incoerente nel generatore weights');
}

/** Equivalenza fra due gruppi; il lato di ciascuno è casuale (non cambia il senso). */
function eqScale(rng: Rng, w: Weights, a: Group[], b: Group[]): Scale {
  checkEq(w, a, b);
  return chance(rng, 0.5)
    ? { left: counted(a), right: counted(b), tilt: 0 }
    : { left: counted(b), right: counted(a), tilt: 0 };
}

/**
 * Equivalenza con i lati FISSI: serve quando due bilance vanno confrontate a
 * colpo d'occhio (stesso gruppo ripetuto, oppure "una ha un pezzo in più"):
 * se i gruppi saltellano da un lato all'altro il confronto non si vede.
 */
function eqScaleLeft(w: Weights, a: Group[], b: Group[]): Scale {
  checkEq(w, a, b);
  return { left: counted(a), right: counted(b), tilt: 0 };
}

// ---------------------------------------------------------------------------
// notazione dei piatti — UNA regola sola, valida per tutte le difficoltà
// ---------------------------------------------------------------------------
//
// Il renderer (PanShapes in visuals.tsx) disegna i pezzi uno per uno finché
// sono al massimo 3 e passa alla forma compatta "N×forma" da 4 in su. Il
// generatore rispetta la stessa soglia dappertutto:
//   1. nessun piatto supera MAX_COUNT pezzi;
//   2. una stessa forma non compare mai "da contare" (2-3 pezzi disegnati) su
//      una bilancia e "da leggere" (N×) su un'altra della stessa domanda: il
//      pezzo singolo, che non si conta, è l'unica eccezione;
//   3. un piatto non contiene mai due gruppi della stessa forma (si leggerebbe
//      come un gruppo solo);
//   4. il contenuto ci sta dentro il piatto (larghezza stimata).
// Se una regola salta, la domanda viene rigenerata da retry().

const DRAWN_MAX = 3; // fin qui il renderer disegna i pezzi
const MAX_COUNT = 9; // oltre, il piatto diventa un muro di numeri
const PLATE_INNER = 100; // px utili dentro un piatto (il riquadro è 108)

/** larghezza stimata di un gruppo sul piatto: pezzi disegnati o scritta "N×" */
function groupWidth(count: number): number {
  return count <= DRAWN_MAX ? count * 26 : 46;
}

function plateWidth(items: CountedShapes[]): number {
  const shapes = items.reduce((s, it) => s + groupWidth(it.count), 0);
  return shapes + 14 * (items.length - 1); // i "+" fra un gruppo e l'altro
}

function checkPlates(scales: Scale[]): void {
  const band = new Map<ShapeName, 'disegnata' | 'scritta'>();
  for (const sc of scales) {
    for (const pan of [sc.left, sc.right]) {
      const seen = new Set<ShapeName>();
      for (const it of pan) {
        if (it.count < 1 || it.count > MAX_COUNT) throw new Error('piatto con troppi pezzi');
        if (seen.has(it.shape)) throw new Error('due gruppi della stessa forma sullo stesso piatto');
        seen.add(it.shape);
        if (it.count === 1) continue; // il pezzo singolo si legge in entrambi i modi
        const b = it.count <= DRAWN_MAX ? 'disegnata' : 'scritta';
        const prev = band.get(it.shape);
        if (prev && prev !== b) throw new Error('notazione dei piatti non uniforme');
        band.set(it.shape, b);
      }
      if (plateWidth(pan) > PLATE_INNER) throw new Error('piatto troppo pieno');
    }
  }
}

/** i numeri STAMPATI nel disegno: solo i gruppi resi come "N×forma" */
function printedNumbers(scales: Scale[]): number[] {
  const out: number[] = [];
  for (const sc of scales)
    for (const pan of [sc.left, sc.right])
      for (const it of pan) if (it.count > DRAWN_MAX) out.push(it.count);
  return out;
}

/** i numeri scritti nel testo della domanda */
function promptNumbers(prompt: string): number[] {
  return (prompt.match(/\d+/g) ?? []).map(Number);
}

// ---------------------------------------------------------------------------
// distrattori
// ---------------------------------------------------------------------------

/**
 * Sceglie 2 distrattori fra i candidati (già ordinati per plausibilità):
 * interi positivi, diversi dalla risposta e fra loro, di ordine di grandezza
 * credibile, e MAI un numero già stampato nel disegno o nella domanda (sarebbe
 * una trappola percettiva: sembra da leggere invece che da calcolare).
 * La posizione della risposta nella scala dei tre numeri (più piccola, in
 * mezzo, più grande) viene sorteggiata, così non esiste una scorciatoia del
 * tipo "è sempre il numero più piccolo".
 */
function chooseDistractors(
  rng: Rng,
  correct: number,
  candidates: number[],
  printed: Set<number>
): [number, number] {
  const seen = new Set<number>([correct]);
  const pool: number[] = [];
  const max = correct * 6 + 8;
  // gli "errori tipici" vengono prima; questi ultimi sono solo tappabuchi
  const filler = [correct + 1, correct - 1, correct + 2, correct - 2, correct * 2, correct + 3, correct + 4];
  const strong = new Set<number>();
  for (const c of [...candidates, ...filler]) {
    if (!Number.isFinite(c) || !Number.isInteger(c)) continue;
    if (c < 1 || c > max || seen.has(c) || printed.has(c)) continue;
    seen.add(c);
    pool.push(c);
    if (candidates.includes(c)) strong.add(c);
  }
  if (pool.length < 2) throw new Error('distrattori insufficienti');
  const below = pool.filter((c) => c < correct);
  const above = pool.filter((c) => c > correct);
  const layouts: Array<[number[], number[]]> = [];
  if (above.length >= 2) layouts.push([above, above]); // risposta = la più piccola
  if (below.length >= 2) layouts.push([below, below]); // risposta = la più grande
  if (below.length >= 1 && above.length >= 1) layouts.push([below, above]); // in mezzo
  if (layouts.length === 0) {
    const [a, b] = pickN(rng, pool, 2);
    return [a, b];
  }
  // fra le posizioni possibili tengo solo quelle che lasciano entrare almeno un
  // errore tipico: tre numeri consecutivi (17, 18, 19) non insegnano niente
  const useful = layouts.filter(([x, y]) => x.some((c) => strong.has(c)) || y.some((c) => strong.has(c)));
  const [x, y] = pick(rng, useful.length ? useful : layouts);
  const head = (arr: number[]) => arr.slice(0, Math.min(3, arr.length));
  const best = (arr: number[]) => {
    const s = arr.filter((c) => strong.has(c));
    return pick(rng, head(s.length ? s : arr));
  };
  if (x !== y) return [best(x), best(y)];
  const a = best(x);
  return [a, best(x.filter((c) => c !== a))];
}

// ---------------------------------------------------------------------------
// modello di una domanda già risolta
// ---------------------------------------------------------------------------

interface Built {
  scales: Scale[];
  prompt: string;
  /** come `prompt`, in inglese */
  promptEn: string;
  answer: number;
  /** candidati distrattori in ordine di plausibilità */
  wrong: number[];
  explanation: string;
  /** come `explanation`, in inglese */
  explanationEn: string;
}

function finish(rng: Rng, difficulty: Difficulty, b: Built): Question {
  checkPlates(b.scales);
  const printed = new Set<number>([...printedNumbers(b.scales), ...promptNumbers(b.prompt)]);
  const [w1, w2] = chooseDistractors(rng, b.answer, b.wrong, printed);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: L(String(b.answer)) }, [
    { kind: 'text', text: L(String(w1)) },
    { kind: 'text', text: L(String(w2)) },
  ]);
  return {
    qtype: 'weights',
    difficulty,
    prompt: L(b.prompt, b.promptEn),
    payload: { kind: 'balance', scales: b.scales },
    choices,
    correctIndex,
    explanation: L(b.explanation, b.explanationEn),
  };
}

// ---------------------------------------------------------------------------
// difficoltà 1 — una conversione, al massimo due passi con numeri piccoli
// ---------------------------------------------------------------------------

/** 1 A = k B → "quante B valgono m A?" (moltiplicare) */
function d1Mul(rng: Rng): Built {
  const [A, B] = pickN(rng, SHAPES, 2);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
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
    promptEn: `How many ${BEn.plural} ${auxEn(m)} ${cntEn(m, AEn)} worth?`,
    answer: k * m,
    wrong: [k + m, k, k * (m + 1), k * m - k, m],
    explanation:
      `La bilancia è in equilibrio: ${cnt(1, A)} ${val(1)} ${cnt(k, B)}. ` +
      `Allora ${cnt(m, A)} valgono ${m} volte tanto: ${m}×${k} = ${cnt(k * m, B)}.`,
    explanationEn:
      `The scale is balanced: ${cntEn(1, AEn)} ${valEn(1)} ${cntEn(k, BEn)}. ` +
      `So ${cntEn(m, AEn)} ${valEn(m)} ${m} times as much: ${m}×${k} = ${cntEn(k * m, BEn)}.`,
  };
}

/** a A = a·k B → "quante B valgono UN A?" (dividere) */
function d1Div(rng: Rng): Built {
  const [A, B] = pickN(rng, SHAPES, 2);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const [cA, cB] = pickN(rng, COLORS, 2);
  const a = randInt(rng, 2, 3);
  // il piatto delle B non deve diventare un muro: a·k resta dentro MAX_COUNT
  const k = randInt(rng, 2, Math.floor(MAX_COUNT / a));
  const w: Weights = new Map([
    [A.shape, k],
    [B.shape, 1],
  ]);
  return {
    scales: [eqScale(rng, w, [g(A, cA, a)], [g(B, cB, a * k)])],
    prompt: `${B.quanti} ${B.plural} valgono ${UNO(A)}?`,
    promptEn: `How many ${BEn.plural} ${auxEn(1)} ${ONE_EN(AEn)} worth?`,
    answer: k,
    wrong: [a * k, k + 1, k - 1, a * k - a, a + k],
    explanation:
      `I due piatti valgono uguale: ${cnt(a, A)} valgono ${cnt(a * k, B)}. ` +
      `Divido tutto per ${a}: ${uno(A)} ${val(1)} ${a * k}÷${a} = ${cnt(k, B)}.`,
    explanationEn:
      `Both pans are worth the same: ${cntEn(a, AEn)} ${valEn(a)} ${cntEn(a * k, BEn)}. ` +
      `Divide by ${a}: ${oneEn(AEn)} is worth ${a * k}÷${a} = ${cntEn(k, BEn)}.`,
  };
}

/** 1 A = a B, 1 B = b C → "quante C valgono UN A?" (catena, moltiplicare) */
function d1ChainDown(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
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
    promptEn: `How many ${CEn.plural} ${auxEn(1)} ${ONE_EN(AEn)} worth?`,
    answer: a * b,
    wrong: [a + b, a * b + a, a, b],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, B)}, e ${cnt(1, B)} ${val(1)} ${cnt(b, C)}. ` +
      `Quindi ${uno(A)} vale ${a} gruppi da ${b}: ${a}×${b} = ${cnt(a * b, C)}.`,
    explanationEn:
      `${cntEn(1, AEn)} ${valEn(1)} ${cntEn(a, BEn)}, and ${cntEn(1, BEn)} ${valEn(1)} ${cntEn(b, CEn)}. ` +
      `So ${oneEn(AEn)} is worth ${a} groups of ${b}: ${a}×${b} = ${cntEn(a * b, CEn)}.`,
  };
}

/** stessa catena, domanda inversa: "quanti A valgono N C?" (dividere) */
function d1ChainUp(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
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
    promptEn: `How many ${AEn.plural} ${auxEn(N)} ${N} ${CEn.plural} worth?`,
    answer: m,
    wrong: [m + 1, unit, a * m, N - unit],
    explanation:
      `Prima il cambio: ${cnt(1, A)} ${val(1)} ${cnt(a, B)} = ${cnt(unit, C)}. ` +
      `Poi divido: ${N}÷${unit} = ${cnt(m, A)}.`,
    explanationEn:
      `First the conversion: ${cntEn(1, AEn)} ${valEn(1)} ${cntEn(a, BEn)} = ${cntEn(unit, CEn)}. ` +
      `Then divide: ${N}÷${unit} = ${cntEn(m, AEn)}.`,
  };
}

/** 1 A = a C, 1 B = b C → "quante C valgono in tutto un A e un B?" (sommare) */
function d1Sum(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  // a e b sono due conteggi della STESSA forma: o tutti e due disegnati (2-3)
  // o tutti e due scritti (4-7), mai uno per tipo
  const [a, b] = pickN(rng, chance(rng, 0.5) ? [2, 3] : [4, 5, 6, 7], 2);
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
    promptEn: `How many ${CEn.plural} are ${oneEn(AEn)} and ${oneEn(BEn)} worth in total?`,
    answer: a + b,
    // errori tipici: moltiplicare invece di sommare, contare due volte lo stesso
    // cambio, fermarsi al più grande, sbagliare di uno
    wrong: [a * b, 2 * a, 2 * b, Math.max(a, b), a + b + 1, a + b - 1],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, C)} e ${cnt(1, B)} ${val(1)} ${cnt(b, C)}. ` +
      `Messi insieme: ${a}+${b} = ${cnt(a + b, C)}.`,
    explanationEn:
      `${cntEn(1, AEn)} ${valEn(1)} ${cntEn(a, CEn)} and ${cntEn(1, BEn)} ${valEn(1)} ${cntEn(b, CEn)}. ` +
      `Put together: ${a}+${b} = ${cntEn(a + b, CEn)}.`,
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
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const DEn = shapeEn(D);
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
    promptEn: `How many ${DEn.plural} ${auxEn(1)} ${ONE_EN(AEn)} worth?`,
    answer: a * b * c,
    wrong: [a + b + c, a * b, b * c, a * c, a * b * c + c],
    explanation:
      `Metto in fila i cambi: ${cnt(1, A)} = ${cnt(a, B)}, ${cnt(1, B)} = ${cnt(b, C)}, ` +
      `${cnt(1, C)} = ${cnt(c, D)}. Si moltiplica lungo la catena: ` +
      `${a}×${b}×${c} = ${cnt(a * b * c, D)}.`,
    explanationEn:
      `Line up the conversions: ${cntEn(1, AEn)} = ${cntEn(a, BEn)}, ${cntEn(1, BEn)} = ${cntEn(b, CEn)}, ` +
      `${cntEn(1, CEn)} = ${cntEn(c, DEn)}. Multiply along the chain: ` +
      `${a}×${b}×${c} = ${cntEn(a * b * c, DEn)}.`,
  };
}

/** stessa catena a 3 livelli, domanda inversa */
function d2Chain3Up(rng: Rng): Built {
  const [A, B, C, D] = pickN(rng, SHAPES, 4);
  const AEn = shapeEn(A);
  const DEn = shapeEn(D);
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
    promptEn: `How many ${AEn.plural} ${auxEn(N)} ${N} ${DEn.plural} worth?`,
    answer: m,
    wrong: [m + 1, unit, a * m, a * b * m, N - unit],
    explanation:
      `${cnt(1, A)} ${val(1)} ${a}×${b}×${c} = ${cnt(unit, D)}. ` +
      `Con ${N} ${D.plural} faccio ${N}÷${unit} = ${cnt(m, A)}.`,
    explanationEn:
      `${cntEn(1, AEn)} ${valEn(1)} ${a}×${b}×${c} = ${cntEn(unit, DEn)}. ` +
      `With ${N} ${DEn.plural}, that's ${N}÷${unit} = ${cntEn(m, AEn)}.`,
  };
}

/** p A = p·u B (serve dividere), 1 B = c C → "quante C valgono UN A?" */
function d2ChainDiv(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const p = randInt(rng, 2, 3);
  const u = randInt(rng, 2, Math.floor(8 / p)); // p·u pezzi sul piatto: max 8
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
    promptEn: `How many ${CEn.plural} ${auxEn(1)} ${ONE_EN(AEn)} worth?`,
    answer: u * c,
    wrong: [p * u * c, u + c, p * u, u, u * c + c],
    explanation:
      `Attenzione al primo cambio: ${cnt(p, A)} valgono ${cnt(p * u, B)}, quindi ` +
      `${uno(A)} ${val(1)} ${p * u}÷${p} = ${cnt(u, B)}. ` +
      `E ${cnt(1, B)} ${val(1)} ${cnt(c, C)}: in tutto ${u}×${c} = ${cnt(u * c, C)}.`,
    explanationEn:
      `Careful with the first conversion: ${cntEn(p, AEn)} ${valEn(p)} ${cntEn(p * u, BEn)}, so ` +
      `${oneEn(AEn)} is worth ${p * u}÷${p} = ${cntEn(u, BEn)}. ` +
      `And ${cntEn(1, BEn)} ${valEn(1)} ${cntEn(c, CEn)}: in total ${u}×${c} = ${cntEn(u * c, CEn)}.`,
  };
}

/** 1 A = 1 B + k C (piatto misto), 1 B = d C → "quante C valgono m A?" */
function d2Combo(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  // k=1 sta bene con qualunque d (il pezzo singolo non si conta); con k=2 anche
  // d resta fra i conteggi disegnati, così le C si leggono sempre allo stesso modo
  const k = randInt(rng, 1, 2);
  const d = k === 1 ? randInt(rng, 2, 6) : randInt(rng, 2, 3);
  const m = randInt(rng, 1, 2);
  const unit = d + k;
  const w: Weights = new Map([
    [A.shape, unit],
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
    prompt: `${C.quanti} ${C.plural} valgono ${m === 1 ? UNO(A) : cnt(m, A)}?`,
    promptEn: `How many ${CEn.plural} ${auxEn(m)} ${m === 1 ? ONE_EN(AEn) : cntEn(m, AEn)} worth?`,
    answer: unit * m,
    wrong: [unit, k * d, d, 2 * d, d - k, unit * m + 1],
    explanation:
      `Sul piatto misto ${cnt(1, A)} ${val(1)} ${cnt(1, B)} più ${cnt(k, C)}. ` +
      `Siccome ${cnt(1, B)} ${val(1)} ${cnt(d, C)}, sostituisco: ${d}+${k} = ${cnt(unit, C)}` +
      (m === 1 ? '.' : `. E ${cnt(m, A)} valgono il doppio: ${m}×${unit} = ${cnt(unit * m, C)}.`),
    explanationEn:
      `On the mixed pan, ${cntEn(1, AEn)} ${valEn(1)} ${cntEn(1, BEn)} plus ${cntEn(k, CEn)}. ` +
      `Since ${cntEn(1, BEn)} ${valEn(1)} ${cntEn(d, CEn)}, substitute: ${d}+${k} = ${cntEn(unit, CEn)}` +
      (m === 1 ? '.' : `. And ${cntEn(m, AEn)} ${valEn(m)} twice as much: ${m}×${unit} = ${cntEn(unit * m, CEn)}.`),
  };
}

/** 1 A = a C, 1 B = b C → "quante C valgono in tutto m A e n B?" */
function d2SumMul(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  // stessa forma C su due bilance: conteggi tutti disegnati o tutti scritti
  const [a, b] = pickN(rng, chance(rng, 0.5) ? [2, 3] : [4, 5, 6], 2);
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
    promptEn: `How many ${CEn.plural} are ${cntEn(m, AEn)} and ${cntEn(n, BEn)} worth in total?`,
    answer,
    // errori tipici: incrociare i cambi, usare un cambio solo per tutti i pezzi,
    // dimenticarsi metà del conto, un pezzo in più o in meno
    wrong: [n * a + m * b, (m + n) * a, (m + n) * b, m * a, n * b, a + b, answer + b, answer - b],
    explanation:
      `${cnt(1, A)} ${val(1)} ${cnt(a, C)}, quindi ${cnt(m, A)} valgono ${m}×${a} = ${m * a}. ` +
      `${cnt(1, B)} ${val(1)} ${cnt(b, C)}, quindi ${cnt(n, B)} ${val(n)} ${n}×${b} = ${n * b}. ` +
      `Sommo: ${m * a}+${n * b} = ${cnt(answer, C)}.`,
    explanationEn:
      `${cntEn(1, AEn)} ${valEn(1)} ${cntEn(a, CEn)}, so ${cntEn(m, AEn)} ${valEn(m)} ${m}×${a} = ${m * a}. ` +
      `${cntEn(1, BEn)} ${valEn(1)} ${cntEn(b, CEn)}, so ${cntEn(n, BEn)} ${valEn(n)} ${n}×${b} = ${n * b}. ` +
      `Add them up: ${m * a}+${n * b} = ${cntEn(answer, CEn)}.`,
  };
}

// ---------------------------------------------------------------------------
// difficoltà 3 — catene con rapporti non unitari e confronto fra due bilance
// ---------------------------------------------------------------------------

/**
 * Terzetti (p, q, t) per le due bilance "a ponte": p A = q B e q B = t C.
 * Il gruppo di q B è IDENTICO sulle due bilance, quindi il ponte si vede a
 * occhio e non c'è nessun minimo comune multiplo da calcolare: basta scambiare
 * un blocco con l'altro. I tre numeri sono diversi fra loro, altrimenti due
 * forme finirebbero per valere uguale e la domanda si sgonfierebbe.
 */
const BRIDGES: Array<[number, number, number]> = [];
for (let p = 2; p <= 3; p++) {
  for (let q = 2; q <= 6; q++) {
    for (let t = 2; t <= 6; t++) {
      if (p === q || q === t || p === t) continue;
      BRIDGES.push([p, q, t]);
    }
  }
}

/** costruisce le due bilance a ponte, con il blocco condiviso sempre a destra */
function bridgeScales(
  rng: Rng,
  A: ShapeInfo,
  B: ShapeInfo,
  C: ShapeInfo,
  p: number,
  q: number,
  t: number
): Scale[] {
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const w: Weights = new Map([
    [A.shape, q * t],
    [B.shape, p * t],
    [C.shape, p * q],
  ]);
  const shared = g(B, cB, q);
  // il blocco condiviso sta dalla STESSA parte su tutte e due le bilance
  // (incolonnato si riconosce a occhio); da quale parte lo decide il caso
  return chance(rng, 0.5)
    ? [eqScaleLeft(w, [g(A, cA, p)], [shared]), eqScaleLeft(w, [g(C, cC, t)], [shared])]
    : [eqScaleLeft(w, [shared], [g(A, cA, p)]), eqScaleLeft(w, [shared], [g(C, cC, t)])];
}

/** p A = q B, q B = t C → "quante C valgono m·p A?" (scambio del blocco) */
function d3Bridge(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [p, q, t] = pick(rng, BRIDGES);
  // m ≥ 2: se no la risposta sarebbe già stampata su un piatto e basterebbe copiarla
  const m = randInt(rng, 2, 3);
  const scales = bridgeScales(rng, A, B, C, p, q, t);
  const nA = m * p;
  const answer = m * t;
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${cnt(nA, A)}?`,
    promptEn: `How many ${CEn.plural} ${auxEn(nA)} ${cntEn(nA, AEn)} worth?`,
    answer,
    wrong: [t, m * q, m * p, t + m, answer + t, answer - t],
    explanation:
      `Sulle due bilance c'è lo stesso identico gruppo: ${cnt(q, B)}. ` +
      `Allora posso scambiarlo: ${cnt(p, A)} valgono ${cnt(q, B)}, che valgono ${cnt(t, C)}. ` +
      `Quindi ${cnt(p, A)} = ${cnt(t, C)}. E ${cnt(nA, A)} sono ${m} gruppi da ${p}: ` +
      `${m}×${t} = ${cnt(answer, C)}.`,
    explanationEn:
      `Both scales have the exact same group: ${cntEn(q, BEn)}. ` +
      `So it can be swapped: ${cntEn(p, AEn)} ${valEn(p)} ${cntEn(q, BEn)}, which ${valEn(q)} ${cntEn(t, CEn)}. ` +
      `So ${cntEn(p, AEn)} = ${cntEn(t, CEn)}. And ${cntEn(nA, AEn)} are ${m} groups of ${p}: ` +
      `${m}×${t} = ${cntEn(answer, CEn)}.`,
  };
}

/** stesse bilance a ponte, domanda inversa: "quanti A valgono N C?" */
function d3BridgeUp(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [p, q, t] = pick(rng, BRIDGES);
  const m = randInt(rng, 2, 3);
  const scales = bridgeScales(rng, A, B, C, p, q, t);
  const N = m * t;
  const answer = m * p;
  return {
    scales,
    prompt: `${A.quanti} ${A.plural} valgono ${N} ${C.plural}?`,
    promptEn: `How many ${AEn.plural} ${auxEn(N)} ${N} ${CEn.plural} worth?`,
    answer,
    wrong: [m * q, m * t, p, N - answer, answer + 1, answer + p],
    explanation:
      `Le due bilance hanno lo stesso gruppo di ${cnt(q, B)}: posso scambiarlo. ` +
      `Così ${cnt(t, C)} valgono ${cnt(q, B)}, che valgono ${cnt(p, A)}. ` +
      `${N} ${C.plural} sono ${m} gruppi da ${t}, quindi ${m}×${p} = ${cnt(answer, A)}.`,
    explanationEn:
      `Both scales have the same group of ${cntEn(q, BEn)}: it can be swapped. ` +
      `So ${cntEn(t, CEn)} ${valEn(t)} ${cntEn(q, BEn)}, which ${valEn(q)} ${cntEn(p, AEn)}. ` +
      `${N} ${CEn.plural} are ${m} groups of ${t}, so ${m}×${p} = ${cntEn(answer, AEn)}.`,
  };
}

/**
 * Coppie (peso della forma chiesta, peso dell'altra) per le due bilance quasi
 * uguali: entrambi i totali in C restano fra 4 e MAX_COUNT, così il piatto
 * delle C è scritto "N×" tutte e due le volte (niente notazione mista).
 */
const NEARLY_EQUAL: Array<[number, number]> = [];
for (let wQ = 2; wQ <= 5; wQ++) {
  for (let wR = 1; wR <= 5; wR++) {
    const z1 = wQ + wR;
    const z2 = 2 * wQ + wR;
    if (z1 >= 4 && z2 <= MAX_COUNT) NEARLY_EQUAL.push([wQ, wR]);
  }
}

/** 1 Q + 1 R = z₁ C e 2 Q + 1 R = z₂ C → la differenza dice quanto vale Q */
function d3Difference(rng: Rng): Built {
  const [Q, R, C] = pickN(rng, SHAPES, 3);
  const QEn = shapeEn(Q);
  const CEn = shapeEn(C);
  const [cQ, cR, cC] = pickN(rng, COLORS, 3);
  const [wQ, wR] = pick(rng, NEARLY_EQUAL);
  const m = randInt(rng, 1, 2);
  const z1 = wQ + wR;
  const z2 = 2 * wQ + wR;
  const w: Weights = new Map([
    [Q.shape, wQ],
    [R.shape, wR],
    [C.shape, 1],
  ]);
  // stesso ordine dei gruppi e stesso lato sulle due bilance: il pezzo in più
  // si vede subito solo se le due righe sono incolonnate
  const qFirst = chance(rng, 0.5);
  const row = (n: number) => (qFirst ? [g(Q, cQ, n), g(R, cR, 1)] : [g(R, cR, 1), g(Q, cQ, n)]);
  const mixedLeft = chance(rng, 0.5);
  const scales = mixedLeft
    ? [eqScaleLeft(w, row(1), [g(C, cC, z1)]), eqScaleLeft(w, row(2), [g(C, cC, z2)])]
    : [eqScaleLeft(w, [g(C, cC, z1)], row(1)), eqScaleLeft(w, [g(C, cC, z2)], row(2))];
  const qui = mixedLeft ? 'a sinistra' : 'a destra';
  const là = mixedLeft ? 'a destra' : 'a sinistra';
  const hereEn = mixedLeft ? 'on the left' : 'on the right';
  const thereEn = mixedLeft ? 'on the right' : 'on the left';
  const answer = m * wQ;
  const step =
    m === 1 ? '' : ` ${cnt(m, Q)} valgono il doppio: ${m}×${wQ} = ${cnt(answer, C)}.`;
  const stepEn =
    m === 1 ? '' : ` ${cntEn(m, QEn)} ${valEn(m)} twice as much: ${m}×${wQ} = ${cntEn(answer, CEn)}.`;
  return {
    scales,
    prompt: `${C.quanti} ${C.plural} valgono ${m === 1 ? UNO(Q) : cnt(m, Q)}?`,
    promptEn: `How many ${CEn.plural} ${auxEn(m)} ${m === 1 ? ONE_EN(QEn) : cntEn(m, QEn)} worth?`,
    answer,
    wrong: [m * wR, wQ, m * z1, wQ + wR, answer + 1, answer - 1],
    explanation:
      `Le due bilance sono quasi uguali: la seconda ha ${uno(Q)} in più ${qui}, ` +
      `e ${là} ha ${cnt(wQ, C)} in più (${z2} invece di ${z1}). ` +
      `Quel pezzo in più è tutta la differenza: ${uno(Q)} ${val(1)} ${cnt(wQ, C)}.${step}`,
    explanationEn:
      `The two scales are almost equal: the second one has an extra ${QEn.name} ${hereEn}, ` +
      `and ${thereEn} it has ${wQ} extra ${CEn.plural} (${z2} instead of ${z1}). ` +
      `That extra piece is the whole difference: ${oneEn(QEn)} ${valEn(1)} ${cntEn(wQ, CEn)}.${stepEn}`,
  };
}

/** p A = p·u B, 1 B = c C → "quante C valgono in tutto m A e n B?" */
function d3MixedTotal(rng: Rng): Built {
  const [A, B, C] = pickN(rng, SHAPES, 3);
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const [cA, cB, cC] = pickN(rng, COLORS, 3);
  const p = randInt(rng, 2, 3);
  const u = randInt(rng, 2, Math.floor(6 / p));
  const m = randInt(rng, 2, 3);
  const n = randInt(rng, 1, 3);
  const midB = m * u + n; // tutto convertito in B
  // la C è la valuta piccola: tengo il totale sotto il muro dei numeri grandi
  const c = midB * 3 <= 24 ? randInt(rng, 2, 3) : 2;
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
    promptEn: `How many ${CEn.plural} are ${cntEn(m, AEn)} and ${cntEn(n, BEn)} worth in total?`,
    answer,
    // errori tipici: saltare la divisione, fermarsi alla valuta di mezzo,
    // dimenticare un pezzo, mescolare le due valute
    wrong: [(m * p * u + n) * c, midB, m * u * c, (u + n) * c, m * u + n * c, answer + c, answer - c],
    explanation:
      `${cnt(p, A)} valgono ${cnt(p * u, B)}, quindi ${uno(A)} ${val(1)} ${p * u}÷${p} = ${cnt(u, B)}. ` +
      `Allora ${cnt(m, A)} valgono ${m}×${u} = ${m * u} ${B.plural}, che con ${cnt(n, B)} fanno ${cnt(midB, B)}. ` +
      `Infine ${cnt(1, B)} ${val(1)} ${cnt(c, C)}: ${midB}×${c} = ${cnt(answer, C)}.`,
    explanationEn:
      `${cntEn(p, AEn)} ${valEn(p)} ${cntEn(p * u, BEn)}, so ${oneEn(AEn)} is worth ${p * u}÷${p} = ${cntEn(u, BEn)}. ` +
      `So ${cntEn(m, AEn)} ${valEn(m)} ${m}×${u} = ${m * u} ${BEn.plural}; add ${cntEn(n, BEn)} and that's ${cntEn(midB, BEn)}. ` +
      `Finally, ${cntEn(1, BEn)} ${valEn(1)} ${cntEn(c, CEn)}: ${midB}×${c} = ${cntEn(answer, CEn)}.`,
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
  const AEn = shapeEn(A);
  const BEn = shapeEn(B);
  const CEn = shapeEn(C);
  const DEn = shapeEn(D);
  const [cA, cB, cC, cD] = pickN(rng, COLORS, 4);
  const [a, v, c] = pick(rng, DEEP_TRIPLES);
  const b = randInt(rng, 2, Math.floor(6 / v)); // b·v pezzi sul piatto: max 6
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
    promptEn: `How many ${AEn.plural} ${auxEn(N)} ${N} ${DEn.plural} worth?`,
    answer: m,
    wrong: [m + 1, unit, a * m, a * v * m, N - unit],
    explanation:
      `La bilancia con ${cnt(b, B)} va semplificata: ${cnt(b, B)} valgono ${cnt(b * v, C)}, cioè ` +
      `${cnt(1, B)} ${val(1)} ${cnt(v, C)}. Allora ${cnt(1, A)} = ${cnt(a, B)} = ` +
      `${cnt(a * v, C)} = ${cnt(unit, D)}. Infine ${N}÷${unit} = ${cnt(m, A)}.`,
    explanationEn:
      `The scale with ${cntEn(b, BEn)} needs simplifying: ${cntEn(b, BEn)} ${valEn(b)} ${cntEn(b * v, CEn)}, meaning ` +
      `${cntEn(1, BEn)} ${valEn(1)} ${cntEn(v, CEn)}. So ${cntEn(1, AEn)} = ${cntEn(a, BEn)} = ` +
      `${cntEn(a * v, CEn)} = ${cntEn(unit, DEn)}. Finally, ${N}÷${unit} = ${cntEn(m, AEn)}.`,
  };
}

// ---------------------------------------------------------------------------

const D1 = [d1Mul, d1Div, d1ChainDown, d1ChainUp, d1Sum];
const D2 = [d2Chain3Down, d2Chain3Up, d2ChainDiv, d2Combo, d2SumMul];
const D3 = [d3Bridge, d3BridgeUp, d3Difference, d3MixedTotal, d3DeepUp];

export function genWeights(rng: Rng, difficulty: Difficulty): Question {
  const variants = difficulty === 1 ? D1 : difficulty === 2 ? D2 : D3;
  return retry(() => finish(rng, difficulty, pick(rng, variants)(rng)));
}
