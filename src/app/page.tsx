'use client';

import Link from 'next/link';
import { motion } from 'motion/react';
import { T } from '@/lib/i18n';
import { SofaiAvatar } from '@/components/SofaiAvatar';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-8 px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-2 text-center"
      >
        <h1 className="font-display text-6xl font-extrabold tracking-tight">
          <span className="text-cyan-300 glow-cyan">Quick</span>
          <span className="text-pink-400 glow-pink">Smart</span>
          <span className="ml-1">⚡</span>
        </h1>
        <p className="text-lg font-semibold text-slate-300">{T.tagline}</p>
        <p className="max-w-xs text-sm text-slate-400">{T.home.subtitle}</p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.15 }}
        className="floaty flex items-end gap-2"
      >
        <SofaiAvatar mood="happy" size={96} />
        <div className="card mb-6 rounded-bl-sm px-3 py-2 text-sm text-slate-200">
          Ciao! Io sono <b className="text-violet-300">SofAI</b> 👋
        </div>
      </motion.div>

      <motion.nav
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="flex w-full flex-col gap-3"
      >
        <Link href="/new" className="btn-primary block py-4 text-center font-display text-xl">
          👑 {T.home.create}
        </Link>
        <Link href="/join" className="btn-ghost block py-4 text-center font-display text-xl font-bold text-slate-100">
          🔑 {T.home.join}
        </Link>
        <Link href="/solo" className="btn-ghost block py-4 text-center font-display text-xl font-bold text-slate-100">
          🎯 {T.home.solo}
        </Link>
      </motion.nav>
    </main>
  );
}
