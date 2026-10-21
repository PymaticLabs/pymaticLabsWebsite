import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'
import { invoiceLink } from '@/lib/delivery/zone'

// El PDF de una factura (solo quien compro), por un enlace firmado que caduca en minutos.

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withZoneUser(request, 'zona/factura', async (user, delivery) => {
    const url = await invoiceLink(delivery, user, id)
    if (request.nextUrl.searchParams.get('json')) return NextResponse.json({ url })
    return NextResponse.redirect(url, 303)
  })
}
