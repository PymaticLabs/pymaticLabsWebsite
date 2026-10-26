import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { revocationList } from '@/lib/delivery/versions'

// La lista de licencias y claves anuladas, para meterla en la version siguiente del esqueleto
// (cambio de Eric: el cerebro rechaza lo que este en ella). Authorization: Bearer <ADMIN_SECRET>.

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  return NextResponse.json(await revocationList(getDelivery()))
}
