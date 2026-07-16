import { useMemo, useState } from 'react'
import type { ReplayData, ReplayDriver } from './api'
import { teamColor } from './palette'
import { contrastColor, trackStatusAt, TYRE_COLORS } from './replay'

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

function fmtLap(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`
}

/** tempi dei giri "puliti": esclusi il via, i giri con sosta e quelli
 *  non interamente in bandiera verde */
function cleanLaps(replay: ReplayData, d: ReplayDriver): number[] {
  const out: number[] = []
  for (const [n, start, end] of d.laps) {
    if (end === null || n === 1) continue
    if (d.pits.some(([a, b]) => a <= end && (b ?? a + 60) >= start)) continue
    if (trackStatusAt(replay.track_status, start) !== 1) continue
    if (replay.track_status.some(([t, c]) => t > start && t < end && c !== 1)) continue
    out.push(end - start)
  }
  return out
}

/** quantile su array gia' ordinato */
function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

/** ordine di arrivo (piu' giri, poi primo a chiudere l'ultimo) */
function finishOrder(replay: ReplayData): ReplayDriver[] {
  return [...replay.drivers].sort((a, b) => {
    const la = a.laps.length ? a.laps[a.laps.length - 1][0] : 0
    const lb = b.laps.length ? b.laps[b.laps.length - 1][0] : 0
    if (la !== lb) return lb - la
    const ea = a.laps.length ? a.laps[a.laps.length - 1][2] ?? Infinity : Infinity
    const eb = b.laps.length ? b.laps[b.laps.length - 1][2] ?? Infinity : Infinity
    return ea - eb
  })
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

/** Passo gara: distribuzione dei giri puliti per pilota (box plot),
 *  ordinato per mediana. */
function PaceChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 380
  const padL = 56
  const padB = 26
  const padT = 10

  const data = useMemo(() => {
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    return replay.drivers
      .map(d => {
        const times = cleanLaps(replay, d).sort((a, b) => a - b)
        if (times.length < 5) return null
        const q1 = quantile(times, 0.25)
        const med = quantile(times, 0.5)
        const q3 = quantile(times, 0.75)
        const iqr = q3 - q1
        const lo = times.find(v => v >= q1 - 1.5 * iqr)!
        const hi = [...times].reverse().find(v => v <= q3 + 1.5 * iqr)!
        const outliers = times.filter(v => v < lo || v > hi)
        return { d, color: teamColor(d.team, colorIdx.get(d.num) ?? 0), q1, med, q3, lo, hi, outliers }
      })
      .filter(Boolean)
      .map(b => b!)
      .sort((a, b) => a.med - b.med)
  }, [replay])

  if (data.length === 0) return null
  const yMin = Math.min(...data.map(b => Math.min(b.lo, ...b.outliers))) - 0.4
  const yMax = Math.max(...data.map(b => Math.max(b.hi, ...b.outliers))) + 0.4
  const yFlip = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB)
  const slot = (W - padL) / data.length
  const bw = Math.min(slot * 0.5, 30)
  const ticks: number[] = []
  const step = yMax - yMin > 6 ? 2 : 1
  for (let v = Math.ceil(yMin); v <= yMax; v += step) ticks.push(v)

  return (
    <div className="chart">
      <div className="chart-label">Passo gara <span>distribuzione dei giri puliti (senza via, soste, SC/VSC) — ordinato per mediana</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {ticks.map(v => (
          <g key={v}>
            <line x1={padL} x2={W} y1={yFlip(v)} y2={yFlip(v)} className="grid" />
            <text x={padL - 6} y={yFlip(v)} textAnchor="end" fill="#666" fontSize="10"
              dominantBaseline="middle">{fmtLap(v).slice(0, -4)}</text>
          </g>
        ))}
        {data.map((b, i) => {
          const cx = padL + slot * i + slot / 2
          return (
            <g key={b.d.num}>
              <line x1={cx} x2={cx} y1={yFlip(b.hi)} y2={yFlip(b.lo)} stroke="#555" strokeWidth="1" />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={yFlip(b.hi)} y2={yFlip(b.hi)} stroke="#555" strokeWidth="1" />
              <line x1={cx - bw / 4} x2={cx + bw / 4} y1={yFlip(b.lo)} y2={yFlip(b.lo)} stroke="#555" strokeWidth="1" />
              <rect x={cx - bw / 2} y={yFlip(b.q3)} width={bw} height={yFlip(b.q1) - yFlip(b.q3)}
                fill={b.color} rx="2" />
              <line x1={cx - bw / 2} x2={cx + bw / 2} y1={yFlip(b.med)} y2={yFlip(b.med)}
                stroke="#111" strokeWidth="2" />
              {b.outliers.map((v, j) => (
                <circle key={j} cx={cx} cy={yFlip(v)} r="2.5" fill="none" stroke="#777" strokeWidth="1" />
              ))}
              <text x={cx} y={H - 8} textAnchor="middle" fill={b.color} fontSize="10">{b.d.abbr}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Gap medio dal pilota piu' veloce, sui giri puliti. */
function AvgGapChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const rowH = 22
  const padL = 50

  const data = useMemo(() => {
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    return replay.drivers
      .map(d => {
        const times = cleanLaps(replay, d)
        if (times.length < 5) return null
        return {
          d,
          color: teamColor(d.team, colorIdx.get(d.num) ?? 0),
          avg: times.reduce((s, v) => s + v, 0) / times.length,
        }
      })
      .filter(Boolean)
      .map(b => b!)
      .sort((a, b) => a.avg - b.avg)
  }, [replay])

  if (data.length === 0) return null
  const base = data[0].avg
  const maxGap = Math.max(data[data.length - 1].avg - base, 0.5)
  const H = data.length * rowH + 8
  const barW = (gap: number) => (gap / maxGap) * (W - padL - 170)

  return (
    <div className="chart">
      <div className="chart-label">Gap medio dal più veloce <span>media dei giri puliti</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {data.map((b, i) => {
          const yy = 4 + i * rowH
          const gap = b.avg - base
          return (
            <g key={b.d.num}>
              <text x={padL - 8} y={yy + rowH / 2} textAnchor="end" fill={b.color}
                fontSize="11" dominantBaseline="middle">{b.d.abbr}</text>
              {i === 0 ? (
                <text x={padL + 4} y={yy + rowH / 2} fill="#ccc" fontSize="11"
                  dominantBaseline="middle">più veloce · {fmtLap(b.avg)}</text>
              ) : (
                <>
                  <rect x={padL} y={yy + 3} width={Math.max(barW(gap), 1)} height={rowH - 6}
                    fill={b.color} rx="2" />
                  <text x={padL + Math.max(barW(gap), 1) + 6} y={yy + rowH / 2} fill="#bbb"
                    fontSize="11" dominantBaseline="middle">+{gap.toFixed(3)}s</text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

interface Stint {
  from: number
  to: number
  compound: string
  fresh: boolean
}

function stints(d: ReplayDriver): Stint[] {
  const out: Stint[] = []
  let prev: number | null = null
  for (const [lap, compound, life, fresh] of d.tyres) {
    const cur = out[out.length - 1]
    // dentro uno stint la vita cresce di 1 a giro: se non cresce e' un
    // treno nuovo (anche usato, che riparte da vita > 1)
    const reset = !cur || compound !== cur.compound ||
      (life !== null && prev !== null && life <= prev)
    if (reset) {
      out.push({ from: lap, to: lap, compound, fresh: fresh ?? true })
    } else {
      cur.to = lap
    }
    prev = life ?? (prev === null ? null : prev + 1)
  }
  return out
}

/** Strategie gomme: stint per pilota, mescola a colori, usata tratteggiata. */
function StrategyChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const rowH = 22
  const padL = 50
  const padB = 24

  const order = useMemo(() => finishOrder(replay), [replay])
  const colorIdx = useMemo(() => new Map(replay.drivers.map((d, i) => [d.num, i])), [replay])
  const maxLap = Math.max(...replay.drivers.map(d => d.laps.length ? d.laps[d.laps.length - 1][0] : 0), 1)
  const H = order.length * rowH + padB
  const x = (lap: number) => padL + (lap / maxLap) * (W - padL - 30)

  return (
    <div className="chart">
      <div className="chart-label">Strategie gomme <span>numero = ultimo giro dello stint — tratteggiato: treno usato</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {Array.from({ length: Math.floor(maxLap / 10) }, (_, i) => (i + 1) * 10).map(l => (
          <line key={l} x1={x(l)} x2={x(l)} y1={0} y2={H - padB} className="grid" />
        ))}
        {order.map((d, i) => {
          const yy = 4 + i * rowH + rowH / 2 - 2
          return (
            <g key={d.num}>
              <text x={padL - 8} y={yy} textAnchor="end"
                fill={teamColor(d.team, colorIdx.get(d.num) ?? 0)}
                fontSize="11" dominantBaseline="middle">{d.abbr}</text>
              {stints(d).map((s, j) => (
                <g key={j}>
                  <line x1={x(s.from - 1) + 2} x2={x(s.to)} y1={yy} y2={yy}
                    stroke={TYRE_COLORS[s.compound] ?? '#999'} strokeWidth="7"
                    strokeDasharray={s.fresh ? undefined : '5 4'} />
                  <text x={x(s.to) + 4} y={yy} fill="#999" fontSize="9"
                    dominantBaseline="middle">{s.to}</text>
                </g>
              ))}
            </g>
          )
        })}
        {Array.from({ length: Math.floor(maxLap / 10) + 1 }, (_, i) => i * 10).map(l => (
          <text key={l} x={x(l)} y={H - 8} textAnchor="middle" fill="#666" fontSize="10">{l}</text>
        ))}
      </svg>
      <p className="axis-note">
        {(['S', 'M', 'H', 'I', 'W'] as const).map(c => (
          <span key={c} style={{ marginRight: 12 }}>
            <span style={{ color: TYRE_COLORS[c] }}>■</span> {
              { S: 'soft', M: 'media', H: 'dura', I: 'intermedia', W: 'bagnato' }[c]}
          </span>
        ))}
      </p>
    </div>
  )
}

export default function Charts({ replay }: Props) {
  return (
    <div className="charts">
      <PaceChart replay={replay} />
      <AvgGapChart replay={replay} />
      <StrategyChart replay={replay} />
      <LapChart replay={replay} />
      <GapChart replay={replay} />
    </div>
  )
}
