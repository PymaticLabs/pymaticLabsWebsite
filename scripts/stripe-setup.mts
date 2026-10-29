// Deja Stripe listo para la entrega automatica, sin tocar el panel (y se puede repetir: lo que ya
// esta, no se duplica). Solo con claves de prueba, salvo --live.
//
//   node --env-file=.env.local scripts/stripe-setup.mts [--webhook https://pymaticlabs.com/api/stripe/webhook] [--live]
//
// Crea:
// - el tipo de IVA del 21 % (sin IVA dentro, de Espana, metadata cerebro=iva-21), que llevan los
//   pagos con IVA (Espana peninsular y Baleares, y la UE sin NIF-IVA); los demas van sin el. El IVA
//   lo decide la web antes de pagar, sin Stripe Tax (lib/delivery/checkout-tax.ts);
// - un producto por modalidad con su precio de lista en EUR, sin IVA (el tipo del 21 % lo suma en
//   el pago), con lookup_key cerebro-<modalidad>;
// - el mensual: un producto por plan, con su precio al mes (cerebro-plan-esencial, -pro, -premium) y,
//   en el mismo producto, el de por ano adelantado, al precio de 10 meses (cerebro-plan-<plan>-anual;
//   oferta v1.9), los dos sin IVA (el 21 % va en la suscripcion);
// - el cupon de lanzamiento de cada modalidad (cerebro-lanzamiento-<modalidad>): la diferencia
//   entre lista y lanzamiento, un solo uso por compra y 10 usos como tope (las 10 plazas en total
//   las cuenta la web, que reserva una al abrir cada pago);
// - el portal de cliente: cambiar de plan del mensual y entre pago mensual y anual, tarjeta,
//   facturas de Stripe y cancelar al final del periodo; subir de plan o pasar a anual, al momento y
//   cobrado en ese momento (always_invoice: la diferencia se factura ya, no en la renovacion);
//   bajar de plan o pasar de anual a mensual, al final del periodo pagado (los periodos empezados no
//   se devuelven: clausula 5; retainers-y-mantenimiento v2.8). Con meses incluidos (la prueba hasta
//   el fin de los que trae la compra), cualquier cambio de plan o de periodo los respeta y se cobra
//   al acabar (continue_trial; los socios, 27-10-2026). La direccion y el correo, si, pero no el NIF
//   ni la razon social (son los de la licencia y de Holded: cambiarlos alli cambiaria el IVA de los
//   cobros siguientes);
// - con --webhook, el endpoint con los avisos que usa la entrega (imprime su secreto una vez).
//
// A mano en el panel: la URL de las condiciones (Settings > Public details, la pide la casilla de
// Checkout). Stripe Tax no hace falta: si estaba activo, se puede dejar o apagar (los pagos no lo usan).

import Stripe from 'stripe'
import { LAUNCH_CUSTOMERS, modalities, plans } from '../lib/offer.ts'
import { WEBHOOK_EVENTS, isPlanProduct, launchCouponId, lookupKey, planProductName, priceCents, productName, type PlanPeriod, type ProductId } from '../lib/delivery/products.ts'
import { isSpainTaxRate } from '../lib/delivery/adapters/stripe-payments.ts'
import { SPAIN_VAT_RATE, TAX_RATE_TAG } from '../lib/delivery/tax.ts'

const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('STRIPE_SECRET_KEY sin configurar')
if (!key.startsWith('sk_test_') && !process.argv.includes('--live')) throw new Error('no es una clave de prueba: anade --live si de verdad es para produccion')
const stripe = new Stripe(key)
const webhookIndex = process.argv.indexOf('--webhook')
const webhookUrl = webhookIndex > 0 ? process.argv[webhookIndex + 1] : null

// Por su metadato cerebro, con products.list (paginando, activos o no): products.search tarda hasta
// un minuto en ver lo recien creado y, repitiendo el script enseguida, duplicaba los productos (y el
// cupon de lanzamiento se quedaba en el viejo).
async function findProduct(id: string): Promise<Stripe.Product | null> {
  for await (const p of stripe.products.list({ limit: 100 })) if (p.metadata?.cerebro === id) return p
  return null
}

async function product(id: string, name: string): Promise<Stripe.Product> {
  const found = await findProduct(id)
  // El nombre es el que ve el cliente en el pago y en las facturas de Stripe: se corrige si cambio.
  if (found) return found.name === name ? found : stripe.products.update(found.id, { name })
  return stripe.products.create({ name, metadata: { cerebro: id } })
}

// recurring: el periodo del mensual (month o year); null en el pago unico.
async function price(productId: string, product: ProductId, cents: number, recurring: PlanPeriod | null): Promise<Stripe.Price> {
  const lookup = lookupKey(product, recurring ?? 'month')
  const existing = (await stripe.prices.list({ lookup_keys: [lookup], active: true, expand: ['data.currency_options'] })).data[0]
  const same = existing && existing.unit_amount === cents && existing.product === productId && (existing.recurring?.interval ?? null) === recurring
  if (same) return existing
  // Precio nuevo (o cambiado): se lleva el lookup_key y el viejo deja de usarse.
  const created = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: cents,
    tax_behavior: 'exclusive',
    lookup_key: lookup,
    transfer_lookup_key: true,
    nickname: recurring && isPlanProduct(product) ? planProductName(product, recurring, 'es') : productName(product, 'es'),
    ...(recurring ? { recurring: { interval: recurring } } : {}),
  })
  if (existing) await stripe.prices.update(existing.id, { active: false })
  return created
}

async function coupon(id: string, productId: string, cents: number, name: string) {
  try {
    // applies_to solo llega pedido (expand). Un cupon no cambia de producto ni de importe.
    const existing = await stripe.coupons.retrieve(id, { expand: ['applies_to'] })
    if (existing.amount_off !== cents) console.warn(`  ! el cupon ${id} ya existe con otro importe: borrarlo a mano y repetir`)
    if (!existing.applies_to?.products.includes(productId)) {
      console.warn(`  ! el cupon ${id} no es del producto ${productId} (es de ${existing.applies_to?.products.join(', ') || 'ninguno en concreto'}): borrarlo a mano y repetir`)
    }
    return existing
  } catch {
    return stripe.coupons.create({
      id,
      name,
      amount_off: cents,
      currency: 'eur',
      duration: 'once',
      max_redemptions: LAUNCH_CUSTOMERS,
      applies_to: { products: [productId] },
    })
  }
}

// El tipo de IVA del 21 % que llevan los pagos (line_items[].tax_rates y default_tax_rates del
// mensual). Un tipo de Stripe no cambia de porcentaje: si alguno con cerebro=iva-21 no vale
// (archivado, otro porcentaje, IVA dentro), se crea otro y la web usa el que vale.
async function taxRate(): Promise<Stripe.TaxRate> {
  const rates = await stripe.taxRates.list({ limit: 100 })
  const existing = rates.data.find(isSpainTaxRate)
  if (existing) return existing
  for (const old of rates.data.filter((r) => r.metadata?.cerebro === TAX_RATE_TAG && r.active)) {
    await stripe.taxRates.update(old.id, { active: false })
    console.log(`  ${old.id} (${old.percentage} %${old.inclusive ? ', IVA dentro' : ''}): archivado`)
  }
  return stripe.taxRates.create({
    display_name: 'IVA',
    description: `IVA general de Espana (${SPAIN_VAT_RATE} %)`,
    percentage: SPAIN_VAT_RATE,
    inclusive: false,
    country: 'ES',
    jurisdiction: 'ES',
    tax_type: 'vat',
    metadata: { cerebro: TAX_RATE_TAG },
  })
}

async function main() {
  console.log(`Stripe (${key!.startsWith('sk_test_') ? 'prueba' : 'PRODUCCION'})`)
  const rate = await taxRate()
  console.log(`  IVA: ${rate.id} (${rate.percentage} %, sin IVA dentro, ${rate.country})`)
  for (const m of modalities) {
    const p = await product(m.id, productName(m.id, 'es'))
    const pr = await price(p.id, m.id, m.listPrice * 100, null)
    const c = await coupon(launchCouponId(m.id), p.id, (m.listPrice - m.launchPrice) * 100, 'Precio de lanzamiento')
    console.log(`  ${m.id}: ${p.id} · ${pr.id} (${lookupKey(m.id)}) · cupon ${c.id}`)
  }
  // Un producto por plan: el portal no deja cambiar entre precios del mismo producto con el mismo
  // intervalo, pero si entre el del mes y el del ano. La web reconoce el plan y el periodo por el
  // lookup_key del precio, no por el producto.
  const planProducts: { product: string; prices: string[] }[] = []
  for (const plan of plans) {
    const id = `plan-${plan.id}` as const
    const p = await product(id, productName(id, 'es'))
    const prices: string[] = []
    for (const period of ['month', 'year'] as const) {
      const pr = await price(p.id, id, priceCents(id, period).list, period)
      prices.push(pr.id)
      console.log(`  ${id} (${period === 'year' ? 'al ano' : 'al mes'}): ${p.id} · ${pr.id} (${lookupKey(id, period)}, ${pr.unit_amount! / 100} € sin IVA)`)
    }
    planProducts.push({ product: p.id, prices })
  }
  // El de antes, con los tres precios en un solo producto: archivado (sus precios ya no se usan).
  const old = await findProduct('mensual')
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
    subscription_update: {
      enabled: true,
      default_allowed_updates: ['price'],
      // Subir de plan se cobra al momento: con create_prorations la diferencia quedaba pendiente hasta
      // la renovacion (en el anual, hasta un ano) y, cancelando al final del periodo, no se cobraba
      // nunca. La factura del cambio llega con invoice.paid y da la licencia con el plan nuevo.
      proration_behavior: 'always_invoice',
      products: planProducts,
      // Bajar de plan o pasar de anual a mensual, al final del periodo pagado: ni abonos ni devoluciones.
      schedule_at_period_end: { conditions: [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }] },
      // Con meses incluidos (prueba), cambiar de plan o pasar a anual no los acaba: se cobra al acabar.
      // Sin decirlo, Stripe pone end_trial y el cambio se cobra ese dia, perdiendo los meses que quedan.
      trial_update_behavior: 'continue_trial',
    },
  }
  // active: una desactivada (desde el panel) no la encuentra la web y nadie abre el portal.
  if (ours) await stripe.billingPortal.configurations.update(ours.id, { active: true, features })
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
