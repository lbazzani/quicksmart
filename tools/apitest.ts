// Test di integrazione API end-to-end (senza browser).
// Prerequisito: server su BASE (default http://localhost:3005) e DB raggiungibile.
// Verifica: creazione, join, gara di buzz concorrente, risposta giusta/sbagliata,
// riapertura, penalità "nessun buzz", fine partita, modalità solo con timeout.
// Uso: npx tsx tools/apitest.ts

import { Pool } from 'pg';
import type { GameSnapshot } from '../src/lib/types';

const BASE = process.env.BASE ?? 'http://localhost:3005';
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://costola:costola@localhost:5433/quicksmart',
});

let failures = 0;
function check(cond: boolean, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function snap(code: string): Promise<GameSnapshot> {
  const res = await fetch(`${BASE}/api/game/${code}`);
  return (await res.json()) as GameSnapshot;
}

async function waitFor(code: string, pred: (s: GameSnapshot) => boolean, timeoutMs = 30_000): Promise<GameSnapshot> {
  const t0 = Date.now();
  for (;;) {
    const s = await snap(code);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout in attesa di stato (fase=${s.phase} status=${s.status})`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

/**
 * Risposta corretta del round in corso. Le domande sono generate al volo e non
 * stanno nel database, quindi la chiediamo all'oracolo di test (attivo solo con
 * QS_TEST_MODE=1, in produzione risponde 404).
 */
async function correctIndexOf(s: GameSnapshot): Promise<number> {
  void s;
  const res = await fetch(`${BASE}/api/game/${currentCode}/solution`);
  if (!res.ok) {
    throw new Error(
      res.status === 404
        ? 'oracolo non disponibile: avvia il server con QS_TEST_MODE=1'
        : `oracolo: HTTP ${res.status}`
    );
  }
  const { correctIndex } = (await res.json()) as { correctIndex: number };
  return correctIndex;
}

/** codice della partita su cui stiamo lavorando (per l'oracolo) */
let currentCode = '';

interface Cred { playerId: string; token: string; code?: string }

async function testTeam() {
  console.log('\n— PARTITA A SQUADRE (3 giocatori, 3 round) —');
  const host = await post<Cred & { code: string }>(`/api/game`, {
    name: 'Test Team',
    nickname: 'Anna',
    avatar: '🦊',
    mode: 'team',
    roundsTotal: 3,
    buzzWindowSec: 5,
    answerSec: 5,
  });
  const code = host.code;
  currentCode = code;
  check(!!code && code.length === 5, `partita creata con codice ${code}`);

  const p2 = await post<Cred>(`/api/game/${code}/join`, { nickname: 'Luca', avatar: '🐼' });
  const p3 = await post<Cred>(`/api/game/${code}/join`, { nickname: 'Marco', avatar: '🦄' });
  check(!!p2.playerId && !!p3.playerId, 'Luca e Marco entrati');

  const dupe = await post<{ error?: string }>(`/api/game/${code}/join`, { nickname: 'anna', avatar: '🐸' });
  check(dupe.error === 'nickname_taken', 'nickname duplicato rifiutato');

  let s = await snap(code);
  check(s.players.length === 3, '3 giocatori in lobby');

  await post(`/api/game/${code}/start`, host);
  s = await waitFor(code, (x) => x.phase === 'buzz');
  check(s.current !== null && s.current.value === 100, 'round 1 in fase buzz, valore 100 (facile)');

  // RITARDATARIO: entra a partita già iniziata (caso tipico in famiglia)
  const late = await post<Cred & { error?: string }>(`/api/game/${code}/join`, { nickname: 'Nonna', avatar: '🐢' });
  check(!late.error && !!late.playerId, 'si può entrare a partita già iniziata');
  s = await snap(code);
  const nonna = s.players.find((p) => p.nickname === 'Nonna');
  check(!!nonna && nonna.score === 0, 'il ritardatario parte da zero punti');
  check(s.current!.lockedOut.includes(late.playerId), 'il ritardatario non gioca il round già in corso');
  check(nonna!.joinedAtRound === s.roundIndex, 'il round di ingresso è segnalato alla UI');
  const lateBuzz = await post<{ ok: boolean; error?: string }>(`/api/game/${code}/buzz`, late);
  check(!lateBuzz.ok && lateBuzz.error === 'locked_out', 'il ritardatario non può prenotarsi nel round in corso');

  // ROUND 1: gara di buzz concorrente — deve vincere esattamente uno
  const racers = [host, p2, p3];
  const results = await Promise.all(racers.map((c) => post<{ ok: boolean; error?: string }>(`/api/game/${code}/buzz`, c)));
  const winners = results.map((r, i) => (r.ok ? i : -1)).filter((i) => i >= 0);
  check(winners.length === 1, `gara di buzz: esattamente 1 vincitore su 3 (${winners.length})`);
  const tooLate = results.filter((r) => !r.ok && r.error === 'too_late').length;
  check(tooLate === 2, 'gli altri 2 ricevono too_late');
  const winner = racers[winners[0]];

  // il vincitore risponde correttamente
  s = await snap(code);
  check(s.phase === 'answer' && s.current?.buzzerId === winner.playerId, 'fase answer con buzzer corretto');
  const notMyTurn = await post<{ ok: boolean }>(`/api/game/${code}/answer`, { ...racers[(winners[0] + 1) % 3], choiceIndex: 0 });
  check(!notMyTurn.ok, 'un altro giocatore non può rispondere al posto del buzzer');
  const ci = await correctIndexOf(s);
  await post(`/api/game/${code}/answer`, { ...winner, choiceIndex: ci });
  s = await waitFor(code, (x) => x.phase === 'reveal');
  check(s.current?.outcome === 'correct', 'risposta corretta riconosciuta');
  const winnerPub = s.players.find((p) => p.id === winner.playerId)!;
  check(winnerPub.score >= 100 && winnerPub.score <= 150, `punti con bonus velocità (${winnerPub.score} ∈ [100,150])`);
  check(s.current?.correctIndex === ci && !!s.current?.explanation, 'reveal espone soluzione e spiegazione');

  // ROUND 2: risposta sbagliata → riapertura → altro giocatore indovina
  s = await waitFor(code, (x) => x.phase === 'buzz' && x.roundIndex === 1, 20_000);
  const preScores = new Map(s.players.map((p) => [p.id, p.score]));
  const r2buzz = await post<{ ok: boolean }>(`/api/game/${code}/buzz`, host);
  check(r2buzz.ok, 'round 2: Anna si prenota');
  s = await snap(code);
  const ci2 = await correctIndexOf(s);
  await post(`/api/game/${code}/answer`, { ...host, choiceIndex: (ci2 + 1) % 3 });
  s = await waitFor(code, (x) => x.phase === 'buzz' && (x.current?.lockedOut.length ?? 0) === 1, 10_000);
  check(true, 'dopo errore la domanda riapre');
  const annaAfterWrong = s.players.find((p) => p.id === host.playerId)!;
  check(
    annaAfterWrong.score === (preScores.get(host.playerId) ?? 0) - 100,
    `penalità errore −50% del valore (−100): ${annaAfterWrong.score}`
  );
  check(s.current!.value === 140, `valore decaduto a 140 (${s.current!.value})`);
  const annaRetry = await post<{ ok: boolean; error?: string }>(`/api/game/${code}/buzz`, host);
  check(!annaRetry.ok && annaRetry.error === 'locked_out', 'chi ha sbagliato non può riprenotarsi');
  await post(`/api/game/${code}/buzz`, p2);
  s = await snap(code);
  await post(`/api/game/${code}/answer`, { ...p2, choiceIndex: ci2 });
  s = await waitFor(code, (x) => x.phase === 'reveal' && x.roundIndex === 1);
  const luca = s.players.find((p) => p.id === p2.playerId)!;
  const lucaDelta = luca.score - (preScores.get(p2.playerId) ?? 0);
  check(s.current?.outcome === 'correct' && lucaDelta >= 140 && lucaDelta <= 210, `Luca indovina sulla riapertura (+${lucaDelta})`);

  // ROUND 3: nessuno si prenota → −25 a tutti
  s = await waitFor(code, (x) => x.phase === 'buzz' && x.roundIndex === 2, 20_000);
  const pre3 = new Map(s.players.map((p) => [p.id, p.score]));
  s = await waitFor(code, (x) => x.phase === 'reveal' && x.roundIndex === 2, 15_000);
  check(s.current?.outcome === 'nobody', 'nessun buzz → outcome nobody');
  const allMinus25 = s.players.every((p) => p.score === (pre3.get(p.id) ?? 0) - 25);
  check(allMinus25, 'tutti −25');

  // fine partita automatica dopo 3 round
  s = await waitFor(code, (x) => x.status === 'ended', 15_000);
  check(s.status === 'ended', 'partita terminata automaticamente');

  // a partita finita non si entra più
  const lateEnded = await post<{ error?: string }>(`/api/game/${code}/join`, { nickname: 'Tardi', avatar: '🐢' });
  check(lateEnded.error === 'ended', 'join rifiutato a partita finita, con messaggio dedicato');

  const db = await pool.query(
    `SELECT p.nickname, p.score FROM players p JOIN games g ON g.id = p.game_id WHERE g.code = $1 ORDER BY p.score DESC`,
    [code]
  );
  // ordine stabile: a parità di punteggio la classifica non ha un ordine
  // definito, quindi il confronto va fatto sull'insieme, non sulla sequenza
  const key = (n: string, sc: number) => `${n}:${sc}`;
  const inMemory = s.players.map((p) => key(p.nickname, p.score)).sort().join(',');
  const persisted = db.rows.map((r) => key(r.nickname as string, r.score as number)).sort().join(',');
  check(inMemory === persisted, `punteggi persistiti su Postgres (${persisted})`);
  const rounds = await pool.query(
    `SELECT count(*) AS n FROM rounds r JOIN games g ON g.id = r.game_id WHERE g.code = $1`,
    [code]
  );
  check(rounds.rows[0].n === '3', '3 round salvati su Postgres');
}

async function testSolo() {
  console.log('\n— MODALITÀ SOLO (2 round, timeout al primo) —');
  const solo = await post<Cred & { code: string }>(`/api/game`, {
    nickname: 'Marta',
    avatar: '🦄',
    mode: 'solo',
    roundsTotal: 2,
    buzzWindowSec: 5,
    answerSec: 5,
  });
  const code = solo.code;
  currentCode = code;
  check(!!code, `partita solo creata (${code})`);
  await post(`/api/game/${code}/start`, solo);

  // round 1: lascia scadere il tempo di decisione → −40% del base (100) = −40
  let s = await waitFor(code, (x) => x.phase === 'reveal' && x.roundIndex === 0, 20_000);
  check(s.current?.outcome === 'timeout', 'timeout di decisione rilevato');
  check(s.players[0].score === -40, `penalità solo −40 (${s.players[0].score})`);

  // round 2: buzz + risposta corretta
  s = await waitFor(code, (x) => x.phase === 'buzz' && x.roundIndex === 1, 20_000);
  await post(`/api/game/${code}/buzz`, solo);
  s = await snap(code);
  check(s.phase === 'answer', 'buzz ferma il timer di decisione');
  const ci = await correctIndexOf(s);
  await post(`/api/game/${code}/answer`, { ...solo, choiceIndex: ci });
  s = await waitFor(code, (x) => x.status === 'ended', 20_000);
  check(s.players[0].score > -40, `risposta corretta premiata (totale ${s.players[0].score})`);
  check(s.players[0].stats.correct === 1, 'statistiche aggiornate');
}

async function main() {
  await testTeam();
  await testSolo();
  await pool.end();
  if (failures) {
    console.error(`\n✗ ${failures} verifiche fallite`);
    process.exit(1);
  }
  console.log('\n✓ Tutti i test di integrazione passati');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
