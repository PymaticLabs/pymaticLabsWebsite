// Avisos de Stripe de mentira, con la forma de los de verdad (API 2025-09-30.clover) y firmados con
// un secreto de prueba: los usan las pruebas, la prueba de punta a punta y la pagina de pago de
// prueba (/api/dev/checkout). Solo llevan los campos que lee la entrega.

import Stripe from 'stripe'
import { randomBytes } from 'node:crypto'

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString('hex')}`

export interface FakeBuyer {
  company: string
  taxId: string
  taxIdType?: string
  email: string
  country?: string
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
  const country = input.buyer.country ?? 'ES'
  const net = input.amountSubtotal - discount
  const rate = input.taxRate ?? (country === 'ES' ? 21 : 0)
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
      address: { line1: 'Calle Mayor 1', line2: null, city: 'Castellón de la Plana', postal_code: '12001', state: 'CS', country },
      business_name: input.buyer.company,
      email: input.buyer.email,
      individual_name: null,
      name: 'Persona de contacto',
      phone: null,
      tax_exempt: 'none',
      tax_ids: [{ type: input.buyer.taxIdType ?? (country === 'ES' ? 'es_cif' : 'eu_vat'), value: input.buyer.taxId }],
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
  created?: number
  /** El precio cobrado (price_fake_cerebro-plan-...): por defecto, el del plan de los metadatos. */
  price?: string
  customerTaxIds?: { type: string; value: string }[]
}): Record<string, unknown> {
  const price = input.price ?? (input.metadata?.product ? `price_fake_cerebro-${input.metadata.product}` : null)
  const tax = Math.round((input.amount * (input.taxRate ?? 21)) / 100)
  const created = input.created ?? Math.floor(Date.now() / 1000)
  return {
    id: input.invoiceId ?? id('in'),
    object: 'invoice',
    amount_paid: input.amount + tax,
    billing_reason: 'subscription_cycle',
    created,
    currency: 'eur',
    customer: input.customer,
    customer_email: null,
    customer_address: { country: input.country ?? 'ES' },
    customer_tax_ids: input.customerTaxIds ?? [],
    lines: {
      object: 'list',
      data: [
        {
          id: id('il'),
          object: 'line_item',
          amount: input.amount,
          period: { start: created, end: input.periodEnd },
          parent: { type: 'subscription_item_details' },
          ...(price ? { pricing: { type: 'price_details', price_details: { price, product: 'prod_fake_mensual' }, unit_amount_decimal: String(input.amount) } } : {}),
        },
      ],
    },
    parent: { type: 'subscription_details', subscription_details: { subscription: input.subscription ?? id('sub'), metadata: input.metadata ?? {} } },
    period_end: input.periodEnd,
    status: 'paid',
    status_transitions: { paid_at: created },
    subtotal: input.amount,
    total: input.amount + tax,
    total_excluding_tax: input.amount,
    total_taxes: tax ? [{ amount: tax, tax_behavior: 'exclusive', taxability_reason: 'standard_rated', taxable_amount: input.amount, type: 'tax_rate_details' }] : [],
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
