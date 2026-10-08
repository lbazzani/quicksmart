// Come si gioca: la stessa sostanza del pannello delle regole (RulesSheet),
// ma in una pagina vera, resa dal server.
//
// Perché una pagina in più se il pannello c'è già: il pannello è per chi sta
// per giocare, e i motori di ricerca non lo vedono (si apre con un tocco). Chi
// cerca «quiz di logica da fare in famiglia» deve trovare una pagina che dica
// cos'è QuickSmart, per chi è e come si gioca — e un pulsante per iniziare.
// Solo italiano: è il pubblico che cerca così.

import type { Metadata } from 'next';
import Link from 'next/link';
import { T } from '@/lib/i18n';

const DESCRIZIONE =
  'Quiz visuali di logica da giocare insieme dal telefono, senza app e senza registrazione: in famiglia, in classe, fra amici. Regole, punteggi e sfida del giorno.';

export const metadata: Metadata = {
  title: 'Come si gioca · quiz di logica in famiglia',
  description: DESCRIZIONE,
  alternates: { canonical: '/come-si-gioca' },
  openGraph: {
    type: 'article',
    siteName: 'QuickSmart',
    locale: 'it_IT',
    url: '/come-si-gioca',
    title: 'Come si gioca a QuickSmart',
    description: DESCRIZIONE,
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'QuickSmart — chi pensa più in fretta?' }],
  },
};

const DOMANDE = [
  {
    q: 'Quanto costa?',
    a: 'Niente. Non ci sono abbonamenti, pubblicità né acquisti dentro il gioco.',
  },
  {
    q: 'Serve scaricare un’app?',
    a: 'No: si gioca dal browser del telefono, del tablet o del computer. Chi vuole può aggiungerlo alla schermata Home e aprirlo come un’app.',
  },
  {
    q: 'Bisogna registrarsi?',
    a: 'No. Basta un nome da mostrare in classifica e un avatar.',
  },
  {
    q: 'Quante persone possono giocare insieme?',
    a: 'Fino a 24 nella stessa partita. Si entra con un codice di 5 lettere o inquadrando un QR, anche a partita iniziata.',
  },
  {
    q: 'È adatto ai bambini?',
    a: 'Sì. Le domande sono figure da osservare (sequenze, simmetrie, bilance, orologi, dadi, bandiere), non nozioni da sapere: un bambino attento batte spesso un adulto distratto. La difficoltà sale piano, dalla prima domanda all’ultima.',
  },
  {
    q: 'Si può usare in classe?',
    a: 'Sì: chi insegna crea la partita sulla LIM o sul proprio telefono, la classe entra col codice e il podio finale mostra precisione e velocità di ognuno.',
  },
  {
    q: 'Cos’è la sfida del giorno?',
    a: 'Dieci domande uguali per tutti, che cambiano a mezzanotte. Si gioca una volta e si condivide il risultato senza svelare le risposte: è il modo per sfidare chi non è nella stessa stanza.',
  },
  {
    q: 'Chi è SofAI?',
    a: 'La mascotte del gioco: commenta la partita con battute scritte da un’intelligenza artificiale. Nelle sue battute i nomi di chi gioca non arrivano mai all’AI.',
  },
];

// dati strutturati: aiutano Google a mostrare le domande frequenti nei risultati
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'QuickSmart',
      url: 'https://quicksmart.it/',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Web',
      inLanguage: ['it', 'en'],
      description: DESCRIZIONE,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    },
    {
      '@type': 'FAQPage',
      mainEntity: DOMANDE.map((d) => ({
        '@type': 'Question',
        name: d.q,
        acceptedAnswer: { '@type': 'Answer', text: d.a },
      })),
    },
  ],
};

function Elenco({ voci }: { voci: { e: string; t: string; d: string }[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {voci.map((v) => (
        <li key={v.t} className="flex gap-3">
          <span className="text-2xl leading-none">{v.e}</span>
          <span>
            <b className="text-stone-100">{v.t}.</b> <span className="text-stone-300">{v.d}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ComeSiGioca() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-8 text-[15px] leading-relaxed">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />

      <header className="flex flex-col gap-3">
        <Link href="/" className="font-display text-lg font-extrabold">
          <span className="text-orange-400">Quick</span>
          <span className="text-amber-300">Smart</span> ⚡
        </Link>
        <h1 className="font-display text-4xl font-extrabold leading-tight">Come si gioca</h1>
        <p className="text-stone-300">
          QuickSmart è un quiz di logica in tempo reale: a ogni domanda compare una figura con tre risposte molto simili, e
          vince chi ragiona più in fretta. Si gioca dal telefono, senza app e senza registrazione — in famiglia, in classe o
          fra amici, anche a distanza.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sfida" className="btn-primary px-5 py-3 font-display text-lg">
            🗓️ Sfida del giorno
          </Link>
          <Link href="/new" className="btn-ghost px-5 py-3 font-display text-lg font-bold text-stone-100">
            👑 Crea una squadra
          </Link>
        </div>
      </header>

      <section className="card flex flex-col gap-4 px-5 py-5">
        <h2 className="font-display text-2xl font-extrabold">👥 In squadra</h2>
        <p className="text-stone-300">{T.rules.intro}</p>
        <Elenco voci={T.rules.team} />
      </section>

      <section className="card flex flex-col gap-4 px-5 py-5">
        <h2 className="font-display text-2xl font-extrabold">🎯 In solitaria e sfida del giorno</h2>
        <Elenco voci={T.rules.solo} />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="font-display text-2xl font-extrabold">Domande frequenti</h2>
        {DOMANDE.map((d) => (
          <div key={d.q}>
            <h3 className="font-bold text-amber-300">{d.q}</h3>
            <p className="text-stone-300">{d.a}</p>
          </div>
        ))}
      </section>

      <footer className="flex flex-wrap gap-3 pb-4">
        <Link href="/sfida" className="btn-primary px-5 py-3 font-display text-lg">
          ⚡ Gioca adesso
        </Link>
        <Link href="/" className="btn-ghost px-5 py-3 font-display text-lg font-bold text-stone-100">
          Home
        </Link>
      </footer>
    </main>
  );
}
