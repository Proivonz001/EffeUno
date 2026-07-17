"""Da lanciare DURANTE una sessione in corso: verifica se i dati live sono
raggiungibili SENZA abbonamento F1TV.

Controlla due strade:
1. Endpoint statici livetiming (gli stessi del replay): durante la sessione
   i file .jsonStream crescono in near-real-time. Se rispondono 200 e
   crescono tra due letture, si puo' fare un live "quasi in diretta" a
   polling, senza SignalR e senza token.
2. SignalR con no_auth: 20 secondi di connessione senza token, conta i
   messaggi ricevuti.

Uso:  .venv/Scripts/python.exe scripts/probe_live_noauth.py
"""

import sys
import time

import requests

INDEX = "https://livetiming.formula1.com/static/StreamingStatus.json"

# le risposte hanno un BOM che la console Windows (cp1252) non digerisce
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def probe_static() -> None:
    print("== 1) endpoint statici ==")
    r = requests.get(INDEX, timeout=10)
    print(f"StreamingStatus.json: HTTP {r.status_code} -> {r.text.lstrip(chr(0xfeff))[:120]}")
    # l'indice della stagione elenca i meeting; durante un weekend il path
    # della sessione live e' deducibile dall'ultimo meeting
    year = time.strftime("%Y")
    idx = requests.get(
        f"https://livetiming.formula1.com/static/{year}/Index.json", timeout=10)
    print(f"{year}/Index.json: HTTP {idx.status_code}")
    if idx.status_code != 200:
        return
    import json as _json
    data = _json.loads(idx.content.decode("utf-8-sig"))
    meeting = data["Meetings"][-1]
    session = meeting["Sessions"][-1]
    path = session.get("Path")
    print(f"ultima sessione: {meeting['Name']} / {session['Name']} -> {path}")
    if not path:
        print("nessun Path (sessione non ancora iniziata?)")
        return
    url = f"https://livetiming.formula1.com/static/{path}Position.z.jsonStream"
    a = requests.get(url, timeout=15)
    print(f"Position.z.jsonStream: HTTP {a.status_code}, {len(a.content)} byte")
    if a.status_code != 200:
        return
    print("aspetto 20s e rileggo per vedere se cresce...")
    time.sleep(20)
    b = requests.get(url, timeout=15)
    grew = len(b.content) - len(a.content)
    print(f"seconda lettura: {len(b.content)} byte (delta {grew:+d})")
    print("=> POLLING FATTIBILE" if grew > 0 else
          "=> file fermo: sessione non in corso, o serve auth")


def probe_signalr() -> None:
    print("\n== 2) SignalR senza token ==")
    from pathlib import Path
    from tempfile import mkdtemp

    from fastf1.livetiming.client import SignalRClient
    out = Path(mkdtemp()) / "noauth_probe.txt"
    client = SignalRClient(str(out), timeout=20, no_auth=True)
    try:
        client.start()
    except Exception as exc:  # noqa: BLE001 - qualunque errore e' un esito utile
        print(f"connessione fallita: {exc}")
    n = sum(1 for _ in open(out)) if out.exists() else 0
    print(f"messaggi ricevuti in ~20s: {n}")
    print("=> NO-AUTH FUNZIONA" if n > 5 else "=> senza token non arriva nulla")


if __name__ == "__main__":
    probe_static()
    probe_signalr()
    sys.exit(0)
