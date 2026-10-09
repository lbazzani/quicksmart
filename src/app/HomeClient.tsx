'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { LangSwitch, useT } from '@/lib/lang';
import { SofaiAvatar } from '@/components/SofaiAvatar';
import { RulesSheet } from '@/components/RulesSheet';
import { Onboarding } from '@/components/Onboarding';
import { numeroSfida } from '@/lib/daily';
import { leggiRisultatoSfida } from '@/lib/share';

export function HomeClient() {
  const T = useT();
  // la sfida del giorno è la porta d'ingresso per chi arriva da un link
  // condiviso: sta in cima, e dice se oggi l'hai già giocata
  // Il numero si calcola nel browser: la home è pre-generata alla build, e un
  // numero scritto nell'HTML sarebbe quello del giorno della build.
  const [numero, setNumero] = useState<number | null>(null);
  const [punti, setPunti] = useState<number | null>(null);
  useEffect(() => {
    const n = numeroSfida();
    /* eslint-disable react-hooks/set-state-in-effect -- data e localStorage solo nel browser */
    setNumero(n);
    setPunti(leggiRisultatoSfida(n)?.punti ?? null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);
  return (
    <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
      <Onboarding />
      <LangSwitch className="absolute right-4 top-4" />
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-2 text-center"
      >
        <h1 className="font-display text-6xl font-extrabold tracking-tight">
          <span className="text-orange-400 glow-orange">Quick</span>
          <span className="text-amber-300 glow-amber">Smart</span>
          <span className="ml-1">⚡</span>
        </h1>
        <p className="text-lg font-semibold text-stone-300">{T.tagline}</p>
        <p className="max-w-xs text-sm text-stone-400">{T.home.subtitle}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15 }}
        className="floaty flex items-end gap-2"
      >
        <SofaiAvatar mood="happy" size={96} />
        <div className="card mb-6 rounded-bl-sm px-3 py-2 text-sm text-stone-200">
          Ciao! Io sono <b className="text-amber-300">SofAI</b> 👋
        </div>
      </motion.div>

      <motion.nav
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="flex w-full flex-col gap-3"
      >
        <Link
          href="/sfida"
          className="card flex items-center gap-3 border border-amber-300/40 px-4 py-3 active:scale-[0.98]"
        >
          <span className="text-3xl">🗓️</span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-extrabold text-amber-300">
              {T.home.daily}
              {numero !== null && ` #${numero}`}
            </span>
            <span className="block text-xs text-stone-400">
              {punti !== null ? T.home.dailyDone.replace('{points}', String(punti)) : T.home.dailySub}
            </span>
          </span>
          <span className="font-display text-xl text-amber-300">→</span>
        </Link>
        <Link href="/new" className="btn-primary block py-4 text-center font-display text-xl">
          👑 {T.home.create}
        </Link>
        <Link href="/join" className="btn-ghost block py-4 text-center font-display text-xl font-bold text-stone-100">
          🔑 {T.home.join}
        </Link>
        <Link href="/solo" className="btn-ghost block py-4 text-center font-display text-xl font-bold text-stone-100">
          🎯 {T.home.solo}
        </Link>
        <div className="mt-1 flex justify-center">
          <RulesSheet />
        </div>
        {/* la versione da leggere con calma, e quella che trovano i motori di ricerca */}
        <Link href="/come-si-gioca" className="text-center text-xs text-stone-500 underline-offset-2 hover:underline">
          {T.home.howTo}
        </Link>
      </motion.nav>
    </main>
  );
}
