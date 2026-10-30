import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { formatReport, productionCheck, redact, type HealthReport } from './delivery/health.ts'
import { WEBHOOK_EVENTS, isPlanProduct, launchCouponId, lookupKey, priceCents, productName, type PlanPeriod, type ProductId } from './delivery/products.ts'
import { modalities, plans } from './offer.ts'

// La comprobacion de produccion contra un fetch de mentira: Supabase, Stripe, Brevo, Holded,
// Cal.com, VIES y la web publicada contestan como lo harian, y el informe dice lo que falta sin
// ensenar nunca el valor de un secreto.

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
  HOLDED_TAX_REVERSE_CHARGE: 's_iva_intras',
  HOLDED_TAX_EXPORT: 's_iva_nosujeto',
  CALCOM_API_KEY: 'cal_live_PruebaDeCalcom',
  CALCOM_EVENT_TYPES: '{"eric": 11, "sergio": 22}',
  RESEND_API_KEY: 're_PruebaDeResend',
  LICENSE_MODE: 'manual',
  LICENSE_REQUEST_EMAIL: 'eric@pymaticlabs.com',
  CHECKOUT_OPEN: 'false',
}

const SECRETS = Object.entries(ENV).filter(([k]) => /KEY|SECRET|SALT/.test(k)).map(([, v]) => v)

const PRODUCTS: ProductId[] = [...modalities.map((m) => m.id), ...plans.map((p) => `plan-${p.id}` as const)]
/** Los precios de Stripe: el pago unico, y el mensual al mes y al ano (en el mismo producto). */
const PRICES = PRODUCTS.flatMap((product): { product: ProductId; period: PlanPeriod | null }[] =>
  isPlanProduct(product) ? (['month', 'year'] as const).map((period) => ({ product, period })) : [{ product, period: null }]
)

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
  /** El tipo de IVA de cerebro=iva-21: el bueno, uno con el IVA dentro, o ninguno. */
  taxRate: 'ok' | 'inclusive' | 'none'
  /** Sin los precios anuales (como antes de pasar otra vez stripe-setup), o uno mal (otro importe y otro producto). */
  annualPrices: 'ok' | 'none' | 'wrong'
  /**
   * El portal: con el mes y el ano de cada plan, bajar al final del periodo y los meses incluidos
   * respetados; sin los anuales; sin esperar al final; subir sin cobrarlo al momento; o acabando los
   * meses incluidos al cambiar (end_trial, o sin poner).
   */
  portal: 'ok' | 'monthly-only' | 'immediate' | 'prorations' | 'end-trial' | 'trial-unset' | 'quantity'
  /** Lo que contesta VIES por el NIF-IVA de PymaticLabs: valido, no valido, caido o sin aceptar al solicitante. */
  vies: 'valid' | 'invalid' | 'down' | 'requester'
  /** Las ventas con el 21 % a la UE sin NIF-IVA que devuelve Supabase (base y fecha). */
  euSales: { net: number; paidAt: string; refunded?: number; status?: string }[]
  /** Las que esperan revision sin empresa (con el 21 %), con el pais declarado. */
  euPending: { net: number; paidAt: string; country: string }[]
  /** Lo que ensena /precios con la venta abierta: enlaces a /comprar o el formulario de antes. */
  pricingLinks: boolean
  /** El cupon de lanzamiento: del producto de su modalidad, o de otro (un producto duplicado por stripe-setup). */
  couponProduct: 'ok' | 'other'
  /** El nombre de los productos en Stripe: el de la web, o el de antes (sin pasar otra vez stripe-setup). */
  productNames: 'ok' | 'old'
}

function services(overrides: Partial<World> = {}) {
  const w: World = {
    live: true,
    bucketPublic: false,
    vault: ['entrega_jobs_secret', 'entrega_site_url'],
    webhookEvents: [...WEBHOOK_EVENTS],
    senderActive: true,
    pricingButtons: false,
    missingTables: [],
    holdedStatus: 200,
    versions: true,
    taxRate: 'ok',
    annualPrices: 'ok',
    portal: 'ok',
    pricingLinks: true,
    couponProduct: 'ok',
    productNames: 'ok',
    vies: 'valid',
    euSales: [],
    euPending: [],
    ...overrides,
  }
  const prices = PRICES.filter((p) => p.period !== 'year' || w.annualPrices !== 'none').map(({ product, period }) => {
    const wrong = period === 'year' && w.annualPrices === 'wrong'
    return {
      id: `price_${lookupKey(product, period ?? 'month')}`,
      object: 'price',
      lookup_key: lookupKey(product, period ?? 'month'),
      unit_amount: priceCents(product, period ?? 'month').list + (wrong ? 100 : 0),
      currency: 'eur',
      product: wrong ? `prod_${product}_otro` : `prod_${product}`,
      recurring: period ? { interval: period } : null,
      tax_behavior: 'exclusive',
    }
  })
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
        // Las ventas con el 21 % a la UE sin NIF-IVA: la consulta pide la empresa (companies!inner) y las de otro pais de la UE.
        if (table === 'purchases' && url.searchParams.get('select')?.includes('companies!inner(country)')) {
          assert.equal(url.searchParams.get('tax_treatment'), 'eq.standard')
          assert.match(url.searchParams.get('companies.country') ?? '', /^in\.\(.*DE.*\)$/)
          assert.doesNotMatch(url.searchParams.get('companies.country') ?? '', /\bES\b/)
          // Monaco va con Francia en el IVA: sus ventas sin NIF-IVA tambien cuentan.
          assert.match(url.searchParams.get('companies.country') ?? '', /\bMC\b/)
          // Como PostgREST, el filtro del estado que pida la consulta (in.(a,b) o neq.a).
          const filter = url.searchParams.get('status') ?? ''
          const listed = /^in\.\((.*)\)$/.exec(filter)?.[1].split(',')
          const excluded = /^neq\.(.*)$/.exec(filter)?.[1]
          const rows = w.euSales.filter((x) => (listed ? listed.includes(x.status ?? 'paid') : excluded ? (x.status ?? 'paid') !== excluded : true))
          // Solo las de vivo (o las de prueba) y desde el ano anterior (con un dia de margen por la hora de Madrid).
          assert.equal(url.searchParams.get('livemode'), `eq.${w.live}`)
          assert.equal(url.searchParams.get('paid_at'), 'gte.2024-12-31T00:00:00.000Z')
          return json(
            rows.map((x) => ({
              id: `p-${x.paidAt}`,
              status: x.status ?? 'paid',
              livemode: w.live,
              tax_treatment: 'standard',
              amount_subtotal: x.net,
              amount_discount: 0,
              amount_total: Math.round(x.net * 1.21),
              amount_refunded: x.refunded ?? 0,
              paid_at: x.paidAt,
              companies: { country: 'DE' },
            }))
          )
        }
        // Las que esperan revision sin empresa (ya cobradas con el 21 %): con el pais declarado.
        if (table === 'purchases' && url.searchParams.get('company_id') === 'is.null') {
          assert.deepEqual([url.searchParams.get('status'), url.searchParams.get('tax_treatment')], ['eq.needs_review', 'eq.standard'])
          return json(
            w.euPending.map((x) => ({
              id: `r-${x.paidAt}`,
              company_id: null,
              status: 'needs_review',
              livemode: w.live,
              tax_treatment: 'standard',
              amount_subtotal: x.net,
              amount_discount: 0,
              amount_total: Math.round(x.net * 1.21),
              amount_refunded: 0,
              paid_at: x.paidAt,
              review_data: { reason: 'country_mismatch', declared: { country: x.country } },
            }))
          )
        }
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
      // El IVA es un tipo fijo del 21 % (sin Stripe Tax): no se pregunta por /v1/tax/settings.
      if (path === '/v1/tax_rates') {
        const rate = { id: 'txr_1', object: 'tax_rate', active: true, percentage: 21, inclusive: w.taxRate === 'inclusive', country: 'ES', metadata: { cerebro: 'iva-21' } }
        // Otro tipo cualquiera de la cuenta (sin el metadato): no cuenta.
        return json(list([{ id: 'txr_otro', object: 'tax_rate', active: true, percentage: 21, inclusive: false, country: 'ES', metadata: {} }, ...(w.taxRate === 'none' ? [] : [rate])]))
      }
      if (path === '/v1/prices') {
        // Como Stripe: solo los de los lookup_keys pedidos (lookup_keys[0]=...), como mucho 10.
        const keys = [...url.searchParams.entries()].filter(([k]) => k.startsWith('lookup_keys')).map(([, v]) => v)
        if (keys.length > 10) return json({ error: { message: 'lookup_keys: como mucho 10' } }, 400)
        // Con expand[0]=data.product, el producto entero con su nombre (como Stripe).
        const expandProduct = [...url.searchParams.entries()].some(([k, v]) => k.startsWith('expand') && v === 'data.product')
        const found = prices.filter((p) => keys.includes(p.lookup_key))
        if (!expandProduct) return json(list(found))
        const named = (id: string) => (w.productNames === 'old' && id === 'prod_hazlo-tu' ? 'Cerebro Digital · Hazlo tú' : productName(id.replace(/^prod_/, '').replace(/_otro$/, ''), 'es'))
        return json(list(found.map((p) => ({ ...p, product: { id: p.product, object: 'product', name: named(p.product) } }))))
      }
      if (path.startsWith('/v1/coupons/')) {
        const id = decodeURIComponent(path.split('/').pop()!)
        const m = modalities.find((x) => launchCouponId(x.id) === id)!
        const cents = priceCents(m.id)
        // Como Stripe: applies_to solo si se pide (expand[0]=applies_to).
        const appliesTo = [...url.searchParams.entries()].some(([k, v]) => k.startsWith('expand') && v === 'applies_to')
        const products = [w.couponProduct === 'other' ? `prod_${m.id}_otro` : `prod_${m.id}`]
        return json({ id, object: 'coupon', amount_off: cents.list - cents.launch!, valid: true, times_redeemed: 1, max_redemptions: 10, ...(appliesTo ? { applies_to: { products } } : {}) })
      }
      if (path === '/v1/billing_portal/configurations') {
        // Un producto por plan, con su precio del mes y el del ano (los que crea stripe-setup). Como
        // Stripe (API 2025-09-30.clover): los productos solo llegan si se piden con expand.
        const expanded = [...url.searchParams.entries()].some(([k, v]) => k.startsWith('expand') && v === 'data.features.subscription_update.products')
        const products = plans.map((p) => ({
          product: `prod_plan-${p.id}`,
          prices: prices.filter((x) => x.lookup_key.startsWith(`cerebro-plan-${p.id}`) && (w.portal !== 'monthly-only' || x.recurring?.interval === 'month')).map((x) => x.id),
          adjustable_quantity: { enabled: w.portal === 'quantity', maximum: null, minimum: 1 },
        }))
        const conditions = w.portal === 'immediate' ? [] : [{ type: 'decreasing_item_amount' }, { type: 'shortening_interval' }]
        const trial = w.portal === 'end-trial' ? { trial_update_behavior: 'end_trial' } : w.portal === 'trial-unset' ? {} : { trial_update_behavior: 'continue_trial' }
        const features = { subscription_update: { enabled: true, default_allowed_updates: ['price'], proration_behavior: w.portal === 'prorations' ? 'create_prorations' : 'always_invoice', ...(expanded ? { products } : {}), schedule_at_period_end: { conditions }, ...trial } }
        return json(list([{ id: 'bpc_1', object: 'billing_portal.configuration', active: true, metadata: { cerebro: 'portal' }, features }]))
      }
    }
    if (url.host === 'api.brevo.com') {
      if (path === '/v3/account') return json({ email: 'info@pymaticlabs.com' })
      if (path === '/v3/senders') return json({ senders: [{ email: 'info@pymaticlabs.com', active: w.senderActive }] })
      if (path === '/v3/senders/domains') return json({ domains: [{ domain_name: 'pymaticlabs.com', authenticated: true }] })
    }
    if (url.host === 'api.holded.com') {
      // Un 401 que repite la clave en el mensaje: el informe no la puede ensenar.
      if (w.holdedStatus !== 200) return json({ message: `invalid key ${ENV.HOLDED_API_KEY}` }, w.holdedStatus)
      if (path.endsWith('/taxes')) return json({ items: [{ id: 's_iva_21' }, { id: 's_iva_intras' }, { id: 's_iva_nosujeto' }] })
      return json({ items: [] })
    }
    if (url.host === 'ec.europa.eu' && path === '/taxation_customs/vies/rest-api/check-vat-number' && method === 'POST') {
      // Siempre con el NIF-IVA de PymaticLabs, que pregunta por si mismo.
      const body = JSON.parse(String(init.body)) as Record<string, string>
      assert.deepEqual(body, { countryCode: 'ES', vatNumber: 'B88781745', requesterMemberStateCode: 'ES', requesterNumber: 'B88781745' })
      if (w.vies === 'down') return json({ actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE', message: 'Member State service unavailable' }] }, 500)
      if (w.vies === 'requester') return json({ actionSucceed: false, errorWrappers: [{ error: 'INVALID_REQUESTER_INFO' }] }, 400)
      return json({ countryCode: 'ES', vatNumber: 'B88781745', requestDate: '2026-11-02T10:00:00.000Z', valid: w.vies === 'valid', requestIdentifier: w.vies === 'valid' ? 'WAPIAAAAZ9' : '', name: 'PYMATICLABS SL', address: '---' })
    }
    if (url.host === 'api.cal.com' && path === '/v2/slots') return json({ data: { '2026-11-03': [{ start: '2026-11-03T17:00:00.000Z' }] } })
    if (url.host === 'pymaticlabs.com') {
      if (path === '/api/zone/me') return json({ available: true, user: null })
      if (path === '/') return new Response('<header><a href="/zona/entrar">Entrar</a></header>', { status: 200 })
      if (path === '/precios') {
        const buttons = w.pricingLinks ? '<a href="/comprar/hazlo-tu">Comprar</a>' : '<form action="/api/checkout" method="post"></form>'
        return new Response(w.pricingButtons ? buttons : '<button disabled>Próximamente</button><a href="/contacto?interes=hazlo-tu">Avísame</a>', { status: 200 })
      }
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
  // El IVA de las ventas con IVA, el tipo fijo del 21 % (sin Stripe Tax); y los impuestos de Holded de las
  // ventas sin IVA (inversion del sujeto pasivo y fuera de la UE), puestos y en la cuenta.
  assert.deepEqual([find(report, 'Tipo de IVA del 21 %').status, find(report, 'Tipo de IVA del 21 %').detail], ['ok', 'txr_1, activo, sin IVA dentro'])
  assert.ok(!report.checks.some((c) => /Stripe Tax/.test(c.item)))
  for (const item of ['Impuesto IVA del 21 %', 'Impuesto inversión del sujeto pasivo (HOLDED_TAX_REVERSE_CHARGE)', 'Impuesto sin IVA español (HOLDED_TAX_EXPORT)', 'HOLDED_TAX_REVERSE_CHARGE', 'HOLDED_TAX_EXPORT']) assert.equal(find(report, item).status, 'ok', item)
  // VIES contesta con el NIF-IVA de PymaticLabs, y las ventas con el 21 % a la UE sin NIF-IVA, lejos del limite.
  assert.deepEqual([find(report, 'NIF-IVA de PymaticLabs').status, find(report, 'NIF-IVA de PymaticLabs').detail], ['ok', 'válido en VIES (consulta WAPIAAAAZ9)'])
  assert.equal(find(report, 'Ventas con el 21 % a la UE sin NIF-IVA').status, 'ok')
  assert.equal(find(report, 'Precio cerebro-plan-pro').status, 'ok')
  // El mensual, tambien por ano adelantado: el precio de 10 meses, en el producto del plan.
  assert.deepEqual([find(report, 'Precio cerebro-plan-pro-anual').status, find(report, 'Precio cerebro-plan-pro-anual').detail], ['ok', '1990 € sin IVA, al año'])
  assert.equal(find(report, 'Precio cerebro-plan-premium-anual').status, 'ok')
  assert.equal(find(report, 'Portal de cliente').status, 'ok')
  assert.equal(find(report, 'Cupón cerebro-lanzamiento-hazlo-tu').status, 'ok')
  assert.equal(find(report, 'Remitente info@pymaticlabs.com').status, 'ok')
  assert.equal(find(report, 'Huecos de Eric').status, 'ok')
  assert.equal(find(report, 'Botón Entrar').status, 'ok')
  assert.match(find(report, 'CHECKOUT_OPEN').detail!, /todo listo/)
  assert.match(formatReport(report), /Listo para vender/)
  noSecrets(report)
})

test('comprobacion de produccion: dice lo que falta y como arreglarlo, sin ensenar ningun secreto', async () => {
  services({ live: false, bucketPublic: true, vault: ['entrega_site_url'], webhookEvents: ['checkout.session.completed'], senderActive: false, missingTables: ['license_requests'], holdedStatus: 401, versions: false, taxRate: 'inclusive' })
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
  // El tipo de IVA con el IVA dentro no vale (cobraria de menos); sin ninguno, tampoco.
  falta('Tipo de IVA del 21 %')
  assert.match(find(report, 'Tipo de IVA del 21 %').detail!, /IVA dentro/)
  assert.match(find(report, 'Tipo de IVA del 21 %').fix!, /stripe-setup/)
  falta('Botones de compra')
  // La venta abierta con cosas sin arreglar: lo primero, cerrarla.
  assert.match(find(report, 'CHECKOUT_OPEN').fix!, /CHECKOUT_OPEN=false/)
  // Holded contesta 401 repitiendo la clave: el informe no la repite.
  assert.equal(report.checks.find((c) => c.area === 'Holded')!.status, 'falta')
  noSecrets(report)
  assert.match(formatReport(report), /NO está listo para vender/)
})

test('comprobacion de produccion: el pago anual del mensual, con sus precios en el producto del plan y el portal que cambia entre los dos', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  // Sin los anuales (stripe-setup sin volver a pasar): falta cada uno, y el portal no los ofrece.
  services({ annualPrices: 'none' })
  const none = await productionCheck(ENV, at)
  for (const plan of plans) assert.deepEqual([find(none, `Precio cerebro-plan-${plan.id}-anual`).status, find(none, `Precio cerebro-plan-${plan.id}-anual`).detail], ['falta', 'no está'])
  assert.equal(find(none, 'Precio cerebro-plan-pro').status, 'ok')
  assert.equal(none.ready, false)
  // Con otro importe y en otro producto (el portal no cambiaria entre el del mes y el del ano).
  services({ annualPrices: 'wrong' })
  const wrong = find(await productionCheck(ENV, at), 'Precio cerebro-plan-esencial-anual')
  assert.equal(wrong.status, 'falta')
  assert.match(wrong.detail!, /cuesta 99100 y la oferta dice 99000/)
  assert.match(wrong.detail!, /no es del producto del plan/)
  // El portal sin los anuales, o que baja de plan al momento (con abono del periodo empezado).
  services({ portal: 'monthly-only' })
  const monthlyOnly = find(await productionCheck(ENV, at), 'Portal de cliente')
  assert.equal(monthlyOnly.status, 'falta')
  assert.match(monthlyOnly.detail!, /no deja cambiar a cerebro-plan-esencial-anual, cerebro-plan-pro-anual, cerebro-plan-premium-anual/)
  services({ portal: 'immediate' })
  const immediate = find(await productionCheck(ENV, at), 'Portal de cliente')
  assert.equal(immediate.status, 'falta')
  assert.match(immediate.detail!, /final del periodo pagado/)
  // Subir de plan sin cobrarlo al momento (create_prorations): la diferencia esperaria a la renovacion.
  services({ portal: 'prorations' })
  const prorations = find(await productionCheck(ENV, at), 'Portal de cliente')
  assert.equal(prorations.status, 'falta')
  assert.match(prorations.detail!, /subir de plan no se cobra al momento \(proration_behavior create_prorations: tiene que ser always_invoice\)/)
  // Un producto con el nombre de antes: es el que ve el cliente en la pagina de pago.
  services({ productNames: 'old' })
  const oldName = find(await productionCheck(ENV, at), 'Precio cerebro-hazlo-tu')
  assert.equal(oldName.status, 'falta')
  assert.match(oldName.detail!, /el producto se llama «Cerebro Digital · Hazlo tú» y en la web «Cerebro Digital · Solista»/)
  // Con la cantidad cambiable, el cliente podria pagar el plan dos veces.
  services({ portal: 'quantity' })
  const quantity = find(await productionCheck(ENV, at), 'Portal de cliente')
  assert.equal(quantity.status, 'falta')
  assert.match(quantity.detail!, /deja cambiar la cantidad/)
  services()
  assert.equal(find(await productionCheck(ENV, at), 'Portal de cliente').status, 'ok')
  // Los botones de /precios llevan a /comprar (que pide el NIF): con la venta abierta, cuentan.
  services({ pricingButtons: true })
  const open = await productionCheck({ ...ENV, CHECKOUT_OPEN: 'true' }, { ...at, checkSite: true })
  assert.deepEqual([find(open, 'Botones de compra').status, find(open, 'Botones de compra').detail], ['ok', 'en /precios'])
  services({ pricingButtons: false })
  assert.equal(find(await productionCheck({ ...ENV, CHECKOUT_OPEN: 'true' }, { ...at, checkSite: true }), 'Botones de compra').status, 'falta')
})

test('comprobacion de produccion: el cupon de lanzamiento tiene que ser del producto del precio de su modalidad', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  services()
  assert.equal(find(await productionCheck(ENV, at), 'Cupón cerebro-lanzamiento-acompanado').status, 'ok')
  // Con el producto duplicado (stripe-setup repetido enseguida), el cupon se quedaba en el viejo y salia en verde.
  services({ couponProduct: 'other' })
  const report = await productionCheck(ENV, at)
  const coupon = find(report, 'Cupón cerebro-lanzamiento-hazlo-tu')
  assert.equal(coupon.status, 'falta')
  assert.equal(coupon.detail, 'no es del producto de cerebro-hazlo-tu (prod_hazlo-tu), sino de prod_hazlo-tu_otro')
  assert.match(coupon.fix!, /borrarlo a mano en Stripe y repetir scripts\/stripe-setup\.mts/)
  assert.equal(report.ready, false)
})

test('comprobacion de produccion: sin las claves de un servicio no lo llama, y redact quita lo que parece una clave', async () => {
  services()
  const env = { ...ENV, BREVO_API_KEY: '', DELIVERY_IP_SALT: '' }
  const report = await productionCheck(env, { now: new Date('2026-11-02T10:00:00Z') })
  assert.equal(find(report, 'DELIVERY_IP_SALT').status, 'falta')
  assert.equal(report.checks.find((c) => c.area === 'Brevo')!.detail, 'faltan BREVO_API_KEY')
  // Los demas servicios se miran igual, aunque falte la sal.
  assert.equal(report.checks.find((c) => c.area === 'Stripe' && c.item === 'Clave')!.status, 'ok')
  services({ taxRate: 'none' })
  const noRate = await productionCheck(ENV, { now: new Date('2026-11-02T10:00:00Z') })
  assert.equal(find(noRate, 'Tipo de IVA del 21 %').status, 'falta')
  assert.match(find(noRate, 'Tipo de IVA del 21 %').detail!, /no está/)
  assert.equal(noRate.ready, false)
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

test('comprobacion de produccion: el portal respeta los meses incluidos en cualquier cambio (continue_trial)', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  for (const [portal, shown] of [['end-trial', 'end_trial'], ['trial-unset', 'sin poner']] as const) {
    services({ portal })
    const report = await productionCheck(ENV, at)
    const check = find(report, 'Portal de cliente')
    assert.equal(check.status, 'falta', portal)
    assert.match(check.detail!, new RegExp(`con meses incluidos, cambiar de plan o pasar a anual los acaba y se cobra ese día \\(trial_update_behavior ${shown}: tiene que ser continue_trial\\)`))
    assert.match(check.fix!, /stripe-setup/)
    assert.equal(report.ready, false)
  }
  services()
  assert.equal(find(await productionCheck(ENV, at), 'Portal de cliente').status, 'ok')
})

test('comprobacion de produccion: VIES con el NIF-IVA de PymaticLabs; caido, solo aviso', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  services({ vies: 'down' })
  const down = await productionCheck(ENV, at)
  assert.equal(find(down, 'NIF-IVA de PymaticLabs').status, 'aviso')
  assert.match(find(down, 'NIF-IVA de PymaticLabs').detail!, /VIES no contesta ahora \(MS_UNAVAILABLE\)/)
  assert.equal(down.ready, true)
  services({ vies: 'invalid' })
  const invalid = await productionCheck(ENV, at)
  assert.equal(find(invalid, 'NIF-IVA de PymaticLabs').status, 'falta')
  assert.match(find(invalid, 'NIF-IVA de PymaticLabs').fix!, /VIES_REQUESTER/)
  assert.equal(invalid.ready, false)
  services({ vies: 'requester' })
  assert.equal(find(await productionCheck(ENV, at), 'NIF-IVA de PymaticLabs').status, 'falta')
  // En vivo, otro NIF-IVA (aunque valga en VIES) saldria impreso como el del proveedor: FALTA.
  services()
  const other = find(await productionCheck({ ...ENV, VIES_REQUESTER: 'ESB12345674' }, at), 'NIF-IVA de PymaticLabs')
  assert.equal(other.status, 'falta')
  assert.match(other.detail!, /no es el NIF-IVA de PymaticLabs \(ESB88781745\)/)
})

test('comprobacion de produccion: los impuestos de Holded de las ventas sin IVA son obligatorios; un id que no esta en la cuenta, aviso', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  services()
  const report = await productionCheck({ ...ENV, HOLDED_TAX_REVERSE_CHARGE: '', HOLDED_TAX_EXPORT: 's_otro' }, at)
  assert.equal(find(report, 'HOLDED_TAX_REVERSE_CHARGE').status, 'falta')
  assert.match(find(report, 'HOLDED_TAX_REVERSE_CHARGE').detail!, /inversión del sujeto pasivo/)
  assert.equal(find(report, 'HOLDED_TAX_EXPORT').status, 'falta')
  assert.equal(find(report, 'Impuesto sin IVA español (HOLDED_TAX_EXPORT)').status, 'aviso')
  assert.match(find(report, 'Impuesto sin IVA español (HOLDED_TAX_EXPORT)').detail!, /«s_otro» no aparece/)
  assert.equal(report.ready, false)
})

test('comprobacion de produccion: los impuestos de Holded, exactamente s_iva_intras y s_iva_nosujeto; los que se confunden con ellos, FALTA con el porque', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  services()
  const good = await productionCheck(ENV, at)
  assert.deepEqual([find(good, 'HOLDED_TAX_REVERSE_CHARGE').status, find(good, 'HOLDED_TAX_EXPORT').status], ['ok', 'ok'])
  const cases: [Record<string, string>, string, RegExp][] = [
    // La inversion del sujeto pasivo interior: S2, casilla 122 y fuera del 349.
    [{ HOLDED_TAX_REVERSE_CHARGE: 's_iva_invsuj' }, 'HOLDED_TAX_REVERSE_CHARGE', /^es s_iva_invsuj, .*casilla 122 del 303 y se quedaría fuera del 349: tiene que ser s_iva_intras$/],
    // La exportacion: casilla 60 y la clave 02 de Verifactu, que exige una operacion exenta.
    [{ HOLDED_TAX_EXPORT: 's_iva_export' }, 'HOLDED_TAX_EXPORT', /^es s_iva_export, .*casilla 60 del 303 y a Verifactu con la clave 02.*: tiene que ser s_iva_nosujeto$/],
    [{ HOLDED_TAX_EXPORT: 's_iva_exento' }, 'HOLDED_TAX_EXPORT', /^es s_iva_exento, .*no están exentas, sino no sujetas.*: tiene que ser s_iva_nosujeto$/],
    [{ HOLDED_TAX_REVERSE_CHARGE: 's_iva_exento' }, 'HOLDED_TAX_REVERSE_CHARGE', /: tiene que ser s_iva_intras$/],
    // Cambiados entre si.
    [{ HOLDED_TAX_REVERSE_CHARGE: 's_iva_nosujeto', HOLDED_TAX_EXPORT: 's_iva_intras' }, 'HOLDED_TAX_EXPORT', /^es s_iva_intras, el de las ventas a empresas de la UE con NIF-IVA .*: tiene que ser s_iva_nosujeto$/],
  ]
  for (const [env, item, why] of cases) {
    const report = await productionCheck({ ...ENV, ...env }, at)
    const check = find(report, item)
    assert.equal(check.status, 'falta', `${item}=${env[item]}`)
    assert.match(check.detail!, why)
    assert.match(check.fix!, item === 'HOLDED_TAX_EXPORT' ? /HOLDED_TAX_EXPORT=s_iva_nosujeto/ : /HOLDED_TAX_REVERSE_CHARGE=s_iva_intras/)
    assert.equal(report.ready, false)
  }
})

test('comprobacion de produccion: las ventas con el 21 % a la UE sin NIF-IVA, aviso desde 8.000 € este año (el pago se para) y al pasar de 10.000 € (este o el anterior)', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  const plain = (text: string) => text.replace(/ /g, ' ')
  services({ euSales: [{ net: 500_000, paidAt: '2026-03-01T10:00:00Z' }, { net: 300_000, paidAt: '2026-10-01T10:00:00Z', refunded: 121_000 }, { net: 200_000, paidAt: '2025-06-01T10:00:00Z' }] })
  const below = find(await productionCheck(ENV, at), 'Ventas con el 21 % a la UE sin NIF-IVA')
  assert.equal(below.status, 'ok')
  assert.equal(plain(below.detail!), '7.000,00 € este año y 2.000,00 € el anterior, sin IVA')
  // En 8.000 €: el pago ya no abre ventas asi, pero los mensuales siguen con el 21 %.
  services({ euSales: [{ net: 600_000, paidAt: '2026-03-01T10:00:00Z' }, { net: 200_000, paidAt: '2026-10-01T10:00:00Z' }] })
  const stop = find(await productionCheck(ENV, at), 'Ventas con el 21 % a la UE sin NIF-IVA')
  assert.equal(stop.status, 'aviso')
  assert.match(plain(stop.detail!), /^8\.000,00 € este año .*: desde 8\.000,00 € la web ya no abre pagos así .*los mensuales que ya hay siguen cobrando el 21 % español$/)
  services({ euSales: [{ net: 900_000, paidAt: '2026-03-01T10:00:00Z' }, { net: 200_000, paidAt: '2026-10-01T10:00:00Z' }] })
  const over = await productionCheck(ENV, at)
  const check = find(over, 'Ventas con el 21 % a la UE sin NIF-IVA')
  assert.equal(check.status, 'aviso')
  assert.match(check.detail!, /ventanilla única, OSS/)
  assert.match(check.fix!, /Manel/)
  // Uno del ano anterior por encima tambien cuenta (el limite mira este y el anterior).
  services({ euSales: [{ net: 1_100_000, paidAt: '2025-05-01T10:00:00Z' }] })
  assert.equal(find(await productionCheck(ENV, at), 'Ventas con el 21 % a la UE sin NIF-IVA').status, 'aviso')
  // Si Supabase no contesta a esa consulta: aviso, sin parar la comprobacion.
  services({ missingTables: ['purchases'] })
  const failed = find(await productionCheck(ENV, at), 'Ventas con el 21 % a la UE sin NIF-IVA')
  assert.deepEqual([failed.status, /no se pudieron sumar/.test(failed.detail!)], ['aviso', true])
})

test('comprobacion de produccion: las ventas a la UE sin NIF-IVA cuentan como en el pago y en el aviso de cada venta (pagadas, devueltas en parte, con contracargo abierto o a revisar ya cobradas)', async () => {
  const at = { now: new Date('2026-11-02T10:00:00Z') }
  // La que espera revision cuenta (ya cobrada con el 21 %), tambien sin empresa (con el pais
  // declarado, si es de la UE); el contracargo perdido (ya rectificado) y la devuelta, no.
  services({
    euSales: [
      { net: 300_000, paidAt: '2026-03-01T10:00:00Z' },
      { net: 200_000, paidAt: '2026-04-01T10:00:00Z', status: 'partially_refunded', refunded: 121_000 },
      { net: 100_000, paidAt: '2026-05-01T10:00:00Z', status: 'disputed' },
      { net: 50_000, paidAt: '2026-06-01T10:00:00Z', status: 'needs_review' },
      { net: 900_000, paidAt: '2026-07-01T10:00:00Z', status: 'dispute_lost' },
      { net: 900_000, paidAt: '2026-08-01T10:00:00Z', status: 'refunded', refunded: 1_089_000 },
    ],
    euPending: [
      { net: 100_000, paidAt: '2026-09-01T10:00:00Z', country: 'IT' },
      { net: 900_000, paidAt: '2026-09-02T10:00:00Z', country: 'US' },
      { net: 900_000, paidAt: '2026-09-03T10:00:00Z', country: 'ES' },
    ],
  })
  const check = find(await productionCheck(ENV, at), 'Ventas con el 21 % a la UE sin NIF-IVA')
  assert.equal(check.status, 'ok')
  assert.equal(check.detail!.replace(/ /g, ' '), '6.500,00 € este año y 0,00 € el anterior, sin IVA')
})

test('comprobacion de produccion: con el servicio de prueba de VIES puesto (Preview), el NIF-IVA propio se mira en el de verdad, y aviso', async () => {
  services({ live: false })
  const report = await productionCheck({ ...ENV, STRIPE_SECRET_KEY: 'sk_test_51PruebaDeClaveSecreta', VIES_TEST_SERVICE: 'true' }, { now: new Date('2026-11-02T10:00:00Z') })
  // El falso solo contesta en /check-vat-number: el servicio de prueba daria «sin mock».
  assert.equal(find(report, 'NIF-IVA de PymaticLabs').status, 'ok')
  assert.equal(find(report, 'Servicio de prueba de VIES').status, 'aviso')
})
