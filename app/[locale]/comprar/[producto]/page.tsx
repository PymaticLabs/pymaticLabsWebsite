import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { firstSessionSlots, isCheckoutOpen } from '@/lib/checkout'
import { getDelivery } from '@/lib/delivery/container'
import { hostName, isGuided, isOneTimeProduct, modality } from '@/lib/delivery/products'
import { formatPrice } from '@/lib/offer'
import type { Slot } from '@/lib/delivery/types'

// La pagina de compra de una modalidad: el resumen y el boton al pago de Stripe. En el Acompanado,
// antes se elige la primera sesion y con quien, entre los huecos libres de Cal.com (si las dos
// semanas siguientes estan llenas, salen los de la tercera). Los errores del pago vuelven aqui.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string; producto: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, producto } = await params
  const t = await getTranslations({ locale, namespace: 'purchase' })
  return generatePageMetadata({ title: t('metaTitle'), description: t('metaDescription'), path: `/comprar/${producto}`, locale, noindex: true })
}

const ERRORS = ['closed', 'slot_taken', 'session_required', 'unavailable', 'product', 'company_required', 'already_subscribed', 'rate_limited', 'busy'] as const

export default async function ComprarPage({ params, searchParams }: { params: Params; searchParams: Promise<{ error?: string }> }) {
  const { locale, producto } = await params
  const { error } = await searchParams
  if (!isOneTimeProduct(producto)) notFound()
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'purchase' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })
  const offer = modality(producto)
  const guided = isGuided(producto)
  const open = isCheckoutOpen()
  const errorKey = ERRORS.find((e) => e === error)

  let slots: Slot[] = []
  let thirdWeek = false
  let slotsFailed = false
  if (open && guided) {
    try {
      ;({ slots, thirdWeek } = await firstSessionSlots(getDelivery()))
    } catch (e) {
      console.error('[comprar] huecos:', e)
      slotsFailed = true
    }
  }

  const dayFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
  const timeFormat = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' })
  const days = new Map<string, Slot[]>()
  for (const slot of slots.slice(0, 120)) {
    const day = dayFormat.format(new Date(slot.start))
    days.set(day, [...(days.get(day) ?? []), slot])
  }

  return (
    <section className="pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
          {t('title', { product: tOffer(`modalities.${producto}.name`) })}
        </h1>
        <p className="mt-4 text-lg text-body">{t('subtitle')}</p>
        <p className="mt-3 text-sm text-muted">
          {t('price', { list: formatPrice(offer.listPrice, locale), launch: formatPrice(offer.launchPrice, locale) })}
        </p>

        {errorKey && (
          <p role="alert" className="mt-6 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-sm text-ink">
            {t(`errors.${errorKey}`)}
          </p>
        )}

        {!open ? (
          <div className="mt-8 space-y-4">
            <p className="text-body">{t('closed')}</p>
            <Button variant="outline" asChild>
              <Link href={localePath(locale, '/precios')}>{t('back')}</Link>
            </Button>
          </div>
        ) : (
          <form action="/api/checkout" method="post" className="mt-8 space-y-6">
            <input type="hidden" name="product" value={producto} />
            <input type="hidden" name="locale" value={locale} />
            {guided && (
              <fieldset className="space-y-4">
                <legend className="text-xl font-semibold text-ink">{t('chooseTitle')}</legend>
                <p className="text-sm text-body">{t('chooseText')}</p>
                {thirdWeek && <p className="text-sm font-medium text-ink">{t('thirdWeek')}</p>}
                {slotsFailed && <p className="text-sm text-ink">{t('slotsError')}</p>}
                {!slotsFailed && !slots.length && <p className="text-sm text-ink">{t('noSlots')}</p>}
                <div className="space-y-5">
                  {[...days.entries()].map(([day, daySlots]) => (
                    <div key={day}>
                      <p className="text-sm font-semibold text-ink first-letter:uppercase">{day}</p>
                      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {daySlots.map((slot) => (
                          <label
                            key={`${slot.host}|${slot.start}`}
                            className="flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-body has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand"
                          >
                            <input type="radio" name="slot" value={`${slot.host}|${slot.start}`} required className="accent-brand" />
                            <span>
                              <strong className="text-ink">{timeFormat.format(new Date(slot.start))}</strong> {t('with', { host: hostName(slot.host) })}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            )}
            <p className="text-xs text-muted">{t('b2b')}</p>
            <div className="flex flex-wrap gap-3">
              <Button type="submit" size="lg" disabled={guided && !slots.length}>
                {t('pay')}
              </Button>
              <Button variant="outline" size="lg" asChild>
                <Link href={localePath(locale, '/precios')}>{t('back')}</Link>
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
