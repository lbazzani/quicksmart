// Generatore "clock": orologi analogici. Tutte le ore si leggono "H:MM" con H 1..12.
//
// Sotto-varianti di regola (ognuna con più impaginazioni: 1 orologio, 1 orologio
// + quadrante "?", 2 orologi, sequenze di 3-4 quadranti):
//  d1 — sposta di N minuti avanti/indietro; sposta di N ore intere; tempo
//       trascorso fra due orologi senza riporto sui minuti.
//  d2 — orologio allo specchio; angolo fra le lancette a ore tonde e mezz'ore;
//       orologio che va avanti/indietro di g minuti ogni ora; tempo trascorso
//       CON riporto; sequenza di orologi a passo costante; salto oltre l'ora.
//  d3 — sovrapposizione delle lancette (ogni 720/11 min, non ogni ora);
//       specchio + avanzamento; specchio confrontato con un orologio vero;
//       angolo con minuti qualsiasi (risultato intero); orologio rotto letto
//       al contrario (dall'ora segnata all'ora vera); sequenza a passo
//       crescente; tempo trascorso all'indietro con prestito.
//
// Convenzione grafica (vedi visuals.tsx): un ClockSpec con `mirrored` viene
// DISEGNATO ribaltato, quindi l'immagine che il giocatore legge è mirror(spec):
// lo spec contiene sempre l'ora VERA del quadrante.
//
// I distrattori sono errori tipici costruiti ad arte: direzione sbagliata,
// errore di un'ora esatta, minuti sommati senza riportare l'ora, sottrazione
// "in colonna" senza prestito, lancetta delle ore considerata ferma sul numero,
// specchio applicato solo alle ore, scarto dell'orologio rotto applicato una
// sola volta o nel verso sbagliato. Mai distrattori casuali.

import type { ChoiceVisual, ClockSpec, Difficulty, Question } from '../types';
import { chance, pick, randInt, type Rng } from '../rng';
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

/** durata in formato "1 h 25 min" / "45 min" / "2 h" */
function fmtDur(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function clockOf(t: number, label?: string): ClockSpec {
  const c: ClockSpec = { h: hourOf(t), m: minOf(t) };
  if (label) c.label = label;
  return c;
}

/** quadrante disegnato allo specchio: l'immagine visibile legge mirror(t) */
function mirroredClock(t: number, label?: string): ClockSpec {
  const c: ClockSpec = { h: hourOf(t), m: minOf(t), mirrored: true };
  if (label) c.label = label;
  return c;
}

/** quadrante incognito ("?") */
function unknownClock(label?: string): ClockSpec {
  const c: ClockSpec = { h: 0, m: 0, unknown: true };
  if (label) c.label = label;
  return c;
}

/**
 * Ora "riflessa": un orologio che segna t, visto allo specchio, sembra segnare
 * mirror(t). Equivale a: minuti' = (60 - m) % 60, ore' = (11 - h + (m===0?1:0)) % 12.
 * Esempi: 3:00 ↔ 9:00, 2:30 ↔ 9:30, 4:15 ↔ 7:45, 12:00 ↔ 12:00.
 */
function mirror(t: number): number {
  return norm(MOD - t);
}

/** angolo (in gradi) fra le lancette, sempre il più piccolo: |30·h − 5,5·m| */
function angleAt(t: number): number {
  const a = Math.abs(30 * hourOf(t) - 5.5 * minOf(t));
  return a > 180 ? 360 - a : a;
}

/** angolo che si ottiene credendo la lancetta delle ore ferma sul numero */
function staticAngle(t: number): number {
  const a = Math.abs(30 * hourOf(t) - 6 * minOf(t));
  return a > 180 ? 360 - a : a;
}

/** ora casuale con minuti multipli di 5 */
function randTime(rng: Rng): number {
  return randInt(rng, 0, 11) * 60 + randInt(rng, 0, 11) * 5;
}

/**
 * Sceglie 2 distrattori distinti da una lista di errori tipici, ORDINATA per
 * importanza: il primo candidato valido è sempre presente (così la spiegazione
 * può citarlo con certezza), il secondo varia.
 */
function twoOf<T>(rng: Rng, correct: T, cands: T[]): [T, T] {
  const seen = new Set<T>([correct]);
  const distinct: T[] = [];
  for (const c of cands) {
    if (seen.has(c)) continue;
    seen.add(c);
    distinct.push(c);
  }
  if (distinct.length < 2) throw new Error('distrattori insufficienti');
  const first = distinct[0];
  const second = pick(rng, distinct.slice(1));
  return chance(rng, 0.5) ? [first, second] : [second, first];
}

function textChoices(rng: Rng, correct: string, cands: string[]) {
  const [a, b] = twoOf(rng, correct, cands);
  const opt = (text: string): ChoiceVisual => ({ kind: 'text', text });
  return placeChoices(rng, opt(correct), [opt(a), opt(b)]);
}

function clockChoices(rng: Rng, correctT: number, cands: number[]) {
  const c = norm(correctT);
  const [a, b] = twoOf(rng, c, cands.map(norm));
  const opt = (t: number): ChoiceVisual => ({ kind: 'clock', clock: clockOf(t) });
  return placeChoices(rng, opt(c), [opt(a), opt(b)]);
}

const STEPS = [20, 25, 35, 40, 45, 50] as const;
const BIG_STEPS = [70, 75, 80, 85, 90, 95, 100, 105, 110] as const;

/** scenari dei due orologi: le etichette compaiono sotto i quadranti */
const SCENARIOS = [
  { a: 'Prima', b: 'Dopo', q: 'Quanto tempo è passato dal primo orologio al secondo?' },
  { a: 'Inizio', b: 'Fine', q: 'Il gioco comincia all’ora del primo orologio e finisce a quella del secondo: quanto dura?' },
  { a: 'Partenza', b: 'Arrivo', q: 'Il treno parte all’ora del primo orologio e arriva a quella del secondo: quanto dura il viaggio?' },
  { a: 'Sveglia', b: 'Colazione', q: 'Sofia si sveglia all’ora del primo orologio e fa colazione a quella del secondo: quanto tempo passa?' },
  { a: 'Andata', b: 'Ritorno', q: 'Si parte all’ora del primo orologio e si torna a quella del secondo: quanto tempo passa?' },
  { a: 'Entrata', b: 'Uscita', q: 'Si entra all’ora del primo orologio e si esce a quella del secondo: quanto tempo si resta dentro?' },
] as const;

/**
 * Momenti della giornata usati come etichetta nelle domande sull'angolo: a ogni
 * momento sono associate solo ore plausibili, così la scena resta credibile.
 */
const MOMENTS_D2 = [
  { label: 'Ricreazione', phrase: 'È l’ora della ricreazione.', hours: [10, 11] },
  { label: 'Pranzo', phrase: 'È l’ora di pranzo.', hours: [0, 1] },
  { label: 'Merenda', phrase: 'È l’ora della merenda.', hours: [4, 5] },
] as const;

const MOMENTS_D3 = [
  { label: 'Compiti', phrase: 'È l’ora dei compiti.', hours: [4, 5, 6] },
  { label: 'Allenamento', phrase: 'È l’ora dell’allenamento.', hours: [5, 6, 7] },
  { label: 'Cena', phrase: 'È l’ora di cena.', hours: [7, 8, 9] },
  { label: 'Buonanotte', phrase: 'È l’ora della buonanotte.', hours: [9, 10, 11] },
] as const;

// ---------------------------------------------------------------------------
// d1a: "che ora segnerà tra N minuti?" / "che ora segnava N minuti fa?"
// ---------------------------------------------------------------------------

function d1Shift(rng: Rng): Question {
  const t = randTime(rng);
  const n = pick(rng, STEPS);
  const fwd = chance(rng, 0.5);
  const dir = fwd ? 1 : -1;
  const correctT = norm(t + dir * n);
  // distrattore 1: gira le lancette dalla parte sbagliata
  const oppT = norm(t - dir * n);
  // distrattore 2: minuti giusti ma un'ora in più o in meno
  const hourT = norm(correctT + pick(rng, [60, -60]));
  const { choices, correctIndex } = clockChoices(rng, correctT, [oppT, hourT]);

  const lay = randInt(rng, 0, 2);
  const clocks: ClockSpec[] =
    lay === 0
      ? [clockOf(t)]
      : lay === 1
        ? [clockOf(t, 'Adesso')]
        : fwd
          ? [clockOf(t, 'Adesso'), unknownClock('Dopo')]
          : [unknownClock('Prima'), clockOf(t, 'Adesso')];

  const m = minOf(t);
  const carry = fwd
    ? m + n >= 60
      ? ` I minuti fanno ${m} + ${n} = ${m + n}: più di un giro, quindi si scavalca l’ora.`
      : ''
    : m - n < 0
      ? ` I minuti segnati (${m}) non bastano per toglierne ${n}: si scende di un’ora e si prendono in prestito 60 minuti.`
      : '';

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: fwd ? `Che ora segnerà l’orologio tra ${n} minuti?` : `Che ora segnava l’orologio ${n} minuti fa?`,
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `L’orologio segna le ${fmt(t)}: andando ${fwd ? 'avanti' : 'indietro'} di ${n} minuti si arriva alle ` +
      `${fmt(correctT)}.${carry} Trappole: un orologio si sposta dalla parte sbagliata (${fmt(oppT)}), ` +
      `un altro sbaglia di un’ora esatta.`,
  };
}

// ---------------------------------------------------------------------------
// d1b: "tra N ore" — la lancetta dei minuti non si muove
// ---------------------------------------------------------------------------

function d1Hours(rng: Rng): Question {
  const t = randTime(rng);
  const n = randInt(rng, 2, 5);
  const fwd = chance(rng, 0.5);
  const dir = fwd ? 1 : -1;
  const correctT = norm(t + dir * n * 60);
  const oppT = norm(t - dir * n * 60); // conta le ore dalla parte sbagliata
  const offT = norm(correctT + pick(rng, [60, -60])); // sbaglia di un'ora nel conteggio
  const { choices, correctIndex } = clockChoices(rng, correctT, [oppT, offT]);

  const lay = randInt(rng, 0, 1);
  const clocks: ClockSpec[] =
    lay === 0
      ? [clockOf(t, 'Ora')]
      : fwd
        ? [clockOf(t, 'Ora'), unknownClock('Più tardi')]
        : [unknownClock('Prima'), clockOf(t, 'Ora')];

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: fwd ? `Che ora segnerà l’orologio tra ${n} ore?` : `Che ora segnava l’orologio ${n} ore fa?`,
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `Con le ore intere la lancetta lunga non si muove: resta dov’è. Si sposta solo quella corta, di ` +
      `${n} ore ${fwd ? 'in avanti' : 'indietro'}: dalle ${fmt(t)} alle ${fmt(correctT)}. Occhio che dopo il 12 si ` +
      `ricomincia da 1: chi conta ${n} ore dalla parte sbagliata arriva alle ${fmt(oppT)}.`,
  };
}

// ---------------------------------------------------------------------------
// d1c: due orologi, "quanto tempo è passato?" (senza riporto sui minuti)
// ---------------------------------------------------------------------------

function d1Elapsed(rng: Rng): Question {
  const sc = pick(rng, SCENARIOS);
  const m1 = randInt(rng, 0, 11) * 5;
  const t1 = randInt(rng, 0, 11) * 60 + m1;
  const H = randInt(rng, 0, 3);
  // niente riporto: i minuti da aggiungere non fanno scavalcare l'ora
  const pool = [10, 15, 20, 25, 30, 40, 45, 50].filter((v) => m1 + v <= 55);
  const small = pool.filter((v) => v >= 15);
  if (H === 0 && small.length === 0) throw new Error('nessun intervallo comodo');
  const M = H === 0 ? pick(rng, small) : pick(rng, [0, ...pool]);
  const gap = H * 60 + M;
  const t2 = norm(t1 + gap);

  const cands = [gap + 60]; // un'ora di troppo (errore garantito nelle opzioni)
  if (gap > 60) cands.push(gap - 60);
  if (M !== 0 && M !== 30) cands.push(H * 60 + (60 - M)); // conta i minuti dalla parte sbagliata
  if (M !== 0) cands.push(gap + 5, gap - 5); // un trattino di troppo / in meno
  const { choices, correctIndex } = textChoices(
    rng,
    fmtDur(gap),
    cands.filter((v) => v > 0 && v < MOD).map(fmtDur)
  );

  let expl = `Il primo orologio segna le ${fmt(t1)}, il secondo le ${fmt(t2)}. `;
  if (H > 0 && M > 0) {
    expl += `Si contano prima le ore intere — dalle ${fmt(t1)} alle ${fmt(t1 + H * 60)} passano ${H} ${
      H === 1 ? 'ora' : 'ore'
    } — poi i minuti che restano: ${M}. In tutto ${fmtDur(gap)}.`;
  } else if (H > 0) {
    expl += `La lancetta lunga è ferma nello stesso punto, quindi sono passate ore intere: ${fmtDur(gap)}.`;
  } else {
    expl += `L’ora non cambia: basta contare i minuti, da ${minOf(t1)} a ${minOf(t2)}, cioè ${M} minuti.`;
  }
  expl += ` Chi conta un’ora di troppo risponde ${fmtDur(gap + 60)}.`;

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: sc.q,
    payload: { kind: 'clock', clocks: [clockOf(t1, sc.a), clockOf(t2, sc.b)] },
    choices,
    correctIndex,
    explanation: expl,
  };
}

// ---------------------------------------------------------------------------
// d2a: orologio allo specchio
// ---------------------------------------------------------------------------

function d2Mirror(rng: Rng): Question {
  const real = randTime(rng); // ora vera del quadrante
  const seen = mirror(real); // ciò che si legge nell'immagine riflessa
  // esclude i casi in cui lo specchio non cambia nulla (12:00 e 6:00)
  if (real === seen) throw new Error('specchio banale');
  const mm = minOf(seen);
  const cands: string[] = [fmt(seen)]; // legge l'immagine così com'è (errore garantito)
  if (mm !== 0 && mm !== 30) cands.push(fmt(hourOf(real) * 60 + mm)); // specchia solo le ore
  cands.push(fmt(real + 60), fmt(real - 60)); // un'ora in più / in meno
  const { choices, correctIndex } = textChoices(rng, fmt(real), cands);
  const clocks = chance(rng, 0.5) ? [mirroredClock(real)] : [mirroredClock(real, 'Allo specchio')];
  const minRule = mm === 0 ? 'i minuti restano a 0' : `i minuti diventano 60 − ${mm} = ${60 - mm}`;

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: 'Questo orologio è visto allo specchio: che ora è davvero?',
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `Allo specchio destra e sinistra si scambiano: l’immagine sembra segnare le ${fmt(seen)}, ma per l’ora vera ` +
      `bisogna riflettere di nuovo le lancette. ${minRule[0].toUpperCase()}${minRule.slice(1)} e le ore si contano ` +
      `all’indietro partendo dal 12: l’ora vera è le ${fmt(real)}. L’errore classico è fidarsi dell’immagine e ` +
      `rispondere ${fmt(seen)}.`,
  };
}

// ---------------------------------------------------------------------------
// d2b: angolo fra le lancette a ore tonde e mezz'ore
// ---------------------------------------------------------------------------

function angleQuestion(rng: Rng, difficulty: 2 | 3): Question {
  const moment = difficulty === 2 ? pick(rng, MOMENTS_D2) : pick(rng, MOMENTS_D3);
  const plain = chance(rng, 0.3); // senza etichetta: ora libera
  const h = plain ? randInt(rng, 0, 11) : pick(rng, moment.hours);
  const m = difficulty === 2 ? pick(rng, [0, 30]) : pick(rng, [10, 20, 40, 50]);
  const t = h * 60 + m;
  const correct = angleAt(t);
  if (correct < 30) throw new Error('angolo troppo stretto');

  // ogni distrattore porta con sé la spiegazione dell'errore che rappresenta
  const stat = staticAngle(t);
  const cands: { v: number; why: string }[] = [];
  if (stat !== correct) {
    cands.push({
      v: stat,
      why:
        `la lancetta corta NON sta ferma sul numero — in ${m} minuti si è già spostata di ${0.5 * m}° — ` +
        `e chi la crede ferma risponde ${stat}°`,
    });
  }
  if (difficulty === 3) {
    const misread = angleAt((h + 1) * 60 + m); // legge la lancetta corta sul numero successivo
    cands.push({ v: misread, why: `chi legge la lancetta corta sul numero dopo risponde ${misread}°` });
  }
  if (360 - correct !== correct) {
    cands.push({ v: 360 - correct, why: `dall’altra parte del quadrante l’angolo misura ${360 - correct}°, ma qui serve il più piccolo` });
  }
  if (correct + 30 <= 330) {
    cands.push({ v: correct + 30, why: `chi conta i numeri invece degli spazi sbaglia di un’ora di quadrante e risponde ${correct + 30}°` });
  }
  if (correct - 30 >= 5) {
    cands.push({ v: correct - 30, why: `chi conta uno spazio in meno risponde ${correct - 30}°` });
  }
  // angoli troppo sottili non sono opzioni credibili: si scartano
  const pool = cands.filter((c) => c.v >= 15);
  const { choices, correctIndex } = textChoices(rng, `${correct}°`, pool.map((c) => `${c.v}°`));
  const trap = pool[0].why; // twoOf garantisce che il primo candidato sia sempre in gioco

  const hd = 30 * h + 0.5 * m;
  const md = 6 * m;
  const raw = Math.abs(hd - md);

  return {
    qtype: 'clock',
    difficulty,
    prompt:
      (plain ? '' : moment.phrase + ' ') + 'Quanti gradi misura l’angolo più piccolo fra le due lancette?',
    payload: { kind: 'clock', clocks: [plain ? clockOf(t) : clockOf(t, moment.label)] },
    choices,
    correctIndex,
    explanation:
      `Il quadrante è diviso in 12 ore, quindi ogni ora vale 360 ÷ 12 = 30°; in più la lancetta delle ore avanza di ` +
      `mezzo grado al minuto. Alle ${fmt(t)} la lancetta lunga è a ${md}° dal 12 e quella corta a ${hd}°. ` +
      `La differenza è ${raw}°${
        raw > 180 ? `: più di mezzo giro, quindi l’angolo piccolo è 360 − ${raw} = ${correct}°` : ', ed è già il più piccolo'
      }. Trappola: ${trap}.`,
  };
}

// ---------------------------------------------------------------------------
// d2c: orologio che va avanti (o indietro) di g minuti ogni ora
// ---------------------------------------------------------------------------

function d2Broken(rng: Rng): Question {
  const t = randTime(rng);
  const g = pick(rng, [5, 10]);
  const n = randInt(rng, 2, 4);
  const fast = chance(rng, 0.6);
  const dir = fast ? 1 : -1;
  const trueT = norm(t + n * 60);
  const correctT = norm(trueT + dir * n * g);
  const cands = [
    fmt(trueT), // dimentica lo scarto (errore garantito)
    fmt(norm(trueT + dir * g)), // applica lo scarto una volta sola
    fmt(norm(trueT - dir * n * g)), // sbaglia il verso dello scarto
  ];
  const { choices, correctIndex } = textChoices(rng, fmt(correctT), cands);
  const clocks = chance(rng, 0.5)
    ? [clockOf(t, 'Ora esatta')]
    : [clockOf(t, 'Ora esatta'), unknownClock('Poi')];

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt:
      `Questo orologio adesso è giusto, ma ${fast ? 'va avanti' : 'resta indietro'} di ${g} minuti ogni ora. ` +
      `Che ora segnerà fra ${n} ore?`,
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `In ${n} ore l’errore si accumula: ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. ` +
      `L’ora giusta fra ${n} ore sarà le ${fmt(trueT)}; l’orologio segnerà ${n * g} minuti ${
        fast ? 'più avanti' : 'più indietro'
      }, cioè le ${fmt(correctT)}. Chi si dimentica dello scarto risponde ${fmt(trueT)}.`,
  };
}

// ---------------------------------------------------------------------------
// d2d: due orologi, tempo trascorso CON riporto sui minuti
// ---------------------------------------------------------------------------

function d2Elapsed(rng: Rng): Question {
  const sc = pick(rng, SCENARIOS);
  const M = pick(rng, [10, 15, 20, 25, 35, 40, 45, 50]);
  // minuti di partenza tali da far scavalcare l'ora (m1 + M ≥ 60): serve il riporto
  const m1 = randInt(rng, Math.ceil((60 - M) / 5), 11) * 5;
  const t1 = randInt(rng, 0, 11) * 60 + m1;
  const H = randInt(rng, 0, 3);
  const gap = H * 60 + M;
  const t2 = norm(t1 + gap);
  const m2 = minOf(t2);

  // errore classico: sottrazione "in colonna" ore-ore e minuti-minuti, senza prestito
  const naive = (H + 1) * 60 + (60 - M);
  const cands = [naive, gap + 60];
  if (gap > 60) cands.push(gap - 60);
  if (M !== 30) cands.push(H * 60 + (60 - M));
  const { choices, correctIndex } = textChoices(
    rng,
    fmtDur(gap),
    cands.filter((v) => v > 0 && v < MOD).map(fmtDur)
  );

  const r = 60 - m1; // minuti che mancano all'ora tonda
  const rest = gap - r;
  const leg2 = rest === 0 ? '' : ` poi dalle ${fmt(t1 + r)} alle ${fmt(t2)} ne passano ancora ${fmtDur(rest)};`;
  const h1d = hourOf(t1) === 0 ? 12 : hourOf(t1);
  const h2d = hourOf(t2) === 0 ? 12 : hourOf(t2);
  // il conto "in colonna" si cita con i numeri solo se non fa comparire ore negative
  const column = h2d > h1d ? `(${h2d} − ${h1d} ore e ${m1} − ${m2} minuti)` : 'ore con ore e minuti con minuti';

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: sc.q,
    payload: { kind: 'clock', clocks: [clockOf(t1, sc.a), clockOf(t2, sc.b)] },
    choices,
    correctIndex,
    explanation:
      `Dalle ${fmt(t1)} alle ${fmt(t2)}. Il trucco è fermarsi all’ora tonda: dalle ${fmt(t1)} alle ${fmt(t1 + r)} ` +
      `passano ${r} minuti;${leg2} in tutto ${fmtDur(gap)}. Chi invece sottrae in colonna ${column} ottiene ` +
      `${fmtDur(naive)}: sbagliato, perché i minuti non arrivano a 100 ma a 60.`,
  };
}

// ---------------------------------------------------------------------------
// d2e: sequenza di orologi a passo costante
// ---------------------------------------------------------------------------

function d2Sequence(rng: Rng): Question {
  const s = pick(rng, [20, 25, 30, 35, 40, 45, 50, 55]);
  const k = pick(rng, [2, 3]); // quadranti visibili
  const t0 = randTime(rng);
  const visible = Array.from({ length: k }, (_, i) => norm(t0 + i * s));
  const correctT = norm(t0 + k * s);
  const cands = [
    norm(correctT - s), // si ferma un passo prima (ripete l'ultimo quadrante)
    norm(correctT + s), // applica il passo una volta di troppo
    norm(correctT + 60),
    norm(correctT - 60),
  ];
  const { choices, correctIndex } = clockChoices(rng, correctT, cands);

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: 'Fra un orologio e il successivo passa sempre lo stesso tempo. Che ora segna l’ultimo?',
    payload: { kind: 'clock', clocks: [...visible.map((t) => clockOf(t)), unknownClock()] },
    choices,
    correctIndex,
    explanation:
      `Fra ${fmt(visible[0])} e ${fmt(visible[1])} passano ${fmtDur(s)}: è il passo della serie. Applicandolo ` +
      `all’ultimo orologio visibile (${fmt(visible[k - 1])}) si arriva alle ${fmt(correctT)}. Chi si ferma un passo ` +
      `prima risponde ${fmt(norm(correctT - s))}.`,
  };
}

// ---------------------------------------------------------------------------
// d2f: salto di più di un'ora ("tra 100 minuti")
// ---------------------------------------------------------------------------

function d2BigStep(rng: Rng): Question {
  const t = randTime(rng);
  const n = pick(rng, BIG_STEPS);
  const correctT = norm(t + n);
  const cands = [
    norm(t + n - 60), // somma i minuti ma dimentica di aggiungere l'ora
    norm(t + n + 60), // aggiunge due ore invece di una
    norm(t - n), // gira dalla parte sbagliata
  ];
  const { choices, correctIndex } = textChoices(rng, fmt(correctT), cands.map(fmt));

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: `Che ora segnerà l’orologio fra ${n} minuti?`,
    payload: { kind: 'clock', clocks: [clockOf(t, 'Adesso')] },
    choices,
    correctIndex,
    explanation:
      `${n} minuti sono 1 ora e ${n - 60} minuti. Dalle ${fmt(t)} si aggiunge prima l’ora (${fmt(t + 60)}) e poi i ` +
      `${n - 60} minuti che restano: ${fmt(correctT)}. Chi somma solo i minuti e si dimentica l’ora arriva alle ` +
      `${fmt(norm(t + n - 60))}.`,
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
  const real = randTime(rng); // ora vera del quadrante
  const seen = mirror(real); // ciò che si legge nell'immagine riflessa
  if (real === seen) throw new Error('specchio banale');
  const n = pick(rng, STEPS);
  const correctT = norm(real + n);
  const cands = [
    norm(seen + n), // dimentica lo specchio e somma alla lettura diretta
    norm(real - n), // specchia bene ma va indietro
    norm(correctT + 60),
    norm(correctT - 60),
  ];
  const { choices, correctIndex } = textChoices(rng, fmt(correctT), cands.map(fmt));
  const clocks = chance(rng, 0.5) ? [mirroredClock(real)] : [mirroredClock(real, 'Allo specchio')];

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: `Questo orologio è visto allo specchio: che ora sarà davvero fra ${n} minuti?`,
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `Due passi. Primo: si riflette l’immagine — sembra segnare le ${fmt(seen)}, quindi l’ora vera è le ` +
      `${fmt(real)} (i minuti diventano 60 meno i minuti, le ore si contano all’indietro dal 12). Secondo: si ` +
      `aggiungono ${n} minuti, e si arriva alle ${fmt(correctT)}. Chi si dimentica dello specchio ottiene ` +
      `${fmt(norm(seen + n))}.`,
  };
}

// ---------------------------------------------------------------------------
// d3c: orologio al muro + orologio nello specchio, quanto tempo li separa
// ---------------------------------------------------------------------------

function d3MirrorCompare(rng: Rng): Question {
  const t1 = randTime(rng);
  const gap = pick(rng, [35, 40, 50, 55, 65, 70, 80, 95, 100, 110, 125, 140, 155, 170]);
  const t2 = norm(t1 + gap);
  const mirrorFirst = chance(rng, 0.5);
  const reflected = mirrorFirst ? t1 : t2; // il quadrante disegnato allo specchio
  if (reflected === mirror(reflected)) throw new Error('specchio banale');
  // errore garantito: legge lo specchio come se fosse un orologio normale
  const ignored = mirrorFirst ? norm(t2 - mirror(t1)) : norm(mirror(t2) - t1);
  if (ignored === gap || ignored === 0) throw new Error('specchio ininfluente');

  const cands = [ignored, gap + 60];
  if (gap > 60) cands.push(gap - 60);
  // sottrazione "in colonna" senza prestito, quando i minuti scavalcano l'ora
  if (minOf(t2) < minOf(t1)) cands.push((Math.floor(gap / 60) + 1) * 60 + (60 - (gap % 60)));
  const { choices, correctIndex } = textChoices(
    rng,
    fmtDur(gap),
    cands.filter((v) => v > 0 && v < MOD).map(fmtDur)
  );

  const clocks = mirrorFirst
    ? [mirroredClock(t1, 'Nello specchio'), clockOf(t2, 'Al muro')]
    : [clockOf(t1, 'Al muro'), mirroredClock(t2, 'Nello specchio')];

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt:
      'Uno dei due orologi lo vediamo riflesso in uno specchio. Quanto tempo passa fra l’ora vera del primo e ' +
      'l’ora vera del secondo?',
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation:
      `L’orologio nello specchio sembra segnare le ${fmt(mirror(reflected))}, ma riflettendo le lancette l’ora vera ` +
      `è le ${fmt(reflected)}. Le due ore vere sono ${fmt(t1)} e ${fmt(t2)}: fra loro passano ${fmtDur(gap)}. ` +
      `Chi legge lo specchio come un orologio normale calcola ${fmtDur(ignored)}.`,
  };
}

// ---------------------------------------------------------------------------
// d3d: orologio rotto letto al contrario (dall'ora segnata all'ora vera)
// ---------------------------------------------------------------------------

const BROKEN3 = [
  [3, 5],
  [4, 4],
  [4, 6],
  [6, 3],
  [6, 5],
  [7, 4],
  [8, 3],
  [9, 4],
  [12, 3],
  [13, 4],
] as const;

function d3Broken(rng: Rng): Question {
  const [g, n] = pick(rng, BROKEN3);
  const fast = chance(rng, 0.5);
  const dir = fast ? 1 : -1;
  const reverse = chance(rng, 0.5);

  if (reverse) {
    // l'orologio SEGNA un'ora sbagliata: risalire all'ora vera
    const shown = randTime(rng);
    const realT = norm(shown - dir * n * g);
    const cands = [
      norm(shown + dir * n * g), // corregge nel verso sbagliato
      norm(shown - dir * g), // applica lo scarto una volta sola
      norm(shown - dir * n * g + 60),
    ];
    const { choices, correctIndex } = textChoices(rng, fmt(realT), cands.map(fmt));
    return {
      qtype: 'clock',
      difficulty: 3,
      prompt:
        `Questo orologio ${fast ? 'va avanti' : 'resta indietro'} di ${g} minuti ogni ora ed è stato messo all’ora ` +
        `giusta ${n} ore fa. Che ora è davvero adesso?`,
      payload: { kind: 'clock', clocks: [clockOf(shown, 'Orologio rotto'), unknownClock('Ora esatta')] },
      choices,
      correctIndex,
      explanation:
        `In ${n} ore ha accumulato ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. Segna le ` +
        `${fmt(shown)}, quindi l’ora vera sta ${n * g} minuti ${fast ? 'indietro' : 'avanti'}: sono le ${fmt(realT)}. ` +
        `Chi corregge nel verso sbagliato risponde ${fmt(norm(shown + dir * n * g))}.`,
    };
  }

  // l'orologio è giusto adesso: che ora segnerà fra n ore
  const t = randTime(rng);
  const trueT = norm(t + n * 60);
  const correctT = norm(trueT + dir * n * g);
  const cands = [
    fmt(trueT), // dimentica lo scarto
    fmt(norm(trueT + dir * g)), // scarto applicato una volta sola
    fmt(norm(trueT - dir * n * g)), // verso sbagliato
  ];
  const { choices, correctIndex } = textChoices(rng, fmt(correctT), cands);
  return {
    qtype: 'clock',
    difficulty: 3,
    prompt:
      `Adesso questo orologio segna l’ora esatta, ma ${fast ? 'guadagna' : 'perde'} ${g} minuti ogni ora. ` +
      `Che ora segnerà fra ${n} ore?`,
    payload: { kind: 'clock', clocks: [clockOf(t, 'Ora esatta'), unknownClock('Orologio rotto')] },
    choices,
    correctIndex,
    explanation:
      `Lo scarto si accumula: ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. Fra ${n} ore l’ora ` +
      `giusta sarà le ${fmt(trueT)}, quindi l’orologio segnerà le ${fmt(correctT)}. Chi si ferma all’ora giusta ` +
      `risponde ${fmt(trueT)}; chi applica lo scarto una volta sola risponde ${fmt(norm(trueT + dir * g))}.`,
  };
}

// ---------------------------------------------------------------------------
// d3e: sequenza di orologi a passo CRESCENTE
// ---------------------------------------------------------------------------

function d3Sequence(rng: Rng): Question {
  // coppie (passo iniziale, incremento) scelte in modo che il rapporto fra i primi
  // due intervalli NON sia 2 o 1,5: altrimenti anche una lettura "moltiplicativa"
  // della serie sarebbe difendibile e la risposta non sarebbe più unica.
  const [s, d] = pick(rng, [
    [15, 5],
    [15, 10],
    [20, 5],
    [20, 15],
    [25, 5],
    [25, 10],
    [25, 15],
    [30, 5],
    [30, 10],
  ] as const);
  const t0 = randTime(rng);
  const t1 = norm(t0 + s);
  const t2 = norm(t1 + s + d);
  const correctT = norm(t2 + s + 2 * d);
  const cands = [
    norm(correctT - d), // ripete l'ultimo passo invece di allungarlo
    norm(correctT - 2 * d), // usa sempre il primo passo
    norm(correctT + 60),
  ];
  const { choices, correctIndex } = clockChoices(rng, correctT, cands);

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: 'Guarda quanto tempo passa fra un orologio e il successivo: che ora segna l’ultimo?',
    payload: { kind: 'clock', clocks: [clockOf(t0), clockOf(t1), clockOf(t2), unknownClock()] },
    choices,
    correctIndex,
    explanation:
      `Gli intervalli non sono uguali, crescono: prima ${s} minuti (${fmt(t0)} → ${fmt(t1)}), poi ${s + d} ` +
      `(${fmt(t1)} → ${fmt(t2)}), cioè ${d} minuti in più ogni volta. Il passo successivo è quindi ${s + 2 * d} ` +
      `minuti: dalle ${fmt(t2)} si arriva alle ${fmt(correctT)}. Chi crede il passo costante risponde ` +
      `${fmt(norm(correctT - d))}.`,
  };
}

// ---------------------------------------------------------------------------
// d3f: tempo trascorso all'indietro, con prestito sui minuti
// ---------------------------------------------------------------------------

function d3ElapsedBack(rng: Rng): Question {
  const M = pick(rng, [10, 15, 20, 25, 35, 40, 45, 50]);
  const H = randInt(rng, 1, 3);
  const gap = H * 60 + M;
  // minuti di arrivo inferiori a M: per tornare indietro serve il prestito
  const m2 = randInt(rng, 0, Math.floor((M - 5) / 5)) * 5;
  const t2 = randInt(rng, 0, 11) * 60 + m2;
  const correctT = norm(t2 - gap);
  const cands = [
    norm(correctT + 60), // toglie i minuti senza prestito (dimentica di scalare un'ora)
    norm(t2 + gap), // conta nel verso sbagliato
    norm(correctT - 60),
  ];
  const { choices, correctIndex } = clockChoices(rng, correctT, cands);

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: `Sono passati ${fmtDur(gap)} dal primo orologio al secondo. Che ora segnava il primo?`,
    payload: { kind: 'clock', clocks: [unknownClock('Prima'), clockOf(t2, 'Dopo')] },
    choices,
    correctIndex,
    explanation:
      `Si torna indietro a pezzi: dalle ${fmt(t2)} si tolgono prima ${H} ${H === 1 ? 'ora' : 'ore'} ` +
      `(${fmt(norm(t2 - H * 60))}), poi ${M} minuti. Ma i minuti da togliere (${M}) sono più di quelli segnati ` +
      `(${m2}), quindi si prende in prestito un’ora: si arriva alle ${fmt(correctT)}. Chi si dimentica del prestito ` +
      `risponde ${fmt(norm(correctT + 60))}.`,
  };
}

// ---------------------------------------------------------------------------

const D1 = [d1Shift, d1Hours, d1Elapsed] as const;
const D2 = [d2Mirror, (r: Rng) => angleQuestion(r, 2), d2Broken, d2Elapsed, d2Sequence, d2BigStep] as const;
const D3 = [
  d3Overlap,
  d3Mirror,
  d3MirrorCompare,
  (r: Rng) => angleQuestion(r, 3),
  d3Broken,
  d3Sequence,
  d3ElapsedBack,
] as const;

export function genClock(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) return pick(rng, D1)(rng);
    if (difficulty === 2) return pick(rng, D2)(rng);
    return pick(rng, D3)(rng);
  }, 40);
}
