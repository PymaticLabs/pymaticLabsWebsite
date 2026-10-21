import { NextRequest, NextResponse } from 'next/server'
import { withZoneUser } from '@/lib/api-route'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  return withZoneUser(request, 'zona/logout', async (_user, delivery, jar) => {
    await delivery.auth.signOut(jar)
    return NextResponse.json({ signedOut: true })
  })
}
