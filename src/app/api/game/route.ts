import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';
import { clientIp, rateLimit, tooMany } from '@/lib/ratelimit';
import { SFIDA, numeroSfida, semeSfida } from '@/lib/daily';
import type { GameMode, GamePack } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface CreateBody {
  name?: string;
  mode?: GameMode;
  pack?: GamePack;
  nickname?: string;
  avatar?: string;
  roundsTotal?: number | null;
  buzzWindowSec?: number;
  answerSec?: number;
  showMistakes?: boolean;
  /** true = la sfida del giorno: regole e domande le decide il server */
  daily?: boolean;
  /** da quale link è arrivata la persona (?ref=…), solo per contare */
  ref?: string;
}

/** il ref arriva dall'indirizzo, cioè da chiunque: solo una parola corta */
function cleanRef(v: unknown): string | undefined {
  return typeof v === 'string' && /^[a-z0-9_-]{1,24}$/i.test(v) ? v.toLowerCase() : undefined;
}

export async function POST(req: NextRequest) {
  // creare partite è l'operazione più costosa: 10 al minuto per IP bastano
  if (!rateLimit(`create:${clientIp(req)}`, 10, 60_000)) return tooMany();

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  // La sfida del giorno ignora le impostazioni del client: punteggi presi con
  // regole diverse non si confronterebbero. Il numero lo decide il server,
  // così a cavallo della mezzanotte vale l'orologio di uno solo.
  const daily = body.daily === true ? numeroSfida() : undefined;
  const mode: GameMode = daily !== undefined || body.mode === 'solo' ? 'solo' : 'team';
  const pack: GamePack = daily !== undefined ? SFIDA.pack : body.pack === 'flags' ? 'flags' : 'logic';
  const nickname = (body.nickname ?? '').trim().slice(0, 20);
  const name = daily !== undefined
    ? `Sfida del giorno #${daily}`
    : (body.name ?? '').trim().slice(0, 30) || (mode === 'solo' ? 'Allenamento' : 'QuickSmart');
  const avatar = (body.avatar ?? '🦊').slice(0, 8);
  if (!nickname) return NextResponse.json({ error: 'nickname_required' }, { status: 400 });

  const roundsTotal = daily !== undefined
    ? SFIDA.rounds
    : body.roundsTotal == null
      ? null
      : Math.max(1, Math.min(30, Math.round(body.roundsTotal)));
  // default rivisti dopo i test in famiglia: il tempo per pensare era troppo poco
  const buzzWindowSec = daily !== undefined
    ? SFIDA.buzzWindowSec
    : Math.max(5, Math.min(90, Math.round(body.buzzWindowSec ?? (mode === 'solo' ? 20 : 40))));
  const answerSec = daily !== undefined ? SFIDA.answerSec : Math.max(3, Math.min(30, Math.round(body.answerSec ?? 12)));

  try {
    const engine = getEngine();
    const { code, playerId, token } = await engine.createGame({
      name,
      mode,
      pack,
      nickname,
      avatar,
      roundsTotal,
      buzzWindowMs: buzzWindowSec * 1000,
      answerMs: answerSec * 1000,
      showMistakes: body.showMistakes !== false,
      ...(daily !== undefined ? { seed: semeSfida(daily), daily } : {}),
      ref: cleanRef(body.ref),
    });
    return NextResponse.json({ code, playerId, token });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'error';
    if (msg === 'too_many_rooms') return NextResponse.json({ error: 'too_many_rooms' }, { status: 503 });
    if (msg === 'nickname_required') return NextResponse.json({ error: 'nickname_required' }, { status: 400 });
    console.error('createGame:', e);
    return NextResponse.json({ error: 'server_error' }, { status: 500 });
  }
}
