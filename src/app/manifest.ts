import type { MetadataRoute } from 'next';

/**
 * Manifest PWA: serve perché QuickSmart si aggiunga alla schermata Home del
 * telefono e si apra a schermo intero, senza barra del browser.
 * Colori dalla tavolozza "brace": notte calda, la stessa del corpo pagina.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'QuickSmart',
    short_name: 'QuickSmart',
    description:
      'Quiz visuali in tempo reale per tutta la famiglia: guarda la figura, prenotati prima degli altri e rispondi in 5 secondi.',
    lang: 'it',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#16100c',
    // uguale a viewport.themeColor in layout.tsx: la barra di sistema deve
    // sfumare nella pagina, non tagliarla con una striscia arancione
    theme_color: '#16100c',
    categories: ['games', 'education', 'entertainment'],
    icons: [
      { src: '/icon.svg', type: 'image/svg+xml', sizes: 'any' },
      { src: '/icon-192.png', type: 'image/png', sizes: '192x192', purpose: 'any' },
      { src: '/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
      { src: '/icon-maskable-512.png', type: 'image/png', sizes: '512x512', purpose: 'maskable' },
    ],
  };
}
