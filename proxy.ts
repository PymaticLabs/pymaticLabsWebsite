import createMiddleware from 'next-intl/middleware'
import type { NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { readConfig, zoneAvailable } from './lib/delivery/config'
import { refreshZoneSession } from './lib/delivery/adapters/supabase-auth'
import type { CookieToSet } from './lib/delivery/types'

const intl = createMiddleware(routing)

/** Las paginas de la zona de clientes (/zona y /en/zona). */
const ZONE_PAGE = /^\/(en\/)?zona(\/|$)/

// En las paginas de la zona, antes de pintarlas, se renueva la sesion de Supabase si su token ha
// caducado: una pagina no puede poner cookies. Las cookies nuevas van a la peticion (para que la
// pagina ya las lea) y a la respuesta. Las rutas /api/zone/* lo hacen solas.
export default async function proxy(request: NextRequest) {
  const refreshed: CookieToSet[] = []
  if (ZONE_PAGE.test(request.nextUrl.pathname) && zoneAvailable()) {
    try {
      if (readConfig().adapters.auth === 'supabase') {
        await refreshZoneSession(process.env, {
          getAll: () => request.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
          setAll: (cookies) => {
            for (const cookie of cookies) {
              if (cookie.options.maxAge === 0) request.cookies.delete(cookie.name)
              else request.cookies.set(cookie.name, cookie.value)
              refreshed.push(cookie)
            }
          },
        })
      }
    } catch (error) {
      // Sin renovar, la pagina pide entrar otra vez: nunca se cae la web por esto.
      console.error('[proxy] sesion de la zona:', error)
    }
  }
  const response = intl(request)
  for (const cookie of refreshed) {
    response.cookies.set(cookie.name, cookie.value, { ...cookie.options, secure: cookie.options.secure ?? request.nextUrl.protocol === 'https:' })
  }
  if (refreshed.length) response.headers.set('Cache-Control', 'private, no-store')
  return response
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
