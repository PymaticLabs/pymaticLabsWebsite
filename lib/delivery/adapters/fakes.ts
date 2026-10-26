// Los adaptadores falsos: la entrega entera sin cuentas ni red. Los usan las pruebas, la prueba
// de punta a punta (scripts/e2e-entrega.mts) y la web en local con DELIVERY_MODE=fake.
//
// - LocalSigner: una clave Ed25519 de prueba (nunca la de licencias.pub: sus licencias no valen
//   en ningun cerebro).
// - FakeInvoicer, OutboxMailer, LocalStorage, FakeCalendar, FakeAuth y FakePayments guardan lo
//   que harian, para mirarlo despues. Se les pueden provocar fallos (failNext) para probar los
//   reintentos.

import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { privateKeyFromSeed, rawPublicKey } from '../../license.ts'
import { EU_COUNTRIES, addDays, hmacHex, madridDate, madridTimeToUtc, newId, safeEqual, weekday } from '../util.ts'
import {
  PermanentError,
  RateLimitedError,
  RetryableError,
  SlotUnavailableError,
  type BookingResult,
  type Bucket,
  type Calendar,
  type Company,
  type CookieJar,
  type InvoiceDraft,
  type InvoiceKind,
  type Invoicer,
  type Locale,
  type Mail,
  type Mailer,
  type PaymentStatus,
  type Payments,
  type ProviderDocument,
  type RefundInfo,
  type TaxDetails,
  type Signer,
  type Slot,
  type Storage,
  type ZoneAuth,
  type ZoneUser,
} from '../types.ts'

/** Fallos provocados: los siguientes n usos de una operacion lanzan un error temporal. */
class Failures {
  private pending = new Map<string, number>()
  failNext(operation: string, times = 1) {
    this.pending.set(operation, (this.pending.get(operation) ?? 0) + times)
  }
  check(operation: string) {
    const left = this.pending.get(operation) ?? 0
    if (left > 0) {
      this.pending.set(operation, left - 1)
      throw new RetryableError(`fallo provocado en ${operation}`)
    }
  }
}

// --- Firma -------------------------------------------------------------------------------------

export class LocalSigner implements Signer {
  readonly keyId = 'local-test'
  private seed: string
  failures = new Failures()

  constructor(seedBase64?: string) {
    if (seedBase64) {
      this.seed = seedBase64
    } else {
      const { privateKey } = generateKeyPairSync('ed25519')
      const der = privateKey.export({ format: 'der', type: 'pkcs8' })
      this.seed = der.subarray(der.length - 32).toString('base64')
    }
  }

  async publicKey() {
    return rawPublicKey(privateKeyFromSeed(this.seed))
  }

  async sign(message: Buffer) {
    this.failures.check('sign')
    return edSign(null, message, privateKeyFromSeed(this.seed))
  }
}

// --- Facturas ----------------------------------------------------------------------------------

export interface FakeDocument extends ProviderDocument {
  kind: InvoiceKind
  draft: InvoiceDraft
  sentTo: string[]
}

export class FakeInvoicer implements Invoicer {
  readonly name = 'fake'
  contacts = new Map<string, { id: string; name: string; taxId: string }>()
  documents = new Map<string, FakeDocument>()
  counters: Record<InvoiceKind, number> = { invoice: 0, credit_note: 0 }
  calls = 0
  failures = new Failures()
  /** Centimos de mas en el total que "calcula" Holded (para probar que no se emite si no cuadra). */
  skewCents = 0

  private use(operation: string) {
    this.calls += 1
    this.failures.check(operation)
  }

  async ensureContact(company: Company) {
    this.use('ensureContact')
    const existing = this.contacts.get(company.taxId)
    if (existing) return existing.id
    const contact = { id: `ct_${this.contacts.size + 1}`, name: company.name, taxId: company.taxId }
    this.contacts.set(company.taxId, contact)
    return contact.id
  }

  async findDocument(kind: InvoiceKind, contactId: string, reference: string) {
    this.use('findDocument')
    for (const doc of this.documents.values()) {
      if (doc.kind === kind && doc.draft.contactId === contactId && doc.draft.reference === reference) return this.public(doc)
    }
    return null
  }

  async createDocument(kind: InvoiceKind, draft: InvoiceDraft) {
    this.use('createDocument')
    const doc: FakeDocument = { id: `doc_${this.documents.size + 1}`, number: null, approved: false, kind, draft, sentTo: [] }
    this.documents.set(doc.id, doc)
    return this.public(doc)
  }

  async getDocument(kind: InvoiceKind, id: string) {
    this.use('getDocument')
    return this.public(this.doc(id))
  }

  async approveDocument(kind: InvoiceKind, id: string) {
    this.use('approveDocument')
    const doc = this.doc(id)
    if (!doc.approved) {
      this.counters[kind] += 1
      doc.number = `${kind === 'invoice' ? 'F' : 'R'}${doc.draft.date.slice(0, 4)}-${String(this.counters[kind]).padStart(4, '0')}`
      doc.approved = true
    }
    return this.public(doc)
  }

  async sendDocument(kind: InvoiceKind, id: string, email: string) {
    this.use('sendDocument')
    this.doc(id).sentTo.push(email)
  }

  async getPdf(kind: InvoiceKind, id: string) {
    this.use('getPdf')
    return minimalPdf(`Factura ${this.doc(id).number ?? id}`)
  }

  private doc(id: string) {
    const doc = this.documents.get(id)
    // Como Holded (http.ts): un 404 permanente, con su status (borrado a mano, por ejemplo).
    if (!doc) throw Object.assign(new PermanentError(`fake 404: no existe el documento ${id}`), { status: 404 })
    return doc
  }

  private public(doc: FakeDocument): ProviderDocument {
    // El total y el IVA como los calcula Holded: base de las lineas y el impuesto del borrador.
    const net = doc.draft.lines.reduce((sum, line) => sum + Math.round(line.price * line.units * 100), 0)
    const tax = doc.draft.taxTreatment === 'standard' ? Math.round((net * (doc.draft.taxRate ?? 21)) / 100) : 0
    return { id: doc.id, number: doc.number, approved: doc.approved, total: (net + tax + this.skewCents) / 100, tax: tax / 100 }
  }
}

/** Un PDF de una pagina con una linea de texto: lo justo para que se abra. */
export function minimalPdf(text: string): Buffer {
  const safe = text.replace(/[()\\]/g, '')
  const stream = `BT /F1 18 Tf 72 720 Td (${safe}) Tj ET`
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((object, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  body += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'latin1')
}

// --- Correo --------------------------------------------------------------------------------------

export interface SentMail extends Mail {
  id: string
  sentAt: string
}

export class OutboxMailer implements Mailer {
  readonly name = 'outbox'
  sent: SentMail[] = []
  failures = new Failures()
  private dir: string | null
  private keys = new Set<string>()

  /** dir: si se da, cada correo queda tambien en <dir>/<n>.json y .html para abrirlo. */
  constructor(dir: string | null = null) {
    this.dir = dir
  }

  async send(mail: Mail) {
    this.failures.check('send')
    // Como Brevo con IdempotencyKey: el mismo correo no sale dos veces.
    if (mail.idempotencyKey && this.keys.has(mail.idempotencyKey)) {
      return { id: this.sent.find((m) => m.idempotencyKey === mail.idempotencyKey)?.id ?? 'repetido' }
    }
    if (mail.idempotencyKey) this.keys.add(mail.idempotencyKey)
    const record: SentMail = { ...mail, id: `mail_${this.sent.length + 1}`, sentAt: new Date().toISOString() }
    this.sent.push(record)
    if (this.dir) {
      fs.mkdirSync(this.dir, { recursive: true })
      const base = path.join(this.dir, `${String(this.sent.length).padStart(4, '0')}`)
      const { attachments, ...rest } = record
      fs.writeFileSync(
        `${base}.json`,
        JSON.stringify({ ...rest, attachments: (attachments ?? []).map((a) => ({ name: a.name, contentType: a.contentType, base64: a.content.toString('base64') })) }, null, 2)
      )
      fs.writeFileSync(`${base}.html`, record.html)
    }
    if (process.env.NODE_ENV !== 'test') console.info(`[buzon] ${record.to} · ${record.subject}`)
    return { id: record.id }
  }
}

// --- Almacen --------------------------------------------------------------------------------------

export class LocalStorage implements Storage {
  files = new Map<string, { content: Buffer; contentType: string }>()
  private dir: string | null
  private secret: string
  private siteUrl: string

  constructor(options: { dir?: string | null; secret: string; siteUrl: string }) {
    this.dir = options.dir ?? null
    this.secret = options.secret
    this.siteUrl = options.siteUrl
  }

  private key(bucket: Bucket, filePath: string) {
    return `${bucket}/${filePath}`
  }

  private diskPath(bucket: Bucket, filePath: string) {
    if (!this.dir) return null
    const target = path.resolve(this.dir, bucket, filePath)
    if (!target.startsWith(path.resolve(this.dir))) throw new Error('ruta fuera del almacen')
    return target
  }

  async put(bucket: Bucket, filePath: string, content: Buffer, contentType: string) {
    this.files.set(this.key(bucket, filePath), { content, contentType })
    const disk = this.diskPath(bucket, filePath)
    if (disk) {
      fs.mkdirSync(path.dirname(disk), { recursive: true })
      fs.writeFileSync(disk, content)
    }
  }

  async get(bucket: Bucket, filePath: string) {
    const memory = this.files.get(this.key(bucket, filePath))
    if (memory) return memory.content
    const disk = this.diskPath(bucket, filePath)
    return disk && fs.existsSync(disk) ? fs.readFileSync(disk) : null
  }

  async exists(bucket: Bucket, filePath: string) {
    return (await this.get(bucket, filePath)) !== null
  }

  async signedUrl(bucket: Bucket, filePath: string, expiresInSeconds: number, downloadName?: string) {
    const expires = Math.floor(Date.now() / 1000) + expiresInSeconds
    const params = new URLSearchParams({ b: bucket, p: filePath, e: String(expires) })
    if (downloadName) params.set('n', downloadName)
    params.set('s', this.signature(params))
    return `${this.siteUrl}/api/dev/storage?${params}`
  }

  private signature(params: URLSearchParams) {
    return hmacHex(this.secret, `${params.get('b')}|${params.get('p')}|${params.get('e')}|${params.get('n') ?? ''}`)
  }

  /** Comprueba un enlace de signedUrl (el que sirve /api/dev/storage). */
  verifySigned(params: URLSearchParams, nowSeconds = Math.floor(Date.now() / 1000)): { bucket: Bucket; path: string; name: string | null } | null {
    const expires = Number(params.get('e'))
    if (!Number.isFinite(expires) || expires < nowSeconds) return null
    if (!safeEqual(params.get('s'), this.signature(params))) return null
    const bucket = params.get('b')
    if (bucket !== 'releases' && bucket !== 'customer-files') return null
    return { bucket, path: params.get('p') ?? '', name: params.get('n') }
  }
}

// --- Calendario ----------------------------------------------------------------------------------

/**
 * Huecos como los de Cal.com con el horario de la oferta: de lunes a viernes de 18:00 a 22:00 y
 * los sabados de 10:00 a 14:00, hora peninsular, sesiones de 1 hora, con Eric y con Sergio.
 * busyDays: los primeros dias, llenos (para probar que salen los de la tercera semana).
 */
export class FakeCalendar implements Calendar {
  readonly name = 'fake'
  booked = new Map<string, BookingResult & { host: string; email: string }>()
  /** Las canceladas, por su uid, con el motivo que se dio. */
  cancelled = new Map<string, BookingResult & { host: string; email: string; reason: string }>()
  reservations = new Map<string, Slot>()
  busyDays: number
  hosts: string[]
  failures = new Failures()
  private clock: () => Date
  private seq = 0

  constructor(options: { busyDays?: number; hosts?: string[]; clock?: () => Date } = {}) {
    this.busyDays = options.busyDays ?? 0
    this.hosts = options.hosts ?? ['eric', 'sergio']
    this.clock = options.clock ?? (() => new Date())
  }

  private slotKey(slot: Slot) {
    return `${slot.host}|${new Date(slot.start).toISOString()}`
  }

  async availability(fromIso: string, toIso: string) {
    const from = new Date(fromIso)
    const to = new Date(toIso)
    const firstFree = addDays(madridDate(this.clock()), this.busyDays)
    const taken = new Set([...this.booked.keys(), ...[...this.reservations.values()].map((s) => this.slotKey(s))])
    const slots: Slot[] = []
    for (let day = madridDate(from); day <= madridDate(to); day = addDays(day, 1)) {
      if (day < firstFree) continue
      const dow = weekday(day)
      const hours = dow >= 1 && dow <= 5 ? [18, 19, 20, 21] : dow === 6 ? [10, 11, 12, 13] : []
      for (const hour of hours) {
        const start = madridTimeToUtc(day, hour)
        // Como Cal.com: solo los huecos que caben enteros (la hora) dentro de la ventana pedida.
        if (start < from || start.getTime() + 60 * 60_000 > to.getTime()) continue
        for (const host of this.hosts) {
          const slot = { host, start: start.toISOString() }
          if (!taken.has(this.slotKey(slot))) slots.push(slot)
        }
      }
    }
    return slots
  }

  async reserve(slot: Slot, _minutes: number) {
    this.failures.check('reserve')
    const key = this.slotKey(slot)
    if (this.booked.has(key) || [...this.reservations.values()].some((s) => this.slotKey(s) === key)) throw new SlotUnavailableError()
    const id = `res_${newId()}`
    this.reservations.set(id, slot)
    return id
  }

  async release(reservationId: string) {
    this.reservations.delete(reservationId)
  }

  async book(input: { slot: Slot; attendee: { name: string; email: string; locale: Locale }; reservationId: string | null }) {
    this.failures.check('book')
    if (input.reservationId) this.reservations.delete(input.reservationId)
    const key = this.slotKey(input.slot)
    if (this.booked.has(key) || [...this.reservations.values()].some((s) => this.slotKey(s) === key)) throw new SlotUnavailableError()
    const start = new Date(input.slot.start)
    // Con contador, no por las que hay: tras cancelar una, el uid siguiente no repite.
    const n = ++this.seq
    const result = {
      uid: `bk_${n}`,
      start: start.toISOString(),
      end: new Date(start.getTime() + 3600_000).toISOString(),
      meetingUrl: `https://cal.example.test/video/${n}`,
      host: input.slot.host,
      email: input.attendee.email,
    }
    this.booked.set(key, result)
    return { uid: result.uid, start: result.start, end: result.end, meetingUrl: result.meetingUrl }
  }

  /** Como Cal.com: una que ya acabo no se cancela (ended); una cancelada antes o que no existe, gone. */
  async cancel(uid: string, reason: string) {
    this.failures.check('cancel')
    const entry = [...this.booked.entries()].find(([, b]) => b.uid === uid)
    if (!entry) return 'gone' as const
    const [key, booking] = entry
    if (booking.end && new Date(booking.end) <= this.clock()) return 'ended' as const
    this.booked.delete(key)
    this.cancelled.set(uid, { ...booking, reason })
    return 'cancelled' as const
  }
}

// --- Acceso a la zona ------------------------------------------------------------------------------

export const FAKE_SESSION_COOKIE = 'zona_prueba'

/** Codigo por correo como Supabase, con la sesion en una cookie firmada. El codigo sale por el buzon. */
export class FakeAuth implements ZoneAuth {
  readonly name = 'fake'
  users = new Map<string, string>()
  codes = new Map<string, { code: string; expires: number; attempts: number }>()
  private mailer: Mailer
  private secret: string
  private clock: () => Date

  constructor(options: { mailer: Mailer; secret: string; clock?: () => Date }) {
    this.mailer = options.mailer
    this.secret = options.secret
    this.clock = options.clock ?? (() => new Date())
  }

  async ensureUser(email: string) {
    const key = email.toLowerCase()
    let id = this.users.get(key)
    if (!id) {
      id = newId()
      this.users.set(key, id)
    }
    return id
  }

  async sendCode(email: string, locale: Locale) {
    const key = email.toLowerCase()
    if (!this.users.has(key)) return // shouldCreateUser: false
    // 8 cifras, como se configura Supabase (Email OTP Length).
    const code = String(Math.floor(10_000_000 + Math.random() * 90_000_000))
    this.codes.set(key, { code, expires: this.clock().getTime() + 10 * 60_000, attempts: 0 })
    await this.mailer.send({
      to: key,
      subject: locale === 'en' ? `Your access code: ${code}` : `Tu código para entrar: ${code}`,
      html: `<p>${code}</p>`,
      text: code,
      tags: ['zona-codigo'],
    })
  }

  async verifyCode(email: string, code: string, jar: CookieJar) {
    const key = email.toLowerCase()
    const entry = this.codes.get(key)
    const id = this.users.get(key)
    if (!entry || !id) return null
    entry.attempts += 1
    // Como Supabase: tras varios intentos fallidos frena (y el codigo deja de valer).
    if (entry.attempts > 5) {
      this.codes.delete(key)
      throw new RateLimitedError('demasiados intentos con ese codigo')
    }
    if (entry.expires < this.clock().getTime() || !safeEqual(entry.code, code.trim())) return null
    this.codes.delete(key)
    const payload = Buffer.from(JSON.stringify({ id, email: key, exp: this.clock().getTime() + 8 * 3600_000 })).toString('base64url')
    jar.setAll([
      {
        name: FAKE_SESSION_COOKIE,
        value: `${payload}.${hmacHex(this.secret, payload)}`,
        options: { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 8 * 3600 },
      },
    ])
    return { id, email: key }
  }

  async currentUser(jar: CookieJar): Promise<ZoneUser | null> {
    const cookie = jar.getAll().find((c) => c.name === FAKE_SESSION_COOKIE)?.value
    if (!cookie) return null
    const [payload, signature] = cookie.split('.')
    if (!payload || !safeEqual(signature, hmacHex(this.secret, payload))) return null
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as { id: string; email: string; exp: number }
      return data.exp > this.clock().getTime() ? { id: data.id, email: data.email } : null
    } catch {
      return null
    }
  }

  async signOut(jar: CookieJar) {
    jar.setAll([{ name: FAKE_SESSION_COOKIE, value: '', options: { path: '/', maxAge: 0 } }])
  }
}

// --- Pagos -----------------------------------------------------------------------------------------

/**
 * Stripe de mentira. Sabe de los pagos que ha "visto": los de su propia pagina de pago de prueba
 * (/api/dev/checkout) y los de los avisos que le llegan al webhook en modo falso (observe()). Una
 * licencia cuyo pago no conoce es, para la conciliacion, una licencia sin pago.
 */
export class FakePayments implements Payments {
  readonly name = 'fake'
  sessions = new Map<string, { id: string; url: string; expiresAt: number; params: Record<string, unknown> }>()
  payments = new Map<string, PaymentStatus>()
  invoiceByPaymentIntent = new Map<string, string>()
  paidSessions: Record<string, unknown>[] = []
  paidInvoices: Record<string, unknown>[] = []
  /** Lo que diria VIES de cada NIF-IVA (por defecto, verified). */
  taxIdStatus = new Map<string, string>()
  canceledSubscriptions = new Set<string>()
  failures = new Failures()
  private siteUrl: string

  constructor(siteUrl: string) {
    this.siteUrl = siteUrl
  }

  async priceId(lookupKey: string) {
    return `price_fake_${lookupKey}`
  }

  async createCheckoutSession(params: Record<string, unknown>) {
    this.failures.check('createCheckoutSession')
    const id = `cs_fake_${newId().replace(/-/g, '')}`
    const expiresAt = Number(params.expires_at) || Math.floor(Date.now() / 1000) + 1800
    const session = { id, url: `${this.siteUrl}/api/dev/checkout?id=${id}`, expiresAt, params }
    this.sessions.set(id, session)
    return { id, url: session.url, expiresAt }
  }

  async createPortalSession(customerId: string, returnUrl: string) {
    return `${this.siteUrl}/api/dev/portal?customer=${encodeURIComponent(customerId)}&return=${encodeURIComponent(returnUrl)}`
  }

  async invoiceIdForPaymentIntent(paymentIntentId: string) {
    return this.invoiceByPaymentIntent.get(paymentIntentId) ?? null
  }

  async paymentStatus(ref: string) {
    return this.payments.get(ref) ?? { exists: false, paid: false, refunded: false, disputed: false, amount: null }
  }

  async refundsOf(charge: { id: string; amount_refunded?: number; payment_intent?: unknown; refunds?: { data?: unknown[] } | null }): Promise<RefundInfo[]> {
    const data = charge.refunds?.data as { id: string; amount: number; status?: string | null }[] | undefined
    if (data) return data.map((r) => ({ id: r.id, amount: r.amount, status: r.status ?? 'succeeded' }))
    // Sin la lista: una sola devolucion por todo lo devuelto (como un aviso de una devolucion).
    const amount = Number(charge.amount_refunded) || 0
    return amount > 0 ? [{ id: `re_${String(charge.payment_intent ?? charge.id)}_${amount}`, amount, status: 'succeeded' }] : []
  }

  async taxDetails(input: { checkoutSessionId?: string | null; invoiceId?: string | null }): Promise<TaxDetails> {
    if (input.checkoutSessionId) {
      const session = this.paidSessions.find((s) => s.id === input.checkoutSessionId) as
        | { total_details?: { amount_tax?: number; breakdown?: { taxes?: { taxability_reason?: string | null }[] } }; customer_details?: { address?: { country?: string }; tax_ids?: { type: string; value: string }[] } }
        | undefined
      if (!session) return { reasons: [], amountTax: null, taxIds: [] }
      const tax = session.total_details?.amount_tax ?? 0
      const country = session.customer_details?.address?.country ?? null
      const ids = session.customer_details?.tax_ids ?? []
      // Como Stripe Tax: con IVA, standard_rated; a la UE con NIF-IVA, reverse_charge; si no, not_collecting.
      const reasons =
        session.total_details?.breakdown?.taxes?.map((t) => t.taxability_reason ?? '').filter(Boolean) ??
        [tax > 0 ? 'standard_rated' : country && country !== 'ES' && EU_COUNTRIES.has(country) && ids.some((t) => t.type === 'eu_vat') ? 'reverse_charge' : 'not_collecting']
      return { reasons, amountTax: tax, taxIds: ids.map((t) => ({ type: t.type, value: t.value, verification: this.taxIdStatus.get(t.value) ?? 'verified' })) }
    }
    if (input.invoiceId) {
      const invoice = this.paidInvoices.find((i) => i.id === input.invoiceId) as { total_taxes?: { amount: number; taxability_reason?: string | null }[] } | undefined
      if (!invoice) return { reasons: [], amountTax: null, taxIds: [] }
      const taxes = invoice.total_taxes ?? []
      return { reasons: taxes.length ? taxes.map((t) => t.taxability_reason ?? '').filter(Boolean) : ['not_collecting'], amountTax: taxes.reduce((s, t) => s + t.amount, 0), taxIds: [] }
    }
    return { reasons: [], amountTax: null, taxIds: [] }
  }

  async priceLookupKey(priceId: string) {
    return priceId.startsWith('price_fake_') ? priceId.slice('price_fake_'.length) : null
  }

  async cancelSubscription(subscriptionId: string) {
    if (this.canceledSubscriptions.has(subscriptionId)) return false
    this.canceledSubscriptions.add(subscriptionId)
    return true
  }

  async listPaidCheckoutSessions(sinceUnix: number) {
    return this.paidSessions.filter((s) => Number(s.created) >= sinceUnix)
  }

  async listPaidInvoices(sinceUnix: number) {
    return this.paidInvoices.filter((i) => Number(i.created) >= sinceUnix)
  }

  /** Lo que el Stripe de mentira aprende de un aviso que "mando". */
  observe(event: { type: string; data: { object: Record<string, unknown> } }) {
    const object = event.data.object
    const set = (ref: unknown, patch: Partial<PaymentStatus>) => {
      if (typeof ref !== 'string' || !ref) return
      const current = this.payments.get(ref) ?? { exists: true, paid: false, refunded: false, disputed: false, amount: null }
      this.payments.set(ref, { ...current, exists: true, ...patch })
    }
    if (event.type === 'checkout.session.completed' && object.payment_status === 'paid') {
      set(object.payment_intent ?? object.id, { paid: true, amount: Number(object.amount_total) })
      if (!this.paidSessions.some((s) => s.id === object.id)) this.paidSessions.push(object)
    } else if (event.type === 'invoice.paid') {
      set(object.id, { paid: true, amount: Number(object.amount_paid) })
      if (!this.paidInvoices.some((i) => i.id === object.id)) this.paidInvoices.push(object)
    } else if (event.type === 'charge.refunded') {
      set(object.payment_intent, { refunded: object.refunded === true })
    } else if (event.type.startsWith('charge.dispute.')) {
      // Como paymentStatus de verdad: cuenta un contracargo abierto o perdido, no uno ganado ni una peticion de informacion.
      set(object.payment_intent, { disputed: ['needs_response', 'under_review', 'lost'].includes(String(object.status)) })
    }
  }
}
