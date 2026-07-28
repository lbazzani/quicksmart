import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  let body: { nickname?: string; avatar?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const nickname = (body.nickname ?? '').trim().slice(0, 20);
  const avatar = (body.avatar ?? '🐼').slice(0, 8);
  if (!nickname) return NextResponse.json({ error: 'nickname_required' }, { status: 400 });

  const res = await getEngine().join(code, nickname, avatar);
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : 409;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ code: code.toUpperCase(), playerId: res.playerId, token: res.token });
}
