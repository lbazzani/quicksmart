// Generatore "balance": bilance logiche a due piatti con pesi interi coerenti.
// Difficoltà 1: una bilancia in equilibrio, letta in due direzioni — "quanti
// triangoli pesano quanto UN cerchio?" (divisione) oppure "quanti triangoli
// pesano quanto 3 cerchi?" (moltiplicazione). 2: due bilance transitive
// (A>B, B>C) → "quale forma è la più pesante?". 3: 2-3 equivalenze in catena da
// combinare (2 cerchi = 3 triangoli; 1 triangolo = 2 quadrati) con divisione
// finale. I pesi sono assegnati internamente e i tilt DERIVATI dai pesi.
//
// Distrattori: errori di conto tipici (dimenticare di dividere, fermarsi a metà
// catena, sommare invece di moltiplicare, sottrarre invece di dividere,
// off-by-one, leggere il numero sbagliato sulla bilancia). Mai a caso.
//
// Nessuna scorciatoia cieca: prima i distrattori naturali erano "il totale del
// piatto" (sempre PIÙ GRANDE della risposta) e "uno in più / uno in meno",
// quindi la risposta era sempre quella di mezzo o la più piccola — mai la più
// grande — e bastava saperlo per vincere senza guardare le bilance. Ora:
//  1) le risposte sono numeri abbastanza grandi da avere errori plausibili
//     anche SOTTO (a d1 il rapporto è ≥ 4, oppure si chiede un multiplo;
//     a d3 la risposta sta fra 5 e 12 e la prima bilancia moltiplica, b > a);
//  2) i due distrattori vengono scelti da un insieme ampio di errori plausibili
//     con balancedNumericDistractors, che fa ruotare la posizione ordinale
//     della risposta (in mezzo, la più piccola, la più grande);
//  3) fra due candidati equivalenti vince sempre l'errore CONCETTUALE: cambia
//     il modo di scegliere i distrattori, non la loro natura didattica.

import type { ChoiceVisual, CountedShapes, Difficulty, Question, ShapeName } from '../types';
import { chance, pick, pickN, shuffle, type Rng } from '../rng';
import { balancedNumericDistractors, placeChoices, retry } from './qutils';

interface ShapeInfo {
  shape: ShapeName;
  name: string; // "cerchio"
  plural: string; // "cerchi"
  un: string; // articolo indeterminativo: "un"/"una"
  il: string; // articolo determinativo: "il"/"la"
  del: string; // preposizione articolata: "del"/"della"
  quanti: string; // "Quanti"/"Quante"
}

const SHAPES: ShapeInfo[] = [
  { shape: 'circle', name: 'cerchio', plural: 'cerchi', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'square', name: 'quadrato', plural: 'quadrati', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'triangle', name: 'triangolo', plural: 'triangoli', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'star', name: 'stella', plural: 'stelle', un: 'una', il: 'la', del: 'della', quanti: 'Quante' },
  { shape: 'diamond', name: 'rombo', plural: 'rombi', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
  { shape: 'heart', name: 'cuore', plural: 'cuori', un: 'un', il: 'il', del: 'del', quanti: 'Quanti' },
];

const COLORS = [0, 1, 2, 3, 4, 5, 6, 7];

/** "3 cerchi" / "1 cerchio" */
function cnt(n: number, s: ShapeInfo): string {
  return `${n} ${n === 1 ? s.name : s.plural}`;
}

/** "UN cerchio" / "UNA stella" */
function UNO(s: ShapeInfo): string {
  return `${s.un.toUpperCase()} ${s.name}`;
}

type Scale = { left: CountedShapes[]; right: CountedShapes[]; tilt: -1 | 0 | 1 };

/** costruisce una bilancia col tilt DERIVATO dai pesi assegnati (mai incoerente) */
function mkScale(left: CountedShapes[], right: CountedShapes[], weight: (s: ShapeName) => number): Scale {
  const tot = (side: CountedShapes[]) => side.reduce((sum, it) => sum + it.count * weight(it.shape), 0);
  const l = tot(left);
  const r = tot(right);
  return { left, right, tilt: l > r ? -1 : l < r ? 1 : 0 };
}

function pan(s: ShapeInfo, color: number, count: number): CountedShapes[] {
  return [{ shape: s.shape, color, count }];
}

/** stessa bilancia, lato sinistro e destro sorteggiati (il tilt resta derivato) */
function flipScale(rng: Rng, l: CountedShapes[], r: CountedShapes[], weight: (s: ShapeName) => number): Scale {
  return chance(rng, 0.5) ? mkScale(l, r, weight) : mkScale(r, l, weight);
}

/**
 * Le due opzioni sbagliate di un quesito numerico.
 *
 * `prefer` sono gli errori CONCETTUALI del quesito (dimenticare di dividere,
 * fermarsi a metà catena, sommare invece di moltiplicare...), `near` i valori
 * vicini che servono solo a coprire il lato altrimenti scoperto. Si passa tutto
 * a balancedNumericDistractors, che fa variare la posizione ordinale della
 * risposta; poi, a parità di lato, ogni valore vicino viene rimpiazzato da un
 * errore concettuale. Se non si riesce a bilanciare, il quesito viene scartato
 * (retry) invece di ripiegare sulla solita coppia "uno sopra / uno sotto".
 *
 * `visible` sono i numeri che si LEGGONO sui piatti o nella domanda: se li
 * copiassero tutti e due i distrattori, la risposta sarebbe l'unico numero
 * "nuovo" delle tre opzioni e si indovinerebbe senza fare il conto.
 */
function numberChoices(
  rng: Rng,
  correct: number,
  prefer: number[],
  near: number[],
  visible: number[] = []
): [ChoiceVisual, ChoiceVisual] {
  // mai "1": una risposta di un solo peso non è un errore che qualcuno farebbe
  const usable = (v: number) => Number.isInteger(v) && v >= 2 && v !== correct;
  const balanced = balancedNumericDistractors(rng, correct, [...prefer, ...near].filter(usable));
  if (!balanced) throw new Error('distrattori numerici non bilanciabili');

  const out = [...balanced];
  for (const p of prefer.filter(usable)) {
    if (out.includes(p)) continue;
    const i = out.findIndex((v) => v !== p && Math.sign(v - correct) === Math.sign(p - correct));
    if (i >= 0) out[i] = p; // stesso lato: la posizione della risposta non cambia
  }
  if (out.every((v) => visible.includes(v))) throw new Error('distrattori tutti copiati dal disegno');
  shuffle(rng, out);
  return [
    { kind: 'text', text: String(out[0]) },
    { kind: 'text', text: String(out[1]) },
  ];
}

// ---------------------------------------------------------------------------
// d1: una bilancia in equilibrio, rapporto intero tra due forme.
// Due direzioni di lettura, sorteggiate: la stessa immagine può chiedere di
// DIVIDERE (quanti B per UN A) o di MOLTIPLICARE (quanti B per N A). Serve
// anche a far crescere la risposta: con un rapporto 2 o 3 non esistono due
// errori plausibili più piccoli della risposta, e la risposta finirebbe sempre
// in mezzo o in fondo alla classifica.
// ---------------------------------------------------------------------------

/**
 * [a, k]: a forme A equilibrano a·k forme B → UN A pesa quanto k B.
 * k ≥ 4 e a ≤ k−2: sotto la risposta restano almeno due errori plausibili e
 * distinti (il numero di A letto sull'altro piatto, la divisione sbagliata di
 * uno). Con un rapporto 2 o 3 la risposta non potrebbe mai essere la più
 * grande delle tre opzioni, ed era metà del problema.
 */
const D1_DIVIDE = [
  [2, 4],
  [2, 5],
  [2, 6],
  [3, 5],
] as const;

/**
 * [N, k]: la bilancia mostra UN A contro k B, si chiede quanti B per N A.
 * Risposta N·k, fra 6 e 12: c'è spazio per errori plausibili da tutt'e due i lati.
 */
const D1_MULTIPLY = [
  [2, 3],
  [2, 4],
  [2, 5],
  [3, 2],
  [3, 3],
  [3, 4],
  [4, 2],
  [4, 3],
] as const;

/** d1a — "Quanti B pesano quanto UN A?": bisogna dividere il piatto per a */
function d1Divide(rng: Rng, A: ShapeInfo, B: ShapeInfo, cA: number, cB: number): Question {
  const [a, k] = pick(rng, D1_DIVIDE);
  const m = a * k; // forme B sull'altro piatto
  // pesi interni: peso(A) = k, peso(B) = 1 → equilibrio garantito
  const weight = (s: ShapeName) => (s === A.shape ? k : 1);
  const scale = flipScale(rng, pan(A, cA, a), pan(B, cB, m), weight);

  const [w1, w2] = numberChoices(
    rng,
    k,
    [
      m, // legge il totale del piatto e si dimentica di dividere
      m - a, // sottrae invece di dividere
      a, // legge il numero sbagliato: le forme sull'altro piatto
      m / (a + 1), // divide per il numero sbagliato (quando viene intero)
    ],
    [k + 1, k - 1, k + 2, k - 2], // la divisione sbagliata di poco
    [a, m] // i due numeri che si leggono sui piatti
  );
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(k) }, [w1, w2]);
  return {
    qtype: 'balance',
    difficulty: 1,
    prompt: `${B.quanti} ${B.plural} pesano quanto ${UNO(A)}?`,
    payload: { kind: 'balance', scales: [scale] },
    choices,
    correctIndex,
    explanation:
      `La bilancia è in equilibrio: ${cnt(a, A)} pesano quanto ${cnt(m, B)}. ` +
      `Dividendo entrambi i piatti per ${a}: ${UNO(A)} pesa quanto ${m}÷${a} = ${cnt(k, B)}.`,
  };
}

/** d1b — "Quanti B pesano quanto N A?": la bilancia dà il rapporto, poi si moltiplica */
function d1Multiply(rng: Rng, A: ShapeInfo, B: ShapeInfo, cA: number, cB: number): Question {
  const [N, k] = pick(rng, D1_MULTIPLY);
  const n = N * k;
  const weight = (s: ShapeName) => (s === A.shape ? k : 1);
  const scale = flipScale(rng, pan(A, cA, 1), pan(B, cB, k), weight);

  const [w1, w2] = numberChoices(
    rng,
    n,
    [
      k, // risponde per UN solo A: copia il piatto senza moltiplicare
      N + k, // somma i due numeri invece di moltiplicarli
      (N - 1) * k, // si dimentica un A per strada
      (N + 1) * k, // conta un A di troppo
      N * (k + 1), // sbaglia di uno il rapporto letto sulla bilancia
      N * (k - 1),
    ],
    [n + 1, n - 1, n + 2, n - 2], // la moltiplicazione sbagliata di poco
    [1, k, N] // i numeri che si leggono sui piatti e nella domanda
  );
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [w1, w2]);
  return {
    qtype: 'balance',
    difficulty: 1,
    prompt: `${B.quanti} ${B.plural} pesano quanto ${cnt(N, A)}?`,
    payload: { kind: 'balance', scales: [scale] },
    choices,
    correctIndex,
    explanation:
      `La bilancia è in equilibrio: ${UNO(A)} pesa quanto ${cnt(k, B)}. ` +
      `Per ${cnt(N, A)} servono ${N} volte tant${B.un === 'una' ? 'e' : 'i'} ${B.plural}: ` +
      `${N} × ${k} = ${cnt(n, B)}.`,
  };
}

function genD1(rng: Rng): Question {
  const [A, B] = pickN(rng, SHAPES, 2);
  const [cA, cB] = pickN(rng, COLORS, 2);
  return chance(rng, 0.5) ? d1Divide(rng, A, B, cA, cB) : d1Multiply(rng, A, B, cA, cB);
}

// ---------------------------------------------------------------------------
// d2: due bilance transitive (H>M e M>L) → forma più pesante
// ---------------------------------------------------------------------------
function genD2(rng: Rng): Question {
  const [H, M, L] = pickN(rng, SHAPES, 3); // pesante, media, leggera
  const [cH, cM, cL] = pickN(rng, COLORS, 3);
  const w = new Map<ShapeName, number>([
    [H.shape, 3],
    [M.shape, 2],
    [L.shape, 1],
  ]);
  const weight = (s: ShapeName) => w.get(s) ?? 0;
  // 1 contro 1, lati casuali: il tilt deriva dai pesi
  const s1 = chance(rng, 0.5)
    ? mkScale(pan(H, cH, 1), pan(M, cM, 1), weight)
    : mkScale(pan(M, cM, 1), pan(H, cH, 1), weight);
  const s2 = chance(rng, 0.5)
    ? mkScale(pan(M, cM, 1), pan(L, cL, 1), weight)
    : mkScale(pan(L, cL, 1), pan(M, cM, 1), weight);
  const scales = chance(rng, 0.5) ? [s1, s2] : [s2, s1];

  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: H.name }, [
    { kind: 'text', text: M.name }, // la forma che "vince" solo un confronto diretto
    { kind: 'text', text: L.name }, // chi legge il tilt al contrario
  ]);
  return {
    qtype: 'balance',
    difficulty: 2,
    prompt: 'Quale forma è la più pesante?',
    payload: { kind: 'balance', scales },
    choices,
    correctIndex,
    explanation:
      `La bilancia pende sempre verso il piatto più pesante. Una bilancia mostra che ` +
      `${H.il} ${H.name} pesa più ${M.del} ${M.name}; l'altra che ${M.il} ${M.name} pesa più ` +
      `${L.del} ${L.name}. Mettendo in fila: ${H.name} > ${M.name} > ${L.name}, ` +
      `quindi la forma più pesante è ${H.il} ${H.name}.`,
  };
}

// ---------------------------------------------------------------------------
// d3: catena di 2-3 equivalenze da combinare, con divisione finale
// ---------------------------------------------------------------------------
/**
 * Catene ammesse: a·S0 = b·S1, 1·S1 = d·S2 (e, con tre bilance, 1·S2 = e·S3).
 * La risposta è n = b·d·e ÷ a. I vincoli non sono estetici, servono a togliere
 * la scorciatoia:
 *  - a ≥ 2: c'è sempre una divisione finale, quindi "il totale del piatto" resta
 *    un errore plausibile SOPRA la risposta;
 *  - b > a: la prima bilancia moltiplica, quindi "ignorare i suoi numeri" (d·e)
 *    è un errore plausibile SOTTO la risposta;
 *  - 5 ≤ n ≤ 12: sotto il 5 non esistono due errori plausibili più piccoli,
 *    sopra il 12 i conti smettono di essere alla portata.
 */
function chains(three: boolean): { a: number; b: number; d: number; e: number }[] {
  const out: { a: number; b: number; d: number; e: number }[] = [];
  for (const a of [2, 3])
    for (let b = a + 1; b <= 7; b++)
      for (let d = 2; d <= (three ? 4 : 6); d++)
        for (const e of three ? [2, 3] : [1]) {
          const total = b * d * e;
          if (total % a !== 0) continue;
          const n = total / a;
          if (n < 5 || n > 12) continue;
          out.push({ a, b, d, e });
        }
  return out;
}

const CHAINS_2 = chains(false);
const CHAINS_3 = chains(true);

function genD3(rng: Rng): Question {
  const three = chance(rng, 0.4);
  const { a, b, d, e } = pick(rng, three ? CHAINS_3 : CHAINS_2);
  const infos = pickN(rng, SHAPES, three ? 4 : 3);
  const cols = pickN(rng, COLORS, infos.length);
  const [S0, S1, S2, S3] = infos;
  const T = three ? S3 : S2; // forma bersaglio della domanda
  const total = b * d * e; // quanti T equilibrano a·S0
  const n = total / a; // risposta (intera per costruzione dei combo)

  // pesi interni in unità della forma più leggera T
  const w = new Map<ShapeName, number>([
    [S0.shape, n],
    [S1.shape, d * e],
    [S2.shape, e],
  ]);
  if (three) w.set(S3.shape, 1);
  const weight = (s: ShapeName) => w.get(s) ?? 0;

  const flip = (l: CountedShapes[], r: CountedShapes[]) =>
    chance(rng, 0.5) ? mkScale(l, r, weight) : mkScale(r, l, weight);
  const scales: Scale[] = [flip(pan(S0, cols[0], a), pan(S1, cols[1], b)), flip(pan(S1, cols[1], 1), pan(S2, cols[2], d))];
  if (three) scales.push(flip(pan(S2, cols[2], 1), pan(S3, cols[3], e)));
  shuffle(rng, scales);

  // errori concettuali della catena, sia sopra sia sotto la risposta
  const prefer = [
    total, // legge il totale e si dimentica di dividere per a
    total - a, // sottrae invece di dividere
    d * e, // ignora i numeri della prima bilancia (come se fosse 1 S0 = 1 S1)
    b + d + (three ? e : 0), // somma le equivalenze invece di moltiplicarle
    (b * d) / a, // ferma la catena una bilancia prima (con 2 bilance vale n: si scarta)
    b / a, // ferma la catena alla prima bilancia (conta gli S1, non i T)
  ];
  const [w1, w2] = numberChoices(rng, n, prefer, [n + 1, n - 1, n + 2, n - 2]);
  const { choices, correctIndex } = placeChoices(rng, { kind: 'text', text: String(n) }, [w1, w2]);

  let expl = `Sappiamo che ${cnt(a, S0)} = ${cnt(b, S1)} e ${cnt(1, S1)} = ${cnt(d, S2)}`;
  if (three) expl += ` e ${cnt(1, S2)} = ${cnt(e, S3)}`;
  expl += `. Quindi ${cnt(b, S1)} = ${cnt(b * d, S2)}`;
  if (three) expl += ` = ${cnt(b * d * e, S3)}`;
  expl += `, perciò ${cnt(a, S0)} = ${cnt(total, T)}`;
  expl +=
    a > 1
      ? `: dividendo per ${a}, ${UNO(S0)} pesa quanto ${total}÷${a} = ${cnt(n, T)}.`
      : `, cioè ${UNO(S0)} pesa quanto ${cnt(n, T)}.`;

  return {
    qtype: 'balance',
    difficulty: 3,
    prompt: `${T.quanti} ${T.plural} servono per bilanciare ${UNO(S0)}?`,
    payload: { kind: 'balance', scales },
    choices,
    correctIndex,
    explanation: expl,
  };
}

export function genBalance(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => (difficulty === 1 ? genD1(rng) : difficulty === 2 ? genD2(rng) : genD3(rng)));
}
