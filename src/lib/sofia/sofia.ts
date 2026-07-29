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
  | { kind: 'special'; special: 'none' | 'twin' | 'lampo' }
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
  /** interrompe la chiamata AI in volo: la usa il podio per passare avanti */
  sofiaKill?: () => void;
  roundIndex: number;
  players: Map<string, { connections: number }>;
}

// Misurato sul server: il CLI risponde in 10-12s quando è libero e in 30-50s
// se ci sono altre chiamate in volo. Con i 25s di prima scadeva sempre, e la
// battuta AI non si vedeva mai — senza che nulla lo segnalasse.
const AI_TIMEOUT_MS = 60_000;
/**
 * Quanto spesso l'AI commenta un round. Zero, e non per prudenza: un reveal
 * dura 6 secondi e l'AI ne impiega da 10 a 50, quindi la battuta arriverebbe
 * sempre a round finito e verrebbe scartata perché non più attuale. Chiederla
 * lo stesso significa solo tenere occupata l'unica linea disponibile e far
 * aspettare il podio, che invece la battuta la aspetta davvero.
 * Durante la partita restano le battute pre-scritte, che sono immediate.
 * Se un giorno il CLI diventasse molto più rapido, basta rialzare questo
 * numero.
 */
const REVEAL_AI_CHANCE = 0;
const AI_ENABLED = () => process.env.SOFIA_AI === '1';
/** al massimo 8 giocatori nel prompt: tiene corto il testo e limita la superficie */
const MAX_STANDINGS = 8;

function lineKindFor(ctx: SofiaEventCtx): { kind: SofiaLineKind; name?: string; n?: number } {
  switch (ctx.kind) {
    case 'welcome':
      return { kind: 'welcome', name: ctx.nickname };
    case 'join':
      return { kind: 'join', name: ctx.nickname };
    case 'special':
      return { kind: ctx.special === 'twin' ? 'twin' : 'lampo' };
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
    'Usa i nomi di chi gioca esattamente come sono scritti qui sotto e non dedurre da un nome se la persona è maschio o femmina. ' +
    'ITALIANO NEUTRO, obbligatorio: la battuta deve funzionare per bambine, bambini, mamme, papà e nonni, quindi NIENTE aggettivi, ' +
    'participi o sostantivi al maschile o al femminile riferiti a chi gioca (vietati "bravo/brava", "sei stato/stata", "primo/prima", ' +
    '"campione/campionessa", "veloce" va bene perché invariabile). Usa invece verbi, frasi impersonali, parole invariabili o ' +
    'sostantivi che descrivono la cosa e non la persona ("che colpo!", "primo posto", "risposta lampo", "hai il cervello più veloce"). ' +
    'Niente asterischi, schwa o forme tipo "benvenut@". ' +
    'Situazione: ';
  // Il ripiego non passa da deAlias (non è un alias numerato) e finirebbe a
  // schermo così com'è: dev'essere invariabile, non "Giocatore".
  const nameOf = (nick?: string) => (nick ? (alias.get(nick) ?? 'chi gioca') : 'chi gioca');
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
    // Con una persona sola (allenamento in solitaria) non esiste "chi è in
    // fondo alla classifica": chiedendolo lo stesso, il modello risponde
    // chiedendo la classifica completa invece di fare la battuta, e quella
    // richiesta finiva dritta sul podio.
    if (ctx.standings.length < 2) {
      const solo = ctx.standings[0];
      return (
        head +
        `l'allenamento in solitaria è finito, ${nameOf(solo?.nickname)} ha chiuso con ${Math.round(solo?.score ?? 0)} punti. ` +
        `Commenta il risultato: non c'è nessun altro in classifica, quindi non paragonare a nessuno.`
      );
    }
    const list = ctx.standings
      .slice(0, MAX_STANDINGS)
      .map((s, i) => `${i + 1}° ${nameOf(s.nickname)} ${Math.round(s.score)}`)
      .join(', ');
    return (
      head +
      `la partita è finita, celebra chi ha vinto e prendi in giro con dolcezza chi è in fondo alla classifica. Classifica finale: ${list}.`
    );
  }
  return null; // welcome/join: bastano le battute pre-scritte
}

/** lunghezza massima della battuta mostrata in UI */
const MAX_TEXT = 160;

/** il modello chiede informazioni invece di fare la battuta */
const CHIEDE_CHIARIMENTI =
  /\b(mi serve|mi servono|non ho (il |abbastanza )?(contesto|informazioni)|puoi (dirmi|fornirmi)|potrebbe fornir|mi mancano|fammi sapere|per favore forniscimi)\b/i;

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

function askClaude(prompt: string, onStart?: (kill: () => void) => void): Promise<string> {
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
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      done = true;
      child.kill('SIGKILL');
      reject(new Error(`timeout dopo ${AI_TIMEOUT_MS}ms${err ? ` — stderr: ${err.slice(0, 300)}` : ''}`));
    }, AI_TIMEOUT_MS);
    onStart?.(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new Error('interrotta: ha la precedenza il podio'));
    });
    child.stdout.on('data', (d) => (out += d));
    // stderr va CONSUMATO anche se non serve: è una pipe, e se si riempie il
    // CLI si blocca a metà scrittura e la battuta non arriva mai.
    child.stderr.on('data', (d) => {
      if (err.length < 4000) err += d;
    });
    child.on('error', (e) => {
      if (!done) {
        clearTimeout(timer);
        reject(e);
      }
    });
    child.on('close', (code) => {
      if (done) return;
      clearTimeout(timer);
      const text = out.trim().replaceAll('\n', ' ').replace(/^["«]|["»]$/g, '').slice(0, MAX_TEXT);
      // A volte il modello non fa la battuta: chiede altre informazioni. Non è
      // un testo da mostrare a fine partita, meglio la battuta pre-scritta.
      if (CHIEDE_CHIARIMENTI.test(text)) return reject(new Error(`risposta non utilizzabile: ${text.slice(0, 80)}`));
      if (text.length >= 4) return resolve(text);
      reject(new Error(`uscita ${code} senza testo utile — stderr: ${err.trim().slice(0, 300) || '(vuoto)'}`));
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

  // Una partita che nessuno sta guardando continua ad andare avanti da sola
  // fino allo sweep (2 ore). Generare battute per una stanza vuota non serve a
  // nessuno e ruba tempo alle partite vere: il CLI è una risorsa sola, e con
  // più chiamate in volo passa da 10 a 50 secondi di risposta.
  if (![...room.players.values()].some((p) => p.connections > 0)) return;

  // Quanto ci mette davvero l'AI (misurato in produzione): 10-12 secondi
  // quando è libera, 30-50 se ci sono altre chiamate in volo. Un round ne dura
  // circa 25 e il reveal appena 6: una battuta di round chiesta adesso arriva
  // quasi sempre a giochi fatti e viene scartata perché non è più attuale.
  // Quindi se ne chiede una ogni tanto — quando arriva in tempo è un bel colpo
  // — e per il resto si tiene la linea libera per il podio, che è il momento
  // in cui la battuta si legge con calma ed è l'ultima cosa che resta.
  if (ctx.kind === 'reveal' && Math.random() > REVEAL_AI_CHANCE) return;

  if (room.sofiaBusy) {
    // Una chiamata alla volta. Un commento di round che aspetta il suo turno
    // sarebbe vecchio due volte: si lascia perdere. Il podio invece aspetta.
    if (ctx.kind === 'podium') {
      room.sofiaPending = { ctx, seq };
      // La battuta di round in volo non la leggerà più nessuno: la partita è
      // finita. Interromperla fa partire subito quella del podio, che
      // altrimenti aspetterebbe quasi un minuto davanti alla classifica.
      room.sofiaKill?.();
    }
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
    const t0 = Date.now();
    const text = deAlias(await askClaude(prompt, (kill) => (room.sofiaKill = kill)), alias);
    console.warn(`[SofAI] AI ok (${ctx.kind}) in ${Date.now() - t0}ms`);
    // sostituisce solo se nel frattempo non è uscita una battuta più recente
    if (room.sofia && (room.sofia.seq === seq || ctx.kind === 'podium')) {
      room.sofia = { text, mood: room.sofia.mood, roundIndex: room.sofia.roundIndex, ai: true, seq: ++room.sofiaSeq };
      onUpdate();
    }
  } catch (e) {
    // Resta la battuta pre-scritta, e in partita non si nota nulla: proprio per
    // questo il motivo va scritto nei log, o l'AI può restare spenta per
    // settimane senza che nessuno se ne accorga.
    console.warn(`[SofAI] AI non disponibile (${ctx.kind}):`, e instanceof Error ? e.message : e);
  } finally {
    room.sofiaBusy = false;
    room.sofiaKill = undefined;
    const pending = room.sofiaPending;
    room.sofiaPending = undefined;
    if (pending) await runAi(room, pending.ctx, pending.seq, onUpdate);
  }
}
