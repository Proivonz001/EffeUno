"""EffeUno backend — API FastAPI sopra la sorgente dati F1.

Avvio (dalla radice del repo):
    .venv/Scripts/python.exe -m uvicorn backend.app.main:app --reload --port 8000
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .sources.fastf1_source import FastF1Source
from .store import SessionStore

app = FastAPI(title="EffeUno API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

source = FastF1Source()
store = SessionStore(source)


@app.get("/api/events/{year}")
def events(year: int):
    return source.events(year)


def _ready_session(year: int, event: str, session: str):
    entry = store.get_or_load(year, event, session)
    if entry.status == "error":
        raise HTTPException(502, detail=entry.error)
    return entry


@app.get("/api/session/{year}/{event}/{session}")
def session_info(year: int, event: str, session: str):
    """Avvia il load se serve e riporta lo stato. Il client fa polling
    finche' status != loading, poi chiede replay/laps/telemetry."""
    entry = _ready_session(year, event, session)
    if entry.status == "loading":
        return {"status": "loading"}
    return {"status": "ready", **entry.session.info()}


@app.get("/api/replay/{year}/{event}/{session}")
def replay(year: int, event: str, session: str):
    entry = _ready_session(year, event, session)
    if entry.status == "loading":
        raise HTTPException(409, detail="session still loading")
    return entry.session.replay()


@app.get("/api/laps/{year}/{event}/{session}")
def laps(year: int, event: str, session: str):
    entry = _ready_session(year, event, session)
    if entry.status == "loading":
        raise HTTPException(409, detail="session still loading")
    return entry.session.laps()


@app.get("/api/telemetry/{year}/{event}/{session}/{driver}/{lap}")
def lap_telemetry(year: int, event: str, session: str, driver: str, lap: int):
    entry = _ready_session(year, event, session)
    if entry.status == "loading":
        raise HTTPException(409, detail="session still loading")
    try:
        return entry.session.lap_telemetry(driver, lap)
    except IndexError:
        raise HTTPException(404, detail=f"no lap {lap} for driver {driver}")
