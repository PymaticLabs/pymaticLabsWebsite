import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { GcpKmsSigner } from './delivery/adapters/gcp-kms-signer.ts'
import { HoldedInvoicer } from './delivery/adapters/holded-invoicer.ts'
import { BrevoMailer, brevoAttachments } from './delivery/adapters/brevo-mailer.ts'
import { CalcomCalendar } from './delivery/adapters/calcom-calendar.ts'
import { StripePayments } from './delivery/adapters/stripe-payments.ts'
import { cifWithControl, parseSpanishTaxId } from './delivery/checkout-nif.ts'
import { checkPaidTax, decideTax, declaredTax, territoryOf } from './delivery/tax.ts'
import {
  SALE_COUNTRIES,
  STRIPE_METADATA_VALUE_MAX,
  isEuCountry,
  isSaleCountry,
  parseEuVatId,
  parseOtherTaxId,
  readTaxInput,
  taxMetadata,
  territoryOfPostalCode,
  treatmentFor,
  vatPrefix,
  viesText,
  type CheckoutTax,
} from './delivery/checkout-tax.ts'
import { LAUNCH_BUSY_ALERT_AFTER, clientRef } from './delivery/launch.ts'
import { clientIpBucket, ipBucket, wideIpBucket } from './delivery/limits.ts'
import { PYMATICLABS_VAT_ID, readViesResponse, viesRequester } from './delivery/vies.ts'
import { ViesChecker } from './delivery/adapters/vies-checker.ts'
import { SupabaseStorage } from './delivery/adapters/supabase-storage.ts'
import { SupabaseRepository } from './delivery/adapters/supabase-repository.ts'
import { FakeCalendar } from './delivery/adapters/fakes.ts'
import { issueLicense } from './delivery/license-issue.ts'
import { devToolsEnabled, readConfig } from './delivery/config.ts'
import { crc32c, madridTimeToUtc, normalizeTaxId, cleanCompanyName, formatMoney } from './delivery/util.ts'
import { lookupKey, planProductName, priceCents, priceFromLookupKey, productFromLookupKey, productName } from './delivery/products.ts'
import { currentSecuritySupport, securitySupportUntil } from './delivery/versions.ts'
import { ANNUAL_PAID_MONTHS, formatPrice, modalities, plans } from './offer.ts'
import { unzip, zip } from './delivery/zip.ts'
import { createFakeDelivery } from './delivery/container.ts'
import { CheckoutError, cancelCheckout, cancelReturnPath, companyTax, createCheckout, firstSessionSlots, oneTimeSessionParams, planSessionParams, trialEndFor } from './checkout.ts'
import { PermanentError, RetryableError, SlotUnavailableError, type Company, type Purchase } from './delivery/types.ts'
import { canonical, signLicense, verifyLicense, rawPublicKey, type LicenseData } from './license.ts'

// Los adaptadores de verdad, contra un fetch de mentira: lo que mandan a cada API y como leen sus
// respuestas y sus errores. Y los parametros de Stripe Checkout.

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}

function mockFetch(handler: (call: Call) => { status?: number; json?: unknown; body?: BodyInit; headers?: Record<string, string> }) {
  const calls: Call[] = []
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input),
      method: init.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init.body === 'string' ? init.body : init.body ? '[binario]' : null,
    }
    calls.push(call)
    const res = handler(call)
    const body = res.body ?? (res.json === undefined ? null : JSON.stringify(res.json))
    return new Response(body, { status: res.status ?? 200, headers: res.headers })
  }) as typeof fetch
  return calls
}

const company: Company = {
  id: 'c1',
  name: 'Carpintería Muñoz SL',
  taxId: 'B12345678',
  taxIdType: 'es_cif',
  country: 'ES',
  address: { line1: 'Calle Mayor 1', line2: null, city: 'Castellón', postal_code: '12001', state: 'CS', country: 'ES' },
  email: 'compras@munoz.test',
  locale: 'es',
  currency: 'eur',
  stripeCustomerId: 'cus_1',
  holdedContactId: null,
  seats: 1,
  subscriptionId: null,
  subscriptionStatus: null,
  subscriptionPlan: null,
  subscriptionEventAt: null,
  accessRevokedAt: null,
  createdAt: '2026-11-02T10:00:00Z',
}

test('CRC32C: el vector de referencia de Castagnoli', () => {
  assert.equal(crc32c(Buffer.from('123456789')), 0xe3069283)
})

test('zip: la licencia sale tal cual del .zip', () => {
  const content = Buffer.from('{"formato": 1, "cliente": "Muñoz"}\n', 'utf-8')
  const [entry] = unzip(zip([{ name: 'licencia-munoz.cerebro-licencia', content }]))
  assert.equal(entry.name, 'licencia-munoz.cerebro-licencia')
  assert.deepEqual(entry.content, content)
})

test('NIF y razon social limpios, como los acepta firmar_licencia.py', () => {
  assert.equal(normalizeTaxId(' es b-12.345.678 '), 'ESB-12345678')
  assert.equal(normalizeTaxId('B1234​5678'), 'B12345678')
  assert.equal(normalizeTaxId('B12/345'), null)
  assert.equal(cleanCompanyName('  Carpintería​  Muñoz\n SL '), 'Carpintería Muñoz SL')
  assert.equal(cleanCompanyName('x'), null)
})

test('hora de Madrid a UTC, en invierno y en verano', () => {
  assert.equal(madridTimeToUtc('2026-11-02', 18).toISOString(), '2026-11-02T17:00:00.000Z')
  assert.equal(madridTimeToUtc('2026-07-01', 18).toISOString(), '2026-07-01T16:00:00.000Z')
})

test('licencia con el pago dentro: solo si licencia.py lo acepta; sin el, el fichero de siempre', () => {
  const { privateKey } = generateKeyPairSync('ed25519')
  const der = privateKey.export({ format: 'der', type: 'pkcs8' })
  const seed = der.subarray(der.length - 32).toString('base64')
  const publicKey = rawPublicKey(privateKey)
  const base: LicenseData = { id: 'PML-LIC-2026-0010', cliente: 'Empresa SL', nif: 'B12345678', modalidad: 'hazlo-tu', equipo: false, emitida: '2026-11-02', soporte_hasta: '2026-11-02' }
  const withPayment = signLicense({ ...base, pago: 'pi_3Q2abc' }, seed, publicKey)
  assert.match(withPayment.text, /"soporte_hasta": "2026-11-02",\n    "pago": "pi_3Q2abc"\n/)
  assert.equal(verifyLicense(withPayment.text, publicKey, { allowPayment: true }).pago, 'pi_3Q2abc')
  // El licencia.py de hoy la rechazaria: campos de mas.
  assert.throws(() => verifyLicense(withPayment.text, publicKey), /campos/)
  const without = signLicense(base, seed, publicKey)
  assert.doesNotMatch(without.text, /pago/)
  assert.equal(canonical(base).toString('utf-8').includes('pago'), false)
})

test('Google Cloud KMS: firma Ed25519 pura con CRC32C, y la licencia verifica con su publica', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const keyVersion = 'projects/p/locations/europe-west1/keyRings/licencias/cryptoKeys/web/cryptoKeyVersions/1'
  const pem = publicKey.export({ format: 'pem', type: 'spki' }).toString()
  const calls = mockFetch((call) => {
    if (call.url === 'https://oauth2.googleapis.com/token') return { json: { access_token: 'ya29.token', expires_in: 3600 } }
    if (call.url.endsWith('/publicKey')) return { json: { pem, algorithm: 'EC_SIGN_ED25519', pemCrc32c: String(crc32c(Buffer.from(pem))), name: keyVersion } }
    if (call.url.endsWith(':asymmetricSign')) {
      const body = JSON.parse(call.body!)
      const data = Buffer.from(body.data, 'base64')
      assert.equal(Number(body.dataCrc32c), crc32c(data))
      const signature = edSign(null, data, privateKey)
      return { json: { signature: signature.toString('base64'), signatureCrc32c: String(crc32c(signature)), verifiedDataCrc32c: true, name: keyVersion } }
    }
    return { status: 404, json: {} }
  })
  const signer = new GcpKmsSigner({
    GCP_KMS_KEY_VERSION: keyVersion,
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: 'firma@p.iam.gserviceaccount.com', private_key: rsa.privateKey.export({ format: 'pem', type: 'pkcs8' }) }),
  })
  const expected = rawPublicKey(publicKey)
  assert.equal(await signer.publicKey(), expected)
  const license = await issueLicense(
    { id: 'PML-LIC-2026-0001', cliente: 'Empresa SL', nif: 'B12345678', modalidad: 'acompanado', equipo: true, emitida: '2026-11-02', soporte_hasta: '2027-02-02' },
    signer,
    { expectedPublicKey: expected }
  )
  assert.equal(verifyLicense(license.text, expected).id, 'PML-LIC-2026-0001')
  const sign = calls.find((c) => c.url.endsWith(':asymmetricSign'))!
  assert.equal(sign.headers.authorization, 'Bearer ya29.token')
  assert.equal(calls.filter((c) => c.url.includes('oauth2')).length, 1) // el token se reutiliza

  // Si KMS no confirma el CRC32C, no se usa la firma.
  mockFetch((call) => (call.url.endsWith(':asymmetricSign') ? { json: { signature: 'AA==', verifiedDataCrc32c: false } } : { json: { access_token: 't', expires_in: 3600 } }))
  await assert.rejects(signer.sign(Buffer.from('x')), RetryableError)
})

test('Holded: contacto por NIF (o nuevo), factura con el impuesto, aprobar, enviar y PDF', async () => {
  const calls = mockFetch((call) => {
    if (call.url.includes('/contacts?')) return { json: { items: [] } }
    if (call.url.endsWith('/contacts')) return { status: 201, json: { id: 'ct1' } }
    if (call.url.endsWith('/invoices') && call.method === 'POST') return { status: 201, json: { id: 'inv1' } }
    if (call.url.endsWith('/invoices/inv1/approve')) return { status: 200 }
    if (call.url.endsWith('/invoices/inv1') && call.method === 'GET') return { json: { id: 'inv1', document_number: 'F260001', draft: false, approved_at: '2026-11-02T10:00:00' } }
    if (call.url.endsWith('/invoices/inv1/send')) return { json: { status: 'sent' } }
    if (call.url.endsWith('/invoices/inv1/pdf')) return { body: '%PDF-1.4 prueba', headers: { 'Content-Type': 'application/pdf' } }
    return { status: 404, json: { detail: 'no' } }
  })
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk_test', HOLDED_INVOICE_SERIES_ID: 'serie-web' })
  assert.equal(await holded.ensureContact(company), 'ct1')
  assert.match(calls[0].url, /contacts\?code=B12345678/)
  assert.equal(calls[0].headers.authorization, 'Bearer hk_test')
  const created = JSON.parse(calls[1].body!)
  assert.equal(created.code, 'B12345678')
  assert.equal(created.bill_address.country_code, 'ES')

  const doc = await holded.createDocument('invoice', {
    contactId: 'ct1',
    reference: 'Cerebro Digital · Solista · pi_1',
    date: '2026-11-02',
    currency: 'eur',
    language: 'es',
    taxTreatment: 'standard',
    taxRate: 21,
    lines: [{ name: 'Cerebro Digital · Solista', description: null, units: 1, price: 990 }],
    body: null,
    notes: 'Stripe pi_1',
  })
  assert.deepEqual(doc, { id: 'inv1', number: null, approved: false })
  const invoiceBody = JSON.parse(calls.find((c) => c.url.endsWith('/invoices'))!.body!)
  assert.deepEqual(invoiceBody.items[0].taxes, ['s_iva_21'])
  assert.equal(invoiceBody.currency, 'EUR')
  assert.equal(invoiceBody.number_line_id, 'serie-web')
  assert.equal((await holded.approveDocument('invoice', 'inv1')).number, 'F260001')
  await holded.sendDocument('invoice', 'inv1', 'compras@munoz.test', 'es')
  assert.deepEqual(JSON.parse(calls.find((c) => c.url.endsWith('/send'))!.body!).emails, ['compras@munoz.test'])
  assert.equal((await holded.getPdf('invoice', 'inv1')).subarray(0, 4).toString(), '%PDF')

  // Sin el impuesto de la inversion del sujeto pasivo configurado, no factura (error permanente).
  await assert.rejects(holded.createDocument('invoice', { contactId: 'ct1', reference: 'r', date: '2026-11-02', currency: 'eur', language: 'en', taxTreatment: 'reverse_charge', taxRate: 0, lines: [], body: null, notes: null }), PermanentError)
})

test('Holded: una factura encontrada en un reintento se lee entera (el listado no dice si esta aprobada), con su total y su IVA', async () => {
  const calls = mockFetch((call) => {
    if (call.url.includes('/invoices?')) return { json: { items: [{ id: 'inv9', description: 'Cerebro Digital · Solista · pi_9' }] } }
    if (call.url.endsWith('/invoices/inv9')) return { json: { id: 'inv9', document_number: 'F260009', draft: false, approved_at: '2026-11-02T10:00:00', total: '1197.90', tax: 207.9 } }
    return { status: 404, json: { detail: 'no' } }
  })
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk' })
  const found = await holded.findDocument('invoice', 'ct1', 'pi_9')
  assert.deepEqual(found, { id: 'inv9', number: 'F260009', approved: true, total: 1197.9, tax: 207.9 })
  assert.ok(calls.some((c) => c.url.endsWith('/invoices/inv9')))
})

test('Holded: los importes con coma decimal, como los da la v2 de verdad ("1210,00", "1.210,00")', async () => {
  mockFetch((call) => {
    if (call.url.endsWith('/invoices/a')) return { json: { id: 'a', document_number: null, draft: true, approved_at: null, total: '1210,00', tax: '210,00' } }
    if (call.url.endsWith('/invoices/b')) return { json: { id: 'b', document_number: 'F260010', draft: false, approved_at: '2026-11-02T10:00:00', total: '12.100,50', tax: '2.100,50' } }
    return { status: 404, json: { detail: 'no' } }
  })
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk' })
  assert.deepEqual(await holded.getDocument('invoice', 'a'), { id: 'a', number: null, approved: false, total: 1210, tax: 210 })
  assert.deepEqual(await holded.getDocument('invoice', 'b'), { id: 'b', number: 'F260010', approved: true, total: 12100.5, tax: 2100.5 })
})

test('Holded: 429 se reintenta respetando Retry-After; 401 para la cola', async () => {
  mockFetch(() => ({ status: 429, json: { detail: 'You have reached the per-minute limit' }, headers: { 'Retry-After': '60' } }))
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk' })
  const error = await holded.ensureContact(company).catch((e) => e)
  assert.ok(error instanceof RetryableError)
  assert.equal(error.retryAfterMs, 60_000)
  mockFetch(() => ({ status: 401, json: { title: 'Unauthorized' } }))
  await assert.rejects(holded.ensureContact(company), PermanentError)
})

test('Brevo: la licencia viaja en .zip, con IdempotencyKey', async () => {
  const calls = mockFetch(() => ({ status: 201, json: { messageId: '<m1@brevo>' } }))
  const mailer = new BrevoMailer({ BREVO_API_KEY: 'xkeysib-test' }, { email: 'info@pymaticlabs.com', name: 'Pymatic Labs' }, 'info@pymaticlabs.com')
  const result = await mailer.send({
    to: 'a@b.test',
    subject: 'Hola',
    html: '<p>Hola</p>',
    text: 'Hola',
    idempotencyKey: 'welcome:1',
    attachments: [
      { name: 'licencia-x.cerebro-licencia', content: Buffer.from('{}'), contentType: 'application/json' },
      { name: 'condiciones.html', content: Buffer.from('<p>c</p>'), contentType: 'text/html' },
    ],
  })
  assert.equal(result.id, '<m1@brevo>')
  assert.equal(calls[0].headers['api-key'], 'xkeysib-test')
  const body = JSON.parse(calls[0].body!)
  assert.deepEqual(body.headers, { IdempotencyKey: 'welcome:1' })
  assert.deepEqual(body.attachment.map((a: { name: string }) => a.name), ['licencia-x.zip', 'condiciones.html'])
  assert.equal(unzip(Buffer.from(body.attachment[0].content, 'base64'))[0].name, 'licencia-x.cerebro-licencia')
  assert.deepEqual(brevoAttachments([{ name: 'f.pdf', content: Buffer.from('x'), contentType: 'application/pdf' }])[0].name, 'f.pdf')
})

test('Cal.com: huecos de cada persona, apartar, y hueco ocupado al reservar', async () => {
  const calls = mockFetch((call) => {
    if (call.url.includes('/slots?') && call.url.includes('eventTypeId=11')) return { json: { status: 'success', data: { '2026-11-03': [{ start: '2026-11-03T18:00:00.000+01:00' }] } } }
    if (call.url.includes('/slots?')) return { json: { status: 'success', data: {} } }
    if (call.url.endsWith('/slots/reservations')) return { status: 201, json: { status: 'success', data: { reservationUid: 'res-1' } } }
    if (call.url.endsWith('/slots/reservations/res-1')) return { status: 200, json: {} }
    if (call.url.endsWith('/bookings')) return { status: 400, json: { message: 'User either already has booking at this time or is not available' } }
    return { status: 404, json: {} }
  })
  const cal = new CalcomCalendar({ CALCOM_API_KEY: 'cal_test', CALCOM_EVENT_TYPES: '{"eric": 11, "sergio": 22}' })
  const slots = await cal.availability('2026-11-03T00:00:00Z', '2026-11-04T00:00:00Z')
  assert.deepEqual(slots, [{ host: 'eric', start: '2026-11-03T17:00:00.000Z' }])
  assert.equal(calls[0].headers['cal-api-version'], '2024-09-04')
  assert.equal(await cal.reserve(slots[0], 35), 'res-1')
  assert.equal(JSON.parse(calls.find((c) => c.url.endsWith('/slots/reservations'))!.body!).reservationDuration, 35)
  await assert.rejects(
    cal.book({ slot: slots[0], attendee: { name: 'Empresa', email: 'a@b.test', locale: 'es' }, reservationId: 'res-1', metadata: {} }),
    SlotUnavailableError
  )
  // Antes de reservar suelta lo apartado (si no, se bloquearia a si mismo).
  const order = calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)
  assert.ok(order.indexOf('DELETE /v2/slots/reservations/res-1') < order.indexOf('POST /v2/bookings'))
  assert.equal(calls.find((c) => c.url.endsWith('/bookings'))!.headers['cal-api-version'], '2024-08-13')
})

test('Cal.com: cancelar una reserva; una que ya acabo, ya cancelada o que no existe no es un error', async () => {
  const calError = (status: number, message: string) => ({ status, json: { status: 'error', error: { code: status === 404 ? 'NotFoundException' : 'BadRequestException', message } } })
  const calls = mockFetch((call) => {
    if (call.url.endsWith('/bookings/bk-futura/cancel')) return { json: { status: 'success', data: { uid: 'bk-futura', status: 'cancelled' } } }
    if (call.url.endsWith('/bookings/bk-pasada/cancel')) return calError(400, 'Cannot cancel a booking that has already ended')
    if (call.url.endsWith('/bookings/bk-cancelada/cancel')) return calError(400, 'This booking has already been cancelled.')
    if (call.url.endsWith('/bookings/bk-rara/cancel')) return calError(400, 'cancellationReason must be a string')
    return calError(404, 'Booking with uid=bk-borrada was not found in the database')
  })
  const cal = new CalcomCalendar({ CALCOM_API_KEY: 'cal_test', CALCOM_EVENT_TYPES: '{"eric": 11, "sergio": 22}' })
  assert.equal(await cal.cancel('bk-futura', 'Compra devuelta'), 'cancelled')
  assert.equal(calls[0].method, 'POST')
  assert.equal(calls[0].headers['cal-api-version'], '2024-08-13')
  assert.equal(calls[0].headers.authorization, 'Bearer cal_test')
  assert.deepEqual(JSON.parse(calls[0].body!), { cancellationReason: 'Compra devuelta' })
  assert.equal(await cal.cancel('bk-pasada', 'Compra devuelta'), 'ended')
  assert.equal(await cal.cancel('bk-cancelada', 'Compra devuelta'), 'gone')
  assert.equal(await cal.cancel('bk-borrada', 'Compra devuelta'), 'gone')
  // Otro 400 si es un error (permanente: el paso se para y avisa).
  await assert.rejects(cal.cancel('bk-rara', 'Compra devuelta'), PermanentError)
})

test('Supabase Storage: subir, enlace firmado que caduca y leer lo que no esta', async () => {
  const calls = mockFetch((call) => {
    if (call.url.includes('/object/sign/')) return { json: { signedURL: '/object/sign/releases/versiones/1.2.0/a%20b.mcpb?token=abc' } }
    if (call.url.includes('/object/authenticated/')) return { status: 400, json: { statusCode: '404', error: 'not_found' } }
    return { status: 200, json: { Key: 'x' } }
  })
  const storage = new SupabaseStorage({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })
  await storage.put('releases', 'versiones/1.2.0/a b.mcpb', Buffer.from('x'), 'application/octet-stream')
  assert.equal(calls[0].url, 'https://abc.supabase.co/storage/v1/object/releases/versiones/1.2.0/a%20b.mcpb')
  assert.equal(calls[0].headers['x-upsert'], 'true')
  const url = await storage.signedUrl('releases', 'versiones/1.2.0/a b.mcpb', 300, 'a b.mcpb')
  assert.equal(url, 'https://abc.supabase.co/storage/v1/object/sign/releases/versiones/1.2.0/a%20b.mcpb?token=abc&download=a+b.mcpb')
  assert.equal(JSON.parse(calls[1].body!).expiresIn, 300)
  assert.equal(await storage.get('customer-files', 'no/esta.pdf'), null)
})

test('Supabase: un id de una URL que no es uuid (ni numero, en la cola) no existe, sin preguntar a Postgres (daria 22P02 y un 500)', async () => {
  const ID = '3f2b1c9e-8a4d-4e6f-9b0a-1c2d3e4f5a6b'
  const calls = mockFetch((call) => {
    if (call.url.includes(`id=eq.${ID}`)) return { json: [{ id: ID, status: 'paid' }] }
    if (call.url.includes('id=eq.7')) return { json: [] }
    return { status: 400, json: { code: '22P02', message: 'invalid input syntax for type uuid', details: null, hint: null } }
  })
  const repo = new SupabaseRepository({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })
  const now = new Date('2026-11-02T10:00:00Z')
  assert.equal(await repo.getPurchase('no-es-un-uuid'), null)
  assert.equal(await repo.getPurchase(`${ID}x`), null)
  assert.equal(await repo.getInvoice('123'), null)
  assert.equal(await repo.getVersionFile('../otra'), null)
  assert.equal(await repo.getCompany('c1'), null)
  assert.equal(await repo.retryJob('abc', now), false)
  assert.equal(await repo.retryJob('1.5', now), false)
  assert.equal(await repo.retryJob('', now), false)
  await repo.completeJob('x', null, now)
  await repo.failJob('x', 'fallo', { dead: true }, now)
  await repo.markJobAlerted('x', now)
  assert.equal(calls.length, 0)
  // Los bien formados si van a la base de datos.
  assert.deepEqual(await repo.getPurchase(ID), { id: ID, status: 'paid' })
  assert.equal(await repo.retryJob('7', now), false)
  assert.deepEqual(
    calls.map((c) => `${c.method} ${new URL(c.url).pathname}`),
    ['GET /rest/v1/purchases', 'PATCH /rest/v1/jobs']
  )
})

test('configuracion: en falso nunca en produccion; los adaptadores salen del modo', () => {
  const SALT = { DELIVERY_IP_SALT: 'a'.repeat(64) }
  assert.throws(() => readConfig({ DELIVERY_MODE: 'fake', VERCEL_ENV: 'production' }), /produccion/)
  const live = readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_live_x' })
  assert.equal(live.mode, 'live')
  assert.equal(live.invoiceMode, 'draft')
  assert.equal(live.creditNoteMode, 'draft')
  assert.equal(live.adapters.signer, 'gcp-kms')
  assert.equal(live.adapters.mailer, 'brevo')
  assert.equal(live.licenseKeyEnv, 'production')
  assert.equal(live.stripeLive, true)
  assert.equal(readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_test_x' }).stripeLive, false)
  const fake = readConfig({ DELIVERY_MODE: 'fake', DELIVERY_INVOICER: 'holded' })
  assert.equal(fake.adapters.invoicer, 'holded')
  assert.equal(fake.adapters.repository, 'memory')
  assert.equal(fake.licenseKeyEnv, 'test')
  assert.throws(() => readConfig({ ...SALT, DELIVERY_SIGNER: 'aws' }), /DELIVERY_SIGNER/)
})

test('configuracion: la clave de KMS nunca con pagos de mentira; las rutas de prueba, solo con todo en falso; la sal, obligatoria', () => {
  const SALT = { DELIVERY_IP_SALT: 'a'.repeat(64) }
  // /api/dev/checkout firmaria licencias de verdad gratis.
  assert.throws(() => readConfig({ DELIVERY_MODE: 'fake', DELIVERY_SIGNER: 'gcp-kms' }), /gcp-kms/)
  assert.throws(() => readConfig({ ...SALT, DELIVERY_PAYMENTS: 'fake' }), /gcp-kms/)
  assert.throws(() => readConfig({ DELIVERY_MODE: 'fake', LICENSE_KEY_ENV: 'production' }), /LICENSE_KEY_ENV/)
  assert.equal(devToolsEnabled(readConfig({ DELIVERY_MODE: 'fake' })), true)
  assert.equal(devToolsEnabled(readConfig({ DELIVERY_MODE: 'fake', DELIVERY_MAILER: 'brevo' })), false)
  assert.equal(devToolsEnabled(readConfig({ ...SALT })), false)
  // Sin sal (o con una corta) no se monta en vivo: las huellas de IP no serian huellas.
  assert.throws(() => readConfig({}), /DELIVERY_IP_SALT/)
  assert.throws(() => readConfig({ DELIVERY_IP_SALT: 'corta' }), /DELIVERY_IP_SALT/)
  // Una clave de KMS solo de pruebas, para Preview con Stripe de prueba.
  assert.equal(readConfig({ ...SALT, LICENSE_KEY_ENV: 'test' }).licenseKeyEnv, 'test')
})

test('NIF espanol: formato y letra o digito de control de sociedad, persona y NIE, sin servicios externos', () => {
  // Sociedades: el control en cifra (A, B, E, H), en letra (N, P, Q, R, S, W) o en las dos (las demas).
  assert.deepEqual(parseSpanishTaxId('A82018474'), { taxId: 'A82018474', kind: 'cif' })
  assert.deepEqual(parseSpanishTaxId(' b-12.345.674 '), { taxId: 'B12345674', kind: 'cif' })
  assert.deepEqual(parseSpanishTaxId('Q2826000H'), { taxId: 'Q2826000H', kind: 'cif' })
  assert.equal(parseSpanishTaxId('Q28260008'), null) // Q lleva letra
  assert.equal(parseSpanishTaxId('B1234567D'), null) // B lleva cifra
  assert.deepEqual(parseSpanishTaxId('G1234567D'), { taxId: 'G1234567D', kind: 'cif' })
  assert.deepEqual(parseSpanishTaxId('G12345674'), { taxId: 'G12345674', kind: 'cif' })
  assert.equal(parseSpanishTaxId('B12345678'), null) // el digito de control no es el suyo
  assert.equal(parseSpanishTaxId('I12345674'), null) // I no es letra de sociedad
  // Personas (DNI) y NIE.
  assert.deepEqual(parseSpanishTaxId('12345678z'), { taxId: '12345678Z', kind: 'dni' })
  assert.equal(parseSpanishTaxId('12345678A'), null)
  assert.deepEqual(parseSpanishTaxId('X1234567L'), { taxId: 'X1234567L', kind: 'nie' })
  assert.deepEqual(parseSpanishTaxId('Y-1234567-X'), { taxId: 'Y1234567X', kind: 'nie' })
  assert.equal(parseSpanishTaxId('X1234567A'), null)
  // Con el prefijo ES del NIF-IVA espanol vale (sin el); un NIF-IVA de otro pais o un EIN, no.
  assert.deepEqual(parseSpanishTaxId('ESB12345674'), { taxId: 'B12345674', kind: 'cif' })
  assert.deepEqual(parseSpanishTaxId('ES 12345678Z'), { taxId: '12345678Z', kind: 'dni' })
  for (const other of ['DE123456789', 'FR12345678901', '12-3456789', 'B1234567', '', null, undefined]) assert.equal(parseSpanishTaxId(other), null, String(other))
  // Los de las pruebas y la muestra, con su control.
  assert.equal(cifWithControl('B1234567'), 'B12345674')
  assert.equal(cifWithControl('Q2826000'), 'Q2826000H')
  for (let n = 0; n < 200; n++) assert.ok(parseSpanishTaxId(cifWithControl(`B${String(1000000 + n * 37)}`)))
})

test('el territorio de una direccion de Espana: por el codigo postal y, si dicen Canarias, Ceuta o Melilla, por la provincia o la ciudad', () => {
  const at = (postalCode: string | null, state: string | null, city: string | null = null) => territoryOf({ postalCode, state, city })
  assert.equal(at('12001', 'CS', 'Castellón de la Plana'), 'peninsula')
  assert.equal(at('07001', 'PM', 'Palma'), 'peninsula') // Baleares, con el IVA peninsular
  for (const [postalCode, territory] of [['35001', 'canarias'], ['38001', 'canarias'], ['51001', 'ceuta'], ['52001', 'melilla']]) assert.equal(at(postalCode, null), territory, postalCode)
  // Con un codigo de la peninsula y la provincia o la ciudad de fuera, lo de fuera (se mira a mano si no cuadra).
  assert.equal(at('28001', 'ES-TF'), 'canarias')
  assert.equal(at('28001', null, 'Las Palmas de Gran Canaria'), 'canarias')
  assert.equal(at('28001', 'Melilla'), 'melilla')
  // Sin un codigo postal de Espana no se sabe.
  assert.equal(at('1234', null, 'Las Palmas de Gran Canaria'), null)
  assert.equal(territoryOf(null), null)
})

test('al facturar: el 21 %, la inversion del sujeto pasivo con NIF-IVA, sin IVA fuera de la UE y en Canarias; lo que no cuadra, a mano', () => {
  const purchase = { amountSubtotal: 99000, amountDiscount: 0, amountTax: 20790, currency: 'eur', taxTreatment: 'standard', taxRate: 21 } as Purchase
  const details = { reasons: [], amountTax: null, taxIds: [] }
  assert.deepEqual(decideTax(purchase, company, details), { treatment: 'standard', rate: 21, hold: null, vatPending: false })
  const ten = decideTax({ ...purchase, amountTax: 9900 }, company, details)
  assert.deepEqual([ten.treatment, ten.hold?.mode], ['standard', 'manual'])
  assert.match(ten.hold!.reason, /IVA del 10 %: solo se factura sola con el 21 %/)
  // Sin IVA: cada caso, sola (en borrador mientras HOLDED_INVOICE_MODE=draft).
  const zero = { ...purchase, amountTax: 0, taxRate: 0 }
  const de = { ...company, country: 'DE', taxId: 'DE123456789', taxIdType: 'eu_vat', address: { ...company.address!, postal_code: '10115', country: 'DE' } }
  assert.deepEqual(decideTax({ ...zero, taxTreatment: 'reverse_charge' }, de, details), { treatment: 'reverse_charge', rate: 0, hold: null, vatPending: false })
  const greek = { ...de, country: 'GR', taxId: 'EL123456789' }
  assert.equal(decideTax({ ...zero, taxTreatment: 'reverse_charge' }, greek, details).treatment, 'reverse_charge')
  assert.deepEqual(decideTax({ ...zero, taxTreatment: 'export' }, { ...company, country: 'US', taxId: 'US12-3456789', taxIdType: 'other' }, details), { treatment: 'export', rate: 0, hold: null, vatPending: false })
  const canarias = { ...company, address: { ...company.address!, postal_code: '35001', city: 'Las Palmas de Gran Canaria', state: 'GC' } }
  assert.deepEqual(decideTax({ ...zero, taxTreatment: 'export' }, canarias, details), { treatment: 'export', rate: 0, hold: null, vatPending: false })
  // A la UE sin NIF-IVA comprobado y sin IVA: le tocaba el 21 %.
  const noVat = decideTax({ ...zero, taxTreatment: 'standard' }, { ...de, taxId: 'DE1234567890', taxIdType: 'other' }, details)
  assert.deepEqual([noVat.treatment, noVat.hold?.mode], ['standard', 'manual'])
  assert.match(noVat.hold!.reason, /venta a DE sin IVA y sin NIF-IVA comprobado en VIES: le tocaba el 21 %/)
  // En la peninsula sin IVA, o sin codigo postal que diga el territorio: a mano.
  assert.match(decideTax({ ...zero, taxTreatment: 'standard' }, company, details).hold!.reason, /peninsular o Baleares sin IVA/)
  assert.match(decideTax({ ...zero, taxTreatment: 'export' }, { ...company, address: null }, details).hold!.reason, /sin código postal/)
  // El 21 % cobrado a quien no le tocaba (Canarias, fuera de la UE, NIF-IVA): a mano, para devolver el IVA.
  for (const c of [canarias, { ...company, country: 'US', taxIdType: 'other' }, de]) {
    const charged = decideTax(purchase, c, details)
    assert.deepEqual([charged.treatment, charged.hold?.mode], ['standard', 'manual'], c.country ?? '')
    assert.match(charged.hold!.reason, /se cobró el 21 % a una venta sin IVA español/)
  }
  assert.equal(decideTax({ ...purchase, currency: 'usd' }, company, details).hold?.mode, 'manual')
  assert.equal(decideTax(purchase, company, { ...details, amountTax: 100 }).hold?.mode, 'manual')
})

/** Lo que decide readTaxInput para una empresa de Espana peninsular, con el 21 %. */
const SPAIN_TAX: CheckoutTax = { country: 'ES', territory: 'peninsula', taxId: 'B12345674', taxIdType: 'es_cif', treatment: 'standard', vies: null }

test('Checkout de pago unico: el NIF espanol de la web, el 21 % fijo (sin Stripe Tax ni NIF de Stripe), direccion, condiciones, cupon y metadatos', () => {
  const params = oneTimeSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'acompanado',
    priceId: 'price_1',
    taxRateId: 'txr_21',
    tax: SPAIN_TAX,
    locale: 'en',
    expiresAt: 1_800_000_000,
    terms: { version: '2026-10-09', sha256: 'f'.repeat(64) },
    launchRef: 'ref-1',
    slot: { host: 'sergio', start: '2026-11-03T17:00:00.000Z' },
    reservationId: 'res-1',
  }) as Record<string, any>
  assert.equal(params.mode, 'payment')
  // Ni Stripe Tax ni el NIF de Stripe (solo mira la forma del NIF-IVA): el 21 % en la linea, en euros.
  assert.equal(params.tax_id_collection, undefined)
  assert.equal(params.automatic_tax, undefined)
  assert.deepEqual(params.line_items, [{ price: 'price_1', quantity: 1, tax_rates: ['txr_21'] }])
  assert.equal(params.currency, 'eur')
  assert.equal(params.billing_address_collection, 'required')
  assert.deepEqual(params.consent_collection, { terms_of_service: 'required' })
  assert.deepEqual(params.name_collection, { business: { enabled: true, optional: false } })
  assert.equal(params.customer_creation, 'always')
  assert.equal(params.locale, 'en')
  assert.deepEqual(params.discounts, [{ coupon: 'cerebro-lanzamiento-acompanado' }])
  assert.match(params.custom_text.terms_of_service_acceptance.message, /\(https:\/\/pymaticlabs\.com\/en\/condiciones\)/)
  // Ya no dice que es solo para empresas de Espana: que compra una empresa, para su actividad.
  assert.match(params.custom_text.terms_of_service_acceptance.message, /as a business or professional, for my business, not as a consumer\.$/)
  assert.doesNotMatch(JSON.stringify(params.custom_text), /established in Spain|con sede en España/)
  assert.deepEqual(params.metadata, {
    product: 'acompanado',
    seats: '1',
    locale: 'en',
    tax_country: 'ES',
    tax_territory: 'peninsula',
    tax_id: 'B12345674',
    tax_id_type: 'es_cif',
    tax_treatment: 'standard',
    terms_version: '2026-10-09',
    terms_sha256: 'f'.repeat(64),
    launch_ref: 'ref-1',
    session_host: 'sergio',
    session_start: '2026-11-03T17:00:00.000Z',
    calendar_reservation: 'res-1',
  })
  // Lo declarado va tambien en el pago (lo ve quien mire el cobro en Stripe) y en el texto del boton.
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata)
  // El cobro, con el nombre de la web: acompanado es Duo.
  assert.equal(params.payment_intent_data.description, 'Digital Brain · Duo')
  assert.equal(params.custom_text.submit.message, 'Prices plus 21% VAT. The invoice, with tax ID B12345674, arrives by email; the license, right away.')
  assert.deepEqual(params.custom_fields.map((f: { key: string }) => f.key), ['novedades'])
  // Solo tarjeta: nada de pagos que quedan pendientes (la plaza y el hueco caducarian antes de cobrar).
  assert.deepEqual(params.payment_method_types, ['card'])
  assert.equal(params.success_url, 'https://pymaticlabs.com/en/gracias?pago={CHECKOUT_SESSION_ID}')
  // La vuelta sin pagar cierra el pago (suelta su plaza y su hueco) y lleva a la pagina de compra,
  // con el pais y el territorio elegidos.
  assert.equal(params.cancel_url, 'https://pymaticlabs.com/api/checkout/cancel?pago={CHECKOUT_SESSION_ID}&producto=acompanado&locale=en&pais=ES&territorio=peninsula')
  // Siempre en euros, aunque Adaptive Pricing este encendido en la cuenta.
  assert.deepEqual(params.adaptive_pricing, { enabled: false })
  const base = { siteUrl: 'https://x', priceId: 'p', taxRateId: 'txr_21', tax: SPAIN_TAX, expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null }
  const team = oneTimeSessionParams({ ...base, product: 'hazlo-tu-equipo', locale: 'es' }) as Record<string, any>
  assert.equal(team.custom_text.submit.message, 'Precios más el 21\u00a0% de IVA. La factura, con el NIF B12345674, te llega por correo y la licencia, al momento.')
  // Con las licencias a mano, la pagina de pago dice lo mismo que /gracias: en unas horas.
  const manual = oneTimeSessionParams({ ...base, product: 'hazlo-tu', locale: 'es', manualLicense: true }) as Record<string, any>
  assert.match(manual.custom_text.submit.message, /la licencia, en unas horas\.$/)
  const manualEn = oneTimeSessionParams({ ...base, product: 'hazlo-tu', locale: 'en', manualLicense: true }) as Record<string, any>
  assert.match(manualEn.custom_text.submit.message, /the license, within a few hours\.$/)
  assert.equal(team.metadata.seats, '10')
  assert.equal(team.discounts, undefined)
  assert.equal(team.currency, 'eur')
  // Ya no hay campo propio para el EIN (sin venta en dolares).
  assert.equal(team.custom_fields.find((f: { key: string }) => f.key === 'nif'), undefined)
})

test('Checkout de pago unico sin IVA: inversion del sujeto pasivo con la consulta a VIES, Canarias y fuera de la UE, sin el tipo del 21 %', () => {
  const base = { siteUrl: 'https://x', product: 'hazlo-tu' as const, priceId: 'p', expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null }
  const de: CheckoutTax = { country: 'DE', territory: null, taxId: 'DE123456789', taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: 'DE', vatNumber: '123456789' } }
  const vies = { request: 'WAPIAAAAX1', checkedAt: '2026-11-02T10:00:00.000Z' }
  const rc = oneTimeSessionParams({ ...base, taxRateId: null, tax: de, vies, locale: 'es' }) as Record<string, any>
  assert.deepEqual(rc.line_items, [{ price: 'p', quantity: 1 }])
  assert.deepEqual(rc.metadata, {
    product: 'hazlo-tu',
    seats: '1',
    locale: 'es',
    tax_country: 'DE',
    tax_id: 'DE123456789',
    tax_id_type: 'eu_vat',
    tax_treatment: 'reverse_charge',
    vies_request: 'WAPIAAAAX1',
    vies_checked_at: '2026-11-02T10:00:00.000Z',
    terms_version: 'v',
    terms_sha256: 's',
  })
  assert.equal(rc.custom_text.submit.message, 'Sin IVA: inversión del sujeto pasivo, con el NIF-IVA DE123456789 comprobado en VIES. La factura te llega por correo y la licencia, al momento.')
  // Sin la consulta a VIES no se abre a 0 %; con IVA, sin el tipo del 21 % tampoco.
  assert.throws(() => oneTimeSessionParams({ ...base, taxRateId: null, tax: de, locale: 'es' }), /VIES/)
  assert.throws(() => oneTimeSessionParams({ ...base, taxRateId: null, tax: SPAIN_TAX, locale: 'es' }), /tipo del 21 %/)
  // Aunque llegue el tipo del 21 %, sin IVA no se pone.
  const canarias = oneTimeSessionParams({ ...base, taxRateId: 'txr_21', tax: { ...SPAIN_TAX, territory: 'canarias', treatment: 'export' }, locale: 'es' }) as Record<string, any>
  assert.deepEqual(canarias.line_items, [{ price: 'p', quantity: 1 }])
  assert.equal(canarias.metadata.tax_territory, 'canarias')
  assert.equal(canarias.custom_text.submit.message, 'Sin IVA: Canarias está fuera del territorio del IVA español. La factura, con el NIF B12345674, te llega por correo y la licencia, al momento.')
  const us: CheckoutTax = { country: 'US', territory: null, taxId: 'US12-3456789', taxIdType: 'other', treatment: 'export', vies: null }
  const world = oneTimeSessionParams({ ...base, taxRateId: null, tax: us, locale: 'en' }) as Record<string, any>
  assert.equal(world.custom_text.submit.message, 'No Spanish VAT: sale outside the EU. The invoice, with tax ID US12-3456789, arrives by email; the license, right away.')
  assert.equal(world.metadata.tax_territory, undefined)
  const melilla = oneTimeSessionParams({ ...base, taxRateId: null, tax: { ...SPAIN_TAX, territory: 'melilla', treatment: 'export' }, locale: 'en' }) as Record<string, any>
  assert.match(melilla.custom_text.submit.message, /^No VAT: Melilla is outside the Spanish VAT area\./)
  // En la UE sin NIF-IVA: el 21 % de IVA espanol, con su identificacion fiscal.
  const frTax: CheckoutTax = { country: 'FR', territory: null, taxId: 'FR12345678900012', taxIdType: 'other', treatment: 'standard', vies: null }
  const fr = oneTimeSessionParams({ ...base, taxRateId: 'txr_21', tax: frTax, locale: 'es' }) as Record<string, any>
  assert.deepEqual(fr.line_items[0].tax_rates, ['txr_21'])
  assert.equal(fr.custom_text.submit.message, 'Precios más el 21\u00a0% de IVA español. La factura, con la identificación fiscal FR12345678900012, te llega por correo y la licencia, al momento.')
})

test('Stripe: el tipo de IVA del 21 % se busca por su metadato (activo, sin IVA dentro), una sola vez', async () => {
  const withRates = (rates: Record<string, unknown>[]) => {
    const payments = new StripePayments({ STRIPE_SECRET_KEY: 'sk_test_51Prueba' })
    const lists: Record<string, unknown>[] = []
    Object.assign(payments as unknown as Record<string, unknown>, { stripe: { taxRates: { list: async (params: Record<string, unknown>) => (lists.push(params), { data: rates }) } } })
    return { payments, lists }
  }
  const good = { id: 'txr_bueno', active: true, percentage: 21, inclusive: false, country: 'ES', metadata: { cerebro: 'iva-21' } }
  const { payments, lists } = withRates([
    { ...good, id: 'txr_otro', metadata: {} },
    { ...good, id: 'txr_dentro', inclusive: true },
    { ...good, id: 'txr_10', percentage: 10 },
    good,
  ])
  assert.equal(await payments.taxRateId(), 'txr_bueno')
  assert.equal(await payments.taxRateId(), 'txr_bueno')
  assert.deepEqual(lists, [{ active: true, inclusive: false, limit: 100 }])
  // Sin el de stripe-setup no se abre ningun pago (y no se usa otro cualquiera de la cuenta).
  await assert.rejects(withRates([{ ...good, metadata: {} }]).payments.taxRateId(), (e: Error) => e instanceof PermanentError && /stripe-setup/.test(e.message))
})

test('Stripe: un tipo de IVA archivado por stripe-setup con la instancia ya caliente: se busca otra vez y el pago se reintenta una vez', async () => {
  const payments = new StripePayments({ STRIPE_SECRET_KEY: 'sk_test_51Prueba' })
  const rate = (id: string) => ({ id, active: true, percentage: 21, inclusive: false, country: 'ES', metadata: { cerebro: 'iva-21' } })
  let rates = [rate('txr_viejo')]
  let broken = false
  const created: Record<string, any>[] = []
  const rejected = (message: string) => Object.assign(new Error(message), { type: 'StripeInvalidRequestError', statusCode: 400 })
  Object.assign(payments as unknown as Record<string, unknown>, {
    stripe: {
      taxRates: { list: async () => ({ data: rates }) },
      prices: { list: async () => ({ data: [{ id: 'price_hazlo_tu' }] }) },
      checkout: {
        sessions: {
          create: async (params: Record<string, any>) => {
            created.push(params)
            if (broken) throw rejected('Invalid email address')
            if (!rates.some((r) => r.id === params.line_items[0].tax_rates[0])) throw rejected(`The tax rate ${params.line_items[0].tax_rates[0]} is inactive.`)
            return { id: `cs_${created.length}`, url: `https://checkout.stripe.com/c/pay/cs_${created.length}`, expires_at: 1 }
          },
        },
      },
    },
  })
  const params = async () => ({ line_items: [{ price: await payments.priceId('cerebro-hazlo-tu'), quantity: 1, tax_rates: [await payments.taxRateId()] }] })
  assert.equal((await payments.createCheckoutSession(await params())).id, 'cs_1')
  // stripe-setup archiva el tipo y crea otro: la instancia aun tiene el viejo guardado.
  rates = [rate('txr_nuevo')]
  assert.equal((await payments.createCheckoutSession(await params())).id, 'cs_3')
  assert.deepEqual(created.map((p) => p.line_items[0].tax_rates[0]), ['txr_viejo', 'txr_viejo', 'txr_nuevo'])
  assert.equal(await payments.taxRateId(), 'txr_nuevo')
  // Un rechazo con los mismos ids (otra causa) no se reintenta.
  broken = true
  await assert.rejects(payments.createCheckoutSession(await params()), (e: Error) => e instanceof PermanentError && /Invalid email/.test(e.message))
  assert.equal(created.length, 4)
})

test('Stripe: el portal se abre con la configuracion de stripe-setup (cerebro=portal), nunca con la del panel', async () => {
  const portalWith = (configurations: { id: string; metadata: Record<string, string> }[]) => {
    const payments = new StripePayments({ STRIPE_SECRET_KEY: 'sk_test_51Prueba' })
    const created: Record<string, unknown>[] = []
    const lists: Record<string, unknown>[] = []
    Object.assign(payments as unknown as Record<string, unknown>, {
      stripe: {
        billingPortal: {
          configurations: { list: async (params: Record<string, unknown>) => (lists.push(params), { data: configurations }) },
          sessions: { create: async (params: Record<string, unknown>) => (created.push(params), { url: 'https://billing.stripe.com/p/session_1' }) },
        },
      },
    })
    return { payments, created, lists }
  }
  const { payments, created, lists } = portalWith([{ id: 'bpc_panel', metadata: {} }, { id: 'bpc_cerebro', metadata: { cerebro: 'portal' } }])
  assert.equal(await payments.createPortalSession('cus_1', 'https://pymaticlabs.com/zona/mensual'), 'https://billing.stripe.com/p/session_1')
  await payments.createPortalSession('cus_2', 'https://pymaticlabs.com/zona/mensual')
  assert.deepEqual(created, [
    { customer: 'cus_1', return_url: 'https://pymaticlabs.com/zona/mensual', configuration: 'bpc_cerebro' },
    { customer: 'cus_2', return_url: 'https://pymaticlabs.com/zona/mensual', configuration: 'bpc_cerebro' },
  ])
  // Se busca una vez, entre las activas.
  assert.deepEqual(lists, [{ active: true, limit: 100 }])
  // Sin la nuestra no se abre la del panel (que dejaria cambiar el NIF y no tiene los planes).
  const panelOnly = portalWith([{ id: 'bpc_panel', metadata: {} }])
  await assert.rejects(panelOnly.payments.createPortalSession('cus_1', 'https://pymaticlabs.com/zona/mensual'), (e: Error) => e instanceof PermanentError && /stripe-setup/.test(e.message))
  assert.deepEqual(panelOnly.created, [])
})

test('Checkout del mensual: con su cliente de Stripe, los meses incluidos como prueba y el 21 % en la suscripcion', () => {
  const now = new Date('2026-11-02T10:00:00Z')
  assert.equal(trialEndFor('2027-02-02', now), Math.floor(Date.parse('2027-02-02T23:00:00Z') / 1000))
  assert.equal(trialEndFor('2026-11-03', now), null) // menos de 48 horas
  assert.equal(trialEndFor(null, now), null)
  const params = planSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'plan-pro',
    priceId: 'price_pro',
    taxRateId: 'txr_21',
    tax: { ...SPAIN_TAX, taxId: 'B12345678' },
    locale: 'es',
    // Una empresa de antes con la moneda en dolares: el mensual, en euros igual.
    company: { ...company, currency: 'usd' },
    expiresAt: 1,
    trialEnd: 1_800_000_000,
    terms: { version: 'v', sha256: 's' },
  }) as Record<string, any>
  assert.equal(params.mode, 'subscription')
  assert.equal(params.customer, 'cus_1')
  // El NIF y el nombre, los de la compra: ni se piden ni se cambian al contratar el mensual.
  assert.deepEqual(params.customer_update, { address: 'auto' })
  assert.equal(params.tax_id_collection, undefined)
  // El 21 % en la suscripcion (vale tambien tras cambiar de plan en el portal), sin Stripe Tax y en euros.
  assert.equal(params.automatic_tax, undefined)
  assert.deepEqual(params.subscription_data.default_tax_rates, ['txr_21'])
  assert.deepEqual(params.line_items, [{ price: 'price_pro', quantity: 1 }])
  assert.equal(params.currency, 'eur')
  assert.deepEqual(params.adaptive_pricing, { enabled: false })
  assert.equal(params.subscription_data.trial_end, 1_800_000_000)
  assert.equal(params.subscription_data.metadata.company_id, 'c1')
  assert.equal(params.subscription_data.metadata.tax_id, 'B12345678')
  assert.equal(params.subscription_data.metadata.tax_treatment, 'standard')
  assert.deepEqual(params.metadata, params.subscription_data.metadata)
  assert.equal(params.custom_text.submit.message, 'Precios más el 21\u00a0% de IVA. Cada factura, con el NIF B12345678, te llega por correo.')
  assert.equal(params.success_url, 'https://pymaticlabs.com/zona?mensual=ok')
  // Sin IVA (una empresa de fuera de la UE): sin default_tax_rates, y lo declarado en la suscripcion.
  const us = planSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'plan-pro',
    priceId: 'price_pro',
    taxRateId: null,
    tax: { country: 'US', territory: null, taxId: 'US12-3456789', taxIdType: 'other', treatment: 'export', vies: null },
    locale: 'en',
    company: { ...company, country: 'US', taxId: 'US12-3456789', taxIdType: 'other' },
    expiresAt: 1,
    trialEnd: null,
    terms: { version: 'v', sha256: 's' },
  }) as Record<string, any>
  assert.equal(us.subscription_data.default_tax_rates, undefined)
  assert.equal(us.subscription_data.metadata.tax_treatment, 'export')
  assert.equal(us.custom_text.submit.message, 'No Spanish VAT: sale outside the EU. Each invoice, with tax ID US12-3456789, arrives by email.')
})

test('el mensual por ano adelantado: el precio de 10 meses, su lookup_key propio y la entrega lo reconoce', () => {
  // La oferta v1.9: al ano, el precio de 10 meses (990, 1.990 y 2.990 €, sin IVA).
  assert.deepEqual(plans.map((p) => p.yearly), [990, 1990, 2990])
  for (const plan of plans) assert.equal(plan.yearly, plan.monthly * ANNUAL_PAID_MONTHS, plan.id)
  assert.deepEqual(priceCents('plan-pro', 'year'), { list: 199000, launch: null })
  assert.deepEqual(priceCents('plan-pro'), { list: 19900, launch: null })
  // El pago unico no tiene periodo.
  assert.deepEqual(priceCents('hazlo-tu', 'year'), priceCents('hazlo-tu'))
  assert.equal(lookupKey('plan-esencial', 'year'), 'cerebro-plan-esencial-anual')
  assert.equal(lookupKey('plan-esencial'), 'cerebro-plan-esencial')
  assert.equal(lookupKey('hazlo-tu', 'year'), 'cerebro-hazlo-tu')
  assert.deepEqual(priceFromLookupKey('cerebro-plan-premium-anual'), { product: 'plan-premium', period: 'year' })
  assert.deepEqual(priceFromLookupKey('cerebro-plan-premium'), { product: 'plan-premium', period: 'month' })
  assert.deepEqual(priceFromLookupKey('cerebro-acompanado'), { product: 'acompanado', period: null })
  for (const key of ['cerebro-hazlo-tu-anual', 'cerebro-plan-oro-anual', 'plan-pro-anual', 'cerebro-plan-pro-anual-anual', null]) assert.equal(priceFromLookupKey(key), null, String(key))
  assert.equal(productFromLookupKey('cerebro-plan-pro-anual'), 'plan-pro')
  assert.equal(planProductName('plan-pro', 'year', 'en'), 'Digital Brain · Monthly Pro (paid yearly)')
  assert.equal(planProductName('plan-pro', 'month', 'es'), 'Cerebro Digital · Mensual Pro')
  // Las modalidades, con su nombre propio (Sergio, 29-10-2026): el de los productos de Stripe, las
  // facturas y los correos, como en la web. Los ids no cambian.
  assert.deepEqual(
    modalities.map((m) => productName(m.id, 'es')),
    ['Cerebro Digital · Solista', 'Cerebro Digital · Banda', 'Cerebro Digital · Dúo', 'Cerebro Digital · Orquesta']
  )
  assert.deepEqual(
    modalities.map((m) => productName(m.id, 'en')),
    ['Digital Brain · Solo', 'Digital Brain · Band', 'Digital Brain · Duo', 'Digital Brain · Orchestra']
  )
  assert.deepEqual(modalities.map((m) => m.id), ['hazlo-tu', 'hazlo-tu-equipo', 'acompanado', 'acompanado-equipo'])

  const params = planSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'plan-pro',
    priceId: 'price_pro_anual',
    period: 'year',
    taxRateId: 'txr_21',
    tax: SPAIN_TAX,
    locale: 'es',
    company,
    expiresAt: 1,
    trialEnd: 1_800_000_000,
    terms: { version: 'v', sha256: 's' },
  }) as Record<string, any>
  assert.deepEqual(params.line_items, [{ price: 'price_pro_anual', quantity: 1 }])
  // El mismo 21 % y la misma prueba (los meses incluidos) que al mes.
  assert.deepEqual(params.subscription_data.default_tax_rates, ['txr_21'])
  assert.equal(params.subscription_data.trial_end, 1_800_000_000)
  assert.equal(params.subscription_data.metadata.period, 'year')
  assert.equal(params.metadata.period, 'year')
  assert.equal(params.subscription_data.description, 'Cerebro Digital · Mensual Pro (pago anual)')
})

test('precios con punto de millar tambien en cuatro cifras, como la oferta («1.990 €»)', () => {
  // Intl separa la cifra del € con un espacio duro.
  const plain = (s: string) => s.replace(/ /g, ' ')
  assert.equal(plain(formatPrice(1990, 'es')), '1.990 €')
  assert.equal(plain(formatPrice(990, 'es')), '990 €')
  assert.equal(plain(formatPrice(10000, 'es')), '10.000 €')
  assert.equal(formatPrice(1990, 'en'), '€1,990')
  assert.equal(plain(formatMoney(240790, 'eur', 'es')), '2.407,90 €')
  assert.equal(formatMoney(119790, 'eur', 'en'), '€1,197.90')
})

test('la fecha de fin de la seguridad: cinco anos desde que se publica cada version; una de correccion conserva la de la que corrige', async () => {
  const versions = [
    { id: '1.9.0', publishedAt: '2026-11-15T10:00:00Z' },
    { id: '1.10.0', publishedAt: '2027-03-31T22:30:00Z' }, // ya 1 de abril en Madrid
    { id: '1.10.1', publishedAt: '2027-05-20T10:00:00Z' },
  ]
  assert.equal(securitySupportUntil(versions, '1.9.0'), '2031-11-15')
  assert.equal(securitySupportUntil(versions, '1.10.0'), '2032-04-01')
  assert.equal(securitySupportUntil(versions, '1.10.1'), '2032-04-01')
  assert.equal(securitySupportUntil(versions, '2.0.0'), null)
  const d = createFakeDelivery()
  assert.equal(await currentSecuritySupport(d), null)
  await d.repo.upsertVersion({ id: '1.9.0', notesEs: 'n', notesEn: 'n', publishedAt: '2026-11-15T10:00:00Z' })
  await d.repo.upsertVersion({ id: '1.9.2', notesEs: 'n', notesEn: 'n', publishedAt: '2027-01-10T10:00:00Z' })
  // La que se vende es la ultima (1.9.2, no 1.9.0 por orden de texto), con la fecha de la 1.9.0.
  assert.deepEqual(await currentSecuritySupport(d), { version: '1.9.2', until: '2031-11-15' })
})

test('createCheckout: el NIF espanol se comprueba antes de apartar nada; solo en euros', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const { slots } = await firstSessionSlots(d)
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es' }), code('tax_id_required'))
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: '  ' }), code('tax_id_required'))
  for (const taxId of ['B12345678', 'DE123456789', '12-3456789']) {
    await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId, session: slots[0] }), code('tax_id_invalid'), taxId)
  }
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: 'B12345674', currency: 'usd' }), code('currency'))
  // Nada apartado ni pago abierto con un NIF que no vale.
  assert.equal(d.fakes.calendar.reservations.size, 0)
  assert.equal(d.fakes.payments.sessions.size, 0)
  // Con uno bueno (como lo escriba el cliente), el pago lleva el limpio y el tipo del 21 %.
  const ok = await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: 'esb-12.345.674', currency: 'EUR' })
  const params = d.fakes.payments.sessions.get(ok.sessionId)!.params as Record<string, any>
  assert.equal(params.metadata.tax_id, 'B12345674')
  assert.deepEqual(params.line_items[0].tax_rates, ['txr_fake_iva_21'])
})

test('createCheckout: el Acompanado exige un hueco libre y lo aparta; el mensual, ser cliente', async () => {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  const taxId = 'B12345674'
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId }), (e: unknown) => e instanceof CheckoutError && e.code === 'session_required')
  const { slots } = await firstSessionSlots(d)
  const checkout = await createCheckout(d, { product: 'acompanado', locale: 'es', taxId, session: slots[0] })
  assert.equal(checkout.launch, true)
  assert.equal(d.fakes.calendar.reservations.size, 1)
  // Otro cliente, el mismo hueco: ya no esta libre.
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId, session: slots[0] }), (e: unknown) => e instanceof CheckoutError && e.code === 'slot_taken')
  await assert.rejects(createCheckout(d, { product: 'plan-pro', locale: 'es' }), (e: unknown) => e instanceof CheckoutError && e.code === 'company_required')
  await assert.rejects(createCheckout(d, { product: 'nada', locale: 'es' }), (e: unknown) => e instanceof CheckoutError && e.code === 'product')
  const plan = await createCheckout(d, { product: 'plan-esencial', locale: 'es', company: { ...company, id: 'c-sin-licencia' } })
  assert.ok(plan.url.includes('/api/dev/checkout'))
  assert.deepEqual((d.fakes.payments.sessions.get(plan.sessionId)!.params.subscription_data as { default_tax_rates: string[] }).default_tax_rates, ['txr_fake_iva_21'])
  // La copia de las condiciones de la version vigente queda guardada al abrir el primer pago.
  assert.ok([...d.fakes.storage.files.keys()].some((k) => /^customer-files\/condiciones\/\d{4}-\d{2}-\d{2}\/es\.html$/.test(k)))
  now = new Date(now.getTime() + 1000)
})

test('createCheckout: el precio de lanzamiento, 10 plazas en total y no mas de 2 abiertas por IP; sin plaza y quedando, launch_busy', async () => {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  const taxId = 'B12345674'
  const busy = (e: unknown) => e instanceof CheckoutError && e.code === 'launch_busy'
  const { slots } = await firstSessionSlots(d)
  // Tres empresas detras de la misma IP (una oficina compartida): la tercera no paga el de lista ni
  // cierra el pago que otra esta haciendo; que pruebe en media hora.
  const nifs = ['A58818501', 'B12345674', 'G28029643']
  const same = await Promise.all(nifs.slice(0, 2).map((nif) => createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nif, clientIp: '1.2.3.4' })))
  assert.deepEqual(same.map((c) => c.launch), [true, true])
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nifs[2], clientIp: '1.2.3.4' }), busy)
  assert.equal(d.fakes.payments.expiredSessions.size, 0)
  assert.equal(d.fakes.payments.sessions.size, 2)
  const others = []
  for (let i = 0; i < 8; i++) others.push(await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: `9.9.9.${i}` }))
  assert.equal(others.filter((c) => c.launch).length, 8)
  // Las 10 apartadas por pagos a medias: el siguiente no paga el de lista; en el Acompanado, el hueco
  // que habia apartado se suelta.
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: '8.8.8.8' }), busy)
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '8.8.8.9', session: slots[0] }), busy)
  assert.equal(d.fakes.calendar.reservations.size, 0)
  assert.equal(d.fakes.payments.sessions.size, 10)
  // Gastada una (pagada) y suelta otra (caduca su pago): con plaza otra vez. Las 10 gastadas, el de lista.
  await d.repo.markLaunchSlot(String((d.fakes.payments.sessions.get(others[0].sessionId)!.params.metadata as Record<string, string>).launch_ref), 'used')
  now = new Date(now.getTime() + 40 * 60_000)
  assert.equal((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: '7.7.7.7' })).launch, true)
  // Gastadas todas, el de lista sin esperar (oferta v1.9: desde la venta 11).
  const one = createFakeDelivery({ clock: () => now, env: { LAUNCH_LIMIT: '1' } })
  const first = await createCheckout(one, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: '6.6.6.6' })
  await one.repo.markLaunchSlot(String((one.fakes.payments.sessions.get(first.sessionId)!.params.metadata as Record<string, string>).launch_ref), 'used')
  const list = await createCheckout(one, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: '6.6.6.7' })
  assert.equal(list.launch, false)
  assert.equal(one.fakes.payments.sessions.get(list.sessionId)!.params.discounts, undefined)
})

test('createCheckout: quien vuelve atras desde Stripe y abre otro pago se lleva la plaza de su pago a medias (reserveLaunchPlace)', async (t) => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const taxId = 'B12345674'
  const busy = (e: unknown) => e instanceof CheckoutError && e.code === 'launch_busy'
  const open = () => createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId, clientIp: '1.2.3.4' })
  const [a, b] = [await open(), await open()]
  assert.deepEqual([a.launch, b.launch], [true, true])
  // A la tercera, antes, el precio de lista: ahora se cierra en Stripe su pago mas viejo y la plaza pasa al nuevo.
  const c = await open()
  assert.equal(c.launch, true)
  assert.deepEqual([...d.fakes.payments.expiredSessions], [a.sessionId])
  assert.ok((d.fakes.payments.sessions.get(c.sessionId)!.params.discounts as unknown[]).length)
  // Otra empresa desde la misma IP no le cierra ninguno, ni paga el de lista: launch_busy.
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: 'A58818501', clientIp: '1.2.3.4' }), busy)
  assert.deepEqual([...d.fakes.payments.expiredSessions], [a.sessionId])
  // Si Stripe no contesta al mirar sus pagos a medias, tampoco se abre al de lista.
  t.mock.method(console, 'warn', () => {})
  d.fakes.payments.failures.failNext('getCheckoutSession')
  await assert.rejects(open(), busy)
  assert.deepEqual([...d.fakes.payments.expiredSessions], [a.sessionId])
})

test('createCheckout: quien vuelve atras con el navegador y elige el mismo hueco lo coge (se cierra su pago a medias); otro NIF no', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const taxId = 'B12345674'
  const { slots } = await firstSessionSlots(d)
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const first = await createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '1.2.3.4', session: slots[0] })
  // Otra empresa desde la misma IP, o sin saber la IP: el hueco sigue ocupado, y el pago abierto.
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId: 'A58818501', clientIp: '1.2.3.4', session: slots[0] }), code('slot_taken'))
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId, session: slots[0] }), code('slot_taken'))
  assert.equal(d.fakes.payments.expiredSessions.size, 0)
  // La misma, con el mismo hueco (la pagina salio de la cache del historial): antes, slot_taken unos 35 minutos.
  const again = await createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '1.2.3.4', session: slots[0] })
  assert.deepEqual([...d.fakes.payments.expiredSessions], [first.sessionId])
  assert.equal(again.launch, true)
  // Un solo hueco apartado (el del pago nuevo) y la plaza del viejo, suelta.
  assert.deepEqual([...d.fakes.calendar.reservations.values()], [{ host: slots[0].host, start: new Date(slots[0].start).toISOString() }])
  assert.equal((d.fakes.payments.sessions.get(again.sessionId)!.params.metadata as Record<string, string>).calendar_reservation, [...d.fakes.calendar.reservations.keys()][0])
  // Otro hueco no cierra nada: el pago a medias con el primero sigue abierto.
  await createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '1.2.3.4', session: slots[1] })
  assert.deepEqual([...d.fakes.payments.expiredSessions], [first.sessionId])
  assert.equal(d.fakes.calendar.reservations.size, 2)
})

test('createCheckout: si la base no contesta al apartar la plaza de lanzamiento, el hueco de Cal.com no se queda apartado', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const taxId = 'B12345674'
  const { slots } = await firstSessionSlots(d)
  const reserve = d.repo.reserveLaunchSlot.bind(d.repo)
  let fail = true
  d.repo.reserveLaunchSlot = async (...args: Parameters<typeof reserve>) => {
    if (fail) {
      fail = false
      throw new Error('supabase sin contestar')
    }
    return reserve(...args)
  }
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '1.2.3.4', session: slots[0] }), /supabase sin contestar/)
  assert.equal(d.fakes.calendar.reservations.size, 0)
  assert.equal(d.fakes.payments.sessions.size, 0)
  // Al reintentar, el mismo hueco sigue libre.
  assert.equal((await createCheckout(d, { product: 'acompanado', locale: 'es', taxId, clientIp: '1.2.3.4', session: slots[0] })).launch, true)
})

test('la vuelta desde Stripe sin pagar (/api/checkout/cancel): solo con la venta abierta y 10 cada 10 minutos por IP', async (t) => {
  // Con 11 plazas: el pago 11 no se queda sin abrir por launch_busy.
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z'), env: { LAUNCH_LIMIT: '11' } })
  const open = { CHECKOUT_OPEN: 'true' }
  const sessions = []
  for (let i = 0; i < 11; i++) sessions.push((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: 'B12345674', clientIp: `9.9.9.${i}` })).sessionId)
  const expire = t.mock.method(d.fakes.payments, 'expireCheckoutSession')
  // Con la venta cerrada no se llama a Stripe.
  assert.equal(await cancelCheckout(d, sessions[0], '5.5.5.5', {}), false)
  assert.equal(expire.mock.callCount(), 0)
  // Con ella abierta, cada vuelta cierra su pago; la 11.ª desde la misma IP ya no llama a Stripe.
  for (const id of sessions.slice(0, 10)) assert.equal(await cancelCheckout(d, id, '5.5.5.5', open), true)
  assert.equal(expire.mock.callCount(), 10)
  assert.equal(await cancelCheckout(d, sessions[10], '5.5.5.5', open), false)
  assert.equal(expire.mock.callCount(), 10)
  assert.ok(!d.fakes.payments.expiredSessions.has(sessions[10]))
  // Otra IP si puede (la de verdad del que vuelve), y un id que no es de un pago no llega a Stripe.
  assert.equal(await cancelCheckout(d, sessions[10], '6.6.6.6', open), true)
  assert.equal(await cancelCheckout(d, 'no-es-un-pago', '7.7.7.7', open), false)
  assert.equal(expire.mock.callCount(), 11)
})

test('primera sesion: si las dos semanas estan llenas, salen los huecos de la tercera', async () => {
  const now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  const calendar = new FakeCalendar({ busyDays: 15, clock: () => now })
  d.calendar = calendar
  const { slots, thirdWeek } = await firstSessionSlots(d)
  assert.equal(thirdWeek, true)
  assert.ok(slots.length > 0)
  assert.ok(slots.every((s) => new Date(s.start) >= new Date('2026-11-17T00:00:00Z')))
  // Lunes a viernes de 18 a 22 y sabados de 10 a 14, hora peninsular; con Eric y con Sergio.
  const hours = new Set(slots.map((s) => new Intl.DateTimeFormat('es-ES', { hour: '2-digit', hour12: false, timeZone: 'Europe/Madrid', weekday: 'short' }).format(new Date(s.start))))
  assert.ok([...hours].every((h) => /(lun|mar|mié|jue|vie).* (18|19|20|21)$|sáb.* (10|11|12|13)$/.test(h)), [...hours].join(','))
  assert.deepEqual([...new Set(slots.map((s) => s.host))].sort(), ['eric', 'sergio'])
})

// --- Se vende a todo el mundo: el pais, la identificacion fiscal y el IVA antes de pagar ----------

test('identificacion fiscal: los cinco casos de lo que se escribe en /comprar, y lo que no vale', () => {
  const read = (input: Parameters<typeof readTaxInput>[0]) => readTaxInput(input)
  // 1. Espana peninsular (sin pais: Espana; sin territorio: la peninsula), con el 21 %.
  assert.deepEqual(read({ taxId: 'esb-12.345.674' }), { tax: { country: 'ES', territory: 'peninsula', taxId: 'B12345674', taxIdType: 'es_cif', treatment: 'standard', vies: null } })
  // 2. Canarias, Ceuta y Melilla: sin IVA espanol. Lo de los otros campos, ignorado.
  for (const territory of ['canarias', 'ceuta', 'melilla']) {
    assert.deepEqual(read({ country: 'es', territory, taxId: 'B12345674', vatId: 'DE123456789', otherTaxId: 'x' }), { tax: { country: 'ES', territory, taxId: 'B12345674', taxIdType: 'es_cif', treatment: 'export', vies: null } })
  }
  // 3. Otro pais de la UE con NIF-IVA (con o sin prefijo; Grecia, EL): inversion del sujeto pasivo, a VIES.
  assert.deepEqual(read({ country: 'DE', vatId: 'de 123 456 789', otherTaxId: 'no cuenta' }), {
    tax: { country: 'DE', territory: null, taxId: 'DE123456789', taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: 'DE', vatNumber: '123456789' } },
  })
  assert.deepEqual(read({ country: 'GR', vatId: '123456789' }), {
    tax: { country: 'GR', territory: null, taxId: 'EL123456789', taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: 'EL', vatNumber: '123456789' } },
  })
  assert.equal((read({ country: 'GR', vatId: 'GR123456789' }) as { tax: CheckoutTax }).tax.taxId, 'EL123456789')
  // 4. La UE sin NIF-IVA: con el 21 % y su identificacion fiscal, con el pais delante.
  assert.deepEqual(read({ country: 'FR', vatId: ' ', otherTaxId: 'SIREN 123 456 789' }), { tax: { country: 'FR', territory: null, taxId: 'FRSIREN123456789', taxIdType: 'other', treatment: 'standard', vies: null } })
  // 5. Fuera de la UE: sin IVA espanol, con la identificacion fiscal (la suiza ya trae CH).
  assert.deepEqual(read({ country: 'US', otherTaxId: '12-3456789', taxId: 'B12345674' }), { tax: { country: 'US', territory: null, taxId: 'US12-3456789', taxIdType: 'other', treatment: 'export', vies: null } })
  assert.equal((read({ country: 'CH', otherTaxId: 'CHE-123.456.789' }) as { tax: CheckoutTax }).tax.taxId, 'CHE-123456789')
  for (const country of ['AD', 'GB', 'NO']) assert.equal((read({ country, otherTaxId: 'A-1234' }) as { tax: CheckoutTax }).tax.treatment, 'export', country)
  // A cualquier pais, sin lista de los que no se vende (los socios, 29-10-2026): Rusia, como los demas de fuera.
  assert.deepEqual(read({ country: 'RU', otherTaxId: '7707083893' }), { tax: { country: 'RU', territory: null, taxId: 'RU7707083893', taxIdType: 'other', treatment: 'export', vies: null } })
  // Lo que no vale, con su error.
  const error = (input: Parameters<typeof readTaxInput>[0]) => (read(input) as { error?: string }).error
  assert.equal(error({ country: 'XX', taxId: 'B12345674' }), 'country_invalid')
  assert.equal(error({ country: 'ES', territory: 'andorra', taxId: 'B12345674' }), 'territory_invalid')
  assert.equal(error({ country: 'ES' }), 'tax_id_required')
  assert.equal(error({ country: 'ES', taxId: 'DE123456789' }), 'tax_id_invalid')
  assert.equal(error({ country: 'DE', vatId: 'FR12345678901' }), 'vat_id_invalid')
  assert.equal(error({ country: 'DE', vatId: 'DE12345' }), 'vat_id_invalid')
  assert.equal(error({ country: 'DE' }), 'eu_tax_id_required')
  assert.equal(error({ country: 'DE', otherTaxId: '!!' }), 'other_tax_id_invalid')
  assert.equal(error({ country: 'US', vatId: 'US123' }), 'other_tax_id_required')
  assert.equal(error({ country: 'US', otherTaxId: '12' }), 'other_tax_id_invalid')
  assert.equal(error({ country: 'US', otherTaxId: 'X'.repeat(31) }), 'other_tax_id_invalid')
})

test('identificacion fiscal: la forma del NIF-IVA de cada pais, la de fuera de la UE, los territorios y los paises', () => {
  assert.deepEqual(parseEuVatId('AT', 'ATU12345678'), { vatId: 'ATU12345678', viesCountry: 'AT', number: 'U12345678' })
  assert.equal(parseEuVatId('BE', '123456789')?.vatId, 'BE0123456789') // los de 9 cifras, con el 0 delante
  assert.equal(parseEuVatId('NL', 'NL123456789B01')?.number, '123456789B01')
  assert.equal(parseEuVatId('FR', 'FR 12 345678901')?.vatId, 'FR12345678901')
  assert.equal(parseEuVatId('IE', '1234567WA')?.vatId, 'IE1234567WA')
  assert.equal(parseEuVatId('SE', 'SE123456789001')?.vatId, 'SE123456789001')
  for (const [country, value] of [['DE', '12345678'], ['AT', '12345678'], ['NL', '123456789'], ['ES', 'B12345674'], ['US', '123456789']]) assert.equal(parseEuVatId(country, value), null, `${country} ${value}`)
  assert.equal(parseOtherTaxId('US', 'ñandú-12 34'), 'USNANDU-1234')
  assert.equal(parseOtherTaxId('AD', '--L-123456-Z--'), 'ADL-123456-Z')
  assert.equal(parseOtherTaxId('US', '1-2-3'), null)
  // Territorios por el codigo postal (35 y 38, Canarias; 51, Ceuta; 52, Melilla).
  assert.deepEqual(['07001', '35001', '38001', '51001', '52001', '53001', '1200', null].map(territoryOfPostalCode), ['peninsula', 'canarias', 'canarias', 'ceuta', 'melilla', null, null, null])
  assert.equal(territoryOf({ postalCode: '28001', state: 'TF', city: null }), 'canarias') // la provincia lo dice
  assert.equal(territoryOf({ postalCode: '', state: 'TF', city: null }), null)
  // Los paises: todos los de ISO 3166-1 y XK, sin lista de los que no se vende (los socios, 29-10-2026); la UE del IVA, los 27 y Monaco.
  assert.equal(SALE_COUNTRIES.length, 250)
  assert.equal(new Set(SALE_COUNTRIES).size, SALE_COUNTRIES.length)
  assert.ok(SALE_COUNTRIES.every((c) => /^[A-Z]{2}$/.test(c)))
  for (const c of ['ES', 'XK', 'AD', 'RU', 'BY', 'KP', 'IR', 'SY', 'CU', 'AQ', 'BV', 'HM', 'GS', 'UM']) assert.ok(isSaleCountry(c), c)
  for (const c of ['XX', 'ZZ', 'EU', 'UK', 'es', '', null]) assert.ok(!isSaleCountry(c), String(c))
  assert.equal(SALE_COUNTRIES.filter(isEuCountry).length, 28)
  assert.deepEqual(SALE_COUNTRIES.filter(isEuCountry), 'AT BE BG CY CZ DE DK EE ES FI FR GR HR HU IE IT LT LU LV MC MT NL PL PT RO SE SI SK'.split(' '))
  assert.ok(!isEuCountry('XI') && !isEuCountry('GB') && isEuCountry('GR'))
  // Lo heredado de Object no es un pais de la UE (ni rompe la forma del NIF-IVA).
  for (const c of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.ok(!isEuCountry(c) && parseEuVatId(c, 'U12345678') === null, c)
  // Lo que va en los metadatos, con la consulta a VIES solo con inversion del sujeto pasivo.
  const vies = { request: 'WAPI1', checkedAt: '2026-11-02T10:00:00.000Z' }
  assert.deepEqual(taxMetadata({ country: 'US', territory: null, taxId: 'US1234', taxIdType: 'other', treatment: 'export', vies: null }, vies), { tax_country: 'US', tax_id: 'US1234', tax_id_type: 'other', tax_treatment: 'export' })
})

/** Un pago unico con lo que llega del formulario de /comprar. */
async function openOneTime(d: ReturnType<typeof createFakeDelivery>, input: Partial<Parameters<typeof createCheckout>[1]>) {
  const checkout = await createCheckout(d, { product: 'hazlo-tu', locale: 'es', clientIp: '203.0.113.9', ...input })
  return d.fakes.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
}

test('createCheckout: los cinco casos de punta a punta, con lo declarado en los metadatos y el 21 % solo cuando toca', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  // 1. Espana peninsular.
  const es = await openOneTime(d, { country: 'ES', territory: 'peninsula', taxId: 'B12345674' })
  assert.deepEqual(es.line_items[0].tax_rates, ['txr_fake_iva_21'])
  assert.deepEqual([es.metadata.tax_country, es.metadata.tax_territory, es.metadata.tax_id, es.metadata.tax_id_type, es.metadata.tax_treatment], ['ES', 'peninsula', 'B12345674', 'es_cif', 'standard'])
  // client_ref, la huella exacta de quien abre un pago con plaza (lib/delivery/launch.ts), solo en la sesion.
  const { client_ref: ref, ...sessionMetadata } = es.metadata
  assert.equal(ref, clientRef(d, '203.0.113.9', es.metadata.launch_ref))
  assert.deepEqual(es.payment_intent_data.metadata, sessionMetadata)
  // 2. Canarias: sin el tipo del 21 %.
  const canarias = await openOneTime(d, { country: 'ES', territory: 'canarias', taxId: 'B12345674', clientIp: '203.0.113.10' })
  assert.equal(canarias.line_items[0].tax_rates, undefined)
  assert.deepEqual([canarias.metadata.tax_territory, canarias.metadata.tax_treatment], ['canarias', 'export'])
  // 3. La UE con NIF-IVA: VIES con el NIF-IVA de PymaticLabs como solicitante (en el adaptador) y su consulta, con el pedido.
  const de = await openOneTime(d, { country: 'DE', vatId: 'DE123456789', clientIp: '203.0.113.11' })
  assert.deepEqual(d.fakes.vies.checks, [{ countryCode: 'DE', vatNumber: '123456789' }])
  assert.equal(de.line_items[0].tax_rates, undefined)
  assert.deepEqual([de.metadata.tax_country, de.metadata.tax_territory, de.metadata.tax_id, de.metadata.tax_id_type, de.metadata.tax_treatment], ['DE', undefined, 'DE123456789', 'eu_vat', 'reverse_charge'])
  assert.match(de.metadata.vies_request, /^WAPIFALSO\d+$/)
  assert.equal(de.metadata.vies_checked_at, '2026-11-02T10:00:00.000Z')
  assert.match(de.custom_text.submit.message, /inversión del sujeto pasivo, con el NIF-IVA DE123456789 comprobado en VIES/)
  // 4. La UE sin NIF-IVA: el 21 %, con su identificacion; sin preguntar a VIES.
  const fr = await openOneTime(d, { country: 'FR', vatId: '', otherTaxId: '123 456 789 00012', clientIp: '203.0.113.12' })
  assert.deepEqual(fr.line_items[0].tax_rates, ['txr_fake_iva_21'])
  assert.deepEqual([fr.metadata.tax_id, fr.metadata.tax_id_type, fr.metadata.tax_treatment, fr.metadata.vies_request], ['FR12345678900012', 'other', 'standard', undefined])
  assert.equal(d.fakes.vies.checks.length, 1)
  // 5. Fuera de la UE: sin IVA espanol.
  const us = await openOneTime(d, { country: 'US', otherTaxId: '12-3456789', clientIp: '203.0.113.13' })
  assert.equal(us.line_items[0].tax_rates, undefined)
  assert.deepEqual([us.metadata.tax_country, us.metadata.tax_id, us.metadata.tax_id_type, us.metadata.tax_treatment], ['US', 'US12-3456789', 'other', 'export'])
  // La plaza de lanzamiento va igual en todos.
  assert.ok([es, canarias, de, fr, us].every((p) => p.discounts?.length === 1))
})

test('createCheckout: con NIF-IVA, VIES antes de abrir el pago; no valido o sin respuesta, sin plaza, sin hueco y sin contar para el limite de lo mal escrito', async (t) => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const { slots } = await firstSessionSlots(d)
  // Lo mal escrito se dice antes de nada: ni VIES, ni limite por IP.
  for (let i = 0; i < 12; i++) await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'DE', vatId: 'DE12', clientIp: '1.1.1.1' }), code('vat_id_invalid'))
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'DE', clientIp: '1.1.1.1' }), code('eu_tax_id_required'))
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'JP', clientIp: '1.1.1.1' }), code('other_tax_id_required'))
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'ZZ', taxId: 'B12345674', clientIp: '1.1.1.1' }), code('country_invalid'))
  assert.equal(d.fakes.vies.checks.length, 0)
  // VIES dice que no vale: vat_invalid (que lo revise o siga sin el, con el 21 %).
  d.fakes.vies.results.set('DE123456789', 'invalid')
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', country: 'DE', vatId: 'DE123456789', session: slots[0], clientIp: '1.1.1.1' }), code('vat_invalid'))
  // VIES caido: no se vende a 0 %, que pruebe en unos minutos.
  t.mock.method(console, 'warn', () => {})
  d.fakes.vies.down = true
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', country: 'IT', vatId: 'IT12345678901', session: slots[0], clientIp: '1.1.1.1' }), code('vat_unavailable'))
  // Un VIES que revienta (en vez de contestar) es lo mismo.
  d.vies = { name: 'roto', check: async () => Promise.reject(new Error('socket hang up')) }
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'IT', vatId: 'IT12345678901', clientIp: '1.1.1.1' }), code('vat_unavailable'))
  assert.equal(d.fakes.payments.sessions.size, 0)
  assert.equal(d.fakes.calendar.reservations.size, 0)
  assert.equal(Object.keys(d.fakes.repo.state.launchSlots).length, 0)
  // Sin NIF-IVA, el mismo cliente puede seguir con el 21 %.
  const fr = await openOneTime(d, { country: 'DE', otherTaxId: '12/345/67890', clientIp: '1.1.1.1' })
  assert.deepEqual([fr.metadata.tax_id, fr.metadata.tax_treatment, fr.line_items[0].tax_rates], ['DE1234567890', 'standard', ['txr_fake_iva_21']])
})

test('createCheckout: las consultas a VIES, unas pocas por conexion (el /48 en IPv6), no por cada /64', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  d.fakes.vies.results.set('DE123456789', 'invalid')
  // Cada intento desde otro /64 de la misma conexion (una casa con un /56 tiene 256): el limite de pagos por IP no los junta.
  const from = (i: number) => createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'DE', vatId: 'DE123456789', clientIp: `2001:db8:7:${i.toString(16)}::1` })
  for (let i = 0; i < 10; i++) await assert.rejects(from(i), code('vat_invalid'))
  await assert.rejects(from(10), code('rate_limited'))
  assert.equal(d.fakes.vies.checks.length, 10)
  // Otra conexion, si; y sin NIF-IVA no cuenta (no se pregunta a VIES).
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', country: 'DE', vatId: 'DE123456789', clientIp: '2001:db8:8::1' }), code('vat_invalid'))
  assert.equal((await openOneTime(d, { country: 'DE', otherTaxId: '12/345/67890', clientIp: '2001:db8:7:ff::1' })).metadata.tax_treatment, 'standard')
  assert.equal(d.fakes.vies.checks.length, 11)
})

test('createCheckout del mensual: el IVA de la empresa guardada, con VIES otra vez si tiene NIF-IVA', async (t) => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const plan = async (c: Company) => {
    const checkout = await createCheckout(d, { product: 'plan-pro', locale: 'es', company: c })
    return d.fakes.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
  }
  const peninsula = await plan({ ...company, id: 'c-es' })
  assert.deepEqual(peninsula.subscription_data.default_tax_rates, ['txr_fake_iva_21'])
  assert.deepEqual([peninsula.subscription_data.metadata.tax_country, peninsula.subscription_data.metadata.tax_territory, peninsula.subscription_data.metadata.tax_treatment], ['ES', 'peninsula', 'standard'])
  const canarias = await plan({ ...company, id: 'c-ic', address: { ...company.address!, postal_code: '38001', city: 'Santa Cruz de Tenerife', state: 'TF' } })
  assert.equal(canarias.subscription_data.default_tax_rates, undefined)
  assert.deepEqual([canarias.subscription_data.metadata.tax_territory, canarias.subscription_data.metadata.tax_treatment], ['canarias', 'export'])
  const de = { ...company, id: 'c-de', country: 'DE', taxId: 'DE123456789', taxIdType: 'eu_vat', address: { ...company.address!, postal_code: '10115', country: 'DE' } }
  const rc = await plan(de)
  assert.deepEqual(d.fakes.vies.checks, [{ countryCode: 'DE', vatNumber: '123456789' }])
  assert.equal(rc.subscription_data.default_tax_rates, undefined)
  assert.deepEqual([rc.subscription_data.metadata.tax_treatment, rc.subscription_data.metadata.tax_id_type], ['reverse_charge', 'eu_vat'])
  assert.match(rc.subscription_data.metadata.vies_request, /^WAPIFALSO/)
  // Sin NIF-IVA (de la UE) o de fuera: el 21 % o sin IVA, sin VIES.
  assert.deepEqual((await plan({ ...de, id: 'c-de2', taxId: 'DE1234567890', taxIdType: 'other' })).subscription_data.default_tax_rates, ['txr_fake_iva_21'])
  assert.equal((await plan({ ...company, id: 'c-us', country: 'US', taxId: 'US12-3456789', taxIdType: 'otro' })).subscription_data.metadata.tax_treatment, 'export')
  assert.equal(d.fakes.vies.checks.length, 1)
  // Si VIES ya no lo da por valido, o no contesta: no se abre.
  d.fakes.vies.results.set('DE123456789', 'invalid')
  await assert.rejects(plan(de), code('vat_invalid'))
  t.mock.method(console, 'warn', () => {})
  d.fakes.vies.down = true
  await assert.rejects(plan(de), code('vat_unavailable'))
  // Cualquier pais vale (tambien Rusia, sin IVA espanol); uno que no es un codigo de pais, no.
  assert.equal((await plan({ ...company, id: 'c-ru', country: 'RU', taxId: 'RU7707083893', taxIdType: 'other' })).subscription_data.metadata.tax_treatment, 'export')
  await assert.rejects(plan({ ...company, id: 'c-xx', country: 'XX', taxIdType: 'other' }), code('country_invalid'))
  // Una empresa de antes sin pais, con NIF espanol: Espana.
  assert.equal(companyTax({ ...company, taxId: 'B12345674', country: null }).country, 'ES')
})

test('VIES: lo que contesta la API REST, la consulta que manda y, sin respuesta a tiempo, nunca valido', async () => {
  const now = new Date('2026-11-02T10:00:00Z')
  assert.deepEqual(readViesResponse(200, { countryCode: 'DE', vatNumber: '123456789', requestDate: '2026-11-02T10:00:01.000Z', valid: true, requestIdentifier: 'WAPIAAAAZ1', name: '---', address: '---' }, now), {
    status: 'valid',
    requestIdentifier: 'WAPIAAAAZ1',
    requestDate: '2026-11-02T10:00:01.000Z',
    name: null,
    address: null,
  })
  assert.deepEqual(readViesResponse(200, { valid: false, requestIdentifier: '' }, now), { status: 'invalid', reason: null })
  // Valido sin numero de consulta no vale como prueba.
  assert.equal(readViesResponse(200, { valid: true, requestIdentifier: '' }, now).status, 'unavailable')
  for (const error of ['MS_UNAVAILABLE', 'TIMEOUT', 'SERVICE_UNAVAILABLE', 'MS_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ', 'IP_BLOCKED', 'INVALID_REQUESTER_INFO']) {
    assert.deepEqual(readViesResponse(200, { actionSucceed: false, errorWrappers: [{ error, message: 'x' }] }, now), { status: 'unavailable', reason: error }, error)
  }
  assert.deepEqual(readViesResponse(400, { actionSucceed: false, errorWrappers: [{ error: 'INVALID_INPUT' }] }, now), { status: 'invalid', reason: 'INVALID_INPUT' })
  assert.equal(readViesResponse(200, { userError: 'MS_UNAVAILABLE', valid: false }, now).status, 'unavailable')
  assert.equal(readViesResponse(500, null, now).status, 'unavailable')
  assert.equal(readViesResponse(200, { valid: 'true' }, now).status, 'unavailable')

  // El adaptador de verdad: POST con el solicitante (el NIF-IVA de PymaticLabs, partido) y un tiempo maximo.
  assert.deepEqual(viesRequester(PYMATICLABS_VAT_ID), { memberState: 'ES', number: 'B88781745' })
  assert.throws(() => viesRequester('B88781745'), /VIES_REQUESTER/)
  const calls = mockFetch(() => ({ json: { valid: true, requestIdentifier: 'WAPIAAAAZ2', requestDate: '2026-11-02T10:00:00.000Z' } }))
  const vies = new ViesChecker({}, readConfig({ DELIVERY_IP_SALT: 'a'.repeat(64) }).vies)
  assert.equal((await vies.check({ countryCode: 'EL', vatNumber: '123456789' })).status, 'valid')
  assert.equal(calls[0].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number')
  assert.equal(calls[0].method, 'POST')
  assert.deepEqual(JSON.parse(calls[0].body!), { countryCode: 'EL', vatNumber: '123456789', requesterMemberStateCode: 'ES', requesterNumber: 'B88781745' })
  // Sin red, o tarda mas de la cuenta: unavailable, sin lanzar.
  globalThis.fetch = (async () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
  }) as typeof fetch
  const down = await new ViesChecker({ VIES_API_URL: 'https://vies.example.test/' }, { requester: 'ESB88781745', timeoutMs: 10 }).check({ countryCode: 'DE', vatNumber: '1' })
  assert.equal(down.status, 'unavailable')
  // Una pagina de error que no es JSON, tambien.
  mockFetch(() => ({ status: 503, body: '<html>Service Unavailable</html>' }))
  assert.equal((await vies.check({ countryCode: 'DE', vatNumber: '123456789' })).status, 'unavailable')
  // La configuracion: el solicitante y el tiempo maximo, con sus valores por defecto; VIES de verdad en vivo.
  const live = readConfig({ DELIVERY_IP_SALT: 'a'.repeat(64) })
  assert.deepEqual([live.vies, live.adapters.vies], [{ requester: 'ESB88781745', timeoutMs: 6000, testService: false }, 'vies'])
  assert.equal(readConfig({ DELIVERY_IP_SALT: 'a'.repeat(64), VIES_REQUESTER: 'es b88781745', VIES_TIMEOUT_MS: '99999' }).vies.timeoutMs, 20_000)
  assert.throws(() => readConfig({ DELIVERY_IP_SALT: 'a'.repeat(64), VIES_REQUESTER: '12' }), /VIES_REQUESTER/)
  assert.equal(readConfig({ DELIVERY_MODE: 'fake' }).adapters.vies, 'fake')
  assert.equal(devToolsEnabled(readConfig({ DELIVERY_MODE: 'fake', DELIVERY_VIES: 'vies' })), false)
  // VIES de mentira con Stripe en vivo no se monta (cualquier NIF-IVA bien escrito saldria a 0 %); con Stripe de prueba, si.
  const fakeVies = { DELIVERY_IP_SALT: 'a'.repeat(64), DELIVERY_VIES: 'fake', LICENSE_MODE: 'manual' }
  assert.throws(() => readConfig({ ...fakeVies, STRIPE_SECRET_KEY: 'sk_live_x' }), /DELIVERY_VIES=fake con Stripe en vivo/)
  assert.equal(readConfig({ ...fakeVies, STRIPE_SECRET_KEY: 'sk_test_x' }).adapters.vies, 'fake')
})

test('tras el pago: lo declarado frente a la direccion de facturacion de Stripe y el IVA cobrado', () => {
  const declared = (metadata: Record<string, string>) => declaredTax(metadata)!
  const madrid = { country: 'ES', postalCode: '28001', state: 'M', city: 'Madrid' }
  const es = declared({ tax_country: 'ES', tax_territory: 'peninsula', tax_id: 'B12345674', tax_id_type: 'es_cif', tax_treatment: 'standard' })
  assert.deepEqual(checkPaidTax({ declared: es, billing: madrid, currency: 'eur', amountTax: 20790, net: 99000 }), { treatment: 'standard', rate: 21, countryProblems: [], vatProblems: [] })
  // Canarias declarada y la direccion en Madrid (o al reves): el territorio no cuadra.
  const ic = declared({ tax_country: 'ES', tax_territory: 'canarias', tax_id: 'B12345674', tax_id_type: 'es_cif', tax_treatment: 'export' })
  assert.match(checkPaidTax({ declared: ic, billing: madrid, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /dirección en península y Baleares y antes de pagar se declaró Canarias/)
  assert.match(checkPaidTax({ declared: es, billing: { ...madrid, postalCode: '35001' }, currency: 'eur', amountTax: 20790, net: 99000 }).countryProblems.join(), /dirección en Canarias/)
  assert.deepEqual(checkPaidTax({ declared: ic, billing: { ...madrid, postalCode: '35001' }, currency: 'eur', amountTax: 0, net: 99000 }), { treatment: 'export', rate: 0, countryProblems: [], vatProblems: [] })
  assert.match(checkPaidTax({ declared: es, billing: { ...madrid, postalCode: '' }, currency: 'eur', amountTax: 20790, net: 99000 }).countryProblems.join(), /sin código postal/)
  // Otro pais que el declarado.
  const de = declared({ tax_country: 'DE', tax_id: 'DE123456789', tax_id_type: 'eu_vat', tax_treatment: 'reverse_charge', vies_request: 'WAPI1', vies_checked_at: '2026-11-02T10:00:00Z' })
  assert.deepEqual(checkPaidTax({ declared: de, billing: { country: 'DE', postalCode: '10115', state: null }, currency: 'eur', amountTax: 0, net: 99000 }), { treatment: 'reverse_charge', rate: 0, countryProblems: [], vatProblems: [] })
  assert.match(checkPaidTax({ declared: de, billing: { country: 'AT', postalCode: '1010', state: null }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /en AT y antes de pagar se declaró DE/)
  assert.match(checkPaidTax({ declared: de, billing: { country: null, postalCode: null, state: null }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /sin país/)
  // Sin la consulta a VIES, o un NIF-IVA que no es de ese pais, no se sostiene.
  assert.match(checkPaidTax({ declared: { ...de, viesRequest: null }, billing: { country: 'DE', postalCode: '10115', state: null }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /VIES/)
  assert.match(checkPaidTax({ declared: { ...de, taxId: 'FR12345678901' }, billing: { country: 'DE', postalCode: '10115', state: null }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /identificación fiscal/)
  assert.match(checkPaidTax({ declared: { ...de, treatment: 'export' }, billing: { country: 'DE', postalCode: '10115', state: null }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems.join(), /le toca «reverse_charge»/)
  // El IVA cobrado: el 21 % de la base tras el cupon (un centimo de margen) o nada.
  assert.deepEqual(checkPaidTax({ declared: es, billing: madrid, currency: 'eur', amountTax: 10501, net: 50000 }).vatProblems, [])
  assert.match(checkPaidTax({ declared: es, billing: madrid, currency: 'eur', amountTax: 0, net: 99000 }).vatProblems.join(), /el 21 % de 99000 son 20790/)
  assert.match(checkPaidTax({ declared: de, billing: { country: 'DE', postalCode: '10115', state: null }, currency: 'eur', amountTax: 20790, net: 99000 }).vatProblems.join(), /venta sin IVA español \(reverse_charge\)/)
  assert.match(checkPaidTax({ declared: es, billing: madrid, currency: 'usd', amountTax: 20790, net: 99000 }).vatProblems.join(), /cobrada en USD/)
  // Un pago de antes (sin tax_country): Espana peninsular con el 21 %, con el NIF espanol de tax_id.
  assert.deepEqual(declaredTax({ tax_id: 'B12345674' }), { country: 'ES', territory: 'peninsula', taxId: 'B12345674', taxIdType: 'es_cif', treatment: 'standard', viesRequest: null, viesCheckedAt: null, legacy: true })
  assert.equal(declaredTax({}), null)
  const us = declared({ tax_country: 'US', tax_id: 'US12-3456789', tax_id_type: 'other', tax_treatment: 'export' })
  assert.deepEqual(checkPaidTax({ declared: us, billing: { country: 'US', postalCode: '10001', state: 'NY' }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems, [])
})

// --- Remate de la venta a todo el mundo --------------------------------------------------------

test('VIES: el nombre y la direccion del titular van con el pedido (vies_name y vies_address), en una linea, recortados y sin «---»', async () => {
  // Lo que se guarda: en una linea, sin el «---» de los paises que no lo dan, y como mucho lo que admite Stripe.
  assert.equal(viesText('---'), null)
  assert.equal(viesText(' - - '), null)
  assert.equal(viesText(null), null)
  assert.equal(viesText('  Muster  GmbH '), 'Muster GmbH')
  assert.equal(viesText('Hauptstr. 1\n10115 Berlin\n'), 'Hauptstr. 1, 10115 Berlin')
  assert.equal(viesText('x'.repeat(600))!.length, STRIPE_METADATA_VALUE_MAX)
  // Sin partir en dos un caracter que ocupa dos.
  assert.equal(viesText(`${'a'.repeat(STRIPE_METADATA_VALUE_MAX - 1)}\u{1F600}b`), 'a'.repeat(STRIPE_METADATA_VALUE_MAX - 1))
  // VIES los da tal cual (sin «---»), y el adaptador de verdad los deja pasar.
  assert.deepEqual(readViesResponse(200, { valid: true, requestIdentifier: 'WAPI9', requestDate: '2026-11-02T10:00:00.000Z', name: 'MUSTER GMBH', address: 'HAUPTSTR. 1\n10115 BERLIN' }), {
    status: 'valid',
    requestIdentifier: 'WAPI9',
    requestDate: '2026-11-02T10:00:00.000Z',
    name: 'MUSTER GMBH',
    address: 'HAUPTSTR. 1\n10115 BERLIN',
  })
  // En los metadatos solo con inversion del sujeto pasivo, y solo si VIES los da.
  const de: CheckoutTax = { country: 'DE', territory: null, taxId: 'DE123456789', taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: 'DE', vatNumber: '123456789' } }
  const proof = { request: 'WAPI9', checkedAt: '2026-11-02T10:00:00.000Z', name: 'MUSTER GMBH', address: 'HAUPTSTR. 1\n10115 BERLIN' }
  assert.deepEqual(taxMetadata(de, proof), {
    tax_country: 'DE',
    tax_id: 'DE123456789',
    tax_id_type: 'eu_vat',
    tax_treatment: 'reverse_charge',
    vies_request: 'WAPI9',
    vies_checked_at: '2026-11-02T10:00:00.000Z',
    vies_name: 'MUSTER GMBH',
    vies_address: 'HAUPTSTR. 1, 10115 BERLIN',
  })
  assert.deepEqual(Object.keys(taxMetadata(de, { ...proof, name: '---', address: null })).filter((k) => k.startsWith('vies_')), ['vies_request', 'vies_checked_at'])
  assert.deepEqual(Object.keys(taxMetadata(SPAIN_TAX, proof)).filter((k) => k.startsWith('vies_')), [])

  // De punta a punta: la sesion, el pago y, en el mensual, la suscripcion.
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  d.fakes.vies.holders.set('DE123456789', { name: 'MUSTER GMBH', address: 'HAUPTSTR. 1\n10115 BERLIN' })
  const sale = await openOneTime(d, { country: 'DE', vatId: 'DE123456789' })
  assert.deepEqual([sale.metadata.vies_name, sale.metadata.vies_address], ['MUSTER GMBH', 'HAUPTSTR. 1, 10115 BERLIN'])
  // En el pago, lo mismo que en la sesion menos client_ref (la huella del cliente, solo en la sesion).
  const { client_ref: saleRef, ...saleMetadata } = sale.metadata
  assert.ok(saleRef)
  assert.deepEqual(sale.payment_intent_data.metadata, saleMetadata)
  const companyDe = { ...company, id: 'c-de', country: 'DE', taxId: 'DE123456789', taxIdType: 'eu_vat', address: { ...company.address!, postal_code: '10115', country: 'DE' } }
  const plan = await createCheckout(d, { product: 'plan-pro', locale: 'es', company: companyDe })
  const sub = (d.fakes.payments.sessions.get(plan.sessionId)!.params as Record<string, any>).subscription_data.metadata
  assert.deepEqual([sub.vies_name, sub.vies_address], ['MUSTER GMBH', 'HAUPTSTR. 1, 10115 BERLIN'])
  // Un pais que contesta «---» (como Espana): sin esas claves.
  const it = await openOneTime(d, { country: 'IT', vatId: 'IT12345678901', clientIp: '203.0.113.20' })
  assert.deepEqual([it.metadata.vies_request !== undefined, 'vies_name' in it.metadata, 'vies_address' in it.metadata], [true, false, false])
})

test('Monaco, territorio frances del IVA: NIF-IVA con FR comprobado en el VIES de Francia (sin IVA) o, sin el, el 21 %', async () => {
  assert.ok(isEuCountry('MC'))
  assert.equal(vatPrefix('MC'), 'FR')
  assert.deepEqual(parseEuVatId('MC', 'fr 12 345678901'), { vatId: 'FR12345678901', viesCountry: 'FR', number: '12345678901' })
  assert.equal(parseEuVatId('MC', '12345678901')?.vatId, 'FR12345678901')
  assert.equal(parseEuVatId('MC', 'MC12345678901'), null)
  assert.deepEqual([treatmentFor('MC', null, true), treatmentFor('MC', null, false)], ['reverse_charge', 'standard'])
  // Lo que se escribe en /comprar.
  assert.deepEqual(readTaxInput({ country: 'MC', vatId: 'FR12345678901' }), {
    tax: { country: 'MC', territory: null, taxId: 'FR12345678901', taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: 'FR', vatNumber: '12345678901' } },
  })
  assert.deepEqual(readTaxInput({ country: 'MC', otherTaxId: 'RCI 12S34567' }), { tax: { country: 'MC', territory: null, taxId: 'MCRCI12S34567', taxIdType: 'other', treatment: 'standard', vies: null } })
  assert.equal((readTaxInput({ country: 'MC', vatId: 'ATU12345678' }) as { error?: string }).error, 'vat_id_invalid')
  assert.equal((readTaxInput({ country: 'MC' }) as { error?: string }).error, 'eu_tax_id_required')

  // De punta a punta: VIES de Francia antes de pagar, y sin NIF-IVA el tipo del 21 %.
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const rc = await openOneTime(d, { country: 'MC', vatId: 'FR12345678901' })
  assert.deepEqual(d.fakes.vies.checks, [{ countryCode: 'FR', vatNumber: '12345678901' }])
  assert.deepEqual([rc.metadata.tax_country, rc.metadata.tax_id, rc.metadata.tax_treatment, rc.line_items[0].tax_rates], ['MC', 'FR12345678901', 'reverse_charge', undefined])
  const std = await openOneTime(d, { country: 'MC', otherTaxId: 'RCI 12S34567', clientIp: '203.0.113.21' })
  assert.deepEqual([std.metadata.tax_treatment, std.line_items[0].tax_rates], ['standard', ['txr_fake_iva_21']])

  // Tras el pago (lib/delivery/tax.ts): la direccion de facturacion en Monaco cuadra con lo declarado
  // Monaco; con el NIF-IVA frances, tambien en Francia (un solo territorio del IVA); sin el, no.
  const declared = declaredTax(rc.metadata)!
  const monaco = { country: 'MC', postalCode: '98000', state: null, city: 'Monaco' }
  assert.deepEqual(checkPaidTax({ declared, billing: monaco, currency: 'eur', amountTax: 0, net: 99000 }), { treatment: 'reverse_charge', rate: 0, countryProblems: [], vatProblems: [] })
  assert.deepEqual(checkPaidTax({ declared, billing: { ...monaco, country: 'FR' }, currency: 'eur', amountTax: 0, net: 99000 }).countryProblems, [])
  const declaredStd = declaredTax(std.metadata)!
  assert.deepEqual(checkPaidTax({ declared: declaredStd, billing: monaco, currency: 'eur', amountTax: 20790, net: 99000 }), { treatment: 'standard', rate: 21, countryProblems: [], vatProblems: [] })
  assert.match(checkPaidTax({ declared: declaredStd, billing: { ...monaco, country: 'FR' }, currency: 'eur', amountTax: 20790, net: 99000 }).countryProblems.join(), /en FR y antes de pagar se declaró MC/)
  // Al facturar y en el mensual: como Francia.
  const mc = { ...company, id: 'c-mc', country: 'MC', taxId: 'FR12345678901', taxIdType: 'eu_vat', address: { ...company.address!, postal_code: '98000', city: 'Monaco', state: null, country: 'MC' } }
  const zero = { amountSubtotal: 99000, amountDiscount: 0, amountTax: 0, currency: 'eur', taxTreatment: 'reverse_charge', taxRate: 0 } as Purchase
  assert.deepEqual(decideTax(zero, mc, { reasons: [], amountTax: null, taxIds: [] }), { treatment: 'reverse_charge', rate: 0, hold: null, vatPending: false })
  assert.deepEqual(companyTax(mc).vies, { countryCode: 'FR', vatNumber: '12345678901' })
  assert.equal(companyTax({ ...mc, taxId: 'MCRCI12S34567', taxIdType: 'other' }).treatment, 'standard')
})

test('la UE sin NIF-IVA con un NIF-IVA valido escrito como identificacion fiscal: que lo escriba como NIF-IVA; si VIES dice que no o no contesta, el 21 %', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const { slots } = await firstSessionSlots(d)
  // Con el prefijo o sin el (en casi toda la UE el numero fiscal es el mismo): VIES dice que vale, no se abre nada.
  const cases: [string, string, { countryCode: string; vatNumber: string }][] = [
    ['DE', 'DE 123 456 789', { countryCode: 'DE', vatNumber: '123456789' }],
    ['IT', '12345678901', { countryCode: 'IT', vatNumber: '12345678901' }],
    ['GR', 'EL 123456789', { countryCode: 'EL', vatNumber: '123456789' }],
    ['MC', 'FR12345678901', { countryCode: 'FR', vatNumber: '12345678901' }],
  ]
  for (const [country, otherTaxId, query] of cases) {
    d.fakes.vies.checks.length = 0
    await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', country, otherTaxId, session: slots[0], clientIp: '198.51.100.1' }), code('other_tax_id_is_vat'), country)
    assert.deepEqual(d.fakes.vies.checks, [query], country)
  }
  assert.equal(d.fakes.payments.sessions.size, 0)
  assert.equal(d.fakes.calendar.reservations.size, 0)
  assert.equal(Object.keys(d.fakes.repo.state.launchSlots).length, 0)
  // Con el, como NIF-IVA: sin IVA.
  assert.equal((await openOneTime(d, { country: 'DE', vatId: 'DE 123 456 789', clientIp: '198.51.100.2' })).metadata.tax_treatment, 'reverse_charge')
  // VIES dice que no vale, o no contesta: sigue como antes, con el 21 % (lo que se escribio, como identificacion fiscal).
  d.fakes.vies.results.set('DE987654321', 'invalid')
  const invalid = await openOneTime(d, { country: 'DE', otherTaxId: '987654321', clientIp: '198.51.100.3' })
  assert.deepEqual([invalid.metadata.tax_id, invalid.metadata.tax_id_type, invalid.metadata.tax_treatment, invalid.line_items[0].tax_rates], ['DE987654321', 'other', 'standard', ['txr_fake_iva_21']])
  d.fakes.vies.down = true
  assert.equal((await openOneTime(d, { country: 'DE', otherTaxId: 'DE 111 222 333', clientIp: '198.51.100.4' })).metadata.tax_treatment, 'standard')
  d.vies = { name: 'roto', check: async () => Promise.reject(new Error('socket hang up')) }
  assert.equal((await openOneTime(d, { country: 'DE', otherTaxId: 'DE 111 222 334', clientIp: '198.51.100.5' })).metadata.tax_treatment, 'standard')

  // Lo que no tiene la forma del NIF-IVA, o es de fuera de la UE, ni pregunta. Y cuenta para el limite
  // de consultas a VIES de la conexion: pasado, no se pregunta y sigue con el 21 %.
  const e = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z'), env: { LIMIT_CHECKOUT_PER_IP: '50', LAUNCH_LIMIT: '50', LAUNCH_CLIENT_LIMIT: '50' } })
  await openOneTime(e, { country: 'DE', otherTaxId: 'HRB 12345', clientIp: '198.51.100.9' })
  await openOneTime(e, { country: 'CH', otherTaxId: 'CHE-123.456.789', clientIp: '198.51.100.9' })
  assert.equal(e.fakes.vies.checks.length, 0)
  e.fakes.vies.results.set('DE123456789', 'invalid')
  for (let i = 0; i < 10; i++) await openOneTime(e, { country: 'DE', otherTaxId: '123456789', clientIp: '198.51.100.9' })
  assert.equal(e.fakes.vies.checks.length, 10)
  e.fakes.vies.results.delete('DE123456789')
  assert.equal((await openOneTime(e, { country: 'DE', otherTaxId: '123456789', clientIp: '198.51.100.9' })).metadata.tax_treatment, 'standard')
  assert.equal(e.fakes.vies.checks.length, 10)
})

test('launch_busy: el tope de plazas cuenta por conexion (el /56 en IPv6, la IPv4 entera) y, si salta varias veces en una hora, aviso interno', async (t) => {
  const now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  const busy = (e: unknown) => e instanceof CheckoutError && e.code === 'launch_busy'
  // En IPv4, como antes: la IP entera. En IPv6, la conexion es el /56 (lo de una casa); VIES y los huecos, el /48.
  for (const bucket of [wideIpBucket, clientIpBucket]) {
    assert.equal(bucket('1.2.3.4'), ipBucket('1.2.3.4'))
    assert.equal(bucket('::ffff:1.2.3.4'), '1.2.3.4')
    assert.equal(bucket(null), null)
  }
  assert.equal(wideIpBucket('2001:db8:7:ab::1'), '2001:0db8:0007::/48')
  assert.equal(clientIpBucket('2001:db8:7:ab::1'), '2001:0db8:0007:0000::/56')
  assert.equal(clientIpBucket('[2001:db8:7:abcd:1:2:3:4]'), '2001:0db8:0007:ab00::/56')
  assert.equal(clientIpBucket('2001:db8:7:ab99::1'), clientIpBucket('2001:db8:7:ab00::2'))
  assert.notEqual(clientIpBucket('2001:db8:7:100::1'), clientIpBucket('2001:db8:7:200::1'))
  // Una sola casa con un /56: con el /64, cinco bloques suyos apartaban las 10. Ahora, 2 plazas entre todos.
  const nifs = ['A58818501', 'B12345674', 'G28029643', cifWithControl('B7654321'), cifWithControl('A0800185')]
  const from = (i: number) => createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nifs[i], clientIp: `2001:db8:7:${i.toString(16)}::1` })
  assert.deepEqual([(await from(0)).launch, (await from(1)).launch], [true, true])
  for (const i of [2, 3, 4]) await assert.rejects(from(i), busy, `bloque ${i}`)
  assert.equal(d.fakes.payments.sessions.size, 2)
  const held = [...d.fakes.payments.sessions.keys()]
  // Otra conexion si tiene plaza, tambien otra casa del mismo operador (otro /56 del mismo /48: con el /48
  // esperaba sin motivo); en IPv4, cada IP la suya.
  assert.equal((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nifs[2], clientIp: '2001:db8:7:100::1' })).launch, true)
  assert.equal((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nifs[3], clientIp: '1.2.3.4' })).launch, true)
  assert.equal((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: nifs[4], clientIp: '1.2.3.5' })).launch, true)

  // A la tercera en una hora, un aviso a PymaticLabs con las plazas que quedan y los pagos de esa conexion; uno por hora.
  const alerts = () => d.fakes.mailer.sent.filter((m) => m.subject.startsWith('Plazas de lanzamiento'))
  assert.equal(alerts().length, 1)
  const [alert] = alerts()
  assert.equal(alert.to, d.config.alertEmail)
  assert.match(alert.subject, new RegExp(`${LAUNCH_BUSY_ALERT_AFTER} compras sin plaza en una hora`))
  assert.match(alert.text, /Plazas sin gastar: 10 de 10/)
  assert.match(alert.text, /La última: hazlo-tu: su conexión ya tenía 2 pagos abiertos con plaza \(el tope es 2\)/)
  for (const id of held) assert.ok(alert.text.includes(id), id)
  assert.match(alert.text, /Expire session/)
  await assert.rejects(from(2), busy)
  assert.equal(alerts().length, 1)

  // Con las que quedan apartadas por otros (no por su conexion), el aviso lo dice.
  const one = createFakeDelivery({ clock: () => now, env: { LAUNCH_LIMIT: '1' } })
  await createCheckout(one, { product: 'hazlo-tu', locale: 'es', taxId: nifs[0], clientIp: '9.9.9.9' })
  for (const ip of ['9.9.9.1', '9.9.9.2', '9.9.9.3']) await assert.rejects(createCheckout(one, { product: 'hazlo-tu', locale: 'es', taxId: nifs[1], clientIp: ip }), busy)
  assert.equal(one.fakes.mailer.sent.length, 1)
  assert.match(one.fakes.mailer.sent[0].text, /La última: hazlo-tu: las que quedan, apartadas por pagos a medias de otros/)
  assert.match(one.fakes.mailer.sent[0].text, /Plazas sin gastar: 1 de 1/)
  // Sin ningun id de esos pagos en el aviso (no son de su conexion): dice donde estan. En Stripe las
  // sesiones de Checkout no se buscan por metadatos; en launch_slots, si (con la conexion).
  assert.match(one.fakes.mailer.sent[0].text, /select checkout_session_id, client_hash, expires_at from launch_slots where status = 'reserved' and expires_at > now\(\)/)
  assert.ok(![...one.fakes.payments.sessions.keys()].some((id) => one.fakes.mailer.sent[0].text.includes(id)))

  // Si el correo no sale, el cliente recibe launch_busy igual (y queda en el registro).
  const down = createFakeDelivery({ clock: () => now, env: { LAUNCH_LIMIT: '1' } })
  await createCheckout(down, { product: 'hazlo-tu', locale: 'es', taxId: nifs[0], clientIp: '9.9.9.9' })
  const logged = t.mock.method(console, 'error', () => {})
  down.fakes.mailer.failures.failNext('send')
  for (const ip of ['9.9.9.1', '9.9.9.2', '9.9.9.3']) await assert.rejects(createCheckout(down, { product: 'hazlo-tu', locale: 'es', taxId: nifs[1], clientIp: ip }), busy)
  assert.equal(down.fakes.mailer.sent.length, 0)
  assert.match(String(logged.mock.calls[0].arguments[0]), /aviso de launch_busy sin enviar/)
})

test('pago a medias suyo: ademas de la conexion y el NIF, su huella exacta (client_ref: la IPv4, o el /64); quien escribe su NIF desde otro /64 no se lo cierra', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const { slots } = await firstSessionSlots(d)
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const victim = 'B12345674'
  // La empresa paga desde su /64; alguien de su misma conexion (otro /64 del /56) abre otro pago: el tope de 2.
  const first = await createCheckout(d, { product: 'acompanado', locale: 'es', taxId: victim, session: slots[0], clientIp: '2001:db8:1:100::1' })
  await createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: 'A58818501', clientIp: '2001:db8:1:101::1' })
  const params = d.fakes.payments.sessions.get(first.sessionId)!.params as Record<string, any>
  // La huella va solo en la sesion, y es distinta en cada pago (no junta en Stripe los pagos de una IP).
  assert.equal(params.metadata.client_ref, clientRef(d, '2001:db8:1:100::2', params.metadata.launch_ref))
  assert.equal(params.payment_intent_data.metadata.client_ref, undefined)
  assert.notEqual(params.metadata.client_ref, clientRef(d, '2001:db8:1:100::1', 'otra-plaza'))
  // Desde otro /64 de la conexion, con su NIF (es publico): ni la plaza ni el hueco; su pago sigue abierto.
  const intruder = '2001:db8:1:102::1'
  await assert.rejects(createCheckout(d, { product: 'hazlo-tu', locale: 'es', taxId: victim, clientIp: intruder }), code('launch_busy'))
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId: victim, session: slots[0], clientIp: intruder }), code('slot_taken'))
  assert.equal(d.fakes.payments.expiredSessions.size, 0)
  // La misma empresa desde su /64 (otra direccion del bloque): su pago a medias se cierra y el hueco y la plaza pasan al nuevo.
  const again = await createCheckout(d, { product: 'acompanado', locale: 'es', taxId: victim, session: slots[0], clientIp: '2001:db8:1:100::2' })
  assert.equal(again.launch, true)
  assert.deepEqual([...d.fakes.payments.expiredSessions], [first.sessionId])
})

test('Acompanado: la plaza se decide antes que los huecos (un launch_busy no gasta sus topes); los huecos, por el /48', async () => {
  const d = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z') })
  const { slots } = await firstSessionSlots(d)
  const code = (c: string) => (e: unknown) => e instanceof CheckoutError && e.code === c
  const reserved = (x: typeof d) => Object.values(x.fakes.repo.state.launchSlots).filter((s) => s.status === 'reserved').length
  // Diez bloques /64 de un mismo /56 (una casa), tres intentos cada uno: 2 plazas y despues launch_busy,
  // sin contar ni apartar huecos. Antes, los launch_busy contaban: rate_limited y, con el /64, el total gastado.
  const results: string[] = []
  let n = 0
  for (let b = 0; b < 10; b++) {
    for (let k = 0; k < 3; k++) {
      const slot = n < 2 ? slots[2 + n] : slots[4]
      const otherTaxId = `99-${String(++n).padStart(7, '0')}`
      results.push(await createCheckout(d, { product: 'acompanado', locale: 'es', country: 'US', otherTaxId, session: slot, clientIp: `2001:db8:abcd:ff${b}0::1` }).then((r) => (r.launch ? 'plaza' : 'lista'), (e: CheckoutError) => e.code))
    }
  }
  assert.deepEqual(results, ['plaza', 'plaza', ...Array(28).fill('launch_busy')])
  assert.equal(d.fakes.calendar.reservations.size, 2)
  // Otra casa del mismo /48 tiene su plaza y el tercer hueco del /48; la cuarta, rate_limited, y su plaza se suelta.
  assert.equal((await createCheckout(d, { product: 'acompanado', locale: 'es', taxId: 'B12345674', session: slots[1], clientIp: '2001:db8:abcd:100::1' })).launch, true)
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', taxId: 'A58818501', session: slots[5], clientIp: '2001:db8:abcd:200::1' }), code('rate_limited'))
  assert.deepEqual([d.fakes.calendar.reservations.size, reserved(d)], [3, 3])

  // Diez IPv4, tres intentos cada una: las 10 plazas con su hueco y 20 launch_busy que no cuentan. Con
  // un tope total de 11 huecos, al soltarse una plaza el siguiente aun tiene hueco; despues, busy, y su
  // plaza se suelta.
  const e = createFakeDelivery({ clock: () => new Date('2026-11-02T10:00:00Z'), env: { LIMIT_HOLDS_TOTAL: '11' } })
  const free = (await firstSessionSlots(e)).slots
  const opened: { id: string; ip: string }[] = []
  const codes: string[] = []
  for (let ip = 1; ip <= 10; ip++) {
    for (let k = 0; k < 3; k++) {
      const clientIp = `203.0.113.${ip}`
      const otherTaxId = `99-${String(++n).padStart(7, '0')}`
      codes.push(
        await createCheckout(e, { product: 'acompanado', locale: 'es', country: 'US', otherTaxId, session: free[opened.length], clientIp }).then(
          (r) => (opened.push({ id: r.sessionId, ip: clientIp }), 'plaza'),
          (err: CheckoutError) => err.code
        )
      )
    }
  }
  assert.deepEqual([codes.filter((c) => c === 'plaza').length, codes.filter((c) => c === 'launch_busy').length], [10, 20])
  assert.equal(e.fakes.calendar.reservations.size, 10)
  // Con las 10 apartadas, quien llega espera (launch_busy), no «busy».
  await assert.rejects(createCheckout(e, { product: 'acompanado', locale: 'es', taxId: 'B12345674', session: free[12], clientIp: '198.51.100.7' }), code('launch_busy'))
  const open = { CHECKOUT_OPEN: 'true' }
  assert.equal(await cancelCheckout(e, opened[0].id, opened[0].ip, open), true)
  assert.equal((await createCheckout(e, { product: 'acompanado', locale: 'es', taxId: 'B12345674', session: free[12], clientIp: '198.51.100.7' })).launch, true)
  assert.equal(await cancelCheckout(e, opened[1].id, opened[1].ip, open), true)
  await assert.rejects(createCheckout(e, { product: 'acompanado', locale: 'es', taxId: 'A58818501', session: free[13], clientIp: '198.51.100.8' }), code('busy'))
  assert.deepEqual([e.fakes.calendar.reservations.size, reserved(e)], [9, 9])
})

test('la vuelta desde Stripe sin pagar vuelve a /comprar con el pais y el territorio elegidos, si son de la lista', () => {
  const back = (query: string) => cancelReturnPath(new URLSearchParams(query))
  assert.equal(back('pago=cs_1&producto=acompanado&locale=en&pais=ES&territorio=canarias'), '/en/comprar/acompanado?pais=ES&territorio=canarias')
  assert.equal(back('pago=cs_1&producto=hazlo-tu&locale=es&pais=DE'), '/comprar/hazlo-tu?pais=DE')
  // El territorio, solo en Espana; lo que no es de la lista (la URL la escribe cualquiera), fuera.
  assert.equal(back('producto=hazlo-tu&locale=es&pais=DE&territorio=canarias'), '/comprar/hazlo-tu?pais=DE')
  assert.equal(back('producto=hazlo-tu&locale=es&pais=ES&territorio=andorra'), '/comprar/hazlo-tu?pais=ES')
  assert.equal(back('producto=hazlo-tu&locale=es&pais=RU'), '/comprar/hazlo-tu?pais=RU') // se vende a cualquier pais
  assert.equal(back('producto=hazlo-tu&locale=es&pais=XX'), '/comprar/hazlo-tu')
  assert.equal(back('producto=hazlo-tu&locale=es&pais=de'), '/comprar/hazlo-tu')
  assert.equal(back('producto=hazlo-tu&pais=%22%3E%3Cscript%3E'), '/comprar/hazlo-tu')
  assert.equal(back('producto=hazlo-tu'), '/comprar/hazlo-tu')
  assert.equal(back('producto=plan-pro&locale=en&pais=ES'), '/en/precios')
  // Lo que pone el pago en cancel_url: el pais siempre, el territorio solo en Espana.
  const base = { siteUrl: 'https://x', product: 'hazlo-tu' as const, priceId: 'p', expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null, locale: 'es' as const }
  const us = oneTimeSessionParams({ ...base, taxRateId: null, tax: { country: 'US', territory: null, taxId: 'US12-3456789', taxIdType: 'other', treatment: 'export', vies: null } }) as Record<string, any>
  assert.equal(us.cancel_url, 'https://x/api/checkout/cancel?pago={CHECKOUT_SESSION_ID}&producto=hazlo-tu&locale=es&pais=US')
  const melilla = oneTimeSessionParams({ ...base, taxRateId: null, tax: { ...SPAIN_TAX, territory: 'melilla', treatment: 'export' } }) as Record<string, any>
  assert.equal(back(new URL(melilla.cancel_url).search), '/comprar/hazlo-tu?pais=ES&territorio=melilla')
})

test('VIES: el servicio de prueba (VIES_TEST_SERVICE=true), solo con Stripe de prueba y fuera de produccion', async () => {
  const SALT = { DELIVERY_IP_SALT: 'a'.repeat(64) }
  const calls = mockFetch(() => ({ json: { valid: true, requestIdentifier: 'WAPITEST1', requestDate: '2026-11-02T10:00:00.000Z' } }))
  const testing = readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_test_x', VIES_TEST_SERVICE: 'true' })
  assert.equal(testing.vies.testService, true)
  assert.equal((await new ViesChecker({}, testing.vies).check({ countryCode: 'RO', vatNumber: '100' })).status, 'valid')
  assert.equal(calls[0].url, 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-test-service')
  assert.deepEqual(JSON.parse(calls[0].body!), { countryCode: 'RO', vatNumber: '100', requesterMemberStateCode: 'ES', requesterNumber: 'B88781745' })
  // VIES_API_URL cambia solo la direccion base; la ruta la pone el adaptador.
  await new ViesChecker({ VIES_API_URL: 'https://vies.example.test/api/' }, { ...testing.vies, testService: false }).check({ countryCode: 'RO', vatNumber: '100' })
  assert.equal(calls[1].url, 'https://vies.example.test/api/check-vat-number')
  // En /comprar se prueba con Rumania (su NIF-IVA admite tres cifras): RO100, RO200...
  assert.equal(parseEuVatId('RO', 'RO100')?.number, '100')
  // Con Stripe en vivo, o en produccion, no se monta: daria por valido un NIF-IVA sin mirarlo.
  assert.throws(() => readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_live_x', VIES_TEST_SERVICE: 'true' }), /VIES_TEST_SERVICE=true con Stripe en vivo o en produccion/)
  assert.throws(() => readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_test_x', VIES_TEST_SERVICE: 'true', VERCEL_ENV: 'production' }), /VIES_TEST_SERVICE/)
  assert.throws(() => readConfig({ ...SALT, VIES_TEST_SERVICE: 'si' }), /VIES_TEST_SERVICE=si: tiene que ser true o false/)
  assert.equal(readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_live_x', VIES_TEST_SERVICE: 'false' }).vies.testService, false)
  // Ni VIES_API_URL: con un «?» al final dejaba fuera la ruta del adaptador y llevaba al servicio de
  // prueba aunque VIES_TEST_SERVICE fuera false (u otro servidor que lo da todo por valido).
  const sneaky = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-test-service?'
  await new ViesChecker({ VIES_API_URL: sneaky }, { ...testing.vies, testService: false }).check({ countryCode: 'RO', vatNumber: '100' })
  assert.equal(new URL(calls[2].url).pathname, '/taxation_customs/vies/rest-api/check-vat-test-service')
  assert.throws(() => readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_live_x', VIES_API_URL: sneaky }), /VIES_API_URL=.* con Stripe en vivo o en produccion/)
  assert.throws(() => readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_test_x', VERCEL_ENV: 'production', VIES_API_URL: 'https://vies.example.test' }), /VIES_API_URL/)
  assert.equal(readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_live_x', VIES_API_URL: 'https://ec.europa.eu/taxation_customs/vies/rest-api/' }).stripeLive, true)
  assert.equal(readConfig({ ...SALT, STRIPE_SECRET_KEY: 'sk_test_x', VIES_API_URL: 'https://vies.example.test' }).stripeLive, false)
})
