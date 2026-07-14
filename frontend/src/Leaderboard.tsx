import { useMemo } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor, standingsAt } from './replay'

interface Props {
  replay: ReplayData
  time: number
}

export default function Leaderboard({ replay, time }: Props) {
  // ricalcolo a mezzo secondo, non a 60fps: basta e avanza per una classifica
  const qt = Math.floor(time * 2) / 2
  const rows = useMemo(() => standingsAt(replay, qt), [replay, qt])
  const colorIndex = useMemo(
    () => new Map(replay.drivers.map((d, i) => [d.num, i])),
    [replay],
  )

  return (
    <div className="leaderboard">
      <table>
        <tbody>
          {rows.map(r => {
            const bg = teamColor(r.driver.team, colorIndex.get(r.driver.num) ?? 0)
            return (
              <tr key={r.driver.num} className={r.out ? 'out' : ''}>
                <td className="pos">{r.pos}</td>
                <td>
                  <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                    {r.driver.abbr}
                  </span>
                </td>
                <td className="lap">G{r.lap}</td>
                <td className="gap">{r.gapText}</td>
                <td className="pit">{r.inPit && !r.out ? 'BOX' : ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
