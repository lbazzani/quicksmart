// Generatore "mirror": una composizione asimmetrica e la sua immagine ALLO SPECCHIO.
// Il payload mostra una cella (griglia 2×2 o fila di 3) con forme di colori tutti
// diversi; si chiede come appare riflessa. I distrattori sono le ROTAZIONI della
// stessa composizione — l'errore classico di chi confonde "riflettere" con "girare" —
// e le riflessioni "a metà" (sposto le forme ma non le ribalto, o viceversa).
//
// Difficoltà 1: specchio a destra, forme dritte, colori di famiglie diverse.
// 2: specchio a destra con forme direzionali inclinate: conta anche l'angolo.
// 3: specchio sotto (l'acqua di un lago) oppure DOPPIO specchio (destra + sotto =
//    mezzo giro: due riflessioni si annullano). Il distrattore migliore diventa il
//    riflesso nell'asse sbagliato.
//
// LEGGIBILITÀ — il punto delicato di questo tipo. Due opzioni possono avere dati
// diversi e vedersi IDENTICHE, perché ruotare un quadrato di 90°, una stella di
// 72° o un esagono di 60° non si nota. Peggio: differenze come i 36° fra una
// stella dritta e la stessa stella girata di mezzo giro esistono sulla carta ma
// non sullo schermo di un telefono, dove ogni forma è larga ~24 px. Qui sotto la
// somiglianza fra due forme non è un confronto di campi ma una DISTANZA ANGOLARE
// percettiva (shapeDist): sotto i 40° due orientamenti si considerano uguali.
// Su quella distanza poggiano tre regole, tutte verificate prima di accettare la
// domanda:
//   A) le tre opzioni devono essere percettivamente distinte;
//   B) ogni coppia di opzioni deve differire in almeno DUE celle (mai una sola
//      forma a fare da unico indizio);
//   C) almeno DUE forme devono distinguere la risposta giusta da ENTRAMBI i
//      distrattori: guardando solo quelle due si risponde con sicurezza.
// In più: le forme che portano il verso (freccia, luna, cuore, triangolo) sono le
// uniche a essere ruotate; quadrati, stelle, pentagoni, esagoni, croci e cerchi
// restano dritti e fanno da punto di riferimento di colore e posizione, così una
// rotazione non si trasforma mai in un indizio da 18°.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { COLOR_NAMES } from '../colors';
import { pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

// ---------------------------------------------------------------------------
// Algebra delle trasformazioni
// ---------------------------------------------------------------------------
// Il renderer (src/components/visuals.tsx) disegna una forma con
//   <g transform="translate(100 0) scale(-1 1) rotate(rot 50 50)">
// cioè applica PRIMA la rotazione e POI l'eventuale specchio: l'immagine finale è
// M^flip ∘ R(rot). Da qui:
//   specchio a destra (sx↔dx):   M ∘ (M^f R(r)) = M^(1-f) R(r)      → flip, rot invariata
//   specchio sotto (alto↔basso): V = M∘R(180) → M^(1-f) R(r+180)    → flip, rot+180
//   rotazione di θ:              R(θ) ∘ (M^f R(r)) = M^f R(r ± θ)   → segno − se flip

/** elemento [rot, flip] del gruppo di simmetria: lascia la forma identica a sé stessa */
type SymElem = readonly [number, 0 | 1];

const dihedral = (period: number): SymElem[] => {
  const out: SymElem[] = [];
  for (let a = 0; a < 360; a += period) out.push([a, 0], [a, 1]);
  return out;
};

const D4 = dihedral(90);
const D6 = dihedral(60);
const D3 = dihedral(120);
const D5 = dihedral(72);
/** simmetriche rispetto all'asse verticale (puntano in su) */
const AXIS_V: SymElem[] = [[0, 0], [0, 1]];
/** simmetriche rispetto all'asse orizzontale (puntano di lato) */
const AXIS_H: SymElem[] = [[0, 0], [180, 1]];

/**
 * Simmetrie PERCETTIVE dei disegni di visuals.tsx. Non sono quelle esatte al
 * pixel: la stella e il pentagono sono centrati in (50,52) mentre il renderer
 * ruota attorno a (50,50), e il triangolo non è perfettamente equilatero, quindi
 * girarli di 72°/120° li sposta di un paio di px. Su una forma da 24 px quello
 * scarto non si vede: per chi guarda lo schermo sono rotazioni identiche, ed è
 * questo che il generatore deve credere.
 */
const SYM: Record<ShapeName, SymElem[] | 'full'> = {
  circle: 'full',
  dot: 'full',
  square: D4,
  diamond: D4,
  cross: D4,
  hexagon: D6,
  triangle: D3,
  star: D5,
  pentagon: D5,
  heart: AXIS_V,
  arrow: AXIS_H,
  moon: AXIS_H,
};

/** sotto questa differenza angolare due orientamenti si vedono uguali (gradi) */
const TH = 40;

/** angolo ridotto a [0, 180]: quanto "gira" davvero una rotazione */
function absAngle(deg: number): number {
  const d = normRot(deg);
  return d > 180 ? 360 - d : d;
}

/**
 * Distanza percettiva fra due forme disegnate: Infinity se cambia forma, colore o
 * riempimento (differenza lampante), altrimenti di quanti gradi bisogna girare la
 * prima per vedere la seconda, tenendo conto delle simmetrie della forma.
 * Due specifiche con distanza 0 sono lo stesso disegno.
 */
function shapeDist(a: ShapeSpec, b: ShapeSpec): number {
  if (a.shape !== b.shape) return Infinity;
  if ((a.color ?? 0) !== (b.color ?? 0)) return Infinity;
  if ((a.fillMode ?? 'solid') !== (b.fillMode ?? 'solid')) return Infinity;
  const sym = SYM[a.shape];
  if (sym === 'full') return 0;
  const r1 = normRot(a.rot ?? 0);
  const r2 = normRot(b.rot ?? 0);
  const f1: 0 | 1 = a.flip ? 1 : 0;
  const f2: 0 | 1 = b.flip ? 1 : 0;
  const same = f1 === f2;
  // stesso verso → le due immagini differiscono per una rotazione di r1−r2;
  // versi opposti → per una riflessione, che diventa rotazione solo componendola
  // con una simmetria a specchio della forma
  const theta = same ? r1 - r2 : r1 + r2;
  let best = 180;
  for (const [gr, gf] of sym) {
    if (same && gf === 0) best = Math.min(best, absAngle(theta + gr));
    if (!same && gf === 1) best = Math.min(best, absAngle(gr - theta));
  }
  return best;
}

/** true se le due forme, una volta disegnate, si vedono uguali */
function sameLook(a: ShapeSpec, b: ShapeSpec): boolean {
  return shapeDist(a, b) < TH;
}

/** forma normalizzata: chiavi sempre nello stesso ordine, rot 0 e flip falso omessi */
function clean(s: ShapeSpec): ShapeSpec {
  const out: ShapeSpec = { shape: s.shape, color: s.color ?? 0, fillMode: s.fillMode ?? 'solid' };
  const rot = normRot(s.rot ?? 0);
  if (rot) out.rot = rot;
  if (s.flip) out.flip = true;
  return out;
}

// ---------------------------------------------------------------------------
// Composizioni
// ---------------------------------------------------------------------------

/** una composizione dentro una cella: la griglia è quella usata dal renderer */
interface Comp {
  layout: 'grid' | 'row';
  cols: number;
  rows: number;
  /** ordine row-major: [alto-sx, alto-dx, basso-sx, basso-dx] per la 2×2 */
  shapes: ShapeSpec[];
}

function mkComp(layout: 'grid' | 'row', shapes: ShapeSpec[]): Comp {
  const n = shapes.length;
  if (layout === 'row') return { layout, cols: n, rows: 1, shapes };
  const cols = n <= 4 ? 2 : 3; // stessa regola di <Cell> in visuals.tsx
  return { layout, cols, rows: Math.ceil(n / cols), shapes };
}

function sameFrame(a: Comp, b: Comp): boolean {
  return a.layout === b.layout && a.rows === b.rows && a.cols === b.cols;
}

/** celle in cui le due composizioni mostrano qualcosa di visibilmente diverso */
function cues(a: Comp, b: Comp): number {
  if (!sameFrame(a, b)) return 99;
  let n = 0;
  for (let i = 0; i < a.shapes.length; i++) if (!sameLook(a.shapes[i], b.shapes[i])) n++;
  return n;
}

function toCell(c: Comp, label?: string): CellSpec {
  const cell: CellSpec = { shapes: c.shapes.map(clean), layout: c.layout };
  if (label) cell.label = label;
  return cell;
}

// --- trasformazioni delle singole forme ------------------------------------

type ShapeOp = (s: ShapeSpec) => ShapeSpec;

const keep: ShapeOp = (s) => clean(s);
/** ribaltamento sinistra↔destra della singola forma */
const flipV: ShapeOp = (s) => clean({ ...s, flip: !s.flip });
/** capovolgimento alto↔basso della singola forma */
const flipH: ShapeOp = (s) => clean({ ...s, flip: !s.flip, rot: normRot((s.rot ?? 0) + 180) });
const turn = (deg: number): ShapeOp => (s) =>
  clean({ ...s, rot: normRot((s.rot ?? 0) + (s.flip ? -deg : deg)) });

// --- permutazioni delle posizioni ------------------------------------------

/** per ogni posizione di destinazione, l'indice di provenienza */
type PermFn = (rows: number, cols: number) => { rows: number; cols: number; src: number[] };

function build(rows: number, cols: number, from: (r: number, c: number) => number): number[] {
  const src: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) src.push(from(r, c));
  return src;
}

const pKeep: PermFn = (rows, cols) => ({ rows, cols, src: build(rows, cols, (r, c) => r * cols + c) });
const pMirV: PermFn = (rows, cols) => ({ rows, cols, src: build(rows, cols, (r, c) => r * cols + (cols - 1 - c)) });
const pMirH: PermFn = (rows, cols) => ({ rows, cols, src: build(rows, cols, (r, c) => (rows - 1 - r) * cols + c) });
const p180: PermFn = (rows, cols) => ({ rows, cols, src: build(rows, cols, (r, c) => (rows - 1 - r) * cols + (cols - 1 - c)) });
const p90: PermFn = (rows, cols) => ({ rows: cols, cols: rows, src: build(cols, rows, (r, c) => (rows - 1 - c) * cols + r) });
const p270: PermFn = (rows, cols) => ({ rows: cols, cols: rows, src: build(cols, rows, (r, c) => c * cols + (cols - 1 - r)) });

// --- operazioni complete ----------------------------------------------------

type OpName = 'id' | 'mirV' | 'mirH' | 'rot90' | 'rot180' | 'rot270' | 'posV' | 'posH' | 'selfV' | 'selfH';

interface OpDef {
  perm: PermFn;
  shape: ShapeOp;
  /** come si chiama nella spiegazione ("Le altre due risposte sono …") */
  label: string;
}

const OPS: Record<OpName, OpDef> = {
  id: { perm: pKeep, shape: keep, label: 'la figura di partenza, identica' },
  mirV: { perm: pMirV, shape: flipV, label: 'il riflesso nello specchio a destra (destra e sinistra scambiate)' },
  mirH: { perm: pMirH, shape: flipH, label: 'il riflesso nello specchio messo sotto (alto e basso scambiati)' },
  rot90: { perm: p90, shape: turn(90), label: 'la figura girata di un quarto di giro (90°)' },
  rot180: { perm: p180, shape: turn(180), label: 'la figura girata di mezzo giro (180°)' },
  rot270: { perm: p270, shape: turn(270), label: 'la figura girata di tre quarti di giro (270°)' },
  posV: { perm: pMirV, shape: keep, label: 'le forme spostate a specchio ma non ribaltate su sé stesse' },
  posH: { perm: pMirH, shape: keep, label: 'le forme spostate in alto e in basso ma non capovolte' },
  selfV: { perm: pKeep, shape: flipV, label: 'le forme ribaltate su sé stesse ma rimaste al loro posto' },
  selfH: { perm: pKeep, shape: flipH, label: 'le forme capovolte ma rimaste al loro posto' },
};

const ROTATIONS: OpName[] = ['rot90', 'rot180', 'rot270'];
const ALL_OPS = Object.keys(OPS) as OpName[];

/** il renderer ricava le colonne dal numero di forme: 90°/270° servono griglie quadrate */
function renderable(c: Comp, op: OpName): boolean {
  if (op !== 'rot90' && op !== 'rot270') return true;
  return c.layout === 'grid' && c.rows === c.cols;
}

function applyOp(c: Comp, op: OpName): Comp {
  const { perm, shape } = OPS[op];
  const p = perm(c.rows, c.cols);
  return { layout: c.layout, cols: p.cols, rows: p.rows, shapes: p.src.map((i) => shape(c.shapes[i])) };
}

// ---------------------------------------------------------------------------
// Testi italiani
// ---------------------------------------------------------------------------

const SHAPE_IT: Record<ShapeName, string> = {
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
  dot: 'il pallino',
};

/** nomi di colore invariabili, così vanno bene con maschile e femminile */
const COLOR_IT = [...COLOR_NAMES];

/**
 * Famiglie di colore: ciano e blu, rosa e corallo, ambra e arancione sono coppie
 * che a 24 px si confondono. In una stessa figura ne entra al massimo una per
 * famiglia, così il colore resta l'etichetta sicura di ogni forma.
 */
const COLOR_FAMILIES: number[][] = [[0, 6], [1, 5], [2], [3, 7], [4]];

function pickColors(rng: Rng, n: number): number[] {
  const fams = pickN(rng, COLOR_FAMILIES, n);
  return fams.map((f) => pick(rng, f));
}

function nameOf(s: ShapeSpec): string {
  return `${SHAPE_IT[s.shape]} ${COLOR_IT[(s.color ?? 0) % COLOR_IT.length]}`;
}

function posName(c: Comp, i: number): string {
  const r = Math.floor(i / c.cols);
  const col = i % c.cols;
  const h = c.cols === 1 ? '' : col === 0 ? 'a sinistra' : col === c.cols - 1 ? 'a destra' : 'al centro';
  const v = c.rows === 1 ? '' : r === 0 ? 'in alto' : r === c.rows - 1 ? 'in basso' : 'in mezzo';
  if (v && h) return `${v} ${h}`;
  return v || h || 'al centro';
}

// ---------------------------------------------------------------------------
// Costruzione delle composizioni
// ---------------------------------------------------------------------------

/** forme senza un verso riconoscibile: fanno da punto di riferimento, sempre dritte */
const CALM: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'cross'];
/** forme che puntano di lato: allo specchio a destra si vede subito che si girano */
const SIDEWAYS: ShapeName[] = ['arrow', 'moon'];
/** forme "in piedi": si vede subito se qualcuno le capovolge */
const UPRIGHT: ShapeName[] = ['triangle', 'heart'];
/** tutte le forme con un verso inconfondibile: sono le uniche che vengono ruotate */
const TURNED: ShapeName[] = [...SIDEWAYS, ...UPRIGHT];
/** sfondo di default: anche triangolo e cuore, che dritti smascherano un mezzo giro */
const BACKDROP: ShapeName[] = [...CALM, ...UPRIGHT];

const STEPS45 = [0, 45, 90, 135, 180, 225, 270, 315];
const STEPS90 = [0, 90, 180, 270];

interface Plan {
  layout: 'grid' | 'row';
  n: number;
  /** le forme che portano il verso: quante, da quale gruppo, con quali angoli */
  cue: { pool: ShapeName[]; n: number; rots: number[] };
  /** forme di sfondo, sempre dritte (default: BACKDROP) */
  calm?: ShapeName[];
  /** tutte le forme uguali: si distinguono solo per colore e verso */
  repeat?: boolean;
  /** quante forme disegnate solo col contorno */
  outlines?: number;
}

function buildComp(rng: Rng, p: Plan): Comp {
  const colors = pickColors(rng, p.n);
  let names: ShapeName[];
  let rots: number[];
  if (p.repeat) {
    const one = pick(rng, p.cue.pool);
    names = Array.from({ length: p.n }, () => one);
    rots = p.cue.rots.length >= p.n ? pickN(rng, p.cue.rots, p.n) : names.map(() => pick(rng, p.cue.rots));
  } else {
    const turned = pickN(rng, p.cue.pool, p.cue.n);
    const calmPool = (p.calm ?? BACKDROP).filter((s) => !turned.includes(s));
    const still = pickN(rng, calmPool, p.n - p.cue.n);
    const angles =
      p.cue.rots.length >= turned.length
        ? pickN(rng, p.cue.rots, turned.length)
        : turned.map(() => pick(rng, p.cue.rots));
    const mixed = shuffle(rng, [
      ...turned.map((shape, i) => ({ shape, rot: angles[i] })),
      ...still.map((shape) => ({ shape, rot: 0 })),
    ]);
    names = mixed.map((m) => m.shape);
    rots = mixed.map((m) => m.rot);
  }
  const outline = new Set(p.outlines ? pickN(rng, Array.from({ length: p.n }, (_, i) => i), p.outlines) : []);
  const shapes = names.map((shape, i) =>
    clean({ shape, color: colors[i], rot: rots[i], fillMode: outline.has(i) ? 'outline' : 'solid' })
  );
  return mkComp(p.layout, shapes);
}

// ---------------------------------------------------------------------------
// Assemblaggio della domanda
// ---------------------------------------------------------------------------

interface Variant {
  plan: Plan;
  /** la trasformazione richiesta dalla domanda */
  correct: OpName;
  /** i due errori plausibili */
  wrong: [OpName, OpName];
  /** 'direct' = figura → ?  |  'example' = esempio risolto + figura → ? */
  style: 'direct' | 'example';
  prompt: string;
  /** frase che apre la spiegazione */
  rule: string;
  /** verbo usato per il ribaltamento delle singole forme */
  selfWord: string;
  /** etichetta della cella con il punto interrogativo */
  outLabel: string;
}

class Ambiguous extends Error {}

function assemble(rng: Rng, difficulty: Difficulty, v: Variant): Question {
  const src = buildComp(rng, v.plan);
  const right = applyOp(src, v.correct);
  const opts = [right, applyOp(src, v.wrong[0]), applyOp(src, v.wrong[1])];

  // 1) il riflesso deve cambiare davvero qualcosa, e cambiarlo in più punti
  if (cues(src, right) < 2) throw new Ambiguous('la risposta somiglia troppo alla figura di partenza');

  // 2) DEDUP PERCETTIVO + regola dei due indizi: nessuna coppia di opzioni può
  //    vedersi uguale e nessuna può giocarsi su un dettaglio solo
  for (let i = 0; i < opts.length; i++) {
    for (let j = i + 1; j < opts.length; j++) {
      if (cues(opts[i], opts[j]) < 2) throw new Ambiguous('due opzioni si distinguono per meno di due dettagli');
    }
  }

  // 3) due forme "libere": due celle in cui la risposta giusta si stacca da
  //    ENTRAMBI i distrattori. Guardando solo quelle si risponde con sicurezza.
  let solo = 0;
  for (let i = 0; i < right.shapes.length; i++) {
    const a = sameFrame(right, opts[1]) ? sameLook(right.shapes[i], opts[1].shapes[i]) : false;
    const b = sameFrame(right, opts[2]) ? sameLook(right.shapes[i], opts[2].shapes[i]) : false;
    if (!a && !b) solo++;
  }
  if (solo < 2) throw new Ambiguous('un solo dettaglio distingue la risposta giusta');

  // 4) verifica cruciale: una riflessione non deve MAI coincidere con una rotazione,
  //    altrimenti "specchio" e "giro" darebbero la stessa figura e la domanda è ambigua
  if (v.correct === 'mirV' || v.correct === 'mirH') {
    for (const rot of ROTATIONS) {
      if (!renderable(src, rot)) continue;
      if (cues(applyOp(src, rot), right) === 0) throw new Ambiguous('il riflesso coincide con una rotazione');
    }
  }

  const cells = opts.map((c) => toCell(c));
  const rows: CellSpec[][] = [];
  let exSrc: Comp | null = null;

  if (v.style === 'example') {
    exSrc = buildComp(rng, v.plan);
    const exOut = applyOp(exSrc, v.correct);
    // l'esempio deve mostrare il cambiamento a occhio nudo, in almeno due celle
    if (cues(exSrc, exOut) < 2) throw new Ambiguous("l'esempio non mostra abbastanza");
    // l'esempio non deve essere la stessa figura della domanda: regalerebbe la risposta
    if (cues(exSrc, src) === 0) throw new Ambiguous("l'esempio ripete la figura della domanda");
    // l'esempio deve INCHIODARE la regola: ogni trasformazione compatibile con
    // l'esempio deve dare, sulla figura della domanda, la stessa risposta
    for (const op of ALL_OPS) {
      if (op === v.correct || !renderable(exSrc, op) || !renderable(src, op)) continue;
      if (cues(applyOp(exSrc, op), exOut) === 0 && cues(applyOp(src, op), right) > 0) {
        throw new Ambiguous("l'esempio non basta a capire la regola");
      }
    }
    rows.push([toCell(exSrc, 'esempio'), toCell(exOut, v.outLabel)]);
    rows.push([toCell(src, 'e questa?'), { shapes: [], unknown: true, label: v.outLabel }]);
  } else {
    rows.push([toCell(src, 'la figura'), { shapes: [], unknown: true, label: v.outLabel }]);
  }

  const { choices, correctIndex } = placeChoices(rng, { kind: 'cell', cell: cells[0] }, [
    { kind: 'cell', cell: cells[1] },
    { kind: 'cell', cell: cells[2] },
  ]);

  return {
    qtype: 'mirror',
    difficulty,
    prompt: v.prompt,
    payload: {
      kind: 'cells',
      rows,
      arrows: v.style === 'direct',
      analogy: v.style === 'example',
      // le due righe dell'esempio sono due momenti distinti: incorniciate non si
      // leggono per sbaglio come un'unica figura da 4 celle
      groups: v.style === 'example',
    },
    choices,
    correctIndex,
    explanation: explain(v, src, right, exSrc),
  };
}

function explain(v: Variant, src: Comp, out: Comp, example: Comp | null): string {
  const parts: string[] = [];
  if (example) parts.push("Nell'esempio la figura entra nello specchio e ne esce ribaltata.");
  parts.push(v.rule);

  // traccia concreta: due forme che cambiano posto
  const perm = OPS[v.correct].perm(src.rows, src.cols);
  const moves: string[] = [];
  for (let d = 0; d < perm.src.length && moves.length < 2; d++) {
    const s = perm.src[d];
    if (s === d) continue;
    moves.push(`${nameOf(src.shapes[s])} che era ${posName(src, s)} passa ${posName(out, d)}`);
  }
  if (moves.length) parts.push(`Così ${moves.join(' e ')}.`);
  else parts.push('Nessuna forma cambia posto: cambia solo il verso di ognuna.');

  const changed = src.shapes.findIndex((s) => !sameLook(s, OPS[v.correct].shape(s)));
  if (changed >= 0) {
    parts.push(`Anche ogni singola forma ${v.selfWord}: guarda ${nameOf(src.shapes[changed])}.`);
  }

  parts.push(`Le altre due risposte sono ${OPS[v.wrong[0]].label} e ${OPS[v.wrong[1]].label}.`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Testi delle regole
// ---------------------------------------------------------------------------
// Ogni prompt dice DOVE sta lo specchio. "Specchio verticale" è ambiguo: c'è chi
// legge "lo specchio è messo in verticale" (scambia destra e sinistra) e chi
// legge "ribalta in verticale" (scambia alto e basso), e in questo tipo di
// domanda le due letture portano a due opzioni diverse, entrambe presenti.

const PROMPT_V = [
  "Lo specchio è a destra della figura: cosa si vede riflesso?",
  'Metti uno specchio in piedi a destra della figura: quale immagine ci vedi?',
  'La figura si guarda in uno specchio messo a destra: qual è il suo riflesso?',
];
const PROMPT_H = [
  "Lo specchio è sotto la figura, come l'acqua di un lago: qual è il riflesso?",
  'La figura si specchia nell\'acqua, proprio sotto di lei: quale riflesso vedi?',
];
const PROMPT_DOUBLE = [
  'Due specchi di fila: prima quello a destra, poi quello sotto. Che immagine esce alla fine?',
  'La figura si riflette prima nello specchio a destra e poi in quello sotto: come appare alla fine?',
];
const PROMPT_EX_V = [
  "Guarda l'esempio: la figura si riflette nello specchio a destra. Ora tocca alla seconda figura.",
  "Sopra c'è una figura e il suo riflesso nello specchio a destra: qual è il riflesso della seconda?",
];
const PROMPT_EX_H = [
  "Guarda l'esempio: la figura si riflette nell'acqua sotto di lei. Ora tocca alla seconda figura.",
  "Sopra c'è una figura e il suo riflesso nello specchio messo sotto: qual è il riflesso della seconda?",
];

const RULE_V = "Uno specchio messo a destra scambia la destra con la sinistra, ma lascia l'alto in alto.";
const RULE_H = "Uno specchio messo sotto scambia l'alto con il basso, ma lascia la sinistra a sinistra.";
const RULE_DOUBLE =
  'Due riflessioni di fila si annullano a metà: la prima scambia destra e sinistra, la seconda alto e basso, e alla fine la figura risulta girata di mezzo giro (180°).';

const SELF_V = "si ribalta su sé stessa, come se guardasse dall'altra parte";
const SELF_H = 'si capovolge sottosopra';
const SELF_TURN = 'fa mezzo giro su sé stessa';

const OUT_V = 'riflesso';
const OUT_H = 'riflesso';
const OUT_DOUBLE = '2 specchi';

// ---------------------------------------------------------------------------
// Difficoltà 1 — specchio a destra, forme dritte
// ---------------------------------------------------------------------------

function genD1(rng: Rng): Question {
  const kind = randInt(rng, 0, 4);
  if (kind === 0) {
    // griglia 2×2 di forme diverse, dritte: conta solo lo scambio di posto.
    // I tre distrattori hanno tre disposizioni diverse: bastano i colori.
    return assemble(rng, 1, {
      plan: { layout: 'grid', n: 4, cue: { pool: SIDEWAYS, n: 1, rots: [0] }, outlines: randInt(rng, 0, 1) },
      correct: 'mirV',
      wrong: ['rot180', 'mirH'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 1) {
    // due frecce/lune: allo specchio puntano dall'altra parte, e si vede benissimo
    return assemble(rng, 1, {
      plan: { layout: 'grid', n: 4, cue: { pool: SIDEWAYS, n: 2, rots: [0] }, outlines: randInt(rng, 0, 1) },
      correct: 'mirV',
      wrong: ['posV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 2) {
    // fila di 3: l'ordine si rovescia e le due forme di lato si girano
    return assemble(rng, 1, {
      plan: { layout: 'row', n: 3, cue: { pool: SIDEWAYS, n: 2, rots: [0] } },
      correct: 'mirV',
      wrong: ['posV', 'selfV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 3) {
    // 2×2 con una forma in piedi: il mezzo giro la capovolge, lo specchio no
    return assemble(rng, 1, {
      plan: { layout: 'grid', n: 4, cue: { pool: SIDEWAYS, n: 2, rots: [0] }, calm: UPRIGHT },
      correct: 'mirV',
      wrong: ['rot180', 'mirH'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  // esempio risolto + figura nuova: la regola si scopre guardando
  return assemble(rng, 1, {
    plan: { layout: 'grid', n: 4, cue: { pool: SIDEWAYS, n: 2, rots: [0] } },
    correct: 'mirV',
    wrong: ['rot180', 'mirH'],
    style: 'example',
    prompt: pick(rng, PROMPT_EX_V),
    rule: RULE_V,
    selfWord: SELF_V,
    outLabel: OUT_V,
  });
}

// ---------------------------------------------------------------------------
// Difficoltà 2 — specchio a destra con forme inclinate
// ---------------------------------------------------------------------------

function genD2(rng: Rng): Question {
  const kind = randInt(rng, 0, 4);
  const spin: OpName = pick(rng, ['rot90', 'rot270']);
  if (kind === 0) {
    // 2×2 con due forme inclinate: conta anche l'angolo di ognuna
    return assemble(rng, 2, {
      plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
      correct: 'mirV',
      wrong: ['rot180', spin],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 1) {
    // quattro volte la stessa forma: distinguono solo colore e inclinazione
    return assemble(rng, 2, {
      plan: {
        layout: 'grid',
        n: 4,
        cue: { pool: ['arrow', 'moon', 'heart'], n: 4, rots: STEPS45 },
        repeat: true,
      },
      correct: 'mirV',
      wrong: ['posV', spin],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 2) {
    // fila di 3 inclinate: ordine rovesciato E forme ribaltate
    return assemble(rng, 2, {
      plan: { layout: 'row', n: 3, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
      correct: 'mirV',
      wrong: ['posV', 'selfV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  if (kind === 3) {
    // qualche forma solo contornata: un attributo in più da seguire
    return assemble(rng, 2, {
      plan: {
        layout: 'grid',
        n: 4,
        cue: { pool: TURNED, n: 2, rots: STEPS90 },
        outlines: randInt(rng, 1, 2),
      },
      correct: 'mirV',
      wrong: [spin, 'selfV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
      outLabel: OUT_V,
    });
  }
  // esempio risolto, con forme inclinate
  return assemble(rng, 2, {
    plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
    correct: 'mirV',
    wrong: ['rot180', 'mirH'],
    style: 'example',
    prompt: pick(rng, PROMPT_EX_V),
    rule: RULE_V,
    selfWord: SELF_V,
    outLabel: OUT_V,
  });
}

// ---------------------------------------------------------------------------
// Difficoltà 3 — specchio sotto (l'acqua) e doppio specchio
// ---------------------------------------------------------------------------
// Qui la difficoltà sta nella TRASFORMAZIONE, non nel numero di forme: griglie
// più grandi rendevano ogni forma larga 24 px e trasformavano il ragionamento
// spaziale in una caccia alle differenze.

function genD3(rng: Rng): Question {
  const kind = randInt(rng, 0, 5);
  if (kind === 0) {
    // specchio d'acqua su una 2×2 inclinata: il distrattore è l'asse sbagliato
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
      correct: 'mirH',
      wrong: ['mirV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_H),
      rule: RULE_H,
      selfWord: SELF_H,
      outLabel: OUT_H,
    });
  }
  if (kind === 1) {
    // doppio specchio: due riflessioni = mezzo giro
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
      correct: 'rot180',
      wrong: ['mirV', 'mirH'],
      style: 'direct',
      prompt: pick(rng, PROMPT_DOUBLE),
      rule: RULE_DOUBLE,
      selfWord: SELF_TURN,
      outLabel: OUT_DOUBLE,
    });
  }
  if (kind === 2) {
    // tre forme girate su quattro: lo specchio d'acqua contro il "solo spostate"
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 3, rots: STEPS45 } },
      correct: 'mirH',
      wrong: ['posH', 'mirV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_H),
      rule: RULE_H,
      selfWord: SELF_H,
      outLabel: OUT_H,
    });
  }
  if (kind === 3) {
    // fila di 3 nell'acqua: nessuna forma cambia posto, si capovolgono e basta
    return assemble(rng, 3, {
      plan: { layout: 'row', n: 3, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
      correct: 'mirH',
      wrong: ['mirV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_H),
      rule: RULE_H,
      selfWord: SELF_H,
      outLabel: OUT_H,
    });
  }
  if (kind === 4) {
    // esempio risolto con lo specchio d'acqua: la regola va dedotta
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, cue: { pool: TURNED, n: 2, rots: STEPS45 }, outlines: randInt(rng, 0, 1) },
      correct: 'mirH',
      wrong: ['rot180', 'mirV'],
      style: 'example',
      prompt: pick(rng, PROMPT_EX_H),
      rule: RULE_H,
      selfWord: SELF_H,
      outLabel: OUT_H,
    });
  }
  // doppio specchio su una fila
  return assemble(rng, 3, {
    plan: { layout: 'row', n: 3, cue: { pool: TURNED, n: 2, rots: STEPS45 } },
    correct: 'rot180',
    wrong: ['mirV', 'mirH'],
    style: 'direct',
    prompt: pick(rng, PROMPT_DOUBLE),
    rule: RULE_DOUBLE,
    selfWord: SELF_TURN,
    outLabel: OUT_DOUBLE,
  });
}

export function genMirror(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => (difficulty === 1 ? genD1(rng) : difficulty === 2 ? genD2(rng) : genD3(rng)), 60);
}
