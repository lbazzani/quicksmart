// QR code SVG per l'URL di join in LAN.
import { NextRequest } from 'next/server';
import QRCode from 'qrcode';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const data = new URL(req.url).searchParams.get('data') ?? '';
  if (!data.startsWith('http') || !data.includes('/join') || data.length > 200) {
    return new Response('bad request', { status: 400 });
  }
  const svg = await QRCode.toString(data, { type: 'svg', margin: 1, width: 240, color: { dark: '#0f172a', light: '#f8fafc' } });
  return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'max-age=300' } });
}
