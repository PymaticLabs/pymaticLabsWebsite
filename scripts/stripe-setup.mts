// Deja Stripe listo para la entrega automatica, sin tocar el panel (y se puede repetir: lo que ya
// esta, no se duplica). Solo con claves de prueba, salvo --live.
//
//   node --env-file=.env.local scripts/stripe-setup.mts [--webhook https://pymaticlabs.com/api/stripe/webhook] [--live]
//
// Crea:
// - un producto por modalidad con su precio de lista en EUR (y los mismos numeros en USD),
//   sin IVA (Stripe Tax lo suma), con lookup_key cerebro-<modalidad>;
// - el mensual: un producto por plan, con su precio al mes (cerebro-plan-esencial, -pro, -premium);
// - el cupon de lanzamiento de cada modalidad (cerebro-lanzamiento-<modalidad>): la diferencia
//   entre lista y lanzamiento, un solo uso por compra y 10 usos como tope (las 10 plazas en total
//   las cuenta la web, que reserva una al abrir cada pago);
// - el portal de cliente: cambiar de plan del mensual, tarjeta, facturas de Stripe y cancelar al
//   final del periodo; la direccion y el correo, si, pero no el NIF ni la razon social (son los de
//   la licencia y de Holded: cambiarlos alli cambiaria el IVA de los cobros siguientes);
// - con --webhook, el endpoint con los avisos que usa la entrega (imprime su secreto una vez);
// - Stripe Tax con la sede de PymaticLabs y el registro del IVA de Espana, si faltan.
//
// A mano en el panel: la URL de las condiciones (Settings > Public details, la pide la casilla de
// Checkout) y, en la cuenta real, el plan de Stripe Tax (Tax Basic).

import Stripe from 'stripe'
import { LAUNCH_CUSTOMERS, modalities, plans } from '../lib/offer.ts'
import { WEBHOOK_EVENTS, launchCouponId, lookupKey, productName, type ProductId } from '../lib/delivery/products.ts'

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

// Stripe Tax: la sede (el origen del IVA), el codigo por defecto y el registro del IVA de Espana.
// Sin ellos el pago con automatic_tax falla. Solo pone lo que falte: en la cuenta real ya estan.
const HEAD_OFFICE = { line1: 'Calle Alfred Giner Sorolla 3', line2: '2º 5ª', postal_code: '12006', city: 'Castellón de la Plana', state: 'CS', country: 'ES' }

async function tax() {
  const settings = await stripe.tax.settings.retrieve()
  const update: Stripe.Tax.SettingsUpdateParams = {}
  if (!settings.head_office?.address?.country) update.head_office = { address: HEAD_OFFICE }
  if (!settings.defaults?.tax_code) update.defaults = { tax_code: TAX_CODE, tax_behavior: 'exclusive' }
  if (Object.keys(update).length) await stripe.tax.settings.update(update)
  const active = await stripe.tax.registrations.list({ status: 'active', limit: 100 })
  if (!active.data.some((r) => r.country === 'ES')) {
    // Pequeno comercio, como en la cuenta real: menos de 10.000 EUR al ano a consumidores de otros paises de la UE.
    await stripe.tax.registrations.create({ country: 'ES', country_options: { es: { type: 'standard', standard: { place_of_supply_scheme: 'small_seller' } } }, active_from: 'now' })
  }
  const after = await stripe.tax.settings.retrieve()
  console.log(`  Stripe Tax: ${after.status === 'active' ? 'activo' : `${after.status} (falta: ${after.status_details?.pending?.missing_fields?.join(', ') ?? '?'})`}, IVA de Espana registrado`)
}

async function main() {
  console.log(`Stripe (${key!.startsWith('sk_test_') ? 'prueba' : 'PRODUCCION'})`)
  await tax()
  for (const m of modalities) {
    const p = await product(m.id, productName(m.id, 'es'))
    const pr = await price(p.id, m.id, m.listPrice * 100, false)
    const c = await coupon(launchCouponId(m.id), p.id, (m.listPrice - m.launchPrice) * 100, 'Precio de lanzamiento')
    console.log(`  ${m.id}: ${p.id} · ${pr.id} (${lookupKey(m.id)}) · cupon ${c.id}`)
  }
  // Un producto por plan: el portal no deja cambiar entre precios del mismo producto con el mismo
  // intervalo. La web reconoce el plan por el lookup_key del precio, no por el producto.
  const planProducts: { product: string; prices: string[] }[] = []
  for (const plan of plans) {
    const id = `plan-${plan.id}` as const
    const p = await product(id, `Cerebro Digital · ${productName(id, 'es')}`)
    const pr = await price(p.id, id, plan.monthly * 100, true)
    planProducts.push({ product: p.id, prices: [pr.id] })
    console.log(`  ${id}: ${p.id} · ${pr.id} (${lookupKey(id)})`)
  }
  // El de antes, con los tres precios en un solo producto: archivado (sus precios ya no se usan).
  const old = (await stripe.products.search({ query: `metadata['cerebro']:'mensual'` })).data[0]
  if (old?.active) {
    await stripe.products.update(old.id, { active: false })
    console.log(`  ${old.id} (mensual con los tres planes): archivado`)
  }

  const portals = await stripe.billingPortal.configurations.list({ limit: 100 })
  const ours = portals.data.find((c) => c.metadata?.cerebro === 'portal')
  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: { enabled: true, allowed_updates: ['address', 'email'] },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: { enabled: true, mode: 'at_period_end' },
    subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: 'create_prorations', products: planProducts },
  }
  if (ours) await stripe.billingPortal.configurations.update(ours.id, { features })
  else await stripe.billingPortal.configurations.create({ features, metadata: { cerebro: 'portal' }, default_return_url: `${process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'}/zona` })
  console.log('  portal de cliente: listo')

  if (webhookUrl) {
    const events: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [...WEBHOOK_EVENTS]
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
