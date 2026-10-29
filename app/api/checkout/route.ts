import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { clientIp, cookieJar, errorResponse, localeOf, readBody, sameOrigin } from '@/lib/api-route'
import { CheckoutError, SLOTS_CACHE_TAG, createCheckout, isCheckoutOpen } from '@/lib/checkout'
import { isSaleCountry, isSpainTerritory } from '@/lib/delivery/checkout-tax'
import { getDelivery } from '@/lib/delivery/container'
import { isGuided, isOneTimeProduct, isPlanProduct } from '@/lib/delivery/products'
import { ownedCompany } from '@/lib/delivery/zone'

// Crea el pago en Stripe Checkout y lleva al cliente alli. Lo llaman la pagina de compra
// (/comprar/<modalidad>, con el pais, la identificacion fiscal y, en el Acompanado, la sesion
// elegida: formulario, responde con una redireccion 303) o la zona (JSON: responde con la URL). El
// pago unico pide el pais (country; sin el, Espana) y, segun el, el territorio y el NIF espanol
// (territory, taxId), el NIF-IVA (vatId) o la identificacion fiscal (otherTaxId): los que no tocan
// se ignoran (sin JavaScript llegan todos). Sin ninguno (un boton que manda directo aqui), a
// /comprar, que los pide. Solo en euros: otra moneda (currency=usd) se rechaza. El mensual solo se
// contrata con la sesion de la zona, al mes o por ano adelantado (period=month o year). Es publica:
// los limites por IP y de huecos apartados estan en createCheckout (429 o 503 si se pasan).

export const runtime = 'nodejs'

/** Donde se ensena el error: la pagina de compra de ese producto (o la zona, en el mensual). */
function errorPage(product: string): string {
  if (isPlanProduct(product)) return '/zona/mensual'
  return isOneTimeProduct(product) ? `/comprar/${product}` : '/precios'
}

/** HTTP de cada error, en JSON: limites, 429; lo que hay que esperar (VIES caido, demasiados huecos), 503; lo ocupado, 409. */
function statusOf(code: string): number {
  if (code === 'rate_limited') return 429
  if (code === 'busy' || code === 'vat_unavailable') return 503
  if (code === 'slot_taken' || code === 'already_subscribed' || code === 'launch_busy') return 409
  return 400
}

export async function POST(request: NextRequest) {
  const { data, form } = await readBody(request)
  const locale = localeOf(data.locale)
  const prefix = locale === 'en' ? '/en' : ''
  const product = data.product ?? ''
  // De vuelta a /comprar con un error, el pais y el territorio elegidos (sin la identificacion: no va en la URL).
  const keep = new URLSearchParams()
  if (isOneTimeProduct(product)) {
    const country = data.country?.trim().toUpperCase()
    if (isSaleCountry(country)) keep.set('pais', country)
    if (country === 'ES' && isSpainTerritory(data.territory)) keep.set('territorio', data.territory)
  }
  const back = (path: string, code: string) => {
    const query = new URLSearchParams({ error: code, ...(path.startsWith('/comprar/') ? Object.fromEntries(keep) : {}) })
    return NextResponse.redirect(new URL(`${prefix}${path}?${query}`, request.url), 303)
  }

  if (!sameOrigin(request)) return NextResponse.json({ error: 'origen no permitido' }, { status: 403 })
  if (!isCheckoutOpen()) return form ? back('/precios', 'closed') : NextResponse.json({ error: 'la compra no esta abierta' }, { status: 403 })

  // Sin pais ni NIF (el boton Comprar de /precios), primero la pagina de compra, que los pide y los comprueba.
  if (form && isOneTimeProduct(product) && data.taxId === undefined && data.country === undefined) {
    return NextResponse.redirect(new URL(`${prefix}/comprar/${product}`, request.url), 303)
  }
  // El hueco elegido llega como "persona|inicio" (un solo campo de radio en el formulario).
  const [slotHost, slotStart] = (data.slot ?? '').split('|')
  const host = data.host || slotHost
  const start = data.start || slotStart
  const delivery = getDelivery()
  // Los huecos que ensena /comprar estan guardados 60 s: uno recien apartado, o que ya estaba
  // ocupado, deja de salir en la visita siguiente (sin esperar al minuto).
  const refreshSlots = () => {
    if (isGuided(product)) revalidateTag(SLOTS_CACHE_TAG, { expire: 0 })
  }
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
      currency: data.currency || null,
      country: data.country ?? null,
      territory: data.territory ?? null,
      taxId: data.taxId ?? null,
      vatId: data.vatId ?? null,
      otherTaxId: data.otherTaxId ?? null,
      session: host && start ? { host, start } : null,
      company,
      // El mensual, al mes o por ano adelantado (el boton que se pulsa en la zona).
      period: data.period || null,
      clientIp: clientIp(request),
    })
    refreshSlots()
    return form ? NextResponse.redirect(session.url, 303) : NextResponse.json({ url: session.url, launch: session.launch })
  } catch (error) {
    if (error instanceof CheckoutError) {
      if (error.code === 'slot_taken') refreshSlots()
      if (form) return back(errorPage(product), error.code)
      return NextResponse.json({ error: error.message, code: error.code }, { status: statusOf(error.code) })
    }
    if (form) return back(errorPage(product), 'unavailable')
    return errorResponse(error, 'checkout')
  }
}
