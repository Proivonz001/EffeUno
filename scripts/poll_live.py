"""Registra una sessione live SENZA abbonamento, a polling degli endpoint
statici livetiming (i file .jsonStream crescono durante la sessione).

Uso (da lanciare poco prima o durante la sessione):
    .venv/Scripts/python.exe scripts/poll_live.py --label spa_fp1

Aspetta che StreamingStatus dica Online, scopre il path della sessione
dall'indice di stagione e poi scarica gli incrementi di ogni topic con
richieste Range ogni --interval secondi, salvando in live_streams/poll_*/.
Ogni ciclo stampa quanto sono cresciuti i file: se crescono, il live
senza abbonamento e' confermato e questi file sono anche la registrazione
per sviluppare replayer e LiveSource.

Test a secco su una sessione GIA' conclusa (i file esistono ma non
crescono):  --path "2026/2026-07-05_British_Grand_Prix/2026-07-05_Race/" --cycles 2
"""

import argparse
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

BASE = "https://livetiming.formula1.com/static/"
TOPICS = [
    "SessionInfo.json", "DriverList.jsonStream", "SessionStatus.jsonStream",
    "TrackStatus.jsonStream", "TimingData.jsonStream",
    "TimingAppData.jsonStream", "Position.z.jsonStream",
    "CarData.z.jsonStream", "WeatherData.jsonStream",
    "RaceControlMessages.jsonStream", "LapCount.jsonStream",
    "TeamRadio.jsonStream",
]

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def get_json(url: str):
    import json
    r = requests.get(url, timeout=15)
    r.raise_for_status()
    return json.loads(r.content.decode("utf-8-sig"))


def streaming_online() -> bool:
    try:
        return get_json(BASE + "StreamingStatus.json").get("Status") == "Online"
    except Exception:
        return False


def discover_path() -> str | None:
    """Path della sessione corrente dall'indice di stagione: l'ultima
    sessione che espone un Path."""
    year = datetime.utcnow().year
    idx = get_json(f"{BASE}{year}/Index.json")
    best = None
    for meeting in idx.get("Meetings", []):
        for session in meeting.get("Sessions", []):
            if session.get("Path"):
                best = (meeting["Name"], session["Name"], session["Path"])
    if best:
        print(f"sessione: {best[0]} / {best[1]} -> {best[2]}")
        return best[2]
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--label", default="session")
    ap.add_argument("--interval", type=float, default=8.0)
    ap.add_argument("--path", default=None,
                    help="path sessione esplicito (salta l'attesa Online)")
    ap.add_argument("--cycles", type=int, default=0,
                    help="numero di cicli poi esci (0 = finche' Offline)")
    args = ap.parse_args()

    path = args.path
    if not path:
        print("aspetto che StreamingStatus dica Online (Ctrl+C per uscire)...")
        while not streaming_online():
            time.sleep(30)
            print(".", end="", flush=True)
        print("\nOnline!")
        path = discover_path()
        if not path:
            print("nessun path di sessione nell'indice: riprova tra un minuto")
            return 1

    out_dir = (Path(__file__).resolve().parents[1] / "live_streams"
               / f"poll_{datetime.now().strftime('%Y%m%d_%H%M')}_{args.label}")
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"salvo in {out_dir}")

    sizes: dict[str, int] = {t: 0 for t in TOPICS}
    offline_since: float | None = None
    cycle = 0
    while True:
        cycle += 1
        grew_total = 0
        for topic in TOPICS:
            url = BASE + path + topic
            have = sizes[topic]
            try:
                headers = {"Range": f"bytes={have}-"} if have else {}
                r = requests.get(url, headers=headers, timeout=20)
            except Exception as exc:
                print(f"  {topic}: {exc}")
                continue
            fp = out_dir / topic
            if r.status_code == 206:
                with open(fp, "ab") as f:
                    f.write(r.content)
                sizes[topic] += len(r.content)
                grew_total += len(r.content)
            elif r.status_code == 200:
                new = len(r.content)
                if new != have:
                    fp.write_bytes(r.content)
                    grew_total += max(0, new - have)
                    sizes[topic] = new
            elif r.status_code in (404, 416):
                pass  # topic non ancora pubblicato / nessun byte nuovo
            else:
                print(f"  {topic}: HTTP {r.status_code}")
        total = sum(sizes.values())
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ciclo {cycle}: "
              f"+{grew_total/1e3:.1f} KB (totale {total/1e6:.2f} MB)"
              + ("  <-- CRESCE: live senza abbonamento OK" if grew_total > 0 else ""))
        if args.cycles and cycle >= args.cycles:
            break
        if not args.path:
            if streaming_online():
                offline_since = None
            else:
                offline_since = offline_since or time.time()
                if time.time() - offline_since > 600:
                    print("Offline da 10 minuti: sessione finita.")
                    break
        time.sleep(args.interval)

    print("file salvati:")
    for t in TOPICS:
        if sizes[t]:
            print(f"  {t:28s} {sizes[t]/1e3:10.1f} KB")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\ninterrotto.")
        sys.exit(0)
