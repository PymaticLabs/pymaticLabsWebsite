import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Users } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPrice, modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'
import { cn } from '@/lib/utils'

// Precios en corto: las cuatro modalidades caben en dos caminos (lo montas tu o te lo montamos), cada uno
// para una persona y, debajo, con equipo. El detalle y la compra, en /precios.
export default function PricingTeaser() {
  const t = useTranslations('home.pricing')
  const tOffer = useTranslations('offer')
  const locale = useLocale()
  const paths = modalities.filter((m) => !m.team)

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t('title')} subtitle={t('subtitle')} className="mb-6" />
        <div className="mb-10 text-center">
          <Badge variant="accent" className="px-3.5 py-1 text-sm">
            {t('launch')}
          </Badge>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {paths.map((modality) => {
            const team = modalities.find((m) => m.team && m.guided === modality.guided)
            return (
              <div
                key={modality.id}
                className={cn(
                  'flex flex-col rounded-3xl border bg-surface p-6 sm:p-8',
                  modality.guided ? 'border-brand shadow-lg shadow-brand/10 ring-1 ring-brand' : 'border-line'
                )}
              >
                <h3 className="text-2xl font-bold text-ink">{tOffer(`modalities.${modality.id}.name`)}</h3>
                {/* Dos lineas siempre, para que los precios de las dos queden a la misma altura */}
                <p className="mt-2 text-base leading-relaxed text-body md:min-h-[3.25rem]">{t(`texts.${modality.id}`)}</p>
                <p className="mt-6 flex items-baseline gap-2">
                  <span className="text-5xl font-bold tracking-tight text-ink">{formatPrice(modality.launchPrice, locale)}</span>
                  <span className="text-sm text-muted">{tOffer('noVat')}</span>
                </p>
                <p className="mt-1 text-sm text-muted">
                  {tOffer('list')}: <s>{formatPrice(modality.listPrice, locale)}</s> · {tOffer('oneOff')} ·{' '}
                  {tOffer(`modalities.${modality.id}.people`)}
                </p>
                {team && (
                  <p className="mt-auto flex items-center gap-2 pt-6 text-base text-ink">
                    <Users className="h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                    {t('team', { price: formatPrice(team.launchPrice, locale) })}
                  </p>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-10 flex flex-col items-center gap-5 text-center">
          <Button size="lg" asChild>
            <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
          </Button>
          <p className="text-sm text-muted">{t('note')}</p>
        </div>
      </div>
    </section>
  )
}
