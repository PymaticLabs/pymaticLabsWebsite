import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'
import { downloadLink } from '@/lib/delivery/zone'

// Una descarga de la ultima version: lleva a un enlace firmado del almacen privado que caduca en
// minutos (DOWNLOAD_URL_TTL_SECONDS). ?json=1 devuelve el enlace en vez de redirigir.

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withZoneUser(request, 'zona/descarga', async (user, delivery) => {
    const url = await downloadLink(delivery, user, id, request.nextUrl.searchParams.get('company'))
    if (request.nextUrl.searchParams.get('json')) return NextResponse.json({ url, expiresIn: delivery.config.downloadTtlSeconds })
    return NextResponse.redirect(url, 303)
  })
}
