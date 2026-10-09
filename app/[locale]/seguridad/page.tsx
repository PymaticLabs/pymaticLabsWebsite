import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, Mail, ShieldCheck } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { renderContent } from '@/lib/markdown'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return generatePageMetadata({
    title: t('securityTitle'),
    description: t('securityDescription'),
    path: '/seguridad',
    locale,
  })
}

export default async function SeguridadPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'security' })
  const tPromise = await getTranslations({ locale, namespace: 'promise' })

  const behind = t.raw('behind') as string[]
  const also = t.raw('also') as string[]
  const policyHtml = renderContent('legal', locale, 'politica-de-vulnerabilidades')

  return (
    <>
      <section className="pt-32 pb-16 bg-gradient-to-b from-brand-soft to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader as="h1" eyebrow={t('eyebrow')} title={t('title')} subtitle={t('subtitle')} className="mb-0" />
        </div>
      </section>

      <section className="pb-16">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold text-ink mb-5">
              <ShieldCheck className="h-6 w-6 text-brand" aria-hidden="true" />
              {t('promiseTitle')}
            </h2>
            <blockquote className="rounded-2xl bg-ink p-6 sm:p-8 text-lg leading-relaxed text-white/90">
              “{tPromise('quote')}”
            </blockquote>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-ink mb-5">{t('behindTitle')}</h2>
            <ul className="space-y-3">
              {behind.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check className="h-5 w-5 shrink-0 text-brand mt-0.5" aria-hidden="true" />
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted leading-relaxed">{t('behindNote')}</p>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-ink mb-5">{t('alsoTitle')}</h2>
            <ul className="space-y-3">
              {also.map((item) => (
                <li key={item} className="flex gap-3">
                  <Check className="h-5 w-5 shrink-0 text-brand mt-0.5" aria-hidden="true" />
                  <span className="text-body leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-brand/20 bg-brand-soft p-6 sm:flex sm:items-center sm:justify-between gap-6">
            <div>
              <h2 className="text-lg font-semibold text-ink">{t('reportTitle')}</h2>
              <p className="mt-1 text-body">{t('reportText')}</p>
            </div>
            <Button className="mt-4 sm:mt-0 shrink-0" asChild>
              <a href={`mailto:info@pymaticlabs.com?subject=${locale === 'en' ? 'Security' : 'Seguridad'}`}>
                <Mail className="h-4 w-4" aria-hidden="true" />
                {t('reportCta')}
              </a>
            </Button>
          </div>
        </div>
      </section>

      <section className="py-16 bg-paper-2" id="vulnerabilidades">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <h2 className="text-3xl font-bold tracking-tight text-ink">{t('policyTitle')}</h2>
            <Badge variant="accent">{t('draftBadge')}</Badge>
          </div>
          <p className="text-sm text-muted mb-8">{t('draftNote')}</p>
          <div className="prose-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
        </div>
      </section>
    </>
  )
}
