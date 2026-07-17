"""Genera una gara SINTETICA per la demo pubblica (GitHub Pages).

Nessun dato F1: circuito inventato, piloti e squadre di fantasia,
telemetria prodotta da un modello fisico semplificato (velocita' dal
raggio di curva, frenate/accelerazioni limitate, degrado gomma, effetto
carburante, pit stop, una Safety Car, due ritiri). L'output riempie
frontend/public/demo/ con gli stessi JSON che servirebbe il backend,
piu' l'immagine hero per il README.

Uso:  .venv/Scripts/python.exe scripts/gen_demo_data.py
"""

import json
import math
from pathlib import Path

import numpy as np

rng = np.random.default_rng(42)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "public" / "demo"
IMG = ROOT / "docs" / "img"

# --- squadre e piloti di fantasia (colori = palette custom dell'app) ---
TEAMS = [
    ("Aurora", "#3671c6"), ("Boreale", "#ff8000"), ("Cinabro", "#e8002d"),
    ("Duna", "#27f4d2"), ("Elettra", "#229971"), ("Fenice", "#ff87bc"),
    ("Grifone", "#64c4ff"), ("Idra", "#6692ff"), ("Lanterna", "#52e252"),
    ("Meridiana", "#b6babd"),
]
DRIVERS = [
    ("Dario Valli", "VAL"), ("Nico Fabbri", "FAB"),
    ("Luca Moretti", "MOR"), ("Elia Santoro", "SAN"),
    ("Marco Rinaldi", "RIN"), ("Tommaso Greco", "GRE"),
    ("Pietro Colombo", "COL"), ("Andrea Ferri", "FER"),
    ("Stefano Riva", "RIV"), ("Matteo Barone", "BAR"),
    ("Paolo Gatti", "GAT"), ("Simone Leone", "LEO"),
    ("Franco Villa", "VIL"), ("Aldo Serra", "SER"),
    ("Bruno Costa", "COS"), ("Ivan Monti", "MON"),
    ("Carlo Pagano", "PAG"), ("Enzo Vitale", "VIT"),
    ("Guido Fontana", "FON"), ("Remo Basile", "BAS"),
]
N_LAPS = 42
SC_LAPS = (24, 26)          # safety car, estremi inclusi
RETIRE = {16: 13, 19: 33}   # indice pilota -> ultimo giro completato


# --- circuito: curva chiusa armonica con due tratti raddrizzati ---------
def build_track() -> tuple[np.ndarray, np.ndarray]:
    theta = np.linspace(0, 2 * math.pi, 2400, endpoint=False)
    r = (560 + 195 * np.sin(2 * theta + 1.1) + 140 * np.sin(3 * theta + 0.4)
         + 95 * np.sin(5 * theta + 2.2) + 45 * np.sin(7 * theta + 0.9))
    x = r * np.cos(theta)
    y = r * np.sin(theta)
    # raddrizza due archi: rettilineo principale e back straight
    for a, b in ((0.00, 0.09), (0.46, 0.56)):
        i0, i1 = int(a * len(theta)), int(b * len(theta))
        x[i0:i1] = np.linspace(x[i0], x[i1], i1 - i0)
        y[i0:i1] = np.linspace(y[i0], y[i1], i1 - i0)
    # ricampiona a passo costante (~6 m)
    dx = np.diff(np.r_[x, x[0]])
    dy = np.diff(np.r_[y, y[0]])
    ds = np.hypot(dx, dy)
    s = np.r_[0, np.cumsum(ds)][:-1]
    total = s[-1] + ds[-1]
    grid = np.arange(0, total, 6.0)
    xs = np.interp(grid, np.r_[s, total], np.r_[x, x[0]])
    ys = np.interp(grid, np.r_[s, total], np.r_[y, y[0]])
    return np.c_[xs, ys], grid


def speed_profile(track: np.ndarray, s: np.ndarray) -> np.ndarray:
    """v(s) dal raggio di curva, con limiti di frenata/accelerazione."""
    p_prev = np.roll(track, 1, axis=0)
    p_next = np.roll(track, -1, axis=0)
    a = np.hypot(*(p_next - track).T)
    b = np.hypot(*(track - p_prev).T)
    c = np.hypot(*(p_next - p_prev).T)
    cross = ((p_next[:, 0] - track[:, 0]) * (track[:, 1] - p_prev[:, 1])
             - (p_next[:, 1] - track[:, 1]) * (track[:, 0] - p_prev[:, 0]))
    kappa = np.abs(2 * cross / np.maximum(a * b * c, 1e-9))
    kappa = np.convolve(np.r_[kappa[-10:], kappa, kappa[:10]],
                        np.ones(21) / 21, mode="same")[10:-10]
    v = np.minimum(86.0, np.sqrt(15.0 / np.maximum(kappa, 1e-6)))
    ds = np.diff(np.r_[s, s[-1] + 6.0])
    for _ in range(3):  # frenata (indietro) e trazione (avanti), con wrap
        for i in range(len(v) - 1, -1, -1):
            nxt = (i + 1) % len(v)
            v[i] = min(v[i], math.sqrt(v[nxt] ** 2 + 2 * 42.0 * ds[i]))
        for i in range(len(v)):
            nxt = (i + 1) % len(v)
            acc = min(10.0, 1100.0 / max(v[i], 20))
            v[nxt] = min(v[nxt], math.sqrt(v[i] ** 2 + 2 * acc * ds[i]))
    return v


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    IMG.mkdir(parents=True, exist_ok=True)

    track, s = build_track()
    v = speed_profile(track, s)
    ds = np.diff(np.r_[s, s[-1] + 6.0])
    t_ref = np.r_[0, np.cumsum(ds / v)][:-1]
    T0 = float(t_ref[-1] + ds[-1] / v[-1])
    total_len = float(s[-1] + 6.0)
    print(f"circuito: {total_len:.0f} m — giro di riferimento {T0:.1f}s")

    def pos_at_fraction(u: float) -> tuple[float, float]:
        tt = (u % 1.0) * T0
        i = int(np.searchsorted(t_ref, tt)) % len(track)
        return float(track[i, 0]), float(track[i, 1])

    # pit lane: corda interna sul rettilineo principale
    centroid = track.mean(axis=0)
    i_in = int(0.965 * len(track))
    i_out = int(0.035 * len(track))
    pl = []
    for k in range(31):
        w = k / 30
        base = track[i_in] * (1 - w) + track[i_out] * w
        pull = 18 * math.sin(math.pi * w)
        d = centroid - base
        d /= np.hypot(*d)
        pl.append(base + d * pull)
    pit_lane = [[round(p[0] * 10, 1), round(p[1] * 10, 1)] for p in pl]

    # zone DRS = i due tratti raddrizzati; detection ~150 m prima
    def seg(a: float, b: float) -> list[list[float]]:
        i0, i1 = int(a * len(track)), int(b * len(track))
        return [[round(px * 10, 1), round(py * 10, 1)] for px, py in track[i0:i1]]
    drs_zones = [seg(0.005, 0.085), seg(0.465, 0.555)]
    det_pts = []
    for f in (0.965, 0.435):
        px, py = track[int(f * len(track))]
        det_pts.append([round(px * 10, 1), round(py * 10, 1)])
    marks = []
    for third in (1 / 3, 2 / 3):
        px, py = pos_at_fraction(third)
        marks.append([round(px * 10, 1), round(py * 10, 1)])

    # --- simulazione gara -------------------------------------------------
    drivers_out = []
    laps_json = []
    ends = {}
    for i, (name, abbr) in enumerate(DRIVERS):
        team, _color = TEAMS[i // 2]
        num = str(2 + i * 4 + (i % 3))
        f_driver = 1.0 + 0.0032 * (i // 2) / 9 + float(rng.normal(0, 0.0008))
        pit_lap = int(rng.integers(15, 27))
        two_stop = i % 7 == 3
        pit_laps = {pit_lap} if not two_stop else {12, 28}
        last_lap = RETIRE.get(i, N_LAPS)

        lap_rows, sec_rows, tyre_rows, pits = [], [], [], []
        t = i * 0.45  # sfalsamento di griglia
        stint, comp, age = 0, "M", 0
        comps = ["M", "H"] if not two_stop else ["M", "H", "S"]
        best = (None, None)
        for n in range(1, last_lap + 1):
            age += 1
            deg = {"S": 0.0009, "M": 0.00048, "H": 0.00028}[comp]
            fuel = 1 + 0.030 * (1 - n / N_LAPS)
            fl = f_driver * fuel * (1 + deg * age) * (1 + float(rng.normal(0, 0.0016)))
            if SC_LAPS[0] <= n <= SC_LAPS[1]:
                fl *= 1.38
            if n == 1:
                fl *= 1.06  # partenza
            dur = T0 * fl
            if n in pit_laps:
                dur += 24 + float(rng.normal(0, 1.2))
            start, end = t, t + dur
            lap_rows.append([n, round(start, 3), round(end, 3)])
            th = np.array([0.33, 0.345, 0.325]) * dur
            th += rng.normal(0, 0.05, 3)
            sec_rows.append([n, round(th[0], 3), round(th[1], 3), round(th[2], 3)])
            fresh = age == 1 if comp != "S" else age == 1
            tyre_rows.append([n, comp, age, bool(stint == 0 or fresh or comp != "S")])
            if n not in pit_laps and (best[0] is None or dur < best[1]):
                if not (SC_LAPS[0] <= n <= SC_LAPS[1]) and n > 1:
                    best = (n, dur)
            if n in pit_laps:
                pits.append([round(end - 13, 1), round(end + 11, 1)])
                stint += 1
                comp = comps[min(stint, len(comps) - 1)]
                age = 3 if comp == "S" else 0  # la soft finale e' un treno usato
            t = end
        ends[abbr] = t

        # campioni posizione ogni 0.5 s
        points = []
        t_end = lap_rows[-1][2]
        for tt in np.arange(0, t_end, 0.5):
            n_idx = next((k for k, lr in enumerate(lap_rows)
                          if lr[1] <= tt <= lr[2]), None)
            if n_idx is None:
                continue
            lr = lap_rows[n_idx]
            in_pit = next((pw for pw in pits if pw[0] <= tt <= pw[1]), None)
            if in_pit:
                w = (tt - in_pit[0]) / (in_pit[1] - in_pit[0])
                p = pl[min(int(w * 30), 30)]
                px, py = float(p[0]), float(p[1])
            else:
                u = (tt - lr[1]) / (lr[2] - lr[1])
                px, py = pos_at_fraction(u)
            points.append([round(float(tt), 2), round(px * 10, 1), round(py * 10, 1)])

        drivers_out.append({
            "num": num, "abbr": abbr, "team": team,
            "top_speed": round(88 * 3.6 * (1 - (f_driver - 1) * 3) + float(rng.normal(0, 1.5))),
            "points": points, "pits": pits, "laps": lap_rows,
            "tyres": tyre_rows, "sectors": sec_rows,
            "tl": [], "penalties": [],
        })
        if best[0] is not None:
            laps_json.append({
                "driver": abbr, "num": num, "lap": best[0],
                "time_s": round(best[1], 3),
                "compound": "MEDIUM" if best[0] < 20 else "HARD",
                "accurate": True,
            })

        # telemetria del giro migliore
        scale = best[1] / T0 if best[0] else 1.0
        vv = v / scale
        tel = {
            "driver": abbr, "lap": best[0] or 2,
            "time": [round(float(x) * scale, 3) for x in t_ref[::4]],
            "distance": [round(float(x), 1) for x in s[::4]],
            "speed": [round(float(x) * 3.6, 1) for x in vv[::4]],
            "throttle": [round(min(100.0, max(0.0, 110 - 32.0 / max(float(k), 1e-6) / 40)), 1)
                         for k in (32.0 / np.maximum(vv, 1) ** 2)[::4]],
            "brake": [bool(b) for b in (np.gradient(vv) < -0.35)[::4]],
            "gear": [int(np.clip(np.searchsorted([25, 38, 50, 62, 74, 84], x) + 2, 2, 8))
                     for x in vv[::4]],
            "x": [round(float(px) * 10, 1) for px in track[::4, 0]],
            "y": [round(float(py) * 10, 1) for py in track[::4, 1]],
        }
        with open(OUT / f"tel_{abbr}_{tel['lap']}.json", "w") as f:
            json.dump(tel, f, separators=(",", ":"))

    # penalita' e track limits a due piloti di meta' gruppo
    tl_driver = drivers_out[9]
    tl_times = [round(tl_driver["laps"][20][2], 1), round(tl_driver["laps"][30][2], 1)]
    tl_driver["tl"] = tl_times
    pen_driver = drivers_out[12]
    pen_t = round(pen_driver["laps"][25][2], 1)
    pen_driver["penalties"] = [[pen_t, "+5s"]]

    # stato pista: verde, gialla locale al ritiro, SC, verde, scacchi
    ret_abbr = DRIVERS[16][1]
    ret_rows = next(d for d in drivers_out if d["abbr"] == ret_abbr)
    t_inc = ret_rows["laps"][-1][2]
    frac = 0.62
    sec_inc = int(frac * 11) + 1
    leader_laps = drivers_out[0]["laps"]
    t_sc = leader_laps[SC_LAPS[0] - 1][1]
    t_sc_end = leader_laps[SC_LAPS[1] - 1][2]
    duration = max(d["laps"][-1][2] for d in drivers_out)
    track_status = [[0.0, 1], [round(t_inc, 1), 2], [round(t_inc + 45, 1), 1],
                    [round(t_sc, 1), 4], [round(t_sc_end, 1), 1]]
    sector_flags = [[round(t_inc, 1), sec_inc, 2], [round(t_inc + 45, 1), sec_inc, 0]]

    replay = {
        "duration_s": round(duration, 1),
        "track": [[round(px * 10, 1), round(py * 10, 1)] for px, py in track],
        "pit_lane": pit_lane,
        "sector_marks": marks,
        "drs_zones": drs_zones,
        "detection_points": det_pts,
        "sector_flags": sector_flags,
        "drivers": drivers_out,
        "track_status": track_status,
    }
    with open(OUT / "replay.json", "w") as f:
        json.dump(replay, f, separators=(",", ":"))

    # feed: direzione gara + meteo (niente radio: non esistono audio sintetici)
    rc = [
        {"t": -300.0, "category": "Flag", "flag": "GREEN",
         "message": "GREEN LIGHT - PIT EXIT OPEN"},
        {"t": round(t_inc, 1), "category": "Flag", "flag": "YELLOW",
         "message": f"YELLOW IN TRACK SECTOR {sec_inc}"},
        {"t": round(t_inc + 10, 1), "category": "Other", "flag": None,
         "message": f"CAR {ret_rows['num']} ({ret_abbr}) STOPPED AT TURN 9 - INCIDENT NOTED"},
        {"t": round(t_inc + 45, 1), "category": "Flag", "flag": "CLEAR",
         "message": f"CLEAR IN TRACK SECTOR {sec_inc}"},
        {"t": round(t_sc, 1), "category": "SafetyCar", "flag": None,
         "message": "SAFETY CAR DEPLOYED"},
        {"t": round(t_sc_end - 60, 1), "category": "SafetyCar", "flag": None,
         "message": "SAFETY CAR IN THIS LAP"},
        {"t": tl_times[0], "category": "Other", "flag": None,
         "message": f"CAR {tl_driver['num']} ({tl_driver['abbr']}) LAP DELETED - TRACK LIMITS AT TURN 7"},
        {"t": tl_times[1], "category": "Other", "flag": None,
         "message": f"CAR {tl_driver['num']} ({tl_driver['abbr']}) LAP DELETED - TRACK LIMITS AT TURN 7"},
        {"t": pen_t, "category": "Other", "flag": None,
         "message": f"FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR {pen_driver['num']} ({pen_driver['abbr']}) - TRACK LIMITS"},
        {"t": round(duration, 1), "category": "Flag", "flag": "CHEQUERED",
         "message": "CHEQUERED FLAG"},
    ]
    weather = []
    for tt in np.arange(-300, duration + 60, 60):
        weather.append([float(round(tt)), round(24 + tt / duration * 2, 1),
                        round(39 - tt / duration * 4, 1), False,
                        round(2 + math.sin(tt / 900) * 1.5, 1),
                        int((190 + tt / 60) % 360)])
    with open(OUT / "feed.json", "w") as f:
        json.dump({"race_control": rc, "radio": [], "weather": weather}, f,
                  separators=(",", ":"))

    with open(OUT / "laps.json", "w") as f:
        json.dump(laps_json, f, separators=(",", ":"))
    session = {
        "status": "ready", "year": 2026, "event": "Gran Premio EffeUno",
        "session": "Race",
        "drivers": [{"num": d["num"], "abbr": d["abbr"],
                     "name": DRIVERS[k][0], "team": d["team"]}
                    for k, d in enumerate(drivers_out)],
    }
    with open(OUT / "session.json", "w") as f:
        json.dump(session, f, separators=(",", ":"))
    with open(OUT / "events.json", "w") as f:
        json.dump([{"round": 1, "name": "Gran Premio EffeUno",
                    "country": "Demo sintetica", "date": "2026-01-01",
                    "format": "conventional"}], f)

    total_kb = sum(p.stat().st_size for p in OUT.glob("*.json")) / 1e3
    print(f"scritti {len(list(OUT.glob('*.json')))} file in {OUT} ({total_kb:.0f} KB)")

    # --- immagine hero per il README -------------------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(12, 7), facecolor="#121212")
    ax.set_facecolor("#121212")
    ax.plot(track[:, 0], track[:, 1], color="#3a3a3a", lw=7,
            solid_capstyle="round", zorder=1)
    for z in drs_zones:
        za = np.array(z) / 10
        ax.plot(za[:, 0], za[:, 1], color="#2e6b45", lw=7, zorder=2)
    t_snap = 1000.0
    for k, d in enumerate(drivers_out):
        pts = [p for p in d["points"] if p[0] <= t_snap]
        if not pts:
            continue
        px, py = pts[-1][1] / 10, pts[-1][2] / 10
        color = TEAMS[k // 2][1]
        ax.scatter([px], [py], s=210, c=color, zorder=3, edgecolors="#111")
        ax.annotate(d["abbr"], (px, py), color="#111", fontsize=5.5,
                    ha="center", va="center", zorder=4, weight="bold")
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title("EffeUno — replay demo (dati sintetici)", color="#bbb", fontsize=13)
    fig.savefig(IMG / "demo-map.png", dpi=150, bbox_inches="tight",
                facecolor="#121212")
    print(f"hero: {IMG / 'demo-map.png'}")


if __name__ == "__main__":
    main()
