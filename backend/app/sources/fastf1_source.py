"""Implementazione DataSource su FastF1 (dati storici, cache locale)."""

import json
import math
import re
from pathlib import Path
from typing import Any

import fastf1
import fastf1.exceptions
import numpy as np
import pandas as pd

from .base import DataSource, LoadedSession

ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = ROOT / "fastf1_cache"

# Salto massimo plausibile tra due campioni consecutivi (in 1/10 m).
# Oltre, il campione e' un glitch di posizione ("teleport") e va scartato.
MAX_PLAUSIBLE_JUMP = 1200  # 120 m

COMPOUND_LETTER = {"SOFT": "S", "MEDIUM": "M", "HARD": "H",
                   "INTERMEDIATE": "I", "WET": "W"}


class DataUnavailable(Exception):
    """La sessione non e' replayabile perche' i dati non esistono a monte
    (archivio F1 incompleto), non per un problema nostro. Chi pubblica la
    distingue dagli errori veri: non c'e' niente da riprovare."""


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
        """[giro, mescola (S/M/H/I/W), giri percorsi con questo treno, nuova].
        Nota: l'usura reale non e' nel feed; l'eta' in giri e' il proxy standard."""
        out: list[list[Any]] = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            compound = COMPOUND_LETTER.get(str(lap["Compound"]).upper(), "?")
            life = lap["TyreLife"]
            fresh = lap["FreshTyre"]
            out.append([int(lap["LapNumber"]), compound,
                        int(life) if pd.notna(life) else None,
                        bool(fresh) if pd.notna(fresh) else True])
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

    def _speed_traps(self, laps: pd.DataFrame) -> list[list[Any]]:
        """[giro, I1, I2, FL, ST] km/h ai rilevamenti (None se mancante):
        intertempo 1/2, traguardo, speed trap del rettilineo principale."""
        def v(x: Any) -> float | None:
            return round(float(x), 0) if pd.notna(x) else None
        out = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            row = [int(lap["LapNumber"]), v(lap["SpeedI1"]), v(lap["SpeedI2"]),
                   v(lap["SpeedFL"]), v(lap["SpeedST"])]
            if any(x is not None for x in row[1:]):
                out.append(row)
        return out

    def _deleted_laps(self, laps: pd.DataFrame) -> list[list[Any]]:
        """Giri cancellati con flag UFFICIALE del feed: [t fine giro, giro,
        motivo]. Piu' affidabile della regex sui messaggi direzione gara."""
        out: list[list[Any]] = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            if not (pd.notna(lap.get("Deleted")) and bool(lap["Deleted"])):
                continue
            start = lap["LapStartTime"]
            lt = lap["LapTime"]
            if pd.isna(start):
                continue
            t = start.total_seconds() - self._t0 + \
                (lt.total_seconds() if pd.notna(lt) else 0)
            reason = str(lap["DeletedReason"]) if pd.notna(lap.get("DeletedReason")) else ""
            out.append([round(t, 1), int(lap["LapNumber"]), reason.strip()])
        return out

    def _lap_status(self, laps: pd.DataFrame) -> list[list[Any]]:
        """[giro, TrackStatus] per giro: stringa di codici attraversati
        ('1' verde, '2' gialla, '4' SC, '5' rossa, '6/7' VSC — '67' = piu'
        stati nello stesso giro). Serve a marcare i giri sporchi con
        precisione per pilota."""
        out = []
        for _, lap in laps.sort_values("LapNumber").iterrows():
            st = lap.get("TrackStatus")
            out.append([int(lap["LapNumber"]),
                        str(st) if pd.notna(st) else ""])
        return out

    def _results(self) -> dict[str, dict[str, Any]]:
        """Risultati ufficiali per pilota: griglia, classifica finale,
        stato (Finished/+1 Lap/Collision/...), punti e — in qualifica —
        i tempi ufficiali di Q1/Q2/Q3 (chi non ha il Q2 e' eliminato in Q1)."""
        res = self._s.results
        if res is None or res.empty:
            return {}
        def num_or_none(v: Any) -> float | None:
            v = _clean(v)
            return None if v is None else float(v)
        def sec(v: Any) -> float | None:
            return round(v.total_seconds(), 3) if pd.notna(v) else None
        out: dict[str, dict[str, Any]] = {}
        for _, r in res.iterrows():
            grid = num_or_none(r.get("GridPosition"))
            pts = num_or_none(r.get("Points"))
            out[str(r["DriverNumber"])] = {
                "grid": int(grid) if grid else None,   # 0/None = via dalla pit
                "finish": _clean(r.get("ClassifiedPosition")) or None,
                "status": _clean(r.get("Status")) or None,
                "points": pts if pts else 0,
                "q1": sec(r.get("Q1")),
                "q2": sec(r.get("Q2")),
                "q3": sec(r.get("Q3")),
            }
        return out

    def _circuit(self) -> tuple[list[list[Any]], list[list[Any]]]:
        """(curve numerate, postazioni marshal) da get_circuit_info():
        [x, y, etichetta, angolo] — l'angolo orienta l'etichetta fuori
        dal nastro. Geometria REALE, niente piu' settori approssimati."""
        try:
            info = self._s.get_circuit_info()
        except Exception:
            return [], []
        def rows(df: Any) -> list[list[Any]]:
            out = []
            if df is None or df.empty:
                return out
            for _, r in df.iterrows():
                label = f"{int(r['Number'])}{r['Letter'] or ''}" \
                    if pd.notna(r.get("Number")) else ""
                out.append([round(float(r["X"]), 1), round(float(r["Y"]), 1),
                            label, round(float(r.get("Angle", 0)), 1)])
            return out
        return rows(info.corners), rows(info.marshal_sectors)

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

    def _sector_marks(self, ref_lap: Any, ref_tel: Any) -> list[list[float]]:
        """Coordinate dei confini S1/S2 e S2/S3, interpolate sul giro di
        riferimento all'istante in cui i settori sono scattati."""
        marks: list[list[float]] = []
        st = ref_tel["SessionTime"].dt.total_seconds()
        cum = ref_lap["LapStartTime"]
        for col in ("Sector1Time", "Sector2Time"):
            v = ref_lap[col]
            if pd.isna(v):
                return []
            cum = cum + v
            ts = cum.total_seconds()
            marks.append([
                round(float(np.interp(ts, st, ref_tel["X"])), 1),
                round(float(np.interp(ts, st, ref_tel["Y"])), 1),
            ])
        return marks

    # canale DRS: 8 = rilevato entro 1s (abilitato), 10/12/14 = ala aperta
    DRS_OPEN = (10, 12, 14)
    DRS_ELIGIBLE = 8

    def _drs_geometry(self, ref_tel: Any) -> tuple[list[list[list[float]]], list[list[float]]]:
        """(zone DRS, punti di detection) ricavati dai dati di tutta la gara:
        le zone sono i tratti dove i piloti hanno tenuto l'ala aperta, i punti
        di detection sono dove il canale passa a 8 (rilevati entro 1s) — il
        feed non pubblica la geometria di nessuno dei due.

        Regole 2026: il DRS non e' piu' aiuto al sorpasso e la telemetria
        pubblica (per ora) non espone lo stato override/detection: il canale
        resta a 0 e questa scansione non produce nulla, quindi si salta."""
        if int(self._s.event["EventDate"].year) >= 2026:
            return [], []
        bin_m = 25.0
        lap_len = float(ref_tel["Distance"].iloc[-1])
        nbins = int(lap_len // bin_m) + 1
        open_counts = np.zeros(nbins)
        onset_counts = np.zeros(nbins)
        for num in list(self._s.drivers)[:10]:
            laps = self._s.laps[self._s.laps["DriverNumber"] == num]
            for _, lap in laps.iterlaps():
                try:
                    car = lap.get_car_data().add_distance()
                except Exception:
                    continue
                drs = car["DRS"].to_numpy()
                dist = car["Distance"].to_numpy()
                idx = (dist[np.isin(drs, self.DRS_OPEN)] // bin_m).astype(int)
                for i in idx[(idx >= 0) & (idx < nbins)]:
                    open_counts[i] += 1
                # transizioni a "rilevato": l'inizio marca il punto di detection
                onset = (drs[1:] == self.DRS_ELIGIBLE) & (drs[:-1] != self.DRS_ELIGIBLE)
                oidx = (dist[1:][onset] // bin_m).astype(int)
                for i in oidx[(oidx >= 0) & (oidx < nbins)]:
                    onset_counts[i] += 1

        def hot_ranges(counts: Any, min_count: float) -> list[tuple[float, float]]:
            threshold = max(min_count, 0.1 * counts.max())
            if counts.max() < min_count:
                return []
            out: list[tuple[float, float]] = []
            start: int | None = None
            for i in range(nbins + 1):
                hot = i < nbins and counts[i] >= threshold
                if hot and start is None:
                    start = i
                elif not hot and start is not None:
                    out.append((start * bin_m, i * bin_m))
                    start = None
            return out

        zones: list[list[list[float]]] = []
        for d0, d1 in hot_ranges(open_counts, 6):
            seg = ref_tel[(ref_tel["Distance"] >= d0) & (ref_tel["Distance"] <= d1)]
            if len(seg) > 1:
                zones.append([[round(x, 1), round(y, 1)]
                              for x, y in zip(seg["X"], seg["Y"])])

        detections: list[list[float]] = []
        dist_ref = ref_tel["Distance"]
        for d0, d1 in hot_ranges(onset_counts, 6):
            mid = (d0 + d1) / 2
            detections.append([
                round(float(np.interp(mid, dist_ref, ref_tel["X"])), 1),
                round(float(np.interp(mid, dist_ref, ref_tel["Y"])), 1),
            ])
        return zones, detections

    def _sector_flags(self) -> list[list[float]]:
        """Bandiere nei settori marshal dai messaggi direzione gara:
        [t, settore, codice] con 2 = gialla, 3 = doppia gialla, 0 = libero.
        La geometria dei settori NON e' nel feed: il frontend la approssima
        dividendo il nastro in tratti uguali numerati dal traguardo."""
        out: list[list[float]] = []
        rcm = self._s.race_control_messages
        if rcm is None or rcm.empty:
            return out
        t0_date = self._s.t0_date
        for _, m in rcm.iterrows():
            if pd.isna(m["Time"]):
                continue
            msg = str(m["Message"]).upper()
            sec = re.search(r"IN TRACK SECTOR (\d+)", msg)
            if sec is None:
                continue
            code = (0 if "CLEAR" in msg
                    else 3 if "DOUBLE YELLOW" in msg
                    else 2 if "YELLOW" in msg else None)
            if code is None:
                continue
            t = round((m["Time"] - t0_date).total_seconds() - self._t0, 1)
            out.append([t, int(sec.group(1)), code])
        return out

    # durate regolamentari delle manche in minuti: qualifica e Sprint
    QUALI_MINUTES = (18, 15, 12)
    SPRINT_QUALI_MINUTES = (12, 10, 8)

    def _quali_segments(self) -> list[dict[str, Any]]:
        """Manche Q1/Q2/Q3 dal session_status: una per ogni coppia
        Started->Finished; un Aborted dentro la manche e' bandiera rossa
        (countdown fermo) e il Started successivo la riprende."""
        if "Qualifying" not in self._s.name and "Shootout" not in self._s.name:
            return []
        minutes = (self.SPRINT_QUALI_MINUTES if "Sprint" in self._s.name
                   or "Shootout" in self._s.name else self.QUALI_MINUTES)
        segments: list[dict[str, Any]] = []
        cur: dict[str, Any] | None = None
        for _, row in self._s.session_status.iterrows():
            t = round(row["Time"].total_seconds() - self._t0, 1)
            status = row["Status"]
            if status == "Started":
                if cur is None:
                    part = len(segments) + 1
                    cur = {"part": part, "start": t, "end": None, "pauses": [],
                           "duration": minutes[min(part, 3) - 1] * 60}
                elif cur["pauses"] and cur["pauses"][-1][1] is None:
                    cur["pauses"][-1][1] = t
            elif status == "Aborted" and cur is not None:
                cur["pauses"].append([t, None])
            elif status in ("Finished", "Ends") and cur is not None:
                cur["end"] = t
                segments.append(cur)
                cur = None
        if cur is not None:  # sessione interrotta/in corso a fine dati
            segments.append(cur)
        return segments

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
        # Alcune sessioni del 2018 (Australia, Bahrain, Monza) non hanno mai
        # avuto le posizioni X/Y nell'archivio F1: verificato ri-scaricando
        # da zero, pos_data e' vuoto. Senza traiettorie non c'e' replay, ed
        # e' un limite a monte, non un errore nostro: va detto subito, prima
        # di toccare campi che in quelle sessioni sono a loro volta vuoti.
        if not any(pos is not None and not pos.empty
                   for pos in (s.pos_data or {}).values()):
            raise DataUnavailable(
                "F1 non ha pubblicato i dati di posizione per questa sessione")
        tl_events, penalties = self._race_control()
        results = self._results()
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
                try:
                    top_speed = round(float(s.car_data[num]["Speed"].max()), 0)
                except Exception:
                    top_speed = None
                drivers.append({
                    "num": num,
                    "top_speed": top_speed,
                    "abbr": _clean(info["Abbreviation"]),
                    "team": _clean(info["TeamName"]),
                    "points": points,
                    "pits": self._pit_windows(drv_laps),
                    "laps": self._lap_timeline(drv_laps),
                    "tyres": self._tyres(drv_laps),
                    "sectors": self._sectors(drv_laps),
                    "tl": tl_events.get(num, []),
                    "penalties": penalties.get(num, []),
                    "traps": self._speed_traps(drv_laps),
                    "deleted": self._deleted_laps(drv_laps),
                    "lap_status": self._lap_status(drv_laps),
                    "result": results.get(num),
                })

        # giro di riferimento per nastro/settori: il piu' veloce, ma in
        # sessioni degeneri (Spa 2021: 3 giri dietro SC) pick_fastest e'
        # None — si ripiega sul primo giro con telemetria utilizzabile
        ref_lap = s.laps.pick_fastest()
        tel = None
        if ref_lap is not None:
            try:
                tel = ref_lap.get_telemetry().add_distance()
            except Exception:
                tel = None
        if tel is None:
            for _, cand in s.laps.sort_values("LapTime").iterlaps():
                try:
                    tel = cand.get_telemetry().add_distance()
                    ref_lap = cand
                    break
                except Exception:
                    continue
        if tel is None or len(tel) < 2:
            raise ValueError("nessun giro con telemetria: sessione non replayabile")
        track = [[round(x, 1), round(y, 1)] for x, y in zip(tel["X"], tel["Y"])]

        # stato pista: 1 verde, 2 gialla, 4 SC, 5 rossa, 6 VSC, 7 VSC in rientro
        ts = s.track_status
        track_status = [
            [round(row["Time"].total_seconds() - self._t0, 1), int(row["Status"])]
            for _, row in ts.iterrows()
        ]

        drs_zones, detection_points = self._drs_geometry(tel)
        corners, marshal_sectors = self._circuit()
        return {
            "duration_s": round(duration, 1),
            "track": track,
            "corners": corners,
            "marshal_sectors": marshal_sectors,
            "pit_lane": self._pit_lane_polyline(drivers),
            "sector_marks": self._sector_marks(ref_lap, tel),
            "drs_zones": drs_zones,
            "detection_points": detection_points,
            "sector_flags": self._sector_flags(),
            "drivers": drivers,
            "track_status": track_status,
            "quali_segments": self._quali_segments(),
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
                "status": str(lap["TrackStatus"]) if pd.notna(lap["TrackStatus"]) else "",
                "deleted": bool(lap["Deleted"]) if pd.notna(lap.get("Deleted")) else False,
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
        weather: list[list[Any]] = []
        w = self._s.weather_data
        if w is not None and not w.empty:
            for _, row in w.iterrows():
                weather.append([
                    round(row["Time"].total_seconds() - self._t0, 0),
                    round(float(row["AirTemp"]), 1),
                    round(float(row["TrackTemp"]), 1),
                    bool(row["Rainfall"]),
                    round(float(row["WindSpeed"]), 1),
                    int(row["WindDirection"]),
                ])

        radio.sort(key=lambda r: r["t"])
        return {"race_control": race_control, "radio": radio, "weather": weather}

    def lap_telemetry(self, driver: str, lap: int) -> dict[str, Any]:
        laps = self._s.laps.pick_drivers(driver)
        row = laps[laps["LapNumber"] == lap].iloc[0]
        tel = row.get_telemetry().add_distance()
        # tempo dall'inizio del giro, per il delta cumulativo tra due giri
        t = tel["Time"].dt.total_seconds()
        t = t - t.iloc[0]
        out = {
            "driver": driver,
            "lap": lap,
            "time": [round(v, 3) for v in t],
            "distance": [round(v, 1) for v in tel["Distance"]],
            "speed": [round(v, 1) for v in tel["Speed"]],
            "throttle": [round(v, 1) for v in tel["Throttle"]],
            "brake": [bool(v) for v in tel["Brake"]],
            "gear": [int(v) for v in tel["nGear"]],
            "rpm": [int(v) for v in tel["RPM"]],
            "x": [round(v, 1) for v in tel["X"]],
            "y": [round(v, 1) for v in tel["Y"]],
        }
        # canale DRS solo dove significa qualcosa (dal 2026 e' sempre 0)
        if int(self._s.event["EventDate"].year) < 2026:
            out["drs"] = [int(v) for v in tel["DRS"]]
        return out


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
                "format": str(ev["EventFormat"]),
            }
            for _, ev in schedule.iterrows()
        ]

    def load_session(self, year: int, event: str, session: str) -> LoadedSession:
        try:
            s = fastf1.get_session(year, event, session)
        except ValueError:
            if session != "SQ":
                raise
            # nel 2023 la manche sprint si chiamava "Sprint Shootout" e
            # FastF1 non la riconosce col codice SQ: stesso formato, altro nome
            s = fastf1.get_session(year, event, "Sprint Shootout")
        s.load()
        # nelle sessioni 2018 con archivio incompleto il load "riesce" ma
        # lascia fuori timing o telemetria: meglio dirlo qui che schiantarsi
        # piu' avanti con un DataNotLoadedError incomprensibile
        try:
            if s.laps is None or s.laps.empty:
                raise DataUnavailable("nessun dato di giro nell'archivio F1")
        except fastf1.exceptions.DataNotLoadedError as exc:
            raise DataUnavailable(
                "archivio F1 incompleto per questa sessione") from exc
        return FastF1Session(s)
