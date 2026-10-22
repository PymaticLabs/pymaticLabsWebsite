// La comprobacion de produccion (scripts/comprobar-produccion.mts y GET /api/admin/health): con el
// entorno de produccion, que esten todas las variables de los modos elegidos y que cada servicio
// conteste lo que la entrega necesita, solo leyendo (ni cobros, ni correos, ni facturas, ni firmas).
// Devuelve una lista en castellano con lo que falta y como arreglarlo. Nunca ensena el valor de un
// secreto: los mensajes de los proveedores pasan por redact() antes de salir.
//
// Lo que no se puede mirar desde fuera (el SMTP de Supabase, la plantilla del codigo, Verifactu...)
// sale al final como "a mano", para repasarlo en su panel.

import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { modalities, plans } from '../offer.ts'
import { CalcomCalendar } from './adapters/calcom-calendar.ts'
import { GcpKmsSigner } from './adapters/gcp-kms-signer.ts'
import { requestJson } from './adapters/http.ts'
import { readConfig, type DeliveryConfig } from './config.ts'
import { SESSION_HOSTS, WEBHOOK_EVENTS, launchCouponId, lookupKey, priceCents, type ProductId } from './products.ts'
import { errorMessage } from './util.ts'

type Env = Record<string, string | undefined>

export type CheckStatus = 'ok' | 'falta' | 'aviso' | 'info'

export interface Check {
  area: string
  item: string
  status: CheckStatus
  detail?: string
  /** Como arreglarlo (la seccion de docs/entrega-automatica.md que lo explica). */
  fix?: string
}

export interface HealthReport {
  generatedAt: string
  /** true: se espera produccion (Stripe en vivo, la clave del Mac); false: un entorno de pruebas. */
  expectLive: boolean
  /** Sin nada que falte: se puede abrir la venta. */
  ready: boolean
  summary: Record<CheckStatus, number>
  checks: Check[]
}

const GUIDE = 'docs/entrega-automatica.md'
const SECRET_NAME = /KEY|SECRET|SALT|JSON|TOKEN|PASSWORD|SEED|PRIVATE/

/** Quita de un texto cualquier secreto del entorno y lo que tenga forma de clave. */
export function redact(text: string, env: Env): string {
  let out = text
  for (const [name, value] of Object.entries(env)) {
    if (!value || value.trim().length < 8 || !SECRET_NAME.test(name)) continue
    out = out.split(value.trim()).join('***')
  }
  return out
    .replace(/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9*]+/g, '$1_$2_***')
    .replace(/\bwhsec_[A-Za-z0-9]+/g, 'whsec_***')
    .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, 'sb_$1_***')
    .replace(/\bxkeysib-[A-Za-z0-9-]+/g, 'xkeysib-***')
    .replace(/\bcal_(live_)?[A-Za-z0-9]{8,}/g, 'cal_***')
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '***')
}

type Add = (item: string, status: CheckStatus, detail?: string | null, fix?: string) => void

/** Una seccion: lo que anade, en su orden; si revienta, una linea que lo dice. */
async function section(area: string, env: Env, run: (add: Add) => Promise<void> | void, failFix: string): Promise<Check[]> {
  const checks: Check[] = []
  const add: Add = (item, status, detail, fix) => checks.push({ area, item, status, ...(detail ? { detail: redact(detail, env) } : {}), ...(fix ? { fix } : {}) })
  try {
    await run(add)
  } catch (error) {
    const e = error as { type?: string; statusCode?: number }
    add('Conexión', 'falta', errorMessage(error) || [e.type, e.statusCode].filter(Boolean).join(' ') || 'sin respuesta', failFix)
  }
  return checks
}

// --- Modos y variables -------------------------------------------------------------------------

interface Variable {
  name: string
  what: string
  fix: string
  /** Lo que no vale de su valor (sin ensenarlo), o null. */
  invalid?: (value: string) => string | null
  /** aviso en vez de falta si no esta. */
  optional?: boolean
}

function variables(config: DeliveryConfig | null, expectLive: boolean): Variable[] {
  const secret = (what: string) => (v: string) => (v.length < 32 ? `${what} corto: mejor de 32 caracteres o mas (openssl rand -hex 32)` : null)
  const list: Variable[] = [
    { name: 'NEXT_PUBLIC_SITE_URL', what: 'la dirección pública de la web', fix: `${GUIDE}, 3.7`, invalid: (v) => (/^https:\/\//.test(v) ? null : 'tiene que empezar por https://') },
    { name: 'DELIVERY_IP_SALT', what: 'la sal de las huellas de IP y correo', fix: 'openssl rand -hex 32, en Production', invalid: (v) => (v.trim().length < 16 ? 'demasiado corta' : null) },
    { name: 'JOBS_SECRET', what: 'el secreto de pg_cron (/api/jobs/*)', fix: `${GUIDE}, 3.7 (el mismo que en Vault)`, invalid: secret('secreto') },
    { name: 'ADMIN_SECRET', what: 'el secreto de /api/admin/* (licencias a mano, versiones)', fix: `${GUIDE}, 3.7`, invalid: secret('secreto') },
    {
      name: 'STRIPE_SECRET_KEY',
      what: 'la clave secreta de Stripe',
      fix: `${GUIDE}, 3.4`,
      invalid: (v) => {
        if (!/^(sk|rk)_(live|test)_/.test(v)) return 'no es una clave secreta de Stripe (sk_live_ o sk_test_)'
        const live = /_live_/.test(v)
        if (expectLive && !live) return 'es de PRUEBA: en producción, la sk_live_'
        if (!expectLive && live) return 'es de VIVO en un entorno de pruebas'
        return null
      },
    },
    { name: 'STRIPE_WEBHOOK_SECRET', what: 'el secreto del webhook de Stripe', fix: 'scripts/stripe-setup.mts --webhook (lo imprime una vez)', invalid: (v) => (v.startsWith('whsec_') ? null : 'no empieza por whsec_') },
    { name: 'SUPABASE_URL', what: 'la URL del proyecto de Supabase', fix: `${GUIDE}, 3.1`, invalid: (v) => (/^https:\/\/.+/.test(v) ? null : 'tiene que ser la https://<ref>.supabase.co') },
    { name: 'SUPABASE_ANON_KEY', what: 'la clave publicable de Supabase', fix: `${GUIDE}, 3.1` },
    { name: 'SUPABASE_SERVICE_ROLE_KEY', what: 'la clave secreta de Supabase', fix: `${GUIDE}, 3.1` },
    { name: 'BREVO_API_KEY', what: 'la clave de la API de Brevo', fix: `${GUIDE}, 3.2` },
    { name: 'HOLDED_API_KEY', what: 'la clave de la API de Holded', fix: `${GUIDE}, 3.5` },
    { name: 'CALCOM_API_KEY', what: 'la clave de la API de Cal.com', fix: `${GUIDE}, 3.6` },
    {
      name: 'CALCOM_EVENT_TYPES',
      what: 'los eventos de Eric y de Sergio en Cal.com',
      fix: `${GUIDE}, 3.6: {"eric": <id>, "sergio": <id>}`,
      invalid: (v) => {
        try {
          const parsed = JSON.parse(v) as Record<string, unknown>
          const missing = SESSION_HOSTS.filter((h) => !(Number(parsed[h.id]) > 0)).map((h) => h.name)
          return missing.length ? `falta el evento de ${missing.join(' y ')}` : null
        } catch {
          return 'no es JSON'
        }
      },
    },
    { name: 'HOLDED_TAX_REVERSE_CHARGE', what: 'el impuesto de Holded de la inversión del sujeto pasivo (UE)', fix: `${GUIDE}, 3.5, paso 2 (sin él, esas ventas se paran con aviso)`, optional: true },
    { name: 'HOLDED_TAX_EXPORT', what: 'el impuesto de Holded de las ventas fuera de la UE', fix: `${GUIDE}, 3.5, paso 2 (sin él, esas ventas se paran con aviso)`, optional: true },
    { name: 'RESEND_API_KEY', what: 'el correo del formulario de contacto', fix: 'Resend (no es de la venta)', optional: true },
  ]
  if (config?.licenseMode === 'kms') {
    list.push(
      { name: 'GCP_KMS_KEY_VERSION', what: 'la clave de licencias de la web en KMS', fix: `${GUIDE}, 3.3` },
      { name: 'GOOGLE_SERVICE_ACCOUNT_JSON', what: 'la cuenta de servicio que solo firma', fix: `${GUIDE}, 3.3` },
      { name: 'LICENSE_WEB_PUBLIC_KEY', what: 'la publica que debe dar KMS', fix: 'scripts/clave-web-publica.mts' }
    )
  }
  return list
}

function checkModes(env: Env, expectLive: boolean): { config: DeliveryConfig | null; checks: Promise<Check[]> } {
  let config: DeliveryConfig | null = null
  let failure: string | null = null
  try {
    config = readConfig(env)
  } catch (error) {
    failure = errorMessage(error)
    // Sin la sal (lo mas comun la primera vez), los servicios se miran igual: la falta ya sale arriba.
    try {
      config = readConfig({ ...env, DELIVERY_IP_SALT: 'solo-para-comprobar-los-servicios' })
    } catch {
      config = null
    }
  }
  const checks = section('Modos y variables', env, (add) => {
    // La sal sale abajo, con las variables; lo demas que no vale, aqui.
    if (failure && !(config && failure.includes('DELIVERY_IP_SALT'))) add('Configuración de la entrega', 'falta', failure, 'Corregir esa variable en Vercel (Production) y volver a desplegar')
    if (config) {
      if (config.mode !== 'live') add('Entrega', 'falta', 'DELIVERY_MODE=fake: todo de mentira', 'DELIVERY_MODE=live (o sin poner) en Production')
      else add('Entrega', 'ok', 'de verdad (DELIVERY_MODE=live)')
      const fakes = Object.entries(config.adapters).filter(([, v]) => ['memory', 'local', 'fake', 'outbox'].includes(v))
      const allowed = fakes.filter(([k]) => !(k === 'signer' && config!.licenseMode === 'manual'))
      if (allowed.length) add('Piezas', 'falta', `de mentira: ${allowed.map(([k, v]) => `${k}=${v}`).join(', ')}`, 'Quitar las DELIVERY_REPOSITORY, DELIVERY_MAILER... de Production')
      if (config.licenseMode === 'manual') {
        add('Licencias', 'ok', `a mano: Eric las firma en su Mac y las sube (pedidas a ${config.licenseRequestEmail}; aviso a las ${config.licensePendingAlertHours} h sin firmar)`)
        if (!env.LICENSE_REQUEST_EMAIL?.trim()) add('LICENSE_REQUEST_EMAIL', 'aviso', `sin poner: las licencias se piden a ${config.licenseRequestEmail}; que sea un buzón que Eric lea`, `LICENSE_REQUEST_EMAIL con el correo de Eric (${GUIDE}, sección 0)`)
        if (expectLive && config.manualKeyEnv === 'test') {
          add('Clave de las licencias a mano', 'falta', 'LICENSE_MANUAL_PUBLIC_KEY es una clave de pruebas: los pagos de verdad no se podrían entregar', 'Quitar LICENSE_MANUAL_PUBLIC_KEY de Production (vale la del Mac de Eric)')
        } else if (!expectLive && config.manualKeyEnv === 'production') {
          add('Clave de las licencias a mano', 'aviso', 'la del Mac de Eric: los pagos de prueba no se podrán entregar', `Para probar, LICENSE_MANUAL_PUBLIC_KEY de pruebas (scripts/subir-licencia.mts --crear-clave-prueba; ${GUIDE}, sección 0)`)
        } else {
          add('Clave de las licencias a mano', 'ok', config.manualKeyEnv === 'production' ? 'la del Mac de Eric (licencias.pub)' : 'de pruebas (LICENSE_MANUAL_PUBLIC_KEY)')
        }
      } else if (!env.LICENSE_MODE?.trim()) {
        // Sin decirlo, firma la web solo porque la clave de KMS esta puesta (la guia lo pedia antes):
        // con el producto de hoy, cada cliente recibiria una licencia que no vale. Tiene que ser a proposito.
        add(
          'Licencias',
          expectLive ? 'falta' : 'aviso',
          'LICENSE_MODE sin poner y la clave de KMS puesta: firmaría la web, con una clave que el producto de hoy no acepta',
          `LICENSE_MODE=manual en Production (kms solo cuando Eric publique la versión que acepta la clave de la web; ${GUIDE}, sección 9)`
        )
      } else {
        add('Licencias', 'aviso', 'las firma la web con su clave de KMS (LICENSE_MODE=kms): solo vale si el producto ya acepta su publica', `Si Eric aún no ha publicado esa versión, LICENSE_MODE=manual (${GUIDE}, sección 9)`)
        if (expectLive && config.licenseKeyEnv !== 'production') add('Clave de la web', 'falta', 'LICENSE_KEY_ENV=test: no firmaría pagos en vivo', 'Quitar LICENSE_KEY_ENV de Production')
      }
      add('Facturas', 'info', config.invoiceMode === 'emit' ? 'se emiten solas en Holded (Verifactu)' : 'en borrador: cada venta avisa para emitirla a mano en Holded (HOLDED_INVOICE_MODE=draft)')
    }
    if (env.VERCEL_ENV && expectLive && env.VERCEL_ENV !== 'production') add('Entorno de Vercel', 'aviso', `VERCEL_ENV=${env.VERCEL_ENV}: no es Production`)
    for (const v of variables(config, expectLive)) {
      const value = env[v.name]?.trim()
      if (!value) {
        add(v.name, v.optional ? 'aviso' : 'falta', `sin poner: ${v.what}`, v.fix)
        continue
      }
      const wrong = v.invalid?.(value) ?? null
      add(v.name, wrong ? (wrong.includes('corto') ? 'aviso' : 'falta') : 'ok', wrong ?? 'puesta', wrong ? v.fix : undefined)
    }
  }, 'Revisar las variables')
  return { config, checks }
}

// --- Supabase ----------------------------------------------------------------------------------

const MIGRATIONS: { file: string; tables: string[] }[] = [
  {
    file: '20261021120000_entrega.sql',
    tables: ['companies', 'members', 'purchases', 'licenses', 'invoices', 'bookings', 'versions', 'version_files', 'stripe_events', 'jobs', 'license_sequences', 'rate_limits', 'launch_slots'],
  },
  { file: '20261021130000_licencias_a_mano.sql', tables: ['license_requests'] },
]
const CRON_JOBS = ['entrega-cola', 'entrega-conciliacion', 'entrega-huellas-ip', 'entrega-limites', 'entrega-historial-cron']

async function checkSupabase(env: Env, config: DeliveryConfig, add: Add) {
  const url = env.SUPABASE_URL!.replace(/\/+$/, '')
  const db: SupabaseClient = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } })
  const first = await db.from('companies').select('id').limit(1)
  if (first.error && first.error.code !== 'PGRST205' && first.error.code !== '42P01') {
    const why = [first.error.code, first.error.message, first.error.details].filter(Boolean).join(' · ') || 'sin respuesta'
    add('Conexión', 'falta', `no contesta o la clave secreta no vale: ${why}`, `${GUIDE}, 3.1, pasos 1 y 2`)
    return
  }
  add('Conexión', 'ok', 'contesta con la clave secreta')

  // Las migraciones: sus tablas, la columna nueva de licenses y la funcion de estado.
  for (const migration of MIGRATIONS) {
    const missing: string[] = []
    for (const table of migration.tables) {
      const { error } = await db.from(table).select('*').limit(1)
      if (error) missing.push(table)
    }
    if (migration.file.includes('licencias_a_mano')) {
      if ((await db.from('licenses').select('origin').limit(1)).error) missing.push('licenses.origin')
    }
    add(`Migración ${migration.file}`, missing.length ? 'falta' : 'ok', missing.length ? `sin aplicar (no están: ${missing.join(', ')})` : 'aplicada', `npx supabase db push (${GUIDE}, 3.1, paso 3)`)
  }
  const estado = await db.rpc('entrega_estado')
  if (estado.error) {
    add('Migración 20261021120200_cron.sql', 'aviso', 'no se puede mirar sin entrega_estado() (de 20261021130000_licencias_a_mano.sql)', `Aplicar las migraciones y comprobar las tareas en Database > Cron`)
  } else {
    const state = (estado.data ?? {}) as { cron?: { nombre: string; activa: boolean }[] | null; vault?: string[] | null; extensiones?: string[] }
    const extensions = state.extensiones ?? []
    const noExt = ['pg_cron', 'pg_net'].filter((e) => !extensions.includes(e))
    add('Extensiones pg_cron y pg_net', noExt.length ? 'falta' : 'ok', noExt.length ? `sin activar: ${noExt.join(', ')}` : 'activas', 'Database > Extensions')
    if (state.cron === null || state.cron === undefined) add('Tareas de pg_cron', 'aviso', 'no se pudieron leer', 'Mirarlas en Database > Cron')
    else {
      const off = CRON_JOBS.filter((name) => !state.cron!.some((j) => j.nombre === name && j.activa))
      add('Tareas de pg_cron (cola cada minuto, conciliación diaria, borrados)', off.length ? 'falta' : 'ok', off.length ? `faltan o están paradas: ${off.join(', ')}` : `${CRON_JOBS.length} activas`, `Aplicar 20261021120200_cron.sql (${GUIDE}, 3.1, paso 3)`)
    }
    if (state.vault === null || state.vault === undefined) add('Secretos de Vault', 'aviso', 'no se pudieron leer', `${GUIDE}, 3.1, paso 4`)
    else {
      const noVault = ['entrega_site_url', 'entrega_jobs_secret'].filter((n) => !state.vault!.includes(n))
      add('Secretos de Vault (para que pg_cron llame a la web)', noVault.length ? 'falta' : 'ok', noVault.length ? `faltan: ${noVault.join(', ')} (sin ellos la cola no se reintenta sola)` : 'los dos están (sus valores no se leen)', `${GUIDE}, 3.1, paso 4`)
    }
  }

  for (const bucket of ['releases', 'customer-files']) {
    const { data, error } = await db.storage.getBucket(bucket)
    if (error || !data) add(`Bucket ${bucket}`, 'falta', `no existe: ${error?.message ?? ''}`, 'Aplicar 20261021120100_almacen.sql')
    else add(`Bucket ${bucket}`, data.public ? 'falta' : 'ok', data.public ? 'es PÚBLICO: cualquiera bajaría las facturas o las versiones' : 'privado', 'Storage: quitarle «Public bucket»')
  }

  // El acceso con codigo: lo que dice Supabase Auth en publico (/auth/v1/settings).
  try {
    const settings = await requestJson<{ external?: { email?: boolean }; disable_signup?: boolean; mailer_autoconfirm?: boolean }>('Supabase Auth', `${url}/auth/v1/settings`, {
      headers: { apikey: env.SUPABASE_ANON_KEY! },
    })
    add('Acceso con correo', settings.external?.email ? 'ok' : 'falta', settings.external?.email ? 'activo (la clave publicable vale)' : 'el proveedor Email está apagado', `${GUIDE}, 3.1, paso 6`)
    add('Altas libres apagadas', settings.disable_signup ? 'ok' : 'falta', settings.disable_signup ? 'solo las compras crean cuentas' : '«Allow new users to sign up» está encendido', `${GUIDE}, 3.1, paso 6`)
    if (settings.mailer_autoconfirm) add('Confirm email', 'falta', 'apagado: un cambio de correo sin confirmar podría heredar altas', `${GUIDE}, 3.1, paso 6`)
  } catch (error) {
    add('Acceso con correo', 'falta', `Supabase Auth no contesta con la clave publicable: ${errorMessage(error)}`, `${GUIDE}, 3.1, paso 2 (SUPABASE_ANON_KEY)`)
  }

  // Lo que hay en la cola: pasos parados y licencias a mano sin firmar.
  const dead = await db.from('jobs').select('key', { count: 'exact', head: true }).eq('status', 'dead')
  if (!dead.error) add('Pasos parados en la cola', (dead.count ?? 0) > 0 ? 'aviso' : 'ok', `${dead.count ?? 0}`, 'GET /api/admin/jobs?status=dead')
  if (config.licenseMode === 'manual') {
    const cutoff = new Date(Date.now() - config.licensePendingAlertHours * 3600_000).toISOString()
    const late = await db.from('license_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending').lt('created_at', cutoff)
    if (!late.error) add(`Licencias a mano sin firmar desde hace más de ${config.licensePendingAlertHours} h`, (late.count ?? 0) > 0 ? 'aviso' : 'ok', `${late.count ?? 0}`, 'scripts/subir-licencia.mts --pendientes')
  }
}

// --- Stripe ------------------------------------------------------------------------------------

async function checkStripe(env: Env, config: DeliveryConfig, expectLive: boolean, add: Add) {
  const stripe = new Stripe(env.STRIPE_SECRET_KEY!.trim(), { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 1, timeout: 20_000 })
  const balance = await stripe.balance.retrieve()
  add('Clave', balance.livemode === expectLive ? 'ok' : 'falta', `vale, ${balance.livemode ? 'en vivo' : 'de prueba'}`, `${GUIDE}, 3.4`)

  const webhookUrl = `${(env.NEXT_PUBLIC_SITE_URL || config.siteUrl).replace(/\/+$/, '')}/api/stripe/webhook`
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 })
  // En Preview la direccion lleva ?x-vercel-protection-bypass=...: cuenta la ruta, no el secreto.
  const endpoint = endpoints.data.find((e) => e.url.split('?')[0] === webhookUrl)
  if (!endpoint) add('Webhook', 'falta', `no hay endpoint para ${webhookUrl}`, `node --env-file=<produccion> scripts/stripe-setup.mts --live --webhook ${webhookUrl}`)
  else {
    const events = endpoint.enabled_events as string[]
    const missing = WEBHOOK_EVENTS.filter((e) => !events.includes(e) && !events.includes('*'))
    add('Webhook', endpoint.status === 'enabled' && !missing.length ? 'ok' : 'falta', endpoint.status !== 'enabled' ? `${webhookUrl}: desactivado` : missing.length ? `le faltan avisos: ${missing.join(', ')}` : `${webhookUrl}, con los ${WEBHOOK_EVENTS.length} avisos`, 'scripts/stripe-setup.mts --webhook <url> (pone los avisos al día)')
    add('Secreto del webhook', 'info', 'no se puede comprobar desde aquí: si Stripe dice 400 al mandar avisos, STRIPE_WEBHOOK_SECRET no es el de este endpoint')
  }

  const tax = await stripe.tax.settings.retrieve()
  add('Stripe Tax', tax.status === 'active' ? 'ok' : 'falta', tax.status === 'active' ? 'activo' : `sin activar (${tax.status})`, `${GUIDE}, 3.4, paso 3`)
  const registrations = await stripe.tax.registrations.list({ status: 'active', limit: 100 })
  const spain = registrations.data.some((r) => r.country === 'ES')
  add('Registro del IVA de España en Stripe Tax', spain ? 'ok' : 'falta', spain ? 'activo' : 'no está', `${GUIDE}, 3.4, paso 3`)

  const products: ProductId[] = [...modalities.map((m) => m.id), ...plans.map((p) => `plan-${p.id}` as const)]
  const prices = await stripe.prices.list({ lookup_keys: products.map(lookupKey), active: true, limit: 100, expand: ['data.currency_options'] })
  for (const product of products) {
    const price = prices.data.find((p) => p.lookup_key === lookupKey(product))
    const want = priceCents(product).list
    const recurring = product.startsWith('plan-')
    if (!price) add(`Precio ${lookupKey(product)}`, 'falta', 'no está', 'scripts/stripe-setup.mts')
    else {
      const wrong = [
        price.unit_amount !== want ? `cuesta ${price.unit_amount} y la oferta dice ${want} (céntimos)` : null,
        price.currency !== 'eur' ? `en ${price.currency}` : null,
        Boolean(price.recurring) !== recurring ? (recurring ? 'no es mensual' : 'es recurrente') : null,
        price.tax_behavior !== 'exclusive' ? 'con el IVA dentro (tiene que ser exclusive)' : null,
      ].filter(Boolean)
      add(`Precio ${lookupKey(product)}`, wrong.length ? 'falta' : 'ok', wrong.length ? wrong.join('; ') : `${want / 100} € sin IVA${price.currency_options?.usd ? ' (y en USD)' : ''}`, 'scripts/stripe-setup.mts')
    }
  }
  for (const m of modalities) {
    const id = launchCouponId(m.id)
    const cents = priceCents(m.id)
    try {
      const coupon = await stripe.coupons.retrieve(id)
      const wrong = coupon.amount_off !== cents.list - (cents.launch ?? cents.list) ? `descuenta ${coupon.amount_off} y la oferta ${cents.list - (cents.launch ?? cents.list)}` : !coupon.valid ? 'ya no vale (gastado o caducado)' : null
      add(`Cupón ${id}`, wrong ? 'falta' : 'ok', wrong ?? `${coupon.times_redeemed} de ${coupon.max_redemptions ?? '∞'} usados`, 'scripts/stripe-setup.mts')
    } catch (error) {
      add(`Cupón ${id}`, 'falta', `no está (${errorMessage(error)})`, 'scripts/stripe-setup.mts')
    }
  }
  const portals = await stripe.billingPortal.configurations.list({ limit: 100 })
  const portal = portals.data.find((c) => c.metadata?.cerebro === 'portal')
  add('Portal de cliente', portal?.active ? 'ok' : 'falta', portal ? (portal.active ? 'configurado' : 'desactivado') : 'no está', 'scripts/stripe-setup.mts')
}

// --- Brevo, Holded, Cal.com y KMS ---------------------------------------------------------------

async function checkBrevo(env: Env, config: DeliveryConfig, add: Add) {
  const headers = { 'api-key': env.BREVO_API_KEY!.trim() }
  await requestJson('Brevo', 'https://api.brevo.com/v3/account', { headers })
  add('Clave', 'ok', 'vale')
  const from = config.fromEmail.toLowerCase()
  const senders = await requestJson<{ senders?: { email: string; active?: boolean }[] }>('Brevo', 'https://api.brevo.com/v3/senders', { headers })
  const sender = senders.senders?.find((s) => s.email.toLowerCase() === from)
  add(`Remitente ${from}`, sender?.active ? 'ok' : 'falta', sender ? (sender.active ? 'verificado' : 'sin verificar') : 'no está en Brevo', `${GUIDE}, 3.2, paso 3 (o DELIVERY_FROM_EMAIL con uno verificado)`)
  try {
    const domains = await requestJson<{ domains?: { domain_name: string; authenticated?: boolean }[] }>('Brevo', 'https://api.brevo.com/v3/senders/domains', { headers })
    const domain = domains.domains?.find((x) => x.domain_name.toLowerCase() === from.split('@')[1])
    add(`Dominio ${from.split('@')[1]}`, domain?.authenticated ? 'ok' : 'falta', domain ? (domain.authenticated ? 'autenticado (DKIM, DMARC)' : 'sin autenticar: los correos irían a spam') : 'no está en Brevo', `${GUIDE}, 3.2, paso 2`)
  } catch (error) {
    add('Dominio', 'aviso', `no se pudo comprobar: ${errorMessage(error)}`, `${GUIDE}, 3.2, paso 2`)
  }
}

async function checkHolded(env: Env, add: Add) {
  const base = (env.HOLDED_API_URL || 'https://api.holded.com/api/v2').replace(/\/+$/, '')
  const headers = { Authorization: `Bearer ${env.HOLDED_API_KEY!.trim()}` }
  const taxes = JSON.stringify(await requestJson<unknown>('Holded', `${base}/taxes`, { headers }))
  add('Clave', 'ok', 'vale')
  for (const [what, path] of [['facturas', 'invoices'], ['contactos', 'contacts']]) {
    try {
      await requestJson('Holded', `${base}/${path}?limit=1`, { headers })
      add(`Permiso de ${what}`, 'ok', 'puede leer')
    } catch (error) {
      add(`Permiso de ${what}`, 'falta', errorMessage(error), `${GUIDE}, 3.5, paso 1`)
    }
  }
  for (const [name, fallback, what] of [
    ['HOLDED_TAX_STANDARD', 's_iva_21', 'IVA del 21 %'],
    ['HOLDED_TAX_REVERSE_CHARGE', '', 'inversión del sujeto pasivo'],
    ['HOLDED_TAX_EXPORT', '', 'fuera de la UE'],
    ['HOLDED_TAX_EXEMPT', '', 'exento'],
  ]) {
    const id = env[name]?.trim() || fallback
    if (!id) continue // ya avisado en las variables (o no hace falta: exento)
    add(`Impuesto ${what} (${name})`, taxes.includes(`"${id}"`) ? 'ok' : 'aviso', taxes.includes(`"${id}"`) ? 'está en la cuenta' : `«${id}» no aparece en /taxes de la cuenta`, `${GUIDE}, 3.5, paso 2`)
  }
}

async function checkCalcom(env: Env, add: Add, now: Date) {
  const calendar = new CalcomCalendar(env)
  const from = new Date(now.getTime() + 24 * 3600_000).toISOString()
  const to = new Date(now.getTime() + 15 * 24 * 3600_000).toISOString()
  const slots = await calendar.availability(from, to)
  for (const host of SESSION_HOSTS) {
    const count = slots.filter((s) => s.host === host.id).length
    add(`Huecos de ${host.name}`, count ? 'ok' : 'aviso', count ? `${count} en las dos próximas semanas` : 'ninguno en las dos próximas semanas: revisar su horario', `${GUIDE}, 3.6`)
  }
}

async function checkKms(env: Env, config: DeliveryConfig, add: Add) {
  const signer = new GcpKmsSigner(env)
  const publicKey = await signer.publicKey()
  add('Clave de KMS', publicKey === config.licensePublicKey ? 'ok' : 'falta', publicKey === config.licensePublicKey ? 'contesta y su publica es LICENSE_WEB_PUBLIC_KEY' : 'su publica no es LICENSE_WEB_PUBLIC_KEY: la web no firmaría', 'scripts/clave-web-publica.mts')
}

// --- La web publicada -----------------------------------------------------------------------------

async function checkSite(env: Env, config: DeliveryConfig, add: Add) {
  const site = (env.NEXT_PUBLIC_SITE_URL || config.siteUrl).replace(/\/+$/, '')
  const get = async (path: string) => {
    // Una Preview protegida: Vercel le da el secreto de bypass como variable de sistema.
    const bypass = env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim()
    const headers: Record<string, string> = bypass ? { 'x-vercel-protection-bypass': bypass } : {}
    const res = await fetch(`${site}${path}`, { cache: 'no-store', redirect: 'follow', headers, signal: AbortSignal.timeout(20_000) })
    return { status: res.status, text: await res.text() }
  }
  const me = await get('/api/zone/me?perfil=1')
  let available = false
  try {
    available = me.status === 200 && (JSON.parse(me.text) as { available?: boolean }).available === true
  } catch {
    // no era JSON: una web sin la ruta (o la de otro sitio)
  }
  add('Zona de socio', available ? 'ok' : 'falta', available ? `${site}/zona contesta` : 'la web publicada dice que la zona no está montada', 'Supabase y DELIVERY_IP_SALT en Production, y volver a desplegar')
  const home = await get('/')
  const login = home.text.includes('href="/zona/entrar"')
  add('Botón Entrar', login ? 'ok' : 'falta', login ? 'en la barra de arriba' : 'la portada publicada no lo tiene (se hizo antes de poner Supabase)', 'Volver a desplegar en Vercel (Redeploy): las páginas se hacen al desplegar')
  const pricing = await get('/precios')
  const buttons = pricing.text.includes('action="/api/checkout"')
  const open = env.CHECKOUT_OPEN === 'true'
  if (buttons !== open) {
    add('Botones de compra', open ? 'falta' : 'aviso', open ? 'CHECKOUT_OPEN=true pero /precios sigue con «Próximamente»' : '/precios enseña los botones con CHECKOUT_OPEN=false', 'Volver a desplegar en Vercel (Redeploy) tras cambiar CHECKOUT_OPEN')
  } else add('Botones de compra', 'ok', open ? 'en /precios' : 'escondidos en /precios (venta cerrada)')
}

// --- Todo ----------------------------------------------------------------------------------------

const MANUAL: [string, string][] = [
  ['Supabase: SMTP de Brevo, plantilla «Magic Link» con {{ .Token }}, código de 8 cifras y 10 minutos', `${GUIDE}, 3.1, paso 6`],
  ['Supabase: «IP address forwarding» y el límite de correos subido', `${GUIDE}, 3.1, paso 7`],
  ['Supabase: plan Pro (el gratuito se pausa y no tiene copias)', `${GUIDE}, 3.1, paso 1`],
  ['Stripe: la URL de las condiciones y de la privacidad en Public details (la pide la casilla del pago)', `${GUIDE}, 3.4, paso 2`],
  ['Holded: Verifactu activo; las facturas quedan en borrador hasta confirmar que aprobar por la API lo registra', `${GUIDE}, 3.5`],
  ['Cal.com: los dos eventos sin «requiere confirmación», con videollamada', `${GUIDE}, 3.6`],
  ['Vercel: región fra1 y los secretos de producción Sensitive y solo en Production', `${GUIDE}, 3.7`],
]

/**
 * Comprueba el entorno dado (el de produccion). expectLive false: un entorno de pruebas (Stripe de
 * prueba, clave de pruebas para las licencias a mano). checkSite: mira tambien la web publicada.
 */
export async function productionCheck(env: Env, options: { expectLive?: boolean; checkSite?: boolean; now?: Date } = {}): Promise<HealthReport> {
  const expectLive = options.expectLive ?? true
  const now = options.now ?? new Date()
  const { config, checks: modes } = checkModes(env, expectLive)
  const has = (...names: string[]) => names.every((n) => env[n]?.trim())
  const skip = (area: string, names: string[]) => Promise.resolve<Check[]>([{ area, item: 'Sin comprobar', status: 'falta', detail: `faltan ${names.filter((n) => !env[n]?.trim()).join(', ')}` }])
  const sections: Promise<Check[]>[] = [modes]
  if (config) {
    sections.push(
      has('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY')
        ? section('Supabase', env, (add) => checkSupabase(env, config, add), `${GUIDE}, 3.1`)
        : skip('Supabase', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']),
      has('STRIPE_SECRET_KEY') ? section('Stripe', env, (add) => checkStripe(env, config, expectLive, add), `${GUIDE}, 3.4`) : skip('Stripe', ['STRIPE_SECRET_KEY']),
      has('BREVO_API_KEY') ? section('Brevo', env, (add) => checkBrevo(env, config, add), `${GUIDE}, 3.2`) : skip('Brevo', ['BREVO_API_KEY']),
      has('HOLDED_API_KEY') ? section('Holded', env, (add) => checkHolded(env, add), `${GUIDE}, 3.5`) : skip('Holded', ['HOLDED_API_KEY']),
      has('CALCOM_API_KEY', 'CALCOM_EVENT_TYPES') ? section('Cal.com', env, (add) => checkCalcom(env, add, now), `${GUIDE}, 3.6`) : skip('Cal.com', ['CALCOM_API_KEY', 'CALCOM_EVENT_TYPES'])
    )
    if (config.licenseMode === 'kms') {
      sections.push(has('GCP_KMS_KEY_VERSION', 'GOOGLE_SERVICE_ACCOUNT_JSON') ? section('Google Cloud KMS', env, (add) => checkKms(env, config, add), `${GUIDE}, 3.3`) : skip('Google Cloud KMS', ['GCP_KMS_KEY_VERSION', 'GOOGLE_SERVICE_ACCOUNT_JSON']))
    }
    if (options.checkSite) sections.push(section('La web publicada', env, (add) => checkSite(env, config, add), 'Comprobar que la web está desplegada en NEXT_PUBLIC_SITE_URL'))
  }
  const checks = (await Promise.all(sections)).flat()
  for (const [item, fix] of MANUAL) checks.push({ area: 'A mano (no se ve desde aquí)', item, status: 'info', fix })

  const missing = checks.some((c) => c.status === 'falta')
  const open = env.CHECKOUT_OPEN === 'true'
  checks.push(
    open && missing
      ? { area: 'Venta', item: 'CHECKOUT_OPEN', status: 'falta', detail: 'la venta está ABIERTA y falta lo de arriba', fix: 'CHECKOUT_OPEN=false (y volver a desplegar) hasta arreglarlo' }
      : { area: 'Venta', item: 'CHECKOUT_OPEN', status: 'info', detail: open ? 'abierta' : missing ? 'cerrada: arreglar primero lo que falta' : 'cerrada, y todo listo: una compra de prueba y después CHECKOUT_OPEN=true en Production (y volver a desplegar)' }
  )
  const summary: Record<CheckStatus, number> = { ok: 0, falta: 0, aviso: 0, info: 0 }
  for (const check of checks) summary[check.status] += 1
  return { generatedAt: now.toISOString(), expectLive, ready: summary.falta === 0, summary, checks }
}

/** El informe en texto, para la terminal: por areas, lo que falta con como arreglarlo. */
export function formatReport(report: HealthReport): string {
  const label: Record<CheckStatus, string> = { ok: 'ok   ', falta: 'FALTA', aviso: 'aviso', info: '·    ' }
  const lines = [`Comprobación de ${report.expectLive ? 'producción' : 'un entorno de pruebas'} · ${report.generatedAt.slice(0, 16).replace('T', ' ')} UTC`]
  let area = ''
  for (const check of report.checks) {
    if (check.area !== area) {
      area = check.area
      lines.push('', area)
    }
    lines.push(`  ${label[check.status]}  ${check.item}${check.detail ? `: ${check.detail}` : ''}`)
    if (check.fix && check.status !== 'ok') lines.push(`         -> ${check.fix}`)
  }
  const { ok, falta, aviso } = report.summary
  lines.push(
    '',
    `Resumen: ${ok} ok, ${aviso} aviso(s), ${falta} que falta(n). ${report.ready ? 'Listo para vender (repasa los avisos y lo que va a mano).' : 'NO está listo para vender: arreglar lo que dice FALTA.'}`
  )
  return lines.join('\n')
}
