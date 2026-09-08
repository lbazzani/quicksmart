# `db/data/` — script di allineamento dati

Qui vanno gli SQL che cambiano **il contenuto** del database, non la struttura.

| | dove va |
|---|---|
| `ALTER TABLE`, `CREATE INDEX`, nuove tabelle | `db/migrations/` |
| correggere valori, popolare una colonna nuova, inserire configurazioni | **qui** |

Sono separati perché si comportano in modo diverso: il DDL va applicato ovunque
e sempre, un allineamento dati vale spesso una volta sola e su un ambiente solo.
Tenerli insieme significa prima o poi eseguire in produzione una correzione
scritta per il test.

## Nome del file

```
AAAAMMGG-hhmm_descrizione_breve.sql
20260901-1430_corregge_ordini.sql
```

La data ordina l'esecuzione. Un file già applicato **non si modifica più**: se
serve una correzione, si scrive il file successivo. Gli strumenti registrano
l'impronta di ogni file e segnalano quelli cambiati dopo l'applicazione.

## Intestazione obbligatoria

```sql
-- @descrizione: assegna lo stato iniziale agli ordini importati
-- @autore:      rene.menditto@sparktech.it
-- @ticket:      AMP-142
-- @reversibile: no

UPDATE tabella_esempio SET ...;
```

`@reversibile` non serve a generare un annullamento automatico — su dati di
produzione sarebbe più pericoloso del problema. Serve a farti rispondere alla
domanda **prima** di rilasciare: se la risposta è `no`, il rilascio ti ricorda
di verificare il backup.

## Come vengono applicati

```bash
./deploy/release.sh db      # cosa manca in produzione
./deploy/release.sh prod    # li applica, dopo conferma
```

Ogni file gira in una transazione: passa intero o non passa. Il registro sta in
`platform.data_scripts` ed è consultabile dalla console.
