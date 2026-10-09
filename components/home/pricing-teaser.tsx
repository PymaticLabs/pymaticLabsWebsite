import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import SectionHeader from '@/components/section-header'
import ModalityCard from '@/components/pricing/modality-card'
import { modalities } from '@/lib/offer'
import { localePath } from '@/lib/i18n'

export default function PricingTeaser() {
  const t = useTranslations('pricingTeaser')
  const tOffer = useTranslations('offer')
  const locale = useLocale()

  return (
    <section className="py-20 sm:py-24 bg-paper-2">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {modalities.map((modality) => (
            <ModalityCard key={modality.id} modality={modality} />
          ))}
        </div>
        <p className="mt-6 text-center text-sm text-muted">{tOffer('launchNote')}</p>
        <div className="mt-8 text-center">
          <Button size="lg" asChild>
            <Link href={localePath(locale, '/precios')}>{t('cta')}</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
