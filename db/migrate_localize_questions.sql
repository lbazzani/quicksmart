-- Migrazione una tantum: prompt/explanation di `questions` da TEXT a JSONB
-- (LocalizedText, {"it": "...", "en": "..."}), per le domande multilingua.
--
-- Sicura sulle righe esistenti: il valore italiano attuale finisce sotto "it"
-- E sotto "en" (stessa convenzione di L() in src/lib/localize.ts — l'inglese
-- ripiega sull'italiano finché non si rigenera l'archivio). Nessuna riga
-- persa: `rounds.question_id` continua a puntare agli stessi id.
--
-- Uso: psql "$DATABASE_URL" -f db/migrate_localize_questions.sql
-- Poi: npx tsx tools/seed.ts   (rigenera l'archivio con i testi bilingue veri)
--
-- Idempotente: se le colonne sono già JSONB non fa nulla.

DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'questions' AND column_name = 'prompt') = 'text' THEN
    ALTER TABLE questions
      ALTER COLUMN prompt TYPE JSONB USING jsonb_build_object('it', prompt, 'en', prompt),
      ALTER COLUMN explanation TYPE JSONB USING jsonb_build_object('it', explanation, 'en', explanation);
  END IF;
END $$;
