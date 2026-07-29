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
  text: string;
  /** valore con cui l'opzione si confronta davvero con le altre */
  v: number;
  /** frase per la spiegazione: "chi si dimentica lo scarto risponde 5:20" */
  why: string;
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
function optTime(t: number, why = ''): Opt {
  const h = hourOf(t) === 0 ? 12 : hourOf(t);
  return { text: fmt(t), v: h * 60 + minOf(t), why };
}

/** durata: si ordina per minuti totali */
const optDur = (mins: number, why = ''): Opt => ({ text: fmtDur(mins), v: mins, why });

const optDeg = (deg: number, why = ''): Opt => ({ text: `${deg}°`, v: deg, why });

const optMins = (mins: number, why = ''): Opt => ({ text: `${mins} minuti`, v: mins, why });

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
  const seen = new Set<string>([correct.text]);
  const pool: Opt[] = [];
  for (const c of cands) {
    if (seen.has(c.text) || c.v === correct.v || !Number.isFinite(c.v)) continue;
    seen.add(c.text);
    pool.push(c);
  }

  const kc = lead(correct.text);
  const byRank: { pair: [Opt, Opt]; score: number; mute: boolean; primary: boolean }[][] = [[], [], []];
  for (let i = 0; i < pool.length; i++) {
    for (let j = i + 1; j < pool.length; j++) {
      const [a, b] = [pool[i], pool[j]];
      const rank = (a.v < correct.v ? 1 : 0) + (b.v < correct.v ? 1 : 0);
      const [ka, kb] = [lead(a.text), lead(b.text)];
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
  return { choices, correctIndex, picked, traps: `${picked[0].why}; ${picked[1].why}` };
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
  { a: 'Sveglia', b: 'Colazione', q: 'Ci si sveglia all’ora del primo orologio e si fa colazione a quella del secondo: quanto tempo passa?' },
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
    optDur(gap + 60, `chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`),
  ];
  if (gap > 60) cands.push(optDur(gap - 60, `chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`));
  if (M !== 0 && M !== 30) {
    const back = H * 60 + (60 - M);
    cands.push(optDur(back, `chi conta i minuti dalla parte sbagliata (${60 - M} invece di ${M}) dice ${fmtDur(back)}`));
  }
  cands.push(optDur(gap + 5, `chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`));
  cands.push(optDur(gap - 5, `chi conta un trattino in meno dice ${fmtDur(gap - 5)}`));
  if (M !== 0) {
    cands.push(optDur((H + 1) * 60, `chi arrotonda all’ora intera dice ${fmtDur((H + 1) * 60)}`));
  }
  if (H > 0 && M > 0) {
    cands.push(optDur(M, `chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(M)}`));
    cands.push(optDur(H * 60, `chi conta solo le ore intere dice ${fmtDur(H * 60)}`));
  }
  // scambia il RISULTATO con una delle due letture: non conta quanti minuti
  // passano, legge i minuti segnati da uno dei due orologi
  cands.push(optDur(minOf(t2), `chi legge i minuti dell’orologio di arrivo dice ${fmtDur(minOf(t2))}`));
  cands.push(optDur(m1, `chi legge i minuti dell’orologio di partenza dice ${fmtDur(m1)}`));
  const { choices, correctIndex, traps } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
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
  expl += ` Trappole: ${traps}.`;

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
  const half = norm(hourOf(seen) * 60 + minOf(real)); // riflette i minuti, non le ore
  const halfH = norm(hourOf(real) * 60 + mm); // riflette le ore, non i minuti
  const cands: Opt[] = [
    optTime(seen, `chi si fida dell’immagine risponde ${fmt(seen)}`),
    optTime(half, `chi riflette i minuti ma tiene l’ora dell’immagine risponde ${fmt(half)}`),
    optTime(halfH, `chi riflette le ore ma tiene i minuti dell’immagine risponde ${fmt(halfH)}`),
    optTime(real + 60, `chi conta le ore all’indietro dal 12 e ne salta una arriva a ${fmt(real + 60)}`),
    optTime(real - 60, `chi conta le ore all’indietro dal 12 e ne conta una in meno arriva a ${fmt(real - 60)}`),
    optTime(seen + 60, `chi legge l’immagine e sbaglia anche di un’ora dice ${fmt(seen + 60)}`),
    optTime(seen - 60, `chi legge l’immagine e sbaglia anche di un’ora dice ${fmt(seen - 60)}`),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(real), cands);
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
      `all’indietro partendo dal 12: l’ora vera è le ${fmt(real)}. Trappole: ${traps}.`,
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
        `la lancetta corta NON sta ferma sul numero — in ${m} minuti si è già spostata di ${0.5 * m}° — ` +
          `e chi la crede ferma risponde ${stat}°`
      )
    );
  }
  // legge la lancetta corta sul numero prima o su quello dopo (a mezz'ora sta in
  // mezzo ai due, ed è lì che l'occhio sbaglia)
  for (const dh of [1, -1]) {
    const mis = angleAt(((h + dh + 12) % 12) * 60 + m);
    if (mis !== correct) {
      cands.push(optDeg(mis, `chi legge la lancetta corta sul numero ${dh > 0 ? 'dopo' : 'prima'} risponde ${mis}°`));
    }
  }
  if (360 - correct !== correct) {
    cands.push(
      optDeg(360 - correct, `dall’altra parte del quadrante l’angolo misura ${360 - correct}°, ma qui serve il più piccolo`)
    );
  }
  if (correct + 30 <= 330) {
    cands.push(optDeg(correct + 30, `chi conta i numeri invece degli spazi sbaglia di un’ora di quadrante e risponde ${correct + 30}°`));
  }
  if (correct + 60 <= 330) {
    cands.push(optDeg(correct + 60, `chi si conta due spazi di troppo sul quadrante risponde ${correct + 60}°`));
  }
  if (correct - 30 >= 5) {
    cands.push(optDeg(correct - 30, `chi conta uno spazio in meno risponde ${correct - 30}°`));
  }
  if (correct - 60 >= 15) {
    cands.push(optDeg(correct - 60, `chi perde due spazi contando sul quadrante risponde ${correct - 60}°`));
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
      }. Trappole: ${traps}.`,
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
    optTime(trueT, `chi si dimentica dello scarto risponde ${fmt(trueT)}`),
    optTime(norm(trueT + dir * g), `chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(norm(trueT + dir * g))}`),
    optTime(norm(trueT - dir * n * g), `chi sbaglia il verso dello scarto risponde ${fmt(norm(trueT - dir * n * g))}`),
    optTime(
      norm(correctT + dir * g),
      `chi conta ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(correctT + dir * g)}`
    ),
    optTime(norm(correctT + 60), `chi conta un’ora di troppo fra le ${n} che passano arriva alle ${fmt(correctT + 60)}`),
    optTime(norm(correctT - 60), `chi conta un’ora in meno fra le ${n} che passano arriva alle ${fmt(correctT - 60)}`),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
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
      }, cioè le ${fmt(correctT)}. Trappole: ${traps}.`,
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
    optDur(naive, `chi sottrae in colonna, senza prestito, ottiene ${fmtDur(naive)}`),
    optDur(gap + 60, `chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`),
  ];
  if (gap > 60) cands.push(optDur(gap - 60, `chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`));
  if (M !== 30) {
    const back = H * 60 + (60 - M);
    cands.push(optDur(back, `chi conta i minuti dalla parte sbagliata (${60 - M} invece di ${M}) dice ${fmtDur(back)}`));
  }
  cands.push(optDur((H + 1) * 60, `chi arrotonda all’ora intera dice ${fmtDur((H + 1) * 60)}`));
  cands.push(optDur(gap + 5, `chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`));
  cands.push(optDur(gap - 5, `chi conta un trattino in meno dice ${fmtDur(gap - 5)}`));
  if (H > 0) {
    cands.push(optDur(M, `chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(M)}`));
    cands.push(optDur(H * 60, `chi conta solo le ore intere dice ${fmtDur(H * 60)}`));
  }
  // scambia il RISULTATO con una delle due letture (i minuti segnati da un
  // orologio invece di quelli che passano)
  cands.push(optDur(m2, `chi legge i minuti dell’orologio di arrivo dice ${fmtDur(m2)}`));
  cands.push(optDur(m1, `chi legge i minuti dell’orologio di partenza dice ${fmtDur(m1)}`));
  const { choices, correctIndex, picked } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
  );
  // la sottrazione in colonna è LA lezione di questa variante: si spiega sempre,
  // anche quando fra le opzioni è finito un altro errore
  const others = picked
    .filter((o) => o.v !== naive)
    .map((o) => o.why)
    .join('; ');

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
      `${fmtDur(naive)}: sbagliato, perché i minuti non arrivano a 100 ma a 60.` +
      (others ? ` Altra trappola: ${others}.` : ''),
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
  const cands: Opt[] = [
    optTime(norm(t + n - 60), `chi somma i minuti e si dimentica l’ora arriva alle ${fmt(t + n - 60)}`),
    optTime(norm(t + n + 60), `chi aggiunge due ore invece di una arriva alle ${fmt(t + n + 60)}`),
    optTime(norm(t - n), `chi gira le lancette dalla parte sbagliata dice ${fmt(t - n)}`),
    optTime(norm(t + 60), `chi aggiunge l’ora e si scorda i ${n - 60} minuti che restano dice ${fmt(t + 60)}`),
    optTime(norm(t + n - 5), `chi conta un trattino in meno dice ${fmt(t + n - 5)}`),
    optTime(norm(t + n + 5), `chi conta un trattino di troppo dice ${fmt(t + n + 5)}`),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);

  return {
    qtype: 'clock',
    difficulty: 2,
    prompt: `Che ora segnerà l’orologio fra ${n} minuti?`,
    payload: { kind: 'clock', clocks: [clockOf(t, 'Adesso')] },
    choices,
    correctIndex,
    explanation:
      `${n} minuti sono 1 ora e ${n - 60} minuti. Dalle ${fmt(t)} si aggiunge prima l’ora (${fmt(t + 60)}) e poi i ` +
      `${n - 60} minuti che restano: ${fmt(correctT)}. Trappole: ${traps}.`,
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
    optMins(staticN, `chi dimentica che anche la lancetta delle ore avanza risponde ${staticN}`),
    optMins(hourlyN, `chi crede che si sovrappongano a ogni ora esatta risponde ${hourlyN}`),
    optMins(markN, `chi punta al trattino subito dopo la lancetta corta risponde ${markN}`),
    optMins(oppN, `chi si ferma quando le lancette sono in fila ma opposte risponde ${oppN}`),
  ].filter((c) => c.v >= 5 && c.v !== correctN);
  const { choices, correctIndex, traps } = textOptions(rng, optMins(correctN), cands);
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
      `Trappole: ${traps}.`,
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
    optTime(norm(seen + n), `chi si dimentica dello specchio e somma alla lettura diretta arriva alle ${fmt(seen + n)}`),
    optTime(norm(real - n), `chi riflette bene ma poi va indietro invece che avanti dice ${fmt(real - n)}`),
    optTime(real, `chi si ferma all’ora vera e non aggiunge i ${n} minuti risponde ${fmt(real)}`),
    optTime(
      norm(hourOf(seen) * 60 + minOf(real) + n),
      `chi riflette i minuti ma tiene l’ora dell’immagine arriva alle ${fmt(hourOf(seen) * 60 + minOf(real) + n)}`
    ),
    optTime(norm(correctT + 5), `chi conta un trattino di troppo dice ${fmt(correctT + 5)}`),
    optTime(norm(correctT - 5), `chi conta un trattino in meno dice ${fmt(correctT - 5)}`),
    optTime(norm(correctT + 60), `chi sbaglia di un’ora nel contare all’indietro dal 12 dice ${fmt(correctT + 60)}`),
    optTime(norm(correctT - 60), `chi sbaglia di un’ora nel contare all’indietro dal 12 dice ${fmt(correctT - 60)}`),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
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
      `aggiungono ${n} minuti, e si arriva alle ${fmt(correctT)}. Trappole: ${traps}.`,
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
    optDur(ignored, `chi legge lo specchio come un orologio normale calcola ${fmtDur(ignored)}`),
    optDur(gap + 60, `chi conta un’ora di troppo arriva a ${fmtDur(gap + 60)}`),
  ];
  if (gap > 60) cands.push(optDur(gap - 60, `chi si dimentica un’ora si ferma a ${fmtDur(gap - 60)}`));
  // sottrazione "in colonna" senza prestito, quando i minuti scavalcano l'ora
  if (minOf(t2) < minOf(t1)) {
    const naive = (Hg + 1) * 60 + (60 - Mg);
    cands.push(optDur(naive, `chi sottrae in colonna, senza prestito, ottiene ${fmtDur(naive)}`));
  }
  if (Mg !== 0) {
    cands.push(optDur(gap + 5, `chi conta un trattino di troppo dice ${fmtDur(gap + 5)}`));
    cands.push(optDur(gap - 5, `chi conta un trattino in meno dice ${fmtDur(gap - 5)}`));
    cands.push(optDur((Hg + 1) * 60, `chi arrotonda all’ora intera dice ${fmtDur((Hg + 1) * 60)}`));
    if (Hg > 0) {
      cands.push(optDur(Mg, `chi guarda solo la lancetta lunga e si scorda le ore dice ${fmtDur(Mg)}`));
      cands.push(optDur(Hg * 60, `chi conta solo le ore intere dice ${fmtDur(Hg * 60)}`));
    }
  }
  const { choices, correctIndex, traps } = textOptions(
    rng,
    optDur(gap),
    cands.filter((c) => c.v > 0 && c.v < MOD)
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
      `Trappole: ${traps}.`,
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
      optTime(norm(shown + dir * n * g), `chi corregge nel verso sbagliato risponde ${fmt(shown + dir * n * g)}`),
      optTime(norm(shown - dir * g), `chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(shown - dir * g)}`),
      optTime(shown, `chi si fida di quello che segna il quadrante risponde ${fmt(shown)}`),
      optTime(
        norm(realT - dir * g),
        `chi toglie ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(realT - dir * g)}`
      ),
      optTime(norm(realT + 60), `chi sbaglia di un’ora nel conto dello scarto dice ${fmt(realT + 60)}`),
      optTime(norm(realT - 60), `chi sbaglia di un’ora nel conto dello scarto dice ${fmt(realT - 60)}`),
    ];
    const { choices, correctIndex, traps } = textOptions(rng, optTime(realT), cands);
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
        `Trappole: ${traps}.`,
    };
  }

  // l'orologio è giusto adesso: che ora segnerà fra n ore
  const t = randTime(rng);
  const trueT = norm(t + n * 60);
  const correctT = norm(trueT + dir * n * g);
  const cands: Opt[] = [
    optTime(trueT, `chi si ferma all’ora giusta e dimentica lo scarto risponde ${fmt(trueT)}`),
    optTime(norm(trueT + dir * g), `chi applica lo scarto una volta sola invece di ${n} risponde ${fmt(trueT + dir * g)}`),
    optTime(norm(trueT - dir * n * g), `chi sbaglia il verso dello scarto risponde ${fmt(trueT - dir * n * g)}`),
    optTime(
      norm(correctT + dir * g),
      `chi conta ${n + 1} ore di scarto invece di ${n} (l’errore di chi conta anche l’ora di partenza) risponde ${fmt(correctT + dir * g)}`
    ),
    optTime(norm(correctT + 60), `chi conta un’ora di troppo fra le ${n} che passano arriva alle ${fmt(correctT + 60)}`),
    optTime(norm(correctT - 60), `chi conta un’ora in meno fra le ${n} che passano arriva alle ${fmt(correctT - 60)}`),
  ];
  const { choices, correctIndex, traps } = textOptions(rng, optTime(correctT), cands);
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
      `giusta sarà le ${fmt(trueT)}, quindi l’orologio segnerà le ${fmt(correctT)}. Trappole: ${traps}.`,
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
