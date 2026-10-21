import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { productionCheck } from '@/lib/delivery/health'

// La comprobacion de produccion con el entorno de este despliegue (las variables Sensitive de
// Vercel no se pueden bajar: aqui si estan). Solo lee de cada servicio. Authorization: Bearer
// <ADMIN_SECRET>. ?pruebas=1 para un entorno de pruebas (Stripe de prueba). En texto, con
// scripts/comprobar-produccion.mts --web <url>.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const report = await productionCheck(process.env, { expectLive: request.nextUrl.searchParams.get('pruebas') !== '1', checkSite: true })
  return NextResponse.json(report, { headers: { 'Cache-Control': 'private, no-store' } })
}
