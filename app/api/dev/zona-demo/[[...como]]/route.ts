import { NextRequest, NextResponse } from 'next/server'
import { cookieJar } from '@/lib/api-route'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'
import { DEMO_PEOPLE, seedZoneDemo, type DemoPerson } from '@/lib/delivery/demo'

// Solo en modo falso: la zona de socio de muestra, para verla y sacar capturas sin Supabase.
// Monta la muestra (lib/delivery/demo.ts), entra como esa persona por el camino de verdad (codigo
// del buzon falso y sesion en cookie) y lleva a la zona.
//
//   /api/dev/zona-demo            la titular (Acompanado con equipo)
//   /api/dev/zona-demo/miembro    una persona de su equipo
//   /api/dev/zona-demo/solo       Hazlo tu para una persona
//   .../en                        la zona en ingles

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ como?: string[] }> }) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  const delivery = getDelivery()
  if (!devToolsEnabled(delivery.config)) return new NextResponse(null, { status: 404 })
  const segments = (await params).como ?? []
  const person = (segments.find((s) => s in DEMO_PEOPLE) ?? 'titular') as DemoPerson
  const locale = segments.includes('en') ? 'en' : 'es'
  await seedZoneDemo(delivery)

  const email = DEMO_PEOPLE[person]
  await delivery.auth.sendCode(email, locale)
  const code = delivery.fakes.auth?.codes.get(email)?.code
  const jar = cookieJar(request)
  if (!code || !(await delivery.auth.verifyCode(email, code, jar))) {
    return NextResponse.json({ error: `no se pudo entrar como ${email}` }, { status: 500 })
  }
  // Al mismo host que pidio (request.url dice localhost aunque se entre por 127.0.0.1, y la cookie
  // es de ese host).
  const origin = `${request.nextUrl.protocol}//${request.headers.get('host') ?? request.nextUrl.host}`
  return jar.apply(NextResponse.redirect(new URL(locale === 'en' ? '/en/zona' : '/zona', origin), 303))
}
