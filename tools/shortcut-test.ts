// Il test delle scorciatoie.
//
// Un quiz può essere corretto e non memorizzabile, e comunque risolvibile senza
// ragionare: se la risposta è quasi sempre il numero più piccolo, o quella di
// mezzo, o la figura più colorata, il bambino sveglio impara la scorciatoia e
// smette di pensare. È lo stesso problema del furbetto, in un'altra forma.
//
// Qui misuriamo, per ogni tipo di domanda, quanto rendono le euristiche cieche:
// nessuna deve superare in modo significativo il livello del caso (33%).
// Uso: npx tsx tools/shortcut-test.ts [campioni=1200] [tipo]

import { mulberry32 } from '../src/lib/rng';
import { ALL_QUESTION_TYPES, GENERATORS } from '../src/lib/questions';
import type { Difficulty, Question, QuestionType } from '../src/lib/types';

const N = parseInt(process.argv[2] ?? '1200', 10);
const ONLY = process.argv[3] as QuestionType | undefined;

/** soglia oltre la quale una scorciatoia è considerata redditizia */
const THRESHOLD = 0.45;

type Heuristic = { name: string; pick: (q: Question) => number | null };

/** valore numerico di un'opzione testuale, se ne ha uno */
function numOf(q: Question, i: number): number | null {
  const c = q.choices[i];
  if (c.kind !== 'text') return null;
  const m = c.text.match(/-?\d+/);
  return m ? parseInt(m[0], 10) : null;
}

function nums(q: Question): (number | null)[] {
  return [0, 1, 2].map((i) => numOf(q, i));
}

/** quante forme totali contiene un'opzione grafica */
function shapeCount(q: Question, i: number): number | null {
  const c = q.choices[i];
  if (c.kind !== 'cell') return null;
  return c.cell.shapes.length;
}

const HEURISTICS: Heuristic[] = [
  {
    name: 'numero più piccolo',
    pick: (q) => {
      const v = nums(q);
      if (v.some((x) => x === null)) return null;
      return (v as number[]).indexOf(Math.min(...(v as number[])));
    },
  },
  {
    name: 'numero più grande',
    pick: (q) => {
      const v = nums(q);
      if (v.some((x) => x === null)) return null;
      return (v as number[]).indexOf(Math.max(...(v as number[])));
    },
  },
  {
    name: 'numero di mezzo',
    pick: (q) => {
      const v = nums(q);
      if (v.some((x) => x === null)) return null;
      const arr = v as number[];
      const sorted = [...arr].sort((a, b) => a - b);
      return arr.indexOf(sorted[1]);
    },
  },
  {
    name: 'più figure',
    pick: (q) => {
      const v = [0, 1, 2].map((i) => shapeCount(q, i));
      if (v.some((x) => x === null)) return null;
      return (v as number[]).indexOf(Math.max(...(v as number[])));
    },
  },
  {
    name: 'meno figure',
    pick: (q) => {
      const v = [0, 1, 2].map((i) => shapeCount(q, i));
      if (v.some((x) => x === null)) return null;
      return (v as number[]).indexOf(Math.min(...(v as number[])));
    },
  },
  {
    name: "l'opzione diversa dalle altre due",
    pick: (q) => {
      // se due opzioni condividono una proprietà e la terza no, prova la terza
      const keys = q.choices.map((c) => JSON.stringify(c).length);
      for (let i = 0; i < 3; i++) {
        const others = [0, 1, 2].filter((j) => j !== i);
        if (keys[others[0]] === keys[others[1]] && keys[i] !== keys[others[0]]) return i;
      }
      return null;
    },
  },
  // Le tre che seguono le hanno trovate i verificatori dopo il primo giro di
  // correzioni: gli agenti avevano imparato a battere le euristiche note e la
  // scorciatoia si era spostata su queste. Stanno qui perché non succeda più.
  {
    name: 'il numero diverso dagli altri due',
    pick: (q) => {
      const v = nums(q);
      if (v.some((x) => x === null)) return null;
      const arr = v as number[];
      for (let i = 0; i < 3; i++) {
        const others = [0, 1, 2].filter((j) => j !== i);
        if (arr[others[0]] === arr[others[1]] && arr[i] !== arr[others[0]]) return i;
      }
      // variante: la decina diversa (es. 10:20 fra 9:15 e 9:40)
      const tens = arr.map((x) => Math.floor(x / 10));
      for (let i = 0; i < 3; i++) {
        const others = [0, 1, 2].filter((j) => j !== i);
        if (tens[others[0]] === tens[others[1]] && tens[i] !== tens[others[0]]) return i;
      }
      return null;
    },
  },
  {
    name: 'la più vicina alla media delle altre due',
    pick: (q) => {
      const v = nums(q);
      if (v.some((x) => x === null)) return null;
      const arr = v as number[];
      let best = -1;
      let bestDist = Infinity;
      for (let i = 0; i < 3; i++) {
        const others = [0, 1, 2].filter((j) => j !== i);
        const dist = Math.abs(arr[i] - (arr[others[0]] + arr[others[1]]) / 2);
        if (dist < bestDist) {
          bestDist = dist;
          best = i;
        }
      }
      return best;
    },
  },
  {
    name: 'la risposta scritta più lunga',
    pick: (q) => {
      if (!q.choices.every((c) => c.kind === 'text')) return null;
      const lens = q.choices.map((c) => (c.kind === 'text' ? c.text.length : 0));
      const max = Math.max(...lens);
      return lens.filter((l) => l === max).length === 1 ? lens.indexOf(max) : null;
    },
  },
];

interface Row {
  qtype: string;
  d: Difficulty;
  heuristic: string;
  hits: number;
  attempts: number;
}

const rows: Row[] = [];
const types = ONLY ? [ONLY] : ALL_QUESTION_TYPES;

for (const qtype of types) {
  for (const d of [1, 2, 3] as Difficulty[]) {
    const rng = mulberry32(20260729 + d * 7);
    const tally = new Map<string, { hits: number; attempts: number }>();
    for (let i = 0; i < N; i++) {
      let q: Question;
      try {
        q = GENERATORS[qtype](rng, d);
      } catch {
        continue;
      }
      for (const h of HEURISTICS) {
        const guess = h.pick(q);
        if (guess === null) continue;
        const t = tally.get(h.name) ?? { hits: 0, attempts: 0 };
        t.attempts++;
        if (guess === q.correctIndex) t.hits++;
        tally.set(h.name, t);
      }
    }
    for (const [heuristic, t] of tally) {
      rows.push({ qtype, d, heuristic, hits: t.hits, attempts: t.attempts });
    }
  }
}

const risky = rows.filter((r) => r.attempts >= 60 && r.hits / r.attempts > THRESHOLD);
risky.sort((a, b) => b.hits / b.attempts - a.hits / a.attempts);

console.log(`Campioni per tipo/difficoltà: ${N}\nSoglia di allarme: ${THRESHOLD * 100}% (il caso è 33%)\n`);
if (risky.length === 0) {
  console.log('✓ Nessuna scorciatoia cieca rende più del caso: per rispondere bisogna ragionare.');
  process.exit(0);
}

console.log('SCORCIATOIE REDDITIZIE (rispondere senza ragionare paga):');
console.log('tipo         d  euristica                          successo   casi');
console.log('─'.repeat(74));
for (const r of risky) {
  console.log(
    `${r.qtype.padEnd(12)} ${r.d}  ${r.heuristic.padEnd(33)} ${((r.hits / r.attempts) * 100).toFixed(1).padStart(7)}%  ${String(r.attempts).padStart(5)}`
  );
}
console.error(`\n✗ ${risky.length} scorciatoie sopra la soglia.`);
process.exit(1);
