// La curva de Hilbert del hilo de la marca: la misma con la que estan hechos el fondo de la web y el sello
// del Cerebro Digital. Un solo hilo que pasa por todas las celdas sin cruzarse nunca.

/** Celda (x, y) en la posicion d de la curva, en una rejilla de n x n (n potencia de 2). */
export function d2xy(n: number, d: number): [number, number] {
  let x = 0
  let y = 0
  let t = d
  for (let s = 1; s < n; s *= 2) {
    const rx = Math.floor(t / 2) % 2
    const ry = (t % 2) ^ rx
    if (ry === 0) {
      if (rx === 1) {
        x = s - 1 - x
        y = s - 1 - y
      }
      const tmp = x
      x = y
      y = tmp
    }
    x += s * rx
    y += s * ry
    t = Math.floor(t / 4)
  }
  return [x, y]
}

/**
 * El trazo SVG de la curva de orden `order` con celdas de `cell` unidades: de abajo a la izquierda a abajo a
 * la derecha. Cada paso es horizontal o vertical, asi que va en h/v relativos (la mitad de largo).
 */
export function hilbertPath(order: number, cell: number) {
  const n = 2 ** order
  let [px, py] = d2xy(n, 0)
  let path = `M${(px + 0.5) * cell} ${(n - py - 0.5) * cell}`
  for (let d = 1; d < n * n; d++) {
    const [x, y] = d2xy(n, d)
    path += x !== px ? `h${(x - px) * cell}` : `v${(py - y) * cell}`
    px = x
    py = y
  }
  return path
}
