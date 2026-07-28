import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';
import type { GameMode } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CreateBody {
  name?: string;
  mode?: GameMode;
  nickname?: string;
  avatar?: string;
  roundsTotal?: number | null;
  buzzWindowSec?: number;
  answerSec?: number;
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const mode: GameMode = body.mode === 'solo' ? 'solo' : 'team';
  const nickname = (body.nickname ?? '').trim().slice(0, 20);
  const name = (body.name ?? '').trim().slice(0, 30) || (mode === 'solo' ? 'Allenamento' : 'QuickSmart');
  const avatar = (body.avatar ?? '🦊').slice(0, 8);
  if (!nickname) return NextResponse.json({ error: 'nickname_required' }, { status: 400 });

  const roundsTotal =
    body.roundsTotal == null ? null : Math.max(1, Math.min(30, Math.round(body.roundsTotal)));
  const buzzWindowSec = Math.max(5, Math.min(90, body.buzzWindowSec ?? (mode === 'solo' ? 15 : 25)));
  const answerSec = Math.max(3, Math.min(30, body.answerSec ?? 5));

  const engine = getEngine();
  const { code, playerId, token } = await engine.createGame({
    name,
    mode,
    nickname,
    avatar,
    roundsTotal,
    buzzWindowMs: buzzWindowSec * 1000,
    answerMs: answerSec * 1000,
  });
  return NextResponse.json({ code, playerId, token });
}
