// Avisos de Stripe de mentira, con la forma de los de verdad (API 2025-09-30.clover) y firmados con
// un secreto de prueba: los usan las pruebas, la prueba de punta a punta y la pagina de pago de
// prueba (/api/dev/checkout). Solo llevan los campos que lee la entrega.
//
// Con los metadatos del IVA que pone el pago (tax_country, tax_territory, tax_treatment: lib/checkout.ts),
// la direccion de facturacion es la de ese pais y territorio, y el IVA el que toca (el 21 % en
// standard, nada en los demas); sin ellos, como los pagos de antes (Espana, en Castellon, con el 21 %).

import Stripe from 'stripe'
import { randomBytes } from 'node:crypto'
import { lookupKey, type ProductId } from './products.ts'

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`

/** Una direccion de cada territorio de Espana (la de siempre, en Castellon, para la peninsula). */
const SPAIN_ADDRESSES: Record<string, { city: string; postal_code: string; state: string }> = {
  peninsula: { city: 'Castellón de la Plana', postal_code: '12001', state: 'CS' },
  canarias: { city: 'Las Palmas de Gran Canaria', postal_code: '35001', state: 'GC' },
  ceuta: { city: 'Ceuta', postal_code: '51001', state: 'CE' },
  melilla: { city: 'Melilla', postal_code: '52001', state: 'ML' },
}

/** La direccion de facturacion: la de Castellon salvo que se diga otro territorio de Espana (o el codigo postal). */
function billingAddress(country: string, territory: string | undefined, postalCode: string | undefined) {
  const base = SPAIN_ADDRESSES[country === 'ES' && territory ? territory : 'peninsula'] ?? SPAIN_ADDRESSES.peninsula
  return { line1: 'Calle Mayor 1', line2: null, city: base.city, postal_code: postalCode ?? base.postal_code, state: base.state, country }
}

/** El IVA del pago, en %: el que diga la prueba; si no, el de los metadatos (standard, el 21 %); si no, el 21 % en Espana. */
function rateOf(taxRate: number | undefined, metadata: Record<string, string> | undefined, country: string): number {
  if (taxRate !== undefined) return taxRate
  if (metadata?.tax_treatment) return metadata.tax_treatment === 'standard' ? 21 : 0
  return country === 'ES' ? 21 : 0
}

export interface FakeBuyer {
  company: string
  taxId: string
  taxIdType?: string
  email: string
  /** Por defecto, el de los metadatos (tax_country) o Espana. */
  country?: string
  /** El codigo postal de la direccion de facturacion (por defecto, el del territorio de los metadatos). */
  postalCode?: string
}

export function fakeCheckoutSession(input: {
  product: string
  buyer: FakeBuyer
  metadata?: Record<string, string>
  amountSubtotal: number
  amountDiscount?: number
  taxRate?: number
  currency?: string
  created?: number
  customer?: string
  paymentIntent?: string
  sessionId?: string
  marketing?: 'si' | 'no'
}): Record<string, unknown> {
  const discount = input.amountDiscount ?? 0
  const declared = input.metadata?.tax_country
  const country = input.buyer.country ?? declared ?? 'ES'
  const net = input.amountSubtotal - discount
  const rate = rateOf(input.taxRate, input.metadata, country)
  const tax = Math.round((net * rate) / 100)
  return {
    id: input.sessionId ?? id('cs_test'),
    object: 'checkout.session',
    mode: 'payment',
    status: 'complete',
    payment_status: 'paid',
    created: input.created ?? Math.floor(Date.now() / 1000),
    currency: input.currency ?? 'eur',
    locale: input.metadata?.locale ?? 'es',
    customer: input.customer ?? id('cus'),
    payment_intent: input.paymentIntent ?? id('pi'),
    amount_subtotal: input.amountSubtotal,
    amount_total: net + tax,
    total_details: { amount_discount: discount, amount_shipping: 0, amount_tax: tax },
    customer_details: {
      address: billingAddress(country, input.metadata?.tax_territory, input.buyer.postalCode),
      business_name: input.buyer.company,
      email: input.buyer.email,
      individual_name: null,
      name: 'Persona de contacto',
      phone: null,
      tax_exempt: 'none',
      // Sin tax_id_collection, Stripe no guarda NIF: el declarado va en los metadatos. Los pagos de antes si lo traian.
      tax_ids: declared ? [] : [{ type: input.buyer.taxIdType ?? (country === 'ES' ? 'es_cif' : 'eu_vat'), value: input.buyer.taxId }],
    },
    collected_information: { business_name: input.buyer.company, individual_name: null, shipping_details: null },
    consent: { promotions: null, terms_of_service: 'accepted' },
    custom_fields: input.marketing ? [{ key: 'novedades', type: 'dropdown', dropdown: { value: input.marketing } }] : [],
    metadata: { product: input.product, ...input.metadata },
  }
}

export function fakeInvoice(input: {
  customer: string
  amount: number
  taxRate?: number
  periodEnd: number
  metadata?: Record<string, string>
  invoiceId?: string
  subscription?: string
  country?: string
  /** El codigo postal de la direccion de facturacion (por defecto, uno de Castellon). */
  postalCode?: string
  /** Sin direccion en la factura (customer_address null): la entrega mira la de la empresa. */
  noAddress?: boolean
  created?: number
  /** El precio cobrado (price_fake_cerebro-plan-...): por defecto, el del plan y el periodo de los metadatos. */
  price?: string
  /** Mas lineas de la suscripcion en la misma factura, antes de la del cobro: el abono del mes sin usar al pasar a pago anual. */
  extraLines?: { amount: number; periodEnd: number; price: string }[]
  customerTaxIds?: { type: string; value: string }[]
  /** open: un cobro que no se pudo hacer (invoice.payment_failed), con su enlace para pagarlo. */
  status?: 'paid' | 'open'
}): Record<string, unknown> {
  const product = input.metadata?.product
  const price = input.price ?? (product ? `price_fake_${lookupKey(product as ProductId, input.metadata?.period === 'year' ? 'year' : 'month')}` : null)
  const created = input.created ?? Math.floor(Date.now() / 1000)
  // Como las ordena Stripe al cambiar de precio: primero el abono del tiempo sin usar, despues el cobro.
  const lines = [...(input.extraLines ?? []), { amount: input.amount, periodEnd: input.periodEnd, price }]
  const net = lines.reduce((sum, l) => sum + l.amount, 0)
  const country = input.country ?? input.metadata?.tax_country ?? 'ES'
  // Como el pago unico: el IVA de los metadatos de la suscripcion (standard, el 21 %); sin ellos, el 21 %.
  const tax = Math.round((net * rateOf(input.taxRate, input.metadata, 'ES')) / 100)
  const open = input.status === 'open'
  const invoiceId = input.invoiceId ?? id('in')
  return {
    id: invoiceId,
    object: 'invoice',
    amount_due: net + tax,
    amount_paid: open ? 0 : net + tax,
    attempt_count: 1,
    hosted_invoice_url: `https://invoice.stripe.com/i/acct_fake/${invoiceId}`,
    billing_reason: 'subscription_cycle',
    created,
    currency: 'eur',
    customer: input.customer,
    customer_email: null,
    // Como la del pago unico: cada cobro se mira que siga en el pais (y el territorio) declarados.
    customer_address: input.noAddress ? null : billingAddress(country, input.metadata?.tax_territory, input.postalCode),
    customer_tax_ids: input.customerTaxIds ?? [],
    lines: {
      object: 'list',
      data: lines.map((line) => ({
        id: id('il'),
        object: 'line_item',
        amount: line.amount,
        period: { start: created, end: line.periodEnd },
        parent: { type: 'subscription_item_details' },
        ...(line.price ? { pricing: { type: 'price_details', price_details: { price: line.price, product: 'prod_fake_mensual' }, unit_amount_decimal: String(line.amount) } } : {}),
      })),
    },
    parent: { type: 'subscription_details', subscription_details: { subscription: input.subscription ?? id('sub'), metadata: input.metadata ?? {} } },
    period_end: input.periodEnd,
    status: open ? 'open' : 'paid',
    status_transitions: { paid_at: open ? null : created },
    subtotal: net,
    total: net + tax,
    total_excluding_tax: net,
    total_taxes: tax ? [{ amount: tax, tax_behavior: 'exclusive', taxability_reason: 'standard_rated', taxable_amount: net, type: 'tax_rate_details' }] : [],
    total_discount_amounts: [],
  }
}

/**
 * Un cobro devuelto. refunds: cada devolucion con su id; por defecto, una sola por todo lo devuelto
 * (con dos devoluciones, se dan las dos, como las lista Stripe).
 */
export function fakeCharge(input: { paymentIntent: string; amount: number; refunded: number; refunds?: { id: string; amount: number; status?: string }[] }): Record<string, unknown> {
  const refunds = input.refunds ?? (input.refunded > 0 ? [{ id: `re_${input.paymentIntent}_${input.refunded}`, amount: input.refunded, status: 'succeeded' }] : [])
  return {
    id: id('ch'),
    object: 'charge',
    amount: input.amount,
    amount_refunded: input.refunded,
    refunded: input.refunded >= input.amount,
    payment_intent: input.paymentIntent,
    currency: 'eur',
    refunds: { object: 'list', data: refunds.map((r) => ({ object: 'refund', status: 'succeeded', ...r })), has_more: false },
  }
}

export function fakeDispute(input: { paymentIntent: string; amount: number; status?: string; disputeId?: string }): Record<string, unknown> {
  return {
    id: input.disputeId ?? id('dp'),
    object: 'dispute',
    amount: input.amount,
    charge: id('ch'),
    payment_intent: input.paymentIntent,
    currency: 'eur',
    reason: 'fraudulent',
    status: input.status ?? 'needs_response',
  }
}

/** created: el del objeto si lo trae (en las pruebas, el pago se cobra cuando se abrio), o ahora. */
export function fakeEvent(type: string, object: Record<string, unknown>, eventId?: string, created?: number): Stripe.Event {
  return {
    id: eventId ?? id('evt'),
    object: 'event',
    api_version: '2025-09-30.clover',
    created: created ?? (Number(object.created) || Math.floor(Date.now() / 1000)),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type,
    data: { object },
  } as unknown as Stripe.Event
}

/** La cabecera Stripe-Signature de un aviso, con el secreto del webhook de prueba. */
export function signPayload(payload: string, secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload, secret })
}
