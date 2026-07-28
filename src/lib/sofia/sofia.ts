// Sofia, la mascotte del gioco. A ogni evento mostra subito una battuta
// pre-scritta; se SOFIA_AI=1 chiede in parallelo una battuta migliore al CLI
// di Claude (modello haiku, prompt corto) e la sostituisce quando arriva,
// se il commento è ancora attuale. Il gioco non aspetta mai l'AI.

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import os from 'os';
import type { RoundOutcome, SofiaMood } from '../types';
import { T } from '../i18n';
import { LINES, MOODS, fillLine, type SofiaLineKind } from './lines';

export type SofiaEventCtx =
  | { kind: 'welcome'; nickname: string }
  | { kind: 'join'; nickname: string }
  | {
      kind: 'reveal';
      outcome: RoundOutcome;
      winner?: string;
      answerTimeMs?: number;
      streak?: number;
      qtype: string;
      difficulty: number;
      roundIndex: number;
      standings: { nickname: string; score: number }[];
    }
  | { kind: 'podium'; standings: { nickname: string; score: number }[] };

// Il tipo Room vive nell'engine; qui bastano i campi che tocchiamo.
interface SofiaRoom {
  sofia: { text: string; mood: SofiaMood; roundIndex: number; ai: boolean; seq: number } | null;
  sofiaSeq: number;
  sofiaBusy: boolean;
  roundIndex: number;
}

const AI_TIMEOUT_MS = 25_000;
const AI_ENABLED = () => process.env.SOFIA_AI === '1';

function lineKindFor(ctx: SofiaEventCtx): { kind: SofiaLineKind; name?: string; n?: number } {
  switch (ctx.kind) {
    case 'welcome':
      return { kind: 'welcome', name: ctx.nickname };
    case 'join':
      return { kind: 'join', name: ctx.nickname };
    case 'podium':
      return { kind: 'podium', name: ctx.standings[0]?.nickname };
    case 'reveal': {
      if (ctx.outcome === 'correct') {
        if ((ctx.streak ?? 0) >= 3) return { kind: 'correctStreak', name: ctx.winner, n: ctx.streak };
        if ((ctx.answerTimeMs ?? Infinity) < 2000) return { kind: 'correctFast', name: ctx.winner };
        return { kind: 'correct', name: ctx.winner };
      }
      if (ctx.outcome === 'nobody') return { kind: 'nobody' };
      if (ctx.outcome === 'timeout') return { kind: 'timeout' };
      return { kind: 'exhausted' };
    }
  }
}

function aiPrompt(ctx: SofiaEventCtx): string | null {
  const head =
    'Sei SofAI, la mascotte simpatica e un po\' sfottona di un quiz a squadre per famiglie. ' +
    'Scrivi UNA sola battuta in italiano (max 18 parole, al massimo 1 emoji), senza virgolette né premesse. ' +
    'Situazione: ';
  if (ctx.kind === 'reveal') {
    const diff = T.difficulty[ctx.difficulty] ?? '';
    const qt = T.qtypes[ctx.qtype] ?? ctx.qtype;
    const top = ctx.standings.slice(0, 3).map((s) => `${s.nickname} ${s.score}`).join(', ');
    let what: string;
    if (ctx.outcome === 'correct') {
      const secs = ctx.answerTimeMs ? (ctx.answerTimeMs / 1000).toFixed(1) : '?';
      what = `${ctx.winner} ha indovinato una domanda ${diff} (${qt}) in ${secs} secondi` +
        ((ctx.streak ?? 0) >= 3 ? `, ${ctx.streak} giuste di fila` : '');
    } else if (ctx.outcome === 'nobody') what = `nessuno ha avuto il coraggio di prenotarsi (domanda ${diff})`;
    else if (ctx.outcome === 'timeout') what = `tempo scaduto senza risposta (allenamento in solitaria)`;
    else what = `tutti hanno sbagliato la domanda (${qt})`;
    return head + `${what}. Classifica: ${top}.`;
  }
  if (ctx.kind === 'podium') {
    const list = ctx.standings.map((s, i) => `${i + 1}° ${s.nickname} ${s.score}`).join(', ');
    return (
      head +
      `la partita è finita, celebra chi ha vinto e prendi in giro con dolcezza gli ultimi. Classifica finale: ${list}.`
    );
  }
  return null; // welcome/join: bastano le battute pre-scritte
}

function findClaude(): string | null {
  const candidates = [
    ...(process.env.PATH ?? '').split(':').map((d) => `${d}/claude`),
    `${os.homedir()}/.nvm/versions/node/v24.12.0/bin/claude`,
    `${os.homedir()}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ];
  for (const c of candidates) {
    try {
      if (existsSync(c)) return c;
    } catch {
      // ignora path illeggibili
    }
  }
  return null;
}

function askClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = findClaude();
    if (!bin) return reject(new Error('claude CLI non trovato'));
    const child = spawn(bin, ['-p', prompt, '--model', 'haiku'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let out = '';
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      child.kill('SIGKILL');
      reject(new Error('timeout'));
    }, AI_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', (e) => {
      if (!done) {
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on('close', () => {
      if (done) return;
      clearTimeout(timer);
      const text = out.trim().replaceAll('\n', ' ').replace(/^["«]|["»]$/g, '').slice(0, 160);
      if (text.length < 4) reject(new Error('risposta vuota'));
      else resolve(text);
    });
  });
}

/**
 * Gestisce un evento: battuta immediata + upgrade AI asincrono.
 * `onUpdate` va chiamato a ogni modifica di room.sofia (bump versione + SSE).
 */
export async function sofiaOnEvent(room: SofiaRoom, ctx: SofiaEventCtx, onUpdate: () => void): Promise<void> {
  const { kind, name, n } = lineKindFor(ctx);
  const pool = LINES[kind];
  const canned = fillLine(pool[Math.floor(Math.random() * pool.length)], name, n);
  const seq = ++room.sofiaSeq;
  room.sofia = { text: canned, mood: MOODS[kind], roundIndex: room.roundIndex, ai: false, seq };
  onUpdate();

  if (!AI_ENABLED() || room.sofiaBusy) return;
  const prompt = aiPrompt(ctx);
  if (!prompt) return;
  room.sofiaBusy = true;
  try {
    const text = await askClaude(prompt);
    // sostituisce solo se nel frattempo non è uscita una battuta più recente
    // (il podio resta valido comunque: è l'ultimo commento della partita)
    if (room.sofia && (room.sofia.seq === seq || ctx.kind === 'podium')) {
      room.sofia = { text, mood: room.sofia.mood, roundIndex: room.sofia.roundIndex, ai: true, seq: ++room.sofiaSeq };
      onUpdate();
    }
  } catch {
    // l'AI non ha risposto in tempo: resta la battuta pre-scritta
  } finally {
    room.sofiaBusy = false;
  }
}
