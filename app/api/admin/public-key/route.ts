import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'

// La publica de la clave de licencias de la web, leida de KMS (getPublicKey), en el formato de
// esqueleto/firmas/licencias.pub (base64 de los 32 bytes): la que Eric anade al esqueleto.
// Authorization: Bearer <ADMIN_SECRET>.

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const { signer, config } = getDelivery()
  const publicKey = await signer.publicKey()
  return NextResponse.json({
    keyId: signer.keyId,
    publicKey,
    matchesConfig: config.licensePublicKey ? config.licensePublicKey === publicKey : null,
  })
}
