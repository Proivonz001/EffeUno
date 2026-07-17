"""Parser dello stream livetiming (SignalR registrato da record_live.py o
ricevuto live). Decodifica i topic — inclusi Position.z / CarData.z
(base64 + deflate) — e mantiene uno stato incrementale della sessione:
la base di LiveSource (direzione C) e del replayer di sviluppo.

Il feed manda un primo messaggio completo per topic e poi patch parziali:
i dict vanno fusi in profondita'; nelle patch le liste possono arrivare
come dict indicizzati ("2": {...}) — stessa convenzione vista nel feed
TeamRadio statico.
"""

import ast
import base64
import json
import zlib
from typing import Any


def parse_line(line: str) -> tuple[str, Any, str] | None:
    """Una riga del file registrato: ['Topic', payload, 'timestamp']."""
    line = line.strip()
    if not line:
        return None
    try:
        row = json.loads(line)
    except ValueError:
        try:
            row = ast.literal_eval(line)
        except (ValueError, SyntaxError):
            return None
    if not isinstance(row, list) or len(row) < 3:
        return None
    return str(row[0]), row[1], str(row[2])


def inflate(payload: str) -> Any:
    """Topic .z: base64 -> raw deflate -> JSON."""
    raw = zlib.decompress(base64.b64decode(payload), -zlib.MAX_WBITS)
    return json.loads(raw)


def deep_merge(dst: Any, patch: Any) -> Any:
    """Fusione in profondita' delle patch parziali del feed."""
    if not isinstance(dst, dict) or not isinstance(patch, dict):
        return patch
    for key, value in patch.items():
        dst[key] = deep_merge(dst.get(key), value)
    return dst


def _listify(value: Any) -> list[Any]:
    """Liste che nelle patch arrivano come dict indicizzati."""
    if isinstance(value, dict):
        return [value[k] for k in sorted(value, key=lambda x: int(x))
                if str(k).isdigit()]
    return list(value) if isinstance(value, list) else []


class LiveState:
    """Stato incrementale della sessione, alimentato messaggio per
    messaggio. Le strutture rispecchiano quelle del replay dove possibile."""

    def __init__(self) -> None:
        self.session_info: dict[str, Any] = {}
        self.drivers: dict[str, dict[str, Any]] = {}       # num -> DriverList
        self.timing: dict[str, dict[str, Any]] = {}        # num -> TimingData.Lines merged
        self.timing_app: dict[str, dict[str, Any]] = {}    # num -> TimingAppData (stint/gomme)
        self.timing_stats: dict[str, dict[str, Any]] = {}  # num -> TimingStats (best di sessione)
        self.lap_count: dict[str, Any] = {}
        self.track_status: list[tuple[str, int]] = []      # (ts, codice)
        self.weather: dict[str, Any] = {}
        self.race_control: list[dict[str, Any]] = []
        self.radio: list[dict[str, Any]] = []
        self.positions: dict[str, list[tuple[str, float, float]]] = {}  # num -> [(utc, x, y)]
        self.car_last: dict[str, dict[str, Any]] = {}      # num -> ultimi canali car
        self.championship: dict[str, Any] = {}
        self.messages = 0

    def feed(self, topic: str, payload: Any, ts: str) -> None:
        self.messages += 1
        if isinstance(payload, str):
            # .z: base64+deflate; altri topic a volte arrivano come JSON string
            try:
                payload = inflate(payload) if topic.endswith(".z") \
                    else json.loads(payload)
            except Exception:
                return
        if not isinstance(payload, dict):
            return
        handler = getattr(self, f"_on_{topic.replace('.z', '_z')}", None)
        if handler:
            handler(payload, ts)

    # --- topic handlers -------------------------------------------------
    def _on_SessionInfo(self, p: Any, ts: str) -> None:
        deep_merge(self.session_info, p)

    def _on_DriverList(self, p: Any, ts: str) -> None:
        if isinstance(p, dict):
            for num, info in p.items():
                if isinstance(info, dict):
                    deep_merge(self.drivers.setdefault(num, {}), info)

    def _on_TimingData(self, p: Any, ts: str) -> None:
        for num, line in (p.get("Lines") or {}).items():
            deep_merge(self.timing.setdefault(num, {}), line)

    def _on_TimingAppData(self, p: Any, ts: str) -> None:
        for num, line in (p.get("Lines") or {}).items():
            deep_merge(self.timing_app.setdefault(num, {}), line)

    def _on_TimingStats(self, p: Any, ts: str) -> None:
        # best di sessione per pilota: giro e settori, con Position nel
        # ranking (Position == 1 -> detentore del best assoluto: viola)
        for num, line in (p.get("Lines") or {}).items():
            deep_merge(self.timing_stats.setdefault(num, {}), line)

    def _on_LapCount(self, p: Any, ts: str) -> None:
        deep_merge(self.lap_count, p)

    def _on_TrackStatus(self, p: Any, ts: str) -> None:
        try:
            self.track_status.append((ts, int(p.get("Status"))))
        except (TypeError, ValueError):
            pass

    def _on_WeatherData(self, p: Any, ts: str) -> None:
        deep_merge(self.weather, p)

    def _on_RaceControlMessages(self, p: Any, ts: str) -> None:
        self.race_control.extend(m for m in _listify(p.get("Messages"))
                                 if isinstance(m, dict))

    def _on_TeamRadio(self, p: Any, ts: str) -> None:
        self.radio.extend(c for c in _listify(p.get("Captures"))
                          if isinstance(c, dict))

    def _on_ChampionshipPrediction(self, p: Any, ts: str) -> None:
        deep_merge(self.championship, p)

    def _on_Position_z(self, p: Any, ts: str) -> None:
        for batch in p.get("Position", []):
            utc = batch.get("Timestamp", ts)
            for num, e in (batch.get("Entries") or {}).items():
                x, y = e.get("X"), e.get("Y")
                if x is None or y is None:
                    continue
                self.positions.setdefault(num, []).append((utc, float(x), float(y)))

    def _on_CarData_z(self, p: Any, ts: str) -> None:
        for entry in p.get("Entries", []):
            for num, car in (entry.get("Cars") or {}).items():
                ch = car.get("Channels") or {}
                self.car_last[num] = {
                    "rpm": ch.get("0"), "speed": ch.get("2"),
                    "gear": ch.get("3"), "throttle": ch.get("4"),
                    "brake": ch.get("5"), "drs": ch.get("45"),
                }


def replay_file(path: str, state: LiveState | None = None) -> LiveState:
    """Alimenta uno stato con un file registrato, tutto d'un fiato."""
    state = state or LiveState()
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            row = parse_line(line)
            if row:
                state.feed(*row)
    return state
