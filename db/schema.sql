-- Schema QuickSmart
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS questions (
  id           SERIAL PRIMARY KEY,
  qtype        TEXT NOT NULL,
  difficulty   SMALLINT NOT NULL CHECK (difficulty BETWEEN 1 AND 3),
  prompt       TEXT NOT NULL,
  payload      JSONB NOT NULL,
  choices      JSONB NOT NULL,
  correct_index SMALLINT NOT NULL CHECK (correct_index BETWEEN 0 AND 2),
  explanation  TEXT NOT NULL,
  hash         TEXT NOT NULL UNIQUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_questions_pick ON questions (difficulty, qtype);

CREATE TABLE IF NOT EXISTS games (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('team', 'solo')),
  settings   JSONB NOT NULL,
  status     TEXT NOT NULL DEFAULT 'lobby' CHECK (status IN ('lobby', 'playing', 'ended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS players (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id   UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  nickname  TEXT NOT NULL,
  avatar    TEXT NOT NULL,
  token     TEXT NOT NULL,
  is_host   BOOLEAN NOT NULL DEFAULT false,
  score     INT NOT NULL DEFAULT 0,
  stats     JSONB NOT NULL DEFAULT '{}',
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (game_id, nickname)
);

CREATE TABLE IF NOT EXISTS rounds (
  id           SERIAL PRIMARY KEY,
  game_id      UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_index  INT NOT NULL,
  question_id  INT REFERENCES questions(id),
  outcome      TEXT,
  detail       JSONB NOT NULL DEFAULT '{}',
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at     TIMESTAMPTZ,
  UNIQUE (game_id, round_index)
);
