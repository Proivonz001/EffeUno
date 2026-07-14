"""Fase 0 — export dati per il test di animazione (brief §6, punto 3).

Esporta i primi minuti di gara (pos_data grezzo, tutti i piloti) in JSON
per la pagina di test scripts/fase0_anim/index.html.

Il JSON finisce in scripts/fase0_anim/data/ (gitignorato: i dati F1
non vanno mai committati).
"""

import json
from pathlib import Path

import fastf1

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "fastf1_cache"
OUT_DIR = ROOT / "scripts" / "fase0_anim" / "data"

YEAR, GP, SESSION = 2025, "Italian Grand Prix", "R"
WINDOW_S = 180  # secondi di gara da esportare


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))

    session = fastf1.get_session(YEAR, GP, SESSION)
    session.load()

    status = session.session_status
    t_start = status.loc[status["Status"] == "Started", "Time"].iloc[0]
    t0, t1 = t_start.total_seconds(), t_start.total_seconds() + WINDOW_S

    drivers = []
    for num in session.drivers:
        pos = session.pos_data[num]
        t = pos["SessionTime"].dt.total_seconds()
        window = pos[(t >= t0) & (t <= t1)]
        if window.empty:
            continue
        wt = window["SessionTime"].dt.total_seconds() - t0
        info = session.get_driver(num)
        drivers.append({
            "num": num,
            "abbr": info["Abbreviation"],
            # [t (s), x, y] grezzi, arrotondati per compattezza
            "points": [
                [round(ti, 3), round(xi, 1), round(yi, 1)]
                for ti, xi, yi in zip(wt, window["X"], window["Y"])
            ],
        })

    # Tracciato di sfondo dal giro piu' veloce
    tel = session.laps.pick_fastest().get_telemetry()
    track = [[round(x, 1), round(y, 1)] for x, y in zip(tel["X"], tel["Y"])]

    out = OUT_DIR / "replay.json"
    payload = {"event": f"{session.event['EventName']} {YEAR}",
               "window_s": WINDOW_S, "track": track, "drivers": drivers}
    out.write_text(json.dumps(payload, separators=(",", ":")))

    n_pts = sum(len(d["points"]) for d in drivers)
    print(f"[export] {len(drivers)} piloti, {n_pts} campioni totali, "
          f"{out.stat().st_size / 1024:.0f} KB -> {out}")
    hz = n_pts / len(drivers) / WINDOW_S
    print(f"[export] frequenza media pos_data grezza: {hz:.1f} Hz per pilota")


if __name__ == "__main__":
    main()
