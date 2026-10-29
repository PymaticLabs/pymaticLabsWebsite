import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'

// Precios en corto, como se comparan dos modelos: las cuatro modalidades caben en dos caminos (lo montas tu
// o te lo montamos), cada uno para una persona y, debajo, con equipo. Y tres datos grandes. El detalle y la
// compra, en /precios. Sin plazas de lanzamiento (launchOpen false, como /precios), solo el precio de lista.
export default function PricingTeaser({ launchOpen = true }: { launchOpen?: boolean }) {
  const t = useTranslations('home.pricing')
  const tOffer = useTranslations('offer')
  const locale = useLocale()
  const paths = modalities.filter((m) => !m.team)
  const stats = t.raw('stats') as { value: string; text: string }[]

  return (
    <section id="precio" className="bg-paper-2 py-24 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-[2.75rem] font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">
            {t('title')} <span className="text-gradient">{t('titleAccent')}</span>
          </h2>
          <p className="mt-5 text-xl leading-relaxed text-muted sm:text-2xl">{t('subtitle')}</p>
          {launchOpen && <p className="mt-7 inline-flex rounded-full bg-brand-soft px-4 py-1.5 text-sm font-semibold text-brand">{t('launch')}</p>}
        </div>

        <div className="mx-auto mt-14 grid max-w-4xl gap-5 md:grid-cols-2">
          {paths.map((modality, i) => {
            const team = modalities.find((m) => m.team && m.guided === modality.guided)
            return (
              <div
                key={modality.id}
                data-reveal
                style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}
                className="flex flex-col items-center rounded-[28px] bg-surface px-7 py-10 text-center dark:bg-white/[0.04] dark:ring-1 dark:ring-white/10 sm:px-10 sm:py-12"
              >
                <h3 className="text-3xl font-bold tracking-[-0.03em] text-ink">{tOffer(`modalities.${modality.id}.name`)}</h3>
                {/* Siempre el alto de tres lineas, para que los precios de las dos queden a la misma altura */}
                <p className="mt-3 max-w-sm text-lg leading-snug text-muted md:min-h-[4.75rem]">{t(`texts.${modality.id}`)}</p>
                <p className="mt-8 text-6xl font-bold tracking-[-0.045em] text-ink">{formatPrice(launchOpen ? modality.launchPrice : modality.listPrice, locale)}</p>
                {/* Cada dato entero en su linea: en el movil no se parte por la mitad */}
                <p className="mt-2 text-sm text-muted">
                  {launchOpen && (
                    <>
                      <span className="whitespace-nowrap">
                        {tOffer('list')}: <s>{formatPrice(modality.listPrice, locale)}</s>
                      </span>{' '}
                      ·{' '}
                    </>
                  )}
                  <span className="whitespace-nowrap">{tOffer('oneOff')}</span> ·{' '}
                  <span className="whitespace-nowrap">{tOffer(`modalities.${modality.id}.people`)}</span>
                </p>
                {team && (
                  <p className="mt-6 text-base text-ink">
                    <Users className="mr-2 inline h-5 w-5 align-[-4px] text-brand" aria-hidden="true" />
                    {t('team', { price: formatPrice(launchOpen ? team.launchPrice : team.listPrice, locale) })}
                  </p>
                )}
                <Button size="lg" className="mt-8 h-12 px-8 text-[17px]" asChild>
                  <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
                </Button>
              </div>
            )
          })}
        </div>

        <dl className="mx-auto mt-16 grid max-w-4xl gap-10 text-center sm:mt-20 sm:grid-cols-3">
          {stats.map((stat, i) => (
            <div key={stat.value} data-reveal style={{ '--delay': `${i * 0.1}s` } as React.CSSProperties}>
              <dt className="text-4xl font-bold tracking-[-0.035em] text-ink">{stat.value}</dt>
              <dd className="mx-auto mt-2 max-w-[16rem] text-base leading-relaxed text-muted">{stat.text}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-12 text-center text-sm text-muted">{t('note')}</p>
      </div>
    </section>
  )
}
