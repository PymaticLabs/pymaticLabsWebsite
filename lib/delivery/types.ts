// Tipos de la entrega automatica (PML-KB-0261) y los contratos de cada proveedor.
//
// Cada proveedor va detras de un adaptador con una version de verdad y otra falsa, para que todo
// el camino (pago -> factura -> licencia -> cuenta -> correo) corra y se pruebe sin cuentas ni red:
// repositorio (Supabase / memoria), firma (Google Cloud KMS / clave local de prueba), factura
// (Holded / falsa), correo (Brevo / buzon local), almacen (Supabase Storage / disco), calendario
// (Cal.com / falso), acceso a la zona (Supabase Auth / falso) y pagos (Stripe / falso).
//
// Sin imports con alias (@/...): los tests corren con `node --test`, sin compilar.

import type { LicenseModality } from '../license.ts'

export type Locale = 'es' | 'en'

export interface Address {
  line1: string | null
  line2: string | null
  city: string | null
  postal_code: string | null
  state: string | null
  country: string | null
}

export interface Company {
  id: string
  name: string
  /** NIF o NIF-IVA, normalizado (A-Z, 0-9 y guiones): el de la licencia y el de Holded. */
  taxId: string
  taxIdType: string | null
  country: string | null
  address: Address | null
  /** El correo de quien compro: el titular en la zona. */
  email: string
  locale: Locale
  currency: string
  stripeCustomerId: string | null
  holdedContactId: string | null
  /** Personas que pueden entrar en la zona: 1, o 10 con equipo. */
  seats: number
  subscriptionId: string | null
  subscriptionStatus: string | null
  subscriptionPlan: string | null
  /** Cuando creo Stripe el ultimo aviso de la suscripcion que se aplico (los avisos llegan desordenados). */
  subscriptionEventAt: string | null
  accessRevokedAt: string | null
  createdAt: string
}

export type PurchaseKind = 'one_time' | 'renewal'
export type PurchaseStatus = 'paid' | 'needs_review' | 'refunded' | 'partially_refunded' | 'disputed' | 'dispute_lost'
/** El IVA que cobro Stripe Tax: espanol, inversion del sujeto pasivo (UE), fuera de la UE o exento. */
export type TaxTreatment = 'standard' | 'reverse_charge' | 'export' | 'exempt'

export interface Purchase {
  id: string
  companyId: string | null
  kind: PurchaseKind
  product: string
  /** El pago: pi_... en el pago unico, in_... en cada cobro del mensual. Va en la licencia. */
  paymentRef: string
  stripeCheckoutSessionId: string | null
  stripePaymentIntentId: string | null
  stripeInvoiceId: string | null
  stripeSubscriptionId: string | null
  stripeCustomerId: string | null
  email: string
  locale: Locale
  currency: string
  /** Importes en centimos. subtotal es el de lista, antes del descuento. */
  amountSubtotal: number
  amountDiscount: number
  amountTax: number
  amountTotal: number
  amountRefunded: number
  taxTreatment: TaxTreatment
  taxRate: number | null
  launch: boolean
  seats: number
  termsVersion: string | null
  termsSha256: string | null
  termsAcceptedAt: string | null
  marketingOptIn: boolean
  sessionHost: string | null
  sessionStart: string | null
  calendarReservation: string | null
  /** Cobro del mensual: el ultimo dia que cubre (AAAA-MM-DD), el soporte_hasta de su licencia. */
  supportUntil: string | null
  status: PurchaseStatus
  /** El pago es de Stripe en vivo (true) o de prueba: una compra de prueba nunca se firma con la clave de verdad. */
  livemode: boolean
  reservedLicenseId: string | null
  welcomeSentAt: string | null
  reviewData: Record<string, unknown> | null
  paidAt: string
  createdAt: string
}

/**
 * Quien firmo la licencia: la web (clave propia, ids del 5001 al 9999) o Eric en su Mac, a mano
 * (LICENSE_MODE=manual, ids de su numeracion, del 0001 al 5000).
 */
export type LicenseOrigin = 'web' | 'manual'

export interface LicenseRecord {
  id: string
  companyId: string
  purchaseId: string
  paymentRef: string
  modalidad: LicenseModality
  equipo: boolean
  emitida: string
  soporteHasta: string
  fileName: string
  /** El fichero .cerebro-licencia tal cual. */
  content: string
  keyId: string
  publicKey: string
  origin: LicenseOrigin
  revokedAt: string | null
  revokedReason: string | null
  createdAt: string
}

export type LicenseRequestStatus = 'pending' | 'issued' | 'cancelled'

/**
 * Una licencia pedida a Eric (LICENSE_MODE=manual): lo que tiene que llevar, sacado de la compra. El
 * numero lo pone el, de su numeracion; la web no lo reparte. Al subirla firmada, issued.
 */
export interface LicenseRequest {
  id: string
  purchaseId: string
  companyId: string
  kind: PurchaseKind
  paymentRef: string
  cliente: string
  nif: string
  modalidad: LicenseModality
  equipo: boolean
  /** Personas en la zona: 1, o 10 con equipo (la licencia solo dice equipo true o false). */
  seats: number
  /** La fecha de la compra (o del cobro del mensual), en hora peninsular. */
  emitida: string
  soporteHasta: string
  livemode: boolean
  status: LicenseRequestStatus
  licenseId: string | null
  /** Por que no se firma ya: refund, dispute (o refund:<compra> si cayo con el pago unico de la empresa). */
  cancelReason: string | null
  issuedAt: string | null
  cancelledAt: string | null
  createdAt: string
}

export type InvoiceKind = 'invoice' | 'credit_note'
export type InvoiceStatus = 'draft' | 'approved' | 'sent'

export interface InvoiceRecord {
  id: string
  companyId: string
  purchaseId: string
  kind: InvoiceKind
  /** Clave propia, unica: invoice:<compra> o credit:<compra>:<importe devuelto acumulado>. */
  ref: string
  provider: string
  providerId: string | null
  number: string | null
  status: InvoiceStatus
  amountTotal: number
  currency: string
  storagePath: string | null
  rectifies: string | null
  /** Por que no se emite sola (NIF-IVA sin verificar, en USD, totales que no cuadran): se queda en borrador. */
  holdReason: string | null
  createdAt: string
  approvedAt: string | null
  sentAt: string | null
}

export type MemberRole = 'owner' | 'member'

export interface Member {
  id: string
  companyId: string
  email: string
  userId: string | null
  role: MemberRole
  addedBy: string | null
  /** La compra que la hizo titular: si se devuelve, esa persona pierde el acceso que le dio. */
  purchaseId: string | null
  createdAt: string
  removedAt: string | null
}

export interface Booking {
  id: string
  companyId: string
  purchaseId: string
  number: 1 | 2
  host: string
  startAt: string
  providerUid: string | null
  status: 'booked' | 'failed' | 'cancelled'
  note: string | null
  createdAt: string
}

export interface Version {
  id: string
  notesEs: string
  notesEn: string
  publishedAt: string
  announcedAt: string | null
}

export type VersionFileKind = 'mac' | 'windows' | 'registry' | 'sbom' | 'checksum' | 'other'

export interface VersionFile {
  id: string
  versionId: string
  kind: VersionFileKind
  lang: Locale | null
  fileName: string
  storagePath: string
  sizeBytes: number | null
  sha256: string | null
  /** El instalador del registro: solo con equipo. */
  teamOnly: boolean
  createdAt: string
}

export type JobStatus = 'pending' | 'running' | 'done' | 'dead'

export interface Job {
  id: string
  key: string
  kind: string
  payload: Record<string, unknown>
  dependsOn: string[]
  status: JobStatus
  attempts: number
  maxAttempts: number
  nextRunAt: string
  lockedUntil: string | null
  lastError: string | null
  alertedAt: string | null
  result: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  doneAt: string | null
}

export interface NewJob {
  key: string
  kind: string
  payload?: Record<string, unknown>
  dependsOn?: string[]
  maxAttempts?: number
  runAt?: string
}

// Errores de los pasos: uno temporal se reintenta con espera; uno permanente (datos o
// configuracion que no valen) para la cola de ese paso y avisa a PymaticLabs al momento.
export class RetryableError extends Error {
  retryAfterMs: number | null
  constructor(message: string, retryAfterMs: number | null = null) {
    super(message)
    this.name = 'RetryableError'
    this.retryAfterMs = retryAfterMs
  }
}

export class PermanentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PermanentError'
  }
}

/** El hueco elegido ya no esta libre. */
export class SlotUnavailableError extends Error {
  constructor(message = 'el hueco ya no esta libre') {
    super(message)
    this.name = 'SlotUnavailableError'
  }
}

/** El proveedor frena por demasiados intentos seguidos (Supabase Auth con los codigos, por ejemplo). */
export class RateLimitedError extends Error {
  constructor(message = 'demasiados intentos seguidos') {
    super(message)
    this.name = 'RateLimitedError'
  }
}

/** Ya estan todas las plazas de la licencia (lo comprueba tambien la base de datos). */
export class SeatLimitError extends Error {
  constructor(message = 'ya estan todas las plazas de la licencia') {
    super(message)
    this.name = 'SeatLimitError'
  }
}

// --- Repositorio ---------------------------------------------------------------------------

export type CompanyInput = Pick<
  Company,
  'name' | 'taxId' | 'taxIdType' | 'country' | 'address' | 'email' | 'locale' | 'currency' | 'stripeCustomerId'
>

export type PurchaseInput = Omit<
  Purchase,
  'id' | 'createdAt' | 'amountRefunded' | 'reservedLicenseId' | 'welcomeSentAt' | 'status'
> & { status?: PurchaseStatus }

export type LicenseInput = Omit<LicenseRecord, 'createdAt' | 'revokedAt' | 'revokedReason' | 'origin'> & { origin?: LicenseOrigin }
export type LicenseRequestInput = Omit<LicenseRequest, 'id' | 'createdAt' | 'status' | 'licenseId' | 'cancelReason' | 'issuedAt' | 'cancelledAt'>
export type InvoiceInput = Omit<InvoiceRecord, 'id' | 'createdAt' | 'approvedAt' | 'sentAt'>
export type VersionFileInput = Omit<VersionFile, 'id' | 'createdAt'>

export interface StripeEventRecord {
  id: string
  type: string
  livemode: boolean
  createdAt: string | null
}

export interface Repository {
  /** Apunta un aviso de Stripe. processed: si ya se proceso entero antes (aviso repetido). */
  recordStripeEvent(event: StripeEventRecord): Promise<{ processed: boolean }>
  markStripeEventProcessed(id: string, outcome: string): Promise<void>

  /**
   * La empresa de ese NIF, creada o completada (el NIF manda: un cliente, una empresa). Si ya existia,
   * no se le cambia el nombre ni los datos: solo se rellena lo que faltaba.
   */
  upsertCompany(input: CompanyInput): Promise<Company>
  getCompany(id: string): Promise<Company | null>
  getCompanyByTaxId(taxId: string): Promise<Company | null>
  getCompanyByStripeCustomer(customerId: string): Promise<Company | null>
  updateCompany(id: string, patch: Partial<Omit<Company, 'id' | 'createdAt'>>): Promise<Company>
  listActiveCompanies(): Promise<Company[]>

  /** Crea la compra si no existe ya ese pago; si existe, la devuelve con created false. */
  createPurchase(input: PurchaseInput): Promise<{ purchase: Purchase; created: boolean }>
  getPurchase(id: string): Promise<Purchase | null>
  getPurchaseByPaymentRef(ref: string): Promise<Purchase | null>
  getPurchaseByPaymentIntent(paymentIntentId: string): Promise<Purchase | null>
  getPurchaseByCheckoutSession(sessionId: string): Promise<Purchase | null>
  updatePurchase(id: string, patch: Partial<Omit<Purchase, 'id' | 'createdAt'>>): Promise<Purchase>
  /**
   * Apunta una devolucion sin volver atras (atomico): amount_refunded solo sube y el estado pasa a
   * refunded (full) o a partially_refunded (si estaba pagada). true si cambio algo.
   */
  recordRefund(purchaseId: string, refundedTotal: number, full: boolean): Promise<boolean>
  /** Reserva el id de licencia de la compra una sola vez: los reintentos usan el mismo. */
  reserveLicenseId(purchaseId: string, licenseId: string): Promise<string>
  listPurchasesByCompany(companyId: string): Promise<Purchase[]>

  /** El siguiente numero de licencia de la web en ese anyo, desde WEB_LICENSE_FIRST (los de antes son del Mac de Eric). */
  nextLicenseNumber(year: number): Promise<number>
  insertLicense(input: LicenseInput): Promise<LicenseRecord>
  getLicense(id: string): Promise<LicenseRecord | null>
  getLicenseByPurchase(purchaseId: string): Promise<LicenseRecord | null>
  listLicensesByCompany(companyId: string): Promise<LicenseRecord[]>
  /** Las licencias emitidas desde esa fecha (ISO), para la conciliacion. */
  listLicensesSince(sinceIso: string): Promise<LicenseRecord[]>
  listRevokedLicenses(): Promise<LicenseRecord[]>
  setLicenseRevoked(id: string, revoked: { at: string; reason: string } | null): Promise<void>

  /** Apunta la licencia a pedir a Eric de una compra, una sola vez (si ya estaba, la devuelve con created false). */
  createLicenseRequest(input: LicenseRequestInput): Promise<{ request: LicenseRequest; created: boolean }>
  getLicenseRequestByPurchase(purchaseId: string): Promise<LicenseRequest | null>
  /** Las pedidas, la mas antigua primero; por estado y por empresa si se dice. */
  listLicenseRequests(filter: { status?: LicenseRequestStatus; companyId?: string; limit?: number }): Promise<LicenseRequest[]>
  /**
   * Cambia la pedida solo si sigue en el estado from (comparar y cambiar, de una vez): null si otro
   * la cambio antes (una subida y una devolucion a la vez). Asi solo una de las dos gana.
   */
  updateLicenseRequest(
    id: string,
    from: LicenseRequestStatus,
    patch: Partial<Pick<LicenseRequest, 'status' | 'licenseId' | 'cancelReason' | 'issuedAt' | 'cancelledAt'>>
  ): Promise<LicenseRequest | null>

  /** Crea la factura por su ref, o devuelve la que ya hay con esa ref. */
  saveInvoice(input: InvoiceInput): Promise<InvoiceRecord>
  getInvoiceByRef(ref: string): Promise<InvoiceRecord | null>
  getInvoice(id: string): Promise<InvoiceRecord | null>
  updateInvoice(id: string, patch: Partial<Omit<InvoiceRecord, 'id' | 'createdAt'>>): Promise<InvoiceRecord>
  listInvoicesByCompany(companyId: string): Promise<InvoiceRecord[]>
  listDraftInvoices(): Promise<InvoiceRecord[]>

  /**
   * Da de alta a una persona (si ya esta activa, la devuelve). Una del equipo (member) no entra si ya
   * estan todas las plazas de la empresa: SeatLimitError (la base de datos lo comprueba con bloqueo).
   */
  addMember(input: { companyId: string; email: string; userId: string | null; role: MemberRole; addedBy: string | null; purchaseId?: string | null }): Promise<Member>
  updateMember(id: string, patch: Partial<Pick<Member, 'userId' | 'role' | 'purchaseId'>>): Promise<Member>
  removeMember(companyId: string, email: string, at: string): Promise<boolean>
  listMembers(companyId: string): Promise<Member[]>
  /** Las altas vigentes de ese usuario o de ese correo, en cualquier empresa. */
  listMembershipsByUser(userId: string): Promise<Member[]>
  listMembershipsByEmail(email: string): Promise<Member[]>

  saveBooking(input: Omit<Booking, 'id' | 'createdAt'>): Promise<Booking>
  updateBooking(id: string, patch: Partial<Omit<Booking, 'id' | 'createdAt'>>): Promise<Booking>
  getBooking(purchaseId: string, number: 1 | 2): Promise<Booking | null>
  listBookingsByCompany(companyId: string): Promise<Booking[]>

  upsertVersion(input: Omit<Version, 'announcedAt' | 'publishedAt'> & { publishedAt?: string }): Promise<Version>
  setVersionAnnounced(id: string, at: string): Promise<void>
  addVersionFiles(files: VersionFileInput[]): Promise<VersionFile[]>
  getLatestVersion(): Promise<{ version: Version; files: VersionFile[] } | null>
  getVersionFile(id: string): Promise<VersionFile | null>

  enqueueJobs(jobs: NewJob[], now: Date): Promise<void>
  claimJobs(limit: number, lockSeconds: number, now: Date): Promise<Job[]>
  completeJob(id: string, result: Record<string, unknown> | null, now: Date): Promise<void>
  /** Un intento fallido: vuelve a pending con next_run_at, o queda dead. */
  failJob(id: string, error: string, next: { runAt: string } | { dead: true }, now: Date): Promise<void>
  markJobAlerted(id: string, now: Date): Promise<void>
  getJobByKey(key: string): Promise<Job | null>
  listJobs(filter: { status?: Job['status']; limit?: number }): Promise<Job[]>
  /** Vuelve a poner en cola un paso muerto, con los intentos a cero. */
  retryJob(id: string, now: Date): Promise<boolean>

  /**
   * Cuenta un intento en una ventana fija de windowSeconds (atomico): allowed false si ya van mas de
   * `limit`. Las claves llevan huellas (HMAC) de la IP o del correo, nunca el dato.
   */
  hitRateLimit(key: string, windowSeconds: number, limit: number, now: Date): Promise<{ allowed: boolean; count: number; resetAt: string }>
  clearRateLimit(key: string): Promise<void>

  reserveLaunchSlot(input: { ref: string; product: string; clientHash: string | null; expiresAt: string; limit: number; clientLimit: number }, now: Date): Promise<boolean>
  setLaunchSlotSession(ref: string, sessionId: string): Promise<void>
  markLaunchSlot(ref: string, status: 'used' | 'released'): Promise<void>
  countLaunchSlotsUsed(): Promise<number>
}

// --- Firma de licencias ----------------------------------------------------------------------

export interface Signer {
  /** Que clave firma: la version de la clave en KMS, o "local-test". */
  readonly keyId: string
  /** La publica, base64 de los 32 bytes (como licencias.pub). */
  publicKey(): Promise<string>
  /** Ed25519 puro sobre los bytes tal cual: 64 bytes. */
  sign(message: Buffer): Promise<Buffer>
}

// --- Facturas ----------------------------------------------------------------------------------

export interface InvoiceLine {
  name: string
  description: string | null
  units: number
  /** Precio unitario sin IVA, en unidades de la moneda (no centimos). */
  price: number
}

export interface InvoiceDraft {
  contactId: string
  /** Texto con el pago de Stripe: sirve para encontrar la factura si un reintento la repite. */
  reference: string
  date: string
  currency: string
  language: Locale
  taxTreatment: TaxTreatment
  taxRate: number | null
  lines: InvoiceLine[]
  /** Lo que va impreso: la inversion del sujeto pasivo, la factura que se rectifica... */
  body: string | null
  notes: string | null
}

export interface ProviderDocument {
  id: string
  number: string | null
  approved: boolean
  /** Total e IVA del documento, en unidades de la moneda, si el proveedor los da: se cruzan con lo que cobro Stripe. */
  total?: number | null
  tax?: number | null
}

export interface Invoicer {
  readonly name: string
  /** El contacto de esa empresa por su NIF; lo crea si no esta. */
  ensureContact(company: Company): Promise<string>
  /** Busca una factura ya creada con esa referencia (un reintento tras un corte). */
  findDocument(kind: InvoiceKind, contactId: string, reference: string): Promise<ProviderDocument | null>
  createDocument(kind: InvoiceKind, draft: InvoiceDraft): Promise<ProviderDocument>
  getDocument(kind: InvoiceKind, id: string): Promise<ProviderDocument>
  /** Emite (aprueba) el documento: con Verifactu activo en Holded, queda registrado. */
  approveDocument(kind: InvoiceKind, id: string): Promise<ProviderDocument>
  sendDocument(kind: InvoiceKind, id: string, email: string, locale: Locale): Promise<void>
  getPdf(kind: InvoiceKind, id: string): Promise<Buffer>
}

// --- Correo -------------------------------------------------------------------------------------

export interface MailAttachment {
  name: string
  content: Buffer
  contentType: string
}

export interface Mail {
  to: string
  subject: string
  html: string
  text: string
  replyTo?: string
  attachments?: MailAttachment[]
  /** Un reintento con la misma clave no manda el correo dos veces (si el proveedor lo admite). */
  idempotencyKey?: string
  tags?: string[]
}

export interface Mailer {
  readonly name: string
  send(mail: Mail): Promise<{ id: string }>
}

// --- Almacen -------------------------------------------------------------------------------------

export type Bucket = 'releases' | 'customer-files'

export interface Storage {
  put(bucket: Bucket, path: string, content: Buffer, contentType: string): Promise<void>
  get(bucket: Bucket, path: string): Promise<Buffer | null>
  exists(bucket: Bucket, path: string): Promise<boolean>
  /** Un enlace firmado que caduca en `expiresInSeconds`. downloadName: el nombre al bajarlo. */
  signedUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string): Promise<string>
}

// --- Calendario de sesiones -------------------------------------------------------------------

export interface Slot {
  host: string
  /** ISO en UTC. */
  start: string
}

export interface BookingResult {
  uid: string
  start: string
  end: string | null
  meetingUrl: string | null
}

/** Al cancelar: cancelada ahora, ya no estaba (cancelada antes o borrada a mano) o ya acabo (nada que hacer). */
export type CancelResult = 'cancelled' | 'gone' | 'ended'

export interface Calendar {
  readonly name: string
  /** Huecos libres de cada persona entre dos instantes (ISO, UTC). */
  availability(fromIso: string, toIso: string): Promise<Slot[]>
  /** Aparta el hueco mientras se paga. Devuelve su id, o null si el proveedor no aparta. */
  reserve(slot: Slot, minutes: number): Promise<string | null>
  release(reservationId: string): Promise<void>
  /** SlotUnavailableError si ya no esta libre. */
  book(input: {
    slot: Slot
    attendee: { name: string; email: string; locale: Locale }
    reservationId: string | null
    metadata: Record<string, string>
  }): Promise<BookingResult>
  /** Cancela una reserva por su uid. Una que ya acabo, ya cancelada o que no existe no es un error. */
  cancel(uid: string, reason: string): Promise<CancelResult>
}

// --- Acceso a la zona -----------------------------------------------------------------------

export interface CookieToSet {
  name: string
  value: string
  options: {
    path?: string
    maxAge?: number
    httpOnly?: boolean
    secure?: boolean
    sameSite?: 'lax' | 'strict' | 'none'
    expires?: Date
  }
}

/** Las cookies de la peticion y las que hay que poner en la respuesta (sin depender de Next). */
export interface CookieJar {
  getAll(): { name: string; value: string }[]
  setAll(cookies: CookieToSet[]): void
}

export interface ZoneUser {
  id: string
  email: string
  /**
   * Las empresas que la base de datos deja ver con la sesion de esa persona (seguridad por filas).
   * La zona solo abre las que salgan tambien aqui: si la logica de la web fallara, la base de datos
   * no daria mas. Sin ella (modo falso, en memoria), manda solo la comprobacion de la web.
   */
  visibleCompanyIds?: () => Promise<string[]>
}

export interface ZoneAuth {
  readonly name: string
  /** La cuenta de ese correo (la crea si no existe). Solo las compras y el titular crean cuentas. */
  ensureUser(email: string): Promise<string>
  /**
   * Manda el codigo de un solo uso. No crea cuentas (shouldCreateUser: false). clientIp: la de quien
   * lo pide, para que los limites del proveedor cuenten por persona y no por el servidor de la web.
   */
  sendCode(email: string, locale: Locale, clientIp?: string | null): Promise<void>
  /** RateLimitedError si el proveedor frena por demasiados intentos. */
  verifyCode(email: string, code: string, jar: CookieJar, clientIp?: string | null): Promise<ZoneUser | null>
  currentUser(jar: CookieJar): Promise<ZoneUser | null>
  signOut(jar: CookieJar): Promise<void>
}

// --- Pagos (Stripe) -----------------------------------------------------------------------------

export interface PaymentStatus {
  exists: boolean
  paid: boolean
  refunded: boolean
  /** Con un contracargo abierto o perdido (uno ganado, o una peticion de informacion, no cuenta). */
  disputed: boolean
  amount: number | null
}

/** Lo que dice Stripe Tax de un cobro: el motivo de cada impuesto y los NIF del cliente con su verificacion. */
export interface TaxDetails {
  /** taxability_reason de cada linea de impuesto (standard_rated, reverse_charge, not_collecting...). */
  reasons: string[]
  amountTax: number | null
  taxIds: { type: string; value: string; verification: string | null }[]
}

export interface RefundInfo {
  id: string
  amount: number
  status: string | null
}

export interface Payments {
  readonly name: string
  /** El precio de Stripe por su lookup_key (cerebro-<producto>). */
  priceId(lookupKey: string): Promise<string>
  createCheckoutSession(params: Record<string, unknown>): Promise<{ id: string; url: string; expiresAt: number }>
  createPortalSession(customerId: string, returnUrl: string): Promise<string>
  /** La factura de suscripcion que cobro ese PaymentIntent (para las devoluciones del mensual). */
  invoiceIdForPaymentIntent(paymentIntentId: string): Promise<string | null>
  /** Si el pago (pi_..., in_... o cs_...) existe en Stripe y en que estado. */
  paymentStatus(ref: string): Promise<PaymentStatus>
  /** Las devoluciones de un cobro, cada una con su id y su importe (del aviso, o preguntando a Stripe). */
  refundsOf(charge: { id: string; refunds?: { data?: unknown[]; has_more?: boolean } | null }): Promise<RefundInfo[]>
  /** El IVA de Stripe Tax de una sesion de Checkout o de una factura del mensual, y los NIF del cliente. */
  taxDetails(input: { checkoutSessionId?: string | null; invoiceId?: string | null; customerId?: string | null }): Promise<TaxDetails>
  /** El lookup_key de un precio (de que plan es un cobro tras cambiar de plan en el portal). */
  priceLookupKey(priceId: string): Promise<string | null>
  /** Cancela la suscripcion ya, si sigue viva. false si ya estaba cancelada o no existe. */
  cancelSubscription(subscriptionId: string): Promise<boolean>
  /** Sesiones de Checkout pagadas y facturas del mensual cobradas desde esa fecha (Unix). */
  listPaidCheckoutSessions(sinceUnix: number): Promise<Record<string, unknown>[]>
  listPaidInvoices(sinceUnix: number): Promise<Record<string, unknown>[]>
}

/** El motivo con el que queda una factura en borrador que ya no esta en Holded (borrada a mano). */
export const INVOICE_DELETED_IN_HOLDED = 'Borrado en Holded a mano'
