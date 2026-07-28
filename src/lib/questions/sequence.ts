// Generatore "sequence": una fila di figure con una cella incognita ("quale
// figura continua/completa la sequenza?").
// Difficoltà 1: una regola sola (la vede un bambino di 10 anni). 2: due regole
// combinate o una regola sottile. 3: regole accelerate/sfasate/intrecciate.
// Famiglie di regole: rotazione (fissa, accelerata, a verso alternato), numero
// di figure, dimensione (crescente o oscillante), ciclo di colori, ciclo di
// forme (3), scala dei lati (triangolo→quadrato→pentagono→esagono), ciclo di
// riempimenti (pieno/vuoto/metà), coppia di figure che si scambia
// posto/colore/riempimento. La fila è lunga 4 o 5 celle e il "?" può stare
// anche in mezzo (allora la domanda è "quale figura manca?").
// I distrattori violano UNA regola in modo plausibile (un passo indietro, un
// passo di troppo, verso opposto, attributo copiato dalla cella vicina), mai a
// caso; sono deduplicati anche a livello VISIVO (rotazioni equivalenti per
// simmetria della forma), così le tre opzioni non si somigliano mai.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { COLOR_NAMES } from '../colors';
import { normRot, placeChoices, retry } from './qutils';

type Fill = 'solid' | 'outline' | 'half';

const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];
const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
/** forme ben distinguibili a colpo d'occhio: buone per i cicli di forme */
const CYCLE: ShapeName[] = ['circle', 'square', 'triangle', 'star', 'heart', 'cross', 'moon', 'hexagon'];
/** poligoni con 3, 4, 5, 6 lati */
const SIDES: ShapeName[] = ['triangle', 'square', 'pentagon', 'hexagon'];
const NSIDES: Partial<Record<ShapeName, number>> = { triangle: 3, square: 4, pentagon: 5, hexagon: 6 };
const STEPS = [45, 90, 135];
const DEFAULT_LEN = 5; // 4 celle visibili + 1 incognita in fondo

/** angolo di simmetria: due rotazioni che differiscono di questo valore sono INDISTINGUIBILI */
const SYM: Record<ShapeName, number> = {
  circle: 1,
  dot: 1,
  square: 90,
  diamond: 90,
  triangle: 120,
  star: 72,
  pentagon: 72,
  hexagon: 60,
  cross: 90,
  arrow: 360,
  heart: 360,
  moon: 360,
};

// ---------------------------------------------------------------------------
// Parole (per spiegazioni in italiano corretto)
// ---------------------------------------------------------------------------

interface Word {
  n: string; // singolare
  p: string; // plurale
  un: string; // articolo indeterminativo
  f: boolean; // femminile
}

const W: Record<ShapeName, Word> = {
  circle: { n: 'cerchio', p: 'cerchi', un: 'un', f: false },
  square: { n: 'quadrato', p: 'quadrati', un: 'un', f: false },
  triangle: { n: 'triangolo', p: 'triangoli', un: 'un', f: false },
  diamond: { n: 'rombo', p: 'rombi', un: 'un', f: false },
  star: { n: 'stella', p: 'stelle', un: 'una', f: true },
  pentagon: { n: 'pentagono', p: 'pentagoni', un: 'un', f: false },
  hexagon: { n: 'esagono', p: 'esagoni', un: 'un', f: false },
  arrow: { n: 'freccia', p: 'frecce', un: 'una', f: true },
  heart: { n: 'cuore', p: 'cuori', un: 'un', f: false },
  cross: { n: 'croce', p: 'croci', un: 'una', f: true },
  moon: { n: 'luna', p: 'lune', un: 'una', f: true },
  dot: { n: 'punto', p: 'punti', un: 'un', f: false },
};

/** coppie di colori troppo simili per essere usate insieme in un ciclo */
const CLOSE: number[][] = [
  [0, 6],
  [1, 5],
  [3, 7],
];

const ADJ = {
  pieno: ['pieno', 'piena', 'pieni', 'piene'],
  vuoto: ['vuoto', 'vuota', 'vuoti', 'vuote'],
  meta: ['colorato a metà', 'colorata a metà', 'colorati a metà', 'colorate a metà'],
  ruotato: ['ruotato', 'ruotata', 'ruotati', 'ruotate'],
  piccolo: ['piccolo', 'piccola', 'piccoli', 'piccole'],
  grande: ['grande', 'grande', 'grandi', 'grandi'],
};

function agree(k: keyof typeof ADJ, f: boolean, plural: boolean): string {
  return ADJ[k][(plural ? 2 : 0) + (f ? 1 : 0)];
}

function col(i: number): string {
  return COLOR_NAMES[((i % 8) + 8) % 8];
}

function fillWord(fill: Fill, f = false, plural = false): string {
  return fill === 'solid' ? agree('pieno', f, plural) : fill === 'outline' ? agree('vuoto', f, plural) : agree('meta', f, plural);
}

/** n colori distinti e facili da distinguere tra loro */
function pickColors(rng: Rng, n: number): number[] {
  for (let t = 0; t < 12; t++) {
    const c = pickN(rng, [0, 1, 2, 3, 4, 5, 6, 7], n);
    if (!CLOSE.some(([a, b]) => c.includes(a) && c.includes(b))) return c;
  }
  return pickN(rng, [0, 1, 2, 4], n);
}

// ---------------------------------------------------------------------------
// Regole
// ---------------------------------------------------------------------------

interface PairRule {
  a: ShapeName;
  b: ShapeName;
  ca: number;
  cb: number;
  /** 'pos' = si scambiano di posto; 'color' = si scambiano il colore; 'fill' = si scambiano il riempimento */
  mode: 'pos' | 'color' | 'fill';
  /** i colori restano legati alla POSIZIONE invece che alla figura (variante sottile) */
  colorsFixed?: boolean;
  /** le due figure ruotano anche (usa rotStep) */
  rot?: boolean;
}

interface SeqRules {
  /** ciclo di forme (1 = forma fissa, 2 = alternanza, 3 = ciclo, 4 = scala dei lati) */
  shapes: ShapeName[];
  /** numero di celle della fila (default 5) */
  len?: number;
  /** indice della cella incognita (default: l'ultima) */
  hole?: number;
  /** rotazione: passo fisso, accelerato (rotAccel) o a verso alternato (rotAlt) */
  rotStart?: number;
  rotStep?: number;
  rotAccel?: number; // incremento del passo a ogni cella
  rotAlt?: number; // passo usato nei passaggi dispari (verso alternato)
  /** conteggio di forme nella cella */
  countStart?: number;
  countStep?: number;
  /** le figure ripetute stanno in fila invece che in griglia */
  row?: boolean;
  /** dimensione crescente/decrescente */
  sizeStart?: number;
  sizeStep?: number;
  /** dimensione che oscilla (ciclo esplicito) */
  sizes?: number[];
  /** ciclo colori */
  colors?: number[];
  /** ciclo riempimento */
  fills?: Fill[];
  /** due forme in fila che si scambiano qualcosa a ogni passo */
  pair?: PairRule;
  /** le forme sono la scala dei lati: 1 = crescente, -1 = decrescente */
  sides?: 1 | -1;
}

function lenOf(r: SeqRules): number {
  return r.len ?? DEFAULT_LEN;
}

function holeOf(r: SeqRules): number {
  return r.hole ?? lenOf(r) - 1;
}

function rotAt(r: SeqRules, i: number): number {
  if (r.rotStep === undefined) return 0;
  let rot = r.rotStart ?? 0;
  for (let k = 0; k < i; k++) {
    if (r.rotAccel) rot += r.rotStep + k * r.rotAccel;
    else if (r.rotAlt !== undefined && k % 2 === 1) rot += r.rotAlt;
    else rot += r.rotStep;
  }
  return normRot(rot);
}

function pairCell(r: SeqRules, i: number): CellSpec {
  const p = r.pair as PairRule;
  const sw = i % 2 === 1;
  let first: ShapeSpec;
  let second: ShapeSpec;
  if (p.mode === 'pos') {
    first = { shape: sw ? p.b : p.a, color: p.colorsFixed ? p.ca : sw ? p.cb : p.ca, fillMode: 'solid' };
    second = { shape: sw ? p.a : p.b, color: p.colorsFixed ? p.cb : sw ? p.ca : p.cb, fillMode: 'solid' };
  } else if (p.mode === 'color') {
    first = { shape: p.a, color: sw ? p.cb : p.ca, fillMode: 'solid' };
    second = { shape: p.b, color: sw ? p.ca : p.cb, fillMode: 'solid' };
  } else {
    first = { shape: p.a, color: p.ca, fillMode: sw ? 'outline' : 'solid' };
    second = { shape: p.b, color: p.cb, fillMode: sw ? 'solid' : 'outline' };
  }
  if (p.rot) {
    const rot = rotAt(r, i);
    if (rot) {
      first.rot = rot;
      second.rot = rot;
    }
  }
  return { shapes: [first, second], layout: 'row' };
}

function cellAt(r: SeqRules, i: number): CellSpec {
  if (r.pair) return pairCell(r, i);
  const shape = r.shapes[i % r.shapes.length];
  const rot = rotAt(r, i);
  const count = r.countStart !== undefined ? r.countStart + i * (r.countStep ?? 1) : 1;
  const size = r.sizes
    ? r.sizes[i % r.sizes.length]
    : r.sizeStart !== undefined
      ? +Math.min(1, Math.max(0.2, r.sizeStart + i * (r.sizeStep ?? 0))).toFixed(2)
      : undefined;
  const color = r.colors ? r.colors[i % r.colors.length] : 0;
  const fillMode: Fill = r.fills ? r.fills[i % r.fills.length] : 'solid';
  const spec: ShapeSpec = { shape, color, fillMode };
  if (rot) spec.rot = rot;
  if (size !== undefined) spec.size = size;
  const n = Math.max(1, count);
  const shapes = Array.from({ length: n }, () => ({ ...spec }));
  return { shapes, layout: n > 1 ? (r.row ? 'row' : 'grid') : 'auto' };
}

/**
 * Due celle identiche in tutto tranne la rotazione, con un angolo che differisce
 * di pochi gradi (a meno della simmetria della forma): a occhio non si
 * distinguono, quindi non possono stare nella stessa domanda.
 */
function tooClose(a: CellSpec, b: CellSpec): boolean {
  if (a.shapes.length !== b.shapes.length || (a.layout ?? 'auto') !== (b.layout ?? 'auto')) return false;
  for (let i = 0; i < a.shapes.length; i++) {
    const x = a.shapes[i];
    const y = b.shapes[i];
    if (
      x.shape !== y.shape ||
      (x.color ?? 0) !== (y.color ?? 0) ||
      (x.fillMode ?? 'solid') !== (y.fillMode ?? 'solid') ||
      +(x.size ?? 0.8).toFixed(2) !== +(y.size ?? 0.8).toFixed(2)
    )
      return false;
  }
  let minDelta = 360;
  for (let i = 0; i < a.shapes.length; i++) {
    const sym = SYM[a.shapes[i].shape] ?? 360;
    const d = normRot((a.shapes[i].rot ?? 0) - (b.shapes[i].rot ?? 0)) % sym;
    minDelta = Math.min(minDelta, Math.min(d, sym - d));
  }
  // delta 0 = celle davvero identiche (i cicli le prevedono): va bene
  return minDelta > 0 && minDelta < 20;
}

/** chiave VISIVA della cella: due celle con la stessa chiave si vedono identiche */
function visualKey(c: CellSpec): string {
  return JSON.stringify([
    c.layout ?? 'auto',
    c.shapes.map((s) => [
      s.shape,
      normRot(s.rot ?? 0) % (SYM[s.shape] ?? 360),
      +(s.size ?? 0.8).toFixed(2),
      s.color ?? 0,
      s.fillMode ?? 'solid',
      !!s.flip,
    ]),
  ]);
}

// ---------------------------------------------------------------------------
// Distrattori: la cella corretta con UNA regola violata in modo plausibile
// ---------------------------------------------------------------------------

type Attr = 'shape' | 'rot' | 'size' | 'color' | 'fillMode';

/** cella corretta con un attributo copiato da una cella vicina (regola dimenticata) */
function withAttr(c: CellSpec, attr: Attr, from: ShapeSpec): CellSpec {
  const shapes = c.shapes.map((s) => {
    const t: ShapeSpec = { ...s };
    if (attr === 'shape') t.shape = from.shape;
    else if (attr === 'rot') {
      if (from.rot === undefined) delete t.rot;
      else t.rot = from.rot;
    } else if (attr === 'size') {
      if (from.size === undefined) delete t.size;
      else t.size = from.size;
    } else if (attr === 'color') t.color = from.color;
    else t.fillMode = from.fillMode;
    return t;
  });
  return { ...c, shapes };
}

function withCount(c: CellSpec, n: number): CellSpec {
  if (n < 1 || n > 9) return c;
  return {
    shapes: Array.from({ length: n }, () => ({ ...c.shapes[0] })),
    layout: n > 1 ? (c.layout === 'row' ? 'row' : 'grid') : 'auto',
  };
}

/** scambi "a metà": errori tipici di chi non capisce cosa si scambia */
function pairDistractors(c: CellSpec): CellSpec[] {
  const [x, y] = c.shapes;
  return [
    { ...c, shapes: [{ ...y, color: x.color }, { ...x, color: y.color }] }, // le forme si scambiano, i colori restano fermi
    { ...c, shapes: [{ ...y }, { ...x }] }, // scambio totale (forma + colore)
    { ...c, shapes: [{ ...x, fillMode: y.fillMode }, { ...y, fillMode: x.fillMode }] }, // scambio dei riempimenti
    { ...c, shapes: [{ ...x }, { ...y, color: x.color }] }, // stesso colore per entrambe
    { ...c, shapes: [{ ...x, color: y.color }, { ...y }] },
  ];
}

function candidates(r: SeqRules): CellSpec[] {
  const hole = holeOf(r);
  const correct = cellAt(r, hole);
  const prev = cellAt(r, hole - 1);
  const next = cellAt(r, hole + 1);
  const out: CellSpec[] = [prev, next];
  if (r.pair) {
    out.push(...pairDistractors(correct));
  } else {
    for (const src of [prev, next]) {
      for (const attr of ['shape', 'rot', 'size', 'color', 'fillMode'] as Attr[]) {
        out.push(withAttr(correct, attr, src.shapes[0]));
      }
      if (src.shapes.length !== correct.shapes.length) out.push(withCount(correct, src.shapes.length));
    }
    if (r.countStart !== undefined) {
      const n = correct.shapes.length;
      out.push(withCount(correct, n + 1), withCount(correct, n - 1));
    }
    if (r.rotStep !== undefined) {
      // verso opposto
      out.push(cellAt({ ...r, rotStep: -r.rotStep, rotAlt: r.rotAlt === undefined ? undefined : -r.rotAlt }, hole));
      // passo costante invece che crescente
      if (r.rotAccel) out.push(cellAt({ ...r, rotAccel: 0 }, hole));
      // sempre lo stesso verso invece di alternarlo
      if (r.rotAlt !== undefined) out.push(cellAt({ ...r, rotAlt: r.rotStep }, hole));
      // passo misurato male: doppio o metà
      if (!r.rotAccel && r.rotAlt === undefined) {
        out.push(cellAt({ ...r, rotStep: r.rotStep * 2 }, hole));
        if (r.rotStep % 90 === 0) out.push(cellAt({ ...r, rotStep: r.rotStep / 2 }, hole));
      }
    }
  }
  // niente celle vuote né affollate: restano leggibili anche in miniatura
  return out.filter((c) => c.shapes.length > 0 && c.shapes.length <= 10);
}

// ---------------------------------------------------------------------------
// Spiegazione
// ---------------------------------------------------------------------------

function cycleText(shapes: ShapeName[]): string {
  return shapes.map((s) => W[s].n).join(' → ') + ' → ' + W[shapes[0]].n;
}

/** "90° in senso orario" / "45° in senso antiorario" */
function turn(deg: number): string {
  return `${Math.abs(deg)}° in senso ${deg >= 0 ? 'orario' : 'antiorario'}`;
}

/** frase finale: che cosa va al posto del "?" */
function finale(r: SeqRules): string {
  const hole = holeOf(r);
  const c = cellAt(r, hole);
  if (r.pair) {
    const [x, y] = c.shapes;
    const wx = W[x.shape];
    const wy = W[y.shape];
    const one = (s: ShapeSpec, w: Word) =>
      `${w.un} ${w.n} di colore ${col(s.color ?? 0)}` + (r.pair?.mode === 'fill' ? `, ${fillWord(s.fillMode as Fill, w.f)},` : '');
    return `Quindi al posto del ? ci vuole ${one(x, wx)} a sinistra e ${one(y, wy)} a destra.`;
  }
  const s = c.shapes[0];
  const n = c.shapes.length;
  const w = W[s.shape];
  const bits: string[] = [n > 1 ? `${n} ${w.p}` : `${w.un} ${w.n}`];
  if (r.colors && r.colors.length > 1) bits.push(`di colore ${col(s.color ?? 0)}`);
  if (r.fills && r.fills.length > 1) bits.push(fillWord(s.fillMode as Fill, w.f, n > 1));
  if (r.sizes && r.sizes.length > 1) bits.push(agree((s.size ?? 0.8) >= 0.7 ? 'grande' : 'piccolo', w.f, n > 1));
  else if (r.sizeStart !== undefined) bits.push(`ancora più ${agree((r.sizeStep ?? 0) > 0 ? 'grande' : 'piccolo', w.f, n > 1)}`);
  if (r.rotStep !== undefined) {
    const back = r.rotStep < 0 && r.rotAlt === undefined && !r.rotAccel;
    const delta = normRot(back ? rotAt(r, 0) - rotAt(r, hole) : rotAt(r, hole) - rotAt(r, 0));
    bits.push(
      delta === 0
        ? `${agree('ruotato', w.f, n > 1)} come nella prima cella (il giro è completo)`
        : `${agree('ruotato', w.f, n > 1)} di ${delta}°${back ? ' in senso antiorario' : ''} rispetto alla prima cella`
    );
  }
  return `Quindi al posto del ? ${n > 1 ? 'ci vogliono' : 'ci vuole'} ${bits.join(', ')}.`;
}

function describe(r: SeqRules): string {
  const parts: string[] = [];
  if (r.pair) {
    const p = r.pair;
    const na = W[p.a].n;
    const nb = W[p.b].n;
    if (p.mode === 'pos')
      parts.push(
        p.colorsFixed
          ? `${na} e ${nb} si scambiano di posto a ogni passo, ma i colori restano fermi (a sinistra sempre ${col(p.ca)}, a destra sempre ${col(p.cb)})`
          : `${na} e ${nb} si scambiano di posto a ogni passo, ognuno con il suo colore`
      );
    else if (p.mode === 'color') parts.push(`${na} e ${nb} restano al loro posto e si scambiano il colore a ogni passo`);
    else parts.push(`${na} e ${nb} si scambiano il riempimento a ogni passo (a turno una è piena e l'altra è vuota)`);
    if (p.rot && r.rotStep !== undefined) parts.push(`intanto tutte e due ruotano di ${turn(r.rotStep)} a ogni passo`);
  } else {
    if (r.sides) {
      parts.push(
        `il numero di lati ${r.sides > 0 ? 'cresce' : 'cala'} di uno a ogni passo (${r.shapes
          .map((s) => `${W[s].n} ${NSIDES[s]}`)
          .join(', ')} lati)`
      );
    } else if (r.shapes.length === 3) parts.push(`le forme girano in ciclo di 3: ${cycleText(r.shapes)}`);
    else if (r.shapes.length === 2) parts.push(`le due forme si alternano: ${cycleText(r.shapes)}`);
    if (r.rotStep !== undefined) {
      if (r.rotAccel) parts.push(`la rotazione aumenta a ogni passo (+${r.rotStep}°, poi +${r.rotStep + r.rotAccel}°, …)`);
      else if (r.rotAlt !== undefined)
        parts.push(`la rotazione cambia verso a ogni passo: prima ${turn(r.rotStep)}, poi ${turn(r.rotAlt)}, poi di nuovo ${turn(r.rotStep)}, e così via`);
      else parts.push(`la figura ruota di ${turn(r.rotStep)} a ogni passo`);
    }
    if (r.countStart !== undefined)
      parts.push(`il numero di figure ${(r.countStep ?? 1) > 0 ? 'cresce' : 'cala'} di ${Math.abs(r.countStep ?? 1)} a ogni passo`);
    if (r.sizes && r.sizes.length > 1) parts.push(`la dimensione oscilla (grande, piccola, grande, piccola)`);
    else if (r.sizeStart !== undefined) parts.push(`la dimensione ${(r.sizeStep ?? 0) > 0 ? 'cresce' : 'diminuisce'} regolarmente`);
    if (r.colors && r.colors.length > 1)
      parts.push(
        `i colori si ripetono in ciclo di ${r.colors.length} (${r.colors.map(col).join(' → ')} → ${col(r.colors[0])})`
      );
    if (r.fills && r.fills.length > 1)
      parts.push(
        r.fills.length === 2
          ? `pieno e vuoto si alternano`
          : `il riempimento gira in ciclo di 3 (${r.fills.map((f) => fillWord(f)).join(' → ')} → ${fillWord(r.fills[0])})`
      );
  }
  return 'Regola: ' + parts.join('; ') + '. ' + finale(r);
}

// ---------------------------------------------------------------------------
// Famiglie di regole per difficoltà
// ---------------------------------------------------------------------------

type Fam = (rng: Rng) => SeqRules;

/**
 * Decorazioni COSTANTI su tutta la fila (riempimento e dimensione fissi): non
 * aggiungono nessuna regola da indovinare, cambiano solo l'aspetto — servono a
 * far sembrare diverse due domande con la stessa regola.
 */
function decoFill(rng: Rng, allowHalf = true): Partial<SeqRules> {
  const f = pick(rng, (allowHalf ? ['solid', 'solid', 'outline', 'half'] : ['solid', 'solid', 'outline']) as Fill[]);
  return f === 'solid' ? {} : { fills: [f] };
}

function decoSize(rng: Rng): Partial<SeqRules> {
  const s = pick(rng, [0, 0, 0.65, 0.95]);
  return s ? { sizes: [s] } : {};
}

function deco(rng: Rng, allowHalf = true): Partial<SeqRules> {
  return { ...decoFill(rng, allowHalf), ...decoSize(rng) };
}

function sidesRules(rng: Rng, extra: Partial<SeqRules> = {}): SeqRules {
  const asc = chance(rng, 0.5);
  return {
    shapes: asc ? [...SIDES] : [...SIDES].reverse(),
    sides: asc ? 1 : -1,
    len: 4,
    hole: randInt(rng, 1, 3),
    colors: [randInt(rng, 0, 7)],
    ...extra,
  };
}

function fills3(rng: Rng): Fill[] {
  return shuffle(rng, ['solid', 'outline', 'half'] as Fill[]);
}

const D1: Fam[] = [
  // rotazione a passo fisso, in senso orario o antiorario
  (rng) => ({
    shapes: [pick(rng, ROTATABLE)],
    rotStart: pick(rng, [0, 45, 90, 135]),
    rotStep: pick(rng, STEPS) * (chance(rng, 0.5) ? 1 : -1),
    colors: [randInt(rng, 0, 7)],
    len: pick(rng, [4, 5]),
    ...deco(rng, false),
  }),
  // numero di figure crescente (in griglia)
  (rng) => ({
    shapes: [pick(rng, PLAIN)],
    countStart: randInt(rng, 1, 2),
    countStep: 1,
    len: pick(rng, [4, 5]),
    colors: [randInt(rng, 0, 7)],
    ...deco(rng),
  }),
  // dimensione crescente o calante
  (rng) => {
    const up = chance(rng, 0.6);
    const step = pick(rng, [0.1, 0.12, 0.15]);
    return {
      shapes: [pick(rng, PLAIN)],
      sizeStart: up ? pick(rng, [0.25, 0.3, 0.35]) : pick(rng, [0.9, 0.95]),
      sizeStep: up ? step : -step,
      len: pick(rng, [4, 5]),
      colors: [randInt(rng, 0, 7)],
      ...decoFill(rng),
    };
  },
  // colore e riempimento che si alternano
  (rng) => ({ shapes: [pick(rng, PLAIN)], colors: pickColors(rng, 2), fills: shuffle(rng, ['solid', 'outline'] as Fill[]), ...decoSize(rng) }),
  // (a) ciclo di 3 forme: cerchio → quadrato → triangolo → cerchio …
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), colors: [randInt(rng, 0, 7)], ...deco(rng) }),
  // (b) scala dei lati: triangolo, quadrato, pentagono, esagono (buco anche in mezzo)
  (rng) => sidesRules(rng, deco(rng)),
  // numero di figure crescente, disposte in fila (max 5 per restare leggibili)
  (rng) => ({
    shapes: [pick(rng, PLAIN)],
    countStart: 1,
    countStep: 1,
    row: true,
    len: pick(rng, [4, 5]),
    colors: [randInt(rng, 0, 7)],
    ...deco(rng),
  }),
  // numero di figure calante
  (rng) => {
    const len = pick(rng, [4, 5]);
    const countStart = len === 4 ? pick(rng, [5, 6]) : pick(rng, [6, 7]);
    return {
      shapes: [pick(rng, PLAIN)],
      countStart,
      countStep: -1,
      len,
      row: countStart <= 5,
      colors: [randInt(rng, 0, 7)],
      ...deco(rng),
    };
  },
  // (d) due figure che si scambiano posto / colore / riempimento
  (rng) => {
    const [a, b] = pickN(rng, CYCLE, 2);
    const [ca, cb] = pickColors(rng, 2);
    return { shapes: [a], pair: { a, b, ca, cb, mode: pick(rng, ['pos', 'color', 'fill'] as const) } };
  },
  // (f) ciclo di riempimenti di 3: pieno → vuoto → metà → pieno …
  (rng) => ({ shapes: [pick(rng, PLAIN)], colors: [randInt(rng, 0, 7)], fills: fills3(rng), ...decoSize(rng) }),
  // ciclo di colori di 3
  (rng) => ({ shapes: [pick(rng, PLAIN)], colors: pickColors(rng, 3), ...deco(rng) }),
  // due forme che si alternano
  (rng) => ({ shapes: pickN(rng, CYCLE, 2), colors: [randInt(rng, 0, 7)], ...deco(rng) }),
];

const D2: Fam[] = [
  // rotazione + ciclo di colori
  (rng) => ({ shapes: [pick(rng, ROTATABLE)], rotStart: 0, rotStep: pick(rng, STEPS), colors: pickColors(rng, 2), ...deco(rng, false) }),
  // forme alternate + numero crescente
  (rng) => ({ shapes: pickN(rng, PLAIN, 2), countStart: 1, countStep: 1, colors: [randInt(rng, 0, 7)], ...deco(rng) }),
  // rotazione + dimensione crescente
  (rng) => ({
    shapes: [pick(rng, ROTATABLE)],
    rotStart: 0,
    rotStep: pick(rng, STEPS) * (chance(rng, 0.5) ? 1 : -1),
    sizeStart: 0.35,
    sizeStep: pick(rng, [0.1, 0.14]),
    colors: [randInt(rng, 0, 7)],
    ...decoFill(rng, false),
  }),
  // rotazione + pieno/vuoto
  (rng) => ({
    shapes: [pick(rng, ROTATABLE)],
    rotStart: pick(rng, [0, 45]),
    rotStep: 45,
    rotAccel: 0,
    colors: [randInt(rng, 0, 7)],
    fills: shuffle(rng, ['solid', 'outline'] as Fill[]),
    ...decoSize(rng),
  }),
  // (a) ciclo di 3 forme + ciclo di 2 colori (sfasati: il motivo si ripete ogni 6)
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), colors: pickColors(rng, 2), ...deco(rng) }),
  // (b) scala dei lati + pieno/vuoto
  (rng) => sidesRules(rng, { fills: shuffle(rng, ['solid', 'outline'] as Fill[]), ...decoSize(rng) }),
  // (c) dimensione che oscilla + forme alternate
  (rng) => ({ shapes: pickN(rng, CYCLE, 2), sizes: chance(rng, 0.5) ? [0.9, 0.5] : [0.5, 0.9], colors: [randInt(rng, 0, 7)], ...decoFill(rng) }),
  // (d) le figure si scambiano di posto ma i colori restano fermi (sottile)
  (rng) => {
    const [a, b] = pickN(rng, CYCLE, 2);
    const [ca, cb] = pickColors(rng, 2);
    return { shapes: [a], pair: { a, b, ca, cb, mode: 'pos' as const, colorsFixed: true } };
  },
  // (e) rotazione che alterna il verso: +90°, −45°, +90°, −45° …
  (rng) => {
    const [s, alt] = pick(rng, [
      [90, -45],
      [135, -45],
      [90, -135],
      [45, -90],
      [135, -90],
      [-90, 45],
    ] as const);
    return { shapes: [pick(rng, ROTATABLE)], rotStart: 0, rotStep: s, rotAlt: alt, colors: [randInt(rng, 0, 7)], ...deco(rng, false) };
  },
  // (f) ciclo di riempimenti di 3 + numero crescente
  (rng) => ({ shapes: [pick(rng, PLAIN)], countStart: 1, countStep: 1, fills: fills3(rng), colors: [randInt(rng, 0, 7)], ...decoSize(rng) }),
  // rotazione + dimensione che oscilla
  (rng) => ({ shapes: [pick(rng, ROTATABLE)], rotStart: 0, rotStep: pick(rng, [45, 90, -45, -90]), sizes: [0.9, 0.55], colors: [randInt(rng, 0, 7)], ...decoFill(rng, false) }),
  // forme alternate + ciclo di 3 colori (sfasati)
  (rng) => ({ shapes: pickN(rng, CYCLE, 2), colors: pickColors(rng, 3), ...deco(rng) }),
  // ciclo di 3 forme in fila, numero crescente
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), countStart: 1, countStep: 1, row: true, len: pick(rng, [4, 5]), colors: [randInt(rng, 0, 7)], ...deco(rng) }),
  // scala dei lati + ciclo di 2 colori
  (rng) => sidesRules(rng, { colors: pickColors(rng, 2), ...deco(rng) }),
];

const D3: Fam[] = [
  // rotazione accelerata
  (rng) => ({ shapes: [pick(rng, ROTATABLE)], rotStart: 0, rotStep: 45, rotAccel: 45, colors: [randInt(rng, 0, 7)], ...deco(rng, false) }),
  // rotazione + ciclo di 3 colori + pieno/vuoto
  (rng) => ({
    shapes: [pick(rng, ROTATABLE)],
    rotStart: 0,
    rotStep: pick(rng, [45, 90, -45, -90]),
    rotAccel: 0,
    colors: pickColors(rng, 3),
    fills: shuffle(rng, ['solid', 'outline'] as Fill[]),
    ...decoSize(rng),
  }),
  // forme alternate + numero a passo 2 + colori alternati
  (rng) => ({ shapes: pickN(rng, PLAIN, 2), countStart: 2, countStep: 2, colors: pickColors(rng, 2), ...deco(rng) }),
  // ciclo di 3 forme + pieno/vuoto (sfasati: motivo lungo 6)
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), colors: [randInt(rng, 0, 7)], fills: shuffle(rng, ['solid', 'outline'] as Fill[]), ...decoSize(rng) }),
  // ciclo di 3 forme che ruotano
  (rng) => ({ shapes: shuffle(rng, [...ROTATABLE]), rotStart: 0, rotStep: pick(rng, [45, 90, -45, -90]), colors: [randInt(rng, 0, 7)], ...deco(rng, false) }),
  // scala dei lati + ciclo di 3 colori + pieno/vuoto
  (rng) => sidesRules(rng, { colors: pickColors(rng, 3), fills: shuffle(rng, ['solid', 'outline'] as Fill[]), ...decoSize(rng) }),
  // rotazione a verso alternato + numero crescente
  (rng) => ({
    shapes: [pick(rng, ROTATABLE)],
    rotStart: 0,
    rotStep: pick(rng, [90, 135]),
    rotAlt: pick(rng, [-45, -90]),
    countStart: 1,
    countStep: 1,
    len: pick(rng, [4, 5]),
    colors: [randInt(rng, 0, 7)],
    ...deco(rng, false),
  }),
  // rotazione accelerata + ciclo di 3 colori
  (rng) => ({ shapes: [pick(rng, ROTATABLE)], rotStart: 0, rotStep: pick(rng, [45, 90]), rotAccel: 45, colors: pickColors(rng, 3), ...decoSize(rng) }),
  // coppia che si scambia di posto E ruota
  (rng) => {
    const [a, b] = pickN(rng, ROTATABLE, 2);
    const [ca, cb] = pickColors(rng, 2);
    return {
      shapes: [a],
      rotStart: 0,
      rotStep: pick(rng, [45, 90, -45, -90]),
      pair: { a, b, ca, cb, mode: 'pos' as const, colorsFixed: chance(rng, 0.5), rot: true },
    };
  },
  // dimensione che oscilla + forme alternate + ciclo di 3 colori
  (rng) => ({ shapes: pickN(rng, CYCLE, 2), sizes: chance(rng, 0.5) ? [0.9, 0.5] : [0.5, 0.9], colors: pickColors(rng, 3), ...decoFill(rng) }),
  // ciclo di 3 forme + numero crescente
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), countStart: 1, countStep: 1, row: chance(rng, 0.5), colors: [randInt(rng, 0, 7)], ...deco(rng) }),
  // ciclo di 3 riempimenti + ciclo di 2 colori (sfasati)
  (rng) => ({ shapes: [pick(rng, PLAIN)], fills: fills3(rng), colors: pickColors(rng, 2), ...decoSize(rng) }),
  // ciclo di 3 forme + pieno/vuoto + dimensione che oscilla (tre motivi sfasati)
  (rng) => ({ shapes: pickN(rng, CYCLE, 3), fills: shuffle(rng, ['solid', 'outline'] as Fill[]), sizes: [0.9, 0.55], colors: [randInt(rng, 0, 7)] }),
  // (d) coppia che si scambia colore o riempimento E intanto ruota
  (rng) => {
    const [a, b] = pickN(rng, ROTATABLE, 2);
    const [ca, cb] = pickColors(rng, 2);
    return {
      shapes: [a],
      rotStart: 0,
      rotStep: pick(rng, [45, 90, -45, -90]),
      pair: { a, b, ca, cb, mode: pick(rng, ['color', 'fill'] as const), rot: true },
    };
  },
];

function buildRules(rng: Rng, difficulty: Difficulty): SeqRules {
  return pick(rng, difficulty === 1 ? D1 : difficulty === 2 ? D2 : D3)(rng);
}

function promptFor(rng: Rng, r: SeqRules): string {
  return holeOf(r) === lenOf(r) - 1
    ? pick(rng, ['Quale figura continua la sequenza?', 'Quale figura viene dopo?', 'Che cosa va al posto del punto interrogativo?'])
    : pick(rng, ['Quale figura completa la sequenza?', 'Quale figura manca nella sequenza?']);
}

export function genSequence(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const rules = buildRules(rng, difficulty);
    const len = lenOf(rules);
    const hole = holeOf(rules);
    const row: CellSpec[] = [];
    for (let i = 0; i < len; i++) {
      row.push(i === hole ? ({ shapes: [], unknown: true } as CellSpec) : cellAt(rules, i));
    }
    const correct = cellAt(rules, hole);

    // distrattori: costruiti, poi deduplicati anche visivamente (rotazioni
    // equivalenti per simmetria) così nessuna opzione somiglia a un'altra
    const seen = new Set<string>([visualKey(correct)]);
    const pool: CellSpec[] = [];
    for (const c of candidates(rules)) {
      const k = visualKey(c);
      if (seen.has(k) || tooClose(c, correct)) continue;
      seen.add(k);
      pool.push(c);
    }
    if (pool.length < 2) throw new Error('distrattori insufficienti');
    const [d1, d2] = pickN(rng, pool, 2);
    if (tooClose(d1, d2)) throw new Error('distrattori indistinguibili');
    // le celle visibili devono essere leggibili una per una
    for (let i = 0; i < row.length; i++)
      for (let j = i + 1; j < row.length; j++) if (tooClose(row[i], row[j])) throw new Error('celle troppo simili');

    const { choices, correctIndex } = placeChoices(rng, { kind: 'cell', cell: correct }, [
      { kind: 'cell', cell: d1 },
      { kind: 'cell', cell: d2 },
    ]);
    return {
      qtype: 'sequence' as const,
      difficulty,
      prompt: promptFor(rng, rules),
      payload: { kind: 'cells' as const, rows: [row], arrows: true },
      choices,
      correctIndex,
      explanation: describe(rules),
    };
  });
}
