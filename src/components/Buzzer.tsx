'use client';
// Il pulsante per prenotarsi. Più il tempo finisce, più l'onda dietro batte in
// fretta.
//
// È l'unico momento in cui si decide qualcosa, e prima era un cerchio immobile
// in mezzo a uno schermo vuoto: il tempo scorreva solo nel piccolo anello in
// alto, lontano dal pollice e dagli occhi. Qui la fretta si vede dove si deve
// premere.
//
// A muoversi è SOLO l'onda, mai il pulsante. Un bersaglio che pulsa è un
// bersaglio che si sposta mentre lo si punta — e infatti Playwright si
// rifiutava di cliccarlo, «element is not stable»: quello che dà fastidio a un
// test automatico dà fastidio anche a un dito.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';

/** frazione di tempo rimasta, aggiornata sull'orologio del server */
function useRemainingFrac(endsAt: number, durationMs: number, offset: number): number {
  const [frac, setFrac] = useState(() => (endsAt - (Date.now() + offset)) / durationMs);
  const raf = useRef(0);
  useEffect(() => {
    const loop = () => {
      setFrac((endsAt - (Date.now() + offset)) / durationMs);
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [endsAt, durationMs, offset]);
  return Math.max(0, Math.min(1, frac));
}

export function Buzzer({
  endsAt,
  durationMs,
  offset,
  disabled,
  onBuzz,
  label,
}: {
  endsAt: number;
  durationMs: number;
  offset: number;
  disabled: boolean;
  onBuzz: () => void;
  label: string;
}) {
  const frac = useRemainingFrac(endsAt, durationMs, offset);
  // da 1,7 s per battito quando c'è tempo, fino a 0,45 s sul finale
  const battito = 0.45 + 1.25 * frac;
  const urgente = frac < 0.28;

  return (
    <>
      {/* alone rosso ai bordi dello schermo nell'ultimo quarto: la fretta si
          sente anche guardando la domanda, non solo il pulsante */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-0 z-0 transition-opacity duration-500 ${urgente ? 'vignetta' : ''}`}
        style={{
          opacity: urgente ? 1 : 0,
          background: 'radial-gradient(120% 80% at 50% 50%, transparent 55%, rgba(239,68,68,0.22) 100%)',
          animationDuration: `${battito}s`,
        }}
      />
      <div className="relative z-10 flex items-center justify-center">
        <span
          aria-hidden
          className="onda pointer-events-none absolute h-44 w-44 rounded-full bg-rose-500/35"
          style={{ animationDuration: `${battito}s` }}
        />
        <motion.button
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          whileTap={{ scale: 0.9 }}
          onClick={onBuzz}
          disabled={disabled}
          className={`buzzer relative h-44 w-44 rounded-full bg-gradient-to-b font-display text-2xl font-extrabold text-white ${
            urgente ? 'from-rose-300 to-rose-600' : 'from-rose-400 to-rose-600'
          }`}
        >
          {label}
        </motion.button>
      </div>
    </>
  );
}
