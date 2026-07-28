// Domande gemelle: stessa struttura visiva, risposta diversa.
//
// È la trappola per chi gioca a memoria. Una gemella si presenta con la stessa
// aria di famiglia della domanda originale (stesso tipo, stessa disposizione,
// stesso numero di elementi) ma un parametro cambiato sposta la risposta.
// Chi risponde "questa la so, era la C" sbaglia; chi guarda davvero indovina.
//
// La generazione è per tentativi: si rigenera dallo stesso generatore finché
// non esce una domanda con lo stesso scheletro dell'originale ma soluzione
// differente. Non è garantito che riesca — in tal caso non c'è gemella e il
// round resta normale.

import type { Question } from '../types';
import type { Rng } from '../rng';
import { GENERATORS } from './index';
import { skeletonOf } from './skeleton';
import { reshuffleChoices } from './live';

/** quanto insistere prima di rinunciare alla gemella */
const MAX_ATTEMPTS = 400;

/** confronto strutturale della risposta corretta delle due domande */
function sameAnswer(a: Question, b: Question): boolean {
  return JSON.stringify(a.choices[a.correctIndex]) === JSON.stringify(b.choices[b.correctIndex]);
}

/**
 * Cerca una gemella di `q`: stesso scheletro, risposta diversa.
 * @returns la gemella, oppure null se non ne è emersa una.
 */
export function findTwin(q: Question, rng: Rng): Question | null {
  const target = skeletonOf(q);
  const gen = GENERATORS[q.qtype];
  if (!gen) return null;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    let candidate: Question;
    try {
      candidate = gen(rng, q.difficulty);
    } catch {
      continue;
    }
    if (skeletonOf(candidate) !== target) continue;
    // deve essere una domanda diversa, non la stessa ripresentata
    if (JSON.stringify(candidate.payload) === JSON.stringify(q.payload)) continue;
    const shuffled = reshuffleChoices(candidate, rng);
    if (sameAnswer(shuffled, q)) continue; // stessa risposta: non ingannerebbe nessuno
    return shuffled;
  }
  return null;
}

/**
 * Domande già viste in partita, per pescare quella da "gemellare".
 * Tiene solo le ultime, così la gemella arriva quando il ricordo è fresco.
 */
export class TwinPool {
  private seen: Question[] = [];
  constructor(private readonly capacity = 12) {}

  add(q: Question) {
    this.seen.push(q);
    if (this.seen.length > this.capacity) this.seen.shift();
  }

  /**
   * Prova a costruire una gemella di una domanda vista di recente.
   * Preferisce quelle mostrate qualche round fa: abbastanza vicine da
   * ricordarsele, abbastanza lontane da non essere ovvio che sia un bis.
   */
  makeTwin(rng: Rng): { twin: Question; original: Question } | null {
    if (this.seen.length < 2) return null;
    const candidates = [...this.seen].reverse().slice(1, 8); // salta l'ultimissima
    for (const original of candidates) {
      const twin = findTwin(original, rng);
      if (twin) return { twin, original };
    }
    return null;
  }
}
