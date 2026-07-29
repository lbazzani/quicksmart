'use client';
// Le regole del gioco, in un pannello che si apre dalla home.
//
// Sta in un pannello e non in una pagina a parte perché le regole si leggono
// mentre si sta per giocare: chi le apre vuole tornare ai pulsanti, non
// navigare altrove. Le due modalità sono in due schede — messe una sotto
// l'altra, chi gioca in squadra si leggerebbe anche quelle della solitaria.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '@/lib/lang';
import { SofaiAvatar } from './SofaiAvatar';

type Scheda = 'team' | 'solo';

export function RulesSheet() {
  const T = useT();
  const [aperto, setAperto] = useState(false);
  const [scheda, setScheda] = useState<Scheda>('team');

  // con il pannello aperto la pagina sotto non deve scorrere, o su telefono si
  // finisce per trascinare la home invece dell'elenco
  useEffect(() => {
    if (!aperto) return;
    const chiudi = (e: KeyboardEvent) => e.key === 'Escape' && setAperto(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', chiudi);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', chiudi);
    };
  }, [aperto]);

  const voci = scheda === 'team' ? T.rules.team : T.rules.solo;

  return (
    <>
      <button
        type="button"
        onClick={() => setAperto(true)}
        className="btn-ghost px-4 py-2 text-sm font-bold text-stone-200"
      >
        ❓ {T.rules.open}
      </button>

      <AnimatePresence>
        {aperto && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <button
              type="button"
              aria-label={T.rules.close}
              onClick={() => setAperto(false)}
              className="absolute inset-0 bg-black/70 backdrop-blur-sm"
            />

            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={T.rules.title}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 260, damping: 28 }}
              className="relative flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-amber-300/20 bg-[#1d150f] sm:rounded-3xl"
            >
              <div className="flex items-center gap-3 border-b border-white/10 px-5 pb-3 pt-4">
                <SofaiAvatar mood="happy" size={44} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-xl font-extrabold text-amber-300">{T.rules.title}</h2>
                  <p className="text-sm leading-snug text-stone-400">{T.rules.intro}</p>
                </div>
              </div>

              <div className="flex gap-2 px-5 py-3">
                {(['team', 'solo'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScheda(s)}
                    aria-pressed={scheda === s}
                    className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${
                      scheda === s
                        ? 'bg-orange-400/25 text-orange-100 ring-2 ring-orange-300'
                        : 'bg-white/5 text-stone-300'
                    }`}
                  >
                    {s === 'team' ? T.rules.tabTeam : T.rules.tabSolo}
                  </button>
                ))}
              </div>

              <ul className="flex-1 overflow-y-auto px-5 pb-2">
                {voci.map((v) => (
                  <li key={v.t} className="flex gap-3 border-b border-white/5 py-3 last:border-0">
                    <span className="mt-0.5 shrink-0 text-xl" aria-hidden>
                      {v.e}
                    </span>
                    <div>
                      <p className="font-display text-base font-bold text-stone-100">{v.t}</p>
                      <p className="text-sm leading-normal text-stone-400">{v.d}</p>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="border-t border-white/10 p-4">
                <button type="button" onClick={() => setAperto(false)} className="btn-primary w-full py-3 font-display text-lg">
                  {T.rules.close}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
