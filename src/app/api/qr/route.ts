// QR code SVG per l'URL di invito. Accetta solo il codice partita: l'URL è
// costruito lato server, così l'endpoint non può generare QR verso siti terzi.
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';
import { getEngine } from '@/lib/engine/engine';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const code = (new URL(req.url).searchParams.get('code') ?? '').toUpperCase();
  if (!/^[A-Z]{5}$/.test(code)) return new Response('bad request', { status: 400 });
  const engine = getEngine();
  if (!engine.getRoom(code)) return new Response('not found', { status: 404 });
  const url = engine.joinUrl(code);
  if (!url) return new Response('not available', { status: 404 });

  const svg = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    width: 240,
    color: { dark: '#231a14', light: '#f7efe6' },
  });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' } });
}
