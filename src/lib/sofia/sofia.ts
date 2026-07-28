// SofAI, la mascotte del gioco. A ogni evento mostra subito una battuta
// pre-scritta; se SOFIA_AI=1 chiede in parallelo una battuta migliore al CLI
// di Claude e la sostituisce quando arriva, se il commento è ancora attuale.
// Il gioco non aspetta mai l'AI.
//
// SICUREZZA — i nickname arrivano da internet, quindi non devono MAI finire
// dentro il prompt di un agente:
//  1. nel prompt i giocatori sono placeholder ("Giocatore1"), rimappati sui
//     nomi veri solo dopo la risposta;
//  2. il CLI viene lanciato senza tool, senza MCP, senza settings utente,
//     con cwd in una directory vuota e un ambiente minimo (niente DATABASE_URL
//     né altri segreti del processo).

import { spawn } from 'child_process';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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
  sofiaPending?: { ctx: SofiaEventCtx; seq: number };
  roundIndex: number;
}

const AI_TIMEOUT_MS = 25_000;
const AI_ENABLED = () => process.env.SOFIA_AI === '1';
/** al massimo 8 giocatori nel prompt: tiene corto il testo e limita la superficie */
const MAX_STANDINGS = 8;

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

/** Sostituisce i nickname con alias neutri: nel prompt non entra testo utente. */
function aliasMap(ctx: SofiaEventCtx): Map<string, string> {
  const map = new Map<string, string>();
  const add = (nick?: string) => {
    if (nick && !map.has(nick)) map.set(nick, `Giocatore${map.size + 1}`);
  };
  if (ctx.kind === 'reveal') {
    add(ctx.winner);
    ctx.standings.slice(0, MAX_STANDINGS).forEach((s) => add(s.nickname));
  } else if (ctx.kind === 'podium') {
    ctx.standings.slice(0, MAX_STANDINGS).forEach((s) => add(s.nickname));
  }
  return map;
}

function aiPrompt(ctx: SofiaEventCtx, alias: Map<string, string>): string | null {
  const head =
    'Sei SofAI, la mascotte simpatica e un po\' sfottona di un quiz a squadre per famiglie. ' +
    'Scrivi UNA sola battuta in italiano (max 18 parole, al massimo 1 emoji), senza virgolette né premesse. ' +
    'Usa i nomi dei giocatori esattamente come sono scritti qui sotto. Situazione: ';
  const nameOf = (nick?: string) => (nick ? (alias.get(nick) ?? 'Giocatore') : 'Giocatore');
  if (ctx.kind === 'reveal') {
    const diff = T.difficulty[ctx.difficulty] ?? '';
    const qt = T.qtypes[ctx.qtype] ?? ctx.qtype;
    const top = ctx.standings
      .slice(0, 3)
      .map((s) => `${nameOf(s.nickname)} ${Math.round(s.score)}`)
      .join(', ');
    let what: string;
    if (ctx.outcome === 'correct') {
      const secs = ctx.answerTimeMs ? (ctx.answerTimeMs / 1000).toFixed(1) : '?';
      what =
        `${nameOf(ctx.winner)} ha indovinato una domanda ${diff} (${qt}) in ${secs} secondi` +
        ((ctx.streak ?? 0) >= 3 ? `, ${Math.round(ctx.streak ?? 0)} giuste di fila` : '');
    } else if (ctx.outcome === 'nobody') what = `nessuno ha avuto il coraggio di prenotarsi (domanda ${diff})`;
    else if (ctx.outcome === 'timeout') what = `tempo scaduto senza risposta (allenamento in solitaria)`;
    else what = `tutti hanno sbagliato la domanda (${qt})`;
    return head + `${what}. Classifica: ${top}.`;
  }
  if (ctx.kind === 'podium') {
    const list = ctx.standings
      .slice(0, MAX_STANDINGS)
      .map((s, i) => `${i + 1}° ${nameOf(s.nickname)} ${Math.round(s.score)}`)
      .join(', ');
    return (
      head +
      `la partita è finita, celebra chi ha vinto e prendi in giro con dolcezza gli ultimi. Classifica finale: ${list}.`
    );
  }
  return null; // welcome/join: bastano le battute pre-scritte
}

/** lunghezza massima della battuta mostrata in UI */
const MAX_TEXT = 160;

/**
 * Rimette i nickname veri al posto degli alias nella battuta generata.
 * Il clamp finale va fatto QUI: i nomi veri sono più lunghi dei placeholder.
 */
function deAlias(text: string, alias: Map<string, string>): string {
  let out = text;
  // dal placeholder più lungo al più corto: "Giocatore10" prima di "Giocatore1"
  const pairs = [...alias.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [nick, placeholder] of pairs) out = out.replaceAll(placeholder, nick);
  out = out.replace(/\s+/g, ' ').trim();
  return out.length > MAX_TEXT ? out.slice(0, MAX_TEXT - 1).trimEnd() + '…' : out;
}

function findClaude(): string | null {
  const candidates = [
    ...(process.env.PATH ?? '').split(':').map((d) => `${d}/claude`),
    `${os.homedir()}/.nvm/versions/node/v24.12.0/bin/claude`,
    `${os.homedir()}/.local/bin/claude`,
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    '/usr/bin/claude',
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

/** directory vuota usa-e-getta: il CLI non vede i file dell'applicazione */
let sandboxDir: string | null = null;
function getSandboxDir(): string {
  if (!sandboxDir) sandboxDir = mkdtempSync(join(tmpdir(), 'sofai-'));
  return sandboxDir;
}

const NO_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit'];

/** ambiente minimo: niente DATABASE_URL né altri segreti del processo server */
function minimalEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV,
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: process.env.HOME ?? os.homedir(), // serve al CLI per le sue credenziali
    USER: process.env.USER ?? '',
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? '',
    LANG: process.env.LANG ?? 'en_US.UTF-8',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
  };
}

function askClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = findClaude();
    if (!bin) return reject(new Error('claude CLI non trovato'));
    const child = spawn(
      bin,
      [
        '-p',
        prompt,
        '--model',
        'haiku',
        '--allowedTools',
        '',
        '--disallowedTools',
        ...NO_TOOLS,
        '--strict-mcp-config',
        '--mcp-config',
        '{"mcpServers":{}}',
        '--setting-sources',
        '',
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: getSandboxDir(),
        // ambiente minimo: niente DATABASE_URL né altri segreti del processo.
        // HOME serve solo al CLI per leggere le proprie credenziali.
        env: minimalEnv(),
      }
    );
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
      const text = out.trim().replaceAll('\n', ' ').replace(/^["«]|["»]$/g, '').slice(0, MAX_TEXT);
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

  if (!AI_ENABLED()) return;
  if (!aiPrompt(ctx, aliasMap(ctx))) return; // welcome/join: nessuna chiamata AI
  if (room.sofiaBusy) {
    // una chiamata AI alla volta: tieni da parte SOLO l'evento più recente
    // (il podio non va mai perso: è l'ultimo commento della partita)
    room.sofiaPending = { ctx, seq };
    return;
  }
  await runAi(room, ctx, seq, onUpdate);
}

async function runAi(room: SofiaRoom, ctx: SofiaEventCtx, seq: number, onUpdate: () => void): Promise<void> {
  const alias = aliasMap(ctx);
  const prompt = aiPrompt(ctx, alias);
  if (!prompt) return;
  room.sofiaBusy = true;
  try {
    const text = deAlias(await askClaude(prompt), alias);
    // sostituisce solo se nel frattempo non è uscita una battuta più recente
    if (room.sofia && (room.sofia.seq === seq || ctx.kind === 'podium')) {
      room.sofia = { text, mood: room.sofia.mood, roundIndex: room.sofia.roundIndex, ai: true, seq: ++room.sofiaSeq };
      onUpdate();
    }
  } catch {
    // l'AI non ha risposto in tempo: resta la battuta pre-scritta
  } finally {
    room.sofiaBusy = false;
    const pending = room.sofiaPending;
    room.sofiaPending = undefined;
    if (pending) await runAi(room, pending.ctx, pending.seq, onUpdate);
  }
}
