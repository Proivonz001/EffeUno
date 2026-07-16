import { useEffect, useRef, useState } from 'react'
import './App.css'
import { getEvents, getFeed, getReplay, waitForSession } from './api'
import type { EventInfo, FeedData, ReplayData } from './api'
import Charts from './Charts'
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

type SessionCode = 'R' | 'S' | 'Q'
const SESSION_LABELS: Record<SessionCode, string> = {
  R: 'Gara', S: 'Sprint', Q: 'Qualifica',
}

/** icona meteo: sole quando e' asciutto, nuvola con gocce quando piove */
function WeatherIcon({ rain }: { rain: boolean }) {
  return rain ? (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-label="pioggia">
      <path d="M7 14a4.5 4.5 0 1 1 .8-8.9A5.5 5.5 0 0 1 18.3 7.6 3.7 3.7 0 0 1 17.5 14z"
        fill="#9ab" />
      <g stroke="#4aa3e0" strokeWidth="1.6" strokeLinecap="round">
        <line x1="8.5" y1="16.5" x2="7.5" y2="19.5" />
        <line x1="12.5" y1="16.5" x2="11.5" y2="19.5" />
        <line x1="16.5" y1="16.5" x2="15.5" y2="19.5" />
      </g>
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-label="sereno">
      <circle cx="12" cy="12" r="4.5" fill="#f5c542" />
      <g stroke="#f5c542" strokeWidth="1.6" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4
          return (
            <line key={i}
              x1={12 + Math.cos(a) * 6.5} y1={12 + Math.sin(a) * 6.5}
              x2={12 + Math.cos(a) * 9} y2={12 + Math.sin(a) * 9} />
          )
        })}
      </g>
    </svg>
  )
}

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
  const [session, setSession] = useState<SessionCode>('R')
  const [loaded, setLoaded] = useState<{ year: number; event: string; session: SessionCode } | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [loadingFor, setLoadingFor] = useState(0)
  const [error, setError] = useState('')
  const [replay, setReplay] = useState<ReplayData | null>(null)
  const [feedData, setFeedData] = useState<FeedData | null>(null)
  const [tab, setTab] = useState<'replay' | 'charts' | 'compare'>('replay')

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
      await waitForSession(year, event, session, setLoadingFor)
      setReplay(await getReplay(year, event, session))
      // il feed non e' vitale: se manca (es. niente team radio) si va avanti
      setFeedData(null)
      getFeed(year, event, session)
        .then(setFeedData)
        .catch(() => setFeedData({ race_control: [], radio: [], weather: [] }))
      setLoaded({ year, event, session })
      setFocus(null)
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

  // il weekend selezionato ha la Sprint?
  const hasSprint = events.find(e => e.name === event)?.format.includes('sprint') ?? false
  useEffect(() => {
    if (!hasSprint && session === 'S') setSession('R')
  }, [hasSprint, session])

  // campione meteo piu' recente al tempo del replay
  let wx: FeedData['weather'][number] | null = null
  if (feedData?.weather.length) {
    for (const s of feedData.weather) {
      if (s[0] <= time) wx = s
      else break
    }
    wx = wx ?? feedData.weather[0]
  }

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
        <select value={session} onChange={e => setSession(e.target.value as SessionCode)}>
          {(['R', ...(hasSprint ? ['S'] : []), 'Q'] as SessionCode[]).map(s => (
            <option key={s} value={s}>{SESSION_LABELS[s]}</option>
          ))}
        </select>
        <button onClick={load} disabled={phase === 'loading'}>
          {phase === 'loading' ? `Caricamento… ${loadingFor.toFixed(0)}s` : 'Carica'}
        </button>
        {replay && loaded && (
          <nav className="tabs">
            <button className={tab === 'replay' ? 'active' : ''} onClick={() => setTab('replay')}>
              Replay
            </button>
            {loaded.session !== 'Q' && (
              <button className={tab === 'charts' ? 'active' : ''} onClick={() => setTab('charts')}>
                Grafici
              </button>
            )}
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
            {wx && (
              <span
                className="weather"
                title={`aria ${wx[1]}° · pista ${wx[2]}° · vento ${wx[4]} m/s da ${wx[5]}°${wx[3] ? ' · pioggia' : ''}`}
              >
                <WeatherIcon rain={wx[3]} />
                {wx[1].toFixed(0)}°<em>aria</em> {wx[2].toFixed(0)}°<em>pista</em>
                <span className="wind" style={{ transform: `rotate(${(wx[5] + 180) % 360}deg)` }}>↑</span>
                {wx[4].toFixed(0)}<em>m/s</em>
                {wx[3] && <span className="rain">PIOGGIA</span>}
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
      {replay && loaded && tab === 'replay' && (
        <div className="main">
          <Leaderboard
            replay={replay} time={time}
            mode={loaded.session === 'Q' ? 'quali' : 'race'}
            focus={focus} onFocus={setFocus}
          />
          <TrackMap
            replay={replay} time={time} focus={focus} onFocus={setFocus}
            wind={wx ? [wx[4], wx[5]] : null}
          />
          {feedData && <Feed feed={feedData} replay={replay} time={time} focus={focus} />}
        </div>
      )}
      {replay && loaded && tab === 'charts' && (
        <Charts key={`${loaded.year}-${loaded.event}-${loaded.session}`} replay={replay} />
      )}
      {replay && loaded && tab === 'compare' && (
        <Compare year={loaded.year} event={loaded.event} session={loaded.session} />
      )}
    </div>
  )
}
