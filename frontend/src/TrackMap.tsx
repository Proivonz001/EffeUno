import { useEffect, useRef } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'

/** Se il campione piu' vicino e' piu' lontano di cosi', il pilota non viene
 *  disegnato (box, ritiro, buco dati — visti fino a 1.4s in Fase 0). */
const MAX_STALE_S = 5

interface Props {
  replay: ReplayData
  /** tempo corrente del replay in secondi, gestito dal genitore */
  time: number
}

/** Posizione al tempo t: ricerca binaria + interpolazione lineare
 *  (validata in Fase 0: il dato grezzo a 3.8Hz scatta, la lerp basta). */
function posAt(points: [number, number, number][], t: number):
  { x: number; y: number; stale: boolean } {
  let lo = 0
  let hi = points.length - 1
  if (t <= points[0][0]) return { x: points[0][1], y: points[0][2], stale: points[0][0] - t > MAX_STALE_S }
  if (t >= points[hi][0]) return { x: points[hi][1], y: points[hi][2], stale: t - points[hi][0] > MAX_STALE_S }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid][0] <= t) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  if (b[0] - a[0] > MAX_STALE_S) {
    // buco dati: niente lerp attraverso il buco, resta sull'ultimo campione
    return { x: a[1], y: a[2], stale: t - a[0] > MAX_STALE_S }
  }
  const f = (t - a[0]) / (b[0] - a[0])
  return { x: a[1] + (b[1] - a[1]) * f, y: a[2] + (b[2] - a[2]) * f, stale: false }
}

export default function TrackMap({ replay, time }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(time)
  timeRef.current = time

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    const xs = replay.track.map(p => p[0])
    const ys = replay.track.map(p => p[1])
    const bounds = {
      x0: Math.min(...xs), x1: Math.max(...xs),
      y0: Math.min(...ys), y1: Math.max(...ys),
    }

    const toScreen = (x: number, y: number): [number, number] => {
      const pad = 30 * devicePixelRatio
      const s = Math.min(
        (canvas.width - 2 * pad) / (bounds.x1 - bounds.x0),
        (canvas.height - 2 * pad) / (bounds.y1 - bounds.y0),
      )
      const ox = (canvas.width - (bounds.x1 - bounds.x0) * s) / 2
      const oy = (canvas.height - (bounds.y1 - bounds.y0) * s) / 2
      return [ox + (x - bounds.x0) * s, canvas.height - (oy + (y - bounds.y0) * s)]
    }

    let raf = 0
    const draw = () => {
      const dpr = devicePixelRatio
      if (canvas.width !== canvas.clientWidth * dpr) {
        canvas.width = canvas.clientWidth * dpr
        canvas.height = canvas.clientHeight * dpr
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      ctx.strokeStyle = '#3a3a3a'
      ctx.lineWidth = 7 * dpr
      ctx.lineJoin = 'round'
      ctx.beginPath()
      replay.track.forEach((p, i) => {
        const [x, y] = toScreen(p[0], p[1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      ctx.font = `${10 * dpr}px system-ui`
      replay.drivers.forEach((d, i) => {
        const p = posAt(d.points, timeRef.current)
        if (p.stale) return
        const [x, y] = toScreen(p.x, p.y)
        ctx.fillStyle = teamColor(d.team, i)
        ctx.beginPath()
        ctx.arc(x, y, 5 * dpr, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillText(d.abbr, x + 7 * dpr, y - 5 * dpr)
      })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [replay])

  return <canvas ref={canvasRef} className="track-map" />
}
