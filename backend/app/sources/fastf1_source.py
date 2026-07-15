"""Implementazione DataSource su FastF1 (dati storici, cache locale)."""

import json
import math
import re
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

COMPOUND_LETTER = {"SOFT": "S", "MEDIUM": "M", "HARD": "H",
                   "INTERMEDIATE": "I", "WET": "W"}


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

    def _pit_windows(self, laps: pd.DataFrame) -> list[list[float | None]]:
        """Finestre [ingresso, uscita] pit lane in secondi dallo start.
        PitInTime chiude il giro N, PitOutTime apre il giro N+1."""
        windows: list[list[float | None]] = []
        pit_in: float | None = None
        for _, lap in laps.sort_values("LapNumber").iterrows():
            out = lap["PitOutTime"]
            if pit_in is not None and pd.notna(out):
                windows.append([round(pit_in, 1), round(out.total_seconds() - self._t0, 1)])
                pit_in = None
            pin = lap["PitInTime"]
            if pd.notna(pin):
                pit_in = pin.total_seconds() - self._t0
        if pit_in is not None:  # entrato ai box e mai uscito (ritiro/fine gara)
            windows.append([round(pit_in, 1), None])
        return windows

    def _lap_timeline(self, laps: pd.DataFrame) -> list[list[float | None]]:
        """[numero giro, t inizio, t fine] per calcolare posizioni e gap."""
        out: list[list[float | None]] = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            start = lap["LapStartTime"]
            if pd.isna(start):
                continue
            t_start = start.total_seconds() - self._t0
            lt = lap["LapTime"]
            t_end = t_start + lt.total_seconds() if pd.notna(lt) else None
            out.append([int(lap["LapNumber"]), round(t_start, 3),
                        round(t_end, 3) if t_end is not None else None])
        return out

    def _tyres(self, laps: pd.DataFrame) -> list[list[Any]]:
        """[giro, mescola (S/M/H/I/W), giri percorsi con questo treno].
        Nota: l'usura reale non e' nel feed; l'eta' in giri e' il proxy standard."""
        out: list[list[Any]] = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            compound = COMPOUND_LETTER.get(str(lap["Compound"]).upper(), "?")
            life = lap["TyreLife"]
            out.append([int(lap["LapNumber"]), compound,
                        int(life) if pd.notna(life) else None])
        return out

    def _sectors(self, laps: pd.DataFrame) -> list[list[Any]]:
        """[giro, s1, s2, s3] in secondi (None se mancante)."""
        def sec(v: Any) -> float | None:
            return round(v.total_seconds(), 3) if pd.notna(v) else None
        return [
            [int(lap["LapNumber"]), sec(lap["Sector1Time"]),
             sec(lap["Sector2Time"]), sec(lap["Sector3Time"])]
            for _, lap in laps.sort_values("LapNumber").iterrows()
        ]

    def _race_control(self) -> tuple[dict[str, list], dict[str, list]]:
        """Dai messaggi della direzione gara: (giri cancellati per track
        limits, penalita') per numero pilota, tempi relativi allo start."""
        tl: dict[str, list[float]] = {}
        pen: dict[str, list[list[Any]]] = {}
        rcm = self._s.race_control_messages
        if rcm is None or rcm.empty:
            return tl, pen
        t0_date = self._s.t0_date
        for _, m in rcm.iterrows():
            msg = str(m["Message"]).upper()
            car = re.search(r"CAR (\d+)", msg)
            if car is None or pd.isna(m["Time"]):
                continue
            num = car.group(1)
            t = round((m["Time"] - t0_date).total_seconds() - self._t0, 1)
            if "TRACK LIMITS" in msg and "DELETED" in msg:
                tl.setdefault(num, []).append(t)
            elif (pm := re.search(r"(\d+) SECOND TIME PENALTY", msg)):
                pen.setdefault(num, []).append([t, f"+{pm.group(1)}s"])
            elif "DRIVE THROUGH" in msg and "PENALTY" in msg:
                pen.setdefault(num, []).append([t, "DT"])
            elif ("STOP AND GO" in msg or "STOP/GO" in msg) and "PENALTY" in msg:
                pen.setdefault(num, []).append([t, "S&G"])
        return tl, pen

    @staticmethod
    def _pit_lane_polyline(drivers: list[dict[str, Any]]) -> list[list[float]]:
        """Percorso della pit lane: la traversata dei box reale (ingresso ->
        sosta -> uscita) con piu' campioni tra tutti i pit stop della gara."""
        best: list[list[float]] = []
        for d in drivers:
            for t_in, t_out in d["pits"]:
                if t_out is None or t_out - t_in > 90:  # ritiro, non sosta
                    continue
                seg = [[p[1], p[2]] for p in d["points"] if t_in - 1 <= p[0] <= t_out + 1]
                if len(seg) > len(best):
                    best = seg
        return best

    def replay(self) -> dict[str, Any]:
        s = self._s
        drivers = []
        duration = 0.0
        tl_events, penalties = self._race_control()
        for num in s.drivers:
            pos = s.pos_data.get(num)
            if pos is None or pos.empty:
                continue
            t = pos["SessionTime"].dt.total_seconds() - self._t0
            # tutti i campioni dallo start, pit lane inclusa (i pit stop si vedono)
            window = pos[t >= 0]
            if window.empty:
                continue
            info = s.get_driver(num)
            points: list[list[float]] = []
            px = py = None
            for ti, xi, yi in zip(
                window["SessionTime"].dt.total_seconds() - self._t0,
                window["X"], window["Y"],
            ):
                if math.isnan(xi) or math.isnan(yi) or (xi == 0 and yi == 0):
                    continue
                # filtra i glitch "teleport" visti in Fase 0
                if px is not None and math.hypot(xi - px, yi - py) > MAX_PLAUSIBLE_JUMP:
                    continue
                px, py = xi, yi
                points.append([round(ti, 3), round(xi, 1), round(yi, 1)])
            if points:
                duration = max(duration, points[-1][0])
                drv_laps = s.laps[s.laps["DriverNumber"] == num]
                drivers.append({
                    "num": num,
                    "abbr": _clean(info["Abbreviation"]),
                    "team": _clean(info["TeamName"]),
                    "points": points,
                    "pits": self._pit_windows(drv_laps),
                    "laps": self._lap_timeline(drv_laps),
                    "tyres": self._tyres(drv_laps),
                    "sectors": self._sectors(drv_laps),
                    "tl": tl_events.get(num, []),
                    "penalties": penalties.get(num, []),
                })

        tel = s.laps.pick_fastest().get_telemetry()
        track = [[round(x, 1), round(y, 1)] for x, y in zip(tel["X"], tel["Y"])]

        # stato pista: 1 verde, 2 gialla, 4 SC, 5 rossa, 6 VSC, 7 VSC in rientro
        ts = s.track_status
        track_status = [
            [round(row["Time"].total_seconds() - self._t0, 1), int(row["Status"])]
            for _, row in ts.iterrows()
        ]

        return {
            "duration_s": round(duration, 1),
            "track": track,
            "pit_lane": self._pit_lane_polyline(drivers),
            "drivers": drivers,
            "track_status": track_status,
        }

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

    def feed(self) -> dict[str, Any]:
        """Messaggi direzione gara + clip audio team radio, tempi dallo start.

        I team radio non passano da fastf1.core: arrivano dallo stesso
        servizio livetiming statico (endpoint TeamRadio), come clip mp3
        pubbliche servite da livetiming.formula1.com."""
        t0_date = self._s.t0_date

        def rel(ts: Any) -> float:
            return round((ts - t0_date).total_seconds() - self._t0, 1)

        race_control: list[dict[str, Any]] = []
        rcm = self._s.race_control_messages
        if rcm is not None and not rcm.empty:
            for _, m in rcm.iterrows():
                if pd.isna(m["Time"]):
                    continue
                race_control.append({
                    "t": rel(m["Time"]),
                    "category": _clean(m["Category"]),
                    "flag": _clean(m["Flag"]),
                    "message": _clean(m["Message"]),
                })

        radio: list[dict[str, Any]] = []
        try:
            import warnings

            import fastf1.api as f1api
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")  # fastf1.api "private" warning
                data = f1api.fetch_page(self._s.api_path, "team_radio")
        except Exception:
            data = None  # sessione senza team radio: il feed resta solo testuale
        base = "https://livetiming.formula1.com" + self._s.api_path
        seen: set[str] = set()
        chunks = data if isinstance(data, list) else [(None, data)] if data else []
        for entry in chunks:
            # ogni riga jsonStream e' [timestamp, payload]; il payload puo'
            # arrivare gia' parsato oppure come stringa JSON: non deve mai
            # interrompere il feed intero
            chunk = entry[1] if isinstance(entry, (list, tuple)) and len(entry) > 1 else entry
            if isinstance(chunk, str):
                try:
                    chunk = json.loads(chunk)
                except ValueError:
                    continue
            if not isinstance(chunk, dict):
                continue
            caps = chunk.get("Captures", [])
            if isinstance(caps, dict):
                # aggiornamenti incrementali del jsonStream: dict indicizzato
                # {"2": {...}} invece della lista completa
                caps = list(caps.values())
            for cap in caps:
                try:
                    path = cap.get("Path")
                    if not path or path in seen:
                        continue
                    seen.add(path)
                    utc = pd.to_datetime(cap["Utc"], utc=True).tz_localize(None)
                    radio.append({
                        "t": rel(utc),
                        "num": str(cap.get("RacingNumber", "")),
                        "url": base + path,
                    })
                except Exception:
                    continue
        radio.sort(key=lambda r: r["t"])
        return {"race_control": race_control, "radio": radio}

    def lap_telemetry(self, driver: str, lap: int) -> dict[str, Any]:
        laps = self._s.laps.pick_drivers(driver)
        row = laps[laps["LapNumber"] == lap].iloc[0]
        tel = row.get_telemetry().add_distance()
        # tempo dall'inizio del giro, per il delta cumulativo tra due giri
        t = tel["Time"].dt.total_seconds()
        t = t - t.iloc[0]
        return {
            "driver": driver,
            "lap": lap,
            "time": [round(v, 3) for v in t],
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
