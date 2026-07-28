// Generatore "symmetry": riconoscere le simmetrie di una composizione di forme.
//
// Ogni opzione è una CellSpec che contiene una piccola composizione (2, 3, 4 o 6
// forme disposte in griglia/fila). Le simmetrie considerate sono quelle che il
// renderer sa davvero disegnare:
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
// Tutte le forme della palette hanno almeno un asse di simmetria, quindi il loro
// riflesso coincide sempre con una loro rotazione: canonKey() riduce (rot, flip)
// a un unico angolo canonico modulo l'ordine di rotazione della forma. Serve per
// confrontare STRUTTURALMENTE due composizioni e certificare che la risposta
// corretta è simmetrica e le altre due no.
//
// Difficoltà 1: una sola proprietà da riconoscere (asse verticale/orizzontale,
// oppure "qual è il riflesso di questa figura"). 2: proprietà doppia o negata
// (due assi, un asse ma non l'altro, quale NON è simmetrica). 3: simmetria
// centrale/rotazionale, con il classico tranello specchio-vs-rotazione.
//
// I distrattori non sono mai casuali: sono la stessa composizione con UN difetto
// tipico (una forma copiata invece che specchiata, una forma girata male, due
// colori scambiati) oppure una composizione simmetrica rispetto all'asse
// SBAGLIATO. Il generatore verifica sempre che esattamente una delle tre opzioni
// soddisfi la proprietà chiesta.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

// Il tipo non è ancora registrato in QuestionType (lo fa il coordinatore):
// il doppio cast resta valido anche dopo la registrazione.

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
  // 180/270, dove riflessioni e rotazioni restano esatte al pixel.
  star: { n: 1, w0: 0 },
  pentagon: { n: 1, w0: 0 },
  triangle: { n: 1, w0: 0 },
  heart: { n: 1, w0: 0 },
  arrow: { n: 1, w0: 180 },
  moon: { n: 1, w0: 180 },
};

/** chiave strutturale: due ShapeSpec con la stessa chiave sono disegnate identiche */
function canonKey(s: ShapeSpec): string {
  const g = GEOM[s.shape];
  const tail = `|${s.color ?? 0}|${s.fillMode ?? 'solid'}|${s.size ?? 0.8}`;
  if (g.iso) return `${s.shape}|·${tail}`;
  const period = 360 / g.n;
  let a = s.rot ?? 0;
  if (s.flip) a = -a - g.w0; // il riflesso equivale a una rotazione
  a = ((a % period) + period) % period;
  return `${s.shape}|${Math.round(a * 100) / 100}${tail}`;
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

const same = (a: ShapeSpec, b: ShapeSpec) => canonKey(a) === canonKey(b);

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
/** rettangolo 2×3 */
const F6: Fmt = { n: 6, rows: 2, cols: 3, layout: 'grid' };
/** terzetto in fila (la forma centrale sta sull'asse) */
const FR3: Fmt = { n: 3, rows: 1, cols: 3, layout: 'row' };

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
    return { ...a, color: o.colors[k % o.colors.length], fillMode: o.fill };
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
// Distrattori: la composizione giusta con UN difetto tipico
// ---------------------------------------------------------------------------
type BreakHow = 'copy' | 'turn' | 'swapcolor';

interface Cand {
  shapes: ShapeSpec[];
  flaw: string;
}

function breakSym(rng: Rng, sp: ShapeSpec[], f: Fmt, kind: SymKind, how: BreakHow): Cand {
  const op = opOf(kind, f);
  const mirrorish = kind === 'V' || kind === 'H';
  const idxs = shuffle(rng, sp.map((_, i) => i));
  for (const i of idxs) {
    const out = sp.map((s) => ({ ...s }));
    if (how === 'copy') {
      const j = op.perm[i];
      if (j === i) continue;
      out[j] = { ...out[i] }; // copiata al posto di specchiata/girata
    } else if (how === 'turn') {
      out[i] = { ...out[i], rot: normRot((out[i].rot ?? 0) + 90) };
    } else {
      const j = idxs.find((k) => (sp[k].color ?? 0) !== (sp[i].color ?? 0));
      if (j === undefined) continue;
      out[i] = { ...out[i], color: sp[j].color };
      out[j] = { ...out[j], color: sp[i].color };
    }
    if (!invariant(out, op)) {
      const flaw =
        how === 'copy'
          ? mirrorish
            ? 'una forma è stata copiata invece che specchiata'
            : 'una forma non è stata girata di mezzo giro'
          : how === 'turn'
            ? 'una forma è ruotata nel verso sbagliato'
            : 'due colori sono scambiati e non si corrispondono più';
      return { shapes: out, flaw };
    }
  }
  throw new Error('impossibile rompere la simmetria');
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
  prompt: string;
  rule: string;
  /** che simmetria mostra l'esempio in cima */
  exKinds: SymKind[];
  exAvoid: SymKind[];
  /** true se la risposta giusta è quella che NON ha la proprietà */
  negative?: boolean;
}

type Variant = { key: string; formats: Fmt[]; make: (rng: Rng, f: Fmt, o: CompOpts) => VResult };

const twoOf = <T,>(rng: Rng, arr: readonly T[]): [T, T] => {
  const s = shuffle(rng, [...arr]);
  return [s[0], s[1]];
};

const BREAKS: BreakHow[] = ['copy', 'turn', 'swapcolor'];

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
      ? otherSym(rng, f, [other], { ...opts, avoid: [axis] }, `la simmetria c'è, ma con ${KIND_LABEL[other]}`)
      : otherSym(rng, f, ['C180'], { ...opts, avoid: [axis] }, 'la figura torna uguale girandola di mezzo giro, non allo specchio');
    return {
      correct,
      wrong: [w1, w2],
      target: (sp) => has(sp, f, axis),
      prompt: `Esempio in alto: figura simmetrica a specchio con ${KIND_LABEL[axis]}. Quale delle tre figure ha la stessa simmetria?`,
      rule:
        axis === 'V'
          ? 'Asse verticale: piegando la figura lungo la linea verticale centrale, le due metà devono combaciare. A destra ci vuole il RIFLESSO di ciò che sta a sinistra (stessa forma, stesso colore, ma girata come allo specchio), non una copia.'
          : 'Asse orizzontale: piegando la figura lungo la linea orizzontale centrale, sopra e sotto devono combaciare. In basso ci vuole il RIFLESSO di ciò che sta in alto, non una copia.',
      exKinds: [axis],
      exAvoid: [other],
    };
  };
}

/** d1: quale figura ha ALMENO un asse di simmetria? */
const anyAxis: Variant['make'] = (rng, f, o) => {
  const axis: SymKind = f.rows > 1 && rng() < 0.5 ? 'H' : 'V';
  const other: SymKind = axis === 'V' ? 'H' : 'V';
  const correct = makeComp(rng, f, [axis], { ...o, avoid: [other] });
  // entrambi i distrattori nascono dalla figura giusta: stesse forme, stessi
  // colori, solo un dettaglio fuori posto (così l'unica differenza è la simmetria)
  const [h1, h2] = twoOf(rng, BREAKS);
  const w1 = breakSym(rng, correct, f, axis, h1);
  const w2 = breakSym(rng, correct, f, axis, h2);
  const noAxis = (sp: ShapeSpec[]) => !has(sp, f, 'V') && !has(sp, f, 'H');
  if (!noAxis(w1.shapes) || !noAxis(w2.shapes)) throw new Error('distrattore ancora simmetrico');
  if (h1 === h2) throw new Error('distrattori uguali');
  return {
    correct,
    wrong: [w1, w2],
    target: (sp) => has(sp, f, 'V') || has(sp, f, 'H'),
    prompt:
      'Esempio in alto: una figura simmetrica. Quale delle tre ha almeno un asse di simmetria (verticale oppure orizzontale)?',
    rule:
      'Una figura è simmetrica a specchio se esiste una linea (verticale o orizzontale) che la divide in due metà che combaciano piegandola. Le altre due sono "quasi" simmetriche: basta un dettaglio fuori posto e la simmetria sparisce.',
    exKinds: [axis],
    exAvoid: [other],
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
  if (key(turned) === key(reflected) || key(lazy) === key(reflected) || key(lazy) === key(turned))
    throw new Error('distrattori non distinguibili');
  return {
    correct: reflected,
    wrong: [
      { shapes: turned, flaw: 'è la figura girata di mezzo giro, non riflessa' },
      { shapes: lazy, flaw: 'le forme hanno cambiato posto ma non sono state specchiate' },
    ],
    target: (sp) => key(sp) === key(reflected),
    prompt: 'Quale figura è l’immagine allo specchio (specchio verticale) della figura mostrata?',
    rule:
      'Allo specchio succedono DUE cose insieme: le forme si scambiano da sinistra a destra E ognuna viene girata come allo specchio. Se sposti soltanto le forme, o se giri tutta la figura di mezzo giro, il risultato è diverso.',
    exKinds: [],
    exAvoid: [],
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
    prompt: `Esempio in alto: figura simmetrica con ${KIND_LABEL[axis]}. Due delle tre figure lo sono: quale NON lo è?`,
    rule: `Qui bisogna controllare tutte e tre le figure una per una. Due sono simmetriche con ${KIND_LABEL[axis]}; nella terza ${broken.flaw}, quindi le due metà non combaciano più.`,
    exKinds: [axis],
    exAvoid: [other],
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
    prompt:
      'Quale figura è simmetrica sia con asse verticale sia con asse orizzontale? (in alto un esempio con due assi)',
    rule:
      'Servono due controlli: piegare la figura in verticale (sinistra su destra) e poi in orizzontale (sopra su sotto). Solo una figura supera tutti e due i test; le altre due ne superano uno solo.',
    exKinds: ['V', 'H'],
    exAvoid: [],
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
      prompt: `Quale figura è simmetrica con ${KIND_LABEL[axis]} ma NON con ${KIND_LABEL[other]}? (in alto un esempio)`,
      rule:
        `Attenzione al "ma non": una figura va bene solo se supera il test di ${KIND_LABEL[axis]} e FALLISCE quello di ${KIND_LABEL[other]}. ` +
        'Una delle altre due è simmetrica su entrambi gli assi (quindi è di troppo), l’altra è simmetrica sull’asse sbagliato.',
      exKinds: [axis],
      exAvoid: [other],
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
    prompt:
      'Esempio in alto: figura che resta identica se la giri di mezzo giro (180°). Quale delle tre fa la stessa cosa?',
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
    prompt:
      'Quale figura resta identica girata di 180° ma NON è simmetrica a specchio? (in alto un esempio)',
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
    prompt:
      'Esempio in alto: girandola, cioè figura che resta identica girata di un quarto di giro (90°). Quale delle tre fa la stessa cosa?',
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
    prompt:
      'Esempio in alto: figura che resta identica girata di 180°. Due figure fanno lo stesso: quale invece CAMBIA?',
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
    prompt:
      'Quale figura è simmetrica a specchio (asse verticale) ma CAMBIA se la giri di 180°? (in alto un esempio)',
    rule:
      'Specchio e mezzo giro sono due cose diverse. Serve la figura che passa il test dello specchio verticale ma fallisce quello della rotazione: se una figura ha due assi di simmetria, il mezzo giro la lascia uguale e quindi non va bene.',
    exKinds: ['V'],
    exAvoid: ['H', 'C180'],
  };
};

// ---------------------------------------------------------------------------
// Tabella delle varianti per difficoltà
// ---------------------------------------------------------------------------
const VARIANTS: Record<Difficulty, Variant[]> = {
  1: [
    { key: 'sym-v', formats: [F2, F4, FR3], make: vAxis('V') },
    { key: 'sym-h', formats: [F4, F6], make: vAxis('H') },
    { key: 'sym-any', formats: [F2, F4, FR3], make: anyAxis },
    { key: 'mirror-pair', formats: [F2, F4, FR3], make: mirrorPair },
  ],
  2: [
    { key: 'not-sym', formats: [F4, F6, FR3], make: notSym },
    { key: 'two-axes', formats: [F4, F6], make: twoAxes },
    { key: 'v-not-h', formats: [F4, F6], make: oneAxisOnly('V') },
    { key: 'h-not-v', formats: [F4, F6], make: oneAxisOnly('H') },
  ],
  3: [
    { key: 'rot180', formats: [F4, F6, FR3], make: turnHalf },
    { key: 'rot180-not-mirror', formats: [F4, F6], make: turnNotMirror },
    { key: 'rot90', formats: [F4], make: turnQuarter },
    { key: 'not-rot180', formats: [F4, F6, FR3], make: notTurnHalf },
    { key: 'mirror-not-rot180', formats: [F4, F6], make: mirrorNotTurn },
  ],
};

// formati compatibili con un insieme di simmetrie (per l'esempio in cima)
function exampleFormats(kinds: SymKind[]): Fmt[] {
  const all = [F2, F4, F6, FR3];
  return all.filter((f) => {
    if (kinds.includes('C90') && f.rows !== f.cols) return false;
    if (kinds.includes('H') && f.rows < 2) return false;
    return true;
  });
}

const cellOf = (sp: ShapeSpec[], f: Fmt, highlight = false): CellSpec => {
  const c: CellSpec = { shapes: sp, layout: f.layout };
  if (highlight) c.highlight = true;
  return c;
};

// ---------------------------------------------------------------------------
export function genSymmetry(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const variant = pick(rng, VARIANTS[difficulty]);
    const fmt = pick(rng, variant.formats);
    const colors = pickN(rng, PALETTE_IDX, 4);
    const fill: Fill = rng() < 0.25 ? 'outline' : 'solid';
    const v = variant.make(rng, fmt, { colors, fill });

    // --- unicità: la proprietà chiesta deve valere per UNA sola opzione ---
    const all = [v.correct, v.wrong[0].shapes, v.wrong[1].shapes];
    const hits = all.filter((sp) => v.target(sp)).length;
    if (hits !== 1 || !v.target(v.correct)) throw new Error('risposta non univoca');
    const keys = all.map((sp) => sp.map(canonKey).join('/'));
    if (new Set(keys).size !== 3) throw new Error('opzioni visivamente identiche');

    // --- esempio in cima (forme e colori diversi dalle opzioni) ---
    let rows: CellSpec[][];
    if (variant.key === 'mirror-pair') {
      // qui il payload è il "modello" da specchiare: si ricava dalla risposta
      const back: ShapeSpec[] = new Array(fmt.n);
      const opV = opOf('V', fmt);
      for (let i = 0; i < fmt.n; i++) back[opV.perm[i]] = mirrorV(v.correct[i]);
      rows = rng() < 0.5
        ? [[cellOf(back, fmt, true)]]
        : [[cellOf(back, fmt, true), { shapes: [], unknown: true }]];
    } else {
      const exFmts = exampleFormats(v.exKinds).filter((f) => f !== fmt);
      const exFmt = pick(rng, exFmts.length ? exFmts : exampleFormats(v.exKinds));
      const exColors = pickN(rng, PALETTE_IDX, 4);
      const exFill: Fill = rng() < 0.25 ? 'outline' : 'solid';
      const ex = makeComp(rng, exFmt, v.exKinds, { colors: exColors, fill: exFill, avoid: v.exAvoid });
      if (rng() < 0.35) {
        const ex2Fmts = exampleFormats(v.exKinds).filter((f) => f !== exFmt);
        const ex2Fmt = pick(rng, ex2Fmts.length ? ex2Fmts : [exFmt]);
        const ex2 = makeComp(rng, ex2Fmt, v.exKinds, { colors: exColors, fill: exFill, avoid: v.exAvoid });
        rows = [[cellOf(ex, exFmt, true), cellOf(ex2, ex2Fmt, true)]];
      } else {
        rows = [[cellOf(ex, exFmt, true)]];
      }
    }

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
      prompt: v.prompt,
      payload: { kind: 'cells' as const, rows, arrows: variant.key === 'mirror-pair' && rows[0].length > 1 },
      choices,
      correctIndex,
      explanation: v.rule + tail,
    };
  }, 40);
}
