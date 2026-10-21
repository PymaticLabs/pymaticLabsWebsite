// La conciliacion diaria (pg_cron, /api/jobs/reconcile): cruza licencias y pagos.
//
// 1. Pagos sin entregar: una sesion de Checkout pagada o un cobro del mensual que la web no conoce
//    (un aviso de Stripe perdido) se procesa como si hubiera llegado el aviso. Uno ya devuelto o con
//    contracargo no se entrega: aviso.
// 2. Licencias sin pago: cada licencia de la web tiene que tener su pago cobrado en Stripe. Una sin
//    pago (o con el pago devuelto y la licencia sin anular) es un aviso urgente, que sale en cuanto
//    acaba este paso: la clave de la web pudo usarse fuera de la entrega. Se pregunta a Stripe de
//    pocos en pocos a la vez y con tiempo tasado: si no da tiempo a todas, el aviso lo dice.
// 3. Facturas en borrador (emision a mano): si ya se emitieron en Holded, se guardan para la zona.
// 4. Pasos parados en la cola.

import type Stripe from 'stripe'
import { internalEmail } from './emails.ts'
import { ingestCheckoutSession, ingestInvoice } from './events.ts'
import { storeInvoicePdf } from './steps.ts'
import { errorMessage } from './util.ts'
import type { Delivery } from './container.ts'
import type { LicenseRecord } from './types.ts'

export interface ReconcileReport {
  since: string
  checkedLicenses: number
  /** Licencias que no dio tiempo a mirar en Stripe (cada dia en otro orden: al siguiente se miran otras). */
  unchecked: number
  orphans: { licenseId: string; paymentRef: string; reason: string }[]
  recovered: { ref: string; outcome: string }[]
  skipped: { ref: string; reason: string }[]
  invoicesStored: string[]
  deadJobs: number
  errors: string[]
}

/** Lo que cuenta como recuperado (lo demas, como un producto que no es nuestro, ya avisa por su lado). */
const DELIVERED = ['purchase', 'renewal', 'needs-review']

export async function reconcile(d: Delivery, options: { days?: number; budgetMs?: number; concurrency?: number } = {}): Promise<ReconcileReport> {
  const started = Date.now()
  const budget = options.budgetMs ?? 35_000
  const now = d.clock()
  const since = new Date(now.getTime() - (options.days ?? d.config.reconcileDays) * 86400_000)
  const sinceUnix = Math.floor(since.getTime() / 1000)
  const report: ReconcileReport = { since: since.toISOString(), checkedLicenses: 0, unchecked: 0, orphans: [], recovered: [], skipped: [], invoicesStored: [], deadJobs: 0, errors: [] }

  // 1. Pagos sin entregar
  for (const raw of await d.payments.listPaidCheckoutSessions(sinceUnix)) {
    const session = raw as unknown as Stripe.Checkout.Session
    if (session.mode !== 'payment') continue
    if (await d.repo.getPurchaseByCheckoutSession(session.id)) continue
    // payment_status sigue en paid tras devolverlo: se pregunta antes de entregar.
    const ref = typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null)
    if (ref) {
      try {
        const status = await d.payments.paymentStatus(ref)
        if (status.refunded || status.disputed) {
          report.skipped.push({ ref: session.id, reason: status.refunded ? 'devuelto' : 'con contracargo' })
          continue
        }
      } catch (error) {
        report.errors.push(`${session.id}: ${errorMessage(error)}`)
        continue
      }
    }
    const outcome = await ingestCheckoutSession(d, session)
    if (DELIVERED.includes(outcome)) report.recovered.push({ ref: session.id, outcome })
  }
  for (const raw of await d.payments.listPaidInvoices(sinceUnix)) {
    const invoice = raw as unknown as Stripe.Invoice
    if (!invoice.parent?.subscription_details || !(invoice.total > 0)) continue
    if (await d.repo.getPurchaseByPaymentRef(invoice.id)) continue
    const outcome = await ingestInvoice(d, invoice)
    if (DELIVERED.includes(outcome)) report.recovered.push({ ref: invoice.id, outcome })
  }

  // 2. Licencias sin pago
  const toAsk: { license: LicenseRecord }[] = []
  for (const license of await d.repo.listLicensesSince(since.toISOString())) {
    report.checkedLicenses += 1
    const orphan = (reason: string) => report.orphans.push({ licenseId: license.id, paymentRef: license.paymentRef, reason })
    const purchase = await d.repo.getPurchase(license.purchaseId)
    if (!purchase) {
      orphan('no hay compra con esa licencia')
      continue
    }
    if (purchase.paymentRef !== license.paymentRef) {
      orphan(`la licencia dice el pago ${license.paymentRef} y la compra ${purchase.paymentRef}`)
      continue
    }
    toAsk.push({ license })
  }
  // En otro orden cada vez: si un dia no da tiempo a todas, las que quedan se miran otro dia.
  for (let i = toAsk.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[toAsk[i], toAsk[j]] = [toAsk[j], toAsk[i]]
  }
  const concurrency = options.concurrency ?? 8
  for (let i = 0; i < toAsk.length; i += concurrency) {
    if (Date.now() - started > budget) {
      report.unchecked = toAsk.length - i
      break
    }
    await Promise.all(
      toAsk.slice(i, i + concurrency).map(async ({ license }) => {
        const orphan = (reason: string) => report.orphans.push({ licenseId: license.id, paymentRef: license.paymentRef, reason })
        try {
          const status = await d.payments.paymentStatus(license.paymentRef)
          if (!status.exists) orphan('el pago no existe en Stripe')
          else if (!status.paid) orphan('el pago no esta cobrado')
          else if ((status.refunded || status.disputed) && !license.revokedAt) orphan('el pago se devolvio o tiene contracargo y la licencia sigue sin anular')
        } catch (error) {
          report.errors.push(`${license.id}: ${errorMessage(error)}`)
        }
      })
    )
  }

  report.orphans.sort((a, b) => a.licenseId.localeCompare(b.licenseId))
  // El aviso urgente, ya: no espera a lo demas.
  if (report.orphans.length) {
    const mail = internalEmail(
      `URGENTE · ${report.orphans.length} licencia(s) sin pago`,
      {
        'Qué hacer':
          'Comprobar en Stripe y en el registro de auditoría de Google Cloud KMS quién firmó estas licencias. Si la clave de la web se ha usado fuera de la entrega: desactivar su versión en KMS y anularla en la versión siguiente del esqueleto',
        ...Object.fromEntries(report.orphans.map((o) => [o.licenseId, `${o.paymentRef}: ${o.reason}`])),
        'Sin mirar': report.unchecked ? `${report.unchecked} licencia(s): no dio tiempo` : null,
      },
      `Conciliación del ${now.toISOString().slice(0, 10)}: licencias de los últimos días que no cuadran con un pago cobrado.`
    )
    await d.mailer.send({ to: d.config.alertEmail, ...mail, idempotencyKey: `reconcile:${now.toISOString().slice(0, 10)}:${report.orphans.map((o) => o.licenseId).sort().join(',')}`, tags: ['alerta'] })
  }

  // 3. Facturas en borrador ya emitidas a mano
  for (const invoice of await d.repo.listDraftInvoices()) {
    if (!invoice.providerId) continue
    if (Date.now() - started > budget + 10_000) break
    try {
      const doc = await d.invoicer.getDocument(invoice.kind, invoice.providerId)
      if (!doc.approved) continue
      const updated = await d.repo.updateInvoice(invoice.id, { status: 'approved', number: doc.number, approvedAt: now.toISOString() })
      await storeInvoicePdf(d, updated, invoice.kind)
      report.invoicesStored.push(doc.number ?? invoice.id)
    } catch (error) {
      report.errors.push(`factura ${invoice.ref}: ${errorMessage(error)}`)
    }
  }

  // 4. Pasos parados
  report.deadJobs = (await d.repo.listJobs({ status: 'dead', limit: 500 })).length

  if (!report.orphans.length && (report.recovered.length || report.skipped.length || report.deadJobs || report.errors.length || report.unchecked)) {
    const mail = internalEmail(`Conciliación: ${report.recovered.length} recuperada(s), ${report.deadJobs} paso(s) parado(s)`, {
      Recuperadas: report.recovered.map((r) => `${r.ref} (${r.outcome})`).join(', ') || null,
      'Sin entregar (ya devueltas o con contracargo)': report.skipped.map((s) => `${s.ref} (${s.reason})`).join(', ') || null,
      'Pasos parados': report.deadJobs || null,
      'Sin mirar en Stripe': report.unchecked ? `${report.unchecked} licencia(s): no dio tiempo (se miran en la siguiente; o POST /api/jobs/reconcile otra vez)` : null,
      Errores: report.errors.join(' · ') || null,
    })
    await d.mailer.send({ to: d.config.alertEmail, ...mail, idempotencyKey: `reconcile:${now.toISOString().slice(0, 10)}:resumen`, tags: ['interno'] })
  }
  return report
}
