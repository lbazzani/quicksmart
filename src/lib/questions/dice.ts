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
import { placeChoices, retry } from './qutils';

const txt = (n: number | string): ChoiceVisual => ({ kind: 'text', text: String(n) });

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

/** due distrattori numerici distinti, ≥1 e diversi dalla risposta corretta */
function pickTwo(rng: Rng, candidates: number[], correct: number): [number, number] {
  const uniq = [...new Set(shuffle(rng, candidates).filter((v) => v >= 1 && v !== correct))];
  if (uniq.length < 2) throw new Error('distrattori insufficienti');
  return [uniq[0], uniq[1]];
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

function countQuestion(rng: Rng, difficulty: Difficulty, grid: number[][], note = NOTE_BLOCK): Question {
  const sum = gridSum(grid);
  // errore tipico: contare solo le colonne che si vedono (una per pila)
  const visibleCols = grid.flat().filter((h) => h > 0).length;
  const [dA, dB] = pickTwo(rng, [sum - 1, sum + 1, sum - 2, sum + 2, visibleCols], sum);
  const { choices, correctIndex } = placeChoices(rng, txt(sum), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: 'Quanti cubi ci sono in totale?',
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: `Somma le altezze di tutte le colonne, riga per riga: ${sumText(grid)} = ${sum} cubi. ` + note,
  };
}

// ---------------------------------------------------------------------------
// B: cubi mancanti per completare il parallelepipedo (d3)
// ---------------------------------------------------------------------------

function missingQuestion(rng: Rng, grid: number[][]): Question {
  const sum = gridSum(grid);
  const maxH = Math.max(...grid.flat());
  const rows = grid.length;
  const cols = grid[0].length;
  const box = maxH * rows * cols;
  const missing = box - sum;
  // errori tipici: rispondere con i cubi presenti, oppure sbagliare il conto di poco
  const [dA, dB] = pickTwo(rng, [sum, missing - 1, missing + 1, missing + 2, missing - 2], missing);
  const { choices, correctIndex } = placeChoices(rng, txt(missing), [txt(dA), txt(dB)]);
  const wall = rows === 1 || cols === 1;
  const what = wall
    ? `il muro (una fila di ${rows * cols} colonne, alto quanto la colonna più alta)`
    : `il parallelepipedo (base ${rows}×${cols}, alto quanto la colonna più alta)`;
  const empty = grid.flat().filter((h) => h === 0).length;
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: `Quanti cubi mancano per completare ${what}?`,
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation:
      `Completo, ${wall ? 'il muro' : 'il parallelepipedo'} sarebbe ${rows}×${cols}×${maxH} = ${box} cubi. ` +
      `Adesso ce ne sono ${sumText(grid)} = ${sum}, quindi ne mancano ${box} − ${sum} = ${missing}. ` +
      (empty > 0 ? `Occhio ai ${empty === 1 ? 'posto vuoto' : `${empty} posti vuoti`} della base: ${empty === 1 ? 'anche quello va riempito' : 'vanno riempiti anche quelli'} fino in cima. ` : '') +
      `Il trucco: la domanda chiede i cubi mancanti, non quelli presenti (${sum}).`,
  };
}

// ---------------------------------------------------------------------------
// E: quanti cubi toccano il tavolo (= quante pile)
// ---------------------------------------------------------------------------

function touchQuestion(rng: Rng, difficulty: Difficulty, grid: number[][]): Question {
  const heights = grid.flat();
  const piles = heights.filter((h) => h > 0).length;
  const cubes = total(heights);
  const cells = grid.length * grid[0].length;
  // errori tipici: contare TUTTI i cubi, contare le caselle della base
  // (comprese quelle vuote), contare i cubi che stanno sopra gli altri
  const [dA, dB] = pickTwo(rng, [cubes, cells, cubes - piles, piles + 1, Math.max(...heights)], piles);
  const { choices, correctIndex } = placeChoices(rng, txt(piles), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: 'Quanti cubi toccano il tavolo?',
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation:
      `Ogni pila appoggia sul tavolo con un cubo solo, quello in fondo: basta quindi contare le pile, ` +
      `e le pile sono ${piles}. Il trucco: i cubi in tutto sono ${cubes}, ma quelli appoggiati sopra ` +
      `un altro cubo (${cubes - piles}) il tavolo non lo toccano.`,
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
  // errori tipici: 3 facce per ogni cubo, dimenticare i coperchi, contare i cubi
  const [dA, dB] = pickTwo(rng, [3 * cubes, 2 * cubes, faces + 1, faces - 1, cubes], faces);
  const { choices, correctIndex } = placeChoices(rng, txt(faces), [txt(dA), txt(dB)]);
  const perTower = heights.map((h) => `2×${h}+1 = ${2 * h + 1}`).join(', ');
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: 'Quante facce dei cubi si vedono da questa angolazione?',
    payload: { kind: 'dicestack' as const, grid: towersGrid(heights, vertical) },
    choices,
    correctIndex,
    explanation:
      `Di ogni cubo si vedono al massimo tre facce: il coperchio e i due fianchi. Ma il coperchio di un ` +
      `cubo che ne ha un altro sopra è coperto: in una torre alta h si vedono h fianchi a sinistra, ` +
      `h fianchi a destra e UN solo coperchio, cioè 2×h+1 facce. ` +
      (towers === 1
        ? `Qui la torre è alta ${heights[0]}: ${perTower} facce.`
        : `Qui: ${perTower}, in tutto ${faces} facce.`) +
      ` Il trucco: 3 facce per cubo (${3 * cubes}) sarebbe giusto solo con i cubi tutti staccati.`,
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
 * Due gruppi con LO STESSO numero di pile: quello che ha più cubi non ha la
 * pila più alta. Così chi conta le pile risponde "pari" e chi guarda la torre
 * più alta sbaglia gruppo: bisogna contare i cubi davvero.
 */
function buildGroups(rng: Rng, n: number, tallMax: number, diffMax: number) {
  const tall = randInt(rng, n === 2 ? 4 : 3, tallMax);
  const loser = shuffle(rng, [tall, ...Array.from({ length: n - 1 }, () => randInt(rng, 1, 2))]);
  const loserSum = total(loser);
  const room = n * (tall - 1) - loserSum; // quanto può stare sopra il perdente
  if (room < 1) throw new Error('gruppi non costruibili');
  const diff = randInt(rng, 1, Math.min(diffMax, room));
  const winner = shuffle(rng, partition(rng, loserSum + diff, n, 1, tall - 1));
  return { winner, loser, winnerSum: loserSum + diff, loserSum, diff, tall, n };
}

function groupsQuestion(rng: Rng, difficulty: Difficulty, form: 'which' | 'diff', n: number, tallMax: number, diffMax: number): Question {
  const g = buildGroups(rng, n, tallMax, diffMax);
  const vertical = chance(rng, 0.5);
  const winnerFirst = chance(rng, 0.5);
  const first = winnerFirst ? g.winner : g.loser;
  const second = winnerFirst ? g.loser : g.winner;
  const grid = lineGrid([...first, 0, 0, ...second], vertical);
  const labA = vertical ? 'in alto a destra' : 'in alto a sinistra';
  const labB = vertical ? 'in basso a sinistra' : 'in basso a destra';
  const win = winnerFirst ? 'A' : 'B';
  const lose = winnerFirst ? 'B' : 'A';
  const intro = `Due gruppi di cubi: il gruppo A (${labA}) e il gruppo B (${labB}).`;
  const conti =
    `Il gruppo ${win} ha ${g.winner.join('+')} = ${g.winnerSum} cubi, ` +
    `il gruppo ${lose} ne ha ${g.loser.join('+')} = ${g.loserSum}.`;
  const trap =
    ` Due trappole: i gruppi hanno lo stesso numero di pile (${g.n} e ${g.n}), e la pila più alta ` +
    `(${g.tall} cubi) sta nel gruppo ${lose}, quello che ne ha di meno. Bisogna contare i cubi, non le pile!`;

  if (form === 'which') {
    const other: ChoiceVisual = txt(lose);
    const pari: ChoiceVisual = txt('Pari');
    const distr: [ChoiceVisual, ChoiceVisual] = chance(rng, 0.5) ? [other, pari] : [pari, other];
    const { choices, correctIndex } = placeChoices(rng, txt(win), distr);
    return {
      qtype: 'dice' as const,
      difficulty,
      prompt: `${intro} Quale gruppo ha più cubi? (Rispondi A, B oppure "Pari" se ne hanno uguali.)`,
      payload: { kind: 'dicestack' as const, grid },
      choices,
      correctIndex,
      explanation: `${conti} Quindi ne ha di più il gruppo ${win}.` + trap,
    };
  }

  const [dA, dB] = pickTwo(
    rng,
    [g.winnerSum, g.loserSum, g.diff + 1, g.diff + 2, g.winnerSum + g.loserSum],
    g.diff
  );
  const { choices, correctIndex } = placeChoices(rng, txt(g.diff), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: `${intro} Quanti cubi ha in più il gruppo ${win} rispetto all'altro?`,
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation: `${conti} La differenza è ${g.winnerSum} − ${g.loserSum} = ${g.diff} cubi.` + trap,
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
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: `Nel dado piegato, quale faccia è opposta al ${x}?`,
    payload: { kind: 'dicenet' as const, net },
    choices,
    correctIndex,
    explanation:
      `Piegando la croce, nella riga centrale sono opposte le facce a due caselle di distanza ` +
      `(${faces[1]}–${faces[3]} e ${faces[2]}–${faces[4]}), mentre l'aletta in alto (${faces[0]}) ` +
      `è opposta a quella in basso (${faces[5]}). Quindi il ${x} è opposto al ${opp}. ` +
      `Attenzione: la "regola del 7" (opposte che sommano 7) vale solo per i dadi standard, ` +
      `non per questo sviluppo: ${seven} qui è una faccia adiacente al ${x}.` + trap,
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
  const regola =
    `Nello sviluppo, due facce della ${dir} lunga separate da una casella finiscono una di fronte ` +
    `all'altra: ${faces[0]}–${faces[2]} e ${faces[1]}–${faces[3]}. Restano le due alette, ${faces[4]} e ` +
    `${faces[5]}: per forza sono opposte fra loro. Quindi il ${x} è opposto al ${opp}.`;
  const sette =
    ` Attenzione alla "regola del 7" (facce opposte che sommano 7): vale sui dadi veri, ma qui i numeri ` +
    `sono messi in un altro ordine e il ${seven} è una faccia che TOCCA il ${x}.`;
  const inganno = deceptive
    ? ` I numeri consecutivi messi vicini ingannano l'occhio: conta le caselle, non i valori.`
    : '';

  if (form === 'sum') {
    const answer = 21 - x - opp;
    // errori tipici: dimenticare di togliere anche l'opposta; usare la regola del 7
    const [dA, dB] = pickTwo(rng, [21 - x, 14, answer + 1, answer - 1, 21 - opp], answer);
    const { choices, correctIndex } = placeChoices(rng, txt(answer), [txt(dA), txt(dB)]);
    return {
      qtype: 'dice' as const,
      difficulty,
      prompt: `Piega lo sviluppo: quanto fa la somma delle 4 facce che toccano il ${x}?`,
      payload,
      choices,
      correctIndex,
      explanation:
        `${regola} Le sei facce insieme fanno 1+2+3+4+5+6 = 21: togli il ${x} e la sua opposta ` +
        `(${opp}) e restano le 4 facce che lo toccano, 21 − ${x} − ${opp} = ${answer}.` +
        ` Chi usa la regola del 7 trova sempre 14, ma qui l'opposta del ${x} non è il ${seven}.` +
        inganno,
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
  const codas: Record<Exclude<NetForm, 'sum'>, string> = {
    opposite: '',
    under: ` Il numero contro il tavolo è sempre quello opposto alla faccia rivolta in alto.`,
    nottouch: ` Ogni faccia del dado tocca le altre quattro: l'unica che non tocca mai il ${x} è la sua opposta. Il ${adj}, per esempio, gli sta proprio accanto già sul foglio.`,
  };
  return {
    qtype: 'dice' as const,
    difficulty,
    prompt: prompts[form],
    payload,
    choices,
    correctIndex,
    explanation: regola + codas[form] + sette + inganno,
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

/** d1: somma dei pallini di 3 tessere */
function tilesSumQuestion(rng: Rng, counts: number[]): Question {
  const color = randInt(rng, 0, 7);
  const sum = total(counts);
  // errori tipici: dimenticare una tessera, contare male di uno, contare le tessere
  const [dA, dB] = pickTwo(
    rng,
    [sum - counts[counts.length - 1], sum - counts[0], sum + 1, sum - 1, counts.length],
    sum
  );
  const { choices, correctIndex } = placeChoices(rng, txt(sum), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 1,
    prompt: 'Quanti pallini ci sono in tutto sulle tessere?',
    payload: { kind: 'cells' as const, rows: [counts.map((n) => dotCell(n, color))] },
    choices,
    correctIndex,
    explanation:
      `Conta i pallini tessera per tessera e somma: ${counts.join(' + ')} = ${sum}. ` +
      `Il trucco: nessuna tessera va saltata, nemmeno quella con un pallino solo.`,
  };
}

/** d2: una tessera è coperta e si conosce il totale */
function tilesMissingQuestion(rng: Rng, visible: number[], hidden: number, at: number): Question {
  const color = randInt(rng, 0, 7);
  const seen = total(visible);
  const sum = seen + hidden;
  const counts = [...visible];
  counts.splice(at, 0, hidden);
  const row = counts.map((n, i) => (i === at ? UNKNOWN_CELL : dotCell(n, color)));
  // errori tipici: rispondere col totale, con la somma di quelle scoperte, sbagliare di uno
  const [dA, dB] = pickTwo(rng, [sum, seen, hidden + 1, hidden - 1, sum - visible[0]], hidden);
  const { choices, correctIndex } = placeChoices(rng, txt(hidden), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 2,
    prompt: `Le ${counts.length} tessere hanno in tutto ${sum} pallini. Quanti pallini ha la tessera coperta?`,
    payload: { kind: 'cells' as const, rows: [row] },
    choices,
    correctIndex,
    explanation:
      `Le tessere scoperte hanno ${visible.join(' + ')} = ${seen} pallini. Alla tessera coperta tocca ` +
      `tutto il resto: ${sum} − ${seen} = ${hidden}. ` +
      `Il trucco: prima si somma quello che si vede, poi si sottrae dal totale (non il contrario).`,
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
  // errori tipici: pareggiare colonna per colonna invece della fila intera; contare male di uno
  const colWise = top[at];
  const near = hidden + (hidden >= 6 ? -1 : 1);
  if (colWise === hidden || near === hidden || colWise === near) throw new Error('distrattori non distinti');
  const { choices, correctIndex } = placeChoices(rng, dotChoice(hidden, color), [
    dotChoice(colWise, color),
    dotChoice(near, color),
  ]);
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: 'Le due file devono avere lo stesso numero di pallini in tutto. Quale tessera va al posto del punto interrogativo?',
    payload: { kind: 'cells' as const, rows },
    choices,
    correctIndex,
    explanation:
      `La fila di sopra ha ${top.join(' + ')} = ${sumTop} pallini. La fila di sotto ne ha già ` +
      `${bottom.join(' + ')} = ${seen}, quindi alla tessera coperta ne servono ${sumTop} − ${seen} = ${hidden}. ` +
      `Il trucco: non bisogna pareggiare colonna per colonna (lì sopra c'è ${colWise}), ma il TOTALE della fila.`,
  };
}

/** d3: tre facce visibili di un dado vero, quanto fanno le tre nascoste? */
function hiddenFacesQuestion(rng: Rng, visible: number[]): Question {
  const color = randInt(rng, 0, 7);
  const seen = total(visible);
  const answer = 21 - seen;
  const opposites = visible.map((v) => 7 - v);
  // errori tipici: rispondere con la somma visibile, col totale 21, con un solo 7
  const [dA, dB] = pickTwo(rng, [seen, 21, answer + 1, answer - 1, 7], answer);
  const { choices, correctIndex } = placeChoices(rng, txt(answer), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt:
      'Di un dado vero (facce opposte che sommano sempre 7) vedi queste tre facce. ' +
      'Quanti pallini hanno in tutto le tre facce che NON vedi?',
    payload: { kind: 'cells' as const, rows: [visible.map((n) => dotCell(n, color))] },
    choices,
    correctIndex,
    explanation:
      `Le tre facce nascoste sono le opposte di quelle che vedi: 7−${visible[0]} = ${opposites[0]}, ` +
      `7−${visible[1]} = ${opposites[1]} e 7−${visible[2]} = ${opposites[2]}, che sommate fanno ${answer}. ` +
      `Più veloce ancora: tutte e sei le facce insieme fanno 1+2+3+4+5+6 = 21, e quelle che vedi ne ` +
      `prendono ${visible.join('+')} = ${seen}, quindi alle nascoste restano 21 − ${seen} = ${answer}. ` +
      `Il trucco: la somma delle tre facce visibili (${seen}) è la risposta sbagliata più tentatrice.`,
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
      // blocco 2×2: si risolve contando con calma
      const grid = makeReadableGrid(rng, 2, 2, 1, pick(rng, [2, 3, 4]));
      return countQuestion(rng, 1, grid);
    }
    case 'count-line': {
      const n = pick(rng, [3, 5]);
      const heights = Array.from({ length: n }, () => randInt(rng, 1, 3));
      return countQuestion(rng, 1, lineGrid(heights, chance(rng, 0.5)), NOTE_LINE);
    }
    case 'touch': {
      const [rows, cols] = pick(rng, [[2, 2], [2, 3], [3, 2]] as const);
      const grid = makeReadableGrid(rng, rows, cols, 0, 3, (g) => {
        const hs = g.flat();
        const piles = hs.filter((h) => h > 0).length;
        return piles >= 2 && piles < hs.length && hs.some((h) => h > 1) && distinctPiles(g);
      });
      return touchQuestion(rng, 1, grid);
    }
    case 'faces': {
      const heights = chance(rng, 0.3)
        ? [randInt(rng, 2, 6)]
        : [randInt(rng, 2, 6), randInt(rng, 1, 6)];
      return facesQuestion(rng, 1, shuffle(rng, heights), chance(rng, 0.5));
    }
    case 'tiles':
      return tilesSumQuestion(rng, Array.from({ length: 3 }, () => randInt(rng, 1, 6)));
    default:
      return groupsQuestion(rng, 1, 'which', pick(rng, [2, 3]), 6, 3);
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
      // 3×3 con almeno una colonna dietro più bassa di quella davanti
      const grid = makeReadableGrid(rng, 3, 3, 1, 3, hasHiddenColumn);
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
      return groupsQuestion(rng, 2, 'which', pick(rng, [2, 3]), 6, 3);
    case 'groups-diff':
      return groupsQuestion(rng, 2, 'diff', pick(rng, [2, 3]), 6, 3);
    case 'faces':
      return facesQuestion(rng, 2, [randInt(rng, 2, 6), randInt(rng, 1, 6)], chance(rng, 0.5));
    default: {
      const visible = Array.from({ length: 3 }, () => randInt(rng, 1, 6));
      return tilesMissingQuestion(rng, visible, randInt(rng, 1, 6), randInt(rng, 0, 3));
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
          maxH * rows * cols - gridSum(g) >= 2 &&
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
      return groupsQuestion(rng, 3, 'diff', 3, 5, 4);
    case 'faces':
      return facesQuestion(
        rng,
        3,
        shuffle(rng, [randInt(rng, 2, 6), randInt(rng, 1, 6), randInt(rng, 1, 6)]),
        chance(rng, 0.5)
      );
    case 'tiles-rows': {
      const top = Array.from({ length: 3 }, () => randInt(rng, 2, 6));
      const hidden = randInt(rng, 1, 6);
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
