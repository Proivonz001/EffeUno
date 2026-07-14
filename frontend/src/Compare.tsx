import { useEffect, useMemo, useState } from 'react'
import { getLaps, getLapTelemetry } from './api'
import type { LapInfo, LapTelemetry } from './api'

interface Props {
  year: number
  event: string
}

interface Sel {
  driver: string
  lap: number
}

const COLOR_A = '#4da3ff'
const COLOR_B = '#ff8000'

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

function Chart({ a, b, field, height, label, unit }: {
  a: LapTelemetry | null
  b: LapTelemetry | null
  field: 'speed' | 'throttle' | 'brake'
  height: number
  label: string
  unit: string
}) {
  const W = 1000
  const series = [a, b].map(tel =>
    tel ? { dist: tel.distance, vals: tel[field].map(Number) } : null)
  const xMax = Math.max(...series.filter(Boolean).map(s => s!.dist[s!.dist.length - 1]), 1)
  const yMax = field === 'speed'
    ? Math.max(...series.filter(Boolean).flatMap(s => s!.vals), 1) * 1.05
    : field === 'throttle' ? 100 : 1

  return (
    <div className="chart">
      <div className="chart-label">{label} <span>{unit}</span></div>
      <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={0} x2={W} y1={height * f} y2={height * f} className="grid" />
        ))}
        {series[0] && (
          <polyline points={path(series[0].dist, series[0].vals, W, height, xMax, 0, yMax)}
            fill="none" stroke={COLOR_A} strokeWidth="1.5" />
        )}
        {series[1] && (
          <polyline points={path(series[1].dist, series[1].vals, W, height, xMax, 0, yMax)}
            fill="none" stroke={COLOR_B} strokeWidth="1.5" />
        )}
      </svg>
    </div>
  )
}

function LapPicker({ laps, sel, onChange, color }: {
  laps: LapInfo[]
  sel: Sel
  onChange: (s: Sel) => void
  color: string
}) {
  const drivers = useMemo(() => [...new Set(laps.map(l => l.driver))].sort(), [laps])
  const driverLaps = laps.filter(l => l.driver === sel.driver && l.time_s !== null)
  return (
    <span className="lap-picker" style={{ borderColor: color }}>
      <select value={sel.driver} onChange={e => {
        const driver = e.target.value
        const first = laps.find(l => l.driver === driver && l.time_s !== null)
        onChange({ driver, lap: first?.lap ?? 1 })
      }}>
        {drivers.map(d => <option key={d} value={d}>{d}</option>)}
      </select>
      <select value={sel.lap} onChange={e => onChange({ ...sel, lap: Number(e.target.value) })}>
        {driverLaps.map(l => (
          <option key={l.lap} value={l.lap}>
            G{l.lap} — {fmtLap(l.time_s)}{l.accurate ? '' : ' ⚠'}
          </option>
        ))}
      </select>
    </span>
  )
}

export default function Compare({ year, event }: Props) {
  const [laps, setLaps] = useState<LapInfo[]>([])
  const [selA, setSelA] = useState<Sel | null>(null)
  const [selB, setSelB] = useState<Sel | null>(null)
  const [telA, setTelA] = useState<LapTelemetry | null>(null)
  const [telB, setTelB] = useState<LapTelemetry | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    getLaps(year, event, 'R').then(ls => {
      setLaps(ls)
      // default: i due giri validi piu' veloci di piloti diversi
      const valid = ls.filter(l => l.time_s !== null && l.accurate)
        .sort((a, b) => a.time_s! - b.time_s!)
      const a = valid[0]
      const b = valid.find(l => l.driver !== a?.driver)
      if (a) setSelA({ driver: a.driver, lap: a.lap })
      if (b) setSelB({ driver: b.driver, lap: b.lap })
    }).catch(e => setError(String(e)))
  }, [year, event])

  useEffect(() => {
    if (!selA) return
    setTelA(null)
    getLapTelemetry(year, event, 'R', selA.driver, selA.lap)
      .then(setTelA).catch(e => setError(String(e)))
  }, [year, event, selA])

  useEffect(() => {
    if (!selB) return
    setTelB(null)
    getLapTelemetry(year, event, 'R', selB.driver, selB.lap)
      .then(setTelB).catch(e => setError(String(e)))
  }, [year, event, selB])

  const info = (sel: Sel | null) => {
    const l = laps.find(x => sel && x.driver === sel.driver && x.lap === sel.lap)
    return l ? `${l.driver} G${l.lap} · ${fmtLap(l.time_s)} · ${l.compound ?? '?'}` : '…'
  }

  if (error) return <p className="error">{error}</p>
  if (!selA || !selB) return <p className="hint">Carico la lista giri…</p>

  return (
    <div className="compare">
      <div className="compare-bar">
        <LapPicker laps={laps} sel={selA} onChange={setSelA} color={COLOR_A} />
        <span className="vs">vs</span>
        <LapPicker laps={laps} sel={selB} onChange={setSelB} color={COLOR_B} />
        <span className="legend">
          <span style={{ color: COLOR_A }}>■ {info(selA)}</span>
          <span style={{ color: COLOR_B }}>■ {info(selB)}</span>
        </span>
      </div>
      {(!telA || !telB) && <p className="hint">Carico la telemetria…</p>}
      <Chart a={telA} b={telB} field="speed" height={260} label="Velocità" unit="km/h" />
      <Chart a={telA} b={telB} field="throttle" height={110} label="Acceleratore" unit="%" />
      <Chart a={telA} b={telB} field="brake" height={60} label="Freno" unit="on/off" />
      <p className="axis-note">asse orizzontale: distanza lungo il giro</p>
    </div>
  )
}
