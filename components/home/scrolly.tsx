"use client"

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { motion, useInView, useScroll, useTransform } from 'motion/react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import Laptop from '@/components/home/laptop'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'

interface Scene {
  id: string
  kicker: string
  title: string
  text: string
  specs: string[]
}

// La home: el portatil se queda fijo y cada bloque de texto que pasa por el centro de la
// pantalla cambia lo que se ve en el (orden de Eric: portada, local, historial, equipo,
// documentos, carpetas y tareas).
export default function Scrolly() {
  const t = useTranslations('home')
  const locale = useLocale()
  const scenes = t.raw('scenes') as Scene[]
  const [active, setActive] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  const tilt = useTransform(scrollYProgress, [0, 1], [-8, 8])

  const featuresHref = localePath(locale, '/funciones')

  return (
    <section ref={sectionRef} className="relative">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-x-10 px-4 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:px-8">
        {/* Movil: portada, portatil fijo arriba y escenas. Escritorio: textos a la izquierda y
            portatil fijo a la derecha durante toda la seccion. */}
        <Step
          index={0}
          onActive={setActive}
          className="min-h-0 pb-6 pt-10 lg:col-start-1 lg:row-start-1 lg:min-h-[calc(100vh-4rem)] lg:pb-12 lg:pt-12"
        >
            <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-ink">{t('hero.title')}</h1>
            <p className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight text-brand">{t('hero.tagline')}</p>
            <p className="mt-5 max-w-md text-lg text-body leading-relaxed">{t('hero.text')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href={localePath(locale, '/precios')}>{t('hero.ctaPrimary')}</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href={featuresHref}>{t('hero.ctaSecondary')}</Link>
              </Button>
            </div>
            <p className="mt-10 hidden items-center gap-1 text-sm text-muted lg:flex">
              <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden="true" />
              {t('hero.scroll')}
            </p>
        </Step>

        <div className="sticky top-16 z-10 -mx-4 bg-white px-4 pb-2 pt-2 sm:-mx-6 sm:px-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mx-0 lg:flex lg:h-[calc(100vh-4rem)] lg:items-center lg:self-start lg:bg-transparent lg:px-0">
          <div className="mx-auto w-full max-w-[300px] sm:max-w-[420px] lg:max-w-none">
            <Laptop scene={active} tilt={tilt} />
          </div>
        </div>

        <div className="lg:col-start-1 lg:row-start-2">
          {scenes.map((scene, i) => (
            <Step key={scene.id} index={i + 1} onActive={setActive}>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand">{scene.kicker}</p>
              <h2 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight text-ink">{scene.title}</h2>
              <p className="mt-4 max-w-md text-lg text-body leading-relaxed">{scene.text}</p>
              <ul className="mt-6 flex flex-wrap gap-2">
                {scene.specs.map((spec) => (
                  <li key={spec} className="rounded-full border border-line bg-white px-3.5 py-1.5 text-sm font-medium text-ink">
                    {spec}
                  </li>
                ))}
              </ul>
              <Link
                href={featuresHref}
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline"
              >
                {t('more')}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Step>
          ))}
        </div>
      </div>
    </section>
  )
}

function Step({
  index,
  onActive,
  className,
  children,
}: {
  index: number
  onActive: (index: number) => void
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Activo cuando su bloque cruza la franja central de la pantalla.
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' })
  useEffect(() => {
    if (inView) onActive(index)
  }, [inView, index, onActive])

  return (
    <motion.div
      ref={ref}
      className={cn('flex min-h-[70vh] flex-col justify-center py-12 lg:min-h-screen', className)}
      initial={false}
      animate={{ opacity: inView || index === 0 ? 1 : 0.35 }}
      transition={{ duration: 0.4 }}
    >
      {children}
    </motion.div>
  )
}
