// Oracolo per i test automatici: rivela la risposta corretta del round in corso.
// Le domande sono generate al volo, quindi i test non possono più leggerla dal
// database. Attivo SOLO con QS_TEST_MODE=1: in produzione questa route non
// esiste (risponde 404) e nessuno può sbirciare la soluzione.

import { NextRequest, NextResponse } from 'next/server';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ code: string }> }) {
  if (process.env.QS_TEST_MODE !== '1') return new NextResponse('not found', { status: 404 });
  const { code } = await ctx.params;
  const room = getEngine().getRoom(code);
  if (!room?.current) return NextResponse.json({ error: 'no_round' }, { status: 404 });
  return NextResponse.json({
    correctIndex: room.current.q.correctIndex,
    qtype: room.current.q.qtype,
    difficulty: room.current.q.difficulty,
    special: room.current.special,
    explanation: room.current.q.explanation,
  });
}
