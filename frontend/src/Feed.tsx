import { useMemo, useRef, useState } from 'react'
import type { FeedData, ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor } from './replay'

interface Props {
  feed: FeedData
  replay: ReplayData
  time: number
}

type Item =
  | { t: number; kind: 'rc'; flag: string | null; text: string }
  | { t: number; kind: 'radio'; num: string; url: string }

const FLAG_COLORS: Record<string, string> = {
  GREEN: '#2ecc71',
  CLEAR: '#2ecc71',
  YELLOW: '#f1c40f',
  'DOUBLE YELLOW': '#f1c40f',
  RED: '#e74c3c',
  BLUE: '#3498db',
  CHEQUERED: '#ddd',
  'BLACK AND WHITE': '#ddd',
}

function fmtClock(s: number): string {
  const neg = s < 0
  const a = Math.abs(s)
  const h = Math.floor(a / 3600)
  const m = Math.floor((a % 3600) / 60)
  const sec = Math.floor(a % 60)
  return `${neg ? '−' : ''}${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

export default function Feed({ feed, replay, time }: Props) {
  // un aggiornamento al secondo basta per un feed testuale
  const qt = Math.floor(time)
  const [playingUrl, setPlayingUrl] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...feed.race_control
        .filter(m => m.message)
        .map(m => ({ t: m.t, kind: 'rc' as const, flag: m.flag, text: m.message! })),
      ...feed.radio
        .map(r => ({ t: r.t, kind: 'radio' as const, num: r.num, url: r.url })),
    ]
    return all.sort((a, b) => a.t - b.t)
  }, [feed])

  const drivers = useMemo(
    () => new Map(replay.drivers.map((d, i) => [d.num, { abbr: d.abbr, color: teamColor(d.team, i) }])),
    [replay],
  )

  // visibili: gia' accaduti al tempo del replay, i piu' recenti in alto
  const visible = useMemo(
    () => items.filter(it => it.t <= qt).slice(-80).reverse(),
    [items, qt],
  )

  function toggle(url: string) {
    const audio = audioRef.current ?? (audioRef.current = new Audio())
    audio.onended = () => setPlayingUrl(null)
    if (playingUrl === url) {
      audio.pause()
      setPlayingUrl(null)
    } else {
      audio.src = url
      audio.play().catch(() => setPlayingUrl(null))
      setPlayingUrl(url)
    }
  }

  return (
    <div className="feed">
      <div className="feed-header">Direzione gara · Team radio</div>
      {visible.length === 0 && <p className="feed-empty">Nessun comunicato finora.</p>}
      {visible.map((it, i) => (
        <div className="feed-item" key={`${it.t}-${i}`}>
          <span className="feed-time">{fmtClock(it.t)}</span>
          {it.kind === 'rc' ? (
            <>
              {it.flag && FLAG_COLORS[it.flag] && (
                <span className="feed-flag" style={{ background: FLAG_COLORS[it.flag] }} />
              )}
              <span className="feed-msg">{it.text}</span>
            </>
          ) : (
            <>
              {(() => {
                const d = drivers.get(it.num)
                const bg = d?.color ?? '#555'
                return (
                  <span className="tag" style={{ background: bg, color: contrastColor(bg) }}>
                    {d?.abbr ?? it.num}
                  </span>
                )
              })()}
              <button className="feed-play" onClick={() => toggle(it.url)}>
                {playingUrl === it.url ? '⏸' : '▶'} radio
              </button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
