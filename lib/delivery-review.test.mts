import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDelivery } from './delivery/container.ts'
import { handleStripeEvent, oneTimeJobs } from './delivery/events.ts'
import { runJobs } from './delivery/jobs.ts'
import { reconcile } from './delivery/reconcile.ts'
import { revocationList } from './delivery/versions.ts'
import { fakeCharge, fakeCheckoutSession, fakeDispute, fakeEvent, fakeInvoice } from './delivery/fake-stripe.ts'
import { ipBucket } from './delivery/limits.ts'
import { priceCents } from './delivery/products.ts'
import { CheckoutError, createCheckout, firstSessionSlots } from './checkout.ts'
import { addTeamMember, allowCodeRequest, removeTeamMember, requestCode, verifyCode, zoneOverview, ZoneError } from './delivery/zone.ts'
import { verifyLicense } from './license.ts'
import { LEGAL_VERSIONS } from './legal-versions.ts'
import { RateLimitedError, SeatLimitError } from './delivery/types.ts'
import type { ModalityId } from './offer.ts'

// Lo que pidio la revision de la entrega (cada prueba dice que hallazgo cubre), con las piezas
// falsas: sin cuentas ni red. El reloj lo mueve cada prueba.

function world(env: Record<string, string> = {}) {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now, env })
  return {
    d,
    f: d.fakes,
    advance(ms: number) {
      now = new Date(now.getTime() + ms)
    },
    now: () => now,
  }
}

const HOUR = 3600_000
let counter = 0
function buyer(n = ++counter) {
  return { company: `Revision ${n} SL`, taxId: `B${String(20000000 + n)}`, email: `compras${n}@revision${n}.test` }
}

function paidSession(
  product: ModalityId,
  options: { buyer?: ReturnType<typeof buyer>; metadata?: Record<string, string>; country?: string; taxIdType?: string; taxRate?: number; currency?: string; created?: number } = {}
) {
  const prices = priceCents(product)
  const b = options.buyer ?? buyer()
  return fakeCheckoutSession({
    product,
    buyer: { ...b, country: options.country, taxIdType: options.taxIdType },
    amountSubtotal: prices.list,
    taxRate: options.taxRate,
    currency: options.currency,
    created: options.created ?? Math.floor(new Date('2026-11-02T10:00:00Z').getTime() / 1000),
    metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones, ...options.metadata },
  })
}

async function pay(w: ReturnType<typeof world>, session: Record<string, unknown>) {
  return handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session))
}

async function purchaseOf(w: ReturnType<typeof world>, session: Record<string, unknown>) {
  const purchase = await w.d.repo.getPurchaseByCheckoutSession(String(session.id))
  assert.ok(purchase, 'hay compra')
  return purchase
}

/** Una empresa con equipo, su mensual Pro activo y un cobro con su licencia del mensual. */
async function withMonthly(w: ReturnType<typeof world>) {
  const session = paidSession('hazlo-tu-equipo')
  await pay(w, session)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const companyId = purchase.companyId!
  const customer = String(session.customer)
  await handleStripeEvent(w.d, fakeEvent('customer.subscription.created', { id: `sub_${companyId.slice(0, 8)}`, object: 'subscription', customer, status: 'active', metadata: { product: 'plan-pro', company_id: companyId } }))
  const invoice = fakeInvoice({ customer, amount: 19900, periodEnd: Math.floor(Date.parse('2027-04-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: companyId } })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', invoice))).outcome, 'renewal')
  await runJobs(w.d)
  const renewal = (await w.d.repo.getLicenseByPurchase((await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!.id))!
  const base = (await w.d.repo.getLicenseByPurchase(purchase.id))!
  return { session, purchase, companyId, customer, renewal, base, subscriptionId: `sub_${companyId.slice(0, 8)}` }
}

test('[1, 16] otra compra con el NIF de un cliente, desde otro correo: a revisar, sin tocar la empresa ni dar acceso, y aviso a sus titulares', async () => {
  const w = world()
  const victim = buyer()
  await pay(w, paidSession('hazlo-tu-equipo', { buyer: victim }))
  await runJobs(w.d)
  const company = (await w.d.repo.getCompanyByTaxId(victim.taxId))!

  const attacker = { company: 'Quien Sea SL', taxId: victim.taxId, email: 'alguien@otra.test' }
  const session = paidSession('hazlo-tu', { buyer: attacker })
  assert.equal((await pay(w, session)).outcome, 'needs-review')
  await runJobs(w.d)

  const purchase = await purchaseOf(w, session)
  assert.equal(purchase.status, 'needs_review')
  assert.equal(purchase.companyId, null)
  assert.deepEqual((purchase.reviewData as { reason: string }).reason, 'nif_conflict')
  // La empresa sigue con su nombre y sus personas; ni licencia ni factura para quien compro.
  assert.equal((await w.d.repo.getCompany(company.id))!.name, victim.company)
  assert.deepEqual((await w.d.repo.listMembers(company.id)).map((m) => m.email), [victim.email])
  assert.equal(await w.d.repo.getLicenseByPurchase(purchase.id), null)
  assert.equal((await w.d.repo.listMembershipsByEmail(attacker.email)).length, 0)
  // Sus titulares, avisados (sin el correo de quien compro); PymaticLabs, con urgencia.
  const alert = w.f.mailer.sent.find((m) => m.to === victim.email && m.tags?.includes('aviso-nif'))
  assert.ok(alert)
  assert.ok(!alert.text.includes(attacker.email))
  assert.ok(w.f.mailer.sent.some((m) => m.to === w.d.config.internalEmail && /URGENTE · Compra con el NIF de otro cliente/.test(m.subject)))
  // Ni codigo para entrar.
  await requestCode(w.d, attacker.email, 'es')
  assert.equal(w.f.mailer.sent.filter((m) => m.to === attacker.email && m.tags?.includes('zona-codigo')).length, 0)
  // PymaticLabs la devuelve: sin factura ni licencia que anular, nada se para.
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
  await runJobs(w.d)
  assert.deepEqual(await w.d.repo.listJobs({ status: 'dead' }), [])
  assert.equal((await w.d.repo.getCompany(company.id))!.accessRevokedAt, null)

  // Quien compro para la empresa puede volver a comprar: entra sola, y el nombre no cambia.
  const again = paidSession('hazlo-tu', { buyer: { ...victim, company: 'Nombre Nuevo SL' } })
  assert.equal((await pay(w, again)).outcome, 'purchase')
  await runJobs(w.d)
  assert.equal((await purchaseOf(w, again)).companyId, company.id)
  assert.equal((await w.d.repo.getCompany(company.id))!.name, victim.company)
})

test('[16] una compra revisada y entregada a mano que se devuelve: quien entro por ella sale; la empresa sigue', async () => {
  const w = world()
  const owner = buyer()
  await pay(w, paidSession('hazlo-tu-equipo', { buyer: owner }))
  await runJobs(w.d)
  const company = (await w.d.repo.getCompanyByTaxId(owner.taxId))!
  const colleague = { company: owner.company, taxId: owner.taxId, email: 'colega@revision.test' }
  const session = paidSession('hazlo-tu', { buyer: colleague })
  await pay(w, session)
  await runJobs(w.d)
  // PymaticLabs lo comprueba con la empresa y la entrega (como POST /api/admin/jobs deliver).
  const reviewed = await w.d.repo.updatePurchase((await purchaseOf(w, session)).id, { companyId: company.id, status: 'paid' })
  await w.d.repo.enqueueJobs(oneTimeJobs(reviewed), w.now())
  await runJobs(w.d)
  assert.deepEqual((await w.d.repo.listMembers(company.id)).map((m) => [m.email, m.role]).sort(), [[colleague.email, 'owner'], [owner.email, 'owner']])

  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: reviewed.amountTotal, refunded: reviewed.amountTotal })))
  await runJobs(w.d)
  assert.deepEqual((await w.d.repo.listMembers(company.id)).map((m) => m.email), [owner.email])
  assert.equal((await w.d.repo.getCompany(company.id))!.accessRevokedAt, null)
})

test('[17] devolver el pago unico con el mensual: anula sus licencias del mensual, cancela la suscripcion y no firma mas cobros', async () => {
  const w = world()
  const m = await withMonthly(w)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(m.session.payment_intent), amount: m.purchase.amountTotal, refunded: m.purchase.amountTotal })))
  await runJobs(w.d)

  assert.equal((await w.d.repo.getLicense(m.base.id))!.revokedReason, 'refund')
  assert.equal((await w.d.repo.getLicense(m.renewal.id))!.revokedReason, `refund:${m.purchase.id}`)
  assert.ok(w.f.payments.canceledSubscriptions.has(m.subscriptionId))
  assert.equal((await w.d.repo.getCompany(m.companyId))!.subscriptionStatus, 'canceled')
  assert.ok(w.f.mailer.sent.some((m) => /^Mensual cancelado/.test(m.subject)))
  const refundMail = w.f.mailer.sent.find((x) => x.tags?.includes('devolucion'))!
  assert.match(refundMail.text, /cancelado tu mensual/)
  // En la lista de anuladas, las dos (la del mensual, con el mismo motivo).
  const list = await revocationList(w.d, {})
  assert.deepEqual(list.licencias.map((l) => [l.id, l.motivo]).sort(), [[m.base.id, 'refund'], [m.renewal.id, 'refund']].sort())

  // Si Stripe cobrara otro mes (antes de cancelar), no se firma: a revisar.
  const late = fakeInvoice({ customer: m.customer, amount: 19900, periodEnd: Math.floor(Date.parse('2027-05-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: m.companyId } })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', late))).outcome, 'needs-review')
  await runJobs(w.d)
  assert.equal((await w.d.repo.listLicensesByCompany(m.companyId)).length, 2)
  assert.ok(w.f.mailer.sent.some((x) => /Venta a revisar/.test(x.subject) && /sin pago único vigente/.test(x.text)))
})

test('[18, 19] contracargos: una peticion de informacion no anula; el contracargo si, y ganado devuelve tambien las del mensual; la conciliacion no lo da por huerfano', async () => {
  const w = world()
  const m = await withMonthly(w)
  const pi = String(m.session.payment_intent)
  const send = (type: string, status: string, id: string) => handleStripeEvent(w.d, fakeEvent(type, fakeDispute({ paymentIntent: pi, amount: m.purchase.amountTotal, status, disputeId: id })))

  // Peticion de informacion: solo aviso. Se cierra sin contracargo: nada cambia.
  assert.equal((await send('charge.dispute.created', 'warning_needs_response', 'dp_peticion')).outcome, 'inquiry')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(m.base.id))!.revokedAt, null)
  assert.equal((await w.d.repo.getCompany(m.companyId))!.accessRevokedAt, null)
  assert.ok(w.f.mailer.sent.some((x) => /^Petición de información/.test(x.subject)))
  assert.equal((await send('charge.dispute.closed', 'warning_closed', 'dp_peticion')).outcome, 'dispute-closed')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getPurchase(m.purchase.id))!.status, 'paid')

  // Pasa a contracargo (aviso updated): licencias anuladas y zona cerrada, pero el mensual no se cancela aun.
  assert.equal((await send('charge.dispute.updated', 'needs_response', 'dp_2')).outcome, 'dispute')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(m.base.id))!.revokedReason, 'dispute')
  assert.equal((await w.d.repo.getLicense(m.renewal.id))!.revokedReason, `dispute:${m.purchase.id}`)
  assert.ok((await w.d.repo.getCompany(m.companyId))!.accessRevokedAt)
  assert.equal(w.f.payments.canceledSubscriptions.size, 0)

  // Ganado: vuelven las dos licencias y la zona.
  assert.equal((await send('charge.dispute.closed', 'won', 'dp_2')).outcome, 'dispute-won')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(m.base.id))!.revokedAt, null)
  assert.equal((await w.d.repo.getLicense(m.renewal.id))!.revokedAt, null)
  assert.equal((await w.d.repo.getCompany(m.companyId))!.accessRevokedAt, null)
  assert.equal((await w.d.repo.getPurchase(m.purchase.id))!.status, 'paid')
  // Ganado no es "licencia sin pago" (charge.disputed sigue en true en Stripe).
  assert.deepEqual((await reconcile(w.d)).orphans, [])
})

test('[17, 18] un contracargo perdido es definitivo: sin otro pago unico, el mensual se cancela', async () => {
  const w = world()
  const m = await withMonthly(w)
  const pi = String(m.session.payment_intent)
  await handleStripeEvent(w.d, fakeEvent('charge.dispute.created', fakeDispute({ paymentIntent: pi, amount: m.purchase.amountTotal, disputeId: 'dp_x' })))
  await handleStripeEvent(w.d, fakeEvent('charge.dispute.closed', fakeDispute({ paymentIntent: pi, amount: m.purchase.amountTotal, disputeId: 'dp_x', status: 'lost' })))
  await runJobs(w.d)
  assert.ok(w.f.payments.canceledSubscriptions.has(m.subscriptionId))
  assert.equal((await w.d.repo.getPurchase(m.purchase.id))!.status, 'dispute_lost')
  assert.ok((await w.d.repo.getLicense(m.renewal.id))!.revokedAt)
})

test('[20] dos devoluciones a la vez: una rectificativa por devolucion, por lo que dice cada una, y nunca mas de lo cobrado', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit', HOLDED_CREDIT_NOTE_MODE: 'emit' })
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const total = purchase.amountTotal
  const pi = String(session.payment_intent)
  const first = { id: 're_a_parcial', amount: 12100 }
  const rest = { id: 're_b_resto', amount: total - 12100 }
  // Llegan a la vez, y la total antes que la parcial.
  await Promise.all([
    handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: pi, amount: total, refunded: total, refunds: [rest, first] }))),
    handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: pi, amount: total, refunded: 12100, refunds: [first] }))),
  ])
  await runJobs(w.d)
  const credits = (await w.d.repo.listInvoicesByCompany(purchase.companyId!)).filter((i) => i.kind === 'credit_note')
  assert.deepEqual(credits.map((c) => c.amountTotal).sort((a, b) => a - b), [-rest.amount, -first.amount].sort((a, b) => a - b))
  assert.equal(credits.reduce((s, c) => s + c.amountTotal, 0), -total)
  const after = (await w.d.repo.getPurchase(purchase.id))!
  assert.deepEqual([after.status, after.amountRefunded], ['refunded', total])
})

test('[21] un pago que queda pendiente (no tarjeta) no entrega ni gasta plaza: aviso', async () => {
  const w = world()
  const session = { ...paidSession('hazlo-tu', { metadata: { launch_ref: 'ref-pendiente' } }), payment_status: 'unpaid' }
  assert.equal((await pay(w, session)).outcome, 'awaiting-payment')
  await runJobs(w.d)
  assert.equal(Object.keys(w.f.repo.state.purchases).length, 0)
  assert.ok(w.f.mailer.sent.some((m) => /^Pago pendiente de cobrar/.test(m.subject)))
})

test('[4, 22] el IVA lo dice Stripe Tax: Espana sin IVA no se factura sola; NIF-IVA sin verificar, borrador; verificado, se emite', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit', HOLDED_TAX_REVERSE_CHARGE: 's_iva_isp' })
  // Espana con 0 de IVA (Stripe Tax sin el registro de Espana): ni se crea en Holded; la licencia sale igual.
  const spain = paidSession('hazlo-tu', { taxRate: 0 })
  await pay(w, spain)
  // Alemania con un NIF-IVA que VIES no confirma: Stripe aplica la inversion igual.
  const unverified = paidSession('hazlo-tu', { country: 'DE', taxIdType: 'eu_vat', buyer: { company: 'Sin Verificar GmbH', taxId: 'DE111111111', email: 'a@sinverificar.test' } })
  w.f.payments.taxIdStatus.set('DE111111111', 'unverified')
  await pay(w, unverified)
  const verified = paidSession('hazlo-tu', { country: 'DE', taxIdType: 'eu_vat', buyer: { company: 'Verificada GmbH', taxId: 'DE222222222', email: 'a@verificada.test' } })
  await pay(w, verified)
  await runJobs(w.d)

  const pSpain = await purchaseOf(w, spain)
  assert.equal(await w.d.repo.getInvoiceByRef(`invoice:${pSpain.id}`), null)
  assert.ok((await w.d.repo.getPurchase(pSpain.id))!.welcomeSentAt)
  assert.ok(w.f.mailer.sent.some((m) => /^Facturar a mano/.test(m.subject) && /España sin IVA/.test(m.text)))
  assert.ok(w.f.mailer.sent.some((m) => /^Venta/.test(m.subject) && /Factura retenida/.test(m.text)))

  const pUnverified = await purchaseOf(w, unverified)
  const draft = (await w.d.repo.getInvoiceByRef(`invoice:${pUnverified.id}`))!
  assert.equal(draft.status, 'draft')
  assert.match(draft.holdReason ?? '', /VIES/)
  assert.equal(w.f.invoicer.documents.get(draft.providerId!)!.approved, false)
  assert.equal(pUnverified.taxTreatment, 'reverse_charge')

  const sent = (await w.d.repo.getInvoiceByRef(`invoice:${(await purchaseOf(w, verified)).id}`))!
  assert.equal(sent.status, 'sent')

  // Devolver la de Espana: la rectificativa, tambien a mano.
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(spain.payment_intent), amount: pSpain.amountTotal, refunded: pSpain.amountTotal })))
  await runJobs(w.d)
  assert.ok(w.f.mailer.sent.some((m) => /^Rectificar a mano/.test(m.subject) && /no se hizo sola/.test(m.text)))
})

test('[22, 28] antes de emitir, Holded tiene que dar el total de Stripe; en dolares, borrador y aviso (y en dolares desde la UE, tambien)', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit', HOLDED_TAX_EXPORT: 's_export' })
  w.f.invoicer.skewCents = 500
  const skewed = paidSession('hazlo-tu')
  await pay(w, skewed)
  await runJobs(w.d)
  const inv = (await w.d.repo.getInvoiceByRef(`invoice:${(await purchaseOf(w, skewed)).id}`))!
  assert.equal(inv.status, 'draft')
  assert.match(inv.holdReason ?? '', /Holded da/)

  w.f.invoicer.skewCents = 0
  const usd = paidSession('hazlo-tu', { country: 'US', taxIdType: 'us_ein', currency: 'usd', buyer: { company: 'Inc Test', taxId: '12-3456789', email: 'a@inc.test' } })
  const usdFromEu = paidSession('hazlo-tu', { country: 'FR', taxIdType: 'eu_vat', currency: 'usd', buyer: { company: 'SARL Test', taxId: 'FR12345678901', email: 'a@sarl.test' } })
  await pay(w, usd)
  await pay(w, usdFromEu)
  await runJobs(w.d)
  const usdInvoice = (await w.d.repo.getInvoiceByRef(`invoice:${(await purchaseOf(w, usd)).id}`))!
  assert.equal(usdInvoice.status, 'draft')
  assert.match(usdInvoice.holdReason ?? '', /cambio a euros/)
  assert.equal((await purchaseOf(w, usd)).taxTreatment, 'export')
  assert.ok(w.f.mailer.sent.some((m) => /Factura en borrador, sin emitir/.test(m.subject) && /solo para fuera de la UE/.test(m.text)))
})

test('[23] en dolares, el EIN llega en el campo propio: la compra se entrega con ese NIF', async () => {
  const w = world()
  const session = paidSession('hazlo-tu', { country: 'US', currency: 'usd', buyer: { company: 'Acme Corp', taxId: 'x', email: 'ap@acme.test' } })
  ;(session.customer_details as { tax_ids: unknown[] }).tax_ids = []
  session.custom_fields = [{ key: 'nif', type: 'text', text: { value: '12-3456789' } }]
  assert.equal((await pay(w, session)).outcome, 'purchase')
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const company = (await w.d.repo.getCompany(purchase.companyId!))!
  assert.deepEqual([company.taxId, company.taxIdType], ['12-3456789', 'us_ein'])
  assert.equal(verifyLicense((await w.d.repo.getLicenseByPurchase(purchase.id))!.content, await w.f.signer.publicKey()).nif, '12-3456789')
})

test('[24] un pago de un producto que la web no conoce (un enlace de pago antiguo): aviso urgente, no silencio', async () => {
  const w = world()
  const session: Record<string, unknown> = { ...paidSession('hazlo-tu'), metadata: { product: 'enlace-de-pago-viejo' } }
  assert.equal((await pay(w, session)).outcome, 'ignored-product')
  await runJobs(w.d)
  assert.ok(w.f.mailer.sent.some((m) => /URGENTE · Pago cobrado sin entregar/.test(m.subject) && m.text.includes(String(session.payment_intent))))
  // Un cobro del mensual de un precio que no es de ningun plan, igual.
  const invoice = fakeInvoice({ customer: 'cus_x', amount: 1000, periodEnd: 0, price: 'price_de_otra_cosa' })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', invoice))).outcome, 'ignored-product')
})

test('[25] Cal.com caido: tras unos intentos la reserva se da por fallida y la licencia sale igual', async () => {
  const w = world()
  const { slots } = await firstSessionSlots(w.d)
  w.f.calendar.failures.failNext('book', 20)
  const session = paidSession('acompanado', { metadata: { session_host: slots[0].host, session_start: slots[0].start } })
  await pay(w, session)
  for (let i = 0; i < 4; i++) {
    await runJobs(w.d)
    w.advance(2 * HOUR)
  }
  const purchase = await purchaseOf(w, session)
  const booking = (await w.d.repo.getBooking(purchase.id, 1))!
  assert.deepEqual([booking.status, booking.note], ['failed', 'calendario'])
  const welcome = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('bienvenida'))!
  assert.match(welcome.text, /No hemos podido confirmar ahora tu primera sesión/)
  assert.ok(w.f.mailer.sent.some((m) => /^Venta/.test(m.subject) && /Cal.com no respondió/.test(m.text)))
  assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)
})

test('[26, 34] el plan de cada cobro sale del precio cobrado (tras cambiarlo en el portal); y un cobro pagado con saldo tambien se factura', async () => {
  const w = world()
  const m = await withMonthly(w)
  // En el portal paso a Premium: los metadatos de la suscripcion siguen diciendo Pro.
  const premium = fakeInvoice({ customer: m.customer, amount: 29900, periodEnd: Math.floor(Date.parse('2027-05-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: m.companyId }, price: 'price_fake_cerebro-plan-premium' })
  await handleStripeEvent(w.d, fakeEvent('invoice.paid', premium))
  // Pagado con el saldo a favor tras bajar de plan: 0 a la tarjeta, total de 99 + IVA.
  const credited: Record<string, unknown> = { ...fakeInvoice({ customer: m.customer, amount: 9900, periodEnd: Math.floor(Date.parse('2027-06-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: m.companyId }, price: 'price_fake_cerebro-plan-esencial' }), amount_paid: 0 }
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', credited))).outcome, 'renewal')
  await runJobs(w.d)
  const pPremium = (await w.d.repo.getPurchaseByPaymentRef(String(premium.id)))!
  assert.equal(pPremium.product, 'plan-premium')
  const pCredited = (await w.d.repo.getPurchaseByPaymentRef(String(credited.id)))!
  assert.deepEqual([pCredited.product, pCredited.amountTotal], ['plan-esencial', 11979])
  assert.equal((await w.d.repo.getCompany(m.companyId))!.subscriptionPlan, 'plan-esencial')
  const lines = [...w.f.invoicer.documents.values()].map((doc) => doc.draft.lines[0].name)
  assert.ok(lines.includes('Cerebro Digital · Mensual Premium'))
})

test('[35] los avisos de la suscripcion desordenados no la resucitan; incomplete tampoco deja contratar otra', async () => {
  const w = world()
  const m = await withMonthly(w)
  const sub = (status: string) => ({ id: m.subscriptionId, object: 'subscription', customer: m.customer, status, metadata: { product: 'plan-pro', company_id: m.companyId } })
  const base = Math.floor(w.now().getTime() / 1000) + 1000
  await handleStripeEvent(w.d, fakeEvent('customer.subscription.deleted', sub('canceled'), undefined, base + 10))
  assert.equal((await handleStripeEvent(w.d, fakeEvent('customer.subscription.updated', sub('active'), undefined, base))).outcome, 'subscription-stale')
  assert.equal((await w.d.repo.getCompany(m.companyId))!.subscriptionStatus, 'canceled')

  await w.d.repo.updateCompany(m.companyId, { subscriptionStatus: 'incomplete' })
  const company = (await w.d.repo.getCompany(m.companyId))!
  await assert.rejects(createCheckout(w.d, { product: 'plan-pro', locale: 'es', company }), (e: unknown) => e instanceof CheckoutError && e.code === 'already_subscribed')
})

test('[32] el mensual no se cobra hasta que acaban los meses incluidos solo con ese plan o uno menor', async () => {
  const w = world()
  const session = paidSession('hazlo-tu-equipo') // 3 meses de Pro
  await pay(w, session)
  await runJobs(w.d)
  const company = (await w.d.repo.getCompany((await purchaseOf(w, session)).companyId!))!
  const trialOf = async (product: string) => {
    const checkout = await createCheckout(w.d, { product, locale: 'es', company })
    return (w.f.payments.sessions.get(checkout.sessionId)!.params.subscription_data as { trial_end?: number }).trial_end ?? null
  }
  assert.ok(await trialOf('plan-pro'))
  assert.ok(await trialOf('plan-esencial'))
  assert.equal(await trialOf('plan-premium'), null)
  assert.equal((await zoneOverview(w.d, { id: (await w.d.repo.listMembers(company.id))[0].userId!, email: company.email })).company.subscription.coveredBy, 'plan-pro')
})

test('[33] la conciliacion no entrega un pago perdido que ya se devolvio', async () => {
  const w = world()
  const lost = paidSession('hazlo-tu')
  w.f.payments.paidSessions.push(lost)
  w.f.payments.payments.set(String(lost.payment_intent), { exists: true, paid: true, refunded: true, disputed: false, amount: 1 })
  const report = await reconcile(w.d)
  assert.deepEqual(report.recovered, [])
  assert.deepEqual(report.skipped.map((s) => s.reason), ['devuelto'])
  assert.equal(await w.d.repo.getPurchaseByCheckoutSession(String(lost.id)), null)
})

test('[2] un pago de Stripe en vivo nunca se firma con la clave de pruebas, ni al reves; un aviso de prueba con claves de vivo no se procesa', async () => {
  const w = world()
  const live = { ...paidSession('hazlo-tu'), livemode: true }
  await pay(w, live)
  await runJobs(w.d)
  const dead = await w.d.repo.listJobs({ status: 'dead' })
  assert.deepEqual(dead.map((j) => j.kind), ['license'])
  assert.match(dead[0].lastError ?? '', /LICENSE_KEY_ENV/)
  assert.equal((await purchaseOf(w, live)).livemode, true)

  const prod = createFakeDelivery({ env: { DELIVERY_PAYMENTS: 'stripe', STRIPE_SECRET_KEY: 'sk_live_solo_para_la_prueba' } })
  assert.equal((await handleStripeEvent(prod, fakeEvent('checkout.session.completed', paidSession('hazlo-tu')))).outcome, 'ignored-livemode')
  assert.equal(Object.keys(prod.fakes.repo.state.purchases).length, 0)
})

test('[37] devolver una compra con otra devuelta solo en parte: la zona sigue abierta', async () => {
  const w = world()
  const owner = buyer()
  const a = paidSession('hazlo-tu', { buyer: owner })
  const b = paidSession('hazlo-tu-equipo', { buyer: owner })
  await pay(w, a)
  await pay(w, b)
  await runJobs(w.d)
  const pa = await purchaseOf(w, a)
  const pb = await purchaseOf(w, b)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(a.payment_intent), amount: pa.amountTotal, refunded: 1000 })))
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(b.payment_intent), amount: pb.amountTotal, refunded: pb.amountTotal })))
  await runJobs(w.d)
  assert.equal((await w.d.repo.getPurchase(pa.id))!.status, 'partially_refunded')
  assert.equal((await w.d.repo.getCompany(pa.companyId!))!.accessRevokedAt, null)
  // Sigue siendo titular (por la otra compra).
  assert.deepEqual((await w.d.repo.listMembers(pa.companyId!)).map((m) => [m.email, m.purchaseId]), [[owner.email, pa.id]])
})

test('[31] la fecha de la compra es la del cobro (el aviso), no la de abrir el pago', async () => {
  const w = world()
  const session = paidSession('hazlo-tu', { created: Math.floor(Date.parse('2026-12-31T22:50:00Z') / 1000) })
  await handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session, undefined, Math.floor(Date.parse('2027-01-01T00:10:00Z') / 1000)))
  await runJobs(w.d)
  const license = (await w.d.repo.getLicenseByPurchase((await purchaseOf(w, session)).id))!
  assert.deepEqual([license.emitida, license.id], ['2027-01-01', 'PML-LIC-2027-5001'])
})

test('[3, 7] zona: 5 codigos probados por correo y se bloquea (aunque cambie la IP); al acertar se limpia; pocos codigos por correo y por IP', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  const { email } = await purchaseOf(w, session)
  const jar = { getAll: () => [], setAll: () => {} }
  await requestCode(w.d, email, 'es')
  const code = w.f.mailer.sent.filter((m) => m.to === email && m.tags?.includes('zona-codigo')).pop()!.text
  assert.match(code, /^\d{8}$/)
  for (let i = 0; i < 5; i++) assert.equal(await verifyCode(w.d, email, '00000000', jar, `198.51.100.${i}`), null)
  // El sexto, ni con el bueno: espera.
  await assert.rejects(verifyCode(w.d, email, code, jar, '203.0.113.9'), RateLimitedError)
  w.advance(16 * 60_000)
  await requestCode(w.d, email, 'es')
  const fresh = w.f.mailer.sent.filter((m) => m.to === email && m.tags?.includes('zona-codigo')).pop()!.text
  assert.ok(await verifyCode(w.d, email, fresh, jar, '203.0.113.9'))

  // Pedir codigos: 5 por correo y hora (de mas, no se manda nada, sin decirlo).
  for (let i = 0; i < 6; i++) await requestCode(w.d, email, 'es')
  assert.equal(w.f.mailer.sent.filter((m) => m.to === email && m.tags?.includes('zona-codigo')).length, 5)
  // Y 10 peticiones por IP cada 15 minutos; una IPv6 cuenta por su /64.
  for (let i = 0; i < 10; i++) assert.equal(await allowCodeRequest(w.d, `2001:db8:1:2::${i + 1}`), true)
  assert.equal(await allowCodeRequest(w.d, '2001:db8:1:2:ffff::1'), false)
  assert.equal(await allowCodeRequest(w.d, '2001:db8:1:3::1'), true)
  assert.equal(ipBucket('::ffff:203.0.113.9'), '203.0.113.9')
})

test('[6] equipo: una invitacion por persona y dia, un tope de altas al dia y las plazas tambien en la base de datos', async () => {
  const w = world({ LIMIT_TEAM_ADDS_PER_DAY: '4' })
  const session = paidSession('hazlo-tu-equipo')
  await pay(w, session)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  // Alta y baja en bucle: una sola invitacion ese dia.
  for (let i = 0; i < 3; i++) {
    assert.deepEqual(await addTeamMember(w.d, user, purchase.companyId!, 'bucle@equipo.test'), { added: true })
    await removeTeamMember(w.d, user, purchase.companyId!, 'bucle@equipo.test')
  }
  await addTeamMember(w.d, user, purchase.companyId!, 'bucle@equipo.test')
  await runJobs(w.d)
  assert.equal(w.f.mailer.sent.filter((m) => m.to === 'bucle@equipo.test').length, 1)
  assert.ok(!Object.values(w.f.repo.state.jobs).some((j) => j.key.includes('bucle@')), 'la clave lleva la huella, no el correo')
  // Y no mas de 4 altas al dia (LIMIT_TEAM_ADDS_PER_DAY).
  await assert.rejects(addTeamMember(w.d, user, purchase.companyId!, 'quinta@equipo.test'), (e: unknown) => e instanceof ZoneError && e.status === 429)
  w.advance(25 * HOUR)
  assert.deepEqual(await addTeamMember(w.d, user, purchase.companyId!, 'quinta@equipo.test'), { added: true })

  // Dos altas a la vez con la ultima plaza: la base de datos solo deja una.
  const solo = createFakeDelivery()
  const single = await solo.repo.upsertCompany({ name: 'Una SL', taxId: 'B99999999', taxIdType: 'es_cif', country: 'ES', address: null, email: 'a@una.test', locale: 'es', currency: 'eur', stripeCustomerId: null })
  await solo.repo.addMember({ companyId: single.id, email: 'a@una.test', userId: null, role: 'owner', addedBy: null })
  await assert.rejects(solo.repo.addMember({ companyId: single.id, email: 'b@una.test', userId: null, role: 'member', addedBy: null }), SeatLimitError)
})

test('[9] zona: quien entra por su correo (alta sin cuenta) queda unido a su cuenta desde entonces', async () => {
  const w = world()
  const session = paidSession('hazlo-tu-equipo')
  await pay(w, session)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const member = await w.d.repo.addMember({ companyId: purchase.companyId!, email: 'sin-cuenta@equipo.test', userId: null, role: 'member', addedBy: null })
  await zoneOverview(w.d, { id: 'cuenta-nueva', email: 'sin-cuenta@equipo.test' })
  assert.equal((await w.d.repo.listMembers(purchase.companyId!)).find((m) => m.id === member.id)!.userId, 'cuenta-nueva')
})

test('[5, 10] pagos abiertos y huecos apartados con tope por IP (por /64 en IPv6); la plaza de lanzamiento, tambien por /64', async () => {
  const w = world()
  const v6 = (i: number) => `2001:db8:aa:bb::${i + 1}`
  const first = [await createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', clientIp: v6(0) }), await createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', clientIp: v6(1) }), await createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', clientIp: v6(2) })]
  assert.deepEqual(first.map((c) => c.launch), [true, true, false])
  const slots = (await firstSessionSlots(w.d)).slots
  for (let i = 0; i < 3; i++) await createCheckout(w.d, { product: 'acompanado', locale: 'es', clientIp: '198.51.100.7', session: slots[i] })
  await assert.rejects(createCheckout(w.d, { product: 'acompanado', locale: 'es', clientIp: '198.51.100.7', session: slots[3] }), (e: unknown) => e instanceof CheckoutError && e.code === 'rate_limited')
  for (let i = 3; i < 10; i++) await createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', clientIp: v6(i) })
  await assert.rejects(createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', clientIp: v6(10) }), (e: unknown) => e instanceof CheckoutError && e.code === 'rate_limited')
})

test('[4] el NIF-IVA aun pendiente en VIES: la factura espera unos minutos; si se verifica, se emite sola; si no, borrador', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit', HOLDED_TAX_REVERSE_CHARGE: 's_iva_isp' })
  const later = paidSession('hazlo-tu', { country: 'IT', taxIdType: 'eu_vat', buyer: { company: 'Srl Uno', taxId: 'IT11111111111', email: 'a@srluno.test' } })
  const never = paidSession('hazlo-tu', { country: 'IT', taxIdType: 'eu_vat', buyer: { company: 'Srl Due', taxId: 'IT22222222222', email: 'a@srldue.test' } })
  w.f.payments.taxIdStatus.set('IT11111111111', 'pending')
  w.f.payments.taxIdStatus.set('IT22222222222', 'pending')
  await pay(w, later)
  await pay(w, never)
  await runJobs(w.d)
  const pLater = await purchaseOf(w, later)
  assert.equal(await w.d.repo.getInvoiceByRef(`invoice:${pLater.id}`), null)
  // La licencia y la bienvenida no esperan a la factura.
  assert.ok((await w.d.repo.getPurchase(pLater.id))!.welcomeSentAt)
  w.f.payments.taxIdStatus.set('IT11111111111', 'verified')
  for (let i = 0; i < 3; i++) {
    w.advance(HOUR)
    await runJobs(w.d)
  }
  assert.equal((await w.d.repo.getInvoiceByRef(`invoice:${pLater.id}`))!.status, 'sent')
  const draft = (await w.d.repo.getInvoiceByRef(`invoice:${(await purchaseOf(w, never)).id}`))!
  assert.equal(draft.status, 'draft')
  assert.match(draft.holdReason ?? '', /pending/)
  // Sin aviso de paso fallando: esperar a VIES no es un fallo.
  assert.equal(w.f.mailer.sent.filter((m) => /Paso fallando/.test(m.subject)).length, 0)
})
