// Licencias a mano (LICENSE_MODE=manual): hasta que el producto acepte la clave de la web, cada
// licencia la firma Eric en su Mac con la clave que el producto ya conoce (licencias.pub).
//
// 1. El paso license no firma: apunta la licencia pedida (tabla license_requests) con lo que tiene
//    que llevar, sacado de la compra, y se la pide a Eric por correo con los campos y como subirla.
//    La bienvenida sale igual, sin la licencia ("te llega en unas horas"), y la zona la ensena como
//    pendiente. El numero lo pone Eric, de su numeracion (del 0001 al 5000): la web no lo reparte.
// 2. Eric la sube firmada (scripts/subir-licencia.mts o POST /api/admin/licenses). La web la
//    comprueba con su publica y con la compra (NIF, modalidad, equipo, emitida y soporte_hasta), la guarda,
//    se la manda al cliente (en un .zip, como siempre) y la zona la ofrece para bajarla.
// 3. Sin firmar a las LICENSE_PENDING_ALERT_HOURS horas, aviso (y la conciliacion lo repite cada
//    dia). Una devolucion o un contracargo antes de firmarla la cancelan, y se le dice a Eric; si el
//    contracargo se gana, se vuelve a pedir. Si llegan a la vez que la subida, gana la cancelacion
//    (la pedida cambia de estado solo si sigue en el de antes) y la licencia subida queda anulada.
//
// Un pago de prueba nunca se entrega con la clave del Mac, ni uno de verdad con una de pruebas
// (LICENSE_MANUAL_PUBLIC_KEY), como pasa con la clave de la web y LICENSE_KEY_ENV.

import { verify } from 'node:crypto'
import { canonical, LicenseError, licenseFileName, publicKeyFromRaw, verifyLicense, type LicenseData, type LicenseModality } from '../license.ts'
import { internalEmail, licenseRequestEmail } from './emails.ts'
import { WEB_LICENSE_FIRST } from './license-issue.ts'
import { cleanCompanyName } from './util.ts'
import type { Delivery } from './container.ts'
import type { Company, LicenseRecord, LicenseRequest, NewJob, Purchase } from './types.ts'

export class LicenseUploadError extends Error {
  status: 400 | 404 | 409
  constructor(status: 400 | 404 | 409, message: string) {
    super(message)
    this.name = 'LicenseUploadError'
    this.status = status
  }
}

export interface ManualTerms {
  modalidad: LicenseModality
  equipo: boolean
  soporte_hasta: string
}

/** Lo justo de una licencia pedida para firmarla y comprobarla (lo que dan GET /api/admin/licenses y el script). */
export function requestView(request: LicenseRequest) {
  return {
    compra: request.purchaseId,
    tipo: request.kind,
    estado: request.status,
    pago: request.paymentRef,
    prueba: !request.livemode,
    plazas: request.seats,
    licencia: request.licenseId,
    pedida: request.createdAt,
    cancelada: request.cancelReason,
    campos: { cliente: request.cliente, nif: request.nif, modalidad: request.modalidad, equipo: request.equipo, emitida: request.emitida, soporte_hasta: request.soporteHasta },
  }
}

async function sendRequest(d: Delivery, request: LicenseRequest, product: string, idempotencyKey: string, again = false) {
  const mail = licenseRequestEmail({ ...request, product, manualKeyEnv: d.config.manualKeyEnv, siteUrl: d.config.siteUrl, again })
  await d.mailer.send({ to: d.config.licenseRequestEmail, ...mail, idempotencyKey, tags: ['licencia-a-mano'] })
}

/**
 * La licencia de esa compra, pedida a Eric (una sola vez: un reintento del paso no la repite), y el
 * aviso por si sigue sin firmar a las horas que diga la configuracion.
 */
export async function requestManualLicense(d: Delivery, purchase: Purchase, company: Company, terms: ManualTerms, emitida: string): Promise<LicenseRequest> {
  const { request } = await d.repo.createLicenseRequest({
    purchaseId: purchase.id,
    companyId: company.id,
    kind: purchase.kind,
    paymentRef: purchase.paymentRef,
    cliente: company.name,
    nif: company.taxId,
    modalidad: terms.modalidad,
    equipo: terms.equipo,
    seats: purchase.kind === 'one_time' ? purchase.seats : company.seats,
    emitida,
    soporteHasta: terms.soporte_hasta,
    livemode: purchase.livemode,
  })
  if (request.status !== 'pending') return request
  await sendRequest(d, request, purchase.product, `license_request:${purchase.id}`)
  const runAt = new Date(d.clock().getTime() + d.config.licensePendingAlertHours * 3600_000).toISOString()
  await d.repo.enqueueJobs([{ key: `license_reminder:${purchase.id}`, kind: 'license_reminder', payload: { purchaseId: purchase.id }, runAt, maxAttempts: 5 }], d.clock())
  return request
}

/** La compra de un id (uuid) o de su pago (pi_..., in_..., cs_...): lo que se pasa a --compra. */
export async function purchaseByRef(d: Delivery, ref: string): Promise<Purchase | null> {
  const value = ref.trim()
  if (/^(pi|in)_[A-Za-z0-9]+$/.test(value)) return d.repo.getPurchaseByPaymentRef(value)
  if (/^cs_[A-Za-z0-9_]+$/.test(value)) return d.repo.getPurchaseByCheckoutSession(value)
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return d.repo.getPurchase(value.toLowerCase())
  return null
}

export interface UploadResult {
  licenseId: string
  purchaseId: string
  company: string
  kind: Purchase['kind']
  /** Ya estaba subida esa misma licencia: no se manda nada otra vez. */
  already: boolean
  /** Lo que no para la subida pero conviene mirar (el nombre del cliente distinto del de la compra). */
  warnings: string[]
}

const MAX_LICENSE_BYTES = 64 * 1024
const PAID = ['paid', 'partially_refunded']

/** Lo firmado de un fichero si la firma es buena con esa publica, aunque sus campos no valgan; si no, null. */
function signedFields(content: string, publicKey: string): LicenseData | null {
  try {
    const doc = JSON.parse(content) as { licencia?: LicenseData; firma?: unknown }
    if (!doc?.licencia || typeof doc.licencia !== 'object' || typeof doc.firma !== 'string') return null
    return verify(null, canonical(doc.licencia), publicKeyFromRaw(publicKey), Buffer.from(doc.firma, 'base64')) ? doc.licencia : null
  } catch {
    return null
  }
}

/** Lo que no cuadra entre lo firmado y lo pedido de la compra (vacio: cuadra). */
function mismatches(data: LicenseData, request: LicenseRequest, purchase: Purchase): string[] {
  const wrong: string[] = []
  const check = (field: string, got: unknown, want: unknown) => {
    if (got !== want) wrong.push(`${field} ${JSON.stringify(got)} (la compra: ${JSON.stringify(want)})`)
  }
  check('nif', data.nif, request.nif)
  check('modalidad', data.modalidad, request.modalidad)
  check('equipo', data.equipo, request.equipo)
  // emitida es la fecha del pago: con la de otro dia no cuadra con el cobro ni con la factura.
  check('emitida', data.emitida, request.emitida)
  check('soporte_hasta', data.soporte_hasta, request.soporteHasta)
  // La licencia solo dice equipo: con equipo son mas de una persona; sin el, una.
  if (data.equipo !== request.seats > 1) wrong.push(`plazas: ${request.seats} con equipo ${data.equipo}`)
  if (data.pago !== undefined && data.pago !== purchase.paymentRef) wrong.push(`pago ${data.pago} (la compra: ${purchase.paymentRef})`)
  return wrong
}

/** Los campos del fichero, si su firma es de la clave que toca; si no, 400 diciendo si falla la firma o los campos. */
function verified(d: Delivery, content: string, request: LicenseRequest, purchase: Purchase): LicenseData {
  try {
    return verifyLicense(content, d.config.manualPublicKey, { allowPayment: d.config.licenseIncludePayment })
  } catch (error) {
    const why = error instanceof LicenseError ? error.message : String(error)
    const signed = signedFields(content, d.config.manualPublicKey)
    if (!signed) throw new LicenseUploadError(400, `no verifica con la clave ${d.config.manualKeyEnv === 'production' ? 'del Mac de Eric' : 'de pruebas'}: ${why}`)
    // La firma es buena y lo que falla son los campos (lo mas comun: emitida con la fecha de hoy, no la del pago).
    const wrong = mismatches(signed, request, purchase)
    throw new LicenseUploadError(400, `la firma es buena, pero los campos no valen: ${why}${wrong.length ? `; no cuadra con la compra: ${wrong.join('; ')}` : ''}`)
  }
}

function cancelledError(request: LicenseRequest) {
  return new LicenseUploadError(409, `la licencia pedida se cancelo (${request.cancelReason ?? 'sin motivo'}): no se entrega`)
}

/**
 * La recien guardada de una pedida que se cancelo mientras se subia: anulada con el mismo motivo que
 * la pedida (si era un contracargo y se gana, reinstate la devuelve con ella).
 */
async function withdraw(d: Delivery, license: LicenseRecord, reason: string | null) {
  if (!license.revokedAt) await d.repo.setLicenseRevoked(license.id, { at: d.clock().toISOString(), reason: reason ?? 'cancelada' })
}

/** El correo al cliente con la licencia: el del mensual en un cobro; en un pago unico, despues de la bienvenida. */
function deliveryJobs(purchase: Purchase): NewJob[] {
  const p = purchase.id
  return purchase.kind === 'renewal'
    ? [{ key: `renewal_email:${p}`, kind: 'renewal_email', payload: { purchaseId: p } }]
    : [{ key: `license_email:${p}`, kind: 'license_email', payload: { purchaseId: p }, dependsOn: [`welcome:${p}`] }]
}

/**
 * Guarda la licencia firmada por Eric de esa compra, despues de comprobarla: firma con la publica
 * del Mac (o la de pruebas), numero de su numeracion y los campos de la compra. Despues, el correo al
 * cliente con la licencia (tras la bienvenida, si es un pago unico; el del mensual, si es un cobro).
 * Repetir la misma subida no hace nada; otra licencia para una compra que ya la tiene, 409.
 *
 * Una devolucion o un contracargo pueden llegar mientras se sube: la pedida pasa a entregada solo si
 * sigue pedida (comparar y cambiar), y si la cancelaron antes, la recien guardada queda anulada y no
 * sale. Si la cancelacion llega despues, revoke la encuentra y la anula (y los correos no salen sin
 * la compra pagada).
 */
export async function uploadManualLicense(d: Delivery, ref: string, content: string): Promise<UploadResult> {
  if (!content.trim()) throw new LicenseUploadError(400, 'falta el fichero de la licencia')
  if (Buffer.byteLength(content, 'utf-8') > MAX_LICENSE_BYTES) throw new LicenseUploadError(400, 'el fichero es demasiado grande para ser una licencia')
  const purchase = await purchaseByRef(d, ref)
  if (!purchase) throw new LicenseUploadError(404, `no hay ninguna compra ${ref} (el id de la compra, o su pago pi_... / in_...)`)
  const request = await d.repo.getLicenseRequestByPurchase(purchase.id)
  const warnings: string[] = []
  const result = (license: LicenseRecord, already: boolean): UploadResult => ({
    licenseId: license.id,
    purchaseId: purchase.id,
    company: request?.cliente ?? license.fileName,
    kind: purchase.kind,
    already,
    warnings,
  })

  let license = await d.repo.getLicenseByPurchase(purchase.id)
  if (license) {
    if (license.content !== content) throw new LicenseUploadError(409, `la compra ya tiene la licencia ${license.id}`)
    if (license.revokedAt) throw new LicenseUploadError(409, `la licencia ${license.id} esta anulada (${license.revokedReason ?? 'sin motivo'}): no se entrega`)
    // La misma subida otra vez: si ya estaba entregada (o la firmo la web), nada que hacer; el correo
    // se vuelve a encolar por si la otra se corto antes (sale una sola vez).
    if (!request) return result(license, true)
    if (request.status === 'issued') {
      await d.repo.enqueueJobs(deliveryJobs(purchase), d.clock())
      return result(license, true)
    }
    if (request.status === 'cancelled') {
      await withdraw(d, license, request.cancelReason)
      throw cancelledError(request)
    }
    // Se guardo y se corto antes de apuntarla: se termina abajo, si la compra sigue pagada.
    if (!PAID.includes(purchase.status)) throw new LicenseUploadError(409, `la compra esta ${purchase.status}: no se entrega`)
  } else {
    if (!request) throw new LicenseUploadError(404, 'esa compra no tiene licencia pedida a mano (¿LICENSE_MODE=manual?)')
    if (request.status === 'cancelled') throw cancelledError(request)
    if (request.status === 'issued') throw new LicenseUploadError(409, `la licencia pedida ya se entrego (${request.licenseId ?? 'sin numero'})`)
    if (!PAID.includes(purchase.status)) throw new LicenseUploadError(409, `la compra esta ${purchase.status}: no se entrega`)
    // Como con la clave de la web: un pago de prueba nunca con la clave de verdad, ni al reves.
    const production = d.config.manualKeyEnv === 'production'
    if (purchase.livemode !== production) {
      throw new LicenseUploadError(
        409,
        purchase.livemode
          ? 'pago en vivo y esta web espera una clave de pruebas (LICENSE_MANUAL_PUBLIC_KEY): quitarla en produccion'
          : 'pago de prueba de Stripe: no se entrega con la clave del Mac (en pruebas, LICENSE_MANUAL_PUBLIC_KEY con una clave de pruebas)'
      )
    }
    const data = verified(d, content, request, purchase)
    // Los numeros del Mac: del 0001 al 5000 (los de la web, del 5001, salen de su secuencia).
    const n = Number(data.id.slice(-4))
    if (n < 1 || n >= WEB_LICENSE_FIRST) throw new LicenseUploadError(400, `${data.id}: los numeros del Mac son del 0001 al ${WEB_LICENSE_FIRST - 1}`)
    const wrong = mismatches(data, request, purchase)
    if (wrong.length) throw new LicenseUploadError(409, `no cuadra con la compra: ${wrong.join('; ')}`)
    if (await d.repo.getLicense(data.id)) throw new LicenseUploadError(409, `el numero ${data.id} ya es de otra licencia`)
    if (cleanCompanyName(data.cliente) !== cleanCompanyName(request.cliente)) warnings.push(`el cliente de la licencia es "${data.cliente}" y el de la compra "${request.cliente}"`)
    license = await d.repo.insertLicense({
      id: data.id,
      companyId: request.companyId,
      purchaseId: purchase.id,
      paymentRef: purchase.paymentRef,
      modalidad: data.modalidad,
      equipo: data.equipo,
      emitida: data.emitida,
      soporteHasta: data.soporte_hasta,
      fileName: licenseFileName(data.cliente),
      content,
      keyId: production ? 'mac-eric' : 'manual-test',
      publicKey: d.config.manualPublicKey,
      origin: 'manual',
    })
  }

  // De pedida a entregada solo si sigue pedida: si una devolucion o un contracargo la cancelo
  // mientras tanto, gana la cancelacion y la recien guardada queda anulada.
  const issued = await d.repo.updateLicenseRequest(request.id, 'pending', { status: 'issued', licenseId: license.id, issuedAt: d.clock().toISOString() })
  if (!issued) {
    const latest = await d.repo.getLicenseRequestByPurchase(purchase.id)
    // Otra subida del mismo fichero a la vez: ya esta.
    if (latest?.status === 'issued' && latest.licenseId === license.id) return result(license, true)
    await withdraw(d, license, latest?.cancelReason ?? null)
    throw latest?.status === 'cancelled' ? cancelledError(latest) : new LicenseUploadError(409, `la licencia pedida cambio mientras se subia (${latest?.status ?? 'ya no esta'}): no se entrega`)
  }
  // Devuelta (o con contracargo) mientras se subia: revoke ya esta en la cola y la anula al pasar, y
  // los correos no salen sin la compra pagada. Se dice, para que nadie la mande a mano.
  const fresh = await d.repo.getPurchase(purchase.id)
  if (!fresh || !PAID.includes(fresh.status)) {
    throw new LicenseUploadError(409, `la compra paso a ${fresh?.status ?? 'no estar'} mientras se subia: la licencia queda guardada para anularla y no se entrega`)
  }
  await d.repo.enqueueJobs(deliveryJobs(purchase), d.clock())
  return result(license, false)
}

/**
 * Sin firmar todavia: deja de pedirse (devolucion o contracargo) y se le dice a Eric en un solo correo.
 * Solo las que siguen pedidas (comparar y cambiar): una que se acaba de subir firmada no se cancela,
 * se anula su licencia con el mismo motivo.
 */
export async function cancelLicenseRequests(d: Delivery, items: { request: LicenseRequest; reason: string }[], key: string): Promise<string[]> {
  const at = d.clock().toISOString()
  const cancelled: typeof items = []
  for (const item of items.filter((i) => i.request.status === 'pending')) {
    if (await d.repo.updateLicenseRequest(item.request.id, 'pending', { status: 'cancelled', cancelReason: item.reason, cancelledAt: at })) {
      cancelled.push(item)
      continue
    }
    const latest = await d.repo.getLicenseRequestByPurchase(item.request.purchaseId)
    const lic = latest?.status === 'issued' && latest.licenseId ? await d.repo.getLicense(latest.licenseId) : null
    if (lic && !lic.revokedAt) await d.repo.setLicenseRevoked(lic.id, { at, reason: item.reason })
  }
  if (cancelled.length) {
    const mail = internalEmail(`No firmar: ${cancelled.map((i) => i.request.cliente).join(', ')}`, {
      'Qué hacer': 'Nada: no firmar estas licencias pedidas (devolución o contracargo). Si ya las firmaste, no subirlas: la web no las acepta',
      ...Object.fromEntries(cancelled.map((i) => [`Compra ${i.request.purchaseId}`, `${i.request.cliente} (${i.request.nif}), ${i.request.kind === 'one_time' ? 'pago único' : 'cobro del mensual'}: ${i.reason}`])),
    })
    await d.mailer.send({ to: d.config.licenseRequestEmail, ...mail, idempotencyKey: `${key}:no-firmar`, tags: ['licencia-a-mano'] })
  }
  return cancelled.map((i) => i.request.purchaseId)
}

/**
 * Un contracargo ganado: las que se cancelaron por el vuelven a estar pedidas (y se piden otra vez).
 * Si Eric la subio mientras (y quedo anulada con el contracargo), reinstate ya la devolvio: se da por
 * entregada y le llega al cliente, sin pedirla otra vez.
 */
export async function restoreLicenseRequests(d: Delivery, requests: LicenseRequest[], key: string): Promise<string[]> {
  const restored: string[] = []
  for (const request of requests.filter((r) => r.status === 'cancelled')) {
    const purchase = await d.repo.getPurchase(request.purchaseId)
    const lic = await d.repo.getLicenseByPurchase(request.purchaseId)
    if (lic) {
      if (lic.revokedAt) continue
      const issued = await d.repo.updateLicenseRequest(request.id, 'cancelled', { status: 'issued', licenseId: lic.id, issuedAt: d.clock().toISOString(), cancelReason: null, cancelledAt: null })
      if (issued && purchase) await d.repo.enqueueJobs(deliveryJobs(purchase), d.clock())
      continue
    }
    const updated = await d.repo.updateLicenseRequest(request.id, 'cancelled', { status: 'pending', cancelReason: null, cancelledAt: null })
    if (!updated) continue
    await sendRequest(d, updated, purchase?.product ?? '', `${key}:${request.purchaseId}`, true)
    restored.push(request.purchaseId)
  }
  return restored
}

/** Las pedidas que siguen sin firmar pasadas las horas de aviso (para el recordatorio y la conciliacion). */
export async function overdueLicenseRequests(d: Delivery) {
  const cutoff = d.clock().getTime() - d.config.licensePendingAlertHours * 3600_000
  const overdue = []
  for (const request of await d.repo.listLicenseRequests({ status: 'pending', limit: 500 })) {
    if (new Date(request.createdAt).getTime() > cutoff) continue
    overdue.push({ purchaseId: request.purchaseId, company: request.cliente, kind: request.kind, hours: Math.floor((d.clock().getTime() - new Date(request.createdAt).getTime()) / 3600_000) })
  }
  return overdue
}

/** El aviso de licencias sin firmar: a quien las firma y, si es otro buzon, a las alertas. */
export async function sendOverdueNotice(d: Delivery, overdue: Awaited<ReturnType<typeof overdueLicenseRequests>>, key: string) {
  if (!overdue.length) return
  const mail = internalEmail(
    `Licencia(s) sin firmar desde hace más de ${d.config.licensePendingAlertHours} h: ${overdue.map((o) => o.company).join(', ')}`,
    {
      'Qué hacer': `Firmarlas en el Mac y subirlas (scripts/subir-licencia.mts): el cliente ya pagó y espera su licencia. Las pendientes: GET ${d.config.siteUrl}/api/admin/licenses`,
      ...Object.fromEntries(overdue.map((o) => [`Compra ${o.purchaseId}`, `${o.company}, ${o.kind === 'one_time' ? 'pago único' : 'cobro del mensual'}: ${o.hours} h sin firmar`])),
    }
  )
  const to = [...new Set([d.config.licenseRequestEmail, d.config.alertEmail])]
  for (const [i, email] of to.entries()) {
    await d.mailer.send({ to: email, ...mail, idempotencyKey: `${key}:${i}`, tags: ['alerta'] })
  }
}
