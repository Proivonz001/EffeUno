"""LiveSource: lo stato live servito al frontend (sezione LIVE).

V1 — alimentazione da due sorgenti:
- replayer di un file registrato (sviluppo/collaudo, anche accelerato);
- (in arrivo) client SignalR diretto per la sessione in corso.

Lo stato e' effimero per scelta: vive in RAM e si butta a fine sessione.
"""

import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from .sources.livetiming_parse import LiveState, parse_line

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS_DIR = ROOT / "live_streams"

# codici microsettore -> colore della torre (stessi della grafica F1)
SEGMENT_COLORS = {
    2048: "set",       # giallo: percorso
    2049: "pb",        # verde: personal best
    2051: "ob",        # viola: overall best
    2064: "pit",       # in pit lane
}


def _ts_seconds(ts: str) -> float | None:
    """Timestamp dello stream ('2026-07-17T12:19:58.793Z') in secondi."""
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


class LiveSource:
    def __init__(self) -> None:
        self._state: LiveState | None = None
        self._mode = "off"          # off | replay | live
        self._label = ""
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()

    # --- controllo ------------------------------------------------------
    def recordings(self) -> list[dict[str, Any]]:
        out = []
        for p in sorted(RECORDINGS_DIR.glob("*.txt")):
            if p.stat().st_size > 10_000:
                out.append({"name": p.name, "mb": round(p.stat().st_size / 1e6, 1)})
        return out

    def start_replay(self, name: str, speed: float = 1.0) -> None:
        path = (RECORDINGS_DIR / name).resolve()
        if RECORDINGS_DIR.resolve() not in path.parents or not path.exists():
            raise FileNotFoundError(name)
        self.stop()
        self._state = LiveState()
        self._mode = "replay"
        self._label = f"{name} ×{speed:g}"
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._replay_worker, args=(path, speed), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=3)
        self._mode = "off"
        self._label = ""
        self._state = None

    def _replay_worker(self, path: Path, speed: float) -> None:
        prev_ts: float | None = None
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if self._stop.is_set():
                    return
                row = parse_line(line)
                if not row:
                    continue
                now_ts = _ts_seconds(row[2])
                if prev_ts is not None and now_ts is not None:
                    delay = (now_ts - prev_ts) / speed
                    if 0 < delay < 30:
                        time.sleep(delay)
                prev_ts = now_ts or prev_ts
                with self._lock:
                    self._state.feed(*row)
        self._mode = "off"
        self._label += " (finito)"

    # --- lettura --------------------------------------------------------
    def status(self) -> dict[str, Any]:
        s = self._state
        return {
            "mode": self._mode,
            "label": self._label,
            "session": (s.session_info.get("Meeting", {}).get("Name", "") + " · "
                        + s.session_info.get("Name", "")) if s else None,
            "messages": s.messages if s else 0,
        }

    def snapshot(self, pos_after: str | None = None) -> dict[str, Any]:
        """Stato per il frontend: torre + posizioni nuove + contesto."""
        with self._lock:
            s = self._state
            if s is None:
                return {"mode": "off"}
            return {
                "mode": self._mode,
                "label": self._label,
                "session": s.session_info,
                "lap_count": s.lap_count,
                "tower": self._tower(s),
                "positions": self._positions(s, pos_after),
                "track_status": s.track_status[-1][1] if s.track_status else 1,
                "weather": s.weather,
                "race_control": s.race_control[-25:],
                "radio": s.radio[-10:],
                "championship": s.championship or None,
            }

    @staticmethod
    def _positions(s: LiveState, after: str | None) -> dict[str, list]:
        out: dict[str, list] = {}
        for num, pts in s.positions.items():
            if after:
                fresh = [p for p in pts if p[0] > after]
            else:
                fresh = pts[-600:]  # primo caricamento: ultima manciata di minuti
            if fresh:
                out[num] = [[p[0], p[1], p[2]] for p in fresh]
        return out

    @staticmethod
    def _tower(s: LiveState) -> list[dict[str, Any]]:
        rows = []
        for num, t in s.timing.items():
            d = s.drivers.get(num, {})
            sectors = []
            for i in ("0", "1", "2"):
                sec = (t.get("Sectors") or {}).get(i) or {}
                segs = sec.get("Segments") or {}
                if isinstance(segs, dict):
                    seg_list = [segs[k].get("Status", 0)
                                for k in sorted(segs, key=lambda x: int(x))
                                if isinstance(segs[k], dict)]
                else:
                    seg_list = [g.get("Status", 0) for g in segs]
                sectors.append({
                    "value": sec.get("Value") or "",
                    "pb": bool(sec.get("PersonalFastest")),
                    "ob": bool(sec.get("OverallFastest")),
                    "segments": seg_list,
                })
            stints = t and (s.timing_app.get(num, {}).get("Stints") or {})
            stint_list = ([v for _, v in sorted(stints.items(), key=lambda kv: int(kv[0]))]
                          if isinstance(stints, dict) else list(stints or []))
            last_stint = stint_list[-1] if stint_list else {}
            last = t.get("LastLapTime") or {}
            best = t.get("BestLapTime") or {}
            try:
                pos = int(t.get("Position", 0))
            except (TypeError, ValueError):
                pos = 0
            rows.append({
                "num": num,
                "pos": pos,
                "abbr": d.get("Tla", num),
                "team": d.get("TeamName", ""),
                "color": d.get("TeamColour", ""),
                "last": {"value": last.get("Value") or "",
                         "pb": bool(last.get("PersonalFastest")),
                         "ob": bool(last.get("OverallFastest"))},
                "best": best.get("Value") or "",
                "gap": t.get("TimeDiffToFastest")
                    or (t.get("GapToLeader") if isinstance(t.get("GapToLeader"), str) else "")
                    or "",
                "interval": t.get("TimeDiffToPositionAhead")
                    or ((t.get("IntervalToPositionAhead") or {}).get("Value")
                        if isinstance(t.get("IntervalToPositionAhead"), dict) else "")
                    or "",
                "in_pit": bool(t.get("InPit")),
                "pit_out": bool(t.get("PitOut")),
                "retired": bool(t.get("Retired") or t.get("Stopped")),
                "laps": t.get("NumberOfLaps"),
                "pits": t.get("NumberOfPitStops"),
                "sectors": sectors,
                "tyre": {"compound": last_stint.get("Compound", ""),
                         "new": last_stint.get("New") == "true",
                         "age": (last_stint.get("TotalLaps")
                                 if last_stint.get("TotalLaps") is not None else None)},
            })
        rows.sort(key=lambda r: r["pos"] if r["pos"] > 0 else 99)
        return rows


live_source = LiveSource()
