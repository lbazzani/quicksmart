// Generatore "dice": dadi e cubi. Sette famiglie di domande, tutte visuali.
//
// Pile isometriche (payload 'dicestack'):
//   A. conteggio dei cubi (d1 blocco 2×2 o fila singola, d2 3×3 con colonne
//      dietro più basse di quelle davanti)
//   B. cubi mancanti per completare il parallelepipedo o il muro (d3)
//   C. due gruppi di cubi a confronto: quale ne ha di più / quanti in più.
//      Non esistono due 'dicestack' in un payload solo: si usa UNA griglia
//      lineare più larga con due caselle vuote a fare da separazione.
//   D. quante facce di cubo si vedono da questa angolazione (torri separate:
//      ogni torre alta h mostra 2·h+1 facce, non 3·h)
//   E. quanti cubi toccano il tavolo (= quante pile, non quanti cubi)
// Sviluppo del dado (payload 'dicenet'): 32 sviluppi diversi (striscia di 4
//   caselle + 2 alette, orizzontale o verticale) e quattro domande: faccia
//   opposta, faccia sotto, faccia che non tocca mai, somma delle facce che
//   toccano. La "regola del 7" NON vale su questi sviluppi: è il distrattore.
// Tessere con pallini (payload 'cells' con forme 'dot'): somma dei pallini
//   (d1), tessera coperta dato il totale (d2), due file con lo stesso totale
//   (d3), facce nascoste di un dado vero (d3).
//
// Distrattori: sempre errori tipici (contare le pile invece dei cubi, 3 facce
// per cubo, regola del 7, dimenticare di sottrarre…), mai numeri a caso.
//
// NOTA DI DISEGNO — nella proiezione isometrica del renderer la pila in
// (r+1, c+1) cade esattamente sopra quella in (r, c) (stesso x, 1 px di
// scarto): due pile sulla stessa diagonale si incolonnano e sembrano una pila
// sola, e con altezze sfortunate un cubo sparisce del tutto. Perciò:
//  - tutte le griglie passano da makeReadableGrid(), che non lascia sparire
//    nessun cubo (il conteggio totale resta sempre leggibile dal disegno);
//  - le domande che devono distinguere le SINGOLE pile ("quante pile",
//    "quante ne mancano", i due gruppi, le facce visibili) usano file lineari
//    (1×n o n×1) oppure passano da distinctPiles().

import type { CellSpec, ChoiceVisual, Difficulty, Question } from '../types';
import { chance, pick, randInt, shuffle, type Rng } from '../rng';
import { L } from '../localize';
import { balancedNumericDistractors, placeChoices, retry } from './qutils';

const txt = (n: number | string): ChoiceVisual => ({ kind: 'text', text: L(String(n)) });

const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

function gridSum(grid: number[][]): number {
  return total(grid.flat());
}

/** vero se almeno una colonna dietro è più bassa di quella davanti (resta nascosta) */
function hasHiddenColumn(grid: number[][]): boolean {
  for (let r = 1; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++)
      if (grid[r][c] > grid[r - 1][c]) return true;
  return false;
}

/**
 * Vero se nel disegno ogni pila resta riconoscibile:
 *  1) nessun cubo finisce esattamente dietro un altro: succede quando la pila
 *     in (r+1, c+1) è alta più di 1 e dietro di lei c'è una pila;
 *  2) nessuna pila sparisce fra due vicine più alte (a destra e davanti).
 */
function isReadable(grid: number[][]): boolean {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const h = grid[r][c];
      if (h === 0) continue;
      if ((grid[r + 1]?.[c + 1] ?? 0) > 1) return false;
      const right = grid[r][c + 1] ?? 0;
      const front = grid[r + 1]?.[c] ?? 0;
      if (right > h && front > h) return false;
    }
  }
  return true;
}

/**
 * Vero se le pile restano DISTINGUIBILI una dall'altra. Nel disegno isometrico
 * due pile con la stessa differenza colonna−riga cadono sulla stessa verticale
 * e si incolonnano: sembrano una pila sola e alta. Va bene per "quanti cubi in
 * tutto" (il totale non cambia), non per "quante pile" o "quante ne mancano".
 */
function distinctPiles(grid: number[][]): boolean {
  const diag = new Set<number>();
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] === 0) continue;
      if (diag.has(c - r)) return false;
      diag.add(c - r);
    }
  }
  return true;
}

/** griglia casuale che rispetta isReadable() (altezze limitate dov'è necessario) */
function makeReadableGrid(
  rng: Rng,
  rows: number,
  cols: number,
  minH: number,
  maxH: number,
  ok?: (g: number[][]) => boolean
): number[][] {
  for (let attempt = 0; attempt < 60; attempt++) {
    const g: number[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: number[] = [];
      for (let c = 0; c < cols; c++) {
        // se dietro-a-sinistra c'è una pila, questa può essere alta al massimo 1
        const cap = r > 0 && c > 0 && g[r - 1][c - 1] > 0 ? Math.min(1, maxH) : maxH;
        row.push(randInt(rng, Math.min(minH, cap), cap));
      }
      g.push(row);
    }
    if (isReadable(g) && (!ok || ok(g))) return g;
  }
  throw new Error('griglia leggibile non trovata');
}

/** dispone una fila di altezze in orizzontale (1×n) oppure in verticale (n×1) */
function lineGrid(heights: number[], vertical: boolean): number[][] {
  return vertical ? heights.map((h) => [h]) : [heights];
}

// ---------------------------------------------------------------------------
// Distrattori numerici
// ---------------------------------------------------------------------------

/**
 * Distanza minima fra la risposta e ogni distrattore. Chi ha capito il compito
 * e perde il conto di UNO non deve trovare la propria svista fra le opzioni:
 * sarebbe una punizione per la manina, non per il ragionamento.
 */
const GAP = 2;

/** sviste di conteggio plausibili, sopra e sotto (mai a distanza 1) */
function slips(correct: number): number[] {
  const ds = correct >= 12 ? [2, 3, 4, 5, 6] : [2, 3, 4];
  return ds.flatMap((d) => [correct - d, correct + d]);
}

/**
 * Due distrattori numerici per un quesito che si risolve contando.
 *
 * `prefer` sono gli errori CONCETTUALI del quesito (contare le pile invece dei
 * cubi, dimenticare la sottrazione, la regola del 7, saltare una tessera…):
 * restano la prima scelta, perché sono quelli che insegnano qualcosa.
 *
 * Il punto delicato è la POSIZIONE della risposta nella terna. Gli errori
 * naturali di questi quesiti sono quasi tutti dallo stesso lato — "quanti cubi
 * in tutto" ha i distrattori uno sopra e uno sotto (risposta di mezzo), "quante
 * pile" li ha tutti sopra (risposta più piccola), "quanti in più" pure — e chi
 * se ne accorge vince senza guardare il disegno. Perciò il pool contiene errori
 * plausibili DA ENTRAMBI I LATI e balancedNumericDistractors fa ruotare la
 * posizione ordinale della risposta: a volte in mezzo, a volte la più piccola,
 * a volte la più grande.
 */
function numChoices(
  rng: Rng,
  correct: number,
  prefer: number[],
  opts: { min?: number; max?: number } = {}
): [number, number] {
  const min = opts.min ?? 2;
  const max = opts.max ?? Number.MAX_SAFE_INTEGER;
  const usable = (v: number) =>
    Number.isInteger(v) && v >= min && v <= max && Math.abs(v - correct) >= GAP;
  const pool = [...prefer, ...slips(correct)].filter(usable);
  const out = balancedNumericDistractors(rng, correct, pool, GAP);
  if (!out) throw new Error('distrattori numerici sbilanciati');

  // a parità di lato l'errore concettuale batte la svista generica
  for (const p of prefer.filter(usable)) {
    if (out.includes(p)) continue;
    const i = out.findIndex((v) => v !== p && Math.sign(v - correct) === Math.sign(p - correct));
    if (i >= 0) out[i] = p;
  }

  // Anche i due DISTRATTORI devono distare almeno GAP fra loro. Se no nasce una
  // scorciatoia nuova di zecca: la risposta è a 2 da entrambi, quindi appena i
  // due distrattori sono numeri consecutivi basta scartare la coppia e scegliere
  // il terzo numero — senza guardare il disegno. Il rattoppo cambia UNO dei due
  // valori restando dalla stessa parte della risposta, così la posizione
  // ordinale scelta da balancedNumericDistractors non si sposta (rigenerare
  // avrebbe rimesso in mezzo la risposta, che è il difetto di partenza).
  if (Math.abs(out[0] - out[1]) < GAP) {
    const sameSide = (keep: number, drop: number) =>
      pool.filter(
        (v) =>
          v !== keep &&
          Math.sign(v - correct) === Math.sign(drop - correct) &&
          Math.abs(v - keep) >= GAP
      );
    const alt = sameSide(out[0], out[1]);
    if (alt.length) out[1] = pick(rng, alt);
    else {
      const alt0 = sameSide(out[1], out[0]);
      if (!alt0.length) throw new Error('i due distrattori sono per forza consecutivi');
      out[0] = pick(rng, alt0);
    }
  }

  // La stessa scorciatoia vista dall'occhio invece che dal ragionamento: se i
  // due distrattori si somigliano fra loro (stesso numero di cifre) e la
  // risposta no, la terza opzione si stacca e si sceglie senza contare. Si
  // prova a scambiarne uno con un candidato che abbia le cifre della risposta,
  // sempre dalla stessa parte: se non esiste si lascia com'è, perché
  // rigenerare rimetterebbe la risposta in mezzo — cioè il difetto di partenza.
  const digits = (v: number) => String(v).length;
  if (digits(out[0]) !== digits(correct) && digits(out[1]) !== digits(correct)) {
    for (const i of [0, 1] as const) {
      const keep = out[1 - i];
      const alt = pool.filter(
        (v) =>
          v !== keep &&
          digits(v) === digits(correct) &&
          Math.sign(v - correct) === Math.sign(out[i] - correct) &&
          Math.abs(v - keep) >= GAP
      );
      if (alt.length) {
        out[i] = pick(rng, alt);
        break;
      }
    }
  }
  return [out[0], out[1]];
}

/** "(2+1+3) + (1+2+2)" — le altezze riga per riga, per la spiegazione */
function sumText(grid: number[][]): string {
  return grid.map((row) => '(' + row.join('+') + ')').join(' + ');
}

/** scelta pesata fra varianti */
function weighted<T extends string>(rng: Rng, table: Array<[T, number]>): T {
  let x = rng() * total(table.map(([, w]) => w));
  for (const [v, w] of table) if ((x -= w) < 0) return v;
  return table[table.length - 1][0];
}

// ---------------------------------------------------------------------------
// A: conteggio cubi
// ---------------------------------------------------------------------------

const NOTE_BLOCK =
  `Il trucco: contano anche i cubi nascosti dietro le pile più alte, non solo quelli che si vedono!`;
const NOTE_LINE =
  `Il trucco: ogni pila vale quanti cubi è alta, non uno solo. Conta le pile una per una e somma.`;
const NOTE_BLOCK_EN =
  `The trick: the cubes hidden behind the taller stacks count too, not just the ones you can see!`;
const NOTE_LINE_EN =
  `The trick: each stack counts for as many cubes as it's tall, not just one. Count the stacks one by one and add them up.`;

/**
 * Sotto questa soglia non esistono due valori PIÙ PICCOLI plausibili (il minimo
 * offribile è 2 e la distanza minima è 2): la risposta finirebbe sempre a essere
 * la più grande delle tre e basterebbe scegliere quella per vincere senza
 * contare niente.
 */
const MIN_CUBES = 6;

function countQuestion(
  rng: Rng,
  difficulty: Difficulty,
  grid: number[][],
  note = NOTE_BLOCK,
  noteEn = NOTE_BLOCK_EN
): Question {
  const sum = gridSum(grid);
  if (sum < MIN_CUBES) throw new Error('troppi pochi cubi per distrattori equilibrati');
  const heights = grid.flat();
  const piles = heights.filter((h) => h > 0).length;
  const maxH = Math.max(...heights);
  // errori tipici: una pila = un cubo (si contano le colonne che si vedono);
  // saltare una pila alta perché sta dietro, o contarla due volte; credere che
  // tutte le pile siano alte come la più alta
  const [dA, dB] = numChoices(rng, sum, [piles, sum - maxH, sum + maxH, maxH * piles]);
  const { choices, correctIndex } = placeChoices(rng, txt(sum), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L('Quanti cubi ci sono in totale?', 'How many cubes are there in total?'),
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: L(
      `Somma le altezze di tutte le colonne, riga per riga: ${sumText(grid)} = ${sum} cubi. ` + note,
      `Add up the heights of all the columns, row by row: ${sumText(grid)} = ${sum} cubes. ` + noteEn
    ),
  };
}

// ---------------------------------------------------------------------------
// B: cubi mancanti per completare il parallelepipedo (d3)
// ---------------------------------------------------------------------------

/** come MIN_CUBES: sotto il 6 la risposta sarebbe sempre la più grande delle tre */
const MIN_MISSING = 6;

function missingQuestion(rng: Rng, grid: number[][]): Question {
  const sum = gridSum(grid);
  const maxH = Math.max(...grid.flat());
  const rows = grid.length;
  const cols = grid[0].length;
  const box = maxH * rows * cols;
  const missing = box - sum;
  if (missing < MIN_MISSING) throw new Error('troppi pochi cubi mancanti per distrattori equilibrati');
  const holes = grid.flat().filter((h) => h === 0).length;
  // errori tipici: rispondere con i cubi presenti o con il solido intero;
  // dimenticare che anche i posti vuoti della base vanno riempiti fino in cima;
  // sbagliare di un piano l'altezza del solido da completare
  const [dA, dB] = numChoices(rng, missing, [
    sum,
    box,
    missing - holes * maxH,
    missing - rows * cols,
    missing + rows * cols,
  ]);
  const { choices, correctIndex } = placeChoices(rng, txt(missing), [txt(dA), txt(dB)]);
  const wall = rows === 1 || cols === 1;
  const what = wall
    ? `il muro (una fila di ${rows * cols} colonne, alto quanto la colonna più alta)`
    : `il parallelepipedo (base ${rows}×${cols}, alto quanto la colonna più alta)`;
  const whatEn = wall
    ? `the wall (a row of ${rows * cols} columns, as tall as the tallest column)`
    : `the block (base ${rows}×${cols}, as tall as the tallest column)`;
  const empty = holes;
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: L(`Quanti cubi mancano per completare ${what}?`, `How many cubes are missing to complete ${whatEn}?`),
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: L(
      `Completo, ${wall ? 'il muro' : 'il parallelepipedo'} sarebbe ${rows}×${cols}×${maxH} = ${box} cubi. ` +
        `Adesso ce ne sono ${sumText(grid)} = ${sum}, quindi ne mancano ${box} − ${sum} = ${missing}. ` +
        (empty > 0 ? `Occhio ai ${empty === 1 ? 'posto vuoto' : `${empty} posti vuoti`} della base: ${empty === 1 ? 'anche quello va riempito' : 'vanno riempiti anche quelli'} fino in cima. ` : '') +
        // se per caso i cubi presenti sono tanti quanti i mancanti la "trappola"
        // non esiste: dirlo lo stesso confonderebbe e basta
        (sum === missing
          ? `Curiosità: qui i cubi che mancano sono esattamente quanti quelli che ci sono già.`
          : `Il trucco: la domanda chiede i cubi mancanti, non quelli presenti (${sum}).`),
      `If it were complete, ${wall ? 'the wall' : 'the block'} would be ${rows}×${cols}×${maxH} = ${box} cubes. ` +
        `Right now there are ${sumText(grid)} = ${sum}, so ${box} − ${sum} = ${missing} are missing. ` +
        (empty > 0 ? `Watch out for the ${empty === 1 ? 'empty spot' : `${empty} empty spots`} in the base: ${empty === 1 ? 'it needs filling too' : 'they need filling too'}, all the way to the top. ` : '') +
        (sum === missing
          ? `Fun fact: here the missing cubes are exactly as many as the ones already there.`
          : `The trick: the question asks for the missing cubes, not the ones already there (${sum}).`)
    ),
  };
}

// ---------------------------------------------------------------------------
// E: quanti cubi toccano il tavolo (= quante pile)
// ---------------------------------------------------------------------------

/**
 * Le pile devono essere almeno 6: con meno non esistono due numeri più piccoli
 * plausibili e distanti fra loro, e "scegli il più piccolo" vincerebbe sempre
 * (era al 68%).
 */
const MIN_PILES = 6;

function touchQuestion(rng: Rng, difficulty: Difficulty, grid: number[][]): Question {
  const heights = grid.flat();
  const piles = heights.filter((h) => h > 0).length;
  const cubes = total(heights);
  const maxH = Math.max(...heights);
  if (piles < MIN_PILES) throw new Error('troppe poche pile per distrattori equilibrati');
  // errori tipici: contare TUTTI i cubi, contare quelli appoggiati sopra un
  // altro cubo (il complemento), scambiare "quante pile" con "quanto è alta la
  // più alta"
  const [dA, dB] = numChoices(rng, piles, [cubes, cubes - piles, maxH]);
  const { choices, correctIndex } = placeChoices(rng, txt(piles), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L('Quanti cubi toccano il tavolo?', 'How many cubes are touching the table?'),
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: L(
      `Ogni pila appoggia sul tavolo con un cubo solo, quello in fondo: basta quindi contare le pile, ` +
        `e le pile sono ${piles}. Il trucco: i cubi in tutto sono ${cubes}, ma quelli appoggiati sopra ` +
        `un altro cubo (${cubes - piles}) il tavolo non lo toccano.`,
      `Each stack touches the table with just one cube, the bottom one: so all you have to do is count the ` +
        `stacks, and there are ${piles} of them. The trick: there are ${cubes} cubes in total, but the ones ` +
        `sitting on top of another cube (${cubes - piles}) never touch the table.`
    ),
  };
}

// ---------------------------------------------------------------------------
// D: quante facce di cubo si vedono
// ---------------------------------------------------------------------------

/** torri separate da due caselle vuote: nessuna copre l'altra nel disegno */
function towersGrid(heights: number[], vertical: boolean): number[][] {
  const cells: number[] = [];
  heights.forEach((h, i) => {
    if (i > 0) cells.push(0, 0);
    cells.push(h);
  });
  return lineGrid(cells, vertical);
}

function facesQuestion(rng: Rng, difficulty: Difficulty, heights: number[], vertical: boolean): Question {
  const cubes = total(heights);
  const towers = heights.length;
  const faces = 2 * cubes + towers; // 2·h + 1 per torre
  // "3 facce per cubo" deve restare un errore ben visibile: se i cubi sono
  // pochi più delle torri quel numero cade a ridosso della risposta
  if (cubes < towers + 2) throw new Error('torri troppo basse: il 3·cubi non è distinguibile');
  // errori tipici: 3 facce per ogni cubo (giusto solo a cubi staccati),
  // dimenticare i coperchi (2 per cubo), contare i cubi invece delle facce
  const [dA, dB] = numChoices(rng, faces, [3 * cubes, 2 * cubes, cubes]);
  const { choices, correctIndex } = placeChoices(rng, txt(faces), [txt(dA), txt(dB)]);
  const perTower = heights.map((h) => `2×${h}+1 = ${2 * h + 1}`).join(', ');
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L('Quante facce dei cubi si vedono da questa angolazione?', 'How many cube faces can you see from this angle?'),
    payload: { kind: 'dicestack' as const, grid: towersGrid(heights, vertical) },
    choices,
    correctIndex,
    explanation: L(
      `Di ogni cubo si vedono al massimo tre facce: il coperchio e i due fianchi. Ma il coperchio di un ` +
        `cubo che ne ha un altro sopra è coperto: in una torre alta h si vedono h fianchi a sinistra, ` +
        `h fianchi a destra e UN solo coperchio, cioè 2×h+1 facce. ` +
        (towers === 1
          ? `Qui la torre è alta ${heights[0]}: ${perTower} facce.`
          : `Qui: ${perTower}, in tutto ${faces} facce.`) +
        ` Il trucco: 3 facce per cubo (${3 * cubes}) sarebbe giusto solo con i cubi tutti staccati.`,
      `You can see at most three faces of each cube: the top and the two sides. But the top of a ` +
        `cube that has another cube stacked on it is hidden: in a tower h cubes tall you see h side faces on ` +
        `the left, h side faces on the right, and just ONE top — that's 2×h+1 faces. ` +
        (towers === 1
          ? `Here the tower is ${heights[0]} cubes tall: ${perTower} faces.`
          : `Here: ${perTower}, ${faces} faces in total.`) +
        ` The trick: 3 faces per cube (${3 * cubes}) would only be right if all the cubes were separate.`
    ),
  };
}

// ---------------------------------------------------------------------------
// C: due gruppi di cubi a confronto
// ---------------------------------------------------------------------------

/** spezza `sum` in `n` addendi interi fra min e max */
function partition(rng: Rng, sum: number, n: number, min: number, max: number): number[] {
  const parts = Array.from({ length: n }, () => min);
  let left = sum - n * min;
  if (left < 0 || left > n * (max - min)) throw new Error('partizione impossibile');
  for (let guard = 0; left > 0 && guard < 400; guard++) {
    const i = randInt(rng, 0, n - 1);
    if (parts[i] < max) {
      parts[i]++;
      left--;
    }
  }
  if (left > 0) throw new Error('partizione impossibile');
  return parts;
}

/**
 * Differenza minima fra i due gruppi quando la domanda chiede "quanti in più".
 * Con una differenza di 1-3 (com'era) tutti gli errori plausibili stanno SOPRA
 * la risposta — i due totali, la differenza sbagliata di poco — e "scegli il
 * numero più piccolo" vinceva il 100% delle volte. Da 5 in su esistono anche
 * errori più piccoli: "ho saltato una pila del gruppo che ne ha di più".
 */
const MIN_GROUP_DIFF = 6;

/**
 * Due gruppi con LO STESSO numero di pile: quello che ha più cubi non ha la
 * pila più alta. Così chi conta le pile risponde "pari" e chi guarda la torre
 * più alta sbaglia gruppo: bisogna contare i cubi davvero.
 */
function buildGroups(rng: Rng, n: number, tallMax: number, diffMin: number, diffMax: number) {
  // Con la pila più alta (tall) nel gruppo perdente e le altre sue pile a 1-2
  // cubi, il vincitore può stare al massimo n·(tall−1) cubi: nel caso migliore
  // la differenza arriva a (n−1)·tall − 2n + 1. Se la torre è troppo bassa la
  // differenza richiesta non ci sta e si finirebbe a rigenerare all'infinito.
  const minTall = Math.max(n === 2 ? 4 : 3, Math.ceil((diffMin + 2 * n - 1) / (n - 1)));
  if (minTall > tallMax) throw new Error('gruppi non costruibili');
  const tall = randInt(rng, minTall, tallMax);
  const loser = shuffle(rng, [tall, ...Array.from({ length: n - 1 }, () => randInt(rng, 1, 2))]);
  const loserSum = total(loser);
  const room = n * (tall - 1) - loserSum; // quanto può stare sopra il perdente
  if (room < diffMin) throw new Error('gruppi non costruibili');
  const diff = randInt(rng, diffMin, Math.min(diffMax, room));
  const winner = shuffle(rng, partition(rng, loserSum + diff, n, 1, tall - 1));
  return { winner, loser, winnerSum: loserSum + diff, loserSum, diff, tall, n };
}

function groupsQuestion(
  rng: Rng,
  difficulty: Difficulty,
  form: 'which' | 'diff',
  n: number,
  tallMax: number,
  diffMin: number,
  diffMax: number
): Question {
  const g = buildGroups(rng, n, tallMax, diffMin, diffMax);
  const vertical = chance(rng, 0.5);
  const winnerFirst = chance(rng, 0.5);
  const first = winnerFirst ? g.winner : g.loser;
  const second = winnerFirst ? g.loser : g.winner;
  const grid = lineGrid([...first, 0, 0, ...second], vertical);
  const labA = vertical ? 'in alto a destra' : 'in alto a sinistra';
  const labB = vertical ? 'in basso a sinistra' : 'in basso a destra';
  const labAEn = vertical ? 'top right' : 'top left';
  const labBEn = vertical ? 'bottom left' : 'bottom right';
  const win = winnerFirst ? 'A' : 'B';
  const lose = winnerFirst ? 'B' : 'A';
  const intro = `Due gruppi di cubi: il gruppo A (${labA}) e il gruppo B (${labB}).`;
  const introEn = `Two groups of cubes: group A (${labAEn}) and group B (${labBEn}).`;
  const conti =
    `Il gruppo ${win} ha ${g.winner.join('+')} = ${g.winnerSum} cubi, ` +
    `il gruppo ${lose} ne ha ${g.loser.join('+')} = ${g.loserSum}.`;
  const contiEn =
    `Group ${win} has ${g.winner.join('+')} = ${g.winnerSum} cubes, ` +
    `group ${lose} has ${g.loser.join('+')} = ${g.loserSum}.`;
  const trap =
    ` Due trappole: i gruppi hanno lo stesso numero di pile (${g.n} e ${g.n}), e la pila più alta ` +
    `(${g.tall} cubi) sta nel gruppo ${lose}, quello che ne ha di meno. Bisogna contare i cubi, non le pile!`;
  const trapEn =
    ` Two traps: the groups have the same number of stacks (${g.n} and ${g.n}), and the tallest stack ` +
    `(${g.tall} cubes) is in group ${lose}, the one with fewer cubes overall. You have to count the cubes, not the stacks!`;

  if (form === 'which') {
    const other: ChoiceVisual = txt(lose);
    const pari: ChoiceVisual = { kind: 'text', text: L('Pari', 'Tie') };
    const distr: [ChoiceVisual, ChoiceVisual] = chance(rng, 0.5) ? [other, pari] : [pari, other];
    const { choices, correctIndex } = placeChoices(rng, txt(win), distr);
    return {
      qtype: 'dice' as const,
      difficulty,
      prompt: L(
        `${intro} Quale gruppo ha più cubi? (Rispondi A, B oppure "Pari" se ne hanno uguali.)`,
        `${introEn} Which group has more cubes? (Answer A, B, or "Tie" if they have the same number.)`
      ),
      payload: { kind: 'dicestack' as const, grid },
      choices,
      correctIndex,
      explanation: L(`${conti} Quindi ne ha di più il gruppo ${win}.` + trap, `${contiEn} So group ${win} has more.` + trapEn),
    };
  }

  // errori tipici: dimenticare la sottrazione (il totale di uno dei due gruppi);
  // saltare una pila del vincitore (differenza troppo piccola) o del perdente
  // (differenza troppo grande)
  const [dA, dB] = numChoices(rng, g.diff, [
    g.winnerSum,
    ...g.winner.map((h) => g.diff - h),
    g.loserSum,
    ...g.loser.map((h) => g.diff + h),
  ]);
  const { choices, correctIndex } = placeChoices(rng, txt(g.diff), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L(
      `${intro} Quanti cubi ha in più il gruppo ${win} rispetto all'altro?`,
      `${introEn} How many more cubes does group ${win} have than the other?`
    ),
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: L(
      `${conti} La differenza è ${g.winnerSum} − ${g.loserSum} = ${g.diff} cubi.` + trap,
      `${contiEn} The difference is ${g.winnerSum} − ${g.loserSum} = ${g.diff} cubes.` + trapEn
    ),
  };
}

// ---------------------------------------------------------------------------
// Sviluppi del dado (payload 'dicenet')
// ---------------------------------------------------------------------------

// faces = [a, b, c, d, e, f] con net: riga0 [·,a,·,·], riga1 [b,c,d,e], riga2 [·,f,·,·].
// Nel dado piegato le coppie opposte sono a–f, b–d, c–e.
const OPP_IDX = [5, 3, 4, 1, 2, 0];

function netQuestion(rng: Rng, difficulty: Difficulty, faces: number[], deceptive: boolean): Question {
  // scegliamo una faccia la cui opposta NON sia 7−X, così la "regola del 7" è
  // un distrattore valido (e la risposta resta univoca)
  const askable = [0, 1, 2, 3, 4, 5].filter((i) => faces[i] + faces[OPP_IDX[i]] !== 7);
  if (askable.length === 0) throw new Error('tutte le coppie opposte sommano 7');
  const qi = pick(rng, askable);
  const x = faces[qi];
  const opp = faces[OPP_IDX[qi]];
  const seven = 7 - x; // per costruzione ≠ opp e ≠ x: nel dado piegato è adiacente a x
  const adj = pick(rng, faces.filter((v) => v !== x && v !== opp && v !== seven));
  const { choices, correctIndex } = placeChoices(rng, txt(opp), [txt(seven), txt(adj)]);
  const net: (number | null)[][] = [
    [null, faces[0], null, null],
    [faces[1], faces[2], faces[3], faces[4]],
    [null, faces[5], null, null],
  ];
  const trap = deceptive
    ? ` I numeri consecutivi messi vicini ingannano l'occhio: conta le posizioni, non i valori.`
    : '';
  const trapEn = deceptive
    ? ` Consecutive numbers placed next to each other trick the eye: count the positions, not the values.`
    : '';
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L(`Nel dado piegato, quale faccia è opposta al ${x}?`, `When you fold up the die, which face ends up opposite the ${x}?`),
    payload: { kind: 'dicenet' as const, net },
    choices,
    correctIndex,
    explanation: L(
      `Piegando la croce, nella riga centrale sono opposte le facce a due caselle di distanza ` +
        `(${faces[1]}–${faces[3]} e ${faces[2]}–${faces[4]}), mentre l'aletta in alto (${faces[0]}) ` +
        `è opposta a quella in basso (${faces[5]}). Quindi il ${x} è opposto al ${opp}. ` +
        `Attenzione: la "regola del 7" (opposte che sommano 7) vale solo per i dadi standard, ` +
        `non per questo sviluppo: ${seven} qui è una faccia adiacente al ${x}.` + trap,
      `When you fold the cross shape, the faces in the middle row that are two squares apart end up opposite ` +
        `each other (${faces[1]}–${faces[3]} and ${faces[2]}–${faces[4]}), while the top flap (${faces[0]}) ` +
        `ends up opposite the bottom one (${faces[5]}). So the ${x} is opposite the ${opp}. ` +
        `Watch out: the "rule of 7" (opposite faces add up to 7) only works for standard dice, ` +
        `not for this net: here the ${seven} is a face adjacent to the ${x}.` + trapEn
    ),
  };
}

/** riga centrale con 4 numeri consecutivi: le coppie opposte sembrano "sbagliate" */
function deceptiveFaces(rng: Rng): number[] {
  const n = randInt(rng, 1, 3);
  const run = [n, n + 1, n + 2, n + 3];
  if (chance(rng, 0.5)) run.reverse();
  const rem = shuffle(rng, [1, 2, 3, 4, 5, 6].filter((v) => !run.includes(v)));
  return [rem[0], run[0], run[1], run[2], run[3], rem[1]];
}

// --- sviluppi generici: striscia di 4 caselle + 2 alette, 32 disposizioni ---

interface NetLayout {
  rows: number;
  cols: number;
  vertical: boolean;
  /** coordinate delle 6 facce: 0–3 = striscia (in fila), 4–5 = alette */
  cells: [number, number][];
}

/** nella striscia sono opposte le facce a due caselle di distanza; restano le alette */
const STRIP_OPP = [2, 3, 0, 1, 5, 4];

const NET_LAYOUTS: NetLayout[] = (() => {
  const out: NetLayout[] = [];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out.push({ rows: 3, cols: 4, vertical: false, cells: [[1, 0], [1, 1], [1, 2], [1, 3], [0, i], [2, j]] });
      out.push({ rows: 4, cols: 3, vertical: true, cells: [[0, 1], [1, 1], [2, 1], [3, 1], [i, 0], [j, 2]] });
    }
  }
  return out;
})();

function buildNet(layout: NetLayout, faces: number[]): (number | null)[][] {
  const net: (number | null)[][] = Array.from({ length: layout.rows }, () =>
    Array.from({ length: layout.cols }, () => null as number | null)
  );
  layout.cells.forEach(([r, c], i) => {
    net[r][c] = faces[i];
  });
  return net;
}

/** facce attaccate sul foglio alla faccia k (nel dado si toccano di sicuro) */
function paperNeighbours(layout: NetLayout, k: number): number[] {
  const [r, c] = layout.cells[k];
  return layout.cells
    .map(([nr, nc], i) => (Math.abs(nr - r) + Math.abs(nc - c) === 1 ? i : -1))
    .filter((i) => i >= 0);
}

type NetForm = 'opposite' | 'under' | 'nottouch' | 'sum';

function netGeneralQuestion(
  rng: Rng,
  difficulty: Difficulty,
  layout: NetLayout,
  faces: number[],
  form: NetForm,
  deceptive: boolean
): Question {
  const askable = [0, 1, 2, 3, 4, 5].filter((i) => faces[i] + faces[STRIP_OPP[i]] !== 7);
  if (askable.length === 0) throw new Error('tutte le coppie opposte sommano 7');
  const qi = pick(rng, askable);
  const x = faces[qi];
  const opp = faces[STRIP_OPP[qi]];
  const seven = 7 - x;
  const payload = { kind: 'dicenet' as const, net: buildNet(layout, faces) };
  const dir = layout.vertical ? 'colonna' : 'fila';
  const dirEn = layout.vertical ? 'column' : 'row';
  const regola =
    `Nello sviluppo, due facce della ${dir} lunga separate da una casella finiscono una di fronte ` +
    `all'altra: ${faces[0]}–${faces[2]} e ${faces[1]}–${faces[3]}. Restano le due alette, ${faces[4]} e ` +
    `${faces[5]}: per forza sono opposte fra loro. Quindi il ${x} è opposto al ${opp}.`;
  const regolaEn =
    `In the net, two faces of the long ${dirEn} with one square between them end up opposite ` +
    `each other: ${faces[0]}–${faces[2]} and ${faces[1]}–${faces[3]}. That leaves the two flaps, ${faces[4]} and ` +
    `${faces[5]}: they must be opposite each other. So the ${x} is opposite the ${opp}.`;
  const sette =
    ` Attenzione alla "regola del 7" (facce opposte che sommano 7): vale sui dadi veri, ma qui i numeri ` +
    `sono messi in un altro ordine e il ${seven} è una faccia che TOCCA il ${x}.`;
  const setteEn =
    ` Watch out for the "rule of 7" (opposite faces add up to 7): it holds for real dice, but here the ` +
    `numbers are arranged in a different order, and the ${seven} is a face that TOUCHES the ${x}.`;
  const inganno = deceptive
    ? ` I numeri consecutivi messi vicini ingannano l'occhio: conta le caselle, non i valori.`
    : '';
  const ingannoEn = deceptive
    ? ` Consecutive numbers placed next to each other trick the eye: count the squares, not the values.`
    : '';

  if (form === 'sum') {
    const answer = 21 - x - opp;
    const touching = faces.filter((v) => v !== x && v !== opp);
    // errori tipici: togliere solo la faccia chiesta (o solo la sua opposta);
    // usare la regola del 7 (21 − 7 = 14); sommare tre facce su quattro, o
    // sommarne una due volte
    const [dA, dB] = numChoices(rng, answer, [
      21 - x,
      14,
      ...touching.map((f) => answer - f),
      21 - opp,
      ...touching.map((f) => answer + f),
    ]);
    const { choices, correctIndex } = placeChoices(rng, txt(answer), [txt(dA), txt(dB)]);
    return {
      qtype: 'dice' as const,
      difficulty,
      prompt: L(
        `Piega lo sviluppo: quanto fa la somma delle 4 facce che toccano il ${x}?`,
        `Fold up the net: what's the sum of the 4 faces touching the ${x}?`
      ),
      payload,
      choices,
      correctIndex,
      explanation: L(
        `${regola} Le sei facce insieme fanno 1+2+3+4+5+6 = 21: togli il ${x} e la sua opposta ` +
          `(${opp}) e restano le 4 facce che lo toccano, 21 − ${x} − ${opp} = ${answer}.` +
          ` Chi usa la regola del 7 trova sempre 14, ma qui l'opposta del ${x} non è il ${seven}.` +
          inganno,
        `${regolaEn} All six faces together add up to 1+2+3+4+5+6 = 21: take away the ${x} and its opposite ` +
          `(${opp}) and you're left with the 4 faces touching it, 21 − ${x} − ${opp} = ${answer}.` +
          ` Anyone using the rule of 7 always gets 14, but here the opposite of the ${x} isn't the ${seven}.` +
          ingannoEn
      ),
    };
  }

  // distrattore "una casella invece di due": una faccia attaccata sul foglio
  const near = paperNeighbours(layout, qi)
    .map((i) => faces[i])
    .filter((v) => v !== opp && v !== seven);
  const rest = faces.filter((v) => v !== x && v !== opp && v !== seven);
  const adj = pick(rng, near.length ? near : rest);
  const { choices, correctIndex } = placeChoices(rng, txt(opp), [txt(seven), txt(adj)]);
  const prompts: Record<Exclude<NetForm, 'sum'>, string> = {
    opposite: `Piega lo sviluppo e ricostruisci il dado: quale faccia finisce opposta al ${x}?`,
    under: `Pieghi lo sviluppo e appoggi il dado con il ${x} rivolto in alto: quale numero si trova sotto, contro il tavolo?`,
    nottouch: `Piegando lo sviluppo, quale faccia NON tocca mai il ${x}?`,
  };
  const promptsEn: Record<Exclude<NetForm, 'sum'>, string> = {
    opposite: `Fold up the net and rebuild the die: which face ends up opposite the ${x}?`,
    under: `Fold up the net and set the die down with the ${x} facing up: which number ends up on the bottom, against the table?`,
    nottouch: `When you fold up the net, which face NEVER touches the ${x}?`,
  };
  const codas: Record<Exclude<NetForm, 'sum'>, string> = {
    opposite: '',
    under: ` Il numero contro il tavolo è sempre quello opposto alla faccia rivolta in alto.`,
    nottouch: ` Ogni faccia del dado tocca le altre quattro: l'unica che non tocca mai il ${x} è la sua opposta. Il ${adj}, per esempio, gli sta proprio accanto già sul foglio.`,
  };
  const codasEn: Record<Exclude<NetForm, 'sum'>, string> = {
    opposite: '',
    under: ` The number against the table is always the one opposite the face pointing up.`,
    nottouch: ` Every face of the die touches the other four: the only one that never touches the ${x} is its opposite. The ${adj}, for example, is already right next to it on the sheet.`,
  };
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: L(prompts[form], promptsEn[form]),
    payload,
    choices,
    correctIndex,
    explanation: L(regola + codas[form] + sette + inganno, regolaEn + codasEn[form] + setteEn + ingannoEn),
  };
}

/** 4 numeri consecutivi nella striscia: le coppie opposte sembrano "sbagliate" */
function deceptiveStrip(rng: Rng): number[] {
  const n = randInt(rng, 1, 3);
  const run = [n, n + 1, n + 2, n + 3];
  if (chance(rng, 0.5)) run.reverse();
  const rem = shuffle(rng, [1, 2, 3, 4, 5, 6].filter((v) => !run.includes(v)));
  return [run[0], run[1], run[2], run[3], rem[0], rem[1]];
}

// ---------------------------------------------------------------------------
// Tessere con pallini (payload 'cells')
// ---------------------------------------------------------------------------

function dotCell(n: number, color: number): CellSpec {
  return {
    shapes: Array.from({ length: n }, () => ({ shape: 'dot' as const, color, size: 1 })),
    layout: n === 1 ? ('auto' as const) : ('grid' as const),
  };
}

const dotChoice = (n: number, color: number): ChoiceVisual => ({ kind: 'cell', cell: dotCell(n, color) });
const UNKNOWN_CELL: CellSpec = { shapes: [], unknown: true };

/**
 * Massimo di pallini su una tessera. Il renderer li dispone su 3 colonne, quindi
 * fino a 11 restano 4 righe da 3: a 72px (la misura delle opzioni) sono ancora
 * pallini contabili. Serve tutto questo spazio perché intorno alla risposta
 * ci stiano due tessere più ricche E due più povere, tutte staccate fra loro.
 */
const MAX_DOTS = 11;

/** somma minima delle tessere: sotto non ci sono due valori più piccoli plausibili */
const MIN_DOTS_SUM = 8;

/** d1: somma dei pallini di 3 tessere */
function tilesSumQuestion(rng: Rng, counts: number[]): Question {
  const color = randInt(rng, 0, 7);
  const sum = total(counts);
  if (sum < MIN_DOTS_SUM) throw new Error('somma troppo piccola per distrattori equilibrati');
  // errori tipici: saltare una tessera (una in meno), oppure contarne una due
  // volte tornando indietro con l'occhio (una in più)
  const [dA, dB] = numChoices(rng, sum, [
    ...counts.map((n) => sum - n),
    ...counts.map((n) => sum + n),
  ]);
  const { choices, correctIndex } = placeChoices(rng, txt(sum), [txt(dA), txt(dB)]);
  const smallest = Math.min(...counts);
  return {
    qtype: 'dice' as const,
    difficulty: 1,
    prompt: L('Quanti pallini ci sono in tutto sulle tessere?', 'How many dots are there in total on the tiles?'),
    payload: { kind: 'cells' as const, rows: [counts.map((n) => dotCell(n, color))] },
    choices,
    correctIndex,
    explanation: L(
      `Conta i pallini tessera per tessera e somma: ${counts.join(' + ')} = ${sum}. ` +
        `Il trucco: nessuna tessera va saltata (nemmeno quella da ${smallest}) e nessuna va contata due volte.`,
      `Count the dots tile by tile and add them up: ${counts.join(' + ')} = ${sum}. ` +
        `The trick: no tile should be skipped (not even the one with ${smallest}) and none should be counted twice.`
    ),
  };
}

/** la tessera coperta deve valere almeno 6: sotto, la risposta è sempre la più piccola */
const MIN_HIDDEN_TILE = 6;

/** d2: una tessera è coperta e si conosce il totale */
function tilesMissingQuestion(rng: Rng, visible: number[], hidden: number, at: number): Question {
  const color = randInt(rng, 0, 7);
  const seen = total(visible);
  const sum = seen + hidden;
  const counts = [...visible];
  counts.splice(at, 0, hidden);
  const row = counts.map((n, i) => (i === at ? UNKNOWN_CELL : dotCell(n, color)));
  if (hidden < MIN_HIDDEN_TILE) throw new Error('tessera coperta troppo piccola per distrattori equilibrati');
  // errori tipici: rispondere col totale o con la somma delle scoperte;
  // sottrarre una sola tessera invece di tutte; sottrarne una due volte
  const [dA, dB] = numChoices(rng, hidden, [
    sum,
    seen,
    ...visible.map((v) => hidden - v),
    ...visible.map((v) => sum - v),
  ]);
  const { choices, correctIndex } = placeChoices(rng, txt(hidden), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 2,
    prompt: L(
      `Le ${counts.length} tessere hanno in tutto ${sum} pallini. Quanti pallini ha la tessera coperta?`,
      `The ${counts.length} tiles have ${sum} dots in total. How many dots does the covered tile have?`
    ),
    payload: { kind: 'cells' as const, rows: [row] },
    choices,
    correctIndex,
    explanation: L(
      `Le tessere scoperte hanno ${visible.join(' + ')} = ${seen} pallini. Alla tessera coperta tocca ` +
        `tutto il resto: ${sum} − ${seen} = ${hidden}. ` +
        `Il trucco: prima si somma quello che si vede, poi si sottrae dal totale (non il contrario).`,
      `The uncovered tiles have ${visible.join(' + ')} = ${seen} dots. The covered tile gets ` +
        `whatever's left: ${sum} − ${seen} = ${hidden}. ` +
        `The trick: first add up what you can see, then subtract it from the total (not the other way round).`
    ),
  };
}

/** d3: due file devono avere lo stesso totale, una tessera è coperta */
function tilesRowsQuestion(rng: Rng, top: number[], bottom: number[], at: number, hidden: number): Question {
  const color = randInt(rng, 0, 7);
  const sumTop = total(top);
  const seen = total(bottom);
  const row2 = [...bottom];
  row2.splice(at, 0, hidden);
  const rows = [
    top.map((n) => dotCell(n, color)),
    row2.map((n, i) => (i === at ? UNKNOWN_CELL : dotCell(n, color))),
  ];
  // Qui le opzioni sono TESSERE, non numeri, ma le scorciatoie sono le stesse e
  // anzi più visibili: "scegli quella con meno pallini" pagava il 48%, e due
  // tessere da 6 e 7 pallini si somigliano abbastanza da far spiccare la terza
  // ("scegli quella diversa dalle altre due"). La quantità di pallini passa
  // quindi dallo stesso bilanciamento dei numeri, distanza fra i distrattori
  // compresa: nessuna coppia di opzioni si somiglia.
  // Errori tipici: pareggiare colonna per colonna invece della fila intera;
  // dimenticare una tessera di sopra (ne servono di meno) o una di sotto (di più).
  const colWise = top[at];
  const [dA, dB] = numChoices(
    rng,
    hidden,
    [colWise, ...top.map((v) => hidden - v), ...bottom.map((v) => hidden + v)],
    { min: 1, max: MAX_DOTS }
  );
  const { choices, correctIndex } = placeChoices(rng, dotChoice(hidden, color), [
    dotChoice(dA, color),
    dotChoice(dB, color),
  ]);
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: L(
      'Le due file devono avere lo stesso numero di pallini in tutto. Quale tessera va al posto del punto interrogativo?',
      'The two rows need to have the same total number of dots. Which tile goes in place of the question mark?'
    ),
    payload: { kind: 'cells' as const, rows },
    choices,
    correctIndex,
    explanation: L(
      `La fila di sopra ha ${top.join(' + ')} = ${sumTop} pallini. La fila di sotto ne ha già ` +
        `${bottom.join(' + ')} = ${seen}, quindi alla tessera coperta ne servono ${sumTop} − ${seen} = ${hidden}. ` +
        `Il trucco: non bisogna pareggiare colonna per colonna (lì sopra c'è ${colWise}), ma il TOTALE della fila.`,
      `The top row has ${top.join(' + ')} = ${sumTop} dots. The bottom row already has ` +
        `${bottom.join(' + ')} = ${seen}, so the covered tile needs ${sumTop} − ${seen} = ${hidden}. ` +
        `The trick: you don't need to match column by column (the one above has ${colWise}), just the ROW TOTAL.`
    ),
  };
}

/** d3: tre facce visibili di un dado vero, quanto fanno le tre nascoste? */
function hiddenFacesQuestion(rng: Rng, visible: number[]): Question {
  const color = randInt(rng, 0, 7);
  const seen = total(visible);
  const answer = 21 - seen;
  const opposites = visible.map((v) => 7 - v);
  // errori tipici: rispondere con la somma delle facce viste, col totale 21
  // (dimenticando di sottrarre), con un solo 7; sommare due facce nascoste su
  // tre, oppure contarne una due volte
  const [dA, dB] = numChoices(rng, answer, [
    seen,
    21,
    ...opposites.map((o) => answer - o),
    7,
    ...opposites.map((o) => answer + o),
  ]);
  const { choices, correctIndex } = placeChoices(rng, txt(answer), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: L(
      'Di un dado vero (facce opposte che sommano sempre 7) vedi queste tre facce. ' +
        'Quanti pallini hanno in tutto le tre facce che NON vedi?',
      'On a real die (opposite faces always add up to 7), you can see these three faces. ' +
        'How many dots do the three faces you CANNOT see have in total?'
    ),
    payload: { kind: 'cells' as const, rows: [visible.map((n) => dotCell(n, color))] },
    choices,
    correctIndex,
    explanation: L(
      `Le tre facce nascoste sono le opposte di quelle che vedi: 7−${visible[0]} = ${opposites[0]}, ` +
        `7−${visible[1]} = ${opposites[1]} e 7−${visible[2]} = ${opposites[2]}, che sommate fanno ${answer}. ` +
        `Più veloce ancora: tutte e sei le facce insieme fanno 1+2+3+4+5+6 = 21, e quelle che vedi ne ` +
        `prendono ${visible.join('+')} = ${seen}, quindi alle nascoste restano 21 − ${seen} = ${answer}. ` +
        (dA === seen || dB === seen
          ? `Il trucco: la somma delle tre facce visibili (${seen}) è la risposta sbagliata più tentatrice.`
          : `Il trucco: le tre facce nascoste vanno sommate tutte e tre, e nessuna va contata due volte.`),
      `The three hidden faces are the opposites of the ones you can see: 7−${visible[0]} = ${opposites[0]}, ` +
        `7−${visible[1]} = ${opposites[1]} and 7−${visible[2]} = ${opposites[2]}, which add up to ${answer}. ` +
        `Even faster: all six faces together add up to 1+2+3+4+5+6 = 21, and the ones you can see ` +
        `take up ${visible.join('+')} = ${seen}, so the hidden ones are left with 21 − ${seen} = ${answer}. ` +
        (dA === seen || dB === seen
          ? `The trick: the sum of the three visible faces (${seen}) is the most tempting wrong answer.`
          : `The trick: all three hidden faces need to be added up, and none should be counted twice.`)
    ),
  };
}

// ---------------------------------------------------------------------------
// Difficoltà
// ---------------------------------------------------------------------------

function genD1(rng: Rng): Question {
  switch (
    weighted(rng, [
      ['count-block', 10],
      ['count-line', 16],
      ['touch', 18],
      ['faces', 12],
      ['tiles', 22],
      ['groups', 22],
    ])
  ) {
    case 'count-block': {
      // blocco 2×2 o 2×3: si risolve contando con calma
      const [rows, cols] = pick(rng, [[2, 2], [2, 3], [3, 2]] as const);
      const grid = makeReadableGrid(rng, rows, cols, 1, pick(rng, [2, 3, 4]), (g) => gridSum(g) >= MIN_CUBES);
      return countQuestion(rng, 1, grid);
    }
    case 'count-line': {
      const n = pick(rng, [3, 4, 5]);
      const heights = Array.from({ length: n }, () => randInt(rng, 1, 3));
      return countQuestion(rng, 1, lineGrid(heights, chance(rng, 0.5)), NOTE_LINE, NOTE_LINE_EN);
    }
    case 'touch': {
      // Fila di pile con due buchi. Serve una base LUNGA: distinctPiles() vieta
      // due pile sulla stessa diagonale, e in un blocco 2×3 le pile distinte non
      // arriverebbero mai a MIN_PILES.
      const piles = randInt(rng, MIN_PILES, 8);
      const heights = shuffle(rng, [
        ...Array.from({ length: piles }, () => randInt(rng, 1, 3)),
        0,
        0,
      ]);
      return touchQuestion(rng, 1, lineGrid(heights, chance(rng, 0.5)));
    }
    case 'faces': {
      // una torre sola è l'ingresso più facile, ma di torri singole ne esistono
      // pochissime: va tenuta rara o le domande si ripetono
      const heights = chance(rng, 0.18)
        ? [randInt(rng, 3, 7)]
        : [randInt(rng, 2, 6), randInt(rng, 1, 6)];
      return facesQuestion(rng, 1, shuffle(rng, heights), chance(rng, 0.5));
    }
    case 'tiles':
      return tilesSumQuestion(rng, Array.from({ length: pick(rng, [3, 4]) }, () => randInt(rng, 1, 6)));
    default:
      return groupsQuestion(rng, 1, 'which', pick(rng, [2, 3]), 6, 1, 3);
  }
}

function genD2(rng: Rng): Question {
  switch (
    weighted(rng, [
      ['count-hidden', 14],
      ['net-cross', 10],
      ['net-general', 22],
      ['groups-which', 10],
      ['groups-diff', 12],
      ['faces', 12],
      ['tiles', 20],
    ])
  ) {
    case 'count-hidden': {
      // base piena con almeno una colonna dietro più bassa di quella davanti
      const [rows, cols] = pick(rng, [[3, 3], [3, 4], [4, 3], [2, 4], [4, 2]] as const);
      const grid = makeReadableGrid(rng, rows, cols, 1, 3, hasHiddenColumn);
      return countQuestion(rng, 2, grid);
    }
    case 'net-cross':
      return netQuestion(rng, 2, shuffle(rng, [1, 2, 3, 4, 5, 6]), false);
    case 'net-general':
      return netGeneralQuestion(
        rng,
        2,
        pick(rng, NET_LAYOUTS),
        shuffle(rng, [1, 2, 3, 4, 5, 6]),
        pick(rng, ['opposite', 'under', 'nottouch'] as const),
        false
      );
    case 'groups-which':
      return groupsQuestion(rng, 2, 'which', pick(rng, [2, 3]), 6, 1, 3);
    case 'groups-diff':
      // la differenza deve valere almeno MIN_GROUP_DIFF, altrimenti sotto di lei
      // non esistono due errori plausibili e la risposta è sempre la più piccola
      return groupsQuestion(rng, 2, 'diff', pick(rng, [3, 4]), 6, MIN_GROUP_DIFF, 7);
    case 'faces': {
      const heights = [randInt(rng, 2, 6), randInt(rng, 1, 6)];
      if (chance(rng, 0.35)) heights.push(randInt(rng, 1, 4));
      return facesQuestion(rng, 2, shuffle(rng, heights), chance(rng, 0.5));
    }
    default: {
      const visible = Array.from({ length: 3 }, () => randInt(rng, 2, 8));
      return tilesMissingQuestion(rng, visible, randInt(rng, MIN_HIDDEN_TILE, MAX_DOTS), randInt(rng, 0, 3));
    }
  }
}

function genD3(rng: Rng): Question {
  switch (
    weighted(rng, [
      ['missing', 15],
      ['net-cross', 6],
      ['net-general', 24],
      ['groups-diff', 13],
      ['faces', 10],
      ['tiles-rows', 17],
      ['hidden-faces', 15],
    ])
  ) {
    case 'missing': {
      // pila "da completare": serve immaginare i cubi che non ci sono.
      // Le pile devono restare distinguibili (serve leggere ogni altezza):
      // nelle basi larghe qualche posto resta per forza vuoto.
      const [rows, cols] = pick(rng, [[1, 3], [1, 4], [1, 5], [3, 1], [4, 1], [5, 1], [2, 2], [2, 3], [3, 2]] as const);
      const flat = rows === 1 || cols === 1;
      const grid = makeReadableGrid(rng, rows, cols, flat ? 1 : 0, 4, (g) => {
        const hs = g.flat();
        const maxH = Math.max(...hs);
        return (
          maxH >= 3 &&
          hs.filter((h) => h > 0).length >= 3 &&
          maxH * rows * cols - gridSum(g) >= MIN_MISSING &&
          distinctPiles(g)
        );
      });
      return missingQuestion(rng, grid);
    }
    case 'net-cross':
      return netQuestion(rng, 3, deceptiveFaces(rng), true);
    case 'net-general': {
      const deceptive = chance(rng, 0.5);
      return netGeneralQuestion(
        rng,
        3,
        pick(rng, NET_LAYOUTS),
        deceptive ? deceptiveStrip(rng) : shuffle(rng, [1, 2, 3, 4, 5, 6]),
        weighted(rng, [
          ['sum', 40],
          ['nottouch', 20],
          ['under', 20],
          ['opposite', 20],
        ]) as NetForm,
        deceptive
      );
    }
    case 'groups-diff':
      return groupsQuestion(rng, 3, 'diff', pick(rng, [3, 4]), 6, MIN_GROUP_DIFF, 8);
    case 'faces':
      return facesQuestion(
        rng,
        3,
        shuffle(rng, [randInt(rng, 2, 6), randInt(rng, 1, 6), randInt(rng, 1, 6)]),
        chance(rng, 0.5)
      );
    case 'tiles-rows': {
      const top = Array.from({ length: 3 }, () => randInt(rng, 2, 6));
      // La tessera coperta sta fra 5 e 7 pallini: sotto il 5 non esistono due
      // tessere più POVERE staccate fra loro (si scende sotto un pallino), sopra
      // il 7 non ce ne stanno due più ricche entro MAX_DOTS — e in un caso o
      // nell'altro la risposta sarebbe sempre la più magra o sempre la più
      // grassa delle tre (era "scegli quella con meno pallini", 48%).
      const hidden = randInt(rng, 5, 7);
      const rest = total(top) - hidden;
      if (rest < 2 || rest > 12) throw new Error('fila inferiore non costruibile');
      const bottom = partition(rng, rest, 2, 1, 6);
      return tilesRowsQuestion(rng, top, bottom, randInt(rng, 0, 2), hidden);
    }
    default: {
      // tre facce che si toccano davvero in un angolo del dado: mai due opposte
      const visible = shuffle(rng, [
        pick(rng, [1, 6]),
        pick(rng, [2, 5]),
        pick(rng, [3, 4]),
      ]);
      return hiddenFacesQuestion(rng, visible);
    }
  }
}

export function genDice(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => (difficulty === 1 ? genD1(rng) : difficulty === 2 ? genD2(rng) : genD3(rng)), 40);
}
