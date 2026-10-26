// Stripe: sesiones de Checkout, portal de cliente y lo que la conciliacion pregunta de cada pago.
//
// STRIPE_SECRET_KEY (sk_test_... hasta abrir la venta). Los precios se buscan por lookup_key y se
// guardan en memoria: los crea scripts/stripe-setup.mts.

import Stripe from 'stripe'
import { requireEnv } from './http.ts'
import { PermanentError, RetryableError, type PaymentStatus, type Payments, type RefundInfo, type TaxDetails } from '../types.ts'

/** Un contracargo que cuenta: abierto o perdido (no uno ganado, evitado ni una peticion de informacion). */
const COUNTED_DISPUTES = ['needs_response', 'under_review', 'lost']

/** Los errores de Stripe, clasificados para la cola. */
async function call<T>(what: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const e = error as { type?: string; statusCode?: number; message?: string; code?: string }
    const message = `Stripe ${what}: ${e.message ?? error}`
    if (e.type === 'StripeConnectionError' || e.type === 'StripeAPIError' || e.type === 'StripeRateLimitError' || (e.statusCode ?? 0) >= 500) {
      throw new RetryableError(message)
    }
    throw Object.assign(new PermanentError(message), { code: e.code, status: e.statusCode })
  }
}

export class StripePayments implements Payments {
  readonly name = 'stripe'
  private stripe: Stripe
  private prices = new Map<string, string>()
  private portalConfiguration: string | null = null

  constructor(env: Record<string, string | undefined>) {
    this.stripe = new Stripe(requireEnv(env, 'STRIPE_SECRET_KEY'), { maxNetworkRetries: 2 })
  }

  async priceId(lookupKey: string) {
    const cached = this.prices.get(lookupKey)
    if (cached) return cached
    const list = await call('prices', () => this.stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 }))
    const price = list.data[0]
    if (!price) throw new PermanentError(`Stripe no tiene un precio activo con lookup_key ${lookupKey} (scripts/stripe-setup.mts)`)
    this.prices.set(lookupKey, price.id)
    return price.id
  }

  async createCheckoutSession(params: Record<string, unknown>) {
    const session = await call('checkout', () => this.stripe.checkout.sessions.create(params as unknown as Stripe.Checkout.SessionCreateParams))
    if (!session.url) throw new PermanentError('Stripe no devolvio la URL de pago')
    return { id: session.id, url: session.url, expiresAt: session.expires_at }
  }

  /**
   * Con la configuracion del portal que crea scripts/stripe-setup.mts (metadata cerebro=portal). Sin
   * pasarla, Stripe usa la del panel: en vivo falla si nunca se guardo, o deja cambiar el NIF y no
   * ofrece los planes. Sin la nuestra no se abre ninguna (la comprobacion de produccion lo avisa).
   */
  async createPortalSession(customerId: string, returnUrl: string) {
    if (!this.portalConfiguration) {
      const list = await call('portal', () => this.stripe.billingPortal.configurations.list({ active: true, limit: 100 }))
      const ours = list.data.find((c) => c.metadata?.cerebro === 'portal')
      if (!ours) throw new PermanentError('Stripe no tiene la configuracion del portal (scripts/stripe-setup.mts)')
      this.portalConfiguration = ours.id
    }
    const configuration = this.portalConfiguration
    const portal = await call('portal', () => this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, configuration }))
    return portal.url
  }

  async invoiceIdForPaymentIntent(paymentIntentId: string) {
    const list = await call('invoice_payments', () =>
      this.stripe.invoicePayments.list({ payment: { type: 'payment_intent', payment_intent: paymentIntentId }, limit: 1 })
    )
    const invoice = list.data[0]?.invoice
    return typeof invoice === 'string' ? invoice : invoice?.id ?? null
  }

  async paymentStatus(ref: string): Promise<PaymentStatus> {
    const missing: PaymentStatus = { exists: false, paid: false, refunded: false, disputed: false, amount: null }
    try {
      if (ref.startsWith('pi_')) {
        const intent = await call('payment_intents', () => this.stripe.paymentIntents.retrieve(ref, { expand: ['latest_charge'] }))
        const charge = typeof intent.latest_charge === 'object' ? intent.latest_charge : null
        // charge.disputed sigue en true tras ganar un contracargo: se mira cada uno (solo si lo hubo).
        let disputed = false
        if (charge?.disputed) {
          const disputes = await call('disputes', () => this.stripe.disputes.list({ payment_intent: ref, limit: 10 }))
          disputed = disputes.data.some((d) => COUNTED_DISPUTES.includes(d.status))
        }
        return {
          exists: true,
          paid: intent.status === 'succeeded',
          refunded: charge?.refunded ?? false,
          disputed,
          amount: intent.amount_received,
        }
      }
      if (ref.startsWith('in_')) {
        const invoice = await call('invoices', () => this.stripe.invoices.retrieve(ref))
        return { exists: true, paid: invoice.status === 'paid', refunded: false, disputed: false, amount: invoice.amount_paid }
      }
      if (ref.startsWith('cs_')) {
        const session = await call('checkout', () => this.stripe.checkout.sessions.retrieve(ref))
        return { exists: true, paid: session.payment_status !== 'unpaid', refunded: false, disputed: false, amount: session.amount_total }
      }
      return missing
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return missing
      throw error
    }
  }

  async refundsOf(charge: { id: string; refunds?: { data?: unknown[]; has_more?: boolean } | null }): Promise<RefundInfo[]> {
    const embedded = charge.refunds?.data as Stripe.Refund[] | undefined
    const refunds =
      embedded && !charge.refunds?.has_more
        ? embedded
        : await call('refunds', () => this.stripe.refunds.list({ charge: charge.id, limit: 100 }).autoPagingToArray({ limit: 1000 }))
    return refunds.map((r) => ({ id: r.id, amount: r.amount, status: r.status }))
  }

  async taxDetails(input: { checkoutSessionId?: string | null; invoiceId?: string | null; customerId?: string | null }): Promise<TaxDetails> {
    let reasons: string[] = []
    let amountTax: number | null = null
    if (input.checkoutSessionId) {
      // El desglose solo llega pidiendolo (expand): no viene en el aviso.
      const session = await call('checkout', () => this.stripe.checkout.sessions.retrieve(input.checkoutSessionId!, { expand: ['total_details.breakdown'] }))
      reasons = (session.total_details?.breakdown?.taxes ?? []).map((t) => t.taxability_reason ?? '').filter(Boolean)
      amountTax = session.total_details?.amount_tax ?? 0
    } else if (input.invoiceId) {
      const invoice = await call('invoices', () => this.stripe.invoices.retrieve(input.invoiceId!))
      reasons = (invoice.total_taxes ?? []).map((t) => t.taxability_reason ?? '').filter(Boolean)
      amountTax = (invoice.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0)
    }
    const taxIds = input.customerId
      ? (await call('tax_ids', () => this.stripe.customers.listTaxIds(input.customerId!, { limit: 20 }))).data.map((t) => ({
          type: t.type,
          value: t.value,
          verification: t.verification?.status ?? null,
        }))
      : []
    return { reasons, amountTax, taxIds }
  }

  async priceLookupKey(priceId: string) {
    const price = await call('prices', () => this.stripe.prices.retrieve(priceId))
    return price.lookup_key ?? null
  }

  async cancelSubscription(subscriptionId: string) {
    try {
      const subscription = await call('subscriptions', () => this.stripe.subscriptions.retrieve(subscriptionId))
      if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') return false
      await call('subscriptions', () => this.stripe.subscriptions.cancel(subscriptionId, { prorate: false }))
      return true
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') return false
      throw error
    }
  }

  async listPaidCheckoutSessions(sinceUnix: number) {
    const sessions = await call('checkout', () =>
      this.stripe.checkout.sessions.list({ status: 'complete', created: { gte: sinceUnix }, limit: 100 }).autoPagingToArray({ limit: 2000 })
    )
    return sessions.filter((s) => s.payment_status === 'paid') as unknown as Record<string, unknown>[]
  }

  async listPaidInvoices(sinceUnix: number) {
    const invoices = await call('invoices', () =>
      this.stripe.invoices.list({ status: 'paid', created: { gte: sinceUnix }, limit: 100 }).autoPagingToArray({ limit: 2000 })
    )
    return invoices as unknown as Record<string, unknown>[]
  }
}

/** Comprueba la firma de un aviso de Stripe (no llama a Stripe: basta el secreto del webhook). */
export function constructStripeEvent(payload: string, signature: string, secret: string): Stripe.Event {
  return Stripe.webhooks.constructEvent(payload, signature, secret)
}
