import { NextRequest, NextResponse } from 'next/server'
import { localeOf, readBody, withZoneUser } from '@/lib/api-route'
import { zoneUrl } from '@/lib/delivery/emails'
import { portalLink } from '@/lib/delivery/zone'

// El portal de cliente de Stripe (tarjeta, plan del mensual, cancelar), solo para quien compro.
// Formulario: redirige; JSON: devuelve la URL.

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  return withZoneUser(request, 'zona/portal', async (user, delivery) => {
    const { data, form } = await readBody(request)
    const url = await portalLink(delivery, user, data.company || null, zoneUrl(delivery.config.siteUrl, localeOf(data.locale)))
    return form ? NextResponse.redirect(url, 303) : NextResponse.json({ url })
  })
}
