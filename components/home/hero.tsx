import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { localePath } from '@/lib/i18n'
import Demo from '@/components/home/demo'

export default function Hero() {
  const t = useTranslations('hero')
  const locale = useLocale()
  const badges = t.raw('badges') as string[]

  return (
    <section className="relative overflow-hidden pt-28 pb-20 sm:pt-36">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-brand-soft to-transparent"
      />
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
        <div className="space-y-6">
          <p className="inline-flex items-center gap-2 rounded-full border border-brand/20 bg-white px-3 py-1 text-sm font-medium text-brand">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden="true" />
            {t('eyebrow')}
          </p>
          <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-bold tracking-tight text-ink leading-[1.08]">
            {t('title')}
          </h1>
          <p className="text-lg text-body leading-relaxed max-w-xl">{t('subtitle')}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            <Button size="lg" asChild>
              <Link href={localePath(locale, '/precios')}>{t('ctaPrimary')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="#demo">{t('ctaSecondary')}</a>
            </Button>
          </div>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-2">
            {badges.map((badge) => (
              <li key={badge} className="flex items-center gap-1.5 text-sm text-ink">
                <Check className="h-4 w-4 text-brand" aria-hidden="true" />
                {badge}
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t('note')}</p>
        </div>

        <div id="demo" className="scroll-mt-24">
          <Demo />
        </div>
      </div>
    </section>
  )
}
