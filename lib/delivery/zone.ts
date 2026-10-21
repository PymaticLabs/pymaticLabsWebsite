// Lo que hace la zona de socio, sin la interfaz (la construye otra pieza sobre /api/zone/*).
//
// - Entrar: correo y codigo de un solo uso. Solo reciben codigo los correos con acceso (titular o
//   equipo de una empresa con acceso vigente); a los demas no se les dice nada distinto (ni tardando
//   distinto: el codigo se manda despues de contestar). Con limites propios por IP y por correo,
//   ademas de los de Supabase: 5 codigos probados por correo cada 15 minutos y se bloquea.
// - Dentro: la licencia (volver a bajarla), las descargas de la ultima version con enlaces que
//   caducan en minutos, las facturas, las condiciones aceptadas, el portal de Stripe para el mensual,
//   el equipo (solo quien compro, hasta las plazas compradas) y la segunda sesion del Acompanado.
//
// Cada funcion comprueba que la persona tiene acceso a esa empresa. En Supabase, la seguridad por
// filas (RLS) lo repite por debajo para quien lea con su sesion.

import { coveringPlan, firstSessionSlots } from '../checkout.ts'
import { clearLimit, fingerprint, ipBucket, withinLimit } from './limits.ts'
import { isGuided, isSessionHost } from './products.ts'
import { termsAttachment } from './terms.ts'
import { madridDate, normalizeEmail } from './util.ts'
import type { Delivery } from './container.ts'
import type { ZoneProfile } from '../zone-profile.ts'
import { RateLimitedError, SeatLimitError, SlotUnavailableError, type Company, type CookieJar, type Locale, type Member, type Slot, type ZoneUser } from './types.ts'

export class ZoneError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 429
  constructor(status: 400 | 401 | 403 | 404 | 409 | 429, message: string) {
    super(message)
    this.name = 'ZoneError'
    this.status = status
  }
}

interface Access {
  company: Company
  member: Member
  owner: boolean
}

/** Las empresas con acceso vigente de esa persona. */
async function accesses(d: Delivery, user: ZoneUser): Promise<Access[]> {
  const byUser = await d.repo.listMembershipsByUser(user.id)
  // Una persona dada de alta antes de tener cuenta: se la reconoce por su correo (ya verificado con
  // el codigo) la primera vez, y desde entonces por su cuenta.
  const byEmail = (await d.repo.listMembershipsByEmail(user.email)).filter((m) => !m.userId)
  for (const member of byEmail) {
    await d.repo.updateMember(member.id, { userId: user.id })
    member.userId = user.id
  }
  // Con Supabase, la base de datos tiene que estar de acuerdo (RLS con la sesion de esa persona).
  const visible = user.visibleCompanyIds ? new Set(await user.visibleCompanyIds()) : null
  const result: Access[] = []
  for (const member of [...byUser, ...byEmail]) {
    if (visible && !visible.has(member.companyId)) continue
    const company = await d.repo.getCompany(member.companyId)
    if (company && !company.accessRevokedAt && !result.some((r) => r.company.id === company.id)) {
      result.push({ company, member, owner: member.role === 'owner' })
    }
  }
  return result
}

async function access(d: Delivery, user: ZoneUser, companyId?: string | null, { owner = false } = {}): Promise<Access> {
  const all = await accesses(d, user)
  if (!all.length) throw new ZoneError(403, 'sin acceso a la zona')
  // Sin empresa dicha: la primera (o la primera que compro, si hace falta serlo).
  const found = companyId ? all.find((a) => a.company.id === companyId) : owner ? (all.find((a) => a.owner) ?? all[0]) : all[0]
  if (!found) throw new ZoneError(404, 'empresa no encontrada')
  if (owner && !found.owner) throw new ZoneError(403, 'solo quien compro')
  return found
}

/** La empresa que esa persona compro (para contratar el mensual desde la zona). */
export async function ownedCompany(d: Delivery, user: ZoneUser, companyId?: string | null): Promise<Company> {
  return (await access(d, user, companyId, { owner: true })).company
}

/** Cuantos codigos pide una IP: de mas, la ruta contesta 429 (a todos igual, sean o no clientes). */
export async function allowCodeRequest(d: Delivery, clientIp: string | null): Promise<boolean> {
  return withinLimit(d, 'zona-pedir-ip', ipBucket(clientIp), d.config.limits.loginPerIp, 15 * 60)
}

/**
 * Pide el codigo. Siempre responde igual: no se cuenta que correos son clientes. La ruta lo llama
 * despues de contestar (after), para que tampoco se note en lo que tarda.
 */
export async function requestCode(d: Delivery, rawEmail: string, locale: Locale, clientIp: string | null = null): Promise<void> {
  const email = normalizeEmail(rawEmail)
  if (!email) return
  // Mas de unos pocos por hora a un correo, no se mandan (nadie llena el limite de correos de Supabase).
  if (!(await withinLimit(d, 'zona-pedir-correo', email, d.config.limits.loginPerEmail, 3600))) return
  const memberships = await d.repo.listMembershipsByEmail(email)
  for (const member of memberships) {
    const company = await d.repo.getCompany(member.companyId)
    if (company && !company.accessRevokedAt) {
      // La cuenta existe desde la compra o el alta; por si acaso, se asegura antes de mandar.
      if (!member.userId) await d.auth.ensureUser(email)
      await d.auth.sendCode(email, locale, clientIp)
      return
    }
  }
}

/**
 * Comprueba el codigo, con limites propios: por IP y por correo (5 intentos cada 15 minutos y ese
 * correo queda bloqueado hasta que pasen; despues, un codigo nuevo). Supabase solo limita por IP.
 */
export async function verifyCode(d: Delivery, rawEmail: string, code: string, jar: CookieJar, clientIp: string | null = null): Promise<ZoneUser | null> {
  const email = normalizeEmail(rawEmail)
  if (!email) return null
  if (!(await withinLimit(d, 'zona-probar-ip', ipBucket(clientIp), d.config.limits.verifyPerIp, 15 * 60))) throw new RateLimitedError('demasiados codigos desde esa IP')
  if (!(await withinLimit(d, 'zona-probar-correo', email, d.config.limits.verifyPerEmail, 15 * 60))) throw new RateLimitedError('demasiados codigos para ese correo')
  const user = await d.auth.verifyCode(email, code, jar, clientIp)
  if (user) await clearLimit(d, 'zona-probar-correo', email)
  return user
}

/**
 * Lo poco que ensena la barra de arriba de la web de quien tiene sesion: su correo y sus empresas con
 * acceso vigente (ninguna si se le cerro la zona). Sin los datos de la zona: va en cada pagina.
 */
export async function zoneProfile(d: Delivery, user: ZoneUser): Promise<ZoneProfile> {
  const all = await accesses(d, user)
  return { email: user.email, companies: all.map((a) => ({ name: a.company.name, role: a.owner ? 'owner' : 'member' })) }
}

export async function zoneOverview(d: Delivery, user: ZoneUser, companyId?: string | null) {
  const all = await accesses(d, user)
  if (!all.length) throw new ZoneError(403, 'sin acceso a la zona')
  const { company, owner } = await access(d, user, companyId)
  const [licenses, invoices, purchases, members, bookings, latest, requested] = await Promise.all([
    d.repo.listLicensesByCompany(company.id),
    owner ? d.repo.listInvoicesByCompany(company.id) : Promise.resolve([]),
    owner ? d.repo.listPurchasesByCompany(company.id) : Promise.resolve([]),
    owner ? d.repo.listMembers(company.id) : Promise.resolve([]),
    d.repo.listBookingsByCompany(company.id),
    d.repo.getLatestVersion(),
    d.repo.listLicenseRequests({ companyId: company.id, status: 'pending' }),
  ])
  const guided = purchases.some((p) => p.kind === 'one_time' && isGuided(p.product) && p.status === 'paid')
  const booked = bookings.filter((b) => b.status === 'booked')
  // El plan con el que el mensual no se cobra hasta que acaben los meses que ya tiene (o uno menor).
  const covering = owner ? await coveringPlan(d, company) : null
  return {
    user: { email: user.email },
    companies: all.map((a) => ({ id: a.company.id, name: a.company.name, role: a.member.role })),
    company: {
      id: company.id,
      name: company.name,
      taxId: company.taxId,
      seats: company.seats,
      subscription: { status: company.subscriptionStatus, plan: company.subscriptionPlan, coveredBy: covering?.plan ?? null },
      canOpenPortal: owner && Boolean(company.stripeCustomerId),
    },
    role: owner ? 'owner' : 'member',
    licenses: licenses.map((l) => ({
      id: l.id,
      modalidad: l.modalidad,
      equipo: l.equipo,
      emitida: l.emitida,
      soporteHasta: l.soporteHasta,
      fileName: l.fileName,
      revoked: Boolean(l.revokedAt),
    })),
    // Las que Eric aun tiene que firmar (LICENSE_MODE=manual): la zona dice que llegan en unas horas.
    pendingLicenses: requested.map((r) => ({ kind: r.kind, modalidad: r.modalidad, equipo: r.equipo, emitida: r.emitida, soporteHasta: r.soporteHasta, requestedAt: r.createdAt })),
    invoices: invoices
      .filter((i) => i.status !== 'draft')
      .map((i) => ({ id: i.id, kind: i.kind, number: i.number, amountTotal: i.amountTotal, currency: i.currency, date: i.approvedAt ?? i.createdAt, downloadable: Boolean(i.storagePath) })),
    pendingInvoices: invoices.filter((i) => i.status === 'draft').length,
    purchases: purchases.map((p) => ({
      id: p.id,
      product: p.product,
      kind: p.kind,
      paidAt: p.paidAt,
      amountTotal: p.amountTotal,
      currency: p.currency,
      status: p.status,
      termsVersion: p.termsVersion,
    })),
    team: owner ? members.map((m) => ({ email: m.email, role: m.role, since: m.createdAt })) : [],
    sessions: {
      guided,
      bookings: bookings.map((b) => ({
        number: b.number,
        host: b.host,
        startAt: b.startAt,
        status: b.status,
        // El enlace de la videollamada (Cal.com lo guarda en la nota de la reserva).
        meetingUrl: b.status === 'booked' && b.note?.startsWith('http') ? b.note : null,
      })),
      canBook: guided && owner && booked.length < 2,
    },
    version: latest
      ? {
          id: latest.version.id,
          publishedAt: latest.version.publishedAt,
          notes: { es: latest.version.notesEs, en: latest.version.notesEn },
          files: latest.files
            .filter((f) => !f.teamOnly || company.seats > 1)
            .map((f) => ({ id: f.id, kind: f.kind, lang: f.lang, fileName: f.fileName, sizeBytes: f.sizeBytes, sha256: f.sha256 })),
        }
      : null,
  }
}

export async function licenseFile(d: Delivery, user: ZoneUser, licenseId: string) {
  const license = await d.repo.getLicense(licenseId)
  if (!license) throw new ZoneError(404, 'licencia no encontrada')
  await access(d, user, license.companyId)
  if (license.revokedAt) throw new ZoneError(403, 'licencia anulada')
  return { fileName: license.fileName, content: license.content }
}

/** Un enlace de descarga de la ultima version que caduca en minutos. */
export async function downloadLink(d: Delivery, user: ZoneUser, fileId: string, companyId?: string | null) {
  const { company } = await access(d, user, companyId)
  const file = await d.repo.getVersionFile(fileId)
  const latest = await d.repo.getLatestVersion()
  if (!file || !latest || file.versionId !== latest.version.id) throw new ZoneError(404, 'descarga no encontrada')
  if (file.teamOnly && company.seats <= 1) throw new ZoneError(403, 'solo con equipo')
  return d.storage.signedUrl('releases', file.storagePath, d.config.downloadTtlSeconds, file.fileName)
}

export async function invoiceLink(d: Delivery, user: ZoneUser, invoiceId: string) {
  const invoice = await d.repo.getInvoice(invoiceId)
  if (!invoice) throw new ZoneError(404, 'factura no encontrada')
  await access(d, user, invoice.companyId, { owner: true })
  if (!invoice.storagePath) throw new ZoneError(404, 'la factura aun no esta lista')
  return d.storage.signedUrl('customer-files', invoice.storagePath, d.config.downloadTtlSeconds, `${invoice.number ?? 'factura'}.pdf`)
}

/** La copia de las condiciones que acepto esa compra. */
export async function termsFile(d: Delivery, user: ZoneUser, purchaseId: string) {
  const purchase = await d.repo.getPurchase(purchaseId)
  if (!purchase?.companyId) throw new ZoneError(404, 'compra no encontrada')
  const { company } = await access(d, user, purchase.companyId, { owner: true })
  const terms = await termsAttachment(d.storage, {
    version: purchase.termsVersion,
    locale: purchase.locale,
    company: company.name,
    taxId: company.taxId,
    acceptedAt: purchase.termsAcceptedAt ?? purchase.paidAt,
    paymentRef: purchase.paymentRef,
  })
  if (!terms) throw new ZoneError(404, 'no esta la copia de esa version')
  return { fileName: terms.attachment.name, content: terms.attachment.content }
}

export async function addTeamMember(d: Delivery, user: ZoneUser, companyId: string, rawEmail: string) {
  const { company } = await access(d, user, companyId, { owner: true })
  const email = normalizeEmail(rawEmail)
  if (!email) throw new ZoneError(400, 'correo no valido')
  if (company.seats <= 1) throw new ZoneError(409, 'la licencia es para una persona: para mas, con equipo')
  const members = await d.repo.listMembers(company.id)
  if (members.some((m) => m.email === email)) return { added: false }
  if (members.length >= company.seats) throw new ZoneError(409, `ya estan las ${company.seats} personas de la licencia`)
  // Dar de alta y de baja en bucle mandaria correos sin fin desde pymaticlabs.com: un tope al dia.
  if (!(await withinLimit(d, 'equipo-altas', company.id, d.config.limits.teamAddsPerDay, 86400))) throw new ZoneError(429, 'demasiadas altas hoy: prueba manana')
  const userId = await d.auth.ensureUser(email)
  try {
    await d.repo.addMember({ companyId: company.id, email, userId, role: 'member', addedBy: user.id })
  } catch (error) {
    // Dos altas a la vez con la ultima plaza: la base de datos solo deja una.
    if (error instanceof SeatLimitError) throw new ZoneError(409, `ya estan las ${company.seats} personas de la licencia`)
    throw error
  }
  // Una invitacion por persona y dia (la clave, con la huella del correo: nada personal en el registro).
  const key = `team_invite:${company.id}:${fingerprint(d, email)}:${madridDate(d.clock())}`
  await d.repo.enqueueJobs([{ key, kind: 'team_invite', payload: { companyId: company.id, email } }], d.clock())
  return { added: true }
}

export async function removeTeamMember(d: Delivery, user: ZoneUser, companyId: string, rawEmail: string) {
  const { company } = await access(d, user, companyId, { owner: true })
  const email = normalizeEmail(rawEmail)
  if (!email) throw new ZoneError(400, 'correo no valido')
  const member = (await d.repo.listMembers(company.id)).find((m) => m.email === email)
  if (!member) return { removed: false }
  if (member.role === 'owner') throw new ZoneError(409, 'quien compro no se puede dar de baja desde aqui')
  return { removed: await d.repo.removeMember(company.id, email, d.clock().toISOString()) }
}

export async function portalLink(d: Delivery, user: ZoneUser, companyId: string | null, returnUrl: string) {
  const { company } = await access(d, user, companyId, { owner: true })
  if (!company.stripeCustomerId) throw new ZoneError(409, 'sin cliente en Stripe')
  return d.payments.createPortalSession(company.stripeCustomerId, returnUrl)
}

async function guidedPurchase(d: Delivery, companyId: string) {
  const purchases = await d.repo.listPurchasesByCompany(companyId)
  const purchase = purchases.find((p) => p.kind === 'one_time' && isGuided(p.product) && p.status === 'paid')
  if (!purchase) throw new ZoneError(403, 'las sesiones son del Acompanado')
  return purchase
}

export async function sessionSlots(d: Delivery, user: ZoneUser, companyId: string | null) {
  const { company } = await access(d, user, companyId, { owner: true })
  await guidedPurchase(d, company.id)
  return firstSessionSlots(d)
}

/** Reserva la sesion que falta: la primera si su hueco se ocupo al pagar, o la segunda. */
export async function bookSession(d: Delivery, user: ZoneUser, companyId: string | null, slot: Slot) {
  const { company } = await access(d, user, companyId, { owner: true })
  const purchase = await guidedPurchase(d, company.id)
  const first = await d.repo.getBooking(purchase.id, 1)
  const number: 1 | 2 = first?.status === 'booked' ? 2 : 1
  if (number === 2 && (await d.repo.getBooking(purchase.id, 2))?.status === 'booked') throw new ZoneError(409, 'ya estan las dos sesiones')
  const start = new Date(slot.start)
  if (!isSessionHost(slot.host) || Number.isNaN(start.getTime()) || start <= d.clock()) throw new ZoneError(400, 'hueco no valido')
  try {
    const result = await d.calendar.book({
      slot: { host: slot.host, start: start.toISOString() },
      attendee: { name: company.name, email: purchase.email, locale: purchase.locale },
      reservationId: null,
      metadata: { compra: purchase.id, sesion: String(number) },
    })
    const booking = { companyId: company.id, purchaseId: purchase.id, number, host: slot.host, startAt: result.start, providerUid: result.uid, status: 'booked' as const, note: result.meetingUrl }
    // La primera que fallo al pagar se sustituye por la nueva.
    if (number === 1 && first) await d.repo.updateBooking(first.id, booking)
    else await d.repo.saveBooking(booking)
    return { number, start: result.start }
  } catch (error) {
    if (error instanceof SlotUnavailableError) throw new ZoneError(409, 'ese hueco ya no esta libre')
    throw error
  }
}
