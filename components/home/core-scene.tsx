"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MotionValue } from 'motion/react'
import { sceneAt, stage } from '@/components/home/stage'
import {
  CARD,
  CENTER,
  LEVELS,
  VIEW,
  ZONE_COUNT,
  buildBrain,
  buildFrames,
  buildHeadline,
  buildPatch,
  clamp01,
  fileKind,
  mulberry32,
  namedCells,
  outlinePoints,
  ramp,
  toGrid,
  type Headline,
  type ScreenAxes,
  type ZoneFrame,
} from '@/components/home/thread'
import { HEADLINE_FRAGMENT, HEADLINE_VERTEX, THREAD_FRAGMENT, THREAD_VERTEX } from '@/components/home/thread-shaders'

// El cerebro de la home: un solo hilo de luz que, visto desde arriba, dibuja un cerebro de icono
// (ver thread.ts). La camara mira siempre como en la portada (nunca gira) y se mueve como sobre un
// mapa: entre dos zonas se aleja en linea recta hasta ver el simbolo entero, siempre igual y centrado,
// la luz pasa a la zona siguiente y la camara baja en linea recta a ella, nivel a nivel: la zona, sus
// carpetas y sus documentos, parandose en cada nivel. Al fondo, uno de ellos ha crecido hasta ser una
// pagina y, con la camara ya quieta, el propio hilo dibuja el titular en sus renglones, encima del
// titular real. En cada parada no se mueve nada mientras se lee.
// Escenas: 0 portada, 1 local, 2 historial, 3 equipo, 4 documentos, 5 carpetas, 6 tareas (la zona
// de la escena k es la k - 1 del hilo).
//
// Unidades: el cerebro mide unos 2 de ancho (x) y 2,3 de largo (y); la boveda sube en z.

const SCENE_COUNT = 7
const FOV = 40
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
/**
 * Tramos de cada escena, en escenas de scroll desde la parada anterior (cada una mide SCENE_VH, ver
 * stage.ts). En cada parada la camara esta quieta HOLD a cada lado. Luego sube en linea recta: la
 * pagina se aleja un poco y se apaga, la camara sube sin que se vea nada y aparece el simbolo entero,
 * que se para (desde la portada, el simbolo solo se recoloca). Con el simbolo entero quieto, la luz
 * pasa de la zona que se deja a la siguiente. Despues baja en linea recta a ella, con una parada en
 * sus carpetas y otra en sus documentos, y llega a la pagina antes de la siguiente parada.
 */
const HOLD = 0.15
const RISE_END = 0.27
const DESCEND = 0.37
const ARRIVE = 1 - HOLD
/** Con el simbolo entero quieto, cuando pasa la luz de una zona a la otra. */
const LIGHT_FROM = 0.29
const LIGHT_TO = 0.35
/** Paradas de la bajada: cuanto duran (en escenas) y el tamano de las celdas en px (carpetas y documentos) mientras. */
const PAUSE = 0.04
const PAUSE_PX = [56, 120]
/** Arranque y frenada de cada tramo de la bajada, en parte del tramo (en medio va a velocidad constante). */
const DIVE_RAMP = 0.22
/** Peso de cada tramo de la bajada (hasta las carpetas, hasta los documentos y hasta la pagina) por lo que acerca. */
const DIVE_WEIGHT = [1.25, 0.85, 1]
/** Subida: la pagina se aleja hasta RISE_BACK veces y se apaga; el simbolo aparece con sus celdas de RISE_PX px. */
const RISE_BACK = 1.6
const RISE_PX = 80
/**
 * Texto de cada parada: llega a menos de TEXT_SHOW de ella y se va a mas de TEXT_HIDE (en escenas,
 * con la camara ya quieta), con un fundido en el tiempo: nunca se queda a medias.
 */
const TEXT_SHOW = 0.11
const TEXT_HIDE = 0.125
const TEXT_IN = 0.45
const TEXT_OUT = 0.3
/** Fundido (en segundos) de la penumbra detras del texto y de los nombres de carpetas y documentos. */
const DIM_FADE = 0.2
const NAME_FADE = 0.25
/** Cuanto se enciende la zona a la que se va mientras se ve el simbolo entero. */
const LIT = 0.7
/** Un salto de mas de esto (en escenas: el indice, la barra de scroll) no se recorre: se funde. */
const JUMP = 0.6
const CUT_FADE = 0.35
/** Velocidad maxima de la camara, en escenas por segundo: ni una rueda rapida ni un golpe de dedo la aceleran. */
const MAX_SPEED = 0.3
/** Pulso: una sola pasada lenta y suave por el hilo al abrir la pagina, y se para. Sin animaciones, ninguna. */
const PULSE_SPEED = 1 / 36
const PULSE_AMOUNT = 0.6
/** Sin animaciones la camara no viaja: al cambiar de vista todo se apaga (DIP_OUT s) y se enciende ya en la nueva. */
const DIP_OUT = 0.2
const DIP_IN = 0.3

type RGB = [number, number, number]
// Componentes tal cual del hex: el shader los pinta sin convertir.
const rgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const THEMES = {
  light: {
    background: '#ffffff',
    blending: THREE.NormalBlending as THREE.Blending,
    light: 1,
    glow: rgb('#3d7bff'),
    core: rgb('#0463FE'),
    node: rgb('#0A2A7A'),
    pulse: rgb('#00A3D9'),
    ink: rgb('#0A1633'),
    glowScale: 0.35,
    sky: rgb('#9DB6E8'),
    starOpacity: 0.5,
    nebula: ['#6AA4FF', '#9AB8FF', '#7FD8FF'],
    nebulaOpacity: 0.08,
    /** Penumbra detras del titulo de la portada (en claro, menos: el hilo azul sobre blanco se borraria) y de su texto. */
    heroDim: 0.45,
    heroTextDim: 0.85,
  },
  dark: {
    background: '#070a12',
    blending: THREE.AdditiveBlending as THREE.Blending,
    light: 0,
    glow: rgb('#0463FE'),
    core: rgb('#9FDCFF'), // el alma del hilo, de un cian casi blanco
    node: rgb('#D4F3FF'),
    pulse: rgb('#5FE3FF'),
    ink: rgb('#F2F6FF'),
    glowScale: 1,
    sky: rgb('#C9D8FF'),
    starOpacity: 0.9,
    nebula: ['#0463FE', '#2B7FFF', '#1FB6FF'],
    nebulaOpacity: 0.16,
    heroDim: 0.86,
    heroTextDim: 0.9,
  },
}
type Palette = (typeof THEMES)['light']

/** Trazo de cada nivel (en px): el cerebro, las carpetas, los documentos y el hilo fino de la pagina (mas tenue). */
const LEVEL_STYLE = [
  { lineW: 1.6, glow: 3.0, dot: 1.7, core: 0.95, glowAmt: 0.5 },
  { lineW: 1.4, glow: 2.5, dot: 1.5, core: 0.9, glowAmt: 0.4 },
  { lineW: 1.3, glow: 2.2, dot: 1.4, core: 0.85, glowAmt: 0.34 },
  { lineW: 0.9, glow: 1.5, dot: 0.8, core: 0.5, glowAmt: 0.16 },
]

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
  const sky = useRef({ fade: 1 })
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
      <color attach="background" args={[palette.background]} />
      <Sky palette={palette} fade={sky} wide={wide} />
      <Thread {...props} palette={palette} wide={wide} sky={sky} quality={quality} slowed={top <= 1} onScreen={onScreen} />
    </Canvas>
  )
}

// ---------------------------------------------------------------- el espacio

const SKY_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uRatio;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Cada estrella con su brillo, fijo (no titilan).
    vAlpha = 0.3 + 0.6 * aSeed;
    gl_PointSize = aSize * uRatio * (0.7 + 0.3 * vAlpha);
  }
`

const SKY_FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.1, d) * vAlpha * uOpacity;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor, a);
  }
`

/** Estrellas de fondo y nebulosas bajo el cerebro, quietas: dan profundidad y se apagan al bajar a una zona. */
function Sky({ palette, fade, wide }: { palette: Palette; fade: { current: { fade: number } }; wide: boolean }) {
  const { gl } = useThree()
  const stars = useMemo(() => {
    const count = wide ? 3200 : 1800
    const rand = mulberry32(9)
    const pos = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const u = rand() * 2 - 1
      const a = rand() * Math.PI * 2
      const r = 14 + rand() * 40
      const ring = Math.sqrt(1 - u * u)
      pos.set([Math.cos(a) * ring * r, Math.sin(a) * ring * r, u * r], i * 3)
      size[i] = 0.8 + rand() * rand() * 2.6
      seed[i] = rand()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [wide])
  useEffect(() => () => stars.dispose(), [stars])
  const starMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: {
          uRatio: { value: 1 },
          uColor: { value: new THREE.Vector3(...palette.sky) },
          uOpacity: { value: palette.starOpacity },
        },
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: palette.blending,
      }),
    [palette]
  )
  useEffect(() => () => starMaterial.dispose(), [starMaterial])

  // Nebulosas: manchas de luz grandes y muy suaves por debajo del simbolo; la ultima, su propio brillo.
  // Una textura por color, compartida.
  const clouds = useMemo(() => {
    const textures = palette.nebula.map((color) => glowTexture(color))
    const list = CLOUDS.map((c) => ({
      ...c,
      material: new THREE.SpriteMaterial({
        map: textures[c.color],
        transparent: true,
        opacity: palette.nebulaOpacity,
        depthTest: false,
        depthWrite: false,
        blending: palette.blending,
      }),
    }))
    return { textures, list }
  }, [palette])
  useEffect(
    () => () => {
      clouds.textures.forEach((t) => t.dispose())
      clouds.list.forEach((c) => c.material.dispose())
    },
    [clouds]
  )

  useFrame(() => {
    starMaterial.uniforms.uRatio.value = gl.getPixelRatio()
    starMaterial.uniforms.uOpacity.value = palette.starOpacity * (0.25 + 0.75 * fade.current.fade)
    for (const c of clouds.list) {
      // Apagadas (al bajar a una zona) no se pintan.
      c.material.opacity = palette.nebulaOpacity * fade.current.fade
      c.material.visible = fade.current.fade > 0.01
    }
  })

  return (
    <>
      <points geometry={stars} material={starMaterial} frustumCulled={false} renderOrder={-2} />
      {clouds.list.map((c, k) => (
        <sprite key={k} position={c.at} scale={c.scale} material={c.material} renderOrder={-1} />
      ))}
    </>
  )
}

const CLOUDS: { at: [number, number, number]; scale: number; color: number }[] = [
  { at: [7, 4, -9], scale: 15, color: 0 },
  { at: [-8, -3, -8], scale: 12, color: 1 },
  { at: [2, -9, -11], scale: 13, color: 2 },
  { at: [-4, 8, -12], scale: 11, color: 0 },
  { at: [0, 0, -0.8], scale: 4.6, color: 1 },
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
  /** Zona a la que mira la camara: la que se deja al subir y la siguiente con el simbolo entero y al bajar. */
  zone: number
  /** Zona de la que viene la luz mientras pasa a zone con el simbolo entero (-1 desde la portada: no hay luz). */
  from: number
  /** Cuanto ha pasado la luz de from a zone. */
  mix: number
  /** 1 en la portada y 0 con el simbolo entero en su sitio. */
  hero: number
  /** Parte de la bajada que se lleva (0 arriba, 1 en la pagina) o -1 si no se baja. */
  down: number
  /** Parte de la subida que se lleva (0 en la pagina, 1 arriba) o -1 si no se sube. */
  up: number
  /** Sin animaciones: quieta en los documentos de la zona (con sus nombres). */
  docs: boolean
  /** Cuanto se ha bajado en escala logaritmica (0 viendo el simbolo entero, 1 en la pagina): lo calcula la escena. */
  dive: number
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

/**
 * Cuanto se ha bajado (en escala logaritmica) en la parte t de la bajada: tres tramos (hasta las
 * carpetas, hasta los documentos y hasta la pagina), cada uno con arranque y frenada suaves y con una
 * parada de verdad entre ellos (folders y files: donde se para, en la misma escala). Cada tramo dura
 * segun lo que acerca y lo que se ve mientras (DIVE_WEIGHT): el cerebro entero creciendo cambia mucho la
 * imagen y va mas despacio; las carpetas ya grandes, casi vacias, mas deprisa.
 */
function descent(t: number, folders: number, files: number) {
  const pause = PAUSE / (ARRIVE - DESCEND)
  const moving = 1 - 2 * pause
  const wa = DIVE_WEIGHT[0] * folders
  const wb = DIVE_WEIGHT[1] * (files - folders)
  const sum = wa + wb + DIVE_WEIGHT[2] * (1 - files)
  const a = (moving * wa) / sum
  const b = (moving * wb) / sum
  if (t < a) return folders * cruise(t / a, DIVE_RAMP)
  if (t < a + pause) return folders
  if (t < a + pause + b) return lerp(folders, files, cruise((t - a - pause) / b, DIVE_RAMP))
  if (t < a + 2 * pause + b) return files
  return lerp(files, 1, cruise((t - a - 2 * pause - b) / (1 - a - 2 * pause - b), DIVE_RAMP))
}

/**
 * Cuanto se ha bajado en la parte t de la subida: la pagina se aleja un poco (back, en la misma
 * escala) mientras se apaga, la camara sube de golpe sin que se vea nada y el simbolo aparece (con
 * sus celdas a RISE_PX, en brain) y se para despacio arriba.
 */
function rise(t: number, back: number, brain: number) {
  if (t < 0.25) return 1 - back * ramp(0, 0.25, t)
  if (t < 0.32) return lerp(1 - back, brain, ramp(0.25, 0.32, t))
  return brain * (1 - cruise((t - 0.32) / 0.68, 0.3))
}
/** En la subida: cuanto se ven los niveles finos (se apagan al empezar) y el cerebro (aparece al final). */
const riseFine = (t: number) => 1 - ramp(0.03, 0.23, t)
const riseBrain = (t: number) => ramp(0.32, 0.52, t)

/** Pose segun el scroll (s de 0 a 6, en escenas). */
function journey(s: number, out: Pose) {
  const k = Math.min(SCENE_COUNT - 2, Math.max(0, Math.floor(s)))
  const f = s - k
  out.hero = 0
  out.down = -1
  out.up = -1
  out.mix = 1
  out.docs = false
  if (f < RISE_END) {
    // En la parada que se deja (la portada o la pagina de la zona anterior) y, al pasar HOLD, la subida.
    const t = clamp01((f - HOLD) / (RISE_END - HOLD))
    out.zone = Math.max(0, k - 1)
    out.from = k - 1
    if (k === 0) {
      // Desde la portada no se sube: el simbolo entero solo se recoloca, aun sin luz.
      out.hero = 1 - cruise(t, 0.3)
      out.mix = 0
    } else if (t > 0) out.up = t
    else out.down = 1
  } else if (f < DESCEND) {
    // Con el simbolo entero quieto, la luz pasa de la zona que se deja a la siguiente.
    out.zone = k
    out.from = k - 1
    out.mix = ramp(LIGHT_FROM, LIGHT_TO, f)
    out.down = 0
  } else {
    out.zone = out.from = k
    out.down = clamp01((f - DESCEND) / (ARRIVE - DESCEND))
  }
  return out
}

/**
 * Sin animaciones, la camara no viaja: cada tramo del scroll tiene una vista quieta y entre dos hay
 * un fundido. Por escena, cuatro: la parada (un cuarto de escena a cada lado), el simbolo entero con
 * la zona siguiente encendida y sus documentos con sus nombres (asi se ve donde se entra). La vista v
 * cubre x = 4 s + 1 de v a v + 1; la de cada parada n son dos (4 n y 4 n + 1) y se cuenta como 4 n.
 */
const stillView = (x: number) => {
  const v = Math.min(4 * (SCENE_COUNT - 1) + 1, Math.max(1, Math.floor(x)))
  return v % 4 === 1 ? v - 1 : v
}
/** Donde acaba una vista (en x; empieza en su numero). */
const viewEnd = (view: number) => (view % 4 === 0 ? view + 2 : view + 1)

function stillPose(view: number, out: Pose) {
  const q = view % 4
  const base = (view - q) / 4
  out.hero = 0
  out.up = -1
  out.mix = 1
  out.docs = false
  if (q === 0) {
    // La parada base: la portada o la pagina de su zona.
    out.zone = Math.max(0, base - 1)
    out.from = base - 1
    out.down = base === 0 ? 0 : 1
    if (base === 0) {
      out.hero = 1
      out.mix = 0
    }
  } else {
    // El simbolo entero con la zona encendida o sus documentos.
    out.zone = out.from = base
    out.down = 0
    out.docs = q === 3
  }
  return out
}

/** Distancia a la que se ve el cerebro entero, centrado, ocupando tall de la altura y across del ancho (la portada). */
function fitDistance(aspect: number, tall: number, across: number) {
  const byHeight = 2.45 / tall / (2 * TAN)
  const byWidth = 2.1 / across / (2 * TAN * aspect)
  return Math.max(byHeight, byWidth)
}

/** Al fondo de cada zona la rejilla fina se ve derecha: su derecha y su arriba son los de la pantalla. */
const SCREEN: ScreenAxes = { right: [1, 0], up: [0, 1] }

/** Ancla de una zona en px del lienzo: el centro de su titular (hasta medirlo, el centro de la pantalla). */
function anchorOf(work: ZoneWork, W: number, H: number, out: [number, number]) {
  out[0] = Number.isNaN(work.anchor[0]) ? W / 2 : work.anchor[0]
  out[1] = Number.isNaN(work.anchor[1]) ? H / 2 : work.anchor[1]
  return out
}

/** Distancia (por VIEW.dir) desde el documento objetivo de una zona a la que las celdas del nivel k miden px. */
function heightFor(frame: ZoneFrame, k: number, px: number, pxk: number) {
  return (frame.unit[k] * pxk) / px + frame.depth[2] - frame.depth[k]
}

/** La vista del simbolo entero, la misma para todas las zonas. */
interface Overview {
  /** Donde cae en pantalla el centro del cerebro y a que distancia esta (por VIEW.dir). */
  at: [number, number]
  height: number
  /** Por zona: distancia a su documento objetivo (por VIEW.dir) y donde cae en pantalla. */
  above: number[]
  points: [number, number][]
}

/**
 * Vista del simbolo entero: centrado y lo mas grande posible en la parte libre de la pantalla (bajo
 * la barra de arriba y, en el ordenador, con sitio a los lados para las etiquetas de las zonas y el
 * indice; en el movil, encima y debajo para su etiqueta y, en horizontal, a los lados). Es la misma
 * para todas las zonas: entre dos solo cambia la luz. Desde ella se baja a cada zona.
 */
function overviewOf(zones: ZoneWork[], outline: THREE.Vector3[], W: number, H: number, wide: boolean): Overview {
  const pxk = H / 2 / TAN
  const sideways = !wide && H < 500 && W > H
  const left = wide ? 170 : sideways ? 150 : 16
  const right = W - (wide ? 330 : sideways ? 150 : 16)
  const top = wide ? 92 : sideways ? 72 : 112
  const bottom = H - (wide ? 60 : sideways ? 24 : 88)
  const v = new THREE.Vector3()
  const fit = (sx: number, sy: number) => {
    let h = 0
    for (const point of outline) {
      // A distancia h, el punto cae en sx + x * pxk / (h - depth) (y lo mismo en vertical).
      v.subVectors(point, CENTER)
      const depth = v.dot(VIEW.dir)
      const x = v.dot(VIEW.right)
      const y = v.dot(VIEW.up)
      h = Math.max(h, depth + (Math.max(x, 0) * pxk) / Math.max(40, right - sx), depth + (Math.max(-x, 0) * pxk) / Math.max(40, sx - left))
      h = Math.max(h, depth + (Math.max(y, 0) * pxk) / Math.max(40, sy - top), depth + (Math.max(-y, 0) * pxk) / Math.max(40, bottom - sy))
    }
    return h
  }
  // Se centra la silueta proyectada (no el centro del cerebro, que con la boveda cae algo arriba).
  let sx = (left + right) / 2
  let sy = (top + bottom) / 2
  let h = fit(sx, sy)
  for (let pass = 0; pass < 2; pass++) {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of outline) {
      v.subVectors(point, CENTER)
      const scale = pxk / (h - v.dot(VIEW.dir))
      const x = sx + v.dot(VIEW.right) * scale
      const y = sy - v.dot(VIEW.up) * scale
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
    sx += (left + right) / 2 - (minX + maxX) / 2
    sy += (top + bottom) / 2 - (minY + maxY) / 2
    h = fit(sx, sy)
  }
  // En el ordenador, en el centro de la pantalla como en la portada si cabe casi igual de grande, y no
  // mas grande que en la portada: al salir de ella el simbolo apenas cambia.
  if (wide) {
    const centered = fit(W / 2, sy)
    if (centered < h * 1.1) {
      sx = W / 2
      h = centered
    }
    h = Math.max(h, fitDistance(W / H, 0.74, 0.86))
  }
  const camera = CENTER.clone()
    .addScaledVector(VIEW.dir, h)
    .addScaledVector(VIEW.right, ((W / 2 - sx) / pxk) * h)
    .addScaledVector(VIEW.up, ((sy - H / 2) / pxk) * h)
  const above: number[] = []
  const points: [number, number][] = []
  for (const work of zones) {
    v.subVectors(camera, work.frame.centers[2])
    const height = v.dot(VIEW.dir)
    above.push(height)
    points.push([W / 2 - (v.dot(VIEW.right) * pxk) / height, H / 2 + (v.dot(VIEW.up) * pxk) / height])
  }
  return { at: [sx, sy], height: h, above, points }
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

function brainGeometry() {
  const brain = buildBrain()
  const g = quadGeometry()
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(brain.a, 3))
  g.setAttribute('aPrev', new THREE.InstancedBufferAttribute(brain.prev, 3))
  g.setAttribute('aNext', new THREE.InstancedBufferAttribute(brain.next, 3))
  g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(brain.info, 4))
  g.instanceCount = brain.count
  return g
}

const vec3 = (c: RGB) => ({ value: new THREE.Vector3(...c) })

function threadMaterial(palette: Palette, level: number) {
  const st = LEVEL_STYLE[level]
  return new THREE.ShaderMaterial({
    vertexShader: THREAD_VERTEX,
    fragmentShader: THREAD_FRAGMENT,
    defines: level === 0 ? { DOME: '' } : {},
    uniforms: {
      uRes: { value: new THREE.Vector2(1, 1) },
      uDpr: { value: 1 },
      uAlpha: { value: 0 },
      uMaxCell: { value: 1e6 },
      uLens: { value: 9 },
      uLensAt: { value: new THREE.Vector2() },
      uPatch: { value: new THREE.Vector2(1, 1) },
      uLineW: { value: st.lineW },
      uGlow: { value: st.glow },
      uDotR: { value: st.dot },
      uCore: { value: st.core },
      uGlowAmt: { value: st.glowAmt },
      uTime: { value: 0 },
      uPulse: { value: 0 },
      // Un solo pulso recorre el cerebro entero en 40 s (fase por celda: 1/1024). Los niveles finos no
      // llevan; si lo llevaran, uno cada 8192 celdas, con la cabeza y la cola del mismo largo en celdas.
      uSpeed: { value: level === 0 ? PULSE_SPEED : 1 / 14 },
      uStep: { value: level === 0 ? 1 / 1024 : 1 / 8192 },
      uHead: { value: level === 0 ? 900 : 7200 },
      uTail: { value: level === 0 ? 100 : 800 },
      uZone: { value: 0 },
      uZoneFrom: { value: 0 },
      uZoneMix: { value: 1 },
      uZoneAmt: { value: 0 },
      uTarget: { value: -1 },
      uDots: { value: 1 },
      uCardOn: { value: 0 },
      uFolderOn: { value: 0 },
      uLockOn: { value: 0 },
      uPage: { value: 0 },
      uPageDot: { value: 0.003 },
      uPageRows: { value: new THREE.Vector4(0, 0, 1, 0) },
      uQuiet: { value: new THREE.Vector4() },
      uQuietAmt: { value: 0 },
      uLight: { value: palette.light },
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

/** Lo que se prepara de cada zona: su rejilla al llegar, sus niveles finos, su titular, su pagina y su bloque de texto. */
interface ZoneWork {
  frame: ZoneFrame
  axes: ScreenAxes
  /** Centro de su titular en px del lienzo: alli queda la zona vista desde arriba y el documento al llegar. */
  anchor: [number, number]
  matrices: THREE.Matrix4[]
  patches: (THREE.InstancedBufferGeometry | null)[]
  patchKeys: string[]
  /** Mitad del trozo de cada nivel fino, en celdas (para desvanecer su borde). */
  patchSizes: [number, number][]
  headline: Headline | null
  lit: THREE.InstancedBufferGeometry | null
  dim: number[] | null
  /** Tamano en px de la celda del documento objetivo al llegar: su tarjeta enmarca el titular. */
  page: number
  /** Unidades del espacio por px de pantalla al llegar. */
  pxUnit: number
  /** Rejilla del titular: centrada en el documento objetivo, con celdas del paso del titular. */
  lineMatrix: THREE.Matrix4
  /** Renglones de la pagina, en celdas de documento: primera linea de base, ultima, separacion y renglones del titular. */
  rows: THREE.Vector4
  /** Separacion de la rejilla de puntos de la pagina (la del titular), en celdas de documento. */
  dots: number
  /** Tipo de archivo de los documentos con nombre (el primero, el objetivo). */
  kinds: number[]
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
 * Pagina de una zona: el tamano de la tarjeta objetivo al llegar (enmarca el titular), sus renglones
 * y la rejilla del titular. Sin titular, la tarjeta ocupa tres cuartos del ancho.
 */
function placePage(work: ZoneWork, width: number, headline: Headline | null, wide: boolean) {
  const { frame } = work
  if (headline) {
    // La tarjeta enmarca el titular con un margen a los lados (sin salirse de la pantalla) y con aire arriba y abajo.
    const across = Math.min(headline.size[0] / 2 + (wide ? 64 : 12), width / 2 - 4) / CARD.half
    const tall = (headline.size[1] / 2 + headline.pitch * 0.8) / CARD.tall
    work.page = Math.max(across, tall)
    const first = headline.baselines[0] ?? 0
    const last = headline.baselines[headline.baselines.length - 1] ?? 0
    work.rows.set(-first / work.page, -last / work.page, headline.pitch / work.page, headline.baselines.length)
  } else {
    work.page = (width * 0.375) / CARD.half
    work.rows.set(0, 0, 0.06, 1)
  }
  work.pxUnit = frame.unit[2] / work.page
  work.dots = (headline?.step ?? 6) / work.page
  const cell = work.dots * frame.unit[2]
  work.lineMatrix
    .makeBasis(frame.axisI.clone().multiplyScalar(cell), frame.axisJ.clone().multiplyScalar(cell), frame.normal.clone().multiplyScalar(cell))
    .setPosition(frame.centers[2])
}

/** Trabajo pendiente de una zona: su titular (antes los de todas, es lo que se lee) o sus niveles finos. */
interface Task {
  zone: number
  /** 0 el titular y su pagina, 1 los niveles finos. */
  kind: number
  run: Generator<void, void, unknown>
}

/**
 * Titular y pagina de una zona, de una vez (unos 10-30 ms). Con el titular dibujado, el texto real se
 * vuelve transparente (data-drawn, ver .dotted en globals.css); sin el, se sigue viendo.
 */
function* prepareHeadline(work: ZoneWork, canvas: DOMRect, wide: boolean): Generator<void, void, unknown> {
  const title = stage.titles[work.frame.zone + 1]
  const headline = title ? buildHeadline(work.frame, title, canvas, work.axes, wide) : null
  placePage(work, canvas.width, headline, wide)
  work.headline = headline
  work.lit?.dispose()
  work.lit = headline ? cellGeometry(headline.cells, headline.count) : null
  if (title) {
    if (headline) title.dataset.drawn = ''
    else delete title.dataset.drawn
  }
}

/** Niveles finos de una zona, a trozos (el ultimo, a la medida de la pantalla y de la pagina). */
function* preparePatches(work: ZoneWork, canvas: DOMRect, wide: boolean): Generator<void, void, unknown> {
  const headline = work.headline
  const side = wide ? 40 : 32
  // El hilo fino que rodea la pagina: lo justo para cubrir la pantalla desde que se ve (con la tarjeta a media pagina).
  const fine = (0.5 * work.page * work.frame.unit[LEVELS - 1]) / work.frame.unit[2]
  const hx = headline?.at[0] ?? canvas.width / 2
  const hy = headline?.at[1] ?? canvas.height / 2
  const sx = Math.min(150, Math.ceil(Math.max(hx, canvas.width - hx) / fine) + 3)
  const sy = Math.min(150, Math.ceil(Math.max(hy, canvas.height - hy) / fine) + 3)
  const reach = work.axes.right[0] !== 0 ? [sx, sy] : [sy, sx]
  for (let level = 1; level < LEVELS; level++) {
    const [hw, hh] = level === LEVELS - 1 ? reach : [side, side]
    const key = `${hw}x${hh}:${wide}:${work.kinds.join('')}`
    if (work.patchKeys[level] === key && work.patches[level]) continue
    const build = buildPatch(work.frame, level, hw, hh, work.axes, wide, work.kinds)
    let step = build.next()
    while (!step.done) {
      yield
      step = build.next()
    }
    work.patches[level]?.dispose()
    work.patches[level] = cellGeometry(step.value.cells, step.value.count)
    work.patchKeys[level] = key
    work.patchSizes[level] = [hw, hh]
    yield
  }
}

/** Si a una zona le falta algun nivel fino. */
function missingPatch(work: ZoneWork) {
  for (let k = 1; k < LEVELS; k++) if (!work.patches[k]) return true
  return false
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
    data(el: Maybe, key: 'on' | 'side' | 'quiet', value: string) {
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
  sky: { current: { fade: number } }
  quality: Quality
  /** La resolucion ya esta al minimo: no hace falta seguir midiendo. */
  slowed: boolean
  /** Si el lienzo esta a la vista (fuera, no se pinta). */
  onScreen: boolean
}

function Thread({ progress, reduceMotion, palette, wide, sky, quality, slowed, onScreen }: ThreadProps) {
  const { size, gl, camera, scene } = useThree()
  const invalidate = useThree((state) => state.invalidate)
  const viewportDpr = useThree((state) => state.viewport.dpr)
  const cam = camera as THREE.PerspectiveCamera
  const frames = useMemo(() => buildFrames(), [])
  const zones = useMemo<ZoneWork[]>(
    () =>
      frames.map((frame) => {
        const matrices = frame.centers.map((c, k) =>
          new THREE.Matrix4()
            .makeBasis(
              frame.axisI.clone().multiplyScalar(frame.unit[k]),
              frame.axisJ.clone().multiplyScalar(frame.unit[k]),
              frame.normal.clone().multiplyScalar(frame.unit[k])
            )
            .setPosition(c)
        )
        const work: ZoneWork = {
          frame,
          axes: SCREEN,
          anchor: [NaN, NaN],
          matrices,
          patches: [null, null, null, null],
          patchKeys: ['', '', '', ''],
          patchSizes: [
            [1, 1],
            [1, 1],
            [1, 1],
            [1, 1],
          ],
          headline: null,
          lit: null,
          dim: null,
          page: 1,
          pxUnit: 1,
          lineMatrix: new THREE.Matrix4(),
          rows: new THREE.Vector4(),
          dots: 0.003,
          kinds: [],
        }
        placePage(work, 1440, null, true)
        return work
      }),
    [frames]
  )
  useEffect(
    () => () =>
      zones.forEach((z) => {
        z.patches.forEach((g) => g?.dispose())
        z.lit?.dispose()
        z.patches = [null, null, null, null]
        z.patchKeys = ['', '', '', '']
        z.lit = null
      }),
    [zones]
  )

  const brain = useMemo(() => brainGeometry(), [])
  useEffect(() => () => brain.dispose(), [brain])
  const materials = useMemo(() => Array.from({ length: LEVELS }, (_, k) => threadMaterial(palette, k)), [palette])
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])
  const textMaterial = useMemo(() => headlineMaterial(palette), [palette])
  useEffect(() => () => textMaterial.dispose(), [textMaterial])
  const meshes = useRef<(THREE.Mesh | null)[]>([])
  const textMesh = useRef<THREE.Mesh>(null)

  const pose = useMemo<Pose>(() => ({ zone: 0, from: -1, mix: 0, hero: 1, down: 0, up: -1, docs: false, dive: 0 }), [])
  /** Scroll suavizado (en escenas): la camara no salta con cada golpe de rueda ni pasa de MAX_SPEED. */
  const smooth = useRef(-1)
  /**
   * Relojes en segundos de performance.now (el de R3F vuelve a cero cada vez que el lienzo sale de la
   * vista y vuelve): el ultimo fotograma, el ultimo salto grande (que no se recorre: la escena aparece
   * con un fundido) y cuando empezo el pulso.
   */
  const last = useRef(0)
  const cut = useRef(-Infinity)
  const pulseStart = useRef(-1)
  // Al volver a la vista, ningun fundido de un salto anterior se queda a medias.
  useEffect(() => void (onScreen && (cut.current = -Infinity)), [onScreen])
  /** Si el fotograma anterior pidio otro (si no, el tiempo hasta este fue un rato quieto, no un fotograma lento). */
  const continued = useRef(false)
  /** La vista del simbolo entero (se recalcula al cambiar la pantalla). */
  const overview = useRef<Overview | null>(null)
  useEffect(() => void (overview.current = null), [size.width, size.height, wide])
  /**
   * Fundidos en el tiempo (nunca se quedan a medias): el texto de cada escena (la parada que se lee,
   * con margen para no parpadear en el borde), la penumbra detras y los nombres de carpetas y
   * documentos ([zona][0 carpetas, 1 documentos][nombre], 8 por grupo). Sin animaciones, ademas, la
   * vista quieta que se ve, la que toca y cuanto se ve (dip).
   */
  const fades = useMemo(
    () => ({ reading: -1, lead: 0, text: new Float64Array(SCENE_COUNT), dim: 0, names: new Float64Array(ZONE_COUNT * 16), shown: -1, wanted: -1, dip: 1 }),
    []
  )
  /** Portada: cajas del titulo y de su texto (en penumbra) y, en el movil, donde empieza el titulo. */
  const hero = useRef<{ title: number[] | null; text: number[] | null; top: number }>({ title: null, text: null, top: 0 })
  /** Ancho de cada etiqueta en px, para que no se salga de la pantalla. */
  const widths = useMemo(() => new Map<HTMLElement, number>(), [])
  const dom = useMemo(() => domWriter(), [])

  // Preparacion de las zonas a trozos, en los ratos libres del navegador: primero los titulares de
  // todas (lo que se lee) y luego los niveles finos, empezando por la zona en la que esta la camara.
  // Se rehace al cambiar el tamano (los titulares y el ultimo nivel van a su medida).
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
    widths.clear()
    for (const el of [...stage.zoneLabels, ...stage.folders.flat(), ...stage.files.flat()]) {
      if (el) widths.set(el, (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0)
    }
    const headlines: Task[] = []
    const patches: Task[] = []
    for (const work of zones) {
      const zone = work.frame.zone
      const zoneBlock = stage.blocks[zone + 1]
      work.dim = zoneBlock ? textBox(Array.from(zoneBlock.children), canvas) : null
      const title = stage.titles[zone + 1]?.getBoundingClientRect()
      work.anchor = title?.width ? [title.left + title.width / 2 - canvas.left, title.top + title.height / 2 - canvas.top] : [NaN, NaN]
      work.kinds = (stage.files[zone] ?? []).map((el) => fileKind(el?.textContent ?? ''))
      headlines.push({ zone, kind: 0, run: prepareHeadline(work, canvas, wide) })
      patches.push({ zone, kind: 1, run: preparePatches(work, canvas, wide) })
    }
    queue.current = [...headlines, ...patches]
    overview.current = null
    scheduler.current.kick()
  }, [fontsReady, size.width, size.height, wide, zones, gl, widths])
  useEffect(() => {
    let alive = true
    let pending = false
    let cancel = () => {}
    const score = (task: Task) => task.kind * 10 + Math.abs(task.zone - pose.zone)
    const run = (deadline: IdleDeadline | null) => {
      pending = false
      const end = performance.now() + Math.max(5, Math.min(12, deadline?.timeRemaining() ?? 8))
      let done = false
      while (alive && queue.current.length && performance.now() < end) {
        let best = 0
        for (let q = 1; q < queue.current.length; q++) if (score(queue.current[q]) < score(queue.current[best])) best = q
        if (queue.current[best].run.next().done) queue.current.splice(best, 1)
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
  /** Termina ya lo pendiente de una zona (hasta el tipo de trabajo dado). */
  const flush = (zone: number, kind: number) => {
    for (let q = 0; q < queue.current.length; q++) {
      const task = queue.current[q]
      if (task.zone !== zone || task.kind > kind) continue
      let step = task.run.next()
      while (!step.done) step = task.run.next()
      queue.current.splice(q--, 1)
    }
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
  // navegador puede) y despues se pintan todas las mallas un par de fotogramas sin que se vea nada.
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
  }, [gl, scene, camera, materials, textMaterial, invalidate])

  // Resolucion: mientras se lee en un movil sube; si los fotogramas van lentos un buen rato, baja.
  const reading = useRef(false)
  const perf = useRef({ time: 0, frames: 0, strikes: 0 })

  // Celdas con nombre de cada zona, en celdas de su rejilla: [zona][0 carpetas, 1 documentos][nombre];
  // y, por zona, la direccion de "abajo" en pantalla al llegar (alli va el nombre de cada documento).
  const named = useMemo(() => zones.map((z) => [1, 2].map((level) => namedCells(wide, level).map(([a, b]) => toGrid(z.axes, a, b)))), [zones, wide])
  const downs = useMemo(() => zones.map((z) => toGrid(z.axes, 0, -1)), [zones])
  const outline = useMemo(() => outlinePoints(), [])
  const levels = useMemo(
    () => ({ px: new Float64Array(LEVELS), alpha: new Float64Array(LEVELS), lens: new Float64Array(LEVELS), at: new Float64Array(2), middle: new Float64Array(2) }),
    []
  )
  const tmp = useMemo(
    () => ({
      focus: new THREE.Vector3(),
      look: new THREE.Vector3(),
      v: new THREE.Vector3(),
      anchor: [0, 0] as [number, number],
    }),
    []
  )

  useFrame(() => {
    const now = performance.now() / 1000
    // Tiempo desde el fotograma anterior; tras un rato quieto, el primer paso no cuenta todo ese rato.
    const dt = continued.current ? Math.min(Math.max(now - last.current, 0), 0.25) : 1 / 60
    last.current = now
    if (pulseStart.current < 0) pulseStart.current = now
    const goal = sceneAt(progress.get(), SCENE_COUNT - 1)
    const first = smooth.current < 0
    // Scroll suavizado y nunca mas deprisa que MAX_SPEED (ni con la barra espaciadora, ni con un golpe de
    // dedo). Un salto grande (el indice, la barra de scroll) no se recorre: la escena aparece ya en su
    // sitio con un fundido.
    if (first || reduceMotion) smooth.current = goal
    else if (Math.abs(goal - smooth.current) > JUMP) {
      smooth.current = goal
      cut.current = now
    } else {
      const step = THREE.MathUtils.damp(smooth.current, goal, 8, dt) - smooth.current
      smooth.current += clampTo(step, -MAX_SPEED * dt, MAX_SPEED * dt)
    }
    if (Math.abs(smooth.current - goal) < 2e-4) smooth.current = goal
    const s = smooth.current
    // Tras un salto (o al empezar), los fundidos no se recorren: todo aparece ya como toca.
    const jumped = first || cut.current === now
    let fade = ramp(0, CUT_FADE, now - cut.current)

    // Que se ve y que texto se lee. Sin animaciones, la vista quieta del tramo, con un fundido al cambiar.
    if (reduceMotion) {
      const x = 4 * s + 1
      if (fades.wanted < 0 || x < fades.wanted - 0.08 || x >= viewEnd(fades.wanted) + 0.08) fades.wanted = stillView(x)
      if (fades.shown < 0 || first) {
        fades.shown = fades.wanted
        fades.dip = 1
      } else if (fades.shown !== fades.wanted) {
        fades.dip = Math.max(0, fades.dip - dt / DIP_OUT)
        if (fades.dip === 0) fades.shown = fades.wanted
      } else fades.dip = Math.min(1, fades.dip + dt / DIP_IN)
      stillPose(fades.shown, pose)
      fade *= fades.dip
      fades.reading = fades.shown % 4 === 0 && fades.shown === fades.wanted && fades.dip > 0.95 ? fades.shown / 4 : -1
    } else {
      journey(s, pose)
      const near = Math.round(s)
      fades.reading = Math.abs(s - near) < (fades.reading === near ? TEXT_HIDE : TEXT_SHOW) ? near : -1
    }
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

    const work = zones[pose.zone]
    const frame = work.frame
    stage.live = true
    // Fotogramas lentos (menos de unos 26 por segundo; con ahorro de bateria algunos navegadores se quedan
    // en 30 y eso no cuenta) dos ratos seguidos: un paso menos de resolucion. Solo cuentan los que siguen
    // a otro (el primero tras un rato quieto no dice nada de la tarjeta grafica).
    if (!reduceMotion && !slowed && continued.current && dt < 0.25 && now > 3) {
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
    const deep = LEVELS - 1
    overview.current ??= overviewOf(zones, outline, W, H, wide)
    const over = overview.current
    const above = over.above[pose.zone]
    const [hx, hy] = anchorOf(work, W, H, tmp.anchor)
    const bottom = work.pxUnit * pxk

    // Cuanto se ha bajado, en escala logaritmica (0 con el simbolo entero, 1 en la pagina): las dos
    // paradas de la bajada (con los nombres de las carpetas y con los de los documentos a la vista) y
    // donde aparece el simbolo al subir.
    const range = Math.log(above / bottom)
    const folders = clampTo(Math.log(above / heightFor(frame, 1, PAUSE_PX[0], pxk)) / range, 0.12, 0.6)
    const files = clampTo(Math.log(above / heightFor(frame, 2, PAUSE_PX[1], pxk)) / range, folders + 0.12, 0.92)
    const brainAt = clampTo(Math.log(above / heightFor(frame, 0, RISE_PX, pxk)) / range, 0, 0.5)
    const rising = pose.up >= 0
    if (pose.docs) pose.dive = files
    else if (rising) pose.dive = rise(pose.up, Math.log(RISE_BACK) / range, brainAt)
    else pose.dive = pose.down > 0 ? descent(pose.down, folders, files) : 0
    const dive = pose.dive
    // Si la camara baja a una zona que aun no esta preparada (al cargar a media pagina o saltando
    // desde el indice), se termina ahora: mejor un tiron que una pantalla vacia (y su titular dice
    // donde acaba la bajada).
    if (dive > 0 && !work.lit) flush(pose.zone, 0)
    if (dive > 0.03 && missingPatch(work)) flush(pose.zone, 1)

    // Portada en el movil (en vertical): el simbolo arriba, entre la barra y el titulo, que va abajo.
    const portrait = !wide && H > W && hero.current.top > 0
    const heroTop = 72
    const heroBottom = hero.current.top + 24
    const heroDistance = portrait ? fitDistance(W / H, (heroBottom - heroTop) / H, 0.9) : fitDistance(W / H, 0.74, 0.86)

    // Camara: siempre con la orientacion de la portada (nada gira). Solo cambia el punto que se mira
    // (focus), donde cae en pantalla (sx, sy) y a que distancia. Desde la portada, el centro del cerebro
    // pasa de su sitio en la portada al de la vista del simbolo entero. Al bajar y al subir, el documento
    // objetivo de la zona: al empezar a bajar, la zona se desliza hasta el centro de su titular (ya esta
    // alli en la parada de las carpetas) mientras crece, y despues la camara baja en linea recta hacia el.
    let height = above
    let sx = hx
    let sy = hy
    if (pose.hero > 0) {
      const t = 1 - pose.hero
      tmp.focus.copy(CENTER)
      sx = lerp(W / 2, over.at[0], t)
      sy = lerp(portrait ? (heroTop + heroBottom) / 2 : H / 2, over.at[1], t)
      height = Math.exp(lerp(Math.log(heroDistance), Math.log(over.height), t))
    } else {
      const drift = ramp(0, folders, dive)
      tmp.focus.copy(frame.centers[2])
      sx = lerp(over.points[pose.zone][0], hx, drift)
      sy = lerp(over.points[pose.zone][1], hy, drift)
      height = Math.exp(lerp(Math.log(above), Math.log(bottom), dive))
    }
    cam.position
      .copy(tmp.focus)
      .addScaledVector(VIEW.dir, height)
      .addScaledVector(VIEW.right, ((W / 2 - sx) / pxk) * height)
      .addScaledVector(VIEW.up, ((sy - H / 2) / pxk) * height)
    cam.up.copy(VIEW.up)
    cam.lookAt(tmp.look.copy(cam.position).sub(VIEW.dir))
    cam.near = Math.max(1e-6, height * 0.02)
    cam.far = 200
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    // Tras un salto (o sin animaciones, al cambiar de vista), toda la escena se funde.
    dom.opacity(gl.domElement, fade)

    // Leyendo un titular en un movil de mucha densidad, a mas resolucion (la escena esta quieta).
    const sharp = !wide && fades.reading > 0 && window.devicePixelRatio > 1.5
    if (sharp !== reading.current) {
      reading.current = sharp
      quality.onReading(sharp)
    }
    // Penumbra detras del texto que se esta leyendo y, dentro de una zona, bajo la ruta, la lectura en
    // vivo y el indice.
    const onHero = fades.lead === 0
    const box = onHero ? hero.current.title : zones[Math.max(0, fades.lead - 1)].dim
    const dimAmt = (onHero ? Math.min(0.92, palette.heroDim + (wide ? 0 : 0.06)) : 0.78) * fades.dim
    const box2 = onHero ? hero.current.text : null
    const edgeAmt = 0.88 * ramp(0, 0.1, dive)
    // El pulso: una pasada que entra y sale con suavidad y se queda quieta. Solo se pinta mientras se ve el simbolo.
    const pass = (now - pulseStart.current) * PULSE_SPEED
    const pulse = reduceMotion ? 0 : PULSE_AMOUNT * ramp(0, 0.04, pass) * (1 - ramp(0.92, 1, pass))
    let pulseSeen = false

    // Niveles: cada uno se ve mientras sus celdas tienen un tamano util y, los finos, solo dentro de la
    // lente; uno detras de otro, sin dos tramas finas a la vez. Los documentos no se apagan al acercarse:
    // la tarjeta objetivo crece hasta ser la pagina. Al subir, los finos se apagan enseguida y el cerebro
    // aparece al final.
    const { px, alpha, lens } = levels
    px.fill(0)
    alpha.fill(0)
    lens.fill(9)
    const at = levels.at
    const middle = levels.middle
    for (let k = 0; k < LEVELS; k++) {
      const mesh = meshes.current[k]
      if (!mesh) continue
      const uniforms = materials[k].uniforms
      const st = LEVEL_STYLE[k]
      if (k === 0) {
        px[0] = (frame.unit[0] * pxk) / Math.max(1e-6, cam.position.distanceTo(frame.surface))
        alpha[0] = (1 - ramp(110, 280, px[0])) * (rising ? riseBrain(pose.up) : 1)
        // La zona a la que se va se enciende (como su etiqueta); con el simbolo entero, la luz pasa de una a
        // otra. En la portada aun no hay luz.
        uniforms.uZone.value = frame.zone
        uniforms.uZoneFrom.value = zones[pose.from < 0 ? pose.zone : pose.from].frame.zone
        uniforms.uZoneMix.value = pose.from < 0 ? 1 : pose.mix
        uniforms.uZoneAmt.value = Math.max(LIT * (pose.from < 0 ? pose.mix : 1), ramp(0.02, 0.15, dive))
        uniforms.uTarget.value = frame.index0
        uniforms.uLockOn.value = ramp(10, 22, px[0])
        pulseSeen = pulse > 0 && alpha[0] > 0.05 && dive < 0.3
      } else {
        const geometry = work.patches[k]
        const dist = tmp.v.subVectors(cam.position, frame.centers[k]).dot(frame.normal)
        px[k] = dist > 0 ? (frame.unit[k] * pxk) / dist : 1e6
        if (geometry && dive > 0 && dist > 0) {
          // Las carpetas, cuando el cerebro ya se va; los documentos, cuando sus tarjetas ya se leen; el
          // hilo fino que rodea la pagina es solo contexto: tenue, y cuando los otros documentos ya se han ido.
          if (k === 1) alpha[k] = ramp(14, 26, px[1]) * (1 - ramp(220, 480, px[1]))
          else if (k === 2) alpha[k] = ramp(48, 80, px[2])
          else alpha[k] = 0.45 * ramp(0.75 * work.page, 0.97 * work.page, px[2])
          if (rising) alpha[k] *= riseFine(pose.up)
        }
        lens[k] = k === deep ? 1.7 : k === 1 ? lerp(0.3, 0.6, ramp(14, 48, px[1])) : lerp(0.16, 0.75, ramp(9, 48, px[2]))
        if (geometry && mesh.geometry !== geometry) mesh.geometry = geometry
        mesh.matrix.copy(work.matrices[k])
        const centered = project(frame.centers[k], cam, W, H, middle)
        uniforms.uLensAt.value.set(middle[0] * dpr, (H - middle[1]) * dpr)
        uniforms.uLens.value = lens[k]
        uniforms.uPatch.value.set(work.patchSizes[k][0], work.patchSizes[k][1])
        uniforms.uFolderOn.value = k === 1 ? ramp(14, 28, px[k]) * (1 - ramp(150, 300, px[k])) : 0
        uniforms.uCardOn.value = k === 2 ? ramp(16, 32, px[k]) : 0
        uniforms.uLockOn.value = k < deep ? ramp(12, 26, px[k]) : 0
        if (k === 2) {
          uniforms.uPage.value = ramp(0.22 * work.page, 0.55 * work.page, px[2])
          uniforms.uPageRows.value.copy(work.rows)
          uniforms.uPageDot.value = work.dots
        }
        if (k === deep) {
          // El hilo fino se queda fuera de la pagina (dentro va la rejilla de puntos del titular).
          const inPage = project(frame.centers[2], cam, W, H, at)
          const halfW = CARD.half * px[2] + 3
          const halfH = CARD.tall * px[2] + 3
          uniforms.uQuiet.value.set((at[0] - halfW) * dpr, (H - at[1] - halfH) * dpr, (at[0] + halfW) * dpr, (H - at[1] + halfH) * dpr)
          uniforms.uQuietAmt.value = centered && inPage ? 1 : 0
        }
      }
      mesh.visible = alpha[k] > 0.003
      if (!mesh.visible) continue
      const big = ramp(6, 16, px[k])
      uniforms.uAlpha.value = alpha[k]
      uniforms.uMaxCell.value = k === 2 ? 1e6 : 1200 * dpr
      uniforms.uRes.value.set(W * dpr, H * dpr)
      uniforms.uDpr.value = dpr
      uniforms.uLineW.value = st.lineW * dpr
      uniforms.uGlow.value = st.glow * dpr
      uniforms.uDotR.value = st.dot * dpr * (0.35 + 0.65 * big)
      uniforms.uGlowAmt.value = st.glowAmt * palette.glowScale * (0.25 + 0.75 * big)
      uniforms.uCore.value = st.core
      uniforms.uDots.value = k === deep ? 0.55 : 1
      uniforms.uTime.value = now - pulseStart.current
      uniforms.uPulse.value = k === 0 && pulseSeen ? pulse : 0
      if (box) uniforms.uDim.value.set(box[0] * dpr, (H - box[3]) * dpr, box[2] * dpr, (H - box[1]) * dpr)
      uniforms.uDimAmt.value = box ? dimAmt : 0
      if (box2) uniforms.uDim2.value.set(box2[0] * dpr, (H - box2[3]) * dpr, box2[2] * dpr, (H - box2[1]) * dpr)
      uniforms.uDimAmt2.value = box2 ? palette.heroTextDim * fades.dim : 0
      uniforms.uEdge.value.set((H - 112) * dpr, 72 * dpr, wide ? (W - 210) * dpr : 1e6, 140 * dpr)
      uniforms.uEdgeAmt.value = edgeAmt
    }

    // El titular, dibujado por el hilo en la pagina cuando la camara ya ha llegado: aparece y se va con
    // un fundido corto, con la camara quieta.
    const line = textMesh.current
    const lineFade = fades.text[pose.zone + 1]
    if (line) {
      line.visible = lineFade > 0.001 && !!work.lit
      if (line.visible && work.lit) {
        if (line.geometry !== work.lit) line.geometry = work.lit
        line.matrix.copy(work.lineMatrix)
        const uniforms = textMaterial.uniforms
        uniforms.uFade.value = lineFade
        uniforms.uRes.value.set(W * dpr, H * dpr)
        uniforms.uDpr.value = dpr
      }
    }
    // El cielo se pinta antes que el hilo: si cambia, hace falta un fotograma mas para que lo recoja.
    // Se apaga al bajar a una zona y, al subir, vuelve mientras aparece el simbolo.
    const skyFade = rising ? ramp(0.25, 0.7, pose.up) : 1 - ramp(0.12, 0.4, dive)
    const skyChanged = Math.abs(skyFade - sky.current.fade) > 1e-4
    sky.current.fade = skyFade

    // Texto de cada escena: la portada al principio; el de cada zona, con su titular. Ocultos siguen en
    // el arbol de accesibilidad: solo dejan de recibir clics y sus enlaces salen del tabulador.
    for (let k = 0; k < SCENE_COUNT; k++) {
      const shown = fades.text[k] * fade
      dom.opacity(stage.blocks[k], shown)
      dom.still(stage.blocks[k], shown < 0.5)
      dom.inert(stage.actions[k], shown < 0.5)
    }

    // La ruta hasta la informacion, fija y entera, mientras se esta dentro de una zona. Mientras se lee
    // un titular, el indice de la derecha se queda en numeros si no hay sitio (para no pisarlo) y el
    // aviso de scroll se va.
    const path = ramp(0.04, 0.12, dive) * fade
    for (let z = 0; z < stage.crumbs.length; z++) dom.opacity(stage.crumbs[z], z === pose.zone ? path : 0)
    dom.opacity(stage.hint, 1 - ramp(0.1, 0.2, s))
    dom.data(stage.nav, 'quiet', lead >= 0 ? '1' : '0')

    // Etiquetas de las zonas alrededor del simbolo, siempre por fuera de su silueta en pantalla (una
    // elipse con la caja de su contorno proyectado). En el movil, solo la de la zona a la que se va,
    // encima o debajo del simbolo (en horizontal, a un lado).
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
    const away = (1 - ramp(0, 0.06, dive)) * (rising ? riseBrain(pose.up) : 1)
    const sideways = wide || (H < 500 && W > H)
    for (let z = 0; z < ZONE_COUNT; z++) {
      const el = stage.zoneLabels[z]
      // Cuanto es esta la zona a la que se va (con el simbolo entero, pasa de la que se deja a la siguiente).
      const on = (z === pose.zone ? pose.mix : 0) + (z === pose.from ? 1 - pose.mix : 0)
      const seen = (wide || on > 0.01) && away > 0.01 && project(frames[z].label, cam, W, H, at)
      const shown = wide ? lerp(0.5 + 0.5 * on, 0.85, pose.hero) : on * (1 - pose.hero)
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
        side = 'below'
        x = clampTo(ex + dx * 0.3, 16 + width / 2, W - 16 - width / 2)
        y = clampTo(dy > 0 ? ey + eb + 18 : ey - eb - 34, 96, H - 96)
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

    // Al bajar, los nombres de las carpetas (junto a su icono) y de los documentos (debajo de su tarjeta):
    // enteros o nada. Aparecen y se van con un fundido corto mientras sus celdas miden lo justo para
    // leerlos, su nivel se ve entero y estan dentro de la lente; la bajada se para con ellos a la vista.
    for (let q = 0; q < 2; q++) {
      const k = q + 1
      const sets = q === 0 ? stage.folders : stage.files
      const readable = alpha[k] > 0.6 && (q === 0 ? px[1] > 30 && px[1] < 170 : px[2] > 52 && px[2] < 230)
      const centered = project(frame.centers[k], cam, W, H, middle)
      const down = downs[pose.zone]
      for (let z = 0; z < sets.length; z++) {
        const items = sets[z]
        for (let n = 0; n < items.length && n < 8; n++) {
          const el = items[n]
          const cell = named[z]?.[q]?.[n]
          const slot = (z * 2 + q) * 8 + n
          let placed = false
          let target = 0
          if (z === pose.zone && centered && cell && el) {
            const lift = q === 0 ? 0 : 0.43
            tmp.v
              .copy(frame.centers[k])
              .addScaledVector(frame.axisI, (cell[0] + lift * down[0]) * frame.unit[k])
              .addScaledVector(frame.axisJ, (cell[1] + lift * down[1]) * frame.unit[k])
            placed = project(tmp.v, cam, W, H, at)
            if (placed && readable && Math.hypot(at[0] - middle[0], at[1] - middle[1]) / Math.min(W, H) < lens[k] + 0.05) target = 1
          }
          const a = (fades.names[slot] = jumped ? target : approach(fades.names[slot], target, dt / NAME_FADE))
          if (a !== target) fading = true
          dom.opacity(el, placed ? a * fade : 0)
          if (!placed || !a || !el) continue
          const width = widths.get(el) ?? 120
          let x = at[0]
          let side = 'below'
          if (q === 0) {
            // Al lado del icono, hacia donde quepa.
            const gap = 0.24 * px[k]
            side = at[0] + gap + 12 + width > W - 16 ? 'left' : 'right'
            x = side === 'left' ? clampTo(at[0] - gap, 16 + width + 12, W - 16) : clampTo(at[0] + gap, 16, W - 28 - width)
          } else {
            x = clampTo(at[0], 16 + width / 2, W - 16 - width / 2)
          }
          dom.move(el, x, at[1] + (q === 0 ? 0 : 3))
          dom.data(el, 'side', side)
        }
      }
    }

    // Solo se pide otro fotograma mientras algo se mueve: la camara que aun no ha llegado, el fundido de
    // un salto o de un cambio de vista, un fundido de texto o de nombres, el pulso (mientras dura y se ve)
    // o el cielo, que lo recoge en el siguiente.
    const dipping = reduceMotion && (fades.shown !== fades.wanted || fades.dip < 1)
    const moving = s !== goal || now - cut.current < CUT_FADE || fading || dipping || pulseSeen || skyChanged
    continued.current = moving
    if (moving) invalidate()

    // Al arrancar, las mallas que aun no se ven se pintan igual (sin que se vea nada) para compilar ya sus shaders.
    if (warm.current > 0) {
      warm.current--
      for (let k = 1; k < LEVELS; k++) {
        const mesh = meshes.current[k]
        if (!mesh || mesh.visible) continue
        if (!mesh.geometry.getAttribute('aCell')) mesh.geometry = placeholder
        materials[k].uniforms.uAlpha.value = 0
        mesh.visible = true
      }
      if (line && !line.visible) {
        line.geometry = work.lit ?? placeholder
        textMaterial.uniforms.uFade.value = 0
        line.visible = true
      }
      invalidate()
    }
  })

  return (
    <>
      {materials.map((material, k) => (
        <mesh
          key={k}
          ref={(el) => void (meshes.current[k] = el)}
          material={material}
          frustumCulled={false}
          matrixAutoUpdate={k === 0}
          renderOrder={k}
          {...(k === 0 ? { geometry: brain } : {})}
        />
      ))}
      <mesh ref={textMesh} material={textMaterial} frustumCulled={false} matrixAutoUpdate={false} renderOrder={LEVELS} visible={false} />
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
