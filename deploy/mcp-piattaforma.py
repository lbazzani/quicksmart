#!/usr/bin/env python3
"""
Server MCP della piattaforma SparkTech.

Dà a Claude, dentro il repository di un progetto, gli strumenti per guardare e
governare la propria produzione — senza che nessuno debba ricordarsi la sintassi
di kubectl, e senza dare a nessuno le chiavi del cluster.

    claude mcp add piattaforma -- ./deploy/mcp-piattaforma.py

Tutto passa dalla stessa chiave SSH di `deploy/release.sh`, che apre soltanto le
operazioni di rilascio del proprio progetto. Uno strumento che non è elencato
qui sotto non esiste; uno elencato qui ma non permesso dalla chiave viene
rifiutato dall'altra parte. Due controlli indipendenti, non uno.

── Perché la promozione NON è fra gli strumenti ─────────────────────────────

C'è `prepara_rilascio`, che costruisce le immagini e dice cosa cambierebbe, e
non c'è nessuno strumento che porti davvero in produzione. È deliberato: il
passaggio finale lo fa una persona lanciando `./deploy/release.sh prod`, che
chiede una conferma esplicita mostrando l'indirizzo di chi rilascia (da Git).

Un agent non ha il contesto che serve per quella decisione — se c'è una
presentazione fra dieci minuti, se il dato che sta correggendo è quello giusto,
se un collega sta lavorando sul database in questo momento. Dargli il tasto
significherebbe fingere che quel contesto non conti.
"""
import json, os, shlex, subprocess, sys

CHIAVE = os.environ.get("DEPLOY_KEY", os.path.expanduser("~/.ssh/quicksmart-deploy-key"))
NODO = os.environ.get("DEPLOY_HOST", "quicksmart-deploy@5.189.188.37")
PROGETTO = "QuickSmart"
URL_PROD = "https://quicksmart.it"
CONSOLE = "https://sparktech.it/prodconsole"
RADICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def remoto(comando: str, secondi: int = 120) -> str:
    """Esegue un'operazione sul canale di rilascio."""
    if not os.path.isfile(CHIAVE):
        return (f"Chiave di rilascio assente in {CHIAVE}.\n"
                f"Chiedila a lorenzo.bazzani@sparktech.it, poi `chmod 600` sul file.")
    try:
        r = subprocess.run(
            ["ssh", "-i", CHIAVE, "-o", "BatchMode=yes",
             # Senza un limite sulla connessione, con il nodo spento lo
             # strumento resta appeso finché non scade il timeout di sistema —
             # minuti, durante i quali sembra che sia Claude a non rispondere.
             "-o", "ConnectTimeout=8", "-o", "ServerAliveInterval=15",
             "-o", "StrictHostKeyChecking=accept-new", NODO, comando],
            capture_output=True, text=True, timeout=secondi)
    except subprocess.TimeoutExpired:
        return f"L'operazione non ha risposto entro {secondi} secondi."
    if r.returncode == 255:
        return (f"Il nodo di rilascio ({NODO}) non risponde.\n"
                f"Se il problema persiste, guarda lo stato dei server nella console: {CONSOLE}/fleet")
    return (r.stdout + r.stderr).strip() or "(nessuna risposta)"


def invia_sorgenti() -> str:
    """Manda al nodo i file che Git conosce.

    ⚠️ L'elenco lo decide `git ls-files`, non `tar --exclude`: su macOS bsdtar
    applica le esclusioni anche ai suffissi, quindi `--exclude=data` esclude
    ANCHE `db/data` e gli script di allineamento dati sparirebbero in silenzio.
    """
    elenco = subprocess.run(["git", "-C", RADICE, "ls-files", "-co", "--exclude-standard"],
                            capture_output=True, text=True)
    tar = subprocess.Popen(["tar", "-C", RADICE, "-czf", "-", "-T", "-"],
                           stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    ssh = subprocess.Popen(["ssh", "-i", CHIAVE, "-o", "BatchMode=yes",
                            "-o", "ConnectTimeout=8", NODO, "sync"],
                           stdin=tar.stdout, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           text=True)
    tar.stdin.write(elenco.stdout.encode()); tar.stdin.close()
    try:
        out, _ = ssh.communicate(timeout=300)
    except subprocess.TimeoutExpired:
        ssh.kill()
        return "L'invio dei sorgenti non è terminato entro cinque minuti."
    return out.strip()


# ── Gli strumenti ───────────────────────────────────────────────────────────

STRUMENTI = [
    {
        "name": "stato_produzione",
        "description": (f"Come sta {PROGETTO} in produzione adesso: repliche attive e attese, "
                        "quale versione di ogni immagine è in esecuzione, stato del database "
                        "e ultimo backup."),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "stato_database",
        "description": ("Migrazioni DDL e script di allineamento dati: quali sono già applicati "
                        "in produzione e quali sono in attesa. Segnala anche gli script "
                        "incompleti o modificati dopo essere stati applicati. "
                        "Da usare PRIMA di proporre un rilascio."),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "log",
        "description": "Le ultime righe di log di un'applicazione in produzione.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "applicazione": {"type": "string",
                                 "description": "es. quicksmart, quicksmart, quicksmart-db"},
                "righe": {"type": "integer", "description": "quante righe (predefinito 100)"},
            },
            "required": ["applicazione"],
        },
    },
    {
        "name": "verifica_indirizzi",
        "description": "Prova gli indirizzi pubblici del progetto e riporta il codice HTTP.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "prepara_rilascio",
        "description": (
            "Prepara un rilascio SENZA eseguirlo: invia i sorgenti, costruisce e pubblica le "
            "immagini, e riepiloga cosa cambierebbe in produzione (immagini nuove, migrazioni "
            "in attesa, script dati in attesa). NON porta nulla in produzione — quel passo lo "
            "fa una persona con `./deploy/release.sh prod`."),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "scala",
        "description": ("Cambia il numero di repliche di un'applicazione. È reversibile e non "
                        "tocca i dati, quindi si può fare; portare a 0 ferma il servizio."),
        "inputSchema": {
            "type": "object",
            "properties": {
                "applicazione": {"type": "string"},
                "repliche": {"type": "integer", "description": "da 0 a 9"},
            },
            "required": ["applicazione", "repliche"],
        },
    },
]


def esegui(nome: str, arg: dict) -> str:
    if nome == "stato_produzione":
        return remoto("status")
    if nome == "stato_database":
        invia_sorgenti()
        return remoto("db-check")
    if nome == "log":
        app = shlex.quote(str(arg.get("applicazione", "")))
        n = int(arg.get("righe", 100))
        return remoto(f"logs {app} {min(max(n, 1), 2000)}", secondi=180)
    if nome == "verifica_indirizzi":
        return remoto("verifica")
    if nome == "scala":
        app = shlex.quote(str(arg.get("applicazione", "")))
        n = int(arg.get("repliche", 1))
        if not 0 <= n <= 9:
            return "Il numero di repliche deve stare fra 0 e 9."
        return remoto(f"scale {app} {n}", secondi=300)
    if nome == "prepara_rilascio":
        parti = ["## Sorgenti", invia_sorgenti(), "", "## Database", remoto("db-check")]
        rev = subprocess.run(["git", "-C", RADICE, "rev-parse", "--short", "HEAD"],
                             capture_output=True, text=True).stdout.strip()
        import datetime
        tag = datetime.datetime.now().strftime("%Y%m%d-%H%M") + "-" + rev
        parti += ["", "## Immagini", remoto(f"build {tag}", secondi=2400)]
        parti += ["", "## Quello che gira adesso", remoto("status")]
        parti += ["", "## Come si va in produzione", (
            "Le immagini sono pubblicate ma NON promosse. Il passaggio lo fa una persona:\n\n"
            "    ./deploy/release.sh prod\n\n"
            "Mostrerà l'indirizzo di chi rilascia (da Git) e chiederà conferma, applicherà le "
            "migrazioni e poi le immagini, e verificherà gli indirizzi pubblici.\n"
            f"Se qualcosa va storto: ./deploy/release.sh rollback\n"
            f"Console: {CONSOLE}")]
        return "\n".join(parti)
    return f"Strumento sconosciuto: {nome}"


# ── Protocollo MCP su stdio ─────────────────────────────────────────────────

def rispondi(id_, risultato=None, errore=None):
    m = {"jsonrpc": "2.0", "id": id_}
    if errore is not None:
        m["error"] = {"code": -32603, "message": errore}
    else:
        m["result"] = risultato
    sys.stdout.write(json.dumps(m) + "\n")
    sys.stdout.flush()


def main():
    for riga in sys.stdin:
        riga = riga.strip()
        if not riga:
            continue
        try:
            msg = json.loads(riga)
        except json.JSONDecodeError:
            continue
        metodo, id_ = msg.get("method"), msg.get("id")

        if metodo == "initialize":
            rispondi(id_, {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": f"piattaforma-{PROGETTO.lower()}", "version": "1.0.0"},
            })
        elif metodo == "tools/list":
            rispondi(id_, {"tools": STRUMENTI})
        elif metodo == "tools/call":
            p = msg.get("params", {})
            try:
                testo = esegui(p.get("name", ""), p.get("arguments") or {})
            except Exception as e:
                testo = f"Errore: {e}"
            rispondi(id_, {"content": [{"type": "text", "text": testo}]})
        elif metodo in ("notifications/initialized", "notifications/cancelled"):
            pass                      # notifiche: nessuna risposta attesa
        elif id_ is not None:
            rispondi(id_, errore=f"metodo non gestito: {metodo}")


if __name__ == "__main__":
    main()
