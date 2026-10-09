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
import { IMMAGINE_OG, OG_BASE } from '@/lib/seo';

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
  const codice = r ? codificaRisultato(r) : null;
  const immagine = codice
    ? { url: `/api/og/risultato?r=${codice}`, width: 1200, height: 630, alt: titolo }
    : IMMAGINE_OG;
  return {
    title: r ? { absolute: titolo } : 'Sfida del giorno',
    description: DESCRIZIONE,
    // il risultato è di chi l'ha condiviso: la pagina da indicizzare è una sola
    alternates: { canonical: '/sfida' },
    openGraph: {
      ...OG_BASE,
      // og:url invece porta il risultato: Facebook rilegge l'anteprima
      // dall'og:url, e con /sfida mostrerebbe quella generica
      url: codice ? `/sfida?r=${codice}` : '/sfida',
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
