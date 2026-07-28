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
import { sofiaOnEvent, type SofiaEventCtx } from '../sofia/sofia';

const COUNTDOWN_MS = 3000;
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // sweep partite morte dopo 2h
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
  questions: Question[];
  current: CurrentRound | null;
  sofia: SofiaComment | null;
  sofiaSeq: number;
  sofiaBusy: boolean;
  version: number;
  epoch: number; // invalida i timer di fasi superate
  timer: NodeJS.Timeout | null;
  emitter: EventEmitter;
  lastActivity: number;
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
      if (now - room.lastActivity > ROOM_TTL_MS) {
        if (room.timer) clearTimeout(room.timer);
        this.rooms.delete(code);
      }
    }
  }

  joinUrl(code: string): string | undefined {
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
    const settings: GameSettings = {
      mode: opts.mode,
      roundsTotal: opts.roundsTotal,
      buzzWindowMs: opts.buzzWindowMs,
      answerMs: opts.answerMs,
      revealMs: 6000,
    };
    const code = this.makeCode();
    const gameId = await dbCreateGame(code, opts.name, opts.mode, settings);
    const token = randomBytes(16).toString('hex');
    const playerId = await dbAddPlayer(gameId, opts.nickname, opts.avatar, token, true);
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
      questions: [],
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
      nickname: opts.nickname,
      avatar: opts.avatar,
      token,
      isHost: true,
      score: 0,
      streak: 0,
      connections: 0,
      lastDelta: 0,
      stats: newStats(),
    });
    this.rooms.set(code, room);
    this.sofia(room, { kind: 'welcome', nickname: opts.nickname });
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
  ): Promise<{ ok: true; playerId: string; token: string } | { ok: false; error: 'not_found' | 'started' | 'nickname_taken' }> {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    if (room.status !== 'lobby') return { ok: false, error: 'started' };
    const clean = nickname.trim().slice(0, 20);
    for (const p of room.players.values()) {
      if (p.nickname.toLowerCase() === clean.toLowerCase()) return { ok: false, error: 'nickname_taken' };
    }
    const token = randomBytes(16).toString('hex');
    const playerId = await dbAddPlayer(room.gameId, clean, avatar, token, false);
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
    });
    room.lastActivity = Date.now();
    this.sofia(room, { kind: 'join', nickname: clean });
    this.bump(room);
    return { ok: true, playerId, token };
  }

  /** carica il pool di domande per la partita */
  private async loadPool(room: Room): Promise<void> {
    const total = room.settings.roundsTotal;
    const poolSize = total ?? 60;
    const counts: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < poolSize; i++) counts[difficultyForRound(i, total)]++;
    const byDiff = await dbLoadQuestions(counts);
    const pool: Question[] = [];
    for (let i = 0; i < poolSize; i++) {
      const want = difficultyForRound(i, total);
      // se una difficoltà si esaurisce, ripiega sulle altre
      const q = byDiff[want].pop() ?? byDiff[2].pop() ?? byDiff[1].pop() ?? byDiff[3].pop();
      if (!q) break;
      pool.push(q);
    }
    room.questions = pool;
  }

  async start(code: string, playerId: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const room = this.getRoom(code);
    if (!room) return { ok: false, error: 'not_found' };
    const p = this.auth(room, playerId, token);
    if (!p?.isHost) return { ok: false, error: 'not_host' };
    if (room.status !== 'lobby') return { ok: false, error: 'already_started' };
    await this.loadPool(room);
    if (room.questions.length === 0) return { ok: false, error: 'no_questions' };
    room.status = 'playing';
    dbSetGameStatus(room.gameId, 'playing').catch(console.error);
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

  private startRound(room: Room, index: number) {
    if (index >= room.questions.length) {
      this.finish(room);
      return;
    }
    room.epoch++;
    room.roundIndex = index;
    const q = room.questions[index];
    for (const p of room.players.values()) p.lastDelta = 0;
    room.current = {
      q,
      value: baseValue(q.difficulty),
      errors: 0,
      lockedOut: new Set(),
      countdownEndsAt: Date.now() + COUNTDOWN_MS,
    };
    room.phase = 'countdown';
    this.schedule(room, COUNTDOWN_MS, () => this.enterBuzz(room, room.settings.buzzWindowMs));
    this.bump(room);
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
    cur.answerDeadline = Date.now() + room.settings.answerMs;
    p.stats.buzzWins++;
    this.schedule(room, room.settings.answerMs, () => this.onAnswerTimeout(room));
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
      const remainingFrac = 1 - elapsed / room.settings.answerMs;
      p.streak++;
      p.stats.correct++;
      p.stats.bestStreak = Math.max(p.stats.bestStreak, p.streak);
      const delta = correctPoints(cur.value, remainingFrac, p.streak);
      p.score += delta;
      p.lastDelta += delta;
      cur.winnerId = playerId;
      cur.answerTimeMs = elapsed;
      this.reveal(room, 'correct');
    } else {
      p.streak = 0;
      p.stats.wrong++;
      const delta = wrongPenalty(cur.value);
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
        const delta = soloTimeoutPenalty(cur.q.difficulty);
        p.score += delta;
        p.lastDelta += delta;
        p.streak = 0;
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
      else this.startRound(room, room.roundIndex + 1);
    });
    this.bump(room);
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
            prompt: cur.q.prompt,
            payload: cur.q.payload,
            choices: cur.q.choices,
            value: cur.value,
            countdownEndsAt: cur.countdownEndsAt,
            buzzDeadline: cur.buzzDeadline,
            answerDeadline: cur.answerDeadline,
            buzzerId: cur.buzzerId,
            lockedOut: [...cur.lockedOut],
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
