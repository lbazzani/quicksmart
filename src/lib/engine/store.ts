// Persistenza su Postgres. L'engine in-memory è autoritativo durante la
// partita; qui salviamo archivio domande, partite, giocatori e round.

import { query } from '../db';
import type { Difficulty, GameSettings, PlayerStats, Question } from '../types';

interface QuestionRow {
  id: number;
  qtype: string;
  difficulty: number;
  prompt: string;
  payload: unknown;
  choices: unknown;
  correct_index: number;
  explanation: string;
}

export async function dbCreateGame(
  code: string,
  name: string,
  mode: string,
  settings: GameSettings
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO games (code, name, mode, settings) VALUES ($1, $2, $3, $4) RETURNING id`,
    [code, name, mode, JSON.stringify(settings)]
  );
  return rows[0].id;
}

export async function dbAddPlayer(
  gameId: string,
  nickname: string,
  avatar: string,
  token: string,
  isHost: boolean
): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO players (game_id, nickname, avatar, token, is_host)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [gameId, nickname, avatar, token, isHost]
  );
  return rows[0].id;
}

export async function dbSetGameStatus(gameId: string, status: string, ended = false): Promise<void> {
  await query(
    `UPDATE games SET status = $2, ended_at = CASE WHEN $3 THEN now() ELSE ended_at END WHERE id = $1`,
    [gameId, status, ended]
  );
}

export async function dbSavePlayer(playerId: string, score: number, stats: PlayerStats): Promise<void> {
  await query(`UPDATE players SET score = $2, stats = $3 WHERE id = $1`, [
    playerId,
    score,
    JSON.stringify(stats),
  ]);
}

export async function dbSaveRound(
  gameId: string,
  roundIndex: number,
  questionId: number | undefined,
  outcome: string,
  detail: Record<string, unknown>
): Promise<void> {
  await query(
    `INSERT INTO rounds (game_id, round_index, question_id, outcome, detail, ended_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (game_id, round_index) DO UPDATE SET outcome = $4, detail = $5, ended_at = now()`,
    [gameId, roundIndex, questionId ?? null, outcome, JSON.stringify(detail)]
  );
}

function rowToQuestion(r: QuestionRow): Question {
  return {
    id: r.id,
    qtype: r.qtype as Question['qtype'],
    difficulty: r.difficulty as Difficulty,
    prompt: r.prompt,
    payload: r.payload as Question['payload'],
    choices: r.choices as Question['choices'],
    correctIndex: r.correct_index as 0 | 1 | 2,
    explanation: r.explanation,
  };
}

/** Estrae domande casuali per difficoltà (senza ripetizioni nella partita). */
export async function dbLoadQuestions(counts: Record<Difficulty, number>): Promise<Record<Difficulty, Question[]>> {
  const out: Record<Difficulty, Question[]> = { 1: [], 2: [], 3: [] };
  for (const d of [1, 2, 3] as Difficulty[]) {
    if (counts[d] <= 0) continue;
    const { rows } = await query<QuestionRow>(
      `SELECT id, qtype, difficulty, prompt, payload, choices, correct_index, explanation
       FROM questions WHERE difficulty = $1 ORDER BY random() LIMIT $2`,
      [d, counts[d]]
    );
    out[d] = rows.map(rowToQuestion);
  }
  return out;
}

export async function dbCountQuestions(): Promise<number> {
  const { rows } = await query<{ n: string }>(`SELECT count(*) AS n FROM questions`);
  return parseInt(rows[0].n, 10);
}
