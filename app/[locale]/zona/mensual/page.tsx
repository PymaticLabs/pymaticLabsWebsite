import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, CreditCard, LifeBuoy, ShieldCheck } from 'lucide-react'
import ZoneFrame from '@/components/zone/zone-frame'
import { Card, Notice, PageTitle } from '@/components/zone/zone-ui'
import { Button } from '@/components/ui/button'
import { isCheckoutOpen } from '@/lib/checkout'
import { formatDate } from '@/lib/delivery/emails'
import { addDays } from '@/lib/delivery/util'
import { generatePageMetadata } from '@/lib/metadata'
import { formatPrice, plans } from '@/lib/offer'
import { loadZone } from '@/lib/zone-page'
import { monthlyState, planName } from '@/lib/zone-view'

// El mensual (solo quien compro): en que punto esta su mantenimiento y soporte y, segun el caso, el
// portal de cliente de Stripe (tarjeta, plan, cancelar) o los tres planes para contratarlo. Si aun le
// quedan meses incluidos, el primer cobro llega cuando acaban (lib/checkout.ts, trialEndFor).

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

const ERRORS = ['closed', 'company_required', 'already_subscribed', 'unavailable', 'product', 'rate_limited'] as const

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('monthly.title'), description: t('meta.description'), path: '/zona/mensual', locale, noindex: true })
}

export default async function MensualPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string; error?: string }> }) {
  const { locale } = await params
  const { empresa, error } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/mensual', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="mensual" />

  const t = await getTranslations({ locale, namespace: 'zone' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })
  const tPricing = await getTranslations({ locale, namespace: 'pricing.monthly' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data } = state

  if (data.role !== 'owner') {
    return (
      <ZoneFrame locale={locale} state={state} section="mensual">
        <PageTitle title={t('monthly.title')} />
        <div className="mt-8 max-w-3xl">
          <Notice>{t('ownerOnly')}</Notice>
        </div>
      </ZoneFrame>
    )
  }

  const monthly = monthlyState(data, new Date())
  const errorKey = ERRORS.find((e) => e === error)
  const rows = tPricing.raw('rows') as { label: string; values: boolean[] }[]
  const open = isCheckoutOpen()

  return (
    <ZoneFrame locale={locale} state={state} section="mensual">
      <PageTitle title={t('monthly.title')} intro={t('monthly.intro')} />

      <div className="mt-8 max-w-3xl space-y-6">
        {errorKey && (
          <Notice tone="warning" role="alert">
            {t(`monthly.errors.${errorKey}`)}
          </Notice>
        )}

        <Card icon={LifeBuoy} title={t('monthly.statusTitle')}>
          {monthly.kind === 'subscribed' ? (
            <>
              <p className="text-lg font-medium text-ink">{t('monthly.subscribed', { plan: planName(monthly.product, tOffer) })}</p>
              <p>{t(`monthly.statuses.${['active', 'trialing', 'past_due', 'unpaid', 'paused'].includes(monthly.status) ? monthly.status : 'active'}`)}</p>
              {monthly.supportUntil && <p>{t('monthly.licenseUntil', { date: formatDate(monthly.supportUntil, loc) })}</p>}
            </>
          ) : monthly.kind === 'included' ? (
            <>
              <p className="text-lg font-medium text-ink">{t('monthly.included', { date: formatDate(monthly.supportUntil, loc) })}</p>
              <p>
                {data.company.subscription.coveredBy
                  ? t('monthly.includedNextPlan', { plan: planName(data.company.subscription.coveredBy, tOffer), date: formatDate(addDays(monthly.supportUntil, 1), loc) })
                  : t('monthly.includedNext', { date: formatDate(addDays(monthly.supportUntil, 1), loc) })}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-medium text-ink">{t('monthly.none')}</p>
              <p>{t('monthly.noneText')}</p>
            </>
          )}
          {monthly.kind === 'subscribed' && data.company.canOpenPortal && (
            <form action="/api/zone/portal" method="post" className="pt-2">
              <input type="hidden" name="company" value={data.company.id} />
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" size="lg">
                <CreditCard className="h-5 w-5" aria-hidden="true" />
                {t('monthly.portal')}
              </Button>
              <p className="mt-3 text-sm text-muted">{t('monthly.portalNote')}</p>
            </form>
          )}
        </Card>

        <Notice>
          <span className="inline-flex items-center gap-2 font-medium">
            <ShieldCheck className="h-5 w-5 text-brand" aria-hidden="true" />
            {t('monthly.securityTitle')}
          </span>
          <p>{t('monthly.security')}</p>
        </Notice>
      </div>

      {monthly.kind !== 'subscribed' && (
        <section className="mt-10">
          <h2 className="text-2xl font-bold tracking-tight text-ink">{t('monthly.plansTitle')}</h2>
          <p className="mt-2 max-w-3xl text-base text-body">{open ? t('monthly.plansText') : t('monthly.plansClosed')}</p>
          <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
            {plans.map((plan, index) => (
              <div key={plan.id} className="flex flex-col rounded-2xl border border-line bg-surface p-6">
                <h3 className="text-xl font-semibold text-ink">{t('monthly.planName', { plan: tOffer(`plans.${plan.id}`) })}</h3>
                <p className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-ink">{formatPrice(plan.monthly, locale)}</span>
                  <span className="text-sm text-muted">{t('monthly.perMonth')}</span>
                </p>
                <ul className="mt-5 flex-1 space-y-2">
                  {rows
                    .filter((row) => row.values[index])
                    .map((row) => (
                      <li key={row.label} className="flex gap-2 text-base text-body">
                        <Check className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden="true" />
                        {row.label}
                      </li>
                    ))}
                </ul>
                {open && (
                  <form action="/api/checkout" method="post" className="mt-6">
                    <input type="hidden" name="product" value={`plan-${plan.id}`} />
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="company" value={data.company.id} />
                    <Button type="submit" size="lg" variant={plan.id === 'pro' ? 'default' : 'outline'} className="w-full">
                      {t('monthly.subscribe', { plan: tOffer(`plans.${plan.id}`) })}
                    </Button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </ZoneFrame>
  )
}
