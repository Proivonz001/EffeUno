import { useEffect, useMemo, useState } from 'react'
import { getLaps, getLapTelemetry } from './api'
import type { LapInfo, LapTelemetry } from './api'

interface Props {
  year: number
  event: string
  session: string
}

interface Sel {
  driver: string
  lap: number
}

/** colori dei tre giri confrontabili: A (riferimento), B, C */
const COLORS = ['#4da3ff', '#ff8000', '#2ecc71']

function fmtLap(s: number | null): string {
  if (s === null) return '—'
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`
}

/** polyline SVG da una serie x/y gia' normalizzata sul viewBox */
function path(xs: number[], ys: number[], w: number, h: number,
  xMax: number, yMin: number, yMax: number): string {
  const pts: string[] = []
  for (let i = 0; i < xs.length; i++) {
    const x = (xs[i] / xMax) * w
    const y = h - ((ys[i] - yMin) / (yMax - yMin)) * h
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`)
  }
  return pts.join(' ')
}

/** interpolazione lineare di ys su xs (crescente) nel punto x */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0]
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1]
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo])
  return ys[lo] + (ys[hi] - ys[lo]) * f
}

const lastDist = (t: LapTelemetry) => t.distance[t.distance.length - 1]

/** Delta cumulativo di ogni giro rispetto al giro A (riferimento):
 *  sopra lo zero il giro e' in ritardo su A. */
function DeltaChart({ tels }: { tels: (LapTelemetry | null)[] }) {
  const W = 1000
  const H = 140
  const ref = tels[0]
  const others = tels.slice(1).map((t, i) => ({ tel: t, color: COLORS[i + 1] }))
    .filter(o => o.tel !== null)
  if (!ref || others.length === 0) return null

  const xMax = Math.max(...tels.filter(Boolean).map(t => lastDist(t!)), 1)
  const series = others.map(({ tel, color }) => {
    const dMax = Math.min(lastDist(ref), lastDist(tel!))
    const dist: number[] = []
    const delta: number[] = []
    for (const d of ref.distance) {
      if (d > dMax) break
      dist.push(d)
      delta.push(interp(tel!.distance, tel!.time, d) - interp(ref.distance, ref.time, d))
    }
    return { dist, delta, color }
  })
  const span = Math.max(...series.flatMap(s => s.delta.map(Math.abs)), 0.05) * 1.1
  const zeroY = H / 2

  return (
    <div className="chart">
      <div className="chart-label">
        Δ tempo cumulativo <span>rispetto ad <b style={{ color: COLORS[0] }}>A</b> —
        sopra lo zero: in ritardo · scala ±{span.toFixed(1)} s</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={zeroY} y2={zeroY} className="grid zero" />
        {series.map((s, i) => (
          <polyline key={i} points={path(s.dist, s.delta, W, H, xMax, -span, span)}
            fill="none" stroke={s.color} strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  )
}

/** codici del canale DRS grezzo con ala aperta */
const DRS_OPEN = new Set([10, 12, 14])

/** tratti [distanza inizio, fine] con DRS aperto lungo il giro */
function drsRanges(tel: LapTelemetry): [number, number][] {
  if (!tel.drs) return []
  const out: [number, number][] = []
  let open: number | null = null
  for (let i = 0; i < tel.drs.length; i++) {
    const isOpen = DRS_OPEN.has(tel.drs[i])
    if (isOpen && open === null) open = tel.distance[i]
    if (!isOpen && open !== null) {
      out.push([open, tel.distance[i]])
      open = null
    }
  }
  if (open !== null) out.push([open, tel.distance[tel.distance.length - 1]])
  return out
}

function Chart({ tels, field, height, label, unit }: {
  tels: (LapTelemetry | null)[]
  field: 'speed' | 'throttle' | 'brake' | 'rpm'
  height: number
  label: string
  unit: string
}) {
  const W = 1000
  const series = tels.map(tel =>
    tel && tel[field] ? { dist: tel.distance, vals: tel[field]!.map(Number) } : null)
  const present = series.filter(Boolean).map(s => s!)
  if (present.length === 0) return null
  const xMax = Math.max(...present.map(s => s.dist[s.dist.length - 1]), 1)
  const yMax = field === 'speed' || field === 'rpm'
    ? Math.max(...present.flatMap(s => s.vals), 1) * 1.05
    : field === 'throttle' ? 100 : 1
  // strisce DRS in alto (solo grafico velocita', stagioni con il canale):
  // una riga sottile per giro, dove l'ala era aperta
  const drs = field === 'speed'
    ? tels.map(tel => tel ? drsRanges(tel) : []) : []
  const hasDrs = drs.some(r => r.length > 0)

  return (
    <div className="chart">
      <div className="chart-label">{label} <span>{unit}{hasDrs ? ' — strisce in alto: DRS aperto' : ''}</span></div>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} x2={W} y1={height * f} y2={height * f} className="grid" />
        ))}
        {drs.map((ranges, i) => ranges.map(([a, b], j) => (
          <rect key={`${i}-${j}`} x={(a / xMax) * W} y={2 + i * 5}
            width={Math.max(((b - a) / xMax) * W, 1)} height={3.2}
            fill={COLORS[i]} opacity="0.85" />
        )))}
        {series.map((s, i) => s && (
          <polyline key={i} points={path(s.dist, s.vals, W, height, xMax, 0, yMax)}
            fill="none" stroke={COLORS[i]} strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  )
}

function LapPicker({ laps, sel, onChange, color, optional }: {
  laps: LapInfo[]
  sel: Sel | null
  onChange: (s: Sel | null) => void
  color: string
  optional?: boolean
}) {
  const drivers = useMemo(() => [...new Set(laps.map(l => l.driver))].sort(), [laps])
  const driverLaps = sel ? laps.filter(l => l.driver === sel.driver && l.time_s !== null) : []
  return (
    <span className="lap-picker" style={{ borderColor: sel ? color : '#444' }}>
      <select value={sel?.driver ?? ''} onChange={e => {
        const driver = e.target.value
        if (!driver) return onChange(null)
        const first = laps.find(l => l.driver === driver && l.time_s !== null)
        onChange({ driver, lap: first?.lap ?? 1 })
      }}>
        {optional && <option value="">—</option>}
        {drivers.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      {sel && (
        <select value={sel.lap} onChange={e => onChange({ ...sel, lap: Number(e.target.value) })}>
          {driverLaps.map(l => (
            <option key={l.lap} value={l.lap}>
              G{l.lap} — {fmtLap(l.time_s)}{l.accurate ? '' : ' ⚠'}
            </option>
          ))}
        </select>
      )}
    </span>
  )
}

export default function Compare({ year, event, session }: Props) {
  const [laps, setLaps] = useState<LapInfo[]>([])
  const [sels, setSels] = useState<(Sel | null)[]>([null, null, null])
  const [tels, setTels] = useState<(LapTelemetry | null)[]>([null, null, null])
  const [error, setError] = useState('')

  const setSel = (i: number) => (sel: Sel | null) =>
    setSels(prev => {
      const next = [...prev]
      next[i] = sel
      return next
    })

  useEffect(() => {
    getLaps(year, event, session).then(ls => {
      setLaps(ls)
      // default: i due giri validi piu' veloci di piloti diversi
      const valid = ls.filter(l => l.time_s !== null && l.accurate)
        .sort((a, b) => a.time_s! - b.time_s!)
      const a = valid[0]
      const b = valid.find(l => l.driver !== a?.driver)
      setSels([
        a ? { driver: a.driver, lap: a.lap } : null,
        b ? { driver: b.driver, lap: b.lap } : null,
        null,
      ])
    }).catch(e => setError(String(e)))
  }, [year, event, session])

  // un effetto per slot: setSel preserva l'identita' degli altri elementi,
  // quindi cambia solo il fetch del giro toccato
  for (const i of [0, 1, 2]) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useEffect(() => {
      const sel = sels[i]
      setTels(prev => {
        const next = [...prev]
        next[i] = null
        return next
      })
      if (!sel) return
      let stale = false
      getLapTelemetry(year, event, session, sel.driver, sel.lap)
        .then(tel => {
          if (stale) return
          setTels(prev => {
            const next = [...prev]
            next[i] = tel
            return next
          })
        })
        .catch(e => setError(String(e)))
      return () => { stale = true }
    }, [year, event, session, sels[i]])
  }

  const info = (sel: Sel | null) => {
    const l = laps.find(x => sel && x.driver === sel.driver && x.lap === sel.lap)
    return l ? `${l.driver} G${l.lap} · ${fmtLap(l.time_s)} · ${l.compound ?? '?'}` : '…'
  }

  if (error) return <p className="error">{error}</p>
  if (!sels[0] || !sels[1]) return <p className="hint">Carico la lista giri…</p>

  const loading = sels.some((s, i) => s !== null && tels[i] === null)

  return (
    <div className="compare">
      <div className="compare-bar">
        <LapPicker laps={laps} sel={sels[0]} onChange={setSel(0)} color={COLORS[0]} />
        <span className="vs">vs</span>
        <LapPicker laps={laps} sel={sels[1]} onChange={setSel(1)} color={COLORS[1]} />
        <LapPicker laps={laps} sel={sels[2]} onChange={setSel(2)} color={COLORS[2]} optional />
        <span className="legend">
          {sels.map((sel, i) => sel && (
            <span key={i} style={{ color: COLORS[i] }}>■ {info(sel)}</span>
          ))}
        </span>
      </div>
      {loading && <p className="hint">Carico la telemetria…</p>}
      <DeltaChart tels={tels} />
      <Chart tels={tels} field="speed" height={260} label="Velocità" unit="km/h" />
      <Chart tels={tels} field="throttle" height={110} label="Acceleratore" unit="%" />
      <Chart tels={tels} field="brake" height={60} label="Freno" unit="on/off" />
      <Chart tels={tels} field="rpm" height={140} label="Regime motore" unit="giri/min" />
      <p className="axis-note">asse orizzontale: distanza lungo il giro</p>
    </div>
  )
}
