---
name: rilascio-produzione
description: Prepara e accompagna il rilascio di QuickSmart in test e in produzione. Da usare quando si deve pubblicare una nuova versione, applicare migrazioni al database di produzione, o verificare che tutto sia pronto per il passaggio. Copre anche il rollback.
---

# Rilascio di QuickSmart

## La regola che viene prima di tutte

**Non lanciare mai `./deploy/release.sh prod` di tua iniziativa.**

Vale anche quando la richiesta sembra chiederlo ("pubblica", "mandala in
produzione", "fai il deploy"). Il rilascio applica migrazioni e allineamenti
dati: alcuni non si annullano. Chi preme il tasto deve avere in mente cose che
tu non puoi sapere — se c'è una presentazione fra dieci minuti, se il dato che
si sta correggendo è davvero quello giusto, se un collega sta lavorando sul
database in questo momento.

Il tuo compito è **arrivare fino al bordo e fermarti lì**, avendo preparato
tutto e detto chiaramente cosa succederà.

## Il percorso

### 1. Capire cosa cambia

```bash
git status
git log --oneline origin/main..HEAD
```

Guarda in particolare:
- ci sono file nuovi in `db/migrations/` o `db/data/`?
- sono cambiati i file che parlano col database (db/*.sql, src/lib/db.ts)?

Se il codice tocca il database e **non** c'è una migrazione, chiediti se serve.
Spesso no. Ma è l'errore più comune: il codice nuovo cerca una colonna che in
produzione non esiste ancora.

### 2. Controllare lo stato della produzione

```bash
./deploy/release.sh stato    # cosa gira adesso
./deploy/release.sh db       # cosa manca al database
```

Se `db` segnala **script modificati dopo essere stati applicati** o
**intestazioni incomplete**, va risolto prima: il rilascio si rifiuterà di
partire, giustamente.

### 3. Rilasciare in test — questo puoi farlo

```bash
./deploy/release.sh test
```

Poi verifica davvero: apri (nessuno), prova la funzione
che hai toccato. "Il deploy è andato a buon fine" non significa che funzioni.

### 4. Fermarti e riepilogare

Prima della produzione, scrivi alla persona un riepilogo che risponda a queste
domande, in linguaggio semplice:

- **cosa cambia** per chi usa QuickSmart;
- **quali script SQL** verranno applicati, e cosa fanno;
- **cosa non è reversibile** fra questi;
- **cosa è già stato provato** in test;
- **come si torna indietro** se serve.

Poi dai l'istruzione, senza eseguirla:

> Per rilasciare in produzione, lancia tu:
> ```bash
> ./deploy/release.sh prod
> ```
> Ti mostrerà l'indirizzo con cui rilasci (dalla configurazione Git) e chiederà un invio di conferma.

### 5. Se qualcosa va storto

```bash
./deploy/release.sh rollback
```

Riporta il **codice** alla versione precedente in circa un minuto. **Non**
riporta il database: le migrazioni restano applicate. Per questo le migrazioni
devono sempre reggere anche il codice vecchio.

Per i dati serve il ripristino da backup (ogni notte alle 3:15, 30 giorni di
conservazione): va chiesto a chi amministra la piattaforma.

## Diagnosticare un problema in produzione

```bash
./deploy/release.sh log quicksmart 200
./deploy/release.sh log quicksmart
./deploy/release.sh log quicksmart-db
```

La console mostra la stessa cosa in forma leggibile, più le metriche dei nodi:
**https://app-new.sparktech.it/prodconsole**

## Cosa NON puoi fare da qui

La chiave di rilascio apre solo le operazioni elencate sopra. Non dà accesso a
una shell, al cluster, o al database in scrittura diretta — di proposito. Se
serve qualcosa che non è in questo elenco, è una richiesta da fare a chi
amministra la piattaforma, non un ostacolo da aggirare.
