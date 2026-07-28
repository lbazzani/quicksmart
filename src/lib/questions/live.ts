// Fornitura di domande a tempo di gioco.
//
// Il gioco NON pesca da un archivio fisso: genera al volo con un seme casuale,
// così lo spazio giocabile è quello vero dei generatori (decine di milioni) e
// non le poche centinaia seminate nel database. L'archivio su Postgres resta
// come rete di sicurezza e come vetrina per l'audit.
//
// Tre difese contro chi gioca a memoria:
//  1. generazione al volo → non rivedi mai la stessa domanda;
//  2. opzioni rimescolate quando la domanda va in onda → la posizione della
//     risposta non è memorizzabile nemmeno per le domande ripetute;
//  3. scheletri recenti evitati → la partita non ripropone strutture appena viste.

import { randomInt } from 'crypto';
import type { Difficulty, Question, QuestionType } from '../types';
import { mulberry32, shuffle, type Rng } from '../rng';
import { GENERATORS, QUESTION_TYPES } from './index';
import { skeletonOf } from './skeleton';

/** quante strutture recenti evitare prima di riproporle */
const SKELETON_MEMORY = 40;

export interface QuestionSource {
  /** tipi ammessi (default: tutti) */
  types?: QuestionType[];
}

/**
 * Rimescola le tre opzioni e aggiorna l'indice della risposta corretta.
 * Va chiamata QUANDO la domanda va in onda: due presentazioni della stessa
 * domanda hanno la risposta in posizioni diverse.
 */
export function reshuffleChoices(q: Question, rng: Rng = Math.random): Question {
  const idx = shuffle(rng, [0, 1, 2]);
  const choices = idx.map((i) => q.choices[i]);
  const correctIndex = idx.indexOf(q.correctIndex) as 0 | 1 | 2;
  return { ...q, choices, correctIndex };
}

/** seme non prevedibile per una nuova partita */
export function freshSeed(): number {
  return randomInt(0, 2 ** 31 - 1);
}

/**
 * Generatore di domande per una partita: ricorda le strutture già mostrate e
 * cerca di non ripeterle.
 */
export class LiveQuestions {
  private rng: Rng;
  /**
   * Generatore separato, seminato con entropia vera, per la sola posizione
   * delle risposte. Tenerlo scollegato da quello delle domande è ciò che rende
   * la posizione davvero imprevedibile: se usasse lo stesso stato, due domande
   * identiche verrebbero rimescolate allo stesso modo e chi le riconosce
   * avrebbe un piccolo vantaggio.
   */
  private shuffleRng: Rng;
  private recentSkeletons: string[] = [];
  private types: QuestionType[];
  /** tipi già usati in questo giro, per alternarli */
  private typeQueue: QuestionType[] = [];

  constructor(seed: number = freshSeed(), source: QuestionSource = {}) {
    this.rng = mulberry32(seed);
    this.shuffleRng = mulberry32(freshSeed());
    this.types = source.types?.length ? source.types : [...QUESTION_TYPES];
  }

  private nextType(): QuestionType {
    if (this.typeQueue.length === 0) this.typeQueue = shuffle(this.rng, [...this.types]);
    return this.typeQueue.pop()!;
  }

  /**
   * Una domanda nuova della difficoltà richiesta, evitando le strutture viste
   * di recente. Dopo qualche tentativo accetta comunque una domanda: meglio una
   * struttura ripetuta che nessuna domanda.
   */
  next(difficulty: Difficulty): Question {
    let fallback: Question | null = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const qtype = this.nextType();
      let q: Question;
      try {
        q = GENERATORS[qtype](this.rng, difficulty);
      } catch {
        continue; // generatore in difficoltà con questi parametri: cambia tipo
      }
      q = reshuffleChoices(q, this.shuffleRng);
      const skel = skeletonOf(q);
      if (!this.recentSkeletons.includes(skel)) {
        this.remember(skel);
        return q;
      }
      fallback ??= q;
    }
    if (fallback) {
      this.remember(skeletonOf(fallback));
      return fallback;
    }
    // ultimissima risorsa: una sequenza, che non fallisce mai
    return reshuffleChoices(GENERATORS.sequence(this.rng, difficulty), this.shuffleRng);
  }

  private remember(skel: string) {
    this.recentSkeletons.push(skel);
    if (this.recentSkeletons.length > SKELETON_MEMORY) this.recentSkeletons.shift();
  }
}
