// La sfida del giorno: la pagina a cui portano i risultati condivisi.
// Metadati qui (pagina server), il resto nel componente client: è il link che
// gira nelle chat, e l'anteprima deve dire subito di che si tratta.
//
// Se il link porta un risultato (?r=…, src/lib/share.ts) l'anteprima è quella
// del risultato: titolo con il punteggio e l'immagine con la striscia dei round
// (src/app/api/og/risultato). Senza, l'anteprima di sempre.

import type { Metadata } from 'next';
import { SfidaClient } from './SfidaClient';
import { codificaRisultato, decodificaRisultato } from '@/lib/share';

const DESCRIZIONE = 'Dieci domande visuali di logica, le stesse per tutti fino a mezzanotte. Quanti punti fai?';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ r?: string | string[] }>;
}): Promise<Metadata> {
  const { r: grezzo } = await searchParams;
  const r = decodificaRisultato(typeof grezzo === 'string' ? grezzo : undefined);
  const titolo = r
    ? `${r.numero ? `Sfida #${r.numero}` : 'Allenamento'}: ${r.giuste}/${r.totale} · ${r.punti} punti. Mi batti?`
    : 'Sfida del giorno · QuickSmart';
  const immagine = r
    ? { url: `/api/og/risultato?r=${codificaRisultato(r)}`, width: 1200, height: 630, alt: titolo }
    : { url: '/og.png', width: 1200, height: 630, alt: 'QuickSmart — chi pensa più in fretta?' };
  return {
    title: r ? { absolute: titolo } : 'Sfida del giorno',
    description: DESCRIZIONE,
    // il risultato è di chi l'ha condiviso: la pagina da indicizzare è una sola
    alternates: { canonical: '/sfida' },
    openGraph: {
      type: 'website',
      siteName: 'QuickSmart',
      locale: 'it_IT',
      url: '/sfida',
      title: titolo,
      description: DESCRIZIONE,
      images: [immagine],
    },
    twitter: { card: 'summary_large_image', title: titolo, description: DESCRIZIONE, images: [immagine.url] },
  };
}

export default function SfidaPage() {
  return <SfidaClient />;
}
