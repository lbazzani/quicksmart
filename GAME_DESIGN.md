# QuickSmart — Game Design

Quiz visuale stile test del QI, in tempo reale, mobile-first. Una squadra, un codice, chi si prenota per primo risponde. Veloce, competitivo, bello da vedere.

## Modalità

1. **Squadra (multiplayer)** — l'host crea la partita, condivide un codice a 5 lettere (o QR code). I giocatori entrano con nickname + avatar emoji. L'host è anche giocatore e ha i controlli di partita. Si può entrare **anche a partita iniziata**: chi arriva in ritardo parte da zero punti e gioca dal round successivo (quello in corso lo vedrebbe a metà).
2. **Solo (allenamento)** — stesso motore, un solo giocatore, con timer di decisione: se non ti prenoti entro il tempo massimo vieni penalizzato.

## Flusso di un round (multiplayer)

0. **BRIEFING** — Durante il countdown SofAI presenta il round: tipo di domanda,
   difficoltà (★), punti in palio e tempi, con una battuta che ruota per non
   ripetersi. Chi gioca sa sempre che cosa sta per succedere e quanto vale.
1. **BUZZ** — La domanda appare a tutti simultaneamente. Finestra di prenotazione (default 40s: nei test in famiglia 25 erano pochi per ragionare). Grande pulsante BUZZ: il primo che preme si prenota (arbitraggio atomico server-side, gli altri ricevono "troppo tardi").
2. **ANSWER** — Il prenotato ha **12 secondi (configurabile)** per scegliere fra 3 risposte molto simili. Gli altri vedono "✋ X sta rispondendo…" con il timer.
3. **Esiti**
   - ✅ **Giusta** → punti (base × difficoltà + bonus velocità × streak). Confetti.
   - ❌ **Sbagliata** → penalità; il giocatore è escluso dal round e la domanda **riapre** per gli altri per 15s al **70% del valore** (decay per ogni errore). Un banner dice CHI ha sbagliato; con l'opzione **"errori visibili"** (default on) tutti vedono anche QUALE risposta è bruciata, sbarrata nella griglia: aiuta e invoglia a riprovare. Si continua finché qualcuno indovina, la finestra scade o tutti sono esclusi.
   - 🐔 **Prenotato ma muto** (non risponde in tempo) → penalità maggiore (ha bloccato gli altri), escluso, la domanda riapre.
   - 😴 **Nessun buzz** → piccola penalità a tutti (−10): la timidezza costa, ma poco.
4. **REVEAL** — risposta corretta evidenziata (e detta a voce quando nessuno l'ha presa) + spiegazione + delta punti animati + classifica live. Dura 6s di base e si allunga fino a 12s con le spiegazioni lunghe: si deve fare in tempo a leggerle sul telefono. **Chi ha vinto il round ha il microfono**: può scrivere una riga di sfottò che compare a tutti (chat sanificata, mai nei prompt dell'AI).

### Round speciali

- **GEMELLA** 👯 — torna una domanda che sembra già vista, con la risposta spostata: chi va a memoria paga doppio, chi guarda prende +25%.
- **LAMPO** ⚡ — metà tempo per rispondere, punti doppi.
- **SFIDA SOFAI** 🤖 — SofAI gioca anche lei: se nessuno si prenota entro il 65% della finestra, la domanda se la prende lei e si pavoneggia (−10 a tutti, come un round andato a vuoto). Solo in squadra, dal quinto round.

## Punteggio ("smart")

| Evento | Punti |
|---|---|
| Base domanda | facile **100** · media **200** · difficile **300** |
| Bonus velocità risposta | fino a **+50%** del valore in palio, proporzionale al tempo rimanente |
| Risposta sbagliata | **−30%** del valore corrente della domanda |
| Prenotato senza rispondere | **−40%** del valore corrente |
| Nessuno si prenota | **−10** a tutti |
| Riapertura dopo errore | valore domanda **×0.7** per ogni errore |

Le penalità erano −50/−60/−25 e sono state ritarate dopo i test in famiglia:
sbagliare una domanda media costava quanto vincerne una facile, e chi finiva
sotto zero smetteva di prenotarsi. Il rischio deve pungere, non castigare.

**Streak 🔥** — risposte corrette consecutive: ×1.25 da 3, ×1.5 da 5, ×2 da 8. Si azzera sbagliando (non se non buzzi).

**Solo** — timer di decisione (default 20s): scade senza buzz → **−25%** del base (la streak resta: non hai sbagliato, hai solo passato). Il buzz ferma il timer → stesso tempo di risposta della modalità squadra. Stesso scoring per giusto/sbagliato.

Il punteggio può andare sotto zero: rischiare ha un costo reale.

## Fine partita

Alla creazione l'host sceglie:
- **Numero di round** (3–30: preset rapidi 5/10/15/20 più un contatore −/+ per la scelta fine) → fine automatica, oppure
- **Partita aperta** → l'host termina quando vuole con "Termina partita" (il pool di domande si ricarica da solo, senza ripetizioni).

Podio finale animato (🥇🥈🥉) + statistiche: accuratezza, velocità media di risposta, streak massima, buzz vinti.

**La rivincita la decide chi ha vinto** (l'host resta il padrone di casa): stessa
stanza, stesso codice, punteggi azzerati, domande mai viste in quella stanza.
SofAI guarda i numeri della partita e **propone una modifica alle regole**: se
metà squadra è finita sotto zero propone +50% di tempo, se era troppo facile
(precisione ≥75% e nessuno in rosso) propone tempi accorciati di un quarto. Il
vincitore sceglie: rivincita classica o col consiglio di SofAI. Sul podio il
microfono della chat è suo.

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
| `majority` | gruppi di figure a confronto: quale ne ha di più? (nato dai test in famiglia: si capisce al primo sguardo) |
| `pairs` | tutte le figure sono in coppia, una è sola: quale? |

`fold` (foglio piegato) e `domino` (tessere) sono **sospesi** dal luglio 2026:
nei test in famiglia il primo non si capiva e il secondo risultava troppo
complicato. Restano nel codice e nei test (vedi `QUARANTINED` in
`src/lib/questions/index.ts`) e rientrano solo con una presentazione ripensata.

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

### SofAI, la mascotte

Commenta la partita: ingresso in squadra, briefing del round, esito, podio. Il
tono è **ironico e un po' teatrale** — si prende il merito delle domande belle
e dà la colpa ai giocatori per quelle sbagliate — ma mai cattivo. Le battute
sono pre-scritte (`src/lib/sofia/lines.ts`), quindi compaiono **subito**: il
gioco non aspetta mai una risposta esterna.

Dal quarto round **adotta un "cocco"**: chi è in fondo alla classifica riceve
il suo tifo dichiarato e, sulle domande difficili, un **consiglio vero** sul
tipo di quesito ("conta gruppo per gruppo, il colpo d'occhio inganna"). Il
consiglio lo leggono tutti — il favoritismo è teatro, l'aiuto è di squadra — e
i consigli sono SOLO pre-scritti (`HINTS` in lines.ts): un consiglio generato
potrebbe essere falso, e un consiglio falso è peggio di nessun consiglio.

Nel **round sfida** gioca anche lei: annuncia che vuole la domanda e, se
nessuno si prenota in tempo, se la prende e si pavoneggia.

L'AI (il CLI di Claude, lato server, con `SOFIA_AI=1`) interviene in due modi,
entrambi marcati con ✦.

**Durante la partita, scrivendo in anticipo.** Il CLI impiega dai 10 ai 50
secondi e un reveal ne dura 6: chiedere una battuta quando serve è inutile,
arriva sempre tardi. All'inizio della partita SofAI si fa scrivere un lotto di
battute, una per ogni momento del gioco (risposta giusta, errore, nessuno si
prenota, round lampo…), e le tiene pronte. Quando il momento arriva la battuta
è già lì, e compare all'istante come una pre-scritta. Il lotto si ricarica da
solo quando la scorta cala o quando il momento che serviva era a secco — una
partita può battere sempre sullo stesso tasto. Nel prompt del lotto non entra
niente scritto da chi gioca: dove va il nome c'è `{name}`, riempito al momento
dell'uso.

**Al podio, sul momento.** Lì la battuta si aspetta volentieri — la classifica
resta sullo schermo — e l'AI fa la cosa che solo lei può fare: commentare i
nomi e i punti veri di quella partita. Ha la precedenza su qualsiasi lotto in
corso, che viene interrotto.

Ogni riga generata passa da un filtro prima di andare a schermo: si scartano le
risposte in cui il modello chiede informazioni invece di fare la battuta, e
quelle che si rivolgono a chi gioca con una forma di genere («brava», «sei
stato», «da solo»). Il filtro è volutamente stretto: la prima versione bloccava
anche «prima», «solito» e «velocissima», che quasi sempre concordano con un
nome e non con la persona, e buttava battute perfette in silenzio.

Se l'AI non risponde resta la battuta pre-scritta e in partita non si nota
nulla: proprio per questo il motivo del fallimento finisce nei log del
servizio, e il test di produzione verifica che la battuta AI compaia **sullo
schermo** — un controllo sulla sola API non si accorgeva che il client
chiudeva lo stream troppo presto.

I nickname arrivano da internet e non entrano mai nel prompt: dentro sono
`Giocatore1`, `Giocatore2`… e i nomi veri tornano solo dopo la risposta.

### Tema visivo

Tavolozza "brace": sfondo notte calda (`#16100c`), **arancione** come colore guida con l'ambra a fargli eco e il verde acqua come contrappunto freddo (è il complementare dell'arancione). Niente viola né grigi azzurrini. Due colori restano riservati e non si usano come decorazione: **rosso** per il pulsante BUZZ e gli errori, **verde** per le risposte giuste — se l'arancione invadesse quel territorio, un errore e un elemento d'interfaccia si somiglierebbero.

L'"arredo" delle figure (cornici, `?`, aste delle bilance, tessere) è un grigio caldo neutro: i colori della tavolozza portano significato, perché le domande li nominano a voce. Timer circolari, transizioni motion, numeri che contano, confetti sulla vittoria. Font display per i numeri.

**Il pulsante BUZZ** ha dietro un'onda che si allarga, e il suo ritmo è il tempo che resta: lenta all'inizio, veloce sul finale. Nell'ultimo quarto i bordi dello schermo pulsano di rosso, così la fretta si sente anche mentre si guarda la figura. A muoversi è solo l'onda, mai il pulsante: un bersaglio che pulsa è un bersaglio che si sposta mentre lo si punta (Playwright si rifiutava proprio di cliccarlo, «element is not stable» — quello che dà fastidio a un test automatico dà fastidio anche a un dito).

**Lo spazio** cambia con la fase. Finché si decide se prenotarsi la domanda si prende tutto lo spazio libero e il pulsante sta in basso, dove c'è il pollice. Quando compaiono le tre opzioni lo spazio passa a loro — vanno confrontate — e l'istruzione si sposta lì accanto invece di restare in fondo allo schermo.

Chi ha chiesto al sistema meno animazioni (`prefers-reduced-motion`) non vede l'onda né i bordi che respirano.

### Mobile-first (dai test in famiglia, luglio 2026)

- **Testi grandi**: domanda a `text-xl`, spiegazioni a `text-base` su card larga, opzioni numeriche a `text-3xl`. Il reveal si allunga fino a 12s per le spiegazioni lunghe.
- **Celle fluide**: le griglie senza frecce si restringono con lo schermo (grid `minmax(0, Npx)`) invece di sbordare sui telefoni stretti; le opzioni idem.
- **Safe area iOS**: `viewport-fit=cover` + padding `env(safe-area-inset-*)` — niente contenuto sotto notch o barra home.
- **Vibrazione** (dove c'è, Android): buzz vinto, errore, ticchettio del countdown. Indipendente dal mute audio.
- **Classifica**: il MIO chip sta fisso a sinistra con il rank (#N), gli altri scorrono — con 5+ giocatori si spariva dalla classifica.
- **Onboarding**: tre schermate al primo ingresso (figura → buzz → riapertura), poi mai più (localStorage).
- **PWA**: service worker network-first (mai su /api: lo stream SSE non si tocca), installabile a schermo home.
- **Landscape**: overlay "gira il telefono" sui touch in orizzontale.

### Lingua

L'interfaccia è in **italiano e inglese**: segue la lingua del browser, con un
interruttore 🌐 in home e su /join (scelta ricordata). Le **domande e le
battute di SofAI restano in italiano**: nascono sul server, per stanza, e sono
condivise da tutti i giocatori — una partita non ha "la lingua di ognuno". Il
primo render è sempre italiano (SSR e client devono combaciare), la lingua vera
entra subito dopo il montaggio.

### Suoni

Sintetizzati con WebAudio (`src/lib/sounds.ts`): nessun file da scaricare. Countdown, via, buzz, risposta giusta, errore, nessuna prenotazione, fanfara del podio; più il **ticchettio** negli ultimi cinque secondi — sia del tempo per prenotarsi sia di quello per rispondere — che raddoppia negli ultimi due, un **suono che sale** quando la serie di risposte giuste arriva a tre (il moltiplicatore era l'unica cosa importante che non si sentiva) e un **trillo** quando qualcuno entra in squadra, perché in lobby si guarda il codice e non lo schermo.

L'audio si sblocca al primo tocco (su iOS l'`AudioContext` parte solo dentro un gesto) e si spegne dal pulsante in alto a destra, con la scelta ricordata.

## Test

1. **Unit** (vitest): scoring, streak, decay, generatori (correttezza + unicità opzioni).
2. **Integrazione**: gara di buzz con richieste concorrenti → un solo vincitore.
3. **E2E** (Playwright): partita 3 giocatori completa + partita solo, con screenshot.
4. **Audit domande**: agenti IA rispondono alla cieca a un campione per tipo/difficoltà → tasso di successo atteso decrescente, zero risposte ambigue.
