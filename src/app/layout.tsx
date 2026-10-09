import type { Metadata, Viewport } from 'next';
import { Baloo_2, Nunito } from 'next/font/google';
import { RefCapture } from '@/components/RefCapture';
import { SwRegister } from '@/components/SwRegister';
import { LangProvider } from '@/lib/lang';
import { DESCRIZIONE, OG_BASE, SITO, TITOLO } from '@/lib/seo';
import './globals.css';

const baloo = Baloo_2({
  variable: '--font-baloo',
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
});

const nunito = Nunito({
  variable: '--font-nunito',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITO),
  title: {
    default: TITOLO,
    template: '%s · QuickSmart',
  },
  description: DESCRIZIONE,
  applicationName: 'QuickSmart',
  // niente url: lo erediterebbero tutte le pagine, e l'anteprima di /new o
  // /join porterebbe alla home. Ogni pagina da condividere mette il suo.
  openGraph: { ...OG_BASE, title: TITOLO, description: DESCRIZIONE },
  // l'invito alla partita si condivide su WhatsApp/Telegram: serve l'anteprima
  // grande. Solo il formato: titolo, testo e immagine X li prende da Open
  // Graph, così ogni pagina mostra i suoi e non quelli della home.
  twitter: { card: 'summary_large_image' },
  // aggiunto alla schermata Home dell'iPhone: nome corto e barra di stato scura
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black',
    title: 'QuickSmart',
  },
  // i codici partita a 4-6 caratteri non sono numeri di telefono
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#16100c',
  // il contenuto arriva fino ai bordi (notch compreso): i padding con
  // env(safe-area-inset-*) stanno in globals.css
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="it" className={`${baloo.variable} ${nunito.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <LangProvider>{children}</LangProvider>
        <div className="gira-telefono" aria-hidden="true">
          <span className="text-5xl">📱</span>
          <span className="font-display text-xl">Gira il telefono in verticale</span>
        </div>
        <SwRegister />
        <RefCapture />
      </body>
    </html>
  );
}
