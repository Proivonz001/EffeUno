"""Ispeziona un file registrato da record_live.py: righe per topic,
finestra temporale, dimensioni. Serve a validare la registrazione dopo
la sessione, prima di costruirci sopra il replayer.

Uso:
    .venv/Scripts/python.exe scripts/inspect_stream.py live_streams/FILE.txt
"""

import ast
import json
import sys
from collections import Counter
from pathlib import Path


def parse_line(line: str):
    """Le righe salvate da fastf1 sono liste [topic, payload, timestamp],
    a volte JSON valido, a volte repr Python (apici singoli)."""
    line = line.strip()
    if not line:
        return None
    try:
        return json.loads(line)
    except ValueError:
        try:
            return ast.literal_eval(line)
        except (ValueError, SyntaxError):
            return None


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 1
    path = Path(sys.argv[1])
    topics: Counter[str] = Counter()
    bad = 0
    first_ts = last_ts = None
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            row = parse_line(line)
            if not isinstance(row, list) or len(row) < 3:
                bad += 1
                continue
            topics[str(row[0])] += 1
            first_ts = first_ts or row[2]
            last_ts = row[2]

    print(f"{path} — {path.stat().st_size / 1e6:.1f} MB")
    print(f"finestra: {first_ts}  ->  {last_ts}")
    print(f"righe non parsabili: {bad}")
    print("\nrighe per topic:")
    for topic, n in topics.most_common():
        print(f"  {topic:24s} {n:8d}")
    essential = {"Position.z", "TimingData", "TrackStatus", "DriverList"}
    missing = essential - set(topics)
    if missing:
        print(f"\nATTENZIONE: topic essenziali assenti: {sorted(missing)}")
    else:
        print("\nOK: tutti i topic essenziali presenti.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
