"""Implementazione DataSource su FastF1 (dati storici, cache locale)."""

import math
from pathlib import Path
from typing import Any

import fastf1
import pandas as pd

from .base import DataSource, LoadedSession

ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = ROOT / "fastf1_cache"

# Salto massimo plausibile tra due campioni consecutivi (in 1/10 m).
# Oltre, il campione e' un glitch di posizione ("teleport") e va scartato.
MAX_PLAUSIBLE_JUMP = 1200  # 120 m


def _clean(v: Any) -> Any:
    """NaN/NaT -> None per la serializzazione JSON."""
    if v is None or (isinstance(v, float) and math.isnan(v)) or pd.isna(v):
        return None
    return v


class FastF1Session(LoadedSession):
    def __init__(self, session: fastf1.core.Session) -> None:
        self._s = session
        status = session.session_status
        started = status.loc[status["Status"] == "Started", "Time"]
        self._t0 = float(started.iloc[0].total_seconds()) if not started.empty else 0.0

    def info(self) -> dict[str, Any]:
        s = self._s
        drivers = []
        for num in s.drivers:
            d = s.get_driver(num)
            drivers.append({
                "num": num,
                "abbr": _clean(d["Abbreviation"]),
                "name": _clean(d["FullName"]),
                "team": _clean(d["TeamName"]),
            })
        return {
            "year": int(s.event["EventDate"].year),
            "event": s.event["EventName"],
            "session": s.name,
            "drivers": drivers,
        }

    def replay(self) -> dict[str, Any]:
        s = self._s
        drivers = []
        duration = 0.0
        for num in s.drivers:
            pos = s.pos_data.get(num)
            if pos is None or pos.empty:
                continue
            t = pos["SessionTime"].dt.total_seconds() - self._t0
            window = pos[(t >= 0) & (pos["Status"] == "OnTrack")]
            if window.empty:
                continue
            info = s.get_driver(num)
            points: list[list[float]] = []
            px = py = None
            for ti, xi, yi in zip(
                window["SessionTime"].dt.total_seconds() - self._t0,
                window["X"], window["Y"],
            ):
                if math.isnan(xi) or math.isnan(yi):
                    continue
                # filtra i glitch "teleport" visti in Fase 0
                if px is not None and math.hypot(xi - px, yi - py) > MAX_PLAUSIBLE_JUMP:
                    continue
                px, py = xi, yi
                points.append([round(ti, 3), round(xi, 1), round(yi, 1)])
            if points:
                duration = max(duration, points[-1][0])
                drivers.append({
                    "num": num,
                    "abbr": _clean(info["Abbreviation"]),
                    "team": _clean(info["TeamName"]),
                    "points": points,
                })

        tel = s.laps.pick_fastest().get_telemetry()
        track = [[round(x, 1), round(y, 1)] for x, y in zip(tel["X"], tel["Y"])]
        return {"duration_s": round(duration, 1), "track": track, "drivers": drivers}

    def laps(self) -> list[dict[str, Any]]:
        out = []
        for _, lap in self._s.laps.iterlaps():
            lt = lap["LapTime"]
            out.append({
                "driver": lap["Driver"],
                "num": lap["DriverNumber"],
                "lap": int(lap["LapNumber"]),
                "time_s": round(lt.total_seconds(), 3) if pd.notna(lt) else None,
                "compound": _clean(lap["Compound"]),
                "accurate": bool(lap["IsAccurate"]),
            })
        return out

    def lap_telemetry(self, driver: str, lap: int) -> dict[str, Any]:
        laps = self._s.laps.pick_drivers(driver)
        row = laps[laps["LapNumber"] == lap].iloc[0]
        tel = row.get_telemetry().add_distance()
        return {
            "driver": driver,
            "lap": lap,
            "distance": [round(v, 1) for v in tel["Distance"]],
            "speed": [round(v, 1) for v in tel["Speed"]],
            "throttle": [round(v, 1) for v in tel["Throttle"]],
            "brake": [bool(v) for v in tel["Brake"]],
            "gear": [int(v) for v in tel["nGear"]],
            "x": [round(v, 1) for v in tel["X"]],
            "y": [round(v, 1) for v in tel["Y"]],
        }


class FastF1Source(DataSource):
    def __init__(self) -> None:
        CACHE_DIR.mkdir(exist_ok=True)
        fastf1.Cache.enable_cache(str(CACHE_DIR))

    def events(self, year: int) -> list[dict[str, Any]]:
        schedule = fastf1.get_event_schedule(year, include_testing=False)
        return [
            {
                "round": int(ev["RoundNumber"]),
                "name": ev["EventName"],
                "country": ev["Country"],
                "date": str(ev["EventDate"].date()),
            }
            for _, ev in schedule.iterrows()
        ]

    def load_session(self, year: int, event: str, session: str) -> LoadedSession:
        s = fastf1.get_session(year, event, session)
        s.load()
        return FastF1Session(s)
