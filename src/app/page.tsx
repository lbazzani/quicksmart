// La home: metadati e dati strutturati qui (pagina server), il gioco in
// HomeClient. Era tutta 'use client', e una pagina client non può esportare
// metadata: senza canonico, www.quicksmart.it e i nomi del cluster sembravano
// copie della home.

import type { Metadata } from 'next';
import { HomeClient } from './HomeClient';
import { DATI_STRUTTURATI, DESCRIZIONE, OG_BASE, TITOLO } from '@/lib/seo';

export const metadata: Metadata = {
  alternates: { canonical: '/' },
  openGraph: { ...OG_BASE, url: '/', title: TITOLO, description: DESCRIZIONE },
};

// '<' escapato: nessuna stringa dei dati può chiudere lo <script>
const jsonLd = JSON.stringify(DATI_STRUTTURATI).replace(/</g, '\\u003c');

export default function Home() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <HomeClient />
    </>
  );
}
