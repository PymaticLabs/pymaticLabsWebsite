// Lo que se vende por la web y lo que lleva cada licencia, a partir de la oferta (lib/offer.ts).
//
// - Pago unico: las cuatro modalidades. Licencia con su modalidad, el equipo y el soporte_hasta de
//   los meses del mensual que trae (Hazlo tu sin equipo: el mismo dia de la compra).
// - Mensual: Esencial, Pro y Premium, como suscripcion, al mes o por ano adelantado (el precio de
//   10 meses). Cada cobro, licencia nueva con el soporte_hasta del periodo pagado.
//
// En Stripe, cada precio se busca por su lookup_key (cerebro-<producto>; el mensual pagado al ano,
// cerebro-plan-<plan>-anual, en el mismo producto que el del mes) y el cupon de lanzamiento de cada
// modalidad tiene id fijo (cerebro-lanzamiento-<modalidad>): los crea scripts/stripe-setup.mts.

import { TEAM_MAX_PEOPLE, modalities, plans, type ModalityId, type PlanId } from '../offer.ts'
import { addMonths, type LicenseModality } from '../license.ts'
import type { Locale } from './types.ts'

export type OneTimeProductId = ModalityId
export type PlanProductId = `plan-${PlanId}`
export type ProductId = OneTimeProductId | PlanProductId
/** Cada cuanto se cobra el mensual: al mes o por ano adelantado (el precio de 10 meses). */
export type PlanPeriod = 'month' | 'year'

export function isPlanPeriod(value: unknown): value is PlanPeriod {
  return value === 'month' || value === 'year'
}

/** Con quien es la sesion del Acompanado: el cliente elige (Eric, 21-10-2026). */
export const SESSION_HOSTS = [
  { id: 'eric', name: 'Eric' },
  { id: 'sergio', name: 'Sergio' },
] as const
export type SessionHostId = (typeof SESSION_HOSTS)[number]['id']

export function isSessionHost(value: unknown): value is SessionHostId {
  return SESSION_HOSTS.some((host) => host.id === value)
}

export function hostName(id: string): string {
  return SESSION_HOSTS.find((host) => host.id === id)?.name ?? id
}

export function isOneTimeProduct(value: unknown): value is OneTimeProductId {
  return modalities.some((m) => m.id === value)
}

export function isPlanProduct(value: unknown): value is PlanProductId {
  return typeof value === 'string' && plans.some((p) => `plan-${p.id}` === value)
}

export function isProduct(value: unknown): value is ProductId {
  return isOneTimeProduct(value) || isPlanProduct(value)
}

export function planOf(product: PlanProductId): PlanId {
  return product.slice('plan-'.length) as PlanId
}

export function modality(id: OneTimeProductId) {
  const found = modalities.find((m) => m.id === id)
  if (!found) throw new Error(`modalidad desconocida: ${id}`)
  return found
}

export function isGuided(product: string): boolean {
  return isOneTimeProduct(product) && modality(product).guided
}

const ANNUAL_SUFFIX = '-anual'

/** El lookup_key del precio en Stripe: cerebro-<producto>; el mensual pagado al ano, cerebro-plan-<plan>-anual. */
export function lookupKey(product: ProductId, period: PlanPeriod = 'month'): string {
  return period === 'year' && isPlanProduct(product) ? `cerebro-${product}${ANNUAL_SUFFIX}` : `cerebro-${product}`
}

/**
 * El producto y, en el mensual, cada cuanto se cobra, de un lookup_key de Stripe (cerebro-plan-pro
 * -> plan-pro al mes; cerebro-plan-pro-anual -> plan-pro al ano), o null si no es nuestro.
 */
export function priceFromLookupKey(key: string | null | undefined): { product: ProductId; period: PlanPeriod | null } | null {
  const rest = key?.startsWith('cerebro-') ? key.slice('cerebro-'.length) : null
  if (isProduct(rest)) return { product: rest, period: isPlanProduct(rest) ? 'month' : null }
  const annual = rest?.endsWith(ANNUAL_SUFFIX) ? rest.slice(0, -ANNUAL_SUFFIX.length) : null
  return isPlanProduct(annual) ? { product: annual, period: 'year' } : null
}

/** El producto de un lookup_key de Stripe (cerebro-plan-pro y cerebro-plan-pro-anual -> plan-pro), o null si no es nuestro. */
export function productFromLookupKey(key: string | null | undefined): ProductId | null {
  return priceFromLookupKey(key)?.product ?? null
}

/** El plan del mensual que traen los meses incluidos de la ultima compra (Pro con equipo, Esencial en el Acompanado). */
export function includedPlan(product: string): PlanProductId | null {
  if (!isOneTimeProduct(product)) return null
  const included = modality(product).includedMonths
  return included ? `plan-${included.plan}` : null
}

/** Lo que cuesta al mes un plan (para comparar planes, se pague al mes o al ano). */
export function planMonthly(product: PlanProductId): number {
  return plans.find((p) => p.id === planOf(product))?.monthly ?? 0
}

export function launchCouponId(product: OneTimeProductId): string {
  return `cerebro-lanzamiento-${product}`
}

/** Los avisos de Stripe que usa la entrega: los da de alta scripts/stripe-setup.mts y los mira la comprobacion de produccion. */
export const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.closed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const

/** Personas en la zona: hasta 10 con equipo, una sin equipo. */
export function seatsFor(product: OneTimeProductId): number {
  return modality(product).team ? TEAM_MAX_PEOPLE : 1
}

/** Lo que va en la licencia del pago unico (como licenseTerms de la entrega anterior). */
export function licenseTermsFor(
  product: OneTimeProductId,
  emitida: string
): { modalidad: LicenseModality; equipo: boolean; soporte_hasta: string } {
  const offer = modality(product)
  return {
    modalidad: offer.guided ? 'acompanado' : 'hazlo-tu',
    equipo: offer.team,
    soporte_hasta: offer.includedMonths ? addMonths(emitida, offer.includedMonths.months) : emitida,
  }
}

const NAMES: Record<Locale, Record<ProductId, string>> = {
  es: {
    'hazlo-tu': 'Hazlo tú',
    'hazlo-tu-equipo': 'Hazlo tú con equipo',
    acompanado: 'Acompañado',
    'acompanado-equipo': 'Acompañado con equipo',
    'plan-esencial': 'Mensual Esencial',
    'plan-pro': 'Mensual Pro',
    'plan-premium': 'Mensual Premium',
  },
  en: {
    'hazlo-tu': 'Do it yourself',
    'hazlo-tu-equipo': 'Do it yourself, team',
    acompanado: 'Guided',
    'acompanado-equipo': 'Guided, team',
    'plan-esencial': 'Monthly Essential',
    'plan-pro': 'Monthly Pro',
    'plan-premium': 'Monthly Premium',
  },
}

export const BRAND: Record<Locale, string> = { es: 'Cerebro Digital', en: 'Digital Brain' }

export function productName(product: string, locale: Locale): string {
  const name = isProduct(product) ? NAMES[locale][product] : product
  return `${BRAND[locale]} · ${name}`
}

/** El nombre del mensual con cada cuanto se cobra (la descripcion de la suscripcion y el apodo del precio en Stripe). */
export function planProductName(product: PlanProductId, period: PlanPeriod, locale: Locale): string {
  if (period === 'month') return productName(product, locale)
  return `${productName(product, locale)} ${locale === 'en' ? '(paid yearly)' : '(pago anual)'}`
}

/** Precio de lista y de lanzamiento en centimos, sin IVA; el del mensual, al mes o por ano adelantado. */
export function priceCents(product: ProductId, period: PlanPeriod = 'month'): { list: number; launch: number | null } {
  if (isOneTimeProduct(product)) {
    const offer = modality(product)
    return { list: offer.listPrice * 100, launch: offer.launchPrice * 100 }
  }
  const plan = plans.find((p) => p.id === planOf(product))
  if (!plan) throw new Error(`plan desconocido: ${product}`)
  return { list: (period === 'year' ? plan.yearly : plan.monthly) * 100, launch: null }
}
