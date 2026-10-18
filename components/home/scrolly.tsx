"use client"

import { Component, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'motion/react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useTheme } from '@/components/theme-provider'
import { sceneAt, sceneTop, sectionVh, showBlock, stage } from '@/components/home/stage'

// La escena 3D solo en el navegador y solo si hay WebGL: si no, la home se queda en texto.
const CoreScene = dynamic(() => import('@/components/home/core-scene'), { ssr: false })

interface Scene {
  id: string
  kicker: string
  title: string
  text: string
  specs: string[]
  /** Donde esta la informacion de la escena: su carpeta, su documento, el sitio exacto y lo que hay al lado. */
  path: { folder: string; file: string; place: string; folders: string[]; files: string[] }
  cite: string
}

// La home es un viaje por el cerebro, siempre en el centro: un solo hilo de luz que dibuja el simbolo.
// Al bajar, como sobre un mapa y sin que nada gire, la camara se aleja hasta ver el simbolo entero, la
// luz pasa a la zona de cada escena (orden de Eric: portada, local, historial, equipo, documentos,
// carpetas y tareas) y baja a ella: sus carpetas, sus documentos y la pagina donde esta lo que se
// busca, con el titular dibujado por el propio hilo. En cada parada todo se queda quieto mientras se
// lee. Todo va centrado y apilado en el mismo sitio; la escena decide que se ve y donde va cada
// etiqueta (ver stage.ts).
export default function Scrolly() {
  const t = useTranslations('home')
  const locale = useLocale()
  const scenes = t.raw('scenes') as Scene[]
  const hud = t.raw('hud') as string[]
  const sectionRef = useRef<HTMLElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion() ?? false
  const { resolvedTheme } = useTheme()
  const [active, setActive] = useState(0)
  const [webgl, setWebgl] = useState<boolean | null>(null)
  const [crashed, setCrashed] = useState(false)
  const failed = crashed || webgl === false

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })

  const count = scenes.length
  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    setActive(Math.round(sceneAt(p, count)))
    showEarly(sceneAt(p, count), count)
  })

  useEffect(() => {
    setWebgl(hasWebGL())
  }, [])

  // Al cambiar el tamano de la ventana (o girar el movil) cambia el alto del viaje: se vuelve al mismo
  // punto. La barra del navegador del movil no cuenta (el viaje se mide en svh).
  useEffect(() => {
    const section = sectionRef.current
    const sticky = stickyRef.current
    if (!section || !sticky) return
    let height = section.offsetHeight
    let last = scrollYProgress.get()
    showEarly(sceneAt(last, count), count)
    const stop = scrollYProgress.on('change', (p) => void (last = p))
    const onResize = () => {
      const next = section.offsetHeight
      if (next === height) return
      height = next
      if (last <= 0 || last >= 1) return
      const top = section.getBoundingClientRect().top + window.scrollY
      window.scrollTo({ top: top + last * (next - sticky.offsetHeight), behavior: 'instant' })
    }
    window.addEventListener('resize', onResize)
    return () => {
      stop()
      window.removeEventListener('resize', onResize)
    }
  }, [scrollYProgress, count, failed])

  const featuresHref = localePath(locale, '/funciones')
  const labels = [t('index'), ...scenes.map((scene) => scene.kicker)]
  const number = (i: number) => String(i + 2).padStart(2, '0')

  // Cada escena empieza SCENE_VH mas abajo (ver sceneTop). Se salta de golpe: la escena no recorre el
  // camino, aparece ya en la parada con un fundido (ver JUMP en core-scene.tsx).
  const goTo = (k: number) => {
    const section = sectionRef.current
    const sticky = stickyRef.current
    if (!section || !sticky) return
    const top = section.getBoundingClientRect().top + window.scrollY
    window.scrollTo({ top: top + sceneTop(k, scenes.length) * (section.offsetHeight - sticky.offsetHeight), behavior: 'instant' })
  }

  // Sin WebGL no hay viaje: la portada y las escenas, una detras de otra, con todo su texto y enlaces.
  if (failed) {
    return (
      <section className="px-4 pb-16 pt-28 text-center sm:px-8">
        <h1 className="text-6xl sm:text-8xl font-bold leading-[0.95] tracking-tight text-ink">{t('hero.title')}</h1>
        <p className="mt-4 text-2xl font-semibold tracking-tight text-brand">{t('hero.tagline')}</p>
        <p className="mx-auto mt-3 max-w-md text-lg text-body leading-relaxed">{t('hero.text')}</p>
        <HeroActions className="mt-7" />
        <div className="mx-auto mt-12 grid max-w-6xl gap-4 text-left md:grid-cols-2 lg:grid-cols-3">
          {scenes.map((scene, i) => (
            <article key={scene.id} className="flex flex-col rounded-2xl border border-line bg-surface p-6">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-muted">
                <span className="text-brand">{number(i)}</span> — {scene.kicker}
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink">{scene.title}</h2>
              <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.15em] text-brand">{scene.cite}</p>
              <p className="mt-3 text-lg text-body leading-relaxed">{scene.text}</p>
              <Specs items={scene.specs} className="mt-4 flex flex-col gap-1" />
              <MoreLink href={featuresHref} className="mt-auto self-start pt-5" />
            </article>
          ))}
        </div>
      </section>
    )
  }

  return (
    <section ref={sectionRef} className="relative" style={{ height: `${sectionVh(scenes.length)}svh` }}>
      <div ref={stickyRef} className="sticky top-0 h-[100svh] w-full overflow-hidden">
        <div className="absolute inset-0" aria-hidden="true">
          {webgl && (
            <SceneGuard onFail={() => setCrashed(true)}>
              <CoreScene progress={scrollYProgress} reduceMotion={reduceMotion} dark={resolvedTheme === 'dark'} />
            </SceneGuard>
          )}
        </div>

        {/* Etiquetas que la escena coloca sobre el hilo: las zonas alrededor del simbolo y, al bajar, carpetas y documentos */}
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          {/* En el movil solo se ve la de la zona a la que se va (la escena decide) */}
          {scenes.map((scene, i) => (
            <Tag key={scene.id} ref={(el) => void (stage.zoneLabels[i] = el)} className="halo text-xs uppercase tracking-[0.15em] text-muted sm:text-[13px]">
              <span className="text-brand">{number(i)}</span> · {scene.kicker}
            </Tag>
          ))}
          {scenes.map((scene, i) =>
            [scene.path.folder, ...scene.path.folders].map((name, n) => (
              <Tag key={`${scene.id}-folder-${n}`} ref={(el) => void ((stage.folders[i] ??= [])[n] = el)} className={cn('chip', n === 0 ? 'text-brand' : 'text-ink')}>
                {name}
              </Tag>
            ))
          )}
          {scenes.map((scene, i) =>
            [scene.path.file, ...scene.path.files].map((name, n) => (
              <Tag key={`${scene.id}-file-${n}`} ref={(el) => void ((stage.files[i] ??= [])[n] = el)} className={cn('chip', n === 0 ? 'text-brand' : 'text-ink')}>
                {name}
              </Tag>
            ))
          )}
        </div>

        {/* Portada: el titulo va en texto normal, siempre nitido; el hilo se queda en penumbra detras. En el
            movil (en vertical) el texto va abajo y el simbolo encima */}
        <div
          ref={(el) => void (stage.blocks[0] = el)}
          className="absolute inset-0 flex flex-col items-center justify-center px-4 pt-10 text-center portrait:max-lg:justify-end portrait:max-lg:pb-16 short:pt-14"
        >
          <h1 className="text-[3.6rem] sm:text-8xl lg:text-[7.5rem] xl:text-[9rem] short:text-6xl font-bold leading-[0.92] tracking-tight text-ink">{t('hero.title')}</h1>
          <Readable className="mt-6 short:mt-3">
            <p className="text-xl sm:text-2xl short:text-lg font-semibold tracking-tight text-brand">{t('hero.tagline')}</p>
            <p className="mt-3 max-w-xl text-lg short:mt-1 short:max-w-2xl short:text-base text-body leading-relaxed">{t('hero.text')}</p>
            <HeroActions ref={(el) => void (stage.actions[0] = el)} className="mt-7 short:mt-4" />
          </Readable>
        </div>

        {/* Escenas: el titular (lo dibuja el hilo al llegar al fondo de la zona), de donde sale y el resto en
            texto, grande y con buen contraste. Ocultas siguen en el arbol de accesibilidad; solo sus enlaces
            salen del tabulador */}
        {scenes.map((scene, i) => (
          <div
            key={scene.id}
            ref={(el) => void (stage.blocks[i + 1] = el)}
            style={{ opacity: 0, pointerEvents: 'none' }}
            className="absolute inset-0 flex flex-col items-center justify-center px-4 pt-10 text-center short:pt-12"
          >
            <p className="font-mono text-sm uppercase tracking-[0.2em] text-muted">
              <span className="text-brand">{number(i)}</span> — {scene.kicker}
            </p>
            {/* Con el indice de la derecha a la vista, el titular deja sitio a los dos lados */}
            <DottedTitle
              index={i + 1}
              text={scene.title}
              className="mt-3 max-w-5xl text-5xl sm:text-7xl lg:max-w-[min(64rem,calc(100vw-17rem))] xl:max-w-[min(64rem,calc(100vw-27rem))] lg:text-[6.2rem] short:mt-2 short:text-4xl leading-[0.95]"
            />
            <p className="mt-4 inline-flex max-w-sm items-center justify-center gap-2 text-balance font-mono text-[13px] uppercase tracking-[0.12em] text-brand sm:max-w-none short:mt-2">
              <span className="hidden h-px w-5 shrink-0 bg-current sm:block" aria-hidden="true" />
              {scene.cite}
            </p>
            <Readable className="mt-4 short:mt-2">
              <p className="max-w-xl text-lg short:max-w-2xl short:text-base text-body leading-relaxed">{scene.text}</p>
              <Specs items={scene.specs} className="mt-4 hidden flex-wrap justify-center gap-x-6 gap-y-1 sm:flex short:hidden" />
              <MoreLink ref={(el) => void (stage.actions[i + 1] = el)} inert href={featuresHref} className="mt-3 short:mt-1" />
            </Readable>
          </div>
        ))}

        {/* Por donde va la busqueda: la ruta entera hasta la informacion, fija, mientras se esta dentro de una zona */}
        <div className="halo pointer-events-none absolute left-6 right-6 top-20 hidden font-mono text-xs uppercase tracking-[0.12em] sm:block xl:left-8 short:hidden" aria-hidden="true">
          {scenes.map((scene, i) => {
            const steps = [t('journey.brain'), scene.kicker, scene.path.folder, scene.path.file, scene.path.place]
            return (
              <ol key={scene.id} ref={(el) => void (stage.crumbs[i] = el)} style={{ opacity: 0 }} className="absolute left-0 top-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body">
                {steps.map((step, m) => (
                  <li key={m} className={m === steps.length - 1 ? 'text-brand' : undefined}>
                    {m > 0 && <span className="mr-1.5 text-muted">›</span>}
                    {step}
                  </li>
                ))}
              </ol>
            )
          })}
        </div>

        {/* Indice de escenas, con el nombre de cada una a la vista (en pantallas algo mas estrechas, el de la
            escena en la que se esta, y solo los numeros mientras se lee un titular: data-quiet) */}
        <nav ref={(el) => void (stage.nav = el)} aria-label={t('tour')} className="group/nav halo absolute right-4 top-1/2 hidden -translate-y-1/2 lg:block xl:right-6">
          <ol className="text-right">
            {labels.map((label, k) => (
              <li key={label}>
                <button
                  type="button"
                  onClick={() => goTo(k)}
                  aria-current={k === active ? 'step' : undefined}
                  className={cn('group inline-flex min-h-8 items-center gap-2.5 px-2 transition-colors', k === active ? 'text-brand' : 'text-muted hover:text-ink')}
                >
                  <span
                    className={cn(
                      'text-sm transition-opacity group-focus-visible:opacity-100',
                      k === active
                        ? 'font-medium opacity-100 group-data-[quiet=1]/nav:opacity-0 xl:group-data-[quiet=1]/nav:opacity-100'
                        : 'opacity-0 group-hover:opacity-100 xl:opacity-100'
                    )}
                  >
                    {label}
                  </span>
                  <span className="font-mono text-[13px] tabular-nums">{String(k + 1).padStart(2, '0')}</span>
                  <span className={cn('h-px transition-all', k === active ? 'w-6 bg-brand' : 'w-3 bg-line')} />
                </button>
              </li>
            ))}
          </ol>
        </nav>

        {/* Lectura en vivo (cambia con un fundido, sin nada que se mueva) y aviso de scroll */}
        <p className="halo absolute bottom-6 right-6 hidden items-center gap-2 font-mono text-xs text-muted lg:flex xl:right-8">
          <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand" />
          <span className="uppercase tracking-[0.15em]">{t('demo')}</span>
          <span className="text-line">/</span>
          <AnimatePresence mode="wait">
            <motion.span key={active} className="text-ink" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {hud[Math.min(active, hud.length - 1)]}
            </motion.span>
          </AnimatePresence>
        </p>
        <p
          ref={(el) => void (stage.hint = el)}
          className={cn(
            'pointer-events-none absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-muted transition-opacity short:hidden',
            active === 0 ? 'opacity-100' : 'opacity-0'
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          {t('hero.scroll')}
        </p>
      </div>
    </section>
  )
}

/** Hasta que la escena pinta su primer fotograma (o si tarda en llegar), el texto que toca segun el scroll (s en escenas). */
function showEarly(s: number, count: number) {
  if (stage.live) return
  for (let k = 0; k <= count; k++) showBlock(k, k === 0 ? s < 0.3 : Math.abs(s - k) < 0.3)
}

/** Los dos botones de la portada. */
function HeroActions({ ref, className }: { ref?: (el: HTMLDivElement | null) => void; className?: string }) {
  const t = useTranslations('home')
  const locale = useLocale()
  return (
    <div ref={ref} className={cn('flex flex-wrap justify-center gap-3', className)}>
      <Button size="lg" asChild>
        <Link href={localePath(locale, '/precios')}>{t('hero.ctaPrimary')}</Link>
      </Button>
      <Button size="lg" variant="outline" asChild>
        <Link href={localePath(locale, '/funciones')}>{t('hero.ctaSecondary')}</Link>
      </Button>
    </div>
  )
}

/** Lo que incluye cada escena, en una linea de etiquetas (en letra normal y grande, que se lea bien). */
function Specs({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn('text-base text-body', className)}>
      {items.map((spec) => (
        <li key={spec}>
          <span className="text-brand">+</span> {spec}
        </li>
      ))}
    </ul>
  )
}

/** Enlace a todas las funciones, al pie de cada escena: un enlace normal, en letra de leer y facil de pulsar. */
function MoreLink({ ref, href, inert, className }: { ref?: (el: HTMLAnchorElement | null) => void; href: string; inert?: boolean; className?: string }) {
  const t = useTranslations('home')
  return (
    <Link
      ref={ref}
      href={href}
      inert={inert}
      className={cn('inline-flex min-h-11 items-center gap-1.5 text-base font-medium text-brand underline decoration-1 underline-offset-4 hover:decoration-2', className)}
    >
      {t('more')}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  )
}

/**
 * Titular que el hilo dibuja con sus celdas. Cada palabra va en su span para que la escena sepa
 * donde cae cada una (tambien cuando el titular salta de linea). Mientras la escena no lo tiene
 * dibujado (data-drawn), se ve como texto normal.
 */
function DottedTitle({ index, text, className }: { index: number; text: string; className?: string }) {
  const words = text.split(' ')
  return (
    <h2 ref={(el) => void (stage.titles[index] = el)} className={cn('dotted font-bold tracking-[-0.01em] text-ink sm:tracking-tight', className)}>
      {words.map((word, k) => (
        <span key={k}>
          <span>{word}</span>
          {k < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </h2>
  )
}

/**
 * Etiqueta que la escena coloca sobre un punto del hilo: el texto sale hacia el lado que le dice
 * (data-side: a la izquierda, a la derecha o centrado debajo) y se resalta con data-on.
 */
function Tag({ ref, className, children }: { ref: (el: HTMLDivElement | null) => void; className?: string; children: React.ReactNode }) {
  return (
    <div ref={ref} style={{ opacity: 0 }} data-side="right" className="group absolute left-0 top-0">
      <span
        className={cn(
          'absolute top-0 -translate-y-1/2 whitespace-nowrap font-mono group-data-[side=left]:right-3 group-data-[side=right]:left-3',
          'group-data-[side=below]:left-0 group-data-[side=below]:-translate-x-1/2 group-data-[side=below]:translate-y-0',
          'group-data-[on=1]:text-brand dark:group-data-[on=1]:text-brand-light',
          className
        )}
      >
        {children}
      </span>
    </div>
  )
}

/** El texto de apoyo bajo el titular. */
function Readable({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('flex flex-col items-center', className)}>{children}</div>
}

/** Si el navegador puede crear un contexto WebGL (el de prueba se suelta enseguida). */
function hasWebGL() {
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  } catch {
    return false
  }
}

/** Si la escena falla al arrancar (o mas tarde), desaparece y la home sigue funcionando en texto. */
class SceneGuard extends Component<{ children: React.ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}
