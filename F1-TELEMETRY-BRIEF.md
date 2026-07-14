# F1 Telemetry App — Project Brief

> Documento di handoff per Claude Code. Contiene contesto, vincoli e un percorso di partenza.
> Non è una specifica chiusa: la direzione dell'app è ancora da decidere, e la Fase 0 serve
> proprio a decidere con i dati in mano invece che a tavolino.

---

## 1. Contesto

Voglio costruire un'app basata sulla telemetria F1, ispirata agli strumenti che si vedono
nelle live YouTube durante le gare (mappa del circuito con i pallini dei piloti che si
muovono, trace di telemetria, confronto tra giri).

**Obiettivo:** progetto portfolio, open source su GitHub. Non commerciale.

**Stack scelto:** React (frontend) + Python (backend).

**Cosa NON è ancora deciso:** il taglio esatto dell'app. Tre candidati sul tavolo, da
valutare dopo aver esplorato i dati reali (vedi §5).

---

## 2. Fonte dati: FastF1

**FastF1** (Python, licenza MIT) — https://docs.fastf1.dev/

È la scelta di partenza. Motivi:

- Nessuna API key, nessun abbonamento, nessuna registrazione
- Wrapper sul feed ufficiale F1 con caching locale su disco
- Dati storici dal 2018 in poi
- Ha anche un client SignalR per registrare il live (`fastf1.livetiming`)
- È lo standard de facto per l'analisi dati F1, quindi tanto materiale di riferimento

**Alternativa considerata:** OpenF1 (REST/JSON, storico dal 2023 gratis, live a pagamento).
Utile come fallback o come confronto, non come base primaria.

**Alternativa scartata:** API locale di MultiViewer — richiede l'app aperta + abbonamento
F1 TV attivo. Dipendenza troppo fragile per un progetto standalone.

### Struttura dati (verificata su docs FastF1 3.8)

Due sorgenti principali, entrambe a **~4-5 Hz** (limite del feed F1, non della libreria):

**`car_data`**
| Canale | Tipo | Note |
|---|---|---|
| `Speed` | float | km/h |
| `RPM` | float | |
| `nGear` | int | numero marcia |
| `Throttle` | float | 0-100 (%) |
| `Brake` | bool | on/off, non progressivo |
| `DRS` | int | codificato, non booleano |

**`pos_data`**
| Canale | Tipo | Note |
|---|---|---|
| `X`, `Y`, `Z` | float | posizione in 1/10 di metro |
| `Status` | str | `OnTrack` / `OffTrack` |

**Canali comuni a entrambe:**
`Time` (timedelta, 0 = inizio slice), `SessionTime` (timedelta dall'inizio sessione),
`Date` (datetime assoluto), `Source` (flag su come è stato generato il campione).

**Punti di attenzione tecnici:**

- `car_data` e `pos_data` hanno timestamp **indipendenti** → vanno mergiati/interpolati.
  `lap.get_telemetry()` lo fa già e restituisce i due stream uniti e ricampionati.
- `get_telemetry()` non include i canali calcolati (es. `Distance`): vanno aggiunti con i
  metodi `add_*()` sull'oggetto Telemetry (`add_distance()`, `add_relative_distance()`, ecc.)
- 4-5 Hz è **basso**. La mappa animata fluida richiede interpolazione lato client — è un
  problema di rendering, non di dati. Da affrontare consapevolmente, non da nascondere.
- Il `Source` flag dice se un campione è originale o interpolato: utile per non mentire
  nelle visualizzazioni.
- Leggere `howto_accurate_calculations` nei docs prima di fare qualsiasi calcolo derivato.

---

## 3. Vincoli legali (importanti — leggere prima di scrivere codice)

Il dato appartiene a **Formula One Management**. Né FastF1 né OpenF1 hanno una licenza di
ridistribuzione. La linea pratica, per come la interpreto:

✅ **OK per questo progetto**
- Consumare il dato localmente per analisi e visualizzazione
- Pubblicare il **codice** su GitHub (FastF1 e decine di progetti simili lo fanno da anni)
- Cache locale dei dati sulla macchina di chi esegue l'app

❌ **Da evitare**
- Committare dataset F1 nel repo (il codice sì, i dati no)
- Deploy pubblico che serve il feed a terzi → di fatto è ridistribuzione
- Usare loghi, marchi F1/Formula 1/nomi team, o livree nella UI
- Qualsiasi monetizzazione senza licenza FOM

⚠️ **Da includere nel repo**
- Disclaimer nel README: progetto non ufficiale, non affiliato alle società Formula 1.
  "F1, FORMULA ONE, FORMULA 1, GRAND PRIX e marchi correlati sono marchi di Formula One
  Licensing B.V." — copiare l'approccio del disclaimer di FastF1, che è ben calibrato.
- Colori team: usare una palette propria/approssimata, non asset ufficiali.

**Implicazione architetturale:** progettare come **app locale** (l'utente la esegue, i dati
li scarica lui via FastF1) piuttosto che come servizio hostato. Questo risolve il problema
della ridistribuzione alla radice invece che aggirarlo, e per un portfolio va benissimo —
si dimostra con uno screenshot o un video.

---

## 4. Architettura proposta

```
┌─────────────────┐     HTTP/JSON      ┌──────────────────┐
│  React (Vite)   │ ←───────────────→  │  FastAPI         │
│                 │                     │                  │
│  - Track map    │                     │  - /sessions     │
│  - Telemetry    │                     │  - /laps         │
│    traces       │                     │  - /telemetry    │
│  - Lap compare  │                     │                  │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                                        ┌────────▼─────────┐
                                        │  FastF1          │
                                        │  + cache su disco│
                                        └──────────────────┘
```

**Backend — FastAPI**
- Wrappa FastF1, espone JSON pulito e già normalizzato al frontend
- Cache FastF1 abilitata da subito (`fastf1.Cache.enable_cache()`) — senza, ogni richiesta
  ricarica dalla rete ed è lentissimo
- Il primo caricamento di una sessione richiede decine di secondi: prevedere endpoint
  asincrono o warm-up, non far aspettare il browser in sincrono
- Downsampling/serializzazione: una gara intera × 20 piloti è tanta roba, non mandare
  tutto al client indiscriminatamente

**Frontend — React + Vite**
- Track map: SVG o Canvas. Le coordinate X/Y sono già un tracciato — plottarle è
  letteralmente un path. Canvas se si anima, SVG se è statico.
- Grafici telemetria: valutare Recharts (semplice) vs D3 (controllo pieno). Per trace
  sincronizzate multi-pilota probabilmente serve D3.
- Interpolazione tra i campioni a 4-5 Hz per l'animazione fluida

---

## 5. Le tre direzioni possibili

Da decidere **dopo** la Fase 0, non prima.

**A. Analisi post-gara** — dashboard di confronto giri, delta, strategie gomme.
Più semplice, meno "wow" visivo, ma è dove i dati sono più ricchi e affidabili.

**B. Replay animato** — ricostruzione della gara dalle coordinate X/Y, con i pallini che si
muovono. Stessa grafica del live ma con dati storici: nessun vincolo temporale, si sviluppa
e si testa in qualsiasi momento. **Probabilmente il miglior rapporto impatto/rischio per un
portfolio.**

**C. Live** — feed SignalR in tempo reale. Il più impressionante, ma testabile solo durante
i weekend di gara e con una superficie di complessità molto maggiore. Da tenere come
evoluzione, non come punto di partenza.

Nota: B è un sovrainsieme grafico di C. Costruire B significa avere già pronto il 70% di C,
con il feed live come sostituzione della sorgente dati a valle. Progettare B con questo in
mente (astrarre la sorgente dati dietro un'interfaccia) rende C un'aggiunta, non un rewrite.

---

## 6. Fase 0 — prima di decidere qualsiasi cosa

**Non partire dall'architettura. Parti dai dati.**

1. Setup ambiente Python, `pip install fastf1`, abilitare la cache
2. Caricare **una** sessione singola (suggerimento: una gara recente e nota, es. un GP con
   una bella lotta — Monza o Silverstone tendono a dare dati interessanti)
3. Ispezionare in un notebook/script:
   - Che aspetto ha davvero `lap.get_telemetry()`? Quante righe? Quali colonne?
   - Plottare X/Y di un giro con matplotlib → viene fuori il circuito? Quanto è pulito?
   - Quanto pesa la telemetria di un pilota per una gara intera? E di 20?
   - Quanto ci mette il primo `session.load()` a freddo? E con cache calda?
   - Quanto è brutta l'animazione a 4-5 Hz senza interpolazione?
4. **Poi** riaprire la scelta tra A / B / C con numeri veri in mano

Il punto 3 non è cerimoniale: le risposte a "quanto pesa" e "quanto è brutta" determinano
se B è un pomeriggio o due settimane, e quindi se ha senso.

---

## 7. Primo deliverable concreto

Uno script Python standalone che:
- carica una sessione
- estrae la telemetria di un giro veloce
- plotta il tracciato dalle coordinate X/Y
- plotta speed/throttle/brake sotto, allineati per distanza

Se questo funziona ed è leggibile, tutto il resto è costruibile. Se questo è già faticoso,
meglio saperlo prima di aver scritto un backend.

---

## 8. Riferimenti

- FastF1 docs — https://docs.fastf1.dev/
- FastF1 telemetry reference — https://docs.fastf1.dev/api_reference/telemetry.html
- FastF1 accurate calculations — https://docs.fastf1.dev/data_reference/howto_accurate_calculations.html
- FastF1 GitHub — https://github.com/theOehrly/Fast-F1
- OpenF1 (alternativa/fallback) — https://openf1.org/
- F1 Guidelines (uso marchi/contenuti) — https://www.formula1.com/en/information/guidelines.4EOKE9RRqevL4niTK9kWyt
- MultiViewer (riferimento UX, non fonte dati) — https://multiviewer.app/

---

## 9. Nota sulla parte legale

Non sono un avvocato e quanto sopra è un'interpretazione pratica basata su come si comporta
da anni l'ecosistema di progetti F1 open source, non un parere legale. Per un progetto
portfolio non commerciale il rischio è basso e ben precedentato. Se in futuro il progetto
dovesse prendere una piega commerciale, la questione della licenza FOM va risolta **prima**,
non dopo.
