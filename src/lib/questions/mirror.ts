// Generatore "mirror": una composizione asimmetrica e la sua immagine ALLO SPECCHIO.
// Il payload mostra una cella (griglia 2×2, 3×2 o fila) con forme di colori tutti
// diversi; si chiede come appare riflessa. I distrattori sono le ROTAZIONI della
// stessa composizione — l'errore classico di chi confonde "riflettere" con "girare" —
// e le riflessioni "a metà" (sposto le forme ma non le ribalto, o viceversa).
//
// Difficoltà 1: specchio verticale, forme e colori molto distinti, nessuna rotazione.
// 2: specchio verticale con forme direzionali ruotate (freccia, luna, triangolo):
//    conta anche l'orientamento di ogni singola forma.
// 3: specchio orizzontale (l'acqua di un lago), composizioni da 6 forme, oppure
//    DOPPIO specchio (verticale + orizzontale = mezzo giro: due riflessioni si
//    annullano). Il distrattore migliore diventa il riflesso nell'asse sbagliato.
//
// Univocità: prima di costruire le opzioni si confrontano le IMMAGINI (non i dati)
// di riflessioni e rotazioni tramite una firma che tiene conto delle simmetrie di
// ogni forma; se il riflesso coincide con una rotazione — o due opzioni si
// vedrebbero identiche — la domanda viene scartata e rigenerata.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

// ---------------------------------------------------------------------------
// Algebra delle trasformazioni
// ---------------------------------------------------------------------------
// Il renderer (src/components/visuals.tsx) disegna una forma con
//   <g transform="translate(100 0) scale(-1 1) rotate(rot 50 50)">
// cioè applica PRIMA la rotazione e POI l'eventuale specchio: l'immagine finale è
// M^flip ∘ R(rot). Da qui:
//   specchio verticale  (sx↔dx):  M ∘ (M^f R(r)) = M^(1-f) R(r)      → flip, rot invariata
//   specchio orizzontale (alto↔basso): V = M∘R(180) → M^(1-f) R(r+180) → flip, rot+180
//   rotazione di θ:      R(θ) ∘ (M^f R(r)) = M^f R(r ± θ)            → segno − se flip

/** elemento [rot, flip] del gruppo di simmetria: lascia la forma identica a sé stessa */
type SymElem = readonly [number, 0 | 1];

const D4: SymElem[] = [
  [0, 0], [90, 0], [180, 0], [270, 0],
  [0, 1], [90, 1], [180, 1], [270, 1],
];
const D6: SymElem[] = [0, 60, 120, 180, 240, 300].flatMap((r): SymElem[] => [[r, 0], [r, 1]]);
/** simmetriche rispetto all'asse verticale (puntano in su) */
const AXIS_V: SymElem[] = [[0, 0], [0, 1]];
/** simmetriche rispetto all'asse orizzontale (puntano di lato) */
const AXIS_H: SymElem[] = [[0, 0], [180, 1]];

/** simmetrie reali dei disegni in visuals.tsx, verificate sui punti dei poligoni */
const SYM: Record<ShapeName, SymElem[] | 'full'> = {
  circle: 'full',
  dot: 'full',
  square: D4,
  diamond: D4,
  cross: D4,
  hexagon: D6,
  triangle: AXIS_V,
  star: AXIS_V,
  pentagon: AXIS_V,
  heart: AXIS_V,
  arrow: AXIS_H,
  moon: AXIS_H,
};

/** forma normalizzata: chiavi sempre nello stesso ordine, rot 0 e flip falso omessi */
function clean(s: ShapeSpec): ShapeSpec {
  const out: ShapeSpec = { shape: s.shape, color: s.color ?? 0, fillMode: s.fillMode ?? 'solid' };
  const rot = normRot(s.rot ?? 0);
  if (rot) out.rot = rot;
  if (s.flip) out.flip = true;
  return out;
}

/**
 * Orientamento CANONICO: due forme con lo stesso valore si vedono identiche.
 * (un cerchio ruotato di 90° o un quadrato specchiato non cambiano aspetto)
 */
function orient(s: ShapeSpec): string {
  const sym = SYM[s.shape];
  if (sym === 'full') return '*';
  const r = normRot(s.rot ?? 0);
  const f: 0 | 1 = s.flip ? 1 : 0;
  let best = '';
  for (const [gr, gf] of sym) {
    const rr = gf === 0 ? normRot(r + gr) : normRot(gr - r);
    const ff = gf === 0 ? f : 1 - f;
    const key = `${ff}:${String(rr).padStart(3, '0')}`;
    if (!best || key < best) best = key;
  }
  return best;
}

function shapeSig(s: ShapeSpec): string {
  return `${s.shape}/${s.color ?? 0}/${s.fillMode ?? 'solid'}/${orient(s)}`;
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

/** firma VISIVA della composizione: due comp con la stessa firma si vedono identiche */
function compSig(c: Comp): string {
  return `${c.layout}:${c.rows}x${c.cols}:${c.shapes.map(shapeSig).join(',')}`;
}

function toCell(c: Comp): CellSpec {
  return { shapes: c.shapes.map(clean), layout: c.layout };
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
  mirV: { perm: pMirV, shape: flipV, label: 'il riflesso nello specchio verticale (destra e sinistra scambiate)' },
  mirH: { perm: pMirH, shape: flipH, label: 'il riflesso nello specchio orizzontale (alto e basso scambiati)' },
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
const COLOR_IT = ['ciano', 'rosa', 'viola', 'ambra', 'verde', 'corallo', 'blu', 'arancione'];

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

const SIMPLE: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
/** forme che cambiano aspetto già a rot 0 sotto lo specchio verticale */
const SIDEWAYS: ShapeName[] = ['arrow', 'moon'];
/** forme "in piedi": si vede subito se qualcuno le capovolge */
const UPRIGHT: ShapeName[] = ['triangle', 'star', 'pentagon', 'heart'];
const RICH: ShapeName[] = [...SIMPLE, ...SIDEWAYS];

const STEPS45 = [0, 45, 90, 135, 180, 225, 270, 315];
const STEPS90 = [0, 90, 180, 270];

interface Plan {
  layout: 'grid' | 'row';
  n: number;
  pool: ShapeName[];
  /** almeno una forma pescata qui (le altre dal pool) */
  must?: ShapeName[];
  /** la stessa forma ripetuta n volte, distinguibile solo da colore e rotazione */
  repeat?: ShapeName[];
  rots: number[];
  /** rotazioni tutte diverse tra loro */
  distinctRots?: boolean;
  /** quante forme disegnate solo col contorno */
  outlines?: number;
}

function buildComp(rng: Rng, p: Plan): Comp {
  const colors = pickN(rng, [0, 1, 2, 3, 4, 5, 6, 7], p.n);
  let names: ShapeName[];
  if (p.repeat) {
    const one = pick(rng, p.repeat);
    names = Array.from({ length: p.n }, () => one);
  } else if (p.must) {
    const first = pick(rng, p.must);
    names = shuffle(rng, [first, ...pickN(rng, p.pool.filter((s) => s !== first), p.n - 1)]);
  } else {
    names = pickN(rng, p.pool, p.n);
  }
  const rots = p.distinctRots && p.rots.length >= p.n ? pickN(rng, p.rots, p.n) : names.map(() => pick(rng, p.rots));
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
}

class Ambiguous extends Error {}

function assemble(rng: Rng, difficulty: Difficulty, v: Variant): Question {
  const src = buildComp(rng, v.plan);
  const right = applyOp(src, v.correct);
  const opts = [right, applyOp(src, v.wrong[0]), applyOp(src, v.wrong[1])];
  const sigs = opts.map(compSig);

  // 1) il riflesso deve cambiare davvero qualcosa
  if (compSig(src) === sigs[0]) throw new Ambiguous('il riflesso è identico alla figura');
  // 2) le tre opzioni devono vedersi diverse (non basta che i dati differiscano)
  if (new Set(sigs).size !== 3) throw new Ambiguous('due opzioni si vedrebbero identiche');
  // 3) verifica cruciale: una riflessione non deve MAI coincidere con una rotazione,
  //    altrimenti "specchio" e "giro" darebbero la stessa figura e la domanda è ambigua
  if (v.correct === 'mirV' || v.correct === 'mirH') {
    for (const rot of ROTATIONS) {
      if (!renderable(src, rot)) continue;
      if (compSig(applyOp(src, rot)) === sigs[0]) throw new Ambiguous('il riflesso coincide con una rotazione');
    }
  }

  const cells = opts.map(toCell);
  const rows: CellSpec[][] = [];
  let exSrc: Comp | null = null;

  if (v.style === 'example') {
    exSrc = buildComp(rng, v.plan);
    const exOut = applyOp(exSrc, v.correct);
    if (compSig(exSrc) === compSig(exOut)) throw new Ambiguous("l'esempio non mostra alcun cambiamento");
    // l'esempio non deve essere la stessa figura della domanda: regalerebbe la risposta
    if (compSig(exSrc) === compSig(src)) throw new Ambiguous("l'esempio ripete la figura della domanda");
    // l'esempio deve INCHIODARE la regola: ogni trasformazione compatibile con
    // l'esempio deve dare, sulla figura della domanda, la stessa risposta
    const exSig = compSig(exOut);
    for (const op of ALL_OPS) {
      if (op === v.correct || !renderable(exSrc, op) || !renderable(src, op)) continue;
      if (compSig(applyOp(exSrc, op)) === exSig && compSig(applyOp(src, op)) !== sigs[0]) {
        throw new Ambiguous("l'esempio non basta a capire la regola");
      }
    }
    rows.push([toCell(exSrc), toCell(exOut)]);
    rows.push([toCell(src), { shapes: [], unknown: true }]);
  } else {
    rows.push([toCell(src), { shapes: [], unknown: true }]);
  }

  const { choices, correctIndex } = placeChoices(rng, { kind: 'cell', cell: cells[0] }, [
    { kind: 'cell', cell: cells[1] },
    { kind: 'cell', cell: cells[2] },
  ]);

  return {
    qtype: 'mirror',
    difficulty,
    prompt: v.prompt,
    payload: { kind: 'cells', rows, arrows: v.style === 'direct', analogy: v.style === 'example' },
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

  const changed = src.shapes.findIndex((s) => orient(s) !== orient(OPS[v.correct].shape(s)));
  if (changed >= 0) {
    parts.push(`Anche ogni singola forma ${v.selfWord}: guarda ${nameOf(src.shapes[changed])}.`);
  }

  parts.push(
    `Le altre due risposte sono ${OPS[v.wrong[0]].label} e ${OPS[v.wrong[1]].label}.`
  );
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Testi delle regole
// ---------------------------------------------------------------------------

const PROMPT_V = [
  "Lo specchio è a destra della figura: come si vede l'immagine riflessa?",
  'Come appare questa figura vista in uno specchio verticale?',
  'Metti uno specchio di fianco alla figura: quale immagine ci vedi?',
];
const PROMPT_H = [
  "Lo specchio è sotto la figura, come l'acqua di un lago: qual è il riflesso?",
  'Come appare questa figura riflessa in uno specchio orizzontale, messo sotto?',
];
const PROMPT_DOUBLE = [
  'La figura si riflette prima in uno specchio verticale e poi in uno orizzontale: come appare alla fine?',
  'Due specchi di fila: prima quello di fianco, poi quello sotto. Che immagine esce?',
];
const PROMPT_EX_V = [
  'Il primo esempio mostra una figura e il suo riflesso allo specchio: come si riflette la seconda figura?',
  'Guarda come si trasforma la prima figura allo specchio e applica la stessa regola alla seconda.',
];
const PROMPT_EX_H = [
  'Il primo esempio mostra una figura e il suo riflesso: applica la stessa regola alla seconda figura.',
];

const RULE_V =
  "Uno specchio verticale scambia la destra con la sinistra, ma lascia l'alto in alto.";
const RULE_H =
  "Uno specchio orizzontale scambia l'alto con il basso, ma lascia la sinistra a sinistra.";
const RULE_DOUBLE =
  'Due riflessioni di fila si annullano come specchi: la prima scambia destra e sinistra, la seconda alto e basso, e il risultato è la figura girata di mezzo giro (180°).';

const SELF_V = "si ribalta su sé stessa, come se guardasse dall'altra parte";
const SELF_H = 'si capovolge sottosopra';
const SELF_TURN = 'fa mezzo giro su sé stessa';

// ---------------------------------------------------------------------------
// Difficoltà 1 — specchio verticale, forme e colori molto distinti
// ---------------------------------------------------------------------------

function genD1(rng: Rng): Question {
  const kind = randInt(rng, 0, 4);
  const spin: OpName = pick(rng, ['rot90', 'rot270']);
  if (kind === 0) {
    // griglia 2×2 di forme diverse, dritte: conta solo lo scambio di posto
    return assemble(rng, 1, {
      plan: { layout: 'grid', n: 4, pool: SIMPLE, rots: [0] },
      correct: 'mirV',
      wrong: ['rot180', spin],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 1) {
    // con frecce e lune: allo specchio ogni forma punta dall'altra parte
    return assemble(rng, 1, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: SIDEWAYS, rots: [0] },
      correct: 'mirV',
      wrong: ['posV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 2) {
    // fila di 3: l'ordine si rovescia
    return assemble(rng, 1, {
      plan: { layout: 'row', n: 3, pool: SIMPLE, must: UPRIGHT, rots: [0] },
      correct: 'mirV',
      wrong: ['rot180', 'mirH'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 3) {
    // fila di 3 con forme direzionali
    return assemble(rng, 1, {
      plan: { layout: 'row', n: 3, pool: RICH, must: SIDEWAYS, rots: [0] },
      correct: 'mirV',
      wrong: ['posV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  // esempio risolto + figura nuova: la regola si scopre guardando
  return assemble(rng, 1, {
    plan: { layout: 'grid', n: 4, pool: SIMPLE, rots: [0] },
    correct: 'mirV',
    wrong: ['rot180', spin],
    style: 'example',
    prompt: pick(rng, PROMPT_EX_V),
    rule: RULE_V,
    selfWord: SELF_V,
  });
}

// ---------------------------------------------------------------------------
// Difficoltà 2 — specchio verticale con forme direzionali ruotate
// ---------------------------------------------------------------------------

function genD2(rng: Rng): Question {
  const kind = randInt(rng, 0, 4);
  const spin: OpName = pick(rng, ['rot90', 'rot270']);
  if (kind === 0) {
    // 2×2 con frecce/lune inclinate: conta anche l'angolo di ogni forma
    return assemble(rng, 2, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: SIDEWAYS, rots: STEPS45 },
      correct: 'mirV',
      wrong: ['rot180', spin],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 1) {
    // quattro volte la stessa forma: distinguono solo colore e inclinazione
    return assemble(rng, 2, {
      plan: { layout: 'grid', n: 4, pool: RICH, repeat: ['arrow', 'moon', 'triangle'], rots: STEPS45, distinctRots: true },
      correct: 'mirV',
      wrong: ['posV', spin],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 2) {
    // fila di 3 inclinate: ordine rovesciato E forme ribaltate
    return assemble(rng, 2, {
      plan: { layout: 'row', n: 3, pool: RICH, must: SIDEWAYS, rots: STEPS45 },
      correct: 'mirV',
      wrong: ['rot180', 'posV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 3) {
    // due forme solo contornate: un attributo in più da seguire
    return assemble(rng, 2, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: SIDEWAYS, rots: STEPS90, outlines: randInt(rng, 1, 2) },
      correct: 'mirV',
      wrong: [spin, 'selfV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  // esempio risolto, con forme inclinate
  return assemble(rng, 2, {
    plan: { layout: 'grid', n: 4, pool: RICH, must: SIDEWAYS, rots: STEPS45 },
    correct: 'mirV',
    wrong: ['rot180', 'mirH'],
    style: 'example',
    prompt: pick(rng, PROMPT_EX_V),
    rule: RULE_V,
    selfWord: SELF_V,
  });
}

// ---------------------------------------------------------------------------
// Difficoltà 3 — specchio orizzontale, 6 forme, doppio specchio
// ---------------------------------------------------------------------------

function genD3(rng: Rng): Question {
  const kind = randInt(rng, 0, 5);
  if (kind === 0) {
    // specchio d'acqua su una 2×2 inclinata: il distrattore è l'asse sbagliato
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: UPRIGHT, rots: STEPS45 },
      correct: 'mirH',
      wrong: ['mirV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_H),
      rule: RULE_H,
      selfWord: SELF_H,
    });
  }
  if (kind === 1) {
    // doppio specchio: due riflessioni = mezzo giro
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: SIDEWAYS, rots: STEPS45 },
      correct: 'rot180',
      wrong: ['mirV', 'mirH'],
      style: 'direct',
      prompt: pick(rng, PROMPT_DOUBLE),
      rule: RULE_DOUBLE,
      selfWord: SELF_TURN,
    });
  }
  if (kind === 2) {
    // sei forme su due righe, specchio d'acqua
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 6, pool: RICH, must: UPRIGHT, rots: STEPS90 },
      correct: 'mirH',
      wrong: ['mirV', 'rot180'],
      style: 'direct',
      prompt: pick(rng, PROMPT_H),
      rule: RULE_H,
      selfWord: SELF_H,
    });
  }
  if (kind === 3) {
    // sei forme, specchio verticale: tanta roba da tenere a mente
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 6, pool: RICH, must: SIDEWAYS, rots: STEPS45 },
      correct: 'mirV',
      wrong: ['rot180', 'posV'],
      style: 'direct',
      prompt: pick(rng, PROMPT_V),
      rule: RULE_V,
      selfWord: SELF_V,
    });
  }
  if (kind === 4) {
    // esempio risolto con lo specchio orizzontale: la regola va dedotta
    return assemble(rng, 3, {
      plan: { layout: 'grid', n: 4, pool: RICH, must: UPRIGHT, rots: STEPS45 },
      correct: 'mirH',
      wrong: ['rot180', 'mirV'],
      style: 'example',
      prompt: pick(rng, PROMPT_EX_H),
      rule: RULE_H,
      selfWord: SELF_H,
    });
  }
  // doppio specchio su una fila
  return assemble(rng, 3, {
    plan: { layout: 'row', n: 3, pool: RICH, must: UPRIGHT, rots: STEPS45 },
    correct: 'rot180',
    wrong: ['mirV', 'mirH'],
    style: 'direct',
    prompt: pick(rng, PROMPT_DOUBLE),
    rule: RULE_DOUBLE,
    selfWord: SELF_TURN,
  });
}

export function genMirror(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => (difficulty === 1 ? genD1(rng) : difficulty === 2 ? genD2(rng) : genD3(rng)), 40);
}
