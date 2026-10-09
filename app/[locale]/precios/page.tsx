import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, Minus } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import ModalityCard from '@/components/pricing/modality-card'
import FaqList from '@/components/faq-list'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { isCheckoutOpen, paymentLinks } from '@/lib/checkout'
import {
  CUSTOM_FROM_PRICE,
  PACK_ESPANA_PRICE,
  formatPrice,
  modalities,
  plans,
  type Modality,
} from '@/lib/offer'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  return generatePageMetadata({
    title: t('pricingTitle'),
    description: t('pricingDescription'),
    path: '/precios',
    locale,
  })
}

export default async function PreciosPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'pricing' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })

  const included = t.raw('included') as string[]
  const sessions = t.raw('sessions.items') as string[]
  const rows = t.raw('monthly.rows') as { label: string; values: boolean[] }[]

  return (
    <>
      <section className="pt-32 pb-16 bg-gradient-to-b from-brand-soft to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader as="h1" title={t('title')} subtitle={t('subtitle')} />

          <div className="mb-8 rounded-2xl border border-brand/20 bg-white p-5 sm:flex sm:items-center sm:justify-between gap-6">
            <p className="font-semibold text-ink">{tOffer('launchNote')}</p>
            <ul className="mt-3 sm:mt-0 flex flex-wrap gap-x-5 gap-y-1">
              <li className="text-sm text-muted">{t('includedTitle')}:</li>
              {included.map((item) => (
                <li key={item} className="flex items-center gap-1.5 text-sm text-ink">
                  <Check className="h-4 w-4 text-brand" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {modalities.map((modality) => (
              <ModalityCard
                key={modality.id}
                modality={modality}
                extras={t.raw(`extras.${modality.id}`) as string[]}
                highlighted={modality.id === 'acompanado'}
              >
                <BuyAction modality={modality} locale={locale} t={t} />
              </ModalityCard>
            ))}
          </div>

          <div className="mt-6 space-y-1 text-center text-sm text-muted">
            {!isCheckoutOpen() && <p className="font-medium text-ink">{t('comingSoonNote')}</p>}
            <p>{t('markets')}</p>
            <p>{t('b2b')}</p>
          </div>
        </div>
      </section>

      {/* Sesiones y garantia */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('sessions.title')} />
          <ul className="space-y-4">
            {sessions.map((item) => (
              <li key={item} className="flex gap-3">
                <Check className="h-5 w-5 shrink-0 text-brand mt-0.5" aria-hidden="true" />
                <span className="text-body leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Mensual */}
      <section className="py-16 sm:py-20 bg-paper-2" id="mensual">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('monthly.title')} subtitle={t('monthly.subtitle')} />
          <div className="overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="p-4 text-left font-medium text-muted">
                    {t('monthly.feature')}
                  </th>
                  {plans.map((plan) => (
                    <th key={plan.id} scope="col" className="p-4 text-center">
                      <span className="block text-base font-semibold text-ink">{tOffer(`plans.${plan.id}`)}</span>
                      <span className="block text-2xl font-bold text-ink mt-1">
                        {formatPrice(plan.monthly, locale)}
                        <span className="text-sm font-normal text-muted">{t('monthly.perMonth')}</span>
                      </span>
                      <span className="block text-xs font-normal text-muted">{tOffer('noVat')}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-line last:border-0">
                    <th scope="row" className="p-4 text-left font-normal text-body">
                      {row.label}
                    </th>
                    {row.values.map((value, i) => (
                      <td key={plans[i].id} className="p-4 text-center">
                        {value ? (
                          <Check className="mx-auto h-5 w-5 text-brand" aria-label="✓" />
                        ) : (
                          <Minus className="mx-auto h-5 w-5 text-line" aria-label="—" />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 space-y-3 text-sm text-body">
            <p className="font-medium text-ink">{t('monthly.included')}</p>
            <p>{t('monthly.securityNote')}</p>
            <p className="text-muted">
              <strong className="text-ink">{tOffer('plans.premium')}.</strong> {t('monthly.premiumNote')}
            </p>
          </div>
        </div>
      </section>

      {/* Aparte */}
      <section className="py-16 sm:py-20">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('apart.title')} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-2xl border border-line p-6">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-semibold text-ink">{t('apart.packEspana.name')}</h3>
                <Badge variant="accent">{t('apart.packEspana.badge')}</Badge>
              </div>
              <p className="mt-2 text-2xl font-bold text-ink">
                {formatPrice(PACK_ESPANA_PRICE, locale)}{' '}
                <span className="text-sm font-normal text-muted">{tOffer('noVat')}</span>
              </p>
              <p className="mt-3 text-body leading-relaxed">{t('apart.packEspana.text')}</p>
            </div>
            <div className="rounded-2xl border border-line p-6 flex flex-col">
              <h3 className="text-xl font-semibold text-ink">{t('apart.custom.name')}</h3>
              <p className="mt-2 text-2xl font-bold text-ink">
                <span className="text-base font-normal text-muted">{t('apart.custom.from')} </span>
                {formatPrice(CUSTOM_FROM_PRICE, locale)}{' '}
                <span className="text-sm font-normal text-muted">{tOffer('noVat')}</span>
              </p>
              <p className="mt-3 text-body leading-relaxed flex-1">{t('apart.custom.text')}</p>
              <div className="mt-5">
                <Button variant="outline" asChild>
                  <Link href={`${localePath(locale, '/contacto')}?interes=a-medida`}>{t('apart.custom.cta')}</Link>
                </Button>
              </div>
            </div>
          </div>
          <p className="mt-6 text-center text-body">{t('apart.moreThan10')}</p>
        </div>
      </section>

      <FaqList title={t('faqTitle')} items={t.raw('faq')} className="py-16 sm:py-20 bg-paper-2" />
    </>
  )
}

function BuyAction({
  modality,
  locale,
  t,
}: {
  modality: Modality
  locale: string
  t: Awaited<ReturnType<typeof getTranslations<'pricing'>>>
}) {
  const contactHref = `${localePath(locale, '/contacto')}?interes=${modality.id}`
  const paymentLink = paymentLinks()[modality.id]

  // Hazlo tu: enlace de pago de Stripe. Acompañado: factura de Holded primero.
  if (isCheckoutOpen() && (modality.guided || paymentLink)) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">{modality.guided ? t('payWith.invoice') : t('payWith.card')}</p>
        <Button className="w-full" asChild>
          {modality.guided || !paymentLink ? (
            <Link href={contactHref}>{t('requestInvoice')}</Link>
          ) : (
            <a href={paymentLink.url}>{t('buy')}</a>
          )}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{modality.guided ? t('payWith.invoice') : t('payWith.card')}</p>
      <Button className="w-full" variant="outline" disabled>
        {t('comingSoon')}
      </Button>
      <Button className="w-full" asChild>
        <Link href={contactHref}>{t('notifyMe')}</Link>
      </Button>
    </div>
  )
}
