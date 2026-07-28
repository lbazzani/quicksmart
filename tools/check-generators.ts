// Validatore dei generatori di domande.
// Uso: npx tsx tools/check-generators.ts [tipo]   (senza tipo: tutti)
// Per ogni tipo × difficoltà genera 40 domande e verifica il contratto:
//  - 3 opzioni, distinte, correctIndex 0..2
//  - payload/choices serializzabili e con kind supportati dal renderer
//  - prompt/explanation non vuoti (in italiano)
//  - varietà: almeno il 50% di hash unici
// Exit code 1 se qualcosa fallisce.

import { mulberry32 } from '../src/lib/rng';
import { hashQuestion } from '../src/lib/questions/qutils';
import type { Difficulty, Question } from '../src/lib/types';

const PAYLOAD_KINDS = new Set(['cells', 'numbers', 'clock', 'dicestack', 'dicenet', 'balance', 'equation']);
const CHOICE_KINDS = new Set(['cell', 'text', 'clock']);
const N = 40;

const only = process.argv[2];
const types = only
  ? [only]
  : ['sequence', 'matrix', 'oddone', 'numseries', 'rotation', 'dice', 'clock', 'balance', 'analogy', 'arithgrid', 'fold', 'paths', 'sets', 'mirror', 'domino', 'symmetry', 'weights', 'pattern'];

let failures = 0;

function fail(ctx: string, msg: string, q?: Question) {
  failures++;
  console.error(`✗ [${ctx}] ${msg}`);
  if (q) console.error('  ' + JSON.stringify(q).slice(0, 400));
}

async function main() {
  for (const t of types) {
    let gen: (rng: () => number, d: Difficulty) => Question;
    try {
      const mod = await import(`../src/lib/questions/${t}`);
      const exportName = 'gen' + t[0].toUpperCase() + t.slice(1);
      gen = mod[exportName];
      if (typeof gen !== 'function') throw new Error(`export ${exportName} mancante`);
    } catch (e) {
      fail(t, `impossibile importare il generatore: ${e}`);
      continue;
    }
    for (const d of [1, 2, 3] as Difficulty[]) {
      const ctx = `${t} d${d}`;
      const rng = mulberry32(12345 + d);
      const hashes = new Set<string>();
      let ok = 0;
      for (let i = 0; i < N; i++) {
        let q: Question;
        try {
          q = gen(rng, d);
        } catch (e) {
          fail(ctx, `generazione #${i} fallita: ${e}`);
          continue;
        }
        if (q.qtype !== t) fail(ctx, `qtype "${q.qtype}" ≠ "${t}"`, q);
        if (q.difficulty !== d) fail(ctx, `difficulty ${q.difficulty} ≠ ${d}`, q);
        if (!q.prompt?.trim()) fail(ctx, 'prompt vuoto', q);
        if (!q.explanation?.trim()) fail(ctx, 'explanation vuota', q);
        if (!PAYLOAD_KINDS.has(q.payload?.kind)) fail(ctx, `payload.kind non supportato: ${q.payload?.kind}`, q);
        if (!Array.isArray(q.choices) || q.choices.length !== 3) {
          fail(ctx, `servono esattamente 3 opzioni (trovate ${q.choices?.length})`, q);
          continue;
        }
        for (const c of q.choices) if (!CHOICE_KINDS.has(c.kind)) fail(ctx, `choice.kind non supportato: ${c.kind}`, q);
        const keys = q.choices.map((c) => JSON.stringify(c));
        if (new Set(keys).size !== 3) fail(ctx, 'opzioni duplicate', q);
        if (![0, 1, 2].includes(q.correctIndex)) fail(ctx, `correctIndex non valido: ${q.correctIndex}`, q);
        try {
          JSON.parse(JSON.stringify(q));
        } catch {
          fail(ctx, 'payload non serializzabile', q);
        }
        hashes.add(hashQuestion(q));
        ok++;
      }
      const variety = hashes.size / Math.max(1, ok);
      if (ok > 0 && variety < 0.5) fail(ctx, `poca varietà: ${hashes.size}/${ok} hash unici`);
      console.log(`${failures ? '·' : '✓'} ${ctx}: ${ok}/${N} generate, ${hashes.size} uniche`);
    }
  }
  if (failures) {
    console.error(`\n${failures} problemi trovati.`);
    process.exit(1);
  }
  console.log('\nTutti i generatori rispettano il contratto ✓');
}

main();
