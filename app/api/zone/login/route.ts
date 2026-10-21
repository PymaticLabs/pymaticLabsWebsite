import { NextRequest, NextResponse, after } from 'next/server'
import { clientIp, errorResponse, localeOf, readBody, sameOrigin } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { allowCodeRequest, requestCode } from '@/lib/delivery/zone'

// Zona de clientes, paso 1: el correo. Si tiene acceso, le llega un codigo de un solo uso. La
// respuesta es siempre la misma y en el mismo tiempo: se contesta antes de mirar si es cliente y el
// codigo se pide despues (after). Demasiadas peticiones desde una IP: 429, a todos por igual.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'origen no permitido' }, { status: 403 })
  const { data } = await readBody(request)
  const delivery = getDelivery()
  const ip = clientIp(request)
  try {
    if (!(await allowCodeRequest(delivery, ip))) return NextResponse.json({ error: 'demasiados intentos', code: 'rate_limited' }, { status: 429 })
    const email = data.email ?? ''
    const locale = localeOf(data.locale)
    after(() => requestCode(delivery, email, locale, ip).catch((error) => console.error('[zona/login] codigo sin mandar:', error)))
    return NextResponse.json({ sent: true })
  } catch (error) {
    return errorResponse(error, 'zona/login')
  }
}
