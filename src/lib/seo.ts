// I metadati che le pagine condividono: titolo, descrizione, immagine
// d'anteprima e i dati strutturati della home.
//
// Un posto solo perché Next sostituisce openGraph per intero quando una pagina
// lo ridefinisce: senza, ogni pagina riscriverebbe gli stessi campi, e prima o
// poi uno resterebbe indietro.

import type { Metadata } from 'next';

export const SITO = 'https://quicksmart.it';

export const TITOLO = 'QuickSmart — chi pensa più in fretta?';

// niente "per primo": il testo si rivolge a chiunque giochi (vedi i18n.ts)
export const DESCRIZIONE =
  'Quiz visuali in tempo reale per tutta la famiglia: guarda la figura, prenotati prima degli altri e rispondi al volo.';

// JPEG da 79 KB e non il PNG da 314 (public/og.png, tenuto per i link già
// condivisi): oltre ~300 KB WhatsApp spesso non mostra la miniatura, e i link
// di QuickSmart girano soprattutto lì
export const IMMAGINE_OG = { url: '/og.jpg', width: 1200, height: 630, alt: TITOLO };

/** I campi Open Graph di ogni pagina; url, titolo e descrizione li mette la pagina. */
export const OG_BASE = {
  type: 'website',
  siteName: 'QuickSmart',
  locale: 'it_IT',
  images: [IMMAGINE_OG],
} satisfies NonNullable<Metadata['openGraph']>;

/**
 * Dati strutturati della home: WebSite fa comparire «QuickSmart» come nome del
 * sito nei risultati; il gioco dice a Google che cos'è, per chi e quanto costa.
 * Solo fatti veri: 24 è MAX_PLAYERS_PER_ROOM in src/lib/engine/engine.ts.
 */
export const DATI_STRUTTURATI = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebSite',
      '@id': `${SITO}/#sito`,
      name: 'QuickSmart',
      url: `${SITO}/`,
      inLanguage: 'it-IT',
    },
    {
      '@type': ['VideoGame', 'WebApplication'],
      '@id': `${SITO}/#gioco`,
      name: 'QuickSmart',
      url: `${SITO}/`,
      description: DESCRIZIONE,
      image: `${SITO}${IMMAGINE_OG.url}`,
      inLanguage: 'it-IT',
      isPartOf: { '@id': `${SITO}/#sito` },
      genre: ['Quiz', 'Logica'],
      gamePlatform: 'Browser web',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Qualsiasi (browser)',
      playMode: ['SinglePlayer', 'MultiPlayer'],
      numberOfPlayers: { '@type': 'QuantitativeValue', minValue: 1, maxValue: 24 },
      offers: { '@type': 'Offer', price: 0, priceCurrency: 'EUR' },
    },
  ],
};
