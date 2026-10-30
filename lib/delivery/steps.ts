// Los pasos de la cola. Cada uno es idempotente y apunta lo que ya hizo: si se repite (un reintento
// tras un fallo, o un trabajador que murio a mitad), continua donde se quedo sin duplicar nada.
//
// Pago unico: invoice, license, account, booking (Acompanado) -> welcome -> notice.
// Mensual (cada cobro): invoice, license -> renewal_email -> notice. Un cobro sin pagar:
// payment_failed_email (el aviso de la clausula 4, con la fecha a partir de la que se suspende).
// Con LICENSE_MODE=manual, license no firma: pide la licencia a Eric (license_reminder si tarda) y
// la bienvenida sale sin ella; al subirla, license_email (o renewal_email en un cobro del mensual).
// Devolucion o contracargo: revoke (y, sin pago unico vigente, cancel_subscription), rectify (tras
// invoice, si no esta parado), refund_email, notice; contracargo ganado: reinstate. Devolucion
// entera o contracargo perdido del Acompanado: cancel_bookings (sus sesiones que aun no han llegado,
// en Cal.com).
// Version nueva: announce (uno por persona). Alta en el equipo: team_invite. Compra con el NIF de
// otra empresa cliente: company_alert (a sus titulares).
//
// La factura lleva el IVA que se comprobo al llegar el pago (lib/delivery/tax-check.ts): el 21 %, o
// sin IVA con su mencion (inversion del sujeto pasivo a la UE, con la consulta de VIES en las notas;
// Canarias, Ceuta, Melilla y fuera de la UE, no sujeta). Las notas de Holded salen impresas en el PDF
// («Observaciones»): solo llevan la consulta de VIES; el pago de Stripe va en la descripcion (con el
// se encuentra la factura en un reintento) y lo que es para quien la emite, en el motivo de la
// retencion y en el aviso interno. Cada licencia con mantenimiento y soporte cubre 15 dias mas que lo
// pagado o incluido: el margen de un cobro del mensual que falla (clausula 4).

import { addMonths, formatLicenseId, type LicenseModality } from '../license.ts'
import {
  companyAlertEmail,
  formatDate,
  formatDateTime,
  internalEmail,
  licenseReadyEmail,
  paymentFailedEmail,
  refundEmail,
  renewalEmail,
  teamInviteEmail,
  versionEmail,
  welcomeEmail,
  zoneUrl,
} from './emails.ts'
import { issueLicense } from './license-issue.ts'
import { cancelLicenseRequests, requestManualLicense, restoreLicenseRequests, sendOverdueNotice } from './manual-license.ts'
import { hostName, isGuided, isOneTimeProduct, licenseTermsFor, productName, priceCents } from './products.ts'
import { parseEuVatId, viesText, writtenOtherTaxId } from './checkout-tax.ts'
import { EU_NO_VAT_STOP, euNoVatLevel, euNoVatSales } from './eu-sales.ts'
import { EU_DISTANCE_SALES_LIMIT, SPAIN_VAT_RATE, decideTax, viesNameMismatch, type TaxDecision } from './tax.ts'
import { TREATMENT_NAMES, isEuNoVatSale, taxMention, treatmentLine } from './tax-check.ts'
import { termsAttachment } from './terms.ts'
import { addDays, formatMoney, madridDate, paidUntil, withUnpaidMargin } from './util.ts'
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
  type ProviderDocument,
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

/**
 * La consulta de VIES que da por valido el NIF-IVA de una factura con inversion del sujeto pasivo:
 * su numero, cuando y, si los dio, el nombre y la direccion de ese NIF-IVA (muchos paises no los dan).
 */
export interface ViesEvidence {
  request: string
  checkedAt: string
  name?: string | null
  address?: string | null
}

/**
 * Lo de VIES en las notas de la factura, que salen impresas en el PDF («Observaciones»): solo la
 * consulta, su numero y su fecha. Si VIES lo da a otro nombre, eso va en el motivo de la retencion y
 * en el aviso (viesNameHold), no en la factura.
 */
function viesNote(vies: ViesEvidence): string {
  return `VIES ${vies.request} (${vies.checkedAt})`
}

/**
 * El borrador para Holded. reference va en la descripcion, con el pago de Stripe (asi un reintento la
 * encuentra: findDocument); notes, impresas, solo la consulta de VIES (o nada).
 */
function invoiceDraft(purchase: Purchase, contactId: string, reference: string, net: number, body: string | null, vies: string | null = null): InvoiceDraft {
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
    notes: vies,
  }
}

/**
 * El contacto de Holded de la empresa (lo crea la primera vez). Con una identificacion de fuera
 * (other), la que escribio el cliente, sin el pais que le pone delante la web: la de los metadatos
 * del pago (tax_id_written) o, sin ella, la que se deduce (writtenOtherTaxId). Asi no parece un
 * NIF-IVA en la factura ni en Verifactu; companies.tax_id sigue con el prefijo.
 */
async function contactOf(d: Delivery, company: Company, purchase: Purchase): Promise<string> {
  if (company.holdedContactId) return company.holdedContactId
  let code: string | null = null
  if (company.taxIdType === 'other') {
    const meta = purchase.stripeCheckoutSessionId ? (await d.payments.getCheckoutSession(purchase.stripeCheckoutSessionId)).metadata : {}
    code = writtenOtherTaxId(company.country, company.taxId, meta.tax_id === company.taxId ? meta.tax_id_written : null)
  }
  const contactId = await d.invoicer.ensureContact(company, code)
  await d.repo.updateCompany(company.id, { holdedContactId: contactId })
  return contactId
}

/**
 * Emitir (Verifactu), que Holded la mande y guardar el PDF para la zona; o dejarla en borrador
 * (modo draft, o si algo pide mirarla antes: emit false). Emitida por la web, lo que dice Holded de
 * su registro en Verifactu: si no es accepted, aviso urgente (ya esta aprobada: sale igual).
 */
async function finishDocument(d: Delivery, invoice: InvoiceRecord, purchase: Purchase, kind: InvoiceKind, emit: boolean, jobKey: string) {
  const providerId = invoice.providerId
  if (!providerId) throw new PermanentError(`la factura ${invoice.ref} no tiene documento en ${invoice.provider}`)
  if (invoice.status === 'draft' && !emit) return { status: 'draft', invoiceId: invoice.id }
  let approved: ProviderDocument | null = null
  if (invoice.status === 'draft') {
    approved = await d.invoicer.approveDocument(kind, providerId)
    invoice = await d.repo.updateInvoice(invoice.id, { status: 'approved', number: approved.number, approvedAt: now(d) })
  }
  if (invoice.status === 'approved') {
    // En un reintento (aprobada y sin enviar) se vuelve a leer: el aviso no se pierde si fallo al mandarlo.
    const doc = approved ?? (await d.invoicer.getDocument(kind, providerId))
    if (doc.verifactu !== 'accepted') await verifactuNotice(d, invoice, purchase, doc.verifactu, `${jobKey}:verifactu`)
    await d.invoicer.sendDocument(kind, providerId, purchase.email, purchase.locale)
    invoice = await d.repo.updateInvoice(invoice.id, { status: 'sent', sentAt: now(d) })
  }
  if (!invoice.storagePath) invoice = await storeInvoicePdf(d, invoice, kind)
  return { status: invoice.status, number: invoice.number, invoiceId: invoice.id }
}

/**
 * Una factura o rectificativa que la web aprobo en Holded y que Verifactu no da por aceptada (o Holded
 * no dice como esta): urgente, porque un registro que falta o que Hacienda rechaza hay que subsanarlo.
 */
async function verifactuNotice(d: Delivery, invoice: InvoiceRecord, purchase: Purchase, status: string | null | undefined, key: string) {
  const company = purchase.companyId ? await d.repo.getCompany(purchase.companyId) : null
  const what = invoice.kind === 'invoice' ? 'factura' : 'rectificativa'
  const mail = internalEmail(`URGENTE · Verifactu: ${what} ${invoice.number ?? invoice.ref} sin aceptar`, {
    'Qué hacer': `Holded la ha aprobado y su estado en Verifactu es «${status ?? 'sin dar'}», no «accepted». Mirarla en Holded (Opciones > Verifactu) y, si Hacienda la rechazó o no le llegó, subsanarla allí. La web se la manda igual al cliente y la deja en su zona`,
    Empresa: company?.name,
    Factura: invoice.number,
    Pago: purchase.paymentRef,
    Compra: purchase.id,
  })
  await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: key, tags: ['interno'] })
}

/**
 * Una factura que la web tiene en borrador y que en Holded ya se emitio a mano (con HOLDED_INVOICE_MODE=draft,
 * la conciliacion solo la ve de madrugada): se pone al dia como lo haria la conciliacion, con su PDF
 * para la zona y que Holded se la mande al cliente. Si sigue en borrador (o ya no esta), tal cual.
 */
async function refreshDraftInvoice(d: Delivery, invoice: InvoiceRecord, purchase: Purchase): Promise<InvoiceRecord> {
  if (invoice.status !== 'draft' || !invoice.providerId || invoice.provider !== d.invoicer.name) return invoice
  const providerId = invoice.providerId
  const doc = await d.invoicer.getDocument(invoice.kind, providerId).catch((error) => {
    if ((error as { status?: number }).status === 404) return null
    throw error
  })
  if (!doc?.approved) return invoice
  if (!invoice.storagePath) await storeInvoicePdf(d, { ...invoice, number: doc.number }, invoice.kind)
  await d.invoicer.sendDocument(invoice.kind, providerId, purchase.email, purchase.locale)
  return d.repo.updateInvoice(invoice.id, { status: 'sent', number: doc.number, approvedAt: now(d), sentAt: now(d) })
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

/**
 * Una factura que no se emite sola. created: hay borrador en Holded y, al verlo emitido, la
 * conciliacion se la manda al cliente; si no (ni se creo), la web no la conoce y se le manda a mano.
 */
async function holdNotice(d: Delivery, job: Job, purchase: Purchase, company: Company, what: string, reason: string, created: boolean) {
  const mail = internalEmail(`${what}: ${company.name}`, {
    'Qué hacer': created
      ? `Revisarla en Holded y emitirla a mano: al verla emitida, la web se la manda al cliente y la deja en su zona (conciliación diaria). ${reason}`
      : `Hacerla a mano en Holded (Verifactu) y enviársela al cliente desde Holded: la web no la conoce. ${reason}`,
    Empresa: company.name,
    NIF: company.taxId,
    País: company.country,
    IVA: TREATMENT_NAMES[purchase.taxTreatment],
    Importe: `${formatMoney(purchase.amountTotal, purchase.currency, 'es')} (IVA ${formatMoney(purchase.amountTax, purchase.currency, 'es')})`,
    Pago: purchase.paymentRef,
    Compra: purchase.id,
  })
  await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: `${job.key}:retenida`, tags: ['interno'] })
}

/** Intentos esperando a que VIES conteste (con la espera de la cola, unos minutos) antes de dejarla en borrador. */
const VIES_ATTEMPTS = 3

/**
 * La consulta de VIES de una factura con inversion del sujeto pasivo: la de antes de pagar (pago
 * unico, en el paso) o una nueva en cada cobro del mensual, con el NIF-IVA de PymaticLabs como
 * solicitante (el adaptador de VIES). Si el NIF-IVA ya no vale, ni se crea: ese cobro tenia que
 * llevar el 21 %. Si VIES no contesta, se reintenta y, al final, en borrador.
 */
async function viesEvidence(d: Delivery, job: Job, purchase: Purchase, company: Company): Promise<{ vies: ViesEvidence | null; hold: TaxDecision['hold'] }> {
  if (purchase.kind === 'one_time') {
    const vies = job.payload.vies as Partial<ViesEvidence> | undefined
    if (typeof vies?.request === 'string' && vies.request && typeof vies.checkedAt === 'string') {
      const name = typeof vies.name === 'string' && vies.name ? vies.name : null
      const address = typeof vies.address === 'string' && vies.address ? vies.address : null
      return { vies: { request: vies.request, checkedAt: vies.checkedAt, name, address }, hold: null }
    }
    return {
      vies: null,
      hold: { reason: 'sin la consulta de VIES de antes del pago (una compra entregada a mano): comprobar el NIF-IVA en VIES y poner su número de consulta en las notas antes de emitirla', mode: 'draft' },
    }
  }
  const query = company.country ? parseEuVatId(company.country, company.taxId) : null
  if (!query) return { vies: null, hold: { reason: `el NIF-IVA ${company.taxId} no tiene la forma de los de ${company.country ?? 'ningún país'}: no se puede preguntar a VIES`, mode: 'manual' } }
  // El adaptador no lanza: lo que no es un si o un no claros es unavailable.
  const answer = await d.vies.check({ countryCode: query.viesCountry, vatNumber: query.number })
  if (answer.status === 'unavailable') {
    if (job.attempts < VIES_ATTEMPTS) throw new RetryableError(`VIES no contesta: ${answer.reason}`)
    return { vies: null, hold: { reason: `VIES no contestó (${answer.reason}): comprobar el NIF-IVA ${company.taxId} antes de emitirla y poner su número de consulta en las notas`, mode: 'draft' } }
  }
  if (answer.status === 'invalid') {
    return {
      vies: null,
      hold: {
        reason: `el NIF-IVA ${company.taxId} ya no es válido en VIES${answer.reason ? ` (${answer.reason})` : ''}: este cobro tenía que llevar el 21 % de IVA. Hablar con la empresa y con Manel: cobrar la diferencia o facturarlo con el IVA dentro, y pasar su mensual al 21 % (el tipo de IVA de la suscripción y sus metadatos tax_*) mientras no vuelva a valer`,
        mode: 'manual',
      },
    }
  }
  // El nombre y la direccion, limpios como los del pago unico (en una linea, sin «---»).
  return { vies: { request: answer.requestIdentifier, checkedAt: answer.requestDate, name: viesText(answer.name), address: viesText(answer.address) }, hold: null }
}

/**
 * VIES da el NIF-IVA a un nombre que no se parece a la razon social (viesNameMismatch): puede ser el
 * de otra empresa. No frena la venta (la licencia, la bienvenida y la zona salen); la factura queda
 * en borrador con el motivo, que lleva el nombre de VIES y que hay que comprobarlo (en sus notas no:
 * salen impresas). Si no es suyo, el motivo dice todo lo que hay que deshacer: el IVA, la empresa
 * (eu_vat con un NIF-IVA ajeno), la licencia y el mensual.
 */
function viesNameHold(vies: ViesEvidence, company: Company): NonNullable<TaxDecision['hold']> {
  return {
    reason: `VIES da el NIF-IVA ${company.taxId} a nombre de «${vies.name}»${vies.address ? ` (${vies.address})` : ''}, que no se parece a «${company.name}»: comprobar con la empresa que es suyo antes de emitirla; si no lo es, le tocaba el ${SPAIN_VAT_RATE} % (cobrar la diferencia o devolver el pago, y la factura, a mano); corregir tax_id y tax_id_type de la empresa en companies, pedir una licencia nueva con la identificación buena y, si tiene el mensual, pasarlo al ${SPAIN_VAT_RATE} % (el tipo de IVA de la suscripción y sus metadatos tax_*)`,
    mode: 'draft',
  }
}

const invoice: StepHandler = async (d, job) => {
  let purchase = await purchaseOf(d, job)
  const company = await companyOf(d, purchase)
  const ref = `invoice:${purchase.id}`
  let record = await d.repo.getInvoiceByRef(ref)
  let vies: ViesEvidence | null = null
  let otherName = false
  if (!record) {
    // El IVA que se comprobo al llegar el pago (lib/delivery/tax-check.ts), con lo que cobro Stripe:
    // solo se factura sola si cuadra; lo demas, a mano.
    const decision = decideTax(
      purchase,
      company,
      await d.payments.taxDetails({ checkoutSessionId: purchase.stripeCheckoutSessionId, invoiceId: purchase.stripeInvoiceId, customerId: purchase.stripeCustomerId })
    )
    if (decision.treatment !== purchase.taxTreatment || decision.rate !== purchase.taxRate) {
      purchase = await d.repo.updatePurchase(purchase.id, { taxTreatment: decision.treatment, taxRate: decision.rate })
    }
    const holds = decision.hold ? [decision.hold] : []
    // Sin IVA a una empresa de la UE, solo con el NIF-IVA valido en VIES (y su numero de consulta en la factura).
    if (decision.treatment === 'reverse_charge' && decision.hold?.mode !== 'manual') {
      const evidence = await viesEvidence(d, job, purchase, company)
      vies = evidence.vies
      if (evidence.hold) holds.push(evidence.hold)
      otherName = Boolean(vies && viesNameMismatch(vies.name, company.name))
      if (vies && otherName) holds.push(viesNameHold(vies, company))
    }
    const held = holds.length ? { reason: holds.map((h) => h.reason).join('. '), mode: holds.some((h) => h.mode === 'manual') ? ('manual' as const) : ('draft' as const) } : null
    if (held?.mode === 'manual') {
      // Ni se crea: con un IVA dudoso, la factura la hace una persona.
      await holdNotice(d, job, purchase, company, 'Facturar a mano', held.reason, false)
      return { status: 'held', hold: held.reason }
    }
    let hold = held?.reason ?? null
    const contactId = await contactOf(d, company, purchase)
    const reference = `${productName(purchase.product, purchase.locale)} · ${purchase.paymentRef}`
    // Un intento anterior pudo crearla en Holded y cortarse antes de apuntarla: se busca primero.
    const found = job.attempts > 1 ? await d.invoicer.findDocument('invoice', contactId, purchase.paymentRef) : null
    const doc =
      found ??
      (await d.invoicer.createDocument(
        'invoice',
        invoiceDraft(purchase, contactId, reference, purchase.amountSubtotal - purchase.amountDiscount, taxMention(purchase.taxTreatment, company, purchase.locale, d.config.vies.requester), vies && viesNote(vies))
      ))
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
  if (record.holdReason && record.status === 'draft') await holdNotice(d, job, purchase, company, 'Factura en borrador, sin emitir', record.holdReason, true)
  const result = await finishDocument(d, record, purchase, 'invoice', d.config.invoiceMode === 'emit' && !record.holdReason, job.key)
  // Para el aviso de la venta: la consulta y, si VIES lo dio, a nombre de quien esta el NIF-IVA.
  const viesResult = vies ? { vies: vies.request, ...(vies.name ? { viesName: vies.name } : {}), ...(otherName ? { viesOtherName: true } : {}) } : {}
  return { ...result, ...(record.holdReason ? { hold: record.holdReason } : {}), ...viesResult }
}

const rectify: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  // Una compra que se quedo a revisar (y se devuelve) no tuvo factura: nada que rectificar. Tampoco un
  // cobro del mensual a revisar: tiene empresa, pero nunca tuvo el paso de la factura. Una retenida
  // para facturar a mano o una entregada a mano (deliver) si lo tienen.
  if (!purchase.companyId) return { status: 'sin factura' }
  const invoiceJob = await d.repo.getJobByKey(`invoice:${purchase.id}`)
  if (!invoiceJob && !(await d.repo.getInvoiceByRef(`invoice:${purchase.id}`))) return { status: 'sin factura' }
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
  let original = await d.repo.getInvoiceByRef(`invoice:${purchase.id}`)
  // El paso de la factura esta parado (la devolucion no lo espera): ni factura ni rectificativa.
  if (!original && invoiceJob?.status === 'dead') {
    return manual('La factura no llegó a hacerse (el paso invoice está parado): la factura y su rectificativa, a mano en Holded, y enviárselas al cliente desde Holded (si se reintenta ese paso, la web hace la factura, pero la rectificativa sigue siendo a mano)')
  }
  // La factura se retuvo para hacerla a mano (IVA dudoso): la rectificativa, tambien a mano (y la web
  // no la conoce: se manda desde Holded).
  if (!original) return manual('La factura no se hizo sola (estaba retenida): rectificarla a mano en Holded y enviarle la rectificativa al cliente desde Holded')
  // El borrador guardado puede ir un dia por detras de Holded (la conciliacion lo pone al dia de
  // madrugada): si ya se emitio a mano, se pone al dia ahora y se rectifica como una emitida.
  if (original.status === 'draft') original = await refreshDraftInvoice(d, original, purchase)
  // La factura sigue en borrador (emision a mano): el cliente no la recibio y el correo de la
  // devolucion no le promete rectificativa. Si se emite, la conciliacion se la manda; la rectificativa
  // hecha a mano, no.
  if (original.status === 'draft') {
    return manual('La factura sigue en borrador en Holded: anularla; o emitirla (la web se la manda al cliente al verla emitida), rectificarla a mano y enviarle la rectificativa desde Holded')
  }

  // Nunca mas abonado que lo cobrado, aunque lleguen avisos raros.
  const credited = (await d.repo.listInvoicesByCompany(company.id))
    .filter((i) => i.kind === 'credit_note' && i.purchaseId === purchase.id && i.ref !== ref)
    .reduce((sum, i) => sum + Math.abs(i.amountTotal), 0)
  if (credited + amount > purchase.amountTotal) {
    throw new PermanentError(`rectificativas de ${formatMoney(credited + amount, purchase.currency, 'es')} para un cobro de ${formatMoney(purchase.amountTotal, purchase.currency, 'es')}`)
  }
  let record = await d.repo.getInvoiceByRef(ref)
  if (!record) {
    const contactId = await contactOf(d, company, purchase)
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
    const doc =
      found ??
      (await d.invoicer.createDocument('credit_note', {
        ...invoiceDraft(purchase, contactId, reference, sign * base, [body, taxMention(purchase.taxTreatment, company, purchase.locale, d.config.vies.requester)].filter(Boolean).join('\n')),
        date: madridDate(d.clock()),
      }))
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
      'Qué hacer': `En Holded, la rectificativa en borrador: enlazarla a la factura ${original.number ?? original.ref} (tipo R1 si es una devolución), revisar el signo de los importes y emitirla. Al verla emitida, la web se la manda al cliente y la deja en su zona (conciliación diaria)`,
      Empresa: company.name,
      Importe: formatMoney(amount, purchase.currency, 'es'),
      Pago: purchase.paymentRef,
      Motivo: motive,
    })
    await d.mailer.send({ to: d.config.internalEmail, ...mail, idempotencyKey: `${job.key}:borrador`, tags: ['interno'] })
  }
  return finishDocument(d, record, purchase, 'credit_note', emit, job.key)
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

  // Con mantenimiento y soporte (meses incluidos o un cobro del mensual), la licencia cubre 15 dias
  // mas que lo pagado o incluido: si el cobro siguiente falla, siguen llegando las versiones nuevas
  // durante el aviso de la clausula 4 (socios, 27-10-2026); si no se paga, dejan de llegar.
  let terms: { modalidad: LicenseModality; equipo: boolean; soporte_hasta: string }
  if (purchase.kind === 'one_time') {
    if (!isOneTimeProduct(purchase.product)) throw new PermanentError(`producto desconocido: ${purchase.product}`)
    const product = licenseTermsFor(purchase.product, emitida)
    terms = { ...product, soporte_hasta: product.soporte_hasta > emitida ? withUnpaidMargin(product.soporte_hasta) : product.soporte_hasta }
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
      withUnpaidMargin(purchase.supportUntil ?? addMonths(emitida, 1)),
      emitida,
      ...licenses.map((l) => l.soporteHasta),
      ...pending.map((r) => r.soporteHasta),
      ...paid.map((p) => withUnpaidMargin(p.supportUntil!)),
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
    siteUrl: d.config.siteUrl,
  })
  const mail = welcomeEmail({
    locale: purchase.locale,
    company: company.name,
    product: purchase.product,
    licenseId: lic?.id ?? null,
    // Lo incluido, sin el margen de un cobro fallido (la licencia cubre 15 dias mas).
    supportUntil: paidUntil(lic ?? requested!),
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
    supportUntil: paidUntil(lic),
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
    supportUntil: paidUntil(lic),
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
  // Con otro pago unico vigente, la zona sigue (revoke no la cerro): no se le pide que borre nada.
  const accessRevoked = revoked?.accessRevoked !== false
  // Pero si quien compro esta era otra persona (entregada a mano), revoke la saco de la zona.
  const ownAccessClosed = Array.isArray(revoked?.dropped) && (revoked.dropped as unknown[]).includes(purchase.email)
  // La rectificativa solo se promete si la factura ya se emitio: un borrador no le llego al cliente
  // (el aviso pide anularlo o emitirlo y rectificarlo a mano). Este paso espera a rectify, que pone
  // al dia una factura emitida a mano en Holded ese mismo dia.
  const original = await d.repo.getInvoiceByRef(`invoice:${purchase.id}`)
  const mail = refundEmail({
    locale: purchase.locale,
    company: company.name,
    amount: Number(job.payload.amount) || purchase.amountRefunded,
    currency: purchase.currency,
    subscriptionCanceled: Boolean(revoked?.subscriptionCanceled),
    accessRevoked,
    ownAccessClosed,
    licenseId: typeof revoked?.licenseId === 'string' ? revoked.licenseId : null,
    product: purchase.product,
    creditNote: Boolean(original && original.status !== 'draft'),
  })
  await d.mailer.send({ to: purchase.email, ...mail, idempotencyKey: job.key, tags: ['devolucion'] })
  return { sent: true, accessRevoked, ownAccessClosed }
}

/**
 * Clausula 4: un cobro del mensual sin pagar. A los titulares, con la fecha a partir de la que se
 * suspende el mantenimiento y soporte (15 dias despues del primer fallo) y el enlace para pagarlo.
 */
const paymentFailedMail: StepHandler = async (d, job) => {
  const company = await d.repo.getCompany(text(job, 'companyId'))
  if (!company) throw new PermanentError('payment_failed_email: no existe la empresa')
  // Un reintento de Stripe pudo cobrarla antes de que corriera este paso: ya no hay nada que avisar.
  if (await d.repo.getPurchaseByPaymentRef(text(job, 'invoiceId'))) return { sent: 0, reason: 'ya cobrada' }
  const payUrl = typeof job.payload.payUrl === 'string' && job.payload.payUrl.startsWith('https://') ? job.payload.payUrl : null
  const suspendFrom = text(job, 'suspendFrom')
  // Las versiones nuevas siguen durante el aviso si la licencia vigente llega hasta entonces (cada
  // licencia con mantenimiento cubre 15 dias mas que lo pagado): solo entonces el correo lo promete.
  const covered = [
    ...(await d.repo.listLicensesByCompany(company.id)).filter((l) => !l.revokedAt).map((l) => l.soporteHasta),
    ...(await d.repo.listLicenseRequests({ companyId: company.id, status: 'pending' })).map((r) => r.soporteHasta),
  ]
    .sort()
    .pop()
  const mail = paymentFailedEmail({
    locale: company.locale,
    company: company.name,
    product: typeof job.payload.product === 'string' ? job.payload.product : null,
    amount: Number(job.payload.amount) || 0,
    currency: typeof job.payload.currency === 'string' ? job.payload.currency : company.currency,
    vatIncluded: job.payload.vatIncluded !== false,
    suspendFrom,
    versionsUntilSuspension: Boolean(covered && covered >= addDays(suspendFrom, -1)),
    // Tras los meses incluidos, la prueba acaba el dia siguiente a lo incluido y la licencia cubre un
    // dia menos que el aviso: el correo promete hasta donde cubre.
    versionsUntil: covered,
    payUrl,
    zoneUrl: zoneUrl(d.config.siteUrl, company.locale),
  })
  const to = await ownerEmails(d, company)
  for (const [i, email] of to.entries()) {
    await d.mailer.send({ to: email, ...mail, idempotencyKey: `${job.key}:${i}`, tags: ['mensual-impagado'] })
  }
  return { sent: to.length, suspendFrom: job.payload.suspendFrom }
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

/**
 * Los mensuales vivos de empresas de otro pais de la UE sin NIF-IVA: siguen cobrando el 21 % aunque
 * el pago de las ventas nuevas asi ya este parado (lib/delivery/eu-sales.ts). Para el aviso urgente.
 */
async function euNoVatSubscriptions(d: Delivery): Promise<string | null> {
  const alive = (await d.repo.listActiveCompanies()).filter(
    (c) => isEuNoVatSale({ taxTreatment: 'standard' }, c) && c.taxIdType !== 'eu_vat' && c.subscriptionId && ALIVE.includes(c.subscriptionStatus ?? 'active')
  )
  return alive.length ? alive.map((c) => `${c.name} (${c.country}, ${c.subscriptionPlan ? productName(c.subscriptionPlan, 'es') : 'mensual'})`).join(' · ') : null
}

/** El soporte_hasta de una licencia en un aviso interno: con mantenimiento, lo pagado y el margen que firma. */
function supportLine(l: { emitida: string; soporteHasta: string }): string {
  return l.soporteHasta > l.emitida ? `soporte hasta ${paidUntil(l)}; firmada hasta ${l.soporteHasta}, con los 15 días de margen` : 'sin mantenimiento ni soporte'
}

/** Los correos de los titulares de la empresa (o el de su primera compra, si no queda ninguno). */
async function ownerEmails(d: Delivery, company: Company): Promise<string[]> {
  const owners = (await d.repo.listMembers(company.id)).filter((m) => m.role === 'owner').map((m) => m.email)
  return [...new Set(owners.length ? owners : [company.email])]
}

/** A los titulares de la empresa: alguien compro con su NIF desde otro correo (la compra, a revisar). */
const companyAlert: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const company = await d.repo.getCompany(text(job, 'companyId'))
  if (!company) throw new PermanentError('company_alert: no existe la empresa')
  const to = await ownerEmails(d, company)
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

/**
 * Devolucion entera o contracargo perdido del Acompanado: sus sesiones que aun no han llegado se
 * cancelan en Cal.com y en la zona. Las que ya pasaron se quedan. Repetirlo no hace nada.
 */
const cancelBookings: StepHandler = async (d, job) => {
  const purchase = await purchaseOf(d, job)
  const dispute = job.payload.reason === 'dispute'
  const en = purchase.locale === 'en'
  // Lo lee el cliente en el correo de Cal.com.
  const reason = dispute ? (en ? 'Payment charged back' : 'Pago con contracargo') : en ? 'Purchase refunded' : 'Compra devuelta'
  const cancelled: { number: number; host: string; startAt: string }[] = []
  const bookings = purchase.companyId ? await d.repo.listBookingsByCompany(purchase.companyId) : []
  for (const booking of bookings) {
    if (booking.purchaseId !== purchase.id || booking.status !== 'booked') continue
    if (new Date(booking.startAt) <= d.clock()) continue
    const result = booking.providerUid ? await d.calendar.cancel(booking.providerUid, reason) : 'gone'
    // Cal.com dice que ya acabo: como una que ya paso, se queda.
    if (result === 'ended') continue
    await d.repo.updateBooking(booking.id, { status: 'cancelled', note: `cancelada: ${dispute ? 'contracargo' : 'devolución'}` })
    cancelled.push({ number: booking.number, host: booking.host, startAt: booking.startAt })
  }
  return { cancelled }
}

/** Las sesiones que cancelo ese paso, para el aviso interno (null si ninguna). */
async function cancelledSessions(d: Delivery, key: string): Promise<string | null> {
  const list = (await d.repo.getJobByKey(key))?.result?.cancelled
  if (!Array.isArray(list) || !list.length) return null
  return (list as { number: number; host: string; startAt: string }[]).map((s) => `${s.number}ª con ${hostName(s.host)}, ${formatDateTime(s.startAt, 'es')}`).join(' · ')
}

// --- Avisos a PymaticLabs ----------------------------------------------------------------------------

/** Entregar a mano una compra a revisar ya aclarada (sin empresa ni status paid, la llamada da 409). */
const DELIVER_BY_HAND =
  'crear su fila en companies con los datos buenos (país, dirección, tax_id y tax_id_type; si el NIF ya es de una empresa cliente, comprobarlo antes con sus titulares), poner company_id, tax_treatment y status \'paid\' en la compra, y entonces POST /api/admin/jobs {"action":"deliver","purchaseId":"<id>"}'

/** La plaza de lanzamiento de una compra a revisar queda gastada. */
const LAUNCH_NOTE =
  'Si pagó el precio de lanzamiento, su plaza queda gastada, en la web y en Stripe (el uso del cupón): no liberarla en la web sin subir a la vez max_redemptions del cupón de esa modalidad, o Stripe no dejaría abrir el pago de la plaza 10'

export const REVIEW_TODO: Record<string, string> = {
  missing_data:
    'Pedir al cliente la razón social y el NIF. Si el NIF ya es de una empresa cliente, comprobarlo antes con sus titulares; si no, crear su fila en companies. Después, poner company_id y status \'paid\' en la compra, y entonces POST /api/admin/jobs {"action":"deliver","purchaseId":"<id>"}',
  country_mismatch: `Lo declarado antes de pagar no vale, o no cuadra con la dirección de facturación de Stripe (otro país o, en España, otro territorio: la península o Baleares, Canarias, Ceuta o Melilla), y el IVA cobrado puede no ser el que toca (los problemas, en Datos): ni licencia, ni factura, ni zona. Aclararlo con el cliente. Si vale lo declarado (un dato mal puesto en Stripe), ${DELIVER_BY_HAND}. Si no, devolver el pago (no hay factura que rectificar) y que vuelva a comprar con sus datos. ${LAUNCH_NOTE}`,
  country_mismatch_renewal:
    'Un cobro del mensual con los datos fiscales de la suscripción (sus metadatos tax_*) que no valen, o con la dirección de facturación cambiada (en el portal o en el pago) a otro país u otro territorio que los de la empresa: ni licencia ni factura de este cobro; la zona y la licencia del pago único siguen. Hablar con la empresa: si un dato está mal puesto, corregirlo en Stripe y entregarlo a mano; si de verdad se ha mudado, devolver el cobro (o cobrar la diferencia) y poner al día el tipo de IVA de la suscripción y sus metadatos tax_* en Stripe, y su país y su dirección en companies',
  vat_mismatch: `El IVA cobrado no es el que toca a lo declarado (el 21 % de la base tras el cupón en la península y Baleares o en la UE sin NIF-IVA; nada en los demás), o no se cobró en euros: ni licencia, ni factura, ni zona. Revisar el tipo de IVA de Stripe (scripts/stripe-setup.mts, comprobación de producción). Si se cobró IVA de más, devolver solo el IVA (devolución parcial en Stripe); si faltó, cobrar la diferencia o devolver el pago. Después, para entregarla a mano: ${DELIVER_BY_HAND}; con el IVA de más devuelto, su factura sale como «Facturar a mano» (hacerla en Holded sin IVA). ${LAUNCH_NOTE}`,
  card_country: `Una venta sin IVA español fuera de la UE pagada con una tarjeta de España o de otro país de la UE (los problemas, en Datos): ni licencia, ni factura, ni zona. Puede ser una empresa de fuera con la tarjeta de un banco europeo, o una de España o de la UE que tenía que pagar con IVA. Pedirle una prueba de que está establecida en el país declarado: un certificado de su administración tributaria o su inscripción en el registro mercantil de allí (art. 18.3 del Reglamento de Ejecución (UE) 282/2011). Si lo está, ${DELIVER_BY_HAND}. Si no, devolver el pago y que vuelva a comprar con su país. La tarjeta no se rechaza nunca por su país (Reglamento (UE) 2018/302). ${LAUNCH_NOTE}`,
  vat_mismatch_renewal:
    'Un cobro del mensual sin el IVA que le toca a la empresa (el 21 %, o nada sin IVA español), o no en euros: ni licencia ni factura de este cobro; la zona y la licencia del pago único siguen. Revisar el tipo de IVA de la suscripción en Stripe (default_tax_rates). Si se cobró IVA de más, devolver solo el IVA (devolución parcial en Stripe); si faltó, cobrar la diferencia o devolver el cobro. Después, para entregarlo a mano: status \'paid\' en la compra y POST /api/admin/jobs {"action":"deliver","purchaseId":"<id>"}; con el IVA de más devuelto, su factura sale como «Facturar a mano» (hacerla en Holded sin IVA)',
  // De cuando solo se vendia en Espana (compras de antes en la base de datos).
  outside_spain: `Venta de cuando solo se vendía en España, con la dirección de facturación en otro sitio o sin un NIF español válido: ni licencia, ni factura, ni zona. Devolver el pago en Stripe, o, si es una empresa española con la dirección o el NIF mal puestos, ${DELIVER_BY_HAND}. ${LAUNCH_NOTE}`,
  outside_spain_renewal:
    'Un cobro del mensual con la dirección de facturación cambiada a otro país o territorio (en el portal o en el pago): ni licencia ni factura de este cobro; la zona y la licencia del pago único siguen. Hablar con la empresa y devolver el cobro o entregarlo a mano',
  vat_not_21:
    'No se cobró el 21 % de IVA en euros: ni licencia ni factura. Revisar el tipo de IVA de Stripe (scripts/stripe-setup.mts, comprobación de producción) y devolver el pago o cobrar la diferencia antes de entregarla a mano',
  nif_conflict:
    'Alguien ha comprado con el NIF de una empresa que ya es cliente, desde un correo que no es de sus titulares (ya avisados). Comprobarlo con ellos antes de dar nada: si es de la empresa, poner company_id y status paid en la compra y entregarla (POST /api/admin/jobs {"action":"deliver","purchaseId":"<id>"}); si no, devolver el pago',
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
  else if (inv?.status === 'draft') todo.push('Emitir la factura en Holded (Verifactu): al verla emitida, la web se la manda al cliente y la deja en su zona (conciliación diaria)')
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
    case 'renewal': {
      // Las ventas con IVA espanol a otro pais de la UE sin NIF-IVA (como a particulares), de todas
      // las compras (lib/delivery/eu-sales.ts): desde 8.000 euros en el ano el pago ya no abre ventas
      // nuevas asi, pero los mensuales que ya hay siguen cobrando el 21 %: cada uno, aviso urgente.
      // Pasados 10.000 euros (o en el ano anterior), el IVA del pais del cliente por la ventanilla unica (OSS).
      const euNoVat = purchase && company && isEuNoVatSale(purchase, company) ? await euNoVatSales(d.repo, new Date(purchase.paidAt), purchase.livemode) : null
      const euLevel = euNoVat ? euNoVatLevel(euNoVat) : null
      const euSummary = euNoVat ? `${money(euNoVat.current)} este año${euNoVat.previous ? ` y ${money(euNoVat.previous)} el anterior` : ''}` : ''
      const euMonthly = euLevel ? await euNoVatSubscriptions(d) : null
      const stillCharging = `los mensuales que ya hay siguen cobrando el 21 %${euMonthly ? ` (${euMonthly})` : ''}`
      if (euNoVat) {
        todo.push(
          'En Holded, antes de aprobar la factura: Opciones > Verifactu, tipo de identificación «Documento oficial» (04) u «Otro» (06), no NIF/IVA (la regla de Holded por país pone NIF/IVA a toda la UE, y este cliente no lo tiene)'
        )
      }
      if (euLevel === 'over') {
        todo.push(
          `Las ventas con IVA español a la UE sin NIF-IVA ya van por ${euSummary}, más de ${money(EU_DISTANCE_SALES_LIMIT)}: la web ya no abre pagos nuevos así, pero ${stillCharging}. Con Manel, alta en la ventanilla única (OSS, modelo 035) y cobrar el IVA del país del cliente a las de la UE sin NIF-IVA (y rectificar la que pasó el límite)`
        )
      } else if (euLevel === 'stop') {
        todo.push(
          `Las ventas con IVA español a la UE sin NIF-IVA van por ${euSummary}: desde ${money(EU_NO_VAT_STOP)} la web ya no abre pagos nuevos así (piden escribir a info@pymaticlabs.com), pero ${stillCharging}. Con Manel, antes de pasar de ${money(EU_DISTANCE_SALES_LIMIT)}: la ventanilla única (OSS, modelo 035) o qué hacer con esos mensuales`
        )
      }
      const vies = typeof invoiceJob?.result?.vies === 'string' ? invoiceJob.result.vies : null
      const viesName = typeof invoiceJob?.result?.viesName === 'string' ? invoiceJob.result.viesName : null
      const viesOther = invoiceJob?.result?.viesOtherName === true ? ', que no se parece a la razón social (ver Qué hacer)' : ''
      mail = internalEmail(`${euLevel ? 'URGENTE · ' : ''}${event === 'sale' ? 'Venta' : 'Cobro del mensual'}: ${lic?.id ?? (requested ? 'licencia a mano' : 'sin licencia')} · ${company?.name ?? ''}`, {
        'Qué hacer': todo.join('. ') || 'Nada: entregada sola',
        ...base,
        País: company?.country,
        Licencia: lic
          ? `${lic.id} (${supportLine(lic)})`
          : requested
            ? `a mano: ${requested.status === 'pending' ? 'pedida, sin firmar' : requested.status} (${supportLine(requested)})`
            : null,
        Factura: inv ? `${inv.number ?? 'sin número'} (${inv.status})` : held ? 'retenida' : 'pendiente',
        Importe: purchase ? money(purchase.amountTotal) : null,
        // Retenida para facturar a mano (un NIF-IVA que ya no vale en VIES, el 21 % a quien no le
        // tocaba...) o en borrador porque VIES da el NIF-IVA a otro nombre (puede no ser suyo): el
        // IVA de la factura aun no esta decidido, y no va al 349 hasta aclararlo.
        IVA: purchase
          ? (invoiceJob?.result?.status === 'held' || invoiceJob?.result?.viesOtherName === true) && purchase.taxTreatment === 'reverse_charge'
            ? `${TREATMENT_NAMES[purchase.taxTreatment]}, pendiente: factura retenida (ver Qué hacer); no va al modelo 349 hasta aclararla`
            : treatmentLine(purchase)
          : null,
        VIES: vies ? `consulta ${vies}${viesName ? `, a nombre de «${viesName}»${viesOther}` : ''}` : null,
        'Ventas a la UE sin NIF-IVA': euNoVat ? `${euSummary} (límite: ${money(EU_DISTANCE_SALES_LIMIT)} al año)` : null,
        Lanzamiento: purchase?.launch ? 'sí' : null,
        Sesión: first ? `${hostName(first.host)}, ${formatDateTime(first.startAt, 'es')} (${first.status})` : null,
        Novedades: purchase?.marketingOptIn ? 'quiere recibirlas' : null,
      })
      break
    }
    case 'review': {
      const reason = String(job.payload.reason ?? 'missing_data')
      const other = typeof job.payload.companyId === 'string' && reason === 'nif_conflict' ? await d.repo.getCompany(job.payload.companyId) : null
      // Un cobro del mensual: la zona y la licencia del pago unico siguen (su propio todo).
      const todoKey = purchase?.kind === 'renewal' && REVIEW_TODO[`${reason}_renewal`] ? `${reason}_renewal` : reason
      // Con el NIF de otro cliente y ademas sin cuadrar el IVA: que no se entregue sin aclararlo.
      // Solo eso: el todo del IVA repetiria lo de los titulares y lo de devolver.
      const data = (purchase?.reviewData ?? null) as { problems?: unknown; todo?: unknown } | null
      const taxIssue = reason === 'nif_conflict' && Array.isArray(data?.problems) && data.problems.length
        ? 'Además, no cuadran el IVA o los datos fiscales (los problemas, en Datos): aunque sea de la empresa, no entregarla sin aclararlo antes con ella'
        : null
      // Los datos, sin lo que hay que hacer: ya va arriba.
      const shown = Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => key !== 'todo'))
      mail = internalEmail(`${reason === 'nif_conflict' ? 'URGENTE · Compra con el NIF de otro cliente' : 'Venta a revisar'} (${purchase?.paymentRef})`, {
        'Qué hacer': [REVIEW_TODO[todoKey] ?? REVIEW_TODO.missing_data, taxIssue].filter(Boolean).join('. '),
        ...base,
        'Empresa del NIF': other ? `${other.name} (${other.taxId})` : null,
        Datos: data ? JSON.stringify(shown).slice(0, 1500) : null,
      })
      break
    }
    case 'refund': {
      // Lo que paso de verdad (el aviso espera a revoke y a rectify): un cobro a revisar no se
      // entrego; una compra repetida no cierra la zona; con la factura en borrador, la rectificativa va a mano.
      const full = job.payload.full === true
      const revoked = full && purchase ? (await d.repo.getJobByKey(`revoke:${purchase.id}:refund`))?.result : null
      const rectified = purchase && typeof job.payload.refundId === 'string' ? (await d.repo.getJobByKey(`rectify:${purchase.id}:${job.payload.refundId}`))?.result : null
      const credit = rectified?.status === 'manual' ? 'rectificativa a mano (ver el aviso aparte)' : 'rectificativa en curso'
      const done = !full
        ? 'Devolución parcial: la licencia sigue'
        : purchase?.kind === 'renewal'
          ? 'licencia de ese cobro del mensual anulada; la zona y la licencia del pago único siguen'
          : revoked?.accessRevoked === false
            ? 'licencia de esa compra anulada; la empresa sigue con su otra compra y su zona'
            : 'licencia anulada, zona cerrada'
      const what = !purchase?.companyId || rectified?.status === 'sin factura'
        ? 'Nada: ese cobro no se había entregado (sin licencia ni factura)'
        : rectified?.status === 'manual'
          ? `Rectificar a mano (ver el aviso aparte). ${full ? `${done[0].toUpperCase()}${done.slice(1)}` : done}`
          : full
            ? `Nada: ${done} y ${credit}`
            : `${done}; ${credit}`
      mail = internalEmail(`Devolución${full ? '' : ' parcial'}: ${company?.name ?? purchase?.paymentRef}`, {
        'Qué hacer': what,
        ...base,
        Devuelto: money(Number(job.payload.amount)),
        Licencia: lic ? `${lic.id}${lic.revokedAt ? ' (anulada)' : ''}` : null,
        'Sesiones canceladas': full && purchase ? await cancelledSessions(d, `cancel_bookings:${purchase.id}:refund`) : null,
      })
      break
    }
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
        'Sesiones canceladas': status === 'lost' && purchase ? await cancelledSessions(d, `cancel_bookings:${purchase.id}:dispute-lost:${job.payload.disputeId}`) : null,
      })
      break
    }
    case 'subscription_ended':
      mail = internalEmail(`Deja el mensual: ${company?.name ?? ''}`, {
        'Qué hacer': 'Nada: su licencia sigue valiendo; pierde mantenimiento y soporte al acabar el periodo pagado (su licencia cubre las versiones 15 días más, el margen de un cobro fallido)',
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
  payment_failed_email: paymentFailedMail,
  announce,
  team_invite: teamInvite,
  company_alert: companyAlert,
  revoke,
  reinstate,
  cancel_subscription: cancelSubscription,
  cancel_bookings: cancelBookings,
  notice,
}
