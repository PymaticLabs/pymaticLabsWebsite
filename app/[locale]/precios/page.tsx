import { Fragment } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Check, Minus } from 'lucide-react'
import SectionHeader from '@/components/section-header'
import PlanFamilies from '@/components/pricing/plan-families'
import { LaunchOffer } from '@/components/pricing/launch-offer'
import Reveals from '@/components/home/reveals'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { isCheckoutOpen } from '@/lib/checkout'
import { CUSTOM_FROM_PRICE, formatPrice, modalities, plans, type Modality } from '@/lib/offer'
import { formatMonthYear, offerStatus } from './offer-status'

// Estatica, rehecha cada 5 minutos: lee cuantas plazas de lanzamiento quedan (sin ninguna, solo el precio
// de lista) y hasta cuando tiene correcciones de seguridad la version que se vende (./offer-status.ts).
export const revalidate = 300

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'meta' })
  // Sin plazas de lanzamiento, el «desde 500 € (precio de lanzamiento)» ya no vale: el de lista.
  const { launchOpen } = await offerStatus()
  const from = Math.min(...modalities.map((m) => m.listPrice))
  return generatePageMetadata({
    title: t('pricingTitle'),
    description: launchOpen ? t('pricingDescription') : t('pricingDescriptionList', { price: formatPrice(from, locale) }),
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
  const { launchOpen, launchLeft, security } = await offerStatus()

  return (
    <>
      {/* El degradado deja ver el hilo del fondo (ver body::before en globals.css) */}
      <section className="pt-24 pb-14 bg-gradient-to-b from-brand-soft/70 to-transparent sm:pt-40 sm:pb-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-3xl text-center">
            {/* En el movil, cada frase en su linea («Pagas una vez.» / «Es tuyo.»), no partida por la mitad */}
            <h1 className="text-balance text-section font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">
              {t('title')
                .split(/(?<=\.) /)
                .map((sentence, i) => (
                  <Fragment key={i}>
                    {i > 0 && ' '}
                    <span className="block sm:inline">{sentence}</span>
                  </Fragment>
                ))}
            </h1>
            <p className="mt-5 text-pretty text-xl leading-relaxed text-muted sm:text-2xl">{t('subtitle')}</p>
          </div>

          {/* Cuantas de las 10 licencias de lanzamiento quedan; sin ninguna, una linea y el precio de lista */}
          <LaunchOffer left={launchLeft} className="mx-auto mt-12 max-w-5xl sm:mt-16" />

          <div className="mt-10 sm:mt-14">
            <PlanFamilies
              launchOpen={launchOpen}
              extras={(modality) => t.raw(`extras.${modality.id}`) as string[]}
              action={(modality) => <BuyAction modality={modality} locale={locale} t={t} />}
            />
          </div>

          {/* Lo que llevan las cuatro, en una linea bajo las tarjetas; en el movil, una lista alineada a la
              izquierda (centrada y partida en varias lineas no se leia) */}
          <ul className="mx-auto mt-8 flex max-w-md flex-col gap-2.5 sm:max-w-4xl sm:flex-row sm:flex-wrap sm:justify-center sm:gap-x-6 sm:gap-y-2">
            <li className="text-sm text-muted">{t('includedTitle')}:</li>
            {included.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-ink sm:items-center sm:gap-1.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand sm:mt-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>

          <div className="mx-auto mt-6 max-w-md space-y-2 text-pretty text-sm text-muted sm:max-w-none sm:space-y-1 sm:text-center">
            {!isCheckoutOpen() && <p className="font-medium text-ink">{t('comingSoonNote')}</p>}
            {/* A quien se vende y, debajo, el IVA de cada caso: lo unico que lo dice en la pagina */}
            <p>{t('b2b')}</p>
            <p>{t('markets')}</p>
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
      <section className="py-16 sm:py-20 bg-band" id="mensual">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('monthly.title')} subtitle={t('monthly.subtitle')} />
          {/* En el movil, una tarjeta por plan con lo que incluye (la tabla no cabe: Pro y Premium quedarian fuera) */}
          <ul className="space-y-4 sm:hidden">
            {plans.map((plan, i) => (
              <li key={plan.id} className="rounded-2xl border border-line bg-surface p-5">
                <h3 className="text-lg font-semibold text-ink">{tOffer(`plans.${plan.id}`)}</h3>
                <p className="mt-1 text-2xl font-bold text-ink">
                  {formatPrice(plan.monthly, locale)}
                  <span className="text-sm font-normal text-muted">{t('monthly.perMonth')}</span>
                </p>
                <p className="text-sm text-muted">
                  {t('monthly.perYear', { price: formatPrice(plan.yearly, locale) })} · {tOffer('noVat')}
                </p>
                <ul className="mt-4 space-y-2">
                  {rows
                    .filter((row) => row.values[i])
                    .map((row) => (
                      <li key={row.label} className="flex gap-2 text-sm text-body">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                        {row.label}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-line bg-surface sm:block">
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
                      <span className="block text-xs font-normal text-muted">
                        {t('monthly.perYear', { price: formatPrice(plan.yearly, locale) })}
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
                          <Check className="mx-auto h-5 w-5 text-brand" aria-hidden="true" />
                        ) : (
                          <Minus className="mx-auto h-5 w-5 text-field" aria-hidden="true" />
                        )}
                        <span className="sr-only">{value ? t('monthly.yes') : t('monthly.no')}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 space-y-3 text-sm text-body">
            <p className="font-medium text-ink">{t('monthly.included')}</p>
            <p>{t('monthly.annualNote')}</p>
            <p>
              {t('monthly.securityNote')}{' '}
              {security
                ? t('monthly.securityUntil', { version: security.version, date: formatMonthYear(security.until, locale) })
                : t('monthly.securityPeriod')}
            </p>
            <p className="text-muted">
              <strong className="text-ink">{tOffer('plans.premium')}.</strong> {t('monthly.premiumNote')}
            </p>
          </div>
        </div>
      </section>

      {/* Aparte: solo el A medida, igual para todos (sin Pack Espana, socios 29-10-2026). Una tarjeta
          ancha: el texto a la izquierda y el boton a la derecha; en el movil, uno debajo del otro. */}
      <section className="py-16 sm:py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <SectionHeader title={t('apart.title')} />
          <div className="rounded-2xl border border-line bg-surface p-6 sm:p-8 sm:flex sm:items-center sm:justify-between sm:gap-8">
            <div>
              <h3 className="text-xl font-semibold text-ink">{t('apart.custom.name')}</h3>
              <p className="mt-2 text-2xl font-bold text-ink">
                <span className="text-base font-normal text-muted">{t('apart.custom.from')} </span>
                {formatPrice(CUSTOM_FROM_PRICE, locale)}{' '}
                <span className="text-sm font-normal text-muted">{tOffer('noVat')}</span>
              </p>
              <p className="mt-3 text-body leading-relaxed">{t('apart.custom.text')}</p>
            </div>
            <div className="mt-5 sm:mt-0 sm:shrink-0">
              <Button variant="outline" className="w-full sm:w-auto" asChild>
                <Link href={`${localePath(locale, '/contacto')}?interes=a-medida`}>{t('apart.custom.cta')}</Link>
              </Button>
            </div>
          </div>
          <p className="mt-6 text-center text-body">{t('apart.moreThan10')}</p>
        </div>
      </section>

      <Reveals />
    </>
  )
}

// En las tarjetas estrechas (cuatro en fila), un texto largo como «Elegir sesión y comprar» parte en dos
// lineas en vez de salirse del boton.
const BUY_BUTTON = 'h-auto min-h-11 w-full whitespace-normal py-2.5 text-balance'

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

  // Pago con Stripe Checkout, creado por el servidor (/api/checkout) desde /comprar/<modalidad>, que
  // pide antes los datos fiscales de la empresa (y, en el Acompañado, la primera sesión y con quién).
  if (isCheckoutOpen()) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-muted">{t('payWith.card')}</p>
        <Button className={BUY_BUTTON} asChild>
          <Link href={localePath(locale, `/comprar/${modality.id}`)}>{modality.guided ? t('chooseSession') : t('buy')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted">{t('payWith.card')}</p>
      <Button className={BUY_BUTTON} variant="outline" disabled>
        {t('comingSoon')}
      </Button>
      <Button className={BUY_BUTTON} asChild>
        <Link href={contactHref}>{t('notifyMe')}</Link>
      </Button>
    </div>
  )
}
