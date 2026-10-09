// /solo è una pagina client e non può esportare metadata: stanno qui. Senza,
// ereditava titolo, descrizione e anteprima della home.

import type { Metadata } from 'next';
import { OG_BASE } from '@/lib/seo';

const TITOLO = 'Allenamento · quiz di logica da solo contro il tempo';
const DESCRIZIONE =
  'Allenati da solo con i quiz visuali di QuickSmart: logica o bandiere, tu contro il tempo. Gratis, dal browser, senza registrazione.';

export const metadata: Metadata = {
  title: TITOLO,
  description: DESCRIZIONE,
  alternates: { canonical: '/solo' },
  openGraph: { ...OG_BASE, url: '/solo', title: `${TITOLO} · QuickSmart`, description: DESCRIZIONE },
};

export default function SoloLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
