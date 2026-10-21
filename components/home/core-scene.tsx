"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MotionValue } from 'motion/react'
import { sceneAt, stage } from '@/components/home/stage'
import {
  CELL_SIZE,
  CELLS,
  CENTER,
  GLYPH,
  TEAM_ZONE,
  VIEW,
  ZONE_COUNT,
  buildBrain,
  buildFrames,
  buildHeadline,
  cellSides,
  fileKind,
  isLock,
  isTurn,
  namedMarks,
  neighbors,
  outlinePoints,
  plainMarks,
  ramp,
  type Brain,
  type Headline,
  type ZoneFrame,
} from '@/components/home/thread'
import { HEADLINE_FRAGMENT, HEADLINE_VERTEX, THREAD_FRAGMENT, THREAD_VERTEX } from '@/components/home/thread-shaders'

// El cerebro de la home: un solo hilo de luz que, visto desde arriba, dibuja un cerebro de icono
// (ver thread.ts). La camara mira siempre como en la portada (nunca gira), se mueve como sobre un
// mapa y nunca se aleja mas alla del simbolo entero, tal como se ve en la portada. En cada parada esta
// cerca de una zona: su tramo del hilo encendido y grande, sus carpetas y documentos con su nombre y
// el titular dibujado por el propio hilo, encima del titular real. Entre dos paradas se aleja despacio
// hasta ver el simbolo entero, la luz pasa a la zona siguiente y se acerca a ella, tambien despacio. En
// cada parada no se mueve nada mientras se lee.
// Escenas: 0 portada, 1 local, 2 historial, 3 equipo, 4 documentos, 5 carpetas, 6 tareas (la zona
// de la escena k es la k - 1 del hilo).
//
// Unidades: el cerebro mide unos 2 de ancho (x) y 2,3 de largo (y); la boveda sube en z.

const SCENE_COUNT = 7
const FOV = 40
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
/**
 * Tramos de cada escena, en escenas de scroll desde la parada anterior (cada una mide SCENE_VH, ver
 * stage.ts). En cada parada la camara esta quieta HOLD a cada lado. Luego se aleja hasta ver el
 * simbolo entero, se queda quieta un momento y se acerca a la zona siguiente, a la que llega HOLD antes
 * de su parada. La portada ya es la vista del simbolo entero: desde ella, sin que nada se mueva, la luz
 * llega a la primera zona (hasta FIRST_LIGHT) y desde FIRST_IN la camara se acerca, con mas calma que en
 * los demas tramos (este es mas largo).
 */
const HOLD = 0.15
const OUT_END = 0.475
const IN_START = 0.525
const ARRIVE = 1 - HOLD
const FIRST_LIGHT = 0.3
const FIRST_IN = 0.35
/**
 * Cuanto se acerca la camara a cada zona: su tamano en la parada respecto al simbolo entero. Con los
 * tramos de arriba, EASE y SCENE_VH 320 (stage.ts), un golpe de rueda (100 px en una pantalla de 900)
 * acerca como mucho x1,115: mas zoom, a la misma calma, pide mas scroll entre paradas.
 */
const ZONE_ZOOM = 2.4
/**
 * Mientras la camara se acerca a una zona, el centro del simbolo se desplaza a lo sumo MAX_SHIFT del
 * ancho de la pantalla (asi un golpe de rueda lo mueve menos de un 5 % del ancho). Dentro de eso, la
 * zona queda donde mas se ve su tramo, fuera de su texto y de los instrumentos; cada ancho de pantalla
 * que se desplaza cuesta SHIFT_COST de lo que se ve (a igualdad, el sitio que menos lo mueve).
 */
const MAX_SHIFT = 0.25
const SHIFT_COST = 0.2
/** Arranque y frenada de cada tramo, en parte del tramo (en medio va a velocidad constante); en el primero, mas suaves. */
const EASE = 0.14
const FIRST_EASE = 0.3
/** Mientras la camara termina de alejarse, la luz pasa de una zona a la siguiente: con el simbolo entero quieto ya esta en ella. */
const LIGHT_FROM = 0.3
const LIGHT_TO = OUT_END
/**
 * Texto de cada parada: llega a menos de TEXT_SHOW de ella y se va a mas de TEXT_HIDE (en escenas,
 * con la camara ya quieta), con un fundido en el tiempo: nunca se queda a medias.
 */
const TEXT_SHOW = 0.11
const TEXT_HIDE = 0.125
const TEXT_IN = 0.45
const TEXT_OUT = 0.3
/** Fundido (en segundos) de la penumbra detras del texto y de la ruta y los nombres de carpetas y documentos. */
const DIM_FADE = 0.2
const NAME_FADE = 0.3
/** Cuanto se enciende la zona a la que se va mientras se ve el simbolo entero. */
const LIT = 0.7
/**
 * La camara depende solo del scroll: rueda, teclado, barra o dedo la mueven al momento y nunca se queda
 * atras (si no, un scroll rapido se saltaba zonas enteras). Solo un salto desde el indice no se recorre:
 * todo se apaga en CUT_OUT s, la escena pasa a su sitio y se enciende en CUT_IN s.
 */
const CUT_OUT = 0.2
const CUT_IN = 0.35
/** Pulso: una sola pasada lenta y suave por el hilo al abrir la pagina, y se para. Sin animaciones, ninguna. */
const PULSE_SPEED = 1 / 36
const PULSE_AMOUNT = 0.6

type RGB = [number, number, number]
// Componentes tal cual del hex: el shader los pinta sin convertir.
const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const THEMES = {
  // Claro: cielo de dia. El hilo en el azul de marca, con volumen (mas hondo en la sombra y el borde,
  // cian hacia la luz) y un halo azul que lo hace luminoso sin emborronarlo.
  light: {
    /** En claro el lienzo es transparente: el fondo lo pinta la pagina (.home-sky en globals.css). */
    background: null as string | null,
    blending: THREE.NormalBlending as THREE.Blending,
    light: 1,
    glow: rgb('#3D8BFF'),
    core: rgb('#0463FE'),
    node: rgb('#0A2A7A'),
    pulse: rgb('#0096FF'), // un azul electrico: tine el hilo sin aclararlo
    ink: rgb('#0A2470'),
    glowScale: 0.75,
    /** Grosor del trazo y alcance del halo respecto a STYLE. */
    lineScale: 1,
    glowReach: 1.15,
    /** De cerca (en cada parada) el halo se recoge, para que el tramo encendido se vea nitido. */
    glowReachNear: 0.95,
    /** Con las celdas pequenas (el simbolo entero en un movil) los halos se juntan: alli el halo baja hasta glowDense. */
    glowDense: 0.45,
    /** Volumen de la boveda: color en la sombra y en el borde, brillo hacia la luz y cuanto se nota. */
    shadow: rgb('#0A2E8C'),
    lit: rgb('#3FA9FF'),
    shade: 0.85,
    /** La zona a la que se va (en su color y con mas halo) y las demas (mas suaves y transparentes). */
    on: rgb('#0463FE'),
    onAmt: 0.5,
    litGlow: 0.4,
    litGlowNear: 0.25,
    mute: rgb('#86A9E3'),
    muteAmt: 0.5,
    off: 0.65,
    /** Brillo propio bajo el simbolo: en claro, una luz blanca. */
    aura: '#FFFFFF',
    auraOpacity: 0.9,
    /** Sombra de contacto, azul, bajo la boveda y abajo a la derecha: sobre fondo claro da mas volumen que un brillo. */
    contact: '#1F4FC4',
    contactOpacity: 0.07,
    /**
     * Etiquetas de las zonas con el simbolo entero: las que no estan encendidas y todas en la portada. En
     * claro, enteras (con menos, el gris no llega a 4,5:1 sobre el cielo); la encendida se distingue por el azul.
     */
    labelDim: 1,
    heroLabel: 1,
    /** Penumbra detras del titulo de la portada (en claro, menos: el hilo azul se borraria) y de su texto. */
    heroDim: 0.5,
    heroTextDim: 0.85,
  },
  dark: {
    background: '#070a12' as string | null,
    blending: THREE.AdditiveBlending as THREE.Blending,
    light: 0,
    glow: rgb('#0463FE'),
    core: rgb('#9FDCFF'), // el alma del hilo, de un cian casi blanco
    node: rgb('#D4F3FF'),
    pulse: rgb('#5FE3FF'),
    ink: rgb('#F2F6FF'),
    glowScale: 1,
    lineScale: 1,
    glowReach: 1,
    glowReachNear: 1,
    glowDense: 1,
    // En oscuro no hay volumen ni tonos por zona: solo cuenta off (lo que se apagan las demas zonas).
    shadow: rgb('#000000'),
    lit: rgb('#000000'),
    shade: 0,
    on: rgb('#000000'),
    onAmt: 0,
    litGlow: 0,
    litGlowNear: 0,
    mute: rgb('#000000'),
    muteAmt: 0,
    off: 0.3,
    // Sin estrellas ni nebulosas: el fondo, liso; solo el brillo azul del simbolo, muy suave.
    aura: '#2B7FFF',
    auraOpacity: 0.16,
    contact: '#000000',
    contactOpacity: 0,
    labelDim: 0.5,
    heroLabel: 0.85,
    heroDim: 0.86,
    heroTextDim: 0.9,
  },
}
type Palette = (typeof THEMES)['light']

/** Trazo del hilo (en px). */
const STYLE = { lineW: 1.6, glow: 3.0, dot: 1.7, core: 0.95, glowAmt: 0.5 }

interface CoreSceneProps {
  progress: MotionValue<number>
  reduceMotion: boolean
  dark: boolean
}

/** Lo que el hilo le pide al lienzo: mas resolucion mientras se lee en un movil y menos si la tarjeta no llega. */
interface Quality {
  onReading: (reading: boolean) => void
  onSlow: () => void
}

/** Pasos de resolucion que se pueden bajar si la tarjeta grafica no llega. */
const SLOW_STEP = 0.25

export default function CoreScene(props: CoreSceneProps) {
  const palette = props.dark ? THEMES.dark : THEMES.light
  const wide = useWide()
  const aura = useRef({ fade: 1 })
  const canvas = useRef<HTMLCanvasElement>(null)
  const onScreen = useOnScreen(canvas)
  // Resolucion: la de la pantalla hasta un tope (mas bajo en el movil). Mientras se lee un titular en
  // un movil de mucha densidad sube (la escena esta quieta y el titular se ve mas nitido); si la
  // tarjeta grafica no llega, baja un paso cada vez, hasta 1.
  const [reading, setReading] = useState(false)
  const [slow, setSlow] = useState(0)
  const quality = useMemo<Quality>(() => ({ onReading: setReading, onSlow: () => setSlow((n) => n + 1) }), [])
  const top = Math.max(1, (reading && !wide ? 2.5 : wide ? 1.75 : 1.5) - slow * SLOW_STEP)
  // Fuera de la vista no se pinta. Dentro, solo cuando algo cambia: el scroll, el tamano o, mientras
  // duran, el pulso (si se ve), un fundido o la camara que aun no ha llegado (la escena pide el
  // siguiente fotograma). Quieta, no gasta nada.
  const frameloop = onScreen ? 'demand' : 'never'
  return (
    <Canvas
      ref={canvas}
      dpr={[1, top]}
      frameloop={frameloop}
      camera={{ position: [0, -4, 3], fov: FOV, near: 0.001, far: 200 }}
      gl={{ antialias: false, powerPreference: 'high-performance' }}
      fallback={null}
    >
      {palette.background && <color attach="background" args={[palette.background]} />}
      <Aura palette={palette} fade={aura} />
      <Thread {...props} palette={palette} wide={wide} aura={aura} quality={quality} slowed={top <= 1} onScreen={onScreen} />
    </Canvas>
  )
}

// ---------------------------------------------------------------- el brillo del simbolo

/**
 * Bajo el cerebro, quietos: su brillo propio y, en claro, una sombra de contacto que le da volumen. Se
 * atenuan al acercarse a una zona. Detras no hay nada: en oscuro el fondo es liso.
 */
function Aura({ palette, fade }: { palette: Palette; fade: { current: { fade: number } } }) {
  const glows = useMemo(
    () =>
      GLOWS.map((g) => {
        const opacity = g.contact ? palette.contactOpacity : palette.auraOpacity
        const map = glowTexture(g.contact ? palette.contact : palette.aura)
        const material = new THREE.SpriteMaterial({ map, transparent: true, opacity, depthTest: false, depthWrite: false, blending: palette.blending })
        return { ...g, opacity, map, material }
      }),
    [palette]
  )
  useEffect(
    () => () =>
      glows.forEach((g) => {
        g.map.dispose()
        g.material.dispose()
      }),
    [glows]
  )

  useFrame(() => {
    for (const g of glows) {
      // Apagadas (o sin ellas: la sombra, en oscuro) no se pintan.
      g.material.opacity = g.opacity * fade.current.fade
      g.material.visible = fade.current.fade > 0.01 && g.opacity > 0
    }
  })

  return (
    <>
      {glows.map((g, k) => (
        <sprite key={k} position={g.at} scale={g.scale} material={g.material} renderOrder={-1} />
      ))}
    </>
  )
}

/** La sombra de contacto (contact, solo en claro; detras del brillo) y el brillo propio del simbolo. */
const GLOWS: { at: [number, number, number]; scale: number; contact?: boolean }[] = [
  { at: [0.2, -0.28, -0.95], scale: 3.6, contact: true },
  { at: [0, 0, -0.8], scale: 4.6 },
]

/** Mancha de luz redonda que se desvanece hacia fuera. */
function glowTexture(color: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const c = new THREE.Color(color)
  const rgbText = `${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}`
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, `rgba(${rgbText}, 1)`)
  gradient.addColorStop(0.35, `rgba(${rgbText}, 0.45)`)
  gradient.addColorStop(1, `rgba(${rgbText}, 0)`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 256, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// ---------------------------------------------------------------- el viaje

/** Donde esta la camara y que se ve, segun el scroll. */
interface Pose {
  /** Zona a la que mira la camara: la que se deja al alejarse y la siguiente al acercarse. */
  zone: number
  /** Zona encendida y, mientras la luz pasa a ella, la zona de la que viene (-1 desde la portada: aun no hay luz). */
  light: number
  from: number
  /** Cuanto ha pasado la luz de from a light. */
  mix: number
  /** 1 en la portada y 0 con la luz ya en la primera zona (la camara no cambia: la portada ya es el simbolo entero). */
  hero: number
  /** Cuanto se ha acercado la camara a la zona, en escala logaritmica: 0 el simbolo entero, 1 en la parada. */
  zoom: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const clampTo = (x: number, a: number, b: number) => Math.min(Math.max(x, a), Math.max(a, b))

/** Camino recorrido mientras la velocidad sube de 0 a 1 con un paso suave (de 0 a 1/2 para u de 0 a 1). */
const easeIn = (u: number) => u * u * u - (u * u * u * u) / 2

/**
 * De 0 a 1 con arranque y frenada suaves (pendiente cero en los extremos, sin tirones) y velocidad
 * constante en medio; ramp es la parte del tramo que dura cada uno.
 */
function cruise(t: number, ramp: number) {
  if (t <= 0) return 0
  if (t >= 1) return 1
  const speed = 1 / (1 - ramp)
  if (t < ramp) return speed * ramp * easeIn(t / ramp)
  if (t > 1 - ramp) return 1 - speed * ramp * easeIn((1 - t) / ramp)
  return speed * (t - ramp / 2)
}

/** Pose segun el scroll (s de 0 a 6, en escenas). */
function journey(s: number, out: Pose) {
  const k = Math.min(SCENE_COUNT - 2, Math.max(0, Math.floor(s)))
  const f = s - k
  if (k === 0) {
    // Desde la portada, quieta, la luz aparece en la primera zona y luego la camara se acerca a ella.
    const m = ramp(HOLD, FIRST_LIGHT, f)
    out.hero = 1 - m
    out.zone = out.light = 0
    out.from = -1
    out.mix = m
    out.zoom = cruise((f - FIRST_IN) / (ARRIVE - FIRST_IN), FIRST_EASE)
    return out
  }
  out.hero = 0
  if (f < IN_START) {
    // En la parada de la zona anterior y, pasado HOLD, se aleja.
    out.zone = k - 1
    out.zoom = 1 - cruise((f - HOLD) / (OUT_END - HOLD), EASE)
  } else {
    out.zone = k
    out.zoom = cruise((f - IN_START) / (ARRIVE - IN_START), EASE)
  }
  // La luz pasa de la zona que se deja a la siguiente.
  const m = ramp(LIGHT_FROM, LIGHT_TO, f)
  out.mix = m > 0 && m < 1 ? m : 1
  out.light = m > 0 ? k : k - 1
  out.from = m < 1 ? k - 1 : k
  return out
}

/** Distancia a la que se ve el cerebro entero, centrado, ocupando tall de la altura y across del ancho (la portada). */
function fitDistance(aspect: number, tall: number, across: number) {
  const byHeight = 2.45 / tall / (2 * TAN)
  const byWidth = 2.1 / across / (2 * TAN * aspect)
  return Math.max(byHeight, byWidth)
}

const look = new THREE.Vector3()
/**
 * Coloca la camara, siempre con la orientacion de la portada (nada gira): el punto focus esta a height
 * de ella (por VIEW.dir), con el angulo de la portada cerrado zoom veces, y cae en pantalla en (sx, sy).
 */
function aim(cam: THREE.PerspectiveCamera, focus: THREE.Vector3, sx: number, sy: number, height: number, W: number, H: number, zoom = 1) {
  const tan = TAN / zoom
  const pxk = H / 2 / tan
  cam.fov = 2 * THREE.MathUtils.radToDeg(Math.atan(tan))
  cam.position
    .copy(focus)
    .addScaledVector(VIEW.dir, height)
    .addScaledVector(VIEW.right, ((W / 2 - sx) / pxk) * height)
    .addScaledVector(VIEW.up, ((sy - H / 2) / pxk) * height)
  cam.up.copy(VIEW.up)
  cam.lookAt(look.copy(cam.position).sub(VIEW.dir))
  cam.near = Math.max(1e-3, height * 0.02)
  cam.far = 200
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld()
}

/**
 * Acercarse a una zona desde el simbolo entero: su punto de la boveda pasa de from a to en pantalla
 * mientras crece ZONE_ZOOM veces, como un zoom sobre un mapa: todo se aleja de pivot, el unico punto
 * de la pantalla que no se mueve. La camara no se acerca: se queda a la misma distancia (above), cierra
 * su angulo (como el zoom de una camara de fotos) y se desplaza de lado lo justo. Asi todo crece igual
 * y a la vez, sin que lo mas alto de la boveda se adelante.
 */
interface ZoneView {
  /** Distancia (por VIEW.dir) de su punto a la camara con el simbolo entero. */
  above: number
  from: [number, number]
  /** Donde queda su punto en la parada (ver aimZone) y el punto de la pantalla que no se mueve al acercarse. */
  to: [number, number]
  pivot: [number, number]
}

/** La vista del simbolo entero (la de la portada), la misma para todas las zonas, y como se acerca la camara a cada una desde ella. */
interface Overview {
  /** Donde cae en pantalla el centro del cerebro y a que distancia esta (por VIEW.dir). */
  at: [number, number]
  height: number
  zones: ZoneView[]
}

/**
 * Vista del simbolo entero, la de la portada: en el centro de la pantalla o, en el movil en vertical,
 * arriba, entre la barra y donde empieza el titulo (titleTop, en px del lienzo; 0 si aun no se sabe).
 * Es la misma para todas las zonas: entre dos solo cambia la luz, y al salir de la portada solo se va
 * su texto. Desde ella se acerca la camara a cada zona (a donde, lo decide aimZone).
 */
function overviewOf(frames: ZoneFrame[], W: number, H: number, wide: boolean, titleTop: number): Overview {
  const pxk = H / 2 / TAN
  const portrait = !wide && H > W && titleTop > 0
  const top = 72
  const bottom = titleTop + 24
  const sy = portrait ? (top + bottom) / 2 : H / 2
  const h = portrait ? fitDistance(W / H, (bottom - top) / H, 0.9) : fitDistance(W / H, 0.74, 0.86)
  const camera = CENTER.clone()
    .addScaledVector(VIEW.dir, h)
    .addScaledVector(VIEW.up, ((sy - H / 2) / pxk) * h)
  const v = new THREE.Vector3()
  const zones = frames.map((frame): ZoneView => {
    v.subVectors(camera, frame.focus)
    const above = v.dot(VIEW.dir)
    const x = W / 2 - (v.dot(VIEW.right) * pxk) / above
    const y = H / 2 + (v.dot(VIEW.up) * pxk) / above
    return { above, from: [x, y], to: [x, y], pivot: [x, y] }
  })
  return { at: [W / 2, sy], height: h, zones }
}

/**
 * Donde queda una zona en su parada (view.to y, con el, su pivote): donde mas celdas de su tramo caen
 * en pantalla fuera de su texto (dim), de las bandas de arriba y de abajo y del indice, sin que el centro
 * del simbolo se desplace mas de MAX_SHIFT del ancho mientras se acerca. points son las celdas del tramo
 * en pantalla con el simbolo entero (x e y seguidas): en la parada, cada una queda a ZONE_ZOOM veces su
 * distancia a from, alrededor de to. Devuelve el centro de lo que se ve de la zona (alli van los nombres).
 * index es donde empieza el indice de escenas (ver indexEdge).
 */
function aimZone(view: ZoneView, points: Float64Array, at: [number, number], dim: number[] | null, W: number, H: number, index: number): [number, number] {
  const z = ZONE_ZOOM
  const [fx, fy] = view.from
  // Sin desplazar el centro del simbolo, la zona quedaria en (nx, ny).
  const nx = at[0] + z * (fx - at[0])
  const ny = at[1] + z * (fy - at[1])
  // Lo que no tapa la penumbra del texto (hasta 40 px de el), las bandas ni el indice (ver uEdge).
  const top = topBand(W) + 8
  const bottom = H - BOTTOM_BAND - 8
  const box = dim ? [dim[0] - 40, dim[1] - 40, dim[2] + 40, dim[3] + 40] : [0, 0, 0, 0]
  const nav = index - 30
  const free = (x: number, y: number) =>
    x > 16 && x < W - 16 && y > top && y < bottom && !(x > box[0] && x < box[2] && y > box[1] && y < box[3]) && !(x > nav && Math.abs(y - H / 2) < 160)
  // Cada celda respecto al punto de la zona, ya en la parada.
  const count = points.length / 2
  const ox = new Float64Array(count)
  const oy = new Float64Array(count)
  for (let q = 0; q < count; q++) {
    ox[q] = z * (points[q * 2] - fx)
    oy[q] = z * (points[q * 2 + 1] - fy)
  }
  const reach = MAX_SHIFT * W
  let best = -Infinity
  let tx = nx
  let ty = ny
  const score = (dx: number, dy: number, every: number) => {
    const shift = Math.hypot(dx, dy)
    if (shift > reach) return
    let seen = 0
    for (let q = 0; q < count; q += every) if (free(nx + dx + ox[q], ny + dy + oy[q])) seen += every
    const value = seen / count - (SHIFT_COST * shift) / W
    if (value <= best) return
    best = value
    tx = nx + dx
    ty = ny + dy
  }
  // Primero a pasos grandes (con una de cada dos celdas) y luego, alrededor del mejor, a pasos cuatro
  // veces mas cortos y con todas.
  const step = reach / 6
  for (let j = -6; j <= 6; j++) for (let i = -6; i <= 6; i++) score(i * step, j * step, 2)
  const [dx0, dy0] = [tx - nx, ty - ny]
  best = -Infinity
  for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) score(dx0 + (i * step) / 4, dy0 + (j * step) / 4, 1)
  view.to = [tx, ty]
  const k = Math.abs(1 - z) < 1e-3 ? 0 : 1 / (1 - z)
  view.pivot = k ? [(tx - z * fx) * k, (ty - z * fy) * k] : [fx, fy]
  let cx = 0
  let cy = 0
  let n = 0
  for (let q = 0; q < count; q++) {
    if (!free(tx + ox[q], ty + oy[q])) continue
    cx += tx + ox[q]
    cy += ty + oy[q]
    n++
  }
  return n ? [cx / n, cy / n] : [tx, ty]
}

/** Acerca value a goal a lo sumo step (para los fundidos en el tiempo). */
const approach = (value: number, goal: number, step: number) => (value < goal ? Math.min(goal, value + step) : Math.max(goal, value - step))

// ---------------------------------------------------------------- mallas y materiales

/** Malla de celdas: cada instancia es un cuadrado en pantalla (cada malla lleva su propio cuadrado). */
function quadGeometry() {
  const g = new THREE.InstancedBufferGeometry()
  g.setIndex([0, 1, 2, 0, 2, 3])
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3))
  return g
}

function cellGeometry(cells: Float32Array, count: number) {
  const g = quadGeometry()
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells.slice(0, count * 4), 4))
  g.instanceCount = count
  return g
}

/** El cerebro: sus marcas (aInfo) cambian cuando se eligen las celdas con nombre de cada zona. */
function brainGeometry(brain: Brain) {
  const g = quadGeometry()
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(brain.a, 3))
  g.setAttribute('aPrev', new THREE.InstancedBufferAttribute(brain.prev, 3))
  g.setAttribute('aNext', new THREE.InstancedBufferAttribute(brain.next, 3))
  g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(brain.info, 4))
  g.instanceCount = brain.count
  return g
}

const vec3 = (c: RGB) => ({ value: new THREE.Vector3(...c) })

function threadMaterial(palette: Palette) {
  return new THREE.ShaderMaterial({
    vertexShader: THREAD_VERTEX,
    fragmentShader: THREAD_FRAGMENT,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uLineW: { value: STYLE.lineW },
      uGlow: { value: STYLE.glow },
      uDotR: { value: STYLE.dot },
      uCore: { value: STYLE.core },
      uGlowAmt: { value: STYLE.glowAmt },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      // Un solo pulso recorre el cerebro entero en 36 s (fase por celda: 1/1024).
      uSpeed: { value: PULSE_SPEED },
      uStep: { value: 1 / CELLS },
      uHead: { value: 900 },
      uTail: { value: 100 },
      uZone: { value: 0 },
      uZoneFrom: { value: 0 },
      uZoneMix: { value: 1 },
      uZoneAmt: { value: 0 },
      uTarget: { value: -1 },
      uCardOn: { value: 0 },
      uFolderOn: { value: 0 },
      uLockOn: { value: 0 },
      uLight: { value: palette.light },
      uOff: { value: palette.off },
      uShade: { value: palette.shade },
      uOnAmt: { value: palette.onAmt },
      uLitGlow: { value: palette.litGlow },
      uMute: { value: palette.muteAmt },
      uShadowColor: vec3(palette.shadow),
      uLitColor: vec3(palette.lit),
      uOnColor: vec3(palette.on),
      uMuteColor: vec3(palette.mute),
      uDim: { value: new THREE.Vector4() },
      uDimAmt: { value: 0 },
      uDim2: { value: new THREE.Vector4() },
      uDimAmt2: { value: 0 },
      uEdge: { value: new THREE.Vector4(1e6, -1e6, 1e6, 1) },
      uEdgeAmt: { value: 0 },
      uGlowColor: vec3(palette.glow),
      uCoreColor: vec3(palette.core),
      uNodeColor: vec3(palette.node),
      uPulseColor: vec3(palette.pulse),
      uInk: vec3(palette.ink),
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: palette.blending,
  })
}

function headlineMaterial(palette: Palette) {
  return new THREE.ShaderMaterial({
    vertexShader: HEADLINE_VERTEX,
    fragmentShader: HEADLINE_FRAGMENT,
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uFade: { value: 0 },
      uLight: { value: palette.light },
      uInk: vec3(palette.ink),
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: palette.blending,
  })
}

/** Nombre de una carpeta o un documento, junto a la celda que le toca en la parada de su zona. */
interface Name {
  el: HTMLElement
  /** Celda del cerebro (su posicion en el hilo). */
  cell: number
  folder: boolean
  /** Tipo de su archivo (ver fileKind) y si va con llave. */
  kind: number
  lock: boolean
  /** Hacia donde sale el texto: las carpetas a un lado, los documentos debajo. */
  side: 'left' | 'right' | 'below'
  /** Tamano de la celda en la parada, en px. */
  px: number
}

/** Lo que se prepara de cada zona: su titular, su bloque de texto y los nombres de carpetas y documentos. */
interface ZoneWork {
  frame: ZoneFrame
  headline: Headline | null
  lit: THREE.InstancedBufferGeometry | null
  /** Caja que ocupa su bloque de texto, en px del lienzo: alli el hilo se queda en penumbra. */
  dim: number[] | null
  names: Name[]
  /** Celdas de su tramo que pierden su candado suelto (pisaria un nombre o el texto). */
  clear: number[]
  /** Todos los nombres de la zona (tambien los que no caben: no se ven). */
  all: HTMLElement[]
  /** Celda de su documento principal: resalta con la luz en el simbolo entero (-1 si no hay). */
  target: number
}

/** Caja (en px del lienzo) que ocupan unos elementos de texto: alli el hilo se queda en penumbra. */
function textBox(elements: Element[], canvas: DOMRect) {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (const el of elements) {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    left = Math.min(left, r.left - canvas.left)
    top = Math.min(top, r.top - canvas.top)
    right = Math.max(right, r.right - canvas.left)
    bottom = Math.max(bottom, r.bottom - canvas.top)
  }
  return left < right ? [left, top, right, bottom] : null
}

/**
 * Donde empieza (en px del lienzo, por la izquierda) lo que ensena el indice de escenas mientras se lee
 * un titular: desde xl, el nombre de cada escena; en lg, y en xl si la pantalla es baja, solo los numeros
 * (los nombres se apagan, ver scrolly.tsx y globals.css). Asi, en esas pantallas, las zonas y sus nombres
 * pueden llegar mas cerca del borde. Infinity si no hay indice (en el movil).
 */
function indexEdge(canvas: DOMRect) {
  const nav = stage.nav
  if (!nav || !nav.offsetWidth) return Infinity
  const named = window.matchMedia('(min-width: 1280px) and (min-height: 761px)').matches
  let left = Infinity
  // Cada boton lleva su nombre, su numero y su raya.
  nav.querySelectorAll('button').forEach((button) => {
    const shown = named ? button : button.children[1]
    if (shown) left = Math.min(left, shown.getBoundingClientRect().left)
  })
  return left - canvas.left
}

/**
 * Titular de una zona, de una vez (unos 10-30 ms). Con el titular dibujado, el texto real se vuelve
 * transparente (data-drawn, ver .dotted en globals.css); sin el, se sigue viendo.
 */
function prepareHeadline(work: ZoneWork, canvas: DOMRect, wide: boolean) {
  const title = stage.titles[work.frame.zone + 1]
  const headline = title ? buildHeadline(title, canvas, wide) : null
  work.headline = headline
  work.lit?.dispose()
  work.lit = headline ? cellGeometry(headline.cells, headline.count) : null
  if (title) {
    if (headline) title.dataset.drawn = ''
    else delete title.dataset.drawn
  }
}

/** Rectangulo en px: izquierda, arriba, derecha, abajo. */
type Rect = [number, number, number, number]
const hits = (a: Rect, b: Rect, gap: number) => a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap
const within = (a: Rect, b: Rect) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3]
/** Alto de la etiqueta de un nombre (ver .chip en globals.css). */
const CHIP = 23

/** Medio ancho y medio alto del dibujo de una carpeta o de una tarjeta, en partes de su tamano (g). */
const glyphHalf = (folder: boolean) => (folder ? [0.25, 0.22] : [0.31, 0.37])

/** Donde va la etiqueta de un nombre (ver Tag en scrolly.tsx): debajo del dibujo o a un lado. */
function nameAnchor(x: number, y: number, g: number, folder: boolean, side: Name['side']): [number, number] {
  const [hw, hh] = glyphHalf(folder)
  if (side === 'below') return [x, y + hh * g + 4]
  return [x + (side === 'left' ? -1 : 1) * (hw * g + 2), y]
}

/** Lo que ocupa en pantalla una carpeta o un documento: su dibujo y su nombre (debajo o a un lado). */
function nameBoxes(x: number, y: number, g: number, width: number, folder: boolean, side: Name['side']): Rect[] {
  const [hw, hh] = glyphHalf(folder)
  const [ax, ay] = nameAnchor(x, y, g, folder, side)
  const glyph: Rect = [x - hw * g, y - hh * g, x + hw * g, y + hh * g]
  if (side === 'below') return [glyph, [ax - width / 2, ay, ax + width / 2, ay + CHIP]]
  return [glyph, side === 'left' ? [ax - 12 - width, ay - CHIP / 2, ax - 12, ay + CHIP / 2] : [ax + 12, ay - CHIP / 2, ax + 12 + width, ay + CHIP / 2]]
}

/** Bandas de arriba y de abajo (en px) en las que el hilo se queda en penumbra bajo la barra, la ruta y la lectura en vivo. */
const topBand = (W: number) => (W >= 640 ? 104 : 72)
const BOTTOM_BAND = 48

const cellPoint = new THREE.Vector3()
/** Nodo de la celda d (de las posiciones de la malla del cerebro) en px de pantalla. */
function projectCell(points: Float32Array, d: number, cam: THREE.Camera, W: number, H: number, out: Float64Array) {
  cellPoint.set(points[d * 3], points[d * 3 + 1], points[d * 3 + 2])
  return project(cellPoint, cam, W, H, out)
}

/** Una celda es buena para un nombre si alli la boveda se ve de frente: en pantalla, casi cuadrada (su lado corto, al menos FLAT del largo) y sin torcer. */
const FLAT = 0.7

/**
 * Elige en que celdas van los nombres de carpetas y documentos de una zona: celdas de su tramo que en
 * la parada (con la camara cam) caen en pantalla fuera de su texto y de los instrumentos, se ven de
 * frente, repartidas alrededor de centre (el centro de lo que se ve de la zona) y sin pisarse, cada una
 * con su nombre al lado (las carpetas, en una vuelta del hilo) o debajo (los documentos, si cabe). Pocos:
 * la carpeta y el documento principales y, si hay sitio, uno o dos mas; un nombre que no cabe no se ve.
 * Devuelve tambien los candados sueltos que se quitan (pisarian un nombre o el texto). index es donde
 * empieza el indice de escenas (ver indexEdge).
 */
function placeNames(work: ZoneWork, brain: Brain, cam: THREE.Camera, centre: [number, number], W: number, H: number, wide: boolean, index: number, widths: Map<HTMLElement, number>) {
  const { zone, first, last } = work.frame
  const safe: Rect = [16, topBand(W) + 26, W - 16, H - BOTTOM_BAND - 26]
  const busy: Rect[] = []
  if (work.dim) busy.push(work.dim as Rect)
  // El indice de escenas (y su penumbra).
  if (index < W) busy.push([index - 56, H / 2 - 184, W, H / 2 + 184])
  const at = new Float64Array(2)
  const edge = new Float64Array(8)
  const cells: { d: number; x: number; y: number; c: number; turn: boolean; fit: number }[] = []
  for (let d = first; d < last; d++) {
    if (!projectCell(brain.a, d, cam, W, H, at)) continue
    const x = at[0]
    const y = at[1]
    let c = 0
    if (projectCell(brain.prev, d, cam, W, H, at)) c = Math.max(c, Math.hypot(at[0] - x, at[1] - y))
    if (projectCell(brain.next, d, cam, W, H, at)) c = Math.max(c, Math.hypot(at[0] - x, at[1] - y))
    if (c <= 4) continue
    // Lo que mide la celda en pantalla de un lado a otro (a) y de abajo arriba (b).
    let front = true
    cellSides(d).forEach((point, q) => {
      front = project(point, cam, W, H, at) && front
      edge[q * 2] = at[0]
      edge[q * 2 + 1] = at[1]
    })
    const ax = edge[2] - edge[0]
    const ay = edge[3] - edge[1]
    const bx = edge[6] - edge[4]
    const by = edge[7] - edge[5]
    const la = Math.hypot(ax, ay)
    const lb = Math.hypot(bx, by)
    // Como encaja un nombre: 2 si la celda se ve de frente y esta rodeada de su zona (en el borde, entre el
    // hilo encendido y el apagado, se veria suelta); 1 si al menos no se ve muy de lado; 0 si no vale.
    const ratio = Math.min(la, lb) / Math.max(la, lb, 1e-6)
    const square = Math.abs(ax * by - ay * bx) >= 0.9 * la * lb
    const inner = neighbors(d).every((e) => brain.info[e * 4] === zone)
    const fit = !front ? 0 : ratio >= FLAT && square && inner ? 2 : ratio >= 0.5 ? 1 : 0
    cells.push({ d, x, y, c, turn: isTurn(brain.info[d * 4 + 2]), fit })
  }
  // Primero la carpeta y el documento principales, luego el segundo documento (en la zona del equipo, el
  // que va con llave, tambien en el movil) y la segunda carpeta. Los principales y el de la llave, si no
  // caben en una celda buena, van en una que valga.
  const folders = stage.folders[zone] ?? []
  const files = stage.files[zone] ?? []
  const most = wide ? 4 : W >= 640 || zone === TEAM_ZONE ? 3 : 2
  const order = [
    { el: folders[0], folder: true, n: 0 },
    { el: files[0], folder: false, n: 0 },
    { el: files[1], folder: false, n: 1 },
    { el: folders[1], folder: true, n: 1 },
  ]
  const items = order.slice(0, most).filter((item): item is { el: HTMLElement; folder: boolean; n: number } => !!item.el)
  const names: Name[] = []
  const taken: Rect[] = []
  const used = new Set<number>()
  for (const item of items) {
    const width = widths.get(item.el) ?? 120
    const lock = !item.folder && zone === TEAM_ZONE && item.n === 1
    let best: Name | null = null
    let bestBoxes: Rect[] = []
    for (let need = 2; need >= (item.n === 0 || lock ? 1 : 2) && !best; need--) {
      let bestScore = -Infinity
      for (const cell of cells) {
        if (used.has(cell.d) || cell.fit < need || (item.folder && !cell.turn)) continue
        // Las carpetas con el nombre a un lado; los documentos, mejor debajo (si no cabe, a un lado).
        for (const side of item.folder ? (['right', 'left'] as const) : (['below', 'right', 'left'] as const)) {
          const boxes = nameBoxes(cell.x, cell.y, cell.c * GLYPH, width, item.folder, side)
          if (!boxes.every((box) => within(box, safe) && !busy.some((b) => hits(box, b, 14)) && !taken.some((t) => hits(box, t, 12)))) continue
          // Lejos de los ya puestos (hasta un punto) y cerca del centro de lo que se ve de la zona.
          let near = 340
          for (const name of names) {
            projectCell(brain.a, name.cell, cam, W, H, at)
            near = Math.min(near, Math.hypot(at[0] - cell.x, at[1] - cell.y))
          }
          const score = near - 0.35 * Math.hypot(cell.x - centre[0], cell.y - centre[1]) + (side === 'right' ? 3 : 0) - (!item.folder && side !== 'below' ? 40 : 0)
          if (score <= bestScore) continue
          bestScore = score
          bestBoxes = boxes
          const kind = item.folder ? 0 : fileKind(item.el.textContent ?? '')
          best = { el: item.el, cell: cell.d, folder: item.folder, kind, lock, side, px: cell.c }
        }
      }
    }
    if (!best) continue
    names.push(best)
    taken.push(...bestBoxes)
    used.add(best.cell)
    for (const e of neighbors(best.cell)) used.add(e)
  }
  // Los candados sueltos del tramo que pisarian un nombre, el texto o los bordes se quitan.
  const clear: number[] = []
  for (const cell of cells) {
    if (used.has(cell.d) || !isLock(brain.info[cell.d * 4 + 2])) continue
    const r = cell.c * 0.14
    const box: Rect = [cell.x - r, cell.y - r, cell.x + r, cell.y + r]
    const seen = box[2] > 0 && box[3] > 0 && box[0] < W && box[1] < H
    if (seen && (!within(box, safe) || busy.some((b) => hits(box, b, 14)) || taken.some((t) => hits(box, t, 6)))) clear.push(cell.d)
  }
  return { names, clear }
}

/** Trabajo pendiente: el titular de una zona. */
interface Task {
  zone: number
  run: () => void
}

type Maybe = HTMLElement | null | undefined

/**
 * Escrituras en el DOM solo cuando cambian: cada fotograma se recalcula todo, pero se compara con
 * numeros redondeados y solo se crea una cadena (y se toca el DOM) si el valor cambia.
 */
function domWriter() {
  const last = new WeakMap<HTMLElement, Record<string, number | string | boolean>>()
  const changed = (el: HTMLElement, key: string, value: number | string | boolean) => {
    let cache = last.get(el)
    if (!cache) last.set(el, (cache = {}))
    if (cache[key] === value) return false
    cache[key] = value
    return true
  }
  return {
    opacity(el: Maybe, value: number) {
      const v = Math.round(value * 100) / 100
      if (el && changed(el, 'opacity', v)) el.style.opacity = String(v)
    },
    /** Posicion en px (a medio px). */
    move(el: Maybe, x: number, y: number) {
      if (!el) return
      const rx = Math.round(x * 2) / 2
      const ry = Math.round(y * 2) / 2
      const cx = changed(el, 'x', rx)
      const cy = changed(el, 'y', ry)
      if (cx || cy) el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`
    },
    data(el: Maybe, key: 'on' | 'side' | 'quiet' | 'zone', value: string) {
      if (el && changed(el, key, value)) el.dataset[key] = value
    },
    /** Sin clics (un bloque de texto que no se ve). */
    still(el: Maybe, value: boolean) {
      if (el && changed(el, 'still', value)) el.style.pointerEvents = value ? 'none' : ''
    },
    /** Fuera del tabulador y sin clics (los enlaces de un bloque que no se ve). */
    inert(el: Maybe, value: boolean) {
      if (el && changed(el, 'inert', value)) el.inert = value
    },
  }
}

const projected = new THREE.Vector3()
/** Punto del espacio en px de pantalla (en out); false si queda detras de la camara. */
function project(world: THREE.Vector3, cam: THREE.Camera, W: number, H: number, out: Float64Array) {
  projected.copy(world).project(cam)
  out[0] = (projected.x * 0.5 + 0.5) * W
  out[1] = (0.5 - projected.y * 0.5) * H
  return projected.z < 1
}

/** Si una etiqueta (de x0 a x1, centrada en y) pisa una caja de texto (con 8 px de aire). */
const overlaps = (box: number[], x0: number, x1: number, y: number) => x1 > box[0] - 8 && x0 < box[2] + 8 && y + 16 > box[1] && y - 16 < box[3]

// ---------------------------------------------------------------- escena

interface ThreadProps extends CoreSceneProps {
  palette: Palette
  wide: boolean
  aura: { current: { fade: number } }
  quality: Quality
  /** La resolucion ya esta al minimo: no hace falta seguir midiendo. */
  slowed: boolean
  /** Si el lienzo esta a la vista (fuera, no se pinta). */
  onScreen: boolean
}

function Thread({ progress, reduceMotion, palette, wide, aura, quality, slowed, onScreen }: ThreadProps) {
  const { size, gl, camera, scene } = useThree()
  const invalidate = useThree((state) => state.invalidate)
  const viewportDpr = useThree((state) => state.viewport.dpr)
  const cam = camera as THREE.PerspectiveCamera
  const frames = useMemo(() => buildFrames(), [])
  const zones = useMemo<ZoneWork[]>(
    () => frames.map((frame) => ({ frame, headline: null, lit: null, dim: null, names: [], clear: [], all: [], target: -1 })),
    [frames]
  )
  useEffect(
    () => () =>
      zones.forEach((z) => {
        z.lit?.dispose()
        z.lit = null
      }),
    [zones]
  )

  // El cerebro y sus marcas de partida (las celdas con nombre cambian las suyas y las de sus vecinas).
  const brain = useMemo(() => buildBrain(), [])
  const baseMarks = useMemo(() => Float32Array.from({ length: CELLS }, (_, d) => brain.info[d * 4 + 2]), [brain])
  const geometry = useMemo(() => brainGeometry(brain), [brain])
  useEffect(() => () => geometry.dispose(), [geometry])
  const material = useMemo(() => threadMaterial(palette), [palette])
  useEffect(() => () => material.dispose(), [material])
  const textMaterial = useMemo(() => headlineMaterial(palette), [palette])
  useEffect(() => () => textMaterial.dispose(), [textMaterial])
  const textMesh = useRef<THREE.Mesh>(null)
  /** Camara de calculo: la de cada parada, para colocar los nombres antes de llegar. */
  const probe = useMemo(() => new THREE.PerspectiveCamera(FOV, 1, 0.001, 200), [])

  const pose = useMemo<Pose>(() => ({ zone: 0, light: 0, from: -1, mix: 0, hero: 1, zoom: 0 }), [])
  /** Donde esta la camara (en escenas): el scroll, salvo mientras se funde un salto desde el indice. */
  const smooth = useRef(-1)
  /**
   * Relojes en segundos de performance.now (el de R3F vuelve a cero cada vez que el lienzo sale de la
   * vista y vuelve): el ultimo fotograma y cuando empezo el pulso.
   */
  const last = useRef(0)
  const pulseStart = useRef(-1)
  /** Salto desde el indice (que no se recorre): si todo se esta apagando y cuanto se ve la escena (de 0 a 1). */
  const cut = useRef({ leaving: false, level: 1 })
  // Al volver a la vista, la escena aparece ya en su sitio, sin recorrer nada ni fundidos a medias.
  useEffect(() => void (onScreen && (smooth.current = -1)), [onScreen])
  /** Si el fotograma anterior pidio otro (si no, el tiempo hasta este fue un rato quieto, no un fotograma lento). */
  const continued = useRef(false)
  /** La vista del simbolo entero (se recalcula al cambiar la pantalla, y con ella donde van los nombres). */
  const overview = useRef<Overview | null>(null)
  useEffect(() => void (overview.current = null), [size.width, size.height, wide])
  /**
   * Fundidos en el tiempo (nunca se quedan a medias): el texto de cada escena (la parada que se lee,
   * con margen para no parpadear en el borde), la penumbra detras y, por zona, su ruta y los nombres de
   * sus carpetas y documentos.
   */
  const fades = useMemo(
    () => ({ reading: -1, lead: 0, text: new Float64Array(SCENE_COUNT), dim: 0, zones: new Float64Array(ZONE_COUNT) }),
    []
  )
  /** Portada: cajas del titulo y de su texto (en penumbra) y, en el movil, donde empieza el titulo. */
  const hero = useRef<{ title: number[] | null; text: number[] | null; top: number }>({ title: null, text: null, top: 0 })
  /** Ancho de cada etiqueta en px, para que no se salga de la pantalla ni pise nada. */
  const widths = useMemo(() => new Map<HTMLElement, number>(), [])
  /** Donde empieza el indice de escenas en px del lienzo (ver indexEdge). */
  const index = useRef(Infinity)
  const dom = useMemo(() => domWriter(), [])

  // Los titulares de las zonas se preparan uno a uno en los ratos libres del navegador, empezando por
  // la zona en la que esta la camara. Se rehace al cambiar el tamano (van a la medida del texto real).
  const [fontsReady, setFontsReady] = useState(false)
  const queue = useRef<Task[]>([])
  const scheduler = useRef({ kick: () => {} })
  useEffect(() => {
    let alive = true
    document.fonts.ready.then(() => alive && setFontsReady(true))
    return () => {
      alive = false
    }
  }, [])
  useEffect(() => {
    if (!fontsReady) return
    const canvas = gl.domElement.getBoundingClientRect()
    const block = stage.blocks[0]
    const h1 = block?.querySelector('h1')
    hero.current = {
      title: textBox(h1 ? [h1] : [], canvas),
      text: textBox(block ? Array.from(block.querySelectorAll('p')) : [], canvas),
      top: h1 ? h1.getBoundingClientRect().top - canvas.top : 0,
    }
    index.current = indexEdge(canvas)
    widths.clear()
    for (const el of [...stage.zoneLabels, ...stage.folders.flat(), ...stage.files.flat()]) {
      if (el) widths.set(el, (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0)
    }
    for (const work of zones) {
      const zoneBlock = stage.blocks[work.frame.zone + 1]
      // La caja de lo que se lee: las palabras del titular (no su caja, que llega a los lados cuando salta
      // de linea), los parrafos, las etiquetas y el enlace.
      work.dim = zoneBlock ? textBox(Array.from(zoneBlock.querySelectorAll('p, ul, a, h2 > span > span')), canvas) : null
    }
    queue.current = zones.map((work) => ({ zone: work.frame.zone, run: () => prepareHeadline(work, canvas, wide) }))
    overview.current = null
    scheduler.current.kick()
    invalidate()
  }, [fontsReady, size.width, size.height, wide, zones, gl, widths, invalidate])
  useEffect(() => {
    let alive = true
    let pending = false
    let cancel = () => {}
    const run = (deadline: IdleDeadline | null) => {
      pending = false
      const end = performance.now() + Math.max(5, Math.min(12, deadline?.timeRemaining() ?? 8))
      let done = false
      while (alive && queue.current.length && performance.now() < end) {
        let best = 0
        for (let q = 1; q < queue.current.length; q++) if (Math.abs(queue.current[q].zone - pose.zone) < Math.abs(queue.current[best].zone - pose.zone)) best = q
        queue.current.splice(best, 1)[0].run()
        done = true
      }
      // Sin animaciones solo se pinta cuando algo cambia: aqui, lo recien preparado.
      if (done) invalidate()
      if (alive && queue.current.length) kick()
    }
    // Se para cuando no queda trabajo; al cambiar el tamano se vuelve a llenar y se arranca de nuevo.
    const kick = () => {
      if (pending || !alive) return
      pending = true
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(run, { timeout: 300 })
        cancel = () => window.cancelIdleCallback(id)
      } else {
        const id = window.setTimeout(() => run(null), 40)
        cancel = () => window.clearTimeout(id)
      }
    }
    scheduler.current.kick = kick
    kick()
    return () => {
      alive = false
      cancel()
      scheduler.current.kick = () => {}
    }
  }, [pose, invalidate])
  /** Termina ya el titular pendiente de una zona. */
  const flush = (zone: number) => {
    const q = queue.current.findIndex((task) => task.zone === zone)
    if (q >= 0) queue.current.splice(q, 1)[0].run()
  }

  /**
   * Con la vista del simbolo entero recien calculada, donde queda cada zona en su parada, las celdas de
   * sus nombres (con la camara de la parada) y sus marcas en la malla del cerebro: la carpeta o la
   * tarjeta, y sus vecinas sin nada, para que no se confundan.
   */
  const relayout = (over: Overview, W: number, H: number) => {
    const info = brain.info
    for (let d = 0; d < CELLS; d++) info[d * 4 + 2] = baseMarks[d]
    probe.aspect = W / H
    // Las celdas en pantalla con el simbolo entero: de ahi sale donde queda cada zona en su parada.
    aim(probe, CENTER, over.at[0], over.at[1], over.height, W, H)
    const points = new Float64Array(CELLS * 2)
    const at = new Float64Array(2)
    for (let d = 0; d < CELLS; d++) {
      projectCell(brain.a, d, probe, W, H, at)
      points[d * 2] = at[0]
      points[d * 2 + 1] = at[1]
    }
    for (const work of zones) {
      const { zone, first, last } = work.frame
      const view = over.zones[zone]
      const centre = aimZone(view, points.subarray(first * 2, last * 2), over.at, work.dim, W, H, index.current)
      aim(probe, work.frame.focus, view.to[0], view.to[1], view.above, W, H, ZONE_ZOOM)
      const placed = placeNames(work, brain, probe, centre, W, H, wide, index.current, widths)
      work.names = placed.names
      work.clear = placed.clear
      work.all = [...(stage.folders[zone] ?? []), ...(stage.files[zone] ?? [])].filter((el): el is HTMLElement => !!el)
      work.target = (work.names.find((name) => !name.folder) ?? work.names[0])?.cell ?? -1
      for (const name of work.names) for (const e of neighbors(name.cell)) info[e * 4 + 2] = plainMarks(baseMarks[e])
      for (const d of work.clear) info[d * 4 + 2] = plainMarks(baseMarks[d])
    }
    for (const work of zones) for (const name of work.names) info[name.cell * 4 + 2] = namedMarks(baseMarks[name.cell], name.folder, name.kind, name.lock)
    geometry.getAttribute('aInfo').needsUpdate = true
  }

  // Con la escena en marcha, los titulares que ya tiene dibujados se vuelven transparentes (ver .dotted
  // en globals.css). Si se pierde el contexto de WebGL, el texto real vuelve a verse hasta que se recupere.
  useEffect(() => {
    const root = document.documentElement
    const canvas = gl.domElement
    // Un lienzo sin contexto se ve en blanco: se oculta y queda el fondo de la pagina.
    const show = () => {
      root.dataset.dots = ''
      canvas.style.visibility = ''
      invalidate()
    }
    const lost = (event: Event) => {
      event.preventDefault()
      delete root.dataset.dots
      canvas.style.visibility = 'hidden'
    }
    show()
    canvas.addEventListener('webglcontextlost', lost)
    canvas.addEventListener('webglcontextrestored', show)
    return () => {
      canvas.removeEventListener('webglcontextlost', lost)
      canvas.removeEventListener('webglcontextrestored', show)
      delete root.dataset.dots
      for (const title of stage.titles) if (title) delete title.dataset.drawn
      stage.live = false
    }
  }, [gl, invalidate])

  // Sin animaciones (o tras cambiar el tamano o la resolucion) se pinta solo cuando cambia algo.
  useEffect(() => progress.on('change', () => invalidate()), [progress, invalidate])
  useEffect(() => invalidate(), [size, viewportDpr, invalidate])

  // Shaders compilados al arrancar y no a mitad del primer viaje: se compilan en paralelo (si el
  // navegador puede) y despues se pinta el titular un par de fotogramas sin que se vea nada.
  const warm = useRef(0)
  const placeholder = useMemo(() => cellGeometry(new Float32Array([0, 0, 0, 1]), 1), [])
  useEffect(() => () => placeholder.dispose(), [placeholder])
  useEffect(() => {
    let alive = true
    const start = () => {
      if (!alive) return
      warm.current = 2
      invalidate()
    }
    if (gl.extensions.has('KHR_parallel_shader_compile')) gl.compileAsync(scene, camera).then(start, start)
    else start()
    return () => {
      alive = false
    }
  }, [gl, scene, camera, material, textMaterial, invalidate])

  // Resolucion: mientras se lee en un movil sube; si los fotogramas van lentos un buen rato, baja.
  const reading = useRef(false)
  const perf = useRef({ time: 0, frames: 0, strikes: 0 })

  const outline = useMemo(() => outlinePoints(), [])
  const tmp = useMemo(() => ({ v: new THREE.Vector3(), right: new THREE.Vector3(), up: new THREE.Vector3(), dir: new THREE.Vector3(), at: new Float64Array(2) }), [])

  useFrame(() => {
    const now = performance.now() / 1000
    // Tiempo desde el fotograma anterior; tras un rato quieto, el primer paso no cuenta todo ese rato.
    const dt = continued.current ? Math.min(Math.max(now - last.current, 0), 0.25) : 1 / 60
    last.current = now
    if (pulseStart.current < 0) pulseStart.current = now
    const goal = sceneAt(progress.get(), SCENE_COUNT - 1)
    const first = smooth.current < 0
    // La camara sigue al scroll al momento, sin retraso ni velocidad maxima. Un salto desde el indice no
    // se recorre: con la camara quieta todo se apaga, la escena pasa a su sitio y se enciende.
    const c = cut.current
    // Tras un salto (o al empezar), los fundidos no se recorren: todo aparece ya como toca.
    let jumped = first
    if (first) {
      smooth.current = goal
      c.leaving = false
      c.level = 1
    } else {
      const leap = performance.now() - stage.leap < 600
      // En un aparato muy lento, el fundido dura al menos unos fotogramas (nunca se apaga de golpe).
      const step = Math.min(dt, 1 / 15)
      if (!c.leaving && leap && Math.abs(goal - smooth.current) > 0.02) {
        c.leaving = true
        stage.leap = 0
      }
      if (c.leaving) {
        c.level = Math.max(0, c.level - step / CUT_OUT)
        if (c.level === 0) {
          smooth.current = goal
          c.leaving = false
          jumped = true
        }
      } else {
        c.level = Math.min(1, c.level + step / CUT_IN)
        smooth.current = goal
      }
    }
    const s = smooth.current
    let fade = c.level

    // Que se ve y que texto se lee. Tambien sin animaciones (en Windows, "efectos de animacion" apagados):
    // la camara solo se mueve con el scroll de quien lee y despacio, asi que el viaje se ve igual; lo que
    // se mueve solo (el pulso) es lo que se quita.
    journey(s, pose)
    const stop = Math.round(s)
    fades.reading = Math.abs(s - stop) < (fades.reading === stop ? TEXT_HIDE : TEXT_SHOW) ? stop : -1
    let fading = false
    let lead = -1
    for (let k = 0; k < SCENE_COUNT; k++) {
      const target = k === fades.reading ? 1 : 0
      fades.text[k] = jumped ? target : approach(fades.text[k], target, dt / (target ? TEXT_IN : TEXT_OUT))
      if (fades.text[k] !== target) fading = true
      if (fades.text[k] > 0 && (lead < 0 || fades.text[k] > fades.text[lead])) lead = k
    }
    // La penumbra detras del texto llega entera en cuanto empieza a aparecer y se va cuando ya no esta.
    if (lead >= 0) fades.lead = lead
    const dimGoal = lead >= 0 ? 1 : 0
    fades.dim = jumped ? dimGoal : approach(fades.dim, dimGoal, dt / DIM_FADE)
    if (fades.dim !== dimGoal) fading = true

    const frame = frames[pose.zone]
    stage.live = true
    // Fotogramas lentos (menos de unos 26 por segundo; con ahorro de bateria algunos navegadores se quedan
    // en 30 y eso no cuenta) dos ratos seguidos: un paso menos de resolucion. Solo cuentan los que siguen
    // a otro (el primero tras un rato quieto no dice nada de la tarjeta grafica).
    if (!slowed && continued.current && dt < 0.25 && now > 3) {
      const p = perf.current
      p.time += dt
      p.frames++
      if (p.time > 2) {
        p.strikes = p.time / p.frames > 1 / 26 ? p.strikes + 1 : 0
        p.time = 0
        p.frames = 0
        if (p.strikes >= 2) {
          p.strikes = 0
          quality.onSlow()
        }
      }
    }
    const W = size.width
    const H = size.height
    const dpr = gl.getPixelRatio()
    const pxk = H / 2 / TAN
    if (!overview.current) {
      overview.current = overviewOf(frames, W, H, wide, hero.current.top)
      relayout(overview.current, W, H)
    }
    const over = overview.current
    // Si la camara se acerca a una zona cuyo titular aun no esta preparado (al cargar a media pagina o
    // saltando desde el indice), se termina ahora: mejor un tiron que llegar sin el.
    if (pose.zoom > 0 && !zones[pose.zone].lit) flush(pose.zone)

    // Camara: siempre con la orientacion de la portada (nada gira). Con el simbolo entero (tambien en la
    // portada), la vista de over; al acercarse a una zona (y al alejarse), un zoom sobre el mapa: su punto
    // crece ZONE_ZOOM veces y todo se aparta del pivote.
    const view = over.zones[pose.zone]
    const zoom = Math.exp(pose.zoom * Math.log(ZONE_ZOOM))
    const height = view.above
    aim(cam, frame.focus, view.pivot[0] + zoom * (view.from[0] - view.pivot[0]), view.pivot[1] + zoom * (view.from[1] - view.pivot[1]), height, W, H, zoom)
    /** Px de pantalla por unidad del espacio junto al punto al que se mira. */
    const pxUnit = (pxk * zoom) / height
    // Tras un salto desde el indice, toda la escena se funde.
    dom.opacity(gl.domElement, fade)

    // Leyendo un titular en un movil de mucha densidad, a mas resolucion (la escena esta quieta).
    const sharp = !wide && fades.reading > 0 && window.devicePixelRatio > 1.5
    if (sharp !== reading.current) {
      reading.current = sharp
      quality.onReading(sharp)
    }

    // El hilo. Penumbra detras del texto que se esta leyendo y, cerca de una zona, bajo la barra de
    // arriba, la lectura en vivo y el indice.
    const onHero = fades.lead === 0
    const box = onHero ? hero.current.title : zones[Math.max(0, fades.lead - 1)].dim
    const dimAmt = (onHero ? Math.min(0.92, palette.heroDim + (wide ? 0 : 0.06)) : 0.82) * fades.dim
    const box2 = onHero ? hero.current.text : null
    // El pulso: una pasada que entra y sale con suavidad y se queda quieta. Solo se pinta mientras se ve el simbolo entero.
    const pass = (now - pulseStart.current) * PULSE_SPEED
    const pulse = reduceMotion ? 0 : PULSE_AMOUNT * ramp(0, 0.04, pass) * (1 - ramp(0.92, 1, pass))
    const pulseSeen = pulse > 0 && pose.zoom < 0.3
    const near = ramp(0, 1, pose.zoom)
    const u = material.uniforms
    // La zona encendida (como su etiqueta); con el simbolo entero, la luz pasa de una a otra. En la
    // portada aun no hay luz; cerca de una zona, toda la suya.
    u.uZone.value = pose.light
    u.uZoneFrom.value = pose.from < 0 ? pose.light : pose.from
    u.uZoneMix.value = pose.from < 0 ? 1 : pose.mix
    u.uZoneAmt.value = (pose.from < 0 ? pose.mix : 1) * lerp(LIT, 1, near)
    u.uTarget.value = zones[pose.light].target
    // Candados cuando las celdas ya miden algo; carpetas y tarjetas, al acercarse a la zona.
    u.uLockOn.value = ramp(10, 22, CELL_SIZE * pxUnit)
    u.uFolderOn.value = ramp(0.5, 0.95, pose.zoom)
    u.uCardOn.value = ramp(0.5, 0.95, pose.zoom)
    u.uRes.value.set(W * dpr, H * dpr)
    u.uDpr.value = dpr
    u.uLineW.value = STYLE.lineW * dpr * palette.lineScale
    u.uGlow.value = STYLE.glow * dpr * lerp(palette.glowReach, palette.glowReachNear, near)
    u.uLitGlow.value = lerp(palette.litGlow, palette.litGlowNear, near)
    u.uDotR.value = STYLE.dot * dpr
    // Con las celdas muy pequenas (el simbolo entero en un movil) el halo baja: si no, los halos se juntan
    // y en claro el cerebro se veria como una mancha azul.
    u.uGlowAmt.value = STYLE.glowAmt * palette.glowScale * lerp(palette.glowDense, 1, ramp(5, 16, CELL_SIZE * pxUnit))
    u.uTime.value = now - pulseStart.current
    u.uPulse.value = pulseSeen ? pulse : 0
    if (box) u.uDim.value.set(box[0] * dpr, (H - box[3]) * dpr, box[2] * dpr, (H - box[1]) * dpr)
    u.uDimAmt.value = box ? dimAmt : 0
    if (box2) u.uDim2.value.set(box2[0] * dpr, (H - box2[3]) * dpr, box2[2] * dpr, (H - box2[1]) * dpr)
    u.uDimAmt2.value = box2 ? palette.heroTextDim * fades.dim : 0
    u.uEdge.value.set((H - topBand(W)) * dpr, BOTTOM_BAND * dpr, index.current < W ? (index.current - 10) * dpr : 1e6, 140 * dpr)
    u.uEdgeAmt.value = 0.88 * ramp(0.15, 0.85, pose.zoom)

    // El titular que se lee, dibujado por el hilo en el plano de su zona, encima del titular real:
    // aparece y se va con un fundido corto, con la camara quieta.
    const line = textMesh.current
    const textZone = fades.lead - 1
    const lineWork = textZone >= 0 ? zones[textZone] : null
    const lineFade = textZone >= 0 ? fades.text[fades.lead] : 0
    if (line) {
      line.visible = lineFade > 0.001 && !!lineWork?.lit
      if (line.visible && lineWork?.lit && lineWork.headline) {
        // Rejilla con celdas de headline.step px en la parada, centrada en el titular real (en el plano
        // del punto de la zona, a perPx unidades del espacio por px).
        const stop = over.zones[textZone]
        const perPx = stop.above / (pxk * ZONE_ZOOM)
        const cell = lineWork.headline.step * perPx
        tmp.v
          .copy(lineWork.frame.focus)
          .addScaledVector(VIEW.right, (lineWork.headline.at[0] - stop.to[0]) * perPx)
          .addScaledVector(VIEW.up, (stop.to[1] - lineWork.headline.at[1]) * perPx)
        line.matrix
          .makeBasis(tmp.right.copy(VIEW.right).multiplyScalar(cell), tmp.up.copy(VIEW.up).multiplyScalar(cell), tmp.dir.copy(VIEW.dir).multiplyScalar(cell))
          .setPosition(tmp.v)
        if (line.geometry !== lineWork.lit) line.geometry = lineWork.lit
        const uniforms = textMaterial.uniforms
        uniforms.uFade.value = lineFade
        uniforms.uRes.value.set(W * dpr, H * dpr)
        uniforms.uDpr.value = dpr
      }
    }
    // El brillo del simbolo se pinta antes que el hilo: si cambia, hace falta un fotograma mas para que
    // lo recoja. Se atenua al acercarse a una zona.
    const auraFade = 1 - 0.6 * near
    const auraChanged = Math.abs(auraFade - aura.current.fade) > 1e-4
    aura.current.fade = auraFade

    // Texto de cada escena: la portada al principio; el de cada zona, con su titular. Ocultos siguen en
    // el arbol de accesibilidad: solo dejan de recibir clics y sus enlaces salen del tabulador.
    for (let k = 0; k < SCENE_COUNT; k++) {
      const shown = fades.text[k] * fade
      dom.opacity(stage.blocks[k], shown)
      dom.still(stage.blocks[k], shown < 0.5)
      dom.inert(stage.actions[k], shown < 0.5)
    }
    // Mientras se lee un titular, el indice de la derecha se queda en numeros si no hay sitio (para no
    // pisarlo) y el aviso de scroll se va. Mientras se lee una zona (data-zone), tambien en las pantallas
    // bajas de xl, y el hilo del fondo de la pagina se va (ver globals.css).
    dom.opacity(stage.hint, 1 - ramp(0.1, 0.2, s))
    dom.data(stage.nav, 'quiet', lead >= 0 ? '1' : '0')
    dom.data(stage.nav, 'zone', lead > 0 ? '1' : '0')

    // Con la camara ya en la parada de una zona, su ruta y los nombres de sus carpetas (al lado de su
    // icono) y documentos (debajo o al lado de su tarjeta) aparecen con un fundido corto; al irse, se van.
    const at = tmp.at
    for (let z = 0; z < ZONE_COUNT; z++) {
      const work = zones[z]
      const goal = z === pose.zone && pose.hero === 0 && pose.zoom >= 1 ? 1 : 0
      const a = (fades.zones[z] = jumped ? goal : approach(fades.zones[z], goal, dt / NAME_FADE))
      if (a !== goal) fading = true
      dom.opacity(stage.crumbs[z], a * fade)
      for (const el of work.all) if (!work.names.some((name) => name.el === el)) dom.opacity(el, 0)
      // Tamano de sus celdas respecto al de la parada (alli se midieron).
      const scale = ((pxUnit * over.zones[z].above) / (pxk * ZONE_ZOOM)) * GLYPH
      for (const name of work.names) {
        const placed = a > 0 && projectCell(brain.a, name.cell, cam, W, H, at)
        dom.opacity(name.el, placed ? a * fade : 0)
        if (!placed) continue
        const g = name.px * scale
        const [ax, ay] = nameAnchor(at[0], at[1], g, name.folder, name.side)
        dom.move(name.el, ax, ay)
        dom.data(name.el, 'side', name.side)
      }
    }

    // Etiquetas de las zonas alrededor del simbolo, siempre por fuera de su silueta en pantalla (una
    // elipse con la caja de su contorno proyectado), mientras se ve entero. En el movil, solo la de la
    // zona encendida, encima o debajo del simbolo (en horizontal, a un lado).
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of outline) {
      if (!project(point, cam, W, H, at)) continue
      minX = Math.min(minX, at[0])
      maxX = Math.max(maxX, at[0])
      minY = Math.min(minY, at[1])
      maxY = Math.max(maxY, at[1])
    }
    const ex = (minX + maxX) / 2
    const ey = (minY + maxY) / 2
    const ea = Math.max(1, (maxX - minX) / 2)
    const eb = Math.max(1, (maxY - minY) / 2)
    const away = 1 - ramp(0, 0.35, pose.zoom)
    const sideways = wide || (H < 500 && W > H)
    for (let z = 0; z < ZONE_COUNT; z++) {
      const el = stage.zoneLabels[z]
      // Cuanto es esta la zona encendida (con el simbolo entero, la luz pasa de la que se deja a la siguiente).
      const on = (z === pose.light ? pose.mix : 0) + (z === pose.from ? 1 - pose.mix : 0)
      const seen = (wide || on > 0.01) && away > 0.01 && project(frames[z].label, cam, W, H, at)
      const shown = wide ? lerp(palette.labelDim + (1 - palette.labelDim) * on, palette.heroLabel, pose.hero) : on * (1 - pose.hero)
      dom.opacity(el, seen ? away * shown * fade : 0)
      if (!seen || !el) continue
      let dx = at[0] - ex
      let dy = at[1] - ey
      const len = Math.max(1e-3, Math.hypot(dx, dy))
      const onEdge = len / Math.max(1e-3, Math.hypot(dx / ea, dy / eb))
      const needed = onEdge + 16 + (10 * Math.abs(dy)) / len
      if (len < needed) {
        dx *= needed / len
        dy *= needed / len
      }
      const width = (widths.get(el) ?? 120) + 12
      let side = dx < 0 ? 'left' : 'right'
      let x = side === 'left' ? clampTo(ex + dx, 16 + width, W - 16) : clampTo(ex + dx, 16, W - 16 - width)
      let y = clampTo(ey + dy, 96, H - 72)
      if (!sideways) {
        // En el movil en vertical no hay sitio a los lados: encima o debajo del simbolo, centrada.
        // Si encima no cabe (con el simbolo arriba, como en la portada), debajo.
        side = 'below'
        x = clampTo(ex + dx * 0.3, 16 + width / 2, W - 16 - width / 2)
        const above = ey - eb - 34
        y = clampTo(dy > 0 || above < 96 ? ey + eb + 18 : above, 96, H - 96)
      } else if (!wide) {
        // En horizontal, a su lado del simbolo y a su altura.
        x = side === 'left' ? clampTo(ex - ea - 16, 16 + width, W - 16) : clampTo(ex + ea + 16, 16, W - 16 - width)
        y = clampTo(ey + dy, 80, H - 24)
      } else if (onHero && hero.current.title && hero.current.text) {
        // En la portada, las que caerian sobre el titulo o su texto bajan hasta debajo del texto.
        const x0 = side === 'left' ? x - width : x
        const x1 = side === 'left' ? x : x + width
        if (overlaps(hero.current.title, x0, x1, y) || overlaps(hero.current.text, x0, x1, y)) y = lerp(y, hero.current.text[3] + 18, fades.text[0])
      }
      dom.move(el, x, y)
      dom.data(el, 'side', side)
      dom.data(el, 'on', on > 0.5 && pose.hero < 0.5 ? '1' : '0')
    }

    // Solo se pide otro fotograma mientras algo se mueve: la camara que aun no ha llegado, el fundido de
    // un salto o de un cambio de vista, un fundido de texto o de nombres, el pulso (mientras dura y se ve)
    // o el brillo del simbolo, que lo recoge en el siguiente.
    const moving = s !== goal || c.leaving || c.level < 1 || fading || pulseSeen || auraChanged
    continued.current = moving
    if (moving) invalidate()

    // Al arrancar, el titular aun sin ver se pinta igual (sin que se vea nada) para compilar ya su shader.
    if (warm.current > 0) {
      warm.current--
      if (line && !line.visible) {
        line.geometry = zones[pose.zone].lit ?? placeholder
        textMaterial.uniforms.uFade.value = 0
        line.visible = true
      }
      invalidate()
    }
  })

  return (
    <>
      <mesh geometry={geometry} material={material} frustumCulled={false} renderOrder={0} />
      <mesh ref={textMesh} material={textMaterial} frustumCulled={false} matrixAutoUpdate={false} renderOrder={1} visible={false} />
    </>
  )
}

// ---------------------------------------------------------------- utilidades

/** Si la pantalla es de lg en adelante, con la misma regla que usa el texto (Tailwind). Solo corre en el navegador. */
function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

/** Si un elemento esta a la vista (fuera de ella, la escena no pinta). */
function useOnScreen(ref: React.RefObject<HTMLElement | null>) {
  const [onScreen, setOnScreen] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setOnScreen(entry.isIntersecting))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return onScreen
}
