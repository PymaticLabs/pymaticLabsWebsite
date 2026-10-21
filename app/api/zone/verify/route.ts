import { NextRequest, NextResponse } from 'next/server'
import { clientIp, cookieJar, errorResponse, readBody, sameOrigin } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { normalizeEmail } from '@/lib/delivery/util'
import { verifyCode } from '@/lib/delivery/zone'

// Zona de clientes, paso 2: el codigo. Si vale, deja la sesion en cookies (httpOnly). Con limites
// por IP y por correo (lib/delivery/zone.ts): de mas, 429.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: 'origen no permitido' }, { status: 403 })
  const { data } = await readBody(request)
  const email = normalizeEmail(data.email)
  const code = (data.code ?? '').replace(/\s+/g, '')
  if (!email || !/^\d{6,10}$/.test(code)) return NextResponse.json({ error: 'correo o codigo no validos' }, { status: 400 })
  const jar = cookieJar(request)
  try {
    const user = await verifyCode(getDelivery(), email, code, jar, clientIp(request))
    if (!user) return jar.apply(NextResponse.json({ error: 'codigo no valido o caducado' }, { status: 401 }))
    return jar.apply(NextResponse.json({ email: user.email }))
  } catch (error) {
    return jar.apply(errorResponse(error, 'zona/verify'))
  }
}
