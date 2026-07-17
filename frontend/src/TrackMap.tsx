import { useEffect, useMemo, useRef } from 'react'
import type { ReplayData } from './api'
import { teamColor } from './palette'
import { contrastColor, inPit, posAt, retirementTimes, trackStatusAt } from './replay'

interface Props {
  replay: ReplayData
  /** tempo corrente del replay in secondi, gestito dal genitore */
  time: number
  /** pilota evidenziato (numero), null = nessuno */
  focus: string | null
  onFocus: (num: string | null) => void
  /** [velocita' m/s, direzione di provenienza in gradi] o null */
  wind: [number, number] | null
}

/** colore del nastro pista secondo lo stato (verde/gialla/SC/VSC/rossa) */
const TRACK_TINT: Record<number, string> = {
  2: '#6b6020', 4: '#6b6020', 6: '#6b6020', 7: '#6b6020',
  5: '#6b2020',
}

export default function TrackMap({ replay, time, focus, onFocus, wind }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const timeRef = useRef(time)
  timeRef.current = time
  const windRef = useRef(wind)
  windRef.current = wind
  const focusRef = useRef(focus)
  focusRef.current = focus
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  // posizioni a schermo dell'ultimo frame, per il click sui pallini
  const dotsRef = useRef<{ x: number; y: number; num: string }[]>([])
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

    // lunghezza cumulata lungo il nastro: serve per approssimare i settori
    // marshal (il feed da' solo il numero, non la geometria) come tratti
    // uguali numerati dal traguardo
    const cum: number[] = [0]
    for (let i = 1; i < replay.track.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(
        replay.track[i][0] - replay.track[i - 1][0],
        replay.track[i][1] - replay.track[i - 1][1],
      ))
    }
    const totalLen = cum[cum.length - 1] || 1
    const maxSector = Math.max(...replay.sector_flags.map(f => f[1]), 0)

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
    let moved = 0
    const onDown = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; moved = 0 }
    const onMove = (e: PointerEvent) => {
      if (!drag) return
      const v = viewRef.current
      moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y)
      v.px += (e.clientX - drag.x) * devicePixelRatio
      v.py += (e.clientY - drag.y) * devicePixelRatio
      drag = { x: e.clientX, y: e.clientY }
    }
    const onUp = () => { drag = null }
    // click (non trascinamento) su un pallino: focus sul pilota
    const onClick = (e: MouseEvent) => {
      if (moved > 4) return
      const mx = e.offsetX * devicePixelRatio
      const my = e.offsetY * devicePixelRatio
      const R = 12 * devicePixelRatio
      const hit = dotsRef.current.find(d => Math.hypot(d.x - mx, d.y - my) <= R)
      onFocusRef.current(hit && hit.num !== focusRef.current ? hit.num : null)
    }
    const onDbl = () => { viewRef.current = { z: 1, px: 0, py: 0 } }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    canvas.addEventListener('dblclick', onDbl)
    canvas.addEventListener('click', onClick)

    let raf = 0
    const draw = () => {
      const dpr = devicePixelRatio
      if (canvas.width !== canvas.clientWidth * dpr) {
        canvas.width = canvas.clientWidth * dpr
        canvas.height = canvas.clientHeight * dpr
      }
      const t = timeRef.current
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // nastro pista, tinto secondo la bandiera corrente. Con la gialla
      // semplice, se abbiamo i settori marshal si tingono solo quelli
      const status = trackStatusAt(replay.track_status, t)
      const localYellow = status === 2 && maxSector > 0
      ctx.strokeStyle = (localYellow ? undefined : TRACK_TINT[status]) ?? '#3a3a3a'
      ctx.lineWidth = 7 * dpr * Math.sqrt(viewRef.current.z)
      ctx.lineJoin = 'round'
      ctx.beginPath()
      replay.track.forEach((p, i) => {
        const [x, y] = toScreen(p[0], p[1])
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      })
      ctx.stroke()

      // zone DRS (solo pre-2026): tratto del nastro evidenziato in verde
      const ribbon = ctx.lineWidth
      ctx.strokeStyle = '#2e6b45'
      replay.drs_zones.forEach(zone => {
        ctx.beginPath()
        zone.forEach((p, i) => {
          const [x, y] = toScreen(p[0], p[1])
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.stroke()
      })
      ctx.lineWidth = ribbon

      // settori marshal con bandiera gialla al tempo t: tratti approssimati
      // (lunghezze uguali dal traguardo), doppia gialla piu' accesa
      if (maxSector > 0) {
        const active = new Map<number, number>()
        for (const [ts, sec, code] of replay.sector_flags) {
          if (ts > t) break
          if (code === 0) active.delete(sec)
          else active.set(sec, code)
        }
        for (const [sec, code] of active) {
          const d0 = ((sec - 1) / maxSector) * totalLen
          const d1 = (sec / maxSector) * totalLen
          ctx.strokeStyle = code === 3 ? '#d1a91c' : '#a8891c'
          ctx.beginPath()
          let started = false
          for (let i = 0; i < replay.track.length; i++) {
            if (cum[i] < d0) continue
            if (cum[i] > d1) break
            const [x, y] = toScreen(replay.track[i][0], replay.track[i][1])
            if (!started) { ctx.moveTo(x, y); started = true }
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
      }

      // confini settore: tacca perpendicolare al nastro con etichetta
      const tick = (px: number, py: number, qx: number, qy: number,
        label: string | null, checkers: boolean) => {
        const [x0, y0] = toScreen(px, py)
        const [x1, y1] = toScreen(qx, qy)
        const a = Math.atan2(y1 - y0, x1 - x0)
        ctx.save()
        ctx.translate(x0, y0)
        ctx.rotate(a)
        if (checkers) {
          // striscia a scacchi del traguardo, perpendicolare alla pista
          const sq = ribbon / 4
          for (let r = -4; r < 4; r++) {
            for (let c = 0; c < 2; c++) {
              ctx.fillStyle = (r + c) % 2 === 0 ? '#ddd' : '#222'
              ctx.fillRect(c * sq - sq, r * sq, sq, sq)
            }
          }
        } else {
          ctx.strokeStyle = '#8a8a8a'
          ctx.lineWidth = 1.5 * dpr
          ctx.beginPath()
          ctx.moveTo(0, -ribbon * 0.8)
          ctx.lineTo(0, ribbon * 0.8)
          ctx.stroke()
        }
        if (label) {
          ctx.fillStyle = '#777'
          ctx.font = `600 ${8 * dpr}px system-ui`
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText(label, 0, -ribbon * 0.8 - 7 * dpr)
        }
        ctx.restore()
      }
      if (replay.track.length > 1) {
        tick(replay.track[0][0], replay.track[0][1],
          replay.track[1][0], replay.track[1][1], null, true)
      }
      // direzione locale del nastro: punto di pista piu' vicino al riferimento
      const trackDirAt = (m: [number, number]): [number, number] => {
        let best = 0
        let bestD = Infinity
        replay.track.forEach((p, j) => {
          const d = (p[0] - m[0]) ** 2 + (p[1] - m[1]) ** 2
          if (d < bestD) { bestD = d; best = j }
        })
        return replay.track[Math.min(best + 1, replay.track.length - 1)]
      }
      replay.sector_marks.forEach((m, i) => {
        const next = trackDirAt(m)
        tick(m[0], m[1], next[0], next[1], `S${i + 2}`, false)
      })

      // punti di detection: qui si decide chi ha l'overtake/DRS (<1s)
      replay.detection_points.forEach(m => {
        const [x0, y0] = toScreen(m[0], m[1])
        ctx.strokeStyle = '#2ecc71'
        ctx.lineWidth = 2 * dpr
        ctx.setLineDash([3 * dpr, 3 * dpr])
        const next = trackDirAt(m)
        const [x1, y1] = toScreen(next[0], next[1])
        const a = Math.atan2(y1 - y0, x1 - x0)
        ctx.save()
        ctx.translate(x0, y0)
        ctx.rotate(a)
        ctx.beginPath()
        ctx.moveTo(0, -ribbon * 0.9)
        ctx.lineTo(0, ribbon * 0.9)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = '#2ecc71'
        ctx.font = `600 ${8 * dpr}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('DET', 0, ribbon * 0.9 + 8 * dpr)
        ctx.restore()
      })

      // bussola del vento (alto a destra, fissa): direzione di provenienza
      // ruotata a "verso dove soffia", assumendo la mappa orientata a nord
      const w = windRef.current
      if (w) {
        const cx = canvas.width - 44 * dpr
        const cy = 40 * dpr
        const r = 16 * dpr
        ctx.strokeStyle = '#3a3a3a'
        ctx.lineWidth = 1.5 * dpr
        ctx.beginPath()
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = '#666'
        ctx.font = `600 ${7 * dpr}px system-ui`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('N', cx, cy - r - 6 * dpr)
        const a = ((w[1] + 180) % 360) * Math.PI / 180
        ctx.save()
        ctx.translate(cx, cy)
        ctx.rotate(a)
        ctx.strokeStyle = '#aaa'
        ctx.fillStyle = '#aaa'
        ctx.lineWidth = 2 * dpr
        ctx.beginPath()
        ctx.moveTo(0, r * 0.55)
        ctx.lineTo(0, -r * 0.45)
        ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(0, -r * 0.75)
        ctx.lineTo(-4 * dpr, -r * 0.25)
        ctx.lineTo(4 * dpr, -r * 0.25)
        ctx.closePath()
        ctx.fill()
        ctx.restore()
        ctx.fillStyle = '#888'
        ctx.font = `600 ${8 * dpr}px system-ui`
        ctx.fillText(`${w[0].toFixed(0)} m/s`, cx, cy + r + 8 * dpr)
      }

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
      dotsRef.current = []
      visible.forEach(({ x, y, i }) => {
        const d = replay.drivers[i]
        const { bg, fg } = colors[i]
        dotsRef.current.push({ x, y, num: d.num })
        ctx.fillStyle = bg
        ctx.beginPath()
        ctx.arc(x, y, R, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = 'rgba(0,0,0,0.55)'
        ctx.lineWidth = 1.5 * dpr
        ctx.stroke()
        if (d.num === focusRef.current) {
          ctx.strokeStyle = '#fff'
          ctx.lineWidth = 2 * dpr
          ctx.beginPath()
          ctx.arc(x, y, R + 2.5 * dpr, 0, Math.PI * 2)
          ctx.stroke()
        }
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
      canvas.removeEventListener('click', onClick)
    }
  }, [replay, colors, retireAt])

  return <canvas ref={canvasRef} className="track-map" title="rotellina: zoom — trascina: sposta — doppio click: reset — click su un pilota: focus — tratti gialli: settori marshal, posizione approssimata" />
}
