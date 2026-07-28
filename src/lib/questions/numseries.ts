// Generatore "numseries": serie numerica di 5-7 elementi, l'ultimo è "?".
// d1: aritmetica (+k), geometrica (×2 / ×3), countdown (−k).
// d2: differenze crescenti (+d, +d+1, …), alternanza di due operazioni (+p / ×2),
//     quadrati e cubi di numeri consecutivi.
// d3: due serie intrecciate, Fibonacci-like (somma dei due precedenti),
//     differenze delle differenze (salti che accelerano di c ≥ 2), doppio ±b.
// Distrattori: errori tipici costruiti (ripetere l'ultima differenza, usare
// l'operazione sbagliata dell'alternanza, off-by-one della regola), mai a caso.
// Anti-ambiguità: la serie viene rigettata (e rigenerata) se una regola semplice
// alternativa — differenza costante, rapporto costante, seconde differenze
// costanti, Fibonacci, v = q·prec + b, due serie intrecciate aritmetiche —
// giustificherebbe un numero diverso dalla risposta corretta: così nessun
// distrattore è difendibile come "altra soluzione".

import type { Difficulty, Question } from '../types';
import { chance, pick, randInt, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

const MAX = 400;

interface Built {
  visible: number[];
  correct: number;
  /** due errori tipici, mai numeri a caso */
  distractors: [number, number];
  explanation: string;
}

function diffsOf(v: number[]): number[] {
  return v.slice(1).map((x, i) => x - v[i]);
}

/** passo di una progressione aritmetica, o null se i passi non sono costanti */
function constStep(arr: number[]): number | null {
  if (arr.length < 2) return null;
  const d = arr[1] - arr[0];
  return arr.every((x, i) => i === 0 || x - arr[i - 1] === d) ? d : null;
}

/**
 * Tutti i "prossimi numeri" giustificabili da una regola semplice sui numeri
 * visibili. Se uno di questi differisce dalla risposta voluta, la serie è
 * ambigua e va rigenerata.
 */
function altNexts(v: number[]): number[] {
  const out: number[] = [];
  const n = v.length;
  const last = v[n - 1];
  const prev = v[n - 2];
  const d = diffsOf(v);
  // differenza costante
  const cd = constStep(v);
  if (cd !== null) out.push(last + cd);
  // rapporto costante (su interi positivi, con risultato intero)
  if (v.every((x) => x > 0) && v.every((x, i) => i === 0 || x * v[0] === v[i - 1] * v[1])) {
    if ((last * v[1]) % v[0] === 0) out.push((last * v[1]) / v[0]);
  }
  // seconde differenze costanti
  const sd = constStep(d);
  if (sd !== null) out.push(last + d[d.length - 1] + sd);
  // Fibonacci: ogni numero è la somma dei due precedenti
  if (v.every((x, i) => i < 2 || x === v[i - 1] + v[i - 2])) out.push(last + prev);
  // affine: v(i) = q·v(i−1) + b
  for (const q of [2, 3]) {
    const b = v[1] - q * v[0];
    if (v.every((x, i) => i === 0 || x === q * v[i - 1] + b)) out.push(q * last + b);
  }
  // due serie intrecciate, entrambe aritmetiche
  const even = v.filter((_, i) => i % 2 === 0);
  const odd = v.filter((_, i) => i % 2 === 1);
  const chainNext = n % 2 === 0 ? even : odd;
  const chainOther = n % 2 === 0 ? odd : even;
  if (chainNext.length >= 2 && chainOther.length >= 3) {
    const dn = constStep(chainNext);
    if (dn !== null && constStep(chainOther) !== null) out.push(chainNext[chainNext.length - 1] + dn);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Difficoltà 1: una regola semplice
// ---------------------------------------------------------------------------

function buildD1(rng: Rng): Built {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) {
    // aritmetica: +k
    const k = randInt(rng, 2, 9);
    const s = randInt(rng, 1, 40);
    const n = randInt(rng, 5, 6);
    const visible = Array.from({ length: n }, (_, i) => s + i * k);
    const last = visible[n - 1];
    const correct = last + k;
    return {
      visible,
      correct,
      // salta un passo (applica +k due volte); errore di conto di 1
      distractors: [last + 2 * k, correct + pick(rng, [-1, 1])],
      explanation: `Regola: si aggiunge sempre ${k} (${visible[0]} + ${k} = ${visible[1]}, e così via); quindi ${last} + ${k} = ${correct}.`,
    };
  }
  if (kind === 1) {
    // geometrica: ×2 oppure ×3
    const r = chance(rng, 0.3) ? 3 : 2;
    let s: number;
    let n: number;
    if (r === 3) {
      s = randInt(rng, 1, 4);
      n = 4;
    } else {
      n = randInt(rng, 5, 6);
      s = randInt(rng, 2, n === 5 ? 12 : 6);
    }
    const visible = Array.from({ length: n }, (_, i) => s * r ** i);
    const last = visible[n - 1];
    const prev = visible[n - 2];
    const correct = last * r;
    return {
      visible,
      correct,
      // ripete l'ultima differenza invece di moltiplicare; somma r invece di moltiplicare
      distractors: [last + (last - prev), last + r],
      explanation: `Regola: ogni numero è il ${r === 2 ? 'doppio' : 'triplo'} del precedente; quindi ${last} × ${r} = ${correct}.`,
    };
  }
  // countdown: −k
  const k = randInt(rng, 2, 9);
  const n = randInt(rng, 5, 6);
  const correct = randInt(rng, k, 30);
  const visible = Array.from({ length: n }, (_, i) => correct + (n - i) * k);
  const last = visible[n - 1];
  return {
    visible,
    correct,
    // salta un passo (toglie 2k); errore di conto di 1
    distractors: [last - 2 * k, correct + pick(rng, [-1, 1])],
    explanation: `Regola: si toglie sempre ${k} (${visible[0]} − ${k} = ${visible[1]}, e così via); quindi ${last} − ${k} = ${correct}.`,
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 2: due regole combinate o regola sottile
// ---------------------------------------------------------------------------

function buildD2(rng: Rng): Built {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) {
    // differenze crescenti: +d, +d+1, +d+2, …
    const d0 = randInt(rng, 1, 5);
    const s = randInt(rng, 1, 20);
    const n = randInt(rng, 5, 6);
    const visible = [s];
    for (let i = 0; i < n - 1; i++) visible.push(visible[i] + d0 + i);
    const last = visible[n - 1];
    const step = d0 + n - 1; // salto verso la risposta
    const correct = last + step;
    return {
      visible,
      correct,
      // ripete l'ultimo salto (+step−1); aumenta il salto di 2 invece che di 1
      distractors: [correct - 1, correct + 1],
      explanation: `Regola: i salti crescono di 1 a ogni passo (+${d0}, +${d0 + 1}, +${d0 + 2}, …); l'ultimo salto è +${step}; quindi ${last} + ${step} = ${correct}.`,
    };
  }
  if (kind === 1) {
    // alternanza di due operazioni: +p e ×2
    const p = randInt(rng, 3, 9);
    const q = 2;
    const startAdd = chance(rng, 0.5);
    const s = randInt(rng, 1, 6);
    const n = randInt(rng, 5, 6);
    const vals = [s];
    for (let t = 0; t < n; t++) {
      const add = t % 2 === 0 ? startAdd : !startAdd;
      vals.push(add ? vals[t] + p : vals[t] * q);
    }
    const visible = vals.slice(0, n);
    const correct = vals[n];
    const last = visible[n - 1];
    const nextAdd = (n - 1) % 2 === 0 ? startAdd : !startAdd;
    const distractors: [number, number] = nextAdd
      ? [last * q, last + q] // operazione sbagliata; aggiunge il 2 del "×2" invece di p
      : [last + p, last * q + p]; // operazione sbagliata; applica entrambe le operazioni
    return {
      visible,
      correct,
      distractors,
      explanation: `Regola: la serie alterna «+${p}» e «×${q}». Dopo «${nextAdd ? `×${q}` : `+${p}`}» tocca a «${nextAdd ? `+${p}` : `×${q}`}»: ${last} ${nextAdd ? `+ ${p}` : `× ${q}`} = ${correct}.`,
    };
  }
  // quadrati o cubi di numeri consecutivi
  const cube = chance(rng, 0.35);
  if (!cube) {
    const m0 = randInt(rng, 1, 15);
    const n = 5;
    const visible = Array.from({ length: n }, (_, i) => (m0 + i) ** 2);
    const M = m0 + n - 1;
    const last = visible[n - 1];
    const prev = visible[n - 2];
    const correct = (M + 1) ** 2;
    return {
      visible,
      correct,
      // ripete l'ultima differenza (salto dispari precedente); salto dispari successivo
      distractors: [last + (last - prev), correct + 2],
      explanation: `Regola: sono i quadrati di numeri consecutivi (${m0}² = ${m0 ** 2}, ${m0 + 1}² = ${(m0 + 1) ** 2}, …); il prossimo è ${M + 1}² = ${correct}.`,
    };
  }
  const m0 = randInt(rng, 1, 3);
  const n = m0 === 3 ? 4 : 5;
  const visible = Array.from({ length: n }, (_, i) => (m0 + i) ** 3);
  const M = m0 + n - 1;
  const last = visible[n - 1];
  const d = diffsOf(visible);
  const lastDiff = d[d.length - 1];
  const lastSd = lastDiff - d[d.length - 2];
  const correct = (M + 1) ** 3;
  return {
    visible,
    correct,
    // ripete l'ultima differenza; continua le seconde differenze come costanti
    distractors: [last + lastDiff, last + lastDiff + lastSd],
    explanation: `Regola: sono i cubi di numeri consecutivi (${m0}³ = ${m0 ** 3}, ${m0 + 1}³ = ${(m0 + 1) ** 3}, …); il prossimo è ${M + 1}³ = ${correct}.`,
  };
}

// ---------------------------------------------------------------------------
// Difficoltà 3: regole intrecciate / accelerate / astratte
// ---------------------------------------------------------------------------

function buildD3(rng: Rng): Built {
  const kind = randInt(rng, 0, 3);
  if (kind === 0) {
    // due serie intrecciate: A cresce di da, B cresce o cala di db (≠ da)
    const da = randInt(rng, 2, 9);
    const a0 = randInt(rng, 2, 20);
    const desc = chance(rng, 0.4);
    let db = desc ? randInt(rng, 2, Math.min(9, a0 + 2 * da - 1)) : randInt(rng, 2, 9);
    if (db === da) db = da === 9 ? 2 : da + 1;
    const stepB = desc ? -db : db;
    const b0 = desc ? randInt(rng, 3 * db + 2, 3 * db + 40) : randInt(rng, 2, 30);
    const a = [a0, a0 + da, a0 + 2 * da];
    const b = [b0, b0 + stepB, b0 + 2 * stepB];
    const visible = [a[0], b[0], a[1], b[1], a[2], b[2]];
    const correct = a0 + 3 * da;
    return {
      visible,
      correct,
      // continua la serie sbagliata (B); usa il passo di B sulla serie A
      distractors: [b[2] + stepB, a[2] + stepB],
      explanation: `Regola: due serie si alternano: il 1º, 3º e 5º numero (${a[0]}, ${a[1]}, ${a[2]}) crescono di ${da}; il 2º, 4º e 6º (${b[0]}, ${b[1]}, ${b[2]}) ${desc ? 'calano' : 'crescono'} di ${db}. Il «?» continua la prima serie: ${a[2]} + ${da} = ${correct}.`,
    };
  }
  if (kind === 1) {
    // Fibonacci-like: ogni numero è la somma dei due precedenti
    const s1 = randInt(rng, 1, 8);
    const s2 = s1 + randInt(rng, 1, 7);
    const n = randInt(rng, 5, 6);
    const vals = [s1, s2];
    while (vals.length <= n) vals.push(vals[vals.length - 1] + vals[vals.length - 2]);
    const visible = vals.slice(0, n);
    const last = visible[n - 1];
    const prev = visible[n - 2];
    const correct = vals[n];
    return {
      visible,
      correct,
      // ripete l'ultima differenza; raddoppia invece di sommare i due precedenti
      distractors: [2 * last - prev, 2 * last],
      explanation: `Regola: ogni numero è la somma dei due precedenti (${visible[0]} + ${visible[1]} = ${visible[2]}, …); quindi ${prev} + ${last} = ${correct}.`,
    };
  }
  if (kind === 2) {
    // differenze delle differenze: i salti accelerano di c ≥ 2
    const d0 = randInt(rng, 2, 9);
    const c = randInt(rng, 2, 5);
    const s = randInt(rng, 1, 30);
    const n = randInt(rng, 5, 6);
    const visible = [s];
    for (let i = 0; i < n - 1; i++) visible.push(visible[i] + d0 + i * c);
    const last = visible[n - 1];
    const step = d0 + (n - 1) * c;
    const correct = last + step;
    return {
      visible,
      correct,
      // ripete l'ultimo salto (senza accelerare); accelera due volte
      distractors: [correct - c, correct + c],
      explanation: `Regola: i salti aumentano di ${c} a ogni passo (+${d0}, +${d0 + c}, +${d0 + 2 * c}, …); l'ultimo salto è +${step}; quindi ${last} + ${step} = ${correct}.`,
    };
  }
  // doppio ±b: v = 2·prec + b
  const b = pick(rng, [1, 2, 3, -1]);
  const s = b === -1 ? randInt(rng, 2, 6) : randInt(rng, 1, 5);
  const vals = [s];
  for (let i = 0; i < 6; i++) vals.push(vals[i] * 2 + b);
  const n = vals[6] > MAX ? 5 : 6;
  const visible = vals.slice(0, n);
  const last = visible[n - 1];
  const prev = visible[n - 2];
  const correct = vals[n];
  const sign = b > 0 ? '+' : '−';
  const ab = Math.abs(b);
  return {
    visible,
    correct,
    // dimentica il ±b (raddoppia soltanto); continua con l'ultima differenza
    distractors: [last * 2, last + (last - prev)],
    explanation: `Regola: ogni numero è il doppio del precedente ${b > 0 ? `più ${b}` : `meno ${ab}`} (${visible[0]} × 2 ${sign} ${ab} = ${visible[1]}); quindi ${last} × 2 ${sign} ${ab} = ${correct}.`,
  };
}

// ---------------------------------------------------------------------------

export function genNumseries(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const built = difficulty === 1 ? buildD1(rng) : difficulty === 2 ? buildD2(rng) : buildD3(rng);
    const { visible, correct, distractors, explanation } = built;
    // sanità: interi, non negativi, risultato entro il tetto
    if ([...visible, correct].some((x) => !Number.isInteger(x) || x < 0 || x > MAX)) {
      throw new Error('serie fuori range');
    }
    if (distractors.some((x) => !Number.isInteger(x) || x < 0)) throw new Error('distrattore fuori range');
    if (distractors[0] === correct || distractors[1] === correct || distractors[0] === distractors[1]) {
      throw new Error('opzioni non distinte');
    }
    // anti-ambiguità: nessuna regola semplice alternativa deve dare un altro numero
    for (const alt of altNexts(visible)) if (alt !== correct) throw new Error('serie ambigua');
    const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(correct) }, [
      { kind: 'text', text: String(distractors[0]) },
      { kind: 'text', text: String(distractors[1]) },
    ]);
    return {
      qtype: 'numseries' as const,
      difficulty,
      prompt: 'Quale numero continua la serie?',
      payload: { kind: 'numbers' as const, seq: [...visible, '?'] },
      choices,
      correctIndex,
      explanation,
    };
  });
}
