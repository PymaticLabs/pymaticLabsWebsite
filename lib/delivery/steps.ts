// Los pasos de la cola. Cada uno es idempotente y apunta lo que ya hizo: si se repite (un reintento
// tras un fallo, o un trabajador que murio a mitad), continua donde se quedo sin duplicar nada.
//
// Pago unico: invoice, license, account, booking (Acompanado) -> welcome -> notice.
// Mensual (cada cobro): invoice, license -> renewal_email -> notice.
// Con LICENSE_MODE=manual, license no firma: pide la licencia a Eric (license_reminder si tarda) y
// la bienvenida sale sin ella; al subirla, license_email (o renewal_email en un cobro del mensual).
// Devolucion o contracargo: revoke (y, sin pago unico vigente, cancel_subscription), rectify (tras
// invoice), refund_email, notice; contracargo ganado: reinstate.
// Version nueva: announce (uno por persona). Alta en el equipo: team_invite. Compra con el NIF de
// otra empresa cliente: company_alert (a sus titulares).

import { addMonths, formatLicenseId, type LicenseModality } from '../license.ts'
import { companyAlertEmail, formatDate, formatDateTime, internalEmail, licenseReadyEmail, refundEmail, renewalEmail, teamInviteEmail, versionEmail, welcomeEmail, zoneUrl } from './emails.ts'
import { issueLicense } from './license-issue.ts'
import { cancelLicenseRequests, requestManualLicense, restoreLicenseRequests, sendOverdueNotice } from './manual-license.ts'
import { hostName, isGuided, isOneTimeProduct, licenseTermsFor, productName, priceCents } from './products.ts'
import { decideTax } from './tax.ts'
import { termsAttachment } from './terms.ts'
import { formatMoney, madridDate } from './util.ts'
import { zip } from './zip.ts'
import type { Delivery } from './container.ts'
import {
  PermanentError,
  RetryableError,
  SlotUnavailableError,
  type Company,
  type InvoiceDraft,
  type InvoiceKind,
  type InvoiceRecord,
  type Job,
  type LicenseRecord,
  type LicenseRequest,
  type Locale,
  type MailAttachment,
  type Purchase,
} from './types.ts'

export type StepHandler = (d: Delivery, job: Job) => Promise<Record<string, unknown> | void>

function text(job: Job, field: string): string {
  const value = job.payload[field]
  if (typeof value !== 'string' || !value) throw new PermanentError(`${job.kind}: falta ${field}`)
  return value
}

async function purchaseOf(d: Delivery, job: Job): Promise<Purchase> {
  const purchase = await d.repo.getPurchase(text(job, 'purchaseId'))
  if (!purchase) throw new PermanentError(`${job.kind}: no existe la compra ${job.payload.purchaseId}`)
  return purchase
}

async function companyOf(d: Delivery, purchase: Purchase): Promise<Company> {
  const company = purchase.companyId ? await d.repo.getCompany(purchase.companyId) : null
  if (!company) throw new PermanentError(`la compra ${purchase.id} no tiene empresa`)
  return company
}

function now(d: Delivery): string {
  return d.clock().toISOString()
}

/** La licencia en un .zip: Brevo no admite .cerebro-licencia, y asi llega igual con cualquier correo. */
function licenseAttachment(license: LicenseRecord): MailAttachment {
  return {
    name: license.fileName.replace(/\.cerebro-licencia$/, '.zip'),
    content: zip([{ name: license.fileName, content: Buffer.from(license.content, 'utf-8') }]),
    contentType: 'application/zip',
  }
}

/**
 * Los pagos unicos vigentes de la empresa (pagados o devueltos en parte, con su licencia sin anular):
 * la base del mensual y de la zona. Sin ninguno, ni zona ni licencias del mensual.
 */
export async function validBases(d: Delivery, companyId: string, exclude: string | null = null): Promise<Purchase[]> {
  const purchases = (await d.repo.listPurchasesByCompany(companyId)).filter(
    (p) => p.id !== exclude && p.kind === 'one_time' && (p.status === 'paid' || p.status === 'partially_refunded')
  )
  const valid: Purchase[] = []
  for (const purchase of purchases) {
    const license = await d.repo.getLicenseByPurchase(purchase.id)
    if (!license?.revokedAt) valid.push(purchase)
  }
  return valid
}

// --- Factura ---------------------------------------------------------------------------------------

function taxNote(purchase: Purchase, locale: Locale): string | null {
  if (purchase.taxTreatment === 'reverse_charge') {
    return locale === 'en'
      ? 'Reverse charge: VAT to be accounted for by the customer (Article 196, Directive 2006/112/EC; Article 69, Spanish VAT Law 37/1992).'
      : 'Inversión del sujeto pasivo: el IVA lo liquida el cliente (art. 196 de la Directiva 2006/112/CE; art. 69 de la Ley 37/1992 del IVA).'
  }
  if (purchase.taxTreatment === 'export') {
    return locale === 'en'
      ? 'Not subject to Spanish VAT (Article 69, Spanish VAT Law 37/1992).'
      : 'Operación no sujeta al IVA español (art. 69 de la Ley 37/1992 del IVA).'
  }
  return null
}

function lineDescription(purchase: Purchase): string | null {
  const en = purchase.locale === 'en'
  if (purchase.kind === 'renewal' && purchase.supportUntil) {
    return en ? `Maintenance and support until ${formatDate(purchase.supportUntil, 'en')}` : `Mantenimiento y soporte hasta el ${formatDate(purchase.supportUntil, 'es')}`
  }
  if (purchase.launch && isOneTimeProduct(purchase.product)) {
    const list = formatMoney(priceCents(purchase.product).list, purchase.currency, purchase.locale)
    return en ? `Launch price (list price ${list})` : `Precio de lanzamiento (precio de lista ${list})`
  }
  return null
}

function invoiceDraft(purchase: Purchase, contactId: string, reference: string, net: number, body: string | null): InvoiceDraft {
  return {
    contactId,
    reference,
    date: madridDate(new Date(purchase.paidAt)),
    currency: purchase.currency,
    language: purchase.locale,
    taxTreatment: purchase.taxTreatment,
    taxRate: purchase.taxRate,
    lines: [{ name: productName(purchase.product, purchase.locale), description: lineDescription(purchase), units: 1, price: net / 100 }],
    body,
    notes: `Stripe ${purchase.paymentRef} · compra ${purchase.id}`,
  }
}

async function contactOf(d: Delivery, company: Company): Promise<string> {
  if (company.holdedContactId) return company.holdedContactId
  const contactId = await d.invoicer.ensureContact(company)
  await d.repo.updateCompany(company.id, { holdedContactId: contactId })
  return contactId
}

/**
 * Emitir (Verifactu), que Holded la mande y guardar el PDF para la zona; o dejarla en borrador
 * (modo draft, o si algo pide mirarla antes: emit false).
 */
async function finishDocument(d: Delivery, invoice: InvoiceRecord, purchase: Purchase, kind: InvoiceKind, emit: boolean) {
  const providerId = invoice.providerId
  if (!providerId) throw new PermanentError(`la factura ${invoice.ref} no tiene documento en ${invoice.provider}`)
  if (invoice.status === 'draft' && !emit) return { status: 'draft', invoiceId: invoice.id }
  if (invoice.status === 'draft') {
    const doc = await d.invoicer.approveDocument(kind, providerId)
    invoice = await d.repo.updateInvoice(invoice.id, { status: 'approved', number: doc.number, approvedAt: now(d) })
  }
  if (invoice.status === 'approved') {
    await d.invoicer.sendDocument(kind, providerId, purchase.email, purchase.locale)
    invoice = await d.repo.updateInvoice(invoice.id, { status: 'sent', sentAt: now(d) })
  }
  if (!invoice.storagePath) invoice = await storeInvoicePdf(d, invoice, kind)
  return { status: invoice.status, number: invoice.number, invoiceId: invoice.id }
}

export async function storeInvoicePdf(d: Delivery, invoice: InvoiceRecord, kind: InvoiceKind): Promise<InvoiceRecord> {
  const pdf = await d.invoicer.getPdf(kind, invoice.providerId!)
  const name = (invoice.number ?? invoice.id).replace(/[^A-Za-z0-9._-]+/g, '-')
  const path = `facturas/${invoice.companyId}/${name}.pdf`
  await d.storage.put('customer-files', path, pdf, 'application/pdf')
  return d.repo.updateInvoice(invoice.id, { storagePath: path })
}

/** Lo que Holded dice del documento recien creado tiene que cuadrar con lo que cobro Stripe. */
async function totalsMismatch(d: Delivery, kind: InvoiceKind, providerId: string, purchase: Purchase): Promise<string | null> {
  const doc = await d.invoicer.getDocument(kind, providerId)
  if (typeof doc.total !== 'number' || typeof doc.tax !== 'number') return 'Holded no dio el total y el IVA del documento: comprobarlos a mano'
  const total = Math.round(doc.total * 100)
  const tax = Math.round(doc.tax * 100)
  if (Math.abs(total - purchase.amountTotal) > 1 || Math.abs(tax - purchase.amountTax) > 1) {
    return `Holded da ${formatMoney(total, purchase.currency, 'es')} (IVA ${formatMoney(tax, purchase.currency, 'es')}) y Stripe cobró ${formatMoney(purchase.amountTotal, purchase.currency, 'es')} (IVA ${formatMoney(purchase.amountTax, purchase.currency, 'es')})`
  }
  return null
}

async function holdNotice(d: Delivery, job: Job, purchase: Purchase, company: Company, what: string, reason: string) {
  const mail = internalEmail(`${what}: ${company.name}`, {
    'Qué hacer': `Revisarla en Holded y emitirla a mano. ${reason}`,
    Empresa: company.name,
    NIF: company.taxId,
    País: company.country,
    Importe: `${formatMoney(purchase.amountTotal, purchase.currency, 'es')} (IVA ${formatMoney(purchase.amountTax, purchase.currency, 'es')})`,
    Pago: purchase.paymentRef,
  })
  await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: `${job.key}:retenida`, tags: ['interno'] })
}

/** Intentos esperando a que VIES conteste (con la espera de la cola, un par de minutos). */
const VAT_PENDING_ATTEMPTS = 3

const invoice: StepHandler = async (d, job) => {
  let purchase = await purchaseOf(d, job)
  const company = await companyOf(d, purchase)
  const ref = `invoice:${purchase.id}`
  let record = await d.repo.getInvoiceByRef(ref)
  if (!record) {
    // El IVA, por lo que dice Stripe Tax (y la verificacion del NIF-IVA), no adivinado.
    const decision = decideTax(
      purchase,
      company,
      await d.payments.taxDetails({ checkoutSessionId: purchase.stripeCheckoutSessionId, invoiceId: purchase.stripeInvoiceId, customerId: purchase.stripeCustomerId })
    )
    // Stripe pregunta a VIES por el NIF-IVA justo despues del pago: unos intentos de espera antes de
    // dejarla en borrador por no verificado (sin llegar al aviso de paso fallando).
    if (decision.vatPending && job.attempts < VAT_PENDING_ATTEMPTS) throw new RetryableError('NIF-IVA pendiente de verificar en VIES')
    if (decision.treatment !== purchase.taxTreatment || decision.rate !== purchase.taxRate) {
      purchase = await d.repo.updatePurchase(purchase.id, { taxTreatment: decision.treatment, taxRate: decision.rate })
    }
    if (decision.hold?.mode === 'manual') {
      // Ni se crea: con un IVA dudoso, la factura la hace una persona.
      await holdNotice(d, job, purchase, company, 'Facturar a mano', decision.hold.reason)
      return { status: 'held', hold: decision.hold.reason }
    }
    let hold = decision.hold?.reason ?? null
    const contactId = await contactOf(d, company)
    const reference = `${productName(purchase.product, purchase.locale)} · ${purchase.paymentRef}`
    // Un intento anterior pudo crearla en Holded y cortarse antes de apuntarla: se busca primero.
    const found = job.attempts > 1 ? await d.invoicer.findDocument('invoice', contactId, purchase.paymentRef) : null
    const doc =
      found ?? (await d.invoicer.createDocument('invoice', invoiceDraft(purchase, contactId, reference, purchase.amountSubtotal - purchase.amountDiscount, taxNote(purchase, purchase.locale))))
    // Antes de emitir sola, Holded tiene que dar el mismo total y el mismo IVA que cobro Stripe.
    if (!hold && !doc.approved && d.config.invoiceMode === 'emit') hold = await totalsMismatch(d, 'invoice', doc.id, purchase)
    record = await d.repo.saveInvoice({
      companyId: company.id,
      purchaseId: purchase.id,
      kind: 'invoice',
      ref,
      provider: d.invoicer.name,
      providerId: doc.id,
      number: doc.number,
      status: doc.approved ? 'approved' : 'draft',
      amountTotal: purchase.amountTotal,
      currency: purchase.currency,
      storagePath: null,
      rectifies: null,
      holdReason: hold,
    })
  }
  // Retenida: en borrador hasta que una persona la mire, tambien en los reintentos (va en la factura).
  if (record.holdReason && record.status === 'draft') await holdNotice(d, job, purchase, company, 'Factura en borrador, sin emitir', record.holdReason)
  const result = await finishDocument(d, record, purchase, 'invoice', d.config.invoiceMode === 'emit' && !record.holdReason)
  return { ...result, ...(record.holdReason ? { hold: record.holdReason } : {}) }
}

const rectify: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  // Una compra que se quedo a revisar (y se devuelve) no tuvo factura: nada que rectificar.
  if (!purchase.companyId) return { status: 'sin factura' }
  const company = await companyOf(d, purchase)
  const amount = Number(job.payload.amount)
  const ref = text(job, 'ref')
  if (!(amount > 0)) throw new PermanentError(`rectify: importe ${job.payload.amount} no vale`)
  const motive = job.payload.reason === 'dispute' ? 'contracargo' : 'devolución'
  const manual = async (what: string) => {
    const mail = internalEmail(`Rectificar a mano: ${company.name}`, {
      'Qué hacer': what,
      Empresa: company.name,
      Importe: formatMoney(amount, purchase.currency, 'es'),
      Pago: purchase.paymentRef,
      Motivo: motive,
      Devolución: typeof job.payload.refundId === 'string' ? job.payload.refundId : null,
    })
    await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: job.key, tags: ['interno'] })
    return { status: 'manual' }
  }
  const original = await d.repo.getInvoiceByRef(`invoice:${purchase.id}`)
  // La factura se retuvo para hacerla a mano (IVA dudoso): la rectificativa, tambien a mano.
  if (!original) return manual('La factura no se hizo sola (estaba retenida): rectificarla a mano en Holded')
  // La factura sigue en borrador (emision a mano): se anula o se rectifica a mano en Holded.
  if (original.status === 'draft') return manual('La factura sigue en borrador en Holded: anularla, o emitirla y rectificarla')

  // Nunca mas abonado que lo cobrado, aunque lleguen avisos raros.
  const credited = (await d.repo.listInvoicesByCompany(company.id))
    .filter((i) => i.kind === 'credit_note' && i.purchaseId === purchase.id && i.ref !== ref)
    .reduce((sum, i) => sum + Math.abs(i.amountTotal), 0)
  if (credited + amount > purchase.amountTotal) {
    throw new PermanentError(`rectificativas de ${formatMoney(credited + amount, purchase.currency, 'es')} para un cobro de ${formatMoney(purchase.amountTotal, purchase.currency, 'es')}`)
  }
  let record = await d.repo.getInvoiceByRef(ref)
  if (!record) {
    const contactId = await contactOf(d, company)
    // La base devuelta, en proporcion a lo cobrado (el IVA lo pone Holded con el mismo impuesto).
    const net = purchase.amountSubtotal - purchase.amountDiscount
    const base = purchase.amountTotal > 0 ? Math.round((amount * net) / purchase.amountTotal) : amount
    const sign = d.config.creditNoteSign
    const reference = `${productName(purchase.product, purchase.locale)} · ${purchase.paymentRef} · ${ref}`
    const body =
      purchase.locale === 'en'
        ? `Corrects invoice ${original.number}. Reason: ${job.payload.reason === 'dispute' ? 'chargeback' : 'refund'}.`
        : `Rectifica la factura ${original.number}. Motivo: ${motive}.`
    const found = job.attempts > 1 ? await d.invoicer.findDocument('credit_note', contactId, ref) : null
    const doc = found ?? (await d.invoicer.createDocument('credit_note', { ...invoiceDraft(purchase, contactId, reference, sign * base, [body, taxNote(purchase, purchase.locale)].filter(Boolean).join('\n')), date: madridDate(d.clock()) }))
    record = await d.repo.saveInvoice({
      companyId: company.id,
      purchaseId: purchase.id,
      kind: 'credit_note',
      ref,
      provider: d.invoicer.name,
      providerId: doc.id,
      number: doc.number,
      status: doc.approved ? 'approved' : 'draft',
      amountTotal: -amount,
      currency: purchase.currency,
      storagePath: null,
      rectifies: original.id,
      holdReason: null,
    })
  }
  // La rectificativa se emite sola solo con HOLDED_CREDIT_NOTE_MODE=emit: la API v2 no la enlaza con la
  // factura que rectifica, y Verifactu pide ese enlace y el tipo. Por defecto, borrador y aviso.
  const emit = d.config.invoiceMode === 'emit' && d.config.creditNoteMode === 'emit'
  if (record.status === 'draft' && !emit) {
    const mail = internalEmail(`Emitir la rectificativa a mano: ${company.name}`, {
      'Qué hacer': `En Holded, la rectificativa en borrador: enlazarla a la factura ${original.number ?? original.ref} (tipo R1 si es una devolución), revisar el signo de los importes y emitirla`,
      Empresa: company.name,
      Importe: formatMoney(amount, purchase.currency, 'es'),
      Pago: purchase.paymentRef,
      Motivo: motive,
    })
    await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: `${job.key}:borrador`, tags: ['interno'] })
  }
  return finishDocument(d, record, purchase, 'credit_note', emit)
}

// --- Licencia ------------------------------------------------------------------------------------

const license: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const existing = await d.repo.getLicenseByPurchase(purchase.id)
  if (existing) return { licenseId: existing.id }
  const company = await companyOf(d, purchase)
  const manual = d.config.licenseMode === 'manual'
  // Un pago de prueba nunca se firma con la clave que conoce el producto (ni uno de verdad con la de
  // pruebas). A mano, lo mismo se comprueba al subirla (y el correo a Eric lo avisa).
  if (!manual && purchase.livemode !== (d.config.licenseKeyEnv === 'production')) {
    throw new PermanentError(
      `pago ${purchase.livemode ? 'en vivo' : 'de prueba'} y clave de licencias de ${d.config.licenseKeyEnv === 'production' ? 'produccion' : 'pruebas'} (LICENSE_KEY_ENV): no se firma`
    )
  }
  const emitida = madridDate(new Date(purchase.paidAt))

  let terms: { modalidad: LicenseModality; equipo: boolean; soporte_hasta: string }
  if (purchase.kind === 'one_time') {
    if (!isOneTimeProduct(purchase.product)) throw new PermanentError(`producto desconocido: ${purchase.product}`)
    terms = licenseTermsFor(purchase.product, emitida)
  } else {
    // Cada cobro del mensual: la licencia del pago unico vigente con el soporte_hasta nuevo, nunca
    // menos del que ya tiene (ni del de otro cobro que se este entregando a la vez). Sin pago unico
    // vigente (devuelto, con contracargo), no se firma.
    const bases = company.accessRevokedAt ? [] : await validBases(d, company.id)
    if (!bases.length) throw new PermanentError(`${company.name} cobra el mensual sin pago unico vigente: revisar y, si toca, cancelar la suscripcion`)
    const licenses = (await d.repo.listLicensesByCompany(company.id)).filter((l) => !l.revokedAt).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    // A mano, la del pago unico puede estar aun pedida, sin firmar: vale lo que se pidio.
    const pending = (await d.repo.listLicenseRequests({ companyId: company.id, status: 'pending' })).filter((r) => r.purchaseId !== purchase.id)
    const base: { modalidad: LicenseModality; equipo: boolean } | undefined =
      licenses.find((l) => bases.some((p) => p.id === l.purchaseId)) ?? pending.find((r) => bases.some((p) => p.id === r.purchaseId)) ?? licenses[0]
    if (!base) throw new PermanentError(`${company.name} cobra el mensual sin licencia de pago unico`)
    const paid = (await d.repo.listPurchasesByCompany(company.id)).filter((p) => p.kind === 'renewal' && p.status === 'paid' && p.supportUntil)
    const best = [
      purchase.supportUntil ?? addMonths(emitida, 1),
      emitida,
      ...licenses.map((l) => l.soporteHasta),
      ...pending.map((r) => r.soporteHasta),
      ...paid.map((p) => p.supportUntil!),
    ]
      .sort()
      .pop()!
    terms = { modalidad: base.modalidad, equipo: base.equipo, soporte_hasta: best }
  }

  if (manual) {
    // La firma Eric en su Mac (la clave que el producto ya conoce): se le pide, y la bienvenida sale sin esperarla.
    const request = await requestManualLicense(d, purchase, company, terms, emitida)
    return { manual: true, requestId: request.id, status: request.status }
  }

  // El id se reserva una vez por compra: un reintento usa el mismo (sin huecos ni repetidos).
  const year = Number(emitida.slice(0, 4))
  const id = purchase.reservedLicenseId ?? (await d.repo.reserveLicenseId(purchase.id, formatLicenseId(year, await d.repo.nextLicenseNumber(year))))
  const data = {
    id,
    cliente: company.name,
    nif: company.taxId,
    ...terms,
    emitida,
    ...(d.config.licenseIncludePayment ? { pago: purchase.paymentRef } : {}),
  }
  const signed = await issueLicense(data, d.signer, { expectedPublicKey: d.config.licensePublicKey })
  await d.repo.insertLicense({
    id,
    companyId: company.id,
    purchaseId: purchase.id,
    paymentRef: purchase.paymentRef,
    modalidad: terms.modalidad,
    equipo: terms.equipo,
    emitida,
    soporteHasta: terms.soporte_hasta,
    fileName: signed.fileName,
    content: signed.text,
    keyId: d.signer.keyId,
    publicKey: signed.publicKey,
  })
  return { licenseId: id }
}

// --- Cuenta en la zona ------------------------------------------------------------------------------

const account: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const company = await companyOf(d, purchase)
  const userId = await d.auth.ensureUser(purchase.email)
  // Titular por esta compra: si se devuelve, pierde lo que le dio (revoke).
  await d.repo.addMember({ companyId: company.id, email: purchase.email, userId, role: 'owner', addedBy: null, purchaseId: purchase.id })
  const patch: Partial<Company> = {}
  if (purchase.seats > company.seats) patch.seats = purchase.seats
  // Una compra pagada devuelve el acceso que quito una devolucion anterior.
  if (company.accessRevokedAt && purchase.status === 'paid') patch.accessRevokedAt = null
  if (Object.keys(patch).length) await d.repo.updateCompany(company.id, patch)
  return { userId }
}

// --- Primera sesion del Acompanado ---------------------------------------------------------------

/** Intentos con Cal.com antes de dar la reserva por fallida (con la espera, unos minutos): la bienvenida no espera mas. */
const BOOKING_ATTEMPTS = 3

const booking: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const existing = await d.repo.getBooking(purchase.id, 1)
  if (existing) return { booked: existing.status === 'booked' }
  const company = await companyOf(d, purchase)
  if (!purchase.sessionHost || !purchase.sessionStart) return { booked: false, reason: 'sin hueco elegido' }
  const slot = { host: purchase.sessionHost, start: new Date(purchase.sessionStart).toISOString() }
  try {
    const result = await d.calendar.book({
      slot,
      attendee: { name: company.name, email: purchase.email, locale: purchase.locale },
      reservationId: purchase.calendarReservation,
      metadata: { compra: purchase.id, pago: purchase.paymentRef },
    })
    await d.repo.saveBooking({
      companyId: company.id,
      purchaseId: purchase.id,
      number: 1,
      host: slot.host,
      startAt: result.start,
      providerUid: result.uid,
      status: 'booked',
      note: result.meetingUrl,
    })
    return { booked: true, uid: result.uid }
  } catch (error) {
    if (error instanceof SlotUnavailableError) {
      // Se ocupo durante el pago: el cliente elige otro en la zona y PymaticLabs lo sabe por el aviso.
      await d.repo.saveBooking({ companyId: company.id, purchaseId: purchase.id, number: 1, host: slot.host, startAt: slot.start, providerUid: null, status: 'failed', note: 'hueco ocupado' })
      return { booked: false, reason: 'hueco ocupado' }
    }
    // Cal.com no responde (o la clave no vale): tras unos intentos, la licencia sale igual y la sesion
    // la confirma PymaticLabs a mano (el aviso de la venta lo dice).
    if (!(error instanceof PermanentError) && job.attempts < BOOKING_ATTEMPTS) throw error
    await d.repo.saveBooking({ companyId: company.id, purchaseId: purchase.id, number: 1, host: slot.host, startAt: slot.start, providerUid: null, status: 'failed', note: 'calendario' })
    return { booked: false, reason: `calendario: ${error instanceof Error ? error.message : String(error)}` }
  }
}

// --- Correos al cliente -----------------------------------------------------------------------------

const welcome: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  if (purchase.welcomeSentAt) return { sent: false, reason: 'ya enviado' }
  const company = await companyOf(d, purchase)
  const lic = await d.repo.getLicenseByPurchase(purchase.id)
  // A mano: la licencia aun pedida a Eric; la bienvenida sale ya y dice que llega en unas horas.
  const requested = lic ? null : await d.repo.getLicenseRequestByPurchase(purchase.id)
  if (!lic && !requested) throw new PermanentError(`la compra ${purchase.id} no tiene licencia`)
  if (!lic && requested?.status === 'cancelled') return { sent: false, reason: `licencia cancelada (${requested.cancelReason})` }
  const guided = isGuided(purchase.product)
  const first = guided ? await d.repo.getBooking(purchase.id, 1) : null
  const terms = await termsAttachment(d.storage, {
    version: purchase.termsVersion,
    locale: purchase.locale,
    company: company.name,
    taxId: company.taxId,
    acceptedAt: purchase.termsAcceptedAt ?? purchase.paidAt,
    paymentRef: purchase.paymentRef,
  })
  const mail = welcomeEmail({
    locale: purchase.locale,
    company: company.name,
    product: purchase.product,
    licenseId: lic?.id ?? null,
    supportUntil: lic?.soporteHasta ?? requested!.soporteHasta,
    emitida: lic?.emitida ?? requested!.emitida,
    zoneUrl: zoneUrl(d.config.siteUrl, purchase.locale),
    guided,
    booking:
      first?.status === 'booked'
        ? { host: first.host, start: first.startAt, meetingUrl: first.note?.startsWith('http') ? first.note : null }
        : first?.status === 'failed'
          ? { failed: true, calendar: first.note === 'calendario' }
          : null,
    termsAttached: Boolean(terms),
  })
  await d.mailer.send({
    to: purchase.email,
    ...mail,
    attachments: [...(lic ? [licenseAttachment(lic)] : []), ...(terms ? [terms.attachment] : [])],
    idempotencyKey: job.key,
    tags: ['bienvenida'],
  })
  await d.repo.updatePurchase(purchase.id, { welcomeSentAt: now(d) })
  // license: la que llevo (license_email no la repite si se subio antes de mandar la bienvenida).
  return { sent: true, termsVersion: terms?.version ?? null, license: lic?.id ?? null }
}

/** Las compras cuya licencia se manda: pagadas, o devueltas solo en parte. */
const DELIVERABLE: Purchase['status'][] = ['paid', 'partially_refunded']

/** La licencia firmada a mano, al subirla (tras la bienvenida, si no la llevo ya). */
const licenseMail: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const company = await companyOf(d, purchase)
  const lic = await d.repo.getLicenseByPurchase(purchase.id)
  if (!lic) throw new PermanentError(`la compra ${purchase.id} no tiene licencia`)
  if (lic.revokedAt) return { sent: false, reason: 'anulada' }
  // Devuelta o con contracargo mientras se subia: revoke la anula; el correo no sale.
  if (!DELIVERABLE.includes(purchase.status)) return { sent: false, reason: purchase.status }
  if ((await d.repo.getJobByKey(`welcome:${purchase.id}`))?.result?.license === lic.id) return { sent: false, reason: 'ya iba en la bienvenida' }
  const mail = licenseReadyEmail({
    locale: purchase.locale,
    company: company.name,
    licenseId: lic.id,
    supportUntil: lic.soporteHasta,
    emitida: lic.emitida,
    zoneUrl: zoneUrl(d.config.siteUrl, purchase.locale),
  })
  await d.mailer.send({ to: purchase.email, ...mail, attachments: [licenseAttachment(lic)], idempotencyKey: job.key, tags: ['licencia'] })
  return { sent: true, licenseId: lic.id }
}

/** Una licencia pedida a mano que sigue sin firmar a las horas de aviso. */
const licenseReminder: StepHandler = async (d, job) => {
  const request = await d.repo.getLicenseRequestByPurchase(text(job, 'purchaseId'))
  if (request?.status !== 'pending') return { sent: false, reason: request?.status ?? 'sin pedir' }
  const hours = Math.max(d.config.licensePendingAlertHours, Math.floor((d.clock().getTime() - new Date(request.createdAt).getTime()) / 3600_000))
  await sendOverdueNotice(d, [{ purchaseId: request.purchaseId, company: request.cliente, kind: request.kind, hours }], job.key)
  return { sent: true }
}

const renewalMail: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const company = await companyOf(d, purchase)
  const lic = await d.repo.getLicenseByPurchase(purchase.id)
  if (!lic) throw new PermanentError(`el cobro ${purchase.id} no tiene licencia`)
  if (lic.revokedAt) return { sent: false, reason: 'anulada' }
  if (!DELIVERABLE.includes(purchase.status)) return { sent: false, reason: purchase.status }
  const mail = renewalEmail({
    locale: purchase.locale,
    company: company.name,
    licenseId: lic.id,
    supportUntil: lic.soporteHasta,
    zoneUrl: zoneUrl(d.config.siteUrl, purchase.locale),
    plan: purchase.product,
  })
  await d.mailer.send({ to: purchase.email, ...mail, attachments: [licenseAttachment(lic)], idempotencyKey: job.key, tags: ['mensual'] })
  return { sent: true }
}

const refundMail: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  if (purchase.kind !== 'one_time') return { sent: false, reason: 'cobro del mensual' }
  // A revisar y devuelta: no tuvo licencia ni zona; el correo de la devolucion lo manda Stripe.
  if (!purchase.companyId) return { sent: false, reason: 'compra sin entregar' }
  const company = await companyOf(d, purchase)
  const revoked = (await d.repo.getJobByKey(`revoke:${purchase.id}:refund`))?.result
  const mail = refundEmail({
    locale: purchase.locale,
    company: company.name,
    amount: Number(job.payload.amount) || purchase.amountRefunded,
    currency: purchase.currency,
    subscriptionCanceled: Boolean(revoked?.subscriptionCanceled),
  })
  await d.mailer.send({ to: purchase.email, ...mail, idempotencyKey: job.key, tags: ['devolucion'] })
  return { sent: true }
}

const announce: StepHandler = async (d, job) => {
  const locale: Locale = job.payload.locale === 'en' ? 'en' : 'es'
  const latest = await d.repo.getLatestVersion()
  const versionId = text(job, 'versionId')
  if (!latest || latest.version.id !== versionId) return { sent: false, reason: 'ya hay otra version' }
  const mail = versionEmail({
    locale,
    company: text(job, 'company'),
    version: versionId,
    notes: locale === 'en' ? latest.version.notesEn : latest.version.notesEs,
    zoneUrl: zoneUrl(d.config.siteUrl, locale),
  })
  await d.mailer.send({ to: text(job, 'email'), ...mail, idempotencyKey: job.key, tags: ['version'] })
  return { sent: true }
}

const teamInvite: StepHandler = async (d, job) => {
  const company = await d.repo.getCompany(text(job, 'companyId'))
  if (!company) throw new PermanentError('team_invite: no existe la empresa')
  const email = text(job, 'email')
  const active = (await d.repo.listMembers(company.id)).some((m) => m.email === email)
  if (!active) return { sent: false, reason: 'ya no esta en el equipo' }
  const mail = teamInviteEmail({ locale: company.locale, company: company.name, zoneUrl: zoneUrl(d.config.siteUrl, company.locale) })
  await d.mailer.send({ to: email, ...mail, idempotencyKey: job.key, tags: ['equipo'] })
  return { sent: true }
}

/** A los titulares de la empresa: alguien compro con su NIF desde otro correo (la compra, a revisar). */
const companyAlert: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const company = await d.repo.getCompany(text(job, 'companyId'))
  if (!company) throw new PermanentError('company_alert: no existe la empresa')
  const owners = (await d.repo.listMembers(company.id)).filter((m) => m.role === 'owner').map((m) => m.email)
  const to = [...new Set(owners.length ? owners : [company.email])]
  const mail = companyAlertEmail({ locale: company.locale, company: company.name, product: purchase.product, date: madridDate(new Date(purchase.paidAt)) })
  for (const [i, email] of to.entries()) {
    await d.mailer.send({ to: email, ...mail, replyTo: d.config.internalEmail, idempotencyKey: `${job.key}:${i}`, tags: ['aviso-nif'] })
  }
  return { sent: to.length }
}

// --- Devolucion, contracargo y su vuelta atras -------------------------------------------------------

const ALIVE = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']

/**
 * Sin la compra, quien entro como titular por ella pierde ese acceso (la empresa sigue por otra compra):
 * si compro otra vigente, sigue por esa; si antes era del equipo, vuelve a serlo; si no, sale.
 */
async function dropPurchaseOwners(d: Delivery, purchase: Purchase, bases: Purchase[]): Promise<string[]> {
  const dropped: string[] = []
  for (const member of await d.repo.listMembers(purchase.companyId!)) {
    if (member.purchaseId !== purchase.id) continue
    const other = bases.find((p) => p.email === member.email)
    if (other) await d.repo.updateMember(member.id, { purchaseId: other.id })
    else if (member.addedBy) await d.repo.updateMember(member.id, { role: 'member', purchaseId: null })
    else if (await d.repo.removeMember(member.companyId, member.email, now(d))) dropped.push(member.email)
  }
  return dropped
}

const revoke: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const reason = text(job, 'reason')
  // final: devolucion o contracargo perdido. Si no, un contracargo abierto (puede volver: reinstate).
  const final = job.payload.final === true
  // A mano y aun sin firmar: deja de pedirse (y Eric lo sabe). Las pedidas se miran antes que las
  // licencias: una que Eric sube a la vez, o pierde (ya no esta pedida) o ya esta guardada y se anula.
  const own = await d.repo.getLicenseRequestByPurchase(purchase.id)
  const unrequested: { request: LicenseRequest; reason: string }[] = own?.status === 'pending' ? [{ request: own, reason }] : []
  let accessRevoked = false
  let subscriptionCanceled = false
  const cascaded: string[] = []
  let dropped: string[] = []
  if (purchase.kind === 'one_time' && purchase.companyId) {
    const company = await d.repo.getCompany(purchase.companyId)
    const bases = await validBases(d, purchase.companyId, purchase.id)
    if (!bases.length && company) {
      // Sin otro pago unico vigente: se cierra la zona y dejan de valer tambien las licencias del
      // mensual (clausula 5: se pierden los meses). Con la marca de esta compra, para devolverlas si
      // el contracargo se gana.
      if (!company.accessRevokedAt) await d.repo.updateCompany(company.id, { accessRevokedAt: now(d) })
      accessRevoked = true
      // Y las del mensual pedidas a mano, sin firmar, tampoco (antes que las licencias, por lo mismo).
      for (const other of await d.repo.listLicenseRequests({ companyId: company.id, status: 'pending' })) {
        if (other.purchaseId !== purchase.id) unrequested.push({ request: other, reason: `${reason}:${purchase.id}` })
      }
      for (const other of await d.repo.listLicensesByCompany(company.id)) {
        if (other.purchaseId === purchase.id || other.revokedAt) continue
        await d.repo.setLicenseRevoked(other.id, { at: now(d), reason: `${reason}:${purchase.id}` })
        cascaded.push(other.id)
      }
      // Y el mensual deja de cobrarse (solo si es definitivo).
      if (final && company.subscriptionId && (!company.subscriptionStatus || ALIVE.includes(company.subscriptionStatus))) {
        await d.repo.enqueueJobs(
          [{ key: `cancel_subscription:${company.subscriptionId}`, kind: 'cancel_subscription', payload: { companyId: company.id, subscriptionId: company.subscriptionId, purchaseId: purchase.id, reason } }],
          d.clock()
        )
        subscriptionCanceled = true
      }
    } else if (final) {
      dropped = await dropPurchaseOwners(d, purchase, bases)
    }
  }
  const cancelledRequests = await cancelLicenseRequests(d, unrequested, job.key)
  // La de esta compra, al final: tambien la que se acaba de subir mientras.
  const lic = await d.repo.getLicenseByPurchase(purchase.id)
  if (lic && !lic.revokedAt) await d.repo.setLicenseRevoked(lic.id, { at: now(d), reason })
  return { licenseId: lic?.id ?? null, accessRevoked, cascaded, subscriptionCanceled, dropped, cancelledRequests }
}

const reinstate: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const reason = text(job, 'reason')
  const lic = await d.repo.getLicenseByPurchase(purchase.id)
  if (lic?.revokedAt && lic.revokedReason === reason) await d.repo.setLicenseRevoked(lic.id, null)
  const restored: string[] = []
  // A mano: la que se dejo de pedir por el contracargo se vuelve a pedir.
  const own = await d.repo.getLicenseRequestByPurchase(purchase.id)
  const rerequest = own?.status === 'cancelled' && own.cancelReason === reason && !['refunded', 'dispute_lost'].includes(purchase.status) ? [own] : []
  if (purchase.kind === 'one_time' && purchase.companyId && purchase.status !== 'refunded') {
    // Las licencias del mensual que se anularon por esta compra vuelven con ella.
    for (const other of await d.repo.listLicensesByCompany(purchase.companyId)) {
      if (other.revokedReason !== `${reason}:${purchase.id}`) continue
      await d.repo.setLicenseRevoked(other.id, null)
      restored.push(other.id)
    }
    for (const other of await d.repo.listLicenseRequests({ companyId: purchase.companyId, status: 'cancelled' })) {
      if (other.cancelReason === `${reason}:${purchase.id}`) rerequest.push(other)
    }
    const company = await d.repo.getCompany(purchase.companyId)
    if (company?.accessRevokedAt) await d.repo.updateCompany(company.id, { accessRevokedAt: null })
  }
  const requested = await restoreLicenseRequests(d, rerequest, job.key)
  return { licenseId: lic?.id ?? null, restored, requested }
}

/** Sin pago unico vigente, el mensual se cancela en Stripe (si no, seguiria cobrando y firmando). */
const cancelSubscription: StepHandler = async (d, job) => {
  const subscriptionId = text(job, 'subscriptionId')
  const company = await d.repo.getCompany(text(job, 'companyId'))
  const canceled = await d.payments.cancelSubscription(subscriptionId)
  if (company && company.subscriptionId === subscriptionId) await d.repo.updateCompany(company.id, { subscriptionStatus: 'canceled' })
  const mail = internalEmail(`Mensual cancelado: ${company?.name ?? subscriptionId}`, {
    'Qué hacer': 'Nada: sin pago único vigente (devuelto o contracargo perdido) se cancela el mensual en Stripe y sus licencias quedan anuladas',
    Empresa: company?.name,
    Suscripción: subscriptionId,
    Estado: canceled ? 'cancelada ahora' : 'ya estaba cancelada',
    Motivo: String(job.payload.reason ?? ''),
  })
  await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: job.key, tags: ['interno'] })
  return { canceled }
}

// --- Avisos a PymaticLabs ----------------------------------------------------------------------------

const REVIEW_TODO: Record<string, string> = {
  missing_data: 'Pedir al cliente la razón social y el NIF, completar la compra y emitir la licencia y la factura a mano',
  nif_conflict:
    'Alguien ha comprado con el NIF de una empresa que ya es cliente, desde un correo que no es de sus titulares (ya avisados). Comprobarlo con ellos antes de dar nada: si es de la empresa, poner company_id y status paid en la compra y entregarla (POST /api/admin/jobs {"action":"deliver"}); si no, devolver el pago',
  unknown_company: 'Un cobro del mensual de un cliente de Stripe que la web no conoce: buscar la empresa y entregarlo a mano',
  no_base: 'Un cobro del mensual de una empresa sin pago único vigente (devuelto o con contracargo): no se firma licencia. Cancelar la suscripción en Stripe y devolver el cobro si toca',
  tax_id_changed: 'El NIF de la factura de Stripe no es el de la empresa (se cambió en el portal o en el pago): comprobarlo antes de facturar y firmar',
}

const notice: StepHandler = async (d, job) => {
  const event = String(job.payload.event ?? 'sale')
  const purchase = typeof job.payload.purchaseId === 'string' ? await d.repo.getPurchase(job.payload.purchaseId) : null
  const companyId = purchase?.companyId ?? (typeof job.payload.companyId === 'string' ? job.payload.companyId : null)
  const company = companyId ? await d.repo.getCompany(companyId) : null
  const lic = purchase ? await d.repo.getLicenseByPurchase(purchase.id) : null
  const requested = purchase && !lic ? await d.repo.getLicenseRequestByPurchase(purchase.id) : null
  const inv = purchase ? await d.repo.getInvoiceByRef(`invoice:${purchase.id}`) : null
  const invoiceJob = purchase ? await d.repo.getJobByKey(`invoice:${purchase.id}`) : null
  const first = purchase && isGuided(purchase.product) ? await d.repo.getBooking(purchase.id, 1) : null
  const money = (cents: number) => formatMoney(cents, purchase?.currency ?? 'eur', 'es')
  const todo: string[] = []
  if (requested?.status === 'pending') todo.push(`Firmar la licencia a mano y subirla (pedida a ${d.config.licenseRequestEmail})`)
  const held = inv?.holdReason ?? (typeof invoiceJob?.result?.hold === 'string' ? invoiceJob.result.hold : null)
  if (held) todo.push(`Factura retenida: ${held}`)
  else if (inv?.status === 'draft') todo.push('Emitir la factura en Holded (Verifactu) y enviarla')
  if (first?.status === 'failed') {
    todo.push(first.note === 'calendario' ? 'Cal.com no respondió: reservar a mano la primera sesión que eligió y confirmársela' : 'El hueco de la primera sesion se ocupo: ofrecer otro')
  }

  const base = {
    Empresa: company?.name,
    NIF: company?.taxId,
    Correo: purchase?.email,
    Producto: purchase ? productName(purchase.product, 'es') : null,
    Pago: purchase?.paymentRef,
  }
  let mail
  switch (event) {
    case 'sale':
    case 'renewal':
      mail = internalEmail(`${event === 'sale' ? 'Venta' : 'Cobro del mensual'}: ${lic?.id ?? (requested ? 'licencia a mano' : 'sin licencia')} · ${company?.name ?? ''}`, {
        'Qué hacer': todo.join('. ') || 'Nada: entregada sola',
        ...base,
        Licencia: lic
          ? `${lic.id} (soporte hasta ${lic.soporteHasta})`
          : requested
            ? `a mano: ${requested.status === 'pending' ? 'pedida, sin firmar' : requested.status} (soporte hasta ${requested.soporteHasta})`
            : null,
        Factura: inv ? `${inv.number ?? 'sin número'} (${inv.status})` : held ? 'retenida' : 'pendiente',
        Importe: purchase ? `${money(purchase.amountTotal)} (IVA ${money(purchase.amountTax)}, ${purchase.taxTreatment})` : null,
        Lanzamiento: purchase?.launch ? 'sí' : null,
        Sesión: first ? `${hostName(first.host)}, ${formatDateTime(first.startAt, 'es')} (${first.status})` : null,
        Novedades: purchase?.marketingOptIn ? 'quiere recibirlas' : null,
      })
      break
    case 'review': {
      const reason = String(job.payload.reason ?? 'missing_data')
      const other = typeof job.payload.companyId === 'string' && reason === 'nif_conflict' ? await d.repo.getCompany(job.payload.companyId) : null
      mail = internalEmail(`${reason === 'nif_conflict' ? 'URGENTE · Compra con el NIF de otro cliente' : 'Venta a revisar'} (${purchase?.paymentRef})`, {
        'Qué hacer': REVIEW_TODO[reason] ?? REVIEW_TODO.missing_data,
        ...base,
        'Empresa del NIF': other ? `${other.name} (${other.taxId})` : null,
        Datos: purchase?.reviewData ? JSON.stringify(purchase.reviewData).slice(0, 1500) : null,
      })
      break
    }
    case 'refund':
      mail = internalEmail(`Devolución${job.payload.full ? '' : ' parcial'}: ${company?.name ?? purchase?.paymentRef}`, {
        'Qué hacer': job.payload.full ? 'Nada: licencia anulada, zona cerrada y rectificativa en curso' : 'Devolución parcial: la licencia sigue; rectificativa en curso',
        ...base,
        Devuelto: money(Number(job.payload.amount)),
        Licencia: lic ? `${lic.id}${lic.revokedAt ? ' (anulada)' : ''}` : null,
      })
      break
    case 'inquiry':
      mail = internalEmail(`Petición de información del banco: ${company?.name ?? purchase?.paymentRef}`, {
        'Qué hacer': 'Responder en Stripe con las pruebas antes del plazo (si no, puede pasar a contracargo). Aún no se anula nada',
        ...base,
        Importe: money(Number(job.payload.amount)),
        Petición: String(job.payload.disputeId ?? ''),
      })
      break
    case 'dispute':
      mail = internalEmail(`URGENTE · Contracargo: ${company?.name ?? purchase?.paymentRef}`, {
        'Qué hacer': 'Responder al contracargo en Stripe con las pruebas. La licencia queda anulada y la zona cerrada hasta que se resuelva',
        ...base,
        Importe: money(Number(job.payload.amount)),
        Contracargo: String(job.payload.disputeId ?? ''),
      })
      break
    case 'dispute_closed': {
      const status = String(job.payload.status ?? '')
      mail = internalEmail(`Contracargo cerrado (${status}): ${company?.name ?? ''}`, {
        'Qué hacer': ['won', 'warning_closed', 'prevented'].includes(status)
          ? 'Nada: el dinero se queda; licencia y zona siguen o vuelven'
          : status === 'lost'
            ? 'Nada: licencia anulada, rectificativa en curso y, sin otro pago único, el mensual cancelado'
            : 'Revisar en Stripe',
        ...base,
        Contracargo: String(job.payload.disputeId ?? ''),
      })
      break
    }
    case 'subscription_ended':
      mail = internalEmail(`Deja el mensual: ${company?.name ?? ''}`, {
        'Qué hacer': 'Nada: su licencia sigue valiendo; pierde mantenimiento y soporte al acabar el periodo pagado',
        Empresa: company?.name,
        Suscripción: String(job.payload.subscriptionId ?? ''),
      })
      break
    case 'unknown_product':
      mail = internalEmail(`URGENTE · Pago cobrado sin entregar: ${job.payload.product || 'producto desconocido'}`, {
        'Qué hacer': 'Un pago que la web no reconoce (un enlace de pago antiguo, una sesión creada a mano, sin metadatos): entregarlo a mano o devolverlo, y desactivar el origen en Stripe',
        ...Object.fromEntries(Object.entries(job.payload).filter(([k]) => k !== 'event').map(([k, v]) => [k, String(v)])),
      })
      break
    case 'awaiting_payment':
      mail = internalEmail(`Pago pendiente de cobrar: ${job.payload.sessionId}`, {
        'Qué hacer': 'Un pago con un método diferido (no debería: solo se admite tarjeta). Se entrega solo si se cobra; revisar los métodos de pago de Checkout en Stripe',
        ...Object.fromEntries(Object.entries(job.payload).filter(([k]) => k !== 'event').map(([k, v]) => [k, String(v)])),
      })
      break
    default:
      mail = internalEmail(`Aviso de Stripe sin compra: ${event}`, {
        'Qué hacer': 'Revisar en Stripe: un pago que la web no conoce',
        ...Object.fromEntries(Object.entries(job.payload).map(([k, v]) => [k, String(v)])),
      })
  }
  await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: job.key, tags: ['interno'] })
  return { sent: true }
}

export const HANDLERS: Record<string, StepHandler> = {
  invoice,
  rectify,
  license,
  account,
  booking,
  welcome,
  license_email: licenseMail,
  license_reminder: licenseReminder,
  renewal_email: renewalMail,
  refund_email: refundMail,
  announce,
  team_invite: teamInvite,
  company_alert: companyAlert,
  revoke,
  reinstate,
  cancel_subscription: cancelSubscription,
  notice,
}
