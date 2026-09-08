---
name: stato-produzione
description: Verificare lo stato di QuickSmart in produzione — repliche attive, versioni delle immagini, salute del database, log, migrazioni applicate. Da usare per diagnosticare problemi o rispondere a "come sta andando la produzione".
---

# Guardare la produzione

## Dal terminale

```bash
./deploy/release.sh stato       # repliche, immagini, database, ultimo rilascio
./deploy/release.sh db          # migrazioni e allineamenti: applicati e in attesa
./deploy/release.sh log quicksmart 200
./deploy/release.sh log quicksmart
./deploy/release.sh log quicksmart-db
```

## Dalla console

**https://app-new.sparktech.it/prodconsole**

Accesso con l'account Microsoft aziendale. Mostra ciò che il terminale non dà:
carico dei nodi, spazio disco, stato delle patch di sicurezza, contenuto degli
script SQL, interrogazione del database.

## Cosa guardare quando qualcosa non va

**L'applicazione non risponde**

```bash
./deploy/release.sh stato
```

Se `PRONTI` è minore di `ATTESI`, le repliche non partono. Il perché sta nei log:

```bash
./deploy/release.sh log quicksmart 200
```

Le cause più frequenti in ordine di probabilità: il database non risponde; una
variabile d'ambiente manca; l'immagine nuova ha un errore che in test non si era
visto perché i dati erano diversi.

**Risponde ma sbaglia i dati**

Controlla che le migrazioni siano allineate:

```bash
./deploy/release.sh db
```

Uno script in attesa significa che il codice in produzione si aspetta uno schema
che il database non ha. Succede se il rilascio si è fermato a metà.

**Era andato tutto bene e ora no**

```bash
./deploy/release.sh rollback
```

Prima si ripristina il servizio, poi si capisce cosa è successo. Non il
contrario.

## Gli indirizzi

| | |
|---|---|
| produzione | https://quicksmart.it |
| test | (nessuno) |
| console | https://app-new.sparktech.it/prodconsole |
