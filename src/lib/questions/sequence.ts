// Generatore "sequence": sequenza di 4 figure + incognita, "quale viene dopo?"
// Difficoltà 1: una regola semplice. 2: due regole combinate o regola sottile.
// 3: regole accelerate/intrecciate. I distrattori violano UNA regola in modo
// plausibile (un passo in meno, direzione opposta, attributo della cella
// precedente), mai a caso.

import type { CellSpec, Difficulty, Question, ShapeName, ShapeSpec } from '../types';
import { pick, pickN, randInt, type Rng } from '../rng';
import { normRot, placeChoices, retry } from './qutils';

const ROTATABLE: ShapeName[] = ['triangle', 'arrow', 'moon'];
const PLAIN: ShapeName[] = ['circle', 'square', 'diamond', 'star', 'pentagon', 'hexagon', 'heart', 'cross'];

interface SeqRules {
  /** rotazione: passo fisso oppure accelerata */
  rotStart?: number;
  rotStep?: number;
  rotAccel?: number; // incremento del passo a ogni cella
  /** conteggio di forme nella cella */
  countStart?: number;
  countStep?: number;
  /** dimensione crescente/decrescente */
  sizeStart?: number;
  sizeStep?: number;
  /** ciclo colori */
  colors?: number[];
  /** alternanza di forme (ABAB…) */
  shapes: ShapeName[];
  /** ciclo riempimento */
  fills?: Array<'solid' | 'outline'>;
}

function cellAt(r: SeqRules, i: number): CellSpec {
  const shape = r.shapes[i % r.shapes.length];
  let rot = 0;
  if (r.rotStep !== undefined) {
    if (r.rotAccel) {
      // passo crescente: step, step+accel, step+2*accel, …
      for (let k = 0; k < i; k++) rot += r.rotStep + k * r.rotAccel;
      rot = normRot((r.rotStart ?? 0) + rot);
    } else {
      rot = normRot((r.rotStart ?? 0) + i * r.rotStep);
    }
  }
  const count = r.countStart !== undefined ? r.countStart + i * (r.countStep ?? 1) : 1;
  const size = r.sizeStart !== undefined ? +(r.sizeStart + i * (r.sizeStep ?? 0)).toFixed(2) : undefined;
  const color = r.colors ? r.colors[i % r.colors.length] : 0;
  const fillMode = r.fills ? r.fills[i % r.fills.length] : 'solid';
  const spec: ShapeSpec = { shape, color, fillMode };
  if (rot) spec.rot = rot;
  if (size !== undefined) spec.size = size;
  const shapes = Array.from({ length: count }, () => ({ ...spec }));
  return { shapes, layout: count > 1 ? 'grid' : 'auto' };
}

function describe(r: SeqRules): string {
  const parts: string[] = [];
  if (r.rotStep !== undefined) {
    parts.push(
      r.rotAccel
        ? `la rotazione aumenta a ogni passo (+${r.rotStep}°, poi +${r.rotStep + r.rotAccel}°, …)`
        : `la figura ruota di ${r.rotStep}° a ogni passo`
    );
  }
  if (r.countStart !== undefined) parts.push(`il numero di figure ${(r.countStep ?? 1) > 0 ? 'cresce' : 'cala'} di ${Math.abs(r.countStep ?? 1)} a ogni passo`);
  if (r.sizeStart !== undefined) parts.push(`la dimensione ${(r.sizeStep ?? 0) > 0 ? 'cresce' : 'diminuisce'} regolarmente`);
  if (r.colors && r.colors.length > 1) parts.push(`i colori si ripetono in ciclo`);
  if (r.shapes.length > 1) parts.push(`le forme si alternano`);
  if (r.fills && r.fills.length > 1) parts.push(`pieno e vuoto si alternano`);
  return 'Regola: ' + parts.join('; ') + '.';
}

const LEN = 5; // 4 celle visibili + 1 incognita (indice 4)

function buildRules(rng: Rng, difficulty: Difficulty): SeqRules {
  const rotShape = pick(rng, ROTATABLE);
  const steps = [45, 90, 135];
  if (difficulty === 1) {
    const kind = randInt(rng, 0, 3);
    if (kind === 0) return { shapes: [rotShape], rotStart: pick(rng, [0, 90]), rotStep: pick(rng, steps), colors: [randInt(rng, 0, 7)] };
    if (kind === 1) return { shapes: [pick(rng, PLAIN)], countStart: 1, countStep: 1, colors: [randInt(rng, 0, 7)] };
    if (kind === 2) return { shapes: [pick(rng, PLAIN)], sizeStart: 0.3, sizeStep: 0.12, colors: [randInt(rng, 0, 7)] };
    return { shapes: [pick(rng, PLAIN)], colors: pickN(rng, [0, 1, 2, 3, 4, 5], 2), fills: ['solid', 'outline'] };
  }
  if (difficulty === 2) {
    const kind = randInt(rng, 0, 3);
    if (kind === 0)
      return { shapes: [rotShape], rotStart: 0, rotStep: pick(rng, steps), colors: pickN(rng, [0, 1, 2, 3, 4, 5], 2) };
    if (kind === 1)
      return { shapes: pickN(rng, PLAIN, 2), countStart: 1, countStep: 1, colors: [randInt(rng, 0, 7)] };
    if (kind === 2)
      return { shapes: [rotShape], rotStart: 0, rotStep: pick(rng, steps), sizeStart: 0.35, sizeStep: 0.1, colors: [randInt(rng, 0, 7)] };
    return { shapes: [rotShape], rotStart: pick(rng, [0, 45]), rotStep: 45, rotAccel: 0, colors: [randInt(rng, 0, 7)], fills: ['solid', 'outline'] };
  }
  // difficoltà 3
  const kind = randInt(rng, 0, 2);
  if (kind === 0)
    return { shapes: [rotShape], rotStart: 0, rotStep: 45, rotAccel: 45, colors: [randInt(rng, 0, 7)] };
  if (kind === 1)
    return { shapes: [rotShape], rotStart: 0, rotStep: pick(rng, [45, 90]), rotAccel: 0, colors: pickN(rng, [0, 1, 2, 3, 4, 5], 3), fills: ['solid', 'outline'] };
  return { shapes: pickN(rng, PLAIN, 2), countStart: 2, countStep: 2, colors: pickN(rng, [0, 1, 2, 3, 4, 5], 2) };
}

/** distrattore: cella corretta con UNA regola violata in modo plausibile */
function makeDistractor(rng: Rng, r: SeqRules, kind: number): CellSpec {
  const variants: Array<() => CellSpec> = [
    // ripete l'ultima cella visibile (chi non applica la regola l'ultima volta)
    () => cellAt(r, LEN - 2),
    // applica la regola due volte (chi va troppo avanti)
    () => cellAt(r, LEN),
    // rotazione in direzione opposta
    () => {
      if (r.rotStep === undefined) return cellAt(r, LEN - 2);
      const alt: SeqRules = { ...r, rotStep: -r.rotStep };
      return cellAt(alt, LEN - 1);
    },
    // attributo secondario sbagliato (colore/riempimento della cella precedente)
    () => {
      const correct = cellAt(r, LEN - 1);
      const prev = cellAt(r, LEN - 2);
      const shapes = correct.shapes.map((s) => ({
        ...s,
        color: prev.shapes[0].color,
        fillMode: prev.shapes[0].fillMode,
      }));
      return { ...correct, shapes };
    },
  ];
  return variants[kind % variants.length]();
}

export function genSequence(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const rules = buildRules(rng, difficulty);
    const rows = [
      [...Array.from({ length: LEN - 1 }, (_, i) => cellAt(rules, i)), { shapes: [], unknown: true } as CellSpec],
    ];
    const correct = cellAt(rules, LEN - 1);
    const d1 = makeDistractor(rng, rules, randInt(rng, 0, 3));
    let d2 = makeDistractor(rng, rules, randInt(rng, 0, 3));
    // garantisce distrattori diversi tra loro
    for (let k = 0; k < 4 && JSON.stringify(d2) === JSON.stringify(d1); k++) {
      d2 = makeDistractor(rng, rules, k);
    }
    const { choices, correctIndex } = placeChoices(
      rng,
      { kind: 'cell', cell: correct },
      [{ kind: 'cell', cell: d1 }, { kind: 'cell', cell: d2 }]
    );
    return {
      qtype: 'sequence' as const,
      difficulty,
      prompt: 'Quale figura continua la sequenza?',
      payload: { kind: 'cells' as const, rows, arrows: true },
      choices,
      correctIndex,
      explanation: describe(rules),
    };
  });
}
