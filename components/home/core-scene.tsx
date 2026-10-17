"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { MotionValue } from 'motion/react'
import { stage } from '@/components/home/stage'
import {
  CARD,
  CENTER,
  LEVELS,
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
// (ver thread.ts). La camara viaja por fuera, por encima del simbolo y siempre con la cisura en
// vertical, y en cada escena baja a una zona como en un microscopio, nivel a nivel: la zona, sus
// carpetas y sus documentos; al fondo, uno de ellos crece hasta ser una pagina y el propio hilo
// escribe el titular en sus renglones, encima del titular real.
// Escenas: 0 portada, 1 local, 2 historial, 3 equipo, 4 documentos, 5 carpetas, 6 tareas (la zona
// de la escena k es la k - 1 del hilo).
//
// Unidades: el cerebro mide unos 2 de ancho (x) y 2,3 de largo (y); la boveda sube en z.

const SCENE_COUNT = 7
const FOV = 40
const TAN = Math.tan(THREE.MathUtils.degToRad(FOV / 2))
/** Portada: desde delante y casi desde arriba, para que se lea el simbolo. */
const HERO = { azimuth: -Math.PI / 2, elevation: THREE.MathUtils.degToRad(74) }
/** Entre zonas, por fuera: alto para que mande la vista de arriba y lo bastante bajo para ver la boveda. */
const OUTSIDE = THREE.MathUtils.degToRad(63)
/**
 * Tramos de cada escena, en pantallas de scroll desde la parada anterior: se acaba de leer, el hilo
 * borra el titular y se sube, se da la vuelta por fuera hasta la zona siguiente, se baja, el hilo
 * escribe el titular y se empieza a leer. La lectura (2 x READ) queda centrada en cada parada.
 */
const READ = 0.1
const UNWRITE = 0.16
const RISE = 0.37
const ARC = 0.57
const DIVE = 0.9
const WRITE_FROM = 0.81
const WRITE_TO = 1 - READ
/** La portada se queda quieta hasta aqui y luego sale hacia la primera zona. */
const HERO_HOLD = 0.1

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
    flash: rgb('#0463FE'),
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
    flash: rgb('#7FE8FF'),
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
  /** Idioma de la pagina, para escribir el aumento (x1,8 mil o x1.8K). */
  locale: string
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
  // Fuera de la vista no se pinta; sin animaciones, solo cuando cambia algo (el scroll o el tamano).
  const frameloop = onScreen ? (props.reduceMotion ? 'demand' : 'always') : 'never'
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
      <Sky palette={palette} reduceMotion={props.reduceMotion} fade={sky} wide={wide} />
      <Thread {...props} palette={palette} wide={wide} sky={sky} quality={quality} slowed={top <= 1} />
    </Canvas>
  )
}

// ---------------------------------------------------------------- el espacio

const SKY_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uRatio;
  varying float vAlpha;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.6 + aSeed * 1.8) + aSeed * 40.0);
    gl_PointSize = aSize * uRatio * (0.7 + 0.3 * twinkle);
    vAlpha = twinkle;
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

/** Estrellas de fondo y nebulosas bajo el cerebro: dan profundidad y se apagan al bajar a una zona. */
function Sky({ palette, reduceMotion, fade, wide }: { palette: Palette; reduceMotion: boolean; fade: { current: { fade: number } }; wide: boolean }) {
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
          uTime: { value: 0 },
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

  useFrame((state) => {
    starMaterial.uniforms.uTime.value = reduceMotion ? 0 : state.clock.elapsedTime
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

/** Donde esta la camara: la zona, cuanto se ha bajado en ella (0 fuera, 1 en la pagina) y desde donde se mira por fuera. */
interface Pose {
  zone: number
  dive: number
  /** Cuanto del titular esta escrito (0 nada, 1 entero). */
  write: number
  azimuth: number
  elevation: number
  /** 1 en la portada, 0 en cuanto se sale de ella. */
  hero: number
  /** Cuanto se ha avanzado en la vuelta por fuera hacia la zona (para encenderla un poco). */
  arc: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
/** Angulo intermedio por el camino corto. */
const lerpAngle = (a: number, b: number, t: number) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t
/** Paso suave con pendiente cero en los extremos. */
const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10)
/** Bajada y subida: el aumento repartido casi por igual (en escala logaritmica), con arranque y llegada suaves. */
const zoomEase = (u: number) => 0.45 * u + 0.55 * smoother(u)

/** Pose de la camara segun el scroll (s de 0 a 6, en escenas). */
function journey(s: number, frames: ZoneFrame[], out: Pose) {
  const k = Math.min(SCENE_COUNT - 2, Math.max(0, Math.floor(s)))
  const f = s - k
  out.hero = 0
  out.arc = 0
  out.elevation = OUTSIDE
  if (k > 0 && f < RISE) {
    // Lectura, titular que se borra y subida desde la zona de la parada k (la misma bajada, al reves).
    out.zone = k - 1
    out.dive = 1 - clamp01((f - READ) / (RISE - READ))
    out.write = 1 - clamp01((f - READ) / (UNWRITE - READ))
    out.azimuth = frames[k - 1].azimuth
  } else if (f < ARC) {
    // Vuelta por fuera, por encima del simbolo, hasta la zona siguiente (o salida de la portada).
    const from = k === 0 ? HERO_HOLD : RISE
    const t = smoother(clamp01((f - from) / (ARC - from)))
    out.zone = k
    out.dive = 0
    out.write = 0
    out.azimuth = lerpAngle(k === 0 ? HERO.azimuth : frames[k - 1].azimuth, frames[k].azimuth, t)
    out.arc = t
    if (k === 0) {
      out.elevation = lerp(HERO.elevation, OUTSIDE, t)
      out.hero = 1 - t
    }
  } else {
    // Bajada a la zona de la parada k + 1; al llegar, el hilo escribe el titular y se empieza a leer.
    out.zone = k
    out.dive = clamp01((f - ARC) / (DIVE - ARC))
    out.write = clamp01((f - WRITE_FROM) / (WRITE_TO - WRITE_FROM))
    out.azimuth = frames[k].azimuth
    out.arc = 1
  }
  return out
}

/**
 * Distancia a la que se ve el cerebro entero ocupando tall de la altura y across del ancho: en la
 * portada, mas grande; por fuera, con aire para la boveda y las etiquetas.
 */
function fitDistance(aspect: number, hero: boolean, tall: number, across: number) {
  const byHeight = (hero ? 2.45 : 2.5) / tall / (2 * TAN)
  const byWidth = (hero ? 2.1 : 2.4) / across / (2 * TAN * aspect)
  return Math.max(byHeight, byWidth)
}

/** Direccion desde el centro hacia la camara de fuera. */
function outsideDirection(azimuth: number, elevation: number, out: THREE.Vector3) {
  const c = Math.cos(elevation)
  return out.set(c * Math.cos(azimuth), c * Math.sin(azimuth), Math.sin(elevation))
}

/**
 * "Arriba" en pantalla de una camara que mira en la direccion opuesta a dir: el eje largo del
 * cerebro (+y), para que la cisura quede siempre en vertical y el simbolo se vea como el icono.
 */
function upFor(dir: THREE.Vector3, out: THREE.Vector3) {
  return out.set(0, 1, 0).addScaledVector(dir, -dir.y).normalize()
}

/**
 * Al llegar al fondo de una zona se mira de frente a la rejilla. De sus cuatro ejes, se toma como
 * "arriba" el mas parecido al de la camara de fuera: asi la bajada apenas gira.
 */
function finalAxes(frame: ZoneFrame) {
  const dir = outsideDirection(frame.azimuth, OUTSIDE, new THREE.Vector3())
  const up = upFor(dir, new THREE.Vector3())
  up.addScaledVector(frame.normal, -up.dot(frame.normal)).normalize()
  const options: [THREE.Vector3, [number, number]][] = [
    [frame.axisI, [1, 0]],
    [frame.axisJ, [0, 1]],
    [frame.axisI.clone().negate(), [-1, 0]],
    [frame.axisJ.clone().negate(), [0, -1]],
  ]
  let best = options[0]
  for (const o of options) if (o[0].dot(up) > best[0].dot(up)) best = o
  const worldUp = best[0].clone()
  const worldRight = new THREE.Vector3().crossVectors(frame.normal.clone().negate(), worldUp)
  const right: [number, number] = [Math.round(worldRight.dot(frame.axisI)), Math.round(worldRight.dot(frame.axisJ))]
  const axes: ScreenAxes = { right, up: best[1] }
  return { axes, worldUp, worldRight }
}

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
      // Un solo pulso recorre el cerebro entero en 40 s (fase por celda: 1/1024); en los niveles finos,
      // uno cada 8192 celdas, con la cabeza y la cola del mismo largo en celdas.
      uSpeed: { value: level === 0 ? 1 / 40 : 1 / 14 },
      uStep: { value: level === 0 ? 1 / 1024 : 1 / 8192 },
      uHead: { value: level === 0 ? 900 : 7200 },
      uTail: { value: level === 0 ? 100 : 800 },
      uZone: { value: 0 },
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
      uWrite: { value: 0 },
      uLight: { value: palette.light },
      uInk: vec3(palette.ink),
      uFlash: vec3(palette.flash),
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
  up: THREE.Vector3
  right: THREE.Vector3
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
    scaleX(el: Maybe, value: number) {
      const v = Math.round(value * 1000) / 1000
      if (el && changed(el, 'scale', v)) el.style.transform = `scaleX(${v})`
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

const clampTo = (x: number, a: number, b: number) => Math.min(Math.max(x, a), Math.max(a, b))
/** Si una etiqueta (de x0 a x1, centrada en y) pisa una caja de texto (con 8 px de aire). */
const overlaps = (box: number[], x0: number, x1: number, y: number) => x1 > box[0] - 8 && x0 < box[2] + 8 && y + 16 > box[1] && y - 16 < box[3]

/** Aumento redondeado como en un microscopio: 4,5, 240, 1.600 (que se escribe x1,6 mil o x1.6K). */
const roundZoom = (m: number) => (m < 10 ? Math.round(m * 10) / 10 : m < 1000 ? Math.round(m) : Math.round(m / 100) * 100)

// ---------------------------------------------------------------- escena

interface ThreadProps extends CoreSceneProps {
  palette: Palette
  wide: boolean
  sky: { current: { fade: number } }
  quality: Quality
  /** La resolucion ya esta al minimo: no hace falta seguir midiendo. */
  slowed: boolean
}

function Thread({ progress, reduceMotion, locale, palette, wide, sky, quality, slowed }: ThreadProps) {
  const { size, gl, camera, scene } = useThree()
  const invalidate = useThree((state) => state.invalidate)
  const viewportDpr = useThree((state) => state.viewport.dpr)
  const cam = camera as THREE.PerspectiveCamera
  const frames = useMemo(() => buildFrames(), [])
  const zones = useMemo<ZoneWork[]>(
    () =>
      frames.map((frame) => {
        const { axes, worldUp, worldRight } = finalAxes(frame)
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
          axes,
          up: worldUp,
          right: worldRight,
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

  const pose = useMemo<Pose>(() => ({ zone: 0, dive: 0, write: 0, azimuth: HERO.azimuth, elevation: HERO.elevation, hero: 1, arc: 0 }), [])
  /** Scroll suavizado (en escenas): la camara no salta con cada golpe de rueda. */
  const smooth = useRef(-1)
  /** Portada: cajas del titulo y de su texto (en penumbra) y, en el movil, donde empieza el titulo. */
  const hero = useRef<{ title: number[] | null; text: number[] | null; top: number }>({ title: null, text: null, top: 0 })
  /** Ancho de cada etiqueta en px, para que no se salga de la pantalla. */
  const widths = useMemo(() => new Map<HTMLElement, number>(), [])
  const dom = useMemo(() => domWriter(), [])
  // El aumento se escribe en el idioma de la pagina (y se reescribe si cambia).
  const zoomFormat = useMemo(() => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }), [locale])
  const zoomShown = useRef(NaN)
  useEffect(() => void (zoomShown.current = NaN), [zoomFormat])

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
      work.kinds = (stage.files[zone] ?? []).map((el) => fileKind(el?.textContent ?? ''))
      headlines.push({ zone, kind: 0, run: prepareHeadline(work, canvas, wide) })
      patches.push({ zone, kind: 1, run: preparePatches(work, canvas, wide) })
    }
    queue.current = [...headlines, ...patches]
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
      dir: new THREE.Vector3(),
      upOut: new THREE.Vector3(),
      up: new THREE.Vector3(),
      target: new THREE.Vector3(),
      final: new THREE.Vector3(),
      look: new THREE.Vector3(),
      v: new THREE.Vector3(),
    }),
    []
  )

  useFrame((state, delta) => {
    const goal = clamp01(progress.get()) * (SCENE_COUNT - 1)
    smooth.current = smooth.current < 0 || reduceMotion ? goal : THREE.MathUtils.damp(smooth.current, goal, 8, Math.min(delta, 0.25))
    if (Math.abs(smooth.current - goal) < 2e-4) smooth.current = goal
    const s = smooth.current
    journey(s, frames, pose)
    const time = reduceMotion ? 0 : state.clock.elapsedTime
    const work = zones[pose.zone]
    const frame = work.frame
    stage.live = true
    // Si la camara llega a una zona que aun no esta preparada (al cargar a media pagina o saltando
    // desde el indice), se termina ahora: mejor un tiron que una pantalla vacia.
    if (pose.write > 0 && !work.lit) flush(pose.zone, 0)
    if (pose.dive > 0.05 && missingPatch(work)) flush(pose.zone, 1)
    // Fotogramas lentos (menos de unos 26 por segundo; con ahorro de bateria algunos navegadores se quedan
    // en 30 y eso no cuenta) dos ratos seguidos: un paso menos de resolucion.
    if (!reduceMotion && !slowed && delta < 0.25 && state.clock.elapsedTime > 3) {
      const p = perf.current
      p.time += delta
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
    // Por fuera, en el movil solo se ve una etiqueta: el simbolo puede ocupar casi todo el ancho.
    const outside = fitDistance(W / H, false, 0.68, wide ? 0.78 : 0.92)
    const headline = work.headline
    const hx = headline ? headline.at[0] : W / 2
    const hy = headline ? headline.at[1] : H / 2
    const bottom = work.pxUnit * pxk

    // Portada en el movil (en vertical): el simbolo arriba, entre la barra y el titulo, que va abajo.
    const portrait = !wide && H > W && hero.current.top > 0
    const heroTop = 72
    const heroBottom = hero.current.top + 24
    const heroDistance = portrait ? fitDistance(W / H, true, (heroBottom - heroTop) / H, 0.9) : fitDistance(W / H, true, 0.74, 0.86)
    const shift = portrait ? (H / 2 - (heroTop + heroBottom) / 2) * pose.hero : 0

    // Camara: por fuera mira al centro con la cisura en vertical; al bajar, se acerca a la zona y acaba
    // de frente a la rejilla, con el documento objetivo centrado en el titular y del tamano de la pagina.
    const sway = reduceMotion ? 0 : 0.05 * Math.sin(time * 0.21) * (1 - ramp(0, 0.4, pose.dive))
    outsideDirection(pose.azimuth + sway, pose.elevation, tmp.dir)
    upFor(tmp.dir, tmp.upOut)
    const u = zoomEase(pose.dive)
    let height = lerp(outside, heroDistance, pose.hero)
    if (pose.dive <= 0) {
      cam.position.copy(CENTER).addScaledVector(tmp.dir, height)
      cam.up.copy(tmp.upOut)
      cam.lookAt(CENTER)
    } else {
      height = Math.exp(lerp(Math.log(outside), Math.log(bottom), u))
      const targetBlend = ramp(0, 0.33, u)
      const faceBlend = ramp(0.03, 0.42, u)
      tmp.final
        .copy(frame.centers[2])
        .addScaledVector(work.right, (W / 2 - hx) * work.pxUnit)
        .addScaledVector(work.up, (hy - H / 2) * work.pxUnit)
      tmp.target.lerpVectors(CENTER, tmp.final, targetBlend)
      tmp.dir.lerp(frame.normal, faceBlend).normalize()
      tmp.up.copy(tmp.upOut).lerp(work.up, faceBlend).normalize()
      cam.position.copy(tmp.target).addScaledVector(tmp.dir, height)
      cam.up.copy(tmp.up)
      cam.lookAt(tmp.look.copy(cam.position).sub(tmp.dir))
    }
    cam.near = Math.max(1e-6, height * 0.02)
    cam.far = 200
    if (shift > 0.5) cam.setViewOffset(W, H, 0, shift, W, H)
    else if (cam.view?.enabled) cam.clearViewOffset()
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()

    const write = pose.write
    // Leyendo en un movil de mucha densidad, el titular a mas resolucion (la escena esta quieta).
    const sharp = !wide && write > 0.5 && window.devicePixelRatio > 1.5
    if (sharp !== reading.current) {
      reading.current = sharp
      quality.onReading(sharp)
    }
    const heroText = 1 - ramp(0.03, 0.12, s)
    // El texto de apoyo aparece cuando el titular esta casi escrito.
    const blockShown = ramp(0.75, 1, write)
    // Penumbra detras del texto que se esta leyendo y bajo los instrumentos.
    const onHero = heroText > 0.01
    const box = onHero ? hero.current.title : work.dim
    const dimAmt = onHero ? Math.min(0.92, palette.heroDim + (wide ? 0 : 0.06)) * heroText : 0.78 * blockShown
    const box2 = onHero ? hero.current.text : null
    const hudShown = ramp(0.3, 0.42, s)
    const edgeAmt = 0.88 * hudShown * (1 - pose.hero)

    // Niveles: cada uno se ve mientras sus celdas tienen un tamano util y, los finos, solo dentro de la
    // lente. Los documentos no se apagan al acercarse: la tarjeta objetivo crece hasta ser la pagina.
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
        alpha[0] = 1 - ramp(130, 420, px[0])
        uniforms.uZone.value = frame.zone
        // La zona a la que se va se enciende un poco ya en la vuelta por fuera (como su etiqueta).
        uniforms.uZoneAmt.value = Math.max(0.32 * pose.arc * (1 - pose.hero), ramp(0.03, 0.22, pose.dive))
        uniforms.uTarget.value = frame.index0
        uniforms.uLockOn.value = ramp(10, 22, px[0])
      } else {
        const geometry = work.patches[k]
        const dist = tmp.v.subVectors(cam.position, frame.centers[k]).dot(frame.normal)
        px[k] = dist > 0 ? (frame.unit[k] * pxk) / dist : 1e6
        alpha[k] = geometry && pose.dive > 0 && dist > 0 ? ramp(2.6, 6.5, px[k]) : 0
        if (k === 1) alpha[k] *= 1 - ramp(130, 420, px[k])
        // El hilo fino que rodea la pagina es solo contexto: tenue, y cuando los otros documentos ya se han ido.
        if (k === deep) alpha[k] *= 0.45 * ramp(0.4 * work.page, 0.62 * work.page, px[2])
        lens[k] = k === deep ? 1.7 : lerp(0.16, k === 1 ? 0.6 : 0.75, ramp(9, 48, px[k]))
        if (geometry && mesh.geometry !== geometry) mesh.geometry = geometry
        mesh.matrix.copy(work.matrices[k])
        const centered = project(frame.centers[k], cam, W, H, middle)
        uniforms.uLensAt.value.set(middle[0] * dpr, (H - middle[1]) * dpr)
        uniforms.uLens.value = lens[k]
        uniforms.uPatch.value.set(work.patchSizes[k][0], work.patchSizes[k][1])
        uniforms.uFolderOn.value = k === 1 ? ramp(14, 28, px[k]) * (1 - ramp(80, 150, px[k])) : 0
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
      uniforms.uTime.value = time
      uniforms.uPulse.value = reduceMotion ? 0 : k === 0 ? 1 : k === deep ? 0 : 0.35
      if (box) uniforms.uDim.value.set(box[0] * dpr, (H - box[3]) * dpr, box[2] * dpr, (H - box[1]) * dpr)
      uniforms.uDimAmt.value = box ? dimAmt : 0
      if (box2) uniforms.uDim2.value.set(box2[0] * dpr, (H - box2[3]) * dpr, box2[2] * dpr, (H - box2[1]) * dpr)
      uniforms.uDimAmt2.value = box2 ? palette.heroTextDim * heroText : 0
      uniforms.uEdge.value.set((H - 112) * dpr, 96 * dpr, wide ? (W - 210) * dpr : 1e6, 140 * dpr)
      uniforms.uEdgeAmt.value = edgeAmt
    }

    // El titular, escrito por el hilo en la pagina al llegar.
    const text = textMesh.current
    if (text) {
      text.visible = write > 0.001 && !!work.lit
      if (text.visible && work.lit) {
        if (text.geometry !== work.lit) text.geometry = work.lit
        text.matrix.copy(work.lineMatrix)
        const uniforms = textMaterial.uniforms
        uniforms.uWrite.value = write * 1.04
        uniforms.uRes.value.set(W * dpr, H * dpr)
        uniforms.uDpr.value = dpr
      }
    }
    sky.current.fade = 1 - ramp(0.15, 0.6, pose.dive)

    // Texto de cada escena: la portada al principio; el de cada zona, cuando su titular ya esta escrito.
    // Ocultos siguen en el arbol de accesibilidad: solo dejan de recibir clics y sus enlaces salen del tabulador.
    for (let k = 0; k < SCENE_COUNT; k++) {
      const shown = k === 0 ? heroText : pose.zone === k - 1 ? blockShown : 0
      dom.opacity(stage.blocks[k], shown)
      dom.still(stage.blocks[k], shown < 0.5)
      dom.inert(stage.actions[k], shown < 0.5)
    }

    // Instrumentos: aumento, barra de escala, nivel y ruta hasta la informacion. Mientras se lee un
    // titular, el indice de la derecha se queda en numeros (para no pisarlo) y el aviso de scroll se va.
    const pageNow = ramp(0.22 * work.page, 0.55 * work.page, px[2])
    const hudStep = pose.dive <= 0.06 ? 0 : write > 0.02 || pageNow > 0.9 ? 4 : px[2] > 20 ? 3 : px[1] > 24 ? 2 : 1
    const zoom = pose.dive > 0 ? outside / height : 1
    dom.opacity(stage.hud.root, hudShown)
    dom.opacity(stage.hint, 1 - ramp(0.14, 0.26, s))
    dom.data(stage.nav, 'quiet', heroText > 0.05 || write > 0.01 ? '1' : '0')
    const shownZoom = roundZoom(zoom)
    if (shownZoom !== zoomShown.current && stage.hud.zoom) {
      zoomShown.current = shownZoom
      stage.hud.zoom.textContent = '×' + zoomFormat.format(shownZoom)
    }
    dom.scaleX(stage.hud.bar, Math.min(1, Math.max(0.015, Math.pow(zoom, -0.45))))
    for (let m = 0; m < stage.hud.levels.length; m++) dom.opacity(stage.hud.levels[m], m === hudStep ? 1 : 0)
    for (let z = 0; z < stage.crumbs.length; z++) {
      for (let m = 0; m < stage.crumbs[z].length; m++) {
        dom.opacity(stage.crumbs[z][m], z === pose.zone && m <= hudStep ? 1 : 0)
        dom.data(stage.crumbs[z][m], 'on', z === pose.zone && m === hudStep ? '1' : '0')
      }
    }

    // Etiquetas de las zonas alrededor del simbolo, siempre por fuera de su silueta en pantalla (una
    // elipse con la caja de su contorno proyectado). En el movil, solo la de la zona a la que se va.
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
    const away = 1 - ramp(0, 0.14, pose.dive)
    for (let z = 0; z < ZONE_COUNT; z++) {
      const el = stage.zoneLabels[z]
      const allowed = wide || (pose.hero < 0.5 && z === pose.zone)
      const seen = allowed && away > 0.01 && project(frames[z].label, cam, W, H, at)
      dom.opacity(el, seen ? away * (pose.hero > 0.5 ? 0.85 : z === pose.zone ? 1 : 0.5) : 0)
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
      if (!wide) {
        // En el movil no hay sitio a los lados: encima o debajo del simbolo, centrada.
        side = 'below'
        x = clampTo(ex + dx * 0.3, 16 + width / 2, W - 16 - width / 2)
        y = clampTo(dy > 0 ? ey + eb + 18 : ey - eb - 34, 96, H - 96)
      } else if (heroText > 0.01 && hero.current.title && hero.current.text) {
        // En la portada, las que caerian sobre el titulo o su texto bajan hasta debajo del texto.
        const x0 = side === 'left' ? x - width : x
        const x1 = side === 'left' ? x : x + width
        if (overlaps(hero.current.title, x0, x1, y) || overlaps(hero.current.text, x0, x1, y)) y = lerp(y, hero.current.text[3] + 18, heroText)
      }
      dom.move(el, x, y)
      dom.data(el, 'side', side)
      dom.data(el, 'on', z === pose.zone && pose.hero < 0.5 ? '1' : '0')
    }

    // Al bajar, los nombres de las carpetas (junto a su icono) y de los documentos (debajo de su tarjeta).
    // Se van antes de que aparezca el texto de la escena.
    for (let q = 0; q < 2; q++) {
      const k = q + 1
      const sets = q === 0 ? stage.folders : stage.files
      const span = q === 0 ? ramp(24, 34, px[k]) * (1 - ramp(170, 260, px[k])) : ramp(34, 48, px[k]) * (1 - ramp(220, 320, px[k])) * (1 - ramp(0, 0.3, write))
      const live = span * alpha[k] > 0.02 && project(frame.centers[k], cam, W, H, middle)
      const down = downs[pose.zone]
      for (let z = 0; z < sets.length; z++) {
        const items = sets[z]
        for (let n = 0; n < items.length; n++) {
          const el = items[n]
          const cell = named[z]?.[q]?.[n]
          if (z !== pose.zone || !live || !cell || !el) {
            dom.opacity(el, 0)
            continue
          }
          const lift = q === 0 ? 0 : 0.43
          tmp.v
            .copy(frame.centers[k])
            .addScaledVector(frame.axisI, (cell[0] + lift * down[0]) * frame.unit[k])
            .addScaledVector(frame.axisJ, (cell[1] + lift * down[1]) * frame.unit[k])
          if (!project(tmp.v, cam, W, H, at)) {
            dom.opacity(el, 0)
            continue
          }
          const fromLens = Math.hypot(at[0] - middle[0], at[1] - middle[1]) / Math.min(W, H)
          const shown = alpha[k] * span * (1 - ramp(lens[k] - 0.1, lens[k] + 0.15, fromLens))
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
          dom.opacity(el, shown)
          dom.move(el, x, at[1] + (q === 0 ? 0 : 3))
          dom.data(el, 'side', side)
        }
      }
    }

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
      if (text && !text.visible) {
        text.geometry = work.lit ?? placeholder
        textMaterial.uniforms.uWrite.value = -1
        text.visible = true
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
