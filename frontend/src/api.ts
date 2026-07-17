export interface EventInfo {
  round: number
  name: string
  country: string
  date: string
  /** 'conventional' | 'sprint_qualifying' | ... — decide se esiste la Sprint */
  format: string
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
  /** velocita' massima della sessione in km/h (null se non disponibile) */
  top_speed: number | null
  /** campioni grezzi [t (s dallo start), x, y] in 1/10 di metro */
  points: [number, number, number][]
  /** finestre pit lane [t ingresso, t uscita | null se mai uscito] */
  pits: [number, number | null][]
  /** timeline giri [numero, t inizio, t fine | null] per posizioni e gap */
  laps: [number, number, number | null][]
  /** [giro, mescola S/M/H/I/W, giri percorsi con questo treno, treno nuovo] */
  tyres: [number, string, number | null, boolean][]
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
  /** confini S1/S2 e S2/S3 sul giro di riferimento */
  sector_marks: [number, number][]
  /** zone DRS (vuoto dal 2026: ali attive, niente zone) */
  drs_zones: [number, number][][]
  /** punti di detection (<1s dal pilota davanti); vuoto se non nei dati */
  detection_points: [number, number][]
  /** bandiere nei settori marshal: [t, settore, 2 gialla | 3 doppia | 0 libero].
   *  La geometria non e' nel feed: il tratto disegnato e' approssimato. */
  sector_flags: [number, number, number][]
  /** [t, codice]: 1 verde, 2 gialla, 4 SC, 5 rossa, 6 VSC, 7 VSC in rientro */
  track_status: [number, number][]
  drivers: ReplayDriver[]
}

export interface RaceControlMsg {
  t: number
  category: string | null
  flag: string | null
  message: string | null
}

export interface RadioClip {
  t: number
  num: string
  url: string
}

export interface FeedData {
  race_control: RaceControlMsg[]
  radio: RadioClip[]
  /** [t, aria °C, pista °C, pioggia, vento m/s, direzione vento °] */
  weather: [number, number, number, boolean, number, number][]
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
  /** tempo dall'inizio del giro, per il delta cumulativo */
  time: number[]
  distance: number[]
  speed: number[]
  throttle: number[]
  brake: boolean[]
  gear: number[]
  x: number[]
  y: number[]
}

/** Build demo (GitHub Pages): dati SINTETICI impacchettati con la pagina,
 *  nessun backend e nessun dato F1. Generati da scripts/gen_demo_data.py. */
export const DEMO = import.meta.env.VITE_DEMO === '1'
const demo = (name: string) => `${import.meta.env.BASE_URL}demo/${name}`

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

export const getEvents = (year: number) =>
  json<EventInfo[]>(DEMO ? demo('events.json') : `/api/events/${year}`)

const sessionPath = (year: number, event: string, session: string) =>
  `${year}/${encodeURIComponent(event)}/${session}`

export const getSessionInfo = (year: number, event: string, session: string) =>
  json<SessionInfo>(DEMO ? demo('session.json')
    : `/api/session/${sessionPath(year, event, session)}`)

export const getReplay = (year: number, event: string, session: string) =>
  json<ReplayData>(DEMO ? demo('replay.json')
    : `/api/replay/${sessionPath(year, event, session)}`)

export const getLaps = (year: number, event: string, session: string) =>
  json<LapInfo[]>(DEMO ? demo('laps.json')
    : `/api/laps/${sessionPath(year, event, session)}`)

export const getFeed = (year: number, event: string, session: string) =>
  json<FeedData>(DEMO ? demo('feed.json')
    : `/api/feed/${sessionPath(year, event, session)}`)

export const getLapTelemetry = (
  year: number, event: string, session: string, driver: string, lap: number,
) => json<LapTelemetry>(DEMO ? demo(`tel_${driver}_${lap}.json`)
  : `/api/telemetry/${sessionPath(year, event, session)}/${driver}/${lap}`)

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
