import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Download, FileText, ScrollText } from 'lucide-react'
import ZoneFrame from '@/components/zone/zone-frame'
import { ButtonLink, Card, Notice, PageTitle } from '@/components/zone/zone-ui'
import { formatDate } from '@/lib/delivery/emails'
import { productName } from '@/lib/delivery/products'
import { formatMoney } from '@/lib/delivery/util'
import { generatePageMetadata } from '@/lib/metadata'
import { loadZone } from '@/lib/zone-page'

// Facturas y compras (solo quien compro): el PDF de cada factura y rectificativa emitida en Holded,
// por un enlace que caduca en minutos, y por compra, la copia de las condiciones que acepto.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('invoices.title'), description: t('meta.description'), path: '/zona/facturas', locale, noindex: true })
}

export default async function FacturasPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string }> }) {
  const { locale } = await params
  const { empresa } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/facturas', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="facturas" />

  const t = await getTranslations({ locale, namespace: 'zone' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data } = state
  const dateFormat = new Intl.DateTimeFormat(loc === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' })
  const day = (iso: string) => dateFormat.format(new Date(iso))

  if (data.role !== 'owner') {
    return (
      <ZoneFrame locale={locale} state={state} section="facturas">
        <PageTitle title={t('invoices.title')} />
        <div className="mt-8 max-w-3xl">
          <Notice>{t('ownerOnly')}</Notice>
        </div>
      </ZoneFrame>
    )
  }

  const invoices = [...data.invoices].sort((a, b) => b.date.localeCompare(a.date))
  const purchases = [...data.purchases].sort((a, b) => b.paidAt.localeCompare(a.paidAt))

  return (
    <ZoneFrame locale={locale} state={state} section="facturas">
      <PageTitle title={t('invoices.title')} intro={t('invoices.intro')} />

      <div className="mt-8 max-w-3xl space-y-6">
        {data.pendingInvoices > 0 && <Notice role="status">{t('invoices.pending', { count: data.pendingInvoices })}</Notice>}

        <Card icon={FileText} title={t('invoices.listTitle')}>
          {invoices.length === 0 ? (
            <p>{t('invoices.empty')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium text-ink">
                      {t(`invoices.kinds.${invoice.kind}`)} {invoice.number ?? ''}
                    </p>
                    <p className="text-sm text-body">
                      {day(invoice.date)} · {formatMoney(invoice.amountTotal, invoice.currency, loc)}
                    </p>
                  </div>
                  {invoice.downloadable ? (
                    <ButtonLink href={`/api/zone/invoices/${encodeURIComponent(invoice.id)}`} variant="outline">
                      <Download className="h-5 w-5" aria-hidden="true" />
                      {t('invoices.download')}
                    </ButtonLink>
                  ) : (
                    <span className="text-sm text-muted">{t('invoices.preparing')}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card icon={ScrollText} title={t('invoices.purchasesTitle')}>
          <p>{t('invoices.purchasesText')}</p>
          <ul className="divide-y divide-line">
            {purchases.map((purchase) => (
              <li key={purchase.id} className="flex flex-wrap items-center justify-between gap-3 py-4 last:pb-0">
                <div>
                  <p className="font-medium text-ink">{productName(purchase.product, loc)}</p>
                  <p className="text-sm text-body">
                    {day(purchase.paidAt)} · {formatMoney(purchase.amountTotal, purchase.currency, loc)} · {t(`invoices.status.${purchase.status}`)}
                  </p>
                </div>
                {purchase.termsVersion && (
                  <ButtonLink href={`/api/zone/terms/${encodeURIComponent(purchase.id)}`} variant="outline" download>
                    {t('invoices.terms', { version: /^\d{4}-\d{2}-\d{2}$/.test(purchase.termsVersion) ? formatDate(purchase.termsVersion, loc) : purchase.termsVersion })}
                  </ButtonLink>
                )}
              </li>
            ))}
          </ul>
        </Card>

        <p className="text-base text-body">{t('invoices.taxNote')}</p>
      </div>
    </ZoneFrame>
  )
}
