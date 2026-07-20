import { useMemo } from 'react'
import type { ReplayData } from './api'
import { TyreIcon } from './Leaderboard'
import { teamColor } from './palette'
import {
  bestSectorsAt, contrastColor, lapTimesAt, sectorsAt, standingsQualiAt,
} from './replay'

/** Torre per il replay di prove libere e qualifiche: stesso layout a
 *  doppia riga (LAST/BEST) della sezione live. I microsettori non
 *  esistono nei dati storici FastF1, quindi qui non ci sono i pallini. */

interface Props {
  replay: ReplayData
  time: number
}

function fmtLap(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`
}

const fmtSec = (s: number) => s.toFixed(3)

export default function QualiTower({ replay, time }: Props) {
  const qt = Math.floor(time * 2) / 2
  const rows = useMemo(() => standingsQualiAt(replay, qt), [replay, qt])
  const lapTimes = useMemo(() => lapTimesAt(replay, qt), [replay, qt])
  const lastSecs = useMemo(() => sectorsAt(replay, qt), [replay, qt])
  const bestSecs = useMemo(() => bestSectorsAt(replay, qt), [replay, qt])
  const colorIndex = useMemo(
    () => new Map(replay.drivers.map((d, i) => [d.num, i])),
    [replay],
  )

  return (
    <div className="leaderboard tower quali-tower">
      <table>
        <thead>
          <tr>
            <th>P</th><th></th><th></th><th className="t-num">Tempo</th>
            <th className="t-num">Gap</th>
            <th className="t-num">S1</th><th className="t-num">S2</th>
            <th className="t-num">S3</th><th>Gomma</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const bg = teamColor(r.driver.team, colorIndex.get(r.driver.num) ?? 0)
            const lt = lapTimes.get(r.driver.num)
            const cur = lastSecs.get(r.driver.num)
            const best = bestSecs.get(r.driver.num)
            return [
              <tr key={`${r.driver.num}-last`} className="row-last">
                <td className="pos" rowSpan={2}>{r.pos}</td>
                <td rowSpan={2}>
                  <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                    {r.driver.abbr}
                  </span>
                </td>
                <td className="t-label">LAST</td>
                <td className={`t-num ${lt?.last?.cls === 'ob' ? 'lt-ob'
                  : lt?.last?.cls === 'pb' ? 'lt-pb' : ''}`}>
                  {r.inPit ? <span className="box">BOX</span>
                    : lt?.last ? fmtLap(lt.last.time) : ''}
                </td>
                <td className="t-num t-int"></td>
                {[0, 1, 2].map(k => {
                  const s = cur?.sectors[k]
                  return (
                    <td key={k} className={`t-num t-sec ${s?.cls === 'ob' ? 'lt-ob'
                      : s?.cls === 'pb' ? 'lt-pb' : ''}`}>
                      {s ? fmtSec(s.time) : ''}
                    </td>
                  )
                })}
                <td className="tyre-cell" rowSpan={2}
                  title="mescola · giri percorsi con questo treno (usura)">
                  {r.tyre && (
                    <>
                      <TyreIcon c={r.tyre.c} />
                      <span className="age">{r.tyre.age ?? ''}</span>
                    </>
                  )}
                </td>
              </tr>,
              <tr key={`${r.driver.num}-best`} className="row-best">
                <td className="t-label">BEST</td>
                <td className={`t-num ${lt?.fastest ? 'lt-ob' : ''}`}>
                  {lt?.best != null ? fmtLap(lt.best) : ''}
                </td>
                <td className="t-num t-int">{r.pos > 1 ? r.gapText : ''}</td>
                {[0, 1, 2].map(k => {
                  const s = best?.sectors[k]
                  return (
                    <td key={k} className={`t-num t-sec ${s?.ob ? 'lt-ob' : ''}`}>
                      {s ? fmtSec(s.time) : ''}
                    </td>
                  )
                })}
              </tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
