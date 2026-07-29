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
import type { QuestionType, RoundOutcome, SofiaMood } from '../types';
import { T } from '../i18n';
import { HINTS, LINES, MOODS, fillLine, type SofiaLineKind } from './lines';

export type SofiaEventCtx =
  | { kind: 'welcome'; nickname: string }
  | { kind: 'join'; nickname: string }
  | { kind: 'special'; special: 'none' | 'twin' | 'lampo' | 'sofai' }
  | { kind: 'cocco'; nickname: string }
  | { kind: 'hint'; nickname: string; qtype: QuestionType }
  | { kind: 'rematch'; nickname: string }
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
  sofiaPending?: { ctx: SofiaEventCtx; seq: number; onUpdate: () => void };
  /** interrompe la chiamata AI in volo: la usa il podio per passare avanti */
  sofiaKill?: () => void;
  /** battute scritte dall'AI in anticipo, pronte da usare durante la partita */
  sofiaFresh?: Partial<Record<SofiaLineKind, string[]>>;
  /** quanti lotti sono già stati chiesti in questa partita */
  sofiaBatches?: number;
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

function lineKindFor(ctx: SofiaEventCtx): { kind: SofiaLineKind; name?: string; n?: number; tip?: string } {
  switch (ctx.kind) {
    case 'welcome':
      return { kind: 'welcome', name: ctx.nickname };
    case 'join':
      return { kind: 'join', name: ctx.nickname };
    case 'special':
      return { kind: ctx.special === 'twin' ? 'twin' : ctx.special === 'sofai' ? 'sofaiRound' : 'lampo' };
    case 'cocco':
      return { kind: 'cocco', name: ctx.nickname };
    case 'hint':
      return { kind: 'hint', name: ctx.nickname, tip: HINTS[ctx.qtype] };
    case 'rematch':
      return { kind: 'rematch', name: ctx.nickname };
    case 'podium':
      return { kind: 'podium', name: ctx.standings[0]?.nickname };
    case 'reveal': {
      if (ctx.outcome === 'correct') {
        if ((ctx.streak ?? 0) >= 3) return { kind: 'correctStreak', name: ctx.winner, n: ctx.streak };
        if ((ctx.answerTimeMs ?? Infinity) < 2000) return { kind: 'correctFast', name: ctx.winner };
        return { kind: 'correct', name: ctx.winner };
      }
      if (ctx.outcome === 'nobody') return { kind: 'nobody' };
      if (ctx.outcome === 'stolen') return { kind: 'stolen' };
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
    'Sei SofAI, la mascotte di un quiz a squadre per famiglie: ironica, pungente, un po\' teatrale, ma sempre affettuosa. ' +
    'Ti piace prenderti il merito delle domande belle e dare la colpa ai giocatori per quelle sbagliate. ' +
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
    else if (ctx.outcome === 'stolen')
      what = `round sfida: nessuno si è prenotato in tempo e tu, SofAI, hai RUBATO la domanda — pavoneggiati`;
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

/**
 * Momenti di gioco per cui l'AI prepara le battute in anticipo.
 * `nome: true` = la battuta può usare {name} (c'è qualcuno da nominare).
 */
const MOMENTI: ReadonlyArray<{ kind: SofiaLineKind; nome: boolean; quando: string }> = [
  { kind: 'correct', nome: true, quando: 'ha indovinato' },
  { kind: 'correctFast', nome: true, quando: 'ha indovinato in meno di due secondi' },
  { kind: 'correctStreak', nome: true, quando: 'ha indovinato parecchie volte di fila' },
  { kind: 'wrong', nome: true, quando: 'ha sbagliato la risposta' },
  { kind: 'nobody', nome: false, quando: 'nessuno si è prenotato per rispondere' },
  { kind: 'timeout', nome: false, quando: 'è scaduto il tempo senza che nessuno rispondesse' },
  { kind: 'exhausted', nome: false, quando: 'hanno sbagliato tutti' },
  { kind: 'twin', nome: false, quando: 'sta arrivando una domanda che sembra già vista ma non lo è' },
  { kind: 'lampo', nome: false, quando: 'round lampo: metà tempo e punti doppi' },
  { kind: 'sofaiRound', nome: false, quando: 'round sfida: annunci che giochi anche tu e che rubi la domanda a chi non si prenota' },
  { kind: 'stolen', nome: false, quando: 'hai rubato la domanda perché nessuno si è prenotato in tempo: pavoneggiati' },
  { kind: 'cocco', nome: true, quando: 'annunci che da adesso tifi per {name}, in fondo alla classifica' },
  { kind: 'rematch', nome: true, quando: 'ha chiesto la rivincita: si riparte da zero' },
];

/**
 * Il lotto può prendersela comoda: è la differenza fra chiedere una battuta
 * quando serve e prepararla prima. Nessuno lo aspetta — se tarda, per qualche
 * round si vedono le battute pre-scritte e poi entrano le sue. Scrivere nove
 * battute richiede molto più di una sola, e col limite dei 60 secondi il lotto
 * scadeva sempre.
 */
const WARMUP_TIMEOUT_MS = 180_000;

/** quante battute preparate restano prima di chiederne altre */
const SOGLIA_RICARICA = 3;
/** tetto di lotti per partita: l'AI costa tempo, non deve girare a vuoto */
const MAX_LOTTI = 6;

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

/**
 * Parole che si accordano con CHI GIOCA: il prompt le vieta, ma l'AI non è
 * deterministica e queste battute finiscono a schermo senza che nessuno le
 * rilegga. Una riga che ne contiene una si butta e si usa quella pre-scritta.
 *
 * L'elenco è volutamente stretto. La prima versione bloccava anche "prima",
 * "solito", "velocissima" e simili, che in italiano nove volte su dieci
 * concordano con un nome ("risposta velocissima", "prima ancora di pensarci")
 * e non con la persona: buttava battute perfette, in silenzio, e il momento
 * restava senza. Qui stanno solo le forme che si rivolgono davvero a qualcuno.
 */
// confini Unicode e non \b: in JavaScript \b guarda solo A-Z0-9_, quindi "\bè"
// non combacia MAI — la forma "è stata" sarebbe passata indisturbata
const RIVOLTO_A_UN_GENERE =
  /(?<!\p{L})(?:brav[oa]|pront[oa]|(?:sei|è|era|sarebbe|sembri|sembra)\s+stat[oa]|campion(?:e|essa)|cervellon[ea]|benvenut[oa]|scars[oa]|fenomen[oa]|da\s+sol[oa])(?!\p{L})/iu;

/** una riga sola, senza virgolette di contorno, entro la lunghezza mostrabile */
function clampLine(raw: string): string {
  return raw.trim().replaceAll('\n', ' ').replace(/\s+/g, ' ').replace(/^["«]|["»]$/g, '').trim().slice(0, MAX_TEXT);
}

/** true se la riga si può mostrare così com'è */
function usabile(text: string): boolean {
  return text.length >= 4 && !CHIEDE_CHIARIMENTI.test(text) && !RIVOLTO_A_UN_GENERE.test(text);
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

/** Lancia il CLI e restituisce quello che ha scritto, senza interpretarlo. */
function runClaude(prompt: string, onStart?: (kill: () => void) => void, timeoutMs = AI_TIMEOUT_MS): Promise<string> {
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
      reject(new Error(`timeout dopo ${timeoutMs}ms${err ? ` — stderr: ${err.slice(0, 300)}` : ''}`));
    }, timeoutMs);
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
      const text = out.trim();
      if (text.length >= 4) return resolve(text);
      reject(new Error(`uscita ${code} senza testo utile — stderr: ${err.trim().slice(0, 300) || '(vuoto)'}`));
    });
  });
}

/** Una battuta sola, pronta da mostrare. */
async function askOneLine(prompt: string, onStart?: (kill: () => void) => void): Promise<string> {
  const text = clampLine(await runClaude(prompt, onStart));
  // A volte il modello non fa la battuta: chiede altre informazioni. Non è un
  // testo da mostrare a fine partita, meglio la battuta pre-scritta.
  if (!usabile(text)) throw new Error(`risposta non utilizzabile: ${text.slice(0, 80)}`);
  return text;
}

/**
 * Chiede all'AI un lotto di battute per i momenti della partita.
 *
 * Nel prompt non entra NIENTE che venga da chi gioca: né nickname né nome
 * della squadra. Al posto del nome c'è il segnaposto {name}, riempito al
 * momento dell'uso — quindi qui non serve nemmeno il de-aliasing, e la
 * superficie d'attacco è zero.
 */
function warmupPrompt(): string {
  // il segnaposto va mostrato DENTRO l'elenco: chiederlo solo a parole, dopo
  // aver ordinato frasi impersonali, è una contraddizione — e infatti il
  // modello non lo scriveva mai
  const elenco = MOMENTI.map((m) => `${m.kind}: ${m.nome ? '{name} ' : ''}${m.quando}`).join('\n');
  return (
    'Sei SofAI, la mascotte di un quiz visuale a squadre per famiglie: ironica, pungente, un po\' teatrale, ' +
    'mai cattiva. Ti prendi il merito delle domande belle e dai la colpa ai giocatori per quelle sbagliate. ' +
    'Scrivi UNA battuta in italiano per ognuno dei momenti elencati sotto: originali, brevi (max 16 parole), ' +
    'al massimo 1 emoji, senza virgolette. ' +
    'ITALIANO NEUTRO, obbligatorio: devono funzionare per bambine, bambini, mamme, papà e nonni, quindi NIENTE ' +
    'aggettivi, participi o sostantivi al maschile o al femminile riferiti a chi gioca (vietati "bravo/brava", ' +
    '"sei stato/stata", "primo/prima", "campione/campionessa"). Usa verbi, frasi impersonali e parole invariabili. ' +
    'Niente asterischi, schwa o forme tipo "benvenut@". ' +
    'Dove nell\'elenco compare {name}, puoi usare {name} nella battuta: è il posto del nome di chi gioca, ' +
    'lo riempio io — scrivilo esattamente così, e va bene anche una battuta che non nomina nessuno. ' +
    'Nei momenti senza {name} invece non nominare nessuno e non scrivere {name}. ' +
    'In correctStreak puoi usare {n} per il numero di risposte di fila. ' +
    'Rispondi SOLO con righe nel formato "chiave: battuta", una per riga, senza altro testo.\n\n' +
    elenco
  );
}

/** Estrae le righe "chiave: battuta" e tiene solo quelle mostrabili. */
export function parseWarmup(raw: string): Partial<Record<SofiaLineKind, string[]>> {
  const perKind = new Map(MOMENTI.map((m) => [m.kind as string, m]));
  const out: Partial<Record<SofiaLineKind, string[]>> = {};
  for (const riga of raw.split('\n')) {
    const m = /^\s*[-*]?\s*([a-zA-Z]+)\s*[:\-]\s*(.+)$/.exec(riga);
    if (!m) continue;
    const momento = perKind.get(m[1]);
    if (!momento) continue;
    const testo = clampLine(m[2]);
    if (!usabile(testo)) continue;
    // {name} dove non c'è nessuno da nominare lascerebbe un buco nella frase;
    // il contrario invece va benissimo, una battuta impersonale funziona
    if (testo.includes('{name}') && !momento.nome) continue;
    if (testo.includes('{n}') && momento.kind !== 'correctStreak') continue;
    (out[momento.kind] ??= []).push(testo);
  }
  return out;
}

/**
 * Prepara le battute PRIMA che servano.
 *
 * È tutto il senso di questa funzione: il CLI impiega dai 10 ai 50 secondi e
 * un reveal dura 6, quindi una battuta chiesta sul momento non fa mai in
 * tempo. Chiesta all'inizio della partita, invece, è già lì quando serve — e
 * durante il gioco si vedono battute scritte dall'AI, non solo al podio.
 */
export function sofiaWarmup(room: SofiaRoom): void {
  if (!AI_ENABLED()) return;
  if ((room.sofiaBatches ?? 0) >= MAX_LOTTI) return;
  if (room.sofiaBusy) return;
  // stessa regola dell'altra chiamata: una partita che nessuno sta guardando
  // va avanti da sola per ore, e non deve continuare a chiedere battute
  if (!qualcunoGuarda(room)) return;
  room.sofiaBatches = (room.sofiaBatches ?? 0) + 1;
  void runWarmup(room);
}

async function runWarmup(room: SofiaRoom): Promise<void> {
  room.sofiaBusy = true;
  try {
    const t0 = Date.now();
    const lotto = parseWarmup(
      await runClaude(warmupPrompt(), (kill) => (room.sofiaKill = kill), WARMUP_TIMEOUT_MS)
    );
    const quante = Object.values(lotto).reduce((n, v) => n + v.length, 0);
    const scartati = MOMENTI.filter((m) => !lotto[m.kind]).map((m) => m.kind);
    room.sofiaFresh ??= {};
    for (const [kind, righe] of Object.entries(lotto)) {
      const k = kind as SofiaLineKind;
      (room.sofiaFresh[k] ??= []).push(...righe);
    }
    console.warn(
      `[SofAI] lotto ${room.sofiaBatches}: ${quante} battute pronte in ${Date.now() - t0}ms` +
        (scartati.length ? ` (senza: ${scartati.join(', ')})` : '')
    );
  } catch (e) {
    // niente battute preparate: restano quelle pre-scritte, e in partita non
    // cambia nulla. Il motivo però va scritto, o resta invisibile.
    console.warn('[SofAI] lotto non riuscito:', e instanceof Error ? e.message : e);
  } finally {
    room.sofiaBusy = false;
    room.sofiaKill = undefined;
    const pending = room.sofiaPending;
    room.sofiaPending = undefined;
    if (pending) await runAi(room, pending.ctx, pending.seq, pending.onUpdate);
  }
}

/** true se almeno una persona è collegata alla partita */
function qualcunoGuarda(room: SofiaRoom): boolean {
  return [...room.players.values()].some((p) => p.connections > 0);
}

/** quante battute preparate restano in tutto */
function rimaste(room: SofiaRoom): number {
  return Object.values(room.sofiaFresh ?? {}).reduce((n, v) => n + v.length, 0);
}

/**
 * Gestisce un evento: battuta immediata + upgrade AI asincrono.
 * `onUpdate` va chiamato a ogni modifica di room.sofia (bump versione + SSE).
 */
export async function sofiaOnEvent(room: SofiaRoom, ctx: SofiaEventCtx, onUpdate: () => void): Promise<void> {
  const { kind, name, n, tip } = lineKindFor(ctx);
  // se l'AI ne ha preparata una per questo momento si usa quella, altrimenti
  // la pre-scritta: in entrambi i casi compare SUBITO, il gioco non aspetta.
  // I consigli (hint) invece sono SEMPRE pre-scritti: devono essere veri.
  const preparata = kind === 'hint' ? undefined : room.sofiaFresh?.[kind]?.shift();
  const pool = LINES[kind];
  const testo = fillLine(preparata ?? pool[Math.floor(Math.random() * pool.length)], name, n, tip);
  const seq = ++room.sofiaSeq;
  room.sofia = { text: testo, mood: MOODS[kind], roundIndex: room.roundIndex, ai: preparata !== undefined, seq };
  onUpdate();

  // Ricarica quando la scorta si assottiglia, e soprattutto quando il momento
  // che serviva ADESSO non aveva battute: guardare solo il totale non bastava,
  // perché una partita può battere sempre sullo stesso momento (in solitaria,
  // per dire, il tempo che scade) e restare a secco proprio lì mentre le altre
  // scorte sono ancora piene.
  if (AI_ENABLED() && (preparata === undefined || rimaste(room) < SOGLIA_RICARICA)) sofiaWarmup(room);

  if (!AI_ENABLED()) return;
  if (!aiPrompt(ctx, aliasMap(ctx))) return; // welcome/join: nessuna chiamata AI

  // Una partita che nessuno sta guardando continua ad andare avanti da sola
  // fino allo sweep (2 ore). Generare battute per una stanza vuota non serve a
  // nessuno e ruba tempo alle partite vere: il CLI è una risorsa sola, e con
  // più chiamate in volo passa da 10 a 50 secondi di risposta.
  if (!qualcunoGuarda(room)) return;

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
      room.sofiaPending = { ctx, seq, onUpdate };
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
    const text = deAlias(await askOneLine(prompt, (kill) => (room.sofiaKill = kill)), alias);
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
