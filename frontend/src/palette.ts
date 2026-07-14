/** Palette propria, approssimata per squadra — niente colori/asset ufficiali
 *  (vincolo legale, vedi brief §3). Chiavi = TeamName come arriva dal feed. */
const TEAM_COLORS: Record<string, string> = {
  'Red Bull Racing': '#3671c6',
  'McLaren': '#ff8000',
  'Ferrari': '#e8002d',
  'Mercedes': '#27f4d2',
  'Aston Martin': '#229971',
  'Alpine': '#ff87bc',
  'Williams': '#64c4ff',
  'Racing Bulls': '#6692ff',
  'Kick Sauber': '#52e252',
  'Haas F1 Team': '#b6babd',
}

const FALLBACK = ['#f0f080', '#c080ff', '#80f0f0', '#ffb080', '#a0ffa0']

export function teamColor(team: string, index: number): string {
  return TEAM_COLORS[team] ?? FALLBACK[index % FALLBACK.length]
}
