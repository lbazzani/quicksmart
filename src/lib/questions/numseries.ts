// Generatore "numseries": serie numeriche in molte forme diverse.
//
// STRUTTURE (cambia la forma della domanda, non solo i numeri):
//  - coda:      1 2 3 4 ?            "quale numero continua la serie?"
//  - buco:      1 2 ? 4 5            "quale numero manca?"
//  - coppie:    2 4 | 3 9 | 4 16 | 5 ?   (la regola sta DENTRO la coppia)
//  - gruppi:    2 3 6 | 4 5 20 | 6 7 ?   (il terzo nasce dai primi due)
//  - righe:     3 7 4 9 | 8 12 9 ?       (due righe legate fra loro)
//  - intruso:   12 18 24 29 36          "quale numero NON segue la regola?"
//
// REGOLE per difficoltà:
//  d1: +k, −k, ×2/×3, coppie con "+k"/"×k", multipli con intruso, due righe.
//  d2: salti crescenti, alternanza +p/×2, quadrati e cubi, zig-zag +a/−b,
//      ÷2 e ÷3, somma delle cifre, coppie con quadrati, mappe fra righe.
//  d3: serie intrecciate, Fibonacci, salti accelerati, ×2±b, prodotto delle
//      cifre, salti a gruppi di 3, numeri primi, discese sotto lo zero,
//      gruppi di tre numeri, mappe non lineari fra righe.
//
// Distrattori: SEMPRE errori tipici costruiti (ripetere l'ultimo salto, media
// dei vicini, operazione sbagliata dell'alternanza, confondere quadrato e
// doppio, leggere la colonna invece della regola, off-by-one). Mai a caso.
//
// Anti-scorciatoia: gli errori tipici di una serie tendono a CIRCONDARE la
// risposta (uno sotto e uno sopra), e chi sceglie sempre il numero di mezzo
// vince senza ragionare. Perciò ogni famiglia non consegna due distrattori già
// scelti ma un elenco di errori plausibili da entrambi i lati (gli errori
// concettuali della regola, più gli scarti di conto), e `balancedTwo` estrae la
// coppia facendo ruotare la posizione della risposta: a volte in mezzo, a volte
// la più piccola, a volte la più grande. Se un lato non ha abbastanza errori
// credibili la domanda viene scartata e rigenerata.
//
// Anti-ambiguità: ogni serie viene rigettata (e rigenerata) se una regola
// semplice alternativa — differenza costante, differenze delle differenze,
// rapporto costante, Fibonacci, v = q·prec + b, salti alternati, somma/prodotto
// delle cifre, due serie intrecciate — riempirebbe il buco con un numero
// diverso da quello voluto. Così nessun distrattore è difendibile come "altra
// soluzione" e la risposta corretta è unica.

import type { Difficulty, Question } from '../types';
import { chance, pick, randInt, shuffle, type Rng } from '../rng';
import { balancedNumericDistractors, placeChoices, retry } from './qutils';

const MAX = 400;

// ---------------------------------------------------------------------------
// Aiuti numerici
// ---------------------------------------------------------------------------

const PRIMES = [
  2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97,
  101, 103, 107, 109, 113, 127, 131, 137, 139, 149,
];

function digitsOf(n: number): number[] {
  return String(Math.abs(n))
    .split('')
    .map((c) => c.charCodeAt(0) - 48);
}
function dsum(n: number): number {
  return digitsOf(n).reduce((a, b) => a + b, 0);
}
function dprod(n: number): number {
  return digitsOf(n).reduce((a, b) => a * b, 1);
}
function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;
  return true;
}
function isSquare(n: number): boolean {
  if (n < 0) return false;
  const r = Math.round(Math.sqrt(n));
  return r * r === n;
}
function isCube(n: number): boolean {
  if (n < 0) return false;
  const r = Math.round(Math.cbrt(n));
  return r * r * r === n;
}
function gcd(a: number, b: number): number {
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}

interface Pt {
  x: number;
  y: number;
}

/** valore in X del polinomio passante per i punti (aritmetica esatta); null se non intero */
function lagrangeAt(pts: Pt[], X: number): number | null {
  let num = 0;
  let den = 1;
  for (const p of pts) {
    let n = p.y;
    let d = 1;
    for (const q of pts) {
      if (q.x === p.x) continue;
      n *= X - q.x;
      d *= p.x - q.x;
    }
    num = num * d + n * den;
    den *= d;
    const g = gcd(Math.abs(num), Math.abs(den)) || 1;
    num /= g;
    den /= g;
    if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) return null;
  }
  if (den === 0 || num % den !== 0) return null;
  return num / den;
}

/** i punti stanno tutti su un polinomio di grado `deg`? (serve almeno un punto di verifica) */
function fitsPoly(pts: Pt[], deg: number): boolean {
  if (pts.length < deg + 2) return false;
  const base = pts.slice(0, deg + 1);
  return pts.every((q) => lagrangeAt(base, q.x) === q.y);
}

function polyPredict(pts: Pt[], deg: number, X: number): number | null {
  if (!fitsPoly(pts, deg)) return null;
  return lagrangeAt(pts.slice(0, deg + 1), X);
}

/** y = y0·r^(x−x0) con r intero (o 1/r); null se il modello non regge */
function geoPredict(pts: Pt[], X: number): number | null {
  if (pts.length < 3 || pts.some((p) => p.y === 0)) return null;
  const p0 = pts[0];
  for (const r of [2, 3, 4, 5, 10]) {
    for (const dir of [1, -1]) {
      const at = (x: number): number | null => {
        const e = dir * (x - p0.x);
        if (e >= 0) return p0.y * r ** e;
        const q = r ** -e;
        return p0.y % q === 0 ? p0.y / q : null;
      };
      if (pts.every((p) => at(p.x) === p.y)) {
        const v = at(X);
        if (v !== null && Number.isSafeInteger(v)) return v;
      }
    }
  }
  return null;
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

/**
 * Tutti i numeri che una regola semplice metterebbe nel buco in posizione `p`
 * della serie `vals` (il buco può stare in fondo o in mezzo).
 */
function simplePredictions(vals: number[], p: number): number[] {
  const n = vals.length;
  const out: number[] = [];
  const push = (v: number | null | undefined) => {
    if (v !== null && v !== undefined && Number.isSafeInteger(v)) out.push(v);
  };
  const known = (i: number) => i >= 0 && i < n && i !== p;
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) if (i !== p) pts.push({ x: i, y: vals[i] });

  push(polyPredict(pts, 1, p)); // differenza costante
  push(polyPredict(pts, 2, p)); // differenze delle differenze costanti
  push(geoPredict(pts, p)); // rapporto costante

  // due serie intrecciate, entrambe con passo costante
  const same = pts.filter((q) => (q.x - p) % 2 === 0);
  const other = pts.filter((q) => (q.x - p) % 2 !== 0);
  if (fitsPoly(same, 1) && fitsPoly(other, 1)) push(lagrangeAt(same.slice(0, 2), p));

  // salti che si alternano: +a, +b, +a, +b, …
  const dk: (number | null)[] = [];
  for (let i = 0; i + 1 < n; i++) dk.push(i === p || i + 1 === p ? null : vals[i + 1] - vals[i]);
  const cls: number[][] = [[], []];
  dk.forEach((x, i) => {
    if (x !== null) cls[i % 2].push(x);
  });
  // basta che il ritmo sia confermato una volta (salti 4, 2, 4 → uno legge "+4, +2")
  if (cls[0].length >= 1 && cls[1].length >= 1 && cls[0].length + cls[1].length >= 3) {
    const [a, b] = [cls[0][0], cls[1][0]];
    if (a !== b && cls[0].every((x) => x === a) && cls[1].every((x) => x === b)) {
      if (p >= 1) push(vals[p - 1] + cls[(p - 1) % 2][0]);
      else push(vals[1] - cls[0][0]);
    }
  }

  // Fibonacci: ogni numero è la somma dei due precedenti
  let fibOk = 0;
  let fibBad = false;
  for (let i = 2; i < n; i++) {
    if (i === p || i - 1 === p || i - 2 === p) continue;
    if (vals[i] === vals[i - 1] + vals[i - 2]) fibOk++;
    else fibBad = true;
  }
  if (!fibBad && fibOk >= 2) {
    if (known(p - 1) && known(p - 2)) push(vals[p - 1] + vals[p - 2]);
    else if (known(p - 1) && known(p + 1)) push(vals[p + 1] - vals[p - 1]);
    else if (known(p + 1) && known(p + 2)) push(vals[p + 2] - vals[p + 1]);
  }

  // ricorrenza affine: v(i) = q·v(i−1) + b  (anche con divisione)
  const steps: Pt[] = [];
  for (let i = 1; i < n; i++) if (i !== p && i - 1 !== p) steps.push({ x: vals[i - 1], y: vals[i] });
  if (steps.length >= 3) {
    for (const q of [-2, -1, 2, 3, 4, 5]) {
      const b = steps[0].y - q * steps[0].x;
      if (steps.every((s) => s.y === q * s.x + b)) {
        if (known(p - 1)) push(q * vals[p - 1] + b);
        else if (known(p + 1) && (vals[p + 1] - b) % q === 0) push((vals[p + 1] - b) / q);
      }
    }
    for (const q of [2, 3, 4]) {
      if (steps[0].x % q !== 0) continue;
      const b = steps[0].y - steps[0].x / q;
      if (steps.every((s) => s.x % q === 0 && s.y === s.x / q + b)) {
        if (known(p - 1) && vals[p - 1] % q === 0) push(vals[p - 1] / q + b);
      }
    }
  }

  // ricorrenze con le cifre: v(i) = v(i−1) + somma (o prodotto) delle sue cifre
  for (const f of [dsum, dprod]) {
    let ok = 0;
    let bad = false;
    for (let i = 1; i < n; i++) {
      if (i === p || i - 1 === p) continue;
      if (vals[i] === vals[i - 1] + f(vals[i - 1])) ok++;
      else bad = true;
    }
    if (!bad && ok >= 2 && known(p - 1)) push(vals[p - 1] + f(vals[p - 1]));
  }

  // buco in fondo: valgono anche i controlli classici sulla coda
  if (p === n - 1) for (const v of altNexts(vals.slice(0, n - 1))) push(v);
  return out;
}

/** lancia se una regola semplice riempirebbe il buco con un altro numero */
function assertUnique(vals: number[], p: number) {
  for (const alt of simplePredictions(vals, p)) {
    if (alt !== vals[p]) throw new Error('serie ambigua');
  }
}

// ---------------------------------------------------------------------------
// Struttura comune di una domanda costruita
// ---------------------------------------------------------------------------

interface Built {
  /** riga da disegnare: numeri, '?' per l'incognita, '|' come separatore */
  seq: (number | string)[];
  prompt: string;
  correct: number;
  /** due errori tipici, mai numeri a caso */
  distractors: [number, number];
  explanation: string;
  allowNegative?: boolean;
  max?: number;
}

/** soglia sotto la quale un distrattore non è credibile (in una serie positiva, 0 e i negativi) */
function floorOf(vals: number[], allowNegative?: boolean): number {
  if (allowNegative) return -200;
  return Math.min(...vals) > 0 ? 1 : 0;
}

/**
 * Errori di CONTO attorno alla risposta: chi ha capito la regola ma sbaglia la
 * somma finisce a un passo dal risultato. Servono a coprire il lato che gli
 * errori concettuali lasciano scoperto (spesso stanno tutti sopra o tutti sotto).
 */
function slips(correct: number, span = 3): number[] {
  const out: number[] = [];
  for (let d = 1; d <= span; d++) out.push(correct - d, correct + d);
  return out;
}

interface BalanceOpts {
  /** valore minimo credibile per un distrattore */
  floor?: number;
  /** numeri già scritti nella domanda: offrirli confonderebbe e basta */
  avoid?: number[];
  /** se il buco sta FRA due numeri visibili, i distrattori devono starci dentro */
  lo?: number;
  hi?: number;
}

/**
 * Due distrattori scelti in modo che la risposta finisca a turno in mezzo, in
 * cima e in fondo alla terna.
 *
 * `prefer` sono gli errori concettuali (i più istruttivi): vengono ripescati
 * dopo il bilanciamento e sostituiti a uno scarto di conto che stia dallo stesso
 * lato, così la posizione resta quella decisa ma il distrattore è il migliore
 * disponibile. Lancia se un lato non ha errori credibili a sufficienza: la
 * domanda va rigenerata invece di ricadere nello schema "risposta in mezzo".
 */
function balancedTwo(
  rng: Rng,
  correct: number,
  prefer: number[],
  filler: number[],
  opts: BalanceOpts = {}
): [number, number] {
  const { floor = 1, avoid = [], lo = -Infinity, hi = Infinity } = opts;
  const ok = (v: number) =>
    Number.isInteger(v) && v !== correct && v >= floor && v > lo && v < hi && !avoid.includes(v);
  const pref = [...new Set(prefer.filter(ok))];
  const two = balancedNumericDistractors(rng, correct, [...pref, ...filler.filter(ok)], 1);
  if (!two) throw new Error('distrattori non equilibrabili');

  // gli errori concettuali entrano in ordine di priorità, ognuno al posto di uno
  // scarto di conto che sta dalla stessa parte (un posto già "concettuale" non
  // viene più toccato: il primo della lista è il più istruttivo)
  const out: [number, number] = [two[0], two[1]];
  for (const p of pref) {
    if (out.includes(p)) continue;
    const i = out.findIndex(
      (v) => !pref.includes(v) && Math.sign(v - correct) === Math.sign(p - correct)
    );
    if (i >= 0) out[i] = p;
  }
  if (out[0] === out[1]) throw new Error('distrattori non distinti');
  return chance(rng, 0.5) ? out : [out[1], out[0]];
}

// ---------------------------------------------------------------------------
// Catalogo di regole: ogni regola sa produrre i suoi valori e spiegarsi
// ---------------------------------------------------------------------------

interface RuleSeq {
  vals: number[];
  /** frase che descrive la regola, con esempi presi dalla serie stessa */
  rule: string;
  allowNegative?: boolean;
  /** errori tipici di QUESTA regola, provati prima di quelli generici */
  wrong?: (vals: number[]) => number[];
}

function rArith(rng: Rng): RuleSeq {
  const k = pick(rng, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25]);
  const n = randInt(rng, 5, 7);
  const s = randInt(rng, 1, 40);
  const vals = Array.from({ length: n }, (_, i) => s + i * k);
  return { vals, rule: `si aggiunge sempre ${k} (${vals[0]} + ${k} = ${vals[1]}, ${vals[1]} + ${k} = ${vals[2]}, …)` };
}

function rArithDown(rng: Rng): RuleSeq {
  const k = pick(rng, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20]);
  const n = randInt(rng, 5, 7);
  // mai sotto il 5 in fondo: quando la discesa finisce lì c'è anche la risposta,
  // e sotto il 5 non ci sono due distrattori più piccoli credibili
  const end = randInt(rng, 5, 25);
  const vals = Array.from({ length: n }, (_, i) => end + (n - 1 - i) * k);
  return { vals, rule: `si toglie sempre ${k} (${vals[0]} − ${k} = ${vals[1]}, ${vals[1]} − ${k} = ${vals[2]}, …)` };
}

function rGeom(rng: Rng): RuleSeq {
  const r = pick(rng, [2, 2, 3]);
  const n = r === 2 ? randInt(rng, 5, 6) : randInt(rng, 4, 5);
  const cap = Math.floor(MAX / r ** (n - 1));
  const s = randInt(rng, 1, Math.max(1, Math.min(12, cap)));
  const vals = Array.from({ length: n }, (_, i) => s * r ** i);
  return {
    vals,
    rule: `ogni numero è il ${r === 2 ? 'doppio' : 'triplo'} del precedente (${vals[0]} × ${r} = ${vals[1]}, ${vals[1]} × ${r} = ${vals[2]}, …)`,
  };
}

function rGeomDown(rng: Rng): RuleSeq {
  const r = pick(rng, [2, 2, 3]);
  const n = r === 2 ? randInt(rng, 5, 6) : randInt(rng, 4, 5);
  const cap = Math.min(12, Math.floor(MAX / r ** (n - 1)));
  // l'ultimo numero è anche la risposta: se scendesse a 1 o 2 non esisterebbero
  // due valori più piccoli credibili e la risposta sarebbe sempre la minima
  if (cap < 4) throw new Error('discesa geometrica troppo corta');
  const s = randInt(rng, 4, cap);
  const vals = Array.from({ length: n }, (_, i) => s * r ** (n - 1 - i));
  return {
    vals,
    rule: `ogni numero è ${r === 2 ? 'la metà' : 'la terza parte'} del precedente (${vals[0]} ÷ ${r} = ${vals[1]}, ${vals[1]} ÷ ${r} = ${vals[2]}, …)`,
    // toglie r invece di dividere; divide per il numero sbagliato
    wrong: (v) => [v[v.length - 2] - r, Math.floor(v[v.length - 2] / (r + 1))],
  };
}

function rGrow(rng: Rng): RuleSeq {
  const d0 = randInt(rng, 1, 6);
  const n = randInt(rng, 5, 7);
  const s = randInt(rng, 1, 20);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) vals.push(vals[i] + d0 + i);
  return { vals, rule: `i salti crescono di 1 ogni volta (+${d0}, +${d0 + 1}, +${d0 + 2}, …)` };
}

function rAccel(rng: Rng): RuleSeq {
  const d0 = randInt(rng, 2, 9);
  const c = randInt(rng, 2, 5);
  const n = randInt(rng, 5, 6);
  const s = randInt(rng, 1, 30);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) vals.push(vals[i] + d0 + i * c);
  return { vals, rule: `i salti aumentano di ${c} ogni volta (+${d0}, +${d0 + c}, +${d0 + 2 * c}, …)` };
}

function rAltOps(rng: Rng): RuleSeq {
  const p = randInt(rng, 3, 9);
  const startAdd = chance(rng, 0.5);
  const s = randInt(rng, 1, 6);
  const n = randInt(rng, 5, 6);
  const vals = [s];
  for (let t = 0; t < n - 1; t++) {
    const add = t % 2 === 0 ? startAdd : !startAdd;
    vals.push(add ? vals[t] + p : vals[t] * 2);
  }
  const op = (t: number) => ((t % 2 === 0 ? startAdd : !startAdd) ? `+ ${p}` : '× 2');
  return {
    vals,
    rule: `si alternano «+${p}» e «×2» (${vals[0]} ${op(0)} = ${vals[1]}, ${vals[1]} ${op(1)} = ${vals[2]}, …)`,
  };
}

function rZigzag(rng: Rng): RuleSeq {
  const a = randInt(rng, 5, 14);
  const b = randInt(rng, 2, a - 1);
  const up = chance(rng, 0.6);
  const n = randInt(rng, 6, 7);
  const s = randInt(rng, up ? 5 : 5 + b, 40);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) {
    const plus = i % 2 === 0 ? up : !up;
    vals.push(vals[i] + (plus ? a : -b));
  }
  return {
    vals,
    rule: `i salti si alternano: prima ${up ? `+${a}` : `−${b}`}, poi ${up ? `−${b}` : `+${a}`}, e così via`,
  };
}

function rSquares(rng: Rng): RuleSeq {
  const step = pick(rng, [1, 1, 2]);
  const n = 5;
  const m0 = randInt(rng, 1, step === 1 ? 14 : 8);
  const ms = Array.from({ length: n }, (_, i) => m0 + i * step);
  const vals = ms.map((m) => m * m);
  return {
    vals,
    rule: `sono i quadrati ${step === 1 ? 'dei numeri consecutivi' : 'dei numeri di 2 in 2'} (${ms[0]}×${ms[0]} = ${vals[0]}, ${ms[1]}×${ms[1]} = ${vals[1]}, …)`,
  };
}

function rCubes(rng: Rng): RuleSeq {
  const m0 = randInt(rng, 1, 3);
  const n = m0 === 3 ? 4 : 5;
  const ms = Array.from({ length: n }, (_, i) => m0 + i);
  const vals = ms.map((m) => m ** 3);
  return {
    vals,
    rule: `sono i cubi dei numeri consecutivi (${ms[0]}×${ms[0]}×${ms[0]} = ${vals[0]}, ${ms[1]}×${ms[1]}×${ms[1]} = ${vals[1]}, …)`,
  };
}

function rDigitSum(rng: Rng): RuleSeq {
  const n = randInt(rng, 5, 6);
  const s = randInt(rng, 10, 60);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) vals.push(vals[i] + dsum(vals[i]));
  return {
    vals,
    rule: `a ogni numero si somma la somma delle sue cifre (${vals[0]} + ${digitsOf(vals[0]).join('+')} = ${vals[1]}, ${vals[1]} + ${digitsOf(vals[1]).join('+')} = ${vals[2]}, …)`,
    // somma una cifra sola invece di tutte e due
    wrong: (v) => {
      const last = v[v.length - 2];
      const dg = digitsOf(last);
      return [last + dg[dg.length - 1], last + dg[0]];
    },
  };
}

function rDigitProd(rng: Rng): RuleSeq {
  const n = 5;
  const s = randInt(rng, 12, 49);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) {
    const q = dprod(vals[i]);
    if (q < 2) throw new Error('prodotto delle cifre nullo');
    vals.push(vals[i] + q);
  }
  return {
    vals,
    rule: `a ogni numero si somma il prodotto delle sue cifre (${vals[0]} + ${digitsOf(vals[0]).join('×')} = ${vals[1]}, ${vals[1]} + ${digitsOf(vals[1]).join('×')} = ${vals[2]}, …)`,
    // somma le cifre invece di moltiplicarle; somma una cifra sola
    wrong: (v) => {
      const last = v[v.length - 2];
      return [last + dsum(last), last + Math.max(...digitsOf(last))];
    },
  };
}

function rFib(rng: Rng): RuleSeq {
  const s1 = randInt(rng, 1, 8);
  const s2 = s1 + randInt(rng, 1, 7);
  const n = randInt(rng, 5, 6);
  const vals = [s1, s2];
  while (vals.length < n) vals.push(vals[vals.length - 1] + vals[vals.length - 2]);
  return {
    vals,
    rule: `ogni numero è la somma dei due precedenti (${vals[0]} + ${vals[1]} = ${vals[2]}, ${vals[1]} + ${vals[2]} = ${vals[3]}, …)`,
  };
}

function rAffine(rng: Rng): RuleSeq {
  const b = pick(rng, [1, 2, 3, -1, -2]);
  const s = b < 0 ? randInt(rng, 3, 7) : randInt(rng, 1, 5);
  const vals = [s];
  for (let i = 0; i < 5; i++) vals.push(vals[i] * 2 + b);
  const n = vals[5] > MAX ? 5 : 6;
  return {
    vals: vals.slice(0, n),
    rule: `ogni numero è il doppio del precedente ${b > 0 ? `più ${b}` : `meno ${-b}`} (${vals[0]} × 2 ${b > 0 ? '+' : '−'} ${Math.abs(b)} = ${vals[1]}, …)`,
  };
}

function rInter(rng: Rng): RuleSeq {
  const da = randInt(rng, 2, 9);
  const a0 = randInt(rng, 2, 20);
  const desc = chance(rng, 0.4);
  let db = randInt(rng, 2, 9);
  if (db === da) db = da === 9 ? 2 : da + 1;
  const stepB = desc ? -db : db;
  const b0 = desc ? randInt(rng, 3 * db + 2, 3 * db + 40) : randInt(rng, 2, 30);
  const vals: number[] = [];
  for (let i = 0; i < 4; i++) {
    vals.push(a0 + i * da);
    vals.push(b0 + i * stepB);
  }
  return {
    vals: vals.slice(0, 7),
    rule: `si alternano due serie: i numeri in posizione dispari crescono di ${da}, quelli in posizione pari ${desc ? 'calano' : 'crescono'} di ${db}`,
  };
}

function rPeriod3(rng: Rng): RuleSeq {
  const steps = shuffle(rng, [randInt(rng, 2, 5), randInt(rng, 6, 9), randInt(rng, 10, 15)]);
  if (new Set(steps).size < 3) throw new Error('salti non distinti');
  const n = 7;
  const s = randInt(rng, 1, 30);
  const vals = [s];
  for (let i = 0; i < n - 1; i++) vals.push(vals[i] + steps[i % 3]);
  return {
    vals,
    rule: `i salti si ripetono a gruppi di tre: +${steps[0]}, +${steps[1]}, +${steps[2]}, poi di nuovo +${steps[0]}, +${steps[1]}, +${steps[2]}`,
  };
}

function rPrimes(rng: Rng): RuleSeq {
  const n = randInt(rng, 5, 6);
  const start = randInt(rng, 0, 8);
  const vals = PRIMES.slice(start, start + n);
  return {
    vals,
    rule: `sono i numeri primi in fila (${vals[0]}, ${vals[1]}, ${vals[2]}, …): si dividono solo per 1 e per sé stessi`,
    // prende il dispari successivo (che primo non è); salta un primo
    wrong: () => [vals[n - 2] + 2, PRIMES[start + n]],
  };
}

function rDownZero(rng: Rng): RuleSeq {
  const k = randInt(rng, 4, 12);
  const n = randInt(rng, 5, 6);
  const end = -randInt(rng, 1, 20);
  const vals = Array.from({ length: n }, (_, i) => end + (n - 1 - i) * k);
  return {
    vals,
    rule: `si toglie sempre ${k}, anche quando si passa sotto lo zero (${vals[0]} − ${k} = ${vals[1]}, …)`,
    allowNegative: true,
  };
}

function rDownAccel(rng: Rng): RuleSeq {
  const d0 = randInt(rng, 2, 7);
  const c = randInt(rng, 2, 4);
  const n = randInt(rng, 5, 6);
  let drop = 0;
  const drops: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    drops.push(d0 + i * c);
    drop += d0 + i * c;
  }
  const s = drop + randInt(rng, -18, 30);
  const vals = [s];
  for (const d of drops) vals.push(vals[vals.length - 1] - d);
  return {
    vals,
    rule: `si scende sempre di più: prima ${d0}, poi ${d0 + c}, poi ${d0 + 2 * c}, … (ogni salto in giù aumenta di ${c})`,
    allowNegative: true,
  };
}

// ---------------------------------------------------------------------------
// Struttura: "?" in fondo
// ---------------------------------------------------------------------------

function endSeries(rng: Rng, s: RuleSeq): Built {
  const v = s.vals;
  const n = v.length;
  assertUnique(v, n - 1);
  const correct = v[n - 1];
  const visible = v.slice(0, n - 1);
  const last = visible[n - 2];
  const prev = visible[n - 3];
  const floor = floorOf(v, s.allowNegative);
  const prevDiff = last - prev;
  const step = correct - last;
  // errori tipici della regola, più: ripetere l'ultimo salto, ripeterlo due
  // volte, fare un passo di troppo (il numero DOPO la risposta)
  const prefer = [...(s.wrong?.(v) ?? []), last + prevDiff, last + 2 * prevDiff, correct + step];
  return {
    seq: [...visible, '?'],
    prompt: 'Quale numero continua la serie?',
    correct,
    distractors: balancedTwo(rng, correct, prefer, slips(correct), { floor, avoid: visible }),
    explanation: `Regola: ${s.rule}. Quindi dopo ${last} viene ${correct}.`,
    allowNegative: s.allowNegative,
  };
}

// ---------------------------------------------------------------------------
// Struttura: "?" in mezzo alla serie
// ---------------------------------------------------------------------------

function middleSeries(rng: Rng, s: RuleSeq): Built {
  const v = s.vals;
  const n = v.length;
  if (n < 5) throw new Error('serie troppo corta per il buco in mezzo');
  const p = randInt(rng, 1, Math.min(3, n - 3));
  assertUnique(v, p);
  const correct = v[p];
  const floor = floorOf(v, s.allowNegative);
  // errori tipici di chi guarda solo i vicini invece della regola
  const prefer: number[] = [];
  if (p >= 2) prefer.push(v[p - 1] + (v[p - 1] - v[p - 2])); // ripete il salto precedente
  if (p + 2 <= n - 1) prefer.push(v[p + 1] - (v[p + 2] - v[p + 1])); // usa il salto successivo, all'indietro
  prefer.push(Math.round((v[p - 1] + v[p + 1]) / 2)); // media dei due vicini
  // Quando la risposta sta FRA i due vicini, i distrattori devono starci anche
  // loro: un numero fuori da quell'intervallo si scarta a occhio, senza capire
  // la regola. Se lo spazio non basta per due errori per parte si rigenera.
  const between = (correct - v[p - 1]) * (correct - v[p + 1]) < 0;
  const lo = between ? Math.min(v[p - 1], v[p + 1]) : -Infinity;
  const hi = between ? Math.max(v[p - 1], v[p + 1]) : Infinity;
  return {
    seq: [...v.slice(0, p), '?', ...v.slice(p + 1)],
    prompt: 'Quale numero manca?',
    correct,
    distractors: balancedTwo(rng, correct, prefer, slips(correct), { floor, avoid: v, lo, hi }),
    explanation: `Regola: ${s.rule}. Al posto del «?» va ${correct}, perché la serie completa è ${v.join(', ')}.`,
    allowNegative: s.allowNegative,
  };
}

// ---------------------------------------------------------------------------
// Struttura: coppie "a b | a b | a b | a ?" (la regola sta dentro la coppia)
// ---------------------------------------------------------------------------

interface PairRule {
  f: (a: number) => number;
  /** "il secondo numero è il quadrato del primo" */
  text: string;
  /** "5 × 5 = 25" */
  calc: (a: number) => string;
  /** errori tipici su un dato primo elemento */
  wrong: (a: number, prevA: number, prevB: number) => number[];
  /** valore massimo ammesso per il primo elemento */
  amax: number;
}

function pairRulesD1(rng: Rng): PairRule {
  if (chance(rng, 0.55)) {
    const k = randInt(rng, 3, 12);
    return {
      f: (a) => a + k,
      text: `il secondo numero è il primo più ${k}`,
      calc: (a) => `${a} + ${k} = ${a + k}`,
      // continua la serie dei secondi numeri; raddoppia invece di sommare;
      // somma il primo numero a sé stesso; toglie k invece di aggiungerlo
      wrong: (a, _pa, pb) => [pb + k, a * 2, a + a, a - k],
      amax: 40,
    };
  }
  const k = randInt(rng, 2, 4);
  return {
    f: (a) => a * k,
    text: `il secondo numero è il primo moltiplicato per ${k}`,
    calc: (a) => `${a} × ${k} = ${a * k}`,
    // somma invece di moltiplicare; continua la serie dei secondi numeri;
    // moltiplica per il numero sbagliato (uno in più, uno in meno)
    wrong: (a, _pa, pb) => [a + k, pb + k, a * (k + 1), a * (k - 1)],
    amax: 30,
  };
}

function pairRulesD2(rng: Rng): PairRule {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) {
    return {
      f: (a) => a * a,
      text: 'il secondo numero è il quadrato del primo',
      calc: (a) => `${a} × ${a} = ${a * a}`,
      // raddoppia invece di elevare al quadrato; quadrato del numero dopo;
      // quadrato del numero prima
      wrong: (a) => [a * 2, (a + 1) * (a + 1), (a - 1) * (a - 1)],
      amax: 15,
    };
  }
  if (kind === 1) {
    return {
      f: (a) => a * (a + 1),
      text: 'il secondo numero è il primo moltiplicato per il numero successivo',
      calc: (a) => `${a} × ${a + 1} = ${a * (a + 1)}`,
      // quadrato invece del prodotto; somma invece di prodotto; parte dal
      // numero successivo
      wrong: (a) => [a * a, 2 * a + 1, (a + 1) * (a + 2), (a - 1) * a],
      amax: 14,
    };
  }
  const k = randInt(rng, 2, 5);
  const m = randInt(rng, 1, 9);
  return {
    f: (a) => k * a + m,
    text: `il secondo numero è il primo moltiplicato per ${k} e poi aumentato di ${m}`,
    calc: (a) => `${a} × ${k} + ${m} = ${k * a + m}`,
    // dimentica il «+ m»; somma m prima di moltiplicare; somma tutto
    wrong: (a) => [k * a, k * (a + m), a + k + m, k * a + m + k],
    amax: 25,
  };
}

function pairRulesD3(rng: Rng): PairRule {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) {
    return {
      f: (a) => a * a * a,
      text: 'il secondo numero è il cubo del primo',
      calc: (a) => `${a} × ${a} × ${a} = ${a * a * a}`,
      // si ferma al quadrato; moltiplica per 3; cubo del numero dopo o di quello prima
      wrong: (a) => [a * a, a * 3, (a + 1) * (a + 1) * (a + 1), (a - 1) * (a - 1) * (a - 1)],
      amax: 7,
    };
  }
  if (kind === 1) {
    const m = randInt(rng, 1, 9);
    return {
      f: (a) => a * a + m,
      text: `il secondo numero è il quadrato del primo più ${m}`,
      calc: (a) => `${a} × ${a} + ${m} = ${a * a + m}`,
      // dimentica il «+ m»; usa il quadrato del numero dopo; raddoppia invece
      // di elevare al quadrato; somma m due volte
      wrong: (a) => [a * a, (a + 1) * (a + 1) + m, a * 2 + m, a * a + 2 * m],
      amax: 15,
    };
  }
  return {
    f: (a) => a * (a - 1),
    text: 'il secondo numero è il primo moltiplicato per il numero che lo precede',
    calc: (a) => `${a} × ${a - 1} = ${a * (a - 1)}`,
    // quadrato invece del prodotto; moltiplica per il successivo; scala tutto
    // di uno; somma invece di moltiplicare
    wrong: (a) => [a * a, a * (a + 1), (a - 1) * (a - 2), 2 * a - 1],
    amax: 16,
  };
}

function pairsFamily(rng: Rng, rule: PairRule, holeAtEnd: boolean): Built {
  const g = randInt(rng, 3, 4); // coppie oltre a quella incompleta
  const sa = randInt(rng, 1, 3);
  const top = rule.amax - g * sa;
  if (top < 2) throw new Error('coppie fuori range');
  const a0 = randInt(rng, 2, top);
  const as = Array.from({ length: g + 1 }, (_, i) => a0 + i * sa);
  const bs = as.map(rule.f);
  const hole = holeAtEnd ? g : randInt(rng, 1, g - 1);
  const correct = bs[hole];

  // unicità: nessun'altra regola semplice (in a oppure nella posizione) regge
  const known = as.map((a, i) => ({ a, b: bs[i], i })).filter((c) => c.i !== hole);
  for (const deg of [1, 2]) {
    const byA = polyPredict(known.map((c) => ({ x: c.a, y: c.b })), deg, as[hole]);
    if (byA !== null && byA !== correct) throw new Error('coppie ambigue');
    const byI = polyPredict(known.map((c) => ({ x: c.i, y: c.b })), deg, hole);
    if (byI !== null && byI !== correct) throw new Error('coppie ambigue');
  }
  // unicità anche leggendo tutti i numeri di fila
  const flat: number[] = [];
  for (let i = 0; i <= g; i++) flat.push(as[i], bs[i]);
  assertUnique(flat, 2 * hole + 1);

  const seq: (number | string)[] = [];
  for (let i = 0; i <= g; i++) {
    if (i > 0) seq.push('|');
    seq.push(as[i], i === hole ? '?' : bs[i]);
  }
  const prevA = as[hole === 0 ? 1 : hole - 1];
  const prevB = bs[hole === 0 ? 1 : hole - 1];
  return {
    seq,
    prompt: holeAtEnd ? "Quale numero completa l'ultima coppia?" : 'Quale numero manca?',
    correct,
    distractors: balancedTwo(rng, correct, rule.wrong(as[hole], prevA, prevB), slips(correct), {
      avoid: bs, // gli altri secondi numeri sono già sotto gli occhi
    }),
    explanation:
      `I numeri vanno letti a coppie: in ogni coppia ${rule.text} ` +
      `(${as[0]} → ${bs[0]}, ${as[1]} → ${bs[1]}). Quindi accanto a ${as[hole]} va ${rule.calc(as[hole])}.`,
    max: 999,
  };
}

// ---------------------------------------------------------------------------
// Struttura: gruppi di tre "a b c | a b c | a b ?" (il terzo nasce dai primi due)
// ---------------------------------------------------------------------------

interface TriRule {
  f: (a: number, b: number) => number;
  text: string;
  calc: (a: number, b: number) => string;
}

const TRI_RULES: TriRule[] = [
  { f: (a, b) => a + b, text: 'il terzo numero è la somma dei primi due', calc: (a, b) => `${a} + ${b} = ${a + b}` },
  { f: (a, b) => a * b, text: 'il terzo numero è il prodotto dei primi due', calc: (a, b) => `${a} × ${b} = ${a * b}` },
  {
    f: (a, b) => a * b + a,
    text: 'il terzo numero è il prodotto dei primi due, più il primo',
    calc: (a, b) => `${a} × ${b} + ${a} = ${a * b + a}`,
  },
  {
    f: (a, b) => a * b - b,
    text: 'il terzo numero è il prodotto dei primi due, meno il secondo',
    calc: (a, b) => `${a} × ${b} − ${b} = ${a * b - b}`,
  },
  {
    f: (a, b) => 2 * a + b,
    text: 'il terzo numero è il doppio del primo più il secondo',
    calc: (a, b) => `${a} × 2 + ${b} = ${2 * a + b}`,
  },
  {
    f: (a, b) => (a + b) * 2,
    text: 'il terzo numero è il doppio della somma dei primi due',
    calc: (a, b) => `(${a} + ${b}) × 2 = ${(a + b) * 2}`,
  },
  {
    f: (a, b) => b * b - a,
    text: 'il terzo numero è il quadrato del secondo meno il primo',
    calc: (a, b) => `${b} × ${b} − ${a} = ${b * b - a}`,
  },
];

function triFamily(rng: Rng): Built {
  const rule = pick(rng, TRI_RULES);
  const g = 3; // gruppi completi
  const as: number[] = [];
  const bs: number[] = [];
  for (let i = 0; i <= g; i++) {
    as.push(randInt(rng, 2, 9));
    bs.push(randInt(rng, 2, 9));
  }
  // gruppi tutti diversi: se una coppia si ripetesse, la risposta sarebbe già scritta
  if (new Set(as.map((a, i) => `${a}-${bs[i]}`)).size !== g + 1) throw new Error('gruppi ripetuti');
  const cs = as.map((a, i) => rule.f(a, bs[i]));
  if (cs.some((c) => c < 2 || c > 400)) throw new Error('gruppi fuori range');
  const correct = cs[g];

  // unicità: nessun'altra regola del catalogo spiega tutti i gruppi completi
  for (const alt of TRI_RULES) {
    if (alt === rule) continue;
    const fits = as.slice(0, g).every((a, i) => alt.f(a, bs[i]) === cs[i]);
    if (fits && alt.f(as[g], bs[g]) !== correct) throw new Error('gruppi ambigui');
  }
  // e nemmeno una regola che guarda solo la posizione del gruppo
  for (const deg of [1, 2]) {
    const byI = polyPredict(cs.slice(0, g).map((c, i) => ({ x: i, y: c })), deg, g);
    if (byI !== null && byI !== correct) throw new Error('gruppi ambigui');
  }

  const seq: (number | string)[] = [];
  for (let i = 0; i <= g; i++) {
    if (i > 0) seq.push('|');
    seq.push(as[i], bs[i]);
    seq.push(i === g ? '?' : cs[i]);
  }
  // distrattori: il risultato di un'altra regola plausibile del catalogo
  const prefer = TRI_RULES.filter((r) => r !== rule).map((r) => r.f(as[g], bs[g]));
  return {
    seq,
    prompt: "Quale numero completa l'ultimo gruppo?",
    correct,
    distractors: balancedTwo(rng, correct, prefer, slips(correct), { avoid: cs }),
    explanation:
      `I numeri vanno letti a gruppi di tre: ${rule.text} ` +
      `(${rule.calc(as[0], bs[0])}; ${rule.calc(as[1], bs[1])}). Quindi ${rule.calc(as[g], bs[g])}.`,
  };
}

// ---------------------------------------------------------------------------
// Struttura: due righe parallele "a a a | b b ?"
// ---------------------------------------------------------------------------

/** due righe con la STESSA regola e inizi diversi */
function twoRowsSameRule(rng: Rng, difficulty: Difficulty): { r1: number[]; r2: number[]; rule: string } {
  const n = randInt(rng, 3, 4);
  if (difficulty === 1) {
    if (chance(rng, 0.6)) {
      const k = randInt(rng, 2, 12);
      const s1 = randInt(rng, 1, 30);
      const s2 = s1 + randInt(rng, 1, 20);
      return {
        r1: Array.from({ length: n }, (_, i) => s1 + i * k),
        r2: Array.from({ length: n }, (_, i) => s2 + i * k),
        rule: `in ogni riga si aggiunge ${k} a ogni passo`,
      };
    }
    const r = pick(rng, [2, 3]);
    const s1 = randInt(rng, 2, r === 2 ? 12 : 5);
    const s2 = s1 + randInt(rng, 1, 6);
    return {
      r1: Array.from({ length: n }, (_, i) => s1 * r ** i),
      r2: Array.from({ length: n }, (_, i) => s2 * r ** i),
      rule: `in ogni riga ogni numero è il ${r === 2 ? 'doppio' : 'triplo'} del precedente`,
    };
  }
  if (difficulty === 2) {
    if (chance(rng, 0.5)) {
      const d0 = randInt(rng, 1, 5);
      const s1 = randInt(rng, 1, 20);
      const s2 = s1 + randInt(rng, 1, 15);
      const mk = (s: number) => {
        const v = [s];
        for (let i = 0; i < n - 1; i++) v.push(v[i] + d0 + i);
        return v;
      };
      return { r1: mk(s1), r2: mk(s2), rule: `in ogni riga i salti crescono di 1 (+${d0}, +${d0 + 1}, +${d0 + 2}, …)` };
    }
    const p = randInt(rng, 3, 9);
    const mk = (s: number) => {
      const v = [s];
      for (let i = 0; i < n - 1; i++) v.push(i % 2 === 0 ? v[i] + p : v[i] * 2);
      return v;
    };
    const s1 = randInt(rng, 1, 9);
    const s2 = s1 + randInt(rng, 1, 9);
    return { r1: mk(s1), r2: mk(s2), rule: `in ogni riga si alternano «+${p}» e «×2»` };
  }
  if (chance(rng, 0.5)) {
    const mk = (a: number, b: number) => {
      const v = [a, b];
      while (v.length < n) v.push(v[v.length - 1] + v[v.length - 2]);
      return v;
    };
    const a1 = randInt(rng, 1, 9);
    const b1 = a1 + randInt(rng, 1, 8);
    const a2 = a1 + randInt(rng, 1, 6);
    const b2 = b1 + randInt(rng, 1, 9);
    return { r1: mk(a1, b1), r2: mk(a2, b2), rule: 'in ogni riga ogni numero è la somma dei due precedenti' };
  }
  const d0 = randInt(rng, 2, 6);
  const c = randInt(rng, 2, 4);
  const mk = (s: number) => {
    const v = [s];
    for (let i = 0; i < n - 1; i++) v.push(v[i] + d0 + i * c);
    return v;
  };
  const s1 = randInt(rng, 1, 25);
  const s2 = s1 + randInt(rng, 1, 20);
  return { r1: mk(s1), r2: mk(s2), rule: `in ogni riga i salti aumentano di ${c} (+${d0}, +${d0 + c}, +${d0 + 2 * c}, …)` };
}

function parallelSame(rng: Rng, difficulty: Difficulty): Built {
  const { r1, r2, rule } = twoRowsSameRule(rng, difficulty);
  const n = r2.length;
  const hole = chance(rng, 0.65) ? n - 1 : randInt(rng, 1, n - 2);
  if (r1.length !== n) throw new Error('righe di lunghezza diversa');
  if (new Set([...r1, ...r2]).size < r1.length + n - 1) throw new Error('righe troppo simili');
  assertUnique(r2, hole);
  const correct = r2[hole];
  const seq: (number | string)[] = [...r1, '|', ...r2.map((x, i) => (i === hole ? '?' : x))];
  // errori tipici: copiare il numero sopra; portare giù il SALTO della riga
  // sopra (sbagliato quando i salti non sono uguali, come nelle righe ×2);
  // ripetere il proprio salto precedente; fare la media dei vicini
  const prefer = [r1[hole], r2[hole - 1] + (r1[hole] - r1[hole - 1])];
  if (hole >= 2) prefer.push(r2[hole - 1] + (r2[hole - 1] - r2[hole - 2]));
  if (hole + 1 < n) prefer.push(Math.round((r2[hole - 1] + r2[hole + 1]) / 2));
  return {
    seq,
    prompt: 'Quale numero completa la seconda riga?',
    correct,
    distractors: balancedTwo(rng, correct, prefer, slips(correct), { avoid: r2 }),
    explanation:
      `Le due righe (separate dal «|») seguono la stessa regola: ${rule}. ` +
      `La prima riga lo mostra: ${r1.join(', ')}. Nella seconda, al posto del «?» va ${correct}: ${r2.join(', ')}.`,
    max: 999,
  };
}

/** riga di sotto ottenuta da quella di sopra, numero per numero */
function parallelMap(rng: Rng, rule: PairRule): Built {
  const cols = randInt(rng, 3, 4);
  const as: number[] = [];
  let a = randInt(rng, 2, 5);
  for (let i = 0; i <= cols; i++) {
    as.push(a);
    a += randInt(rng, 1, 4);
  }
  if (as[cols] > rule.amax) throw new Error('mappa fuori range');
  const bs = as.map(rule.f);
  const hole = chance(rng, 0.7) ? cols : randInt(rng, 1, cols - 1);
  const correct = bs[hole];

  const known = as.map((x, i) => ({ x, y: bs[i], i })).filter((c) => c.i !== hole);
  for (const deg of [1, 2]) {
    const byA = polyPredict(known.map((c) => ({ x: c.x, y: c.y })), deg, as[hole]);
    if (byA !== null && byA !== correct) throw new Error('mappa ambigua');
  }
  assertUnique(bs, hole);

  const seq: (number | string)[] = [...as, '|', ...bs.map((b, i) => (i === hole ? '?' : b))];
  const prevA = as[hole === 0 ? 1 : hole - 1];
  const prevB = bs[hole === 0 ? 1 : hole - 1];
  // agli errori della regola si aggiunge chi ricopia il numero di sopra
  const prefer = [...rule.wrong(as[hole], prevA, prevB), as[hole]];
  return {
    seq,
    prompt: 'Quale numero completa la seconda riga?',
    correct,
    distractors: balancedTwo(rng, correct, prefer, slips(correct), { avoid: bs }),
    explanation:
      `Ogni numero della seconda riga si ottiene da quello che sta sopra: ${rule.text} ` +
      `(${as[0]} → ${bs[0]}, ${as[1]} → ${bs[1]}, ${as[2]} → ${bs[2]}). Sotto ${as[hole]} va ${rule.calc(as[hole])}.`,
    max: 999,
  };
}

// ---------------------------------------------------------------------------
// Struttura: intruso ("quale numero NON segue la regola?")
// ---------------------------------------------------------------------------

/** categorie "sensate": quelle con cui un umano descriverebbe un gruppo di numeri */
const CATEGORIES: ((x: number) => boolean)[] = [
  (x) => x % 2 === 1,
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((k) => (x: number) => x % k === 0),
  isSquare,
  isCube,
  isPrime,
  ...Array.from({ length: 27 }, (_, i) => (x: number) => dsum(x) === i + 1),
  ...Array.from({ length: 10 }, (_, i) => (x: number) => x % 10 === i),
  ...[1, 2, 3].map((L) => (x: number) => String(x).length === L),
];

/**
 * L'intruso deve essere UNICO: nessun'altra categoria (né la lettura "serie
 * con passo costante") deve indicare un numero diverso.
 */
function assertOnlyIntruder(nums: number[], badIdx: number) {
  for (const cat of CATEGORIES) {
    const out = nums.map((x, i) => (cat(x) ? -1 : i)).filter((i) => i >= 0);
    if (out.length === 1 && out[0] !== badIdx) throw new Error('intruso ambiguo');
  }
  // "togliendo un numero il resto ha passo costante": deve valere solo per l'intruso
  for (let j = 0; j < nums.length; j++) {
    if (j === badIdx) continue;
    const pts = nums.map((y, i) => ({ x: i, y })).filter((p) => p.x !== j);
    if (fitsPoly(pts, 1)) throw new Error('intruso ambiguo');
  }
}

function intruderFamily(rng: Rng, difficulty: Difficulty): Built {
  const n = randInt(rng, 5, 7);
  let nums: number[] = [];
  let label = '';
  let why = '';
  let bad = 0;

  const kind = difficulty === 1 ? randInt(rng, 0, 2) : difficulty === 2 ? randInt(rng, 3, 5) : randInt(rng, 6, 8);
  if (kind === 0 || kind === 3) {
    // multipli di k
    const k = difficulty === 1 ? randInt(rng, 3, 9) : randInt(rng, 6, 12);
    const m0 = randInt(rng, 2, 6);
    const step = chance(rng, 0.5) ? 1 : randInt(rng, 1, 2);
    nums = Array.from({ length: n }, (_, i) => (m0 + i * step) * k);
    bad = randInt(rng, 0, n - 1);
    nums[bad] += pick(rng, [-2, -1, 1, 2]);
    label = `multipli di ${k}`;
    why = `${nums[bad]} non si può dividere per ${k}`;
  } else if (kind === 1) {
    // numeri pari (o dispari)
    const even = chance(rng, 0.5);
    let x = randInt(rng, 2, 20) * 2 + (even ? 0 : 1);
    nums = [];
    for (let i = 0; i < n; i++) {
      nums.push(x);
      x += 2 * randInt(rng, 1, 4);
    }
    bad = randInt(rng, 0, n - 1);
    nums[bad] += 1;
    label = even ? 'numeri pari' : 'numeri dispari';
    why = `${nums[bad]} è ${even ? 'dispari' : 'pari'}`;
  } else if (kind === 2) {
    // numeri che finiscono per 0 o 5
    let x = randInt(rng, 1, 8) * 5;
    nums = [];
    for (let i = 0; i < n; i++) {
      nums.push(x);
      x += 5 * randInt(rng, 1, 3);
    }
    bad = randInt(rng, 0, n - 1);
    nums[bad] += pick(rng, [-2, -1, 1, 2]);
    label = 'numeri che finiscono per 0 o per 5 (la tabellina del 5)';
    why = `${nums[bad]} non finisce né per 0 né per 5`;
  } else if (kind === 4 || kind === 7) {
    // quadrati perfetti
    const m0 = randInt(rng, 2, 4);
    const step = chance(rng, 0.6) ? 1 : 2;
    const ms = Array.from({ length: n }, (_, i) => m0 + i * step);
    nums = ms.map((m) => m * m);
    if (nums[n - 1] > 400) throw new Error('quadrati troppo grandi');
    bad = randInt(rng, 0, n - 1);
    nums[bad] += pick(rng, [-2, -1, 1, 2, 3]);
    label = 'quadrati perfetti (1, 4, 9, 16, 25, …)';
    why = `${nums[bad]} non è il quadrato di nessun numero intero`;
  } else if (kind === 5) {
    // stessa somma delle cifre
    const s = randInt(rng, 6, 12);
    const pool: number[] = [];
    for (let x = 10; x <= 99; x++) if (dsum(x) === s) pool.push(x);
    if (pool.length < n) throw new Error('pochi numeri con questa somma');
    nums = shuffle(rng, [...pool]).slice(0, n).sort((p, q) => p - q);
    bad = randInt(rng, 0, n - 1);
    nums[bad] += pick(rng, [-1, 1, 2]);
    label = `numeri le cui cifre sommate danno ${s} (per esempio ${nums[bad === 0 ? 1 : 0]}: ${digitsOf(nums[bad === 0 ? 1 : 0]).join('+')} = ${s})`;
    why = `le cifre di ${nums[bad]} danno ${dsum(nums[bad])}`;
  } else if (kind === 6) {
    // numeri primi
    const start = randInt(rng, 1, 12);
    nums = PRIMES.slice(start, start + n);
    bad = randInt(rng, 0, n - 1);
    nums[bad] += pick(rng, [-2, 2, 4]);
    if (isPrime(nums[bad])) throw new Error('intruso ancora primo');
    label = 'numeri primi (si dividono solo per 1 e per sé stessi)';
    const div = [2, 3, 5, 7, 11, 13].find((d) => nums[bad] % d === 0 && nums[bad] !== d);
    why = `${nums[bad]} si può dividere per ${div}`;
  } else {
    // cubi perfetti
    const m0 = randInt(rng, 1, 2);
    const ms = Array.from({ length: Math.min(n, 5) }, (_, i) => m0 + i);
    nums = ms.map((m) => m ** 3);
    bad = randInt(rng, 0, nums.length - 1);
    nums[bad] += pick(rng, [-2, -1, 1, 2]);
    label = 'cubi perfetti (1, 8, 27, 64, …)';
    why = `${nums[bad]} non è il cubo di nessun numero intero`;
  }

  if (nums.some((x, i) => x <= 0 || (i > 0 && x <= nums[i - 1]))) throw new Error('intruso mal posizionato');
  if (new Set(nums).size !== nums.length) throw new Error('numeri ripetuti');
  assertOnlyIntruder(nums, bad);

  const correct = nums[bad];
  // Qui i distrattori DEVONO essere altri numeri della fila (la domanda chiede
  // di indicarne uno). Si preferiscono i vicini dell'intruso — è lì che il
  // "salto strano" si vede — ma presi ora da sopra, ora da sotto, ora da tutt'e
  // due i lati: se fossero sempre uno prima e uno dopo, l'intruso sarebbe
  // sempre il numero di mezzo.
  const defined = (x: number | undefined): x is number => x !== undefined;
  const near = [nums[bad - 1], nums[bad + 1], nums[bad - 2], nums[bad + 2]].filter(defined);
  const rest = nums.filter((_, i) => i !== bad);
  return {
    seq: [...nums],
    prompt: 'Quale numero NON segue la regola?',
    correct,
    distractors: balancedTwo(rng, correct, near, rest),
    explanation: `Tutti i numeri sono ${label}, tranne uno: ${why}. L'intruso è ${correct}.`,
    max: 999,
  };
}

// ---------------------------------------------------------------------------
// Famiglie storiche con il "?" in fondo (distrattori su misura della regola)
// ---------------------------------------------------------------------------

interface EndBuilt {
  visible: number[];
  correct: number;
  /** errori tipici della regola, dal più istruttivo in giù (non due soli: servono
   *  candidati sopra E sotto la risposta, altrimenti la posizione è prevedibile) */
  prefer: number[];
  explanation: string;
}

function fromEndBuilt(rng: Rng, b: EndBuilt): Built {
  assertUnique([...b.visible, b.correct], b.visible.length);
  return {
    seq: [...b.visible, '?'],
    prompt: 'Quale numero continua la serie?',
    correct: b.correct,
    distractors: balancedTwo(rng, b.correct, b.prefer, slips(b.correct), {
      floor: floorOf([...b.visible, b.correct]),
      avoid: b.visible,
    }),
    explanation: b.explanation,
  };
}

function legacyD1(rng: Rng): Built {
  const kind = randInt(rng, 0, 2);
  if (kind === 0) {
    // aritmetica: +k
    const k = randInt(rng, 2, 9);
    const s = randInt(rng, 1, 40);
    const n = randInt(rng, 5, 6);
    const visible = Array.from({ length: n }, (_, i) => s + i * k);
    const last = visible[n - 1];
    const correct = last + k;
    return fromEndBuilt(rng, {
      visible,
      correct,
      // applica +k due volte (un passo di troppo); aggiunge k−1 invece di k
      prefer: [last + 2 * k, correct - 1],
      explanation: `Regola: si aggiunge sempre ${k} (${visible[0]} + ${k} = ${visible[1]}, e così via); quindi ${last} + ${k} = ${correct}.`,
    });
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // ripete l'ultima differenza invece di moltiplicare; somma r invece di
      // moltiplicare; moltiplica per il numero sbagliato (r+1); moltiplica due volte
      prefer: [last + (last - prev), last + r, last * (r + 1), correct * r],
      explanation: `Regola: ogni numero è il ${r === 2 ? 'doppio' : 'triplo'} del precedente; quindi ${last} × ${r} = ${correct}.`,
    });
  }
  // countdown: −k
  const k = randInt(rng, 2, 9);
  const n = randInt(rng, 5, 6);
  // la risposta non scende sotto il 5: più in basso non ci sono due numeri più
  // piccoli credibili e la risposta finirebbe sempre a fare la minima
  const correct = randInt(rng, Math.max(k, 5), 30);
  const visible = Array.from({ length: n }, (_, i) => correct + (n - i) * k);
  const last = visible[n - 1];
  return fromEndBuilt(rng, {
    visible,
    correct,
    // toglie 2k (un passo di troppo); toglie k−1 invece di k
    prefer: [last - 2 * k, correct + 1],
    explanation: `Regola: si toglie sempre ${k} (${visible[0]} − ${k} = ${visible[1]}, e così via); quindi ${last} − ${k} = ${correct}.`,
  });
}

function legacyD2(rng: Rng): Built {
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // ripete l'ultimo salto senza farlo crescere; lo fa crescere di 2 invece
      // che di 1; salta un passo (fa crescere il salto due volte)
      prefer: [correct - 1, correct + 1, correct + step + 1],
      explanation: `Regola: i salti crescono di 1 a ogni passo (+${d0}, +${d0 + 1}, +${d0 + 2}, …); l'ultimo salto è +${step}; quindi ${last} + ${step} = ${correct}.`,
    });
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
    // operazione sbagliata dell'alternanza; applica tutt'e due le operazioni;
    // usa il 2 del «×2» come addendo
    const prefer = nextAdd
      ? [last * q, last * q + p, last + q, correct + p]
      : [last + p, last * q + p, last * q - p];
    return fromEndBuilt(rng, {
      visible,
      correct,
      prefer,
      explanation: `Regola: la serie alterna «+${p}» e «×${q}». Dopo «${nextAdd ? `×${q}` : `+${p}`}» tocca a «${nextAdd ? `+${p}` : `×${q}`}»: ${last} ${nextAdd ? `+ ${p}` : `× ${q}`} = ${correct}.`,
    });
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // ripete l'ultima differenza (il salto dispari precedente); usa il salto
      // dispari successivo; salta un quadrato; raddoppia l'ultimo numero
      prefer: [last + (last - prev), correct + 2, (M + 2) ** 2, last * 2],
      explanation: `Regola: sono i quadrati di numeri consecutivi (${m0}² = ${m0 ** 2}, ${m0 + 1}² = ${(m0 + 1) ** 2}, …); il prossimo è ${M + 1}² = ${correct}.`,
    });
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
  return fromEndBuilt(rng, {
    visible,
    correct,
    // ripete l'ultima differenza; continua le seconde differenze come costanti;
    // salta un cubo; si ferma al quadrato invece del cubo
    prefer: [last + lastDiff, last + lastDiff + lastSd, (M + 2) ** 3, (M + 1) ** 2],
    explanation: `Regola: sono i cubi di numeri consecutivi (${m0}³ = ${m0 ** 3}, ${m0 + 1}³ = ${(m0 + 1) ** 3}, …); il prossimo è ${M + 1}³ = ${correct}.`,
  });
}

function legacyD3(rng: Rng): Built {
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // continua la serie sbagliata (B); usa il passo di B sulla serie A;
      // continua l'ultimo numero visibile invece della serie A; salta un posto
      prefer: [b[2] + stepB, a[2] + stepB, b[2] + da, correct + da],
      explanation: `Regola: due serie si alternano: il 1º, 3º e 5º numero (${a[0]}, ${a[1]}, ${a[2]}) crescono di ${da}; il 2º, 4º e 6º (${b[0]}, ${b[1]}, ${b[2]}) ${desc ? 'calano' : 'crescono'} di ${db}. Il «?» continua la prima serie: ${a[2]} + ${da} = ${correct}.`,
    });
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // ripete l'ultima differenza; raddoppia invece di sommare i due
      // precedenti; somma la coppia sbagliata (l'ultimo con il terzultimo);
      // fa un passo di troppo
      prefer: [2 * last - prev, 2 * last, last + visible[n - 3], correct + last],
      explanation: `Regola: ogni numero è la somma dei due precedenti (${visible[0]} + ${visible[1]} = ${visible[2]}, …); quindi ${prev} + ${last} = ${correct}.`,
    });
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
    return fromEndBuilt(rng, {
      visible,
      correct,
      // ripete l'ultimo salto (senza accelerare); accelera due volte; salta un
      // passo; accelera di 1 invece che di c
      prefer: [correct - c, correct + c, correct + step + c, correct - c + 1],
      explanation: `Regola: i salti aumentano di ${c} a ogni passo (+${d0}, +${d0 + c}, +${d0 + 2 * c}, …); l'ultimo salto è +${step}; quindi ${last} + ${step} = ${correct}.`,
    });
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
  return fromEndBuilt(rng, {
    visible,
    correct,
    // dimentica il ±b (raddoppia soltanto); continua con l'ultima differenza;
    // sbaglia il segno del b; fa un passo di troppo
    prefer: [last * 2, last + (last - prev), last * 2 - b, correct * 2 + b],
    explanation: `Regola: ogni numero è il doppio del precedente ${b > 0 ? `più ${b}` : `meno ${ab}`} (${visible[0]} × 2 ${sign} ${ab} = ${visible[1]}); quindi ${last} × 2 ${sign} ${ab} = ${correct}.`,
  });
}

// ---------------------------------------------------------------------------
// Scelta della famiglia per difficoltà
// ---------------------------------------------------------------------------

function buildD1(rng: Rng): Built {
  switch (randInt(rng, 0, 11)) {
    case 0:
    case 1:
      return legacyD1(rng);
    case 2:
      return middleSeries(rng, rArith(rng));
    case 3:
      return middleSeries(rng, rArithDown(rng));
    case 4:
      return middleSeries(rng, rGeom(rng));
    case 5:
      return endSeries(rng, rGeomDown(rng));
    case 6:
      return pairsFamily(rng, pairRulesD1(rng), true);
    case 7:
      return pairsFamily(rng, pairRulesD1(rng), false);
    case 8:
      return intruderFamily(rng, 1);
    case 9:
      return parallelSame(rng, 1);
    case 10:
      return parallelMap(rng, pairRulesD1(rng));
    default:
      return endSeries(rng, chance(rng, 0.5) ? rArith(rng) : rArithDown(rng));
  }
}

function buildD2(rng: Rng): Built {
  switch (randInt(rng, 0, 12)) {
    case 0:
      return legacyD2(rng);
    case 1:
      return middleSeries(rng, rGrow(rng));
    case 2:
      return middleSeries(rng, rAltOps(rng));
    case 3:
      return middleSeries(rng, rSquares(rng));
    case 4:
      return middleSeries(rng, rZigzag(rng));
    case 5:
      return endSeries(rng, rZigzag(rng));
    case 6:
      return endSeries(rng, rDigitSum(rng));
    case 7:
      return endSeries(rng, rGeomDown(rng));
    case 8:
      return endSeries(rng, chance(rng, 0.5) ? rSquares(rng) : rCubes(rng));
    case 9:
      return pairsFamily(rng, pairRulesD2(rng), chance(rng, 0.65));
    case 10:
      return intruderFamily(rng, 2);
    case 11:
      return parallelSame(rng, 2);
    default:
      return parallelMap(rng, pairRulesD2(rng));
  }
}

function buildD3(rng: Rng): Built {
  switch (randInt(rng, 0, 14)) {
    case 0:
    case 1:
      return legacyD3(rng);
    case 2:
      return middleSeries(rng, rFib(rng));
    case 3:
      return middleSeries(rng, rAccel(rng));
    case 4:
      return middleSeries(rng, rInter(rng));
    case 5:
      return middleSeries(rng, rAffine(rng));
    case 6:
      return endSeries(rng, rDigitProd(rng));
    case 7:
      return endSeries(rng, rPeriod3(rng));
    case 8:
      return endSeries(rng, rPrimes(rng));
    case 9:
      return endSeries(rng, chance(rng, 0.5) ? rDownZero(rng) : rDownAccel(rng));
    case 10:
      return middleSeries(rng, rDownAccel(rng));
    case 11:
      return pairsFamily(rng, pairRulesD3(rng), chance(rng, 0.65));
    case 12:
      return triFamily(rng);
    case 13:
      return intruderFamily(rng, 3);
    default:
      return chance(rng, 0.5) ? parallelSame(rng, 3) : parallelMap(rng, pairRulesD3(rng));
  }
}

// ---------------------------------------------------------------------------

export function genNumseries(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    const built = difficulty === 1 ? buildD1(rng) : difficulty === 2 ? buildD2(rng) : buildD3(rng);
    const lim = built.max ?? MAX;
    const floor = built.allowNegative ? -200 : 0;
    const shown = built.seq.filter((x): x is number => typeof x === 'number');
    // sanità: interi, dentro i limiti, risposta unica fra le tre opzioni
    if ([...shown, built.correct].some((x) => !Number.isInteger(x) || x < floor || x > lim)) {
      throw new Error('serie fuori range');
    }
    const [w0, w1] = built.distractors;
    if ([w0, w1].some((x) => !Number.isInteger(x) || x < floor)) throw new Error('distrattore fuori range');
    if (w0 === built.correct || w1 === built.correct || w0 === w1) throw new Error('opzioni non distinte');
    const [a, b] = chance(rng, 0.5) ? [w0, w1] : [w1, w0];
    const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(built.correct) }, [
      { kind: 'text', text: String(a) },
      { kind: 'text', text: String(b) },
    ]);
    return {
      qtype: 'numseries' as const,
      difficulty,
      prompt: built.prompt,
      payload: { kind: 'numbers' as const, seq: built.seq },
      choices,
      correctIndex,
      explanation: built.explanation,
    };
  }, 60);
}
