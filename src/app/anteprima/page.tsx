// Pagina di anteprima dei generatori: mostra una domanda per tipo e difficoltà
// renderizzata come la vedrebbe un giocatore. Serve a controllare a occhio che
// ogni nuovo tipo sia leggibile su schermo di telefono.
// Attiva solo con QS_TEST_MODE=1.

import { notFound } from 'next/navigation';
import { mulberry32 } from '@/lib/rng';
import { ALL_QUESTION_TYPES, GENERATORS } from '@/lib/questions';
import type { Difficulty, Question } from '@/lib/types';
import { T } from '@/lib/i18n';
import { PreviewCard } from './PreviewCard';

export const dynamic = 'force-dynamic';

export default async function Anteprima({
  searchParams,
}: {
  searchParams: Promise<{ seed?: string; d?: string; type?: string }>;
}) {
  if (process.env.QS_TEST_MODE !== '1') notFound();
  const sp = await searchParams;
  const seed = parseInt(sp.seed ?? '1', 10);
  const difficulty = (parseInt(sp.d ?? '2', 10) || 2) as Difficulty;
  const types = sp.type ? ALL_QUESTION_TYPES.filter((t) => t === sp.type) : ALL_QUESTION_TYPES;

  const items: { q: Question; correct: number }[] = [];
  for (const qtype of types) {
    const rng = mulberry32(seed * 1000 + qtype.length);
    try {
      const q = GENERATORS[qtype](rng, difficulty);
      items.push({ q, correct: q.correctIndex });
    } catch {
      // generatore in difficoltà con questo seme: salta
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-3 py-5">
      <h1 className="font-display text-2xl font-extrabold">
        Anteprima · difficoltà {difficulty} · seme {seed}
      </h1>
      <p className="text-xs text-stone-400">
        {items.length} tipi. Cambia con ?seed=N&amp;d=1|2|3&amp;type=nome
      </p>
      {items.map(({ q, correct }, i) => (
        <PreviewCard key={i} q={q} correct={correct} label={T.qtypes[q.qtype] ?? q.qtype} />
      ))}
    </main>
  );
}
