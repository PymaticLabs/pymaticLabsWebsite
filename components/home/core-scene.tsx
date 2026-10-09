"use client"

import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Edges, Line, RoundedBox } from '@react-three/drei'
import * as THREE from 'three'
import type { MotionValue } from 'motion/react'

// El nucleo: el protagonista de la home. Un cubo de capas de vidrio que sigue al scroll de forma
// continua: cada escena es un fotograma clave y entre una y otra todo se interpola.
// Escenas: 0 portada, 1 local, 2 historial, 3 equipo, 4 documentos, 5 carpetas, 6 tareas.
//
// Version provisional hecha en codigo; el modelo de Blender sustituira a las capas.

const SCENE_COUNT = 7
const LAYERS = 5
const CARDS = 20
const SATELLITES = 6
const BRAND = new THREE.Color('#0463FE')
const LAYER_COLOR = new THREE.Color('#dbe7ff')

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => {
  const t = clamp01(x)
  return t * t * (3 - 2 * t)
}
const lerp = THREE.MathUtils.lerp

/** Momento del recorrido: escena actual y cuanto se ha pasado hacia la siguiente (con pausa en cada una). */
function timeline(progress: number) {
  const s = clamp01(progress) * (SCENE_COUNT - 1)
  const i = Math.min(SCENE_COUNT - 2, Math.floor(s))
  // Se queda quieto mientras el texto de la escena esta a la vista y cambia entre medias.
  const f = smooth((s - i - 0.3) / 0.45)
  const weight = (k: number) => (k === i ? 1 - f : k === i + 1 ? f : 0)
  return { s, weight }
}

interface CoreSceneProps {
  progress: MotionValue<number>
  reduceMotion: boolean
  claudeLabel: string
}

export default function CoreScene(props: CoreSceneProps) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 8], fov: 35 }}
      gl={{ antialias: true, alpha: true }}
      fallback={null}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[4, 6, 5]} intensity={1.6} />
      <directionalLight position={[-5, -2, -4]} intensity={0.5} color="#b9d0ff" />
      <Core {...props} />
    </Canvas>
  )
}

function Core({ progress, reduceMotion, claudeLabel: claudeText }: CoreSceneProps) {
  const group = useRef<THREE.Group>(null)
  const layers = useRef<(THREE.Group | null)[]>([])
  const dome = useRef<THREE.Group>(null)
  const claude = useRef<THREE.Group>(null)
  const claudeLabel = useRef<THREE.Sprite>(null)
  const labelTexture = useMemo(() => pillTexture(claudeText), [claudeText])
  const satellites = useRef<(THREE.Group | null)[]>([])
  const links = useRef<THREE.Group>(null)
  const cards = useRef<THREE.InstancedMesh>(null)
  const cardsGroup = useRef<THREE.Group>(null)
  const { camera, size } = useThree()

  const materials = useMemo(
    () =>
      Array.from(
        { length: LAYERS },
        () =>
          new THREE.MeshPhysicalMaterial({
            color: LAYER_COLOR,
            roughness: 0.12,
            metalness: 0.1,
            clearcoat: 1,
            clearcoatRoughness: 0.15,
            transparent: true,
            opacity: 0.72,
            emissive: BRAND,
            emissiveIntensity: 0,
          })
      ),
    []
  )

  // Puntos de salida (documentos) y de llegada (carpetas) de cada ficha.
  const cardPaths = useMemo(() => {
    const random = mulberry32(7)
    return Array.from({ length: CARDS }, (_, j) => {
      const theta = random() * Math.PI * 2
      const phi = Math.acos(2 * random() - 1)
      const r = 6 + random() * 2
      const from = new THREE.Vector3(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.6, r * Math.sin(phi) * Math.sin(theta))
      const col = j % 5
      const row = Math.floor(j / 5)
      const grid = new THREE.Vector3((col - 2) * 0.58, 0.95 - row * 0.62, 1.4)
      return { from, grid, delay: random() * 0.35, spin: random() * Math.PI }
    })
  }, [])

  const satellitePositions = useMemo(
    () =>
      Array.from({ length: SATELLITES }, (_, k) => {
        const a = (k / SATELLITES) * Math.PI * 2 + 0.3
        return new THREE.Vector3(Math.cos(a) * 3.1, Math.sin(k * 1.7) * 0.5, Math.sin(a) * 3.1)
      }),
    []
  )

  const temp = useMemo(() => new THREE.Object3D(), [])

  // Color de cada ficha por columna: carpetas normales, una destacada y la de lo sensible.
  useEffect(() => {
    if (!cards.current) return
    const palette = ['#dbe7ff', '#dbe7ff', '#0463FE', '#dbe7ff', '#111111'].map((c) => new THREE.Color(c))
    for (let j = 0; j < CARDS; j++) cards.current.setColorAt(j, palette[j % 5])
    if (cards.current.instanceColor) cards.current.instanceColor.needsUpdate = true
  }, [])
  const heart = useRef<THREE.Mesh>(null)
  const heartLight = useRef<THREE.PointLight>(null)

  useFrame((state, delta) => {
    const p = progress.get()
    const { s, weight } = timeline(p)
    const w = Array.from({ length: SCENE_COUNT }, (_, k) => weight(k))
    const blend = (values: number[]) => values.reduce((acc, v, k) => acc + v * w[k], 0)

    // Tamaño y sitio segun lo que se ve: el nucleo va en la mitad de abajo (arriba esta el texto)
    // y el anillo del equipo tiene que caber tambien en un movil.
    const viewHeight = 2 * Math.tan(THREE.MathUtils.degToRad(17.5)) * camera.position.z
    const viewWidth = viewHeight * (size.width / size.height)
    const base = Math.min((0.26 * viewHeight) / 1.5, (0.6 * viewWidth) / 2.6)
    const team = Math.min(base, (0.94 * viewWidth) / 7.2, (0.46 * viewHeight) / 3.4)

    if (group.current) {
      const idle = reduceMotion ? 0 : state.clock.elapsedTime * 0.12
      group.current.rotation.y = idle + p * Math.PI * 2.2
      group.current.rotation.x = blend([0.42, 0.3, 0.2, 0.55, 0.35, 0.15, 0.4])
      group.current.position.y = viewHeight * blend([-0.29, -0.25, -0.22, -0.2, -0.24, -0.21, -0.26])
      const scale = blend([1, 0.95, 0.9, team / base, 0.9, 0.85, 1]) * base
      group.current.scale.setScalar(scale)
    }
    if (heart.current) {
      const glow = blend([0.6, 0.5, 1.4, 0.8, 1.2, 0.5, 1]) + (reduceMotion ? 0 : Math.sin(state.clock.elapsedTime * 2) * 0.15)
      heart.current.scale.setScalar(0.32 + glow * 0.1)
      ;(heart.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + glow * 0.2
    }
    if (heartLight.current) heartLight.current.intensity = 6 + blend([0, 0, 10, 2, 8, 0, 4])

    // Capas
    const lit = smooth((s - 5.35) / 0.7) // tareas: las capas se marcan una a una
    layers.current.forEach((layer, i) => {
      if (!layer) return
      const stackY = (i - (LAYERS - 1) / 2) * 0.3
      const angle = (i / LAYERS) * Math.PI * 2
      const x = blend([0, 0, (i - 2) * 0.1, Math.cos(angle) * 1.25, 0, 0, 0])
      const y = blend([stackY, stackY, (i - 2) * 0.68, (i - 2) * 0.08, stackY * 0.9, stackY, stackY * 1.1])
      const z = blend([0, 0, 0, Math.sin(angle) * 1.25, 0, -0.4, 0])
      layer.position.set(x, y, z)
      layer.rotation.y = blend([0, 0, 0, -angle, 0, 0, 0])
      layer.scale.setScalar(blend([1, 1, 1, 0.55, 1, 1, 1]))

      const highlight =
        w[2] * (i === LAYERS - 1 ? 0.55 : 0) + w[1] * 0.06 + w[6] * (lit > i / LAYERS ? 0.5 : 0)
      const material = materials[i]
      material.emissiveIntensity = lerp(material.emissiveIntensity, highlight, Math.min(1, delta * 8))
    })

    // Local: la cupula y el hilo hacia Claude
    if (dome.current) {
      dome.current.scale.setScalar(lerp(0.6, 1, smooth(w[1])) * (w[1] > 0.01 ? 1 : 0.0001))
      dome.current.visible = w[1] > 0.01
    }
    if (claude.current && group.current) {
      claude.current.visible = w[1] > 0.01
      claude.current.scale.setScalar(w[1])
      // Claude se queda siempre a la derecha aunque el nucleo gire.
      claude.current.rotation.y = -group.current.rotation.y
    }
    if (claudeLabel.current) claudeLabel.current.material.opacity = w[1]

    // Equipo: los ordenadores alrededor y sus hilos
    satellites.current.forEach((satellite, k) => {
      if (!satellite) return
      const appear = smooth(w[3] * 1.4 - k * 0.06)
      satellite.visible = appear > 0.01
      satellite.scale.setScalar(appear)
      if (!reduceMotion) satellite.rotation.y = -group.current!.rotation.y + Math.sin(state.clock.elapsedTime + k) * 0.1
    })
    if (links.current) {
      links.current.visible = w[3] > 0.05
      links.current.children.forEach((child) => {
        const material = (child as unknown as { material: { opacity: number } }).material
        if (material) material.opacity = w[3] * 0.6
      })
    }

    // Documentos y carpetas: las fichas
    if (cardsGroup.current && group.current) {
      cardsGroup.current.position.copy(group.current.position)
      cardsGroup.current.scale.copy(group.current.scale)
    }
    if (cards.current) {
      const flyIn = (s - 3.25) / 1.0 // de fuera hacia el nucleo
      const arrange = smooth((s - 4.3) / 0.7) // en columnas
      const visibleCards = w[4] + w[5]
      cardPaths.forEach((card, j) => {
        const t = smooth((flyIn - card.delay) / 0.65)
        const toCore = temp.position.copy(card.from).lerp(new THREE.Vector3(0, 0, 0), t)
        // Cerca del nucleo se encogen: el nucleo los "absorbe".
        let scale = visibleCards * (1 - smooth((t - 0.8) / 0.2)) * (w[4] > 0 ? 1 : 0)
        if (arrange > 0) {
          temp.position.lerpVectors(new THREE.Vector3(0, 0, 0.6), card.grid, arrange)
          scale = w[5] * smooth(arrange * 1.3)
        } else {
          temp.position.copy(toCore)
        }
        temp.rotation.set(0, arrange > 0 ? 0 : card.spin + t * 2, arrange > 0 ? 0 : card.spin * 0.3)
        temp.scale.setScalar(Math.max(0, scale))
        temp.updateMatrix()
        cards.current!.setMatrixAt(j, temp.matrix)
      })
      cards.current.instanceMatrix.needsUpdate = true
      cards.current.visible = visibleCards > 0.01
    }
  })

  return (
    <>
      <group ref={group}>
        {/* El corazon: una luz azul dentro de las capas */}
        <mesh ref={heart}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color={BRAND} transparent opacity={0.7} depthWrite={false} />
        </mesh>
        <pointLight ref={heartLight} color={BRAND} intensity={6} distance={6} />

        {Array.from({ length: LAYERS }, (_, i) => (
          <group key={i} ref={(el) => void (layers.current[i] = el)}>
            <RoundedBox args={[1.7, 0.2, 1.7]} radius={0.07} smoothness={4} material={materials[i]}>
              <Edges color="#0463FE" threshold={15} />
            </RoundedBox>
          </group>
        ))}

        <group ref={dome}>
          <mesh>
            <sphereGeometry args={[1.65, 48, 24]} />
            <meshBasicMaterial color={BRAND} transparent opacity={0.07} depthWrite={false} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[1.65, 0.008, 8, 96]} />
            <meshBasicMaterial color={BRAND} transparent opacity={0.7} />
          </mesh>
          <mesh rotation={[Math.PI / 2.6, 0.5, 0]}>
            <torusGeometry args={[1.65, 0.006, 8, 96]} />
            <meshBasicMaterial color={BRAND} transparent opacity={0.45} />
          </mesh>
        </group>

        <group ref={claude}>
          <Line points={[[0, 0, 0], [1.55, 1.35, 0]]} color="#0463FE" lineWidth={1.5} dashed dashSize={0.12} gapSize={0.1} />
          <mesh position={[1.55, 1.35, 0]}>
            <sphereGeometry args={[0.16, 32, 16]} />
            <meshStandardMaterial color="#111111" />
          </mesh>
          <sprite ref={claudeLabel} position={[1.55, 1.78, 0]} scale={[0.95, 0.3, 1]}>
            <spriteMaterial map={labelTexture} transparent opacity={0} depthWrite={false} />
          </sprite>
        </group>

        <group ref={links}>
          {satellitePositions.map((position, k) => (
            <Line key={k} points={[[0, 0, 0], position.toArray()]} color="#0463FE" lineWidth={1.2} transparent opacity={0} />
          ))}
        </group>
        {satellitePositions.map((position, k) => (
          <group key={k} position={position} ref={(el) => void (satellites.current[k] = el)}>
            <Satellite />
          </group>
        ))}

      </group>
      {/* Las fichas acompañan al nucleo pero no giran con el: la cuadricula queda de frente */}
      <group ref={cardsGroup}>
        <instancedMesh ref={cards} args={[undefined, undefined, CARDS]}>
          <boxGeometry args={[0.42, 0.52, 0.02]} />
          <meshStandardMaterial roughness={0.35} side={THREE.DoubleSide} />
        </instancedMesh>
      </group>
    </>
  )
}

/** Un ordenador del equipo: una pantalla pequeña y su base. */
function Satellite() {
  return (
    <group>
      <RoundedBox args={[0.7, 0.46, 0.04]} radius={0.03} position={[0, 0.25, 0]}>
        <meshStandardMaterial color="#111111" />
      </RoundedBox>
      <mesh position={[0, 0.25, 0.025]}>
        <planeGeometry args={[0.62, 0.38]} />
        <meshStandardMaterial color="#eef3fc" emissive={BRAND} emissiveIntensity={0.15} />
      </mesh>
      <RoundedBox args={[0.82, 0.03, 0.5]} radius={0.012} position={[0, 0, 0.22]}>
        <meshStandardMaterial color="#c4c7cd" />
      </RoundedBox>
    </group>
  )
}

/** Una etiqueta negra redondeada con texto blanco, dibujada en un canvas. */
function pillTexture(text: string) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 80
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000000'
  ctx.beginPath()
  ctx.roundRect(4, 4, 248, 72, 36)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 34px Inter, system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 128, 42)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
