// Esporta un campione di domande per l'audit alla cieca (senza risposta).
// Uso: npx tsx tools/export-audit.ts <dirOutput> [perTipoPerDifficoltà=3]
// Scrive: <dir>/questions-<tipo>.json  (id, difficulty, prompt, payload, choices)
//         <dir>/solutions.json         (id → correct_index, explanation) — NON per i solver

import { mkdirSync, writeFileSync } from 'fs';
import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://costola:costola@localhost:5433/quicksmart',
});

async function main() {
  const dir = process.argv[2];
  const per = parseInt(process.argv[3] ?? '3', 10);
  if (!dir) throw new Error('serve la directory di output');
  mkdirSync(dir, { recursive: true });

  const types = ['sequence', 'matrix', 'oddone', 'numseries', 'rotation', 'dice', 'clock', 'balance', 'analogy', 'arithgrid'];
  const solutions: Record<number, { correctIndex: number; explanation: string; qtype: string; difficulty: number }> = {};
  for (const t of types) {
    const sample: unknown[] = [];
    for (const d of [1, 2, 3]) {
      const { rows } = await pool.query(
        `SELECT id, difficulty, prompt, payload, choices, correct_index, explanation
         FROM questions WHERE qtype = $1 AND difficulty = $2 ORDER BY random() LIMIT $3`,
        [t, d, per]
      );
      // l'audit alla cieca è in italiano: si esporta solo quella lingua (prompt/explanation sono LocalizedText in DB)
      for (const r of rows) {
        sample.push({ id: r.id, difficulty: r.difficulty, prompt: r.prompt.it, payload: r.payload, choices: r.choices });
        solutions[r.id] = { correctIndex: r.correct_index, explanation: r.explanation.it, qtype: t, difficulty: r.difficulty };
      }
    }
    writeFileSync(`${dir}/questions-${t}.json`, JSON.stringify(sample, null, 1));
  }
  writeFileSync(`${dir}/solutions.json`, JSON.stringify(solutions, null, 1));
  console.log(`Esportate ${Object.keys(solutions).length} domande in ${dir}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
