'use client';
// Lingua dell'interfaccia. Il primo render (e l'SSR) è SEMPRE italiano, così
// server e client combaciano; dopo il montaggio si passa alla lingua salvata
// o a quella del browser. Le domande e le battute di SofAI restano in
// italiano: nascono sul server, per stanza, condivise fra tutti i giocatori.

import { createContext, useContext, useEffect, useState } from 'react';
import { DICTS, T as DEFAULT_T, type Dict, type LangCode } from './i18n';
import { loc } from './localize';
import type { LocalizedText } from './types';

const KEY = 'qs:lang';

const LangCtx = createContext<{ lang: LangCode; t: Dict; setLang: (l: LangCode) => void }>({
  lang: 'it',
  t: DEFAULT_T,
  setLang: () => {},
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<LangCode>('it');

  useEffect(() => {
    const saved = localStorage.getItem(KEY);
    const auto: LangCode = navigator.language?.toLowerCase().startsWith('it') ? 'it' : 'en';
    const next: LangCode = saved === 'it' || saved === 'en' ? saved : auto;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- la lingua vera si sa solo nel browser
    if (next !== 'it') setLangState(next);
  }, []);

  function setLang(l: LangCode) {
    localStorage.setItem(KEY, l);
    setLangState(l);
  }

  return <LangCtx.Provider value={{ lang, t: DICTS[lang], setLang }}>{children}</LangCtx.Provider>;
}

/** Il dizionario della lingua attiva. Nei componenti: `const T = useT()`. */
export function useT(): Dict {
  return useContext(LangCtx).t;
}

export function useLang(): { lang: LangCode; setLang: (l: LangCode) => void } {
  const { lang, setLang } = useContext(LangCtx);
  return { lang, setLang };
}

/**
 * Risolve il testo multilingua di una domanda (prompt, spiegazione, risposte…)
 * nella lingua attiva. `const loc = useLoc(); <p>{loc(cur.prompt)}</p>`.
 */
export function useLoc(): (text: LocalizedText) => string {
  const { lang } = useContext(LangCtx);
  return (text: LocalizedText) => loc(text, lang);
}

/** Bottone 🌐 che alterna IT/EN (mostrato dove si entra: home e join). */
export function LangSwitch({ className = '' }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <button
      type="button"
      onClick={() => setLang(lang === 'it' ? 'en' : 'it')}
      className={`btn-ghost px-3 py-1.5 text-sm font-bold text-stone-300 ${className}`}
      aria-label="language"
    >
      🌐 {lang === 'it' ? 'EN' : 'IT'}
    </button>
  );
}
