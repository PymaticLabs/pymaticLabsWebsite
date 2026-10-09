import Link from 'next/link'
import { useTranslations, useLocale } from 'next-intl'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { localePath } from '@/lib/i18n'

// La promesa va literal, sin tocar una coma (promesa-de-privacidad-del-cerebro-digital.md, 02-10-2026).
export default function PrivacyPromise() {
  const t = useTranslations('promise')
  const locale = useLocale()

  return (
    <section className="py-20 sm:py-24 bg-ink text-white">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-brand-light mb-3">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          {t('eyebrow')}
        </div>
        <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-8">{t('title')}</h2>
        <blockquote className="border-l-4 border-brand pl-6 text-lg sm:text-xl leading-relaxed text-white/90">
          “{t('quote')}”
        </blockquote>
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <p className="text-sm text-white/60">{t('footnote')}</p>
          <Link
            href={localePath(locale, '/seguridad')}
            className="inline-flex items-center gap-2 font-semibold text-white hover:text-brand-light"
          >
            {t('link')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  )
}
