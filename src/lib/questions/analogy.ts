// Generatore "analogy": analogia visiva "A sta a B come C sta a ?".
// La trasformazione che porta da A a B va riapplicata a C, che però ha forma
// e colore DIVERSI da A: l'analogia trasferisce la trasformazione, non gli
// attributi. Per garantire una risposta UNIVOCA, C parte con gli stessi
// attributi "di stato" di A (rotazione, conteggio, dimensione, riempimento):
// così ogni lettura della regola porta alla stessa risposta.
// Difficoltà 1: una trasformazione evidente. 2: due trasformazioni combinate.
// 3: trasformazione relativa sottile (conteggio+rotazione insieme, scambio di
// colori o di dimensioni tra le due forme della cella).
// Distrattori costruiti ad arte: copia letterale di B (l'errore classico),
// trasformazione parziale (solo una delle due), direzione opposta. Mai casuali.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, randInt, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];
const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];
const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

const SIZE_S = 0.3;
const SIZE_M = 0.55;
const SIZE_L = 0.8;
const PAIR_S = 0.4;
const PAIR_L = 0.85;

type TransformId = 'rot90' | 'rot180' | 'double' | 'half' | 'add' | 'grow' | 'shrink' | 'fillToggle';

/** modello astratto di una cella "semplice": count copie della stessa forma */
interface Model {
  shape: ShapeName;
  color: number;
  count: number;
  rot: number;
  size?: number;
  fill: 'solid' | 'outline';
}

function render(m: Model): CellSpec {
  const spec: ShapeSpec = { shape: m.shape, color: m.color, fillMode: m.fill };
  const rot = normRot(m.rot);
  if (rot) spec.rot = rot;
  if (m.size !== undefined) spec.size = m.size;
  const shapes = Array.from({ length: m.count }, () => ({ ...spec }));
  const layout: CellSpec['layout'] = m.count === 1 ? 'auto' : m.count >= 4 ? 'grid' : 'row';
  return { shapes, layout };
}

function applyOne(m: Model, t: TransformId): Model {
  switch (t) {
    case 'rot90':
      return { ...m, rot: normRot(m.rot + 90) };
    case 'rot180':
      return { ...m, rot: normRot(m.rot + 180) };
    case 'double':
      return { ...m, count: m.count * 2 };
    case 'half':
      return { ...m, count: m.count / 2 };
    case 'add':
      return { ...m, count: m.count + 1 };
    case 'grow':
      return { ...m, size: SIZE_L };
    case 'shrink':
      return { ...m, size: SIZE_S };
    case 'fillToggle':
      return { ...m, fill: m.fill === 'solid' ? 'outline' : 'solid' };
  }
}

function applyAll(m: Model, ts: TransformId[]): Model {
  return ts.reduce(applyOne, m);
}

/**
 * Errore plausibile su una singola trasformazione, applicato al modello C di
 * partenza: direzione opposta, un passo in meno/in più, o trasformazione
 * dimenticata. Mai un valore casuale.
 */
function wrongSingle(rng: Rng, c: Model, t: TransformId): Model {
  switch (t) {
    case 'rot90':
      return { ...c, rot: normRot(c.rot - 90) }; // ruota in direzione opposta
    case 'rot180':
      return { ...c, rot: normRot(c.rot + 90) }; // fa solo un quarto di giro
    case 'double':
      return { ...c, count: pick(rng, [1, 3]) }; // dimezza, o resta a una in meno (da 2: corretto 4)
    case 'half':
      return { ...c, count: pick(rng, [1, 3]) }; // dimezza due volte, o toglie una sola figura (da 4: corretto 2)
    case 'add':
      return c.count === 1 ? { ...c, count: 3 } : { ...c, count: c.count - 1 }; // ne aggiunge due / ne toglie una
    case 'grow':
      return { ...c, size: SIZE_S }; // rimpicciolisce invece di ingrandire
    case 'shrink':
      return { ...c, size: SIZE_L }; // ingrandisce invece di rimpicciolire
    case 'fillToggle':
      return { ...c }; // dimentica la trasformazione (C invariata)
  }
}

function describeT(t: TransformId, a: Model): string {
  switch (t) {
    case 'rot90':
      return 'ogni figura ruota di 90° in senso orario';
    case 'rot180':
      return 'ogni figura fa mezzo giro (180°)';
    case 'double':
      return `il numero di figure raddoppia (da ${a.count} a ${a.count * 2})`;
    case 'half':
      return `il numero di figure si dimezza (da ${a.count} a ${a.count / 2})`;
    case 'add':
      return `si aggiunge una figura (da ${a.count} a ${a.count + 1})`;
    case 'grow':
      return 'la figura diventa più grande';
    case 'shrink':
      return 'la figura diventa più piccola';
    case 'fillToggle':
      return a.fill === 'solid' ? 'la figura piena diventa vuota (solo contorno)' : 'la figura vuota diventa piena';
  }
}

function explain(ts: TransformId[], a: Model): string {
  const parts = ts.map((t) => describeT(t, a));
  return (
    `Da A a B ${parts.join(' e ')}. Il trucco è applicare a C la stessa trasformazione, ` +
    'senza farsi ingannare dalla copia di B (che ha ancora la forma e il colore di A).'
  );
}

/**
 * Costruisce A e C: stessi attributi di partenza (conteggio, rotazione,
 * dimensione, riempimento) ma forma e colore diversi. Questo rende la
 * risposta univoca: qualunque lettura della regola A→B dà lo stesso esito su C.
 */
function makeBase(rng: Rng, ts: TransformId[]): { a: Model; c: Model } {
  const needRot = ts.includes('rot90') || ts.includes('rot180');
  const pool = needRot ? ROTATABLE : PLAIN;
  const [shapeA, shapeC] = pickN(rng, pool, 2);
  const [colA, colC] = pickN(rng, COLORS, 2);
  const count = ts.includes('double') ? 2 : ts.includes('half') ? 4 : ts.includes('add') ? randInt(rng, 1, 3) : 1;
  const rot = needRot ? pick(rng, [0, 90, 180, 270]) : 0;
  const size = ts.includes('grow') || ts.includes('shrink') ? SIZE_M : undefined;
  const fill = pick(rng, ['solid', 'outline'] as const);
  const a: Model = { shape: shapeA, color: colA, count, rot, fill };
  const c: Model = { shape: shapeC, color: colC, count, rot, fill };
  if (size !== undefined) {
    a.size = size;
    c.size = size;
  }
  return { a, c };
}

function assemble(
  rng: Rng,
  difficulty: Difficulty,
  cellA: CellSpec,
  cellB: CellSpec,
  cellC: CellSpec,
  correct: CellSpec,
  distractors: [CellSpec, CellSpec],
  explanation: string
): Question {
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'cell', cell: correct },
    [
      { kind: 'cell', cell: distractors[0] },
      { kind: 'cell', cell: distractors[1] },
    ]
  );
  return {
    qtype: 'analogy' as const,
    difficulty,
    prompt: 'A sta a B come C sta a...?',
    payload: {
      kind: 'cells' as const,
      analogy: true,
      rows: [
        [cellA, cellB],
        [cellC, { shapes: [], unknown: true } as CellSpec],
      ],
    },
    choices,
    correctIndex,
    explanation,
  };
}

/** costruisce la domanda per una lista di trasformazioni, con distrattore "errore" dato */
function buildFromTransforms(
  rng: Rng,
  difficulty: Difficulty,
  ts: TransformId[],
  wrongOf: (c: Model) => Model
): Question {
  const { a, c } = makeBase(rng, ts);
  const b = applyAll(a, ts);
  const correct = applyAll(c, ts);
  const wrong = wrongOf(c);
  // distrattore 1: copia letterale di B (renderizzata di nuovo: oggetto fresco)
  return assemble(rng, difficulty, render(a), render(b), render(c), render(correct), [render(b), render(wrong)], explain(ts, a));
}

// ---------------------------------------------------------------------------
// Difficoltà 1: una trasformazione evidente
// ---------------------------------------------------------------------------

const SINGLE_POOL: TransformId[] = ['rot90', 'rot180', 'double', 'half', 'add', 'grow', 'shrink', 'fillToggle'];

function genEasy(rng: Rng, difficulty: Difficulty): Question {
  const t = pick(rng, SINGLE_POOL);
  return buildFromTransforms(rng, difficulty, [t], (c) => wrongSingle(rng, c, t));
}

// ---------------------------------------------------------------------------
// Difficoltà 2: due trasformazioni combinate
// ---------------------------------------------------------------------------

function genMedium(rng: Rng, difficulty: Difficulty): Question {
  const kind = randInt(rng, 0, 4);
  let ts: [TransformId, TransformId];
  if (kind === 0) ts = [pick(rng, ['rot90', 'rot180'] as const), 'fillToggle'];
  else if (kind === 1) ts = ['rot90', pick(rng, ['grow', 'shrink'] as const)];
  else if (kind === 2) ts = [pick(rng, ['double', 'add'] as const), 'fillToggle'];
  else if (kind === 3) ts = [pick(rng, ['grow', 'shrink'] as const), 'fillToggle'];
  else ts = ['add', pick(rng, ['grow', 'shrink'] as const)];
  // distrattore "errore": trasformazione parziale (applica solo una delle due)
  const partial = ts[randInt(rng, 0, 1)];
  return buildFromTransforms(rng, difficulty, ts, (c) => applyOne(c, partial));
}

// ---------------------------------------------------------------------------
// Difficoltà 3: trasformazione relativa sottile
// ---------------------------------------------------------------------------

function pairCell(s1: ShapeSpec, s2: ShapeSpec): CellSpec {
  return { shapes: [s1, s2], layout: 'row' };
}

/** il conteggio raddoppia (o si dimezza) E ogni figura ruota di 90° */
function genHardCombo(rng: Rng, difficulty: Difficulty): Question {
  const ts: [TransformId, TransformId] = [pick(rng, ['double', 'half'] as const), 'rot90'];
  const partial = ts[randInt(rng, 0, 1)];
  return buildFromTransforms(rng, difficulty, ts, (c) => applyOne(c, partial));
}

/** le due figure della cella si scambiano i colori (restando al loro posto) */
function genSwapColor(rng: Rng, difficulty: Difficulty): Question {
  const [s1, s2, s3, s4] = pickN(rng, PLAIN, 4);
  const [c1, c2, c3, c4] = pickN(rng, COLORS, 4);
  const mk = (shape: ShapeName, color: number): ShapeSpec => ({ shape, color, fillMode: 'solid' });
  const A = pairCell(mk(s1, c1), mk(s2, c2));
  const B = pairCell(mk(s1, c2), mk(s2, c1));
  const C = pairCell(mk(s3, c3), mk(s4, c4));
  const correct = pairCell(mk(s3, c4), mk(s4, c3));
  const copyB = pairCell(mk(s1, c2), mk(s2, c1)); // errore classico: copiare B
  const posSwap = pairCell(mk(s4, c4), mk(s3, c3)); // scambia le posizioni invece dei colori
  return assemble(
    rng,
    difficulty,
    A,
    B,
    C,
    correct,
    [copyB, posSwap],
    'Da A a B le due figure si scambiano i colori restando ognuna al suo posto. ' +
      'Lo stesso scambio va applicato alla coppia C: stesse forme nello stesso ordine, ma colori invertiti. ' +
      'Il trucco: non copiare B e non scambiare le posizioni delle forme.'
  );
}

/** le due figure della cella si scambiano le dimensioni (grande <-> piccola) */
function genSwapSize(rng: Rng, difficulty: Difficulty): Question {
  const [s1, s2, s3, s4] = pickN(rng, PLAIN, 4);
  const [c1, c2, c3, c4] = pickN(rng, COLORS, 4);
  const bigFirst = pick(rng, [true, false]);
  const [z1, z2] = bigFirst ? [PAIR_L, PAIR_S] : [PAIR_S, PAIR_L];
  const mk = (shape: ShapeName, color: number, size: number): ShapeSpec => ({ shape, color, size, fillMode: 'solid' });
  const A = pairCell(mk(s1, c1, z1), mk(s2, c2, z2));
  const B = pairCell(mk(s1, c1, z2), mk(s2, c2, z1));
  const C = pairCell(mk(s3, c3, z1), mk(s4, c4, z2));
  const correct = pairCell(mk(s3, c3, z2), mk(s4, c4, z1));
  const copyB = pairCell(mk(s1, c1, z2), mk(s2, c2, z1)); // errore classico: copiare B
  const partial = pairCell(mk(s3, c3, z2), mk(s4, c4, z2)); // solo la prima figura cambia dimensione
  return assemble(
    rng,
    difficulty,
    A,
    B,
    C,
    correct,
    [copyB, partial],
    'Da A a B le due figure si scambiano le dimensioni: la grande diventa piccola e la piccola diventa grande. ' +
      'Lo stesso vale per la coppia C. Il trucco: entrambe le figure cambiano dimensione, non una sola, ' +
      'e non bisogna copiare B.'
  );
}

function genHard(rng: Rng, difficulty: Difficulty): Question {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) return genHardCombo(rng, difficulty);
  if (kind === 1) return genSwapColor(rng, difficulty);
  return genSwapSize(rng, difficulty);
}

// ---------------------------------------------------------------------------

export function genAnalogy(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) return genEasy(rng, difficulty);
    if (difficulty === 2) return genMedium(rng, difficulty);
    return genHard(rng, difficulty);
  });
}
