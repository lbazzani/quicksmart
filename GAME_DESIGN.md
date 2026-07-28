# QuickSmart — Game Design

Quiz visuale stile test del QI, in tempo reale, mobile-first. Una squadra, un codice, chi si prenota per primo risponde. Veloce, competitivo, bello da vedere.

## Modalità

1. **Squadra (multiplayer)** — l'host crea la partita, condivide un codice a 5 lettere (o QR code). I giocatori entrano con nickname + avatar emoji. L'host è anche giocatore e ha i controlli di partita.
2. **Solo (allenamento)** — stesso motore, un solo giocatore, con timer di decisione: se non ti prenoti entro il tempo massimo vieni penalizzato.

## Flusso di un round (multiplayer)

1. **BUZZ** — La domanda appare a tutti simultaneamente. Finestra di prenotazione (default 25s). Grande pulsante BUZZ: il primo che preme si prenota (arbitraggio atomico server-side, gli altri ricevono "troppo tardi").
2. **ANSWER** — Il prenotato ha **5 secondi (configurabile)** per scegliere fra 3 risposte molto simili. Gli altri vedono "✋ X sta rispondendo…" con il timer.
3. **Esiti**
   - ✅ **Giusta** → punti (base × difficoltà + bonus velocità × streak). Confetti.
   - ❌ **Sbagliata** → penalità; il giocatore è escluso dal round e la domanda **riapre** per gli altri al **70% del valore** (decay per ogni errore). Si continua finché qualcuno indovina, la finestra scade o tutti sono esclusi.
   - 🐔 **Prenotato ma muto** (non risponde entro i 5s) → penalità maggiore (ha bloccato gli altri), escluso, la domanda riapre.
   - 😴 **Nessun buzz** → piccola penalità a tutti (−25): la timidezza costa.
4. **REVEAL** — risposta corretta evidenziata + spiegazione + delta punti animati + classifica live (6s), poi round successivo automatico.

## Punteggio ("smart")

| Evento | Punti |
|---|---|
| Base domanda | facile **100** · media **200** · difficile **300** |
| Bonus velocità risposta | fino a **+50%** del valore in palio, proporzionale al tempo rimanente |
| Risposta sbagliata | **−50%** del valore corrente della domanda |
| Prenotato senza rispondere | **−60%** del valore corrente |
| Nessuno si prenota | **−25** a tutti |
| Riapertura dopo errore | valore domanda **×0.7** per ogni errore |

**Streak 🔥** — risposte corrette consecutive: ×1.25 da 3, ×1.5 da 5, ×2 da 8. Si azzera sbagliando (non se non buzzi).

**Solo** — timer di decisione (default 15s): scade senza buzz → **−40%** del base (la streak resta: non hai sbagliato, hai solo passato). Il buzz ferma il timer → 5s per rispondere. Stesso scoring per giusto/sbagliato.

Il punteggio può andare sotto zero: rischiare ha un costo reale.

## Fine partita

Alla creazione l'host sceglie:
- **Numero di round** (5 / 10 / 15 / 20) → fine automatica, oppure
- **Partita aperta** → l'host termina quando vuole con "Termina partita" (il pool di domande si ricarica da solo, senza ripetizioni).

Podio finale animato (🥇🥈🥉) + statistiche: accuratezza, velocità media di risposta, streak massima, buzz vinti.

## Archivio domande

**Generatori procedurali** TypeScript: domande visuali illimitate, riproducibili (RNG seedato), con 3 opzioni di cui 2 distrattori "vicini" costruiti ad arte, spiegazione inclusa. Tipi:

| Tipo | Descrizione |
|---|---|
| `sequence` | sequenza di figure (rotazione/conteggio/dimensione) → quale viene dopo? |
| `matrix` | matrice 3×3 con cella mancante, regole di riga/colonna |
| `oddone` | trova l'intruso tra 5-6 figure |
| `numseries` | serie numeriche (aritmetiche, geometriche, intercalate, Fibonacci-like) |
| `rotation` | quale opzione è la stessa figura ruotata (i distrattori sono riflessi) |
| `dice` | dadi: facce opposte / conteggio cubi in pila 3D con cubi nascosti |
| `clock` | orologi: lancette avanti/indietro, orologio allo specchio |
| `balance` | bilance logiche: equivalenze tra forme |
| `analogy` | A sta a B come C sta a ? (trasformazioni visive) |
| `arithgrid` | equazioni con simboli (sistema visuale) |

Seed iniziale: **~600 domande** (≈200 per difficoltà), dedup per hash del payload. Ogni partita pesca domande mai viste in quella partita, mescola i tipi e scala la difficoltà (inizio facile → crescendo).

Il payload è **dichiarativo** (JSON) e viene renderizzato client-side in SVG: nitido su ogni schermo, leggero nel DB.

## Architettura

- **Next.js 15** (App Router, TypeScript) + **Tailwind v4** + **motion** (animazioni) + canvas-confetti.
- **Postgres 17** (Docker `local-postgres`, db `quicksmart`), driver `pg`, `schema.sql`.
- **Realtime**: SSE (`GET /api/game/[code]/stream`) per push dello stato; azioni via POST. `GameEngine` singleton in-memory (autoritativo, timer server-side), persistenza di partite/round/risultati su Postgres.
- **Arbitraggio buzz**: sincrono in-memory nel processo server → il primo POST vince, zero race condition.
- **Identità**: playerId + token in localStorage → il refresh del telefono non ti butta fuori (riconnessione trasparente).
- **Accesso da cellulare**: server in LAN; la lobby mostra **QR code** con l'URL LAN per entrare al volo.

### Pagine

`/` home · `/new` crea partita · `/join` entra con codice · `/g/[code]` lobby → gioco → podio (macchina a stati) · `/solo` allenamento.

### Tema visivo

Dark "neon arcade": sfondo notte, glow ciano/magenta/viola, timer circolari, pulsante BUZZ gigante, transizioni motion, numeri che contano, confetti sulla vittoria. Font display per i numeri.

## Test

1. **Unit** (vitest): scoring, streak, decay, generatori (correttezza + unicità opzioni).
2. **Integrazione**: gara di buzz con richieste concorrenti → un solo vincitore.
3. **E2E** (Playwright): partita 3 giocatori completa + partita solo, con screenshot.
4. **Audit domande**: agenti IA rispondono alla cieca a un campione per tipo/difficoltà → tasso di successo atteso decrescente, zero risposte ambigue.
