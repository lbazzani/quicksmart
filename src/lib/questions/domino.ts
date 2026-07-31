// Generatore "domino": una fila di tessere del domino che segue una regola.
// Le tessere sono disegnate davvero, con i pallini, come quelle di casa (payload
// 'dominoes'); anche le tre risposte sono tessere vere (choice 'domino'). I
// valori vanno da 0 a 6 come nel domino vero e la metà "0" è la metà vuota.
//
// CONVENZIONE UNICA, valida ovunque: le tessere sono coppie ORDINATE, cioè
// «sinistra|destra». 4|5 e 5|4 sono due tessere diverse. Da qui discendono due
// regole ferree, applicate dal guscio a ogni domanda:
//   1. fra le TRE risposte non compaiono mai due tessere che sono l'una il
//      capovolgimento dell'altra (quindi la capovolta della risposta corretta
//      non è mai un distrattore): il bambino non deve mai decidere se 5|4 e 4|5
//      sono la stessa tessera o no;
//   2. quando la regola gira le tessere, o quando nella fila compaiono una
//      tessera e la sua capovolta, la convenzione sta nel PROMPT ("una tessera
//      girata è un'altra tessera") e non solo nell'explanation, che si legge
//      dopo aver risposto: serve per leggere la fila, quindi serve prima.
//
// Nelle regole con salti grandi la fila "gira in tondo": dopo il 6 si riparte da
// 0 (modulo 7) — quando succede il prompt lo dichiara, così la regola resta
// sempre deducibile da ciò che si vede.
//
// FAMIGLIE DI REGOLE. Ogni fila appartiene a una sola famiglia e OGNI FAMIGLIA HA
// IL SUO SUGGERIMENTO NEL PROMPT: dice che TIPO di legame tiene insieme la fila
// (dove guardare), mai quale sia la risposta. Non basta un generico "ogni tessera
// nasce da quella prima di lei": sotto quelle parole ci stanno regole
// strutturalmente diverse (girare la tessera, sommare le due metà, incastrarle)
// e chi ragiona bene può arrivare a una tessera diversa da quella attesa.
//   halves — ogni metà segue la sua regola (passo fisso, passi alternati, metà
//            ferma, rimbalzo fra due valori, somma costante)
//   chain  — le tessere si incastrano: ogni tessera comincia con il numero con
//            cui finiva quella prima
//   flip   — ogni tessera nasce girando quella prima di lei (più un'aggiunta
//            sempre uguale)
//   alt    — si alternano due mosse: girare la tessera oppure aggiungere lo
//            stesso numero a tutte e due le metà
//   sum2   — ogni tessera si ricava sommando le due metà di quella prima
//   prev2  — ogni tessera nasce dalle DUE tessere prima di lei (somma o
//            differenza, metà per metà)
//
// UNA SOLA TESSERA DIFENDIBILE. Prima di accettare una domanda si prova a mettere
// al posto del "?" TUTTE E 49 le tessere del domino e si tiene la domanda solo se
// una sola di esse rende la fila coerente con la famiglia annunciata nel prompt
// (`defensible`). Così la regola scritta nel prompt, applicata alla fila
// disegnata, non può portare da nessuna parte se non alla risposta corretta: non
// c'è modo di ragionare bene e sbagliare. Lo stesso controllo gira anche sulle
// altre cinque famiglie: se una di loro giustificasse una tessera diversa, chi
// legge la fila "a modo suo" potrebbe difendere una risposta che il gioco chiama
// errore, e la domanda viene scartata.
//
// d1: una sola regola sulle metà — somma costante, stesso passo su entrambe,
//     una metà ferma, tessere doppie, tessere che si incastrano.
// d2: due regole insieme (passi diversi sulle due metà, ribaltamenti, passi
//     alternati, una metà che rimbalza) o una regola sottile (salto grande che
//     gira in tondo).
// d3: la tessera si ricava dalla PRECEDENTE (o dalle DUE precedenti) con una
//     sola aritmetica per tutte e due le metà — o sempre modulo 7, o sempre
//     differenza in valore assoluto, mai le due mescolate. Il prompt annuncia
//     da dove nasce ogni tessera e le tessere di riferimento sono evidenziate:
//     a d3 il lavoro deve stare nel calcolo, non nell'indovinare dove guardare.
//     (Le vecchie famiglie "salti crescenti" e "due file intrecciate" sono state
//     tolte: la prima chiedeva di scoprire una legge quadratica, la seconda
//     richiedeva 7 tessere che a schermo vanno a capo e si leggono male.)
//
// L'incognita non è sempre l'ultima: a volte manca una tessera in mezzo alla fila
// o la prima.
//
// Distrattori: sempre errori tipici (metà scambiate, off-by-one, regola applicata
// alla metà sbagliata, un passo di troppo, regola dimenticata a metà), mai
// tessere a caso — e mai una tessera già visibile nella fila, che si eliminerebbe
// senza ragionare.
//
// Anti-ambiguità: oltre al controllo sulla famiglia annunciata, prima di
// accettare una domanda si rileggono le tessere visibili con tutte le regole
// semplici alternative (passi costanti o alternati, salti che accelerano,
// somma/differenza dei due precedenti, ribaltamento con offset, due file
// intrecciate, tessera-da-tessera). Se una di queste giustificherebbe una
// tessera diversa da quella voluta, la domanda viene scartata e rigenerata: la
// risposta corretta è così l'unica difendibile.

import type { Difficulty, DominoTile, LocalizedText, Question } from '../types';
import { chance, pick, randInt, shuffle, type Rng } from '../rng';
import { L } from '../localize';
import { placeChoices, retry } from './qutils';

/** una tessera: [metà sinistra, metà destra], valori 0..6 */
type Tile = [number, number];

const M = 7;
/** inversi moltiplicativi mod 7 (INV[g] · g ≡ 1) */
const INV = [0, 1, 4, 5, 2, 3, 6];

const m7 = (x: number) => ((x % M) + M) % M;
const fmt = (t: Tile) => `${t[0]}|${t[1]}`;
const eq = (a: Tile, b: Tile) => a[0] === b[0] && a[1] === b[1];
/** stessa coppia di numeri, ma girata: 4|5 contro 5|4 */
const turned = (a: Tile, b: Tile) => a[0] === b[1] && a[1] === b[0];
const inRange = (t: Tile) => t.every((v) => Number.isInteger(v) && v >= 0 && v <= 6);

/** frase da aggiungere quando la regola gira le tessere: la convenzione va detta */
const TURN_NOTE =
  ' In questo gioco conta anche da che parte stanno i numeri: una tessera girata è una tessera diversa.';

/** come `TURN_NOTE`, in inglese */
const TURN_NOTE_EN =
  ' In this game, which side a number is on matters too: a flipped tile counts as a different tile.';

/** frase da aggiungere quando la fila gira in tondo dopo il 6: appare più volte identica */
const WRAP_NOTE_EN = ' After 6, it starts over from 0.';

/** "cresce di 2" / "cala di 1" / "resta ferma" */
function stepWord(k: number): string {
  if (k === 0) return 'resta ferma';
  return k > 0 ? `cresce di ${k}` : `cala di ${-k}`;
}

/** come `stepWord`, in inglese: "goes up by 2" / "goes down by 1" / "stays the same" */
function stepWordEn(k: number): string {
  if (k === 0) return 'stays the same';
  return k > 0 ? `goes up by ${k}` : `goes down by ${-k}`;
}

/** elenco dei valori di una metà: "1, 3, 4, 0" */
function halfList(tiles: Tile[], side: 0 | 1): string {
  return tiles.map((t) => t[side]).join(', ');
}

/** la fila con il buco al posto dell'incognita: "1|4 → 4|1 → ? → 5|2" */
function chainWithHole(tiles: Tile[], hidden: number): string {
  return tiles.map((t, i) => (i === hidden ? '?' : fmt(t))).join(' → ');
}

/**
 * La famiglia di regole a cui appartiene la fila. Ogni famiglia ha il suo
 * suggerimento nel prompt e il suo controllo di coerenza: le due cose devono
 * dire la stessa identica cosa.
 */
type Family = 'halves' | 'chain' | 'flip' | 'alt' | 'sum2' | 'prev2';

const ALL_FAMILIES: Family[] = ['halves', 'chain', 'flip', 'alt', 'sum2', 'prev2'];

/**
 * Il suggerimento che finisce nel prompt, cioè PRIMA della risposta. Dice di che
 * tipo di legame si tratta — dove guardare — senza svelare né i numeri né la
 * tessera. Deve descrivere ESATTAMENTE lo spazio di regole che `fitsFamily`
 * accetta: se il prompt promettesse meno, il bambino potrebbe difendere una
 * tessera diversa; se promettesse di più, si sentirebbe imbrogliato.
 */
const FAMILY_HINT: Record<Family, string> = {
  halves: 'ogni metà segue la sua regola',
  chain: 'ogni tessera comincia con il numero con cui finiva quella prima',
  // Attenzione: la regola gira la tessera E può aggiungere un numero. Dire solo
  // "girando" sarebbe falso e chi lo prendesse alla lettera sceglierebbe il
  // distrattore "gira e basta". Il suggerimento preciso lo mette `hint` in
  // Built, calcolato su ciò che la regola fa davvero; questo è il ripiego.
  flip: 'ogni tessera si gira, e i suoi numeri possono cambiare sempre allo stesso modo',
  // "o tutte e due" non è un dettaglio: una mossa può girare la tessera E
  // aggiungere un numero (1|6 → 6|1 → 2|0). Senza quelle parole chi prova solo
  // mosse "pure" non trova nessuna tessera che torna.
  alt: 'si alternano due mosse: girare la tessera, aggiungere lo stesso numero alle due metà, o tutte e due',
  // Dire solo "sommando le due metà" è vero ma INCOMPLETO: metà della tessera
  // nuova è la somma, l'altra metà ricopia una metà di quella prima. Senza
  // questa seconda parte chi applica il suggerimento alla lettera trova un solo
  // numero e resta indeciso fra due tessere.
  sum2: 'ogni tessera ha una metà che è la somma delle due metà di quella prima, e l’altra metà copiata da lei',
  prev2: 'ogni tessera nasce dalle DUE tessere prima di lei',
};

/** come `FAMILY_HINT`, in inglese: deve descrivere esattamente lo stesso spazio di regole */
const FAMILY_HINT_EN: Record<Family, string> = {
  halves: 'each half follows its own rule',
  chain: 'each tile starts with the number the previous one ended with',
  flip: 'each tile is the previous one flipped, and its numbers can change by the same amount every time',
  alt: 'two moves alternate: flip the tile, add the same number to both halves, or both at once',
  sum2: 'each tile has one half that’s the sum of the previous tile’s two halves, and the other half copied from it',
  prev2: 'each tile comes from the TWO tiles before it',
};

interface Built {
  /** la fila completa, incognita compresa */
  tiles: Tile[];
  /** indice dell'incognita */
  hidden: number;
  /** errori tipici in ordine di priorità: il guscio ne usa i primi 2 validi */
  distractors: Tile[];
  /** spiegazione della regola (la frase finale la aggiunge il guscio) */
  explanation: string;
  /** come `explanation`, in inglese */
  explanationEn: string;
  /** la regola gira in tondo dopo il 6: va dichiarato nel prompt */
  mod?: boolean;
  /** che tipo di legame tiene insieme la fila: finisce nel prompt */
  family: Family;
  /**
   * Suggerimento su misura, quando quello generico della famiglia direbbe meno
   * del vero. Il prompt non deve mai promettere una regola più semplice di
   * quella che serve: chi lo prende alla lettera sceglierebbe un distrattore.
   */
  hint?: string;
  /** come `hint`, in inglese */
  hintEn?: string;
  /** tessere di riferimento della regola: evidenziate nel disegno */
  refs?: number[];
}

// ---------------------------------------------------------------------------
// La regola annunciata, letta come la leggerebbe chi risponde
// ---------------------------------------------------------------------------

/**
 * Una metà che «segue la sua regola»: v(i) = base + ⌈i/2⌉·p + ⌊i/2⌋·q (mod 7).
 * Con p = q è un passo fisso, con p = −q è un rimbalzo fra due valori, con p = 0
 * e q = 0 la metà è ferma; il caso generale sono i due salti che si alternano.
 */
function fitsHalf(v: number[]): boolean {
  for (let p = 0; p < M; p++) {
    for (let q = 0; q < M; q++) {
      let ok = true;
      for (let i = 1; i < v.length && ok; i++) {
        if (v[i] !== m7(v[0] + Math.ceil(i / 2) * p + Math.floor(i / 2) * q)) ok = false;
      }
      if (ok) return true;
    }
  }
  return false;
}

const column = (row: Tile[], s: 0 | 1) => row.map((t) => t[s]);

/** una mossa della famiglia `alt`: gira o no, poi aggiunge k a tutte e due le metà */
function altMoveFits(row: Tile[], parity: number, turn: boolean, k: number): boolean {
  for (let i = 0; i + 1 < row.length; i++) {
    if (i % 2 !== parity) continue;
    const [a, b] = row[i];
    const want: Tile = turn ? [m7(b + k), m7(a + k)] : [m7(a + k), m7(b + k)];
    if (!eq(row[i + 1], want)) return false;
  }
  return true;
}

/** la fila (senza buchi) è coerente con ALMENO una regola della famiglia? */
function fitsFamily(fam: Family, row: Tile[]): boolean {
  switch (fam) {
    case 'halves':
      return fitsHalf(column(row, 0)) && fitsHalf(column(row, 1));

    case 'chain': {
      // ogni tessera comincia dove finiva la precedente, e i numeri della catena
      // seguono la loro regola (quella che si vede nel disegno)
      for (let i = 0; i + 1 < row.length; i++) if (row[i + 1][0] !== row[i][1]) return false;
      return fitsHalf(column(row, 0)) && fitsHalf(column(row, 1));
    }

    case 'flip': {
      // t(i+1) = (destra + p, sinistra + q), sempre gli stessi p e q
      for (let p = 0; p < M; p++) {
        for (let q = 0; q < M; q++) {
          let ok = true;
          for (let i = 0; i + 1 < row.length && ok; i++) {
            if (row[i + 1][0] !== m7(row[i][1] + p) || row[i + 1][1] !== m7(row[i][0] + q)) ok = false;
          }
          if (ok) return true;
        }
      }
      return false;
    }

    case 'alt': {
      // due mosse che si alternano: ognuna gira la tessera oppure aggiunge lo
      // stesso numero a tutte e due le metà (o tutte e due le cose insieme)
      for (const parity of [0, 1]) {
        let found = false;
        for (const turn of [false, true]) {
          for (let k = 0; k < M && !found; k++) if (altMoveFits(row, parity, turn, k)) found = true;
        }
        if (!found) return false;
      }
      return true;
    }

    case 'sum2': {
      // la somma delle due metà (mod 7) diventa una metà della tessera dopo,
      // l'altra metà ripete una delle due metà di prima
      const variants: Array<(t: Tile) => Tile> = [
        (t) => [m7(t[0] + t[1]), t[0]],
        (t) => [m7(t[0] + t[1]), t[1]],
        (t) => [t[0], m7(t[0] + t[1])],
        (t) => [t[1], m7(t[0] + t[1])],
      ];
      return variants.some((v) => {
        for (let i = 0; i + 1 < row.length; i++) if (!eq(row[i + 1], v(row[i]))) return false;
        return true;
      });
    }

    case 'prev2': {
      // ogni metà nasce dalle due tessere prima: somma (mod 7) o differenza in
      // valore assoluto — le due metà possono anche seguire operazioni diverse,
      // perché nessuno ha promesso che siano uguali
      const half = (v: number[]) =>
        ([true, false] as const).some((isSum) => {
          for (let i = 2; i < v.length; i++) {
            const want = isSum ? m7(v[i - 1] + v[i - 2]) : Math.abs(v[i - 1] - v[i - 2]);
            if (v[i] !== want) return false;
          }
          return true;
        });
      return half(column(row, 0)) && half(column(row, 1));
    }
  }
}

/**
 * Tutte le tessere che, messe al posto del "?", rendono la fila coerente con la
 * regola annunciata nel prompt. Se ne esce più di una, la domanda non ha una
 * risposta sola e va rigenerata: è esattamente il caso in cui si ragiona bene e
 * si prende comunque la risposta sbagliata.
 */
function defensible(fam: Family, tiles: Tile[], hidden: number): Tile[] {
  const out: Tile[] = [];
  const row = tiles.slice();
  for (let a = 0; a <= 6; a++) {
    for (let b = 0; b <= 6; b++) {
      row[hidden] = [a, b];
      if (fitsFamily(fam, row)) out.push([a, b]);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anti-ambiguità: quali tessere sarebbero difendibili con una regola semplice?
// ---------------------------------------------------------------------------

type Half = (number | null)[];

/**
 * Predizioni difendibili per UNA metà (null = posizione nascosta), lette con le
 * regole che un risolutore umano prova davvero: passi costanti o alternati,
 * salti che accelerano, somma/differenza dei due valori precedenti, due serie
 * intrecciate.
 */
function halfPreds(v: Half, h: number): number[] {
  const idx: number[] = [];
  for (let i = 0; i < v.length; i++) if (v[i] !== null) idx.push(i);
  if (idx.length < 3) return [];
  const i0 = idx[0];
  const out: number[] = [];

  // passi costanti o alternati: v(i) = base + ⌈i/2⌉·p + ⌊i/2⌋·q  (p = q → passo fisso)
  for (let p = 0; p < M; p++) {
    for (let q = 0; q < M; q++) {
      const off = (i: number) => Math.ceil(i / 2) * p + Math.floor(i / 2) * q;
      const base = m7((v[i0] as number) - off(i0));
      if (idx.every((i) => v[i] === m7(base + off(i)))) out.push(m7(base + off(h)));
    }
  }
  // salti che accelerano: v(i) = base + i·d + c·i(i−1)/2  (c ≥ 1)
  for (let d = 0; d < M; d++) {
    for (let c = 1; c < M; c++) {
      const off = (i: number) => i * d + (c * i * (i - 1)) / 2;
      const base = m7((v[i0] as number) - off(i0));
      if (idx.every((i) => v[i] === m7(base + off(i)))) out.push(m7(base + off(h)));
    }
  }
  // ricorsive a due termini: somma (mod 7) o differenza assoluta dei due precedenti
  for (const kind of ['sum', 'absdiff'] as const) {
    let checks = 0;
    let ok = true;
    for (let i = 2; i < v.length; i++) {
      if (v[i] === null || v[i - 1] === null || v[i - 2] === null) continue;
      const a = v[i - 1] as number;
      const b = v[i - 2] as number;
      const exp = kind === 'sum' ? m7(a + b) : Math.abs(a - b);
      if (v[i] !== exp) {
        ok = false;
        break;
      }
      checks++;
    }
    if (ok && checks >= 2 && h >= 2 && v[h - 1] !== null && v[h - 2] !== null) {
      const a = v[h - 1] as number;
      const b = v[h - 2] as number;
      out.push(kind === 'sum' ? m7(a + b) : Math.abs(a - b));
    }
  }
  // due serie intrecciate (posizioni pari / dispari), solo con almeno 3 punti per serie
  const chain = (par: number) => idx.filter((i) => i % 2 === par);
  const cThis = chain(h % 2);
  const cOther = chain(1 - (h % 2));
  if (cThis.length >= 3 && cOther.length >= 3) {
    const fit = (c: number[]): number | null => {
      const g = (c[1] - c[0]) / 2;
      const k = m7(((v[c[1]] as number) - (v[c[0]] as number)) * INV[m7(g)]);
      const at = (i: number) => m7((v[c[0]] as number) + ((i - c[0]) / 2) * k);
      return c.every((i) => v[i] === at(i)) ? k : null;
    };
    const kT = fit(cThis);
    if (kT !== null && fit(cOther) !== null) {
      out.push(m7((v[cThis[0]] as number) + ((h - cThis[0]) / 2) * kT));
    }
  }
  return out;
}

/** predizioni difendibili a livello di TESSERA (regole che legano le due metà) */
function tilePreds(tiles: Tile[], h: number): Tile[] {
  const out: Tile[] = [];
  const vis = (i: number) => i >= 0 && i < tiles.length && i !== h;

  // ribaltamento con offset: t(i+1) = (b(i) + p, a(i) + q)
  for (let p = 0; p < M; p++) {
    for (let q = 0; q < M; q++) {
      let checks = 0;
      let ok = true;
      for (let i = 0; i + 1 < tiles.length; i++) {
        if (!vis(i) || !vis(i + 1)) continue;
        if (tiles[i + 1][0] !== m7(tiles[i][1] + p) || tiles[i + 1][1] !== m7(tiles[i][0] + q)) {
          ok = false;
          break;
        }
        checks++;
      }
      if (!ok || checks < 2) continue;
      if (vis(h - 1)) out.push([m7(tiles[h - 1][1] + p), m7(tiles[h - 1][0] + q)]);
      else if (vis(h + 1)) out.push([m7(tiles[h + 1][1] - q), m7(tiles[h + 1][0] - p)]);
    }
  }
  // tessera-da-tessera: (somma, differenza) e (destra, somma)
  const maps: Array<(t: Tile) => Tile> = [
    (t) => [m7(t[0] + t[1]), Math.abs(t[0] - t[1])],
    (t) => [t[1], m7(t[0] + t[1])],
  ];
  for (const f of maps) {
    let checks = 0;
    let ok = true;
    for (let i = 0; i + 1 < tiles.length; i++) {
      if (!vis(i) || !vis(i + 1)) continue;
      if (!eq(tiles[i + 1], f(tiles[i]))) {
        ok = false;
        break;
      }
      checks++;
    }
    if (ok && checks >= 2 && vis(h - 1)) out.push(f(tiles[h - 1]));
  }
  return out;
}

/** tutte le tessere che una regola semplice alternativa giustificherebbe */
function alternatives(tiles: Tile[], h: number): Tile[] {
  const left: Half = tiles.map((t, i) => (i === h ? null : t[0]));
  const right: Half = tiles.map((t, i) => (i === h ? null : t[1]));
  const out: Tile[] = [];
  for (const a of new Set(halfPreds(left, h))) {
    for (const b of new Set(halfPreds(right, h))) out.push([a, b]);
  }
  out.push(...tilePreds(tiles, h));
  return out;
}

// ---------------------------------------------------------------------------
// Costruttori per difficoltà
// ---------------------------------------------------------------------------

/** dove sta l'incognita: in fondo, in mezzo o in testa */
function chooseHidden(rng: Rng, n: number, pMiddle: number, pFirst: number): number {
  const r = rng();
  if (r < pFirst) return 0;
  if (r < pFirst + pMiddle) return randInt(rng, 1, n - 2);
  return n - 1;
}

/** valore iniziale che tiene tutta la progressione dentro 0..6 */
function startInRange(rng: Rng, n: number, k: number): number {
  return k > 0 ? randInt(rng, 0, 6 - (n - 1) * k) : randInt(rng, (n - 1) * -k, 6);
}

// --- difficoltà 1: una regola sola, nessun giro in tondo ---------------------

function buildD1(rng: Rng): Built {
  // le famiglie con poche file possibili pesano meno, così la fila non si ripete
  const kind = pick(rng, [0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 5]);
  // 5 o 6 tessere: di più non ci stanno sullo schermo di un telefono senza
  // rimpicciolire i pallini oltre il leggibile
  const n = pick(rng, [5, 5, 5, 6]);
  const hidden = chooseHidden(rng, n, 0.34, 0.16);

  if (kind === 0) {
    // somma costante: una metà cresce di 1, l'altra cala di 1
    const dir = chance(rng, 0.5) ? 1 : -1;
    const l0 = startInRange(rng, n, dir);
    const lo = Math.min(l0, l0 + (n - 1) * dir);
    const hi = Math.max(l0, l0 + (n - 1) * dir);
    const s = randInt(rng, hi, lo + 6);
    const tiles = Array.from({ length: n }, (_, i) => [l0 + i * dir, s - (l0 + i * dir)] as Tile);
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'halves',
      distractors: shuffle(rng, [
        [ca + dir, cb - dir], // un passo di troppo
        [ca, cb + dir], // muove la destra dalla parte sbagliata (somma sballata)
        [ca - dir, cb - dir], // muove tutte e due dalla stessa parte
        [ca + dir, cb], // muove solo la metà di sinistra
        [ca + 2 * dir, cb - 2 * dir], // due passi in avanti
      ] as Tile[]),
      explanation:
        `In ogni tessera la somma delle due metà è sempre ${s}: a ogni passo la metà di sinistra ` +
        `${dir > 0 ? 'cresce' : 'cala'} di 1 e quella di destra fa il contrario.`,
      explanationEn:
        `In every tile, the sum of the two halves is always ${s}: at each step the left half ` +
        `${dir > 0 ? 'goes up' : 'goes down'} by 1 and the right half does the opposite.`,
    };
  }

  if (kind === 1) {
    // le due metà fanno lo stesso passo
    const k = chance(rng, 0.5) ? 1 : -1;
    const a0 = startInRange(rng, n, k);
    let b0 = startInRange(rng, n, k);
    if (b0 === a0) b0 = k > 0 ? (b0 === 6 - (n - 1) ? 0 : b0 + 1) : b0 === 6 ? n - 1 : b0 + 1;
    const tiles = Array.from({ length: n }, (_, i) => [a0 + i * k, b0 + i * k] as Tile);
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'halves',
      distractors: shuffle(rng, [
        [ca, cb - k], // ha mosso solo la metà di sinistra
        [ca - k, cb], // ha mosso solo la metà di destra
        [ca + k, cb + k], // un passo di troppo
        [ca + k, cb - k], // le due metà vanno in direzioni opposte
        [ca + 2 * k, cb + 2 * k], // due passi in avanti
      ] as Tile[]),
      explanation:
        `Tutte e due le metà ${k > 0 ? 'crescono' : 'calano'} di 1 a ogni passo: la sinistra fa ` +
        `${halfList(tiles, 0)} e la destra ${halfList(tiles, 1)}.`,
      explanationEn:
        `Both halves ${k > 0 ? 'go up' : 'go down'} by 1 at each step: the left goes ` +
        `${halfList(tiles, 0)} and the right goes ${halfList(tiles, 1)}.`,
    };
  }

  if (kind === 2 || kind === 3) {
    // una metà resta ferma, l'altra avanza
    const movingRight = kind === 2;
    const k = chance(rng, 0.5) ? 1 : -1;
    const m0 = startInRange(rng, n, k);
    const fixed = randInt(rng, 0, 6);
    const tiles = Array.from({ length: n }, (_, i) =>
      movingRight ? ([fixed, m0 + i * k] as Tile) : ([m0 + i * k, fixed] as Tile)
    );
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'halves',
      distractors: shuffle(rng, [
        movingRight ? [ca + k, cb] : [ca, cb + k], // ha mosso la metà sbagliata
        movingRight ? [ca, cb + k] : [ca + k, cb], // un passo di troppo
        [ca + k, cb + k], // ha mosso tutte e due le metà
        movingRight ? [ca, cb + 2 * k] : [ca + 2 * k, cb], // due passi in avanti
        movingRight ? [ca, cb - 2 * k] : [ca - 2 * k, cb], // un passo indietro
      ] as Tile[]),
      explanation:
        `La metà di ${movingRight ? 'sinistra' : 'destra'} resta sempre ${fixed}: si muove solo ` +
        `la metà di ${movingRight ? 'destra' : 'sinistra'}, che ${stepWord(k)} a ogni passo ` +
        `(${halfList(tiles, movingRight ? 1 : 0)}).`,
      explanationEn:
        `The ${movingRight ? 'left' : 'right'} half always stays ${fixed}: only the ` +
        `${movingRight ? 'right' : 'left'} half moves, and it ${stepWordEn(k)} at each step ` +
        `(${halfList(tiles, movingRight ? 1 : 0)}).`,
    };
  }

  if (kind === 5) {
    // le tessere si incastrano come nel domino vero: ogni tessera comincia con il
    // numero con cui finiva la precedente
    const k = chance(rng, 0.5) ? 1 : -1;
    const v0 = k > 0 ? randInt(rng, 0, 6 - n) : randInt(rng, n, 6);
    const vals = Array.from({ length: n + 1 }, (_, i) => v0 + i * k);
    const tiles = Array.from({ length: n }, (_, i) => [vals[i], vals[i + 1]] as Tile);
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'chain',
      distractors: shuffle(rng, [
        [ca + k, cb + k], // un passo di troppo
        [ca, cb + k], // fa avanzare solo la metà di destra
        [ca - k, cb], // ripete la metà di sinistra della tessera precedente
        [ca + k, cb], // fa avanzare solo la metà di sinistra
        [ca, cb + 2 * k], // due passi sulla metà di destra
      ] as Tile[]),
      explanation:
        `Le tessere si incastrano come nel domino vero: ogni tessera comincia con il numero con cui ` +
        `finiva quella prima di lei (${chainWithHole(tiles, hidden)}), ` +
        `e i numeri ${k > 0 ? 'crescono' : 'calano'} di 1 alla volta.`,
      explanationEn:
        `The tiles link up like in a real domino game: each tile starts with the number the ` +
        `previous one ended with (${chainWithHole(tiles, hidden)}), ` +
        `and the numbers ${k > 0 ? 'go up' : 'go down'} by 1 each time.`,
    };
  }

  // tessere doppie: le due metà sono uguali e avanzano insieme
  const k = chance(rng, 0.5) ? 1 : -1;
  const a0 = startInRange(rng, n, k);
  const tiles = Array.from({ length: n }, (_, i) => [a0 + i * k, a0 + i * k] as Tile);
  const [ca] = tiles[hidden];
  return {
    tiles,
    hidden,
    family: 'halves',
    distractors: shuffle(rng, [
      [ca, ca + k], // ha mosso una metà sola
      [ca + k, ca + k], // un passo di troppo
      [ca - k, ca + k], // le due metà si allontanano
      [ca + 2 * k, ca + 2 * k], // due passi in avanti
      [ca + k, ca - k], // le due metà si allontanano dall'altra parte
    ] as Tile[]),
    explanation:
      `Sono tutte tessere doppie (le due metà uguali) e il numero ${k > 0 ? 'cresce' : 'cala'} ` +
      `di 1 a ogni passo: ${chainWithHole(tiles, hidden)}.`,
    explanationEn:
      `They’re all double tiles (both halves equal) and the number ${k > 0 ? 'goes up' : 'goes down'} ` +
      `by 1 at each step: ${chainWithHole(tiles, hidden)}.`,
  };
}

// --- difficoltà 2: due regole insieme, o una regola sottile ------------------

function buildD2(rng: Rng): Built {
  const kind = randInt(rng, 0, 5);

  if (kind === 0) {
    // passi diversi sulle due metà
    const n = pick(rng, [5, 6, 6]);
    const hidden = chooseHidden(rng, n, 0.22, 0.12);
    const p = pick(rng, [-2, -1, 1, 2, 3]);
    let q = pick(rng, [-2, -1, 1, 2, 3]);
    if (q === p) q = p === 3 ? -1 : p + 1;
    const a0 = randInt(rng, 0, 6);
    const b0 = randInt(rng, 0, 6);
    let wrapped = false;
    const tiles = Array.from({ length: n }, (_, i) => {
      const ra = a0 + i * p;
      const rb = b0 + i * q;
      if (ra < 0 || ra > 6 || rb < 0 || rb > 6) wrapped = true;
      return [m7(ra), m7(rb)] as Tile;
    });
    const [ca, cb] = tiles[hidden];
    // tessera di riferimento: la precedente, o la successiva se il ? apre la fila
    const ref = tiles[hidden === 0 ? 1 : hidden - 1];
    return {
      tiles,
      hidden,
      family: 'halves',
      mod: wrapped,
      distractors: shuffle(rng, [
        [m7(ref[0] + q), m7(ref[1] + p)], // ha scambiato i due passi
        [ca, ref[1]], // ha mosso solo la metà di sinistra
        [ref[0], cb], // ha mosso solo la metà di destra
        [m7(ca + p), m7(cb + q)], // un passo di troppo
        [m7(ca - p), m7(cb - q)], // un passo indietro
      ] as Tile[]),
      explanation:
        `Le due metà seguono due regole diverse: la metà di sinistra ${stepWord(p)} a ogni passo ` +
        `(${halfList(tiles, 0)}), la metà di destra ${stepWord(q)} (${halfList(tiles, 1)}).` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : ''),
      explanationEn:
        `The two halves follow two different rules: the left half ${stepWordEn(p)} at each step ` +
        `(${halfList(tiles, 0)}), the right half ${stepWordEn(q)} (${halfList(tiles, 1)}).` +
        (wrapped ? WRAP_NOTE_EN : ''),
    };
  }

  if (kind === 1) {
    // ribalta e aggiungi: t(i+1) = (destra, sinistra + k)
    const n = pick(rng, [5, 6, 6]);
    const k = pick(rng, [1, 2, -1]);
    const tiles: Tile[] = [[randInt(rng, 0, 6), randInt(rng, 0, 6)]];
    let wrapped = false;
    for (let i = 1; i < n; i++) {
      const [a, b] = tiles[i - 1];
      if (a + k < 0 || a + k > 6) wrapped = true;
      tiles.push([b, m7(a + k)]);
    }
    const hidden = chance(rng, 0.2) ? randInt(rng, 2, n - 2) : n - 1;
    const prev = tiles[hidden - 1];
    return {
      tiles,
      hidden,
      family: 'flip',
      // k è sempre diverso da zero: il suggerimento deve dirlo, altrimenti
      // "gira e basta" sembrerebbe la risposta giusta ed è un distrattore
      hint: 'ogni tessera si gira e uno dei due numeri cambia sempre allo stesso modo',
      hintEn: 'each tile is flipped and one of the two numbers always changes the same way',
      mod: wrapped,
      refs: [hidden - 1],
      distractors: shuffle(rng, [
        [prev[1], prev[0]], // gira e basta, dimentica il ±k
        [m7(prev[1] + k), prev[0]], // aggiunge alla metà sbagliata
        [m7(prev[1] + k), m7(prev[0] + k)], // aggiunge a tutte e due le metà
        [prev[0], m7(prev[1] + k)], // aggiunge senza girare
      ] as Tile[]),
      explanation:
        `Ogni tessera si ottiene girando la precedente (le due metà si scambiano di posto) e ` +
        `poi ${k > 0 ? `aggiungendo ${k}` : 'togliendo 1'} alla metà che finisce a destra: ` +
        `${chainWithHole(tiles, hidden)}.` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : '') +
        TURN_NOTE,
      explanationEn:
        `Each tile is the previous one flipped (the two halves swap places) and then ` +
        `${k > 0 ? `adding ${k} to` : 'subtracting 1 from'} the half that ends up on the right: ` +
        `${chainWithHole(tiles, hidden)}.` +
        (wrapped ? WRAP_NOTE_EN : '') +
        TURN_NOTE_EN,
    };
  }

  if (kind === 2) {
    // si gira a ogni passo e, a passi alterni, entrambe le metà crescono di 1
    const n = 6;
    const a = randInt(rng, 0, 6);
    let b = randInt(rng, 0, 6);
    if (b === a) b = m7(a + 1 + randInt(rng, 0, 4));
    let wrapped = false;
    const tiles = Array.from({ length: n }, (_, i) => {
      const j = Math.floor(i / 2);
      if (a + j > 6 || b + j > 6) wrapped = true;
      const x = m7(a + j);
      const y = m7(b + j);
      return (i % 2 === 0 ? [x, y] : [y, x]) as Tile;
    });
    const hidden = chance(rng, 0.2) ? randInt(rng, 2, n - 2) : n - 1;
    const prev = tiles[hidden - 1];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'alt',
      mod: wrapped,
      refs: [hidden - 1],
      distractors: shuffle(rng, [
        [prev[1], prev[0]], // gira senza aggiungere 1
        [m7(ca + 1), m7(cb + 1)], // aggiunge 1 due volte
        [ca, m7(cb + 1)], // aggiunge 1 a una metà sola
        [m7(ca + 1), cb], // aggiunge 1 all'altra metà sola
        [m7(prev[0] + 1), m7(prev[1] + 1)], // aggiunge 1 senza girare
      ] as Tile[]),
      explanation:
        `A ogni passo la tessera si gira; nei passi pari (il 2°, il 4°, …) oltre a girarsi ` +
        `guadagna anche +1 su tutte e due le metà: ${chainWithHole(tiles, hidden)}.` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : '') +
        TURN_NOTE,
      explanationEn:
        `At each step the tile flips; on even steps (the 2nd, the 4th, …) it also gains ` +
        `+1 on both halves on top of flipping: ${chainWithHole(tiles, hidden)}.` +
        (wrapped ? WRAP_NOTE_EN : '') +
        TURN_NOTE_EN,
    };
  }

  if (kind === 3) {
    // una metà alterna due salti, l'altra ha un passo fisso
    const n = 6;
    const hidden = chooseHidden(rng, n, 0.2, 0);
    const p = pick(rng, [1, 2, 3]);
    let q = pick(rng, [-2, -1, 1, 2, 3]);
    if (q === p) q = p === 3 ? 1 : p + 1;
    const r = pick(rng, [-1, 1, 2]);
    const altLeft = chance(rng, 0.5);
    const a0 = randInt(rng, 0, 6);
    const b0 = randInt(rng, 0, 6);
    let wrapped = false;
    const alt: number[] = [a0];
    const fix: number[] = [b0];
    for (let i = 1; i < n; i++) {
      const step = i % 2 === 1 ? p : q;
      const ra = alt[i - 1] + step;
      const rb = fix[i - 1] + r;
      if (ra < 0 || ra > 6 || rb < 0 || rb > 6) wrapped = true;
      alt.push(m7(ra));
      fix.push(m7(rb));
    }
    const tiles = Array.from({ length: n }, (_, i) => (altLeft ? [alt[i], fix[i]] : [fix[i], alt[i]]) as Tile);
    const [ca, cb] = tiles[hidden];
    const prev = tiles[Math.max(0, hidden - 1)];
    const used = hidden % 2 === 1 ? p : q;
    const other = hidden % 2 === 1 ? q : p;
    return {
      tiles,
      hidden,
      family: 'halves',
      mod: wrapped,
      distractors: shuffle(rng, [
        altLeft ? [m7(prev[0] + other), cb] : [ca, m7(prev[1] + other)], // usa il salto sbagliato dell'alternanza
        altLeft ? [ca, prev[1]] : [prev[0], cb], // dimentica la metà con passo fisso
        altLeft ? [m7(ca + used), m7(cb + r)] : [m7(ca + r), m7(cb + used)], // un passo di troppo
        altLeft ? [prev[0], cb] : [ca, prev[1]], // dimentica la metà che alterna
      ] as Tile[]),
      explanation:
        `La metà di ${altLeft ? 'sinistra' : 'destra'} alterna due salti, +${p} e ${q > 0 ? `+${q}` : q} ` +
        `(${altLeft ? halfList(tiles, 0) : halfList(tiles, 1)}); l'altra metà invece ${stepWord(r)} ` +
        `a ogni passo (${altLeft ? halfList(tiles, 1) : halfList(tiles, 0)}).` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : ''),
      explanationEn:
        `The ${altLeft ? 'left' : 'right'} half alternates two jumps, +${p} and ${q > 0 ? `+${q}` : q} ` +
        `(${altLeft ? halfList(tiles, 0) : halfList(tiles, 1)}); the other half instead ${stepWordEn(r)} ` +
        `at each step (${altLeft ? halfList(tiles, 1) : halfList(tiles, 0)}).` +
        (wrapped ? WRAP_NOTE_EN : ''),
    };
  }

  if (kind === 4) {
    // una metà rimbalza fra due valori, l'altra avanza
    const n = pick(rng, [5, 6, 6]);
    const hidden = chooseHidden(rng, n, 0.2, 0);
    const k = pick(rng, [-2, -1, 1, 2]);
    const bounceLeft = chance(rng, 0.5);
    const x = randInt(rng, 0, 6);
    let y = randInt(rng, 0, 6);
    if (y === x) y = m7(x + 1 + randInt(rng, 0, 4));
    const m0 = randInt(rng, 0, 6);
    let wrapped = false;
    const move: number[] = [];
    for (let i = 0; i < n; i++) {
      const raw = m0 + i * k;
      if (raw < 0 || raw > 6) wrapped = true;
      move.push(m7(raw));
    }
    const tiles = Array.from({ length: n }, (_, i) => {
      const b = i % 2 === 0 ? x : y;
      return (bounceLeft ? [b, move[i]] : [move[i], b]) as Tile;
    });
    const [ca, cb] = tiles[hidden];
    const prev = tiles[Math.max(0, hidden - 1)];
    return {
      tiles,
      hidden,
      family: 'halves',
      mod: wrapped,
      distractors: shuffle(rng, [
        bounceLeft ? [prev[0], cb] : [ca, prev[1]], // dimentica il rimbalzo
        bounceLeft ? [ca, prev[1]] : [prev[0], cb], // dimentica l'avanzamento
        bounceLeft ? [ca, m7(cb + k)] : [m7(ca + k), cb], // un passo di troppo
        bounceLeft ? [ca, m7(cb - k)] : [m7(ca - k), cb], // un passo indietro
      ] as Tile[]),
      explanation:
        `La metà di ${bounceLeft ? 'sinistra' : 'destra'} rimbalza fra ${x} e ${y}, una volta ciascuno; ` +
        `intanto la metà di ${bounceLeft ? 'destra' : 'sinistra'} ${stepWord(k)} a ogni passo ` +
        `(${bounceLeft ? halfList(tiles, 1) : halfList(tiles, 0)}).` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : ''),
      explanationEn:
        `The ${bounceLeft ? 'left' : 'right'} half bounces between ${x} and ${y}, once each; ` +
        `meanwhile the ${bounceLeft ? 'right' : 'left'} half ${stepWordEn(k)} at each step ` +
        `(${bounceLeft ? halfList(tiles, 1) : halfList(tiles, 0)}).` +
        (wrapped ? WRAP_NOTE_EN : ''),
    };
  }

  // salto grande uguale su tutte e due le metà: la fila gira in tondo
  const n = pick(rng, [5, 6, 6]);
  const hidden = chooseHidden(rng, n, 0.2, 0);
  const k = pick(rng, [3, 4, 5]);
  const a0 = randInt(rng, 0, 6);
  let b0 = randInt(rng, 0, 6);
  if (b0 === a0) b0 = m7(a0 + 1 + randInt(rng, 0, 4));
  let wrapped = false;
  const tiles = Array.from({ length: n }, (_, i) => {
    if (a0 + i * k > 6 || b0 + i * k > 6) wrapped = true;
    return [m7(a0 + i * k), m7(b0 + i * k)] as Tile;
  });
  if (!wrapped) throw new Error('senza giro in tondo non è la regola giusta');
  const [ca, cb] = tiles[hidden];
  const prev = tiles[Math.max(0, hidden - 1)];
  return {
    tiles,
    hidden,
    family: 'halves',
    mod: true,
    distractors: shuffle(rng, [
      [m7(prev[0] + k), prev[1]], // muove una metà sola
      [prev[0], m7(prev[1] + k)], // muove l'altra metà sola
      [m7(ca + k), m7(cb + k)], // un passo di troppo
      [m7(ca - 1), m7(cb - 1)], // sbaglia il giro in tondo di 1
      [m7(ca + 1), m7(cb + 1)], // sbaglia il giro in tondo dall'altra parte
    ] as Tile[]),
    explanation:
      `Tutte e due le metà fanno lo stesso salto di ${k} a ogni passo, ma la fila gira in tondo: ` +
      `dopo il 6 si ricomincia da 0 (7 diventa 0, 8 diventa 1, …). Sinistra: ${halfList(tiles, 0)}; ` +
      `destra: ${halfList(tiles, 1)}.`,
    explanationEn:
      `Both halves make the same jump of ${k} at each step, but the row wraps around: ` +
      `after 6 it starts over from 0 (7 becomes 0, 8 becomes 1, …). Left: ${halfList(tiles, 0)}; ` +
      `right: ${halfList(tiles, 1)}.`,
  };
}

// --- difficoltà 3: ogni tessera nasce dalle tessere prima di lei -------------
// Regola d'oro di questo livello: UNA sola aritmetica per tutte e due le metà
// (o sempre modulo 7, o sempre differenza in valore assoluto) e il prompt dice
// sempre da dove nasce la tessera, con le tessere di riferimento evidenziate.

function buildD3(rng: Rng): Built {
  const kind = randInt(rng, 0, 5);

  if (kind === 0) {
    // somma delle DUE precedenti su tutte e due le metà (Fibonacci mod 7)
    const n = pick(rng, [5, 6, 6]);
    const hidden = chance(rng, 0.28) ? randInt(rng, 3, n - 2) : n - 1;
    const tiles: Tile[] = [
      [randInt(rng, 0, 6), randInt(rng, 0, 6)],
      [randInt(rng, 1, 6), randInt(rng, 1, 6)],
    ];
    for (let i = 2; i < n; i++) {
      tiles.push([m7(tiles[i - 1][0] + tiles[i - 2][0]), m7(tiles[i - 1][1] + tiles[i - 2][1])]);
    }
    const p1 = tiles[hidden - 1];
    const p2 = tiles[hidden - 2];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'prev2',
      mod: true,
      refs: [hidden - 2, hidden - 1],
      distractors: shuffle(rng, [
        [Math.abs(p1[0] - p2[0]), Math.abs(p1[1] - p2[1])], // differenza invece di somma
        [ca, p1[1]], // dimentica la regola sulla metà di destra
        [p1[0], cb], // dimentica la regola sulla metà di sinistra
        [m7(ca + p1[0]), m7(cb + p1[1])], // un passo di troppo
        [m7(p1[0] + p1[1]), m7(p2[0] + p2[1])], // somma le metà sbagliate
      ] as Tile[]),
      explanation:
        `Ogni metà è la somma delle DUE tessere prima di lei: sinistra con sinistra, destra con ` +
        `destra, e se il conto supera il 6 si tolgono 7. Sinistra: ${halfList(tiles, 0)}; destra: ` +
        `${halfList(tiles, 1)}. Al posto del ? va ${p2[0]} + ${p1[0]} = ${p2[0] + p1[0]}` +
        `${p2[0] + p1[0] > 6 ? ` → ${ca}` : ''} a sinistra e ${p2[1]} + ${p1[1]} = ${p2[1] + p1[1]}` +
        `${p2[1] + p1[1] > 6 ? ` → ${cb}` : ''} a destra.`,
      explanationEn:
        `Each half is the sum of the TWO tiles before it: left with left, right with ` +
        `right, and if the total is over 6, subtract 7. Left: ${halfList(tiles, 0)}; right: ` +
        `${halfList(tiles, 1)}. So the ? is ${p2[0]} + ${p1[0]} = ${p2[0] + p1[0]}` +
        `${p2[0] + p1[0] > 6 ? ` → ${ca}` : ''} on the left and ${p2[1]} + ${p1[1]} = ${p2[1] + p1[1]}` +
        `${p2[1] + p1[1] > 6 ? ` → ${cb}` : ''} on the right.`,
    };
  }

  if (kind === 1) {
    // differenza fra le DUE precedenti su tutte e due le metà: niente modulo,
    // solo "il più grande meno il più piccolo"
    const n = pick(rng, [5, 6, 6]);
    const hidden = chance(rng, 0.28) ? randInt(rng, 3, n - 2) : n - 1;
    const tiles: Tile[] = [
      [randInt(rng, 0, 6), randInt(rng, 0, 6)],
      [randInt(rng, 0, 6), randInt(rng, 0, 6)],
    ];
    for (let i = 2; i < n; i++) {
      tiles.push([
        Math.abs(tiles[i - 1][0] - tiles[i - 2][0]),
        Math.abs(tiles[i - 1][1] - tiles[i - 2][1]),
      ]);
    }
    const p1 = tiles[hidden - 1];
    const p2 = tiles[hidden - 2];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'prev2',
      refs: [hidden - 2, hidden - 1],
      distractors: shuffle(rng, [
        [m7(p1[0] + p2[0]), m7(p1[1] + p2[1])], // somma invece di differenza
        [ca, p1[1]], // dimentica la regola sulla metà di destra
        [p1[0], cb], // dimentica la regola sulla metà di sinistra
        [Math.abs(ca - p1[0]), Math.abs(cb - p1[1])], // un passo di troppo
        [Math.abs(p1[0] - p2[1]), Math.abs(p1[1] - p2[0])], // incrocia le metà
      ] as Tile[]),
      explanation:
        `Ogni metà è la differenza fra le DUE tessere prima di lei (il numero più grande meno il ` +
        `più piccolo): sinistra con sinistra, destra con destra. Sinistra: ${halfList(tiles, 0)}; ` +
        `destra: ${halfList(tiles, 1)}. Al posto del ? va ` +
        `${Math.max(p1[0], p2[0])} − ${Math.min(p1[0], p2[0])} = ${ca} a sinistra e ` +
        `${Math.max(p1[1], p2[1])} − ${Math.min(p1[1], p2[1])} = ${cb} a destra.`,
      explanationEn:
        `Each half is the difference between the TWO tiles before it (the bigger number minus the ` +
        `smaller one): left with left, right with right. Left: ${halfList(tiles, 0)}; ` +
        `right: ${halfList(tiles, 1)}. So the ? is ` +
        `${Math.max(p1[0], p2[0])} − ${Math.min(p1[0], p2[0])} = ${ca} on the left and ` +
        `${Math.max(p1[1], p2[1])} − ${Math.min(p1[1], p2[1])} = ${cb} on the right.`,
    };
  }

  if (kind === 2) {
    // la metà di destra scivola a sinistra, la nuova destra è la somma delle due
    const n = pick(rng, [5, 6, 6]);
    const hidden = chance(rng, 0.28) ? randInt(rng, 2, n - 2) : n - 1;
    const tiles: Tile[] = [[randInt(rng, 0, 6), randInt(rng, 0, 6)]];
    for (let i = 1; i < n; i++) {
      const [a, b] = tiles[i - 1];
      tiles.push([b, m7(a + b)]);
    }
    const prev = tiles[hidden - 1];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'sum2',
      mod: true,
      refs: [hidden - 1],
      distractors: shuffle(rng, [
        [prev[0], cb], // tiene la metà sbagliata a sinistra
        [ca, Math.abs(prev[0] - prev[1])], // differenza invece di somma
        [ca, m7(prev[0] + prev[1] + 1)], // sbaglia il giro in tondo
        [cb, m7(ca + cb)], // un passo di troppo
      ] as Tile[]),
      explanation:
        `La metà di destra scivola a sinistra, e la nuova metà di destra è la somma delle due metà ` +
        `precedenti (se il conto supera il 6 si tolgono 7): ${chainWithHole(tiles, hidden)}. ` +
        `Da ${fmt(prev)}: a sinistra va ${prev[1]}, a destra ${prev[0]} + ${prev[1]} = ` +
        `${prev[0] + prev[1]}${prev[0] + prev[1] > 6 ? ` → ${cb}` : ''}.`,
      explanationEn:
        `The right half slides to the left, and the new right half is the sum of the previous ` +
        `two halves (if the total is over 6, subtract 7): ${chainWithHole(tiles, hidden)}. ` +
        `From ${fmt(prev)}: the left becomes ${prev[1]}, the right becomes ${prev[0]} + ${prev[1]} = ` +
        `${prev[0] + prev[1]}${prev[0] + prev[1] > 6 ? ` → ${cb}` : ''}.`,
    };
  }

  if (kind === 3) {
    // alternanza di due mosse: +k su tutte e due le metà, poi la tessera si gira
    const n = pick(rng, [5, 6, 6]);
    const hidden = chance(rng, 0.28) ? randInt(rng, 2, n - 2) : n - 1;
    const k = pick(rng, [2, 3]);
    const a = randInt(rng, 0, 6);
    let b = randInt(rng, 0, 6);
    if (b === a) b = m7(a + 1 + randInt(rng, 0, 4));
    const tiles: Tile[] = [[a, b]];
    for (let i = 1; i < n; i++) {
      const [x, y] = tiles[i - 1];
      tiles.push(i % 2 === 1 ? [m7(x + k), m7(y + k)] : [y, x]);
    }
    const prev = tiles[hidden - 1];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'alt',
      mod: true,
      refs: [hidden - 1],
      distractors: shuffle(rng, [
        [prev[1], prev[0]], // gira quando invece bisognava sommare
        [m7(prev[0] + k), m7(prev[1] + k)], // somma quando invece bisognava girare
        [m7(ca + k), m7(cb + k)], // applica la somma due volte
        [m7(prev[0] + k), prev[1]], // somma a una metà sola
        [m7(prev[1] + k), m7(prev[0] + k)], // gira e somma nello stesso passo
      ] as Tile[]),
      explanation:
        `Si alternano due mosse: prima si aggiunge ${k} a tutte e due le metà (se il conto supera ` +
        `il 6 si tolgono 7), poi la tessera si gira, poi di nuovo +${k}, poi di nuovo si gira: ` +
        `${chainWithHole(tiles, hidden)}.` +
        TURN_NOTE,
      explanationEn:
        `Two moves alternate: first add ${k} to both halves (if the total is over 6, subtract ` +
        `7), then the tile flips, then +${k} again, then it flips again: ` +
        `${chainWithHole(tiles, hidden)}.` +
        TURN_NOTE_EN,
    };
  }

  if (kind === 4) {
    // gira e aggiungi nello stesso passo: t(i+1) = (destra + k, sinistra + k)
    const n = pick(rng, [5, 6, 6]);
    const hidden = chance(rng, 0.28) ? randInt(rng, 2, n - 2) : n - 1;
    const k = pick(rng, [1, 2, 3]);
    const a = randInt(rng, 0, 6);
    let b = randInt(rng, 0, 6);
    if (b === a) b = m7(a + 1 + randInt(rng, 0, 4));
    const tiles: Tile[] = [[a, b]];
    let wrapped = false;
    for (let i = 1; i < n; i++) {
      const [x, y] = tiles[i - 1];
      if (x + k > 6 || y + k > 6) wrapped = true;
      tiles.push([m7(y + k), m7(x + k)]);
    }
    const prev = tiles[hidden - 1];
    const [ca, cb] = tiles[hidden];
    return {
      tiles,
      hidden,
      family: 'flip',
      // qui si gira E si aggiunge lo stesso numero a tutte e due le metà
      hint: 'ogni tessera si gira e tutti e due i numeri crescono sempre allo stesso modo',
      hintEn: 'each tile is flipped and both numbers always grow the same way',
      mod: wrapped,
      refs: [hidden - 1],
      distractors: shuffle(rng, [
        [prev[1], prev[0]], // gira senza aggiungere
        [prev[1], m7(prev[0] + k)], // aggiunge solo alla metà finita a destra
        [m7(prev[1] + k), prev[0]], // aggiunge solo alla metà finita a sinistra
        [m7(ca + k), m7(cb + k)], // un passo di troppo
        [m7(prev[1] - k), m7(prev[0] - k)], // toglie invece di aggiungere
      ] as Tile[]),
      explanation:
        `Ogni tessera si ottiene dalla precedente in un colpo solo: la tessera si gira (le due metà ` +
        `si scambiano di posto) e a tutte e due si aggiunge ${k}: ${chainWithHole(tiles, hidden)}.` +
        (wrapped ? ' Dopo il 6 si riparte da 0.' : '') +
        TURN_NOTE,
      explanationEn:
        `Each tile comes from the previous one in a single move: the tile flips (the two halves ` +
        `swap places) and both get +${k}: ${chainWithHole(tiles, hidden)}.` +
        (wrapped ? WRAP_NOTE_EN : '') +
        TURN_NOTE_EN,
    };
  }

  // le tessere si incastrano come nel domino vero, ma i numeri fanno salti grandi
  // e la fila gira in tondo
  const n = pick(rng, [5, 6, 6]);
  const hidden = chooseHidden(rng, n, 0.25, 0);
  const k = pick(rng, [2, 3, 4, 5]);
  const v0 = randInt(rng, 0, 6);
  const vals = Array.from({ length: n + 1 }, (_, i) => m7(v0 + i * k));
  const tiles = Array.from({ length: n }, (_, i) => [vals[i], vals[i + 1]] as Tile);
  const prev = tiles[hidden - 1];
  return {
    tiles,
    hidden,
    family: 'chain',
    mod: true,
    refs: [hidden - 1],
    distractors: shuffle(rng, [
      [prev[1], m7(prev[1] + k + 1)], // sbaglia il salto di 1
      [prev[1], m7(prev[1] + k - 1)], // lo sbaglia dall'altra parte
      [m7(prev[1] + k), m7(prev[1] + 2 * k)], // un passo di troppo
      [prev[1], m7(prev[1] - k)], // torna indietro invece di andare avanti
      [prev[0], m7(prev[0] + k)], // riparte dal numero sbagliato
    ] as Tile[]),
    explanation:
      `Le tessere si incastrano come nel domino vero: ogni tessera comincia con il numero con cui ` +
      `finiva quella prima di lei. E il numero fa un salto di ${k} ogni volta, girando in tondo: ` +
      `dopo il 6 si ricomincia da 0. La catena dei numeri è ${vals.join(' → ')}, quindi la fila è ` +
      `${chainWithHole(tiles, hidden)}.`,
    explanationEn:
      `The tiles link up like in a real domino game: each tile starts with the number the ` +
      `previous one ended with. And the number makes a jump of ${k} each time, wrapping around: ` +
      `after 6 it starts over from 0. The chain of numbers is ${vals.join(' → ')}, so the row is ` +
      `${chainWithHole(tiles, hidden)}.`,
  };
}

// ---------------------------------------------------------------------------
// Guscio comune
// ---------------------------------------------------------------------------

/**
 * Il prompt porta TUTTO quello che serve per rispondere: che tipo di legame
 * tiene insieme la fila (il suggerimento della famiglia), se i numeri girano in
 * tondo dopo il 6, e — quando nella fila compaiono una tessera e la sua
 * capovolta — la convenzione che una tessera girata è un'altra tessera. Niente
 * di tutto questo può stare solo nell'explanation, che si legge dopo.
 */
function promptFor(hidden: number, n: number, built: Built, rowTurns: boolean): LocalizedText {
  const base =
    hidden === n - 1
      ? 'Quale tessera continua la fila?'
      : hidden === 0
        ? 'Quale tessera apre la fila?'
        : 'Quale tessera manca nella fila?';
  const notes: string[] = [built.hint ?? FAMILY_HINT[built.family]];
  if (built.mod) notes.push('dopo il 6 si torna a 0');
  // con 'flip' e 'alt' il suggerimento parla già di girare la tessera
  if (rowTurns && built.family !== 'flip' && built.family !== 'alt') {
    notes.push('una tessera girata è un\'altra tessera');
  }
  const baseEn =
    hidden === n - 1
      ? 'Which tile continues the row?'
      : hidden === 0
        ? 'Which tile opens the row?'
        : 'Which tile is missing from the row?';
  const notesEn: string[] = [built.hintEn ?? FAMILY_HINT_EN[built.family]];
  if (built.mod) notesEn.push('after 6 it goes back to 0');
  if (rowTurns && built.family !== 'flip' && built.family !== 'alt') {
    notesEn.push('a flipped tile is a different tile');
  }
  return L(`${base} (${notes.join('; ')})`, `${baseEn} (${notesEn.join('; ')})`);
}

function tailOf(tiles: Tile[], hidden: number): string {
  const c = fmt(tiles[hidden]);
  if (hidden === tiles.length - 1) return ` Dopo ${fmt(tiles[hidden - 1])} viene quindi ${c}.`;
  if (hidden === 0) return ` Tornando indietro da ${fmt(tiles[1])}, la fila si apre con ${c}.`;
  return ` Fra ${fmt(tiles[hidden - 1])} e ${fmt(tiles[hidden + 1])} ci va quindi ${c}.`;
}

/** come `tailOf`, in inglese */
function tailOfEn(tiles: Tile[], hidden: number): string {
  const c = fmt(tiles[hidden]);
  if (hidden === tiles.length - 1) return ` So after ${fmt(tiles[hidden - 1])} comes ${c}.`;
  if (hidden === 0) return ` Working back from ${fmt(tiles[1])}, the row opens with ${c}.`;
  return ` So between ${fmt(tiles[hidden - 1])} and ${fmt(tiles[hidden + 1])} goes ${c}.`;
}

export function genDomino(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const built = difficulty === 1 ? buildD1(rng) : difficulty === 2 ? buildD2(rng) : buildD3(rng);
    const { tiles, hidden } = built;

    // sanità: tessere vere (0..6) e tutte diverse fra loro
    if (tiles.some((t) => !inRange(t))) throw new Error('tessera fuori dal domino');
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) if (eq(tiles[i], tiles[j])) throw new Error('tessera ripetuta');
    }

    const correct = tiles[hidden];

    // LA REGOLA ANNUNCIATA DEVE PORTARE A UNA TESSERA SOLA. Si prova a mettere al
    // posto del "?" tutte e 49 le tessere: se più di una rende la fila coerente
    // con la famiglia dichiarata nel prompt, la domanda è irrisolvibile per chi
    // ragiona bene (potrebbe difendere l'altra) e si rigenera.
    const ok = defensible(built.family, tiles, hidden);
    if (ok.length !== 1) throw new Error(`la regola annunciata ammette ${ok.length} tessere`);
    if (!eq(ok[0], correct)) throw new Error('la regola annunciata non porta alla risposta corretta');

    // E se provasse un'altra famiglia invece di quella annunciata? Nessuna delle
    // altre cinque deve giustificare una tessera diversa: chi legge la fila "a
    // modo suo" non deve poter difendere una risposta che il gioco chiama errore.
    for (const fam of ALL_FAMILIES) {
      if (fam === built.family) continue;
      for (const t of defensible(fam, tiles, hidden)) {
        if (!eq(t, correct)) throw new Error(`anche la famiglia ${fam} giustifica ${fmt(t)}`);
      }
    }

    // anti-ambiguità: nessuna regola semplice alternativa deve dare un'altra tessera
    for (const alt of alternatives(tiles, hidden)) if (!eq(alt, correct)) throw new Error('fila ambigua');

    // Due distrattori validi: errori tipici, mai tessere già visibili nella fila
    // e — regola della convenzione ordinata — mai due opzioni che sono l'una la
    // capovolta dell'altra, così il bambino non deve mai chiedersi se 5|4 e 4|5
    // siano la stessa tessera.
    const chosen: Tile[] = [];
    for (const d of built.distractors) {
      if (!inRange(d) || eq(d, correct) || turned(d, correct)) continue;
      if (tiles.some((t, i) => i !== hidden && eq(t, d))) continue;
      if (chosen.some((c) => eq(c, d) || turned(c, d))) continue;
      chosen.push(d);
      if (chosen.length === 2) break;
    }
    if (chosen.length < 2) throw new Error('distrattori insufficienti');

    // Controllo finale sulle TRE opzioni davvero mostrate: una sola può essere
    // compatibile con la regola annunciata, ed è la corretta. Discende già dal
    // controllo sulle 49 tessere, ma qui è esplicito: se un domani quel controllo
    // si allentasse, questa riga se ne accorge invece di far uscire una domanda
    // in cui due risposte sono difendibili.
    const compatibili = [correct, ...chosen].filter((t) => ok.some((d) => eq(d, t)));
    if (compatibili.length !== 1 || !eq(compatibili[0], correct)) {
      throw new Error('più di un\'opzione compatibile con la regola annunciata');
    }

    const asChoice = (t: Tile) => ({ kind: 'domino' as const, tile: { a: t[0], b: t[1] } });
    const { choices, correctIndex } = placeChoices(rng, asChoice(correct), [
      asChoice(chosen[0]),
      asChoice(chosen[1]),
    ]);

    const refs = new Set(built.refs ?? []);
    const drawn: DominoTile[] = tiles.map((t, i) => {
      // l'incognita non porta con sé i suoi numeri: il payload arriva al client
      if (i === hidden) return { a: 0, b: 0, unknown: true };
      return refs.has(i) ? { a: t[0], b: t[1], highlight: true } : { a: t[0], b: t[1] };
    });

    // Se nella fila compaiono due tessere girate l'una rispetto all'altra (capita
    // anche senza che la regola parli di giravolte, per esempio quando la somma
    // delle due metà è costante), la convenzione va detta PRIMA, nel prompt — e
    // ripetuta nella spiegazione: così nessuno resta col dubbio di aver visto due
    // volte la stessa tessera.
    const rowTurns = tiles.some((t, i) => t[0] !== t[1] && tiles.some((u, j) => j > i && turned(t, u)));
    let explanation = built.explanation + tailOf(tiles, hidden);
    if (rowTurns && !explanation.includes(TURN_NOTE.trim())) explanation += TURN_NOTE;
    let explanationEn = built.explanationEn + tailOfEn(tiles, hidden);
    if (rowTurns && !explanationEn.includes(TURN_NOTE_EN.trim())) explanationEn += TURN_NOTE_EN;

    return {
      qtype: 'domino',
      difficulty,
      prompt: promptFor(hidden, tiles.length, built, rowTurns),
      payload: { kind: 'dominoes' as const, tiles: drawn },
      choices,
      correctIndex,
      explanation: L(explanation, explanationEn),
    };
  }, 120);
}
