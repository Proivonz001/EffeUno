"""Genera i file statici di una sessione per il sito pubblico e (opzionale)
li carica su R2.

Riusa gli stessi generatori del backend (FastF1Session): il sito statico
serve payload identici a quelli dell'API, piu' i pacchetti-telemetria per
pilota che rendono possibile il confronto giri senza backend.

Struttura prodotta (sotto --out, default site_data/):
    index.json                                  catalogo delle sessioni
    {year}/{event_slug}/{S}/replay.json
    {year}/{event_slug}/{S}/feed.json
    {year}/{event_slug}/{S}/laps.json
    {year}/{event_slug}/{S}/drivers/{ABBR}.json  tutti i giri del pilota

Uso:
    python scripts/publish_session.py 2026 "British Grand Prix" R
    python scripts/publish_session.py 2026 "British Grand Prix" R --r2

--r2 richiede R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
nell'ambiente (in locale: .secrets/r2.env).
"""

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BUCKET = "effeuno-data"


def slug(name: str) -> str:
    return name.lower().replace(" ", "-")


def write(path: Path, obj) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(obj, separators=(",", ":"))
    path.write_text(data, encoding="utf-8")
    return len(data)


def r2_client():
    import os

    import boto3
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto")


def _put_json(s3, key: str, body: bytes, max_age: int) -> int:
    """Carica compresso: i browser decomprimono da soli via Content-Encoding,
    e lo storico completo resta dentro i 10GB gratuiti di R2."""
    import gzip
    gz = gzip.compress(body, 6)
    s3.put_object(Bucket=BUCKET, Key=key, Body=gz,
                  ContentType="application/json",
                  ContentEncoding="gzip",
                  CacheControl=f"public, max-age={max_age}")
    return len(gz)


def upload_dir(base: Path, rel_prefix: str) -> None:
    s3 = r2_client()
    files = sorted(p for p in (base / rel_prefix).rglob("*.json"))
    total = 0
    for i, p in enumerate(files, 1):
        key = p.relative_to(base).as_posix()
        n = _put_json(s3, key, p.read_bytes(), 3600)
        total += n
        print(f"  [{i}/{len(files)}] {key} ({n/1e3:.0f} KB gz)")
    # l'indice va sempre ricaricato per ultimo
    idx = base / "index.json"
    if idx.exists():
        _put_json(s3, "index.json", idx.read_bytes(), 300)
        print(f"  index.json aggiornato — totale caricato {total/1e6:.1f} MB")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("year", type=int)
    ap.add_argument("event")
    ap.add_argument("session", choices=["R", "Q", "S", "SQ"])
    ap.add_argument("--out", default=str(ROOT / "site_data"))
    ap.add_argument("--r2", action="store_true", help="carica su R2 alla fine")
    ap.add_argument("--skip-telemetry", action="store_true",
                    help="salta i pacchetti pilota (molto piu' veloce)")
    args = ap.parse_args()

    from backend.app.sources.fastf1_source import FastF1Source

    print(f"carico {args.year} / {args.event} / {args.session}...")
    src = FastF1Source()
    sess = src.load_session(args.year, args.event, args.session)
    info = sess.info()

    base = Path(args.out)
    rel = f"{args.year}/{slug(args.event)}/{args.session}"
    out = base / rel

    n = write(out / "replay.json", sess.replay())
    print(f"replay.json ({n/1e6:.1f} MB)")
    write(out / "feed.json", sess.feed())
    laps = sess.laps()
    write(out / "laps.json", laps)
    print(f"feed.json + laps.json ({len(laps)} giri)")

    if not args.skip_telemetry:
        # pacchetti per pilota: tutti i giri con telemetria in un file
        by_driver: dict[str, list[int]] = {}
        for lap in laps:
            if lap["time_s"] is not None:
                by_driver.setdefault(lap["driver"], []).append(lap["lap"])
        for d_i, (abbr, lap_nos) in enumerate(sorted(by_driver.items()), 1):
            bundle = {}
            for ln in lap_nos:
                try:
                    bundle[str(ln)] = sess.lap_telemetry(abbr, ln)
                except Exception:
                    continue  # giro senza telemetria: resta fuori dal pacchetto
            n = write(out / "drivers" / f"{abbr}.json", bundle)
            print(f"  [{d_i}/{len(by_driver)}] drivers/{abbr}.json "
                  f"({len(bundle)} giri, {n/1e6:.1f} MB)")

    # catalogo: aggiungi/aggiorna la voce e riscrivi
    idx_path = base / "index.json"
    catalog = json.loads(idx_path.read_text()) if idx_path.exists() else {"sessions": []}
    try:
        event_date = str(sess._s.event["EventDate"].date())  # noqa: SLF001
    except Exception:
        event_date = None
    entry = {
        "year": args.year,
        "event": info.get("event", args.event),
        "session": args.session,
        "session_name": info.get("session", args.session),
        "path": rel,
        "drivers": len(info.get("drivers", [])),
        "date": event_date,
    }
    catalog["sessions"] = [s for s in catalog["sessions"] if s["path"] != rel]
    catalog["sessions"].append(entry)
    catalog["sessions"].sort(key=lambda s: (s["year"], s["path"]))
    write(idx_path, catalog)
    print(f"catalogo: {len(catalog['sessions'])} sessioni")

    if args.r2:
        print("upload su R2...")
        upload_dir(base, rel)
    return 0


if __name__ == "__main__":
    sys.exit(main())
