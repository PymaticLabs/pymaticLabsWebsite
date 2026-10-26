import { NextRequest, NextResponse } from 'next/server'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'

// Solo en modo falso: el portal de cliente de Stripe de mentira (en la web de verdad, el de Stripe).

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  if (!devToolsEnabled(getDelivery().config)) return new NextResponse(null, { status: 404 })
  // Solo de vuelta a la propia web: el mismo origen, no algo que empiece igual (web.com.otra.example).
  const back = request.nextUrl.searchParams.get('return') ?? '/'
  let safeBack = '/'
  try {
    const url = new URL(back)
    if (url.origin === new URL(getDelivery().config.siteUrl).origin) safeBack = url.toString()
  } catch {
    // no era una URL
  }
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Portal de prueba</title><body style="font-family:system-ui;max-width:40rem;margin:3rem auto"><h1>Portal de cliente de Stripe (prueba)</h1><p>Aqui el cliente cambiaria su tarjeta o su plan, o cancelaria el mensual.</p><p><a href="${safeBack.replace(/"/g, '')}">Volver</a></p></body>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}
