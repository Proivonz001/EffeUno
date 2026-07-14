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
}

export interface ReplayData {
  duration_s: number
  track: [number, number][]
  drivers: ReplayDriver[]
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
