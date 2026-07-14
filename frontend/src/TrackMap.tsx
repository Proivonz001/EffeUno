import { useEffect, useMemo, useRef } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor, inPit, posAt, retirementTimes, trackStatusAt } from './replay'

interface Props {
  replay: ReplayData
  /** tempo corrente del replay in secondi, gestito dal genitore */
  time: number
}

/** colore del nastro pista secondo lo stato (verde/gialla/SC/VSC/rossa) */
const TRACK_TINT: Record<number, string> = {
  2: '#6b6020', 4: '#6b6020', 6: '#6b6020', 7: '#6b6020',
  5: '#6b2020',
}

export default function TrackMap({ replay, time }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(time)
  timeRef.current = time
  // zoom/pan utente sopra la trasformazione di fit
  const viewRef = useRef({ z: 1, px: 0, py: 0 })

  const colors = useMemo(
    () => replay.drivers.map((d, i) => {
      const bg = teamColor(d.team, i)
      return { bg, fg: contrastColor(bg) }
    }),
    [replay],
  )
  const retireAt = useMemo(() => retirementTimes(replay), [replay])

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
      const { z, px, py } = viewRef.current
      return [
        (ox + (x - bounds.x0) * s) * z + px,
        (canvas.height - (oy + (y - bounds.y0) * s)) * z + py,
      ]
    }

    // --- zoom con rotellina (centrato sul cursore) e pan col trascinamento ---
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const k = Math.exp(-e.deltaY * 0.0015)
      const z = Math.min(25, Math.max(1, v.z * k))
      const applied = z / v.z
      const mx = e.offsetX * devicePixelRatio
      const my = e.offsetY * devicePixelRatio
      v.px = mx - applied * (mx - v.px)
      v.py = my - applied * (my - v.py)
      v.z = z
      if (z <= 1.01) { v.z = 1; v.px = 0; v.py = 0 }
    }
    let drag: { x: number; y: number } | null = null
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY } }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const v = viewRef.current
      v.px += (e.clientX - drag.x) * devicePixelRatio
      v.py += (e.clientY - drag.y) * devicePixelRatio
      drag = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => { drag = null }
    const onDbl = () => { viewRef.current = { z: 1, px: 0, py: 0 } }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('dblclick', onDbl)

    let raf = 0
    const draw = () => {
      const dpr = devicePixelRatio
      if (canvas.width !== canvas.clientWidth * dpr) {
        canvas.width = canvas.clientWidth * dpr
        canvas.height = canvas.clientHeight * dpr
      }
      const t = timeRef.current
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // nastro pista, tinto secondo la bandiera corrente
      const status = trackStatusAt(replay.track_status, t)
      ctx.strokeStyle = TRACK_TINT[status] ?? '#3a3a3a'
      ctx.lineWidth = 7 * dpr * Math.sqrt(viewRef.current.z)
      ctx.lineJoin = 'round'
      ctx.beginPath()
      replay.track.forEach((p, i) => {
        const [x, y] = toScreen(p[0], p[1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // pit lane (traversata reale dei box) — sopra il nastro, che a molti
      // circuiti corre attaccato alla corsia e la coprirebbe
      if (replay.pit_lane.length > 1) {
        ctx.strokeStyle = '#6e6e6e'
        ctx.lineWidth = 2 * dpr * Math.sqrt(viewRef.current.z)
        ctx.lineJoin = 'round'
        ctx.setLineDash([5 * dpr, 4 * dpr])
        ctx.beginPath()
        replay.pit_lane.forEach((p, i) => {
          const [x, y] = toScreen(p[0], p[1])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
        ctx.setLineDash([])
      }

      const R = 10 * dpr
      // piloti visibili: i ritirati spariscono dalla mappa (in classifica
      // restano, marcati OUT)
      const visible: { x: number; y: number; i: number }[] = []
      replay.drivers.forEach((d, i) => {
        if (t > retireAt[i]) return
        const p = posAt(d.points, t)
        if (p.stale) return
        const [x, y] = toScreen(p.x, p.y)
        visible.push({ x, y, i })
      })

      // pallini con la sigla dentro
      const badges: [number, number][] = []
      visible.forEach(({ x, y, i }) => {
        const d = replay.drivers[i]
        const { bg, fg } = colors[i]
        ctx.fillStyle = bg
        ctx.beginPath()
        ctx.arc(x, y, R, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
        ctx.fillStyle = fg
        ctx.font = `700 ${7 * dpr}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(d.abbr, x, y + 0.5 * dpr)

        if (inPit(d.pits, t)) badges.push([x, y])
      })

      // badge BOX in un secondo passaggio, sempre sopra i pallini
      badges.forEach(([x, y]) => {
        const w = 26 * dpr
        const h = 11 * dpr
        ctx.fillStyle = '#f1c40f'
        ctx.beginPath()
        ctx.roundRect(x - w / 2, y - R - h - 3 * dpr, w, h, 3 * dpr)
        ctx.fill()
        ctx.fillStyle = '#111'
        ctx.font = `700 ${7 * dpr}px system-ui`
        ctx.fillText('BOX', x, y - R - h / 2 - 2.5 * dpr)
      })
      ctx.textAlign = 'start'
      ctx.textBaseline = 'alphabetic'
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('dblclick', onDbl)
    }
  }, [replay, colors, retireAt])

  return <canvas ref={canvasRef} className="track-map" title="rotellina: zoom — trascina: sposta — doppio click: reset" />
}
