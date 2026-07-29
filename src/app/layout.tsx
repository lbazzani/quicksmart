import type { Metadata, Viewport } from 'next';
import { Baloo_2, Nunito } from 'next/font/google';
import { SwRegister } from '@/components/SwRegister';
import { LangProvider } from '@/lib/lang';
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

// niente "per primo": il testo si rivolge a chiunque giochi (vedi i18n.ts)
const DESCRIPTION =
  'Quiz visuali in tempo reale per tutta la famiglia: guarda la figura, prenotati prima degli altri e rispondi al volo.';

export const metadata: Metadata = {
  metadataBase: new URL('https://quicksmart.it'),
  title: {
    default: 'QuickSmart — chi pensa più in fretta?',
    template: '%s · QuickSmart',
  },
  description: DESCRIPTION,
  applicationName: 'QuickSmart',
  openGraph: {
    type: 'website',
    siteName: 'QuickSmart',
    locale: 'it_IT',
    url: '/',
    title: 'QuickSmart — chi pensa più in fretta?',
    description: DESCRIPTION,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'QuickSmart — chi pensa più in fretta?' }],
  },
  // l'invito alla partita si condivide su WhatsApp/Telegram: serve l'anteprima grande
  twitter: {
    card: 'summary_large_image',
    title: 'QuickSmart — chi pensa più in fretta?',
    description: DESCRIPTION,
    images: ['/og.png'],
  },
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
      </body>
    </html>
  );
}
