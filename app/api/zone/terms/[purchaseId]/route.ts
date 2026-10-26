import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'
import { termsFile } from '@/lib/delivery/zone'

// La copia de las condiciones que acepto una compra, con quien y cuando las acepto.

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ purchaseId: string }> }) {
  const { purchaseId } = await params
  return withZoneUser(request, 'zona/condiciones', async (user, delivery) => {
    const file = await termsFile(delivery, user, purchaseId)
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  })
}
