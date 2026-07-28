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
  const res = getEngine().buzz(code, body.playerId ?? '', body.token ?? '');
  // "too_late" non è un errore: è la gara del buzz
  return NextResponse.json(res, { status: res.ok || res.error === 'too_late' ? 200 : 400 });
}
