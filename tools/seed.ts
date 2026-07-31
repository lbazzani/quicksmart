// Popola l'archivio domande in Postgres.
// Uso: npx tsx tools/seed.ts [perTipoPerDifficoltà=20] [seed=20260728]

import { generateBank } from '../src/lib/questions';
import { getPool } from '../src/lib/db';

async function main() {
  const per = parseInt(process.argv[2] ?? '20', 10);
  const seed = parseInt(process.argv[3] ?? '20260728', 10);
  console.log(`Genero l'archivio: ${per} domande per tipo per difficoltà (seed ${seed})…`);
  const bank = generateBank(seed, per);
  console.log(`Generate ${bank.length} domande uniche. Inserisco…`);

  const pool = getPool();
  let inserted = 0;
  for (const q of bank) {
    const res = await pool.query(
      `INSERT INTO questions (qtype, difficulty, prompt, payload, choices, correct_index, explanation, hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (hash) DO NOTHING`,
      [
        q.qtype,
        q.difficulty,
        JSON.stringify(q.prompt),
        JSON.stringify(q.payload),
        JSON.stringify(q.choices),
        q.correctIndex,
        JSON.stringify(q.explanation),
        q.hash,
      ]
    );
    inserted += res.rowCount ?? 0;
  }
  const { rows } = await pool.query(
    `SELECT qtype, difficulty, count(*) AS n FROM questions GROUP BY qtype, difficulty ORDER BY qtype, difficulty`
  );
  console.log(`Inserite ${inserted} nuove domande. Archivio attuale:`);
  for (const r of rows) console.log(`  ${r.qtype} d${r.difficulty}: ${r.n}`);
  const tot = await pool.query(`SELECT count(*) AS n FROM questions`);
  console.log(`TOTALE: ${tot.rows[0].n}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
