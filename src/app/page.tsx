// La home: metadati e dati strutturati qui (pagina server), il gioco in
// HomeClient. Era tutta 'use client', e una pagina client non può esportare
// metadata: senza canonico, www.quicksmart.it e i nomi del cluster sembravano
// copie della home.

import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeClient } from './HomeClient';
import { DATI_STRUTTURATI, DESCRIZIONE, OG_BASE, TITOLO } from '@/lib/seo';

// Titolo e descrizione per i risultati di ricerca: le parole che la gente
// cerca. Le anteprime nelle chat restano quelle di sempre (TITOLO), che
// funzionano come invito.
export const metadata: Metadata = {
  title: { absolute: 'QuickSmart: quiz di logica online da giocare insieme, gratis' },
  description:
    'Quiz di logica visuali da giocare insieme dal telefono, fino a 24 persone, o da soli con la sfida del giorno. Gratis, senza app né registrazione.',
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
      {/* Sotto la prima schermata, che resta tutta per il gioco: chi scorre (e
          chi indicizza) trova cos'è QuickSmart. Solo italiano, come
          /come-si-gioca: è il pubblico che cerca così. */}
      <section
        aria-labelledby="cos-e-quicksmart"
        className="mx-auto flex w-full max-w-md flex-col gap-3 px-6 pb-12 text-sm leading-relaxed text-stone-400"
      >
        <h2 id="cos-e-quicksmart" className="font-display text-xl font-extrabold text-stone-200">
          Quiz di logica online, da giocare insieme
        </h2>
        <p>
          QuickSmart è un quiz di logica in tempo reale: a ogni domanda compare una figura (una sequenza, una matrice, una
          bilancia, un orologio, una bandiera) con tre risposte molto simili. Vince chi ragiona più in fretta, non chi sa
          più cose.
        </p>
        <p>
          Si gioca dal telefono, senza app e senza registrazione. Chi crea la partita condivide un codice di 5 lettere o un
          QR, e fino a 24 persone entrano nella stessa squadra: in famiglia, in classe con la LIM, fra amici anche a
          distanza.
        </p>
        <p>
          Da soli ci sono l’allenamento contro il tempo e la sfida del giorno: dieci domande uguali per tutti fino a
          mezzanotte, con il risultato da mandare in chat senza svelare le risposte. È tutto gratis: niente abbonamenti,
          pubblicità o acquisti nel gioco.
        </p>
        <Link href="/come-si-gioca" className="font-semibold text-amber-300 underline-offset-2 hover:underline">
          Come si gioca: regole, punteggi e domande frequenti →
        </Link>
      </section>
    </>
  );
}
