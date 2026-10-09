"use client"

import { useRef } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { motion, useInView, useReducedMotion, useScroll } from 'motion/react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'

// La escena 3D solo en el navegador: sin WebGL no se pinta nada y el texto sigue igual.
const CoreScene = dynamic(() => import('@/components/home/core-scene'), { ssr: false })

interface Scene {
  id: string
  kicker: string
  title: string
  text: string
  specs: string[]
}

// La home: el nucleo se queda fijo en el centro y se transforma de forma continua mientras se
// baja. Cada escena ocupa una pantalla, con el texto centrado arriba (orden de Eric: portada,
// local, historial, equipo, documentos, carpetas y tareas).
export default function Scrolly() {
  const t = useTranslations('home')
  const locale = useLocale()
  const scenes = t.raw('scenes') as Scene[]
  const sectionRef = useRef<HTMLElement>(null)
  const reduceMotion = useReducedMotion() ?? false

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] })
  const featuresHref = localePath(locale, '/funciones')

  return (
    <section ref={sectionRef} className="relative">
      <div className="sticky top-0 h-[100svh] w-full overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0">
          <CoreScene progress={scrollYProgress} reduceMotion={reduceMotion} claudeLabel="Claude" />
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[52%] bg-gradient-to-b from-white via-white/85 to-transparent" />
      </div>

      <div className="relative -mt-[100svh]">
        <Step index={0}>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-ink">{t('hero.title')}</h1>
          <p className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight text-brand">{t('hero.tagline')}</p>
          <p className="mx-auto mt-4 max-w-xl text-lg text-body leading-relaxed">{t('hero.text')}</p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Button size="lg" asChild>
              <Link href={localePath(locale, '/precios')}>{t('hero.ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href={featuresHref}>{t('hero.ctaSecondary')}</Link>
            </Button>
          </div>
          <HeroChat />
          <p className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 text-sm text-muted">
            <ChevronDown className="h-4 w-4 animate-bounce" aria-hidden="true" />
            {t('hero.scroll')}
          </p>
        </Step>

        {scenes.map((scene, i) => (
          <Step key={scene.id} index={i + 1}>
            <p className="text-sm font-semibold uppercase tracking-wider text-brand">{scene.kicker}</p>
            <h2 className="mt-3 text-4xl sm:text-6xl font-bold tracking-tight text-ink">{scene.title}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lg text-body leading-relaxed">{scene.text}</p>
            <ul className="mt-6 flex flex-wrap justify-center gap-2">
              {scene.specs.map((spec) => (
                <li
                  key={spec}
                  className="rounded-full border border-line bg-white/90 px-3.5 py-1.5 text-sm font-medium text-ink backdrop-blur-sm"
                >
                  {spec}
                </li>
              ))}
            </ul>
            <Link
              href={featuresHref}
              className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline-offset-4 hover:underline"
            >
              {t('more')}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </Step>
        ))}
      </div>
    </section>
  )
}

/** El chat de ejemplo de la portada, flotando delante del nucleo. */
function HeroChat() {
  const t = useTranslations('home.hero')
  return (
    <div className="pointer-events-none absolute inset-x-4 bottom-[13%] mx-auto max-w-md space-y-2 text-left text-xs sm:bottom-[14%] sm:text-sm">
      <motion.p
        className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-white shadow-lg shadow-brand/20"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 0.5 }}
      >
        {t('chatUser')}
      </motion.p>
      <motion.div
        className="hidden w-fit max-w-[90%] rounded-2xl rounded-bl-md border sm:block border-line bg-white/95 px-4 py-2.5 text-ink shadow-lg shadow-ink/5 backdrop-blur-sm"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.4, duration: 0.5 }}
      >
        {t('chatReply')}
        <span className="mt-1 block text-xs font-medium text-brand">{t('chatSource')}</span>
      </motion.div>
    </div>
  )
}

function Step({ index, children }: { index: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { margin: '-40% 0px -40% 0px' })

  return (
    <motion.div
      ref={ref}
      className="relative flex h-[100svh] flex-col items-center px-4 pt-24 text-center sm:pt-28"
      initial={false}
      animate={{ opacity: inView || index === 0 ? 1 : 0, y: inView || index === 0 ? 0 : 24 }}
      transition={{ duration: 0.5 }}
    >
      {children}
    </motion.div>
  )
}
