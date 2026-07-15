import { useMemo, useState } from 'react'
import type { ReplayData, ReplayDriver } from './api'
import { teamColor } from './palette'
import { contrastColor } from './replay'

interface Props {
  replay: ReplayData
}

const COLOR_A = '#4da3ff'
const COLOR_B = '#ff8000'

/** istante di fine di ogni giro per pilota (null se non completato) */
function lapEnd(d: ReplayDriver, n: number): number | null {
  const lap = d.laps.find(l => l[0] === n)
  return lap ? lap[2] : null
}

/** Lap chart classico: posizione al traguardo di ogni giro, una linea per
 *  pilota. Il secondo pilota di ogni squadra e' tratteggiato. */
function LapChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const rowH = 20
  const padL = 44
  const padR = 44
  const padT = 12

  const data = useMemo(() => {
    const totalLaps = Math.max(...replay.drivers.map(d => d.laps.length ? d.laps[d.laps.length - 1][0] : 0))
    // posizione per giro: ordine di passaggio sul traguardo
    const posByDriver = new Map<string, [number, number][]>()
    for (let n = 1; n <= totalLaps; n++) {
      const crossed = replay.drivers
        .map(d => ({ num: d.num, end: lapEnd(d, n) }))
        .filter(e => e.end !== null)
        .sort((a, b) => a.end! - b.end!)
      crossed.forEach((e, i) => {
        if (!posByDriver.has(e.num)) posByDriver.set(e.num, [])
        posByDriver.get(e.num)!.push([n, i + 1])
      })
    }
    return { totalLaps, posByDriver }
  }, [replay])

  const H = padT + rowH * replay.drivers.length + 8
  const x = (n: number) => padL + ((n - 1) / Math.max(data.totalLaps - 1, 1)) * (W - padL - padR)
  const y = (p: number) => padT + (p - 1) * rowH + rowH / 2

  // tratteggio per il secondo pilota della stessa squadra
  const seen = new Map<string, number>()
  const dash = new Map<string, boolean>()
  replay.drivers.forEach(d => {
    const k = seen.get(d.team) ?? 0
    dash.set(d.num, k % 2 === 1)
    seen.set(d.team, k + 1)
  })
  const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))

  return (
    <div className="chart">
      <div className="chart-label">Posizioni per giro <span>ordine di passaggio sul traguardo — tratteggiato: seconda guida</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {replay.drivers.map(d => {
          const pts = data.posByDriver.get(d.num)
          if (!pts || pts.length === 0) return null
          const color = teamColor(d.team, colorIdx.get(d.num) ?? 0)
          const first = pts[0]
          const last = pts[pts.length - 1]
          return (
            <g key={d.num}>
              <polyline
                points={pts.map(([n, p]) => `${x(n).toFixed(1)},${y(p).toFixed(1)}`).join(' ')}
                fill="none" stroke={color} strokeWidth="1.6"
                strokeDasharray={dash.get(d.num) ? '5 3' : undefined}
              />
              <text x={x(first[0]) - 6} y={y(first[1])} textAnchor="end"
                fill={color} fontSize="10" dominantBaseline="middle">{d.abbr}</text>
              <text x={x(last[0]) + 6} y={y(last[1])}
                fill={color} fontSize="10" dominantBaseline="middle">{d.abbr}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Distacco per giro tra due piloti: differenza dei tempi di passaggio
 *  sul traguardo, giro per giro. */
function GapChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 220

  const finishers = useMemo(
    () => [...replay.drivers].sort((a, b) => {
      const la = a.laps.length ? a.laps[a.laps.length - 1][0] : 0
      const lb = b.laps.length ? b.laps[b.laps.length - 1][0] : 0
      if (la !== lb) return lb - la
      const ea = a.laps.length ? a.laps[a.laps.length - 1][2] ?? Infinity : Infinity
      const eb = b.laps.length ? b.laps[b.laps.length - 1][2] ?? Infinity : Infinity
      return ea - eb
    }),
    [replay],
  )
  const [numA, setNumA] = useState(finishers[0]?.num ?? '')
  const [numB, setNumB] = useState(finishers[1]?.num ?? '')
  const a = replay.drivers.find(d => d.num === numA)
  const b = replay.drivers.find(d => d.num === numB)

  const pts = useMemo(() => {
    if (!a || !b) return []
    const out: [number, number][] = []
    const maxLap = Math.min(
      a.laps.length ? a.laps[a.laps.length - 1][0] : 0,
      b.laps.length ? b.laps[b.laps.length - 1][0] : 0,
    )
    for (let n = 1; n <= maxLap; n++) {
      const ea = lapEnd(a, n)
      const eb = lapEnd(b, n)
      if (ea !== null && eb !== null) out.push([n, ea - eb])
    }
    return out
  }, [a, b])

  const span = Math.max(...pts.map(p => Math.abs(p[1])), 1) * 1.1
  const maxLap = pts.length ? pts[pts.length - 1][0] : 1
  const x = (n: number) => ((n - 1) / Math.max(maxLap - 1, 1)) * W
  const y = (v: number) => H / 2 - (v / span) * (H / 2)
  const poly = pts.map(([n, v]) => `${x(n).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const tag = (d: ReplayDriver | undefined, color: string) => d && (
    <span className="tag" style={{ background: color, color: contrastColor(color) }}>{d.abbr}</span>
  )

  return (
    <div className="chart">
      <div className="chart-label">
        Distacco per giro <span>sopra lo zero: <b style={{ color: COLOR_A }}>A</b> dietro ·
        scala ±{span.toFixed(0)} s</span>
      </div>
      <div className="gap-pickers">
        <span>A {tag(a, COLOR_A)}</span>
        <select value={numA} onChange={e => setNumA(e.target.value)}>
          {finishers.map(d => <option key={d.num} value={d.num}>{d.abbr}</option>)}
        </select>
        <span className="vs">vs</span>
        <span>B {tag(b, COLOR_B)}</span>
        <select value={numB} onChange={e => setNumB(e.target.value)}>
          {finishers.map(d => <option key={d.num} value={d.num}>{d.abbr}</option>)}
        </select>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="grid zero" />
        <clipPath id="gap-above"><rect x={0} y={0} width={W} height={H / 2} /></clipPath>
        <clipPath id="gap-below"><rect x={0} y={H / 2} width={W} height={H / 2} /></clipPath>
        <polyline points={poly} fill="none" stroke={COLOR_A} strokeWidth="1.6" clipPath="url(#gap-above)" />
        <polyline points={poly} fill="none" stroke={COLOR_B} strokeWidth="1.6" clipPath="url(#gap-below)" />
      </svg>
      <p className="axis-note">asse orizzontale: numero di giro — il tratto ha il colore del pilota in svantaggio</p>
    </div>
  )
}

export default function Charts({ replay }: Props) {
  return (
    <div className="charts">
      <LapChart replay={replay} />
      <GapChart replay={replay} />
    </div>
  )
}
