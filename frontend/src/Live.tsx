import { useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE } from './api'
import { TyreIcon } from './Leaderboard'
import { teamColor } from './palette'
import { contrastColor } from './replay'

/** colori dei microsettori (codici del feed, come la grafica ufficiale) */
const SEG_COLORS: Record<number, string> = {
  0: '#333',        // non ancora percorso
  2048: '#f1c40f',  // percorso
  2049: '#2ecc71',  // personal best
  2051: '#b455ff',  // overall best
  2052: '#e74c3c',  // giallo/stop in quel tratto
  2064: '#3498db',  // in pit lane
}

interface TowerSector {
  value: string
  pb: boolean
  ob: boolean
  segments: number[]
}

interface TowerRow {
  num: string
  pos: number
  abbr: string
  team: string
  color: string
  last: { value: string; pb: boolean; ob: boolean }
  best: string
  best_ob: boolean
  best_sectors: { value: string; ob: boolean }[]
  gap: string
  interval: string
  in_pit: boolean
  pit_out: boolean
  retired: boolean
  laps: number | null
  pits: number | null
  sectors: TowerSector[]
  tyre: { compound: string; new: boolean; age: number | null }
}

interface LiveSnapshot {
  mode: string
  label?: string
  session?: Record<string, unknown>
  lap_count?: { CurrentLap?: number; TotalLaps?: number }
  tower?: TowerRow[]
  positions?: Record<string, [string, number, number][]>
  track_status?: number
  weather?: Record<string, string>
  race_control?: { Utc?: string; Message?: string; Flag?: string }[]
  radio?: { Utc?: string; RacingNumber?: string; Path?: string }[]
  championship?: unknown
}

interface Recording { name: string; mb: number }

const timeCls = (t: { pb: boolean; ob: boolean }) =>
  t.ob ? 'lt-ob' : t.pb ? 'lt-pb' : ''

function rowColor(r: TowerRow, i: number): string {
  return r.color && /^[0-9a-fA-F]{6}$/.test(r.color)
    ? `#${r.color}` : teamColor(r.team, i)
}

/** mappa live: la pista si disegna da sola accumulando le posizioni */
function LiveMap({ positions, tower }: {
  positions: Map<string, [number, number][]>
  tower: TowerRow[]
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = devicePixelRatio
    if (canvas.width !== canvas.clientWidth * dpr) {
      canvas.width = canvas.clientWidth * dpr
      canvas.height = canvas.clientHeight * dpr
    }
    const ctx = canvas.getContext('2d')!
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const pts of positions.values()) {
      for (const [x, y] of pts) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
    if (x1 <= x0) return
    const pad = 24 * dpr
    const s = Math.min((canvas.width - 2 * pad) / (x1 - x0),
      (canvas.height - 2 * pad) / (y1 - y0))
    const ox = (canvas.width - (x1 - x0) * s) / 2
    const oy = (canvas.height - (y1 - y0) * s) / 2
    const toScreen = (x: number, y: number): [number, number] =>
      [ox + (x - x0) * s, canvas.height - (oy + (y - y0) * s)]

    // scia accumulata = il tracciato che emerge giro dopo giro
    ctx.fillStyle = '#2e2e2e'
    for (const pts of positions.values()) {
      for (const [x, y] of pts) {
        const [sx, sy] = toScreen(x, y)
        ctx.fillRect(sx, sy, 2 * dpr, 2 * dpr)
      }
    }
    const idx = new Map(tower.map((r, i) => [r.num, i]))
    for (const [num, pts] of positions) {
      const last = pts[pts.length - 1]
      if (!last) continue
      const r = tower[idx.get(num) ?? -1]
      if (r?.retired) continue
      const [sx, sy] = toScreen(last[0], last[1])
      const bg = r ? rowColor(r, idx.get(num) ?? 0) : '#888'
      ctx.fillStyle = bg
      ctx.beginPath()
      ctx.arc(sx, sy, 9 * dpr, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = contrastColor(bg)
      ctx.font = `700 ${6.5 * dpr}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(r?.abbr ?? num, sx, sy)
    }
  })
  return <canvas ref={canvasRef} className="live-map" />
}

export default function Live() {
  const [snap, setSnap] = useState<LiveSnapshot>({ mode: 'off' })
  const [recordings, setRecordings] = useState<Recording[]>([])
  const [speed, setSpeed] = useState(10)
  const [error, setError] = useState('')
  const positionsRef = useRef(new Map<string, [number, number][]>())
  const cursorRef = useRef<string | null>(null)

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const url = `${API_BASE}/api/live/state` +
          (cursorRef.current ? `?pos_after=${encodeURIComponent(cursorRef.current)}` : '')
        const res = await fetch(url)
        const d: LiveSnapshot = await res.json()
        if (stop) return
        for (const [num, pts] of Object.entries(d.positions ?? {})) {
          const arr = positionsRef.current.get(num) ?? []
          for (const [ts, x, y] of pts) {
            arr.push([x, y])
            if (ts > (cursorRef.current ?? '')) cursorRef.current = ts
          }
          // limite memoria: basta l'ultima ora abbondante
          positionsRef.current.set(num, arr.slice(-9000))
        }
        setSnap(d)
        setError('')
      } catch (e) {
        if (!stop) setError(String(e))
      }
    }
    tick()
    const iv = setInterval(tick, 2000)
    return () => { stop = true; clearInterval(iv) }
  }, [])

  useEffect(() => {
    fetch(`${API_BASE}/api/live/recordings`)
      .then(r => r.json()).then(setRecordings).catch(() => setRecordings([]))
  }, [snap.mode])

  const command = async (path: string) => {
    try {
      await fetch(`${API_BASE}${path}`, { method: 'POST' })
      positionsRef.current = new Map()
      cursorRef.current = null
    } catch (e) {
      setError(String(e))
    }
  }

  const tower = useMemo(() => snap.tower ?? [], [snap])
  const wx = snap.weather ?? {}

  return (
    <div className="live">
      <div className="live-bar">
        {snap.mode === 'off' ? (
          <>
            <span className="live-off">nessuna sessione live</span>
            {recordings.length > 0 && (
              <>
                <span className="hint-inline">replay di prova:</span>
                {recordings.map(r => (
                  <button key={r.name}
                    onClick={() => command(`/api/live/replay/${encodeURIComponent(r.name)}?speed=${speed}`)}>
                    ▶ {r.name.replace('.txt', '')} ({r.mb} MB)
                  </button>
                ))}
                <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
                  {[1, 5, 10, 30, 60].map(v => <option key={v} value={v}>{v}×</option>)}
                </select>
              </>
            )}
          </>
        ) : (
          <>
            <span className="live-dot">●</span>
            <span>{String((snap.session as any)?.Meeting?.Name ?? '')} · {String((snap.session as any)?.Name ?? '')}</span>
            <span className="live-label">{snap.label}</span>
            {snap.lap_count?.CurrentLap != null && (
              <span className="live-lapcount">
                giro {snap.lap_count.CurrentLap}/{snap.lap_count.TotalLaps}
              </span>
            )}
            {wx.AirTemp && (
              <span className="weather">
                {Number(wx.AirTemp).toFixed(0)}°<em>aria</em>{' '}
                {Number(wx.TrackTemp ?? 0).toFixed(0)}°<em>pista</em>
                {wx.Rainfall === '1' && <span className="rain">PIOGGIA</span>}
              </span>
            )}
            <button onClick={() => command('/api/live/stop')}>■ stop</button>
          </>
        )}
        {error && <span className="error-inline">{error}</span>}
      </div>

      <div className="live-main">
        <div className="tower">
          <table>
            <thead>
              <tr>
                <th>P</th><th></th><th></th><th className="t-num">Tempo</th>
                <th className="t-num">Gap</th>
                <th className="t-num">S1</th><th className="t-num">S2</th>
                <th className="t-num">S3</th><th>Gomma</th>
              </tr>
            </thead>
            <tbody>
              {tower.map((r, i) => {
                const bg = rowColor(r, i)
                return [
                  <tr key={`${r.num}-last`} className={`row-last ${r.retired ? 'out' : ''}`}>
                    <td className="pos" rowSpan={2}>{r.pos || ''}</td>
                    <td rowSpan={2}>
                      <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                        {r.abbr}
                      </span>
                    </td>
                    <td className="t-label">LAST</td>
                    <td className={`t-num ${timeCls(r.last)}`}>
                      {r.in_pit ? <span className="box">BOX</span>
                        : r.pit_out ? <span className="pit-out">OUT LAP</span>
                        : r.last.value}
                    </td>
                    <td className="t-num t-int">{r.interval}</td>
                    <td className="minisectors" colSpan={3}>
                      {r.sectors.map((s, k) => (
                        <span key={k} className="ms-group">
                          {s.segments.map((code, j) => (
                            <i key={j} style={{ background: SEG_COLORS[code] ?? '#555' }} />
                          ))}
                        </span>
                      ))}
                    </td>
                    <td className="tyre-cell" rowSpan={2}
                      title="mescola · giri percorsi con questo treno (usura); * = treno usato">
                      {r.tyre.compound && (
                        <>
                          <TyreIcon c={r.tyre.compound[0]} />
                          <span className="age">
                            {r.tyre.age ?? ''}{r.tyre.new ? '' : '*'}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>,
                  <tr key={`${r.num}-best`} className={`row-best ${r.retired ? 'out' : ''}`}>
                    <td className="t-label">BEST</td>
                    <td className={`t-num ${r.best_ob ? 'lt-ob' : ''}`}>{r.best}</td>
                    <td className="t-num t-int">{r.gap}</td>
                    {r.best_sectors.map((s, k) => (
                      <td key={k} className={`t-num t-sec ${s.ob ? 'lt-ob' : ''}`}>
                        {s.value}
                      </td>
                    ))}
                  </tr>,
                ]
              })}
            </tbody>
          </table>
        </div>
        <LiveMap positions={positionsRef.current} tower={tower} />
      </div>
    </div>
  )
}
