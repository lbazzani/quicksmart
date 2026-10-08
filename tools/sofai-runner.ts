// Prova di SofAI contro il servizio claude-runner, con i prompt veri.
// Misura tempi e mostra cosa resta dopo i filtri di sofia.ts.
//
// Uso (dal Mac, con un tunnel verso un'istanza del runner):
//   ssh -f -N -L 18790:10.10.1.2:8790 sparktech2
//   CLAUDE_RUNNER_URLS=sparktech2=http://127.0.0.1:18790 CLAUDE_RUNNER_TOKEN=… \
//     npx tsx tools/sofai-runner.ts [haiku|sonnet|…] [ripetizioni]

import { aiPrompt, aliasMap, parseWarmup, warmupPrompt } from '../src/lib/sofia/sofia';
import { runnerConfigurato, runnerPrompt } from '../src/lib/sofia/runner';

const modello = process.argv[2] ?? 'haiku';
const giri = Number(process.argv[3] ?? 1);
process.env.SOFIA_MODEL = modello;

if (!runnerConfigurato()) {
  console.error('servono CLAUDE_RUNNER_URLS e CLAUDE_RUNNER_TOKEN');
  process.exit(2);
}

async function misura(nome: string, prompt: string, timeoutMs: number, priority: 'interactive' | 'batch') {
  const t0 = Date.now();
  try {
    const text = await runnerPrompt(prompt, { timeoutMs, priority });
    return { nome, ms: Date.now() - t0, text };
  } catch (e) {
    return { nome, ms: Date.now() - t0, text: '', errore: e instanceof Error ? e.message : String(e) };
  }
}

const podioSquadra = { kind: 'podium' as const, standings: [
  { nickname: 'Marta', score: 1840 }, { nickname: 'Papà', score: 1210 }, { nickname: 'Nonna Pina', score: 640 },
] };
const podioSolo = { kind: 'podium' as const, standings: [{ nickname: 'Lorenzo', score: 2436 }] };

async function main() {
for (let i = 0; i < giri; i++) {
  console.log(`\n=== ${modello} · giro ${i + 1}/${giri}`);
  const lotto = await misura('lotto', warmupPrompt(), 180_000, 'batch');
  const parsed = parseWarmup(lotto.text);
  const tenute = Object.values(parsed).reduce((n, v) => n + v.length, 0);
  console.log(`lotto: ${lotto.ms} ms · ${tenute}/13 battute tenute${lotto.errore ? ` · ERRORE ${lotto.errore}` : ''}`);
  for (const [k, v] of Object.entries(parsed)) console.log(`   ${k.padEnd(13)} ${v.join(' | ')}`);
  for (const [nome, ctx] of [['podio squadra', podioSquadra], ['podio solo', podioSolo]] as const) {
    const alias = aliasMap(ctx);
    const r = await misura(nome, aiPrompt(ctx, alias)!, 60_000, 'interactive');
    let testo = r.text;
    for (const [nick, ph] of alias) testo = testo.replaceAll(ph, nick);
    console.log(`${nome}: ${r.ms} ms · ${r.errore ? `ERRORE ${r.errore}` : testo}`);
  }
}
}

void main();
