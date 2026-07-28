// Generatore "symmetry": riconoscere le simmetrie di una composizione di forme.
//
// Ogni opzione è una CellSpec che contiene una piccola composizione (2, 3 o 4
// forme disposte in griglia/fila: MAI 6, che a 72px diventerebbero francobolli
// da cercare col lentino). Le simmetrie considerate sono quelle che il renderer
// sa davvero disegnare:
//   V    = specchio con asse VERTICALE  (sinistra ↔ destra)
//   H    = specchio con asse ORIZZONTALE (sopra ↔ sotto)
//   C180 = rotazione di mezzo giro (simmetria centrale)
//   C90  = rotazione di un quarto di giro ("girandola")
//
// GEOMETRIA (verificata sul renderer, src/components/visuals.tsx):
// la <g> di una forma ha transform "translate(100 0) scale(-1 1) rotate(rot)",
// quindi la geometria disegnata è  Mirror ∘ Rotate(rot)  applicata alla forma
// base. Da qui seguono le regole usate qui sotto:
//   specchio verticale   : rot invariato, flip invertito
//   specchio orizzontale : rot + 180,     flip invertito
//   mezzo giro           : rot + 180,     flip invariato
//   quarto di giro       : rot ± 90 (−90 se flip), flip invariato
// (NB: rot → −rot + flip sarebbe la regola giusta solo se il flip fosse
// applicato DOPO la rotazione: qui non è così.)
//
// LA DOMANDA È PURAMENTE GEOMETRICA. canonKey() — la chiave con cui si decide
// se due forme "sono la stessa" — IGNORA IL COLORE: una simmetria vale o non
// vale in base a forma e orientamento, mai in base a due colori scambiati. I
// colori vengono comunque assegnati per orbita, quindi accompagnano sempre la
// geometria e non possono contraddirla. (Prima non era così: esistevano coppie
// di opzioni geometricamente identiche che differivano solo per un colore, e
// chi ragionava sulla forma restava senza risposta.)
//
// Tutte le forme della palette hanno almeno un asse di simmetria, quindi il loro
// riflesso coincide sempre con una loro rotazione: canonKey() riduce (rot, flip)
// a un unico angolo canonico modulo l'ordine di rotazione della forma.
// seenKey() fa lo stesso ma con il periodo che l'OCCHIO percepisce davvero
// (triangolo 120°, stella/pentagono 72°, esagono 60°…): serve per il dedup
// percettivo delle opzioni e per contare quante posizioni sono davvero diverse.
//
// Difficoltà 1: una sola proprietà da riconoscere (asse verticale/orizzontale,
// oppure "qual è il riflesso di questa figura"). 2: proprietà doppia o negata
// (due assi, un asse ma non l'altro, quale NON è simmetrica). 3: simmetria
// centrale/rotazionale, con il classico tranello specchio-vs-rotazione.
//
// I distrattori non sono mai casuali: sono la stessa composizione con DUE
// difetti geometrici tipici (una forma copiata invece che specchiata, una
// girata male, due che si scambiano di posto) oppure una composizione
// simmetrica rispetto all'asse SBAGLIATO. Due difetti e non uno solo: con una
// sola forma fuori posto su quattro il quesito diventava spot-the-difference.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

type Fill = 'solid' | 'outline';

// ---------------------------------------------------------------------------
// Geometria delle forme: ordine di rotazione (n) e asse di simmetria proprio.
// w0 = 0   → la forma è specchiabile sull'asse verticale a rot 0 (triangolo…)
// w0 = 180 → la forma è specchiabile sull'asse orizzontale a rot 0 (freccia…)
// iso      → forma isotropa: ruotarla/specchiarla non cambia nulla.
// ---------------------------------------------------------------------------
const GEOM: Record<ShapeName, { n: number; w0: number; iso?: boolean }> = {
  circle: { n: 1, w0: 0, iso: true },
  dot: { n: 1, w0: 0, iso: true },
  square: { n: 4, w0: 0 },
  diamond: { n: 4, w0: 0 },
  cross: { n: 4, w0: 0 },
  hexagon: { n: 6, w0: 0 },
  // ATTENZIONE: stella e pentagono sono disegnati centrati in (50,52) ma ruotati
  // attorno a (50,50): la loro simmetria a 5 punte NON è esatta (il centro si
  // sposta di 2px). Vengono quindi trattati come n = 1 e usati solo a rot 0/90/
  // 180/270, dove riflessioni e rotazioni restano esatte al pixel. Stessa storia
  // per il triangolo (baricentro in (50,58.7)).
  star: { n: 1, w0: 0 },
  pentagon: { n: 1, w0: 0 },
  triangle: { n: 1, w0: 0 },
  heart: { n: 1, w0: 0 },
  arrow: { n: 1, w0: 180 },
  moon: { n: 1, w0: 180 },
};

/**
 * Periodo di rotazione che l'occhio NON distingue: qui la simmetria "quasi
 * esatta" di triangolo/stella/pentagono conta eccome, perché una stella ruotata
 * di 72° sullo schermo è la stessa stella. Allineato alla tabella del
 * validatore percettivo (tools/check-generators.ts).
 */
const SEEN_PERIOD: Record<ShapeName, number> = {
  circle: 1,
  dot: 1,
  square: 90,
  diamond: 90,
  cross: 90,
  hexagon: 60,
  triangle: 120,
  star: 72,
  pentagon: 72,
  arrow: 360,
  heart: 360,
  moon: 360,
};

/** coda della chiave: NIENTE colore, la domanda è geometrica */
const tailOf = (s: ShapeSpec) => `|${s.fillMode ?? 'solid'}|${s.size ?? 0.8}`;

function foldKey(s: ShapeSpec, period: number): string {
  if (period <= 1) return `${s.shape}|·${tailOf(s)}`;
  let a = s.rot ?? 0;
  if (s.flip) a = -a - GEOM[s.shape].w0; // il riflesso equivale a una rotazione
  a = ((a % period) + period) % period;
  return `${s.shape}|${Math.round(a * 100) / 100}${tailOf(s)}`;
}

/** chiave ESATTA: due ShapeSpec con la stessa chiave sono disegnate identiche al pixel */
function canonKey(s: ShapeSpec): string {
  const g = GEOM[s.shape];
  return foldKey(s, g.iso ? 1 : 360 / g.n);
}

/** chiave PERCEPITA: come canonKey, ma col periodo che si vede davvero */
const seenKey = (s: ShapeSpec) => foldKey(s, SEEN_PERIOD[s.shape]);

/**
 * Chiave usata dal validatore percettivo di tools/check-generators.ts: ignora
 * il flip delle forme molto simmetriche. Non è la verità (un triangolo
 * specchiato SI vede), ma se due opzioni collidono qui il validatore le
 * dichiara indistinguibili: meglio rigenerare.
 */
function checkerKey(s: ShapeSpec): string {
  const p = SEEN_PERIOD[s.shape];
  const rot = p <= 1 ? 0 : normRot(s.rot ?? 0) % p;
  const flip = p <= 120 ? false : !!s.flip;
  return `${s.shape}|${rot}|${flip}${tailOf(s)}`;
}

function withFlip(s: ShapeSpec, f: boolean): ShapeSpec {
  const o: ShapeSpec = { ...s };
  if (f) o.flip = true;
  else delete o.flip;
  return o;
}

const mirrorV = (s: ShapeSpec): ShapeSpec => withFlip(s, !s.flip);
const mirrorH = (s: ShapeSpec): ShapeSpec =>
  withFlip({ ...s, rot: normRot((s.rot ?? 0) + 180) }, !s.flip);
const turn180 = (s: ShapeSpec): ShapeSpec => ({ ...s, rot: normRot((s.rot ?? 0) + 180) });
const turn90 = (s: ShapeSpec): ShapeSpec => ({
  ...s,
  rot: normRot((s.rot ?? 0) + (s.flip ? -90 : 90)),
});

/** identiche al pixel (per la matematica delle simmetrie) */
const same = (a: ShapeSpec, b: ShapeSpec) => canonKey(a) === canonKey(b);
/** distinguibili a occhio (per il dedup e per contare le differenze) */
const differs = (a: ShapeSpec, b: ShapeSpec) => seenKey(a) !== seenKey(b);
/** quante posizioni una bambina vedrebbe diverse fra due composizioni */
const diffCount = (a: ShapeSpec[], b: ShapeSpec[]) =>
  a.reduce((n, s, i) => n + (differs(s, b[i]) ? 1 : 0), 0);

// ---------------------------------------------------------------------------
// Formati: come sono disposte le forme dentro la cella (vedi <Cell> nel renderer)
// ---------------------------------------------------------------------------
interface Fmt {
  n: number;
  rows: number;
  cols: number;
  layout: 'grid' | 'row';
}
/** coppia affiancata */
const F2: Fmt = { n: 2, rows: 1, cols: 2, layout: 'grid' };
/** quadrato 2×2 */
const F4: Fmt = { n: 4, rows: 2, cols: 2, layout: 'grid' };
/** terzetto in fila (la forma centrale sta sull'asse) */
const FR3: Fmt = { n: 3, rows: 1, cols: 3, layout: 'row' };

/**
 * Quanto grandi disegnare le forme dentro la cella. Più grandi del default
 * (0.8) perché a 72px ogni forma di una griglia 2×2 è larga 36px e va vista
 * bene, ma non tanto da toccare la cornice della cella: in fila le caselle sono
 * strette (un terzo di cella l'una) e cuori e rombi finirebbero sul bordo.
 */
const sizeFor = (f: Fmt) => (f.layout === 'row' ? 0.82 : 0.88);

type SymKind = 'V' | 'H' | 'C180' | 'C90';

interface Op {
  perm: number[];
  t: (s: ShapeSpec) => ShapeSpec;
}

function permOf(f: Fmt, kind: SymKind): number[] {
  const p = new Array<number>(f.n);
  for (let i = 0; i < f.n; i++) {
    const r = Math.floor(i / f.cols);
    const c = i % f.cols;
    if (kind === 'V') p[i] = r * f.cols + (f.cols - 1 - c);
    else if (kind === 'H') p[i] = (f.rows - 1 - r) * f.cols + c;
    else if (kind === 'C180') p[i] = f.n - 1 - i;
    else p[i] = c * f.cols + (f.rows - 1 - r); // C90 (solo griglie quadrate)
  }
  return p;
}

function opOf(kind: SymKind, f: Fmt): Op {
  const t = kind === 'V' ? mirrorV : kind === 'H' ? mirrorH : kind === 'C180' ? turn180 : turn90;
  return { perm: permOf(f, kind), t };
}

/** la composizione è invariante sotto l'operazione? (out[perm[i]] === t(out[i])) */
function invariant(sp: ShapeSpec[], op: Op): boolean {
  for (let i = 0; i < sp.length; i++) if (!same(op.t(sp[i]), sp[op.perm[i]])) return false;
  return true;
}

const has = (sp: ShapeSpec[], f: Fmt, k: SymKind) => invariant(sp, opOf(k, f));

// ---------------------------------------------------------------------------
// Atomi: (forma, rotazione) con le loro simmetrie proprie
// ---------------------------------------------------------------------------
const ROT_SETS: Partial<Record<ShapeName, number[]>> = {
  circle: [0],
  square: [0, 20, 45],
  diamond: [0, 25, 45],
  cross: [0, 15, 45],
  hexagon: [0, 15, 30],
  star: [0, 90, 180, 270],
  pentagon: [0, 90, 180, 270],
  triangle: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
  heart: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
  arrow: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
  moon: [0, 30, 45, 60, 90, 120, 135, 150, 180, 210, 225, 240, 270, 300, 315, 330],
};

const ALL_ATOMS: ShapeSpec[] = Object.entries(ROT_SETS).flatMap(([shape, rots]) =>
  (rots as number[]).map((r) => ({ shape: shape as ShapeName, rot: normRot(r), color: 0, fillMode: 'solid' as const }))
);

const selfV = (s: ShapeSpec) => same(mirrorV(s), s);
const selfH = (s: ShapeSpec) => same(mirrorH(s), s);
const self180 = (s: ShapeSpec) => same(turn180(s), s);

/**
 * Atomi "liberi": diversi dal proprio riflesso verticale, dal proprio riflesso
 * orizzontale E dalla propria rotazione di mezzo giro. Sono gli unici che
 * rendono una simmetria VERIFICABILE a occhio (triangoli/cuori/frecce/lune
 * inclinati): con una forma già simmetrica in sé il rompicapo sarebbe ambiguo.
 */
const FREE = ALL_ATOMS.filter((s) => !selfV(s) && !selfH(s) && !self180(s));

const PALETTE_IDX = [0, 1, 2, 3, 4, 5, 6, 7];
/** palette degli esempi: senza il ciano (0), che è il colore della cornice */
const EXAMPLE_IDX = [1, 2, 3, 4, 5, 6, 7];

// ---------------------------------------------------------------------------
// Costruzione di una composizione con simmetrie imposte
// ---------------------------------------------------------------------------

/** riempie tutta la composizione propagando gli atomi lungo le orbite */
function buildInvariant(base: ShapeSpec[], ops: Op[]): ShapeSpec[] | null {
  const n = base.length;
  const out: (ShapeSpec | null)[] = new Array(n).fill(null);
  for (let seed = 0; seed < n; seed++) {
    if (out[seed]) continue;
    out[seed] = base[seed];
    const queue = [seed];
    while (queue.length) {
      const i = queue.shift() as number;
      for (const op of ops) {
        const j = op.perm[i];
        const v = op.t(out[i] as ShapeSpec);
        if (out[j] === null) {
          out[j] = v;
          queue.push(j);
        } else if (!same(out[j] as ShapeSpec, v)) {
          return null; // vincoli incompatibili: si riprova con altri atomi
        }
      }
    }
  }
  return out as ShapeSpec[];
}

interface CompOpts {
  colors: number[];
  fill: Fill;
  size: number;
  /** simmetrie che NON devono valere (per non rendere ambigua la domanda) */
  avoid?: SymKind[];
  /** riusa le stesse forme di un'altra opzione: le 3 scelte devono differire
   *  solo per la DISPOSIZIONE, non per il repertorio di forme */
  preferShapes?: ShapeName[];
}

function chooseAtoms(rng: Rng, pools: ShapeSpec[][], o: CompOpts): ShapeSpec[] {
  const used = new Set<ShapeName>();
  return pools.map((pool, k) => {
    let src = pool;
    if (o.preferShapes) {
      const narrowed = src.filter((s) => o.preferShapes?.includes(s.shape));
      if (narrowed.length) src = narrowed;
    }
    const fresh = src.filter((s) => !used.has(s.shape));
    if (fresh.length) src = fresh;
    if (!src.length) throw new Error('nessun atomo disponibile');
    const a = pick(rng, src);
    used.add(a.shape);
    return { ...a, color: o.colors[k % o.colors.length], fillMode: o.fill, size: o.size };
  });
}

/** composizione con le simmetrie `kinds` (e senza quelle in `avoid`) */
function makeComp(rng: Rng, f: Fmt, kinds: SymKind[], o: CompOpts): ShapeSpec[] {
  const ops = kinds.map((k) => opOf(k, f));

  // orbite delle posizioni sotto il gruppo generato dalle operazioni
  const parent = Array.from({ length: f.n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const op of ops) {
    for (let i = 0; i < f.n; i++) {
      const a = find(i);
      const b = find(op.perm[i]);
      if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < f.n; i++) {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  }
  const reps = [...groups.keys()].sort((a, b) => a - b);

  // le posizioni FISSE di un'operazione (es. la colonna centrale sotto lo
  // specchio verticale) devono ospitare una forma simmetrica in sé
  const pools = reps.map((rep) => {
    const members = groups.get(rep) as number[];
    const stab = ops.filter((op) => members.some((p) => op.perm[p] === p));
    if (!stab.length) return FREE;
    return ALL_ATOMS.filter((s) => stab.every((op) => same(op.t(s), s)));
  });

  const atoms = chooseAtoms(rng, pools, o);
  const base: ShapeSpec[] = new Array(f.n);
  reps.forEach((rep, k) => {
    base[rep] = atoms[k];
  });
  for (let i = 0; i < f.n; i++) if (!base[i]) base[i] = atoms[0];

  const out = buildInvariant(base, ops);
  if (!out) throw new Error('composizione incoerente');
  for (const k of kinds) if (!has(out, f, k)) throw new Error(`simmetria ${k} mancante`);
  for (const k of o.avoid ?? []) if (has(out, f, k)) throw new Error(`simmetria ${k} indesiderata`);
  return out;
}

const shapeNames = (sp: ShapeSpec[]) => [...new Set(sp.map((s) => s.shape))];

// ---------------------------------------------------------------------------
// Distrattori: la composizione giusta con DUE difetti geometrici
// ---------------------------------------------------------------------------
type BreakHow = 'copy' | 'turn' | 'flip' | 'swap';

const BREAKS: BreakHow[] = ['copy', 'turn', 'flip', 'swap'];

/** descrizione del difetto, al singolare e al plurale */
const BREAK_TEXT: Record<BreakHow, (mirrorish: boolean) => [string, string]> = {
  copy: (m) =>
    m
      ? ['copiata invece che specchiata', 'copiate invece che specchiate']
      : ['copiata invece che girata', 'copiate invece che girate'],
  turn: () => ['girata nel verso sbagliato', 'girate nel verso sbagliato'],
  flip: () => ['specchiata quando non doveva', 'specchiate quando non dovevano'],
  swap: () => ['finita al posto di un’altra', 'finite al posto sbagliato'],
};

interface Cand {
  shapes: ShapeSpec[];
  flaw: string;
}

/**
 * Applica UN difetto geometrico (in una posizione a caso) e dice se c'è
 * riuscito. Ogni difetto deve essere VISIBILE: se la modifica cade su una forma
 * che non la mostra (girare un cerchio, specchiare un quadrato) si prova altrove.
 */
function applyBreak(rng: Rng, out: ShapeSpec[], op: Op, how: BreakHow): boolean {
  const idxs = shuffle(rng, out.map((_, i) => i));
  for (const i of idxs) {
    if (how === 'copy') {
      const j = op.perm[i];
      if (j === i || !differs(out[i], out[j])) continue;
      out[j] = { ...out[i] }; // copiata al posto di specchiata/girata
      return true;
    }
    if (how === 'turn') {
      for (const da of shuffle(rng, [45, 90, 135])) {
        const cand: ShapeSpec = { ...out[i], rot: normRot((out[i].rot ?? 0) + da) };
        if (differs(cand, out[i])) {
          out[i] = cand;
          return true;
        }
      }
      continue;
    }
    if (how === 'flip') {
      const cand = withFlip(out[i], !out[i].flip);
      if (!differs(cand, out[i])) continue;
      out[i] = cand;
      return true;
    }
    const j = idxs.find((k) => k !== i && differs(out[k], out[i]));
    if (j === undefined) continue;
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
    return true;
  }
  return false;
}

/**
 * Distrattore: la composizione giusta con DUE difetti geometrici in posizioni
 * che si vedono. Due e non uno: con una sola forma fuori posto trovare la
 * differenza è un gioco di pazienza, non di ragionamento.
 */
function breakSym(rng: Rng, sp: ShapeSpec[], f: Fmt, kind: SymKind, how: BreakHow): Cand {
  const op = opOf(kind, f);
  const mirrorish = kind === 'V' || kind === 'H';
  const others = BREAKS.filter((b) => b !== how);
  for (let t = 0; t < 24; t++) {
    const out = sp.map((s) => ({ ...s }));
    if (!applyBreak(rng, out, op, how)) break; // difetto non applicabile qui
    const how2 = pick(rng, others);
    if (!applyBreak(rng, out, op, how2)) continue;
    if (invariant(out, op)) continue; // i due difetti si sono annullati
    if (diffCount(sp, out) < 2) continue;
    const [s1, p1] = BREAK_TEXT[how](mirrorish);
    const [s2] = BREAK_TEXT[how2](mirrorish);
    return {
      shapes: out,
      flaw: s1 === s2 ? `due forme sono ${p1}` : `una forma è ${s1} e un’altra è ${s2}`,
    };
  }
  throw new Error('impossibile rompere la simmetria in modo visibile');
}

const KIND_LABEL: Record<SymKind, string> = {
  V: 'asse verticale',
  H: 'asse orizzontale',
  C180: 'mezzo giro (180°)',
  C90: 'quarto di giro (90°)',
};

/** distrattore "simmetrico sull'asse sbagliato" */
function otherSym(rng: Rng, f: Fmt, kinds: SymKind[], o: CompOpts, flaw: string): Cand {
  return { shapes: makeComp(rng, f, kinds, o), flaw };
}

// ---------------------------------------------------------------------------
// Varianti di regola
// ---------------------------------------------------------------------------
interface VResult {
  correct: ShapeSpec[];
  wrong: [Cand, Cand];
  /** proprietà chiesta: deve valere per UNA sola opzione */
  target: (sp: ShapeSpec[]) => boolean;
  /** clausola che descrive cosa succede nell'esempio ("le due metà combaciano…") */
  exProp: string;
  /** la domanda vera e propria */
  ask: string;
  rule: string;
  /** che simmetria mostra l'esempio in cima */
  exKinds: SymKind[];
  exAvoid: SymKind[];
  /** asse da disegnare sull'esempio come linea di piega tratteggiata */
  exCrease?: 'V' | 'H';
  /** true se la risposta giusta è quella che NON ha la proprietà */
  negative?: boolean;
  /** esempio speciale: la STESSA figura mostrata piegata nei due sensi */
  twinAxes?: boolean;
  /** variante "riflesso": il payload è la figura modello, non un esempio */
  model?: ShapeSpec[];
}

type Variant = { key: string; formats: Fmt[]; make: (rng: Rng, f: Fmt, o: CompOpts) => VResult };

const twoOf = <T,>(rng: Rng, arr: readonly T[]): [T, T] => {
  const s = shuffle(rng, [...arr]);
  return [s[0], s[1]];
};

// ---- difficoltà 1 ---------------------------------------------------------

/** d1: quale figura ha l'asse di simmetria verticale (o orizzontale)? */
function vAxis(axis: 'V' | 'H'): Variant['make'] {
  const other: SymKind = axis === 'V' ? 'H' : 'V';
  return (rng, f, o) => {
    const correct = makeComp(rng, f, [axis], { ...o, avoid: [other] });
    const opts = { ...o, preferShapes: shapeNames(correct) };
    const [h1] = twoOf(rng, BREAKS);
    const w1 = breakSym(rng, correct, f, axis, h1);
    const canOther = f.rows > 1 || other === 'V';
    const w2 = canOther
      ? otherSym(rng, f, [other], { ...opts, avoid: [axis] }, `la simmetria c’è, ma con ${KIND_LABEL[other]}`)
      : otherSym(rng, f, ['C180'], { ...opts, avoid: [axis] }, 'la figura torna uguale girandola di mezzo giro, non allo specchio');
    return {
      correct,
      wrong: [w1, w2],
      target: (sp) => has(sp, f, axis),
      exProp:
        axis === 'V'
          ? 'sinistra e destra combaciano piegando lungo la linea gialla'
          : 'sopra e sotto combaciano piegando lungo la linea gialla',
      ask: 'Quale delle tre figure fa lo stesso?',
      rule:
        axis === 'V'
          ? 'Asse verticale: piegando la figura lungo la linea verticale centrale, le due metà devono combaciare. A destra ci vuole il RIFLESSO di ciò che sta a sinistra (stessa forma, ma girata come allo specchio), non una copia.'
          : 'Asse orizzontale: piegando la figura lungo la linea orizzontale centrale, sopra e sotto devono combaciare. In basso ci vuole il RIFLESSO di ciò che sta in alto, non una copia.',
      exKinds: [axis],
      exAvoid: [other],
      exCrease: axis,
    };
  };
}

/** d1: quale figura ha ALMENO un asse di simmetria? */
const anyAxis: Variant['make'] = (rng, f, o) => {
  const axis: SymKind = f.rows > 1 && rng() < 0.5 ? 'H' : 'V';
  const other: SymKind = axis === 'V' ? 'H' : 'V';
  const correct = makeComp(rng, f, [axis], { ...o, avoid: [other] });
  // entrambi i distrattori nascono dalla figura giusta: stesse forme, stessi
  // colori, solo qualche pezzo fuori posto (così l'unica differenza è la simmetria)
  const [h1, h2] = twoOf(rng, BREAKS);
  const w1 = breakSym(rng, correct, f, axis, h1);
  const w2 = breakSym(rng, correct, f, axis, h2);
  const noAxis = (sp: ShapeSpec[]) => !has(sp, f, 'V') && !has(sp, f, 'H');
  if (!noAxis(w1.shapes) || !noAxis(w2.shapes)) throw new Error('distrattore ancora simmetrico');
  return {
    correct,
    wrong: [w1, w2],
    target: (sp) => has(sp, f, 'V') || has(sp, f, 'H'),
    exProp: 'le due metà combaciano piegando lungo la linea gialla',
    ask: 'Quale delle tre figure è simmetrica?',
    rule:
      'Una figura è simmetrica a specchio se esiste una linea (verticale o orizzontale) che la divide in due metà che combaciano piegandola. Le altre due sono "quasi" simmetriche: bastano un paio di pezzi fuori posto e la simmetria sparisce.',
    exKinds: [axis],
    exAvoid: [other],
    exCrease: axis === 'H' ? 'H' : 'V',
  };
};

/** d1: quale figura è il riflesso allo specchio di quella mostrata? */
const mirrorPair: Variant['make'] = (rng, f, o) => {
  const model = makeComp(rng, f, [], { ...o, avoid: ['V', 'H', 'C180'] });
  const opV = opOf('V', f);
  const op180 = opOf('C180', f);
  const reflected: ShapeSpec[] = new Array(f.n);
  const turned: ShapeSpec[] = new Array(f.n);
  // "specchio pigro": le forme cambiano posto ma nessuna viene specchiata
  const lazy: ShapeSpec[] = new Array(f.n);
  for (let i = 0; i < f.n; i++) {
    reflected[opV.perm[i]] = mirrorV(model[i]);
    turned[op180.perm[i]] = turn180(model[i]);
    lazy[opV.perm[i]] = { ...model[i] };
  }
  const key = (sp: ShapeSpec[]) => sp.map(canonKey).join('/');
  return {
    correct: reflected,
    wrong: [
      { shapes: turned, flaw: 'è la figura girata di mezzo giro, non riflessa' },
      { shapes: lazy, flaw: 'le forme hanno cambiato posto ma non sono state specchiate' },
    ],
    target: (sp) => key(sp) === key(reflected),
    exProp: '',
    ask: 'Quale figura è l’immagine allo specchio di quella in alto?',
    rule:
      'Allo specchio succedono DUE cose insieme: le forme si scambiano da sinistra a destra E ognuna viene girata come allo specchio. Se sposti soltanto le forme, o se giri tutta la figura di mezzo giro, il risultato è diverso.',
    exKinds: [],
    exAvoid: [],
    model,
  };
};

// ---- difficoltà 2 ---------------------------------------------------------

/** d2: quale figura NON è simmetrica? */
const notSym: Variant['make'] = (rng, f, o) => {
  const axis: SymKind = f.rows > 1 && rng() < 0.4 ? 'H' : 'V';
  const other: SymKind = axis === 'V' ? 'H' : 'V';
  const good1 = makeComp(rng, f, [axis], { ...o, avoid: [other] });
  const opts = { ...o, preferShapes: shapeNames(good1) };
  const good2 = makeComp(rng, f, [axis], { ...opts, avoid: [other] });
  const broken = breakSym(rng, rng() < 0.5 ? good1 : good2, f, axis, pick(rng, BREAKS));
  return {
    correct: broken.shapes,
    wrong: [
      { shapes: good1, flaw: `sono simmetriche con ${KIND_LABEL[axis]}` },
      { shapes: good2, flaw: `sono simmetriche con ${KIND_LABEL[axis]}` },
    ],
    target: (sp) => !has(sp, f, axis),
    negative: true,
    exProp:
      axis === 'V'
        ? 'sinistra e destra combaciano piegando lungo la linea gialla'
        : 'sopra e sotto combaciano piegando lungo la linea gialla',
    ask: 'Due delle tre figure sono simmetriche così: quale NO?',
    rule: `Qui bisogna controllare tutte e tre le figure una per una. Due sono simmetriche con ${KIND_LABEL[axis]}; nella terza ${broken.flaw}, quindi le due metà non combaciano più.`,
    exKinds: [axis],
    exAvoid: [other],
    exCrease: axis === 'H' ? 'H' : 'V',
  };
};

/** d2: quale figura ha DUE assi di simmetria? */
const twoAxes: Variant['make'] = (rng, f, o) => {
  const correct = makeComp(rng, f, ['V', 'H'], o);
  const opts = { ...o, preferShapes: shapeNames(correct) };
  return {
    correct,
    wrong: [
      otherSym(rng, f, ['V'], { ...opts, avoid: ['H'] }, 'ha solo l’asse verticale'),
      otherSym(rng, f, ['H'], { ...opts, avoid: ['V'] }, 'ha solo l’asse orizzontale'),
    ],
    target: (sp) => has(sp, f, 'V') && has(sp, f, 'H'),
    exProp: 'la stessa figura combacia sia piegata in verticale sia piegata in orizzontale',
    ask: 'Quale delle tre figure combacia in tutti e due i modi?',
    rule:
      'Servono due controlli: piegare la figura in verticale (sinistra su destra) e poi in orizzontale (sopra su sotto). Solo una figura supera tutti e due i test; le altre due ne superano uno solo.',
    exKinds: ['V', 'H'],
    exAvoid: [],
    twinAxes: true,
  };
};

/** d2: un asse sì, l'altro no */
function oneAxisOnly(axis: 'V' | 'H'): Variant['make'] {
  const other: SymKind = axis === 'V' ? 'H' : 'V';
  return (rng, f, o) => {
    const correct = makeComp(rng, f, [axis], { ...o, avoid: [other] });
    const opts = { ...o, preferShapes: shapeNames(correct) };
    return {
      correct,
      wrong: [
        otherSym(rng, f, ['V', 'H'], opts, 'è simmetrica su tutti e due gli assi'),
        otherSym(rng, f, [other], { ...opts, avoid: [axis] }, `è simmetrica con ${KIND_LABEL[other]}`),
      ],
      target: (sp) => has(sp, f, axis) && !has(sp, f, other),
      exProp: 'la figura combacia piegata lungo la linea gialla, ma NON piegata nell’altro senso',
      ask: 'Quale delle tre figure fa la stessa cosa?',
      rule:
        `Attenzione al "ma non": una figura va bene solo se supera il test di ${KIND_LABEL[axis]} e FALLISCE quello di ${KIND_LABEL[other]}. ` +
        'Una delle altre due è simmetrica su entrambi gli assi (quindi è di troppo), l’altra è simmetrica sull’asse sbagliato.',
      exKinds: [axis],
      exAvoid: [other],
      exCrease: axis,
    };
  };
}

// ---- difficoltà 3 ---------------------------------------------------------

/** d3: quale figura resta identica girata di 180°? */
const turnHalf: Variant['make'] = (rng, f, o) => {
  const correct = makeComp(rng, f, ['C180'], { ...o, avoid: ['V', 'H'] });
  const opts = { ...o, preferShapes: shapeNames(correct) };
  const trap = otherSym(
    rng,
    f,
    ['V'],
    { ...opts, avoid: ['H', 'C180'] },
    'è simmetrica allo specchio, ma girandola di mezzo giro cambia'
  );
  const broken = breakSym(rng, correct, f, 'C180', pick(rng, BREAKS));
  return {
    correct,
    wrong: [trap, broken],
    target: (sp) => has(sp, f, 'C180'),
    exProp: 'la figura resta identica se la giri di mezzo giro (180°)',
    ask: 'Quale delle tre figure fa la stessa cosa?',
    rule:
      'Girare di mezzo giro NON è come guardarsi allo specchio: la forma in alto a sinistra finisce in basso a destra, già capovolta. Il tranello è la figura simmetrica a specchio: sembra ordinata, ma ruotandola di 180° non torna uguale.',
    exKinds: ['C180'],
    exAvoid: ['V', 'H'],
  };
};

/** d3: mezzo giro sì, specchio no */
const turnNotMirror: Variant['make'] = (rng, f, o) => {
  const correct = makeComp(rng, f, ['C180'], { ...o, avoid: ['V', 'H'] });
  const opts = { ...o, preferShapes: shapeNames(correct) };
  return {
    correct,
    wrong: [
      otherSym(rng, f, ['V', 'H'], opts, 'torna uguale girandola, ma è ANCHE simmetrica allo specchio'),
      otherSym(rng, f, ['V'], { ...opts, avoid: ['H', 'C180'] }, 'è simmetrica allo specchio ma girandola cambia'),
    ],
    target: (sp) => has(sp, f, 'C180') && !has(sp, f, 'V') && !has(sp, f, 'H'),
    exProp: 'la figura resta identica dopo mezzo giro (180°), ma non è simmetrica a specchio',
    ask: 'Quale delle tre figure fa la stessa cosa?',
    rule:
      'Servono due verifiche opposte: la figura deve tornare uguale ruotandola di mezzo giro e NON deve combaciare piegandola a specchio. Una figura con due assi supera anche il test dello specchio (quindi va scartata), un’altra è solo speculare.',
    exKinds: ['C180'],
    exAvoid: ['V', 'H'],
  };
};

/** d3: girandola — resta identica girata di 90° */
const turnQuarter: Variant['make'] = (rng, f, o) => {
  const correct = makeComp(rng, f, ['C90'], { ...o, avoid: ['V', 'H'] });
  const opts = { ...o, preferShapes: shapeNames(correct) };
  return {
    correct,
    wrong: [
      otherSym(rng, f, ['C180'], { ...opts, avoid: ['C90', 'V', 'H'] }, 'torna uguale solo dopo mezzo giro, non dopo un quarto'),
      breakSym(rng, correct, f, 'C90', pick(rng, BREAKS)),
    ],
    target: (sp) => has(sp, f, 'C90'),
    exProp: 'la figura resta identica se la giri di un quarto di giro (90°), come una girandola',
    ask: 'Quale delle tre figure fa la stessa cosa?',
    rule:
      'In una girandola ogni forma, ruotata di 90°, va a finire esattamente sulla forma successiva in senso orario: quattro "braccia" uguali ma girate di 90° l’una rispetto all’altra. Chi torna uguale solo dopo mezzo giro non basta.',
    exKinds: ['C90'],
    exAvoid: ['V', 'H'],
  };
};

/** d3: quale NON resta uguale girata di 180°? */
const notTurnHalf: Variant['make'] = (rng, f, o) => {
  const good1 = makeComp(rng, f, ['C180'], { ...o, avoid: ['V', 'H'] });
  const opts = { ...o, preferShapes: shapeNames(good1) };
  const good2 = makeComp(rng, f, ['C180'], { ...opts, avoid: ['V', 'H'] });
  const broken = breakSym(rng, rng() < 0.5 ? good1 : good2, f, 'C180', pick(rng, BREAKS));
  return {
    correct: broken.shapes,
    wrong: [
      { shapes: good1, flaw: 'restano identiche dopo mezzo giro' },
      { shapes: good2, flaw: 'restano identiche dopo mezzo giro' },
    ],
    target: (sp) => !has(sp, f, 'C180'),
    negative: true,
    exProp: 'la figura resta identica se la giri di mezzo giro (180°)',
    ask: 'Due figure fanno lo stesso: quale invece CAMBIA?',
    rule: `Per il mezzo giro le forme si scambiano in diagonale (alto-sinistra con basso-destra) e ognuna si capovolge. In una delle tre ${broken.flaw}: dopo il giro non coincide più.`,
    exKinds: ['C180'],
    exAvoid: ['V', 'H'],
  };
};

/** d3: specchio sì, mezzo giro no */
const mirrorNotTurn: Variant['make'] = (rng, f, o) => {
  const correct = makeComp(rng, f, ['V'], { ...o, avoid: ['H', 'C180'] });
  const opts = { ...o, preferShapes: shapeNames(correct) };
  return {
    correct,
    wrong: [
      otherSym(rng, f, ['V', 'H'], opts, 'è speculare, ma resta uguale anche dopo mezzo giro'),
      otherSym(rng, f, ['C180'], { ...opts, avoid: ['V', 'H'] }, 'torna uguale dopo mezzo giro ma non è speculare'),
    ],
    target: (sp) => has(sp, f, 'V') && !has(sp, f, 'C180'),
    exProp: 'la figura combacia piegata lungo la linea gialla, ma girata di mezzo giro CAMBIA',
    ask: 'Quale delle tre figure fa la stessa cosa?',
    rule:
      'Specchio e mezzo giro sono due cose diverse. Serve la figura che passa il test dello specchio verticale ma fallisce quello della rotazione: se una figura ha due assi di simmetria, il mezzo giro la lascia uguale e quindi non va bene.',
    exKinds: ['V'],
    exAvoid: ['H', 'C180'],
    exCrease: 'V',
  };
};

// ---------------------------------------------------------------------------
// Tabella delle varianti per difficoltà
// (formati: mai 6 forme in un'opzione, a 72px sarebbero 24px l'una)
// ---------------------------------------------------------------------------
const VARIANTS: Record<Difficulty, Variant[]> = {
  1: [
    { key: 'sym-v', formats: [F2, F4, FR3], make: vAxis('V') },
    { key: 'sym-h', formats: [F4], make: vAxis('H') },
    { key: 'sym-any', formats: [F2, F4, FR3], make: anyAxis },
    { key: 'mirror-pair', formats: [F2, F4, FR3], make: mirrorPair },
  ],
  2: [
    { key: 'not-sym', formats: [F4, FR3], make: notSym },
    { key: 'two-axes', formats: [F4], make: twoAxes },
    { key: 'v-not-h', formats: [F4], make: oneAxisOnly('V') },
    { key: 'h-not-v', formats: [F4], make: oneAxisOnly('H') },
  ],
  3: [
    { key: 'rot180', formats: [F4, FR3], make: turnHalf },
    { key: 'rot180-not-mirror', formats: [F4], make: turnNotMirror },
    { key: 'rot90', formats: [F4], make: turnQuarter },
    { key: 'not-rot180', formats: [F4, FR3], make: notTurnHalf },
    { key: 'mirror-not-rot180', formats: [F4], make: mirrorNotTurn },
  ],
};

// ---------------------------------------------------------------------------
// Esempi in cima: STESSO formato delle opzioni (altrimenti la corrispondenza
// esempio/risposte non è immediata) ed etichettati.
// ---------------------------------------------------------------------------
interface CellOpts {
  highlight?: boolean;
  label?: string;
  crease?: 'V' | 'H';
}

function cellOf(sp: ShapeSpec[], f: Fmt, c: CellOpts = {}): CellSpec {
  const cell: CellSpec = { shapes: sp, layout: f.layout };
  if (c.highlight) cell.highlight = true;
  if (c.label) cell.label = c.label;
  if (c.crease) cell.crease = c.crease;
  return cell;
}

type ExMode = 'one' | 'two' | 'yesno' | 'twin' | 'mirror';

function buildExamples(
  rng: Rng,
  v: VResult,
  f: Fmt,
  o: CompOpts
): { cells: CellSpec[]; mode: ExMode; arrows: boolean } {
  if (v.model) {
    return {
      mode: 'mirror',
      arrows: true,
      cells: [
        cellOf(v.model, f, { highlight: true, label: 'figura' }),
        { shapes: [], unknown: true, label: 'allo specchio' },
      ],
    };
  }
  const mk = () => makeComp(rng, f, v.exKinds, { ...o, avoid: v.exAvoid });
  /** "ha la proprietà mostrata dall'esempio" (nelle varianti negate è l'opposto del target) */
  const hasProp = (sp: ShapeSpec[]) => (v.negative ? !v.target(sp) : v.target(sp));
  const ex = mk();
  if (!hasProp(ex)) throw new Error('esempio non conforme alla regola');

  // due assi: la stessa figura mostrata piegata nei due sensi
  if (v.twinAxes) {
    return {
      mode: 'twin',
      arrows: false,
      cells: [
        cellOf(ex, f, { highlight: true, label: 'verticale', crease: 'V' }),
        cellOf(ex, f, { highlight: true, label: 'orizzontale', crease: 'H' }),
      ],
    };
  }

  const r = rng();
  if (r < 0.36) {
    return { mode: 'one', arrows: false, cells: [cellOf(ex, f, { highlight: true, label: 'esempio', crease: v.exCrease })] };
  }
  if (r < 0.68) {
    const ex2 = mk();
    if (!hasProp(ex2)) throw new Error('esempio non conforme alla regola');
    if (ex.map(seenKey).join('/') === ex2.map(seenKey).join('/')) throw new Error('due esempi identici');
    return {
      mode: 'two',
      arrows: false,
      cells: [
        cellOf(ex, f, { highlight: true, label: 'esempio', crease: v.exCrease }),
        cellOf(ex2, f, { highlight: true, label: 'esempio', crease: v.exCrease }),
      ],
    };
  }
  // esempio + contro-esempio: la regola si legge anche "in negativo"
  const bad = breakSym(rng, ex, f, v.exKinds[0], pick(rng, BREAKS));
  if (hasProp(bad.shapes)) throw new Error('contro-esempio ancora conforme');
  return {
    mode: 'yesno',
    arrows: false,
    cells: [
      cellOf(ex, f, { highlight: true, label: 'sì', crease: v.exCrease }),
      cellOf(bad.shapes, f, { label: 'no', crease: v.exCrease }),
    ],
  };
}

function promptOf(v: VResult, mode: ExMode): string {
  switch (mode) {
    case 'mirror':
      return v.ask;
    case 'one':
      return `Nell’esempio in alto ${v.exProp}. ${v.ask}`;
    case 'two':
      return `Nei due esempi in alto ${v.exProp}. ${v.ask}`;
    case 'twin':
      return `Nei due esempi in alto ${v.exProp}. ${v.ask}`;
    default:
      // niente doppie negazioni: alcune regole contengono già un "ma non"
      return `In alto, nell’esempio «sì» ${v.exProp}; nel «no» qualcosa non torna. ${v.ask}`;
  }
}

// ---------------------------------------------------------------------------
export function genSymmetry(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const variant = pick(rng, VARIANTS[difficulty]);
    const fmt = pick(rng, variant.formats);
    const size = sizeFor(fmt);
    const fill: Fill = rng() < 0.25 ? 'outline' : 'solid';
    const v = variant.make(rng, fmt, { colors: pickN(rng, PALETTE_IDX, 4), fill, size });

    // --- unicità: la proprietà chiesta deve valere per UNA sola opzione ---
    const all = [v.correct, v.wrong[0].shapes, v.wrong[1].shapes];
    const hits = all.filter((sp) => v.target(sp)).length;
    if (hits !== 1 || !v.target(v.correct)) throw new Error('risposta non univoca');

    // --- dedup percettivo: due opzioni non devono MAI apparire uguali ---
    // (chiave esatta, chiave percepita e chiave del validatore: basta che una
    // sola collida perché la domanda sia da buttare)
    const keys = all.map((sp) => [
      sp.map(canonKey).join('/'),
      sp.map(seenKey).join('/'),
      sp.map(checkerKey).join('/'),
    ]);
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        for (let k = 0; k < 3; k++)
          if (keys[i][k] === keys[j][k]) throw new Error('due opzioni si vedono uguali');

    // --- i distrattori devono differire in ALMENO 2 posizioni ---
    // (con una sola forma diversa su quattro il quesito è spot-the-difference,
    // e la differenza deve essere geometrica: il colore non conta mai)
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++)
        if (diffCount(all[i], all[j]) < 2) throw new Error('opzioni troppo simili');

    // --- esempio/i in cima: stesso formato delle opzioni, colori diversi ---
    // (niente ciano negli esempi: è il colore della cornice che li evidenzia e
    // una forma "outline" ciano si confonderebbe con il bordo della cella)
    const ex = buildExamples(rng, v, fmt, {
      colors: pickN(rng, EXAMPLE_IDX, 4),
      fill,
      size,
    });

    const { choices, correctIndex } = placeChoices(
      rng,
      { kind: 'cell', cell: cellOf(v.correct, fmt) },
      [
        { kind: 'cell', cell: cellOf(v.wrong[0].shapes, fmt) },
        { kind: 'cell', cell: cellOf(v.wrong[1].shapes, fmt) },
      ]
    );

    const flaws = [v.wrong[0].flaw, v.wrong[1].flaw];
    const tail = v.negative
      ? ` Le altre due invece sono a posto: ${flaws[0]}.`
      : ` Nelle altre due: ${flaws[0]}; ${flaws[1]}.`;

    return {
      qtype: 'symmetry',
      difficulty,
      prompt: promptOf(v, ex.mode),
      payload: { kind: 'cells' as const, rows: [ex.cells], arrows: ex.arrows },
      choices,
      correctIndex,
      explanation: v.rule + tail,
    };
  }, 60);
}
