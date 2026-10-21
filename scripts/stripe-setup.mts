// Deja Stripe listo para la entrega automatica, sin tocar el panel (y se puede repetir: lo que ya
// esta, no se duplica). Solo con claves de prueba, salvo --live.
//
//   node --env-file=.env.local scripts/stripe-setup.mts [--webhook https://pymaticlabs.com/api/stripe/webhook] [--live]
//
// Crea:
// - un producto por modalidad con su precio de lista en EUR (y los mismos numeros en USD),
//   sin IVA (Stripe Tax lo suma), con lookup_key cerebro-<modalidad>;
// - el mensual: un producto con sus tres precios al mes (cerebro-plan-esencial, -pro, -premium);
// - el cupon de lanzamiento de cada modalidad (cerebro-lanzamiento-<modalidad>): la diferencia
//   entre lista y lanzamiento, un solo uso por compra y 10 usos como tope (las 10 plazas en total
//   las cuenta la web, que reserva una al abrir cada pago);
// - el portal de cliente: cambiar de plan del mensual, tarjeta, facturas de Stripe y cancelar al
//   final del periodo; la direccion y el correo, si, pero no el NIF ni la razon social (son los de
//   la licencia y de Holded: cambiarlos alli cambiaria el IVA de los cobros siguientes);
// - con --webhook, el endpoint con los avisos que usa la entrega (imprime su secreto una vez).
//
// A mano en el panel: la URL de las condiciones (Settings > Public details, la pide la casilla de
// Checkout), Stripe Tax activado con el registro de IVA de Espana (OSS si toca), y los datos fiscales.

import Stripe from 'stripe'
import { LAUNCH_CUSTOMERS, modalities, plans } from '../lib/offer.ts'
import { launchCouponId, lookupKey, productName, type ProductId } from '../lib/delivery/products.ts'

const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('STRIPE_SECRET_KEY sin configurar')
if (!key.startsWith('sk_test_') && !process.argv.includes('--live')) throw new Error('no es una clave de prueba: anade --live si de verdad es para produccion')
const stripe = new Stripe(key)
const webhookIndex = process.argv.indexOf('--webhook')
const webhookUrl = webhookIndex > 0 ? process.argv[webhookIndex + 1] : null

// Servicios prestados por via electronica (Stripe Tax). Se puede afinar en el panel.
const TAX_CODE = process.env.STRIPE_TAX_CODE || 'txcd_10000000'

async function product(id: string, name: string): Promise<Stripe.Product> {
  const found = await stripe.products.search({ query: `metadata['cerebro']:'${id}'` })
  if (found.data[0]) return found.data[0]
  return stripe.products.create({ name, tax_code: TAX_CODE, metadata: { cerebro: id } })
}

async function price(productId: string, product: ProductId, cents: number, recurring: boolean): Promise<Stripe.Price> {
  const lookup = lookupKey(product)
  const existing = (await stripe.prices.list({ lookup_keys: [lookup], active: true, expand: ['data.currency_options'] })).data[0]
  if (existing && existing.unit_amount === cents && existing.product === productId) return existing
  // Precio nuevo (o cambiado): se lleva el lookup_key y el viejo deja de usarse.
  const created = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: cents,
    tax_behavior: 'exclusive',
    currency_options: { usd: { unit_amount: cents, tax_behavior: 'exclusive' } },
    lookup_key: lookup,
    transfer_lookup_key: true,
    nickname: productName(product, 'es'),
    ...(recurring ? { recurring: { interval: 'month' } } : {}),
  })
  if (existing) await stripe.prices.update(existing.id, { active: false })
  return created
}

async function coupon(id: string, productId: string, cents: number, name: string) {
  try {
    const existing = await stripe.coupons.retrieve(id)
    if (existing.amount_off !== cents) console.warn(`  ! el cupon ${id} ya existe con otro importe: borrarlo a mano y repetir`)
    return existing
  } catch {
    return stripe.coupons.create({
      id,
      name,
      amount_off: cents,
      currency: 'eur',
      currency_options: { usd: { amount_off: cents } },
      duration: 'once',
      max_redemptions: LAUNCH_CUSTOMERS,
      applies_to: { products: [productId] },
    })
  }
}

async function main() {
  console.log(`Stripe (${key!.startsWith('sk_test_') ? 'prueba' : 'PRODUCCION'})`)
  for (const m of modalities) {
    const p = await product(m.id, productName(m.id, 'es'))
    const pr = await price(p.id, m.id, m.listPrice * 100, false)
    const c = await coupon(launchCouponId(m.id), p.id, (m.listPrice - m.launchPrice) * 100, 'Precio de lanzamiento')
    console.log(`  ${m.id}: ${p.id} · ${pr.id} (${lookupKey(m.id)}) · cupon ${c.id}`)
  }
  const monthly = await product('mensual', 'Cerebro Digital · Mensual')
  const planPrices: string[] = []
  for (const plan of plans) {
    const pr = await price(monthly.id, `plan-${plan.id}`, plan.monthly * 100, true)
    planPrices.push(pr.id)
    console.log(`  plan-${plan.id}: ${pr.id} (${lookupKey(`plan-${plan.id}`)})`)
  }

  const portals = await stripe.billingPortal.configurations.list({ limit: 100 })
  const ours = portals.data.find((c) => c.metadata?.cerebro === 'portal')
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ['address', 'email'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: [{ product: monthly.id, prices: planPrices }] },
  }
  if (ours) await stripe.billingPortal.configurations.update(ours.id, { features })
  else await stripe.billingPortal.configurations.create({ features, metadata: { cerebro: 'portal' }, default_return_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'}/zona` })
  console.log('  portal de cliente: listo')

  if (webhookUrl) {
    const events: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
      'invoice.paid',
      'charge.refunded',
      'charge.dispute.created',
      'charge.dispute.updated',
      'charge.dispute.funds_withdrawn',
      'charge.dispute.closed',
      'customer.subscription.created',
      'customer.subscription.updated',
      'customer.subscription.deleted',
    ]
    const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
    const existing = endpoints.data.find((e) => e.url === webhookUrl)
    if (existing) {
      await stripe.webhookEndpoints.update(existing.id, { enabled_events: events })
      console.log(`  webhook ${existing.id}: avisos al dia (su secreto ya estaba en STRIPE_WEBHOOK_SECRET)`)
    } else {
      const created = await stripe.webhookEndpoints.create({ url: webhookUrl, enabled_events: events, description: 'Entrega automatica del Cerebro Digital' })
      console.log(`  webhook ${created.id}: STRIPE_WEBHOOK_SECRET=${created.secret} (ponerlo en Vercel; no se vuelve a ensenar)`)
    }
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
