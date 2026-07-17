"""Pubblica automaticamente le sessioni appena concluse.

Pensato per GitHub Actions (cron nei weekend): guarda il calendario,
trova le sessioni terminate da poco che non sono ancora a catalogo e le
pubblica su R2. Idempotente: se non c'e' nulla da fare esce subito.

Richiede R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY.
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from publish_session import fetch_remote_catalog, publish, slug  # noqa: E402

# durata tipica per stimare la fine sessione + margine perche' i dati
# statici si sblocchino e FastF1 riesca a processarli
DURATION_H = {"R": 3.0, "S": 1.5, "Q": 1.5, "SQ": 1.5}
NAME_TO_CODE = {
    "Race": "R", "Qualifying": "Q", "Sprint": "S",
    "Sprint Qualifying": "SQ", "Sprint Shootout": "SQ",
}
MARGIN_MIN = 25       # minuti dopo la fine stimata prima di provare
WINDOW_H = 14         # non guardare piu' indietro di cosi'


def main() -> int:
    import pandas as pd

    import fastf1
    fastf1.Cache.enable_cache(str(ROOT / "fastf1_cache"))

    now = pd.Timestamp.utcnow().tz_localize(None)
    year = now.year
    sched = fastf1.get_event_schedule(year, include_testing=False)
    catalog = fetch_remote_catalog() or {"sessions": []}
    known = {s["path"] for s in catalog["sessions"]}

    published = 0
    for _, ev in sched.iterrows():
        for k in range(1, 6):
            name = str(ev.get(f"Session{k}", ""))
            code = NAME_TO_CODE.get(name)
            start = ev.get(f"Session{k}DateUtc")
            if code is None or pd.isna(start):
                continue
            end_est = start + pd.Timedelta(hours=DURATION_H[code])
            ready_at = end_est + pd.Timedelta(minutes=MARGIN_MIN)
            if not (ready_at < now < end_est + pd.Timedelta(hours=WINDOW_H)):
                continue
            rel = f"{year}/{slug(ev['EventName'])}/{code}"
            if rel in known:
                continue
            print(f"sessione conclusa da pubblicare: {rel}")
            try:
                publish(year, ev["EventName"], code, ROOT / "site_data", to_r2=True)
                published += 1
            except Exception as exc:
                print(f"ERRORE {rel}: {type(exc).__name__}: {str(exc)[:140]}")
                return 1
    print(f"fatto: {published} sessioni pubblicate" if published
          else "nessuna sessione nuova da pubblicare")
    return 0


if __name__ == "__main__":
    sys.exit(main())
