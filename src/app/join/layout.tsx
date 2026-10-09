// /join serve solo a chi ha già un codice (?code=… cambia a ogni partita):
// fuori dall'indice, ma i link si seguono. Non va bloccata in robots.txt,
// se no Google non vedrebbe il noindex.

import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Entra in squadra',
  description: 'Inserisci il codice della partita e gioca con la tua squadra su QuickSmart.',
  robots: { index: false, follow: true },
};

export default function JoinLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
