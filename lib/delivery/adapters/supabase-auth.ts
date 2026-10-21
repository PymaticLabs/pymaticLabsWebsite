// Acceso a la zona con Supabase Auth: correo y codigo de un solo uso, sin contrasenas. Las cuentas
// solo las crean las compras (y el titular al dar de alta a su equipo): al pedir codigo,
// shouldCreateUser es false, asi que un correo sin cuenta no recibe nada.
//
// SUPABASE_URL, SUPABASE_ANON_KEY (la publica, para la sesion) y SUPABASE_SERVICE_ROLE_KEY (para
// crear cuentas). En Supabase: Auth > Email con SMTP propio (Brevo, en la UE; el de Supabase es
// solo para pruebas) y la plantilla "Magic Link" con {{ .Token }} para que llegue el codigo.
//
// La sesion va en las cookies sb-<proyecto>-auth-token (a veces partidas en .0, .1...): solo las
// lee el servidor (httpOnly) y caducan a los ZONE_SESSION_DAYS dias sin usar la zona. Las paginas
// de la zona no pueden poner cookies: la renueva proxy.ts (refreshZoneSession) antes de pintarlas.
//
// Limites de Supabase Auth: pedir y comprobar codigos cuentan por IP, y todas las peticiones salen
// del servidor de la web. Con una clave secreta nueva (sb_secret_...) en SUPABASE_SERVICE_ROLE_KEY
// y "IP address forwarding" encendido en Auth > Rate Limits, se manda la IP de cada persona
// (Sb-Forwarded-For) y el limite es suyo; con la clave antigua, hay que subir esos limites a mano.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { requireEnv } from './http.ts'
import { PermanentError, RateLimitedError, RetryableError, type CookieJar, type CookieToSet, type Locale, type ZoneAuth, type ZoneUser } from '../types.ts'

/** Dias que dura la sesion de la zona sin usarla (cada renovacion los vuelve a contar). */
export const ZONE_SESSION_DAYS = 7

/** Las opciones de las cookies de la sesion: Supabase las pone legibles desde el navegador y 400 dias. */
function sessionCookieOptions(options: CookieToSet['options']): CookieToSet['options'] {
  const removing = options.maxAge === 0
  return { ...options, httpOnly: true, sameSite: 'lax', path: '/', ...(removing ? {} : { maxAge: ZONE_SESSION_DAYS * 86400 }) }
}

function sessionClient(url: string, key: string, jar: CookieJar, forwardedFor: string | null = null) {
  return createServerClient(url, key, {
    ...(forwardedFor ? { global: { headers: { 'sb-forwarded-for': forwardedFor } } } : {}),
    cookieOptions: { httpOnly: true, sameSite: 'lax', path: '/' },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies) =>
        jar.setAll(cookies.map((c) => ({ name: c.name, value: c.value, options: sessionCookieOptions(c.options as CookieToSet['options']) }))),
    },
  })
}

/**
 * Renueva la sesion si su token ha caducado (proxy.ts, en cada pagina de la zona). Sin cookies de
 * Supabase en la peticion no pregunta a nadie.
 */
export async function refreshZoneSession(env: Record<string, string | undefined>, jar: CookieJar): Promise<void> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return
  if (!jar.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))) return
  await sessionClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, jar).auth.getUser()
}

export class SupabaseAuth implements ZoneAuth {
  readonly name = 'supabase'
  private url: string
  private anonKey: string
  private serviceKey: string
  private admin: SupabaseClient
  private findUserId: (email: string) => Promise<string | null>

  /** findUserId: la cuenta ya apuntada en members (ahorra preguntar a Supabase). */
  constructor(env: Record<string, string | undefined>, findUserId: (email: string) => Promise<string | null>) {
    this.url = requireEnv(env, 'SUPABASE_URL')
    this.anonKey = requireEnv(env, 'SUPABASE_ANON_KEY')
    this.serviceKey = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')
    this.admin = createClient(this.url, this.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    this.findUserId = findUserId
  }

  private session(jar: CookieJar) {
    return sessionClient(this.url, this.anonKey, jar)
  }

  /** Para pedir y comprobar codigos: con la IP de la persona si la clave secreta lo permite. */
  private codeSession(jar: CookieJar, clientIp: string | null | undefined) {
    if (clientIp && this.serviceKey.startsWith('sb_secret_')) return sessionClient(this.url, this.serviceKey, jar, clientIp)
    return this.session(jar)
  }

  async ensureUser(email: string): Promise<string> {
    const known = await this.findUserId(email)
    if (known) return known
    const created = await this.admin.auth.admin.createUser({ email, email_confirm: true })
    if (created.data.user) return created.data.user.id
    if (created.error && created.error.code !== 'email_exists') {
      throw new RetryableError(`Supabase Auth: ${created.error.message}`)
    }
    // Ya tenia cuenta (de otra empresa, o de antes): su id, de auth.users por una funcion solo del
    // servidor (user_id_by_email). Sin generar enlaces de acceso que no hacen falta (y que pisarian
    // el codigo que acabara de pedir esa persona).
    const { data, error } = await this.admin.rpc('user_id_by_email', { p_email: email })
    if (error || !data) throw new RetryableError(`Supabase Auth: no se encuentra la cuenta de ${email}${error ? ` (${error.message})` : ''}`)
    return String(data)
  }

  async sendCode(email: string, _locale: Locale, clientIp?: string | null): Promise<void> {
    const { error } = await this.codeSession({ getAll: () => [], setAll: () => {} }, clientIp).auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    // Un correo sin cuenta da error, y uno con cuenta que pide otro codigo antes de 60 segundos
    // tambien (429): ninguno se cuenta fuera (no se dice que correos son clientes). La zona pide
    // esperar un minuto entre codigos a todos por igual.
    if (error && error.status !== undefined && error.status >= 500) throw new RetryableError(`Supabase Auth: ${error.message}`)
  }

  async verifyCode(email: string, code: string, jar: CookieJar, clientIp?: string | null): Promise<ZoneUser | null> {
    const { data, error } = await this.codeSession(jar, clientIp).auth.verifyOtp({ email, token: code, type: 'email' })
    // Demasiados intentos: se dice, para que la persona espere en vez de seguir probando.
    if (error?.status === 429) throw new RateLimitedError(`Supabase Auth: ${error.message}`)
    if (error && error.status !== undefined && error.status >= 500) throw new RetryableError(`Supabase Auth: ${error.message}`)
    if (error || !data.user?.email) return null
    return { id: data.user.id, email: data.user.email.toLowerCase() }
  }

  async currentUser(jar: CookieJar): Promise<ZoneUser | null> {
    const session = this.session(jar)
    // getUser() pregunta al servidor de Auth: una cookie falsificada no pasa.
    const { data, error } = await session.auth.getUser()
    if (error || !data.user?.email) return null
    return {
      id: data.user.id,
      email: data.user.email.toLowerCase(),
      // Lo que deja ver RLS con su sesion (my_company_ids): la segunda comprobacion de la zona.
      visibleCompanyIds: async () => {
        const { data: rows, error: rlsError } = await session.from('companies').select('id')
        if (rlsError) throw new RetryableError(`Supabase (RLS): ${rlsError.message}`)
        return (rows ?? []).map((row: { id: string }) => String(row.id))
      },
    }
  }

  async signOut(jar: CookieJar): Promise<void> {
    // Solo la de este navegador: las de otros equipos de esa persona siguen abiertas.
    const { error } = await this.session(jar).auth.signOut({ scope: 'local' })
    // Una sesion ya caducada o cerrada en otro sitio (401, 403, 404) se da por cerrada: las cookies
    // se borran igual.
    if (error && (error.status === undefined || error.status >= 500)) throw new PermanentError(`Supabase Auth: ${error.message}`)
  }
}
