// La configuracion de la entrega, leida del entorno (ver .env.example).
//
// DELIVERY_MODE=fake monta todo con adaptadores falsos: corre sin cuentas ni red (pruebas, la
// prueba de punta a punta y la web en local). Cada adaptador se puede cambiar por separado
// (DELIVERY_REPOSITORY, DELIVERY_SIGNER, ...). En produccion nunca se monta en falso, y la firma de
// verdad (KMS) nunca se mezcla con pagos de mentira: firmaria licencias sin cobrar.

import { randomBytes } from 'node:crypto'
import { LICENSES_PUBLIC_KEY } from '../license.ts'
import { LAUNCH_CUSTOMERS } from '../offer.ts'

export type DeliveryMode = 'fake' | 'live'

/**
 * Quien firma las licencias. manual: la web no firma; pide cada licencia a Eric (correo con los
 * campos), que la firma en su Mac con la clave que el producto ya conoce y la sube
 * (scripts/subir-licencia.mts). kms: la firma la web, con su clave de KMS (en modo falso, con la
 * clave local de prueba); solo cuando el producto acepte la publica de la web.
 */
export type LicenseMode = 'manual' | 'kms'

export interface AdapterChoice {
  repository: 'memory' | 'supabase'
  signer: 'local' | 'gcp-kms'
  invoicer: 'fake' | 'holded'
  mailer: 'outbox' | 'brevo'
  storage: 'local' | 'supabase'
  calendar: 'fake' | 'calcom'
  auth: 'fake' | 'supabase'
  payments: 'fake' | 'stripe'
}

export interface JobsConfig {
  maxAttempts: number
  /** Tras cuantos fallos seguidos de un paso se avisa a PymaticLabs (y otra vez si muere). */
  alertAfter: number
  baseDelayMs: number
  maxDelayMs: number
  lockSeconds: number
  concurrency: number
}

/** Limites por IP (por /64 en IPv6) y por correo, en ventanas fijas: frenan a quien abuse sin molestar a nadie. */
export interface LimitsConfig {
  /** Pagos abiertos por IP cada 10 minutos. */
  checkoutPerIp: number
  /** Huecos de Cal.com apartados a la vez: por IP y en total (lo que dura un pago abierto). */
  holdsPerIp: number
  holdsTotal: number
  /** Codigos pedidos por IP cada 15 minutos, y por correo cada hora (de mas, no se manda nada). */
  loginPerIp: number
  loginPerEmail: number
  /** Codigos probados por IP y por correo cada 15 minutos (con el correo, 5 y se bloquea). */
  verifyPerIp: number
  verifyPerEmail: number
  /** Altas en el equipo por empresa y dia. */
  teamAddsPerDay: number
}

export interface DeliveryConfig {
  mode: DeliveryMode
  siteUrl: string
  /** Avisos de cada venta y alertas. */
  internalEmail: string
  alertEmail: string
  fromEmail: string
  fromName: string
  /**
   * emit: la factura se aprueba (Verifactu), Holded la manda y se guarda para la zona.
   * draft: queda en borrador y el aviso interno dice que hay que emitirla a mano (por defecto,
   * hasta confirmar que aprobar por la API registra en Verifactu).
   */
  invoiceMode: 'emit' | 'draft'
  /**
   * El signo de los importes de la rectificativa en Holded: -1 (lineas en negativo, por defecto) o 1
   * si la cuenta de Holded ya los resta por ser un abono. Comprobar con la primera, en borrador.
   */
  creditNoteSign: 1 | -1
  /**
   * La rectificativa, aparte: en borrador por defecto aunque las facturas se emitan solas (la API v2
   * de Holded no enlaza la factura que rectifica, y Verifactu lo pide). emit, solo tras comprobar una.
   */
  creditNoteMode: 'emit' | 'draft'
  /** Pone el pago de Stripe dentro de la licencia (campo pago): solo cuando licencia.py lo acepte. */
  licenseIncludePayment: boolean
  /** La publica que debe tener la clave de la web; si la de KMS no es esta, no se firma. */
  licensePublicKey: string | null
  /**
   * De que entorno es la clave que firma: production (la que conoce el producto) solo firma pagos de
   * Stripe en vivo; test (la local, o una clave de KMS solo de pruebas) solo pagos de prueba.
   */
  licenseKeyEnv: 'production' | 'test'
  licenseMode: LicenseMode
  /**
   * La publica con la que tienen que verificar las licencias subidas a mano: la del Mac de Eric
   * (licencias.pub) por defecto. Otra (LICENSE_MANUAL_PUBLIC_KEY) es una clave de pruebas.
   */
  manualPublicKey: string
  /** production (la del Mac de Eric) solo entrega pagos en vivo; test, solo pagos de prueba. */
  manualKeyEnv: 'production' | 'test'
  /** A quien se piden las licencias a mano (Eric o un buzon de PymaticLabs). */
  licenseRequestEmail: string
  /** Horas sin firmar tras las que una licencia pedida da aviso. */
  licensePendingAlertHours: number
  /** Si las claves de Stripe son de vivo (sk_live_), de prueba, o no se sabe (sin clave). */
  stripeLive: boolean | null
  /** La sal de las huellas de IP y de correo (HMAC): obligatoria en vivo, nunca una constante. */
  ipSalt: string
  limits: LimitsConfig
  launchLimit: number
  /** Plazas de lanzamiento abiertas a la vez desde una misma IP (frena a quien las acapare). */
  launchClientLimit: number
  /** Lo que dura un pago abierto en Stripe Checkout (el minimo de Stripe son 30). */
  checkoutMinutes: number
  /** Lo que valen los enlaces de descarga. */
  downloadTtlSeconds: number
  /** Dias hacia atras que mira la conciliacion diaria. */
  reconcileDays: number
  jobs: JobsConfig
  adapters: AdapterChoice
  /** Carpeta del modo falso (buzon, almacen): .delivery-fake por defecto. */
  fakeDir: string
}

type Env = Record<string, string | undefined>

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T, name: string): T {
  if (!value) return fallback
  if (!(allowed as readonly string[]).includes(value)) throw new Error(`${name}=${value}: tiene que ser ${allowed.join(' o ')}`)
  return value as T
}

/**
 * Sin LICENSE_MODE: a mano en vivo (hasta que el producto acepte la clave de la web), salvo que la
 * clave de KMS ya este puesta; con la clave local de prueba (en falso), firma la web.
 */
function defaultLicenseMode(env: Env, signer: AdapterChoice['signer']): LicenseMode {
  const kmsConfigured = Boolean(env.GCP_KMS_KEY_VERSION?.trim() && env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim())
  return signer === 'local' || kmsConfigured ? 'kms' : 'manual'
}

/**
 * Quien firma las licencias, para las paginas que cuentan cuando llega (comprar y gracias), sin
 * leer el resto de la configuracion ni fallar si falta algo: la misma regla que readConfig. Las
 * paginas estaticas lo leen al desplegar, como CHECKOUT_OPEN.
 */
export function licenseModeOf(env: Env = process.env): LicenseMode {
  if (env.LICENSE_MODE === 'manual' || env.LICENSE_MODE === 'kms') return env.LICENSE_MODE
  const signer = env.DELIVERY_SIGNER === 'local' || env.DELIVERY_SIGNER === 'gcp-kms' ? env.DELIVERY_SIGNER : env.DELIVERY_MODE === 'fake' ? 'local' : 'gcp-kms'
  return defaultLicenseMode(env, signer)
}

export function readConfig(env: Env = process.env): DeliveryConfig {
  const mode = pick(env.DELIVERY_MODE, ['fake', 'live'] as const, 'live', 'DELIVERY_MODE')
  if (mode === 'fake' && env.VERCEL_ENV === 'production') {
    throw new Error('DELIVERY_MODE=fake en produccion: la entrega no se monta en falso con pagos de verdad')
  }
  const fake = mode === 'fake'
  const internalEmail = env.DELIVERY_INTERNAL_EMAIL || env.CONTACT_EMAIL || 'info@pymaticlabs.com'
  const adapters: AdapterChoice = {
    repository: pick(env.DELIVERY_REPOSITORY, ['memory', 'supabase'] as const, fake ? 'memory' : 'supabase', 'DELIVERY_REPOSITORY'),
    signer: pick(env.DELIVERY_SIGNER, ['local', 'gcp-kms'] as const, fake ? 'local' : 'gcp-kms', 'DELIVERY_SIGNER'),
    invoicer: pick(env.DELIVERY_INVOICER, ['fake', 'holded'] as const, fake ? 'fake' : 'holded', 'DELIVERY_INVOICER'),
    mailer: pick(env.DELIVERY_MAILER, ['outbox', 'brevo'] as const, fake ? 'outbox' : 'brevo', 'DELIVERY_MAILER'),
    storage: pick(env.DELIVERY_STORAGE, ['local', 'supabase'] as const, fake ? 'local' : 'supabase', 'DELIVERY_STORAGE'),
    calendar: pick(env.DELIVERY_CALENDAR, ['fake', 'calcom'] as const, fake ? 'fake' : 'calcom', 'DELIVERY_CALENDAR'),
    auth: pick(env.DELIVERY_AUTH, ['fake', 'supabase'] as const, fake ? 'fake' : 'supabase', 'DELIVERY_AUTH'),
    payments: pick(env.DELIVERY_PAYMENTS, ['fake', 'stripe'] as const, fake ? 'fake' : 'stripe', 'DELIVERY_PAYMENTS'),
  }
  // Pagos de mentira (o todo en falso) con la clave de KMS: cualquiera sacaria licencias de verdad gratis.
  if ((fake || adapters.payments === 'fake') && adapters.signer === 'gcp-kms') {
    throw new Error('DELIVERY_SIGNER=gcp-kms con pagos de mentira: la clave de KMS solo firma pagos de Stripe')
  }
  const licenseKeyEnv = pick(env.LICENSE_KEY_ENV, ['production', 'test'] as const, adapters.signer === 'local' ? 'test' : 'production', 'LICENSE_KEY_ENV')
  if (adapters.signer === 'local' && licenseKeyEnv !== 'test') throw new Error('LICENSE_KEY_ENV=production con la clave local de prueba')
  const licenseMode = pick(env.LICENSE_MODE, ['manual', 'kms'] as const, defaultLicenseMode(env, adapters.signer), 'LICENSE_MODE')
  const manualPublicKey = env.LICENSE_MANUAL_PUBLIC_KEY?.trim() || LICENSES_PUBLIC_KEY
  if (Buffer.from(manualPublicKey, 'base64').length !== 32 || Buffer.from(manualPublicKey, 'base64').toString('base64') !== manualPublicKey) {
    throw new Error('LICENSE_MANUAL_PUBLIC_KEY: no son 32 bytes en base64 (como licencias.pub)')
  }
  const stripeKey = env.STRIPE_SECRET_KEY?.trim() ?? ''
  const stripeLive = adapters.payments === 'fake' ? false : stripeKey ? /^(sk|rk)_live_/.test(stripeKey) : null
  const ipSalt = env.DELIVERY_IP_SALT?.trim() || (fake ? env.DELIVERY_FAKE_SECRET || randomBytes(32).toString('hex') : '')
  if (ipSalt.length < 16) throw new Error('DELIVERY_IP_SALT sin configurar (o corta): openssl rand -hex 32')

  return {
    mode,
    siteUrl: (env.DELIVERY_SITE_URL || env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com').replace(/\/+$/, ''),
    internalEmail,
    alertEmail: env.DELIVERY_ALERT_EMAIL || internalEmail,
    fromEmail: env.DELIVERY_FROM_EMAIL || 'info@pymaticlabs.com',
    fromName: env.DELIVERY_FROM_NAME || 'Pymatic Labs',
    invoiceMode: pick(env.HOLDED_INVOICE_MODE, ['emit', 'draft'] as const, 'draft', 'HOLDED_INVOICE_MODE'),
    creditNoteSign: pick(env.HOLDED_CREDIT_NOTE_SIGN, ['negative', 'positive'] as const, 'negative', 'HOLDED_CREDIT_NOTE_SIGN') === 'positive' ? 1 : -1,
    creditNoteMode: pick(env.HOLDED_CREDIT_NOTE_MODE, ['emit', 'draft'] as const, 'draft', 'HOLDED_CREDIT_NOTE_MODE'),
    licenseIncludePayment: env.LICENSE_INCLUDE_PAYMENT === 'true',
    licensePublicKey: env.LICENSE_WEB_PUBLIC_KEY?.trim() || null,
    licenseKeyEnv,
    licenseMode,
    manualPublicKey,
    manualKeyEnv: manualPublicKey === LICENSES_PUBLIC_KEY ? 'production' : 'test',
    licenseRequestEmail: env.LICENSE_REQUEST_EMAIL?.trim() || internalEmail,
    licensePendingAlertHours: int(env.LICENSE_PENDING_ALERT_HOURS, 12),
    stripeLive,
    ipSalt,
    limits: {
      checkoutPerIp: int(env.LIMIT_CHECKOUT_PER_IP, 10),
      holdsPerIp: int(env.LIMIT_HOLDS_PER_IP, 3),
      holdsTotal: int(env.LIMIT_HOLDS_TOTAL, 30),
      loginPerIp: int(env.LIMIT_LOGIN_PER_IP, 10),
      loginPerEmail: int(env.LIMIT_LOGIN_PER_EMAIL, 5),
      verifyPerIp: int(env.LIMIT_VERIFY_PER_IP, 30),
      verifyPerEmail: int(env.LIMIT_VERIFY_PER_EMAIL, 5),
      teamAddsPerDay: int(env.LIMIT_TEAM_ADDS_PER_DAY, 20),
    },
    launchLimit: int(env.LAUNCH_LIMIT, LAUNCH_CUSTOMERS),
    launchClientLimit: int(env.LAUNCH_CLIENT_LIMIT, 2),
    checkoutMinutes: Math.max(30, int(env.CHECKOUT_MINUTES, 30)),
    downloadTtlSeconds: int(env.DOWNLOAD_URL_TTL_SECONDS, 300),
    reconcileDays: int(env.RECONCILE_DAYS, 40),
    jobs: {
      maxAttempts: int(env.JOBS_MAX_ATTEMPTS, 10),
      alertAfter: int(env.JOBS_ALERT_AFTER, 3),
      baseDelayMs: int(env.JOBS_BASE_DELAY_MS, 30_000),
      maxDelayMs: int(env.JOBS_MAX_DELAY_MS, 60 * 60_000),
      lockSeconds: int(env.JOBS_LOCK_SECONDS, 120),
      concurrency: int(env.JOBS_CONCURRENCY, 4),
    },
    adapters,
    fakeDir: env.DELIVERY_FAKE_DIR || '.delivery-fake',
  }
}

/**
 * Si la zona de socio se puede abrir: en falso, o con Supabase y la sal de las IP puestas. Sin
 * ellas (la web publicada antes de montar la venta, o una vista previa sin claves) la zona dice que
 * abre con la venta en vez de fallar, y el pie no la enlaza.
 */
export function zoneAvailable(env: Env = process.env): boolean {
  if (env.DELIVERY_MODE === 'fake') return true
  return Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY && (env.DELIVERY_IP_SALT?.trim().length ?? 0) >= 16)
}

/**
 * Las rutas de prueba (/api/dev/*: pago, estado, almacen, portal y zona de muestra) solo existen con
 * todo en falso: con una sola pieza de verdad (la firma, el correo...) no se abren.
 */
export function devToolsEnabled(config: DeliveryConfig): boolean {
  const a = config.adapters
  return (
    config.mode === 'fake' &&
    a.repository === 'memory' &&
    a.signer === 'local' &&
    a.invoicer === 'fake' &&
    a.mailer === 'outbox' &&
    a.storage === 'local' &&
    a.calendar === 'fake' &&
    a.auth === 'fake' &&
    a.payments === 'fake'
  )
}
