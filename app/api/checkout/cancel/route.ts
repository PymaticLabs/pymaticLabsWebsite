import { revalidateTag } from 'next/cache'
import { NextRequest, NextResponse } from 'next/server'
import { clientIp } from '@/lib/api-route'
import { SLOTS_CACHE_TAG, cancelCheckout, cancelReturnPath } from '@/lib/checkout'
import { getDelivery } from '@/lib/delivery/container'
import { isGuided } from '@/lib/delivery/products'

// La vuelta desde Stripe sin pagar (cancel_url del pago unico, con ?pago={CHECKOUT_SESSION_ID}): se
// cierra ese pago y se sueltan al momento su plaza de lanzamiento y su hueco (lib/delivery/launch.ts),
// sin esperar a que caduque, y se vuelve a la pagina de compra (con el hueco suelto otra vez en la
// lista, sin esperar a la cache de 60 s) con el pais y, en Espana, el territorio que se eligieron,
// como tras un error de /api/checkout (cancelReturnPath: los que no son de la lista, fuera). Es
// publica: solo con la venta abierta y unas pocas por IP (cancelCheckout en lib/checkout.ts). Pase
// lo que pase (un id que no es de un pago, uno ya pagado o cerrado, el limite pasado, Stripe o la
// base sin responder), se vuelve igual: cerrar el pago es solo para que la plaza no quede apartada.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  try {
    const closed = await cancelCheckout(getDelivery(), params.get('pago') ?? '', clientIp(request))
    if (closed && isGuided(params.get('producto') ?? '')) revalidateTag(SLOTS_CACHE_TAG, { expire: 0 })
  } catch (error) {
    console.warn('[checkout/cancel] no se pudo cerrar el pago:', error instanceof Error ? error.message : error)
  }
  return NextResponse.redirect(new URL(cancelReturnPath(params), request.url), 303)
}
