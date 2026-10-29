import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { createFakeDelivery } from './delivery/container.ts'
import { readConfig } from './delivery/config.ts'
import { handleStripeEvent } from './delivery/events.ts'
import { runJobs } from './delivery/jobs.ts'
import { LicenseUploadError, uploadManualLicense } from './delivery/manual-license.ts'
import { reconcile } from './delivery/reconcile.ts'
import { revocationList } from './delivery/versions.ts'
import { fakeCharge, fakeCheckoutSession, fakeDispute, fakeEvent, fakeInvoice } from './delivery/fake-stripe.ts'
import { priceCents } from './delivery/products.ts'
import { cifWithControl } from './delivery/checkout-nif.ts'
import { unzip } from './delivery/zip.ts'
import { licenseFile, zoneOverview } from './delivery/zone.ts'
import { canonical, LICENSES_PUBLIC_KEY, privateKeyFromSeed, rawPublicKey, serializeLicense, signLicense, verifyLicense, type LicenseData } from './license.ts'
import { LEGAL_VERSIONS } from './legal-versions.ts'
import type { ModalityId } from './offer.ts'
import type { LicenseRequest } from './delivery/types.ts'

// Las licencias a mano (LICENSE_MODE=manual), con las piezas falsas: la web pide cada licencia a
// Eric en vez de firmarla, la bienvenida sale sin ella, y la que sube firmada se comprueba, se
// guarda, llega al cliente y se baja de la zona. "La clave del Mac" es aqui una de prueba
// (LICENSE_MANUAL_PUBLIC_KEY): la de verdad no se tiene, y los pagos de prueba solo se entregan con una
// de pruebas.

function key() {
  const { privateKey } = generateKeyPairSync('ed25519')
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  return { seed: der.subarray(der.length - 32).toString('base64'), publicKey: rawPublicKey(privateKey) }
}

const ERIC = key()

function world(env: Record<string, string> = {}) {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now, env: { LICENSE_MODE: 'manual', LICENSE_MANUAL_PUBLIC_KEY: ERIC.publicKey, LICENSE_REQUEST_EMAIL: 'eric@pymaticlabs.test', ...env } })
  return {
    d,
    f: d.fakes,
    advance(ms: number) {
      now = new Date(now.getTime() + ms)
    },
  }
}

const HOUR = 3600_000
let counter = 0
function buyer(n = ++counter) {
  return { company: `Manual ${n} SL`, taxId: cifWithControl(`B${String(3000000 + n)}`), email: `compras${n}@manual${n}.test` }
}

async function buy(w: ReturnType<typeof world>, product: ModalityId = 'hazlo-tu-equipo') {
  const session = fakeCheckoutSession({
    product,
    buyer: buyer(),
    amountSubtotal: priceCents(product).list,
    created: Math.floor(new Date('2026-11-02T10:00:00Z').getTime() / 1000),
    metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones },
  })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session))).outcome, 'purchase')
  await runJobs(w.d)
  const purchase = (await w.d.repo.getPurchaseByCheckoutSession(String(session.id)))!
  const request = (await w.d.repo.getLicenseRequestByPurchase(purchase.id))!
  return { session, purchase, request }
}

/** Lo que haria Eric en su Mac con los campos del correo y un numero suyo. */
function sign(request: LicenseRequest, id: string, patch: Partial<LicenseData> = {}, seed = ERIC.seed, publicKey = ERIC.publicKey) {
  const data: LicenseData = { id, cliente: request.cliente, nif: request.nif, modalidad: request.modalidad, equipo: request.equipo, emitida: request.emitida, soporte_hasta: request.soporteHasta, ...patch }
  return signLicense(data, seed, publicKey).text
}

async function rejects(promise: Promise<unknown>, status: number, message: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof LicenseUploadError, String(error))
    assert.equal(error.status, status)
    assert.match(error.message, message)
    return true
  })
}

test('a mano: la compra pide la licencia a Eric con los campos tal cual, la bienvenida sale sin ella y la zona la ensena en camino', async () => {
  const w = world()
  const { purchase, request } = await buy(w)
  assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)

  // Sin firmar nada ni reservar un numero de la web.
  assert.equal(await w.d.repo.getLicenseByPurchase(purchase.id), null)
  assert.equal(purchase.reservedLicenseId, null)
  const company = (await w.d.repo.getCompany(purchase.companyId!))!
  assert.deepEqual(
    [request.status, request.kind, request.modalidad, request.equipo, request.seats, request.emitida, request.soporteHasta, request.nif, request.cliente, request.paymentRef],
    ['pending', 'one_time', 'hazlo-tu', true, 10, '2026-11-02', '2027-02-17', company.taxId, company.name, purchase.paymentRef]
  )

  // El correo a Eric: los campos, el JSON, como subirla, y sin numero de la web.
  const ask = w.f.mailer.sent.find((m) => m.to === 'eric@pymaticlabs.test' && /Licencia a firmar/.test(m.subject))
  assert.ok(ask)
  assert.match(ask.subject, /^PRUEBA · /) // pago de prueba de Stripe
  assert.ok(ask.text.includes(JSON.stringify({ cliente: request.cliente, nif: request.nif, modalidad: 'hazlo-tu', equipo: true, emitida: '2026-11-02', soporte_hasta: '2027-02-17' })))
  assert.ok(ask.text.includes(`scripts/subir-licencia.mts --web https://web.example.test --compra ${purchase.id} --fichero`))
  assert.match(ask.text, /del 0001 al 5000/)
  assert.doesNotMatch(ask.text, /PML-LIC-2026-\d{4}/)

  // La bienvenida, ya: sin la licencia, con las condiciones, y diciendo que llega en unas horas.
  const welcome = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('bienvenida'))
  assert.ok(welcome)
  assert.match(welcome.text, /Tu licencia te llega en unas horas/)
  assert.ok(!welcome.attachments!.some((a) => a.name.endsWith('.zip')))
  assert.ok(welcome.attachments!.some((a) => a.name.startsWith('condiciones-')))
  assert.match(welcome.subject, /zona de socio, descargas y condiciones/)
  const notice = w.f.mailer.sent.find((m) => /^Venta: licencia a mano/.test(m.subject))
  assert.ok(notice)
  assert.match(notice.text, /Firmar la licencia a mano y subirla \(pedida a eric@pymaticlabs.test\)/)

  // La zona: se entra, sin licencia aun, y la que falta sale como en camino.
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  const o = await zoneOverview(w.d, user)
  assert.deepEqual(o.licenses, [])
  assert.deepEqual(o.pendingLicenses.map((p) => [p.kind, p.modalidad, p.equipo, p.soporteHasta, p.paidUntil]), [['one_time', 'hazlo-tu', true, '2027-02-17', '2027-02-02']])
})

test('a mano: la licencia subida se comprueba con la clave y con la compra, se guarda, llega al cliente en .zip y se baja de la zona', async () => {
  const w = world()
  const { purchase, request } = await buy(w)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }

  // Lo que no vale: otra clave, otro soporte_hasta, otro NIF, sin equipo, un numero de la web, nada.
  const other = key()
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0101', {}, other.seed, other.publicKey)), 400, /no verifica con la clave de pruebas/)
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0101', { soporte_hasta: '2027-03-02' })), 409, /no cuadra con la compra: soporte_hasta "2027-03-02" \(la compra: "2027-02-17"\)/)
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0101', { nif: 'B99999999' })), 409, /nif "B99999999"/)
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0101', { equipo: false })), 409, /equipo false .*plazas: 10 con equipo false/)
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-5001')), 400, /los numeros del Mac son del 0001 al 5000/)
  await rejects(uploadManualLicense(w.d, purchase.id, '  '), 400, /falta el fichero/)
  await rejects(uploadManualLicense(w.d, 'pi_que_no_existe', sign(request, 'PML-LIC-2026-0101')), 404, /no hay ninguna compra/)
  assert.equal(await w.d.repo.getLicenseByPurchase(purchase.id), null)

  // La buena, por el pago (pi_...) o por el id de la compra, con el nombre un poco distinto: aviso, no freno.
  const text = sign(request, 'PML-LIC-2026-0101', { cliente: `${request.cliente.replace(' SL', ', S.L.')}` })
  const result = await uploadManualLicense(w.d, purchase.paymentRef, text)
  assert.equal(result.licenseId, 'PML-LIC-2026-0101')
  assert.equal(result.already, false)
  assert.match(result.warnings[0], /el cliente de la licencia es/)
  const license = (await w.d.repo.getLicenseByPurchase(purchase.id))!
  assert.deepEqual([license.origin, license.keyId, license.publicKey, license.content, license.paymentRef], ['manual', 'manual-test', ERIC.publicKey, text, purchase.paymentRef])
  assert.equal((await w.d.repo.getLicenseRequestByPurchase(purchase.id))!.status, 'issued')

  // El correo al cliente, con el mismo .zip de siempre; y en la zona, para bajarla.
  await runJobs(w.d)
  const mails = w.f.mailer.sent.filter((m) => m.to === purchase.email && m.tags?.includes('licencia'))
  assert.equal(mails.length, 1)
  assert.match(mails[0].subject, /Tu licencia del Cerebro Digital/)
  const [inside] = unzip(mails[0].attachments!.find((a) => a.name.endsWith('.zip'))!.content)
  assert.equal(inside.name, license.fileName)
  assert.equal(inside.content.toString('utf-8'), text)
  assert.equal(verifyLicense((await licenseFile(w.d, user, license.id)).content, ERIC.publicKey).id, 'PML-LIC-2026-0101')
  const o = await zoneOverview(w.d, user)
  assert.deepEqual([o.licenses.map((l) => l.id), o.pendingLicenses.length], [['PML-LIC-2026-0101'], 0])

  // Subirla otra vez no hace nada; otra licencia para la misma compra, no.
  assert.equal((await uploadManualLicense(w.d, purchase.id, text)).already, true)
  await runJobs(w.d)
  assert.equal(w.f.mailer.sent.filter((m) => m.to === purchase.email && m.tags?.includes('licencia')).length, 1)
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0102')), 409, /ya tiene la licencia PML-LIC-2026-0101/)

  // Un numero que ya es de otra licencia, en otra compra: no.
  const second = await buy(w, 'hazlo-tu')
  await rejects(uploadManualLicense(w.d, second.purchase.id, sign(second.request, 'PML-LIC-2026-0101')), 409, /ya es de otra licencia/)
  assert.equal((await uploadManualLicense(w.d, second.purchase.id, sign(second.request, 'PML-LIC-2026-0103'))).licenseId, 'PML-LIC-2026-0103')

  // La conciliacion las cuenta como las demas: cada una con su pago cobrado.
  const report = await reconcile(w.d)
  assert.equal(report.checkedLicenses, 2)
  assert.deepEqual(report.orphans, [])
})

test('a mano: un pago de prueba nunca se entrega con la clave del Mac, ni uno en vivo con una de pruebas', async () => {
  // Sin LICENSE_MANUAL_PUBLIC_KEY: la clave del Mac de verdad.
  const real = world({ LICENSE_MANUAL_PUBLIC_KEY: '' })
  assert.equal(real.d.config.manualPublicKey, LICENSES_PUBLIC_KEY)
  const { purchase, request } = await buy(real)
  const ask = real.f.mailer.sent.find((m) => /Licencia a firmar/.test(m.subject))!
  assert.match(ask.text, /NO firmarla con la clave del Mac/)
  await rejects(uploadManualLicense(real.d, purchase.id, sign(request, 'PML-LIC-2026-0200')), 409, /pago de prueba de Stripe: no se entrega con la clave del Mac/)

  // Con una de pruebas, un pago en vivo tampoco.
  const w = world()
  const live = await buy(w)
  await w.d.repo.updatePurchase(live.purchase.id, { livemode: true })
  await rejects(uploadManualLicense(w.d, live.purchase.id, sign(live.request, 'PML-LIC-2026-0201')), 409, /pago en vivo y esta web espera una clave de pruebas/)
})

test('a mano: sin firmar a las horas de aviso, recordatorio; la conciliacion lo repite; una devolucion antes la cancela y Eric lo sabe', async () => {
  const w = world({ LICENSE_PENDING_ALERT_HOURS: '6', DELIVERY_ALERT_EMAIL: 'alertas@pymaticlabs.test' })
  const { session, purchase, request } = await buy(w)
  const late = () => w.f.mailer.sent.filter((m) => /sin firmar desde hace más de 6 h/.test(m.subject))
  w.advance(5 * HOUR)
  await runJobs(w.d)
  assert.equal(late().length, 0)
  w.advance(2 * HOUR)
  await runJobs(w.d)
  assert.deepEqual(late().map((m) => m.to).sort(), ['alertas@pymaticlabs.test', 'eric@pymaticlabs.test'])
  assert.match(late()[0].text, new RegExp(`Compra ${purchase.id}: ${request.cliente}, pago único: 7 h sin firmar`))
  const report = await reconcile(w.d)
  assert.deepEqual(report.pendingLicenses.map((p) => [p.purchaseId, p.hours]), [[purchase.id, 7]])
  assert.equal(late().length, 4)

  // Devuelta antes de firmarla: deja de pedirse, Eric recibe "No firmar" y la web ya no la acepta.
  const charge = fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('charge.refunded', charge))).outcome, 'refund')
  await runJobs(w.d)
  const cancelled = (await w.d.repo.getLicenseRequestByPurchase(purchase.id))!
  assert.deepEqual([cancelled.status, cancelled.cancelReason], ['cancelled', 'refund'])
  const stop = w.f.mailer.sent.find((m) => m.to === 'eric@pymaticlabs.test' && /^No firmar: /.test(m.subject))
  assert.ok(stop)
  assert.ok(stop.text.includes(purchase.id))
  await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0300')), 409, /se cancelo \(refund\)/)
  assert.deepEqual((await reconcile(w.d)).pendingLicenses, [])
  assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)
})

test('a mano: un contracargo antes de firmarla la cancela; ganado, se vuelve a pedir; una devolucion tras subirla la anula como siempre', async () => {
  const w = world()
  const { session, purchase, request } = await buy(w)
  const pi = String(session.payment_intent)
  const send = (type: string, status: string) => handleStripeEvent(w.d, fakeEvent(type, fakeDispute({ paymentIntent: pi, amount: purchase.amountTotal, status, disputeId: 'dp_manual' })))
  assert.equal((await send('charge.dispute.created', 'needs_response')).outcome, 'dispute')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicenseRequestByPurchase(purchase.id))!.cancelReason, 'dispute')
  assert.equal((await send('charge.dispute.closed', 'won')).outcome, 'dispute-won')
  await runJobs(w.d)
  assert.equal((await w.d.repo.getLicenseRequestByPurchase(purchase.id))!.status, 'pending')
  assert.ok(w.f.mailer.sent.some((m) => m.to === 'eric@pymaticlabs.test' && /Otra vez: Licencia a firmar/.test(m.subject)))

  // Subida y despues devuelta: anulada, en la lista de anuladas con la clave que la firmo y su huella.
  await uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0400'))
  await runJobs(w.d)
  const charge = fakeCharge({ paymentIntent: pi, amount: purchase.amountTotal, refunded: purchase.amountTotal })
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', charge))
  await runJobs(w.d)
  assert.ok((await w.d.repo.getLicense('PML-LIC-2026-0400'))!.revokedAt)
  const list = await revocationList(w.d, {})
  assert.deepEqual(list.licencias.map((l) => [l.id, l.motivo, l.clave]), [['PML-LIC-2026-0400', 'refund', ERIC.publicKey]])
})

test('a mano: el mensual pide su licencia nueva (aunque la del pago unico siga sin firmar) y al subirla sale el correo del mensual', async () => {
  const w = world()
  const { session, purchase, request } = await buy(w)
  const companyId = purchase.companyId!
  const invoice = fakeInvoice({ customer: String(session.customer), amount: 19900, periodEnd: Math.floor(Date.parse('2027-04-02T10:00:00Z') / 1000), metadata: { product: 'plan-pro', company_id: companyId } })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', invoice))).outcome, 'renewal')
  await runJobs(w.d)
  const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!
  const renewalRequest = (await w.d.repo.getLicenseRequestByPurchase(renewal.id))!
  // La modalidad y el equipo, de la pedida del pago unico; el soporte, el del periodo cobrado y 15 dias de margen.
  assert.deepEqual([renewalRequest.kind, renewalRequest.modalidad, renewalRequest.equipo, renewalRequest.soporteHasta], ['renewal', 'hazlo-tu', true, '2027-04-17'])
  assert.equal(await w.d.repo.getJobByKey(`renewal_email:${renewal.id}`), null)
  assert.ok(w.f.mailer.sent.some((m) => /^Cobro del mensual: licencia a mano/.test(m.subject)))
  assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)

  await uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0500'))
  const text = sign(renewalRequest, 'PML-LIC-2026-0501')
  assert.equal((await uploadManualLicense(w.d, String(invoice.id), text)).kind, 'renewal')
  await runJobs(w.d)
  const monthly = w.f.mailer.sent.find((m) => m.to === purchase.email && m.tags?.includes('mensual'))
  assert.ok(monthly)
  assert.equal(unzip(monthly.attachments![0].content)[0].content.toString('utf-8'), text)
  assert.ok(w.f.mailer.sent.some((m) => m.to === purchase.email && m.tags?.includes('licencia')))
  const user = { id: (await w.d.repo.listMembers(companyId))[0].userId!, email: purchase.email }
  assert.deepEqual((await zoneOverview(w.d, user)).licenses.map((l) => l.id), ['PML-LIC-2026-0500', 'PML-LIC-2026-0501'])
})

test('configuracion: LICENSE_MODE a mano por defecto en vivo sin KMS; con KMS o en falso firma la web; la clave a mano, la del Mac', () => {
  const live = { DELIVERY_IP_SALT: 'una-sal-de-prueba-larga', STRIPE_SECRET_KEY: 'sk_live_x' }
  assert.equal(readConfig(live).licenseMode, 'manual')
  assert.equal(readConfig(live).manualKeyEnv, 'production')
  assert.equal(readConfig({ ...live, GCP_KMS_KEY_VERSION: 'projects/p/locations/l/keyRings/r/cryptoKeys/k/cryptoKeyVersions/1', GOOGLE_SERVICE_ACCOUNT_JSON: '{}' }).licenseMode, 'kms')
  assert.equal(readConfig({ ...live, LICENSE_MODE: 'kms' }).licenseMode, 'kms')
  assert.equal(readConfig({ DELIVERY_MODE: 'fake' }).licenseMode, 'kms')
  assert.equal(readConfig({ DELIVERY_MODE: 'fake', LICENSE_MODE: 'manual', LICENSE_MANUAL_PUBLIC_KEY: ERIC.publicKey }).manualKeyEnv, 'test')
  assert.equal(readConfig(live).licenseRequestEmail, 'info@pymaticlabs.com')
  assert.throws(() => readConfig({ ...live, LICENSE_MODE: 'eric' }), /LICENSE_MODE=eric/)
  assert.throws(() => readConfig({ ...live, LICENSE_MANUAL_PUBLIC_KEY: 'corta' }), /LICENSE_MANUAL_PUBLIC_KEY/)
})

test('a mano: una devolucion a la vez que la subida gana siempre: la licencia queda anulada y no le llega al cliente', async () => {
  const licenseMails = (w: ReturnType<typeof world>, email: string) => w.f.mailer.sent.filter((m) => m.to === email && (m.tags?.includes('licencia') || m.tags?.includes('mensual')))
  const refund = async (w: ReturnType<typeof world>, session: { payment_intent?: unknown }, amount: number) => {
    await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount, refunded: amount })))
    await runJobs(w.d)
  }

  // 1. La devolucion (y su revoke) pasa entre las comprobaciones de la subida y el guardado.
  {
    const w = world()
    const { session, purchase, request } = await buy(w)
    const getLicense = w.d.repo.getLicense.bind(w.d.repo)
    let fired = false
    w.d.repo.getLicense = async (id: string) => {
      if (!fired) {
        fired = true
        await refund(w, session, purchase.amountTotal)
      }
      return getLicense(id)
    }
    await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0601')), 409, /se cancelo \(refund\)/)
    await runJobs(w.d)
    const lic = (await w.d.repo.getLicenseByPurchase(purchase.id))!
    assert.deepEqual([lic.id, lic.revokedReason, (await w.d.repo.getLicenseRequestByPurchase(purchase.id))!.status], ['PML-LIC-2026-0601', 'refund', 'cancelled'])
    assert.equal(licenseMails(w, purchase.email).length, 0)
    // Subirla otra vez tampoco la entrega.
    await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0601')), 409, /esta anulada \(refund\)/)
    assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)
  }

  // 2. La devolucion llega justo despues de apuntarla como entregada: revoke la anula y el correo no sale.
  {
    const w = world()
    const { session, purchase, request } = await buy(w)
    const getPurchase = w.d.repo.getPurchase.bind(w.d.repo)
    let armed = false
    const update = w.d.repo.updateLicenseRequest.bind(w.d.repo)
    w.d.repo.updateLicenseRequest = async (...args: Parameters<typeof update>) => {
      const done = await update(...args)
      if (args[2].status === 'issued') armed = true
      return done
    }
    w.d.repo.getPurchase = async (id: string) => {
      if (armed) {
        armed = false
        await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
      }
      return getPurchase(id)
    }
    await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0602')), 409, /paso a refunded mientras se subia/)
    await runJobs(w.d)
    assert.equal((await w.d.repo.getLicenseByPurchase(purchase.id))!.revokedReason, 'refund')
    assert.equal(licenseMails(w, purchase.email).length, 0)
  }

  // 3. Otro trabajador corre revoke antes de que la compra se apunte como devuelta: ve la pedida aun
  //    pedida, la subida la entrega antes de que la cancele, y revoke anula la licencia igual.
  {
    const w = world()
    const { session, purchase, request } = await buy(w)
    const text = sign(request, 'PML-LIC-2026-0603')
    const update = w.d.repo.updateLicenseRequest.bind(w.d.repo)
    let upload: Promise<unknown> | null = null
    w.d.repo.updateLicenseRequest = async (...args: Parameters<typeof update>) => {
      if (args[2].status === 'cancelled' && !upload) {
        upload = uploadManualLicense(w.d, purchase.id, text)
        await upload
      }
      return update(...args)
    }
    await w.d.repo.enqueueJobs([{ key: `revoke:${purchase.id}:refund`, kind: 'revoke', payload: { purchaseId: purchase.id, reason: 'refund', final: true } }], new Date('2026-11-02T10:00:00Z'))
    await runJobs(w.d)
    // upload se asigna dentro de updateLicenseRequest: TypeScript lo da aqui por null.
    assert.equal(((await (upload as Promise<unknown> | null)) as { already: boolean }).already, false)
    await refund(w, session, purchase.amountTotal)
    const lic = (await w.d.repo.getLicenseByPurchase(purchase.id))!
    assert.deepEqual([lic.revokedReason, (await w.d.repo.getLicenseRequestByPurchase(purchase.id))!.status], ['refund', 'issued'])
    assert.equal(licenseMails(w, purchase.email).length, 0)
    assert.ok(!w.f.mailer.sent.some((m) => /^No firmar: /.test(m.subject)))
    assert.equal((await w.d.repo.listJobs({ status: 'dead' })).length, 0)
  }

  // 4. Un contracargo durante la subida: anulada con el; ganado, vuelve y le llega sin pedirla otra vez.
  {
    const w = world()
    const { session, purchase, request } = await buy(w)
    const pi = String(session.payment_intent)
    const dispute = (type: string, status: string) => handleStripeEvent(w.d, fakeEvent(type, fakeDispute({ paymentIntent: pi, amount: purchase.amountTotal, status, disputeId: 'dp_race' })))
    const getLicense = w.d.repo.getLicense.bind(w.d.repo)
    let fired = false
    w.d.repo.getLicense = async (id: string) => {
      if (!fired) {
        fired = true
        await dispute('charge.dispute.created', 'needs_response')
        await runJobs(w.d)
      }
      return getLicense(id)
    }
    await rejects(uploadManualLicense(w.d, purchase.id, sign(request, 'PML-LIC-2026-0604')), 409, /se cancelo \(dispute\)/)
    assert.equal((await w.d.repo.getLicenseByPurchase(purchase.id))!.revokedReason, 'dispute')
    await dispute('charge.dispute.closed', 'won')
    await runJobs(w.d)
    const lic = (await w.d.repo.getLicenseByPurchase(purchase.id))!
    const req = (await w.d.repo.getLicenseRequestByPurchase(purchase.id))!
    assert.deepEqual([lic.revokedAt, req.status, req.licenseId], [null, 'issued', 'PML-LIC-2026-0604'])
    assert.equal(licenseMails(w, purchase.email).length, 1)
    assert.ok(!w.f.mailer.sent.some((m) => /Otra vez: Licencia a firmar/.test(m.subject)))
  }
})

test('a mano: emitida tiene que ser la del pago (y lo dice como campos, no como firma); el numero 0000 no vale', async () => {
  const w = world()
  const { purchase, request } = await buy(w, 'hazlo-tu')
  // Hazlo tu: soporte_hasta es la fecha del pago. Con emitida de otro dia (el de la firma), la firma es
  // buena pero la licencia no vale: se dice asi, y que emitida no cuadra, no que la clave este mal.
  const bad = { id: 'PML-LIC-2026-0701', cliente: request.cliente, nif: request.nif, modalidad: request.modalidad, equipo: request.equipo, emitida: '2026-11-03', soporte_hasta: request.soporteHasta }
  const signedBad = serializeLicense({ formato: 1, licencia: bad, firma: edSign(null, canonical(bad), privateKeyFromSeed(ERIC.seed)).toString('base64') })
  await rejects(
    uploadManualLicense(w.d, purchase.id, signedBad),
    400,
    /^la firma es buena, pero los campos no valen: soporte_hasta es anterior a emitida; no cuadra con la compra: emitida "2026-11-03" \(la compra: "2026-11-02"\)$/
  )
  const team = await buy(w)
  await rejects(uploadManualLicense(w.d, team.purchase.id, sign(team.request, 'PML-LIC-2026-0702', { emitida: '2026-11-03' })), 409, /emitida "2026-11-03" \(la compra: "2026-11-02"\)/)
  await rejects(uploadManualLicense(w.d, team.purchase.id, sign(team.request, 'PML-LIC-2026-0000')), 400, /los numeros del Mac son del 0001 al 5000/)
  assert.equal(await w.d.repo.getLicenseByPurchase(team.purchase.id), null)
})
