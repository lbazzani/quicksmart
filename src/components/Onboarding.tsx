'use client';
// Come si gioca, in tre schermate da dieci secondi: compare solo la prima
// volta (localStorage). Le regole complete restano nel pannello "Come si
// gioca"; qui c'è il minimo per non arrivare al primo round spaesati.

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useT } from '@/lib/lang';
import { SofaiAvatar } from './SofaiAvatar';

const KEY = 'qs:onboarded';

export function Onboarding() {
  const T = useT();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  // localStorage esiste solo nel browser: si legge dopo il montaggio
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- lettura client-only al montaggio
    if (!localStorage.getItem(KEY)) setShow(true);
  }, []);

  function close() {
    localStorage.setItem(KEY, '1');
    setShow(false);
  }

  const slides = T.onboarding.slides;
  const last = step === slides.length - 1;
  const slide = slides[step];

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#16100c]/97 px-8 text-center backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <SofaiAvatar mood={step === 2 ? 'teasing' : 'happy'} size={72} />
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex flex-col items-center gap-3"
          >
            <span className="text-6xl">{slide.e}</span>
            <h2 className="font-display text-3xl font-extrabold text-amber-300">{slide.t}</h2>
            <p className="max-w-xs text-base leading-relaxed text-stone-300">{slide.d}</p>
          </motion.div>

          <div className="flex gap-2">
            {slides.map((_, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full ${i === step ? 'bg-orange-400' : 'bg-white/20'}`} />
            ))}
          </div>

          <div className="flex w-full max-w-xs flex-col gap-2.5">
            <button
              type="button"
              onClick={() => (last ? close() : setStep(step + 1))}
              className="btn-primary py-3.5 font-display text-xl"
            >
              {last ? `🚀 ${T.onboarding.start}` : T.onboarding.next}
            </button>
            {!last && (
              <button type="button" onClick={close} className="btn-ghost py-2.5 text-sm font-bold text-stone-300">
                {T.onboarding.skip}
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
