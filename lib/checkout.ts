// Cobro con Stripe Checkout, con sesiones creadas por el servidor (Eric, 21-10-2026; sustituye a
// los enlaces de pago): una por compra, con lo que pide la entrega automatica (PML-KB-0261):
// - a empresas y profesionales de todo el mundo, en euros (los socios, 27-10-2026): el pais, el
//   territorio en Espana y la identificacion fiscal se piden en /comprar antes de pagar, se
//   comprueban alli y aqui (lib/delivery/checkout-tax.ts) y deciden el IVA, que viaja en los
//   metadatos del pago con lo declarado (tax_country, tax_territory, tax_id, tax_id_type,
//   tax_treatment y, con NIF-IVA, vies_request y vies_checked_at, y vies_name y vies_address si VIES
//   los da: la entrega los compara con la razon social). En Stripe, la razon social y la
//   direccion de facturacion, obligatorias. Sin tax_id_collection ni Stripe Tax: Stripe solo mira la
//   forma del NIF-IVA y dejaria a 0 % uno que VIES rechaza (iva-en-el-cobro-automatico.md);
// - el IVA, decidido aqui: el 21 % (un tipo fijo de Stripe sin IVA dentro) en Espana peninsular y
//   Baleares y en la UE sin NIF-IVA; sin IVA, con NIF-IVA de la UE valido en VIES (inversion del
//   sujeto pasivo: VIES se consulta antes de abrir el pago y, si no contesta, no se vende a 0 %), y
//   fuera de la UE, Canarias, Ceuta y Melilla. Monaco, como Francia. Quien escribe como
//   identificacion fiscal un NIF-IVA que VIES da por valido, que lo ponga como NIF-IVA
//   (other_tax_id_is_vat): con el, sin IVA. Que la direccion de facturacion y el IVA cobrado
//   cuadran se mira al llegar el aviso (lib/delivery/tax.ts, checkPaidTax): no se rechazan tarjetas
//   ni se bloquea la pagina por pais (Reglamento (UE) 2018/302);
// - solo con tarjeta: un pago diferido (SEPA) dejaria la plaza de lanzamiento y el hueco sin apartar;
// - la casilla de las condiciones, con la version que se acepta (y su copia guardada);
// - el precio de lanzamiento para los 10 primeros: cupon de Stripe, con la plaza reservada
//   mientras dura el pago. Si las que quedan estan apartadas por pagos a medias de otros, no se
//   cobra el de lista: launch_busy, que pruebe en media hora (los socios, 27-10-2026), con aviso
//   interno si salta varias veces en una hora. Pasadas las 10 ventas, el de lista sin que nadie
//   cambie nada;
// - en el Acompanado, la primera sesion y con quien, elegidas antes de pagar y apartadas en Cal.com;
// - el mensual, como suscripcion, para quien ya es cliente (desde la zona), con el IVA de su empresa
//   (y VIES otra vez si tiene NIF-IVA): si aun le quedan meses incluidos, empieza a cobrarse cuando
//   acaban (prueba hasta su soporte_hasta), con el plan que traen esos meses o uno menor; con uno
//   mayor, se cobra desde el principio. Al mes o por ano adelantado, al precio de 10 meses (oferta
//   v1.9): el precio anual del mismo plan (cerebro-plan-<plan>-anual), con el mismo IVA y la misma
//   prueba. El portal respeta los meses incluidos en cualquier cambio (continue_trial, stripe-setup).
//
// Contra el abuso (la ruta es publica): pagos abiertos por IP (por /64 en IPv6); plazas de
// lanzamiento apartadas, por conexion (por /56 en IPv6); consultas a VIES y huecos de Cal.com
// apartados, por /48 en IPv6; y huecos apartados a la vez en total (lib/delivery/limits.ts). La plaza
// se decide antes de contar los huecos: un launch_busy no gasta los topes de huecos.
//
// CHECKOUT_OPEN=true ensena los botones de compra. Se deja apagado hasta que el abogado revise las
// condiciones: nada se cobra de verdad mientras tanto.

import { addDays, errorMessage, madridTimeToUtc, newId, paidUntil } from './delivery/util.ts'
import { clientIpBucket, fingerprint, ipBucket, wideIpBucket, withinLimit } from './delivery/limits.ts'
import {
  SESSION_HOSTS,
  includedPlan,
  isGuided,
  isOneTimeProduct,
  isPlanPeriod,
  isPlanProduct,
  isSessionHost,
  launchCouponId,
  lookupKey,
  planMonthly,
  planProductName,
  productName,
  seatsFor,
  type OneTimeProductId,
  type PlanPeriod,
  type PlanProductId,
} from './delivery/products.ts'
import { parseSpanishTaxId } from './delivery/checkout-nif.ts'
import {
  isEuCountry,
  isSaleCountry,
  isSpainTerritory,
  parseEuVatId,
  readTaxInput,
  taxMetadata,
  treatmentFor,
  type CheckoutTax,
  type SpainTerritory,
  type TaxInputError,
  type ViesProof,
} from './delivery/checkout-tax.ts'
import { spainTaxRateId, territoryOf } from './delivery/tax.ts'
import { ensureTermsSnapshot } from './delivery/terms.ts'
import { abandonCheckout, clientRef, noteLaunchBusy, releaseOwnSlotHold, reserveLaunchPlace, type LaunchClient } from './delivery/launch.ts'
import { zoneUrl } from './delivery/emails.ts'
import type { Delivery } from './delivery/container.ts'
import { SlotUnavailableError, type Company, type Locale, type Slot, type ViesResult } from './delivery/types.ts'

export function isCheckoutOpen(env: Record<string, string | undefined> = process.env): boolean {
  return env.CHECKOUT_OPEN === 'true'
}

export type CheckoutErrorCode =
  | 'closed'
  | 'product'
  | 'session_required'
  | 'slot_taken'
  | 'company_required'
  | 'already_subscribed'
  | 'rate_limited'
  | 'busy'
  | 'currency'
  | TaxInputError
  /** VIES dice que el NIF-IVA no vale (o la empresa del mensual ya no lo tiene valido). */
  | 'vat_invalid'
  /** VIES no contesta: no se vende a 0 %, que pruebe en unos minutos. */
  | 'vat_unavailable'
  /** La UE sin NIF-IVA, con una identificacion fiscal que es un NIF-IVA valido en VIES: que lo escriba como NIF-IVA. */
  | 'other_tax_id_is_vat'
  /** Las plazas de lanzamiento que quedan, apartadas por pagos a medias: ni plaza ni precio de lista. */
  | 'launch_busy'

export class CheckoutError extends Error {
  code: CheckoutErrorCode
  constructor(code: CheckoutErrorCode, message: string) {
    super(message)
    this.name = 'CheckoutError'
    this.code = code
  }
}

const TAX_ERRORS: Record<TaxInputError, string> = {
  country_invalid: 'el pais no es un codigo ISO 3166-1 de la lista',
  territory_invalid: 'el territorio de Espana no es peninsula, canarias, ceuta ni melilla',
  tax_id_required: 'falta el NIF de la empresa',
  tax_id_invalid: 'el NIF no es un NIF espanol valido',
  vat_id_invalid: 'el NIF-IVA no tiene la forma de los de ese pais',
  eu_tax_id_required: 'falta el NIF-IVA o la identificacion fiscal de la empresa',
  other_tax_id_required: 'falta la identificacion fiscal de la empresa',
  other_tax_id_invalid: 'la identificacion fiscal no vale (letras, cifras y guiones, de 4 a 30)',
}

export interface CheckoutRequest {
  product: string
  locale: Locale
  /** Solo euros: cualquier otra moneda se rechaza. */
  currency?: string | null
  /** Pago unico: el pais de la empresa (ISO 3166-1 alfa-2); sin el, Espana. */
  country?: string | null
  /** Pago unico en Espana: peninsula (si no se dice), canarias, ceuta o melilla. */
  territory?: string | null
  /** Pago unico en Espana: el NIF espanol de la empresa, escrito en /comprar. */
  taxId?: string | null
  /** Pago unico en otro pais de la UE: el NIF-IVA (vacio: con el 21 %). */
  vatId?: string | null
  /** Pago unico fuera de la UE, o en la UE sin NIF-IVA: la identificacion fiscal. */
  otherTaxId?: string | null
  /** Acompanado: el hueco elegido. */
  session?: { host: string; start: string } | null
  /** Mensual: la empresa de quien esta en la zona. */
  company?: Company | null
  /** Mensual: al mes (month, si no se dice) o por ano adelantado (year). */
  period?: string | null
  clientIp?: string | null
}

function localePrefix(locale: Locale) {
  return locale === 'en' ? '/en' : ''
}

const NBSP = '\u00a0'
const TERRITORY_ES: Record<SpainTerritory, string> = { peninsula: 'la península', canarias: 'Canarias', ceuta: 'Ceuta', melilla: 'Melilla' }
const TERRITORY_EN: Record<SpainTerritory, string> = { peninsula: 'the mainland is', canarias: 'the Canary Islands are', ceuta: 'Ceuta is', melilla: 'Melilla is' }

// El texto de la casilla y el del boton de pago: que compra una empresa, el IVA que lleva y la
// identificacion que va en la factura, para que el cliente lo vea antes de pagar. Con las licencias a
// mano (LICENSE_MODE=manual) la licencia llega en unas horas, como dicen /gracias y la bienvenida.
function termsText(siteUrl: string, locale: Locale, version: string, options: { tax: CheckoutTax; manualLicense?: boolean; monthly?: boolean }) {
  const url = `${siteUrl}${localePrefix(locale)}/condiciones`
  const { tax, manualLicense = false, monthly = false } = options
  const territory = tax.territory ?? 'peninsula'
  if (locale === 'en') {
    const vat =
      tax.treatment === 'standard'
        ? `Prices plus 21% ${tax.country === 'ES' ? '' : 'Spanish '}VAT.`
        : tax.treatment === 'reverse_charge'
          ? `No VAT: reverse charge, with VAT number ${tax.taxId} checked in VIES.`
          : tax.country === 'ES'
            ? `No VAT: ${TERRITORY_EN[territory]} outside the Spanish VAT area.`
            : 'No Spanish VAT: sale outside the EU.'
    const id = tax.treatment === 'reverse_charge' ? '' : `, with tax ID ${tax.taxId},`
    return {
      terms: `I accept the [terms of use and sale](${url}) (version of ${version}). I am buying as a business or professional, for my business, not as a consumer.`,
      submit: monthly ? `${vat} Each invoice${id} arrives by email.` : `${vat} The invoice${id} arrives by email; the license, ${manualLicense ? 'within a few hours' : 'right away'}.`,
      news: 'Digital Brain news by email',
      yes: 'Yes, send them',
      no: 'No',
    }
  }
  const vat =
    tax.treatment === 'standard'
      ? `Precios más el 21${NBSP}% de IVA${tax.country === 'ES' ? '' : ' español'}.`
      : tax.treatment === 'reverse_charge'
        ? `Sin IVA: inversión del sujeto pasivo, con el NIF-IVA ${tax.taxId} comprobado en VIES.`
        : tax.country === 'ES'
          ? `Sin IVA: ${TERRITORY_ES[territory]} está fuera del territorio del IVA español.`
          : 'Sin IVA español: venta fuera de la UE.'
  const id = tax.treatment === 'reverse_charge' ? '' : tax.taxIdType === 'es_cif' ? `, con el NIF ${tax.taxId},` : `, con la identificación fiscal ${tax.taxId},`
  return {
    terms: `Acepto las [condiciones de uso y venta](${url}) (versión del ${version}). Compro como empresa o profesional, para mi actividad, no como consumidor.`,
    submit: monthly ? `${vat} Cada factura${id} te llega por correo.` : `${vat} La factura${id} te llega por correo y la licencia, ${manualLicense ? 'en unas horas' : 'al momento'}.`,
    news: 'Novedades del Cerebro Digital por correo',
    yes: 'Sí, quiero recibirlas',
    no: 'No',
  }
}

/** El tipo de IVA del 21 % solo en las ventas con IVA; sin IVA, nada (y nunca a 0 % sin la consulta a VIES). */
function taxLines(tax: CheckoutTax, taxRateId: string | null, vies: ViesProof | null): string[] {
  if (tax.treatment === 'reverse_charge' && !vies) throw new Error('inversion del sujeto pasivo sin la consulta a VIES: no se abre el pago')
  if (tax.treatment !== 'standard') return []
  if (!taxRateId) throw new Error('venta con IVA sin el tipo del 21 % de Stripe')
  return [taxRateId]
}

/** Los parametros de la sesion de pago unico (sin llamar a nadie: se prueban tal cual). */
export function oneTimeSessionParams(input: {
  siteUrl: string
  product: OneTimeProductId
  priceId: string
  /** El tipo de IVA del 21 % de Stripe (txr_...): solo en las ventas con IVA (standard). */
  taxRateId: string | null
  /** El pais, la identificacion fiscal y el IVA, ya comprobados (readTaxInput). */
  tax: CheckoutTax
  /** Con NIF-IVA: la consulta a VIES que lo confirmo. */
  vies?: ViesProof | null
  locale: Locale
  expiresAt: number
  terms: { version: string; sha256: string }
  launchRef: string | null
  /** Con plaza: la huella exacta de quien abre el pago (launch.ts, clientRef), solo en la sesion. */
  clientRef?: string | null
  slot: Slot | null
  reservationId: string | null
  manualLicense?: boolean
}): Record<string, unknown> {
  const vies = input.vies ?? null
  const rates = taxLines(input.tax, input.taxRateId, vies)
  const text = termsText(input.siteUrl, input.locale, input.terms.version, { tax: input.tax, manualLicense: input.manualLicense })
  const metadata: Record<string, string> = {
    product: input.product,
    seats: String(seatsFor(input.product)),
    locale: input.locale,
    ...taxMetadata(input.tax, vies),
    terms_version: input.terms.version,
    terms_sha256: input.terms.sha256,
  }
  if (input.launchRef) metadata.launch_ref = input.launchRef
  if (input.slot) {
    metadata.session_host = input.slot.host
    metadata.session_start = input.slot.start
  }
  if (input.reservationId) metadata.calendar_reservation = input.reservationId
  return {
    mode: 'payment',
    // Con IVA, el 21 % sobre el precio sin IVA (tax_behavior exclusive), tras el cupon si lo hay.
    line_items: [{ price: input.priceId, quantity: 1, ...(rates.length ? { tax_rates: rates } : {}) }],
    currency: 'eur',
    // Siempre en euros: con Adaptive Pricing encendido en la cuenta, Stripe ensenaria y cobraria en la
    // moneda del comprador y la venta acabaria a revisar.
    adaptive_pricing: { enabled: false },
    locale: input.locale,
    // Solo tarjeta (con Apple Pay y Google Pay): se cobra al momento, sin pagos que quedan pendientes.
    payment_method_types: ['card'],
    customer_creation: 'always',
    billing_address_collection: 'required',
    name_collection: { business: { enabled: true, optional: false } },
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: text.terms }, submit: { message: text.submit } },
    // Las comunicaciones comerciales, con permiso expreso (promotions de Stripe solo existe en EE. UU.).
    custom_fields: [
      {
        key: 'novedades',
        label: { type: 'custom', custom: text.news },
        type: 'dropdown',
        optional: true,
        dropdown: { options: [{ label: text.yes, value: 'si' }, { label: text.no, value: 'no' }] },
      },
    ],
    ...(input.launchRef ? { discounts: [{ coupon: launchCouponId(input.product) }] } : {}),
    // client_ref solo en la sesion, que es lo que se lee al volver (lib/delivery/launch.ts): el pago no lo necesita.
    metadata: input.launchRef && input.clientRef ? { ...metadata, client_ref: input.clientRef } : metadata,
    payment_intent_data: { metadata, description: productName(input.product, input.locale) },
    expires_at: input.expiresAt,
    success_url: `${input.siteUrl}${localePrefix(input.locale)}/gracias?pago={CHECKOUT_SESSION_ID}`,
    // La vuelta sin pagar cierra el pago y suelta al momento su plaza y su hueco (app/api/checkout/cancel),
    // y lleva otra vez a la pagina de compra, con el pais y el territorio elegidos (como tras un error).
    cancel_url: `${input.siteUrl}/api/checkout/cancel?pago={CHECKOUT_SESSION_ID}&producto=${input.product}&locale=${input.locale}&pais=${input.tax.country}${
      input.tax.country === 'ES' && input.tax.territory ? `&territorio=${input.tax.territory}` : ''
    }`,
  }
}

/** Los parametros de la suscripcion al mensual de una empresa que ya es cliente. */
export function planSessionParams(input: {
  siteUrl: string
  product: PlanProductId
  /** El precio de ese plan al mes o al ano (lookupKey(product, period)). */
  priceId: string
  /** Al mes (por defecto) o por ano adelantado. */
  period?: PlanPeriod
  /** El tipo de IVA del 21 % de Stripe (txr_...): solo en las ventas con IVA (standard). */
  taxRateId: string | null
  /** El IVA de la empresa (companyTax). */
  tax: CheckoutTax
  /** Con NIF-IVA: la consulta a VIES de hoy, que lo confirmo. */
  vies?: ViesProof | null
  locale: Locale
  company: Company
  expiresAt: number
  trialEnd: number | null
  terms: { version: string; sha256: string }
}): Record<string, unknown> {
  const vies = input.vies ?? null
  const rates = taxLines(input.tax, input.taxRateId, vies)
  const text = termsText(input.siteUrl, input.locale, input.terms.version, { tax: input.tax, monthly: true })
  const period = input.period ?? 'month'
  // El periodo, solo para leerlo en Stripe: la entrega lo saca del precio cobrado (se cambia en el portal).
  const metadata: Record<string, string> = {
    product: input.product,
    period,
    company_id: input.company.id,
    ...taxMetadata(input.tax, vies),
    locale: input.locale,
    terms_version: input.terms.version,
    terms_sha256: input.terms.sha256,
  }
  const zone = zoneUrl(input.siteUrl, input.locale)
  return {
    mode: 'subscription',
    customer: input.company.stripeCustomerId,
    // El NIF y el nombre son los de la compra (los de la licencia y de Holded): aqui no se piden ni
    // se cambian. La direccion de facturacion se pide y se guarda en el cliente de Stripe.
    customer_update: { address: 'auto' },
    line_items: [{ price: input.priceId, quantity: 1 }],
    currency: 'eur',
    adaptive_pricing: { enabled: false },
    locale: input.locale,
    billing_address_collection: 'required',
    consent_collection: { terms_of_service: 'required' },
    custom_text: { terms_of_service_acceptance: { message: text.terms }, submit: { message: text.submit } },
    payment_method_collection: 'always',
    subscription_data: {
      metadata,
      description: planProductName(input.product, period, input.locale),
      // Con IVA, el 21 % en cada cobro, tambien tras cambiar de plan en el portal (va en la
      // suscripcion, no en el precio). Sin IVA, ninguno.
      ...(rates.length ? { default_tax_rates: rates } : {}),
      ...(input.trialEnd ? { trial_end: input.trialEnd } : {}),
    },
    metadata,
    expires_at: input.expiresAt,
    success_url: `${zone}?mensual=ok`,
    cancel_url: zone,
  }
}

/**
 * El IVA del mensual, con lo que se guardo de la empresa en su compra: el pais, el territorio en
 * Espana (por el codigo postal de su direccion) y si su NIF es un NIF-IVA validado en VIES (eu_vat).
 * Una empresa sin pais (de antes) con NIF espanol, Espana.
 */
export function companyTax(company: Company): CheckoutTax {
  const country = company.country?.trim().toUpperCase() || (parseSpanishTaxId(company.taxId) ? 'ES' : '')
  if (!isSaleCountry(country)) throw new CheckoutError('country_invalid', `la empresa ${company.id} no tiene un pais valido (${country || 'ninguno'})`)
  if (country === 'ES') {
    const a = company.address
    const territory = territoryOf(a ? { postalCode: a.postal_code, state: a.state, city: a.city } : null) ?? 'peninsula'
    return { country, territory, taxId: company.taxId, taxIdType: 'es_cif', treatment: treatmentFor(country, territory, false), vies: null }
  }
  const vat = company.taxIdType === 'eu_vat' && isEuCountry(country) ? parseEuVatId(country, company.taxId) : null
  if (vat) return { country, territory: null, taxId: vat.vatId, taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: vat.viesCountry, vatNumber: vat.number } }
  return { country, territory: null, taxId: company.taxId, taxIdType: 'other', treatment: treatmentFor(country, null, false), vies: null }
}

/**
 * Con NIF-IVA, VIES antes de abrir el pago: valido, la consulta (va con el pedido); no valido,
 * vat_invalid; sin respuesta, vat_unavailable (nunca se vende a 0 % sin ella). Sin NIF-IVA, null.
 * Ademas del limite de pagos por IP, unas pocas consultas por conexion (el /48 en IPv6: con el /64,
 * una sola conexion de casa lanzaba cientos a la Comision en 10 minutos).
 */
async function confirmVat(d: Delivery, tax: CheckoutTax, clientIp: string | null | undefined): Promise<ViesProof | null> {
  if (!tax.vies) return null
  if (!(await withinLimit(d, 'vies-ip', wideIpBucket(clientIp), d.config.limits.viesPerIp, 10 * 60))) {
    throw new CheckoutError('rate_limited', 'demasiadas consultas a VIES desde esa conexion')
  }
  let result: ViesResult
  try {
    result = await d.vies.check(tax.vies)
  } catch (error) {
    result = { status: 'unavailable', reason: errorMessage(error) }
  }
  // La hora, la de la web al preguntar (VIES puede dar solo el dia): la entrega mira que sea de justo
  // antes del pago. El nombre y la direccion del titular, si VIES los da, para compararlos tras el pago.
  if (result.status === 'valid') return { request: result.requestIdentifier, checkedAt: d.clock().toISOString(), name: result.name, address: result.address }
  if (result.status === 'invalid') throw new CheckoutError('vat_invalid', `VIES dice que el NIF-IVA no es valido${result.reason ? ` (${result.reason})` : ''}`)
  console.warn(`[pago] VIES no contesta (${tax.vies.countryCode}): ${result.reason}`)
  throw new CheckoutError('vat_unavailable', `VIES no contesta (${result.reason}): no se vende sin IVA sin comprobarlo`)
}

/**
 * La UE sin NIF-IVA (con el 21 %) que escribe como identificacion fiscal un numero con la forma del
 * NIF-IVA de su pais, con o sin el prefijo (en casi toda la UE el numero fiscal es el mismo): si VIES
 * lo da por valido, true, y que lo escriba como NIF-IVA (sin IVA). Si VIES dice que no, no contesta o
 * la conexion ya paso su limite de consultas, false y sigue con el 21 %, como antes.
 */
async function vatWrittenAsOther(d: Delivery, tax: CheckoutTax, otherTaxId: string | null | undefined, clientIp: string | null | undefined): Promise<boolean> {
  if (tax.taxIdType !== 'other' || tax.treatment !== 'standard' || !isEuCountry(tax.country)) return false
  const vat = parseEuVatId(tax.country, otherTaxId)
  if (!vat) return false
  if (!(await withinLimit(d, 'vies-ip', wideIpBucket(clientIp), d.config.limits.viesPerIp, 10 * 60))) return false
  try {
    return (await d.vies.check({ countryCode: vat.viesCountry, vatNumber: vat.number })).status === 'valid'
  } catch {
    return false
  }
}

/**
 * Cuando empieza a cobrarse el mensual: al acabar los meses incluidos (el dia despues de lo pagado o
 * incluido, coveringPlan), si quedan mas de 48 horas (el minimo de Stripe para una prueba).
 */
export function trialEndFor(soporteHasta: string | null, now: Date): number | null {
  if (!soporteHasta) return null
  const end = madridTimeToUtc(addDays(soporteHasta, 1), 0)
  return end.getTime() - now.getTime() > 49 * 3600_000 ? Math.floor(end.getTime() / 1000) : null
}

/**
 * El plan que cubre la licencia vigente y hasta cuando: el del ultimo cobro del mensual, o el de los
 * meses incluidos en la compra, hasta lo pagado o incluido (paidUntil: su soporte_hasta sin los 15
 * dias de margen de un cobro fallido, que no son meses gratis). La prueba (no cobrar hasta que acabe)
 * vale para ese plan o uno menor.
 */
export async function coveringPlan(d: Delivery, company: Company): Promise<{ plan: PlanProductId; supportUntil: string } | null> {
  const licenses = (await d.repo.listLicensesByCompany(company.id)).filter((l) => !l.revokedAt).sort((a, b) => (a.soporteHasta < b.soporteHasta ? 1 : -1))
  for (const license of licenses) {
    const purchase = await d.repo.getPurchase(license.purchaseId)
    const plan = purchase ? (purchase.kind === 'renewal' && isPlanProduct(purchase.product) ? purchase.product : includedPlan(purchase.product)) : null
    if (plan) return { plan, supportUntil: paidUntil(license) }
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
  // Solo en euros (Eric, 25-10-2026).
  if (req.currency && req.currency.toLowerCase() !== 'eur') throw new CheckoutError('currency', `solo se vende en euros, no en ${req.currency}`)
  // El pais, la identificacion y el IVA del pago unico, comprobados otra vez aqui (la pagina los
  // mira en el navegador): antes de nada, asi uno mal escrito ni cuenta para el limite por IP ni
  // aparta plaza u hueco.
  let tax: CheckoutTax | null = null
  if (isOneTimeProduct(req.product)) {
    const read = readTaxInput({ country: req.country, territory: req.territory, taxId: req.taxId, vatId: req.vatId, otherTaxId: req.otherTaxId })
    if ('error' in read) throw new CheckoutError(read.error, TAX_ERRORS[read.error])
    tax = read.tax
  }
  // Cada pago abierto cuesta una llamada a Stripe (y, en el Acompanado, un hueco apartado): por IP, unos pocos.
  if (!(await withinLimit(d, 'pago-ip', ip, limits.checkoutPerIp, 10 * 60))) throw new CheckoutError('rate_limited', 'demasiados pagos abiertos desde esa IP')
  const terms = await ensureTermsSnapshot(d.storage, req.locale, d.config.siteUrl)

  if (isPlanProduct(req.product)) {
    const company = req.company
    if (!company?.stripeCustomerId) throw new CheckoutError('company_required', 'el mensual se contrata desde la zona de socio')
    // incomplete tambien: otro pago crearia una segunda suscripcion.
    if (company.subscriptionStatus && ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'].includes(company.subscriptionStatus)) {
      throw new CheckoutError('already_subscribed', 'ya tiene el mensual: se cambia desde el portal de Stripe')
    }
    if (req.period && !isPlanPeriod(req.period)) throw new CheckoutError('product', `el mensual se paga al mes o al ano, no ${req.period}`)
    const period: PlanPeriod = req.period === 'year' ? 'year' : 'month'
    // El IVA de su empresa; con NIF-IVA, VIES otra vez (pudo darse de baja desde la compra).
    const planTax = companyTax(company)
    const vies = await confirmVat(d, planTax, req.clientIp)
    const covering = await coveringPlan(d, company)
    // Los meses que ya tiene, gratis con ese plan o uno menor (se pague al mes o al ano); uno mayor se cobra desde ya.
    const latest = covering && planMonthly(req.product) <= planMonthly(covering.plan) ? covering.supportUntil : null
    const session = await d.payments.createCheckoutSession(
      planSessionParams({
        siteUrl: d.config.siteUrl,
        product: req.product,
        priceId: await d.payments.priceId(lookupKey(req.product, period)),
        period,
        taxRateId: planTax.treatment === 'standard' ? await spainTaxRateId(d.payments) : null,
        tax: planTax,
        vies,
        locale: req.locale,
        company,
        expiresAt,
        trialEnd: trialEndFor(latest, now),
        terms,
      })
    )
    return { url: session.url, sessionId: session.id, launch: false }
  }

  if (!isOneTimeProduct(req.product) || !tax) throw new CheckoutError('product', `producto desconocido: ${req.product}`)
  const product = req.product
  const saleTax = tax

  // VIES, tras el limite por IP (cada consulta es una llamada a la Comision Europea) y antes de
  // apartar plaza u hueco: con un NIF-IVA que no vale o sin respuesta, no se abre nada.
  const vies = await confirmVat(d, saleTax, req.clientIp)
  if (await vatWrittenAsOther(d, saleTax, req.otherTaxId, req.clientIp)) {
    throw new CheckoutError('other_tax_id_is_vat', 'la identificacion fiscal es un NIF-IVA valido en VIES: que lo escriba como NIF-IVA')
  }

  // El cliente: su conexion (la IPv4, o el /56 en IPv6) para el tope de plazas, con la huella de la
  // sal de la web, y su IP tal cual para reconocer sus pagos a medias (lib/delivery/launch.ts).
  const client = clientIpBucket(req.clientIp)
  const owner: LaunchClient = { clientHash: client ? fingerprint(d, client) : null, clientIp: req.clientIp ?? null, taxId: saleTax.taxId }

  // Acompanado: el hueco elegido tiene que estar libre (se aparta despues de la plaza).
  let slot: Slot | null = null
  if (isGuided(product)) {
    const chosen = req.session
    const start = chosen ? new Date(chosen.start) : null
    if (!chosen || !isSessionHost(chosen.host) || !start || Number.isNaN(start.getTime()) || start <= now) {
      throw new CheckoutError('session_required', `elige la primera sesion con ${SESSION_HOSTS.map((h) => h.name).join(' o ')}`)
    }
    const wanted: Slot = { host: chosen.host, start: start.toISOString() }
    slot = wanted
    // Cal.com solo da los huecos que caben enteros en la ventana pedida: la de la sesion (una hora) y margen.
    const isFree = async () =>
      (await d.calendar.availability(new Date(start.getTime() - 60_000).toISOString(), new Date(start.getTime() + 3 * 3600_000).toISOString())).some(
        (s) => s.host === wanted.host && s.start === wanted.start
      )
    let free = await isFree()
    // Quien vuelve atras con el navegador (sin pasar por /api/checkout/cancel) y elige el mismo hueco lo
    // tiene apartado por su propio pago a medias: se cierra ese pago y se mira otra vez, una sola.
    if (!free && (await releaseOwnSlotHold(d, owner, wanted, now))) free = await isFree()
    if (!free) throw new CheckoutError('slot_taken', 'ese hueco ya no esta libre')
  }

  // Precio de lanzamiento: una plaza de las 10, reservada mientras dura el pago. Quien vuelve atras
  // desde Stripe y abre otro pago se lleva la plaza de sus pagos a medias (los de su conexion, con su
  // NIF y su IP: lib/delivery/launch.ts). Antes que los limites de huecos: un launch_busy no los gasta.
  const launchRef = newId()
  const launch = await reserveLaunchPlace(
    d,
    { ref: launchRef, product, ...owner, expiresAt: new Date((expiresAt + 300) * 1000).toISOString(), limit: d.config.launchLimit, clientLimit: d.config.launchClientLimit },
    now
  )
  // Sin plaza y quedando sin gastar: las apartan pagos a medias (de otros, o de su conexion hasta su
  // tope) que pueden soltarse. No se cobra el de lista: que pruebe en media hora (lo que dura un pago).
  const placesLeft = launch ? 0 : await launchPlacesLeft(d)
  if (placesLeft > 0) {
    // Varias en una hora, aviso interno (si no sale, el cliente recibe launch_busy igual).
    await noteLaunchBusy(d, { clientHash: owner.clientHash, product, placesLeft, clientLimit: d.config.launchClientLimit }, now)
    throw new CheckoutError('launch_busy', 'las plazas de lanzamiento que quedan estan apartadas por pagos a medias')
  }

  // Sin pago abierto, ni plaza ni hueco apartados (si la base o Cal.com no contestan, caducan solos).
  let reservationId: string | null = null
  const releaseHolds = async () => {
    if (launch) await d.repo.markLaunchSlot(launchRef, 'released').catch(() => undefined)
    if (reservationId) await d.calendar.release(reservationId).catch(() => undefined)
  }

  if (slot) {
    // Un hueco apartado dura lo que el pago: nadie aparta mas de unos pocos a la vez, ni todos juntos
    // mas de un tope (asi no se bloquea el calendario de Eric y Sergio a base de pagos abiertos). Por
    // el /48 en IPv6 (con el /64, una casa con un /56 gastaba el tope total), y despues de la plaza:
    // los intentos que acaban en launch_busy no cuentan.
    const holdWindow = (d.config.checkoutMinutes + 5) * 60
    try {
      if (!(await withinLimit(d, 'huecos-ip', wideIpBucket(req.clientIp), limits.holdsPerIp, holdWindow))) {
        throw new CheckoutError('rate_limited', 'demasiados huecos apartados desde esa conexion')
      }
      if (!(await withinLimit(d, 'huecos', 'todos', limits.holdsTotal, holdWindow))) throw new CheckoutError('busy', 'demasiados huecos apartados a la vez')
      reservationId = await d.calendar.reserve(slot, d.config.checkoutMinutes + 5)
    } catch (error) {
      await releaseHolds()
      if (error instanceof SlotUnavailableError) throw new CheckoutError('slot_taken', 'ese hueco ya no esta libre')
      throw error
    }
  }

  try {
    const session = await d.payments.createCheckoutSession(
      oneTimeSessionParams({
        siteUrl: d.config.siteUrl,
        product,
        priceId: await d.payments.priceId(lookupKey(product)),
        taxRateId: saleTax.treatment === 'standard' ? await spainTaxRateId(d.payments) : null,
        tax: saleTax,
        vies,
        locale: req.locale,
        expiresAt,
        terms,
        launchRef: launch ? launchRef : null,
        clientRef: launch ? clientRef(d, req.clientIp, launchRef) : null,
        slot,
        reservationId,
        manualLicense: d.config.licenseMode === 'manual',
      })
    )
    if (launch) await d.repo.setLaunchSlotSession(launchRef, session.id)
    return { url: session.url, sessionId: session.id, launch }
  } catch (error) {
    await releaseHolds()
    throw error
  }
}

/**
 * La vuelta desde Stripe sin pagar (app/api/checkout/cancel): cierra ese pago y suelta su plaza y su
 * hueco (abandonCheckout). La ruta es publica y cada vuelta cuesta una llamada a Stripe: solo con la
 * venta abierta y 10 cada 10 minutos por IP (por /64 en IPv6). Si no, no se llama a nadie: el pago
 * caduca solo y el aviso checkout.session.expired suelta lo mismo. true si se cerro.
 */
export async function cancelCheckout(d: Delivery, sessionId: string, clientIp: string | null, env: Record<string, string | undefined> = process.env): Promise<boolean> {
  if (!isCheckoutOpen(env)) return false
  if (!(await withinLimit(d, 'cancelar-ip', ipBucket(clientIp), 10, 600))) return false
  return abandonCheckout(d, sessionId)
}

/**
 * A donde lleva la vuelta sin pagar (los parametros de cancel_url): la pagina de compra del producto
 * con el pais y, en Espana, el territorio elegidos, solo si son de la lista (la URL la puede escribir
 * cualquiera); con otro producto, /precios.
 */
export function cancelReturnPath(params: URLSearchParams): string {
  const prefix = params.get('locale') === 'en' ? '/en' : ''
  const product = params.get('producto') ?? ''
  if (!isOneTimeProduct(product)) return `${prefix}/precios`
  const keep = new URLSearchParams()
  const country = params.get('pais')
  const territory = params.get('territorio')
  if (isSaleCountry(country)) keep.set('pais', country)
  if (country === 'ES' && isSpainTerritory(territory)) keep.set('territorio', territory)
  const query = keep.toString()
  return `${prefix}/comprar/${product}${query ? `?${query}` : ''}`
}

/**
 * Las plazas de lanzamiento que quedan de las 10: las gastadas (pagos cobrados con el precio de
 * lanzamiento) no vuelven. Las reservadas por un pago abierto si cuentan como libres: si caduca, la
 * suelta (mientras, quien no consigue plaza recibe launch_busy). Sin ninguna, /precios y /comprar
 * ensenan solo el de lista (oferta v1.9: «Dar el precio de lanzamiento a partir del cliente 11» es un
 * error); el pago ya lo cobra solo.
 */
export async function launchPlacesLeft(d: Delivery): Promise<number> {
  return Math.max(0, d.config.launchLimit - (await d.repo.countLaunchSlotsUsed()))
}

/** La etiqueta de los huecos que ensena /comprar (guardados 60 s): /api/checkout la renueva al apartar uno o al dar slot_taken. */
export const SLOTS_CACHE_TAG = 'huecos-primera-sesion'

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
