import { useMemo, useState } from 'react'
import type { ReplayData, ReplayDriver } from './api'
import { teamColor } from './palette'
import { contrastColor, trackStatusAt, TYRE_COLORS } from './replay'

interface Props {
  replay: ReplayData
}

/** istante di fine di ogni giro per pilota (null se non completato) */
function lapEnd(d: ReplayDriver, n: number): number | null {
  const lap = d.laps.find(l => l[0] === n)
  return lap ? lap[2] : null
}

function fmtLap(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`
}

/** giri "puliti" come coppie [numero giro, tempo]: esclusi il via, i giri
 *  con sosta e quelli non interamente in bandiera verde. Con il
 *  TrackStatus per giro (dati nuovi) il filtro e' esatto per pilota;
 *  altrimenti si ripiega sullo stato pista globale. */
function cleanLapPairs(replay: ReplayData, d: ReplayDriver): [number, number][] {
  const statusByLap = d.lap_status?.length
    ? new Map(d.lap_status) : null
  const out: [number, number][] = []
  for (const [n, start, end] of d.laps) {
    if (end === null || n === 1) continue
    if (d.pits.some(([a, b]) => a <= end && (b ?? a + 60) >= start)) continue
    if (statusByLap) {
      if (statusByLap.get(n) !== '1') continue
    } else {
      if (trackStatusAt(replay.track_status, start) !== 1) continue
      if (replay.track_status.some(([t, c]) => t > start && t < end && c !== 1)) continue
    }
    out.push([n, end - start])
  }
  return out
}

function cleanLaps(replay: ReplayData, d: ReplayDriver): number[] {
  return cleanLapPairs(replay, d).map(p => p[1])
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

/** Distacco per giro: fino a 2 piloti confrontati con un riferimento,
 *  differenza dei tempi di passaggio sul traguardo giro per giro. */
function GapChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 240

  const finishers = useMemo(() => finishOrder(replay), [replay])
  const colorIdx = useMemo(() => new Map(replay.drivers.map((d, i) => [d.num, i])), [replay])
  const [numRef, setNumRef] = useState(finishers[0]?.num ?? '')
  const [numB, setNumB] = useState(finishers[1]?.num ?? '')
  const [numC, setNumC] = useState('')
  const ref = replay.drivers.find(d => d.num === numRef)

  const series = useMemo(() => {
    if (!ref) return []
    return [numB, numC]
      .map(num => replay.drivers.find(d => d.num === num))
      .filter((d): d is ReplayDriver => !!d && d.num !== ref.num)
      .map(d => {
        const pts: [number, number][] = []
        const maxLap = Math.min(
          ref.laps.length ? ref.laps[ref.laps.length - 1][0] : 0,
          d.laps.length ? d.laps[d.laps.length - 1][0] : 0,
        )
        for (let n = 1; n <= maxLap; n++) {
          const er = lapEnd(ref, n)
          const ed = lapEnd(d, n)
          if (er !== null && ed !== null) pts.push([n, ed - er])
        }
        return { d, color: teamColor(d.team, colorIdx.get(d.num) ?? 0), pts }
      })
  }, [replay, ref, numB, numC, colorIdx])

  const span = Math.max(...series.flatMap(s => s.pts.map(p => Math.abs(p[1]))), 1) * 1.1
  const maxLap = Math.max(...series.map(s => s.pts.length ? s.pts[s.pts.length - 1][0] : 1), 1)
  const x = (n: number) => ((n - 1) / Math.max(maxLap - 1, 1)) * (W - 40)
  const y = (v: number) => H / 2 - (v / span) * (H / 2 - 8)

  const tag = (d: ReplayDriver | undefined, color: string) => d && (
    <span className="tag" style={{ background: color, color: contrastColor(color) }}>{d.abbr}</span>
  )
  const pick = (value: string, onChange: (v: string) => void, optional: boolean) => (
    <select value={value} onChange={e => onChange(e.target.value)}>
      {optional && <option value="">—</option>}
      {finishers.map(d => <option key={d.num} value={d.num}>{d.abbr}</option>)}
    </select>
  )

  return (
    <div className="chart">
      <div className="chart-label">
        Distacco per giro <span>sopra lo zero: dietro il riferimento ·
        scala ±{span.toFixed(0)} s</span>
      </div>
      <div className="gap-pickers">
        <span>riferimento {tag(ref, '#888')}</span>
        {pick(numRef, setNumRef, false)}
        <span className="vs">vs</span>
        {series[0] && tag(series[0].d, series[0].color)}
        {pick(numB, setNumB, true)}
        {series[1] && tag(series[1].d, series[1].color)}
        {pick(numC, setNumC, true)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <line x1={0} x2={W} y1={H / 2} y2={H / 2} className="grid zero" />
        {series.map((s, i) => (
          <polyline key={s.d.num}
            points={s.pts.map(([n, v]) => `${x(n).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}
            fill="none" stroke={s.color} strokeWidth="1.6"
            strokeDasharray={series.slice(0, i).some(o => o.color === s.color) ? '6 4' : undefined} />
        ))}
      </svg>
      <p className="axis-note">asse orizzontale: numero di giro — linea zero: il riferimento</p>
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

/** Degrado per stint: tempi dei giri puliti in funzione dell'eta' della
 *  gomma, con retta di regressione per stint — la pendenza e' il degrado. */
function DegradationChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 300
  const padL = 56
  const padB = 26
  const padT = 10

  const finishers = useMemo(() => finishOrder(replay), [replay])
  const [num, setNum] = useState(finishers[0]?.num ?? '')
  const d = replay.drivers.find(x => x.num === num)

  const data = useMemo(() => {
    if (!d) return []
    const timeByLap = new Map(cleanLapPairs(replay, d))
    const lifeByLap = new Map(d.tyres.map(t => [t[0], t[2]]))
    return stints(d).map(s => {
      const pts: { age: number; t: number }[] = []
      for (let n = s.from; n <= s.to; n++) {
        const t = timeByLap.get(n)
        const age = lifeByLap.get(n)
        if (t !== undefined && age !== null && age !== undefined) pts.push({ age, t })
      }
      // regressione lineare: pendenza = secondi persi per giro di eta'
      let slope: number | null = null
      let icept = 0
      if (pts.length >= 3) {
        const mx = pts.reduce((s2, p) => s2 + p.age, 0) / pts.length
        const my = pts.reduce((s2, p) => s2 + p.t, 0) / pts.length
        const den = pts.reduce((s2, p) => s2 + (p.age - mx) ** 2, 0)
        if (den > 0) {
          slope = pts.reduce((s2, p) => s2 + (p.age - mx) * (p.t - my), 0) / den
          icept = my - slope * mx
        }
      }
      return { ...s, pts, slope, icept }
    }).filter(s => s.pts.length > 0)
  }, [replay, d])

  const allPts = data.flatMap(s => s.pts)
  if (!d || allPts.length === 0) return null
  const tMin = Math.min(...allPts.map(p => p.t)) - 0.3
  const tMax = Math.max(...allPts.map(p => p.t)) + 0.3
  const aMax = Math.max(...allPts.map(p => p.age)) + 1
  const x = (age: number) => padL + (age / aMax) * (W - padL - 16)
  const y = (t: number) => padT + ((tMax - t) / (tMax - tMin)) * (H - padT - padB)
  const ticks: number[] = []
  for (let v = Math.ceil(tMin); v <= tMax; v++) ticks.push(v)
  const seen = new Map<string, number>()

  return (
    <div className="chart">
      <div className="chart-label">Degrado per stint <span>giri puliti per età della gomma — la pendenza della retta è il degrado</span></div>
      <div className="gap-pickers">
        <span>pilota</span>
        <select value={num} onChange={e => setNum(e.target.value)}>
          {finishers.map(f => <option key={f.num} value={f.num}>{f.abbr}</option>)}
        </select>
        <span className="legend">
          {data.map((s, i) => (
            <span key={i} style={{ color: TYRE_COLORS[s.compound] ?? '#999' }}>
              ■ G{s.from}–{s.to}{s.slope !== null &&
                ` · ${s.slope >= 0 ? '+' : ''}${s.slope.toFixed(3)} s/giro`}
            </span>
          ))}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {ticks.map(v => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 6} y={y(v)} textAnchor="end" fill="#666" fontSize="10"
              dominantBaseline="middle">{fmtLap(v).slice(0, -4)}</text>
          </g>
        ))}
        {Array.from({ length: Math.floor(aMax / 5) }, (_, i) => (i + 1) * 5).map(a => (
          <text key={a} x={x(a)} y={H - 8} textAnchor="middle" fill="#666" fontSize="10">{a}</text>
        ))}
        {data.map((s, i) => {
          const color = TYRE_COLORS[s.compound] ?? '#999'
          const k = seen.get(s.compound) ?? 0
          seen.set(s.compound, k + 1)
          const dash = k > 0 ? '5 4' : undefined
          const a0 = Math.min(...s.pts.map(p => p.age))
          const a1 = Math.max(...s.pts.map(p => p.age))
          return (
            <g key={i}>
              {s.pts.map((p, j) => (
                <circle key={j} cx={x(p.age)} cy={y(p.t)} r="3" fill={color} fillOpacity="0.8" />
              ))}
              {s.slope !== null && (
                <line x1={x(a0)} y1={y(s.icept + s.slope * a0)}
                  x2={x(a1)} y2={y(s.icept + s.slope * a1)}
                  stroke={color} strokeWidth="1.6" strokeDasharray={dash} />
              )}
            </g>
          )
        })}
      </svg>
      <p className="axis-note">asse orizzontale: età della gomma in giri (per i treni usati include le altre sessioni) —
        pendenza negativa = l'alleggerimento del carburante vale più del degrado</p>
    </div>
  )
}

/** Tempi di pit stop: media delle traversate pit lane per squadra. */
function PitTimesChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 300
  const padL = 56
  const padB = 40
  const padT = 24

  const data = useMemo(() => {
    const byTeam = new Map<string, { times: number[]; color: string }>()
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    replay.drivers.forEach(d => {
      const times = d.pits
        .filter(p => p[1] !== null && p[1] - p[0] <= 90)
        .map(p => p[1]! - p[0])
      if (!byTeam.has(d.team)) {
        byTeam.set(d.team, { times: [], color: teamColor(d.team, colorIdx.get(d.num) ?? 0) })
      }
      byTeam.get(d.team)!.times.push(...times)
    })
    return [...byTeam.entries()]
      .filter(([, v]) => v.times.length > 0)
      .map(([team, v]) => ({
        team,
        color: v.color,
        avg: v.times.reduce((s, t) => s + t, 0) / v.times.length,
        n: v.times.length,
      }))
      .sort((a, b) => a.avg - b.avg)
  }, [replay])

  if (data.length === 0) return null
  const mean = data.reduce((s, d) => s + d.avg * d.n, 0) / data.reduce((s, d) => s + d.n, 0)
  const yMin = Math.floor(Math.min(...data.map(d => d.avg))) - 2
  const yMax = Math.ceil(Math.max(...data.map(d => d.avg))) + 2
  const y = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB)
  const slot = (W - padL) / data.length
  const bw = Math.min(slot * 0.55, 60)

  return (
    <div className="chart">
      <div className="chart-label">Tempi di pit stop <span>media delle traversate pit lane per squadra (ingresso → uscita)</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {Array.from({ length: yMax - yMin + 1 }, (_, i) => yMin + i).map(v => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 6} y={y(v)} textAnchor="end" fill="#666" fontSize="10"
              dominantBaseline="middle">{v}s</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2
          return (
            <g key={d.team}>
              <rect x={cx - bw / 2} y={y(d.avg)} width={bw} height={y(yMin) - y(d.avg)}
                fill={d.color} rx="2" />
              <text x={cx} y={y(d.avg) - 6} textAnchor="middle" fill="#ccc" fontSize="11">
                {d.avg.toFixed(2)}s
              </text>
              <text x={cx} y={H - padB + 14} textAnchor="middle" fill={d.color} fontSize="10">
                {d.team.length > 12 ? d.team.slice(0, 11) + '…' : d.team}
              </text>
            </g>
          )
        })}
        <line x1={padL} x2={W - 90} y1={y(mean)} y2={y(mean)} stroke="#888"
          strokeWidth="1" strokeDasharray="3 3" />
        <text x={W - 86} y={y(mean)} fill="#888" fontSize="10"
          dominantBaseline="middle">media {mean.toFixed(2)}s</text>
      </svg>
    </div>
  )
}

/** Velocita' massima di ogni pilota nella sessione. */
function TopSpeedChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 300
  const padL = 56
  const padB = 26
  const padT = 24

  const data = useMemo(() => {
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    return replay.drivers
      .filter(d => d.top_speed !== null)
      .map(d => ({ d, color: teamColor(d.team, colorIdx.get(d.num) ?? 0), v: d.top_speed! }))
      .sort((a, b) => b.v - a.v)
  }, [replay])

  if (data.length === 0) return null
  const yMin = Math.floor(Math.min(...data.map(x => x.v)) / 10) * 10 - 10
  const yMax = Math.ceil(Math.max(...data.map(x => x.v)) / 10) * 10
  const y = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB)
  const slot = (W - padL) / data.length
  const bw = Math.min(slot * 0.55, 34)

  return (
    <div className="chart">
      <div className="chart-label">Velocità massime <span>picco della sessione per pilota, km/h</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10).map(v => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 6} y={y(v)} textAnchor="end" fill="#666" fontSize="10"
              dominantBaseline="middle">{v}</text>
          </g>
        ))}
        {data.map((x, i) => {
          const cx = padL + slot * i + slot / 2
          return (
            <g key={x.d.num}>
              <rect x={cx - bw / 2} y={y(x.v)} width={bw} height={y(yMin) - y(x.v)}
                fill={x.color} rx="2" />
              <text x={cx} y={y(x.v) - 5} textAnchor="middle" fill="#ccc" fontSize="10">
                {x.v.toFixed(0)}
              </text>
              <text x={cx} y={H - 8} textAnchor="middle" fill={x.color} fontSize="10">{x.d.abbr}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Griglia → arrivo: slope chart con una linea per pilota; verde chi ha
 *  guadagnato posizioni, rosso chi ne ha perse (risultati ufficiali). */
function GridFinishChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const rowH = 20
  const padX = 190

  const data = useMemo(() => {
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    return replay.drivers
      .map(d => {
        const r = d.result
        if (!r?.grid) return null
        const fin = r.finish && /^\d+$/.test(r.finish) ? Number(r.finish) : null
        return { d, color: teamColor(d.team, colorIdx.get(d.num) ?? 0),
          grid: r.grid, fin, status: r.status, points: r.points }
      })
      .filter(Boolean).map(x => x!)
  }, [replay])

  if (data.length === 0) return null
  const maxPos = Math.max(...data.map(x => Math.max(x.grid, x.fin ?? 0)),
    data.length)
  const H = maxPos * rowH + 24
  const y = (p: number) => 8 + (p - 1) * rowH + rowH / 2
  const dnf = data.filter(x => x.fin === null)
    .sort((a, b) => a.grid - b.grid)

  return (
    <div className="chart">
      <div className="chart-label">Griglia → arrivo <span>risultati ufficiali — verde: posizioni guadagnate, rosso: perse</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {data.map(x => {
          const gained = x.fin !== null && x.fin < x.grid
          const lost = x.fin !== null && x.fin > x.grid
          const stroke = gained ? '#2ecc71' : lost ? '#e74c3c' : '#777'
          return (
            <g key={x.d.num}>
              <text x={padX - 10} y={y(x.grid)} textAnchor="end" fill={x.color}
                fontSize="11" dominantBaseline="middle">
                P{x.grid} {x.d.abbr}
              </text>
              {x.fin !== null ? (
                <>
                  <line x1={padX} y1={y(x.grid)} x2={W - padX} y2={y(x.fin)}
                    stroke={stroke} strokeWidth="1.6" opacity="0.85" />
                  <text x={W - padX + 10} y={y(x.fin)} fill={x.color}
                    fontSize="11" dominantBaseline="middle">
                    P{x.fin} {x.d.abbr}
                    {x.points > 0 ? ` · ${x.points % 1 ? x.points : x.points.toFixed(0)} pt` : ''}
                  </text>
                </>
              ) : (
                <line x1={padX} y1={y(x.grid)} x2={padX + 60} y2={y(x.grid)}
                  stroke="#555" strokeWidth="1.6" strokeDasharray="4 4" />
              )}
            </g>
          )
        })}
        {dnf.map((x, i) => (
          <text key={x.d.num} x={W - padX + 10}
            y={y(data.filter(z => z.fin !== null).length + i + 1)}
            fill="#777" fontSize="11" dominantBaseline="middle">
            DNF {x.d.abbr}{x.status ? ` · ${x.status}` : ''}
          </text>
        ))}
      </svg>
    </div>
  )
}

/** Velocita' massime ai rilevamenti ufficiali (speed trap del rettilineo,
 *  intertempi, traguardo) — dal feed, non dalla telemetria campionata. */
function SpeedTrapChart({ replay }: { replay: ReplayData }) {
  const W = 1000
  const H = 320
  const padL = 56
  const padB = 40
  const padT = 24
  const POINTS = [
    { i: 4, label: 'speed trap', color: '#e8e8e8' },
    { i: 1, label: 'intertempo 1', color: '#7fb2d9' },
    { i: 2, label: 'intertempo 2', color: '#5a86a8' },
    { i: 3, label: 'traguardo', color: '#3f6178' },
  ] as const

  const data = useMemo(() => {
    const colorIdx = new Map(replay.drivers.map((d, i) => [d.num, i]))
    return replay.drivers
      .map(d => {
        if (!d.traps?.length) return null
        const max = POINTS.map(p =>
          Math.max(...d.traps!.map(row => row[p.i] ?? 0)))
        if (Math.max(...max) === 0) return null
        return { d, color: teamColor(d.team, colorIdx.get(d.num) ?? 0), max }
      })
      .filter(Boolean).map(x => x!)
      .sort((a, b) => b.max[0] - a.max[0])
  }, [replay])

  if (data.length === 0) return null
  const all = data.flatMap(x => x.max).filter(v => v > 0)
  const yMin = Math.floor(Math.min(...all) / 10) * 10 - 10
  const yMax = Math.ceil(Math.max(...all) / 10) * 10
  const y = (v: number) => padT + ((yMax - v) / (yMax - yMin)) * (H - padT - padB)
  const slot = (W - padL) / data.length
  const bw = Math.min(slot / 5.5, 8)

  return (
    <div className="chart">
      <div className="chart-label">Velocità ai rilevamenti <span>massimo di sessione per pilota, km/h — ordinato per speed trap</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="lap-chart">
        {Array.from({ length: (yMax - yMin) / 10 + 1 }, (_, i) => yMin + i * 10).map(v => (
          <g key={v}>
            <line x1={padL} x2={W} y1={y(v)} y2={y(v)} className="grid" />
            <text x={padL - 6} y={y(v)} textAnchor="end" fill="#666" fontSize="10"
              dominantBaseline="middle">{v}</text>
          </g>
        ))}
        {data.map((x, i) => {
          const cx = padL + slot * i + slot / 2
          return (
            <g key={x.d.num}>
              {POINTS.map((p, j) => x.max[j] > 0 && (
                <rect key={p.i}
                  x={cx + (j - 2) * bw} y={y(x.max[j])}
                  width={bw - 1} height={y(yMin) - y(x.max[j])}
                  fill={j === 0 ? x.color : p.color} opacity={j === 0 ? 1 : 0.55}
                  rx="1" />
              ))}
              <text x={cx} y={y(Math.max(...x.max)) - 5} textAnchor="middle"
                fill="#ccc" fontSize="9">{x.max[0].toFixed(0)}</text>
              <text x={cx} y={H - padB + 14} textAnchor="middle" fill={x.color}
                fontSize="10">{x.d.abbr}</text>
            </g>
          )
        })}
      </svg>
      <p className="axis-note">
        barra colorata: speed trap (rettilineo principale) — barre grigie/azzurre: intertempo 1, intertempo 2, traguardo
      </p>
    </div>
  )
}

export default function Charts({ replay }: Props) {
  return (
    <div className="charts">
      <GridFinishChart replay={replay} />
      <PaceChart replay={replay} />
      <AvgGapChart replay={replay} />
      <StrategyChart replay={replay} />
      <DegradationChart replay={replay} />
      <PitTimesChart replay={replay} />
      <SpeedTrapChart replay={replay} />
      <TopSpeedChart replay={replay} />
      <LapChart replay={replay} />
      <GapChart replay={replay} />
    </div>
  )
}
