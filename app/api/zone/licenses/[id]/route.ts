import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'
import { licenseFile } from '@/lib/delivery/zone'

// La licencia, para volver a bajarla: el mismo fichero que se entrego.

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return withZoneUser(request, 'zona/licencia', async (user, delivery) => {
    const file = await licenseFile(delivery, user, id)
    return new NextResponse(file.content, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  })
}
