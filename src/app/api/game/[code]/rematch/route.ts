import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';
import { clientIp, rateLimit, tooMany } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  if (!rateLimit(`rematch:${clientIp(req)}`, 6, 60_000)) return tooMany();
  const { code } = await ctx.params;
  let body: { playerId?: string; token?: string; applySuggestion?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const res = await getEngine().rematch(code, body.playerId ?? '', body.token ?? '', body.applySuggestion === true);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
