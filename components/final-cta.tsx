import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'

export default function FinalCta() {
  const t = useTranslations('finalCta')
  const locale = useLocale()

  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl bg-brand px-6 py-14 sm:px-12 text-center text-white">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('title')}</h2>
          <p className="mt-4 text-lg text-white/85">{t('subtitle')}</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <Button size="lg" variant="outline" className="border-white" asChild>
              <Link href={localePath(locale, '/precios')}>{t('primary')}</Link>
            </Button>
            <Button size="lg" variant="accent" asChild>
              <Link href={localePath(locale, '/contacto')}>{t('secondary')}</Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
