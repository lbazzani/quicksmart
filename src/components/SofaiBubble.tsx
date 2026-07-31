'use client';
// Bolla dei commenti di SofAI: avatar + battuta, con badge ✦ quando la
// battuta arriva dall'AI. Si anima a ogni nuovo commento.

import { motion } from 'motion/react';
import type { SofiaComment } from '@/lib/types';
import { useLoc } from '@/lib/lang';
import { SofaiAvatar } from './SofaiAvatar';

export function SofaiBubble({ comment, compact = false }: { comment: SofiaComment | null; compact?: boolean }) {
  const loc = useLoc();
  if (!comment) return null;
  return (
    <div className="pointer-events-none flex items-end gap-2">
      <motion.div
        key={`avatar-${comment.seq}`}
        initial={{ rotate: -8, scale: 0.9 }}
        animate={{ rotate: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 12 }}
        className="shrink-0 drop-shadow-[0_0_12px_rgba(251,191,36,0.45)]"
      >
        <SofaiAvatar mood={comment.mood} size={compact ? 52 : 66} />
      </motion.div>
      <motion.div
          key={comment.seq}
          initial={{ opacity: 0, y: 10, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          className={`relative max-w-[75vw] rounded-2xl rounded-bl-sm border border-amber-300/35 bg-gradient-to-br from-amber-500/25 to-orange-500/15 px-3.5 py-2 backdrop-blur-sm sm:max-w-sm ${compact ? 'text-[13px]' : 'text-sm'}`}
        >
          <span className="mr-1 font-display font-bold text-amber-200">SofAI</span>
          {comment.ai && <span title="commento AI" className="mr-1 text-teal-300">✦</span>}
          <span className="text-stone-100">{loc(comment.text)}</span>
        </motion.div>
    </div>
  );
}
