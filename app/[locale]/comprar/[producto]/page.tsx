import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_cache } from 'next/cache'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import PayButton from '@/components/purchase/pay-button'
import TaxFields from '@/components/purchase/tax-fields'
import { Button } from '@/components/ui/button'
import { generatePageMetadata } from '@/lib/metadata'
import { localePath } from '@/lib/i18n'
import { SLOTS_CACHE_TAG, firstSessionSlots, isCheckoutOpen } from '@/lib/checkout'
import { SALE_COUNTRIES, isSaleCountry, isSpainTerritory } from '@/lib/delivery/checkout-tax'
import { licenseModeOf } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { hostName, isGuided, isOneTimeProduct, modality } from '@/lib/delivery/products'
import { formatPrice } from '@/lib/offer'
import type { Slot } from '@/lib/delivery/types'
import { formatMonthYear, offerStatus } from '../../precios/offer-status'

// La pagina de compra de una modalidad: el resumen, el pais y la identificacion fiscal de la empresa
// y el boton al pago de Stripe. Se piden aqui, antes de pagar, porque deciden el IVA, y se comprueban
// en el navegador y otra vez en /api/checkout (components/purchase/tax-fields.tsx; se vende a
// empresas de todo el mundo). Los paises, con su nombre en el idioma de la pagina (Intl), y Espana
// el primero; tras un error, vuelve con el pais y el territorio que se eligieron. En el
// Acompanado, antes se elige la primera sesion y con quien, entre los huecos libres de Cal.com (si
// las dos semanas siguientes estan llenas, salen los de la tercera). Los errores del pago vuelven
// aqui. Con las licencias a mano, dice que la licencia llega en unas horas (como la bienvenida y la zona).
// Sin plazas de lanzamiento, solo el precio de lista; y siempre, hasta cuando tiene correcciones de
// seguridad la version que se vende (politica de vulnerabilidades v1.7, art. 13.19 del CRA).

export const dynamic = 'force-dynamic'

// Los huecos que se ensenan, guardados 60 s (como las plazas de /precios: offer-status.ts): cada
// visita costaba 2 o 4 llamadas a Cal.com, y recargar la pagina gastaba su cuota (la misma clave que
// el pago y la reserva de la sesion). Uno que se acaba de ocupar no rompe nada: el pago vuelve a
// mirar en vivo el hueco elegido (createCheckout) y contesta slot_taken; /api/checkout renueva la
// cache al apartar uno o al dar slot_taken (SLOTS_CACHE_TAG). Un fallo no se guarda.
const cachedSlots = unstable_cache(async () => ({ ...(await firstSessionSlots(getDelivery())), at: Date.now() }), [SLOTS_CACHE_TAG], {
  revalidate: 60,
  tags: [SLOTS_CACHE_TAG],
})

// Pasado el minuto, unstable_cache da lo guardado mientras lo renueva por detras, aunque sea de hace
// horas (con huecos que ya pasaron): si tiene mas de dos minutos, se piden ahora.
async function shownSlots() {
  const cached = await cachedSlots()
  return Date.now() - cached.at > 120_000 ? firstSessionSlots(getDelivery()) : cached
}

type Params = Promise<{ locale: string; producto: string }>

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale, producto } = await params
  const t = await getTranslations({ locale, namespace: 'purchase' })
  const description = t(licenseModeOf() === 'manual' ? 'metaDescriptionManual' : 'metaDescription')
  return generatePageMetadata({ title: t('metaTitle'), description, path: `/comprar/${producto}`, locale, noindex: true })
}

const ERRORS = [
  'closed',
  'slot_taken',
  'session_required',
  'unavailable',
  'product',
  'company_required',
  'already_subscribed',
  'rate_limited',
  'busy',
  'tax_id_required',
  'tax_id_invalid',
  'currency',
  'country_invalid',
  'territory_invalid',
  'vat_id_invalid',
  'eu_tax_id_required',
  'other_tax_id_required',
  'other_tax_id_invalid',
  'vat_invalid',
  'vat_unavailable',
  'other_tax_id_is_vat',
  'launch_busy',
  'eu_no_vat_limit',
] as const

/** Todos los paises (se vende a cualquiera), por su nombre en ese idioma, con Espana el primero. */
function countryOptions(locale: string): { code: string; name: string }[] {
  const lang = locale === 'en' ? 'en' : 'es'
  const names = new Intl.DisplayNames([lang], { type: 'region' })
  const all = SALE_COUNTRIES.map((code) => ({ code, name: names.of(code) ?? code }))
  const rest = all.filter((c) => c.code !== 'ES').sort((a, b) => a.name.localeCompare(b.name, lang))
  return [...all.filter((c) => c.code === 'ES'), ...rest]
}

export default async function ComprarPage({ params, searchParams }: { params: Params; searchParams: Promise<{ error?: string; pais?: string; territorio?: string }> }) {
  const { locale, producto } = await params
  const { error, pais, territorio } = await searchParams
  if (!isOneTimeProduct(producto)) notFound()
  setRequestLocale(locale)
  const t = await getTranslations({ locale, namespace: 'purchase' })
  const tOffer = await getTranslations({ locale, namespace: 'offer' })
  const offer = modality(producto)
  const guided = isGuided(producto)
  const open = isCheckoutOpen()
  const errorKey = ERRORS.find((e) => e === error)
  // Las plazas, sin la cache: justo despues de la venta 10 ya no se anuncia el de lanzamiento.
  const { launchOpen, security } = await offerStatus({ fresh: true })

  let slots: Slot[] = []
  let thirdWeek = false
  let slotsFailed = false
  if (open && guided) {
    try {
      ;({ slots, thirdWeek } = await shownSlots())
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
    <section className="pt-24 sm:pt-32 pb-20">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
          {t('title', { product: tOffer(`modalities.${producto}.name`) })}
        </h1>
        <p className="mt-4 text-lg text-body">{t(licenseModeOf() === 'manual' ? 'subtitleManual' : 'subtitle')}</p>
        <p className="mt-3 text-sm text-muted">
          {launchOpen
            ? t('price', { list: formatPrice(offer.listPrice, locale), launch: formatPrice(offer.launchPrice, locale) })
            : t('priceList', { list: formatPrice(offer.listPrice, locale) })}
        </p>
        <p className="mt-2 text-sm text-muted">
          {security
            ? t('securityUntil', { version: security.version, date: formatMonthYear(security.until, locale) })
            : t('securityPeriod')}
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
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        {daySlots.map((slot) => (
                          <label
                            key={`${slot.host}|${slot.start}`}
                            className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-3 text-sm text-body sm:gap-3 sm:px-4 has-[:checked]:border-brand has-[:checked]:ring-1 has-[:checked]:ring-brand"
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
            <TaxFields
              countries={countryOptions(locale)}
              initialCountry={isSaleCountry(pais) ? pais : 'ES'}
              initialTerritory={isSpainTerritory(territorio) ? territorio : 'peninsula'}
              texts={{
                country: { label: t('country.label'), hint: t('country.hint') },
                scope: { spain: t('country.scope.spain'), eu: t('country.scope.eu'), other: t('country.scope.other') },
                territory: {
                  label: t('territory.label'),
                  options: { peninsula: t('territory.peninsula'), canarias: t('territory.canarias'), ceuta: t('territory.ceuta'), melilla: t('territory.melilla') },
                },
                taxId: { label: t('taxId.label'), placeholder: t('taxId.placeholder'), hint: t('taxId.hint'), required: t('taxId.required'), invalid: t('taxId.invalid') },
                vatId: {
                  label: t('vatId.label'),
                  placeholder: t('vatId.placeholder', { prefix: '{prefix}' }),
                  placeholderAny: t('vatId.placeholderAny'),
                  hint: t('vatId.hint'),
                  required: '',
                  invalid: t('vatId.invalid'),
                },
                otherTaxId: {
                  label: t('otherTaxId.label'),
                  placeholder: t('otherTaxId.placeholder'),
                  hint: t('otherTaxId.hint'),
                  hintEu: t('otherTaxId.hintEu'),
                  required: t('otherTaxId.required'),
                  requiredEu: t('otherTaxId.requiredEu'),
                  invalid: t('otherTaxId.invalid'),
                },
              }}
            />
            <p className="text-xs text-muted">{t('b2b')}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <PayButton label={t('pay')} disabled={guided && !slots.length} />
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
