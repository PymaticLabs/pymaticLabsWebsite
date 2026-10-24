// Cobro con Stripe Checkout, con sesiones creadas por el servidor (Eric, 21-10-2026; sustituye a
// los enlaces de pago): una por compra, con lo que pide la entrega automatica (PML-KB-0261):
// - solo empresas: NIF o NIF-IVA obligatorio, razon social y direccion de facturacion (en dolares,
//   el EIN en un campo propio: Checkout no pide NIF en Estados Unidos);
// - solo con tarjeta: un pago diferido (SEPA) dejaria la plaza de lanzamiento y el hueco sin apartar;
// - Stripe Tax calcula el IVA (con la inversion del sujeto pasivo si el NIF-IVA europeo vale);
// - la casilla de las condiciones, con la version que se acepta (y su copia guardada);
// - el precio de lanzamiento para los 10 primeros: cupon de Stripe, con la plaza reservada
//   mientras dura el pago (la venta 11 paga el de lista sin que nadie cambie nada);
// - en el Acompanado, la primera sesion y con quien, elegidas antes de pagar y apartadas en Cal.com;
// - el mensual, como suscripcion, para quien ya es cliente (desde la zona): si aun le quedan meses
//   incluidos, empieza a cobrarse cuando acaban (prueba hasta su soporte_hasta), con el plan que
//   traen esos meses o uno menor; con uno mayor, se cobra desde el principio.
//
// Contra el abuso (la ruta es publica): pagos abiertos por IP (por /64 en IPv6) y huecos de Cal.com
// apartados a la vez, por IP y en total (lib/delivery/limits.ts).
//
// CHECKOUT_OPEN=true ensena los botones de compra. Se deja apagado hasta que el abogado revise las
// condiciones: nada se cobra de verdad mientras tanto.

import { addDays, madridTimeToUtc, newId } from './delivery/util.ts'
import { fingerprint, ipBucket, withinLimit } from './delivery/limits.ts'
import {
  SESSION_HOSTS,
  includedPlan,
  isGuided,
  isOneTimeProduct,
  isPlanProduct,
  isSessionHost,
  launchCouponId,
  lookupKey,
  planMonthly,
  productName,
  seatsFor,
  type OneTimeProductId,
  type PlanProductId,
} from './delivery/products.ts'
import { ensureTermsSnapshot } from './delivery/terms.ts'
import { zoneUrl } from './delivery/emails.ts'
import type { Delivery } from './delivery/container.ts'
import { SlotUnavailableError, type Company, type Locale, type Slot } from './delivery/types.ts'

export function isCheckoutOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHECKOUT_OPEN === 'true'
}

export type CheckoutErrorCode = 'closed' | 'product' | 'session_required' | 'slot_taken' | 'company_required' | 'already_subscribed' | 'rate_limited' | 'busy'

export class CheckoutError extends Error {
  code: CheckoutErrorCode
  constructor(code: CheckoutErrorCode, message: string) {
    super(message)
    this.name = 'CheckoutError'
    this.code = code
  }
}

export interface CheckoutRequest {
  product: string
  locale: Locale
  currency?: 'eur' | 'usd'
  /** Acompanado: el hueco elegido. */
  session?: { host: string; start: string } | null
  /** Mensual: la empresa de quien esta en la zona. */
  company?: Company | null
  clientIp?: string | null
}

function localePrefix(locale: Locale) {
  return locale === 'en' ? '/en' : ''
}

function termsText(siteUrl: string, locale: Locale, version: string) {
  const url = `${siteUrl}${localePrefix(locale)}/condiciones`
  return locale === 'en'
    ? {
        terms: `I accept the [terms of use and sale](${url}) (version of ${version}). I am buying as a business or professional, for my business, not as a consumer.`,
        submit: 'Businesses and professionals only: the tax ID (NIF or EU VAT number) is required. The invoice arrives by email; the license, right away.',
        taxId: 'Company tax ID (EIN or VAT number)',
        news: 'Digital Brain news by email',
        yes: 'Yes, send them',
        no: 'No',
      }
    : {
        terms: `Acepto las [condiciones de uso y venta](${url}) (versión del ${version}). Compro como empresa o profesional, para mi actividad, no como consumidor.`,
        submit: 'Solo para empresas y profesionales: el NIF o NIF-IVA es obligatorio. La factura te llega por correo y la licencia, al momento.',
        taxId: 'NIF de la empresa (EIN o VAT number)',
        news: 'Novedades del Cerebro Digital por correo',
        yes: 'Sí, quiero recibirlas',
        no: 'No',
      }
}

/** Los parametros de la sesion de pago unico (sin llamar a nadie: se prueban tal cual). */
export function oneTimeSessionParams(input: {
  siteUrl: string
  product: OneTimeProductId
  priceId: string
  locale: Locale
  currency: 'eur' | 'usd'
  expiresAt: number
  terms: { version: string; sha256: string }
  launchRef: string | null
  slot: Slot | null
  reservationId: string | null
}): Record<string, unknown> {
  const text = termsText(input.siteUrl, input.locale, input.terms.version)
  const metadata: Record<string, string> = {
    product: input.product,
    seats: String(seatsFor(input.product)),
    locale: input.locale,
    terms_version: input.terms.version,
    terms_sha256: input.terms.sha256,
  }
  if (input.launchRef) metadata.launch_ref = input.launchRef
  if (input.slot) {
    metadata.session_host = input.slot.host
    metadata.session_start = input.slot.start
  }
  if (input.reservationId) metadata.calendar_reservation = input.reservationId
  // En dolares (Norteamerica), Checkout no pide NIF: un campo propio y obligatorio para el EIN.
  const taxIdField =
    input.currency === 'usd'
      ? [{ key: 'nif', label: { type: 'custom', custom: text.taxId }, type: 'text', optional: false, text: { minimum_length: 5, maximum_length: 32 } }]
      : []
  return {
    mode: 'payment',
    line_items: [{ price: input.priceId, quantity: 1 }],
    currency: input.currency,
    locale: input.locale,
    // Solo tarjeta (con Apple Pay y Google Pay): se cobra al momento, sin pagos que quedan pendientes.
    payment_method_types: ['card'],
    customer_creation: 'always',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: true, required: 'if_supported' },
    name_collection: { business: { enabled: true, optional: false } },
    automatic_tax: { enabled: true },
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: text.terms }, submit: { message: text.submit } },
    // Las comunicaciones comerciales, con permiso expreso (promotions de Stripe solo existe en EE. UU.).
    custom_fields: [
      ...taxIdField,
      {
        key: 'novedades',
        label: { type: 'custom', custom: text.news },
        type: 'dropdown',
        optional: true,
        dropdown: { options: [{ label: text.yes, value: 'si' }, { label: text.no, value: 'no' }] },
      },
    ],
    ...(input.launchRef ? { discounts: [{ coupon: launchCouponId(input.product) }] } : {}),
    metadata,
    payment_intent_data: { metadata, description: productName(input.product, input.locale) },
    expires_at: input.expiresAt,
    success_url: `${input.siteUrl}${localePrefix(input.locale)}/gracias?pago={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.siteUrl}${localePrefix(input.locale)}/precios`,
  }
}

/** Los parametros de la suscripcion al mensual de una empresa que ya es cliente. */
export function planSessionParams(input: {
  siteUrl: string
  product: PlanProductId
  priceId: string
  locale: Locale
  company: Company
  expiresAt: number
  trialEnd: number | null
  terms: { version: string; sha256: string }
}): Record<string, unknown> {
  const text = termsText(input.siteUrl, input.locale, input.terms.version)
  const metadata = { product: input.product, company_id: input.company.id, locale: input.locale, terms_version: input.terms.version, terms_sha256: input.terms.sha256 }
  const zone = zoneUrl(input.siteUrl, input.locale)
  return {
    mode: 'subscription',
    customer: input.company.stripeCustomerId,
    // El NIF y el nombre son los de la compra (los de la licencia y de Holded): aqui no se piden ni
    // se cambian. La direccion si se puede poner al dia (Stripe Tax la necesita).
    customer_update: { address: 'auto' },
    line_items: [{ price: input.priceId, quantity: 1 }],
    currency: input.company.currency,
    locale: input.locale,
    billing_address_collection: 'required',
    automatic_tax: { enabled: true },
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: text.terms } },
    payment_method_collection: 'always',
    subscription_data: {
      metadata,
      description: productName(input.product, input.locale),
      ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
    },
    metadata,
    expires_at: input.expiresAt,
    success_url: `${zone}?mensual=ok`,
    cancel_url: zone,
  }
}

/**
 * Cuando empieza a cobrarse el mensual: al acabar los meses incluidos (el dia despues del
 * soporte_hasta de su licencia), si quedan mas de 48 horas (el minimo de Stripe para una prueba).
 */
export function trialEndFor(soporteHasta: string | null, now: Date): number | null {
  if (!soporteHasta) return null
  const end = madridTimeToUtc(addDays(soporteHasta, 1), 0)
  return end.getTime() - now.getTime() > 49 * 3600_000 ? Math.floor(end.getTime() / 1000) : null
}

/**
 * El plan que cubre el soporte_hasta de la licencia vigente: el del ultimo cobro del mensual, o el
 * de los meses incluidos en la compra. La prueba (no cobrar hasta que acabe) vale para ese o uno menor.
 */
export async function coveringPlan(d: Delivery, company: Company): Promise<{ plan: PlanProductId; supportUntil: string } | null> {
  const licenses = (await d.repo.listLicensesByCompany(company.id)).filter((l) => !l.revokedAt).sort((a, b) => (a.soporteHasta < b.soporteHasta ? 1 : -1))
  for (const license of licenses) {
    const purchase = await d.repo.getPurchase(license.purchaseId)
    const plan = purchase ? (purchase.kind === 'renewal' && isPlanProduct(purchase.product) ? purchase.product : includedPlan(purchase.product)) : null
    if (plan) return { plan, supportUntil: license.soporteHasta }
  }
  return null
}

/** Crea el pago en Stripe y devuelve su URL. */
export async function createCheckout(d: Delivery, req: CheckoutRequest): Promise<{ url: string; sessionId: string; launch: boolean }> {
  const now = d.clock()
  const limits = d.config.limits
  // Un minuto de margen sobre los 30 que exige Stripe como minimo.
  const expiresAt = Math.floor(now.getTime() / 1000) + d.config.checkoutMinutes * 60 + 60
  const ip = ipBucket(req.clientIp)
  // Cada pago abierto cuesta una llamada a Stripe (y, en el Acompanado, un hueco apartado): por IP, unos pocos.
  if (!(await withinLimit(d, 'pago-ip', ip, limits.checkoutPerIp, 10 * 60))) throw new CheckoutError('rate_limited', 'demasiados pagos abiertos desde esa IP')
  const terms = await ensureTermsSnapshot(d.storage, req.locale)

  if (isPlanProduct(req.product)) {
    const company = req.company
    if (!company?.stripeCustomerId) throw new CheckoutError('company_required', 'el mensual se contrata desde la zona de socio')
    // incomplete tambien: otro pago crearia una segunda suscripcion.
    if (company.subscriptionStatus && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(company.subscriptionStatus)) {
      throw new CheckoutError('already_subscribed', 'ya tiene el mensual: se cambia desde el portal de Stripe')
    }
    const covering = await coveringPlan(d, company)
    // Los meses que ya tiene, gratis con ese plan o uno menor; uno mayor se cobra desde ya.
    const latest = covering && planMonthly(req.product) <= planMonthly(covering.plan) ? covering.supportUntil : null
    const session = await d.payments.createCheckoutSession(
      planSessionParams({
        siteUrl: d.config.siteUrl,
        product: req.product,
        priceId: await d.payments.priceId(lookupKey(req.product)),
        locale: req.locale,
        company,
        expiresAt,
        trialEnd: trialEndFor(latest, now),
        terms,
      })
    )
    return { url: session.url, sessionId: session.id, launch: false }
  }

  if (!isOneTimeProduct(req.product)) throw new CheckoutError('product', `producto desconocido: ${req.product}`)
  const product = req.product

  // Acompanado: el hueco elegido tiene que estar libre, y se aparta mientras se paga.
  let slot: Slot | null = null
  let reservationId: string | null = null
  if (isGuided(product)) {
    const chosen = req.session
    const start = chosen ? new Date(chosen.start) : null
    if (!chosen || !isSessionHost(chosen.host) || !start || Number.isNaN(start.getTime()) || start <= now) {
      throw new CheckoutError('session_required', `elige la primera sesion con ${SESSION_HOSTS.map((h) => h.name).join(' o ')}`)
    }
    slot = { host: chosen.host, start: start.toISOString() }
    // Cal.com solo da los huecos que caben enteros en la ventana pedida: la de la sesion (una hora) y margen.
    const free = await d.calendar.availability(new Date(start.getTime() - 60_000).toISOString(), new Date(start.getTime() + 3 * 3600_000).toISOString())
    if (!free.some((s) => s.host === slot!.host && s.start === slot!.start)) throw new CheckoutError('slot_taken', 'ese hueco ya no esta libre')
    // Un hueco apartado dura lo que el pago: nadie aparta mas de unos pocos a la vez, ni todos juntos
    // mas de un tope (asi no se bloquea el calendario de Eric y Sergio a base de pagos abiertos).
    const holdWindow = (d.config.checkoutMinutes + 5) * 60
    if (!(await withinLimit(d, 'huecos-ip', ip, limits.holdsPerIp, holdWindow))) throw new CheckoutError('rate_limited', 'demasiados huecos apartados desde esa IP')
    if (!(await withinLimit(d, 'huecos', 'todos', limits.holdsTotal, holdWindow))) throw new CheckoutError('busy', 'demasiados huecos apartados a la vez')
    try {
      reservationId = await d.calendar.reserve(slot, d.config.checkoutMinutes + 5)
    } catch (error) {
      if (error instanceof SlotUnavailableError) throw new CheckoutError('slot_taken', 'ese hueco ya no esta libre')
      throw error
    }
  }

  // Precio de lanzamiento: una plaza de las 10, reservada mientras dura el pago. La IP cuenta por su
  // bloque (/64 en IPv6), con la huella de la sal de la web.
  const launchRef = newId()
  const clientHash = ip ? fingerprint(d, ip) : null
  const launch = await d.repo.reserveLaunchSlot(
    {
      ref: launchRef,
      product,
      clientHash,
      expiresAt: new Date((expiresAt + 300) * 1000).toISOString(),
      limit: d.config.launchLimit,
      clientLimit: d.config.launchClientLimit,
    },
    now
  )

  try {
    const session = await d.payments.createCheckoutSession(
      oneTimeSessionParams({
        siteUrl: d.config.siteUrl,
        product,
        priceId: await d.payments.priceId(lookupKey(product)),
        locale: req.locale,
        currency: req.currency ?? 'eur',
        expiresAt,
        terms,
        launchRef: launch ? launchRef : null,
        slot,
        reservationId,
      })
    )
    if (launch) await d.repo.setLaunchSlotSession(launchRef, session.id)
    return { url: session.url, sessionId: session.id, launch }
  } catch (error) {
    // Sin pago abierto, ni plaza ni hueco apartados.
    if (launch) await d.repo.markLaunchSlot(launchRef, 'released')
    if (reservationId) await d.calendar.release(reservationId).catch(() => undefined)
    throw error
  }
}

/**
 * Los primeros huecos libres para la primera sesion: los de las dos semanas siguientes y, si estan
 * llenas, los de la tercera (Eric, 21-10-2026). Desde manana, para que haya tiempo de prepararla.
 */
export async function firstSessionSlots(d: Delivery): Promise<{ slots: Slot[]; thirdWeek: boolean }> {
  const now = d.clock()
  const from = new Date(now.getTime() + 24 * 3600_000)
  const twoWeeks = new Date(from.getTime() + 14 * 24 * 3600_000)
  const slots = await d.calendar.availability(from.toISOString(), twoWeeks.toISOString())
  if (slots.length) return { slots, thirdWeek: false }
  const third = await d.calendar.availability(twoWeeks.toISOString(), new Date(twoWeeks.getTime() + 7 * 24 * 3600_000).toISOString())
  return { slots: third, thirdWeek: true }
}
