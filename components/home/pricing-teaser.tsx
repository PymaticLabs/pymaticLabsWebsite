import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { User, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LaunchBadge } from '@/components/pricing/launch-offer'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Precios en corto, como se comparan dos modelos: las dos familias (en solitario, lo montas tu; acompanado,
// te lo montamos), cada una con sus dos modalidades por su nombre (la de una persona y la de equipo), y
// cuantas licencias de lanzamiento quedan. La acompanada, en el azul suave, como en /precios. Y tres datos
// grandes. El detalle y la compra, en /precios. launchLeft: el de offerStatus (0: el precio de lista).
const FAMILIES = [
  { key: 'solo', guided: false },
  { key: 'guided', guided: true },
] as const

export default function PricingTeaser({ launchLeft = null }: { launchLeft?: number | null }) {
  const t = useTranslations('home.pricing')
  const tOffer = useTranslations('offer')
  const locale = useLocale()
  const launchOpen = launchLeft !== 0
  const stats = t.raw('stats') as { value: string; text: string }[]

  return (
    <section id="precio" className="bg-paper-2 py-16 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          {/* En el movil, cada frase en su linea («Pagas una vez.» / «Es tuyo.»), sin dejar una palabra suelta */}
          <h2 className="text-balance text-section font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">
            {t('title')} <span className="text-gradient block sm:inline">{t('titleAccent')}</span>
          </h2>
          <p className="mt-5 text-xl leading-relaxed text-muted sm:text-2xl">{t('subtitle')}</p>
          <LaunchBadge left={launchLeft} className="mt-7" />
        </div>

        <div className="mx-auto mt-10 grid max-w-4xl gap-4 sm:mt-14 sm:gap-5 md:grid-cols-2">
          {FAMILIES.map(({ key, guided }, i) => (
            <div
              key={key}
              data-reveal
              style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}
              className={cn(
                'flex flex-col items-center rounded-[28px] px-5 py-8 text-center sm:px-8 sm:py-12',
                guided ? 'bg-brand-soft ring-1 ring-inset ring-brand/15' : 'bg-surface dark:bg-white/[0.04] dark:ring-1 dark:ring-inset dark:ring-white/10'
              )}
            >
              <h3 className="text-3xl font-bold tracking-[-0.03em] text-ink">{tOffer(`families.${key}.name`)}</h3>
              {/* Siempre el alto de tres lineas, para que los precios de las dos queden a la misma altura */}
              <p className="mt-3 max-w-sm text-pretty text-lg leading-snug text-muted md:min-h-[4.75rem]">{tOffer(`families.${key}.text`)}</p>
              <dl className="mt-8 grid w-full grid-cols-2 gap-3">
                {modalities
                  .filter((modality) => modality.guided === guided)
                  .map((modality) => {
                    const PeopleIcon = modality.team ? Users : User
                    return (
                      <div key={modality.id} className="flex flex-col items-center">
                        <dt className="text-xl font-bold tracking-[-0.02em] text-ink">{tOffer(`modalities.${modality.id}.name`)}</dt>
                        <dd className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted sm:text-sm">
                          <PeopleIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          {tOffer(`modalities.${modality.id}.people`)}
                        </dd>
                        <dd className="mt-3 text-[2rem] font-bold tabular-nums leading-none tracking-[-0.04em] text-ink sm:text-4xl">
                          {formatPrice(launchOpen ? modality.launchPrice : modality.listPrice, locale)}
                        </dd>
                        {launchOpen && (
                          <dd className="mt-1.5 text-sm text-muted">
                            <span className="sr-only">{tOffer('list')}: </span>
                            <s className="tabular-nums">{formatPrice(modality.listPrice, locale)}</s>
                          </dd>
                        )}
                      </div>
                    )
                  })}
              </dl>
              <p className="mt-6 text-sm text-muted first-letter:uppercase">
                {tOffer('oneOff')} · {tOffer('noVat')}
              </p>
              <Button size="lg" className="mt-6 h-12 w-full px-8 text-[17px] sm:mt-8 sm:w-auto" asChild>
                <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
              </Button>
            </div>
          ))}
        </div>

        {/* En el movil, una tabla corta (el dato a la izquierda, lo que significa a la derecha) en vez de tres
            bloques grandes; los div pasan a contents para que las tres filas compartan columnas. */}
        <dl className="mx-auto mt-10 grid max-w-md grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-3 text-left sm:mt-20 sm:max-w-4xl sm:grid-cols-3 sm:items-start sm:gap-10 sm:text-center">
          {stats.map((stat, i) => (
            <div key={stat.value} data-reveal className="contents sm:block" style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}>
              <dt className="text-lg font-bold tracking-[-0.02em] text-ink sm:text-4xl sm:tracking-[-0.035em]">{stat.value}</dt>
              <dd className="text-[15px] leading-snug text-muted sm:mx-auto sm:mt-2 sm:max-w-[16rem] sm:text-base sm:leading-relaxed">{stat.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-8 text-center text-sm text-muted sm:mt-12">{t('note')}</p>
      </div>
    </section>
  )
}
