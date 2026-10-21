import { useTranslations } from 'next-intl'
import { Check, X } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { CerebroIcon } from '@/components/cerebro-icon'

// "¿Te suena?": lo que pasa hoy en la empresa y, al lado, lo que cambia con el cerebro, fila a fila. En el
// movil cada fila va una debajo de otra, con su etiqueta.
export default function Compare() {
  const t = useTranslations('home.compare')
  const rows = t.raw('rows') as [string, string][]

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <SectionHeader title={t('title')} subtitle={t('subtitle')} />
        <div className="overflow-hidden rounded-3xl border border-line bg-surface">
          <div className="hidden grid-cols-2 border-b border-line md:grid" aria-hidden="true">
            <p className="px-6 py-4 text-sm font-semibold uppercase tracking-wider text-muted">{t('before')}</p>
            <p className="flex items-center gap-2.5 bg-brand-soft px-6 py-4 text-sm font-semibold uppercase tracking-wider text-brand">
              <CerebroIcon className="h-6 w-6" />
              {t('after')}
            </p>
          </div>
          <ul className="divide-y divide-line">
            {rows.map(([before, after]) => (
              <li key={before} className="grid md:grid-cols-2">
                <div className="flex gap-3 px-6 py-5">
                  <X className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                  <p className="text-base leading-relaxed text-body">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted md:sr-only">{t('before')}</span>
                    {before}
                  </p>
                </div>
                <div className="flex gap-3 bg-brand-soft px-6 py-5">
                  <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                  <p className="text-base font-medium leading-relaxed text-ink">
                    <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-brand md:sr-only">{t('after')}</span>
                    {after}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
