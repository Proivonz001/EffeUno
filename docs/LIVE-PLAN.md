# Direzione C — piano per il live

Obiettivo: seguire una sessione in corso con la stessa UI del replay
(mappa, classifica, feed), con un ritardo di pochi secondi.

## Da dove arrivano i dati

Lo stesso servizio livetiming che FastF1 interroga a sessione finita ha un
canale push per il live: **SignalR "classico"** (ASP.NET) su
`https://livetiming.formula1.com/signalr`, hub `Streaming`. Ci si abbona ai
topic e il server spinge gli aggiornamenti. FastF1 include gia' un client
funzionante: `python -m fastf1.livetiming save out.txt` registra l'intero
stream di una sessione.

Topic principali (gli stessi nomi dei file statici gia' usati dal replay):

| Topic                 | Contenuto                                   | Uso da noi          |
|-----------------------|---------------------------------------------|---------------------|
| `SessionInfo`         | evento, tipo sessione                       | intestazione        |
| `DriverList`          | piloti, numeri, team                        | palette/tag         |
| `Position.z`          | X/Y/Z di tutte le auto (~3.8 Hz, batch ~1s) | mappa               |
| `CarData.z`           | velocita', RPM, gas, freno, DRS             | top speed, (delta)  |
| `TimingData`          | gap, intervalli, settori, giri              | classifica          |
| `TimingAppData`       | stint e mescole                             | gomme, strategie    |
| `TrackStatus`         | verde/gialla/SC/VSC/rossa                   | bandiera + tinta    |
| `WeatherData`         | aria/pista/vento/pioggia                    | chip meteo          |
| `RaceControlMessages` | direzione gara                              | feed                |
| `TeamRadio`           | clip audio                                  | feed                |
| `LapCount`            | giro corrente                               | classifica          |

I topic col suffisso `.z` sono base64 → zlib deflate → JSON.

## Architettura proposta

Tre pezzi, nell'ordine in cui svilupparli:

1. **Recorder / Replayer** — registrare una sessione vera con
   `fastf1.livetiming save`; scrivere un riproduttore che rilegge il file
   registrato alla velocita' reale (o accelerata) e lo consegna al parser
   come se fosse live. E' la chiave di tutto: permette di sviluppare e
   testare offline, senza aspettare il weekend di gara.
2. **`LiveSource(DataSource)`** — l'interfaccia astratta esiste gia' per
   questo. Stato in-memory che cresce: i parser dei topic aggiornano le
   stesse strutture del replay (points, laps, pits, tyres, feed, meteo).
   Un thread collettore consuma lo stream (vero o riprodotto).
3. **Trasporto verso il frontend** — SSE (`/api/live/stream`): messaggi
   incrementali (nuovi campioni posizione, eventi giro, status, radio).
   Il frontend appende agli array che gia' possiede: TrackMap e classifica
   sono gia' guidati da `time`, basta agganciare il clock al live edge con
   un buffer di ~5 s per il riordino dei pacchetti.

## Frontend

- Bottone **LIVE** accanto al selettore sessione quando c'e' una sessione
  in corso (o un replayer attivo).
- Clock agganciato al live edge; seek libero **all'indietro** (il replay del
  gia' visto e' gratis: gli array sono gia' in memoria), bloccato in avanti.
- Tutto il resto (mappa, classifica, feed, meteo) funziona invariato.

## Passi concreti

1. `scripts/record_live.py`: wrapper di `fastf1.livetiming save` + qualche
   metadato (sessione, t0).
2. Registrare la prossima sessione disponibile (bastano anche le prove
   libere per Position/CarData/Timing).
3. `backend/app/sources/livetiming_parse.py`: decoder dei topic (.z inclusi)
   con test sul file registrato.
4. `LiveSource` + endpoint SSE.
5. UI live (bottone, live edge, buffer).

## Rischi e vincoli

- Il protocollo non e' documentato ufficialmente (reverse engineering
  consolidato da anni in FastF1): puo' cambiare senza preavviso.
- Solo uso personale e locale, come da vincolo legale del brief: nessuna
  ridistribuzione del feed, nessun servizio hostato.
- La qualita' della posizione e' la stessa del replay (~3.8 Hz): la mappa
  live avra' la stessa fluidita' (interpolazione gia' in essere).
- Fuori sessione il canale e' muto: lo sviluppo quotidiano passa dal
  replayer del punto 1.
