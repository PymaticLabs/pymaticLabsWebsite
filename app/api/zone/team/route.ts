import { NextRequest, NextResponse } from 'next/server'
import { readBody, withZoneUser } from '@/lib/api-route'
import { addTeamMember, removeTeamMember } from '@/lib/delivery/zone'

// El equipo (solo quien compro, con equipo): POST {company, email} da de alta (hasta las plazas
// compradas) y le manda el acceso; DELETE {company, email} da de baja.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  return withZoneUser(request, 'zona/equipo', async (user, delivery) => {
    const { data } = await readBody(request)
    return NextResponse.json(await addTeamMember(delivery, user, data.company ?? '', data.email ?? ''))
  })
}

export async function DELETE(request: NextRequest) {
  return withZoneUser(request, 'zona/equipo', async (user, delivery) => {
    const { data } = await readBody(request)
    return NextResponse.json(await removeTeamMember(delivery, user, data.company ?? '', data.email ?? ''))
  })
}
