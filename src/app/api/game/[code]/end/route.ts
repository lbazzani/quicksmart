import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  const { code } = await ctx.params;
  let body: { playerId?: string; token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  const res = await getEngine().end(code, body.playerId ?? '', body.token ?? '');
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
