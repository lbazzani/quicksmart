<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Produzione sulla piattaforma SparkTech (dall'8 settembre 2026)

QuickSmart gira sul cluster Kubernetes SparkTech: indirizzi, comandi e
vincoli sono in `deploy/README.md`; le procedure per Claude sono le skill in
`.claude/skills/` (rilascio-produzione, stato-produzione, migrazione-database),
distribuite dal repository server-sparktech: non modificarle qui.

**Regola per l'agent**: la produzione non si tocca senza conferma esplicita
della persona. `./deploy/release.sh prod` lo lancia una persona; l'agent
prepara codice, migrazioni e script dati, verifica in locale, riepiloga cosa
cambia e cosa non è reversibile, e si ferma. Ogni cambiamento al database passa
da un file in `db/migrations/` o `db/data/` con l'intestazione richiesta.
