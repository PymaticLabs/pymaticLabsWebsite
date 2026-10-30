import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CerebroIcon } from '@/components/cerebro-icon'
import HeroChat, { type HeroChatTexts } from '@/components/home/hero-chat'
import { LaunchBadge } from '@/components/pricing/launch-offer'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'
import { hilbertPath } from '@/lib/hilbert'

// El hilo de la marca detras de la conversacion: una curva de Hilbert de 32 x 32, fina, que se dibuja una
// vez al cargar y se apaga hacia los bordes (el texto de arriba queda limpio).
const THREAD = hilbertPath(5, 35)

// Portada al estilo de una pagina de producto: el nombre, un titular corto y enorme que entra palabra a
// palabra, una linea que lo explica, el precio con las licencias de lanzamiento que quedan y, debajo, el
// producto funcionando: la conversacion. El «desde», el de lanzamiento mientras queden; despues, el de lista.
export default function Hero({ launchLeft = null }: { launchLeft?: number | null }) {
  const t = useTranslations('home')
  const locale = useLocale()
  const from = Math.min(...modalities.map((m) => (launchLeft !== 0 ? m.launchPrice : m.listPrice)))
  const chat: HeroChatTexts = {
    caption: t('chat.caption'),
    name: t('chat.name'),
    company: t('chat.company'),
    local: t('chat.local'),
    example: t('chat.example'),
    today: t('chat.today'),
    placeholder: t('chat.placeholder'),
    replay: t('chat.replay'),
    q1: t('chat.q1'),
    a1: t('chat.a1'),
    source1: t('chat.source1'),
  }
  const title = t('hero.title').split(' ')
  const accent = t('hero.titleAccent').split(' ')
  const word = (text: string, i: number, isAccent: boolean) => (
    <span key={i}>
      <span
        className={`inline-block motion-safe:animate-[rise_0.9s_cubic-bezier(0.2,0.7,0.2,1)_both] ${isAccent ? 'text-gradient pb-[0.08em]' : ''}`}
        style={{ animationDelay: `${0.1 + i * 0.08}s` }}
      >
        {text}
      </span>{' '}
    </span>
  )

  // En el movil, algo menos de aire arriba y entre bloques: la conversacion asoma ya en la primera pantalla.
  return (
    <section className="relative overflow-hidden bg-paper pb-16 pt-24 sm:pb-28 sm:pt-36 low:pt-24">
      <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
        <p className="inline-flex items-center gap-2.5 text-lg font-semibold text-ink motion-safe:animate-[rise_0.8s_cubic-bezier(0.2,0.7,0.2,1)_both]">
          <CerebroIcon className="h-8 w-8" />
          {t('hero.eyebrow')}
        </p>
        <h1 className="mt-4 text-hero font-bold leading-[1.02] tracking-[-0.045em] text-ink sm:mt-5 sm:text-7xl lg:text-[6.75rem] low:mt-3 low:text-6xl low:lg:text-[5rem]">
          {title.map((text, i) => word(text, i, false))}
          {/* En el movil, «tu empresa.» entera en su linea, con su color */}
          <span className="block sm:inline">{accent.map((text, i) => word(text, title.length + i, true))}</span>
        </h1>
        <p
          className="mx-auto mt-5 max-w-2xl text-pretty text-xl leading-relaxed text-muted motion-safe:animate-[rise_0.9s_cubic-bezier(0.2,0.7,0.2,1)_both] sm:mt-6 sm:text-2xl sm:leading-relaxed low:mt-4 low:sm:text-xl"
          style={{ animationDelay: '0.45s' }}
        >
          {t('hero.text')}
        </p>
        <div
          className="mt-7 flex flex-col items-center justify-center gap-2 motion-safe:animate-[rise_0.9s_cubic-bezier(0.2,0.7,0.2,1)_both] sm:mt-9 sm:flex-row sm:gap-7 low:mt-6"
          style={{ animationDelay: '0.6s' }}
        >
          <Button size="lg" className="h-13 w-full px-8 text-[17px] sm:w-auto" asChild>
            <Link href={localePath(locale, '/precios')}>{t('hero.ctaPrimary')}</Link>
          </Button>
          <Link
            href={localePath(locale, '/contacto')}
            className="inline-flex min-h-11 items-center gap-0.5 text-[17px] font-medium text-brand hover:underline hover:underline-offset-4"
          >
            {t('hero.ctaSecondary')}
            <ChevronRight className="h-5 w-5" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-5 flex flex-col items-center gap-4 motion-safe:animate-[rise_0.9s_cubic-bezier(0.2,0.7,0.2,1)_both] sm:mt-6" style={{ animationDelay: '0.7s' }}>
          <p className="text-[15px] text-muted">{t('hero.price', { price: formatPrice(from, locale) })}</p>
          <LaunchBadge left={launchLeft} />
        </div>
      </div>

      {/* El producto: crece un poco al subirlo a la vista (donde el navegador lo sabe hacer, ver .scroll-zoom) */}
      <div className="relative mx-auto mt-10 max-w-3xl px-4 sm:mt-20 sm:px-6">
        <svg
          aria-hidden="true"
          viewBox="0 0 1120 1120"
          className="pointer-events-none absolute left-1/2 top-1/2 w-[64rem] max-w-none -translate-x-1/2 -translate-y-1/2 text-brand opacity-[0.1] sm:opacity-[0.18] [mask-image:radial-gradient(closest-side,#000_35%,transparent_100%)] dark:text-brand-light dark:opacity-[0.1] dark:sm:opacity-[0.18]"
        >
          <path d={THREAD} pathLength={1} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" className="draw-on-load" />
        </svg>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-16 h-2/3 rounded-full bg-brand/25 blur-[90px] dark:bg-brand/30" />
        <div className="scroll-zoom relative">
          <div className="motion-safe:animate-[rise_1s_cubic-bezier(0.2,0.7,0.2,1)_both]" style={{ animationDelay: '0.8s' }}>
            <HeroChat texts={chat} />
          </div>
        </div>
      </div>
    </section>
  )
}
