import { NextRequest, NextResponse } from 'next/server'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'

// Solo en modo falso: sirve los enlaces firmados del almacen local (los de Supabase en la web de
// verdad), con la misma caducidad.

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  const delivery = getDelivery()
  const storage = delivery.fakes.storage
  if (!devToolsEnabled(delivery.config) || !storage) return new NextResponse(null, { status: 404 })
  const signed = storage.verifySigned(request.nextUrl.searchParams)
  if (!signed) return NextResponse.json({ error: 'enlace caducado o no valido' }, { status: 403 })
  const content = await storage.get(signed.bucket, signed.path)
  if (!content) return new NextResponse(null, { status: 404 })
  return new NextResponse(new Uint8Array(content), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${(signed.name ?? signed.path.split('/').pop() ?? 'fichero').replace(/"/g, '')}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
