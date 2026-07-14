import type { ReplayData, ReplayDriver } from './api'

/** Se il campione piu' vicino e' piu' lontano di cosi', il pilota non viene
 *  disegnato (ritiro, buco dati — visti fino a 1.4s in Fase 0). */
export const MAX_STALE_S = 5

/** Posizione al tempo t: ricerca binaria + interpolazione lineare
 *  (validata in Fase 0: il dato grezzo a 3.8Hz scatta, la lerp basta). */
export function posAt(
  points: [number, number, number][], t: number,
): { x: number; y: number; stale: boolean } {
  let lo = 0
  let hi = points.length - 1
  if (t <= points[0][0]) return { x: points[0][1], y: points[0][2], stale: points[0][0] - t > MAX_STALE_S }
  if (t >= points[hi][0]) return { x: points[hi][1], y: points[hi][2], stale: t - points[hi][0] > MAX_STALE_S }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  if (b[0] - a[0] > MAX_STALE_S) {
    // buco dati: niente lerp attraverso il buco, resta sull'ultimo campione
    return { x: a[1], y: a[2], stale: t - a[0] > MAX_STALE_S }
  }
  const f = (t - a[0]) / (b[0] - a[0])
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, stale: false }
}

/** Giri completati + frazione del giro corrente al tempo t. */
export function progressAt(laps: [number, number, number | null][], t: number): number {
  if (laps.length === 0 || t < laps[0][1]) return 0
  for (let i = laps.length - 1; i >= 0; i--) {
    const [n, start, end] = laps[i]
    if (t < start) continue
    const stop = end ?? laps[i + 1]?.[1] ?? null
    if (stop === null || stop <= start) return n - 1
    return Math.min(n, n - 1 + (t - start) / (stop - start))
  }
  return 0
}

/** Inverso di progressAt: quando il pilota ha raggiunto il progresso p. */
export function timeAtProgress(
  laps: [number, number, number | null][], p: number,
): number | null {
  const done = Math.floor(p)
  const entry = laps.find(l => l[0] === done + 1)
  if (!entry) return null
  const [, start, end] = entry
  if (end === null) return start
  return start + (p - done) * (end - start)
}

export function inPit(pits: [number, number | null][], t: number): boolean {
  // finestra mai chiusa = ritiro ai box: il badge BOX ha senso solo
  // nei primi minuti, poi la macchina e' semplicemente ferma in garage
  return pits.some(([a, b]) => t >= a && (b !== null ? t <= b : t <= a + 180))
}

/** Codice stato pista attivo al tempo t (ultimo evento con timestamp <= t). */
export function trackStatusAt(status: [number, number][], t: number): number {
  let code = 1
  for (const [ts, c] of status) {
    if (ts <= t) code = c
    else break
  }
  return code
}

export const STATUS_INFO: Record<number, { label: string; color: string }> = {
  1: { label: 'VERDE', color: '#2ecc71' },
  2: { label: 'GIALLA', color: '#f1c40f' },
  4: { label: 'SAFETY CAR', color: '#f39c12' },
  5: { label: 'ROSSA', color: '#e74c3c' },
  6: { label: 'VSC', color: '#f1c40f' },
  7: { label: 'VSC', color: '#f1c40f' },
}

/** Testo nero o bianco a seconda della luminosita' dello sfondo. */
export function contrastColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 145 ? '#111' : '#fff'
}

export interface Standing {
  driver: ReplayDriver
  pos: number
  lap: number
  progress: number
  gapText: string
  inPit: boolean
  out: boolean
}

/** Classifica al tempo t, calcolata dal progresso sulla timeline dei giri. */
export function standingsAt(replay: ReplayData, t: number): Standing[] {
  const lapsEnd = (d: ReplayDriver): number => {
    const last = d.laps[d.laps.length - 1]
    return last ? last[2] ?? last[1] : 0
  }
  const totalLaps = Math.max(...replay.drivers.map(d => d.laps.length ? d.laps[d.laps.length - 1][0] : 0))
  const raceEnd = Math.max(...replay.drivers.map(lapsEnd))
  const rows = replay.drivers.map(driver => {
    const progress = progressAt(driver.laps, t)
    const lastT = driver.points.length ? driver.points[driver.points.length - 1][0] : 0
    const lapCount = driver.laps.length ? driver.laps[driver.laps.length - 1][0] : 0
    // ritirato: ha smesso di girare ben prima della fine (i doppiati no:
    // fanno meno giri ma la loro timeline arriva comunque a fine gara)
    const retired = lapCount < totalLaps && lapsEnd(driver) + 120 < raceEnd
    const out = (retired && t > lapsEnd(driver) + 60) || (t > lastT + 30 && progress < totalLaps)
    return { driver, progress, out }
  })
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1
    return b.progress - a.progress
  })

  const leader = rows[0]
  return rows.map((r, i) => {
    let gapText = ''
    if (r.out) {
      gapText = 'OUT'
    } else if (i === 0) {
      gapText = 'Leader'
    } else if (leader.progress - r.progress >= 1) {
      gapText = `+${Math.floor(leader.progress - r.progress)} giri`
    } else {
      const tLeader = timeAtProgress(leader.driver.laps, r.progress)
      gapText = tLeader === null ? '—' : `+${Math.max(0, t - tLeader).toFixed(1)}`
    }
    return {
      driver: r.driver,
      pos: i + 1,
      lap: Math.min(Math.floor(r.progress) + 1, totalLaps),
      progress: r.progress,
      gapText,
      inPit: inPit(r.driver.pits, t),
      out: r.out,
    }
  })
}
