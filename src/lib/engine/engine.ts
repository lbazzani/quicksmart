// GameEngine: stato autoritativo delle partite attive, in-memory.
// Macchina a stati per round: countdown → buzz → answer → (riapertura|reveal) → …
// Tutti i timer vivono lato server; i client ricevono snapshot via SSE.

import { EventEmitter } from 'events';
import { randomBytes } from 'crypto';
import os from 'os';
import type {
  Difficulty,
  GameMode,
  GameSettings,
  GameSnapshot,
  GameStatus,
  Phase,
  PlayerPublic,
  PlayerStats,
  Question,
  RoundOutcome,
  SofiaComment,
  SpecialRound,
} from '../types';
import {
  NOBODY_PENALTY,
  REOPEN_WINDOW_MS,
  baseValue,
  correctPoints,
  decayedValue,
  mutePenalty,
  soloTimeoutPenalty,
  wrongPenalty,
} from '../scoring';
import { dbAddPlayer, dbCreateGame, dbLoadQuestions, dbSavePlayer, dbSaveRound, dbSetGameStatus } from './store';
import { sofiaOnEvent, sofiaWarmup, type SofiaEventCtx } from '../sofia/sofia';
import type { SofiaLineKind } from '../sofia/lines';
import { LiveQuestions, freshSeed, reshuffleChoices } from '../questions/live';
import { TwinPool } from '../questions/twin';
import { mulberry32, type Rng } from '../rng';

const COUNTDOWN_MS = 3000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // sweep partite morte dopo 2h
/** quante domande carica alla volta una partita "aperta" (senza numero di round) */
const OPEN_GAME_BLOCK = 30;
/** tetto di stanze attive: evita che qualcuno riempia la memoria creando partite */
const MAX_ROOMS = 300;
/** tetto di giocatori per stanza */
const MAX_PLAYERS_PER_ROOM = 24;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUWXYZ';

export interface RoomPlayer {
  id: string;
  nickname: string;
  avatar: string;
  token: string;
  isHost: boolean;
  score: number;
  streak: number;
  connections: number;
  lastDelta: number;
  stats: PlayerStats;
  /** round in cui è entrato a partita in corso (-1 se era già in lobby) */
  joinedAtRound: number;
}

interface CurrentRound {
  q: Question;
  value: number;
  errors: number;
  lockedOut: Set<string>;
  countdownEndsAt?: number;
  buzzDeadline?: number;
  answerDeadline?: number;
  buzzerId?: string;
  special: SpecialRound;
  answerStartAt?: number;
  answeredIndex?: number;
  outcome?: RoundOutcome;
  winnerId?: string;
  answerTimeMs?: number;
  revealUntil?: number;
}

export interface Room {
  code: string;
  gameId: string;
  name: string;
  mode: GameMode;
  settings: GameSettings;
  status: GameStatus;
  phase: Phase;
  roundIndex: number;
  players: Map<string, RoomPlayer>;
  /** nickname in corso di inserimento (guardia sincrona contro join concorrenti) */
  pendingNicknames: Set<string>;
  questions: Question[];
  /** id delle domande già usate: le partite aperte ricaricano il pool senza ripetere */
  usedQuestionIds: Set<number>;
  /** fabbrica di domande della partita (seme casuale, strutture recenti evitate) */
  live: LiveQuestions;
  /** domande già mostrate, per costruire le gemelle */
  twins: TwinPool;
  /** rng della partita per le scelte di regia (round speciali, gemelle) */
  rng: Rng;
  /** round in cui è già stata usata una gemella, per non abusarne */
  lastTwinRound: number;
  current: CurrentRound | null;
  // stato di SofAI: il significato dei campi sta in src/lib/sofia/sofia.ts
  sofia: SofiaComment | null;
  sofiaSeq: number;
  sofiaBusy: boolean;
  sofiaPending?: { ctx: SofiaEventCtx; seq: number; onUpdate: () => void };
  sofiaKill?: () => void;
  sofiaFresh?: Partial<Record<SofiaLineKind, string[]>>;
  sofiaBatches?: number;
  version: number;
  epoch: number; // invalida i timer di fasi superate
  timer: NodeJS.Timeout | null;
  emitter: EventEmitter;
  lastActivity: number;
}

/**
 * Ripulisce un nickname che arriva da internet: solo lettere, numeri, spazi e
 * pochi segni. Niente newline o caratteri di controllo — il nome viene mostrato
 * a tutti e passa vicino a sistemi che interpretano testo.
 */
export function sanitizeNickname(raw: string): string {
  return [...raw.normalize('NFC')]
    .filter((ch) => /[\p{L}\p{N} '._-]/u.test(ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
}

function newStats(): PlayerStats {
  return { correct: 0, wrong: 0, buzzWins: 0, noAnswer: 0, bestStreak: 0, answerTimeMsSum: 0, answerCount: 0 };
}

/** difficoltà del round i: rampa facile → difficile */
export function difficultyForRound(i: number, total: number | null): Difficulty {
  if (total && total > 0) {
    const frac = i / total;
    return frac < 0.3 ? 1 : frac < 0.65 ? 2 : 3;
  }
  return i < 4 ? 1 : i < 10 ? 2 : 3;
}

function lanIp(): string | null {
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

export class GameEngine {
  rooms = new Map<string, Room>();

  private makeCode(): string {
    let code = '';
    do {
      code = Array.from({ length: 5 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
    } while (this.rooms.has(code));
    return code;
  }

  private sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivity <= ROOM_TTL_MS) continue;
      // non buttare fuori chi è ancora connesso: rimanda lo sweep
      const connected = [...room.players.values()].some((p) => p.connections > 0);
      if (connected) {
        room.lastActivity = now;
        continue;
      }
      if (room.timer) clearTimeout(room.timer);
      room.emitter.emit('closed');
      this.rooms.delete(code);
    }
  }

  joinUrl(code: string): string | undefined {
    // in produzione PUBLIC_URL è il dominio del sito; in LAN usiamo l'IP locale
    if (process.env.PUBLIC_URL) return `${process.env.PUBLIC_URL.replace(/\/$/, '')}/join?code=${code}`;
    const ip = lanIp();
    const port = process.env.PORT ?? '3000';
    return ip ? `http://${ip}:${port}/join?code=${code}` : undefined;
  }

  async createGame(opts: {
    name: string;
    mode: GameMode;
    nickname: string;
    avatar: string;
    roundsTotal: number | null;
    buzzWindowMs: number;
    answerMs: number;
  }): Promise<{ code: string; playerId: string; token: string }> {
    this.sweep();
    if (this.rooms.size >= MAX_ROOMS) throw new Error('too_many_rooms');
    const settings: GameSettings = {
      mode: opts.mode,
      roundsTotal: opts.roundsTotal,
      buzzWindowMs: opts.buzzWindowMs,
      answerMs: opts.answerMs,
      revealMs: 6000,
    };
    const nickname = sanitizeNickname(opts.nickname);
    if (!nickname) throw new Error('nickname_required');
    const seed = freshSeed(); // ogni partita pesca da un punto diverso dello spazio
    const code = this.makeCode();
    const gameId = await dbCreateGame(code, opts.name, opts.mode, settings);
    const token = randomBytes(16).toString('hex');
    const playerId = await dbAddPlayer(gameId, nickname, opts.avatar, token, true);
    const room: Room = {
      code,
      gameId,
      name: opts.name,
      mode: opts.mode,
      settings,
      status: 'lobby',
      phase: 'idle',
      roundIndex: -1,
      players: new Map(),
      pendingNicknames: new Set(),
      questions: [],
      usedQuestionIds: new Set(),
      live: new LiveQuestions(seed),
      twins: new TwinPool(),
      rng: mulberry32(seed ^ 0x5eed),
      lastTwinRound: -99,
      current: null,
      sofia: null,
      sofiaSeq: 0,
      sofiaBusy: false,
      version: 1,
      epoch: 0,
      timer: null,
      emitter: new EventEmitter(),
      lastActivity: Date.now(),
    };
    room.emitter.setMaxListeners(50);
    room.players.set(playerId, {
      id: playerId,
      nickname,
      avatar: opts.avatar,
      token,
      isHost: true,
      score: 0,
      streak: 0,
      connections: 0,
      lastDelta: 0,
      stats: newStats(),
      joinedAtRound: -1,
    });
    this.rooms.set(code, room);
    this.sofia(room, { kind: 'welcome', nickname });
    return { code, playerId, token };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  auth(room: Room, playerId: string, token: string): RoomPlayer | null {
    const p = room.players.get(playerId);
    return p && p.token === token ? p : null;
  }

  async join(
    code: string,
    nickname: string,
    avatar: string
  ): Promise<
    | { ok: true; playerId: string; token: string }
    | { ok: false; error: 'not_found' | 'ended' | 'nickname_taken' | 'room_full' }
  > {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    // si può entrare anche a partita iniziata (in famiglia c'è sempre chi
    // arriva in ritardo): si parte dal round successivo, con zero punti
    if (room.status === 'ended') return { ok: false, error: 'ended' };
    if (room.players.size >= MAX_PLAYERS_PER_ROOM) return { ok: false, error: 'room_full' };
    const clean = sanitizeNickname(nickname);
    if (!clean) return { ok: false, error: 'nickname_taken' };
    const key = clean.toLowerCase();
    for (const p of room.players.values()) {
      if (p.nickname.toLowerCase() === key) return { ok: false, error: 'nickname_taken' };
    }
    // prenota il nome PRIMA dell'await: due join simultanei con lo stesso
    // nickname (o un join mentre parte la partita) non devono passare entrambi
    if (room.pendingNicknames.has(key)) return { ok: false, error: 'nickname_taken' };
    room.pendingNicknames.add(key);
    const token = randomBytes(16).toString('hex');
    let playerId: string;
    try {
      playerId = await dbAddPlayer(room.gameId, clean, avatar, token, false);
    } finally {
      room.pendingNicknames.delete(key);
    }
    // la partita può essere finita durante l'INSERT (il tipo si è ristretto
    // sopra, ma lo stato è cambiato davvero durante l'await)
    if ((room.status as GameStatus) === 'ended') return { ok: false, error: 'ended' };
    room.players.set(playerId, {
      id: playerId,
      nickname: clean,
      avatar,
      token,
      isHost: false,
      score: 0,
      streak: 0,
      connections: 0,
      lastDelta: 0,
      stats: newStats(),
      joinedAtRound: room.status === 'playing' ? room.roundIndex : -1,
    });
    // chi arriva a round iniziato guarda questo e gioca dal successivo: ha
    // visto la domanda a metà, non sarebbe una gara alla pari
    if (room.status === 'playing' && room.current) room.current.lockedOut.add(playerId);
    room.lastActivity = Date.now();
    this.sofia(room, { kind: 'join', nickname: clean });
    this.bump(room);
    return { ok: true, playerId, token };
  }

  /**
   * Prepara un blocco di domande a partire dal round `fromRound`.
   *
   * Le domande si generano al volo (spazio: decine di milioni di combinazioni,
   * opzioni rimescolate a ogni presentazione), così non c'è nulla da imparare a
   * memoria. Se la generazione fallisce del tutto si ripiega sull'archivio in
   * Postgres, che resta come rete di sicurezza.
   */
  private async loadPool(room: Room, fromRound = 0, size?: number): Promise<number> {
    const total = room.settings.roundsTotal;
    const poolSize = size ?? total ?? OPEN_GAME_BLOCK;
    const added: Question[] = [];
    for (let i = 0; i < poolSize; i++) {
      try {
        added.push(room.live.next(difficultyForRound(fromRound + i, total)));
      } catch (e) {
        console.error('generazione domanda fallita:', e);
        break;
      }
    }
    if (added.length === 0) {
      const counts: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0 };
      for (let i = 0; i < poolSize; i++) counts[difficultyForRound(fromRound + i, total)]++;
      const byDiff = await dbLoadQuestions(counts, [...room.usedQuestionIds]);
      for (let i = 0; i < poolSize; i++) {
        const want = difficultyForRound(fromRound + i, total);
        const q = byDiff[want].pop() ?? byDiff[2].pop() ?? byDiff[1].pop() ?? byDiff[3].pop();
        if (!q) break;
        if (q.id !== undefined) room.usedQuestionIds.add(q.id);
        added.push(reshuffleChoices(q));
      }
    }
    room.questions.push(...added);
    return added.length;
  }

  async start(code: string, playerId: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    const p = this.auth(room, playerId, token);
    if (!p?.isHost) return { ok: false, error: 'not_host' };
    if (room.status !== 'lobby') return { ok: false, error: 'already_started' };
    // guardia sincrona: un secondo POST (doppio tap) non deve ricaricare il pool
    room.status = 'playing';
    try {
      await this.loadPool(room);
    } catch (e) {
      room.status = 'lobby';
      console.error('loadPool fallito:', e);
      return { ok: false, error: 'db_error' };
    }
    if (room.questions.length === 0) {
      room.status = 'lobby';
      return { ok: false, error: 'no_questions' };
    }
    // se l'archivio non basta per tutti i round richiesti, la partita dura
    // quanto le domande disponibili (e la UI mostra il totale reale)
    if (room.settings.roundsTotal && room.questions.length < room.settings.roundsTotal) {
      room.settings.roundsTotal = room.questions.length;
    }
    dbSetGameStatus(room.gameId, 'playing').catch(console.error);
    // chiede subito all'AI le battute della partita: ci mette decine di
    // secondi, ma qui c'è tutto il tempo — il primo reveal è lontano
    sofiaWarmup(room);
    this.startRound(room, 0);
    return { ok: true };
  }

  private schedule(room: Room, ms: number, fn: () => void) {
    if (room.timer) clearTimeout(room.timer);
    const epoch = room.epoch;
    room.timer = setTimeout(() => {
      if (room.epoch === epoch) fn();
    }, ms);
  }

  private bump(room: Room) {
    room.version++;
    room.lastActivity = Date.now();
    room.emitter.emit('update');
  }

  /**
   * Decide se questo round è speciale.
   * - `twin`: ripropone la gemella di una domanda già vista (stessa struttura,
   *   risposta diversa) — la trappola per chi gioca a memoria;
   * - `lampo`: metà tempo per rispondere, punti raddoppiati.
   * Mai due round speciali di fila, e mai prima del quarto round.
   */
  private pickSpecial(room: Room, index: number): { kind: SpecialRound; question?: Question } {
    if (room.mode === 'solo' && index < 2) return { kind: 'none' };
    if (index < 3 || index - room.lastTwinRound < 3) return { kind: 'none' };
    if (room.rng() < 0.35) {
      const made = room.twins.makeTwin(room.rng);
      if (made) {
        room.lastTwinRound = index;
        return { kind: 'twin', question: made.twin };
      }
    }
    if (room.rng() < 0.2) {
      room.lastTwinRound = index; // vale come "round speciale già speso"
      return { kind: 'lampo' };
    }
    return { kind: 'none' };
  }

  private startRound(room: Room, index: number) {
    if (room.status !== 'playing') return; // partita terminata nel frattempo
    if (index >= room.questions.length) {
      this.finish(room);
      return;
    }
    room.epoch++;
    room.roundIndex = index;
    const special = this.pickSpecial(room, index);
    const q = special.question ?? room.questions[index];
    room.twins.add(q);
    for (const p of room.players.values()) p.lastDelta = 0;
    room.current = {
      q,
      value: baseValue(q.difficulty) * (special.kind === 'lampo' ? 2 : 1),
      errors: 0,
      lockedOut: new Set(),
      special: special.kind,
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
    };
    room.phase = 'countdown';
    // i round speciali vanno annunciati; quelli normali non hanno nulla da dire
    if (special.kind !== 'none') this.sofia(room, { kind: 'special', special: special.kind });
    this.schedule(room, COUNTDOWN_MS, () =>
      this.enterBuzz(room, room.settings.buzzWindowMs)
    );
    this.bump(room);
  }

  /** tempo per rispondere in questo round (dimezzato nei round Lampo) */
  private answerMsFor(room: Room): number {
    const base = room.settings.answerMs;
    return room.current?.special === 'lampo' ? Math.max(2500, Math.round(base / 2)) : base;
  }

  private enterBuzz(room: Room, windowMs: number) {
    if (!room.current) return;
    room.epoch++;
    room.phase = 'buzz';
    room.current.buzzDeadline = Date.now() + windowMs;
    this.schedule(room, windowMs, () => this.onBuzzTimeout(room));
    this.bump(room);
  }

  buzz(code: string, playerId: string, token: string): { ok: boolean; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    const p = this.auth(room, playerId, token);
    if (!p) return { ok: false, error: 'unauthorized' };
    const cur = room.current;
    if (room.phase !== 'buzz' || !cur) return { ok: false, error: 'too_late' };
    if (cur.lockedOut.has(playerId)) return { ok: false, error: 'locked_out' };
    // arbitraggio: questo blocco è sincrono, il primo che arriva vince
    room.epoch++;
    room.phase = 'answer';
    cur.buzzerId = playerId;
    cur.answerStartAt = Date.now();
    cur.answerDeadline = Date.now() + this.answerMsFor(room);
    p.stats.buzzWins++;
    this.schedule(room, this.answerMsFor(room), () => this.onAnswerTimeout(room));
    this.bump(room);
    return { ok: true };
  }

  answer(code: string, playerId: string, token: string, choiceIndex: number): { ok: boolean; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    const p = this.auth(room, playerId, token);
    if (!p) return { ok: false, error: 'unauthorized' };
    const cur = room.current;
    if (room.phase !== 'answer' || !cur || cur.buzzerId !== playerId) return { ok: false, error: 'not_answering' };
    if (![0, 1, 2].includes(choiceIndex)) return { ok: false, error: 'bad_choice' };

    room.epoch++;
    const elapsed = Date.now() - (cur.answerStartAt ?? Date.now());
    cur.answeredIndex = choiceIndex;
    p.stats.answerTimeMsSum += elapsed;
    p.stats.answerCount++;

    if (choiceIndex === cur.q.correctIndex) {
      const remainingFrac = 1 - elapsed / this.answerMsFor(room);
      p.streak++;
      p.stats.correct++;
      p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak);
      const delta = correctPoints(cur.value, remainingFrac, p.streak, cur.special === 'twin');
      p.score += delta;
      p.lastDelta += delta;
      cur.winnerId = playerId;
      cur.answerTimeMs = elapsed;
      this.reveal(room, 'correct');
    } else {
      p.streak = 0;
      p.stats.wrong++;
      const delta = wrongPenalty(cur.value, cur.special === 'twin');
      p.score += delta;
      p.lastDelta += delta;
      this.afterMiss(room, playerId);
    }
    return { ok: true };
  }

  private onAnswerTimeout(room: Room) {
    const cur = room.current;
    if (room.phase !== 'answer' || !cur?.buzzerId) return;
    const p = room.players.get(cur.buzzerId);
    room.epoch++;
    if (p) {
      p.streak = 0;
      p.stats.noAnswer++;
      const delta = mutePenalty(cur.value);
      p.score += delta;
      p.lastDelta += delta;
    }
    this.afterMiss(room, cur.buzzerId, true);
  }

  /** dopo un errore o un buzz muto: riapre la domanda o chiude il round */
  private afterMiss(room: Room, playerId: string, wasMute = false) {
    const cur = room.current!;
    cur.lockedOut.add(playerId);
    cur.errors++;
    cur.value = decayedValue(cur.q.difficulty, cur.errors);
    cur.buzzerId = undefined;
    cur.answerDeadline = undefined;
    const eligible = [...room.players.keys()].filter((id) => !cur.lockedOut.has(id));
    if (room.mode === 'solo' || eligible.length === 0) {
      this.reveal(room, 'exhausted');
    } else {
      void wasMute;
      this.enterBuzz(room, REOPEN_WINDOW_MS);
    }
  }

  private onBuzzTimeout(room: Room) {
    const cur = room.current;
    if (room.phase !== 'buzz' || !cur) return;
    room.epoch++;
    if (room.mode === 'solo') {
      for (const p of room.players.values()) {
        // la streak si azzera solo sbagliando, non se non ti prenoti
        const delta = soloTimeoutPenalty(cur.q.difficulty);
        p.score += delta;
        p.lastDelta += delta;
      }
      this.reveal(room, 'timeout');
    } else {
      for (const p of room.players.values()) {
        if (!cur.lockedOut.has(p.id)) {
          p.score += NOBODY_PENALTY;
          p.lastDelta += NOBODY_PENALTY;
        }
      }
      this.reveal(room, 'nobody');
    }
  }

  private reveal(room: Room, outcome: RoundOutcome) {
    const cur = room.current!;
    room.epoch++;
    room.phase = 'reveal';
    cur.outcome = outcome;
    cur.revealUntil = Date.now() + room.settings.revealMs;

    // persistenza asincrona
    const deltas: Record<string, number> = {};
    for (const p of room.players.values()) {
      deltas[p.nickname] = p.lastDelta;
      dbSavePlayer(p.id, p.score, p.stats).catch(console.error);
    }
    dbSaveRound(room.gameId, room.roundIndex, cur.q.id, outcome, {
      winner: cur.winnerId ? room.players.get(cur.winnerId)?.nickname : null,
      answerTimeMs: cur.answerTimeMs,
      errors: cur.errors,
      deltas,
    }).catch(console.error);

    // Sofia commenta il round
    const winner = cur.winnerId ? room.players.get(cur.winnerId) : undefined;
    this.sofia(room, {
      kind: 'reveal',
      outcome,
      winner: winner?.nickname,
      answerTimeMs: cur.answerTimeMs,
      streak: winner?.streak,
      qtype: cur.q.qtype,
      difficulty: cur.q.difficulty,
      roundIndex: room.roundIndex,
      standings: this.standings(room),
    });

    this.schedule(room, room.settings.revealMs, () => {
      const total = room.settings.roundsTotal;
      if (total && room.roundIndex + 1 >= total) this.finish(room);
      else this.nextRound(room);
    });
    this.bump(room);
  }

  /**
   * Passa al round successivo. Nelle partite aperte, se il pool è agli sgoccioli
   * ne carica un altro blocco (senza ripetere le domande già viste).
   */
  private nextRound(room: Room) {
    const next = room.roundIndex + 1;
    if (!room.settings.roundsTotal && next >= room.questions.length - 2) {
      this.loadPool(room, room.questions.length)
        .catch((e) => console.error('ricarica pool fallita:', e))
        .finally(() => this.startRound(room, next));
      return;
    }
    this.startRound(room, next);
  }

  async end(code: string, playerId: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    const p = this.auth(room, playerId, token);
    if (!p?.isHost) return { ok: false, error: 'not_host' };
    if (room.status !== 'playing') return { ok: false, error: 'not_playing' };
    room.epoch++;
    if (room.timer) clearTimeout(room.timer);
    this.finish(room);
    return { ok: true };
  }

  private finish(room: Room) {
    room.epoch++;
    room.status = 'ended';
    room.phase = 'idle';
    room.current = null;
    dbSetGameStatus(room.gameId, 'ended', true).catch(console.error);
    for (const p of room.players.values()) dbSavePlayer(p.id, p.score, p.stats).catch(console.error);
    this.sofia(room, { kind: 'podium', standings: this.standings(room) });
    this.bump(room);
  }

  private standings(room: Room): { nickname: string; score: number }[] {
    return [...room.players.values()]
      .sort((a, b) => b.score - a.score)
      .map((p) => ({ nickname: p.nickname, score: p.score }));
  }

  /** commento di Sofia: battuta immediata + eventuale upgrade AI asincrono */
  private sofia(room: Room, ctx: SofiaEventCtx) {
    sofiaOnEvent(room, ctx, () => this.bump(room)).catch(console.error);
  }

  connection(code: string, playerId: string, delta: 1 | -1) {
    const room = this.getRoom(code);
    const p = room?.players.get(playerId);
    if (room && p) {
      p.connections = Math.max(0, p.connections + delta);
      this.bump(room);
    }
  }

  snapshot(room: Room): GameSnapshot {
    const cur = room.current;
    const revealing = room.phase === 'reveal';
    const players: PlayerPublic[] = [...room.players.values()]
      .map((p) => ({
        id: p.id,
        nickname: p.nickname,
        avatar: p.avatar,
        isHost: p.isHost,
        score: p.score,
        streak: p.streak,
        connected: p.connections > 0,
        lastDelta: p.lastDelta,
        stats: p.stats,
        joinedAtRound: p.joinedAtRound,
      }))
      .sort((a, b) => b.score - a.score);
    return {
      code: room.code,
      name: room.name,
      mode: room.mode,
      settings: room.settings,
      status: room.status,
      phase: room.phase,
      roundIndex: room.roundIndex,
      players,
      serverNow: Date.now(),
      version: room.version,
      sofia: room.sofia,
      joinUrl: room.status === 'lobby' ? this.joinUrl(room.code) : undefined,
      current: cur
        ? {
            qtype: cur.q.qtype,
            difficulty: cur.q.difficulty,
            // durante il countdown la domanda non è ancora visibile a nessuno, e
            // le opzioni escono solo quando si può rispondere: chi guarda lo
            // stream grezzo non ha vantaggio su chi guarda lo schermo
            prompt: room.phase === 'countdown' ? '' : cur.q.prompt,
            payload: room.phase === 'countdown' ? { kind: 'cells', rows: [] } : cur.q.payload,
            choices: room.phase === 'answer' || revealing ? cur.q.choices : [],
            value: cur.value,
            countdownEndsAt: cur.countdownEndsAt,
            buzzDeadline: cur.buzzDeadline,
            answerDeadline: cur.answerDeadline,
            buzzerId: cur.buzzerId,
            lockedOut: [...cur.lockedOut],
            errors: cur.errors,
            special: cur.special,
            ...(revealing
              ? {
                  revealUntil: cur.revealUntil,
                  correctIndex: cur.q.correctIndex,
                  explanation: cur.q.explanation,
                  outcome: cur.outcome,
                  answeredIndex: cur.answeredIndex,
                }
              : {}),
          }
        : null,
    };
  }
}

const globalForEngine = globalThis as unknown as { __qsEngine?: GameEngine };

export function getEngine(): GameEngine {
  if (!globalForEngine.__qsEngine) globalForEngine.__qsEngine = new GameEngine();
  return globalForEngine.__qsEngine;
}
