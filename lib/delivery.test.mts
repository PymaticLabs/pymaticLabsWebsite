import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDelivery } from './delivery/container.ts'
import { handleStripeEvent } from './delivery/events.ts'
import { runJobs, backoffMs } from './delivery/jobs.ts'
import { HANDLERS } from './delivery/steps.ts'
import { reconcile } from './delivery/reconcile.ts'
import { publishVersion, revocationList } from './delivery/versions.ts'
import { processStripeWebhook } from './delivery/webhook.ts'
import { fakeCharge, fakeCheckoutSession, fakeDispute, fakeEvent, fakeInvoice, signPayload } from './delivery/fake-stripe.ts'
import { priceCents } from './delivery/products.ts'
import { unzip } from './delivery/zip.ts'
import { createCheckout } from './checkout.ts'
import { addTeamMember, downloadLink, licenseFile, removeTeamMember, requestCode, zoneOverview, bookSession, invoiceLink } from './delivery/zone.ts'
import { verifyLicense, formatLicenseId } from './license.ts'
import { LEGAL_VERSIONS } from './legal-versions.ts'
import type { ModalityId } from './offer.ts'

// La entrega entera con las piezas falsas: sin cuentas ni red. El reloj lo mueve cada prueba.

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
  return { company: `Empresa ${n} SL`, taxId: `B${String(10000000 + n)}`, email: `compras${n}@empresa${n}.test` }
}

/** Un pago unico cobrado, como lo manda Stripe, con los metadatos que pone createCheckout. */
function paidSession(product: ModalityId, options: { launch?: boolean; buyer?: ReturnType<typeof buyer>; metadata?: Record<string, string>; country?: string; taxIdType?: string } = {}) {
  const prices = priceCents(product)
  const b = options.buyer ?? buyer()
  return fakeCheckoutSession({
    product,
    buyer: { ...b, country: options.country, taxIdType: options.taxIdType },
    amountSubtotal: prices.list,
    amountDiscount: options.launch ? prices.list - prices.launch! : 0,
    created: Math.floor(new Date('2026-11-02T10:00:00Z').getTime() / 1000),
    metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones, ...(options.launch ? { launch_ref: `ref-${b.taxId}` } : {}), ...options.metadata },
    marketing: 'si',
  })
}

async function pay(w: ReturnType<typeof world>, session: Record<string, unknown>, eventId?: string) {
  return handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session, eventId))
}

async function licenseOf(w: ReturnType<typeof world>, session: Record<string, unknown>) {
  const purchase = await w.d.repo.getPurchaseByCheckoutSession(String(session.id))
  assert.ok(purchase, 'hay compra')
  const license = await w.d.repo.getLicenseByPurchase(purchase.id)
  assert.ok(license, 'hay licencia')
  return { purchase, license }
}

test('Hazlo tu: factura, licencia firmada con el pago, cuenta, bienvenida con licencia y condiciones, y aviso interno', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  assert.deepEqual(await pay(w, session), { outcome: 'purchase' })
  const stats = await runJobs(w.d)
  assert.equal(stats.dead, 0)
  assert.equal(stats.retried, 0)

  const { purchase, license } = await licenseOf(w, session)
  const data = verifyLicense(license.content, await w.f.signer.publicKey())
  assert.equal(data.id, 'PML-LIC-2026-5001') // la web numera desde el 5001 (lo de antes es del Mac de Eric)
  assert.equal(data.modalidad, 'hazlo-tu')
  assert.equal(data.equipo, false)
  assert.equal(data.emitida, '2026-11-02')
  assert.equal(data.soporte_hasta, '2026-11-02') // sin meses del mensual
  assert.equal(license.paymentRef, session.payment_intent)
  assert.equal(purchase.taxTreatment, 'standard')
  assert.equal(purchase.taxRate, 21)
  assert.equal(purchase.marketingOptIn, true)

  // Factura en Holded (falso): en borrador por defecto, con el precio sin IVA.
  const docs = [...w.f.invoicer.documents.values()]
  assert.equal(docs.length, 1)
  assert.equal(docs[0].draft.lines[0].price, 990)
  assert.equal(docs[0].approved, false)

  // La cuenta: quien compro es titular.
  const members = await w.d.repo.listMembers(purchase.companyId!)
  assert.deepEqual(members.map((m) => [m.email, m.role]), [[purchase.email, 'owner']])

  // Bienvenida: la licencia dentro de un .zip (Brevo) y la copia de las condiciones aceptadas.
  const welcome = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('bienvenida'))
  assert.ok(welcome)
  assert.match(welcome.text, /zona/)
  const zip = welcome.attachments!.find((a) => a.name.endsWith('.zip'))!
  const [inside] = unzip(zip.content)
  assert.equal(inside.name, license.fileName)
  assert.equal(inside.content.toString('utf-8'), license.content)
  const terms = welcome.attachments!.find((a) => a.name.endsWith('.html'))!
  assert.match(terms.content.toString('utf-8'), /Aceptadas por Empresa \d+ SL/)
  assert.ok(terms.content.toString('utf-8').includes(LEGAL_VERSIONS.condiciones))

  // Aviso a PymaticLabs: con lo que hay que hacer (emitir la factura a mano, en borrador).
  const notice = w.f.mailer.sent.find((m) => m.to === w.d.config.internalEmail && m.subject.startsWith('Venta'))
  assert.ok(notice)
  assert.match(notice.text, /Emitir la factura en Holded/)
  assert.match(notice.subject, /PML-LIC-2026-5001/)
})

test('cada modalidad lleva su licencia: modalidad, equipo, soporte_hasta y plazas', async () => {
  const w = world()
  const expected: Record<ModalityId, { modalidad: string; equipo: boolean; hasta: string; seats: number }> = {
    'hazlo-tu': { modalidad: 'hazlo-tu', equipo: false, hasta: '2026-11-02', seats: 1 },
    'hazlo-tu-equipo': { modalidad: 'hazlo-tu', equipo: true, hasta: '2027-02-02', seats: 10 },
    acompanado: { modalidad: 'acompanado', equipo: false, hasta: '2026-12-02', seats: 1 },
    'acompanado-equipo': { modalidad: 'acompanado', equipo: true, hasta: '2027-02-02', seats: 10 },
  }
  const slots = await w.d.calendar.availability(new Date(w.now().getTime() + 24 * HOUR).toISOString(), new Date(w.now().getTime() + 14 * 24 * HOUR).toISOString())
  for (const [i, product] of (Object.keys(expected) as ModalityId[]).entries()) {
    const slot = slots[i]
    const guided = product.startsWith('acompanado')
    const session = paidSession(product, guided ? { metadata: { session_host: slot.host, session_start: slot.start } } : {})
    await pay(w, session)
    await runJobs(w.d)
    const { purchase, license } = await licenseOf(w, session)
    const want = expected[product]
    assert.equal(license.modalidad, want.modalidad, product)
    assert.equal(license.equipo, want.equipo, product)
    assert.equal(license.soporteHasta, want.hasta, product)
    const company = await w.d.repo.getCompany(purchase.companyId!)
    assert.equal(company!.seats, want.seats, product)
    if (guided) {
      const booking = await w.d.repo.getBooking(purchase.id, 1)
      assert.equal(booking?.status, 'booked', product)
      assert.equal(booking?.host, slot.host)
      const welcome = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('bienvenida'))!
      assert.match(welcome.text, /primera sesión de montaje está reservada/)
    }
  }
  assert.equal(w.f.calendar.booked.size, 2)
})

test('Acompanado con el hueco ocupado durante el pago: entrega igual, avisa y deja elegir otro en la zona', async () => {
  const w = world()
  const [slot] = await w.d.calendar.availability(new Date(w.now().getTime() + 24 * HOUR).toISOString(), new Date(w.now().getTime() + 7 * 24 * HOUR).toISOString())
  // Otro lo reserva antes de que llegue el aviso.
  await w.d.calendar.book({ slot, attendee: { name: 'Otro', email: 'otro@x.test', locale: 'es' }, reservationId: null, metadata: {} })
  const session = paidSession('acompanado', { metadata: { session_host: slot.host, session_start: slot.start } })
  await pay(w, session)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, session)
  assert.equal((await w.d.repo.getBooking(purchase.id, 1))?.status, 'failed')
  const welcome = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('bienvenida'))!
  assert.match(welcome.text, /Elige otro en tu zona/)
  const notice = w.f.mailer.sent.find((m) => m.subject.startsWith('Venta'))!
  assert.match(notice.text, /ofrecer otro/)

  // Desde la zona elige otro: sustituye a la primera.
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  const free = await w.d.calendar.availability(new Date(w.now().getTime() + 24 * HOUR).toISOString(), new Date(w.now().getTime() + 7 * 24 * HOUR).toISOString())
  const booked = await bookSession(w.d, user, purchase.companyId, free[0])
  assert.equal(booked.number, 1)
  assert.equal((await w.d.repo.getBooking(purchase.id, 1))?.status, 'booked')
  const second = await bookSession(w.d, user, purchase.companyId, free[1])
  assert.equal(second.number, 2)
})

test('con HOLDED_INVOICE_MODE=emit la factura se emite, Holded la manda y su PDF queda en la zona', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  const session = paidSession('hazlo-tu', { launch: true })
  await pay(w, session)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, session)
  const invoice = await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`)
  assert.equal(invoice?.status, 'sent')
  assert.equal(invoice?.number, 'F2026-0001')
  assert.ok(invoice?.storagePath)
  const doc = w.f.invoicer.documents.get(invoice!.providerId!)!
  assert.deepEqual(doc.sentTo, [purchase.email])
  assert.equal(doc.draft.lines[0].price, 500) // precio de lanzamiento
  assert.match(doc.draft.lines[0].description ?? '', /lanzamiento/)

  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  const url = await invoiceLink(w.d, user, invoice!.id)
  assert.ok(w.f.storage.verifySigned(new URL(url).searchParams))
  const notice = w.f.mailer.sent.find((m) => m.subject.startsWith('Venta'))!
  assert.match(notice.text, /Nada: entregada sola/)
})

test('inversion del sujeto pasivo (UE con NIF-IVA) y venta fuera de la UE', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  const eu = paidSession('hazlo-tu', { country: 'DE', taxIdType: 'eu_vat', buyer: { company: 'GmbH Test', taxId: 'DE123456789', email: 'a@gmbh.test' } })
  const us = paidSession('hazlo-tu', { country: 'US', taxIdType: 'us_ein', buyer: { company: 'Inc Test', taxId: '12-3456789', email: 'a@inc.test' } })
  await pay(w, eu)
  await pay(w, us)
  await runJobs(w.d)
  const pEu = await w.d.repo.getPurchaseByCheckoutSession(String(eu.id))
  const pUs = await w.d.repo.getPurchaseByCheckoutSession(String(us.id))
  assert.equal(pEu?.taxTreatment, 'reverse_charge')
  assert.equal(pUs?.taxTreatment, 'export')
  const bodies = [...w.f.invoicer.documents.values()].map((doc) => doc.draft.body ?? '')
  assert.ok(bodies.some((b) => /Inversión del sujeto pasivo/.test(b)))
  assert.ok(bodies.some((b) => /no sujeta al IVA español/.test(b)))
})

test('avisos repetidos: el mismo aviso dos veces, o dos avisos del mismo pago, no duplican nada', async () => {
  const w = world()
  const session = paidSession('hazlo-tu-equipo')
  assert.equal((await pay(w, session, 'evt_uno')).outcome, 'purchase')
  assert.equal((await pay(w, session, 'evt_uno')).outcome, 'duplicate')
  // Otro aviso del mismo pago (async_payment_succeeded tras completed, o un reenvio a mano).
  await handleStripeEvent(w.d, fakeEvent('checkout.session.async_payment_succeeded', session, 'evt_dos'))
  await runJobs(w.d)
  await pay(w, session, 'evt_tres')
  await runJobs(w.d)
  assert.equal(Object.keys(w.f.repo.state.purchases).length, 1)
  assert.equal(Object.keys(w.f.repo.state.licenses).length, 1)
  assert.equal(w.f.invoicer.documents.size, 1)
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('bienvenida')).length, 1)
  assert.equal(w.f.mailer.sent.filter((m) => m.subject.startsWith('Venta')).length, 1)
})

test('la firma del aviso se comprueba antes de nada', async () => {
  const w = world()
  const payload = JSON.stringify(fakeEvent('checkout.session.completed', paidSession('hazlo-tu')))
  const secret = 'whsec_prueba'
  assert.equal((await processStripeWebhook(w.d, payload, signPayload(payload, 'whsec_otro'), secret)).status, 400)
  assert.equal((await processStripeWebhook(w.d, payload, null, secret)).status, 400)
  assert.equal((await processStripeWebhook(w.d, payload.replace('Empresa', 'Emprexa'), signPayload(payload, secret), secret)).status, 400)
  assert.equal(Object.keys(w.f.repo.state.purchases).length, 0)
  const ok = await processStripeWebhook(w.d, payload, signPayload(payload, secret), secret)
  assert.equal(ok.status, 200)
  assert.equal(ok.body.outcome, 'purchase')
})

test('un paso que falla se reintenta con espera, avisa a PymaticLabs al tercer fallo y acaba bien sin duplicar', async () => {
  const w = world()
  w.f.invoicer.failures.failNext('createDocument', 3)
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, session)
  // La licencia y la bienvenida no esperan a Holded.
  assert.ok(purchase && (await w.d.repo.getPurchase(purchase.id))!.welcomeSentAt)
  let job = await w.d.repo.getJobByKey(`invoice:${purchase.id}`)
  assert.equal(job?.status, 'pending')
  assert.equal(job?.attempts, 1)
  assert.match(job?.lastError ?? '', /fallo provocado/)
  // El aviso interno de la venta espera a la factura.
  assert.equal((await w.d.repo.getJobByKey(`notice:${purchase.id}`))?.status, 'pending')

  for (let i = 0; i < 2; i++) {
    w.advance(2 * HOUR)
    await runJobs(w.d)
  }
  job = await w.d.repo.getJobByKey(`invoice:${purchase.id}`)
  assert.equal(job?.attempts, 3)
  assert.ok(job?.alertedAt)
  const alerts = w.f.mailer.sent.filter((m) => m.tags?.includes('alerta'))
  assert.equal(alerts.length, 1)
  assert.match(alerts[0].subject, /Paso fallando: invoice/)

  w.advance(2 * HOUR)
  await runJobs(w.d)
  job = await w.d.repo.getJobByKey(`invoice:${purchase.id}`)
  assert.equal(job?.status, 'done')
  assert.equal(w.f.invoicer.documents.size, 1)
  assert.equal((await w.d.repo.getJobByKey(`notice:${purchase.id}`))?.status, 'done')
})

test('un paso que no se arregla se para, con aviso urgente, y se reintenta a mano', async () => {
  const w = world({ JOBS_MAX_ATTEMPTS: '4' })
  w.f.signer.failures.failNext('sign', 4)
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  for (let i = 0; i < 6; i++) {
    await runJobs(w.d)
    w.advance(2 * HOUR)
  }
  const purchase = (await w.d.repo.getPurchaseByCheckoutSession(String(session.id)))!
  const job = await w.d.repo.getJobByKey(`license:${purchase.id}`)
  assert.equal(job?.status, 'dead')
  assert.ok(w.f.mailer.sent.some((m) => /URGENTE · Paso parado: license/.test(m.subject)))
  // Sin licencia no hay bienvenida.
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('bienvenida')).length, 0)
  assert.equal(await w.d.repo.retryJob(job!.id, w.now()), true)
  await runJobs(w.d)
  assert.equal((await w.d.repo.getJobByKey(`license:${purchase.id}`))?.status, 'done')
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('bienvenida')).length, 1)
  // El id reservado al principio es el que se usa.
  assert.equal((await w.d.repo.getLicenseByPurchase(purchase.id))?.id, 'PML-LIC-2026-5001')
})

test('una clave de firma que no es la esperada no firma: paso parado al momento', async () => {
  const w = world({ LICENSE_WEB_PUBLIC_KEY: 'BJindrRRqkm0oi++DhofPfFLr5awrwyMTLnuqA/HvIc=' })
  await pay(w, paidSession('hazlo-tu'))
  await runJobs(w.d)
  const dead = await w.d.repo.listJobs({ status: 'dead' })
  assert.deepEqual(dead.map((j) => j.kind), ['license'])
  assert.equal(dead[0].attempts, 1)
  assert.match(dead[0].lastError ?? '', /LICENSE_WEB_PUBLIC_KEY/)
})

test('devolucion: licencia anulada, zona cerrada, rectificativa y correo al cliente', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit', HOLDED_CREDIT_NOTE_MODE: 'emit' })
  const session = paidSession('acompanado')
  await pay(w, session)
  await runJobs(w.d)
  const { purchase, license } = await licenseOf(w, session)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  await zoneOverview(w.d, user)

  const charge = fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('charge.refunded', charge))).outcome, 'refund')
  assert.equal((await handleStripeEvent(w.d, fakeEvent('charge.refunded', charge))).outcome, 'refund-already')
  await runJobs(w.d)

  assert.ok((await w.d.repo.getLicense(license.id))?.revokedAt)
  assert.ok((await w.d.repo.getCompany(purchase.companyId!))?.accessRevokedAt)
  await assert.rejects(zoneOverview(w.d, user), /sin acceso/)
  await assert.rejects(licenseFile(w.d, user, license.id), /sin acceso/)
  // Una rectificativa por cada devolucion de Stripe, con su id.
  const credit = await w.d.repo.getInvoiceByRef(`credit:${purchase.id}:re_${session.payment_intent}_${purchase.amountTotal}`)
  assert.equal(credit?.kind, 'credit_note')
  assert.equal(credit?.status, 'sent')
  assert.equal(credit?.amountTotal, -purchase.amountTotal)
  const doc = w.f.invoicer.documents.get(credit!.providerId!)!
  assert.equal(doc.draft.lines[0].price, -1990)
  assert.match(doc.draft.body ?? '', /Rectifica la factura F2026-0001/)
  assert.ok(w.f.mailer.sent.some((m) => m.to === purchase.email && m.tags?.includes('devolucion')))
  assert.ok(w.f.mailer.sent.some((m) => /^Devolución: /.test(m.subject)))
  const list = await revocationList(w.d, {})
  assert.deepEqual(list.licencias.map((l) => [l.id, l.motivo]), [[license.id, 'refund']])
  // Con la publica que la firmo y la huella del fichero: el esqueleto no la confunde con una del Mac.
  assert.equal(list.licencias[0].clave, await w.f.signer.publicKey())
  assert.match(list.licencias[0].huella, /^[0-9a-f]{64}$/)
})

test('devolucion parcial: rectificativa por lo devuelto, la licencia sigue', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  const { purchase, license } = await licenseOf(w, session)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: 12100 })))
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(license.id))?.revokedAt, null)
  assert.equal((await w.d.repo.getPurchase(purchase.id))?.status, 'partially_refunded')
  const credit = await w.d.repo.getInvoiceByRef(`credit:${purchase.id}:re_${session.payment_intent}_12100`)
  assert.equal(w.f.invoicer.documents.get(credit!.providerId!)!.draft.lines[0].price, -100)
  // Por defecto la rectificativa no se emite sola (Verifactu pide el enlace a la factura): borrador y aviso.
  assert.equal(credit?.status, 'draft')
  assert.ok(w.f.mailer.sent.some((m) => /^Emitir la rectificativa a mano/.test(m.subject)))
})

test('devolucion con la factura aun en borrador: aviso para rectificarla a mano', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, session)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
  await runJobs(w.d)
  assert.ok(w.f.mailer.sent.some((m) => /^Rectificar a mano/.test(m.subject)))
  assert.equal(w.f.invoicer.documents.size, 1)
})

/** Un Acompanado con la primera sesion elegida al pagar y la segunda reservada desde la zona. */
async function guidedWithSessions(w: ReturnType<typeof world>, second: 'next' | 'last' = 'next') {
  const free = await w.d.calendar.availability(new Date(w.now().getTime() + 24 * HOUR).toISOString(), new Date(w.now().getTime() + 14 * 24 * HOUR).toISOString())
  const session = paidSession('acompanado', { metadata: { session_host: free[0].host, session_start: free[0].start } })
  await pay(w, session)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, session)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  assert.equal((await bookSession(w.d, user, purchase.companyId, second === 'next' ? free[2] : free[free.length - 1])).number, 2)
  assert.equal(w.f.calendar.booked.size, 2)
  return { session, purchase }
}

test('devolucion entera del Acompanado: sus sesiones se cancelan en Cal.com y en la zona, y el aviso lo dice; repetirlo no hace nada', async () => {
  const w = world()
  const { session, purchase } = await guidedWithSessions(w)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
  const stats = await runJobs(w.d)
  assert.equal(stats.dead + stats.retried, 0)
  assert.equal(w.f.calendar.booked.size, 0)
  assert.deepEqual([...w.f.calendar.cancelled.values()].map((b) => b.reason), ['Compra devuelta', 'Compra devuelta'])
  for (const n of [1, 2] as const) {
    const booking = await w.d.repo.getBooking(purchase.id, n)
    assert.equal(booking?.status, 'cancelled')
    assert.equal(booking?.note, 'cancelada: devolución')
  }
  const notice = w.f.mailer.sent.find((m) => /^Devolución: /.test(m.subject))!
  assert.match(notice.text, /Sesiones canceladas: 1ª con (Eric|Sergio), .* · 2ª con (Eric|Sergio), /)

  // Otra vez (un reintento): nada que cancelar, sin errores.
  const job = (await w.d.repo.getJobByKey(`cancel_bookings:${purchase.id}:refund`))!
  assert.deepEqual(await HANDLERS.cancel_bookings(w.d, job), { cancelled: [] })
  // Y si se corto tras cancelarla en Cal.com sin apuntarlo: alli ya no esta, se apunta igual.
  const first = (await w.d.repo.getBooking(purchase.id, 1))!
  await w.d.repo.updateBooking(first.id, { status: 'booked' })
  const again = (await HANDLERS.cancel_bookings(w.d, job)) as { cancelled: unknown[] }
  assert.equal(again.cancelled.length, 1)
  assert.equal((await w.d.repo.getBooking(purchase.id, 1))?.status, 'cancelled')
})

test('devolucion parcial del Acompanado: sus sesiones siguen', async () => {
  const w = world()
  const { session, purchase } = await guidedWithSessions(w)
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: 12100 })))
  await runJobs(w.d)
  assert.equal((await w.d.repo.getPurchase(purchase.id))?.status, 'partially_refunded')
  assert.equal(await w.d.repo.getJobByKey(`cancel_bookings:${purchase.id}:refund`), null)
  assert.equal(w.f.calendar.booked.size, 2)
  assert.equal(w.f.calendar.cancelled.size, 0)
  for (const n of [1, 2] as const) assert.equal((await w.d.repo.getBooking(purchase.id, n))?.status, 'booked')
})

test('devolucion del Acompanado con la primera sesion ya pasada: esa se queda como esta, sin errores; la que falta se cancela', async () => {
  const w = world()
  const { session, purchase } = await guidedWithSessions(w, 'last')
  const first = (await w.d.repo.getBooking(purchase.id, 1))!
  // Unos dias despues, ya hecha la primera.
  w.advance(4 * 24 * HOUR)
  assert.ok(new Date(first.startAt) < w.now())
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
  const stats = await runJobs(w.d)
  assert.equal(stats.dead + stats.retried, 0)
  assert.deepEqual(await w.d.repo.getBooking(purchase.id, 1), first)
  assert.equal((await w.d.repo.getBooking(purchase.id, 2))?.status, 'cancelled')
  assert.equal(w.f.calendar.cancelled.size, 1)
  assert.equal(w.f.calendar.booked.size, 1)
  const result = (await w.d.repo.getJobByKey(`cancel_bookings:${purchase.id}:refund`))?.result as { cancelled: { number: number }[] }
  assert.deepEqual(result.cancelled.map((s) => s.number), [2])
  // Como Cal.com: una que ya acabo no se cancela, y no es un error.
  assert.equal(await w.f.calendar.cancel(first.providerUid!, 'Compra devuelta'), 'ended')
})

test('contracargo del Acompanado: abierto no cancela sus sesiones; perdido, si (y el aviso lo dice)', async () => {
  const w = world()
  const { session, purchase } = await guidedWithSessions(w)
  const pi = String(session.payment_intent)
  await handleStripeEvent(w.d, fakeEvent('charge.dispute.created', fakeDispute({ paymentIntent: pi, amount: purchase.amountTotal, disputeId: 'dp_sesiones' })))
  await runJobs(w.d)
  assert.equal(w.f.calendar.booked.size, 2)
  await handleStripeEvent(w.d, fakeEvent('charge.dispute.closed', fakeDispute({ paymentIntent: pi, amount: purchase.amountTotal, disputeId: 'dp_sesiones', status: 'lost' })))
  const stats = await runJobs(w.d)
  assert.equal(stats.dead + stats.retried, 0)
  assert.equal(w.f.calendar.booked.size, 0)
  assert.deepEqual([...w.f.calendar.cancelled.values()].map((b) => b.reason), ['Pago con contracargo', 'Pago con contracargo'])
  assert.equal((await w.d.repo.getBooking(purchase.id, 2))?.note, 'cancelada: contracargo')
  const notice = w.f.mailer.sent.find((m) => /^Contracargo cerrado \(lost\)/.test(m.subject))!
  assert.match(notice.text, /Sesiones canceladas: 1ª con .* · 2ª con /)
})

test('contracargo: licencia anulada y zona cerrada; si se gana, vuelven; si se pierde, rectificativa', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  const won = paidSession('hazlo-tu')
  const lost = paidSession('hazlo-tu')
  await pay(w, won)
  await pay(w, lost)
  await runJobs(w.d)
  const a = await licenseOf(w, won)
  const b = await licenseOf(w, lost)

  for (const [s, id] of [[won, 'dp_gana'], [lost, 'dp_pierde']] as const) {
    assert.equal((await handleStripeEvent(w.d, fakeEvent('charge.dispute.created', fakeDispute({ paymentIntent: String(s.payment_intent), amount: 119790, disputeId: id })))).outcome, 'dispute')
  }
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(a.license.id))?.revokedReason, 'dispute')
  assert.ok((await w.d.repo.getCompany(a.purchase.companyId!))?.accessRevokedAt)
  assert.ok(w.f.mailer.sent.some((m) => /URGENTE · Contracargo/.test(m.subject)))

  await handleStripeEvent(w.d, fakeEvent('charge.dispute.closed', fakeDispute({ paymentIntent: String(won.payment_intent), amount: 119790, disputeId: 'dp_gana', status: 'won' })))
  await handleStripeEvent(w.d, fakeEvent('charge.dispute.closed', fakeDispute({ paymentIntent: String(lost.payment_intent), amount: 119790, disputeId: 'dp_pierde', status: 'lost' })))
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicense(a.license.id))?.revokedAt, null)
  assert.equal((await w.d.repo.getCompany(a.purchase.companyId!))?.accessRevokedAt, null)
  assert.equal((await w.d.repo.getPurchase(a.purchase.id))?.status, 'paid')
  assert.ok((await w.d.repo.getLicense(b.license.id))?.revokedAt)
  assert.equal((await w.d.repo.getPurchase(b.purchase.id))?.status, 'dispute_lost')
  assert.ok(await w.d.repo.getInvoiceByRef(`credit:${b.purchase.id}:dispute:dp_pierde`))
})

test('mensual: cada cobro da factura y licencia nueva con el soporte_hasta del periodo, nunca menos', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  const session = paidSession('hazlo-tu-equipo') // trae 3 meses de Pro: hasta 2027-02-02
  await pay(w, session)
  await runJobs(w.d)
  const { purchase, license } = await licenseOf(w, session)
  const customer = String(session.customer)

  // Un cobro que cubre hasta despues de los meses incluidos.
  const later = fakeInvoice({ customer, amount: 19900, periodEnd: Math.floor(Date.parse('2027-03-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: purchase.companyId! } })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', later))).outcome, 'renewal')
  // La prueba de 0 € no da nada.
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', { ...fakeInvoice({ customer, amount: 0, periodEnd: 0 }), amount_paid: 0 }))).outcome, 'ignored-zero')
  // Un cobro que cubre menos que lo que ya tiene: no se lo recorta.
  const shorter = fakeInvoice({ customer, amount: 19900, periodEnd: Math.floor(Date.parse('2026-12-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro' } })
  await handleStripeEvent(w.d, fakeEvent('invoice.paid', shorter))
  await runJobs(w.d)

  const renewal = await w.d.repo.getPurchaseByPaymentRef(String(later.id))
  const renewed = await w.d.repo.getLicenseByPurchase(renewal!.id)
  assert.equal(renewed?.soporteHasta, '2027-03-02')
  assert.equal(renewed?.modalidad, license.modalidad)
  assert.equal(renewed?.equipo, true)
  assert.notEqual(renewed?.id, license.id)
  assert.equal(verifyLicense(renewed!.content, await w.f.signer.publicKey()).soporte_hasta, '2027-03-02')
  const second = await w.d.repo.getLicenseByPurchase((await w.d.repo.getPurchaseByPaymentRef(String(shorter.id)))!.id)
  assert.equal(second?.soporteHasta, '2027-03-02')
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('mensual')).length, 2)
  const invoice = await w.d.repo.getInvoiceByRef(`invoice:${renewal!.id}`)
  assert.equal(invoice?.status, 'sent')
  assert.equal(w.f.invoicer.documents.get(invoice!.providerId!)!.draft.lines[0].price, 199)

  // Devolver un cobro del mensual anula solo su licencia; la zona sigue.
  w.f.payments.invoiceByPaymentIntent.set('pi_mensual', String(later.id))
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: 'pi_mensual', amount: renewal!.amountTotal, refunded: renewal!.amountTotal })))
  await runJobs(w.d)
  assert.ok((await w.d.repo.getLicense(renewed!.id))?.revokedAt)
  assert.equal((await w.d.repo.getCompany(purchase.companyId!))?.accessRevokedAt, null)
})

test('conciliacion: una licencia sin pago da aviso urgente; un pago sin aviso se entrega', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  let report = await reconcile(w.d)
  assert.equal(report.checkedLicenses, 1)
  assert.deepEqual(report.orphans, [])

  // Una licencia firmada fuera de la entrega (con un pago que Stripe no conoce).
  const { purchase } = await licenseOf(w, session)
  const fake = await w.d.repo.createPurchase({ ...purchase, paymentRef: 'pi_inventado', stripeCheckoutSessionId: 'cs_inventado', stripePaymentIntentId: 'pi_inventado' })
  await w.d.repo.insertLicense({
    id: formatLicenseId(2026, 99),
    companyId: purchase.companyId!,
    purchaseId: fake.purchase.id,
    paymentRef: 'pi_inventado',
    modalidad: 'hazlo-tu',
    equipo: true,
    emitida: '2026-11-02',
    soporteHasta: '2030-11-02',
    fileName: 'x.cerebro-licencia',
    content: '{}',
    keyId: 'local-test',
    publicKey: 'x',
  })
  // Y un pago que Stripe cobro pero cuyo aviso se perdio.
  const lostSession = paidSession('hazlo-tu')
  w.f.payments.paidSessions.push(lostSession)
  w.f.payments.payments.set(String(lostSession.payment_intent), { exists: true, paid: true, refunded: false, disputed: false, amount: 119790 })

  report = await reconcile(w.d)
  assert.deepEqual(report.orphans.map((o) => [o.licenseId, o.reason]), [['PML-LIC-2026-0099', 'el pago no existe en Stripe']])
  assert.deepEqual(report.recovered.map((r) => r.outcome), ['purchase'])
  const urgent = w.f.mailer.sent.find((m) => /URGENTE · 1 licencia\(s\) sin pago/.test(m.subject))
  assert.ok(urgent)
  assert.match(urgent.text, /PML-LIC-2026-0099/)
  await runJobs(w.d)
  assert.ok((await w.d.repo.getPurchaseByCheckoutSession(String(lostSession.id)))?.welcomeSentAt)
})

test('conciliacion: una factura en borrador de otra pieza (la de mentira de antes) no se busca en la de ahora', async () => {
  const w = world()
  await pay(w, paidSession('hazlo-tu'))
  await runJobs(w.d)
  const [draft] = await w.d.repo.listDraftInvoices()
  assert.ok(draft)
  await w.d.repo.updateInvoice(draft.id, { provider: 'holded', providerId: 'doc_de_otra_pieza' })
  const report = await reconcile(w.d)
  assert.deepEqual(report.errors, [])
})

test('conciliacion: un borrador borrado a mano en Holded (404) se apunta asi y no se busca mas, sin contarlo como error', async () => {
  const w = world()
  await pay(w, paidSession('hazlo-tu'))
  await runJobs(w.d)
  const [draft] = await w.d.repo.listDraftInvoices()
  assert.ok(draft?.providerId)
  // Como se borra en Holded (lo normal tras devolver una compra de prueba): 404, como el de verdad.
  w.f.invoicer.documents.delete(draft.providerId)
  await assert.rejects(w.f.invoicer.getDocument('invoice', draft.providerId), (e: { status?: number }) => e.status === 404)
  let report = await reconcile(w.d)
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.invoicesDeleted, [draft.ref])
  const after = (await w.d.repo.getInvoice(draft.id))!
  assert.equal(after.providerId, null)
  assert.equal(after.holdReason, 'Borrado en Holded a mano')
  assert.ok(w.f.mailer.sent.some((m) => /^Conciliación/.test(m.subject) && /Borradores borrados en Holded a mano/.test(m.text)))

  // Al dia siguiente ya no se pregunta a Holded por el.
  const calls = w.f.invoicer.calls
  w.advance(24 * HOUR)
  report = await reconcile(w.d)
  assert.deepEqual(report.errors, [])
  assert.deepEqual(report.invoicesDeleted, [])
  assert.equal(w.f.invoicer.calls, calls)
})

test('conciliacion: un pago devuelto con la licencia sin anular es una licencia sin pago', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  await pay(w, session)
  await runJobs(w.d)
  w.f.payments.payments.set(String(session.payment_intent), { exists: true, paid: true, refunded: true, disputed: false, amount: 1 })
  const report = await reconcile(w.d)
  assert.match(report.orphans[0].reason, /devolvio/)
})

test('100 compras seguidas: precio de lanzamiento solo para 10, 100 licencias con ids unicos y 100 bienvenidas', async () => {
  // Las 50 del Acompanado abren su pago en el mismo instante: sin el tope de huecos apartados a la vez.
  const w = world({ LIMIT_HOLDS_TOTAL: '1000' })
  const products: ModalityId[] = ['hazlo-tu', 'hazlo-tu-equipo', 'acompanado', 'acompanado-equipo']
  const free = await w.d.calendar.availability(new Date(w.now().getTime() + 24 * HOUR).toISOString(), new Date(w.now().getTime() + 21 * 24 * HOUR).toISOString())
  const sessions: Record<string, unknown>[] = []
  for (let i = 0; i < 100; i++) {
    const product = products[i % 4]
    const slot = product.startsWith('acompanado') ? free.shift()! : null
    const checkout = await createCheckout(w.d, { product, locale: i % 2 ? 'en' : 'es', session: slot, clientIp: `10.0.0.${i}` })
    const params = w.f.payments.sessions.get(checkout.sessionId)!.params
    const metadata = params.metadata as Record<string, string>
    const prices = priceCents(product)
    sessions.push(
      fakeCheckoutSession({
        sessionId: checkout.sessionId,
        product,
        buyer: buyer(1000 + i),
        metadata,
        amountSubtotal: prices.list,
        amountDiscount: params.discounts ? prices.list - prices.launch! : 0,
      })
    )
  }
  // Llegan todos los avisos de golpe, y la cola los despacha.
  await Promise.all(sessions.map((s) => pay(w, s)))
  const stats = await runJobs(w.d, { budgetMs: 120_000 })
  assert.equal(stats.dead, 0)
  assert.equal(stats.retried, 0)

  const purchases = Object.values(w.f.repo.state.purchases)
  assert.equal(purchases.length, 100)
  assert.equal(purchases.filter((p) => p.launch).length, 10)
  assert.equal(await w.d.repo.countLaunchSlotsUsed(), 10)
  const ids = Object.keys(w.f.repo.state.licenses).sort()
  assert.equal(ids.length, 100)
  assert.equal(new Set(ids).size, 100)
  assert.equal(ids[0], 'PML-LIC-2026-5001')
  assert.equal(ids[99], 'PML-LIC-2026-5100')
  const publicKey = await w.f.signer.publicKey()
  for (const license of Object.values(w.f.repo.state.licenses)) verifyLicense(license.content, publicKey)
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('bienvenida')).length, 100)
  assert.equal(w.f.mailer.sent.filter((m) => m.subject.startsWith('Venta')).length, 100)
  assert.equal(w.f.invoicer.documents.size, 100)
  assert.equal(w.f.calendar.booked.size, 50)
  assert.equal(Object.values(w.f.repo.state.jobs).filter((j) => j.status !== 'done').length, 0)
})

test('zona: codigo solo para quien tiene acceso, equipo hasta las plazas y descargas con enlace que caduca', async () => {
  const w = world()
  const team = paidSession('hazlo-tu-equipo')
  await pay(w, team)
  await runJobs(w.d)
  const { purchase, license } = await licenseOf(w, team)

  await requestCode(w.d, 'nadie@nada.test', 'es')
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('zona-codigo')).length, 0)
  await requestCode(w.d, purchase.email.toUpperCase(), 'es')
  const codeMail = w.f.mailer.sent.find((m) => m.tags?.includes('zona-codigo'))!
  const cookies: { name: string; value: string }[] = []
  const jar = { getAll: () => cookies, setAll: (c: { name: string; value: string }[]) => void cookies.push(...c) }
  assert.equal(await w.d.auth.verifyCode(purchase.email, '000000', jar), null)
  const user = await w.d.auth.verifyCode(purchase.email, codeMail.text, jar)
  assert.ok(user)
  assert.deepEqual(await w.d.auth.currentUser(jar), user)

  const overview = await zoneOverview(w.d, user)
  assert.equal(overview.role, 'owner')
  assert.deepEqual(overview.licenses.map((l) => l.id), [license.id])
  assert.equal((await licenseFile(w.d, user, license.id)).content, license.content)

  // Equipo: hasta 10 personas contando a quien compro.
  for (let i = 1; i <= 9; i++) assert.deepEqual(await addTeamMember(w.d, user, purchase.companyId!, `persona${i}@empresa.test`), { added: true })
  await assert.rejects(addTeamMember(w.d, user, purchase.companyId!, 'once@empresa.test'), /10 personas/)
  await runJobs(w.d)
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('equipo')).length, 9)

  // La persona del equipo entra igual, baja la extension, pero no ve facturas ni equipo.
  await requestCode(w.d, 'persona1@empresa.test', 'en')
  const memberCode = w.f.mailer.sent.filter((m) => m.tags?.includes('zona-codigo')).pop()!
  const member = await w.d.auth.verifyCode('persona1@empresa.test', memberCode.text, { getAll: () => [], setAll: () => {} })
  assert.ok(member)
  await assert.rejects(addTeamMember(w.d, member, purchase.companyId!, 'x@empresa.test'), /solo quien compro/)

  // Version nueva: ficheros en el almacen, aviso a las 10 personas.
  for (const name of ['cerebro-digital-1.2.0.mcpb', 'cerebro-digital-1.2.0-windows.mcpb', 'cerebro-registro-1.2.0-windows.zip']) {
    await w.d.storage.put('releases', `versiones/1.2.0/${name}`, Buffer.from(name), 'application/octet-stream')
  }
  await assert.rejects(publishVersion(w.d, { version: '1.2.0', notesEs: 'n', notesEn: 'n', announce: true, files: [{ kind: 'mac', fileName: 'a', storagePath: 'versiones/1.2.0/no-esta.mcpb' }] }), /no estan en el almacen/)
  const published = await publishVersion(w.d, {
    version: '1.2.0',
    notesEs: 'Correcciones de seguridad.\n\nMejoras en el montaje.',
    notesEn: 'Security fixes.',
    announce: true,
    files: [
      { kind: 'mac', fileName: 'cerebro-digital-1.2.0.mcpb', storagePath: 'versiones/1.2.0/cerebro-digital-1.2.0.mcpb' },
      { kind: 'windows', fileName: 'cerebro-digital-1.2.0-windows.mcpb', storagePath: 'versiones/1.2.0/cerebro-digital-1.2.0-windows.mcpb' },
      { kind: 'registry', fileName: 'cerebro-registro-1.2.0-windows.zip', storagePath: 'versiones/1.2.0/cerebro-registro-1.2.0-windows.zip' },
    ],
  })
  assert.equal(published.announced, 10)
  await runJobs(w.d)
  assert.equal(w.f.mailer.sent.filter((m) => m.tags?.includes('version')).length, 10)

  const memberView = await zoneOverview(w.d, member)
  assert.equal(memberView.role, 'member')
  assert.deepEqual(memberView.invoices, [])
  assert.deepEqual(memberView.team, [])
  assert.equal(memberView.version?.files.length, 3) // con equipo, tambien el instalador del registro
  const url = await downloadLink(w.d, member, memberView.version!.files[0].id)
  const params = new URL(url).searchParams
  assert.ok(w.f.storage.verifySigned(params))
  assert.equal(w.f.storage.verifySigned(params, Math.floor(Date.now() / 1000) + 3600), null) // caduca en minutos

  // Baja del equipo: pierde el acceso.
  assert.deepEqual(await removeTeamMember(w.d, user, purchase.companyId!, 'persona1@empresa.test'), { removed: true })
  await assert.rejects(zoneOverview(w.d, member), /sin acceso/)
  await assert.rejects(removeTeamMember(w.d, user, purchase.companyId!, purchase.email), /no se puede dar de baja/)
})

test('zona: sin equipo no hay altas ni instalador del registro', async () => {
  const w = world()
  const single = paidSession('hazlo-tu')
  await pay(w, single)
  await runJobs(w.d)
  const { purchase } = await licenseOf(w, single)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  await assert.rejects(addTeamMember(w.d, user, purchase.companyId!, 'otra@empresa.test'), /una persona/)
  for (const name of ['a.mcpb', 'b.mcpb', 'c.zip']) await w.d.storage.put('releases', `versiones/1.0.1/${name}`, Buffer.from(name), 'application/octet-stream')
  await publishVersion(w.d, {
    version: '1.0.1',
    notesEs: 'x',
    notesEn: 'x',
    announce: false,
    files: [
      { kind: 'mac', fileName: 'a.mcpb', storagePath: 'versiones/1.0.1/a.mcpb' },
      { kind: 'windows', fileName: 'b.mcpb', storagePath: 'versiones/1.0.1/b.mcpb' },
      { kind: 'registry', fileName: 'c.zip', storagePath: 'versiones/1.0.1/c.zip' },
    ],
  })
  const view = await zoneOverview(w.d, user)
  assert.deepEqual(view.version?.files.map((f) => f.kind), ['mac', 'windows'])
  const registry = Object.values(w.f.repo.state.versionFiles).find((f) => f.kind === 'registry')!
  await assert.rejects(downloadLink(w.d, user, registry.id), /solo con equipo/)
})

test('compra sin NIF: no se firma nada, se avisa para revisarla a mano', async () => {
  const w = world()
  const session = paidSession('hazlo-tu')
  ;(session.customer_details as { tax_ids: unknown[] }).tax_ids = []
  assert.equal((await pay(w, session)).outcome, 'needs-review')
  await runJobs(w.d)
  assert.equal(Object.keys(w.f.repo.state.licenses).length, 0)
  assert.ok(w.f.mailer.sent.some((m) => /Venta a revisar/.test(m.subject)))
})

test('la espera entre reintentos crece y respeta Retry-After', () => {
  const fixed = () => 0.5
  assert.equal(backoffMs(1, 30_000, 3600_000, null, fixed), 30_000)
  assert.equal(backoffMs(3, 30_000, 3600_000, null, fixed), 120_000)
  assert.equal(backoffMs(20, 30_000, 3600_000, null, fixed), 3600_000)
  assert.equal(backoffMs(1, 30_000, 3600_000, 90_000, fixed), 90_000)
})
