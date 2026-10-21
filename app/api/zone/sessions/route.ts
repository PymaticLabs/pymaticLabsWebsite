import { NextRequest, NextResponse } from 'next/server'
import { readBody, withZoneUser } from '@/lib/api-route'
import { bookSession, sessionSlots } from '@/lib/delivery/zone'

// Sesiones del Acompanado desde la zona: GET, los huecos libres de Eric y de Sergio; POST
// {company, host, start}, reserva la que falta (la segunda, o la primera si se ocupo al pagar).

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  return withZoneUser(request, 'zona/sesiones', async (user, delivery) =>
    NextResponse.json(await sessionSlots(delivery, user, request.nextUrl.searchParams.get('company')))
  )
}

export async function POST(request: NextRequest) {
  return withZoneUser(request, 'zona/sesiones', async (user, delivery) => {
    const { data } = await readBody(request)
    return NextResponse.json(await bookSession(delivery, user, data.company || null, { host: data.host ?? '', start: data.start ?? '' }))
  })
}
