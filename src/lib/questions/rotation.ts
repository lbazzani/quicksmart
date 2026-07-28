// Generatore "rotation": rotazione mentale di una composizione 2×2 asimmetrica.
// Il payload mostra UNA cella (layout 'grid', 4 forme in ordine [alto-sx,
// alto-dx, basso-sx, basso-dx]); la risposta corretta è la stessa composizione
// ruotata di 90/180/270°. I distrattori sono costruiti ad arte: l'immagine
// SPECCHIATA (colonne scambiate + flip e rot invertita su ogni forma) e una
// versione con ERRORE (posizioni ruotate ma forme non girate su sé stesse,
// oppure due forme scambiate di posto).
// Univocità garantita: i 4 colori sono sempre tutti diversi, quindi ogni
// rotazione produce una disposizione di colori unica; lo specchio [c1,c0,c3,c2]
// e lo scambio (trasposizione ∘ rotazione = permutazione mai ciclica) non
// coincidono MAI con una rotazione valida. Il distrattore "rot non aggiornate"
// è usato solo se almeno una forma cambia aspetto sotto l'angolo scelto.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { chance, pick, pickN, randInt, shuffle, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

interface Slot {
  shape: ShapeName;
  color: number;
  rot: number;
  flip?: boolean;
}

/** permutazione degli slot [alto-sx, alto-dx, basso-sx, basso-dx] per rotazione oraria */
const PERM: Record<90 | 180 | 270, [number, number, number, number]> = {
  90: [2, 0, 3, 1], // nuovo ordine: [basso-sx, alto-sx, basso-dx, alto-dx]
  180: [3, 2, 1, 0],
  270: [1, 3, 0, 2],
};

/** forme molto riconoscibili per la difficoltà 1 */
const D1_POOL: ShapeName[] = ['circle', 'square', 'triangle', 'star', 'heart', 'cross', 'arrow'];
const D2_POOL: ShapeName[] = ['circle', 'square', 'triangle', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross', 'arrow'];
/** coppie di forme facili da confondere (difficoltà 2) */
const SIMILAR: [ShapeName, ShapeName][] = [
  ['square', 'diamond'],
  ['pentagon', 'hexagon'],
  ['star', 'pentagon'],
  ['circle', 'dot'],
];
/** forme direzionali dove la rotazione interna è ben visibile (difficoltà 3) */
const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];

/** periodo di simmetria visiva della forma (per rotazioni a passi di 90°) */
function rotPeriod(shape: ShapeName): number {
  switch (shape) {
    case 'circle':
    case 'dot':
    case 'square':
    case 'diamond':
    case 'cross':
      return 90; // aspetto invariato sotto ogni rotazione di 90°
    case 'hexagon':
      return 180;
    default:
      return 360; // triangle, arrow, moon, star, pentagon, heart: sempre visibile
  }
}

/** composizione ruotata in senso orario: slot permutati e ogni forma con rot+θ */
function rotateSlots(slots: Slot[], theta: 90 | 180 | 270): Slot[] {
  return PERM[theta].map((i) => ({ ...slots[i], rot: normRot(slots[i].rot + theta) }));
}

/** specchio orizzontale: colonne scambiate, ogni forma con flip:true e rot invertita */
function mirrorSlots(slots: Slot[]): Slot[] {
  return [1, 0, 3, 2].map((i) => ({ ...slots[i], rot: normRot(-slots[i].rot), flip: true }));
}

function toCell(slots: Slot[], size: number): CellSpec {
  return {
    layout: 'grid',
    shapes: slots.map((s) => {
      const spec: ShapeSpec = { shape: s.shape, color: s.color, size, fillMode: 'solid' };
      if (s.rot) spec.rot = s.rot;
      if (s.flip) spec.flip = true;
      return spec;
    }),
  };
}

function buildShapes(rng: Rng, difficulty: Difficulty): { shapes: ShapeName[]; rots: number[] } {
  if (difficulty === 1) {
    // forme molto distinte, tutte "dritte"
    return { shapes: pickN(rng, D1_POOL, 4), rots: [0, 0, 0, 0] };
  }
  if (difficulty === 2) {
    // forme in parte simili: una forma ripetuta (colori diversi) o una coppia confondibile
    let shapes: ShapeName[];
    if (chance(rng, 0.5)) {
      const [a, b, c] = pickN(rng, D2_POOL, 3);
      shapes = shuffle(rng, [a, a, b, c]);
    } else {
      const pair = pick(rng, SIMILAR);
      const others = pickN(rng, D2_POOL.filter((s) => s !== pair[0] && s !== pair[1]), 2);
      shapes = shuffle(rng, [pair[0], pair[1], others[0], others[1]]);
    }
    return { shapes, rots: [0, 0, 0, 0] };
  }
  // difficoltà 3: solo forme direzionali, con orientamenti iniziali casuali:
  // anche le rotazioni interne vanno controllate una per una
  return {
    shapes: Array.from({ length: 4 }, () => pick(rng, ROTATABLE)),
    rots: Array.from({ length: 4 }, () => pick(rng, [0, 90, 180, 270])),
  };
}

function explain(theta: 90 | 180 | 270, keepRotsTrap: boolean): string {
  const rotText =
    theta === 90
      ? "La composizione è ruotata di 90° in senso orario, come girare una carta di un quarto di giro: la forma in alto a sinistra finisce in alto a destra e ogni forma gira su sé stessa di 90°."
      : theta === 180
        ? "La composizione è ruotata di 180°, come capovolgere una carta: ogni forma salta nell'angolo opposto e si ritrova a testa in giù."
        : "La composizione è ruotata di 270° in senso orario, cioè di un quarto di giro in senso antiorario: la forma in alto a sinistra finisce in basso a sinistra e ogni forma gira su sé stessa.";
  const trapText = keepRotsTrap
    ? "Attenzione alle trappole: un'opzione è l'immagine allo specchio (destra e sinistra scambiate: non è una rotazione!), nell'altra le forme sono nelle posizioni giuste ma non sono girate su sé stesse."
    : "Attenzione alle trappole: un'opzione è l'immagine allo specchio (destra e sinistra scambiate: non è una rotazione!), nell'altra due forme sono scambiate di posto.";
  return rotText + ' ' + trapText;
}

export function genRotation(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const theta: 90 | 180 | 270 =
      difficulty === 1
        ? 180
        : difficulty === 2
          ? pick(rng, [90, 270] as const)
          : pick(rng, [90, 180, 270] as const);
    // 4 colori TUTTI diversi: rendono la composizione asimmetrica (nessuna
    // simmetria di rotazione/riflessione) e ogni opzione tracciabile
    const colors = pickN(rng, [0, 1, 2, 3, 4, 5, 6, 7], 4);
    const { shapes, rots } = buildShapes(rng, difficulty);
    const base: Slot[] = shapes.map((shape, i) => ({ shape, color: colors[i], rot: rots[i] }));

    const correct = rotateSlots(base, theta);
    const mirrored = mirrorSlots(base);

    // distrattore-errore: posizioni ruotate ma rotazioni interne non aggiornate
    // (solo se la differenza è visibile), altrimenti due forme scambiate
    const keepRotsVisible = base.some((s) => theta % rotPeriod(s.shape) !== 0);
    const useKeepRots = keepRotsVisible && difficulty >= 2 && chance(rng, 0.55);
    let error: Slot[];
    if (useKeepRots) {
      error = PERM[theta].map((i) => ({ ...base[i] }));
    } else {
      const i = randInt(rng, 0, 3);
      const j = (i + randInt(rng, 1, 3)) % 4;
      error = correct.map((s) => ({ ...s }));
      [error[i], error[j]] = [error[j], error[i]];
    }

    // guardia di sicurezza: nessun distrattore deve avere la disposizione di
    // colori di una rotazione valida (con 4 colori distinti non accade mai)
    const rotationTuples = new Set<string>([
      base.map((s) => s.color).join(),
      ...([90, 180, 270] as const).map((t) => rotateSlots(base, t).map((s) => s.color).join()),
    ]);
    if (rotationTuples.has(mirrored.map((s) => s.color).join())) throw new Error('specchio ≡ rotazione');
    if (!useKeepRots && rotationTuples.has(error.map((s) => s.color).join())) throw new Error('errore ≡ rotazione');

    const size = pick(rng, [0.7, 0.8]);
    const { choices, correctIndex } = placeChoices(
      rng,
      { kind: 'cell', cell: toCell(correct, size) },
      [
        { kind: 'cell', cell: toCell(mirrored, size) },
        { kind: 'cell', cell: toCell(error, size) },
      ]
    );
    return {
      qtype: 'rotation' as const,
      difficulty,
      prompt: 'Quale opzione mostra la STESSA figura ruotata?',
      payload: { kind: 'cells' as const, rows: [[toCell(base, size)]] },
      choices,
      correctIndex,
      explanation: explain(theta, useKeepRots),
    };
  });
}
