#!/usr/bin/env bash
#
# release.sh — porta QuickSmart in test o in produzione.
#
#   ./deploy/release.sh test
#   ./deploy/release.sh prod
#
# Distribuito dalla piattaforma SparkTech: non modificarlo qui. La versione
# buona sta in server-sparktech/skills/progetto/_file/release.sh, e da lì
# arriva a tutti i progetti. Una modifica locale verrebbe sovrascritta.
#
# Serve solo la chiave ~/.ssh/quicksmart-deploy-key. Non serve accesso al cluster, a
# Docker o al database.
#
# Questo script non si limita a eseguire: prima di toccare la produzione fa le
# domande che è facile dimenticarsi di farsi.

set -uo pipefail

AMBIENTE="${1:-}"
CHIAVE="${DEPLOY_KEY:-$HOME/.ssh/quicksmart-deploy-key}"
NODO="${DEPLOY_HOST:-quicksmart-deploy@5.189.188.37}"
RADICE="$(cd "$(dirname "$0")/.." && pwd)"
URL_PROD="https://quicksmart.it"
URL_TEST="(nessuno)"
CONSOLE="https://sparktech.it/prodconsole"

R=$'\e[31m'; G=$'\e[32m'; Y=$'\e[33m'; B=$'\e[1m'; N=$'\e[0m'
titolo() { printf '\n%s── %s %s\n' "$B" "$1" "$(printf '─%.0s' $(seq 1 $((66-${#1}))))$N"; }
ok()     { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
avviso() { printf '  %s⚠%s  %s\n' "$Y" "$N" "$1"; ALLARMI=$((ALLARMI+1)); }
grave()  { printf '  %s✗%s  %s\n' "$R" "$N" "$1"; BLOCCHI=$((BLOCCHI+1)); }
info()   { printf '    %s\n' "$1"; }
ALLARMI=0; BLOCCHI=0

remoto() { ssh -i "$CHIAVE" -o BatchMode=yes "$NODO" "$*"; }

# Copia i sorgenti sul nodo (inerte: nessun effetto in produzione).
# L'elenco dei file lo decide Git.
# ⚠️ Non tornare a `tar --exclude`: su macOS bsdtar applica le esclusioni anche
# ai suffissi, quindi «--exclude=data» esclude ANCHE db/data e tutti gli script
# di allineamento dati spariscono dal rilascio in silenzio.
invia_sorgenti() {
  git -C "$RADICE" ls-files -co --exclude-standard \
    | tar -C "$RADICE" -czf - -T - \
    | ssh -i "$CHIAVE" -o BatchMode=yes "$NODO" sync
}

uso() {
  cat <<EOF
Uso: ./deploy/release.sh <test|prod>

  test   rilascia su $URL_TEST
  prod   rilascia su $URL_PROD  (chiede conferma)

Altri comandi:
  ./deploy/release.sh stato            cosa gira adesso in produzione
  ./deploy/release.sh db               cosa manca al database di produzione
  ./deploy/release.sh log <app> [n]    log di un'applicazione
  ./deploy/release.sh scala <app> <n>  cambia il numero di repliche
  ./deploy/release.sh rollback         torna alla versione precedente

Console: $CONSOLE
EOF
}

case "$AMBIENTE" in
  stato)  remoto status;   exit $? ;;
  # Prima i sorgenti, poi il controllo: deve valutare gli script di ADESSO,
  # non quelli dell'ultimo rilascio.
  db)     invia_sorgenti >/dev/null; remoto db-check; exit $? ;;
  log)    remoto "logs ${2:-} ${3:-100}"; exit $? ;;
  scala)  remoto "scale ${2:-} ${3:-}";   exit $? ;;
  rollback)
    printf '%sTornare alla versione precedente in produzione?%s [scrivi: rollback] ' "$B" "$N"
    read -r r; [ "$r" = rollback ] || { echo "annullato"; exit 1; }
    remoto rollback; exit $? ;;
  test|prod) ;;
  ""|-h|--help|help) uso; exit 0 ;;
  *) uso; exit 2 ;;
esac

[ -f "$CHIAVE" ] || { echo "Chiave di rilascio non trovata in $CHIAVE"; exit 1; }

# ── 1. Che cosa stai per rilasciare ──────────────────────────────────────────
titolo "Che cosa stai per rilasciare"
cd "$RADICE"
RAMO=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
REV=$(git rev-parse --short HEAD 2>/dev/null || echo '?')
info "ramo $RAMO · commit $REV · $(git log -1 --format=%s 2>/dev/null | cut -c1-60)"

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  avviso "Ci sono modifiche non committate: finiranno nel rilascio ma non in Git."
  info "Chi guarderà questo rilascio fra sei mesi non saprà cosa conteneva."
  git status --porcelain | head -8 | sed 's/^/      /'
fi
if [ "$AMBIENTE" = prod ]; then
  [ "$RAMO" = main ] || avviso "Rilascio in produzione dal ramo «$RAMO», non da main."
  git diff --quiet "origin/$RAMO" HEAD 2>/dev/null || \
    avviso "Il commit locale non coincide con origin/$RAMO: fai «git push» prima."
fi

# ── 2. Invio dei sorgenti ────────────────────────────────────────────────────
# PRIMA del controllo del database, non dopo la conferma: il controllo deve
# valutare gli script che stai per rilasciare, non quelli del sync precedente
# (che possono essere vecchi di giorni, o contenere artefatti ormai corretti).
# Inviare i sorgenti non cambia nulla in produzione: è solo una copia sul nodo.
titolo "Invio dei sorgenti"
invia_sorgenti || { echo "invio fallito"; exit 1; }

# ── 3. Il database ───────────────────────────────────────────────────────────
titolo "Il database"
DDL_NUOVI=$(git diff --name-only "origin/$RAMO...HEAD" 2>/dev/null | grep -c '^db/migrations/' || true)
CODICE_DB=$(git diff --name-only "origin/$RAMO...HEAD" 2>/dev/null | grep -cE '^(db/.*\\.sql|src/lib/db\\.ts)$' || true)
STATO_DB=$(remoto db-check 2>&1)
echo "$STATO_DB" | sed 's/^/  /'

if [ "$CODICE_DB" -gt 0 ] && [ "$DDL_NUOVI" -eq 0 ]; then
  avviso "Hai cambiato $CODICE_DB file che parlano col database, ma nessuna migrazione."
  info "Se il codice nuovo si aspetta una colonna che in produzione non esiste,"
  info "il rilascio passa e l'applicazione si rompe alla prima richiesta."
fi
echo "$STATO_DB" | grep -q 'MODIFICATO dopo essere stato applicato' && \
  grave "Uno script già applicato è stato modificato: va risolto prima."
echo "$STATO_DB" | grep -q 'non dichiara @' && \
  grave "Uno script in attesa non ha l'intestazione completa (@descrizione, @autore, @reversibile)."
IN_ATTESA=$(echo "$STATO_DB" | grep -c '⏳' || true)
[ "$IN_ATTESA" -gt 0 ] && {
  avviso "$IN_ATTESA script verranno applicati al database di produzione."
  info "Gli allineamenti dati non si annullano: verifica che siano quelli giusti."; }

# ── 4. Le domande che solo tu puoi risolvere ─────────────────────────────────
if [ "$AMBIENTE" = prod ]; then
  titolo "Prima di continuare"
  cat <<'EOF'
  Rispondi a mente, non allo script:

    · Questa stessa versione è già stata provata in test?
    · Se ci sono migrazioni, il codice VECCHIO continua a funzionare con lo
      schema NUOVO? (per qualche minuto convivono)
    · Gli script in db/data/ sono pensati per la produzione, o erano
      correzioni valide solo in test?
    · Se qualcosa va storto, sai come tornare indietro?
      («release.sh rollback» riporta il codice, NON i dati.)
EOF
fi

# ── 5. Conferma ──────────────────────────────────────────────────────────────
titolo "Riepilogo"
printf '  ambiente:     %s%s%s\n' "$B" "$AMBIENTE" "$N"
printf '  versione:     %s (%s)\n' "$REV" "$RAMO"
printf '  segnalazioni: %s da valutare · %s bloccanti\n' "$ALLARMI" "$BLOCCHI"
[ "$BLOCCHI" -gt 0 ] && { printf '\n  %sNon procedo: %s problemi bloccanti.%s\n\n' "$R" "$BLOCCHI" "$N"; exit 1; }

if [ "$AMBIENTE" = prod ]; then
  # L'identità di chi rilascia viene da Git: è la stessa che firma i commit,
  # e resta accanto a ogni migrazione applicata. Un invio conferma tutto;
  # chi vuole rilasciare con un altro indirizzo lo scrive al posto dell'invio.
  AUTORE=$(git -C "$RADICE" config user.email 2>/dev/null || true)
  printf '\n  %sStai per modificare la PRODUZIONE su %s.%s\n' "$B" "$URL_PROD" "$N"
  if [ -n "$AUTORE" ]; then
    printf '  Rilascio a nome di %s%s%s (dalla configurazione Git).\n' "$B" "$AUTORE" "$N"
    printf '  [invio per confermare · un altro indirizzo per cambiare · Ctrl-C per fermarti] > '
    read -r risposta
    [ -n "$risposta" ] && AUTORE="$risposta"
  else
    printf '  Il tuo indirizzo email (resta accanto a ogni migrazione applicata) > '
    read -r AUTORE
  fi
  [[ "$AUTORE" == *@* ]] || { echo "  serve un indirizzo email."; exit 1; }
else
  printf '\n  Invio in test. [invio per continuare, Ctrl-C per fermarti] '
  read -r _
fi

# ── 6. Esecuzione ────────────────────────────────────────────────────────────
# I sorgenti sono già sul nodo (sezione 2): da qui in poi solo le azioni.
if [ "$AMBIENTE" = test ]; then
  titolo "Rilascio in test"
  remoto test-deploy || exit 1
  printf '\n  %s✓%s %s\n\n' "$G" "$N" "$URL_TEST"
  exit 0
fi

TAG="$(date +%Y%m%d-%H%M)-$REV"
titolo "Costruzione delle immagini"
USCITA=$(remoto "build $TAG") || { echo "costruzione fallita"; exit 1; }
echo "$USCITA" | sed 's/^/  /'
# Le righe DIGEST_<immagine>=sha256:… diventano gli argomenti di promote.
COPPIE=$(echo "$USCITA" | sed -n 's/^DIGEST_\(.*\)=\(sha256:.*\)$/\1=\2/p' | tr '\n' ' ')
[ -n "$COPPIE" ] || { echo "nessun digest ottenuto"; exit 1; }

titolo "Database"
# Prima lo schema, poi i dati, poi il codice.
remoto "db-apply $AUTORE" || { echo "migrazioni fallite: NON promuovo il codice"; exit 1; }

titolo "Promozione in produzione"
# La promozione scrive i digest nei manifest (GitOps) e attende che il cluster
# converga davvero su quelle immagini: se il ✓ arriva, la versione è in
# esecuzione — non solo "il comando è partito". L'autore finisce nel commit.
remoto "promote autore=$AUTORE $COPPIE" || { echo "promozione fallita — «release.sh rollback» per tornare indietro"; exit 1; }

titolo "Verifica"
# Oltre agli HTTP 200, confronta i digest in esecuzione con quelli dei manifest.
remoto verifica | sed 's/^/  /'

printf '\n  %s✓ QuickSmart aggiornato in produzione%s\n' "$G" "$N"
printf '    %s\n    console: %s\n\n' "$URL_PROD" "$CONSOLE"
