import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'
import { zoneOverview } from '@/lib/delivery/zone'

// Todo lo de la zona de una vez: empresa, licencias, facturas, compras, equipo, sesiones y la
// ultima version con sus descargas. ?company=<id> si la persona esta en mas de una empresa.

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  return withZoneUser(request, 'zona/me', async (user, delivery) =>
    NextResponse.json(await zoneOverview(delivery, user, request.nextUrl.searchParams.get('company')), {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  )
}
