// Misura lo spazio combinatorio dei generatori: quante domande DISTINTE sanno
// produrre, e quanto è "riconoscibile" una domanda (quante ne condividono la
// stessa struttura visiva a meno dei parametri).
// Uso: npx tsx tools/measure-space.ts [campioni=4000]

import { mulberry32 } from '../src/lib/rng';
import { ALL_QUESTION_TYPES, GENERATORS } from '../src/lib/questions';
import { hashQuestion } from '../src/lib/questions/qutils';
import type { Difficulty, Question } from '../src/lib/types';

const N = parseInt(process.argv[2] ?? '4000', 10);

/**
 * "Scheletro" della domanda: la struttura senza i valori concreti. Due domande
 * con lo stesso scheletro si assomigliano a colpo d'occhio — è il livello a cui
 * un giocatore può dire "questa l'ho già vista".
 */
function skeleton(q: Question): string {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        // colori e rotazioni sono i parametri più variabili: li ignoriamo
        if (k === 'color' || k === 'rot' || k === 'size') o[k] = '*';
        else o[k] = strip(val);
      }
      return o;
    }
    if (typeof v === 'number') return '#';
    return v;
  };
  return JSON.stringify([q.qtype, strip(q.payload)]);
}

interface Row {
  qtype: string;
  d: Difficulty;
  unique: number;
  skeletons: number;
  collisionRate: number;
  /** stima di Chao1 della dimensione reale del pool */
  estimatedPool: number;
}

/** Stimatore Chao1: pool ≈ osservati + singleton²/(2·doppioni) */
function chao1(counts: Map<string, number>): number {
  const observed = counts.size;
  let f1 = 0;
  let f2 = 0;
  for (const c of counts.values()) {
    if (c === 1) f1++;
    else if (c === 2) f2++;
  }
  if (f2 === 0) return observed + (f1 * (f1 - 1)) / 2;
  return Math.round(observed + (f1 * f1) / (2 * f2));
}

const rows: Row[] = [];
for (const qtype of ALL_QUESTION_TYPES) {
  for (const d of [1, 2, 3] as Difficulty[]) {
    const rng = mulberry32(999 + d * 31 + qtype.length);
    const hashes = new Map<string, number>();
    const skels = new Set<string>();
    for (let i = 0; i < N; i++) {
      try {
        const q = GENERATORS[qtype](rng, d);
        const h = hashQuestion(q);
        hashes.set(h, (hashes.get(h) ?? 0) + 1);
        skels.add(skeleton(q));
      } catch {
        // generazione fallita: ignora
      }
    }
    rows.push({
      qtype,
      d,
      unique: hashes.size,
      skeletons: skels.size,
      collisionRate: +(1 - hashes.size / N).toFixed(3),
      estimatedPool: chao1(hashes),
    });
  }
}

console.log(`Campioni per tipo/difficoltà: ${N}\n`);
console.log('tipo         d  uniche  scheletri  collisioni  pool stimato');
console.log('─'.repeat(62));
for (const r of rows) {
  console.log(
    `${r.qtype.padEnd(12)} ${r.d}  ${String(r.unique).padStart(6)}  ${String(r.skeletons).padStart(9)}  ${String(
      (r.collisionRate * 100).toFixed(1) + '%'
    ).padStart(10)}  ${String(r.estimatedPool).padStart(12)}`
  );
}

const totalPool = rows.reduce((s, r) => s + r.estimatedPool, 0);
const weakest = [...rows].sort((a, b) => a.estimatedPool - b.estimatedPool).slice(0, 6);
console.log('\nPool totale stimato:', totalPool.toLocaleString('it-IT'));
console.log('\nGeneratori più poveri (da ampliare per primi):');
for (const r of weakest) console.log(`  ${r.qtype} d${r.d}: ~${r.estimatedPool} domande, ${r.skeletons} scheletri`);
