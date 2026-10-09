// /new è una pagina client e non può esportare metadata: stanno qui. Senza,
// ereditava titolo, descrizione e anteprima della home.

import type { Metadata } from 'next';
import { OG_BASE } from '@/lib/seo';

const TITOLO = 'Nuova partita · quiz di logica fino a 24 giocatori';
const DESCRIZIONE =
  'Crea una squadra, condividi il codice e giocate insieme dal telefono, fino a 24 persone: quiz visuali di logica e bandiere, senza app né registrazione.';

export const metadata: Metadata = {
  title: TITOLO,
  description: DESCRIZIONE,
  alternates: { canonical: '/new' },
  openGraph: { ...OG_BASE, url: '/new', title: `${TITOLO} · QuickSmart`, description: DESCRIZIONE },
};

export default function NewLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
