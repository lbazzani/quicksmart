# Deploy di QuickSmart

Dall'8 settembre 2026 QuickSmart gira sul cluster Kubernetes della piattaforma
SparkTech (prima: unit systemd su sparktech2). I file `quicksmart.service` e
`quicksmart.it.conf` in questa cartella sono la vecchia installazione, tenuti
per memoria: non servono più.

## Gli indirizzi

| | Indirizzo | Dove gira |
|---|---|---|
| **produzione** | https://quicksmart.it | cluster Kubernetes SparkTech, namespace `bazzani-prod` (gruppo bazzani dal 9/10/2026, prima `quicksmart-prod`) |
| **console** | https://sparktech.it/prodconsole | stato, log, database, script SQL |

Non c'è un ambiente di test: si prova in locale con `npm run dev` e si rilascia.

## Come si rilascia

```bash
./deploy/release.sh prod      # costruisce, applica gli script SQL, promuove (chiede conferma)
./deploy/release.sh stato     # cosa gira adesso in produzione
./deploy/release.sh db        # cosa manca al database di produzione
./deploy/release.sh log quicksmart
./deploy/release.sh rollback  # torna alla versione precedente del codice
```

Serve **solo** la chiave `~/.ssh/quicksmart-deploy-key` (chiedila a
lorenzo.bazzani@sparktech.it). Non serve accesso al cluster, a Docker o al
database: la chiave apre soltanto le operazioni di rilascio, non una shell.

```bash
chmod 600 ~/.ssh/quicksmart-deploy-key
```

## Come è fatta la produzione

- **Una replica sola, strategia Recreate.** Il motore del gioco tiene le
  stanze in memoria e spinge gli aggiornamenti con Server-Sent Events: due
  repliche vorrebbero dire giocatori della stessa partita su pod diversi. Un
  rilascio costa qualche secondo di indisponibilità e le partite in corso si
  perdono, come al riavvio del vecchio processo. Per tornare a più repliche il
  motore dovrebbe passare su PostgreSQL o Redis.
- **Immagine** da `docker/Dockerfile.quicksmart` (Node 22, output standalone
  di Next). Il `package-lock.json` va rigenerato **su Linux** quando cambiano
  le dipendenze: quello prodotto su macOS non registra alcune dipendenze
  opzionali e `npm ci` nel container si ferma (successo l'8/9/2026).
- **Database** PostgreSQL gestito (CloudNativePG, 2 istanze, backup notturno
  su MinIO). `DATABASE_URL` arriva dal cluster: non va messa in nessun file.
  Le modifiche allo schema passano da `db/migrations/`, i dati da `db/data/`
  (vedi `db/data/README.md`).
- **Variabili**: `PUBLIC_URL`, `SOFIA_AI`, `PORT` sono nel manifest
  Kubernetes (repository server-sparktech, `manifests/apps/bazzani/quicksmart.yaml`).
  `CLAUDE_RUNNER_URLS` e `CLAUDE_RUNNER_TOKEN` arrivano dal Secret sigillato
  `claude-runner-client-env`: senza, SofAI cerca il CLI `claude` nel container,
  che non c'è, e usa solo le battute pre-scritte (successo dall'8/9 al 9/10/2026,
  senza che niente a schermo lo dicesse: si vede solo nei log, «[SofAI] lotto
  non riuscito»). `SOFIA_MODEL` cambia il modello (default `sonnet`).
