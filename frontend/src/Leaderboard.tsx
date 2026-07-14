import { useMemo } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor, fastestLapAt, sectorsAt, standingsAt, TYRE_COLORS } from './replay'
import type { SectorClass } from './replay'

interface Props {
  replay: ReplayData
  time: number
}

const SECTOR_COLORS: Record<SectorClass, string> = {
  ob: '#b455ff',  // viola: miglior settore assoluto
  pb: '#2ecc71',  // verde: miglior settore personale
  std: '#f1c40f', // giallo: piu' lento del proprio best
}

function fmtLapTime(s: number): string {
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`
}

export default function Leaderboard({ replay, time }: Props) {
  // ricalcolo a mezzo secondo, non a 60fps: basta e avanza per una classifica
  const qt = Math.floor(time * 2) / 2
  const rows = useMemo(() => standingsAt(replay, qt), [replay, qt])
  const sectors = useMemo(() => sectorsAt(replay, qt), [replay, qt])
  const fastestFn = useMemo(() => fastestLapAt(replay), [replay])
  const fastest = useMemo(() => fastestFn(qt), [fastestFn, qt])
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
            const sec = sectors.get(r.driver.num)
            return (
              <tr key={r.driver.num} className={r.out ? 'out' : ''}>
                <td className="pos">{r.pos}</td>
                <td>
                  <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                    {r.driver.abbr}
                  </span>
                </td>
                <td className="gap">{r.gapText}</td>
                <td className="int" title="distacco dal pilota davanti — cerchiato: overtake/DRS disponibile (<1s)">
                  {!r.out && r.interval !== null && (
                    <span className={r.drs ? 'drs' : ''}>+{r.interval.toFixed(1)}</span>
                  )}
                </td>
                <td className="tyre" title="mescola · giri percorsi con questo treno">
                  {r.tyre && !r.out && (
                    <>
                      <span style={{ color: TYRE_COLORS[r.tyre.c] ?? '#ccc' }}>{r.tyre.c}</span>
                      <span className="age">{r.tyre.age ?? ''}</span>
                    </>
                  )}
                </td>
                <td className="sectors" title="settori del giro in corso — viola: best assoluto, verde: best personale, giallo: piu' lento">
                  {!r.out && [0, 1, 2].map(i => {
                    const s = sec?.sectors[i]
                    return (
                      <span
                        key={i}
                        className="sector-block"
                        style={{ background: s ? SECTOR_COLORS[s.cls] : '#333' }}
                      />
                    )
                  })}
                </td>
                <td className="badges">
                  {!r.out && fastest?.num === r.driver.num && (
                    <span className="fl" title={`giro piu' veloce: ${fmtLapTime(fastest.time)}`}>FL</span>
                  )}
                  {!r.out && r.tlCount > 0 && (
                    <span className="tl" title={`${r.tlCount} giri cancellati per track limits`}>
                      TL{r.tlCount}
                    </span>
                  )}
                  {r.penalty && <span className="pen" title="penalita' dalla direzione gara">{r.penalty}</span>}
                  {r.inPit && !r.out && <span className="pit">BOX</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
