"""Backfill dello storico: pubblica in sequenza tutte le sessioni dei
campionati indicati, saltando quelle gia' a catalogo. Pensato per girare
per giorni sulla VM (nohup/tmux), riprendibile in qualunque momento.

Uso (sulla VM, con le variabili R2 nell'ambiente):
    python scripts/backfill.py --from-year 2026 --to-year 2018

Ordine: dall'anno piu' recente al piu' vecchio (il sito si riempie prima
con le stagioni che interessano di piu'), eventi in ordine cronologico.
Dopo ogni evento la cache FastF1 viene svuotata se supera --cache-gb
(85MB a sessione: lo storico intero non ci sta sul disco della VM).
"""

import argparse
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts"))

from backend.app.sources.fastf1_source import DataUnavailable  # noqa: E402
from publish_session import DATA_VERSION, fetch_remote_catalog, publish  # noqa: E402

CACHE_DIR = ROOT / "fastf1_cache"


def cache_size_gb() -> float:
    return sum(f.stat().st_size for f in CACHE_DIR.rglob("*") if f.is_file()) / 1e9


def prune_cache(limit_gb: float) -> None:
    if CACHE_DIR.exists() and cache_size_gb() > limit_gb:
        print(f"cache oltre {limit_gb} GB: svuoto")
        for child in CACHE_DIR.iterdir():
            shutil.rmtree(child, ignore_errors=True)


def sessions_for(event_format: str) -> list[str]:
    if "sprint" in event_format:
        return ["R", "Q", "S", "SQ"]
    return ["R", "Q"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--from-year", type=int, default=2026)
    ap.add_argument("--to-year", type=int, default=2018)
    ap.add_argument("--out", default=str(ROOT / "site_data"))
    ap.add_argument("--cache-gb", type=float, default=15.0)
    ap.add_argument("--no-r2", action="store_true", help="solo file locali")
    ap.add_argument("--pause", type=float, default=20.0,
                    help="secondi di pausa tra sessioni (gentilezza verso il feed)")
    ap.add_argument("--rebuild", action="store_true",
                    help="ripubblica le sessioni con formato dati vecchio "
                         f"(versione < {DATA_VERSION}); riprendibile: le voci "
                         "gia' rigenerate vengono saltate")
    args = ap.parse_args()

    import pandas as pd

    import fastf1
    CACHE_DIR.mkdir(exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))

    to_r2 = not args.no_r2
    done = failed = skipped = unavailable = 0
    for year in range(args.from_year, args.to_year - 1, -1):
        try:
            sched = fastf1.get_event_schedule(year, include_testing=False)
        except Exception as exc:
            print(f"{year}: calendario non disponibile ({exc})")
            continue
        for _, ev in sched.iterrows():
            ev_date = ev["EventDate"]
            if pd.notna(ev_date) and ev_date > pd.Timestamp.utcnow().tz_localize(None):
                continue  # weekend futuro
            for code in sessions_for(str(ev["EventFormat"])):
                catalog = fetch_remote_catalog() or {"sessions": []}
                # con --rebuild "gia' fatta" = gia' al formato corrente
                known = {s["path"] for s in catalog["sessions"]
                         if not args.rebuild
                         or s.get("v", 1) >= DATA_VERSION}
                rel = f"{year}/{ev['EventName'].lower().replace(' ', '-')}/{code}"
                if rel in known:
                    skipped += 1
                    continue
                try:
                    t0 = time.time()
                    publish(year, ev["EventName"], code, Path(args.out), to_r2=to_r2)
                    done += 1
                    print(f"== OK {rel} in {time.time()-t0:.0f}s "
                          f"(fatte {done}, saltate {skipped}, errori {failed})")
                except KeyboardInterrupt:
                    raise
                except DataUnavailable as exc:
                    # non e' un errore nostro e non ha senso riprovarci:
                    # quella sessione non esiste nell'archivio F1
                    unavailable += 1
                    print(f"== NON DISPONIBILE {rel}: {exc}")
                except Exception as exc:
                    failed += 1
                    print(f"== ERRORE {rel}: {type(exc).__name__}: {str(exc)[:140]}")
                time.sleep(args.pause)
            prune_cache(args.cache_gb)
    print(f"backfill completo: {done} pubblicate, {skipped} saltate, "
          f"{unavailable} non disponibili a monte, {failed} errori")
    return 0


if __name__ == "__main__":
    sys.exit(main())
