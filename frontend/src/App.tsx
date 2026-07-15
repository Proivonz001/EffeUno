import { useEffect, useRef, useState } from 'react'
import './App.css'
import { getEvents, getFeed, getReplay, waitForSession } from './api'
import type { EventInfo, FeedData, ReplayData } from './api'
import Compare from './Compare'
import Feed from './Feed'
import Leaderboard from './Leaderboard'
import { STATUS_INFO, trackStatusAt } from './replay'
import TrackMap from './TrackMap'

// FastF1 ha telemetria/posizioni affidabili dal 2018 in poi
const FIRST_YEAR = 2018
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from(
  { length: CURRENT_YEAR - FIRST_YEAR + 1 },
  (_, i) => CURRENT_YEAR - i,
)
const SPEEDS = [1, 2, 5, 10, 30]

function fmtClock(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = Math.floor(s % 60)
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function App() {
  const [year, setYear] = useState(2025)
  const [events, setEvents] = useState<EventInfo[]>([])
  const [event, setEvent] = useState('Italian Grand Prix')
  const [loaded, setLoaded] = useState<{ year: number; event: string } | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadingFor, setLoadingFor] = useState(0)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [feedData, setFeedData] = useState<FeedData | null>(null)
  const [tab, setTab] = useState<'replay' | 'compare'>('replay')

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(10)

  useEffect(() => {
    getEvents(year)
      .then(evs => {
        const past = evs.filter(e => new Date(e.date) < new Date())
        setEvents(past)
        // se la gara selezionata non esiste in questa stagione, prendi l'ultima corsa
        setEvent(cur => past.some(e => e.name === cur)
          ? cur
          : past[past.length - 1]?.name ?? '')
      })
      .catch(e => setError(String(e)))
  }, [year])

  async function load() {
    setPhase('loading')
    setLoadingFor(0)
    setError('')
    setReplay(null)
    setTab('replay')
    try {
      await waitForSession(year, event, 'R', setLoadingFor)
      setReplay(await getReplay(year, event, 'R'))
      // il feed non e' vitale: se manca (es. niente team radio) si va avanti
      setFeedData(null)
      getFeed(year, event, 'R')
        .then(setFeedData)
        .catch(() => setFeedData({ race_control: [], radio: [] }))
      setLoaded({ year, event })
      setTime(0)
      setPhase('ready')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }

  // orologio del replay: avanza time con rAF quando in play
  const playRef = useRef({ playing, speed, duration: 0 })
  playRef.current = { playing, speed, duration: replay?.duration_s ?? 0 }
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const { playing, speed, duration } = playRef.current
      if (playing && duration > 0) {
        setTime(t => Math.min(t + dt * speed, duration))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const status = replay ? STATUS_INFO[trackStatusAt(replay.track_status, time)] : null

  return (
    <div className="app">
      <header>
        <h1>EffeUno</h1>
        <select value={year} onChange={e => setYear(Number(e.target.value))}>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={event} onChange={e => setEvent(e.target.value)}>
          {events.map(ev => (
            <option key={ev.round} value={ev.name}>
              {ev.round}. {ev.name} ({ev.country})
            </option>
          ))}
        </select>
        <button onClick={load} disabled={phase === 'loading'}>
          {phase === 'loading' ? `Caricamento… ${loadingFor.toFixed(0)}s` : 'Carica gara'}
        </button>
        {replay && (
          <nav className="tabs">
            <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>
              Replay
            </button>
            <button className={tab === 'compare' ? 'active' : ''} onClick={() => setTab('compare')}>
              Confronto giri
            </button>
          </nav>
        )}
        {replay && tab === 'replay' && (
          <>
            <button onClick={() => setPlaying(p => !p)}>
              {playing ? '⏸' : '▶'}
            </button>
            <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
              {SPEEDS.map(s => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={replay.duration_s}
              step={1}
              value={time}
              onChange={e => setTime(Number(e.target.value))}
            />
            <span className="clock">{fmtClock(time)} / {fmtClock(replay.duration_s)}</span>
            {status && (
              <span className="flag" style={{ background: status.color }}>
                {status.label}
              </span>
            )}
          </>
        )}
      </header>
      {error && <p className="error">{error}</p>}
      {phase === 'idle' && !error && (
        <p className="hint">Scegli stagione e gara, poi premi «Carica gara». Il primo
          caricamento scarica i dati via FastF1 e può richiedere qualche decina di secondi.</p>
      )}
      {replay && tab === 'replay' && (
        <div className="main">
          <Leaderboard replay={replay} time={time} />
          <TrackMap replay={replay} time={time} />
          {feedData && <Feed feed={feedData} replay={replay} time={time} />}
        </div>
      )}
      {replay && loaded && tab === 'compare' && (
        <Compare year={loaded.year} event={loaded.event} />
      )}
    </div>
  )
}
