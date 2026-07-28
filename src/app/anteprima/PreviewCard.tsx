'use client';

import type { Question } from '@/lib/types';
import { ChoiceView, QuestionView } from '@/components/visuals';

const LABELS = ['A', 'B', 'C'];

export function PreviewCard({ q, correct, label }: { q: Question; correct: number; label: string }) {
  return (
    <section className="card flex flex-col items-center gap-2 px-2 py-3">
      <span className="text-xs font-bold uppercase tracking-wide text-cyan-300">
        {label} · {q.qtype}
      </span>
      <p className="text-center font-display text-base font-bold">{q.prompt}</p>
      <QuestionView payload={q.payload} />
      <div className="grid w-full grid-cols-3 gap-2">
        {q.choices.map((c, i) => (
          <div
            key={i}
            className={`relative flex flex-col items-center rounded-xl border-2 px-1 py-2 ${
              i === correct ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/12 bg-white/5'
            }`}
          >
            <span className="absolute left-1 top-0.5 text-[10px] font-extrabold text-slate-400">{LABELS[i]}</span>
            <ChoiceView choice={c} />
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-slate-400">💡 {q.explanation}</p>
    </section>
  );
}
