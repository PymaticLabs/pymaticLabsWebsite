import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import SectionHeader from '@/components/section-header'

export default function WhatIs() {
  const t = useTranslations('whatIs')
  const is = t.raw('is') as string[]
  const isNot = t.raw('isNot') as string[]

  return (
    <section className="py-20 sm:py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <SectionHeader eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="rounded-2xl border border-brand/20 bg-brand-soft/60 p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-ink mb-5">{t('isTitle')}</h3>
            <ul className="space-y-4">
              {is.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check className="h-5 w-5 shrink-0 text-brand mt-0.5" aria-hidden="true" />
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-paper-2 p-6 sm:p-8">
            <h3 className="text-xl font-semibold text-ink mb-5">{t('isNotTitle')}</h3>
            <ul className="space-y-4">
              {isNot.map((item) => (
                <li key={item} className="flex gap-3">
                  <X className="h-5 w-5 shrink-0 text-muted mt-0.5" aria-hidden="true" />
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
