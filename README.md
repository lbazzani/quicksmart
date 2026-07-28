# QuickSmart ⚡

Quiz visuale stile test del QI, in tempo reale, mobile-first. Crea una squadra, condividi il codice (o il QR), prenotati per primo e rispondi in 5 secondi. Con **SofAI**, la mascotte che commenta la partita (battute generate da Claude).

Regole complete e architettura: [GAME_DESIGN.md](GAME_DESIGN.md).

## Stack

- **Next.js 16** (App Router, TypeScript) + Tailwind v4 + motion
- **PostgreSQL 17** — archivio domande, partite, giocatori, round
- **SSE** per il realtime; game engine in-memory autoritativo con timer server-side
- **Domande procedurali**: 10 generatori (sequenze, matrici, intrusi, serie numeriche, rotazioni, dadi, orologi, bilance, analogie, equazioni simboliche) × 3 difficoltà, con distrattori costruiti ad arte e spiegazione
- **SofAI**: commenti AI via `claude` CLI headless (modello haiku, timeout, fallback a battute pre-scritte)

## Avvio in locale

```bash
npm install

# Postgres (docker) + database
# imposta DATABASE_URL in .env.local, es:
#   DATABASE_URL=postgres://user:pass@localhost:5433/quicksmart
#   SOFIA_AI=1   # richiede il CLI `claude` loggato
psql "$DATABASE_URL" -f db/schema.sql
npx tsx tools/seed.ts 20        # ~600 domande (20 per tipo per difficoltà)

npm run dev                      # oppure: npm run build && npm start
```

Per giocare dal telefono: apri l'app dall'IP LAN del computer (la lobby mostra il QR di invito).

## Test

```bash
npx vitest run tests/                 # unit: scoring, rampa difficoltà
npx tsx tools/check-generators.ts     # contratto dei 10 generatori
BASE=http://localhost:3005 npx tsx tools/apitest.ts   # integrazione API (server attivo)
npx playwright test                   # E2E: partita 3 giocatori + solo (server attivo)
```

## Struttura

```
src/lib/questions/   generatori procedurali (payload dichiarativo → SVG client-side)
src/lib/engine/      game engine (stati, buzz, timer, punteggi) + persistenza
src/lib/sofia/       mascotte SofAI (CLI Claude + battute di fallback)
src/app/api/         route: create/join/start/buzz/answer/end/stream(SSE)/qr
src/components/      renderer SVG delle domande, avatar SofAI, timer, UI
tools/               seed, validatore generatori, test integrazione, export audit
```

## i18n

Tutte le stringhe UI vivono in `src/lib/i18n.ts` (oggi solo italiano, struttura pronta per altre lingue).
