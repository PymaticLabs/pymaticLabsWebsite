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
import { ViesChecker } from './adapters/vies-checker.ts'
import { requestJson } from './adapters/http.ts'
import { compareVersions } from './adapters/memory-repository.ts'
import { isSpainTaxRate } from './adapters/stripe-payments.ts'
import { readConfig, type DeliveryConfig } from './config.ts'
import { SESSION_HOSTS, WEBHOOK_EVENTS, launchCouponId, lookupKey, priceCents, productName, type PlanPeriod, type ProductId } from './products.ts'
import { SupabaseRepository } from './adapters/supabase-repository.ts'
import { SPAIN_VAT_RATE, TAX_RATE_TAG } from './tax.ts'
import { EU_NO_VAT_STOP, euNoVatLevel, euNoVatSales, type EuNoVatTotals } from './eu-sales.ts'
import { errorMessage, formatMoney } from './util.ts'
import { PYMATICLABS_VAT_ID, viesRequester } from './vies.ts'

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

/**
 * Los impuestos de Holded de las ventas sin IVA, exactos: s_iva_intras (inversion del sujeto pasivo
 * a la UE: casilla 59 del 303, modelo 349, N2 en Verifactu) y s_iva_nosujeto (no sujeta por reglas de
 * localizacion: casilla 120).
 */
export const HOLDED_TAXES = { reverse_charge: 's_iva_intras', export: 's_iva_nosujeto' } as const

// Por que no vale cada uno de los que se confunden con ellos.
const WRONG_HOLDED_TAXES: Record<string, string> = {
  s_iva_invsuj: 'la inversión del sujeto pasivo interior: iría como S2 a la casilla 122 del 303 y se quedaría fuera del 349',
  s_iva_export: 'la exportación exenta: iría a la casilla 60 del 303 y a Verifactu con la clave 02, que exige una operación exenta',
  s_iva_exento: 'una operación exenta: estas ventas no están exentas, sino no sujetas por reglas de localización',
  s_iva_intras: 'el de las ventas a empresas de la UE con NIF-IVA (casilla 59 del 303 y modelo 349)',
  s_iva_nosujeto: 'el de las ventas no sujetas de Canarias, Ceuta, Melilla y fuera de la UE (casilla 120 del 303, sin 349)',
}

/** Lo que no vale del impuesto de Holded puesto para ese caso (null si es el bueno). */
export function wrongHoldedTax(value: string, treatment: keyof typeof HOLDED_TAXES): string | null {
  const want = HOLDED_TAXES[treatment]
  if (value === want) return null
  const why = Object.hasOwn(WRONG_HOLDED_TAXES, value) ? WRONG_HOLDED_TAXES[value] : 'no es el de este caso'
  return `es ${value}, ${why}: tiene que ser ${want}`
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
    // Los impuestos de Holded de las ventas sin IVA: sin ellos, esas facturas no se crean (holded-invoicer.ts);
    // con otro, irian a otra casilla del 303 y a Verifactu con otra clave (revision fiscal, 30-10-2026).
    {
      name: 'HOLDED_TAX_REVERSE_CHARGE',
      what: 'el impuesto de Holded de la inversión del sujeto pasivo (UE con NIF-IVA)',
      fix: `HOLDED_TAX_REVERSE_CHARGE=${HOLDED_TAXES.reverse_charge} (${GUIDE}, 3.5, paso 2)`,
      invalid: (v) => wrongHoldedTax(v, 'reverse_charge'),
    },
    {
      name: 'HOLDED_TAX_EXPORT',
      what: 'el impuesto de Holded de las ventas sin IVA español (fuera de la UE, Canarias, Ceuta y Melilla)',
      fix: `HOLDED_TAX_EXPORT=${HOLDED_TAXES.export} (${GUIDE}, 3.5, paso 2)`,
      invalid: (v) => wrongHoldedTax(v, 'export'),
    },
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

async function checkSupabase(env: Env, config: DeliveryConfig, expectLive: boolean, now: Date, add: Add) {
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

  // Lo que se descarga: la bienvenida promete las descargas para Mac y Windows en la zona.
  const versions = await db.from('versions').select('id')
  if (!versions.error) {
    const latest = ((versions.data ?? []) as { id: string }[]).map((v) => v.id).sort((a, b) => compareVersions(b, a))[0]
    const files = latest ? await db.from('version_files').select('kind').eq('version_id', latest).eq('team_only', false) : null
    const kinds = new Set(((files?.data ?? []) as { kind: string }[]).map((f) => f.kind))
    const lacking = ['mac', 'windows'].filter((k) => !kinds.has(k))
    const detail = !latest ? 'ninguna: el primer cliente no tendría nada que instalar' : lacking.length ? `la ${latest} no tiene para ${lacking.join(' ni ')}` : `la ${latest}, para Mac y Windows`
    add('Versión publicada (las descargas de la zona)', latest && !lacking.length ? 'ok' : 'falta', detail, `scripts/publicar-version.mts --sin-aviso (${GUIDE}, sección 0)`)
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
  await checkEuDistanceSales(env, expectLive, now, add)
}

/**
 * Las ventas con el 21 % a empresas de otros paises de la UE sin NIF-IVA: como a particulares, con
 * IVA espanol mientras no pasen de 10.000 euros al ano, este o el anterior (arts. 70.Uno.8.o y 73
 * LIVA). Sumadas igual que en el pago y en el aviso de cada venta (lib/delivery/eu-sales.ts, con el
 * repositorio de Supabase): de todas las compras, tambien las que esperan revision ya cobradas. Desde
 * 8.000 euros este ano (o con el anterior por encima del limite) el pago ya no abre ventas asi, pero
 * los mensuales que ya hay siguen con el 21 %: aviso, para hablarlo con Manel. Solo las de vivo (o las
 * de prueba, en un entorno de pruebas).
 */
async function checkEuDistanceSales(env: Env, expectLive: boolean, now: Date, add: Add) {
  const item = 'Ventas con el 21 % a la UE sin NIF-IVA (límite de 10.000 € al año)'
  let totals: EuNoVatTotals
  try {
    totals = await euNoVatSales(new SupabaseRepository(env), now, expectLive)
  } catch (error) {
    add(item, 'aviso', `no se pudieron sumar: ${errorMessage(error)}`, 'Mirarlas en Supabase (purchases con tax_treatment standard y la empresa, o lo declarado, de otro país de la UE)')
    return
  }
  const level = euNoVatLevel(totals)
  const detail = `${formatMoney(totals.current, 'eur', 'es')} este año y ${formatMoney(totals.previous, 'eur', 'es')} el anterior, sin IVA`
  const why =
    level === 'over'
      ? `${detail}: pasado el límite, el IVA es el del país del cliente (ventanilla única, OSS); la web ya no abre pagos así, pero los mensuales que ya hay siguen cobrando el 21 % español`
      : level === 'stop'
        ? `${detail}: desde ${formatMoney(EU_NO_VAT_STOP, 'eur', 'es')} la web ya no abre pagos así (piden escribir a info@pymaticlabs.com), pero los mensuales que ya hay siguen cobrando el 21 % español`
        : null
  add(item, why ? 'aviso' : 'ok', why ?? detail, 'Hablarlo con Manel antes de pasar de 10.000 € (alta en la ventanilla única, modelo 035)')
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

  // El IVA de las ventas con IVA es un tipo fijo del 21 % (sin Stripe Tax): el de stripe-setup, activo y sin IVA dentro.
  const rates = await stripe.taxRates.list({ limit: 100 })
  const rate = rates.data.find(isSpainTaxRate)
  const tagged = rates.data.filter((r) => r.metadata?.cerebro === TAX_RATE_TAG)
  add(
    `Tipo de IVA del ${SPAIN_VAT_RATE} %`,
    rate ? 'ok' : 'falta',
    rate
      ? `${rate.id}, activo, sin IVA dentro`
      : tagged.length
        ? `el de cerebro=${TAX_RATE_TAG} no vale: ${tagged.map((r) => `${r.percentage} %${r.inclusive ? ', IVA dentro' : ''}${r.active ? '' : ', archivado'}`).join('; ')}`
        : `no está (metadata cerebro=${TAX_RATE_TAG}): sin él no se abre ningún pago con IVA`,
    'scripts/stripe-setup.mts (lo crea si falta)'
  )

  // El pago unico y el mensual, al mes y por ano adelantado (el del ano, en el producto del plan: el
  // portal cambia entre los dos). Stripe da como mucho 10 lookup_keys por consulta: van por separado.
  const wanted: { product: ProductId; period: PlanPeriod | null }[] = [
    ...modalities.map((m) => ({ product: m.id, period: null })),
    ...plans.flatMap((p) => (['month', 'year'] as const).map((period) => ({ product: `plan-${p.id}` as const, period }))),
  ]
  const keyOf = (w: { product: ProductId; period: PlanPeriod | null }) => lookupKey(w.product, w.period ?? 'month')
  const prices: Stripe.Price[] = []
  for (const group of [wanted.filter((w) => !w.period), wanted.filter((w) => w.period)]) {
    // Con el producto (expand): su nombre es el que ve el cliente en la pagina de pago.
    prices.push(...(await stripe.prices.list({ lookup_keys: group.map(keyOf), active: true, limit: 100, expand: ['data.product'] })).data)
  }
  const productOf = (price: Stripe.Price) => (typeof price.product === 'string' ? price.product : price.product?.id)
  for (const w of wanted) {
    const key = keyOf(w)
    const price = prices.find((p) => p.lookup_key === key)
    const want = priceCents(w.product, w.period ?? 'month').list
    if (!price) add(`Precio ${key}`, 'falta', 'no está', 'scripts/stripe-setup.mts')
    else {
      const monthly = w.period === 'year' ? prices.find((p) => p.lookup_key === lookupKey(w.product, 'month')) : null
      const wrong = [
        price.unit_amount !== want ? `cuesta ${price.unit_amount} y la oferta dice ${want} (céntimos)` : null,
        price.currency !== 'eur' ? `en ${price.currency}` : null,
        (price.recurring?.interval ?? null) !== w.period ? (w.period ? `no se cobra ${w.period === 'year' ? 'al año' : 'al mes'}` : 'es recurrente') : null,
        price.tax_behavior !== 'exclusive' ? 'con el IVA dentro (tiene que ser exclusive)' : null,
        monthly && productOf(monthly) !== productOf(price) ? 'no es del producto del plan (el del mes): el portal no cambiaría entre los dos' : null,
        // Lo renombra stripe-setup (los nombres de la web: Solista, Banda, Duo, Orquesta).
        typeof price.product === 'object' && price.product && 'name' in price.product && price.product.name !== productName(w.product, 'es')
          ? `el producto se llama «${price.product.name}» y en la web «${productName(w.product, 'es')}» (es el nombre de la página de pago)`
          : null,
      ].filter(Boolean)
      const ok = `${want / 100} € sin IVA${w.period === 'year' ? ', al año' : w.period ? ', al mes' : ''}`
      add(`Precio ${key}`, wrong.length ? 'falta' : 'ok', wrong.length ? wrong.join('; ') : ok, 'scripts/stripe-setup.mts')
    }
  }
  for (const m of modalities) {
    const id = launchCouponId(m.id)
    const cents = priceCents(m.id)
    try {
      // applies_to solo llega pedido. Tiene que ser el producto del precio de la modalidad: con otro
      // (un producto duplicado por stripe-setup), el pago con la plaza de lanzamiento no se abre o
      // sale sin el descuento.
      const coupon = await stripe.coupons.retrieve(id, { expand: ['applies_to'] })
      const off = cents.list - (cents.launch ?? cents.list)
      const price = prices.find((p) => p.lookup_key === lookupKey(m.id))
      const product = price ? productOf(price) : null
      // Un cupon no cambia de importe ni de producto: se borra y stripe-setup lo crea otra vez.
      const remake = 'borrarlo a mano en Stripe y repetir scripts/stripe-setup.mts'
      const [wrong, fix]: [string | null, string] =
        coupon.amount_off !== off
          ? [`descuenta ${coupon.amount_off} y la oferta ${off}`, remake]
          : product && !coupon.applies_to?.products.includes(product)
            ? [`no es del producto de ${lookupKey(m.id)} (${product}), sino de ${coupon.applies_to?.products.join(', ') || 'ninguno en concreto'}`, remake]
            : !coupon.valid
              ? ['ya no vale (gastado o caducado)', 'scripts/stripe-setup.mts']
              : [null, 'scripts/stripe-setup.mts']
      add(`Cupón ${id}`, wrong ? 'falta' : 'ok', wrong ?? `${coupon.times_redeemed} de ${coupon.max_redemptions ?? '∞'} usados`, fix)
    } catch (error) {
      add(`Cupón ${id}`, 'falta', `no está (${errorMessage(error)})`, 'scripts/stripe-setup.mts')
    }
  }
  // Los productos del portal solo llegan si se piden (expand), como el applies_to de los cupones.
  const portals = await stripe.billingPortal.configurations.list({ limit: 100, expand: ['data.features.subscription_update.products'] })
  const portal = portals.data.find((c) => c.metadata?.cerebro === 'portal')
  if (!portal?.active) add('Portal de cliente', 'falta', portal ? 'desactivado' : 'no está', 'scripts/stripe-setup.mts')
  else {
    // Cambiar de plan y entre pago mensual y anual; subir, cobrado al momento (always_invoice); bajar o
    // pasar a mensual, al final del periodo pagado (los periodos empezados no se devuelven: clausula 5).
    // Con meses incluidos, ningun cambio los acaba (continue_trial: los socios, 27-10-2026).
    const update = portal.features?.subscription_update
    const offered = new Set((update?.products ?? []).flatMap((p) => p.prices))
    const missing = prices.filter((p) => p.recurring && !offered.has(p.id)).map((p) => p.lookup_key)
    const scheduled = (update?.schedule_at_period_end?.conditions ?? []).map((c) => c.type)
    const wrong = [
      !update?.enabled ? 'no deja cambiar de plan' : null,
      update?.enabled && missing.length ? `no deja cambiar a ${missing.join(', ')}` : null,
      // Cada suscripcion es una empresa y un plan: con la cantidad, el cliente pagaria el plan dos veces.
      update?.enabled && (update.products ?? []).some((p) => p.adjustable_quantity?.enabled)
        ? 'deja cambiar la cantidad (tiene que ser siempre 1)'
        : null,
      update?.enabled && !(scheduled.includes('decreasing_item_amount') && scheduled.includes('shortening_interval'))
        ? 'bajar de plan o pasar de anual a mensual se aplica al momento, con abono (tiene que esperar al final del periodo pagado)'
        : null,
      // Con create_prorations, la diferencia de subir de plan espera a la renovacion (en el anual, hasta un ano).
      update?.enabled && update.proration_behavior !== 'always_invoice'
        ? `subir de plan no se cobra al momento (proration_behavior ${update.proration_behavior ?? 'sin poner'}: tiene que ser always_invoice)`
        : null,
      // Sin decirlo, end_trial: pasar a anual o a un plan mayor con meses incluidos los acaba y se cobra ese dia.
      update?.enabled && update.trial_update_behavior !== 'continue_trial'
        ? `con meses incluidos, cambiar de plan o pasar a anual los acaba y se cobra ese día (trial_update_behavior ${update.trial_update_behavior ?? 'sin poner'}: tiene que ser continue_trial)`
        : null,
    ].filter(Boolean)
    add('Portal de cliente', wrong.length ? 'falta' : 'ok', wrong.length ? wrong.join('; ') : 'configurado, con el pago mensual y el anual de cada plan', 'scripts/stripe-setup.mts (lo pone al día)')
  }
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
  // Los de las ventas de la web: el 21 %, la inversion del sujeto pasivo (UE con NIF-IVA) y sin IVA
  // espanol (fuera de la UE, Canarias, Ceuta y Melilla); el exento, si esta puesto. Si falta la
  // variable, ya sale arriba (Modos y variables).
  for (const [name, fallback, what] of [
    ['HOLDED_TAX_STANDARD', 's_iva_21', 'IVA del 21 %'],
    ['HOLDED_TAX_REVERSE_CHARGE', '', 'inversión del sujeto pasivo'],
    ['HOLDED_TAX_EXPORT', '', 'sin IVA español'],
    ['HOLDED_TAX_EXEMPT', '', 'exento'],
  ]) {
    const id = env[name]?.trim() || fallback
    if (!id) continue // no hace falta
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

// --- VIES -----------------------------------------------------------------------------------------

/**
 * Que VIES contesta con el NIF-IVA de PymaticLabs (VIES_REQUESTER): el que pregunta en cada venta sin
 * IVA a la UE. No valido, o VIES sin aceptarlo como solicitante: falta (esas ventas no se abririan).
 * VIES caido ahora: aviso (le pasa a ratos; las ventas esperan a que vuelva). Siempre al VIES de
 * verdad: el servicio de prueba (VIES_TEST_SERVICE, solo fuera de produccion) contesta por el numero
 * y no diria nada del nuestro; con el puesto, aviso.
 */
async function checkVies(env: Env, config: DeliveryConfig, add: Add) {
  const own = config.vies.requester
  const { memberState, number } = viesRequester(own)
  if (config.vies.testService) {
    add('Servicio de prueba de VIES (VIES_TEST_SERVICE)', 'aviso', 'las ventas preguntan al servicio de prueba de VIES, que no comprueba ningún NIF-IVA (100 es válido, 200 no)', 'Solo en Preview: quitarlo en cualquier otro sitio')
  }
  const result = await new ViesChecker(env, { ...config.vies, testService: false }).check({ countryCode: memberState, vatNumber: number })
  const item = `NIF-IVA de PymaticLabs (${own})`
  const fix = 'VIES_REQUESTER con el NIF-IVA de PymaticLabs, de alta en el ROI (o sin poner: ESB88781745)'
  // Va impreso como «NIF-IVA del proveedor» en las facturas con inversion del sujeto pasivo, que no se
  // corrigen una vez aprobadas: en vivo, solo el de PymaticLabs.
  if (config.stripeLive && own !== PYMATICLABS_VAT_ID) {
    add(item, 'falta', `no es el NIF-IVA de PymaticLabs (${PYMATICLABS_VAT_ID}): saldría impreso como el del proveedor en las facturas con inversión del sujeto pasivo`, fix)
    return
  }
  if (result.status === 'valid') add(item, 'ok', `válido en VIES (consulta ${result.requestIdentifier})`)
  else if (result.status === 'invalid') add(item, 'falta', 'VIES dice que no es válido: sin él no se puede vender sin IVA a empresas de la UE', fix)
  else if (/INVALID_REQUESTER_INFO|requestIdentifier/.test(result.reason)) add(item, 'falta', `VIES no lo acepta como solicitante (${result.reason}): las ventas sin IVA a la UE no se abrirían`, fix)
  else add(item, 'aviso', `VIES no contesta ahora (${result.reason}): mientras, las empresas de la UE con NIF-IVA no pueden pagar`, 'Repetir la comprobación en unos minutos')
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
  // Los botones llevan a /comprar/<modalidad> (que pide el NIF); en versiones de antes, el formulario al pago.
  const buttons = pricing.text.includes('action="/api/checkout"') || pricing.text.includes('href="/comprar/')
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
  ['Stripe: cobros del mensual fallidos, con reintentos durante 3 semanas (más de los 15 días del aviso) y, al acabar, la suscripción marcada como impagada', `${GUIDE}, 3.4, paso 6`],
  ['Holded: Verifactu activo; las facturas quedan en borrador hasta confirmar por escrito con Holded que aprobar por la API lo registra igual', `${GUIDE}, 3.5`],
  [
    'Holded: en Conformidad, la regla de Verifactu de cada caso (S1 en España y en la UE sin NIF-IVA; N2 en la UE con NIF-IVA, en Canarias, Ceuta y Melilla y fuera de la UE; nunca «Exportación»), mirada con «Verificar» antes de aprobar la primera de cada caso',
    `${GUIDE}, 3.5, paso 6`,
  ],
  ['Cal.com: los dos eventos sin «requiere confirmación», con videollamada', `${GUIDE}, 3.6`],
  ['Vercel: región dub1 (Dublín, junto a Supabase) y los secretos de producción Sensitive y solo en Production', `${GUIDE}, 3.7`],
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
        ? section('Supabase', env, (add) => checkSupabase(env, config, expectLive, now, add), `${GUIDE}, 3.1`)
        : skip('Supabase', ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY']),
      has('STRIPE_SECRET_KEY') ? section('Stripe', env, (add) => checkStripe(env, config, expectLive, add), `${GUIDE}, 3.4`) : skip('Stripe', ['STRIPE_SECRET_KEY']),
      has('BREVO_API_KEY') ? section('Brevo', env, (add) => checkBrevo(env, config, add), `${GUIDE}, 3.2`) : skip('Brevo', ['BREVO_API_KEY']),
      has('HOLDED_API_KEY') ? section('Holded', env, (add) => checkHolded(env, add), `${GUIDE}, 3.5`) : skip('Holded', ['HOLDED_API_KEY']),
      has('CALCOM_API_KEY', 'CALCOM_EVENT_TYPES') ? section('Cal.com', env, (add) => checkCalcom(env, add, now), `${GUIDE}, 3.6`) : skip('Cal.com', ['CALCOM_API_KEY', 'CALCOM_EVENT_TYPES']),
      section('VIES', env, (add) => checkVies(env, config, add), 'Repetir la comprobación en unos minutos')
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
