"""Fase 0 — esplorazione dati FastF1 (brief §6-§7).

Carica una sessione, misura tempi e dimensioni, e produce il primo
deliverable: tracciato da X/Y + speed/throttle/brake allineati per distanza.

Uso:
    python scripts/fase0_explore.py
"""

import sys
import time
from pathlib import Path

import fastf1
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = ROOT / "fastf1_cache"
OUTPUT_DIR = ROOT / "output"

YEAR, GP, SESSION = 2025, "Italian Grand Prix", "R"


def fmt_bytes(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def main() -> None:
    CACHE_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)
    fastf1.Cache.enable_cache(str(CACHE_DIR))

    # --- Tempo di session.load() ---
    t0 = time.perf_counter()
    session = fastf1.get_session(YEAR, GP, SESSION)
    session.load()
    load_s = time.perf_counter() - t0
    print(f"[load] {YEAR} {GP} {SESSION}: {load_s:.1f}s")

    cache_size = sum(f.stat().st_size for f in CACHE_DIR.rglob("*") if f.is_file())
    print(f"[cache] dimensione su disco: {fmt_bytes(cache_size)}")

    # --- Giro piu' veloce della gara ---
    lap = session.laps.pick_fastest()
    drv = lap["Driver"]
    print(f"[fastest] {drv}, giro {int(lap['LapNumber'])}, {lap['LapTime']}")

    tel = lap.get_telemetry()  # car_data + pos_data gia' mergiati
    tel = tel.add_distance()
    print(f"[telemetry] giro singolo: {len(tel)} righe x {len(tel.columns)} colonne")
    print(f"[telemetry] colonne: {list(tel.columns)}")
    dt = tel["Time"].diff().dt.total_seconds().dropna()
    print(f"[telemetry] freq campioni: mediana {1 / dt.median():.1f} Hz, "
          f"min {1 / dt.max():.1f} Hz, max {1 / dt.min():.1f} Hz")
    lap_mem = tel.memory_usage(deep=True).sum()
    print(f"[peso] telemetria 1 giro in RAM: {fmt_bytes(lap_mem)}")

    # --- Peso gara intera: 1 pilota e 20 piloti ---
    # car_data/pos_data sono indicizzati per numero pilota, non per sigla
    drv_num = lap["DriverNumber"]
    car = session.car_data[drv_num]
    pos = session.pos_data[drv_num]
    one_driver = car.memory_usage(deep=True).sum() + pos.memory_usage(deep=True).sum()
    print(f"[peso] gara intera, 1 pilota (car+pos): {fmt_bytes(one_driver)} "
          f"({len(car)} campioni car_data, {len(pos)} pos_data)")

    total = sum(
        session.car_data[d].memory_usage(deep=True).sum()
        + session.pos_data[d].memory_usage(deep=True).sum()
        for d in session.car_data
    )
    print(f"[peso] gara intera, {len(session.car_data)} piloti: {fmt_bytes(total)}")

    # --- Deliverable: tracciato + trace allineate per distanza ---
    fig = plt.figure(figsize=(12, 10))
    gs = fig.add_gridspec(4, 1, height_ratios=[3, 1, 1, 1], hspace=0.35)

    ax_map = fig.add_subplot(gs[0])
    ax_map.plot(tel["X"], tel["Y"], color="#e10600", linewidth=2)
    ax_map.set_aspect("equal")
    ax_map.axis("off")
    ax_map.set_title(
        f"{session.event['EventName']} {YEAR} — giro piu' veloce ({drv}, {lap['LapTime']})"
    )

    dist_km = tel["Distance"] / 1000
    for gs_row, channel, label, color in (
        (1, "Speed", "Speed (km/h)", "#1f77b4"),
        (2, "Throttle", "Throttle (%)", "#2ca02c"),
        (3, "Brake", "Brake (on/off)", "#d62728"),
    ):
        ax = fig.add_subplot(gs[gs_row])
        ax.plot(dist_km, tel[channel], color=color, linewidth=1)
        ax.set_ylabel(label, fontsize=9)
        ax.grid(alpha=0.3)
        if gs_row == 3:
            ax.set_xlabel("Distanza (km)")

    out = OUTPUT_DIR / "fase0_fastest_lap.png"
    fig.savefig(out, dpi=120, bbox_inches="tight")
    print(f"[plot] salvato in {out}")


if __name__ == "__main__":
    sys.exit(main())
