// Generatore "clock": orologi analogici.
// Difficoltà 1: che ora sarà tra N minuti (scelte = 3 orologi).
// Difficoltà 2: orologio visto allo specchio, trovare l'ora vera (scelte testuali).
// Difficoltà 3: tra quanti minuti le lancette si sovrappongono (ogni 720/11 ≈ 65,5
// minuti, non ogni ora) oppure specchio + avanzamento di N minuti combinati.
// Distrattori costruiti ad arte: orologio N minuti indietro, errore di un'ora,
// specchio applicato solo alle ore, lettura senza specchiare, lancetta delle ore
// considerata ferma. Mai distrattori casuali.

import type { ClockSpec, Difficulty, Question } from '../types';
import { pick, pickN, randInt, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

const MOD = 720; // minuti in 12 ore

/** normalizza un tempo in minuti in [0, 720) */
function norm(t: number): number {
  return ((t % MOD) + MOD) % MOD;
}

function hourOf(t: number): number {
  return Math.floor(norm(t) / 60); // 0..11
}

function minOf(t: number): number {
  return norm(t) % 60;
}

/** formato "H:MM" con H 1..12 (mai 0) */
function fmt(t: number): string {
  const h = hourOf(t);
  return `${h === 0 ? 12 : h}:${String(minOf(t)).padStart(2, '0')}`;
}

function clockOf(t: number): ClockSpec {
  return { h: hourOf(t), m: minOf(t) };
}

/**
 * Ora "riflessa": un orologio che segna t, visto allo specchio, sembra segnare
 * mirror(t). Equivale a: minuti' = (60 - m) % 60, ore' = (11 - h + (m===0?1:0)) % 12.
 * Esempi: 3:00 ↔ 9:00, 2:30 ↔ 9:30, 4:15 ↔ 7:45, 12:00 ↔ 12:00.
 */
function mirror(t: number): number {
  return norm(MOD - t);
}

/** ora casuale con minuti multipli di 5 */
function randTime(rng: Rng): number {
  return randInt(rng, 0, 11) * 60 + randInt(rng, 0, 11) * 5;
}

const STEPS = [20, 25, 35, 40, 45, 50] as const;

// ---------------------------------------------------------------------------
// d1: "che ora segnerà tra N minuti?"
// ---------------------------------------------------------------------------

function d1(rng: Rng): Question {
  const t = randTime(rng);
  const n = pick(rng, STEPS);
  const correctT = norm(t + n);
  // distrattore 1: chi va INDIETRO di N minuti invece che avanti
  const behindT = norm(t - n);
  // distrattore 2: minuti giusti ma un'ora in più o in meno
  const hourOffT = norm(correctT + pick(rng, [60, -60]));
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'clock', clock: clockOf(correctT) },
    [
      { kind: 'clock', clock: clockOf(behindT) },
      { kind: 'clock', clock: clockOf(hourOffT) },
    ]
  );
  const m = minOf(t);
  const carry =
    m + n >= 60
      ? ` I minuti fanno ${m} + ${n} = ${m + n}, più di un giro: si scavalca l'ora.`
      : '';
  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: `Che ora segnerà l'orologio tra ${n} minuti?`,
    payload: { kind: 'clock', clocks: [clockOf(t)] },
    choices,
    correctIndex,
    explanation:
      `L'orologio segna le ${fmt(t)}: andando avanti di ${n} minuti si arriva alle ${fmt(correctT)}.${carry}` +
      ` Trappole: un orologio va ${n} minuti indietro (${fmt(behindT)}) e uno sbaglia di un'ora esatta.`,
  };
}

// ---------------------------------------------------------------------------
// d2: orologio allo specchio
// ---------------------------------------------------------------------------

function d2(rng: Rng): Question {
  const t = randTime(rng);
  // esclude i casi in cui lo specchio non cambia nulla (12:00 e 6:00)
  if (t === mirror(t)) throw new Error('specchio banale');
  const realT = mirror(t);
  const correct = fmt(realT);
  const m = minOf(t);
  const candidates: string[] = [];
  // errore di specchio classico: riflette le ore ma NON i minuti
  if (m !== 0 && m !== 30) candidates.push(fmt(hourOf(realT) * 60 + m));
  // legge l'orologio così com'è, dimenticando lo specchio
  candidates.push(fmt(t));
  // un'ora in più / in meno rispetto all'ora vera
  candidates.push(fmt(realT + 60), fmt(realT - 60));
  const distinct = [...new Set(candidates)].filter((c) => c !== correct);
  if (distinct.length < 2) throw new Error('distrattori insufficienti');
  const [a, b] = pickN(rng, distinct, 2);
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'text', text: correct },
    [
      { kind: 'text', text: a },
      { kind: 'text', text: b },
    ]
  );
  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: 'Questo orologio è visto allo specchio: che ora è davvero?',
    payload: { kind: 'clock', clocks: [{ ...clockOf(t), mirrored: true }] },
    choices,
    correctIndex,
    explanation:
      `Allo specchio destra e sinistra si scambiano: l'immagine sembra segnare le ${fmt(t)}, ma l'ora vera si ` +
      `ottiene riflettendo le lancette. I minuti diventano 60 − ${m || 60} e le ore si contano all'indietro dal 12: ` +
      `l'ora vera è le ${correct}. L'errore classico è specchiare solo la lancetta delle ore e non quella dei minuti.`,
  };
}

// ---------------------------------------------------------------------------
// d3a: tra quanti minuti le lancette si sovrappongono
// ---------------------------------------------------------------------------

function d3Overlap(rng: Rng): Question {
  const t = randTime(rng);
  // le sovrapposizioni cadono a k·720/11 minuti (k = 0..10); cerca la prossima
  let next = MOD;
  for (let k = 1; k <= 11; k++) {
    const tk = (k * MOD) / 11;
    if (tk > t + 1e-9) {
      next = tk;
      break;
    }
  }
  const exact = next - t;
  const correctN = Math.round(exact);
  // finestra "comoda": né appena passata la sovrapposizione né a ridosso
  if (correctN < 10 || correctN > 55) throw new Error('fuori finestra');
  // distrattore 1: considera FERMA la lancetta delle ore (fattore 11/12 in meno)
  const staticN = Math.round((exact * 11) / 12);
  // distrattore 2: crede che le lancette si sovrappongano ogni ora esatta
  // (aggiunge 60 alla sovrapposizione precedente invece di 720/11 ≈ 65,45)
  const hourlyN = Math.round(exact - MOD / 11 + 60);
  if (new Set([correctN, staticN, hourlyN]).size !== 3) throw new Error('distrattori coincidenti');
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'text', text: `${correctN} minuti` },
    [
      { kind: 'text', text: `${staticN} minuti` },
      { kind: 'text', text: `${hourlyN} minuti` },
    ]
  );
  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: 'Tra quanti minuti le lancette delle ore e dei minuti si sovrapporranno? (arrotonda al minuto)',
    payload: { kind: 'clock', clocks: [clockOf(t)] },
    choices,
    correctIndex,
    explanation:
      `Le lancette si sovrappongono 11 volte in 12 ore, cioè ogni 720/11 ≈ 65 minuti e mezzo, non ogni ora. ` +
      `Dopo le ${fmt(t)} la prossima sovrapposizione è verso le ${fmt(Math.round(next))}: mancano circa ${correctN} minuti. ` +
      `Chi dimentica che anche la lancetta delle ore avanza risponde ${staticN}; chi crede che si sovrappongano ` +
      `a ogni ora esatta risponde ${hourlyN}.`,
  };
}

// ---------------------------------------------------------------------------
// d3b: specchio + avanzamento combinati
// ---------------------------------------------------------------------------

function d3Mirror(rng: Rng): Question {
  const t = randTime(rng);
  if (t === mirror(t)) throw new Error('specchio banale');
  const n = pick(rng, STEPS);
  const realT = mirror(t);
  const correctT = norm(realT + n);
  const correct = fmt(correctT);
  // distrattore 1 (sempre presente): dimentica lo specchio e aggiunge N alla lettura diretta
  const forgot = fmt(t + n);
  if (forgot === correct) throw new Error('specchio banale'); // non accade: t ≠ mirror(t)
  // distrattore 2: specchia bene ma va indietro di N, oppure sbaglia di un'ora
  const others = [fmt(realT - n), fmt(correctT + 60), fmt(correctT - 60)].filter(
    (c) => c !== correct && c !== forgot
  );
  if (others.length < 1) throw new Error('distrattori insufficienti');
  const second = pick(rng, [...new Set(others)]);
  const { choices, correctIndex } = placeChoices(
    rng,
    { kind: 'text', text: correct },
    [
      { kind: 'text', text: forgot },
      { kind: 'text', text: second },
    ]
  );
  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: `Questo orologio è visto allo specchio: che ora sarà davvero tra ${n} minuti?`,
    payload: { kind: 'clock', clocks: [{ ...clockOf(t), mirrored: true }] },
    choices,
    correctIndex,
    explanation:
      `Due passi: prima si riflette l'orologio (l'immagine sembra segnare le ${fmt(t)}, quindi l'ora vera è le ` +
      `${fmt(realT)}: i minuti diventano 60 meno i minuti, le ore si contano all'indietro dal 12), poi si aggiungono ` +
      `${n} minuti: ${correct}. Chi dimentica lo specchio ottiene ${forgot}.`,
  };
}

// ---------------------------------------------------------------------------

export function genClock(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) return d1(rng);
    if (difficulty === 2) return d2(rng);
    return rng() < 0.5 ? d3Overlap(rng) : d3Mirror(rng);
  });
}
