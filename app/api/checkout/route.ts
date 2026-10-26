import { NextRequest, NextResponse } from 'next/server'
import { clientIp, cookieJar, errorResponse, localeOf, readBody, sameOrigin } from '@/lib/api-route'
import { CheckoutError, createCheckout, isCheckoutOpen } from '@/lib/checkout'
import { getDelivery } from '@/lib/delivery/container'
import { isOneTimeProduct, isPlanProduct } from '@/lib/delivery/products'
import { ownedCompany } from '@/lib/delivery/zone'

// Crea el pago en Stripe Checkout y lleva al cliente alli. Lo llaman los botones de la pagina de
// precios y la de elegir sesion (formulario: responde con una redireccion 303) o la zona (JSON:
// responde con la URL). El mensual solo se contrata con la sesion de la zona. Es publica: los
// limites por IP y de huecos apartados estan en createCheckout (429 o 503 si se pasan).

export const runtime = 'nodejs'

/** Donde se ensena el error: la pagina de compra de ese producto (o la zona, en el mensual). */
function errorPage(product: string): string {
  if (isPlanProduct(product)) return '/zona/mensual'
  return isOneTimeProduct(product) ? `/comprar/${product}` : '/precios'
}

export async function POST(request: NextRequest) {
  const { data, form } = await readBody(request)
  const locale = localeOf(data.locale)
  const prefix = locale === 'en' ? '/en' : ''
  const back = (path: string, code: string) => NextResponse.redirect(new URL(`${prefix}${path}?error=${code}`, request.url), 303)

  if (!sameOrigin(request)) return NextResponse.json({ error: 'origen no permitido' }, { status: 403 })
  if (!isCheckoutOpen()) return form ? back('/precios', 'closed') : NextResponse.json({ error: 'la compra no esta abierta' }, { status: 403 })

  const product = data.product ?? ''
  // El hueco elegido llega como "persona|inicio" (un solo campo de radio en el formulario).
  const [slotHost, slotStart] = (data.slot ?? '').split('|')
  const host = data.host || slotHost
  const start = data.start || slotStart
  const delivery = getDelivery()
  try {
    let company = null
    if (isPlanProduct(product)) {
      const user = await delivery.auth.currentUser(cookieJar(request))
      if (!user) throw new CheckoutError('company_required', 'entra en la zona de socio para contratar el mensual')
      company = await ownedCompany(delivery, user, data.company || null)
    }
    const session = await createCheckout(delivery, {
      product,
      locale,
      currency: data.currency === 'usd' ? 'usd' : 'eur',
      session: host && start ? { host, start } : null,
      company,
      clientIp: clientIp(request),
    })
    return form ? NextResponse.redirect(session.url, 303) : NextResponse.json({ url: session.url, launch: session.launch })
  } catch (error) {
    if (error instanceof CheckoutError) {
      if (form) return back(errorPage(product), error.code)
      const status = error.code === 'rate_limited' ? 429 : error.code === 'busy' ? 503 : error.code === 'slot_taken' || error.code === 'already_subscribed' ? 409 : 400
      return NextResponse.json({ error: error.message, code: error.code }, { status })
    }
    if (form) return back(errorPage(product), 'unavailable')
    return errorResponse(error, 'checkout')
  }
}
