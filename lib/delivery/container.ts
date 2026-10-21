// Monta la entrega con los adaptadores que dice el entorno (lib/delivery/config.ts): los de verdad,
// o los falsos con DELIVERY_MODE=fake. Cada adaptador se crea al usarlo por primera vez: si falta
// la clave de uno (Cal.com, por ejemplo), lo demas sigue funcionando y el paso que lo usa avisa.
// Una sola instancia por proceso (en globalThis: Next puede cargar este modulo una vez por ruta).

import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { readConfig, type DeliveryConfig } from './config.ts'
import { MemoryRepository, emptyMemoryState } from './adapters/memory-repository.ts'
import { FakeAuth, FakeCalendar, FakeInvoicer, FakePayments, LocalSigner, LocalStorage, OutboxMailer } from './adapters/fakes.ts'
import { SupabaseRepository } from './adapters/supabase-repository.ts'
import { GcpKmsSigner } from './adapters/gcp-kms-signer.ts'
import { HoldedInvoicer } from './adapters/holded-invoicer.ts'
import { BrevoMailer } from './adapters/brevo-mailer.ts'
import { SupabaseStorage } from './adapters/supabase-storage.ts'
import { CalcomCalendar } from './adapters/calcom-calendar.ts'
import { SupabaseAuth } from './adapters/supabase-auth.ts'
import { StripePayments } from './adapters/stripe-payments.ts'
import type { Calendar, Invoicer, Mailer, Payments, Repository, Signer, Storage, ZoneAuth } from './types.ts'

export interface Delivery {
  config: DeliveryConfig
  repo: Repository
  signer: Signer
  invoicer: Invoicer
  mailer: Mailer
  storage: Storage
  calendar: Calendar
  auth: ZoneAuth
  payments: Payments
  clock: () => Date
}

/** Las piezas falsas, para mirarlas despues (pruebas y /api/dev/state). */
export interface FakeParts {
  repo: MemoryRepository
  signer: LocalSigner
  invoicer: FakeInvoicer
  mailer: OutboxMailer
  storage: LocalStorage
  calendar: FakeCalendar
  auth: FakeAuth
  payments: FakePayments
}

type Env = Record<string, string | undefined>
type Adapters = Omit<Delivery, 'config' | 'clock'>

export type DeliveryWithFakes = Delivery & { fakes: Partial<FakeParts> }

export function createDelivery(env: Env = process.env, clock: () => Date = () => new Date()): DeliveryWithFakes {
  const config = readConfig(env)
  const a = config.adapters
  const fakeDir = path.resolve(config.fakeDir)
  const fakeSecret = env.DELIVERY_FAKE_SECRET || randomBytes(32).toString('hex')
  const fakes: Partial<FakeParts> = {}
  const cache: Partial<Adapters> = {}

  const delivery = { config, clock, fakes } as DeliveryWithFakes
  const factories: { [K in keyof Adapters]: () => Adapters[K] } = {
    repo: () => (a.repository === 'memory' ? (fakes.repo = new MemoryRepository(emptyMemoryState(), clock)) : new SupabaseRepository(env)),
    mailer: () =>
      a.mailer === 'outbox'
        ? (fakes.mailer = new OutboxMailer(env.DELIVERY_FAKE_OUTBOX === 'false' ? null : path.join(fakeDir, 'buzon')))
        : new BrevoMailer(env, { email: config.fromEmail, name: config.fromName }, config.internalEmail),
    signer: () => (a.signer === 'local' ? (fakes.signer = new LocalSigner(env.DELIVERY_FAKE_SIGNING_SEED)) : new GcpKmsSigner(env)),
    invoicer: () => (a.invoicer === 'fake' ? (fakes.invoicer = new FakeInvoicer()) : new HoldedInvoicer(env)),
    storage: () =>
      a.storage === 'local'
        ? (fakes.storage = new LocalStorage({ dir: env.DELIVERY_FAKE_STORAGE === 'memory' ? null : path.join(fakeDir, 'almacen'), secret: fakeSecret, siteUrl: config.siteUrl }))
        : new SupabaseStorage(env),
    calendar: () => (a.calendar === 'fake' ? (fakes.calendar = new FakeCalendar({ busyDays: Number(env.DELIVERY_FAKE_BUSY_DAYS) || 0, clock })) : new CalcomCalendar(env)),
    auth: () =>
      a.auth === 'fake'
        ? (fakes.auth = new FakeAuth({ mailer: delivery.mailer, secret: fakeSecret, clock }))
        : new SupabaseAuth(env, async (email) => (await delivery.repo.listMembershipsByEmail(email)).find((m) => m.userId)?.userId ?? null),
    payments: () => (a.payments === 'fake' ? (fakes.payments = new FakePayments(config.siteUrl)) : new StripePayments(env)),
  }
  for (const key of Object.keys(factories) as (keyof Adapters)[]) {
    Object.defineProperty(delivery, key, {
      enumerable: true,
      get: () => (cache[key] ??= factories[key]() as never),
      set: (value) => {
        cache[key] = value
      },
    })
  }
  return delivery
}

const GLOBAL = globalThis as unknown as { __cerebroDelivery?: DeliveryWithFakes }

/** La entrega de este proceso. */
export function getDelivery(): DeliveryWithFakes {
  if (!GLOBAL.__cerebroDelivery) GLOBAL.__cerebroDelivery = createDelivery()
  return GLOBAL.__cerebroDelivery
}

/** Todo en falso y en memoria, con un reloj que controlan las pruebas. */
export function createFakeDelivery(options: { clock?: () => Date; env?: Env } = {}): Delivery & { fakes: FakeParts } {
  const delivery = createDelivery(
    {
      DELIVERY_MODE: 'fake',
      DELIVERY_FAKE_OUTBOX: 'false',
      DELIVERY_FAKE_STORAGE: 'memory',
      DELIVERY_SITE_URL: 'https://web.example.test',
      DELIVERY_FAKE_SECRET: 'secreto-de-prueba',
      ...options.env,
    },
    options.clock
  )
  // Se crean ya, para que las pruebas tengan a mano cada pieza falsa.
  for (const key of ['repo', 'mailer', 'signer', 'invoicer', 'storage', 'calendar', 'auth', 'payments'] as const) void delivery[key]
  return delivery as Delivery & { fakes: FakeParts }
}
