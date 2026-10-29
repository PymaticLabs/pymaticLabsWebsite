// El repositorio en Supabase (Postgres en la UE), con la clave service_role: solo en el servidor.
// Las tablas, las funciones atomicas (secuencia de licencias, cola, plazas de lanzamiento) y la
// seguridad por filas estan en supabase/migrations/.
//
// Las columnas son las de los tipos en snake_case (taxId -> tax_id). Lo unico va por claves unicas
// de la base de datos: dos avisos a la vez del mismo pago no crean dos compras.

import { createClient, type PostgrestError, type SupabaseClient } from '@supabase/supabase-js'
import { compareVersions } from './memory-repository.ts'
import { requireEnv } from './http.ts'
import { WEB_LICENSE_FIRST } from '../license-issue.ts'
import {
  RetryableError,
  SeatLimitError,
  type Booking,
  type Company,
  type CompanyInput,
  type InvoiceInput,
  type InvoiceRecord,
  type Job,
  type LicenseInput,
  type LicenseRecord,
  type LicenseRequest,
  type LicenseRequestInput,
  type LicenseRequestStatus,
  type Member,
  type NewJob,
  type Purchase,
  type PurchaseInput,
  type Repository,
  type StripeEventRecord,
  type Version,
  type VersionFile,
  type VersionFileInput,
} from '../types.ts'

type Row = Record<string, unknown>

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function toRow(value: object): Row {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [snake(k), v]))
}

function fromRow<T>(row: Row | null | undefined): T {
  if (!row) return row as T
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v])) as T
}

function fromJob(row: Row): Job {
  const job = fromRow<Job>(row)
  return { ...job, id: String(row.id) }
}

const UNIQUE = '23505'
/** La tabla no existe (PostgREST no la conoce, o Postgres no la tiene). */
const NO_TABLE = ['PGRST205', '42P01']

function fail(what: string, error: PostgrestError): never {
  throw new RetryableError(`Supabase ${what}: ${error.message}`)
}

// Los ids que llegan de una URL o de un cuerpo: uno que no es uuid (o, en la cola, numero) no existe.
// Sin esto Postgres responde 22P02, que sale como RetryableError (un 500) en vez de un 404.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (id: string) => UUID.test(id)
const isJobId = (id: string) => /^[0-9]{1,15}$/.test(id)

export class SupabaseRepository implements Repository {
  private db: SupabaseClient

  constructor(env: Record<string, string | undefined>) {
    this.db = createClient(requireEnv(env, 'SUPABASE_URL'), requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
      db: { schema: 'public' },
    })
  }

  private async one<T>(what: string, query: PromiseLike<{ data: unknown; error: PostgrestError | null }>): Promise<T | null> {
    const { data, error } = await query
    if (error) fail(what, error)
    return data ? fromRow<T>(data as Row) : null
  }

  private async many<T>(
    what: string,
    query: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
    map: (row: Row) => T = (row) => fromRow<T>(row)
  ): Promise<T[]> {
    const { data, error } = await query
    if (error) fail(what, error)
    return ((data as Row[] | null) ?? []).map((row) => map(row))
  }

  async recordStripeEvent(event: StripeEventRecord) {
    const { error } = await this.db
      .from('stripe_events')
      .upsert({ id: event.id, type: event.type, livemode: event.livemode, stripe_created_at: event.createdAt }, { onConflict: 'id', ignoreDuplicates: true })
    if (error) fail('stripe_events', error)
    const row = await this.one<{ processedAt: string | null }>('stripe_events', this.db.from('stripe_events').select('processed_at').eq('id', event.id).maybeSingle())
    return { processed: Boolean(row?.processedAt) }
  }

  async markStripeEventProcessed(id: string, outcome: string) {
    const { error } = await this.db.from('stripe_events').update({ processed_at: new Date().toISOString(), outcome }).eq('id', id)
    if (error) fail('stripe_events', error)
  }

  async upsertCompany(input: CompanyInput): Promise<Company> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.getCompanyByTaxId(input.taxId)
      if (existing) {
        // La empresa ya estaba: ni el nombre ni sus datos cambian por otra compra; solo se completa lo que faltaba.
        const patch: Partial<Company> = {}
        if (!existing.country && input.country) patch.country = input.country
        if (!existing.address && input.address) patch.address = input.address
        if (!existing.taxIdType && input.taxIdType) patch.taxIdType = input.taxIdType
        if (!existing.stripeCustomerId && input.stripeCustomerId) patch.stripeCustomerId = input.stripeCustomerId
        return Object.keys(patch).length ? this.updateCompany(existing.id, patch) : existing
      }
      const { data, error } = await this.db.from('companies').insert(toRow(input)).select('*').single()
      if (!error) return fromRow<Company>(data)
      if (error.code !== UNIQUE) fail('companies', error)
      // Otra compra de la misma empresa la acaba de crear: se vuelve a leer.
    }
    throw new RetryableError('Supabase companies: no se pudo crear ni leer la empresa')
  }

  async getCompany(id: string) {
    if (!isUuid(id)) return null
    return this.one<Company>('companies', this.db.from('companies').select('*').eq('id', id).maybeSingle())
  }

  async getCompanyByTaxId(taxId: string) {
    return this.one<Company>('companies', this.db.from('companies').select('*').eq('tax_id', taxId).maybeSingle())
  }

  async getCompanyByStripeCustomer(customerId: string) {
    return this.one<Company>('companies', this.db.from('companies').select('*').eq('stripe_customer_id', customerId).maybeSingle())
  }

  async updateCompany(id: string, patch: Partial<Omit<Company, 'id' | 'createdAt'>>) {
    const company = await this.one<Company>('companies', this.db.from('companies').update(toRow(patch)).eq('id', id).select('*').single())
    if (!company) throw new RetryableError(`no existe la empresa ${id}`)
    return company
  }

  async listActiveCompanies() {
    return this.many<Company>('companies', this.db.from('companies').select('*').is('access_revoked_at', null))
  }

  async createPurchase(input: PurchaseInput) {
    const { data, error } = await this.db.from('purchases').insert(toRow(input)).select('*').single()
    if (!error) return { purchase: fromRow<Purchase>(data), created: true }
    if (error.code !== UNIQUE) fail('purchases', error)
    const existing =
      (await this.getPurchaseByPaymentRef(input.paymentRef)) ??
      (input.stripeCheckoutSessionId ? await this.getPurchaseByCheckoutSession(input.stripeCheckoutSessionId) : null) ??
      (input.stripeInvoiceId
        ? await this.one<Purchase>('purchases', this.db.from('purchases').select('*').eq('stripe_invoice_id', input.stripeInvoiceId).maybeSingle())
        : null)
    if (!existing) fail('purchases', error)
    return { purchase: existing, created: false }
  }

  async getPurchase(id: string) {
    if (!isUuid(id)) return null
    return this.one<Purchase>('purchases', this.db.from('purchases').select('*').eq('id', id).maybeSingle())
  }

  async getPurchaseByPaymentRef(ref: string) {
    return this.one<Purchase>('purchases', this.db.from('purchases').select('*').eq('payment_ref', ref).maybeSingle())
  }

  async getPurchaseByPaymentIntent(paymentIntentId: string) {
    return this.one<Purchase>('purchases', this.db.from('purchases').select('*').eq('stripe_payment_intent_id', paymentIntentId).maybeSingle())
  }

  async getPurchaseByCheckoutSession(sessionId: string) {
    return this.one<Purchase>('purchases', this.db.from('purchases').select('*').eq('stripe_checkout_session_id', sessionId).maybeSingle())
  }

  async updatePurchase(id: string, patch: Partial<Omit<Purchase, 'id' | 'createdAt'>>) {
    const purchase = await this.one<Purchase>('purchases', this.db.from('purchases').update(toRow(patch)).eq('id', id).select('*').single())
    if (!purchase) throw new RetryableError(`no existe la compra ${id}`)
    return purchase
  }

  async recordRefund(purchaseId: string, refundedTotal: number, full: boolean) {
    const { data, error } = await this.db.rpc('record_refund', { p_id: purchaseId, p_total: refundedTotal, p_full: full })
    if (error) fail('record_refund', error)
    return data === true
  }

  async reserveLicenseId(purchaseId: string, licenseId: string) {
    const { error } = await this.db.from('purchases').update({ reserved_license_id: licenseId }).eq('id', purchaseId).is('reserved_license_id', null)
    if (error && error.code !== UNIQUE) fail('purchases', error)
    const purchase = await this.getPurchase(purchaseId)
    if (!purchase?.reservedLicenseId) throw new RetryableError(`no se pudo reservar el id de licencia de ${purchaseId}`)
    return purchase.reservedLicenseId
  }

  async listPurchasesByCompany(companyId: string) {
    return this.many<Purchase>('purchases', this.db.from('purchases').select('*').eq('company_id', companyId).order('paid_at'))
  }

  async nextLicenseNumber(year: number) {
    const { data, error } = await this.db.rpc('next_license_number', { p_year: year, p_first: WEB_LICENSE_FIRST })
    if (error) fail('next_license_number', error)
    return Number(data)
  }

  async insertLicense(input: LicenseInput) {
    const license = await this.one<LicenseRecord>('licenses', this.db.from('licenses').insert(toRow(input)).select('*').single())
    if (!license) throw new RetryableError('Supabase licenses: no se guardo la licencia')
    return license
  }

  async getLicense(id: string) {
    return this.one<LicenseRecord>('licenses', this.db.from('licenses').select('*').eq('id', id).maybeSingle())
  }

  async getLicenseByPurchase(purchaseId: string) {
    return this.one<LicenseRecord>('licenses', this.db.from('licenses').select('*').eq('purchase_id', purchaseId).maybeSingle())
  }

  async listLicensesByCompany(companyId: string) {
    return this.many<LicenseRecord>('licenses', this.db.from('licenses').select('*').eq('company_id', companyId).order('id'))
  }

  async listLicensesSince(sinceIso: string) {
    return this.many<LicenseRecord>('licenses', this.db.from('licenses').select('*').gte('created_at', sinceIso).order('id'))
  }

  async listRevokedLicenses() {
    return this.many<LicenseRecord>('licenses', this.db.from('licenses').select('*').not('revoked_at', 'is', null).order('id'))
  }

  async setLicenseRevoked(id: string, revoked: { at: string; reason: string } | null) {
    const { error } = await this.db
      .from('licenses')
      .update({ revoked_at: revoked?.at ?? null, revoked_reason: revoked?.reason ?? null })
      .eq('id', id)
    if (error) fail('licenses', error)
  }

  async createLicenseRequest(input: LicenseRequestInput) {
    const { data, error } = await this.db.from('license_requests').insert(toRow(input)).select('*').single()
    if (!error) return { request: fromRow<LicenseRequest>(data), created: true }
    if (error.code !== UNIQUE) fail('license_requests', error)
    // Un reintento del paso: ya estaba pedida.
    const existing = await this.getLicenseRequestByPurchase(input.purchaseId)
    if (!existing) fail('license_requests', error)
    return { request: existing, created: false }
  }

  // Sin la migracion de las licencias a mano (20261021130000) aplicada, leer las pedidas da "ninguna":
  // asi la zona, las devoluciones y los avisos siguen funcionando con LICENSE_MODE=kms. Apuntar una
  // si falla (el paso license se reintenta y avisa), y la comprobacion de produccion lo dice.
  async getLicenseRequestByPurchase(purchaseId: string) {
    const { data, error } = await this.db.from('license_requests').select('*').eq('purchase_id', purchaseId).maybeSingle()
    if (error && NO_TABLE.includes(error.code)) return null
    if (error) fail('license_requests', error)
    return data ? fromRow<LicenseRequest>(data) : null
  }

  async listLicenseRequests(filter: { status?: LicenseRequestStatus; companyId?: string; limit?: number }) {
    let query = this.db.from('license_requests').select('*').order('created_at').limit(filter.limit ?? 500)
    if (filter.status) query = query.eq('status', filter.status)
    if (filter.companyId) query = query.eq('company_id', filter.companyId)
    const { data, error } = await query
    if (error && NO_TABLE.includes(error.code)) return []
    if (error) fail('license_requests', error)
    return ((data as Row[] | null) ?? []).map((row) => fromRow<LicenseRequest>(row))
  }

  async updateLicenseRequest(id: string, from: LicenseRequestStatus, patch: Partial<Pick<LicenseRequest, 'status' | 'licenseId' | 'cancelReason' | 'issuedAt' | 'cancelledAt'>>) {
    // Un solo update con el estado de antes en el where: si otro la cambio, no toca ninguna fila.
    return this.one<LicenseRequest>('license_requests', this.db.from('license_requests').update(toRow(patch)).eq('id', id).eq('status', from).select('*').maybeSingle())
  }

  async saveInvoice(input: InvoiceInput) {
    const { data, error } = await this.db.from('invoices').insert(toRow(input)).select('*').single()
    if (!error) return fromRow<InvoiceRecord>(data)
    if (error.code !== UNIQUE) fail('invoices', error)
    const existing = await this.getInvoiceByRef(input.ref)
    if (!existing) fail('invoices', error)
    return existing
  }

  async getInvoiceByRef(ref: string) {
    return this.one<InvoiceRecord>('invoices', this.db.from('invoices').select('*').eq('ref', ref).maybeSingle())
  }

  async getInvoice(id: string) {
    if (!isUuid(id)) return null
    return this.one<InvoiceRecord>('invoices', this.db.from('invoices').select('*').eq('id', id).maybeSingle())
  }

  async updateInvoice(id: string, patch: Partial<Omit<InvoiceRecord, 'id' | 'createdAt'>>) {
    const invoice = await this.one<InvoiceRecord>('invoices', this.db.from('invoices').update(toRow(patch)).eq('id', id).select('*').single())
    if (!invoice) throw new RetryableError(`no existe la factura ${id}`)
    return invoice
  }

  async listInvoicesByCompany(companyId: string) {
    return this.many<InvoiceRecord>('invoices', this.db.from('invoices').select('*').eq('company_id', companyId).order('created_at'))
  }

  async listDraftInvoices() {
    return this.many<InvoiceRecord>('invoices', this.db.from('invoices').select('*').eq('status', 'draft'))
  }

  async addMember(input: { companyId: string; email: string; userId: string | null; role: Member['role']; addedBy: string | null; purchaseId?: string | null }) {
    const email = input.email.toLowerCase()
    for (let attempt = 0; attempt < 2; attempt++) {
      const existing = await this.one<Member>(
        'members',
        this.db.from('members').select('*').eq('company_id', input.companyId).eq('email', email).is('removed_at', null).maybeSingle()
      )
      if (existing) {
        const patch: Row = {}
        if (!existing.userId && input.userId) patch.user_id = input.userId
        if (input.role === 'owner' && existing.role !== 'owner') Object.assign(patch, { role: 'owner', purchase_id: input.purchaseId ?? null })
        if (!Object.keys(patch).length) return existing
        const updated = await this.one<Member>('members', this.db.from('members').update(patch).eq('id', existing.id).select('*').single())
        return updated ?? existing
      }
      const { data, error } = await this.db.from('members').insert(toRow({ ...input, purchaseId: input.purchaseId ?? null, email })).select('*').single()
      if (!error) return fromRow<Member>(data)
      // El disparador members_seat_limit: el equipo ya ocupa todas las plazas.
      if (error.message?.includes('seat_limit')) throw new SeatLimitError()
      if (error.code !== UNIQUE) fail('members', error)
    }
    throw new RetryableError('Supabase members: no se pudo dar de alta')
  }

  async updateMember(id: string, patch: Partial<Pick<Member, 'userId' | 'role' | 'purchaseId'>>) {
    const member = await this.one<Member>('members', this.db.from('members').update(toRow(patch)).eq('id', id).select('*').single())
    if (!member) throw new RetryableError(`no existe la persona ${id}`)
    return member
  }

  async removeMember(companyId: string, email: string, at: string) {
    const removed = await this.many<Member>(
      'members',
      this.db.from('members').update({ removed_at: at }).eq('company_id', companyId).eq('email', email.toLowerCase()).is('removed_at', null).select('*')
    )
    return removed.length > 0
  }

  async listMembers(companyId: string) {
    return this.many<Member>('members', this.db.from('members').select('*').eq('company_id', companyId).is('removed_at', null).order('created_at'))
  }

  async listMembershipsByUser(userId: string) {
    return this.many<Member>('members', this.db.from('members').select('*').eq('user_id', userId).is('removed_at', null))
  }

  async listMembershipsByEmail(email: string) {
    return this.many<Member>('members', this.db.from('members').select('*').eq('email', email.toLowerCase()).is('removed_at', null))
  }

  async saveBooking(input: Omit<Booking, 'id' | 'createdAt'>) {
    const { data, error } = await this.db.from('bookings').insert(toRow(input)).select('*').single()
    if (!error) return fromRow<Booking>(data)
    if (error.code !== UNIQUE) fail('bookings', error)
    const existing = await this.getBooking(input.purchaseId, input.number)
    if (!existing) fail('bookings', error)
    return existing
  }

  async updateBooking(id: string, patch: Partial<Omit<Booking, 'id' | 'createdAt'>>) {
    const booking = await this.one<Booking>('bookings', this.db.from('bookings').update(toRow(patch)).eq('id', id).select('*').single())
    if (!booking) throw new RetryableError(`no existe la reserva ${id}`)
    return booking
  }

  async getBooking(purchaseId: string, number: 1 | 2) {
    return this.one<Booking>('bookings', this.db.from('bookings').select('*').eq('purchase_id', purchaseId).eq('number', number).maybeSingle())
  }

  async listBookingsByCompany(companyId: string) {
    return this.many<Booking>('bookings', this.db.from('bookings').select('*').eq('company_id', companyId).order('start_at'))
  }

  async upsertVersion(input: Omit<Version, 'announcedAt' | 'publishedAt'> & { publishedAt?: string }) {
    const row: Row = { id: input.id, notes_es: input.notesEs, notes_en: input.notesEn }
    if (input.publishedAt) row.published_at = input.publishedAt
    const version = await this.one<Version>('versions', this.db.from('versions').upsert(row, { onConflict: 'id' }).select('*').single())
    if (!version) throw new RetryableError('Supabase versions: no se guardo la version')
    return version
  }

  async setVersionAnnounced(id: string, at: string) {
    const { error } = await this.db.from('versions').update({ announced_at: at }).eq('id', id)
    if (error) fail('versions', error)
  }

  async addVersionFiles(files: VersionFileInput[]) {
    if (!files.length) return []
    const { error } = await this.db.from('version_files').upsert(files.map(toRow), { onConflict: 'storage_path', ignoreDuplicates: true })
    if (error) fail('version_files', error)
    return this.many<VersionFile>('version_files', this.db.from('version_files').select('*').in('storage_path', files.map((f) => f.storagePath)))
  }

  async getLatestVersion() {
    const versions = await this.many<Version>('versions', this.db.from('versions').select('*'))
    if (!versions.length) return null
    const version = versions.sort((a, b) => compareVersions(b.id, a.id))[0]
    const files = await this.many<VersionFile>('version_files', this.db.from('version_files').select('*').eq('version_id', version.id))
    return { version, files }
  }

  async listVersions() {
    return this.many<Version>('versions', this.db.from('versions').select('*'))
  }

  async getVersionFile(id: string) {
    if (!isUuid(id)) return null
    return this.one<VersionFile>('version_files', this.db.from('version_files').select('*').eq('id', id).maybeSingle())
  }

  async enqueueJobs(jobs: NewJob[], now: Date) {
    if (!jobs.length) return
    const rows = jobs.map((job) => ({
      key: job.key,
      kind: job.kind,
      payload: job.payload ?? {},
      depends_on: job.dependsOn ?? [],
      max_attempts: job.maxAttempts ?? 10,
      next_run_at: job.runAt ?? now.toISOString(),
    }))
    const { error } = await this.db.from('jobs').upsert(rows, { onConflict: 'key', ignoreDuplicates: true })
    if (error) fail('jobs', error)
  }

  async claimJobs(limit: number, lockSeconds: number) {
    const { data, error } = await this.db.rpc('claim_jobs', { p_limit: limit, p_lock_seconds: lockSeconds })
    if (error) fail('claim_jobs', error)
    return ((data as Row[] | null) ?? []).map(fromJob)
  }

  async completeJob(id: string, result: Record<string, unknown> | null, now: Date) {
    if (!isJobId(id)) return
    const at = now.toISOString()
    const { error } = await this.db
      .from('jobs')
      .update({ status: 'done', result, locked_until: null, last_error: null, updated_at: at, done_at: at })
      .eq('id', Number(id))
    if (error) fail('jobs', error)
  }

  async failJob(id: string, message: string, next: { runAt: string } | { dead: true }, now: Date) {
    if (!isJobId(id)) return
    const patch: Row = { last_error: message.slice(0, 2000), locked_until: null, updated_at: now.toISOString() }
    if ('dead' in next) patch.status = 'dead'
    else Object.assign(patch, { status: 'pending', next_run_at: next.runAt })
    const { error } = await this.db.from('jobs').update(patch).eq('id', Number(id))
    if (error) fail('jobs', error)
  }

  async markJobAlerted(id: string, now: Date) {
    if (!isJobId(id)) return
    const { error } = await this.db.from('jobs').update({ alerted_at: now.toISOString() }).eq('id', Number(id))
    if (error) fail('jobs', error)
  }

  async getJobByKey(key: string) {
    const { data, error } = await this.db.from('jobs').select('*').eq('key', key).maybeSingle()
    if (error) fail('jobs', error)
    return data ? fromJob(data) : null
  }

  async listJobs(filter: { status?: Job['status']; limit?: number }) {
    let query = this.db.from('jobs').select('*').order('id', { ascending: false }).limit(filter.limit ?? 100)
    if (filter.status) query = query.eq('status', filter.status)
    return this.many<Job>('jobs', query, fromJob)
  }

  async retryJob(id: string, now: Date) {
    if (!isJobId(id)) return false
    const rows = await this.many<Job>(
      'jobs',
      this.db
        .from('jobs')
        .update({ status: 'pending', attempts: 0, next_run_at: now.toISOString(), alerted_at: null, updated_at: now.toISOString() })
        .eq('id', Number(id))
        .eq('status', 'dead')
        .select('*'),
      fromJob
    )
    return rows.length > 0
  }

  /**
   * Los pasos pendientes de esa clave dejan de esperar a dependency (lib/delivery/jobs.ts, un paso
   * parado). Uno a uno, y solo si siguen pendientes (claim_jobs no cambia depends_on: nadie mas la toca).
   */
  async releaseDependency(dependency: string, keyPrefix: string, now: Date) {
    // El prefijo, sin comodines de like (las claves llevan uuid y dos puntos).
    const pattern = `${keyPrefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const rows = await this.many<Job>(
      'jobs',
      this.db.from('jobs').select('*').like('key', pattern).eq('status', 'pending').contains('depends_on', [dependency]),
      fromJob
    )
    let released = 0
    for (const job of rows) {
      const { data, error } = await this.db
        .from('jobs')
        .update({ depends_on: job.dependsOn.filter((key) => key !== dependency), updated_at: now.toISOString() })
        .eq('id', Number(job.id))
        .eq('status', 'pending')
        .select('id')
      if (error) fail('jobs', error)
      if ((data as unknown[] | null)?.length) released += 1
    }
    return released
  }

  async reserveLaunchSlot(input: { ref: string; product: string; clientHash: string | null; expiresAt: string; limit: number; clientLimit: number }) {
    const { data, error } = await this.db.rpc('reserve_launch_slot', {
      p_ref: input.ref,
      p_product: input.product,
      p_client_hash: input.clientHash,
      p_expires_at: input.expiresAt,
      p_limit: input.limit,
      p_client_limit: input.clientLimit,
    })
    if (error) fail('reserve_launch_slot', error)
    return data === true
  }

  async hitRateLimit(key: string, windowSeconds: number, limit: number) {
    const { data, error } = await this.db.rpc('rate_limit_hit', { p_key: key, p_window_seconds: windowSeconds })
    if (error) fail('rate_limit_hit', error)
    const row = (Array.isArray(data) ? data[0] : data) as { hits: number; reset_at: string } | null
    const count = Number(row?.hits ?? 0)
    return { allowed: count <= limit, count, resetAt: String(row?.reset_at ?? '') }
  }

  async clearRateLimit(key: string) {
    const { error } = await this.db.from('rate_limits').delete().eq('key', key)
    if (error) fail('rate_limits', error)
  }

  async setLaunchSlotSession(ref: string, sessionId: string) {
    const { error } = await this.db.from('launch_slots').update({ checkout_session_id: sessionId }).eq('ref', ref)
    if (error) fail('launch_slots', error)
  }

  async markLaunchSlot(ref: string, status: 'used' | 'released') {
    const { error } = await this.db.from('launch_slots').update({ status }).eq('ref', ref).neq('status', 'used')
    if (error) fail('launch_slots', error)
  }

  async countLaunchSlotsUsed() {
    const { count, error } = await this.db.from('launch_slots').select('ref', { count: 'exact', head: true }).eq('status', 'used')
    if (error) fail('launch_slots', error)
    return count ?? 0
  }

  async listOpenLaunchSlots(clientHash: string, now: Date) {
    const { data, error } = await this.db
      .from('launch_slots')
      .select('ref, checkout_session_id')
      .eq('client_hash', clientHash)
      .eq('status', 'reserved')
      .gt('expires_at', now.toISOString())
      .order('created_at', { ascending: true })
    if (error) fail('launch_slots', error)
    return ((data ?? []) as { ref: string; checkout_session_id: string | null }[]).map((r) => ({ ref: r.ref, sessionId: r.checkout_session_id }))
  }
}
