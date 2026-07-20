import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/** Animazione di sorpasso nelle torri: confronta l'ordine delle righe tra
 *  un render e l'altro e marca chi e' salito (verde, zoom+) e chi e' sceso
 *  (rosso, zoom-). `slide` e' la distanza in px dalla vecchia posizione,
 *  cosi' la riga scivola fino a quella nuova invece di teletrasportarsi. */

export interface OvertakeFx {
  dir: 'up' | 'down'
  /** offset iniziale rispetto alla posizione nuova (px, >0 = veniva da sotto) */
  slide: number
}

const FX_MS = 1000

/**
 * @param order chiavi (numero pilota) nell'ordine di visualizzazione corrente
 * @param rowsPerDriver tr per pilota (2 nelle torri a doppia riga)
 * @param resetKey al cambio (nuova sessione caricata) si riparte senza animare
 */
export function useOvertakeFx(
  order: string[], rowsPerDriver: number, resetKey?: unknown,
) {
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef<string[]>([])
  const reset = useRef<unknown>(resetKey)
  const timer = useRef<number>(0)
  const [fx, setFx] = useState<Map<string, OvertakeFx>>(new Map())

  const key = order.join(',')
  useLayoutEffect(() => {
    const before = prev.current
    prev.current = order
    if (reset.current !== resetKey) {
      reset.current = resetKey
      return
    }
    if (before.length === 0 || before.join(',') === key) return
    // altezza di una "riga pilota" misurata dal DOM per lo scivolamento
    const trs = ref.current?.querySelector<HTMLTableSectionElement>('tbody')?.rows
    let unit = 0
    for (let i = 0; i < rowsPerDriver && trs && i < trs.length; i++) {
      unit += trs[i].getBoundingClientRect().height
    }
    const next = new Map<string, OvertakeFx>()
    order.forEach((num, i) => {
      const old = before.indexOf(num)
      if (old < 0 || old === i) return
      next.set(num, { dir: i < old ? 'up' : 'down', slide: (old - i) * unit })
    })
    if (next.size === 0) return
    setFx(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFx(new Map()), FX_MS)
  }, [key, resetKey])  // eslint-disable-line react-hooks/exhaustive-deps

  return { ref, fx }
}

/** classe e stile da mettere su ogni tr del pilota */
export function fxProps(fx: OvertakeFx | undefined): {
  cls: string
  style?: CSSProperties
} {
  if (!fx) return { cls: '' }
  return {
    cls: fx.dir === 'up' ? 'ot-up' : 'ot-down',
    style: { '--ot-slide': `${fx.slide.toFixed(1)}px` } as CSSProperties,
  }
}
