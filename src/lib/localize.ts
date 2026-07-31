// Helper per il testo multilingua delle domande (vedi LocalizedText in ./types).
// Chi genera una domanda scrive `L('italiano', 'english')`; chi la mostra
// legge `loc(testo, lang)` (o `useLoc()` lato client) per la propria lingua.

import type { LangCode, LocalizedText } from './types';

/**
 * Costruisce un testo multilingua. Senza `en` esplicito, l'inglese ripiega
 * sull'italiano: comodo per i valori che non vanno tradotti (numeri, simboli)
 * e come rete di sicurezza mentre un generatore è a metà traduzione — meglio
 * italiano ripetuto che un campo mancante.
 */
export function L(it: string, en?: string): LocalizedText {
  return { it, en: en ?? it };
}

/** Risolve un testo multilingua nella lingua richiesta. */
export function loc(text: LocalizedText, lang: LangCode): string {
  return text[lang] ?? text.it;
}
