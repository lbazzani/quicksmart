---
name: migrazione-database
description: Scrivere una migrazione DDL o uno script di allineamento dati per QuickSmart secondo lo standard della piattaforma. Da usare quando serve cambiare lo schema del database (colonne, tabelle, indici) o correggere/popolare dati in produzione.
---

# Scrivere una migrazione

## Prima domanda: struttura o contenuto?

| Stai cambiando… | Cartella | Nome |
|---|---|---|
| **struttura** — colonne, tabelle, indici, vincoli | `db/migrations/` | `NNNN_descrizione.sql` |
| **contenuto** — valori, popolamenti, configurazioni | `db/data/` | `AAAAMMGG-hhmm_descrizione.sql` |

La distinzione conta: il DDL va applicato in ogni ambiente, sempre, nello stesso
ordine. Un allineamento dati vale spesso **una volta sola** e su **un ambiente
solo**. Metterli insieme porta prima o poi a eseguire in produzione una
correzione scritta per il test.

Il numero (`0017`) e la data (`20260901-1430`) determinano l'ordine di
esecuzione. Per il numero: guarda l'ultimo presente e aggiungi uno.

## L'intestazione è obbligatoria

```sql
-- @descrizione: aggiunge contract_code a derived.lotto_stats
-- @autore:      nome.cognome@sparktech.it
-- @ticket:      QuickSmart-142
-- @reversibile: si
-- @rollback:    ALTER TABLE derived.lotto_stats DROP COLUMN contract_code;

ALTER TABLE derived.lotto_stats ADD COLUMN contract_code integer;
```

Senza `@descrizione`, `@autore` e `@reversibile` il rilascio **si rifiuta di
partire**. Non è pedanteria: sono i tre campi che la console mostra e che
permettono a un collega di capire un cambiamento senza aprire il file.

`@reversibile` va risposto con onestà. `DROP COLUMN` è `no`: la colonna torna,
il contenuto no. Dichiararlo cambia cosa si fa prima di rilasciare — per esempio
verificare che il backup della notte sia andato a buon fine.

## La regola che rompe più rilasci

**Durante il rilascio lo schema nuovo convive con il codice vecchio.**

Le repliche si sostituiscono una alla volta: per qualche minuto c'è ancora un
processo che gira col codice precedente, e lo schema è già cambiato.

| Sicuro in un rilascio | Va spezzato in due |
|---|---|
| `ADD COLUMN` (annullabile, con default) | `RENAME COLUMN` |
| `CREATE TABLE` | `ALTER COLUMN TYPE` |
| `CREATE INDEX CONCURRENTLY` | `DROP COLUMN` ancora usata |
| aggiungere un valore a un enum | rendere `NOT NULL` una colonna esistente |

**Come si spezza**, per esempio una rinomina:

1. rilascio A — aggiungi `nuovo_nome`, popolalo, il codice scrive su entrambi;
2. rilascio B — il codice legge solo `nuovo_nome`;
3. rilascio C — togli `vecchio_nome`.

Tre rilasci sembrano tanti. Sono comunque meno di un'ora di disservizio.

## Attenzione su tabelle grandi

Su una tabella da qualche GB (la console mostra le dimensioni sotto Database):

- `ADD COLUMN` con un `DEFAULT` costante è veloce (PostgreSQL 11+ non riscrive);
- `ADD COLUMN` con un default **calcolato** riscrive tutta la tabella e la
  blocca: separalo in `ADD COLUMN` + `UPDATE` a lotti;
- gli indici si creano con `CREATE INDEX CONCURRENTLY` — che però **non può
  stare in una transazione**, e il runner mette ogni file in transazione.
  Quindi: crea l'indice normale se la tabella è piccola, altrimenti chiedi a chi
  amministra la piattaforma di farlo fuori dal rilascio.

## Un file applicato non si modifica

Se hai sbagliato, scrivi il file successivo che corregge. Lo strumento registra
l'impronta di ogni file e segnala quelli cambiati dopo l'applicazione: è l'unico
modo di accorgersi che test e produzione hanno storie diverse.

## Verificare prima di rilasciare

```bash
./deploy/release.sh db     # elenca cosa manca in produzione, con le descrizioni
```
