export interface EventInfo {
  round: number
  name: string
  country: string
  date: string
}

export interface DriverInfo {
  num: string
  abbr: string
  name: string
  team: string
}

export interface SessionInfo {
  status: 'loading' | 'ready'
  year?: number
  event?: string
  session?: string
  drivers?: DriverInfo[]
}

export interface ReplayDriver {
  num: string
  abbr: string
  team: string
  /** campioni grezzi [t (s dallo start), x, y] in 1/10 di metro */
  points: [number, number, number][]
  /** finestre pit lane [t ingresso, t uscita | null se mai uscito] */
  pits: [number, number | null][]
  /** timeline giri [numero, t inizio, t fine | null] per posizioni e gap */
  laps: [number, number, number | null][]
  /** [giro, mescola S/M/H/I/W, giri percorsi con questo treno] */
  tyres: [number, string, number | null][]
  /** [giro, s1, s2, s3] in secondi */
  sectors: [number, number | null, number | null, number | null][]
  /** istanti dei giri cancellati per track limits */
  tl: number[]
  /** penalita' dalla direzione gara: [t, etichetta] */
  penalties: [number, string][]
}

export interface ReplayData {
  duration_s: number
  track: [number, number][]
  /** traversata reale della pit lane (ingresso -> box -> uscita) */
  pit_lane: [number, number][]
  /** [t, codice]: 1 verde, 2 gialla, 4 SC, 5 rossa, 6 VSC, 7 VSC in rientro */
  track_status: [number, number][]
  drivers: ReplayDriver[]
}

export interface LapInfo {
  driver: string
  num: string
  lap: number
  time_s: number | null
  compound: string | null
  accurate: boolean
}

export interface LapTelemetry {
  driver: string
  lap: number
  distance: number[]
  speed: number[]
  throttle: number[]
  brake: boolean[]
  gear: number[]
  x: number[]
  y: number[]
}

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

export const getEvents = (year: number) => json<EventInfo[]>(`/api/events/${year}`)

const sessionPath = (year: number, event: string, session: string) =>
  `${year}/${encodeURIComponent(event)}/${session}`

export const getSessionInfo = (year: number, event: string, session: string) =>
  json<SessionInfo>(`/api/session/${sessionPath(year, event, session)}`)

export const getReplay = (year: number, event: string, session: string) =>
  json<ReplayData>(`/api/replay/${sessionPath(year, event, session)}`)

export const getLaps = (year: number, event: string, session: string) =>
  json<LapInfo[]>(`/api/laps/${sessionPath(year, event, session)}`)

export const getLapTelemetry = (
  year: number, event: string, session: string, driver: string, lap: number,
) => json<LapTelemetry>(`/api/telemetry/${sessionPath(year, event, session)}/${driver}/${lap}`)

/** Polla lo stato finche' la sessione non e' pronta (il primo load puo' richiedere secondi). */
export async function waitForSession(
  year: number, event: string, session: string,
  onPoll?: (elapsed: number) => void,
): Promise<SessionInfo> {
  const start = Date.now()
  for (;;) {
    const info = await getSessionInfo(year, event, session)
    if (info.status !== 'loading') return info
    onPoll?.((Date.now() - start) / 1000)
    await new Promise(r => setTimeout(r, 1500))
  }
}
