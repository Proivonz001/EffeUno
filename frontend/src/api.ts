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
  /** velocita' ai rilevamenti [giro, I1, I2, traguardo, speed trap] km/h */
  traps?: [number, number | null, number | null, number | null, number | null][]
  /** giri cancellati UFFICIALI (flag del feed): [t fine giro, giro, motivo] */
  deleted?: [number, number, string][]
  /** [giro, TrackStatus]: '1' verde; altri codici = giro sporco */
  lap_status?: [number, string][]
  /** risultato ufficiale: griglia, classifica, stato, punti, tempi Q1-3
   *  (q2 null in qualifica = eliminato in Q1) */
  result?: {
    grid: number | null
    finish: string | null
    status: string | null
    points: number
    q1: number | null
    q2: number | null
    q3: number | null
  } | null
}

export interface ReplayData {
  duration_s: number
  track: [number, number][]
  /** curve numerate [x, y, etichetta, angolo] da get_circuit_info */
  corners?: [number, number, string, number][]
  /** postazioni marshal [x, y, numero settore, angolo]: geometria REALE
   *  dei settori (il settore N va dalla postazione N alla N+1) */
  marshal_sectors?: [number, number, string, number][]
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
  /** manche di qualifica (vuoto/assente nelle altre sessioni e nei dati
   *  pubblicati prima di questo campo): pause = bandiere rosse (countdown
   *  fermo), duration = durata regolamentare in secondi */
  quali_segments?: {
    part: number
    start: number
    end: number | null
    pauses: [number, number | null][]
    duration: number
  }[]
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
  /** TrackStatus del giro ('1' = tutto verde) */
  status?: string
  /** giro cancellato (flag ufficiale) */
  deleted?: boolean
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
  /** regime motore (assente nei dati pubblicati prima del 2026-07-20) */
  rpm?: number[]
  /** canale DRS grezzo (solo stagioni ≤2025: 10/12/14 = ala aperta) */
  drs?: number[]
  x: number[]
  y: number[]
}

/** Backend configurabile a runtime: aprendo la pagina con ?api=https://...
 *  (es. l'URL Tailscale Serve del proprio PC) i dati arrivano da quel
 *  backend invece che dalla demo; la scelta resta salvata nel browser.
 *  ?api= (vuoto) torna alla demo. */
const _params = new URLSearchParams(window.location.search)
if (_params.has('api')) {
  const v = _params.get('api') ?? ''
  if (v) localStorage.setItem('effeuno-api', v.replace(/\/$/, ''))
  else localStorage.removeItem('effeuno-api')
}
export const API_BASE = localStorage.getItem('effeuno-api') ?? ''

/** Build demo (GitHub Pages): dati SINTETICI impacchettati con la pagina,
 *  nessun backend e nessun dato F1. Generati da scripts/gen_demo_data.py.
 *  Con un backend configurato (?api=...) la demo si spegne. */
export const DEMO = import.meta.env.VITE_DEMO === '1' && !API_BASE
const demo = (name: string) => `${import.meta.env.BASE_URL}demo/${name}`

/** Sito pubblico: catalogo e dati statici pre-pubblicati (R2), nessun
 *  backend. L'override ?api=... vince (uso privato del proprietario). */
const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? ''
export const SITE = !!DATA_BASE && !API_BASE

export interface CatalogSession {
  year: number
  event: string
  session: string
  session_name: string
  path: string
  drivers: number
  date?: string
}

let _catalog: Promise<{ sessions: CatalogSession[] }> | null = null
export function getCatalog() {
  _catalog = _catalog ?? json<{ sessions: CatalogSession[] }>(`${DATA_BASE}/index.json`)
  return _catalog
}

const slugify = (name: string) => name.toLowerCase().replace(/ /g, '-')
const dataPath = (year: number, event: string, session: string) =>
  `${DATA_BASE}/${year}/${slugify(event)}/${session}`

async function json<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

export const getEvents = async (year: number): Promise<EventInfo[]> => {
  if (DEMO) return json<EventInfo[]>(demo('events.json'))
  if (SITE) {
    // dal catalogo: un EventInfo per evento pubblicato in quell'anno
    const cat = await getCatalog()
    const byEvent = new Map<string, CatalogSession[]>()
    for (const s of cat.sessions) {
      if (s.year === year) {
        byEvent.set(s.event, [...(byEvent.get(s.event) ?? []), s])
      }
    }
    return [...byEvent.entries()].map(([name, sessions], i) => ({
      round: i + 1,
      name,
      country: sessions.map(s => s.session).sort().join('/'),
      date: sessions[0].date ?? '2000-01-01',
      format: sessions.some(s => s.session === 'S' || s.session === 'SQ')
        ? 'sprint_qualifying' : 'conventional',
    }))
  }
  return json<EventInfo[]>(`${API_BASE}/api/events/${year}`)
}

const sessionPath = (year: number, event: string, session: string) =>
  `${year}/${encodeURIComponent(event)}/${session}`

export const getSessionInfo = (year: number, event: string, session: string) =>
  SITE ? Promise.resolve({ status: 'ready' } as SessionInfo)
    : json<SessionInfo>(DEMO ? demo('session.json')
      : `${API_BASE}/api/session/${sessionPath(year, event, session)}`)

export const getReplay = (year: number, event: string, session: string) =>
  json<ReplayData>(DEMO ? demo('replay.json')
    : SITE ? `${dataPath(year, event, session)}/replay.json`
    : `${API_BASE}/api/replay/${sessionPath(year, event, session)}`)

export const getLaps = (year: number, event: string, session: string) =>
  json<LapInfo[]>(DEMO ? demo('laps.json')
    : SITE ? `${dataPath(year, event, session)}/laps.json`
    : `${API_BASE}/api/laps/${sessionPath(year, event, session)}`)

export const getFeed = (year: number, event: string, session: string) =>
  json<FeedData>(DEMO ? demo('feed.json')
    : SITE ? `${dataPath(year, event, session)}/feed.json`
    : `${API_BASE}/api/feed/${sessionPath(year, event, session)}`)

/** cache dei pacchetti-telemetria per pilota (modalita' sito) */
const _bundles = new Map<string, Promise<Record<string, LapTelemetry>>>()

export const getLapTelemetry = async (
  year: number, event: string, session: string, driver: string, lap: number,
): Promise<LapTelemetry> => {
  if (DEMO) return json<LapTelemetry>(demo(`tel_${driver}_${lap}.json`))
  if (SITE) {
    const key = `${dataPath(year, event, session)}/drivers/${driver}.json`
    let bundle = _bundles.get(key)
    if (!bundle) {
      bundle = json<Record<string, LapTelemetry>>(key)
      _bundles.set(key, bundle)
    }
    const tel = (await bundle)[String(lap)]
    if (!tel) throw new Error(`telemetria non disponibile per ${driver} giro ${lap}`)
    return tel
  }
  return json<LapTelemetry>(
    `${API_BASE}/api/telemetry/${sessionPath(year, event, session)}/${driver}/${lap}`)
}

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
