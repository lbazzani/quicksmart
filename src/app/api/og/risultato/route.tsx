// L'anteprima di un risultato condiviso: l'immagine che WhatsApp, Telegram e i
// social mostrano sotto il link della sfida (?r=… da src/lib/share.ts).
//
// Perché: un link con il logo è una pubblicità che nessuno guarda; un link con
// «Sfida #12 · 8/10» e la striscia dei round è una sfida personale, ed è il
// motivo per cui chi lo riceve lo apre.
//
// Niente emoji nell'immagine: Satori le scarica da una CDN a ogni richiesta, e
// un'anteprima non deve dipendere da un servizio esterno. I quadratini sono
// riquadri colorati. I caratteri sono quelli della pagina, da assets/fonts.

import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodificaRisultato, type Esito } from '@/lib/share';

type Carattere = { name: string; data: Buffer; weight: 400 | 700 | 800; style: 'normal' };

// letti una volta per processo: sono 650 KB e non cambiano
let caratteri: Promise<Carattere[]> | null = null;
function carica(): Promise<Carattere[]> {
  const leggi = (f: string) => readFile(join(process.cwd(), 'assets/fonts', f));
  caratteri ??= Promise.all([leggi('Baloo2-ExtraBold.ttf'), leggi('Nunito-Bold.ttf'), leggi('Nunito-Regular.ttf')]).then(
    ([baloo, bold, regular]) => [
      { name: 'Baloo', data: baloo, weight: 800, style: 'normal' },
      { name: 'Nunito', data: bold, weight: 700, style: 'normal' },
      { name: 'Nunito', data: regular, weight: 400, style: 'normal' },
    ]
  );
  return caratteri;
}

const COLORE: Record<Esito, string> = { g: '#22c55e', s: '#ef4444', t: '#57534e' };

export async function GET(req: Request) {
  const r = decodificaRisultato(new URL(req.url).searchParams.get('r'));
  // un link senza risultato (o fabbricato male) mostra l'anteprima di sempre
  if (!r) return Response.redirect(`${process.env.PUBLIC_URL ?? 'https://quicksmart.it'}/og.jpg`, 302);

  const titolo = r.numero ? `Sfida del giorno #${r.numero}` : 'Allenamento';
  // dieci round stanno in una riga; oltre, i quadrati si rimpiccioliscono
  const lato = r.esiti.length > 12 ? Math.max(28, Math.floor(860 / r.esiti.length) - 10) : 68;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 84px',
          color: '#f7efe6',
          fontFamily: 'Nunito',
          backgroundColor: '#16100c',
          backgroundImage:
            'radial-gradient(circle at 18% 30%, rgba(249,115,22,0.32), transparent 55%), radial-gradient(circle at 88% 10%, rgba(251,191,36,0.18), transparent 50%)',
        }}
      >
        {/* il fulmine dell'icona (src/app/icon.svg), a destra: il marchio si riconosce anche in miniatura */}
        <svg
          width="300"
          height="300"
          viewBox="0 0 32 32"
          style={{ position: 'absolute', right: 70, top: 165 }}
        >
          <defs>
            <linearGradient id="f" x1="0.25" y1="0" x2="0.75" y2="1">
              <stop offset="0" stopColor="#fbbf24" />
              <stop offset="0.5" stopColor="#fb923c" />
              <stop offset="1" stopColor="#f97316" />
            </linearGradient>
          </defs>
          <path d="M21.6 2.6 7.2 18.4h7L11 29.4 25.4 13.6h-7z" fill="url(#f)" />
        </svg>
        <div style={{ display: 'flex', fontFamily: 'Baloo', fontWeight: 800, fontSize: 64, lineHeight: 1 }}>
          <span style={{ color: '#f97316' }}>Quick</span>
          <span style={{ color: '#fbbf24' }}>Smart</span>
        </div>
        <div style={{ display: 'flex', fontSize: 56, fontWeight: 700, marginTop: 18 }}>{titolo}</div>
        {r.esiti.length > 0 && (
          <div style={{ display: 'flex', gap: 12, marginTop: 34 }}>
            {r.esiti.map((e, i) => (
              <div key={i} style={{ width: lato, height: lato, borderRadius: 14, backgroundColor: COLORE[e] }} />
            ))}
          </div>
        )}
        <div style={{ display: 'flex', fontSize: 52, fontWeight: 700, color: '#fbbf24', marginTop: 30 }}>
          {`${r.giuste}/${r.totale} · ${r.punti} punti`}
        </div>
        <div style={{ display: 'flex', marginTop: 34 }}>
          <div
            style={{
              display: 'flex',
              padding: '14px 34px',
              borderRadius: 999,
              backgroundImage: 'linear-gradient(135deg, #fb923c, #f97316 55%, #ea580c)',
              color: '#2b1405',
              fontSize: 32,
              fontWeight: 700,
            }}
          >
            Mi batti? quicksmart.it/sfida
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: await carica(),
      // stesso ?r=, stessa immagine: i servizi di anteprima possono tenerla per sempre
      headers: { 'Cache-Control': 'public, max-age=31536000, immutable' },
    }
  );
}
