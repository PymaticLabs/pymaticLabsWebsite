import { NextRequest, NextResponse } from 'next/server'
import { cookieJar, errorResponse, withZoneUser } from '@/lib/api-route'
import { zoneAvailable } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { zoneOverview, zoneProfile } from '@/lib/delivery/zone'
import type { ZoneProfileResponse } from '@/lib/zone-profile'

// Todo lo de la zona de una vez: empresa, licencias, facturas, compras, equipo, sesiones y la
// ultima version con sus descargas. ?company=<id> si la persona esta en mas de una empresa.
//
// ?perfil=1, para la barra de arriba de cada pagina (que es estatica): solo quien es y sus empresas,
// y siempre 200 (sin sesion, user null; sin la zona montada, available false), sin errores en la
// consola de quien no ha entrado.

export const runtime = 'nodejs'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.has('perfil')) return profile(request)
  return withZoneUser(request, 'zona/me', async (user, delivery) =>
    NextResponse.json(await zoneOverview(delivery, user, request.nextUrl.searchParams.get('company')), {
      headers: NO_STORE,
    })
  )
}

async function profile(request: NextRequest): Promise<NextResponse> {
  if (!zoneAvailable()) return NextResponse.json({ available: false } satisfies ZoneProfileResponse, { headers: NO_STORE })
  const jar = cookieJar(request)
  try {
    const delivery = getDelivery()
    const user = await delivery.auth.currentUser(jar)
    const body: ZoneProfileResponse = { available: true, user: user ? await zoneProfile(delivery, user) : null }
    // Las cookies que renueve la sesion, a la respuesta (como en el resto de /api/zone/*).
    return jar.apply(NextResponse.json(body, { headers: NO_STORE }))
  } catch (error) {
    return jar.apply(errorResponse(error, 'zona/me?perfil'))
  }
}
