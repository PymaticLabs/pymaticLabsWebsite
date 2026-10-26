import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { formatReport, productionCheck, redact, type HealthReport } from './delivery/health.ts'
import { WEBHOOK_EVENTS, launchCouponId, lookupKey, priceCents, type ProductId } from './delivery/products.ts'
import { modalities, plans } from './offer.ts'

// La comprobacion de produccion contra un fetch de mentira: Supabase, Stripe, Brevo, Holded,
// Cal.com y la web publicada contestan como lo harian, y el informe dice lo que falta sin ensenar
// nunca el valor de un secreto.

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const ENV: Record<string, string> = {
  NEXT_PUBLIC_SITE_URL: 'https://pymaticlabs.com',
  DELIVERY_IP_SALT: 'sal-de-prueba-0123456789abcdef',
  JOBS_SECRET: 'jobs-0123456789abcdef0123456789abcdef',
  ADMIN_SECRET: 'admin-0123456789abcdef0123456789abcdef',
  STRIPE_SECRET_KEY: 'sk_live_51PruebaDeClaveSecreta',
  STRIPE_WEBHOOK_SECRET: 'whsec_PruebaDeSecretoDelWebhook',
  SUPABASE_URL: 'https://proyecto.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_PruebaPublica',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_PruebaSecretaDeSupabase',
  BREVO_API_KEY: 'xkeysib-PruebaDeBrevo',
  HOLDED_API_KEY: 'holded-PruebaDeClaveDeHolded',
  HOLDED_TAX_REVERSE_CHARGE: 's_iva_rc',
  HOLDED_TAX_EXPORT: 's_iva_ex',
  CALCOM_API_KEY: 'cal_live_PruebaDeCalcom',
  CALCOM_EVENT_TYPES: '{"eric": 11, "sergio": 22}',
  RESEND_API_KEY: 're_PruebaDeResend',
  LICENSE_MODE: 'manual',
  LICENSE_REQUEST_EMAIL: 'eric@pymaticlabs.com',
  CHECKOUT_OPEN: 'false',
}

const SECRETS = Object.entries(ENV).filter(([k]) => /KEY|SECRET|SALT/.test(k)).map(([, v]) => v)

const PRODUCTS: ProductId[] = [...modalities.map((m) => m.id), ...plans.map((p) => `plan-${p.id}` as const)]

interface World {
  live: boolean
  bucketPublic: boolean
  vault: string[]
  webhookEvents: string[]
  senderActive: boolean
  pricingButtons: boolean
  missingTables: string[]
  holdedStatus: number
  versions: boolean
}

function services(overrides: Partial<World> = {}) {
  const w: World = { live: true, bucketPublic: false, vault: ['entrega_jobs_secret', 'entrega_site_url'], webhookEvents: [...WEBHOOK_EVENTS], senderActive: true, pricingButtons: false, missingTables: [], holdedStatus: 200, versions: true, ...overrides }
  const list = (data: unknown[]) => ({ object: 'list', data, has_more: false, url: '/v1/x' })
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
    const method = (init.method ?? 'GET').toUpperCase()
    const path = url.pathname
    if (url.host === 'proyecto.supabase.co') {
      if (path === '/rest/v1/rpc/entrega_estado') {
        return json({ cron: ['entrega-cola', 'entrega-conciliacion', 'entrega-huellas-ip', 'entrega-limites', 'entrega-historial-cron'].map((nombre) => ({ nombre, activa: true })), vault: w.vault, extensiones: ['pg_cron', 'pg_net'] })
      }
      if (path.startsWith('/rest/v1/')) {
        const table = path.slice('/rest/v1/'.length)
        if (w.missingTables.includes(table)) return json({ code: 'PGRST205', message: `Could not find the table 'public.${table}'` }, 404)
        if (method === 'HEAD') return new Response(null, { status: 200, headers: { 'content-range': '*/0' } })
        // Dos versiones: la ultima es la 1.10.0 (no la 1.9.0 por orden de texto), con Mac y Windows.
        if (w.versions && table === 'versions' && url.searchParams.get('select') === 'id') return json([{ id: '1.9.0' }, { id: '1.10.0' }])
        if (w.versions && table === 'version_files' && url.searchParams.get('version_id') === 'eq.1.10.0') return json([{ kind: 'mac' }, { kind: 'windows' }])
        return json([])
      }
      if (path.startsWith('/storage/v1/bucket/')) return json({ id: path.split('/').pop(), name: path.split('/').pop(), public: w.bucketPublic })
      if (path === '/auth/v1/settings') return json({ external: { email: true }, disable_signup: true, mailer_autoconfirm: false })
    }
    if (url.host === 'api.stripe.com') {
      if (path === '/v1/balance') return json({ object: 'balance', livemode: w.live, available: [], pending: [] })
      if (path === '/v1/webhook_endpoints') return json(list([{ id: 'we_1', object: 'webhook_endpoint', url: 'https://pymaticlabs.com/api/stripe/webhook', status: 'enabled', enabled_events: w.webhookEvents }]))
      if (path === '/v1/tax/settings') return json({ object: 'tax.settings', status: 'active' })
      if (path === '/v1/tax/registrations') return json(list([{ id: 'taxreg_1', country: 'ES', status: 'active' }]))
      if (path === '/v1/prices') {
        return json(
          list(
            PRODUCTS.map((p) => ({
              id: `price_${p}`,
              object: 'price',
              lookup_key: lookupKey(p),
              unit_amount: priceCents(p).list,
              currency: 'eur',
              recurring: p.startsWith('plan-') ? { interval: 'month' } : null,
              tax_behavior: 'exclusive',
              currency_options: { usd: { unit_amount: priceCents(p).list } },
            }))
          )
        )
      }
      if (path.startsWith('/v1/coupons/')) {
        const id = decodeURIComponent(path.split('/').pop()!)
        const m = modalities.find((x) => launchCouponId(x.id) === id)!
        const cents = priceCents(m.id)
        return json({ id, object: 'coupon', amount_off: cents.list - cents.launch!, valid: true, times_redeemed: 1, max_redemptions: 10 })
      }
      if (path === '/v1/billing_portal/configurations') return json(list([{ id: 'bpc_1', object: 'billing_portal.configuration', active: true, metadata: { cerebro: 'portal' } }]))
    }
    if (url.host === 'api.brevo.com') {
      if (path === '/v3/account') return json({ email: 'info@pymaticlabs.com' })
      if (path === '/v3/senders') return json({ senders: [{ email: 'info@pymaticlabs.com', active: w.senderActive }] })
      if (path === '/v3/senders/domains') return json({ domains: [{ domain_name: 'pymaticlabs.com', authenticated: true }] })
    }
    if (url.host === 'api.holded.com') {
      // Un 401 que repite la clave en el mensaje: el informe no la puede ensenar.
      if (w.holdedStatus !== 200) return json({ message: `invalid key ${ENV.HOLDED_API_KEY}` }, w.holdedStatus)
      if (path.endsWith('/taxes')) return json({ items: [{ id: 's_iva_21' }, { id: 's_iva_rc' }, { id: 's_iva_ex' }] })
      return json({ items: [] })
    }
    if (url.host === 'api.cal.com' && path === '/v2/slots') return json({ data: { '2026-11-03': [{ start: '2026-11-03T17:00:00.000Z' }] } })
    if (url.host === 'pymaticlabs.com') {
      if (path === '/api/zone/me') return json({ available: true, user: null })
      if (path === '/') return new Response('<header><a href="/zona/entrar">Entrar</a></header>', { status: 200 })
      if (path === '/precios') return new Response(w.pricingButtons ? '<form action="/api/checkout" method="post"></form>' : '<button disabled>Próximamente</button>', { status: 200 })
    }
    return json({ error: `sin mock: ${method} ${url}` }, 404)
  }) as typeof fetch
}

function find(report: HealthReport, item: string) {
  const check = report.checks.find((c) => c.item.startsWith(item))
  assert.ok(check, `sale ${item}`)
  return check
}

function noSecrets(report: HealthReport) {
  const text = JSON.stringify(report) + formatReport(report)
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `no ensena ${secret.slice(0, 6)}...`)
}

test('comprobacion de produccion: con todo puesto y cada servicio en orden, lista para vender (licencias a mano)', async () => {
  services()
  const report = await productionCheck(ENV, { checkSite: true, now: new Date('2026-11-02T10:00:00Z') })
  const missing = report.checks.filter((c) => c.status === 'falta')
  assert.deepEqual(missing, [])
  assert.equal(report.ready, true)
  assert.equal(find(report, 'Licencias').status, 'ok')
  assert.match(find(report, 'Licencias').detail!, /a mano/)
  assert.equal(find(report, 'Clave de las licencias a mano').detail, 'la del Mac de Eric (licencias.pub)')
  assert.equal(find(report, 'Migración 20261021130000_licencias_a_mano.sql').status, 'ok')
  assert.equal(find(report, 'Secretos de Vault').status, 'ok')
  assert.equal(find(report, 'Versión publicada').detail, 'la 1.10.0, para Mac y Windows')
  assert.equal(find(report, 'Webhook').status, 'ok')
  assert.equal(find(report, 'Precio cerebro-plan-pro').status, 'ok')
  assert.equal(find(report, 'Cupón cerebro-lanzamiento-hazlo-tu').status, 'ok')
  assert.equal(find(report, 'Remitente info@pymaticlabs.com').status, 'ok')
  assert.equal(find(report, 'Huecos de Eric').status, 'ok')
  assert.equal(find(report, 'Botón Entrar').status, 'ok')
  assert.match(find(report, 'CHECKOUT_OPEN').detail!, /todo listo/)
  assert.match(formatReport(report), /Listo para vender/)
  noSecrets(report)
})

test('comprobacion de produccion: dice lo que falta y como arreglarlo, sin ensenar ningun secreto', async () => {
  services({ live: false, bucketPublic: true, vault: ['entrega_site_url'], webhookEvents: ['checkout.session.completed'], senderActive: false, missingTables: ['license_requests'], holdedStatus: 401, versions: false })
  const env = { ...ENV, STRIPE_SECRET_KEY: 'sk_test_51PruebaDeClaveSecreta', STRIPE_WEBHOOK_SECRET: '', CHECKOUT_OPEN: 'true', LICENSE_MANUAL_PUBLIC_KEY: 'FbnsgdEW0hB49Fh/Mj3c+KLezWlb47hp4N+y7SfP5BQ=' }
  const report = await productionCheck(env, { checkSite: true, now: new Date('2026-11-02T10:00:00Z') })
  assert.equal(report.ready, false)
  const falta = (item: string) => assert.equal(find(report, item).status, 'falta', item)
  falta('STRIPE_SECRET_KEY')
  assert.match(find(report, 'STRIPE_SECRET_KEY').detail!, /es de PRUEBA/)
  falta('STRIPE_WEBHOOK_SECRET')
  falta('Clave de las licencias a mano')
  falta('Migración 20261021130000_licencias_a_mano.sql')
  assert.match(find(report, 'Migración 20261021130000_licencias_a_mano.sql').fix!, /supabase db push/)
  falta('Secretos de Vault')
  assert.match(find(report, 'Secretos de Vault').detail!, /entrega_jobs_secret/)
  falta('Bucket releases')
  // Sin ninguna version publicada, el primer cliente no tendria nada que instalar.
  falta('Versión publicada')
  assert.match(find(report, 'Versión publicada').fix!, /publicar-version\.mts/)
  assert.match(find(report, 'Webhook').detail!, /le faltan avisos: .*invoice\.paid/)
  falta('Remitente info@pymaticlabs.com')
  falta('Botones de compra')
  // La venta abierta con cosas sin arreglar: lo primero, cerrarla.
  assert.match(find(report, 'CHECKOUT_OPEN').fix!, /CHECKOUT_OPEN=false/)
  // Holded contesta 401 repitiendo la clave: el informe no la repite.
  assert.equal(report.checks.find((c) => c.area === 'Holded')!.status, 'falta')
  noSecrets(report)
  assert.match(formatReport(report), /NO está listo para vender/)
})

test('comprobacion de produccion: sin las claves de un servicio no lo llama, y redact quita lo que parece una clave', async () => {
  services()
  const env = { ...ENV, BREVO_API_KEY: '', DELIVERY_IP_SALT: '' }
  const report = await productionCheck(env, { now: new Date('2026-11-02T10:00:00Z') })
  assert.equal(find(report, 'DELIVERY_IP_SALT').status, 'falta')
  assert.equal(report.checks.find((c) => c.area === 'Brevo')!.detail, 'faltan BREVO_API_KEY')
  // Los demas servicios se miran igual, aunque falte la sal.
  assert.equal(report.checks.find((c) => c.area === 'Stripe' && c.item === 'Clave')!.status, 'ok')
  assert.equal(redact('Invalid API Key provided: sk_live_****abcd y whsec_123456 y eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.firma', {}), 'Invalid API Key provided: sk_live_*** y whsec_*** y ***')
})

test('comprobacion de produccion: LICENSE_MODE sin poner con la clave de KMS puesta es FALTA (firmaria la web), y redact quita las semillas', async () => {
  services()
  const env = { ...ENV, LICENSE_MODE: '', GCP_KMS_KEY_VERSION: 'projects/p/locations/europe-west1/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1', GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }
  const report = await productionCheck(env, { now: new Date('2026-11-02T10:00:00Z') })
  const licenses = find(report, 'Licencias')
  assert.equal(licenses.status, 'falta')
  assert.match(licenses.detail!, /LICENSE_MODE sin poner/)
  assert.match(licenses.fix!, /LICENSE_MODE=manual/)
  assert.equal(report.ready, false)
  // Puesto a proposito, solo aviso (vale cuando el producto acepte la clave de la web).
  const chosen = await productionCheck({ ...env, LICENSE_MODE: 'kms' }, { now: new Date('2026-11-02T10:00:00Z') })
  assert.equal(find(chosen, 'Licencias').status, 'aviso')
  // Las semillas de las claves de prueba (LICENSE_TEST_SEED, DELIVERY_FAKE_SIGNING_SEED) tambien se tapan.
  const seed = 'q7ZbV5cJ0bq0n3sRrA1Yy2V0gq4p8Lr9WmXcTzK1sHs='
  assert.equal(redact(`firma con ${seed} y ${seed.slice(0, 20)}`, { LICENSE_TEST_SEED: seed, MY_PRIVATE: 'privada-larga-123' }), `firma con *** y ${seed.slice(0, 20)}`)
  assert.equal(redact('clave privada-larga-123', { MY_PRIVATE: 'privada-larga-123' }), 'clave ***')
})
