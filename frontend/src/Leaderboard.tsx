import { useMemo } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor, lapTimesAt, sectorsAt, standingsAt, TYRE_COLORS } from './replay'
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

/** Ruota F1 stilizzata: gomma nera, anello colorato per mescola sulla
 *  spalla (come le marcature reali), iniziale della mescola al centro. */
export function TyreIcon({ c }: { c: string }) {
  const color = TYRE_COLORS[c] ?? '#ccc'
  return (
    <svg className="tyre-icon" viewBox="0 0 24 24" width="18" height="18" aria-label={`mescola ${c}`}>
      <circle cx="12" cy="12" r="11" fill="#161616" stroke="#000" strokeWidth="1" />
      <circle cx="12" cy="12" r="8.5" fill="none" stroke={color} strokeWidth="2.2" />
      <circle cx="12" cy="12" r="6.2" fill="#2e2e2e" />
      {/* baseline esplicita: centro (12) + metà altezza maiuscola (~0.35·font) —
          dominant-baseline centra l'em box, non la lettera, e sposta la maiuscola */}
      <text x="12" y="15.2" textAnchor="middle"
        fontSize="9" fontWeight="700" fill={color}>{c}</text>
    </svg>
  )
}

export default function Leaderboard({ replay, time }: Props) {
  // ricalcolo a mezzo secondo, non a 60fps: basta e avanza per una classifica
  const qt = Math.floor(time * 2) / 2
  const rows = useMemo(() => standingsAt(replay, qt), [replay, qt])
  const sectors = useMemo(() => sectorsAt(replay, qt), [replay, qt])
  const lapTimes = useMemo(() => lapTimesAt(replay, qt), [replay, qt])
  const colorIndex = useMemo(
    () => new Map(replay.drivers.map((d, i) => [d.num, i])),
    [replay],
  )

  return (
    <div className="leaderboard">
      <table>
        <thead>
          <tr>
            <th className="pos">P</th>
            <th></th>
            <th className="gap">Gap</th>
            <th className="int">Int.</th>
            <th>Settori</th>
            <th className="lap-time">Ultimo</th>
            <th className="lap-time">Migliore</th>
            <th>Gomma</th>
            <th className="pit-count">Pit</th>
            <th>TL</th>
            <th>Pen.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const bg = teamColor(r.driver.team, colorIndex.get(r.driver.num) ?? 0)
            const sec = sectors.get(r.driver.num)
            const lt = lapTimes.get(r.driver.num)
            return (
              <tr key={r.driver.num} className={r.out ? 'out' : ''}>
                <td className="pos">{r.pos}</td>
                <td>
                  <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                    {r.driver.abbr}
                  </span>
                </td>
                <td className="gap">{r.gapText}</td>
                <td className="int" title="distacco dal pilota davanti — cerchiato: overtake/DRS disponibile (<1s) — BOX: in pit lane">
                  {!r.out && (r.inPit ? (
                    <span className="box">BOX</span>
                  ) : r.interval !== null && (
                    <span className={r.drs ? 'drs' : ''}>+{r.interval.toFixed(1)}</span>
                  ))}
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
                <td className="lap-time" title="ultimo giro — verde: best personale, viola: best assoluto">
                  {!r.out && lt?.last && (
                    <span className={lt.last.cls}>{fmtLapTime(lt.last.time)}</span>
                  )}
                </td>
                <td className="lap-time best" title="miglior giro — viola: giro veloce della gara">
                  {!r.out && lt?.best != null && (
                    <span className={lt.fastest ? 'ob' : ''}>{fmtLapTime(lt.best)}</span>
                  )}
                </td>
                <td className="tyre" title="mescola · giri percorsi con questo treno">
                  {r.tyre && !r.out && (
                    <>
                      <TyreIcon c={r.tyre.c} />
                      <span className="age">{r.tyre.age ?? ''}</span>
                    </>
                  )}
                </td>
                <td className="pit-count" title="pit stop effettuati">
                  {!r.out && r.pitCount > 0 ? r.pitCount : ''}
                </td>
                <td className="tl-slot" title={r.tlCount > 0 ? `${r.tlCount} giri cancellati per track limits` : undefined}>
                  {!r.out && r.tlCount > 0 && (r.tlCount <= 6
                    ? Array.from({ length: r.tlCount }, (_, i) => <i key={i} className="tl-notch" />)
                    : <span className="tl-text">{r.tlCount}</span>)}
                </td>
                <td className="pen-slot">
                  {r.penalty && <span className="pen" title="penalita' dalla direzione gara">{r.penalty}</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
