# Piano: domande infinite e a prova di furbetto

Obiettivo: rendere impossibile giocare a memoria, e far sì che ogni partita sembri nuova anche dopo cento partite.

## Da dove partiamo (misurato con `tools/measure-space.ts`)

I 10 generatori sanno produrre **~78 milioni** di domande distinte, ma il gioco ne usa **1200**: quelle seminate una volta sola nel database. Peggio, ogni domanda ha la risposta corretta **congelata in una posizione** (A, B o C): chi memorizza la coppia domanda→lettera vince senza ragionare.

Il secondo problema è la **riconoscibilità**. Contando gli "scheletri" (la struttura visiva a meno di colori, rotazioni e valori) emergono generatori poverissimi:

| generatore | scheletri | verdetto |
|---|---|---|
| `dice` d1 | 1 | sempre la stessa pila di cubi |
| `clock` d1, d2 | 1 | sempre lo stesso tipo di orologio |
| `numseries` d1–d3 | 2–3 | tre sole famiglie di serie |
| `sequence` d1 | 28 | poche regole di base |
| `matrix` d1 | 41 | poche regole di base |

All'estremo opposto `oddone`, `rotation`, `arithgrid` e `balance` d3 hanno migliaia di scheletri: quelli vanno già bene.

## Fase 1 — Togliere ogni appiglio alla memoria

1. **Domande generate al volo.** La partita non pesca più da un archivio fisso: genera con un seme casuale al momento del round. Lo spazio giocabile passa da 1.200 a decine di milioni. L'archivio su Postgres resta come rete di sicurezza (se il DB è irraggiungibile si gioca lo stesso) e come vetrina per l'audit.
2. **Opzioni rimescolate a ogni presentazione.** La posizione della risposta corretta viene decisa quando la domanda va in onda, non quando viene creata. Anche la stessa identica domanda, rivista, ha la risposta altrove.
3. **Memoria di ciò che hai già visto.** Per ogni giocatore teniamo traccia degli scheletri incontrati di recente: il gioco preferisce strutture che quel gruppo non vede da tempo.

## Fase 2 — Le domande gemelle (la trappola per il furbetto)

L'idea centrale richiesta: **la stessa domanda, con la risposta diversa.**

Ogni generatore espone una funzione `twin()` che produce una variante con la **stessa struttura visiva** — stesse forme, stessa disposizione, stessa aria di famiglia — ma un parametro cambiato che **sposta la risposta corretta su un'altra opzione**. Chi risponde a memoria ("questa è quella dei triangoli, la risposta è C") sbaglia; chi ragiona indovina.

Le gemelle entrano in gioco così:
- nelle partite lunghe, un round avanzato ripropone la gemella di una domanda già apparsa;
- SofAI la annuncia con una battuta ambigua ("Questa mi sa che l'avete già vista… o forse no 😏"), aumentando la tensione;
- chi indovina una gemella prende un **bonus attenzione** (+25%), chi la sbaglia perde il doppio: premia chi guarda davvero.

## Fase 3 — Più ricchezza dove serve

**Arricchire i generatori poveri** portando ognuno ad almeno 12–15 scheletri: nuove regole per `numseries` (primi, alternanze a tre tempi, cifre), nuove figure per `dice` (dadi in prospettiva, dadi sommati, sviluppi diversi), nuovi quesiti per `clock` (differenze fra due orologi, orologi rotti, angolo tra le lancette), nuove regole per `sequence` d1 e `matrix` d1.

**Nuovi tipi di domande**, per varietà percepita:

| tipo | idea |
|---|---|
| `fold` | foglio piegato e forato: come appare aperto? |
| `paths` | percorsi su griglia: quale porta all'uscita / quanti passi? |
| `sets` | insiemi e sovrapposizioni (stile Venn) senza testo |
| `mirror` | figura e sua immagine allo specchio, con distrattori ruotati |
| `weights` | catene di equivalenze a tre grandezze |
| `domino` | tessere del domino: quale completa la fila? |
| `symmetry` | quale figura ha un asse di simmetria (o quanti ne ha)? |
| `pattern` | conteggi e ripetizioni in una trama |

Obiettivo: **18 tipi** invece di 10, con spazio totale ben oltre i 100 milioni e nessun tipo sotto i 10 scheletri.

## Fase 4 — Esperienza di gioco

- **Round speciali** annunciati da SofAI: *Lampo* (metà tempo, punti doppi), *Gemello* (la trappola), *Tutti dentro* (nessun buzz: rispondono tutti insieme, punti a chi indovina più in fretta).
- **Barra di progressione** della partita e anteprima del tipo di domanda in arrivo.
- **Statistiche personali** a fine partita: in quali tipi di quesito sei più forte.

## Dove siamo arrivati

**In gioco: tutti e 18 i tipi.** Le domande nascono al momento del round da uno spazio di **25 milioni** di combinazioni, con le opzioni rimescolate da un generatore casuale separato da quello delle domande.

Tre tipi — `fold`, `symmetry`, `domino` — sono stati **sospesi e poi riammessi**. Erano finiti fuori per un motivo solo: un audit alla cieca aveva mostrato che si poteva ragionare bene e sbagliare comunque. In `fold` la regola decisiva (un buco fatto sulla piega non si sdoppia) si leggeva solo dopo aver risposto, e il pannello "1ª piega" disegnava la piega successiva; in `symmetry` l'asse era disegnato negli esempi ma non nelle opzioni, cioè dove si giudica; in `domino` il suggerimento («ogni tessera nasce girando quella prima di lei») era letteralmente falso e portava dritto al distrattore.

Sono rientrati dopo che la regola è stata portata nel prompt, l'asse disegnato anche sulle opzioni e i suggerimenti resi veri: il nuovo audit ha dato **36 risposte su 36**, con tutte le regole dichiarate prima di rispondere. Le condizioni del rientro sono ora custodite da `tests/fairness.test.ts`, che fallisce se qualcuno le rimuove.

**Aggiornamento (luglio 2026, dopo i test in famiglia):** `fold` e `domino` sono di nuovo in quarantena, stavolta non per l'equità ma per la **comprensibilità** — il foglio piegato non si capisce sul telefono, le tessere risultano troppo complicate. Al loro posto sono entrati due tipi pensati per capirsi al primo sguardo: `majority` (gruppi di figure a confronto: quale ne ha di più?) e `pairs` (tutte le figure sono in coppia, una è sola). Le loro garanzie — conteggi ricontati, scarto ≥ 2 del gruppo vincente, una e una sola figura senza gemella — stanno anch'esse in `tests/fairness.test.ts`.

Lo stesso audit ha scovato un difetto che avevo introdotto io nel renderer: una fila di tre forme sforava il riquadro e l'SVG ne tagliava oltre un terzo. Le forme ora stanno intere; per la leggibilità cresce la cella, non la figura.

### Tre strumenti di misura, nati da tre errori

| strumento | cosa misura | perché esiste |
|---|---|---|
| `tools/cheater-test.ts` | quanto rende giocare a memoria | tre livelli di furbetto, tutti fermi al 33% (il caso) |
| `tools/shortcut-test.ts` | quanto rende rispondere senza leggere | trovò una scorciatoia al **100%** in `pattern` |
| `tools/exchangeability-test.ts` | se una caratteristica visibile tradisce la risposta | diagnostico: non enumera euristiche, verifica l'indistinguibilità |
| `tests/fairness.test.ts` | il patto con chi gioca | tutto ciò che serve è dichiarato prima; il gioco non dice mai il falso |

La lezione più utile è arrivata dai verificatori indipendenti: dopo il primo giro di correzioni, gli agenti avevano imparato a **battere il misuratore** invece di risolvere il problema, e le scorciatoie si erano spostate su euristiche non previste (in `clock` una arrivava all'83%). Le euristiche scoperte allora sono ora dentro `shortcut-test`, e nessuna correzione viene accettata senza una controprova scritta da chi non l'ha fatta.

### Limiti noti

- In `clock` a difficoltà 1 l'euristica "scegli il numero diverso dagli altri due" rende il 49% su circa un ottavo delle domande di quel tipo: un vantaggio reale ma marginale (≈2% su quelle domande), da sistemare con calma.
- `tools/exchangeability-test.ts` segnala ancora un centinaio di correlazioni. Molte non sono sfruttabili da un bambino in cinque secondi (richiedono di confrontare più tratti fra tre opzioni), e inseguirle tutte rischia di peggiorare le domande: resta uno strumento diagnostico, non un cancello.

## Fase 5 — Verifica

1. **Audit alla cieca** dei nuovi generatori (agenti che risolvono senza vedere la soluzione), come già fatto per i primi dieci.
2. **Test del furbetto**: un simulatore che gioca "a memoria" (memorizza domanda→posizione su mille partite) deve restare **al livello del caso** (~33%). Se supera quella soglia, la memorizzazione paga ancora e il sistema va corretto.
3. **Misura dello spazio** e degli scheletri per ogni tipo, con soglie minime verificate a ogni build.
4. E2E completi e deploy su quicksmart.it.
