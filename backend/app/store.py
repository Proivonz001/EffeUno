"""Cache in-process delle sessioni caricate.

Il primo load di una sessione richiede secondi (rete + parsing): il load
avviene in un thread di background e le API rispondono subito con lo stato,
cosi' il browser non resta mai appeso (brief §4).
"""

import threading
from dataclasses import dataclass, field
from typing import Optional

from .sources.base import DataSource, LoadedSession


@dataclass
class Entry:
    status: str = "loading"  # loading | ready | error
    session: Optional[LoadedSession] = None
    error: Optional[str] = None
    lock: threading.Lock = field(default_factory=threading.Lock)


class SessionStore:
    def __init__(self, source: DataSource) -> None:
        self._source = source
        self._entries: dict[tuple[int, str, str], Entry] = {}
        self._lock = threading.Lock()

    def get_or_load(self, year: int, event: str, session: str) -> Entry:
        key = (year, event.lower(), session.upper())
        with self._lock:
            entry = self._entries.get(key)
            if entry is not None:
                return entry
            entry = self._entries[key] = Entry()

        def _load() -> None:
            try:
                loaded = self._source.load_session(year, event, session)
                entry.session = loaded
                entry.status = "ready"
            except Exception as exc:  # noqa: BLE001 — lo stato d'errore va all'API
                entry.error = str(exc)
                entry.status = "error"

        threading.Thread(target=_load, daemon=True).start()
        return entry
