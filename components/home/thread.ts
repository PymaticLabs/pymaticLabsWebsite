import * as THREE from 'three'

// El simbolo de la home: un solo hilo de luz (una curva de Hilbert) que recorre todo lo que sabe la
// empresa y que, visto desde arriba, dibuja un cerebro de icono: dos hemisferios, la cisura en medio y
// un unico puente entre ellos. Cada zona es un tramo del hilo. Al acercarse a una zona, algunas celdas
// de su tramo llevan sus carpetas y documentos con nombre, y el propio hilo dibuja el titular encima.
// Aqui solo esta la geometria; la escena (core-scene.tsx) la pinta y mueve la camara.

/** Orden de la curva del cerebro (32 x 32 celdas) y de la rejilla con la que el hilo dibuja los titulares. */
const ORDER = 5
const HEAD_ORDER = 10
export const ZONE_COUNT = 6
/** Tamano de las carpetas y las tarjetas respecto a la celda: casi la llenan, para leerse de cerca (lo usan la escena y los shaders). */
export const GLYPH = 1.3

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
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

/** Semiejes de la boveda (un medio elipsoide): tambien la sombrean los shaders en el modo claro. */
export const DOME = { a: WARP.sx + 0.08, b: WARP.sy + 0.06, height: WARP.height }

/** Altura de la boveda en un punto de la silueta. */
export function dome(X: number, Y: number) {
  const r2 = (X / DOME.a) ** 2 + (Y / DOME.b) ** 2
  const z = DOME.height * Math.pow(Math.max(0, 1 - r2), 0.5)
  return z * (1 - WARP.valley * 2.2 * Math.exp(-((Math.abs(X) / 0.16) ** 2)))
}

export function warp3(x: number, y: number, out = new THREE.Vector3()) {
  const [X, Y] = warp2(x, y)
  return out.set(X, Y, dome(X, Y))
}

/** Centro del cerebro (a media altura de la boveda): hacia donde mira la camara desde fuera. */
export const CENTER = new THREE.Vector3(0, -0.02, WARP.height * 0.35)

/**
 * La unica vista del simbolo, la de la portada: desde delante y casi desde arriba, con la cisura en
 * vertical. La camara nunca gira: solo se aleja y se acerca.
 */
const ELEVATION = THREE.MathUtils.degToRad(74)
export const VIEW = {
  /** Del simbolo hacia la camara. */
  dir: new THREE.Vector3(0, -Math.cos(ELEVATION), Math.sin(ELEVATION)),
  /** Derecha y arriba de la pantalla. */
  right: new THREE.Vector3(1, 0, 0),
  up: new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION)),
}

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

const N0 = 2 ** ORDER
/** Celdas del hilo del cerebro y lado de una (en el centro del simbolo, en unidades del espacio). */
export const CELLS = N0 * N0
export const CELL_SIZE = (2 * WARP.sx) / N0

/** Cada zona es un sexto del hilo: su tramo (de first a last, sin incluirla), su etiqueta y su centro. */
export interface ZoneFrame {
  zone: number
  first: number
  last: number
  /** Donde va la etiqueta de la zona, fuera del borde. */
  label: THREE.Vector3
  /** Punto de la boveda en el centro de la zona: a el se acerca la camara. */
  focus: THREE.Vector3
}

export function buildFrames(): ZoneFrame[] {
  const at: [number, number] = [0, 0]
  return Array.from({ length: ZONE_COUNT }, (_, zone) => {
    // Las mismas celdas que llevan su zona en la malla (ver buildBrain).
    const first = Math.ceil((zone * CELLS) / ZONE_COUNT)
    const last = Math.ceil(((zone + 1) * CELLS) / ZONE_COUNT)
    let cx = 0
    let cy = 0
    for (let d = first; d < last; d++) {
      d2xy(N0, d, at)
      cx += at[0]
      cy += at[1]
    }
    const x = (2 * (cx / (last - first) + 0.5)) / N0 - 1
    const y = (2 * (cy / (last - first) + 0.5)) / N0 - 1
    // Etiqueta: en el borde del cuadrado en la direccion del centro de la zona, un poco por fuera.
    const m = Math.max(Math.abs(x), Math.abs(y)) || 1
    const [bx, by] = warp2(x / m, y / m)
    const r = Math.hypot(bx, by)
    const label = new THREE.Vector3(bx * (1 + 0.1 / r), by * (1 + 0.1 / r), 0.02)
    return { zone, first, last, label, focus: warp3(x, y) }
  })
}

// ---------------------------------------------------------------- las mallas

/**
 * Marcas de cada celda (se suman): vuelta del hilo, punto, candado, carpeta, borde y tarjeta de
 * documento; con tarjeta, su tipo va en los dos bits de "kind" (0 texto, 1 pdf, 2 hoja de calculo, 3 foto).
 * Carpetas y tarjetas solo las llevan las celdas con nombre (ver namedMarks).
 */
const MARK = { turn: 1, dot: 2, lock: 4, folder: 8, rim: 32, card: 64, kind: 128 }

/** Zona con las areas cerradas del equipo: alli hay mas candados. */
export const TEAM_ZONE = 2

/** Tipo de tarjeta segun la extension del nombre de un documento. */
export function fileKind(name: string) {
  const ext = /\.(\w+)/.exec(name)?.[1]?.toLowerCase() ?? ''
  if (ext === 'pdf') return 1
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 2
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'png') return 3
  return 0
}

/** Si una celda es una vuelta del hilo y si lleva candado, segun sus marcas. */
export const isTurn = (marks: number) => (marks & MARK.turn) !== 0
export const isLock = (marks: number) => (marks & MARK.lock) !== 0

/** Marcas de una celda sin carpeta, tarjeta ni candado (las de las vecinas de una con nombre, para que no se confundan). */
export const plainMarks = (marks: number) => marks & (MARK.turn | MARK.dot | MARK.rim)

/** Marcas de una celda con nombre: su carpeta o la tarjeta de su documento (de su tipo y, si va con llave, con candado). */
export function namedMarks(marks: number, folder: boolean, kind: number, lock: boolean) {
  const keep = marks & (MARK.turn | MARK.dot)
  return keep + (folder ? MARK.folder : MARK.card + MARK.kind * kind) + (lock ? MARK.lock : 0)
}

/** Las cuatro vecinas de una celda (y las de las esquinas) en el hilo del cerebro, por su posicion en el hilo. */
export function neighbors(d: number) {
  const [i, j] = d2xy(N0, d)
  const out: number[] = []
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const x = i + di
      const y = j + dj
      if ((di || dj) && x >= 0 && y >= 0 && x < N0 && y < N0) out.push(xy2d(N0, x, y))
    }
  }
  return out
}

/**
 * Puntos de la boveda en los cuatro lados de la celda d (izquierda, derecha, abajo y arriba):
 * proyectados, dicen cuanto mide en pantalla en cada direccion y si alli la boveda se ve de lado.
 */
export function cellSides(d: number): THREE.Vector3[] {
  const [i, j] = d2xy(N0, d)
  const x = (2 * i + 1) / N0 - 1
  const y = (2 * j + 1) / N0 - 1
  const h = 1 / N0
  return [warp3(x - h, y), warp3(x + h, y), warp3(x, y - h), warp3(x, y + h)]
}

/**
 * El cerebro entero, sobre la boveda: por celda, su nodo y los de la anterior y la siguiente, y en
 * "info" su zona, su posicion en el hilo (de 0 a 1, para el pulso), sus marcas y su indice. Las
 * carpetas y las tarjetas se ponen despues, en las celdas con nombre (solo se ven de cerca, en la zona
 * a la que se va). Al final, el borde de cada hemisferio como un hilo cerrado.
 */
export function buildBrain() {
  const n = N0
  const total = CELLS
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

export type Brain = ReturnType<typeof buildBrain>

/**
 * El titular de una zona dibujado por el hilo: se rasteriza el titular del DOM y se mira que celdas
 * de una rejilla anclada en su centro (con la derecha y el arriba de la pantalla) quedan dentro de la
 * letra. Se enciende entero de una vez (con un fundido suave, ver core-scene.tsx). Las vecinas a lo
 * largo de una curva de Hilbert que tambien estan encendidas se unen con el propio hilo.
 */
export interface Headline {
  cells: Float32Array
  count: number
  /** Centro del titular en px del lienzo. */
  at: [number, number]
  /** Lado de cada celda, en px. */
  step: number
}

export function buildHeadline(title: HTMLElement, canvas: DOMRect, wide: boolean): Headline | null {
  const box = title.getBoundingClientRect()
  if (!box.width || !box.height || !canvas.width) return null
  const style = getComputedStyle(title)
  const fontSize = parseFloat(style.fontSize)
  // Celdas finas (unas 24 por cuerpo de letra): la letra sale con su forma y se lee sin esfuerzo.
  const step = Math.min(5, Math.max(wide ? 2.6 : 2.2, fontSize / 24))
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
  title.querySelectorAll(':scope > span > span').forEach((word) => {
    const r = word.getBoundingClientRect()
    ctx.fillText(word.textContent ?? '', r.left - box.left + pad, r.top - box.top + pad + ascent)
  })
  const data = ctx.getImageData(0, 0, raster.width, raster.height).data
  // Centro del titular, en px del lienzo y en px del raster.
  const hx = box.left + box.width / 2 - canvas.left
  const hy = box.top + box.height / 2 - canvas.top
  const ox = box.width / 2 + pad
  const oy = box.height / 2 + pad
  const ca = Math.floor(ox / step)
  const cb = Math.floor(oy / step)
  const lit: [number, number][] = []
  const probe = 4
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
      if (ink / (probe * probe * 255) > 0.42) lit.push([a, b])
    }
  }
  if (!lit.length) return null
  // Enlaces a lo largo de la curva entre celdas encendidas seguidas (la rejilla centrada en la curva).
  const n = 2 ** HEAD_ORDER
  const o = n / 2
  const byIndex = new Set(lit.map(([a, b]) => xy2d(n, o + a, o + b)))
  const at: [number, number] = [0, 0]
  const cells = new Float32Array(lit.length * 4)
  lit.forEach(([a, b], k) => {
    const d = xy2d(n, o + a, o + b)
    const link = (e: number) => {
      if (!byIndex.has(e)) return 4
      const [x, y] = d2xy(n, e, at)
      return direction(x - o - a, y - o - b)
    }
    cells[k * 4] = a
    cells[k * 4 + 1] = b
    cells[k * 4 + 2] = link(d - 1) + 5 * link(d + 1)
  })
  return { cells, count: lit.length, at: [hx, hy], step }
}
