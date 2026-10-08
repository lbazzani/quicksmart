# Far giocare più persone a QuickSmart

Scritto il 9/10/2026, la notte in cui sono entrati sfida del giorno, condivisione e
indicizzazione. È il piano per far arrivare giocatori, con i testi pronti da incollare,
e il modo per capire se funziona.

## Da dove si parte

| | |
|---|---|
| Partite giocate in tutto | 99, di cui **96 a luglio** (la famiglia, i test) |
| Ultima partita vera | 2 agosto 2026 («Alassio», 4 persone) |
| Dall'8/9 all'8/10 | solo partite di prova |
| Traffico | crawler (Google, Bing, OpenAI, Perplexity) e scanner; nessun giocatore |
| Indicizzazione | `robots.txt` e `sitemap.xml` rispondevano 404 |
| SofAI | dall'8/9 senza AI: nel container mancava il CLI (sistemato, ora passa da claude-runner) |

Il gioco funziona ed è piaciuto a chi l'ha provato. Il problema è che **nessuno sa che
esiste** e che una partita finita non lascia niente da mandare in chat.

## Cosa c'è adesso nel prodotto

Pensato tutto per il passaparola: chi gioca porta qualcun altro.

- **Sfida del giorno** (`/sfida`). Dieci domande, le stesse per tutti fino a mezzanotte.
  Il risultato si condivide come su Wordle, senza svelare le risposte:

  ```
  QuickSmart ⚡ Sfida #12
  🟩🟩🟥🟩🟩🟩⬜🟩🟩🟩
  8/10 · 2436 punti
  Mi batti?
  https://quicksmart.it/sfida?ref=sfida
  ```

  È il gancio per chi non è nella stessa stanza, e un motivo per tornare domani.
- **Condividi** sul podio: la striscia in solitaria, i primi tre con le medaglie in squadra.
- **Invita** nella lobby: un link che porta dritto alla pagina per entrare, invece del solo
  codice a voce.
- **Come si gioca** (`/come-si-gioca`), una pagina leggibile dai motori di ricerca, con
  domande frequenti marcate per Google. In più `robots.txt` e `sitemap.xml`.
- **Provenienza**: ogni partita registra da quale link è arrivata chi l'ha creata (`?ref=`).
  Si contano con le query in fondo.

## Il messaggio

> **Il quiz di logica da fare insieme dal telefono. Niente app, niente registrazione.**

Tre cose lo distinguono, e vanno dette sempre:

1. **Si gioca subito**: un link, un nome, via. Nessun download.
2. **Non serve sapere, serve ragionare**: figure, sequenze, bilance. Una bambina attenta
   batte un adulto distratto, e in famiglia è questo che fa ridere.
3. **SofAI**, la mascotte che prende in giro tutti. È la parte che si racconta.

## A chi, e dove

In ordine di costo e di resa attesa. Le prime due righe non costano niente e valgono più
di tutto il resto messo insieme.

| # | Chi | Dove | Perché funziona |
|---|---|---|---|
| 1 | Famiglia, amici, colleghi | le chat WhatsApp che hai già | il primo cerchio gioca davvero, e il risultato condiviso porta il secondo |
| 2 | Insegnanti di primaria e secondaria di primo grado | gruppi Facebook di docenti (didattica della matematica, coding, logica), colleghi e conoscenti che insegnano | si gioca sulla LIM con la classe che entra col codice: dieci minuti di logica a fine lezione |
| 3 | La tua rete professionale | un post su LinkedIn | storia vera (un gioco nato in famiglia) e contenuto tecnico (generatori procedurali, AI che non vede i nomi) |
| 4 | Animatori, oratori, scout, centri estivi | gruppi e pagine locali | gruppi numerosi, cercano attività che non richiedano materiale |
| 5 | Chi cerca su Google | `/come-si-gioca`, la sfida del giorno | arriva da solo: Search Console accelera |
| 6 | Pubblico internazionale | r/WebGames su Reddit, itch.io | l'interfaccia è anche in inglese; serve a vedere se regge fuori dall'Italia |

**Le date da non mancare**: Halloween (31/10), poi **le feste di dicembre**, quando le
famiglie sono tutte insieme e cercano qualcosa da fare dopo cena. Ciò che esce a metà
ottobre ha il tempo di farsi indicizzare per Natale.

## Testi pronti

Scritti in italiano neutro come il gioco (niente «sei bravo/brava»). Il link porta sempre
un `ref` diverso, così si vede quale canale funziona.

### WhatsApp: famiglia e amici

> Ho fatto un gioco 😄 Si chiama QuickSmart: quiz di logica con le figure, si gioca dal
> telefono senza scaricare niente. Ogni giorno c'è una sfida di 10 domande, uguale per
> tutti. Io ho fatto ___ punti: chi mi batte?
> https://quicksmart.it/sfida?ref=wa-famiglia

### WhatsApp: per una serata insieme

> Stasera dopo cena: QuickSmart! Uno crea la partita, gli altri entrano col codice dal
> telefono. Vince chi ragiona più in fretta, e la mascotte prende in giro tutti.
> https://quicksmart.it/?ref=wa-serata

### Gruppo di insegnanti (Facebook)

Prima di pubblicare, leggere il regolamento del gruppo e, se serve, chiedere a chi lo
amministra.

> **Dieci minuti di logica con la LIM, senza registrazioni**
>
> Ho realizzato QuickSmart, un quiz di logica visiva gratuito: sequenze, simmetrie,
> bilance, orologi, dadi, bandiere. Si apre dal browser: l'insegnante crea la partita
> sulla LIM, la classe entra con un codice di 5 lettere (o inquadrando il QR) da tablet
> o telefono, fino a 24 dispositivi. Le domande partono facili e salgono piano; alla fine
> c'è il podio con precisione e velocità di ognuno.
>
> Non servono account e non c'è pubblicità: per giocare basta un soprannome (meglio non
> usare il nome vero). C'è anche una «sfida del giorno» da fare a casa.
>
> Se lo provate in classe mi piacerebbe sapere com'è andata: è nato per giocare in
> famiglia e sto cercando di capire se funziona anche a scuola.
> https://quicksmart.it/come-si-gioca?ref=fb-docenti

⚠️ Prima di proporlo alle scuole serve una pagina privacy, che oggi su quicksmart.it non
c'è. I soprannomi restano nel database con le partite (tabella `players`), senza
scadenza: va detto, oppure va deciso di cancellarli dopo qualche giorno.

### LinkedIn

> Quest'estate ho scritto un gioco per la mia famiglia: QuickSmart, un quiz di logica in
> tempo reale da giocare insieme dal telefono.
>
> Le domande non stanno in un archivio: le generano dei programmi, decine di milioni di
> combinazioni, e le risposte sbagliate sono costruite per sembrare giuste. La mascotte,
> SofAI, commenta la partita con battute scritte da Claude, ma i nomi di chi gioca non
> arrivano mai al modello: nel prompt diventano «Giocatore1», e tornano veri solo dopo.
>
> Da oggi c'è la sfida del giorno: dieci domande uguali per tutti, si gioca una volta e si
> confronta il risultato. Io ho fatto ___. Fatemi vedere 😄
> https://quicksmart.it/sfida?ref=linkedin

### Reddit r/WebGames (in inglese)

Leggere prima le regole del subreddit sull'autopromozione.

> **QuickSmart: a real-time visual logic quiz you play together from your phones (no
> app, no signup)**
>
> I built this for my family: one person creates a game, everyone joins with a 5-letter
> code, and whoever buzzes in first gets to answer. Questions are procedurally generated
> (sequences, symmetries, balances, clocks, dice) with deliberately tricky wrong answers.
> There's also a daily challenge with the same 10 questions for everyone and a
> Wordle-style result you can share. The mascot's jokes are in Italian, the rest is in
> English.
> https://quicksmart.it/sfida?ref=reddit

### Video breve (Instagram, TikTok, Shorts): 20-30 secondi

1. (0-3 s) Primo piano del telefono, testo: «Quiz di logica in famiglia. Chi vince?»
2. (3-12 s) Una domanda vera: la figura, il pulsante PRENOTATI, qualcuno che preme.
3. (12-18 s) La risposta giusta con i coriandoli, e la battuta di SofAI sul podio.
4. (18-25 s) La striscia 🟩🟩🟥 della sfida del giorno. Testo: «Ogni giorno 10 domande
   uguali per tutti. Quicksmart.it, niente app.»

Si registra con la registrazione schermo del telefono durante una partita vera: le
reazioni di chi gioca valgono più di qualunque montaggio.

## Cose da fare che richiedono i tuoi account

| Cosa | Dove | Tempo |
|---|---|---|
| Aggiungere il sito e inviare `https://quicksmart.it/sitemap.xml` | Google Search Console (verifica via DNS: record TXT su GoDaddy, lo posso mettere io) | 10 min |
| Lo stesso | Bing Webmaster Tools (importa da Search Console) | 5 min |
| I messaggi WhatsApp e il post LinkedIn | i tuoi | 10 min |
| Una pagina privacy | da scrivere prima di parlare alle scuole | da decidere |

## Come capire se funziona

Ogni partita creata da un link porta il canale in `games.settings->>'ref'`, e la sfida del
giorno il suo numero in `settings->>'daily'`. Dalla console (database `quicksmart`, sola
lettura):

```sql
-- partite per giorno nelle ultime due settimane, sfida e no
select date(created_at at time zone 'Europe/Rome') as giorno,
       count(*) filter (where settings ? 'daily') as sfide,
       count(*) filter (where not settings ? 'daily') as altre,
       count(*) filter (where settings->>'ref' is not null) as da_un_link
from games
where created_at > now() - interval '14 days'
group by 1 order by 1;

-- da quale canale arrivano (ref = il parametro dei link qui sopra)
select coalesce(settings->>'ref', '(diretto)') as canale, count(*) as partite,
       min(created_at)::date as dal, max(created_at)::date as al
from games
where created_at > now() - interval '30 days'
group by 1 order by 2 desc;

-- quante persone giocano la sfida, giorno per giorno
select (settings->>'daily')::int as sfida, count(*) as partite
from games where settings ? 'daily'
group by 1 order by 1 desc limit 14;
```

La partita di collaudo del 9/10 ha `ref = 'collaudo'`: va esclusa dai conti.

**Un obiettivo per la fine di ottobre**, per capire se la direzione è giusta: **20 sfide
del giorno a settimana** giocate da persone diverse da te, e almeno un canale oltre le
chat di famiglia che porti partite. Se dopo due settimane le partite arrivano solo da
`wa-famiglia`, il gioco piace ma non si diffonde, e serve lavorare sul prodotto (sotto)
più che sui canali.

## Cosa non ho fatto, e perché

- **Non ho pubblicato niente da nessuna parte.** Non ho account sui social, e un post a
  tuo nome lo decidi tu. I testi qui sopra sono pronti da incollare.
- **Non ho registrato il sito su Search Console**: serve il tuo account Google. Il record
  di verifica su GoDaddy lo posso aggiungere io.
- **Nessuna pubblicità a pagamento**: prima conviene vedere cosa fa il passaparola, che è
  gratis. Se poi si vuole provare, una campagna Meta da 5 €/giorno per due settimane
  verso genitori in Italia è il test più piccolo che dice qualcosa.

## Le prossime idee per il prodotto

In ordine di quanto aiutano il passaparola rispetto a quanto costano.

1. **Anteprima del risultato nel link**: l'immagine di WhatsApp che mostra «8/10 · Sfida
   #12» invece del logo. Il link condiviso diventa la pubblicità.
2. **Giorni di fila**: «5 sfide di fila 🔥» sulla striscia condivisa. È ciò che riporta le
   persone ogni giorno.
3. **Sfida un amico sulle stesse domande**: un link con il seme della propria partita, e
   chi lo apre gioca le stesse dieci.
4. **Pagina per la scuola** (`/scuola`): istruzioni per la LIM, partita con nomi a numero
   per non usare i nomi dei ragazzi, domande per età.
5. **Pacchetto di Natale**: domande a tema per dicembre e una sfida speciale il 24 e il 31.
