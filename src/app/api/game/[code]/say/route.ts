import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';
import { clientIp, rateLimit, tooMany } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  // la chat è per una battuta ogni tanto, non per chattare davvero
  if (!rateLimit(`say:${clientIp(req)}`, 20, 60_000)) return tooMany();
  const { code } = await ctx.params;
  let body: { playerId?: string; token?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const res = getEngine().say(code, body.playerId ?? '', body.token ?? '', String(body.text ?? ''));
  // "too_fast" e "not_allowed" non sono guasti: sono le regole del microfono
  const soft = res.ok || res.error === 'too_fast' || res.error === 'not_allowed';
  return NextResponse.json(res, { status: soft ? 200 : 400 });
}
