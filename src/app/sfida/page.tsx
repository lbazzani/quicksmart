// La sfida del giorno: la pagina a cui portano i risultati condivisi.
// Metadati qui (pagina server), il resto nel componente client: è il link che
// gira nelle chat, e l'anteprima deve dire subito di che si tratta.

import type { Metadata } from 'next';
import { SfidaClient } from './SfidaClient';

const DESCRIZIONE = 'Dieci domande visuali di logica, le stesse per tutti fino a mezzanotte. Quanti punti fai?';

export const metadata: Metadata = {
  title: 'Sfida del giorno',
  description: DESCRIZIONE,
  alternates: { canonical: '/sfida' },
  openGraph: {
    type: 'website',
    siteName: 'QuickSmart',
    locale: 'it_IT',
    url: '/sfida',
    title: 'Sfida del giorno · QuickSmart',
    description: DESCRIZIONE,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'QuickSmart — chi pensa più in fretta?' }],
  },
  twitter: { card: 'summary_large_image', title: 'Sfida del giorno · QuickSmart', description: DESCRIZIONE, images: ['/og.png'] },
};

export default function SfidaPage() {
  return <SfidaClient />;
}
