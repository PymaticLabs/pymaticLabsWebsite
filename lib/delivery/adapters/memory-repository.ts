// El repositorio en memoria: el de las pruebas y el del modo falso. Reproduce lo que garantiza la
// base de datos (claves unicas, la secuencia atomica de licencias, la cola con dependencias y
// bloqueos) para que lo que pasa aqui pase igual en Supabase.
//
// JavaScript corre de uno en uno: cada metodo hace su lectura y su escritura sin await entre
// medias, asi que es tan atomico como una funcion de SQL.

import { WEB_LICENSE_FIRST } from '../license-issue.ts'
import { newId } from '../util.ts'
import { SeatLimitError } from '../types.ts'
import type {
  Booking,
  Company,
  CompanyInput,
  InvoiceInput,
  InvoiceRecord,
  Job,
  LicenseInput,
  LicenseRecord,
  Member,
  NewJob,
  Purchase,
  PurchaseInput,
  Repository,
  StripeEventRecord,
  Version,
  VersionFile,
  VersionFileInput,
} from '../types.ts'

export interface MemoryState {
  events: Record<string, StripeEventRecord & { processedAt: string | null; outcome: string | null }>
  companies: Record<string, Company>
  purchases: Record<string, Purchase>
  licenses: Record<string, LicenseRecord>
  invoices: Record<string, InvoiceRecord>
  members: Record<string, Member>
  bookings: Record<string, Booking>
  versions: Record<string, Version>
  versionFiles: Record<string, VersionFile>
  jobs: Record<string, Job>
  sequences: Record<string, number>
  launchSlots: Record<string, { ref: string; product: string; clientHash: string | null; status: string; expiresAt: string; sessionId: string | null }>
  rateLimits: Record<string, { count: number; expiresAt: string }>
  jobCounter: number
}

export function emptyMemoryState(): MemoryState {
  return {
    events: {},
    companies: {},
    purchases: {},
    licenses: {},
    invoices: {},
    members: {},
    bookings: {},
    versions: {},
    versionFiles: {},
    jobs: {},
    sequences: {},
    launchSlots: {},
    rateLimits: {},
    jobCounter: 0,
  }
}

const copy = <T>(value: T): T => structuredClone(value)

export class MemoryRepository implements Repository {
  state: MemoryState
  clock: () => Date

  constructor(state: MemoryState = emptyMemoryState(), clock: () => Date = () => new Date()) {
    this.state = state
    this.clock = clock
  }

  private now(): string {
    return this.clock().toISOString()
  }

  async recordStripeEvent(event: StripeEventRecord) {
    const existing = this.state.events[event.id]
    if (existing) return { processed: existing.processedAt !== null }
    this.state.events[event.id] = { ...event, processedAt: null, outcome: null }
    return { processed: false }
  }

  async markStripeEventProcessed(id: string, outcome: string) {
    const event = this.state.events[id]
    if (event) Object.assign(event, { processedAt: this.now(), outcome })
  }

  async upsertCompany(input: CompanyInput) {
    const existing = Object.values(this.state.companies).find((c) => c.taxId === input.taxId)
    if (existing) {
      // La empresa ya estaba: se queda con su nombre y sus datos (otra compra con el mismo NIF no los
      // cambia); solo se completa lo que faltaba.
      Object.assign(existing, {
        country: existing.country ?? input.country,
        address: existing.address ?? input.address,
        taxIdType: existing.taxIdType ?? input.taxIdType,
        stripeCustomerId: existing.stripeCustomerId ?? input.stripeCustomerId,
      })
      return copy(existing)
    }
    if (input.stripeCustomerId && Object.values(this.state.companies).some((c) => c.stripeCustomerId === input.stripeCustomerId)) {
      throw new Error(`el cliente de Stripe ${input.stripeCustomerId} ya es de otra empresa`)
    }
    const company: Company = {
      ...input,
      id: newId(),
      holdedContactId: null,
      seats: 1,
      subscriptionId: null,
      subscriptionStatus: null,
      subscriptionPlan: null,
      subscriptionEventAt: null,
      accessRevokedAt: null,
      createdAt: this.now(),
    }
    this.state.companies[company.id] = company
    return copy(company)
  }

  async getCompany(id: string) {
    const company = this.state.companies[id]
    return company ? copy(company) : null
  }

  async getCompanyByTaxId(taxId: string) {
    const company = Object.values(this.state.companies).find((c) => c.taxId === taxId)
    return company ? copy(company) : null
  }

  async getCompanyByStripeCustomer(customerId: string) {
    const company = Object.values(this.state.companies).find((c) => c.stripeCustomerId === customerId)
    return company ? copy(company) : null
  }

  async updateCompany(id: string, patch: Partial<Omit<Company, 'id' | 'createdAt'>>) {
    const company = this.state.companies[id]
    if (!company) throw new Error(`no existe la empresa ${id}`)
    Object.assign(company, patch)
    return copy(company)
  }

  async listActiveCompanies() {
    return copy(Object.values(this.state.companies).filter((c) => !c.accessRevokedAt))
  }

  async createPurchase(input: PurchaseInput) {
    const existing = Object.values(this.state.purchases).find(
      (p) =>
        p.paymentRef === input.paymentRef ||
        (input.stripeCheckoutSessionId && p.stripeCheckoutSessionId === input.stripeCheckoutSessionId) ||
        (input.stripeInvoiceId && p.stripeInvoiceId === input.stripeInvoiceId)
    )
    if (existing) return { purchase: copy(existing), created: false }
    const purchase: Purchase = {
      ...input,
      status: input.status ?? 'paid',
      id: newId(),
      amountRefunded: 0,
      reservedLicenseId: null,
      welcomeSentAt: null,
      createdAt: this.now(),
    }
    this.state.purchases[purchase.id] = purchase
    return { purchase: copy(purchase), created: true }
  }

  async getPurchase(id: string) {
    const purchase = this.state.purchases[id]
    return purchase ? copy(purchase) : null
  }

  private findPurchase(test: (p: Purchase) => boolean) {
    const purchase = Object.values(this.state.purchases).find(test)
    return purchase ? copy(purchase) : null
  }

  async getPurchaseByPaymentRef(ref: string) {
    return this.findPurchase((p) => p.paymentRef === ref)
  }

  async getPurchaseByPaymentIntent(paymentIntentId: string) {
    return this.findPurchase((p) => p.stripePaymentIntentId === paymentIntentId)
  }

  async getPurchaseByCheckoutSession(sessionId: string) {
    return this.findPurchase((p) => p.stripeCheckoutSessionId === sessionId)
  }

  async updatePurchase(id: string, patch: Partial<Omit<Purchase, 'id' | 'createdAt'>>) {
    const purchase = this.state.purchases[id]
    if (!purchase) throw new Error(`no existe la compra ${id}`)
    Object.assign(purchase, patch)
    return copy(purchase)
  }

  async recordRefund(purchaseId: string, refundedTotal: number, full: boolean) {
    const purchase = this.state.purchases[purchaseId]
    if (!purchase) throw new Error(`no existe la compra ${purchaseId}`)
    const amount = Math.max(purchase.amountRefunded, refundedTotal)
    const status = full ? 'refunded' : purchase.status === 'paid' ? 'partially_refunded' : purchase.status
    const changed = amount !== purchase.amountRefunded || status !== purchase.status
    Object.assign(purchase, { amountRefunded: amount, status })
    return changed
  }

  async reserveLicenseId(purchaseId: string, licenseId: string) {
    const purchase = this.state.purchases[purchaseId]
    if (!purchase) throw new Error(`no existe la compra ${purchaseId}`)
    if (!purchase.reservedLicenseId) purchase.reservedLicenseId = licenseId
    return purchase.reservedLicenseId
  }

  async listPurchasesByCompany(companyId: string) {
    return copy(Object.values(this.state.purchases).filter((p) => p.companyId === companyId))
  }

  async nextLicenseNumber(year: number) {
    const next = (this.state.sequences[year] ?? WEB_LICENSE_FIRST - 1) + 1
    if (next > 9999) throw new Error(`la secuencia de licencias de ${year} se ha acabado`)
    this.state.sequences[year] = next
    return next
  }

  async insertLicense(input: LicenseInput) {
    if (this.state.licenses[input.id]) throw new Error(`la licencia ${input.id} ya existe`)
    if (Object.values(this.state.licenses).some((l) => l.purchaseId === input.purchaseId)) {
      throw new Error(`la compra ${input.purchaseId} ya tiene licencia`)
    }
    const license: LicenseRecord = { ...input, revokedAt: null, revokedReason: null, createdAt: this.now() }
    this.state.licenses[license.id] = license
    return copy(license)
  }

  async getLicense(id: string) {
    const license = this.state.licenses[id]
    return license ? copy(license) : null
  }

  async getLicenseByPurchase(purchaseId: string) {
    const license = Object.values(this.state.licenses).find((l) => l.purchaseId === purchaseId)
    return license ? copy(license) : null
  }

  async listLicensesByCompany(companyId: string) {
    return copy(Object.values(this.state.licenses).filter((l) => l.companyId === companyId)).sort((a, b) => a.id.localeCompare(b.id))
  }

  async listLicensesSince(sinceIso: string) {
    return copy(Object.values(this.state.licenses).filter((l) => l.createdAt >= sinceIso))
  }

  async listRevokedLicenses() {
    return copy(Object.values(this.state.licenses).filter((l) => l.revokedAt))
  }

  async setLicenseRevoked(id: string, revoked: { at: string; reason: string } | null) {
    const license = this.state.licenses[id]
    if (!license) throw new Error(`no existe la licencia ${id}`)
    license.revokedAt = revoked?.at ?? null
    license.revokedReason = revoked?.reason ?? null
  }

  async saveInvoice(input: InvoiceInput) {
    const existing = Object.values(this.state.invoices).find((i) => i.ref === input.ref)
    if (existing) return copy(existing)
    const invoice: InvoiceRecord = { ...input, id: newId(), createdAt: this.now(), approvedAt: null, sentAt: null }
    this.state.invoices[invoice.id] = invoice
    return copy(invoice)
  }

  async getInvoiceByRef(ref: string) {
    const invoice = Object.values(this.state.invoices).find((i) => i.ref === ref)
    return invoice ? copy(invoice) : null
  }

  async getInvoice(id: string) {
    const invoice = this.state.invoices[id]
    return invoice ? copy(invoice) : null
  }

  async updateInvoice(id: string, patch: Partial<Omit<InvoiceRecord, 'id' | 'createdAt'>>) {
    const invoice = this.state.invoices[id]
    if (!invoice) throw new Error(`no existe la factura ${id}`)
    Object.assign(invoice, patch)
    return copy(invoice)
  }

  async listInvoicesByCompany(companyId: string) {
    return copy(Object.values(this.state.invoices).filter((i) => i.companyId === companyId))
  }

  async listDraftInvoices() {
    return copy(Object.values(this.state.invoices).filter((i) => i.status === 'draft'))
  }

  async addMember(input: { companyId: string; email: string; userId: string | null; role: Member['role']; addedBy: string | null; purchaseId?: string | null }) {
    const email = input.email.toLowerCase()
    const existing = Object.values(this.state.members).find((m) => m.companyId === input.companyId && m.email === email && !m.removedAt)
    if (existing) {
      if (!existing.userId && input.userId) existing.userId = input.userId
      if (input.role === 'owner' && existing.role !== 'owner') {
        existing.role = 'owner'
        existing.purchaseId = input.purchaseId ?? null
      }
      return copy(existing)
    }
    // Como el disparador de la base de datos: el equipo no pasa de las plazas (los titulares, si).
    const company = this.state.companies[input.companyId]
    const active = Object.values(this.state.members).filter((m) => m.companyId === input.companyId && !m.removedAt).length
    if (input.role === 'member' && company && active >= company.seats) throw new SeatLimitError()
    const member: Member = { ...input, purchaseId: input.purchaseId ?? null, email, id: newId(), createdAt: this.now(), removedAt: null }
    this.state.members[member.id] = member
    return copy(member)
  }

  async updateMember(id: string, patch: Partial<Pick<Member, 'userId' | 'role' | 'purchaseId'>>) {
    const member = this.state.members[id]
    if (!member) throw new Error(`no existe la persona ${id}`)
    Object.assign(member, patch)
    return copy(member)
  }

  async removeMember(companyId: string, email: string, at: string) {
    const member = Object.values(this.state.members).find(
      (m) => m.companyId === companyId && m.email === email.toLowerCase() && !m.removedAt
    )
    if (!member) return false
    member.removedAt = at
    return true
  }

  async listMembers(companyId: string) {
    return copy(Object.values(this.state.members).filter((m) => m.companyId === companyId && !m.removedAt))
  }

  async listMembershipsByUser(userId: string) {
    return copy(Object.values(this.state.members).filter((m) => m.userId === userId && !m.removedAt))
  }

  async listMembershipsByEmail(email: string) {
    return copy(Object.values(this.state.members).filter((m) => m.email === email.toLowerCase() && !m.removedAt))
  }

  async saveBooking(input: Omit<Booking, 'id' | 'createdAt'>) {
    const existing = Object.values(this.state.bookings).find((b) => b.purchaseId === input.purchaseId && b.number === input.number)
    if (existing) return copy(existing)
    const booking: Booking = { ...input, id: newId(), createdAt: this.now() }
    this.state.bookings[booking.id] = booking
    return copy(booking)
  }

  async updateBooking(id: string, patch: Partial<Omit<Booking, 'id' | 'createdAt'>>) {
    const booking = this.state.bookings[id]
    if (!booking) throw new Error(`no existe la reserva ${id}`)
    Object.assign(booking, patch)
    return copy(booking)
  }

  async getBooking(purchaseId: string, number: 1 | 2) {
    const booking = Object.values(this.state.bookings).find((b) => b.purchaseId === purchaseId && b.number === number)
    return booking ? copy(booking) : null
  }

  async listBookingsByCompany(companyId: string) {
    return copy(Object.values(this.state.bookings).filter((b) => b.companyId === companyId))
  }

  async upsertVersion(input: Omit<Version, 'announcedAt' | 'publishedAt'> & { publishedAt?: string }) {
    const existing = this.state.versions[input.id]
    const version: Version = {
      id: input.id,
      notesEs: input.notesEs,
      notesEn: input.notesEn,
      publishedAt: existing?.publishedAt ?? input.publishedAt ?? this.now(),
      announcedAt: existing?.announcedAt ?? null,
    }
    this.state.versions[input.id] = version
    return copy(version)
  }

  async setVersionAnnounced(id: string, at: string) {
    const version = this.state.versions[id]
    if (version) version.announcedAt = at
  }

  async addVersionFiles(files: VersionFileInput[]) {
    const added: VersionFile[] = []
    for (const file of files) {
      const existing = Object.values(this.state.versionFiles).find((f) => f.storagePath === file.storagePath)
      if (existing) {
        added.push(copy(existing))
        continue
      }
      const record: VersionFile = { ...file, id: newId(), createdAt: this.now() }
      this.state.versionFiles[record.id] = record
      added.push(copy(record))
    }
    return added
  }

  async getLatestVersion() {
    const versions = Object.values(this.state.versions)
    if (!versions.length) return null
    const version = versions.sort((a, b) => compareVersions(b.id, a.id))[0]
    const files = Object.values(this.state.versionFiles).filter((f) => f.versionId === version.id)
    return { version: copy(version), files: copy(files) }
  }

  async getVersionFile(id: string) {
    const file = this.state.versionFiles[id]
    return file ? copy(file) : null
  }

  async enqueueJobs(jobs: NewJob[], now: Date) {
    for (const job of jobs) {
      if (Object.values(this.state.jobs).some((j) => j.key === job.key)) continue
      const id = String(++this.state.jobCounter)
      const at = now.toISOString()
      this.state.jobs[id] = {
        id,
        key: job.key,
        kind: job.kind,
        payload: job.payload ?? {},
        dependsOn: job.dependsOn ?? [],
        status: 'pending',
        attempts: 0,
        maxAttempts: job.maxAttempts ?? 10,
        nextRunAt: job.runAt ?? at,
        lockedUntil: null,
        lastError: null,
        alertedAt: null,
        result: null,
        createdAt: at,
        updatedAt: at,
        doneAt: null,
      }
    }
  }

  async claimJobs(limit: number, lockSeconds: number, now: Date) {
    const at = now.toISOString()
    const byKey = new Map(Object.values(this.state.jobs).map((j) => [j.key, j]))
    const due = Object.values(this.state.jobs)
      .filter(
        (j) =>
          ((j.status === 'pending' && j.nextRunAt <= at) || (j.status === 'running' && j.lockedUntil !== null && j.lockedUntil < at)) &&
          j.dependsOn.every((key) => !byKey.has(key) || byKey.get(key)!.status === 'done')
      )
      .sort((a, b) => (a.nextRunAt === b.nextRunAt ? Number(a.id) - Number(b.id) : a.nextRunAt < b.nextRunAt ? -1 : 1))
      .slice(0, limit)
    for (const job of due) {
      job.status = 'running'
      job.attempts += 1
      job.lockedUntil = new Date(now.getTime() + lockSeconds * 1000).toISOString()
      job.updatedAt = at
    }
    return copy(due)
  }

  async completeJob(id: string, result: Record<string, unknown> | null, now: Date) {
    const job = this.state.jobs[id]
    if (!job) return
    Object.assign(job, { status: 'done', result, lockedUntil: null, updatedAt: now.toISOString(), doneAt: now.toISOString(), lastError: null })
  }

  async failJob(id: string, error: string, next: { runAt: string } | { dead: true }, now: Date) {
    const job = this.state.jobs[id]
    if (!job) return
    job.lastError = error
    job.lockedUntil = null
    job.updatedAt = now.toISOString()
    if ('dead' in next) job.status = 'dead'
    else Object.assign(job, { status: 'pending', nextRunAt: next.runAt })
  }

  async markJobAlerted(id: string, now: Date) {
    const job = this.state.jobs[id]
    if (job) job.alertedAt = now.toISOString()
  }

  async getJobByKey(key: string) {
    const job = Object.values(this.state.jobs).find((j) => j.key === key)
    return job ? copy(job) : null
  }

  async listJobs(filter: { status?: Job['status']; limit?: number }) {
    return copy(
      Object.values(this.state.jobs)
        .filter((j) => !filter.status || j.status === filter.status)
        .sort((a, b) => Number(b.id) - Number(a.id))
        .slice(0, filter.limit ?? 100)
    )
  }

  async retryJob(id: string, now: Date) {
    const job = this.state.jobs[id]
    if (!job || job.status !== 'dead') return false
    Object.assign(job, { status: 'pending', attempts: 0, nextRunAt: now.toISOString(), alertedAt: null, updatedAt: now.toISOString() })
    return true
  }

  async reserveLaunchSlot(
    input: { ref: string; product: string; clientHash: string | null; expiresAt: string; limit: number; clientLimit: number },
    now: Date
  ) {
    const at = now.toISOString()
    const slots = Object.values(this.state.launchSlots)
    const active = (s: (typeof slots)[number]) => s.status === 'used' || (s.status === 'reserved' && s.expiresAt > at)
    if (slots.filter(active).length >= input.limit) return false
    if (input.clientHash) {
      const mine = slots.filter((s) => s.clientHash === input.clientHash && s.status === 'reserved' && s.expiresAt > at)
      if (mine.length >= input.clientLimit) return false
    }
    this.state.launchSlots[input.ref] = {
      ref: input.ref,
      product: input.product,
      clientHash: input.clientHash,
      status: 'reserved',
      expiresAt: input.expiresAt,
      sessionId: null,
    }
    return true
  }

  async hitRateLimit(key: string, windowSeconds: number, limit: number, now: Date) {
    const at = now.toISOString()
    let entry = this.state.rateLimits[key]
    if (!entry || entry.expiresAt <= at) entry = this.state.rateLimits[key] = { count: 0, expiresAt: new Date(now.getTime() + windowSeconds * 1000).toISOString() }
    entry.count += 1
    return { allowed: entry.count <= limit, count: entry.count, resetAt: entry.expiresAt }
  }

  async clearRateLimit(key: string) {
    delete this.state.rateLimits[key]
  }

  async setLaunchSlotSession(ref: string, sessionId: string) {
    const slot = this.state.launchSlots[ref]
    if (slot) slot.sessionId = sessionId
  }

  async markLaunchSlot(ref: string, status: 'used' | 'released') {
    const slot = this.state.launchSlots[ref]
    // Una plaza gastada no se suelta (el pago ya se cobro con el precio de lanzamiento).
    if (slot && slot.status !== 'used') slot.status = status
  }

  async countLaunchSlotsUsed() {
    return Object.values(this.state.launchSlots).filter((s) => s.status === 'used').length
  }
}

/** Compara versiones X.Y.Z por numeros. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
