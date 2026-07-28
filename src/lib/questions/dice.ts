// Generatore "dice": dadi e cubi, due sotto-modi.
// Modo A (conteggio cubi): pila isometrica, grid[riga][colonna] = altezza.
// Modo B (sviluppo del dado): croce 3×4, trovare la faccia opposta.
// d1: conteggio 2×2 semplice. d2: conteggio 3×3 con colonne nascoste dietro
// pile più alte, oppure sviluppo del dado. d3: cubi mancanti per completare
// il parallelepipedo, oppure sviluppo con pip consecutivi adiacenti (trappola:
// la "regola del 7" NON vale). Distrattori: errori tipici, mai casuali.

import type { ChoiceVisual, Difficulty, Question } from '../types';
import { chance, pick, randInt, shuffle, type Rng } from '../rng';
import { placeChoices, retry } from './qutils';

const txt = (n: number): ChoiceVisual => ({ kind: 'text', text: String(n) });

function gridSum(grid: number[][]): number {
  return grid.flat().reduce((a, b) => a + b, 0);
}

function makeGrid(rng: Rng, rows: number, cols: number, minH: number, maxH: number): number[][] {
  return Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => randInt(rng, minH, maxH))
  );
}

/** vero se almeno una colonna dietro è più bassa di quella davanti (resta nascosta) */
function hasHiddenColumn(grid: number[][]): boolean {
  for (let r = 1; r < grid.length; r++)
    for (let c = 0; c < grid[r].length; c++)
      if (grid[r][c] > grid[r - 1][c]) return true;
  return false;
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

// ---------------------------------------------------------------------------
// Modo A: conteggio cubi
// ---------------------------------------------------------------------------

function countQuestion(rng: Rng, difficulty: Difficulty, grid: number[][]): Question {
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
    explanation:
      `Somma le altezze di tutte le colonne, riga per riga: ${sumText(grid)} = ${sum} cubi. ` +
      `Il trucco: contano anche i cubi nascosti dietro le pile più alte, non solo quelli che si vedono!`,
  };
}

// ---------------------------------------------------------------------------
// Modo A "mancanti" (d3): completare il parallelepipedo
// ---------------------------------------------------------------------------

function missingQuestion(rng: Rng, grid: number[][]): Question {
  const sum = gridSum(grid);
  const maxH = Math.max(...grid.flat());
  const rows = grid.length;
  const cols = grid[0].length;
  const total = maxH * rows * cols;
  const missing = total - sum;
  // errori tipici: rispondere con i cubi presenti, oppure sbagliare il conto di poco
  const [dA, dB] = pickTwo(rng, [sum, missing - 1, missing + 1, missing + 2, missing - 2], missing);
  const { choices, correctIndex } = placeChoices(rng, txt(missing), [txt(dA), txt(dB)]);
  return {
    qtype: 'dice' as const,
    difficulty: 3,
    prompt: `Quanti cubi mancano per completare il parallelepipedo (base ${rows}×${cols}, alto quanto la colonna più alta)?`,
    payload: { kind: 'dicestack' as const, grid },
    choices,
    correctIndex,
    explanation:
      `Il parallelepipedo completo avrebbe ${rows}×${cols}×${maxH} = ${total} cubi. ` +
      `Nella pila ce ne sono ${sumText(grid)} = ${sum}, quindi ne mancano ${total} − ${sum} = ${missing}. ` +
      `Il trucco: la domanda chiede i cubi mancanti, non quelli presenti (${sum}).`,
  };
}

// ---------------------------------------------------------------------------
// Modo B: sviluppo (croce) del dado
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

// ---------------------------------------------------------------------------

export function genDice(rng: Rng, difficulty: Difficulty): Question {
  return retry(() => {
    if (difficulty === 1) {
      // 2×2, altezze 1–2: si risolve contando con calma
      return countQuestion(rng, difficulty, makeGrid(rng, 2, 2, 1, 2));
    }
    if (difficulty === 2) {
      if (chance(rng, 0.5)) {
        // 3×3 con almeno una colonna dietro nascosta da una pila più alta davanti
        let grid = makeGrid(rng, 3, 3, 1, 3);
        while (!hasHiddenColumn(grid)) grid = makeGrid(rng, 3, 3, 1, 3);
        return countQuestion(rng, difficulty, grid);
      }
      return netQuestion(rng, difficulty, shuffle(rng, [1, 2, 3, 4, 5, 6]), false);
    }
    // difficoltà 3
    if (chance(rng, 0.5)) {
      // pila "da completare": serve immaginare i cubi che non ci sono
      let grid = makeGrid(rng, 3, 3, 1, 4);
      while (Math.max(...grid.flat()) < 3 || Math.max(...grid.flat()) * 9 - gridSum(grid) < 2) {
        grid = makeGrid(rng, 3, 3, 1, 4);
      }
      return missingQuestion(rng, grid);
    }
    return netQuestion(rng, difficulty, deceptiveFaces(rng), true);
  });
}
