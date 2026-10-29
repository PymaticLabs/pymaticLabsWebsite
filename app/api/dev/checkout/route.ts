import { NextRequest, NextResponse, after } from 'next/server'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { fakeCheckoutSession, fakeEvent, fakeInvoice, signPayload } from '@/lib/delivery/fake-stripe'
import { runJobs } from '@/lib/delivery/jobs'
import { isOneTimeProduct, isProduct, priceCents } from '@/lib/delivery/products'
import { escapeHtml } from '@/lib/delivery/util'
import { processStripeWebhook } from '@/lib/delivery/webhook'

// Solo en modo falso: la pagina de pago de Stripe de mentira. Pide la empresa, el correo y la
// direccion de facturacion (el pais, por defecto el declarado en /comprar, y el codigo postal, por
// defecto uno de su territorio), "cobra" y manda al webhook los avisos que mandaria Stripe, firmados
// con STRIPE_WEBHOOK_SECRET. Cobra el IVA como Stripe: el 21 % si el pago lleva el tipo de IVA
// (tax_rates, o default_tax_rates en el mensual) y nada si no. La identificacion fiscal ya va en los
// metadatos (lo declarado); solo un pago sin ella (de antes) la pide aqui. Pide tambien el pais de
// la tarjeta (el que contesta cardCountry del Stripe falso): por defecto, el declarado; uno de la UE
// en una venta sin IVA de fuera es la que va a revisar (card_country). Sirve para
// recorrer la compra entera en local, sin cuenta de Stripe, y para la prueba de punta a punta.

export const runtime = 'nodejs'

function page(body: string) {
  return new NextResponse(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago de prueba</title><body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

/** Una direccion de cada territorio de Espana, como las de fakeCheckoutSession. */
const POSTAL_CODES: Record<string, string> = { peninsula: '12001', canarias: '35001', ceuta: '51001', melilla: '52001' }

/** El IVA que cobraria Stripe con esos parametros: el 21 % con el tipo de IVA puesto; si no, nada. */
function chargedRate(params: Record<string, unknown>): number {
  const lines = (params.line_items ?? []) as { tax_rates?: unknown[] }[]
  const subscription = (params.subscription_data ?? {}) as { default_tax_rates?: unknown[] }
  return lines.some((l) => l.tax_rates?.length) || subscription.default_tax_rates?.length ? 21 : 0
}

/** El pais de la tarjeta de cada pago (pi_...), el que contesta el Stripe falso (cardCountry). */
function fakeCards(): Map<string, string> | null {
  return getDelivery().fakes.payments?.cards ?? null
}

function fakeSessionOf(id: string | null) {
  const delivery = getDelivery()
  if (!devToolsEnabled(delivery.config)) return null
  void delivery.payments
  return id ? delivery.fakes.payments?.sessions.get(id) ?? null : null
}

export async function GET(request: NextRequest) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  if (!devToolsEnabled(getDelivery().config)) return new NextResponse(null, { status: 404 })
  const session = fakeSessionOf(request.nextUrl.searchParams.get('id'))
  if (!session) return page('<p>Ese pago no existe o ya caducó.</p>')
  const p = session.params
  const metadata = (p.metadata ?? {}) as Record<string, string>
  const product = String(metadata.product ?? '')
  const field = (name: string, label: string, value = '', required = true) =>
    `<p><label>${label}<br><input name="${name}" value="${escapeHtml(value)}"${required ? ' required' : ''} style="width:100%;padding:.5rem"></label></p>`
  const declared = metadata.tax_country
    ? `<p>Declarado antes de pagar: ${escapeHtml(metadata.tax_country)}${metadata.tax_territory ? ` (${escapeHtml(metadata.tax_territory)})` : ''}, ${escapeHtml(metadata.tax_id ?? '')}, ${escapeHtml(metadata.tax_treatment ?? '')}. IVA que se cobra: ${chargedRate(p)} %.</p>`
    : ''
  const postal = metadata.tax_country === 'ES' || !metadata.tax_country ? (POSTAL_CODES[metadata.tax_territory ?? 'peninsula'] ?? '') : ''
  return page(
    `<h1>Pago de prueba</h1><p>Producto: <strong>${escapeHtml(product)}</strong>${p.discounts ? ' (precio de lanzamiento)' : ''}. Nada se cobra: esto es el modo falso.</p>${declared}
    <form method="post"><input type="hidden" name="id" value="${escapeHtml(session.id)}">
    ${
      p.mode === 'subscription'
        ? ''
        : field('company', 'Razón social', 'Empresa de Prueba SL') +
          (metadata.tax_id ? '' : field('taxId', 'NIF', 'B12345674')) +
          field('email', 'Correo', 'compras@empresa.test') +
          field('country', 'País de la dirección de facturación (ISO)', metadata.tax_country ?? 'ES') +
          field('postalCode', 'Código postal', postal, false) +
          (fakeCards() ? field('cardCountry', 'País de la tarjeta (ISO; vacío, sin tarjeta)', metadata.tax_country ?? 'ES', false) : '')
    }
    <p><button type="submit" style="padding:.6rem 1.2rem">Pagar (prueba)</button></p></form>`
  )
}

export async function POST(request: NextRequest) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  const delivery = getDelivery()
  if (!devToolsEnabled(delivery.config)) return new NextResponse(null, { status: 404 })
  const form = await request.formData()
  const session = fakeSessionOf(String(form.get('id') ?? ''))
  if (!session) return page('<p>Ese pago no existe o ya caducó.</p>')
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return page('<p>Falta STRIPE_WEBHOOK_SECRET (el de prueba) en el entorno.</p>')
  const p = session.params
  const metadata = (p.metadata ?? {}) as Record<string, string>
  const product = metadata.product
  const send = async (type: string, object: Record<string, unknown>) => {
    const payload = JSON.stringify(fakeEvent(type, object))
    return processStripeWebhook(delivery, payload, signPayload(payload, secret), secret)
  }

  if (p.mode === 'subscription') {
    const customer = String(p.customer)
    const trialEnd = Number((p.subscription_data as { trial_end?: number })?.trial_end) || null
    const subscription = `sub_fake_${session.id.slice(-12)}`
    await send('checkout.session.completed', { id: session.id, object: 'checkout.session', mode: 'subscription', payment_status: trialEnd ? 'no_payment_required' : 'paid', customer, subscription, metadata })
    await send('customer.subscription.created', { id: subscription, object: 'subscription', customer, status: trialEnd ? 'trialing' : 'active', metadata })
    if (!trialEnd && isProduct(product)) {
      const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400
      await send('invoice.paid', fakeInvoice({ customer, amount: priceCents(product).list, periodEnd, metadata, subscription, taxRate: chargedRate(p) }))
    }
  } else if (isOneTimeProduct(product)) {
    const prices = priceCents(product)
    const object = fakeCheckoutSession({
      sessionId: session.id,
      product,
      metadata,
      amountSubtotal: prices.list,
      amountDiscount: p.discounts && prices.launch !== null ? prices.list - prices.launch : 0,
      taxRate: chargedRate(p),
      buyer: {
        company: String(form.get('company') ?? ''),
        taxId: String(form.get('taxId') ?? metadata.tax_id ?? ''),
        email: String(form.get('email') ?? ''),
        // Sin decir otra cosa, la direccion es del pais y del territorio declarados.
        country: String(form.get('country') || metadata.tax_country || 'ES').toUpperCase(),
        postalCode: String(form.get('postalCode') ?? '').trim() || undefined,
      },
    })
    // El pais de la tarjeta, antes del aviso: la entrega lo pregunta al llegar.
    const card = String(form.get('cardCountry') ?? '').trim().toUpperCase()
    if (/^[A-Z]{2}$/.test(card)) fakeCards()?.set(String(object.payment_intent), card)
    const result = await send('checkout.session.completed', object)
    if (result.status !== 200) return page(`<p>El webhook respondió ${result.status}: ${escapeHtml(JSON.stringify(result.body))}</p>`)
  }
  after(() => runJobs(delivery, { budgetMs: 30_000 }).catch((error) => console.error('[entrega] cola:', error)))
  return NextResponse.redirect(String(p.success_url).replace('{CHECKOUT_SESSION_ID}', session.id), 303)
}
