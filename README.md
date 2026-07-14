# EffeUno

Interactive F1 telemetry replay, built on [FastF1](https://docs.fastf1.dev/).
Load any race since 2018 and watch it unfold on an animated track map,
reconstructed from real positional telemetry — the kind of view you see on
live-timing streams, but for any historical session.

> **Status:** early scaffold. Backend + animated replay working end-to-end.

## How it works

```
React (Vite) ──HTTP/JSON──> FastAPI ──> FastF1 (+ local disk cache)
```

- **`backend/`** — FastAPI app wrapping FastF1 behind an abstract `DataSource`
  interface (so a future live-timing source can slot in without a rewrite).
  Sessions load in a background thread; the API reports `loading`/`ready` so
  the browser never blocks on the slow first download.
- **`frontend/`** — React + Vite. Canvas track map animating raw ~3.8 Hz
  position samples with linear interpolation, with play/pause, seek and
  playback speed up to 30×.
- **`scripts/`** — the Fase 0 exploration scripts that validated the approach
  (data sizes, sample rates, interpolation quality).

F1 data is **never** stored in this repository. Each user downloads it locally
through FastF1, which caches it on disk (`fastf1_cache/`, gitignored).

## Running locally

Requirements: Python ≥ 3.10, Node ≥ 20.

```bash
# backend
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt   # (bin/ on Linux/macOS)
.venv/Scripts/python -m uvicorn backend.app.main:app --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev
```

Open http://localhost:5173, pick a race, hit *Carica gara*. The first load of
a session downloads ~85 MB through FastF1 and takes a while; cached reloads
take seconds.

## Notice

EffeUno is an unofficial project and is in no way associated with the
Formula 1 companies. F1, FORMULA ONE, FORMULA 1, FIA FORMULA ONE WORLD
CHAMPIONSHIP, GRAND PRIX and related marks are trade marks of Formula One
Licensing B.V.

This project is non-commercial. It does not redistribute F1 data: all data is
fetched and cached locally by each user via FastF1. Team colors in the UI are
an approximated custom palette, not official assets.

## License

Code released under the MIT License.
