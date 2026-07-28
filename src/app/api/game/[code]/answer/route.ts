import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  let body: { playerId?: string; token?: string; choiceIndex?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const res = getEngine().answer(code, body.playerId ?? '', body.token ?? '', body.choiceIndex ?? -1);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
