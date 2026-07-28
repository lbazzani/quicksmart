// Il test del furbetto.
//
// Simula un giocatore che non ragiona: memorizza le domande viste e, quando ne
// riconosce una, ripete la posizione (A/B/C) che era corretta l'altra volta.
// Prova tre livelli di "riconoscimento", dal più ingenuo al più tenace:
//
//   posizione   — memorizza solo "alla domanda N-esima rispondi B"
//   identica    — riconosce la domanda identica (stesso payload)
//   struttura   — riconosce anche le varianti (stesso scheletro): è il furbetto
//                 più pericoloso, quello che dice "ah, questa è quella dei dadi"
//
// Se le difese funzionano, tutti e tre restano intorno al 33%, cioè al caso.
// Uso: npx tsx tools/cheater-test.ts [partite=400] [round=12]

import { LiveQuestions } from '../src/lib/questions/live';
import { skeletonOf } from '../src/lib/questions/skeleton';
import { difficultyForRound } from '../src/lib/engine/engine';
import type { Question } from '../src/lib/types';

const GAMES = parseInt(process.argv[2] ?? '400', 10);
const ROUNDS = parseInt(process.argv[3] ?? '12', 10);

const payloadKey = (q: Question) => JSON.stringify([q.qtype, q.payload]);

interface Strategy {
  name: string;
  /** chiave con cui il furbetto "riconosce" una domanda */
  key: (q: Question, roundIndex: number) => string;
  hits: number;
  attempts: number;
  recognised: number;
  /** quante volte ha riconosciuto qualcosa e ha comunque sbagliato */
  fooled: number;
}

const strategies: Strategy[] = [
  { name: 'posizione', key: (_q, i) => `round-${i}`, hits: 0, attempts: 0, recognised: 0, fooled: 0 },
  { name: 'identica', key: (q) => payloadKey(q), hits: 0, attempts: 0, recognised: 0, fooled: 0 },
  { name: 'struttura', key: (q) => skeletonOf(q), hits: 0, attempts: 0, recognised: 0, fooled: 0 },
];

// memoria del furbetto: chiave → posizione che era corretta
const memory = strategies.map(() => new Map<string, number>());

let totalQuestions = 0;
for (let g = 0; g < GAMES; g++) {
  // ogni partita ha un seme nuovo, come nel gioco vero
  const live = new LiveQuestions();
  for (let r = 0; r < ROUNDS; r++) {
    const q = live.next(difficultyForRound(r, ROUNDS));
    totalQuestions++;
    strategies.forEach((s, si) => {
      const k = s.key(q, r);
      const remembered = memory[si].get(k);
      if (remembered !== undefined) {
        s.recognised++;
        s.attempts++;
        if (remembered === q.correctIndex) s.hits++;
        else s.fooled++;
      }
      memory[si].set(k, q.correctIndex);
    });
  }
}

console.log(`Simulate ${GAMES} partite × ${ROUNDS} round = ${totalQuestions} domande\n`);
console.log('strategia    riconosciute   tentativi   indovinate   tasso   ingannato');
console.log('─'.repeat(72));
let failed = false;
for (const s of strategies) {
  const rate = s.attempts ? s.hits / s.attempts : 0;
  // il caso puro è 1/3; tolleriamo fino al 40% per la varianza statistica
  const bad = s.attempts >= 30 && rate > 0.4;
  if (bad) failed = true;
  console.log(
    `${s.name.padEnd(12)} ${String(s.recognised).padStart(12)} ${String(s.attempts).padStart(11)} ` +
      `${String(s.hits).padStart(12)} ${String((rate * 100).toFixed(1) + '%').padStart(7)} ` +
      `${String(s.fooled).padStart(11)}${bad ? '  ← MEMORIZZARE PAGA!' : ''}`
  );
}

const identiche = strategies[1].recognised;
console.log(`\nDomande identiche ricomparse: ${identiche} su ${totalQuestions} (${((identiche / totalQuestions) * 100).toFixed(2)}%)`);
console.log(`Strutture ricomparse: ${strategies[2].recognised} (${((strategies[2].recognised / totalQuestions) * 100).toFixed(1)}%)`);

if (failed) {
  console.error('\n✗ Il furbetto guadagna un vantaggio: le difese anti-memorizzazione non bastano.');
  process.exit(1);
}
console.log('\n✓ Giocare a memoria non paga: tutte le strategie restano al livello del caso.');
