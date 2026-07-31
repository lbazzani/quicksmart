// Esporta un campione di domande generate al volo, per l'audit alla cieca.
// Uso: npx tsx tools/export-sample.ts <dirOutput> [perDifficoltà=3] [tipi separati da virgola]
// Scrive: <dir>/questions-<tipo>.json  (senza soluzione)
//         <dir>/solutions.json         (le soluzioni — NON per i solver)

import { mkdirSync, writeFileSync } from 'fs';
import { mulberry32 } from '../src/lib/rng';
import { ALL_QUESTION_TYPES, GENERATORS } from '../src/lib/questions';
import type { Difficulty, QuestionType } from '../src/lib/types';

const dir = process.argv[2];
const per = parseInt(process.argv[3] ?? '3', 10);
const only = process.argv[4]?.split(',').filter(Boolean) as QuestionType[] | undefined;
if (!dir) throw new Error('serve la directory di output');
mkdirSync(dir, { recursive: true });

const types = only?.length ? only : ALL_QUESTION_TYPES;
const solutions: Record<number, { correctIndex: number; explanation: string; qtype: string; difficulty: number }> = {};
let id = 1;

for (const qtype of types) {
  const rng = mulberry32(777 + qtype.length * 13);
  const sample: unknown[] = [];
  for (const d of [1, 2, 3] as Difficulty[]) {
    for (let i = 0; i < per; i++) {
      const q = GENERATORS[qtype](rng, d);
      const myId = id++;
      // l'audit alla cieca è in italiano: si esporta solo quella lingua
      sample.push({ id: myId, difficulty: d, prompt: q.prompt.it, payload: q.payload, choices: q.choices });
      solutions[myId] = {
        correctIndex: q.correctIndex,
        explanation: q.explanation.it,
        qtype,
        difficulty: d,
      };
    }
  }
  writeFileSync(`${dir}/questions-${qtype}.json`, JSON.stringify(sample, null, 1));
}
writeFileSync(`${dir}/solutions.json`, JSON.stringify(solutions, null, 1));
console.log(`Esportate ${Object.keys(solutions).length} domande (${types.length} tipi) in ${dir}`);
