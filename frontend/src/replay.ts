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
  if (!entry) {
    // p esattamente sull'ultimo giro (gara finita): l'istante e' la fine di quel giro
    const last = laps.find(l => l[0] === done)
    return last ? last[2] ?? last[1] : null
  }
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

export const TYRE_COLORS: Record<string, string> = {
  S: '#ff3b30', M: '#f1c40f', H: '#e8e8e8', I: '#2ecc71', W: '#3498db',
}

const lapsEnd = (d: ReplayDriver): number => {
  const last = d.laps[d.laps.length - 1]
  return last ? last[2] ?? last[1] : 0
}

/** Per ogni pilota, l'istante da cui considerarlo ritirato
 *  (Infinity se arriva in fondo). Ritirato = ha smesso di girare ben prima
 *  della fine; i doppiati no: fanno meno giri ma la loro timeline arriva
 *  comunque a fine gara. */
export function retirementTimes(replay: ReplayData): number[] {
  const totalLaps = Math.max(...replay.drivers.map(d => d.laps.length ? d.laps[d.laps.length - 1][0] : 0))
  const raceEnd = Math.max(...replay.drivers.map(lapsEnd))
  return replay.drivers.map(d => {
    const lapCount = d.laps.length ? d.laps[d.laps.length - 1][0] : 0
    const retired = lapCount < totalLaps && lapsEnd(d) + 120 < raceEnd
    return retired ? lapsEnd(d) + 60 : Infinity
  })
}

/** Mescola ed eta' (in giri) del treno montato al giro dato. */
export function tyreAt(d: ReplayDriver, lap: number): { c: string; age: number | null } | null {
  const entry = d.tyres.find(e => e[0] === lap)
  return entry ? { c: entry[1], age: entry[2] } : null
}

// --- settori con convenzione TV: viola = best assoluto, verde = best
// personale, giallo = piu' lento. Le classificazioni si congelano al
// momento del completamento del settore, come nelle grafiche ufficiali. ---

export type SectorClass = 'ob' | 'pb' | 'std' // overall best | personal best | standard

interface SectorEvent {
  num: string
  lap: number
  sector: number // 0..2
  time: number
  /** istante in cui il settore e' stato completato */
  end: number
}

function sectorEvents(replay: ReplayData): SectorEvent[] {
  const events: SectorEvent[] = []
  for (const d of replay.drivers) {
    const secByLap = new Map(d.sectors.map(s => [s[0], s]))
    for (const [lapNo, start] of d.laps) {
      const sec = secByLap.get(lapNo)
      if (!sec) continue
      let cursor = start
      for (let i = 0; i < 3; i++) {
        const dur = sec[i + 1]
        if (dur === null) break
        cursor += dur
        events.push({ num: d.num, lap: lapNo, sector: i, time: dur, end: cursor })
      }
    }
  }
  return events.sort((a, b) => a.end - b.end)
}

const sectorEventsCache = new WeakMap<ReplayData, SectorEvent[]>()

export interface DriverSectors {
  /** i tre settori mostrati (giro corrente; completa il precedente finche'
   *  S1 non arriva), null se non ancora completato */
  sectors: ({ time: number; cls: SectorClass } | null)[]
}

/** Stato dei blocchi settore di tutti i piloti al tempo t. */
export function sectorsAt(replay: ReplayData, t: number): Map<string, DriverSectors> {
  let events = sectorEventsCache.get(replay)
  if (!events) {
    events = sectorEvents(replay)
    sectorEventsCache.set(replay, events)
  }
  const bestOverall: (number | null)[] = [null, null, null]
  const bestPersonal = new Map<string, (number | null)[]>()
  const display = new Map<string, { lap: number; sectors: DriverSectors['sectors'] }>()

  for (const ev of events) {
    if (ev.end > t) break
    let cls: SectorClass = 'std'
    const personal = bestPersonal.get(ev.num) ?? [null, null, null]
    if (bestOverall[ev.sector] === null || ev.time <= bestOverall[ev.sector]!) {
      cls = 'ob'
      bestOverall[ev.sector] = ev.time
    } else if (personal[ev.sector] === null || ev.time <= personal[ev.sector]!) {
      cls = 'pb'
    }
    if (personal[ev.sector] === null || ev.time < personal[ev.sector]!) {
      personal[ev.sector] = ev.time
    }
    bestPersonal.set(ev.num, personal)

    const cur = display.get(ev.num)
    if (!cur || cur.lap !== ev.lap) {
      display.set(ev.num, { lap: ev.lap, sectors: [null, null, null] })
    }
    display.get(ev.num)!.sectors[ev.sector] = { time: ev.time, cls }
  }

  const out = new Map<string, DriverSectors>()
  for (const [num, d] of display) out.set(num, { sectors: d.sectors })
  return out
}

// --- tempi giro: ultimo e migliore. Come per i settori, la classificazione
// dell'ultimo giro (viola/verde) si congela al momento del completamento. ---

interface LapEvent {
  num: string
  time: number
  /** istante in cui il giro e' stato completato */
  end: number
}

const lapEventsCache = new WeakMap<ReplayData, LapEvent[]>()

export interface DriverLapTimes {
  last: { time: number; cls: SectorClass } | null
  best: number | null
  /** detentore del giro veloce della gara al tempo t */
  fastest: boolean
}

/** Ultimo giro, miglior giro e giro veloce di tutti i piloti al tempo t. */
export function lapTimesAt(replay: ReplayData, t: number): Map<string, DriverLapTimes> {
  let events = lapEventsCache.get(replay)
  if (!events) {
    events = []
    for (const d of replay.drivers) {
      for (const [, start, end] of d.laps) {
        if (end !== null && end > start) events.push({ num: d.num, time: end - start, end })
      }
    }
    events.sort((a, b) => a.end - b.end)
    lapEventsCache.set(replay, events)
  }
  const out = new Map<string, DriverLapTimes>()
  let bestOverall: number | null = null
  let bestNum: string | null = null
  for (const ev of events) {
    if (ev.end > t) break
    let d = out.get(ev.num)
    if (!d) {
      d = { last: null, best: null, fastest: false }
      out.set(ev.num, d)
    }
    let cls: SectorClass = 'std'
    if (bestOverall === null || ev.time <= bestOverall) cls = 'ob'
    else if (d.best === null || ev.time <= d.best) cls = 'pb'
    if (bestOverall === null || ev.time < bestOverall) {
      bestOverall = ev.time
      bestNum = ev.num
    }
    if (d.best === null || ev.time < d.best) d.best = ev.time
    d.last = { time: ev.time, cls }
  }
  if (bestNum !== null) out.get(bestNum)!.fastest = true
  return out
}

export interface Standing {
  driver: ReplayDriver
  pos: number
  lap: number
  progress: number
  gapText: string
  /** distacco dal pilota davanti, in secondi */
  interval: number | null
  /** overtake/DRS disponibile: gara verde, non ai box, distacco < 1s */
  drs: boolean
  inPit: boolean
  out: boolean
  tyre: { c: string; age: number | null } | null
  /** pit stop effettuati finora */
  pitCount: number
  /** giri cancellati per track limits finora */
  tlCount: number
  /** ultima penalita' ricevuta finora */
  penalty: string | null
}

/** Classifica di qualifica/prove al tempo t: ordina per miglior giro,
 *  gap in millesimi dalla pole provvisoria. */
export function standingsQualiAt(replay: ReplayData, t: number): Standing[] {
  const times = lapTimesAt(replay, t)
  const rows = replay.drivers.map(driver => ({ driver, lt: times.get(driver.num) }))
  rows.sort((a, b) => (a.lt?.best ?? Infinity) - (b.lt?.best ?? Infinity))
  const pole = rows[0]?.lt?.best ?? null
  return rows.map((r, i) => {
    const best = r.lt?.best ?? null
    const prev = i > 0 ? rows[i - 1].lt?.best ?? null : null
    const lap = Math.floor(progressAt(r.driver.laps, t)) + 1
    return {
      driver: r.driver,
      pos: i + 1,
      lap,
      progress: 0,
      gapText: best === null ? '—'
        : i === 0 ? 'Pole'
        : pole === null ? '—' : `+${(best - pole).toFixed(3)}`,
      interval: best !== null && prev !== null ? best - prev : null,
      drs: false,
      inPit: inPit(r.driver.pits, t),
      out: false,
      tyre: tyreAt(r.driver, lap),
      pitCount: r.driver.pits.filter(p => p[0] <= t).length,
      tlCount: r.driver.tl.filter(x => x <= t).length,
      penalty: null,
    }
  })
}

/** Classifica al tempo t, calcolata dal progresso sulla timeline dei giri. */
export function standingsAt(replay: ReplayData, t: number): Standing[] {
  const totalLaps = Math.max(...replay.drivers.map(d => d.laps.length ? d.laps[d.laps.length - 1][0] : 0))
  const retireAt = retirementTimes(replay)
  const rows = replay.drivers.map((driver, i) => {
    const progress = progressAt(driver.laps, t)
    const lastT = driver.points.length ? driver.points[driver.points.length - 1][0] : 0
    const out = t > retireAt[i] || (t > lastT + 30 && progress < totalLaps)
    // dopo la bandiera a scacchi il tempo del pilota si congela al suo arrivo:
    // i gap restano quelli del traguardo invece di divergere o sparire
    const effT = Math.min(t, lapsEnd(driver))
    return { driver, progress, out, effT }
  })
  rows.sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1
    if (a.progress !== b.progress) return b.progress - a.progress
    return a.effT - b.effT // a pari giri completati, chi e' arrivato prima
  })

  const leader = rows[0]
  const green = trackStatusAt(replay.track_status, t) === 1
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
      gapText = tLeader === null ? '—' : `+${Math.max(0, r.effT - tLeader).toFixed(1)}`
    }
    const lap = Math.min(Math.floor(r.progress) + 1, totalLaps)

    let interval: number | null = null
    if (i > 0 && !r.out) {
      const tAhead = timeAtProgress(rows[i - 1].driver.laps, r.progress)
      if (tAhead !== null) interval = Math.max(0, r.effT - tAhead)
    }
    const pit = inPit(r.driver.pits, t)
    // regola overtake/DRS: entro 1s dal pilota davanti, gara verde,
    // non ai box, non nei primi 2 giri, gara non ancora conclusa
    const drs = !r.out && !pit && green && lap > 2 && r.effT === t &&
      interval !== null && interval < 1.0

    const pens = r.driver.penalties.filter(p => p[0] <= t)
    return {
      driver: r.driver,
      pos: i + 1,
      lap,
      progress: r.progress,
      gapText,
      interval,
      drs,
      inPit: pit,
      out: r.out,
      tyre: tyreAt(r.driver, lap),
      pitCount: r.driver.pits.filter(p => p[0] <= t).length,
      tlCount: r.driver.tl.filter(x => x <= t).length,
      penalty: pens.length ? pens[pens.length - 1][1] : null,
    }
  })
}
