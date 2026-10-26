import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDelivery } from './delivery/container.ts'
import { DEMO_PEOPLE, DEMO_VERSION, seedZoneDemo } from './delivery/demo.ts'
import { downloadLink, invoiceLink, licenseFile, termsFile, zoneOverview, zoneProfile } from './delivery/zone.ts'
import { SupabaseAuth, ZONE_SESSION_DAYS, refreshZoneSession } from './delivery/adapters/supabase-auth.ts'
import { RateLimitedError, type CookieToSet, type ZoneUser } from './delivery/types.ts'
import { verifyLicense } from './license.ts'
import { currentLicense, downloadGroups, formatBytes, monthlyState, otherLicenses, safeZoneReturn, sectionPath, upcomingSessions, zoneSections, type ZoneOverview } from './zone-view.ts'
import { profileInitials, profileShortcuts } from './zone-profile.ts'

// La zona de socio: lo que ve cada persona (con la zona de muestra, montada por el camino de
// verdad con las piezas falsas), la seguridad por filas como segunda comprobacion, los codigos que
// frenan y la sesion de Supabase (cookies solo del servidor, renovacion) contra un fetch de mentira.

const NOW = new Date('2026-11-02T10:00:00Z')

async function demo() {
  const d = createFakeDelivery({ clock: () => NOW })
  await seedZoneDemo(d)
  const as = async (email: string): Promise<ZoneUser> => {
    const member = (await d.repo.listMembershipsByEmail(email))[0]
    assert.ok(member?.userId, `${email} tiene cuenta`)
    return { id: member.userId, email }
  }
  return { d, as }
}

test('zona de muestra: la titular ve todo lo de su compra, con datos de la entrega de verdad', async () => {
  const { d, as } = await demo()
  await seedZoneDemo(d) // la segunda vez no duplica nada
  const owner = await as(DEMO_PEOPLE.titular)
  const o = await zoneOverview(d, owner)

  assert.equal(o.role, 'owner')
  assert.equal(o.company.name, 'Carpintería Muñoz, S.L.')
  assert.equal(o.company.seats, 10)
  assert.deepEqual(zoneSections(o), ['inicio', 'licencia', 'descargas', 'sesiones', 'equipo', 'mensual', 'facturas'])

  // Licencia del Acompanado con equipo, con los 3 meses de Pro, que verifica con la clave de la web.
  const license = currentLicense(o.licenses)!
  assert.equal(license.modalidad, 'acompanado')
  assert.equal(license.equipo, true)
  assert.equal(license.soporteHasta, '2027-01-27')
  const file = await licenseFile(d, owner, license.id)
  assert.equal(verifyLicense(file.content, await d.signer.publicKey()).id, license.id)

  // Factura emitida (a mano, como en el modo borrador) con su PDF; las condiciones aceptadas.
  assert.equal(o.invoices.length, 1)
  assert.equal(o.invoices[0].downloadable, true)
  assert.equal(o.pendingInvoices, 0)
  assert.match(await invoiceLink(d, owner, o.invoices[0].id), /\/api\/dev\/storage\?/)
  assert.match((await termsFile(d, owner, o.purchases[0].id)).content.toString('utf-8'), /Aceptadas por Carpintería Muñoz/)

  // La version, con el instalador del registro (con equipo) y el SBOM.
  assert.equal(o.version?.id, DEMO_VERSION)
  const groups = downloadGroups(o.version!.files, 'es')
  assert.deepEqual(groups.map((g) => [g.kind, g.files.length]), [['mac', 2], ['windows', 2], ['registry', 1], ['extra', 1]])
  assert.equal(groups[0].files[0].lang, 'es') // primero el idioma de la pagina
  assert.equal(downloadGroups(o.version!.files, 'en')[0].files[0].lang, 'en')

  // Primera sesion reservada con Eric y la segunda por reservar; equipo de 3; mensual Pro en prueba.
  assert.deepEqual(o.sessions.bookings.map((b) => [b.number, b.host, b.status]), [[1, 'eric', 'booked']])
  assert.equal(o.sessions.canBook, true)
  assert.match(upcomingSessions(o, NOW)[0].meetingUrl ?? '', /^https:\/\//)
  assert.equal(o.team.length, 3)
  assert.deepEqual(monthlyState(o, NOW), { kind: 'subscribed', product: 'plan-pro', status: 'trialing', supportUntil: '2027-01-27' })
})

test('zona de muestra: la persona del equipo y el Hazlo tu ven solo lo suyo', async () => {
  const { d, as } = await demo()
  const member = await as(DEMO_PEOPLE.miembro)
  const m = await zoneOverview(d, member)
  assert.equal(m.role, 'member')
  assert.deepEqual(zoneSections(m), ['inicio', 'licencia', 'descargas', 'sesiones'])
  assert.deepEqual([m.invoices, m.purchases, m.team], [[], [], []])
  assert.equal(m.version?.files.length, 6)
  // Baja la extension con un enlace firmado, pero no la factura ni las condiciones (solo quien compro).
  assert.match(await downloadLink(d, member, m.version!.files[0].id), /\/api\/dev\/storage\?/)
  const owner = await zoneOverview(d, await as(DEMO_PEOPLE.titular))
  await assert.rejects(invoiceLink(d, member, owner.invoices[0].id), /solo quien compro/)

  const solo = await as(DEMO_PEOPLE.solo)
  const s = await zoneOverview(d, solo)
  assert.deepEqual(zoneSections(s), ['inicio', 'licencia', 'descargas', 'mensual', 'facturas'])
  assert.equal(currentLicense(s.licenses)?.equipo, false)
  // Hazlo tu sin equipo: sin meses del mensual; sin el instalador del registro.
  assert.equal(monthlyState(s, NOW).kind, 'none')
  assert.deepEqual(downloadGroups(s.version!.files, 'es').map((g) => g.kind), ['mac', 'windows', 'extra'])
  // Ni la licencia ni las descargas de otra empresa.
  await assert.rejects(licenseFile(d, solo, currentLicense(owner.licenses)!.id), /sin acceso|empresa no encontrada/)
})

test('perfil de la barra de arriba: el correo, las empresas y los atajos de quien entro', async () => {
  const { d, as } = await demo()
  const owner = await zoneProfile(d, await as(DEMO_PEOPLE.titular))
  assert.deepEqual(owner, { email: DEMO_PEOPLE.titular, companies: [{ name: 'Carpintería Muñoz, S.L.', role: 'owner' }] })
  assert.equal(profileInitials(owner.companies[0].name, owner.email), 'CM')
  assert.deepEqual(profileShortcuts(owner), ['licencia', 'descargas', 'facturas'])

  // La persona del equipo: sin facturas (la zona solo se las ensena a quien compro).
  const member = await zoneProfile(d, await as(DEMO_PEOPLE.miembro))
  assert.deepEqual(member.companies, [{ name: 'Carpintería Muñoz, S.L.', role: 'member' }])
  assert.deepEqual(profileShortcuts(member), ['licencia', 'descargas'])

  // Con la zona cerrada (devolucion, contracargo o baja): su correo, sin empresas ni atajos.
  const solo = await as(DEMO_PEOPLE.solo)
  const [membership] = await d.repo.listMembershipsByEmail(DEMO_PEOPLE.solo)
  await d.repo.updateCompany(membership.companyId, { accessRevokedAt: NOW.toISOString() })
  const closed = await zoneProfile(d, solo)
  assert.deepEqual(closed, { email: DEMO_PEOPLE.solo, companies: [] })
  assert.deepEqual(profileShortcuts(closed), [])
  assert.equal(profileInitials(null, closed.email), 'P')
})

test('perfil: las iniciales son las de la empresa sin su forma juridica o, si no, las del correo', () => {
  const cases: [string | null, string, string][] = [
    ['Carpintería Muñoz, S.L.', 'x@y.test', 'CM'],
    ['Estudio Ruiz Arquitectura, S.L.P.', 'x@y.test', 'ER'],
    ['Gestoría de la Plana SLU', 'x@y.test', 'GP'],
    ['Talleres Ferrer S.A.', 'x@y.test', 'TF'],
    ['Ñandú Software GmbH', 'x@y.test', 'ÑS'],
    ['ACME', 'x@y.test', 'A'],
    ['S.L.', 'ana.lopez@y.test', 'AL'],
    [null, 'ana.lopez@y.test', 'AL'],
    ['  ', 'info@y.test', 'I'],
  ]
  for (const [company, email, expected] of cases) assert.equal(profileInitials(company, email), expected, `${company} / ${email}`)
})

test('zona: la seguridad por filas manda tambien (si la base de datos no deja ver la empresa, no se abre)', async () => {
  const { d, as } = await demo()
  const owner = await as(DEMO_PEOPLE.titular)
  const o = await zoneOverview(d, owner)
  const withRls = (ids: string[]): ZoneUser => ({ ...owner, visibleCompanyIds: async () => ids })

  assert.equal((await zoneOverview(d, withRls([o.company.id]))).company.id, o.company.id)
  await assert.rejects(zoneOverview(d, withRls([])), /sin acceso/)
  const license = currentLicense(o.licenses)!
  await assert.rejects(licenseFile(d, withRls(['otra-empresa']), license.id), /sin acceso|empresa no encontrada/)
})

test('zona: el codigo frena tras varios intentos fallidos', async () => {
  const { d } = await demo()
  await d.auth.sendCode(DEMO_PEOPLE.titular, 'es')
  const jar = { getAll: () => [], setAll: () => {} }
  for (let i = 0; i < 5; i++) assert.equal(await d.auth.verifyCode(DEMO_PEOPLE.titular, '000000', jar), null)
  await assert.rejects(d.auth.verifyCode(DEMO_PEOPLE.titular, '000000', jar), RateLimitedError)
})

test('vista de la zona: licencia vigente, mensual, tamanos y a donde se vuelve tras entrar', () => {
  const license = (id: string, emitida: string, soporteHasta: string, revoked = false) => ({ id, modalidad: 'hazlo-tu' as const, equipo: true, emitida, soporteHasta, fileName: `${id}.cerebro-licencia`, revoked })
  const licenses = [license('L1', '2026-11-02', '2027-02-02'), license('L2', '2027-02-02', '2027-03-02'), license('L3', '2027-03-02', '2027-04-02', true)]
  assert.equal(currentLicense(licenses)?.id, 'L2') // la anulada no cuenta
  assert.deepEqual(otherLicenses(licenses, currentLicense(licenses)).map((l) => l.id), ['L3', 'L1'])

  const overview = (status: string | null, soporte: string) =>
    ({ licenses: [license('L', '2026-10-01', soporte)], company: { subscription: { status, plan: 'plan-esencial' } } }) as unknown as ZoneOverview
  assert.equal(monthlyState(overview('active', '2026-12-01'), NOW).kind, 'subscribed')
  assert.equal(monthlyState(overview('canceled', '2026-12-01'), NOW).kind, 'included')
  assert.equal(monthlyState(overview(null, '2026-11-02'), NOW).kind, 'included') // el mismo dia aun cubre
  assert.equal(monthlyState(overview(null, '2026-11-01'), NOW).kind, 'none')

  assert.equal(formatBytes(18_420_000, 'es'), '18,4 MB')
  assert.equal(formatBytes(86_000, 'en'), '86 KB')
  assert.equal(formatBytes(null, 'es'), null)

  assert.equal(sectionPath('inicio'), '/zona')
  assert.equal(sectionPath('equipo', 'c-1'), '/zona/equipo?empresa=c-1')
  assert.equal(safeZoneReturn('/zona/descargas', 'es'), '/zona/descargas')
  assert.equal(safeZoneReturn('/en/zona/equipo?empresa=0b1e-22', 'en'), '/en/zona/equipo?empresa=0b1e-22')
  for (const bad of ['//otra.web/zona', 'https://otra.web/zona', '/zona/entrar', '/zona/../api/admin', '/zona/inventada', '/precios', undefined, 42]) {
    assert.equal(safeZoneReturn(bad, 'es'), '/zona', String(bad))
  }
  assert.equal(safeZoneReturn('/zona/entrar', 'en'), '/en/zona')
})

// --- Supabase Auth contra un fetch de mentira ---------------------------------------------------

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface Call {
  url: string
  method: string
  authorization: string | null
  apikey: string | null
  forwardedFor: string | null
  body: string | null
}

function mockFetch(handler: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined))
    const call: Call = {
      url: String(input instanceof Request ? input.url : input),
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      apikey: headers.get('apikey'),
      forwardedFor: headers.get('sb-forwarded-for'),
      body: typeof init.body === 'string' ? init.body : null,
    }
    calls.push(call)
    const res = handler(call)
    return new Response(res.json === undefined ? null : JSON.stringify(res.json), { status: res.status ?? 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
  return calls
}

const ENV = { SUPABASE_URL: 'https://proyecto.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' }
const USER = { id: '6f1b0a52-0000-4000-8000-000000000001', email: 'Marta@Munoz.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-01T00:00:00Z' }

function sessionCookie(expiresAt: number) {
  const session = { access_token: 'acceso-viejo', token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: 'renovar-1', user: USER }
  return { name: 'sb-proyecto-auth-token', value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}` }
}

test('Supabase Auth: demasiados intentos con el codigo es un 429 que se dice; un codigo malo, no entra', async () => {
  let status = 429
  mockFetch((call) => {
    assert.match(call.url, /\/auth\/v1\/verify/)
    return { status, json: { code: status === 429 ? 'over_request_rate_limit' : 'otp_expired', msg: 'no' } }
  })
  const auth = new SupabaseAuth(ENV, async () => null)
  const jar = { getAll: () => [], setAll: () => {} }
  await assert.rejects(auth.verifyCode('marta@munoz.test', '123456', jar), RateLimitedError)
  status = 403
  assert.equal(await auth.verifyCode('marta@munoz.test', '123456', jar), null)
})

test('Supabase Auth: la sesion se renueva en cookies solo del servidor, y RLS dice que empresas ve', async () => {
  const calls = mockFetch((call) => {
    if (call.url.includes('/auth/v1/token?grant_type=refresh_token')) {
      return { json: { access_token: 'acceso-nuevo', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'renovar-2', user: USER } }
    }
    if (call.url.endsWith('/auth/v1/user')) return { json: USER }
    if (call.url.includes('/rest/v1/companies')) return { json: [{ id: 'empresa-1' }] }
    return { status: 404, json: {} }
  })

  // Token caducado: proxy.ts lo renueva antes de pintar la pagina.
  const cookies = [sessionCookie(Math.floor(Date.now() / 1000) - 60)]
  const set: CookieToSet[] = []
  await refreshZoneSession(ENV, { getAll: () => cookies, setAll: (c) => void set.push(...c) })
  assert.ok(calls.some((c) => c.url.includes('grant_type=refresh_token')))
  const fresh = set.find((c) => c.name === 'sb-proyecto-auth-token' && c.value)
  assert.ok(fresh, 'deja la sesion nueva en la cookie')
  assert.equal(fresh.options.httpOnly, true)
  assert.equal(fresh.options.sameSite, 'lax')
  assert.equal(fresh.options.maxAge, ZONE_SESSION_DAYS * 86400)

  // Con la sesion nueva, quien es y que empresas deja ver RLS (con su token, no con la service_role).
  const auth = new SupabaseAuth(ENV, async () => null)
  const user = await auth.currentUser({ getAll: () => [{ name: fresh.name, value: fresh.value }], setAll: () => {} })
  assert.equal(user?.email, 'marta@munoz.test')
  assert.deepEqual(await user!.visibleCompanyIds!(), ['empresa-1'])
  const rls = calls.find((c) => c.url.includes('/rest/v1/companies'))!
  assert.equal(rls.authorization, 'Bearer acceso-nuevo')

  // Sin cookies de Supabase, ni se pregunta.
  const before = calls.length
  await refreshZoneSession(ENV, { getAll: () => [{ name: 'pymatic_theme', value: 'dark' }], setAll: () => assert.fail('no hay sesion') })
  assert.equal(calls.length, before)
})

test('Supabase Auth: con la clave secreta nueva, los codigos cuentan por la IP de cada persona, no por la del servidor', async () => {
  const calls = mockFetch((call) => (call.url.includes('/auth/v1/otp') ? { json: {} } : { status: 403, json: { code: 'otp_expired', msg: 'no' } }))
  const jar = { getAll: () => [], setAll: () => {} }

  const nueva = new SupabaseAuth({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_prueba' }, async () => null)
  await nueva.sendCode('marta@munoz.test', 'es', '203.0.113.7')
  await nueva.verifyCode('marta@munoz.test', '123456', jar, '203.0.113.7')
  assert.deepEqual(calls.map((c) => [c.url.includes('/otp') ? 'otp' : 'verify', c.forwardedFor, c.apikey]), [
    ['otp', '203.0.113.7', 'sb_secret_prueba'],
    ['verify', '203.0.113.7', 'sb_secret_prueba'],
  ])
  // shouldCreateUser: false (una cuenta solo la crea una compra).
  assert.match(calls[0].body ?? '', /"create_user":false/)

  // Con la clave antigua (JWT) Supabase no admite reenviar la IP: va con la publica y sin cabecera.
  calls.length = 0
  const antigua = new SupabaseAuth(ENV, async () => null)
  await antigua.sendCode('marta@munoz.test', 'es', '203.0.113.7')
  assert.deepEqual([calls[0].forwardedFor, calls[0].apikey], [null, 'anon'])
})

test('Supabase Auth: el alta de quien ya tenia cuenta busca su id en auth.users, sin generar un enlace de acceso', async () => {
  const id = '6f1b0a52-0000-4000-8000-000000000009'
  const calls = mockFetch((call) => {
    if (call.url.endsWith('/auth/v1/admin/users') && call.method === 'POST') return { status: 422, json: { code: 422, error_code: 'email_exists', msg: 'A user with this email address has already been registered' } }
    if (call.url.endsWith('/rest/v1/rpc/user_id_by_email')) return { json: id }
    return { status: 404, json: {} }
  })
  const auth = new SupabaseAuth(ENV, async () => null)
  assert.equal(await auth.ensureUser('ya@tenia.test'), id)
  assert.ok(!calls.some((c) => c.url.includes('generate_link')))
  assert.deepEqual(JSON.parse(calls.find((c) => c.url.includes('/rpc/'))!.body!), { p_email: 'ya@tenia.test' })
})
