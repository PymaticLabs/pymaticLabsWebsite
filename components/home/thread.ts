import * as THREE from 'three'

// El simbolo de la home: un solo hilo de luz (una curva de Hilbert) que recorre todo lo que sabe la
// empresa y que, visto desde arriba, dibuja un cerebro de icono: dos hemisferios, la cisura en medio y
// un unico puente entre ellos. Cada zona es un tramo del hilo. Al bajar a una zona, cada vuelta del
// hilo contiene el mismo dibujo en pequeno: sus carpetas y sus documentos. Al fondo, uno de esos
// documentos se abre como una pagina y el propio hilo escribe el titular en uno de sus renglones.
// Aqui solo esta la geometria; la escena (core-scene.tsx) la pinta y mueve la camara.

/** Orden de la curva en cada nivel: el cerebro, sus carpetas, sus documentos y la linea. */
export const ORDERS = [5, 8, 11, 17]
export const LEVELS = ORDERS.length
export const ZONE_COUNT = 6
const DEEPEST = ORDERS[LEVELS - 1]
/** Separacion entre los planos de dos niveles seguidos, en celdas del de arriba. */
const GAP = 2
/** Profundidad del primer nivel bajo la superficie del cerebro. */
const FIRST_DEPTH = 0.12
/** Media tarjeta de documento, en celdas (ancho y alto): al fondo, la tarjeta objetivo es la pagina. */
export const CARD = { half: 0.29, tall: 0.35 }

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
/** Rampa suave de 0 a 1 entre a y b. */
export const ramp = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}

export function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Numero entre 0 y 1 fijo para cada celda (para repartir puntos, candados y carpetas sin patron). */
export function hash(i: number, j: number, salt: number) {
  const s = Math.sin(i * 127.1 + j * 311.7 + salt * 74.7) * 43758.5453
  return s - Math.floor(s)
}

// ---------------------------------------------------------------- la curva

/** Posicion a lo largo de la curva de la celda (x, y) en una rejilla de n x n (con numeros: vale hasta orden 26). */
export function xy2d(n: number, x: number, y: number) {
  let d = 0
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = Math.floor(x / s) % 2
    const ry = Math.floor(y / s) % 2
    d += s * s * ((3 * rx) ^ ry)
    if (ry === 0) {
      if (rx === 1) {
        x = n - 1 - x
        y = n - 1 - y
      }
      const t = x
      x = y
      y = t
    }
  }
  return d
}

/** Celda en la posicion d de la curva (en out, para no crear un par nuevo en cada llamada). */
export function d2xy(n: number, d: number, out: [number, number] = [0, 0]): [number, number] {
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
  out[0] = x
  out[1] = y
  return out
}

/** Codigo de la direccion de una celda a su vecina: 0 derecha, 1 arriba, 2 izquierda, 3 abajo, 4 ninguna. */
function direction(dx: number, dy: number) {
  if (dx > 0) return 0
  if (dy > 0) return 1
  if (dx < 0) return 2
  if (dy < 0) return 3
  return 4
}

// ---------------------------------------------------------------- la forma

// El cuadrado de la curva se redondea en un ovalo algo mas estrecho delante, se abre la cisura
// entre los dos hemisferios y se levanta una boveda (con un valle suave sobre la cisura).
const WARP = { round: 0.9, gap: 0.035, sx: 0.93, sy: 1.16, taper: 0.055, height: 0.6, valley: 0.1 }

/** Del cuadrado (-1..1) a la silueta vista desde arriba. */
export function warp2(x: number, y: number): [number, number] {
  const u = x * Math.sqrt(1 - (y * y) / 2)
  const v = y * Math.sqrt(1 - (x * x) / 2)
  let X = x + (u - x) * WARP.round
  let Y = y + (v - y) * WARP.round
  X *= WARP.sx * (1 - WARP.taper * Y)
  X += Math.sign(x) * WARP.gap
  Y *= WARP.sy
  return [X, Y]
}

/** Altura de la boveda en un punto de la silueta. */
export function dome(X: number, Y: number) {
  const r2 = (X / (WARP.sx + 0.08)) ** 2 + (Y / (WARP.sy + 0.06)) ** 2
  const z = WARP.height * Math.pow(Math.max(0, 1 - r2), 0.5)
  return z * (1 - WARP.valley * 2.2 * Math.exp(-((Math.abs(X) / 0.16) ** 2)))
}

export function warp3(x: number, y: number, out = new THREE.Vector3()) {
  const [X, Y] = warp2(x, y)
  return out.set(X, Y, dome(X, Y))
}

/** Centro del cerebro (a media altura de la boveda): hacia donde mira la camara desde fuera. */
export const CENTER = new THREE.Vector3(0, -0.02, WARP.height * 0.35)

/**
 * Puntos del contorno del simbolo (el borde y un anillo a media altura de la boveda): proyectados,
 * dan la silueta en pantalla para dejar las etiquetas de las zonas por fuera.
 */
export function outlinePoints() {
  const points: THREE.Vector3[] = []
  const steps = 24
  for (const scale of [1, 0.62]) {
    for (let s = 0; s < steps; s++) {
      const a = (s / steps) * Math.PI * 2
      const c = Math.cos(a)
      const d = Math.sin(a)
      const m = Math.max(Math.abs(c), Math.abs(d))
      points.push(warp3((c / m) * scale, (d / m) * scale))
    }
  }
  return points
}

// ---------------------------------------------------------------- las zonas

const N0 = 2 ** ORDERS[0]

/**
 * Cada zona es un sexto del hilo. Para cada una: su centro (en el cuadrado) y la celda por la que
 * se baja, una del interior de su tramo, lejos del borde y de la cisura.
 */
function zoneCells() {
  const total = N0 * N0
  const at: [number, number] = [0, 0]
  return Array.from({ length: ZONE_COUNT }, (_, z) => {
    const a = Math.floor((z * total) / ZONE_COUNT)
    const b = Math.floor(((z + 1) * total) / ZONE_COUNT)
    let cx = 0
    let cy = 0
    for (let d = a; d < b; d++) {
      d2xy(N0, d, at)
      cx += at[0]
      cy += at[1]
    }
    cx /= b - a
    cy /= b - a
    let best = a
    let bestScore = -Infinity
    for (let d = a; d < b; d++) {
      const [i, j] = d2xy(N0, d, at)
      const x = (2 * (i + 0.5)) / N0 - 1
      const y = (2 * (j + 0.5)) / N0 - 1
      const interior = Math.min(Math.abs(x) - 0.28, 0.78 - Math.max(Math.abs(x), Math.abs(y)))
      const score = -Math.hypot(i - cx, j - cy) * 0.06 + Math.min(0, interior) * 40
      if (score > bestScore) {
        bestScore = score
        best = d
      }
    }
    return { center: [(2 * (cx + 0.5)) / N0 - 1, (2 * (cy + 0.5)) / N0 - 1] as [number, number], cell: best }
  })
}

/**
 * Todo lo que hace falta para bajar a una zona: el punto de la superficie por el que se entra, su
 * normal, los ejes de la rejilla alli (los niveles finos son planos tangentes, uno bajo otro), el
 * tamano de celda y la profundidad de cada nivel y la celda objetivo de cada uno. El hilo mas fino
 * (el ultimo nivel) va en el mismo plano que los documentos: rodea la pagina del documento objetivo.
 */
export interface ZoneFrame {
  zone: number
  /** Direccion (angulo en el plano) desde el centro hacia la zona: por ahi se la ve desde fuera. */
  azimuth: number
  /** Donde va la etiqueta de la zona, fuera del borde. */
  label: THREE.Vector3
  /** Posicion en el hilo del cerebro de la celda por la que se baja. */
  index0: number
  /** Celda objetivo en cada nivel. */
  cells: [number, number][]
  surface: THREE.Vector3
  normal: THREE.Vector3
  axisI: THREE.Vector3
  axisJ: THREE.Vector3
  unit: number[]
  depth: number[]
  /** Centro de la celda objetivo de cada nivel en el espacio (los niveles finos, sobre su plano). */
  centers: THREE.Vector3[]
}

export function buildFrames(): ZoneFrame[] {
  const deep = 2 ** DEEPEST
  const side = 2 ** (DEEPEST - ORDERS[0])
  return zoneCells().map(({ center, cell }, zone) => {
    // La celda a la que se baja esta, en cada nivel, en el centro de la del nivel anterior: asi cada
    // nivel aparece dentro del anterior.
    const [i0, j0] = d2xy(N0, cell)
    const inner = side / 2 + side / 16 + side / 128
    const pi = i0 * side + inner
    const pj = j0 * side + inner
    const xP = (2 * (pi + 0.5)) / deep - 1
    const yP = (2 * (pj + 0.5)) / deep - 1
    const surface = warp3(xP, yP)
    // Giro y escala de la silueta en ese punto: la rejilla fina sigue a la gruesa.
    const e = 1e-5
    const a1 = warp2(xP + e, yP)
    const a0 = warp2(xP - e, yP)
    const b1 = warp2(xP, yP + e)
    const b0 = warp2(xP, yP - e)
    const j00 = (a1[0] - a0[0]) / (2 * e)
    const j10 = (a1[1] - a0[1]) / (2 * e)
    const j01 = (b1[0] - b0[0]) / (2 * e)
    const j11 = (b1[1] - b0[1]) / (2 * e)
    const theta = Math.atan2(j10 - j01, j00 + j11)
    const scale = Math.sqrt(Math.abs(j00 * j11 - j01 * j10))
    const hx = (dome(surface.x + e, surface.y) - dome(surface.x - e, surface.y)) / (2 * e)
    const hy = (dome(surface.x, surface.y + e) - dome(surface.x, surface.y - e)) / (2 * e)
    const normal = new THREE.Vector3(-hx, -hy, 1).normalize()
    const e1 = new THREE.Vector3(1, 0, hx).normalize()
    const e2 = new THREE.Vector3().crossVectors(normal, e1).normalize()
    const axisI = e1.clone().multiplyScalar(Math.cos(theta)).addScaledVector(e2, Math.sin(theta))
    const axisJ = e1.clone().multiplyScalar(-Math.sin(theta)).addScaledVector(e2, Math.cos(theta))
    const unit = ORDERS.map((o) => (scale * 2) / 2 ** o)
    const depth = [0, FIRST_DEPTH]
    for (let k = 2; k < LEVELS - 1; k++) depth[k] = depth[k - 1] + GAP * unit[k - 1]
    depth[LEVELS - 1] = depth[LEVELS - 2]
    const cells = ORDERS.map((o) => [Math.floor(pi / 2 ** (DEEPEST - o)), Math.floor(pj / 2 ** (DEEPEST - o))] as [number, number])
    const centers = cells.map(([ci, cj], k) => {
      const n = 2 ** ORDERS[k]
      const x = (2 * (ci + 0.5)) / n - 1
      const y = (2 * (cj + 0.5)) / n - 1
      if (k === 0) return warp3(x, y)
      const dx = (x - xP) * scale
      const dy = (y - yP) * scale
      return surface
        .clone()
        .addScaledVector(axisI, dx)
        .addScaledVector(axisJ, dy)
        .addScaledVector(normal, -depth[k])
    })
    // Etiqueta: en el borde del cuadrado en la direccion del centro de la zona, un poco por fuera.
    const m = Math.max(Math.abs(center[0]), Math.abs(center[1])) || 1
    const [bx, by] = warp2(center[0] / m, center[1] / m)
    const r = Math.hypot(bx, by)
    const label = new THREE.Vector3(bx * (1 + 0.1 / r), by * (1 + 0.1 / r), 0.02)
    const [zx, zy] = warp2(center[0], center[1])
    return {
      zone,
      azimuth: Math.atan2(zy, zx),
      label,
      index0: cell,
      cells,
      surface,
      normal,
      axisI,
      axisJ,
      unit,
      depth,
      centers,
    }
  })
}

// ---------------------------------------------------------------- las mallas

/**
 * Marcas de cada celda (se suman): vuelta del hilo, punto, candado, carpeta, objetivo, borde y
 * tarjeta de documento; con tarjeta, su tipo va en los dos bits de "kind" (0 texto, 1 pdf, 2 hoja de
 * calculo, 3 foto).
 */
const MARK = { turn: 1, dot: 2, lock: 4, folder: 8, target: 16, rim: 32, card: 64, kind: 128 }

/** Zona con las areas cerradas del equipo: alli hay mas candados. */
const TEAM_ZONE = 2

/** Tipo de tarjeta segun la extension del nombre de un documento. */
export function fileKind(name: string) {
  const ext = /\.(\w+)/.exec(name)?.[1]?.toLowerCase() ?? ''
  if (ext === 'pdf') return 1
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 2
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 3
  return 0
}

/**
 * El cerebro entero (nivel 0), sobre la boveda: por celda, su nodo y los de la anterior y la
 * siguiente, y en "info" su zona, su posicion en el hilo (de 0 a 1, para el pulso), sus marcas y su
 * indice. Al final, el borde de cada hemisferio como un hilo cerrado.
 */
export function buildBrain() {
  const n = N0
  const total = n * n
  const rimSteps = 44
  const count = total + 2 * rimSteps * 6
  const a = new Float32Array(count * 3)
  const prev = new Float32Array(count * 3)
  const next = new Float32Array(count * 3)
  const info = new Float32Array(count * 4)
  const v = new THREE.Vector3()
  const put = (arr: Float32Array, q: number, ci: number, cj: number) => {
    warp3((2 * ci) / n - 1, (2 * cj) / n - 1, v)
    arr[q * 3] = v.x
    arr[q * 3 + 1] = v.y
    arr[q * 3 + 2] = v.z
  }
  const at: [number, number] = [0, 0]
  const before: [number, number] = [0, 0]
  const after: [number, number] = [0, 0]
  for (let d = 0; d < total; d++) {
    const [i, j] = d2xy(n, d, at)
    const [pi, pj] = d > 0 ? d2xy(n, d - 1, before) : at
    const [si, sj] = d < total - 1 ? d2xy(n, d + 1, after) : at
    put(a, d, i + 0.5, j + 0.5)
    put(prev, d, pi + 0.5, pj + 0.5)
    put(next, d, si + 0.5, sj + 0.5)
    const zone = Math.floor((d * ZONE_COUNT) / total)
    const turn = i - pi !== si - i || j - pj !== sj - j
    let marks = turn ? MARK.turn : 0
    if (turn && hash(i, j, 1) < 0.14) marks += MARK.dot
    if (hash(i, j, 2) < (zone === TEAM_ZONE ? 0.05 : 0.006)) marks += MARK.lock
    info[d * 4] = zone
    info[d * 4 + 1] = d / total
    info[d * 4 + 2] = marks
    info[d * 4 + 3] = d
  }
  // Borde: el contorno del cuadrado de cada mitad, deformado como el resto.
  let q = total
  const eps = 1e-6
  for (const side of [-1, 1]) {
    const i0 = side < 0 ? 0 : n / 2 + eps
    const i1 = side < 0 ? n / 2 - eps : n
    const ring: [number, number][] = []
    for (let s = 0; s < rimSteps; s++) ring.push([i0 + ((i1 - i0) * s) / rimSteps, 0])
    for (let s = 0; s < rimSteps * 2; s++) ring.push([i1, (n * s) / (rimSteps * 2)])
    for (let s = 0; s < rimSteps; s++) ring.push([i1 + ((i0 - i1) * s) / rimSteps, n])
    for (let s = 0; s < rimSteps * 2; s++) ring.push([i0, n - (n * s) / (rimSteps * 2)])
    const L = ring.length
    for (let s = 0; s < L; s++) {
      const p = ring[(s - 1 + L) % L]
      const c = ring[s]
      const b = ring[(s + 1) % L]
      put(prev, q, p[0], p[1])
      put(a, q, c[0], c[1])
      put(next, q, b[0], b[1])
      info[q * 4] = -9
      info[q * 4 + 1] = 0
      info[q * 4 + 2] = MARK.rim
      info[q * 4 + 3] = -9
      q++
    }
  }
  return { a, prev, next, info, count: q }
}

/**
 * Celdas con nombre alrededor del objetivo, en celdas de pantalla: en el nivel 1 las carpetas y en
 * el 2 los documentos (la primera es la del objetivo). Cada una en su fila, para que el nombre de un
 * documento quede debajo de su tarjeta sin pisar otro. En el movil van mas juntas.
 */
export function namedCells(wide: boolean, level: number): [number, number][] {
  if (wide) {
    return [
      [0, 0],
      [-3, 2],
      [3, 1],
      [-2, -2],
    ]
  }
  return level === 1
    ? [
        [0, 0],
        [-1, 1],
        [1, -1],
        [1, 2],
      ]
    : [
        [0, 0],
        [-1, 2],
        [1, -1],
        [-1, -2],
      ]
}

/** Ejes de la pantalla al llegar al fondo de una zona, en celdas de la rejilla (derecha y arriba). */
export interface ScreenAxes {
  right: [number, number]
  up: [number, number]
}

export const toGrid = (axes: ScreenAxes, a: number, b: number): [number, number] => [
  a * axes.right[0] + b * axes.up[0],
  a * axes.right[1] + b * axes.up[1],
]

/** Clave numerica de una celda relativa al objetivo (sin crear cadenas). */
const cellKey = (di: number, dj: number) => (di + 4096) * 8192 + (dj + 4096)

/**
 * Un nivel fino de una zona: un trozo de la curva alrededor de su celda objetivo, de 2 hw x 2 hh
 * celdas. Por celda: su posicion respecto a la objetivo, los enlaces con la anterior y la siguiente
 * mas sus marcas (anterior + 5 * siguiente + 25 * marcas) y su fase para el pulso. En los documentos,
 * algo menos de la mitad de las celdas son tarjetas (entre ellas se ven las vueltas del hilo); las que
 * tienen nombre llevan el tipo de su archivo y la de debajo se deja libre para el nombre. Se
 * construye a trozos (es un generador) para no parar el scroll.
 */
export function* buildPatch(frame: ZoneFrame, level: number, hw: number, hh: number, axes: ScreenAxes, wide: boolean, kinds: number[]) {
  const n = 2 ** ORDERS[level]
  const [ti, tj] = frame.cells[level]
  const dT = xy2d(n, ti, tj)
  const cells = new Float32Array(4 * hw * hh * 4)
  // Debajo de cada documento con nombre (y a sus lados) no va tarjeta: alli se lee su nombre. Debajo
  // del objetivo solo se deja libre la de en medio: sus vecinas son todas documentos, para que al
  // acercarse a el se vea entre otros.
  const named = new Map<number, number>()
  const below = new Set<number>()
  namedCells(wide, level).forEach(([a, b], k) => {
    const [gi, gj] = toGrid(axes, a, b)
    named.set(cellKey(gi, gj), k)
    for (let side = k === 0 ? 0 : -1; side <= (k === 0 ? 0 : 1); side++) {
      const [bi, bj] = toGrid(axes, a + side, b - 1)
      below.add(cellKey(bi, bj))
    }
  })
  const docs = level === 2
  const lockRate = level === LEVELS - 1 ? 0 : frame.zone === TEAM_ZONE ? (docs ? 0.1 : 0.06) : 0.008
  const before: [number, number] = [0, 0]
  const after: [number, number] = [0, 0]
  let count = 0
  let rows = 0
  for (let j = tj - hh; j < tj + hh; j++) {
    for (let i = ti - hw; i < ti + hw; i++) {
      if (i < 0 || j < 0 || i >= n || j >= n) continue
      const d = xy2d(n, i, j)
      const [pi, pj] = d > 0 ? d2xy(n, d - 1, before) : [i, j]
      const [si, sj] = d < n * n - 1 ? d2xy(n, d + 1, after) : [i, j]
      const di = i - ti
      const dj = j - tj
      const key = cellKey(di, dj)
      const name = named.get(key) ?? -1
      const target = di === 0 && dj === 0
      const turn = i - pi !== si - i || j - pj !== sj - j
      let marks = turn ? MARK.turn : 0
      if (turn && hash(i, j, 3 + level) < 0.12) marks += MARK.dot
      if (target) marks += MARK.target
      else if (hash(i, j, 7 + level) < lockRate || (docs && frame.zone === TEAM_ZONE && name === 1)) marks += MARK.lock
      if (level === 1 && (name >= 0 || (turn && hash(i, j, 11) < 0.1))) marks += MARK.folder
      const ring = Math.max(Math.abs(di), Math.abs(dj)) === 1
      if (docs && (target || name >= 0 || (!below.has(key) && (ring || hash(i, j, 13) < 0.42)))) {
        const r = hash(i, j, 17)
        const kind = name >= 0 ? (kinds[name] ?? 0) : r < 0.38 ? 0 : r < 0.68 ? 1 : r < 0.92 ? 2 : 3
        marks += MARK.card + MARK.kind * kind
      }
      const code = direction(pi - i, pj - j) + 5 * direction(si - i, sj - j) + 25 * marks
      const phase = (d - dT) / 8192
      const o = count * 4
      cells[o] = di
      cells[o + 1] = dj
      cells[o + 2] = code
      cells[o + 3] = phase - Math.floor(phase)
      count++
    }
    if (++rows % 12 === 0) yield
  }
  return { cells, count }
}

/**
 * El titular de una zona escrito con celdas del nivel mas fino: se rasteriza el titular del DOM y
 * se mira que celdas de una rejilla anclada en su centro quedan dentro de la letra. Cada celda
 * encendida guarda cuando se enciende: se escribe en orden de lectura, palabra a palabra y de
 * izquierda a derecha, como una pluma. Las vecinas a lo largo del hilo que tambien estan encendidas
 * se unen con el propio hilo.
 */
export interface Headline {
  cells: Float32Array
  count: number
  /** Centro del titular en px del lienzo: alli queda el centro de la pagina al llegar. */
  at: [number, number]
  step: number
  /** Ancho y alto del titular, en px. */
  size: [number, number]
  /** Linea de base de cada renglon, en px desde el centro del titular (hacia abajo). */
  baselines: number[]
  /** Distancia entre renglones, en px. */
  pitch: number
}

export function buildHeadline(frame: ZoneFrame, title: HTMLElement, canvas: DOMRect, axes: ScreenAxes, wide: boolean): Headline | null {
  const box = title.getBoundingClientRect()
  if (!box.width || !box.height || !canvas.width) return null
  const style = getComputedStyle(title)
  const fontSize = parseFloat(style.fontSize)
  const step = Math.min(7.5, Math.max(wide ? 3.4 : 2.6, fontSize / 15))
  const pad = Math.ceil(fontSize * 0.4)
  const ss = Math.max(1, Math.ceil(8 / step))
  const w = Math.ceil(box.width) + 2 * pad
  const h = Math.ceil(box.height) + 2 * pad
  const raster = document.createElement('canvas')
  raster.width = w * ss
  raster.height = h * ss
  const ctx = raster.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.scale(ss, ss)
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  ctx.letterSpacing = style.letterSpacing
  ctx.fillStyle = '#000'
  ctx.textBaseline = 'alphabetic'
  // Cada palabra va en su span: su caja empieza donde empieza la letra (por arriba, el ascendente).
  const ascent = ctx.measureText('Hg').fontBoundingBoxAscent
  const words: { left: number; right: number; top: number; bottom: number }[] = []
  title.querySelectorAll(':scope > span > span').forEach((word) => {
    const r = word.getBoundingClientRect()
    const left = r.left - box.left + pad
    const top = r.top - box.top + pad
    ctx.fillText(word.textContent ?? '', left, top + ascent)
    words.push({ left, right: left + r.width, top, bottom: top + r.height })
  })
  const data = ctx.getImageData(0, 0, raster.width, raster.height).data
  // Centro del titular, en px del lienzo y en px del raster.
  const hx = box.left + box.width / 2 - canvas.left
  const hy = box.top + box.height / 2 - canvas.top
  const ox = box.width / 2 + pad
  const oy = box.height / 2 + pad
  const ca = Math.floor(ox / step)
  const cb = Math.floor(oy / step)
  const lit: { a: number; b: number; rank: number }[] = []
  const probe = 4
  // La pluma recorre las palabras una detras de otra (con un pequeno salto entre ellas).
  const gap = fontSize * 0.35
  const starts: number[] = []
  let pen = 0
  for (const word of words) {
    starts.push(pen)
    pen += word.right - word.left + gap
  }
  const total = Math.max(1, pen - gap)
  for (let b = -cb; b <= cb; b++) {
    for (let a = -ca; a <= ca; a++) {
      const x0 = (ox + (a - 0.5) * step) * ss
      const y0 = (oy - (b + 0.5) * step) * ss
      let ink = 0
      for (let py = 0; py < probe; py++) {
        for (let px = 0; px < probe; px++) {
          const x = Math.floor(x0 + ((px + 0.5) / probe) * step * ss)
          const y = Math.floor(y0 + ((py + 0.5) / probe) * step * ss)
          if (x >= 0 && y >= 0 && x < raster.width && y < raster.height) ink += data[(y * raster.width + x) * 4 + 3]
        }
      }
      if (ink / (probe * probe * 255) <= 0.42) continue
      // Palabra a la que pertenece la celda: la que la contiene o, si no, la mas cercana.
      const cx = ox + a * step
      const cy = oy - b * step
      let best = 0
      let bestD = Infinity
      for (let k = 0; k < words.length; k++) {
        const wd = words[k]
        const dx = Math.max(wd.left - cx, 0, cx - wd.right)
        const dy = Math.max(wd.top - cy, 0, cy - wd.bottom)
        const dist = dx * dx + dy * dy * 4
        if (dist < bestD) {
          bestD = dist
          best = k
        }
      }
      const word = words[best]
      const along = word ? starts[best] + Math.min(Math.max(cx - word.left, 0), word.right - word.left) : 0
      lit.push({ a, b, rank: (along / total) * 0.96 })
    }
  }
  if (!lit.length) return null
  // Enlaces a lo largo del hilo entre celdas encendidas seguidas.
  const n = 2 ** DEEPEST
  const [ti, tj] = frame.cells[LEVELS - 1]
  const grid = lit.map(({ a, b }) => toGrid(axes, a, b))
  const byIndex = new Set(grid.map(([di, dj]) => xy2d(n, ti + di, tj + dj)))
  const at: [number, number] = [0, 0]
  const cells = new Float32Array(lit.length * 4)
  lit.forEach((c, k) => {
    const [di, dj] = grid[k]
    const d = xy2d(n, ti + di, tj + dj)
    const link = (e: number) => {
      if (!byIndex.has(e)) return 4
      const [x, y] = d2xy(n, e, at)
      return direction(x - ti - di, y - tj - dj)
    }
    cells[k * 4] = di
    cells[k * 4 + 1] = dj
    cells[k * 4 + 2] = link(d - 1) + 5 * link(d + 1)
    cells[k * 4 + 3] = c.rank
  })
  // Renglones: la linea de base de cada uno, desde el centro del titular.
  const tops: number[] = []
  for (const word of words) if (!tops.some((t) => Math.abs(t - word.top) < fontSize * 0.3)) tops.push(word.top)
  tops.sort((p, q) => p - q)
  const baselines = tops.map((t) => t + ascent - oy)
  const pitch = parseFloat(style.lineHeight) || fontSize * 0.95
  return { cells, count: lit.length, at: [hx, hy], step, size: [box.width, box.height], baselines, pitch }
}
