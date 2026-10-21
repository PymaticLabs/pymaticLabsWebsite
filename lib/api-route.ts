import { NextResponse, type NextRequest } from 'next/server'
import { getDelivery } from '@/lib/delivery/container'
import { bearer, safeEqual } from '@/lib/delivery/util'
import { ZoneError } from '@/lib/delivery/zone'
import { RateLimitedError, type CookieJar, type CookieToSet, type Locale, type ZoneUser } from '@/lib/delivery/types'

// Lo comun de las rutas de la entrega y de la zona: secretos de las llamadas internas, cookies de
// la sesion y errores.

/** Authorization: Bearer <secreto de esa variable>. Sin la variable, nadie pasa. */
export function hasSecret(request: NextRequest, envName: 'JOBS_SECRET' | 'ADMIN_SECRET'): boolean {
  return safeEqual(bearer(request.headers.get('authorization')), process.env[envName])
}

/** Una peticion que cambia algo tiene que venir de la propia web (o sin Origin, desde un script). */
export function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === (request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  } catch {
    return false
  }
}

/** Las cookies de la peticion, y las que la sesion quiere poner, para copiarlas en la respuesta. */
export function cookieJar(request: NextRequest): CookieJar & { apply<T extends NextResponse>(response: T): T } {
  const pending: CookieToSet[] = []
  return {
    getAll: () => request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
    setAll: (cookies) => {
      pending.push(...cookies)
    },
    apply(response) {
      for (const cookie of pending) {
        response.cookies.set(cookie.name, cookie.value, { ...cookie.options, secure: cookie.options.secure ?? request.nextUrl.protocol === 'https:' })
      }
      if (pending.length) response.headers.set('Cache-Control', 'private, no-store')
      return response
    },
  }
}

export function localeOf(value: unknown): Locale {
  return value === 'en' ? 'en' : 'es'
}

export function clientIp(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null
}

/** Los ZoneError, con su codigo; demasiados intentos, 429; lo demas, 500 sin detalles hacia fuera. */
export function errorResponse(error: unknown, where: string): NextResponse {
  if (error instanceof ZoneError) return NextResponse.json({ error: error.message }, { status: error.status })
  if (error instanceof RateLimitedError) return NextResponse.json({ error: 'demasiados intentos', code: 'rate_limited' }, { status: 429 })
  console.error(`[${where}]`, error)
  return NextResponse.json({ error: 'error interno' }, { status: 500 })
}

/**
 * Una ruta de la zona con sesion: sin ella, 401. Las cookies que renueve la sesion se copian en la
 * respuesta, sea cual sea.
 */
export async function withZoneUser(
  request: NextRequest,
  where: string,
  handler: (user: ZoneUser, delivery: ReturnType<typeof getDelivery>, jar: CookieJar) => Promise<NextResponse>
): Promise<NextResponse> {
  const jar = cookieJar(request)
  const delivery = getDelivery()
  if (request.method !== 'GET' && !sameOrigin(request)) return NextResponse.json({ error: 'origen no permitido' }, { status: 403 })
  try {
    const user = await delivery.auth.currentUser(jar)
    if (!user) return jar.apply(NextResponse.json({ error: 'sin sesion' }, { status: 401 }))
    return jar.apply(await handler(user, delivery, jar))
  } catch (error) {
    return jar.apply(errorResponse(error, where))
  }
}

/** Lee el cuerpo como JSON o como formulario. */
export async function readBody(request: NextRequest): Promise<{ data: Record<string, string>; form: boolean }> {
  const type = request.headers.get('content-type') ?? ''
  if (type.includes('application/x-www-form-urlencoded') || type.includes('multipart/form-data')) {
    const form = await request.formData()
    return { data: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])), form: true }
  }
  try {
    const json = (await request.json()) as Record<string, unknown>
    return { data: Object.fromEntries(Object.entries(json ?? {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])), form: false }
  } catch {
    return { data: {}, form: false }
  }
}
