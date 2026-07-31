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
// specchio applicato solo alle ore o solo ai minuti, scarto dell'orologio rotto
// applicato una volta sola, nel verso sbagliato o un'ora di troppo, minuti letti
// su un quadrante invece di essere contati. Mai distrattori casuali.
//
// Gli errori plausibili però sono quasi tutti "uno in più" e "uno in meno": presi
// a coppie mettevano la risposta giusta IN MEZZO alle tre opzioni quasi sempre, e
// bastava scegliere il numero di mezzo per vincere senza guardare le lancette.
// Perciò ogni quesito a opzioni testuali offre un elenco LARGO di errori tipici
// (sopra e sotto la risposta) e ne sceglie due con twoDistractors, che sorteggia
// la posizione della risposta in classifica. Non si usa il
// balancedNumericDistractors di qutils perché qui l'ordine che il giocatore legge
// non è quello dei numeri nudi: "12:05" viene dopo "1:35", e "1 h 5 min" è più
// lungo di "45 min" pur cominciando con un numero più piccolo.

import type { ChoiceVisual, ClockSpec, Difficulty, LocalizedText, Question } from '../types';
import { chance, pick, randInt, type Rng } from '../rng';
import { L } from '../localize';
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

/** come `fmtDur`, in inglese: stessa struttura, "h"/"min" restano capiti in entrambe le lingue */
function fmtDurEn(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}

function clockOf(t: number, label?: LocalizedText): ClockSpec {
  const c: ClockSpec = { h: hourOf(t), m: minOf(t) };
  if (label) c.label = label;
  return c;
}

/** quadrante disegnato allo specchio: l'immagine visibile legge mirror(t) */
function mirroredClock(t: number, label?: LocalizedText): ClockSpec {
  const c: ClockSpec = { h: hourOf(t), m: minOf(t), mirrored: true };
  if (label) c.label = label;
  return c;
}

/** quadrante incognito ("?") */
function unknownClock(label?: LocalizedText): ClockSpec {
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
 * può citarlo con certezza), il secondo varia. Vale per le opzioni DISEGNATE
 * (quadranti): lì non c'è nessuna classifica di numeri da sfruttare.
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

// ---------------------------------------------------------------------------
// Opzioni TESTUALI (orari, durate, gradi, minuti)
//
// Il problema che questo blocco risolve: gli errori tipici di questo tipo sono
// quasi tutti "una in più" e "una in meno" (un'ora di troppo, un trattino in
// meno, lo scarto nel verso sbagliato), quindi la risposta finiva quasi sempre
// in mezzo alle tre opzioni. Chi lo scopre vince senza guardare l'orologio.
// Qui gli errori restano gli stessi — cambia il MODO di sceglierne due: la
// posizione della risposta nella classifica viene sorteggiata a ogni domanda.
// ---------------------------------------------------------------------------

/** un'opzione testuale: il testo mostrato, il valore per l'ordine, l'errore che rappresenta */
interface Opt {
  /**
   * il testo mostrato, in ogni lingua. Il campo `.it` guida ANCHE la logica di
   * selezione qui sotto (dedup, `lead()`): resta quindi identico a prima —
   * cambia solo il tipo del contenitore, mai il valore italiano.
   */
  text: LocalizedText;
  /** valore con cui l'opzione si confronta davvero con le altre */
  v: number;
  /** frase per la spiegazione, in ogni lingua: "chi si dimentica lo scarto risponde 5:20" */
  why: LocalizedText;
}

/**
 * Il numero che si legge PER PRIMO in un'opzione: "3:45" → 3, "1 h 25 min" → 1,
 * "120°" → 120. È con quello che le tre opzioni si confrontano a colpo d'occhio,
 * ed è quindi la classifica che conterebbe per chi volesse tirare a indovinare.
 */
function lead(text: string): number {
  const m = text.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : 0;
}

/** orario: si ordina per l'ora mostrata (le 12 vengono dopo le 11, come si legge) */
function optTime(t: number, why?: LocalizedText): Opt {
  const h = hourOf(t) === 0 ? 12 : hourOf(t);
  // "H:MM" è già lingua-neutra: L() senza secondo argomento ripiega su .it
  return { text: L(fmt(t)), v: h * 60 + minOf(t), why: why ?? L('') };
}

/** durata: si ordina per minuti totali */
const optDur = (mins: number, why?: LocalizedText): Opt => ({ text: L(fmtDur(mins), fmtDurEn(mins)), v: mins, why: why ?? L('') });

const optDeg = (deg: number, why?: LocalizedText): Opt => ({ text: L(`${deg}°`), v: deg, why: why ?? L('') });

const optMins = (mins: number, why?: LocalizedText): Opt => ({ text: L(`${mins} minuti`, `${mins} minutes`), v: mins, why: why ?? L('') });

/**
 * Sceglie due distrattori fra gli errori plausibili in modo che la RISPOSTA non
 * stia sempre nello stesso posto della classifica.
 *
 * Due regole:
 *  1) la posizione della risposta fra le tre opzioni (la più piccola, quella di
 *     mezzo, la più grande) si SORTEGGIA a ogni domanda; se quella estratta non
 *     è ottenibile con gli errori disponibili si ripiega su un ESTREMO, mai su
 *     quella di mezzo — è quella che i distrattori "uno in più / uno in meno"
 *     regalerebbero già da soli troppo spesso;
 *  2) fra le coppie che realizzano quella posizione si preferiscono quelle in
 *     cui anche il PRIMO NUMERO di ogni opzione (quello che salta all'occhio:
 *     l'ora in "3:45", le ore in "1 h 25 min") racconta la stessa classifica dei
 *     valori veri, oppure è lo stesso per tutte e tre (e allora non racconta
 *     niente e si è costretti a leggere l'opzione intera).
 * A parità si preferisce la coppia che contiene l'errore principale del quesito,
 * cioè il primo candidato della lista.
 */
function twoDistractors(rng: Rng, correct: Opt, cands: Opt[]): [Opt, Opt] {
  // la dedup e il "primo numero" ragionano SEMPRE sul testo italiano: è la
  // stessa identica logica di prima, solo che ora `.text` porta anche l'inglese
  const seen = new Set<string>([correct.text.it]);
  const pool: Opt[] = [];
  for (const c of cands) {
    if (seen.has(c.text.it) || c.v === correct.v || !Number.isFinite(c.v)) continue;
    seen.add(c.text.it);
    pool.push(c);
  }

  const kc = lead(correct.text.it);
  const byRank: { pair: [Opt, Opt]; score: number; mute: boolean; primary: boolean }[][] = [[], [], []];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const [a, b] = [pool[i], pool[j]];
      const rank = (a.v < correct.v ? 1 : 0) + (b.v < correct.v ? 1 : 0);
      const [ka, kb] = [lead(a.text.it), lead(b.text.it)];
      const leadRank = (ka < kc ? 1 : 0) + (kb < kc ? 1 : 0);
      const mute = ka === kc && kb === kc; // nessuna classifica a colpo d'occhio
      const readable = ka !== kc && kb !== kc;
      const base = mute ? 2 : readable ? (leadRank === rank ? 2 : 0) : 1;
      byRank[rank].push({ pair: [a, b], score: base, mute, primary: i === 0 || j === 0 });
    }
  }

  const filled = [0, 1, 2].filter((r) => byRank[r].length);
  if (!filled.length) throw new Error('nessuna coppia di distrattori utilizzabile');
  let r = randInt(rng, 0, 2);
  if (!byRank[r].length) {
    const ends = filled.filter((x) => x !== 1);
    r = ends.length ? pick(rng, ends) : filled[0];
  }
  const group = byRank[r];
  const best = Math.max(...group.map((p) => p.score));
  const top = group.filter((p) => p.score === best);
  // fra le coppie migliori si alterna fra quelle che una classifica la mostrano
  // e quelle che non ne mostrano nessuna (tutte e tre le opzioni cominciano con
  // lo stesso numero): nemmeno il primo numero diventa così un indizio stabile
  const kinds = [top.filter((p) => p.mute), top.filter((p) => !p.mute)].filter((k) => k.length);
  const kind = kinds.length === 2 && chance(rng, 0.5) ? kinds[0] : kinds[kinds.length - 1];
  // l'errore principale del quesito entra spesso ma non sempre: se entrasse
  // sempre trascinerebbe con sé anche la sua posizione in classifica
  const withPrimary = kind.filter((p) => p.primary);
  return pick(rng, withPrimary.length && chance(rng, 0.5) ? withPrimary : kind).pair;
}

/** opzioni testuali mescolate + le trappole scelte, da citare nella spiegazione */
function textOptions(rng: Rng, correct: Opt, cands: Opt[]) {
  const picked = twoDistractors(rng, correct, cands);
  const opt = (o: Opt): ChoiceVisual => ({ kind: 'text', text: o.text });
  const { choices, correctIndex } = placeChoices(rng, opt(correct), [opt(picked[0]), opt(picked[1])]);
  const traps = L(`${picked[0].why.it}; ${picked[1].why.it}`, `${picked[0].why.en}; ${picked[1].why.en}`);
  return { choices, correctIndex, picked, traps };
}

function clockChoices(rng: Rng, correctT: number, cands: number[]) {
  const c = norm(correctT);
  const [a, b] = twoOf(rng, c, cands.map(norm));
  const opt = (t: number): ChoiceVisual => ({ kind: 'clock', clock: clockOf(t) });
  return placeChoices(rng, opt(c), [opt(a), opt(b)]);
}

const STEPS = [20, 25, 35, 40, 45, 50] as const;
const BIG_STEPS = [70, 75, 80, 85, 90, 95, 100, 105, 110] as const;

/**
 * Scenari dei due orologi: le etichette compaiono sotto i quadranti. Un solo
 * `pick` sceglie l'intero scenario: `a`, `b` e `q` viaggiano insieme, già
 * bilingui, così non serve un secondo sorteggio per l'inglese.
 */
const SCENARIOS = [
  {
    a: L('Prima', 'Before'),
    b: L('Dopo', 'After'),
    q: L('Quanto tempo è passato dal primo orologio al secondo?', 'How much time passed between the first clock and the second?'),
  },
  {
    a: L('Inizio', 'Start'),
    b: L('Fine', 'End'),
    q: L(
      'Il gioco comincia all’ora del primo orologio e finisce a quella del secondo: quanto dura?',
      'The game starts at the time on the first clock and ends at the time on the second: how long does it last?'
    ),
  },
  {
    a: L('Partenza', 'Departure'),
    b: L('Arrivo', 'Arrival'),
    q: L(
      'Il treno parte all’ora del primo orologio e arriva a quella del secondo: quanto dura il viaggio?',
      'The train leaves at the time on the first clock and arrives at the time on the second: how long is the trip?'
    ),
  },
  {
    a: L('Sveglia', 'Wake-up'),
    b: L('Colazione', 'Breakfast'),
    q: L(
      'Ci si sveglia all’ora del primo orologio e si fa colazione a quella del secondo: quanto tempo passa?',
      'You wake up at the time on the first clock and have breakfast at the time on the second: how much time goes by?'
    ),
  },
  {
    a: L('Andata', 'There'),
    b: L('Ritorno', 'Back'),
    q: L(
      'Si parte all’ora del primo orologio e si torna a quella del secondo: quanto tempo passa?',
      'You leave at the time on the first clock and get back at the time on the second: how much time goes by?'
    ),
  },
  {
    a: L('Entrata', 'In'),
    b: L('Uscita', 'Out'),
    q: L(
      'Si entra all’ora del primo orologio e si esce a quella del secondo: quanto tempo si resta dentro?',
      'You go in at the time on the first clock and come out at the time on the second: how long do you stay inside?'
    ),
  },
] as const;

/**
 * Momenti della giornata usati come etichetta nelle domande sull'angolo: a ogni
 * momento sono associate solo ore plausibili, così la scena resta credibile.
 */
const MOMENTS_D2 = [
  { label: L('Ricreazione', 'Recess'), phrase: L('È l’ora della ricreazione.', 'It’s recess time.'), hours: [10, 11] },
  { label: L('Pranzo', 'Lunch'), phrase: L('È l’ora di pranzo.', 'It’s lunchtime.'), hours: [0, 1] },
  { label: L('Merenda', 'Snack'), phrase: L('È l’ora della merenda.', 'It’s snack time.'), hours: [4, 5] },
] as const;

const MOMENTS_D3 = [
  { label: L('Compiti', 'Homework'), phrase: L('È l’ora dei compiti.', 'It’s homework time.'), hours: [4, 5, 6] },
  { label: L('Allenamento', 'Practice'), phrase: L('È l’ora dell’allenamento.', 'It’s practice time.'), hours: [5, 6, 7] },
  { label: L('Cena', 'Dinner'), phrase: L('È l’ora di cena.', 'It’s dinnertime.'), hours: [7, 8, 9] },
  { label: L('Buonanotte', 'Bedtime'), phrase: L('È l’ora della buonanotte.', 'It’s bedtime.'), hours: [9, 10, 11] },
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
        ? [clockOf(t, L('Adesso', 'Now'))]
        : fwd
          ? [clockOf(t, L('Adesso', 'Now')), unknownClock(L('Dopo', 'After'))]
          : [unknownClock(L('Prima', 'Before')), clockOf(t, L('Adesso', 'Now'))];

  const m = minOf(t);
  const carry = fwd
    ? m + n >= 60
      ? ` I minuti fanno ${m} + ${n} = ${m + n}: più di un giro, quindi si scavalca l’ora.`
      : ''
    : m - n < 0
      ? ` I minuti segnati (${m}) non bastano per toglierne ${n}: si scende di un’ora e si prendono in prestito 60 minuti.`
      : '';
  const carryEn = fwd
    ? m + n >= 60
      ? ` The minutes add up to ${m} + ${n} = ${m + n}: more than a full lap, so it rolls over into the next hour.`
      : ''
    : m - n < 0
      ? ` The minutes shown (${m}) aren’t enough to subtract ${n}: it drops an hour and borrows 60 minutes.`
      : '';

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: fwd
      ? L(`Che ora segnerà l’orologio tra ${n} minuti?`, `What time will the clock show in ${n} minutes?`)
      : L(`Che ora segnava l’orologio ${n} minuti fa?`, `What time did the clock show ${n} minutes ago?`),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `L’orologio segna le ${fmt(t)}: andando ${fwd ? 'avanti' : 'indietro'} di ${n} minuti si arriva alle ` +
        `${fmt(correctT)}.${carry} Trappole: un orologio si sposta dalla parte sbagliata (${fmt(oppT)}), ` +
        `un altro sbaglia di un’ora esatta.`,
      `The clock shows ${fmt(t)}: going ${fwd ? 'forward' : 'back'} ${n} minutes lands on ` +
        `${fmt(correctT)}.${carryEn} Traps: one clock moves the wrong way (${fmt(oppT)}), ` +
        `another is off by exactly one hour.`
    ),
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
      ? [clockOf(t, L('Ora', 'Now'))]
      : fwd
        ? [clockOf(t, L('Ora', 'Now')), unknownClock(L('Più tardi', 'Later'))]
        : [unknownClock(L('Prima', 'Before')), clockOf(t, L('Ora', 'Now'))];

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: fwd
      ? L(`Che ora segnerà l’orologio tra ${n} ore?`, `What time will the clock show in ${n} hours?`)
      : L(`Che ora segnava l’orologio ${n} ore fa?`, `What time did the clock show ${n} hours ago?`),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `Con le ore intere la lancetta lunga non si muove: resta dov’è. Si sposta solo quella corta, di ` +
        `${n} ore ${fwd ? 'in avanti' : 'indietro'}: dalle ${fmt(t)} alle ${fmt(correctT)}. Occhio che dopo il 12 si ` +
        `ricomincia da 1: chi conta ${n} ore dalla parte sbagliata arriva alle ${fmt(oppT)}.`,
      `With whole hours the minute hand doesn’t move: it stays put. Only the hour hand moves, ` +
        `${n} hours ${fwd ? 'forward' : 'back'}: from ${fmt(t)} to ${fmt(correctT)}. Watch out, after 12 it starts ` +
        `over at 1: counting the ${n} hours the wrong way lands on ${fmt(oppT)}.`
    ),
  };
}

// ---------------------------------------------------------------------------
// d1c: due orologi, "quanto tempo è passato?" (senza riporto sui minuti)
// ---------------------------------------------------------------------------

function d1Elapsed(rng: Rng): Question {
  const sc = pick(rng, SCENARIOS);
  // Le durate sotto l'ora ("40 min") pesano più di 1/4 apposta: quando la
  // risposta contiene le ore ("2 h 15 min") il numero che si legge per primo è
  // il piccolo numero delle ore, e nessun errore plausibile ha MENO ore della
  // risposta giusta — le durate corte riportano in pari la classifica.
  const H = pick(rng, [0, 0, 1, 1, 2, 3]);
  // Se la risposta sta sotto l'ora serve che sia abbastanza grande da avere due
  // errori plausibili PIÙ PICCOLI (un trattino in meno, i minuti letti sul
  // primo orologio): sotto la mezz'ora la risposta finirebbe sempre a essere la
  // più piccola delle tre. È la stessa cautela di MIN_COUNT_ANSWER in pattern.ts.
  // con le ore i minuti piccoli sono più frequenti: solo con M < 30 l'errore
  // "minuti contati dalla parte sbagliata" cade SOPRA la risposta, e la risposta
  // può capitare anche in fondo alla classifica
  const M = H === 0 ? pick(rng, [30, 40, 45]) : pick(rng, [0, 10, 10, 15, 15, 20, 20, 25, 25, 30, 40, 45]);
  // Niente riporto: i minuti da aggiungere non fanno scavalcare l'ora. Il primo
  // orologio non segna mai l'ora tonda (m1 ≥ 10): i minuti che segna sono uno
  // degli errori plausibili, e servono sotto la risposta per equilibrare.
  const m1 = randInt(rng, 2, Math.floor((55 - M) / 5)) * 5;
  const t1 = randInt(rng, 0, 11) * 60 + m1;
  const gap = H * 60 + M;
  const t2 = norm(t1 + gap);

  // errori plausibili, sopra e sotto la risposta: servono entrambi i lati perché
  // la risposta possa capitare tanto in mezzo quanto agli estremi
  const cands: Opt[] = [
    optDur(gap + 60, L(`chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`, `counting one hour too many lands on ${fmtDurEn(gap + 60)}`)),
  ];
  if (gap > 60)
    cands.push(optDur(gap - 60, L(`chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`, `forgetting an hour stops at ${fmtDurEn(gap - 60)}`)));
  if (M !== 0 && M !== 30) {
    const back = H * 60 + (60 - M);
    cands.push(
      optDur(
        back,
        L(
          `chi conta i minuti dalla parte sbagliata (${60 - M} invece di ${M}) dice ${fmtDur(back)}`,
          `counting the minutes the wrong way (${60 - M} instead of ${M}) gives ${fmtDurEn(back)}`
        )
      )
    );
  }
  cands.push(optDur(gap + 5, L(`chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`, `counting one tick too many gives ${fmtDurEn(gap + 5)}`)));
  cands.push(optDur(gap - 5, L(`chi conta un trattino in meno dice ${fmtDur(gap - 5)}`, `counting one tick too few gives ${fmtDurEn(gap - 5)}`)));
  if (M !== 0) {
    cands.push(
      optDur((H + 1) * 60, L(`chi arrotonda all’ora intera dice ${fmtDur((H + 1) * 60)}`, `rounding up to the full hour gives ${fmtDurEn((H + 1) * 60)}`))
    );
  }
  if (H > 0 && M > 0) {
    cands.push(
      optDur(M, L(`chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(M)}`, `looking only at the minute hand and forgetting the hours gives ${fmtDurEn(M)}`))
    );
    cands.push(optDur(H * 60, L(`chi conta solo le ore intere dice ${fmtDur(H * 60)}`, `counting only the whole hours gives ${fmtDurEn(H * 60)}`)));
  }
  // scambia il RISULTATO con una delle due letture: non conta quanti minuti
  // passano, legge i minuti segnati da uno dei due orologi
  cands.push(
    optDur(minOf(t2), L(`chi legge i minuti dell’orologio di arrivo dice ${fmtDur(minOf(t2))}`, `reading the minutes off the arrival clock gives ${fmtDurEn(minOf(t2))}`))
  );
  cands.push(optDur(m1, L(`chi legge i minuti dell’orologio di partenza dice ${fmtDur(m1)}`, `reading the minutes off the departure clock gives ${fmtDurEn(m1)}`)));
  const { choices, correctIndex, traps } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
  );

  let expl = `Il primo orologio segna le ${fmt(t1)}, il secondo le ${fmt(t2)}. `;
  let explEn = `The first clock shows ${fmt(t1)}, the second ${fmt(t2)}. `;
  if (H > 0 && M > 0) {
    expl += `Si contano prima le ore intere — dalle ${fmt(t1)} alle ${fmt(t1 + H * 60)} passano ${H} ${
      H === 1 ? 'ora' : 'ore'
    } — poi i minuti che restano: ${M}. In tutto ${fmtDur(gap)}.`;
    explEn += `First count the whole hours — from ${fmt(t1)} to ${fmt(t1 + H * 60)} that’s ${H} ${
      H === 1 ? 'hour' : 'hours'
    } — then the minutes left over: ${M}. All together, ${fmtDurEn(gap)}.`;
  } else if (H > 0) {
    expl += `La lancetta lunga è ferma nello stesso punto, quindi sono passate ore intere: ${fmtDur(gap)}.`;
    explEn += `The minute hand is stuck in the same spot, so whole hours went by: ${fmtDurEn(gap)}.`;
  } else {
    expl += `L’ora non cambia: basta contare i minuti, da ${minOf(t1)} a ${minOf(t2)}, cioè ${M} minuti.`;
    explEn += `The hour doesn’t change: just count the minutes, from ${minOf(t1)} to ${minOf(t2)}, which is ${M} minutes.`;
  }
  expl += ` Trappole: ${traps.it}.`;
  explEn += ` Traps: ${traps.en}.`;

  return {
    qtype: 'clock',
    difficulty: 1,
    prompt: sc.q,
    payload: { kind: 'clock', clocks: [clockOf(t1, sc.a), clockOf(t2, sc.b)] },
    choices,
    correctIndex,
    explanation: L(expl, explEn),
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
  const half = norm(hourOf(seen) * 60 + minOf(real)); // riflette i minuti, non le ore
  const halfH = norm(hourOf(real) * 60 + mm); // riflette le ore, non i minuti
  const cands: Opt[] = [
    optTime(seen, L(`chi si fida dell’immagine risponde ${fmt(seen)}`, `trusting the image gives ${fmt(seen)}`)),
    optTime(
      half,
      L(`chi riflette i minuti ma tiene l’ora dell’immagine risponde ${fmt(half)}`, `reflecting the minutes but keeping the image’s hour gives ${fmt(half)}`)
    ),
    optTime(
      halfH,
      L(`chi riflette le ore ma tiene i minuti dell’immagine risponde ${fmt(halfH)}`, `reflecting the hour but keeping the image’s minutes gives ${fmt(halfH)}`)
    ),
    optTime(
      real + 60,
      L(`chi conta le ore all’indietro dal 12 e ne salta una arriva a ${fmt(real + 60)}`, `counting the hours back from 12 and skipping one lands on ${fmt(real + 60)}`)
    ),
    optTime(
      real - 60,
      L(
        `chi conta le ore all’indietro dal 12 e ne conta una in meno arriva a ${fmt(real - 60)}`,
        `counting the hours back from 12 and counting one too few lands on ${fmt(real - 60)}`
      )
    ),
    optTime(seen + 60, L(`chi legge l’immagine e sbaglia anche di un’ora dice ${fmt(seen + 60)}`, `reading the image and also getting the hour wrong gives ${fmt(seen + 60)}`)),
    optTime(seen - 60, L(`chi legge l’immagine e sbaglia anche di un’ora dice ${fmt(seen - 60)}`, `reading the image and also getting the hour wrong gives ${fmt(seen - 60)}`)),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(real), cands);
  const clocks = chance(rng, 0.5) ? [mirroredClock(real)] : [mirroredClock(real, L('Allo specchio', 'In the mirror'))];
  const minRule = mm === 0 ? 'i minuti restano a 0' : `i minuti diventano 60 − ${mm} = ${60 - mm}`;
  const minRuleEn = mm === 0 ? 'the minutes stay at 0' : `the minutes become 60 − ${mm} = ${60 - mm}`;

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: L('Questo orologio è visto allo specchio: che ora è davvero?', 'This clock is seen in a mirror: what time is it really?'),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `Allo specchio destra e sinistra si scambiano: l’immagine sembra segnare le ${fmt(seen)}, ma per l’ora vera ` +
        `bisogna riflettere di nuovo le lancette. ${minRule[0].toUpperCase()}${minRule.slice(1)} e le ore si contano ` +
        `all’indietro partendo dal 12: l’ora vera è le ${fmt(real)}. Trappole: ${traps.it}.`,
      `In a mirror, left and right swap: the image seems to show ${fmt(seen)}, but to find the real time you need ` +
        `to flip the hands back. ${minRuleEn[0].toUpperCase()}${minRuleEn.slice(1)} and the hours are counted ` +
        `backward from 12: the real time is ${fmt(real)}. Traps: ${traps.en}.`
    ),
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
  // Sotto i 90° non esistono DUE angoli più piccoli plausibili (uno spazio in
  // meno vale 30° e sotto i 15° nessuna opzione è credibile): la risposta
  // finirebbe sempre a essere la più piccola delle tre e basterebbe scegliere
  // quella per vincere senza guardare le lancette. Gli angoli stretti si
  // scartano e la domanda si rigenera.
  if (correct < 90) throw new Error('angolo troppo stretto per distrattori equilibrati');

  // ogni distrattore porta con sé la spiegazione dell'errore che rappresenta
  const stat = staticAngle(t);
  const cands: Opt[] = [];
  if (stat !== correct) {
    cands.push(
      optDeg(
        stat,
        L(
          `la lancetta corta NON sta ferma sul numero — in ${m} minuti si è già spostata di ${0.5 * m}° — ` +
            `e chi la crede ferma risponde ${stat}°`,
          `the hour hand does NOT stay put on the number — in ${m} minutes it has already moved ${0.5 * m}° — ` +
            `so thinking it hasn’t gives ${stat}°`
        )
      )
    );
  }
  // legge la lancetta corta sul numero prima o su quello dopo (a mezz'ora sta in
  // mezzo ai due, ed è lì che l'occhio sbaglia)
  for (const dh of [1, -1]) {
    const mis = angleAt(((h + dh + 12) % 12) * 60 + m);
    if (mis !== correct) {
      cands.push(
        optDeg(
          mis,
          L(
            `chi legge la lancetta corta sul numero ${dh > 0 ? 'dopo' : 'prima'} risponde ${mis}°`,
            `reading the hour hand on the number ${dh > 0 ? 'after' : 'before'} gives ${mis}°`
          )
        )
      );
    }
  }
  if (360 - correct !== correct) {
    cands.push(
      optDeg(
        360 - correct,
        L(
          `dall’altra parte del quadrante l’angolo misura ${360 - correct}°, ma qui serve il più piccolo`,
          `on the other side of the face the angle measures ${360 - correct}°, but here you need the smaller one`
        )
      )
    );
  }
  if (correct + 30 <= 330) {
    cands.push(
      optDeg(
        correct + 30,
        L(
          `chi conta i numeri invece degli spazi sbaglia di un’ora di quadrante e risponde ${correct + 30}°`,
          `counting the numbers instead of the gaps is off by one clock-hour and gives ${correct + 30}°`
        )
      )
    );
  }
  if (correct + 60 <= 330) {
    cands.push(
      optDeg(
        correct + 60,
        L(`chi si conta due spazi di troppo sul quadrante risponde ${correct + 60}°`, `counting two gaps too many on the face gives ${correct + 60}°`)
      )
    );
  }
  if (correct - 30 >= 5) {
    cands.push(optDeg(correct - 30, L(`chi conta uno spazio in meno risponde ${correct - 30}°`, `counting one gap too few gives ${correct - 30}°`)));
  }
  if (correct - 60 >= 15) {
    cands.push(
      optDeg(
        correct - 60,
        L(`chi perde due spazi contando sul quadrante risponde ${correct - 60}°`, `losing count of two gaps on the face gives ${correct - 60}°`)
      )
    );
  }
  // angoli troppo sottili non sono opzioni credibili: si scartano
  const { choices, correctIndex, traps } = textOptions(
    rng,
    optDeg(correct),
    cands.filter((c) => c.v >= 15)
  );

  const hd = 30 * h + 0.5 * m;
  const md = 6 * m;
  const raw = Math.abs(hd - md);

  return {
    qtype: 'clock',
    difficulty,
    prompt: L(
      (plain ? '' : moment.phrase.it + ' ') + 'Quanti gradi misura l’angolo più piccolo fra le due lancette?',
      (plain ? '' : moment.phrase.en + ' ') + 'How many degrees is the smaller angle between the two hands?'
    ),
    payload: { kind: 'clock', clocks: [plain ? clockOf(t) : clockOf(t, moment.label)] },
    choices,
    correctIndex,
    explanation: L(
      `Il quadrante è diviso in 12 ore, quindi ogni ora vale 360 ÷ 12 = 30°; in più la lancetta delle ore avanza di ` +
        `mezzo grado al minuto. Alle ${fmt(t)} la lancetta lunga è a ${md}° dal 12 e quella corta a ${hd}°. ` +
        `La differenza è ${raw}°${
          raw > 180 ? `: più di mezzo giro, quindi l’angolo piccolo è 360 − ${raw} = ${correct}°` : ', ed è già il più piccolo'
        }. Trappole: ${traps.it}.`,
      `The face is split into 12 hours, so each hour is worth 360 ÷ 12 = 30°; on top of that, the hour hand moves ` +
        `half a degree every minute. At ${fmt(t)} the minute hand is at ${md}° from the 12 and the hour hand at ${hd}°. ` +
        `The difference is ${raw}°${
          raw > 180 ? `: more than half a turn, so the smaller angle is 360 − ${raw} = ${correct}°` : ', and that’s already the smaller one'
        }. Traps: ${traps.en}.`
    ),
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
  const cands: Opt[] = [
    optTime(trueT, L(`chi si dimentica dello scarto risponde ${fmt(trueT)}`, `forgetting the drift gives ${fmt(trueT)}`)),
    optTime(
      norm(trueT + dir * g),
      L(
        `chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(norm(trueT + dir * g))}`,
        `applying the drift only once instead of ${n} times gives ${fmt(norm(trueT + dir * g))}`
      )
    ),
    optTime(
      norm(trueT - dir * n * g),
      L(`chi sbaglia il verso dello scarto risponde ${fmt(norm(trueT - dir * n * g))}`, `getting the direction of the drift wrong gives ${fmt(norm(trueT - dir * n * g))}`)
    ),
    optTime(
      norm(correctT + dir * g),
      L(
        `chi conta ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(correctT + dir * g)}`,
        `counting ${n + 1} hours of drift instead of ${n} (the mistake of also counting the starting hour) gives ${fmt(correctT + dir * g)}`
      )
    ),
    optTime(
      norm(correctT + 60),
      L(`chi conta un’ora di troppo fra le ${n} che passano arriva alle ${fmt(correctT + 60)}`, `counting one hour too many among the ${n} that pass lands on ${fmt(correctT + 60)}`)
    ),
    optTime(
      norm(correctT - 60),
      L(`chi conta un’ora in meno fra le ${n} che passano arriva alle ${fmt(correctT - 60)}`, `counting one hour too few among the ${n} that pass lands on ${fmt(correctT - 60)}`)
    ),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
  const clocks = chance(rng, 0.5)
    ? [clockOf(t, L('Ora esatta', 'Exact time'))]
    : [clockOf(t, L('Ora esatta', 'Exact time')), unknownClock(L('Poi', 'Then'))];

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: L(
      `Questo orologio adesso è giusto, ma ${fast ? 'va avanti' : 'resta indietro'} di ${g} minuti ogni ora. ` +
        `Che ora segnerà fra ${n} ore?`,
      `This clock is right now, but it ${fast ? 'runs fast' : 'runs slow'} by ${g} minutes every hour. ` +
        `What time will it show in ${n} hours?`
    ),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `In ${n} ore l’errore si accumula: ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. ` +
        `L’ora giusta fra ${n} ore sarà le ${fmt(trueT)}; l’orologio segnerà ${n * g} minuti ${
          fast ? 'più avanti' : 'più indietro'
        }, cioè le ${fmt(correctT)}. Trappole: ${traps.it}.`,
      `Over ${n} hours the error builds up: ${n} × ${g} = ${n * g} minutes ${fast ? 'ahead' : 'behind'}. ` +
        `The correct time in ${n} hours will be ${fmt(trueT)}; the clock will show ${n * g} minutes ${
          fast ? 'later' : 'earlier'
        }, that is ${fmt(correctT)}. Traps: ${traps.en}.`
    ),
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
  // come in d1: le durate sotto l'ora tengono in pari la classifica delle opzioni
  const H = pick(rng, [0, 0, 1, 1, 2, 3]);
  const gap = H * 60 + M;
  const t2 = norm(t1 + gap);
  const m2 = minOf(t2);

  // errore classico: sottrazione "in colonna" ore-ore e minuti-minuti, senza prestito
  const naive = (H + 1) * 60 + (60 - M);
  const cands: Opt[] = [
    optDur(naive, L(`chi sottrae in colonna, senza prestito, ottiene ${fmtDur(naive)}`, `subtracting column-by-column, without borrowing, gives ${fmtDurEn(naive)}`)),
    optDur(gap + 60, L(`chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`, `counting one hour too many lands on ${fmtDurEn(gap + 60)}`)),
  ];
  if (gap > 60)
    cands.push(optDur(gap - 60, L(`chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`, `forgetting an hour stops at ${fmtDurEn(gap - 60)}`)));
  if (M !== 30) {
    const back = H * 60 + (60 - M);
    cands.push(
      optDur(
        back,
        L(
          `chi conta i minuti dalla parte sbagliata (${60 - M} invece di ${M}) dice ${fmtDur(back)}`,
          `counting the minutes the wrong way (${60 - M} instead of ${M}) gives ${fmtDurEn(back)}`
        )
      )
    );
  }
  cands.push(
    optDur((H + 1) * 60, L(`chi arrotonda all’ora intera dice ${fmtDur((H + 1) * 60)}`, `rounding up to the full hour gives ${fmtDurEn((H + 1) * 60)}`))
  );
  cands.push(optDur(gap + 5, L(`chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`, `counting one tick too many gives ${fmtDurEn(gap + 5)}`)));
  cands.push(optDur(gap - 5, L(`chi conta un trattino in meno dice ${fmtDur(gap - 5)}`, `counting one tick too few gives ${fmtDurEn(gap - 5)}`)));
  if (H > 0) {
    cands.push(
      optDur(M, L(`chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(M)}`, `looking only at the minute hand and forgetting the hours gives ${fmtDurEn(M)}`))
    );
    cands.push(optDur(H * 60, L(`chi conta solo le ore intere dice ${fmtDur(H * 60)}`, `counting only the whole hours gives ${fmtDurEn(H * 60)}`)));
  }
  // scambia il RISULTATO con una delle due letture (i minuti segnati da un
  // orologio invece di quelli che passano)
  cands.push(optDur(m2, L(`chi legge i minuti dell’orologio di arrivo dice ${fmtDur(m2)}`, `reading the minutes off the arrival clock gives ${fmtDurEn(m2)}`)));
  cands.push(optDur(m1, L(`chi legge i minuti dell’orologio di partenza dice ${fmtDur(m1)}`, `reading the minutes off the departure clock gives ${fmtDurEn(m1)}`)));
  const { choices, correctIndex, picked } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
  );
  // la sottrazione in colonna è LA lezione di questa variante: si spiega sempre,
  // anche quando fra le opzioni è finito un altro errore
  const others = picked
    .filter((o) => o.v !== naive)
    .map((o) => o.why.it)
    .join('; ');
  const othersEn = picked
    .filter((o) => o.v !== naive)
    .map((o) => o.why.en)
    .join('; ');

  const r = 60 - m1; // minuti che mancano all'ora tonda
  const rest = gap - r;
  const leg2 = rest === 0 ? '' : ` poi dalle ${fmt(t1 + r)} alle ${fmt(t2)} ne passano ancora ${fmtDur(rest)};`;
  const leg2En = rest === 0 ? '' : ` then from ${fmt(t1 + r)} to ${fmt(t2)} another ${fmtDurEn(rest)} pass;`;
  const h1d = hourOf(t1) === 0 ? 12 : hourOf(t1);
  const h2d = hourOf(t2) === 0 ? 12 : hourOf(t2);
  // il conto "in colonna" si cita con i numeri solo se non fa comparire ore negative
  const column = h2d > h1d ? `(${h2d} − ${h1d} ore e ${m1} − ${m2} minuti)` : 'ore con ore e minuti con minuti';
  const columnEn = h2d > h1d ? `(${h2d} − ${h1d} hours and ${m1} − ${m2} minutes)` : 'hours with hours and minutes with minutes';

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: sc.q,
    payload: { kind: 'clock', clocks: [clockOf(t1, sc.a), clockOf(t2, sc.b)] },
    choices,
    correctIndex,
    explanation: L(
      `Dalle ${fmt(t1)} alle ${fmt(t2)}. Il trucco è fermarsi all’ora tonda: dalle ${fmt(t1)} alle ${fmt(t1 + r)} ` +
        `passano ${r} minuti;${leg2} in tutto ${fmtDur(gap)}. Chi invece sottrae in colonna ${column} ottiene ` +
        `${fmtDur(naive)}: sbagliato, perché i minuti non arrivano a 100 ma a 60.` +
        (others ? ` Altra trappola: ${others}.` : ''),
      `From ${fmt(t1)} to ${fmt(t2)}. The trick is to stop at the round hour: from ${fmt(t1)} to ${fmt(t1 + r)} ` +
        `that’s ${r} minutes;${leg2En} in total ${fmtDurEn(gap)}. Subtracting column-by-column ${columnEn} instead gives ` +
        `${fmtDurEn(naive)}: wrong, because minutes don’t go up to 100, only to 60.` +
        (othersEn ? ` Another trap: ${othersEn}.` : '')
    ),
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
    prompt: L(
      'Fra un orologio e il successivo passa sempre lo stesso tempo. Che ora segna l’ultimo?',
      'The same amount of time passes between one clock and the next. What time does the last one show?'
    ),
    payload: { kind: 'clock', clocks: [...visible.map((t) => clockOf(t)), unknownClock()] },
    choices,
    correctIndex,
    explanation: L(
      `Fra ${fmt(visible[0])} e ${fmt(visible[1])} passano ${fmtDur(s)}: è il passo della serie. Applicandolo ` +
        `all’ultimo orologio visibile (${fmt(visible[k - 1])}) si arriva alle ${fmt(correctT)}. Chi si ferma un passo ` +
        `prima risponde ${fmt(norm(correctT - s))}.`,
      `Between ${fmt(visible[0])} and ${fmt(visible[1])}, ${fmtDurEn(s)} pass: that’s the step of the series. Applying it ` +
        `to the last clock shown (${fmt(visible[k - 1])}) lands on ${fmt(correctT)}. Stopping one step ` +
        `early gives ${fmt(norm(correctT - s))}.`
    ),
  };
}

// ---------------------------------------------------------------------------
// d2f: salto di più di un'ora ("tra 100 minuti")
// ---------------------------------------------------------------------------

function d2BigStep(rng: Rng): Question {
  const t = randTime(rng);
  const n = pick(rng, BIG_STEPS);
  const correctT = norm(t + n);
  const cands: Opt[] = [
    optTime(norm(t + n - 60), L(`chi somma i minuti e si dimentica l’ora arriva alle ${fmt(t + n - 60)}`, `adding the minutes and forgetting the hour lands on ${fmt(t + n - 60)}`)),
    optTime(norm(t + n + 60), L(`chi aggiunge due ore invece di una arriva alle ${fmt(t + n + 60)}`, `adding two hours instead of one lands on ${fmt(t + n + 60)}`)),
    optTime(norm(t - n), L(`chi gira le lancette dalla parte sbagliata dice ${fmt(t - n)}`, `turning the hands the wrong way gives ${fmt(t - n)}`)),
    optTime(
      norm(t + 60),
      L(`chi aggiunge l’ora e si scorda i ${n - 60} minuti che restano dice ${fmt(t + 60)}`, `adding the hour and forgetting the remaining ${n - 60} minutes gives ${fmt(t + 60)}`)
    ),
    optTime(norm(t + n - 5), L(`chi conta un trattino in meno dice ${fmt(t + n - 5)}`, `counting one tick too few gives ${fmt(t + n - 5)}`)),
    optTime(norm(t + n + 5), L(`chi conta un trattino di troppo dice ${fmt(t + n + 5)}`, `counting one tick too many gives ${fmt(t + n + 5)}`)),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: L(`Che ora segnerà l’orologio fra ${n} minuti?`, `What time will the clock show in ${n} minutes?`),
    payload: { kind: 'clock', clocks: [clockOf(t, L('Adesso', 'Now'))] },
    choices,
    correctIndex,
    explanation: L(
      `${n} minuti sono 1 ora e ${n - 60} minuti. Dalle ${fmt(t)} si aggiunge prima l’ora (${fmt(t + 60)}) e poi i ` +
        `${n - 60} minuti che restano: ${fmt(correctT)}. Trappole: ${traps.it}.`,
      `${n} minutes is 1 hour and ${n - 60} minutes. From ${fmt(t)}, first add the hour (${fmt(t + 60)}) and then the ` +
        `remaining ${n - 60} minutes: ${fmt(correctT)}. Traps: ${traps.en}.`
    ),
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
  // Finestra "comoda": né appena passata la sovrapposizione né a ridosso. Il
  // tetto è la metà del periodo (720/22 ≈ 32,7 min) perché solo così le lancette
  // in fila ma OPPOSTE arrivano dopo la sovrapposizione: senza quel distrattore
  // tutti gli errori tipici starebbero sotto la risposta e basterebbe scegliere
  // il numero più grande per vincere senza calcolare niente.
  if (correctN < 12 || correctN > 32) throw new Error('fuori finestra');
  // considera FERMA la lancetta delle ore (fattore 11/12 in meno)
  const staticN = Math.round((exact * 11) / 12);
  // crede che le lancette si sovrappongano ogni ora esatta (aggiunge 60 alla
  // sovrapposizione precedente invece di 720/11 ≈ 65,45)
  const hourlyN = Math.round(exact - MOD / 11 + 60);
  // punta al trattino DOPO la lancetta corta: 5 minuti di lancetta lunga in più
  const markN = staticN + 5;
  // si ferma quando le lancette sono in fila ma opposte (ogni 720/22 minuti)
  let opp = MOD;
  for (let k = 0; k <= 11; k++) {
    const tk = ((2 * k + 1) * MOD) / 22;
    if (tk > t + 1e-9) {
      opp = tk;
      break;
    }
  }
  const oppN = Math.round(opp - t);
  const cands: Opt[] = [
    optMins(staticN, L(`chi dimentica che anche la lancetta delle ore avanza risponde ${staticN}`, `forgetting that the hour hand also moves gives ${staticN}`)),
    optMins(hourlyN, L(`chi crede che si sovrappongano a ogni ora esatta risponde ${hourlyN}`, `thinking they overlap exactly every hour gives ${hourlyN}`)),
    optMins(markN, L(`chi punta al trattino subito dopo la lancetta corta risponde ${markN}`, `aiming for the tick right after the hour hand gives ${markN}`)),
    optMins(oppN, L(`chi si ferma quando le lancette sono in fila ma opposte risponde ${oppN}`, `stopping when the hands are in line but pointing opposite ways gives ${oppN}`)),
  ].filter((c) => c.v >= 5 && c.v !== correctN);
  const { choices, correctIndex, traps } = textOptions(rng, optMins(correctN), cands);
  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: L(
      'Tra quanti minuti le lancette delle ore e dei minuti si sovrapporranno? (arrotonda al minuto)',
      'In how many minutes will the hour and minute hands overlap? (round to the nearest minute)'
    ),
    payload: { kind: 'clock', clocks: [clockOf(t)] },
    choices,
    correctIndex,
    explanation: L(
      `Le lancette si sovrappongono 11 volte in 12 ore, cioè ogni 720/11 ≈ 65 minuti e mezzo, non ogni ora. ` +
        `Dopo le ${fmt(t)} la prossima sovrapposizione è verso le ${fmt(Math.round(next))}: mancano circa ${correctN} minuti. ` +
        `Trappole: ${traps.it}.`,
      `The hands overlap 11 times every 12 hours, that is every 720/11 ≈ 65 and a half minutes, not every hour. ` +
        `After ${fmt(t)} the next overlap is around ${fmt(Math.round(next))}: about ${correctN} minutes to go. ` +
        `Traps: ${traps.en}.`
    ),
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
  const cands: Opt[] = [
    optTime(
      norm(seen + n),
      L(`chi si dimentica dello specchio e somma alla lettura diretta arriva alle ${fmt(seen + n)}`, `forgetting the mirror and adding to the direct reading lands on ${fmt(seen + n)}`)
    ),
    optTime(norm(real - n), L(`chi riflette bene ma poi va indietro invece che avanti dice ${fmt(real - n)}`, `reflecting correctly but then going back instead of forward gives ${fmt(real - n)}`)),
    optTime(real, L(`chi si ferma all’ora vera e non aggiunge i ${n} minuti risponde ${fmt(real)}`, `stopping at the real time and not adding the ${n} minutes gives ${fmt(real)}`)),
    optTime(
      norm(hourOf(seen) * 60 + minOf(real) + n),
      L(
        `chi riflette i minuti ma tiene l’ora dell’immagine arriva alle ${fmt(hourOf(seen) * 60 + minOf(real) + n)}`,
        `reflecting the minutes but keeping the image’s hour lands on ${fmt(hourOf(seen) * 60 + minOf(real) + n)}`
      )
    ),
    optTime(norm(correctT + 5), L(`chi conta un trattino di troppo dice ${fmt(correctT + 5)}`, `counting one tick too many gives ${fmt(correctT + 5)}`)),
    optTime(norm(correctT - 5), L(`chi conta un trattino in meno dice ${fmt(correctT - 5)}`, `counting one tick too few gives ${fmt(correctT - 5)}`)),
    optTime(norm(correctT + 60), L(`chi sbaglia di un’ora nel contare all’indietro dal 12 dice ${fmt(correctT + 60)}`, `getting the hour wrong while counting back from 12 gives ${fmt(correctT + 60)}`)),
    optTime(norm(correctT - 60), L(`chi sbaglia di un’ora nel contare all’indietro dal 12 dice ${fmt(correctT - 60)}`, `getting the hour wrong while counting back from 12 gives ${fmt(correctT - 60)}`)),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
  const clocks = chance(rng, 0.5) ? [mirroredClock(real)] : [mirroredClock(real, L('Allo specchio', 'In the mirror'))];

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: L(
      `Questo orologio è visto allo specchio: che ora sarà davvero fra ${n} minuti?`,
      `This clock is seen in a mirror: what time will it really be in ${n} minutes?`
    ),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `Due passi. Primo: si riflette l’immagine — sembra segnare le ${fmt(seen)}, quindi l’ora vera è le ` +
        `${fmt(real)} (i minuti diventano 60 meno i minuti, le ore si contano all’indietro dal 12). Secondo: si ` +
        `aggiungono ${n} minuti, e si arriva alle ${fmt(correctT)}. Trappole: ${traps.it}.`,
      `Two steps. First: flip the image — it seems to show ${fmt(seen)}, so the real time is ` +
        `${fmt(real)} (the minutes become 60 minus the minutes, the hours are counted back from 12). Second: ` +
        `add ${n} minutes, landing on ${fmt(correctT)}. Traps: ${traps.en}.`
    ),
  };
}

// ---------------------------------------------------------------------------
// d3c: orologio al muro + orologio nello specchio, quanto tempo li separa
// ---------------------------------------------------------------------------

function d3MirrorCompare(rng: Rng): Question {
  const t1 = randTime(rng);
  // gli intervalli sotto l'ora pesano quanto quelli lunghi: una durata con le ore
  // ha per forza un numero iniziale piccolo e sbilancerebbe la classifica
  const gap = pick(rng, [25, 35, 40, 45, 50, 55, 65, 70, 80, 95, 100, 110, 125, 140, 155, 170]);
  const t2 = norm(t1 + gap);
  const mirrorFirst = chance(rng, 0.5);
  const reflected = mirrorFirst ? t1 : t2; // il quadrante disegnato allo specchio
  if (reflected === mirror(reflected)) throw new Error('specchio banale');
  // errore garantito: legge lo specchio come se fosse un orologio normale
  const ignored = mirrorFirst ? norm(t2 - mirror(t1)) : norm(mirror(t2) - t1);
  if (ignored === gap || ignored === 0) throw new Error('specchio ininfluente');

  const Hg = Math.floor(gap / 60);
  const Mg = gap % 60;
  const cands: Opt[] = [
    optDur(ignored, L(`chi legge lo specchio come un orologio normale calcola ${fmtDur(ignored)}`, `reading the mirror like a normal clock works out ${fmtDurEn(ignored)}`)),
    optDur(gap + 60, L(`chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`, `counting one hour too many lands on ${fmtDurEn(gap + 60)}`)),
  ];
  if (gap > 60)
    cands.push(optDur(gap - 60, L(`chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`, `forgetting an hour stops at ${fmtDurEn(gap - 60)}`)));
  // sottrazione "in colonna" senza prestito, quando i minuti scavalcano l'ora
  if (minOf(t2) < minOf(t1)) {
    const naive = (Hg + 1) * 60 + (60 - Mg);
    cands.push(optDur(naive, L(`chi sottrae in colonna, senza prestito, ottiene ${fmtDur(naive)}`, `subtracting column-by-column, without borrowing, gives ${fmtDurEn(naive)}`)));
  }
  if (Mg !== 0) {
    cands.push(optDur(gap + 5, L(`chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`, `counting one tick too many gives ${fmtDurEn(gap + 5)}`)));
    cands.push(optDur(gap - 5, L(`chi conta un trattino in meno dice ${fmtDur(gap - 5)}`, `counting one tick too few gives ${fmtDurEn(gap - 5)}`)));
    cands.push(
      optDur((Hg + 1) * 60, L(`chi arrotonda all’ora intera dice ${fmtDur((Hg + 1) * 60)}`, `rounding up to the full hour gives ${fmtDurEn((Hg + 1) * 60)}`))
    );
    if (Hg > 0) {
      cands.push(
        optDur(Mg, L(`chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(Mg)}`, `looking only at the minute hand and forgetting the hours gives ${fmtDurEn(Mg)}`))
      );
      cands.push(optDur(Hg * 60, L(`chi conta solo le ore intere dice ${fmtDur(Hg * 60)}`, `counting only the whole hours gives ${fmtDurEn(Hg * 60)}`)));
    }
  }
  const { choices, correctIndex, traps } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
  );

  const clocks = mirrorFirst
    ? [mirroredClock(t1, L('Nello specchio', 'In the mirror')), clockOf(t2, L('Al muro', 'On the wall'))]
    : [clockOf(t1, L('Al muro', 'On the wall')), mirroredClock(t2, L('Nello specchio', 'In the mirror'))];

  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: L(
      'Uno dei due orologi lo vediamo riflesso in uno specchio. Quanto tempo passa fra l’ora vera del primo e ' +
        'l’ora vera del secondo?',
      'We see one of the two clocks reflected in a mirror. How much time passes between the real time of the ' +
        'first and the real time of the second?'
    ),
    payload: { kind: 'clock', clocks },
    choices,
    correctIndex,
    explanation: L(
      `L’orologio nello specchio sembra segnare le ${fmt(mirror(reflected))}, ma riflettendo le lancette l’ora vera ` +
        `è le ${fmt(reflected)}. Le due ore vere sono ${fmt(t1)} e ${fmt(t2)}: fra loro passano ${fmtDur(gap)}. ` +
        `Trappole: ${traps.it}.`,
      `The clock in the mirror seems to show ${fmt(mirror(reflected))}, but flipping the hands the real time ` +
        `is ${fmt(reflected)}. The two real times are ${fmt(t1)} and ${fmt(t2)}: ${fmtDurEn(gap)} pass between them. ` +
        `Traps: ${traps.en}.`
    ),
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
    const cands: Opt[] = [
      optTime(norm(shown + dir * n * g), L(`chi corregge nel verso sbagliato risponde ${fmt(shown + dir * n * g)}`, `correcting in the wrong direction gives ${fmt(shown + dir * n * g)}`)),
      optTime(
        norm(shown - dir * g),
        L(`chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(shown - dir * g)}`, `applying the drift only once instead of ${n} times gives ${fmt(shown - dir * g)}`)
      ),
      optTime(shown, L(`chi si fida di quello che segna il quadrante risponde ${fmt(shown)}`, `trusting what the face shows gives ${fmt(shown)}`)),
      optTime(
        norm(realT - dir * g),
        L(
          `chi toglie ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(realT - dir * g)}`,
          `removing ${n + 1} hours of drift instead of ${n} (the mistake of also counting the starting hour) gives ${fmt(realT - dir * g)}`
        )
      ),
      optTime(norm(realT + 60), L(`chi sbaglia di un’ora nel conto dello scarto dice ${fmt(realT + 60)}`, `getting the hour wrong while working out the drift gives ${fmt(realT + 60)}`)),
      optTime(norm(realT - 60), L(`chi sbaglia di un’ora nel conto dello scarto dice ${fmt(realT - 60)}`, `getting the hour wrong while working out the drift gives ${fmt(realT - 60)}`)),
    ];
    const { choices, correctIndex, traps } = textOptions(rng, optTime(realT), cands);
    return {
      qtype: 'clock',
      difficulty: 3,
      prompt: L(
        `Questo orologio ${fast ? 'va avanti' : 'resta indietro'} di ${g} minuti ogni ora ed è stato messo all’ora ` +
          `giusta ${n} ore fa. Che ora è davvero adesso?`,
        `This clock ${fast ? 'runs fast' : 'runs slow'} by ${g} minutes every hour and was set to the right time ` +
          `${n} hours ago. What time is it really now?`
      ),
      payload: { kind: 'clock', clocks: [clockOf(shown, L('Orologio rotto', 'Broken clock')), unknownClock(L('Ora esatta', 'Exact time'))] },
      choices,
      correctIndex,
      explanation: L(
        `In ${n} ore ha accumulato ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. Segna le ` +
          `${fmt(shown)}, quindi l’ora vera sta ${n * g} minuti ${fast ? 'indietro' : 'avanti'}: sono le ${fmt(realT)}. ` +
          `Trappole: ${traps.it}.`,
        `In ${n} hours it has built up ${n} × ${g} = ${n * g} minutes ${fast ? 'ahead' : 'behind'}. It shows ` +
          `${fmt(shown)}, so the real time is ${n * g} minutes ${fast ? 'behind' : 'ahead'}: it’s ${fmt(realT)}. ` +
          `Traps: ${traps.en}.`
      ),
    };
  }

  // l'orologio è giusto adesso: che ora segnerà fra n ore
  const t = randTime(rng);
  const trueT = norm(t + n * 60);
  const correctT = norm(trueT + dir * n * g);
  const cands: Opt[] = [
    optTime(trueT, L(`chi si ferma all’ora giusta e dimentica lo scarto risponde ${fmt(trueT)}`, `stopping at the correct time and forgetting the drift gives ${fmt(trueT)}`)),
    optTime(
      norm(trueT + dir * g),
      L(
        `chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(trueT + dir * g)}`,
        `applying the drift only once instead of ${n} times gives ${fmt(trueT + dir * g)}`
      )
    ),
    optTime(
      norm(trueT - dir * n * g),
      L(`chi sbaglia il verso dello scarto risponde ${fmt(trueT - dir * n * g)}`, `getting the direction of the drift wrong gives ${fmt(trueT - dir * n * g)}`)
    ),
    optTime(
      norm(correctT + dir * g),
      L(
        `chi conta ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(correctT + dir * g)}`,
        `counting ${n + 1} hours of drift instead of ${n} (the mistake of also counting the starting hour) gives ${fmt(correctT + dir * g)}`
      )
    ),
    optTime(
      norm(correctT + 60),
      L(`chi conta un’ora di troppo fra le ${n} che passano arriva alle ${fmt(correctT + 60)}`, `counting one hour too many among the ${n} that pass lands on ${fmt(correctT + 60)}`)
    ),
    optTime(
      norm(correctT - 60),
      L(`chi conta un’ora in meno fra le ${n} che passano arriva alle ${fmt(correctT - 60)}`, `counting one hour too few among the ${n} that pass lands on ${fmt(correctT - 60)}`)
    ),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
  return {
    qtype: 'clock',
    difficulty: 3,
    prompt: L(
      `Adesso questo orologio segna l’ora esatta, ma ${fast ? 'guadagna' : 'perde'} ${g} minuti ogni ora. ` +
        `Che ora segnerà fra ${n} ore?`,
      `Right now this clock shows the exact time, but it ${fast ? 'gains' : 'loses'} ${g} minutes every hour. ` +
        `What time will it show in ${n} hours?`
    ),
    payload: { kind: 'clock', clocks: [clockOf(t, L('Ora esatta', 'Exact time')), unknownClock(L('Orologio rotto', 'Broken clock'))] },
    choices,
    correctIndex,
    explanation: L(
      `Lo scarto si accumula: ${n} × ${g} = ${n * g} minuti di ${fast ? 'anticipo' : 'ritardo'}. Fra ${n} ore l’ora ` +
        `giusta sarà le ${fmt(trueT)}, quindi l’orologio segnerà le ${fmt(correctT)}. Trappole: ${traps.it}.`,
      `The drift builds up: ${n} × ${g} = ${n * g} minutes ${fast ? 'ahead' : 'behind'}. In ${n} hours the correct ` +
        `time will be ${fmt(trueT)}, so the clock will show ${fmt(correctT)}. Traps: ${traps.en}.`
    ),
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
    prompt: L(
      'Guarda quanto tempo passa fra un orologio e il successivo: che ora segna l’ultimo?',
      'Look at how much time passes between one clock and the next: what time does the last one show?'
    ),
    payload: { kind: 'clock', clocks: [clockOf(t0), clockOf(t1), clockOf(t2), unknownClock()] },
    choices,
    correctIndex,
    explanation: L(
      `Gli intervalli non sono uguali, crescono: prima ${s} minuti (${fmt(t0)} → ${fmt(t1)}), poi ${s + d} ` +
        `(${fmt(t1)} → ${fmt(t2)}), cioè ${d} minuti in più ogni volta. Il passo successivo è quindi ${s + 2 * d} ` +
        `minuti: dalle ${fmt(t2)} si arriva alle ${fmt(correctT)}. Chi crede il passo costante risponde ` +
        `${fmt(norm(correctT - d))}.`,
      `The gaps aren’t equal, they grow: first ${s} minutes (${fmt(t0)} → ${fmt(t1)}), then ${s + d} ` +
        `(${fmt(t1)} → ${fmt(t2)}), that’s ${d} more minutes each time. So the next step is ${s + 2 * d} ` +
        `minutes: from ${fmt(t2)} that lands on ${fmt(correctT)}. Assuming a constant step gives ` +
        `${fmt(norm(correctT - d))}.`
    ),
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
    prompt: L(
      `Sono passati ${fmtDur(gap)} dal primo orologio al secondo. Che ora segnava il primo?`,
      `${fmtDurEn(gap)} passed between the first clock and the second one. What time did the first one show?`
    ),
    payload: { kind: 'clock', clocks: [unknownClock(L('Prima', 'Before')), clockOf(t2, L('Dopo', 'After'))] },
    choices,
    correctIndex,
    explanation: L(
      `Si torna indietro a pezzi: dalle ${fmt(t2)} si tolgono prima ${H} ${H === 1 ? 'ora' : 'ore'} ` +
        `(${fmt(norm(t2 - H * 60))}), poi ${M} minuti. Ma i minuti da togliere (${M}) sono più di quelli segnati ` +
        `(${m2}), quindi si prende in prestito un’ora: si arriva alle ${fmt(correctT)}. Chi si dimentica del prestito ` +
        `risponde ${fmt(norm(correctT + 60))}.`,
      `Work backward in pieces: from ${fmt(t2)} first subtract ${H} ${H === 1 ? 'hour' : 'hours'} ` +
        `(${fmt(norm(t2 - H * 60))}), then ${M} minutes. But the minutes to subtract (${M}) are more than the ones ` +
        `shown (${m2}), so an hour gets borrowed: that lands on ${fmt(correctT)}. Forgetting to borrow ` +
        `gives ${fmt(norm(correctT + 60))}.`
    ),
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
