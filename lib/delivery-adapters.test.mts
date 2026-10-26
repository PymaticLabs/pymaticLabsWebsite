import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign as edSign } from 'node:crypto'
import { GcpKmsSigner } from './delivery/adapters/gcp-kms-signer.ts'
import { HoldedInvoicer } from './delivery/adapters/holded-invoicer.ts'
import { BrevoMailer, brevoAttachments } from './delivery/adapters/brevo-mailer.ts'
import { CalcomCalendar } from './delivery/adapters/calcom-calendar.ts'
import { StripePayments } from './delivery/adapters/stripe-payments.ts'
import { SupabaseStorage } from './delivery/adapters/supabase-storage.ts'
import { SupabaseRepository } from './delivery/adapters/supabase-repository.ts'
import { FakeCalendar } from './delivery/adapters/fakes.ts'
import { issueLicense } from './delivery/license-issue.ts'
import { devToolsEnabled, readConfig } from './delivery/config.ts'
import { crc32c, madridTimeToUtc, normalizeTaxId, cleanCompanyName } from './delivery/util.ts'
import { unzip, zip } from './delivery/zip.ts'
import { createFakeDelivery } from './delivery/container.ts'
import { CheckoutError, createCheckout, firstSessionSlots, oneTimeSessionParams, planSessionParams, trialEndFor } from './checkout.ts'
import { PermanentError, RetryableError, SlotUnavailableError, type Company } from './delivery/types.ts'
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
    reference: 'Cerebro Digital · Hazlo tú · pi_1',
    date: '2026-11-02',
    currency: 'eur',
    language: 'es',
    taxTreatment: 'standard',
    taxRate: 21,
    lines: [{ name: 'Cerebro Digital · Hazlo tú', description: null, units: 1, price: 990 }],
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
    if (call.url.includes('/invoices?')) return { json: { items: [{ id: 'inv9', description: 'Cerebro Digital · Hazlo tú · pi_9' }] } }
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

test('Checkout de pago unico: NIF obligatorio, direccion, Stripe Tax, condiciones, cupon y metadatos', () => {
  const params = oneTimeSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'acompanado',
    priceId: 'price_1',
    locale: 'en',
    currency: 'eur',
    expiresAt: 1_800_000_000,
    terms: { version: '2026-10-09', sha256: 'f'.repeat(64) },
    launchRef: 'ref-1',
    slot: { host: 'sergio', start: '2026-11-03T17:00:00.000Z' },
    reservationId: 'res-1',
  }) as Record<string, any>
  assert.equal(params.mode, 'payment')
  assert.deepEqual(params.tax_id_collection, { enabled: true, required: 'if_supported' })
  assert.equal(params.billing_address_collection, 'required')
  assert.deepEqual(params.automatic_tax, { enabled: true })
  assert.deepEqual(params.consent_collection, { terms_of_service: 'required' })
  assert.deepEqual(params.name_collection, { business: { enabled: true, optional: false } })
  assert.equal(params.customer_creation, 'always')
  assert.equal(params.locale, 'en')
  assert.deepEqual(params.discounts, [{ coupon: 'cerebro-lanzamiento-acompanado' }])
  assert.match(params.custom_text.terms_of_service_acceptance.message, /\(https:\/\/pymaticlabs\.com\/en\/condiciones\)/)
  assert.deepEqual(params.metadata, {
    product: 'acompanado',
    seats: '1',
    locale: 'en',
    terms_version: '2026-10-09',
    terms_sha256: 'f'.repeat(64),
    launch_ref: 'ref-1',
    session_host: 'sergio',
    session_start: '2026-11-03T17:00:00.000Z',
    calendar_reservation: 'res-1',
  })
  assert.deepEqual(params.payment_intent_data.metadata, params.metadata)
  assert.deepEqual(params.custom_fields.map((f: { key: string }) => f.key), ['novedades'])
  // Solo tarjeta: nada de pagos que quedan pendientes (la plaza y el hueco caducarian antes de cobrar).
  assert.deepEqual(params.payment_method_types, ['card'])
  assert.equal(params.success_url, 'https://pymaticlabs.com/en/gracias?pago={CHECKOUT_SESSION_ID}')
  assert.match(params.custom_text.submit.message, /the license, right away\.$/)
  const team = oneTimeSessionParams({ siteUrl: 'https://x', product: 'hazlo-tu-equipo', priceId: 'p', locale: 'es', currency: 'usd', expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null }) as Record<string, any>
  assert.match(team.custom_text.submit.message, /la licencia, al momento\.$/)
  // Con las licencias a mano, la pagina de pago dice lo mismo que /gracias: en unas horas.
  const manual = oneTimeSessionParams({ siteUrl: 'https://x', product: 'hazlo-tu', priceId: 'p', locale: 'es', currency: 'eur', expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null, manualLicense: true }) as Record<string, any>
  assert.match(manual.custom_text.submit.message, /la licencia, en unas horas\.$/)
  const manualEn = oneTimeSessionParams({ siteUrl: 'https://x', product: 'hazlo-tu', priceId: 'p', locale: 'en', currency: 'eur', expiresAt: 1, terms: { version: 'v', sha256: 's' }, launchRef: null, slot: null, reservationId: null, manualLicense: true }) as Record<string, any>
  assert.match(manualEn.custom_text.submit.message, /the license, within a few hours\.$/)
  assert.equal(team.metadata.seats, '10')
  assert.equal(team.discounts, undefined)
  assert.equal(team.currency, 'usd')
  // En dolares, el EIN en un campo propio y obligatorio (Checkout no pide NIF en Estados Unidos).
  const ein = team.custom_fields.find((f: { key: string }) => f.key === 'nif')
  assert.equal(ein.type, 'text')
  assert.equal(ein.optional, false)
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

test('Checkout del mensual: con su cliente de Stripe y los meses incluidos como prueba', () => {
  const now = new Date('2026-11-02T10:00:00Z')
  assert.equal(trialEndFor('2027-02-02', now), Math.floor(Date.parse('2027-02-02T23:00:00Z') / 1000))
  assert.equal(trialEndFor('2026-11-03', now), null) // menos de 48 horas
  assert.equal(trialEndFor(null, now), null)
  const params = planSessionParams({
    siteUrl: 'https://pymaticlabs.com',
    product: 'plan-pro',
    priceId: 'price_pro',
    locale: 'es',
    company,
    expiresAt: 1,
    trialEnd: 1_800_000_000,
    terms: { version: 'v', sha256: 's' },
  }) as Record<string, any>
  assert.equal(params.mode, 'subscription')
  assert.equal(params.customer, 'cus_1')
  // El NIF y el nombre, los de la compra: ni se piden ni se cambian al contratar el mensual.
  assert.deepEqual(params.customer_update, { address: 'auto' })
  assert.equal(params.tax_id_collection, undefined)
  assert.equal(params.subscription_data.trial_end, 1_800_000_000)
  assert.equal(params.subscription_data.metadata.company_id, 'c1')
  assert.equal(params.success_url, 'https://pymaticlabs.com/zona?mensual=ok')
})

test('createCheckout: el Acompanado exige un hueco libre y lo aparta; el mensual, ser cliente', async () => {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es' }), (e: unknown) => e instanceof CheckoutError && e.code === 'session_required')
  const { slots } = await firstSessionSlots(d)
  const checkout = await createCheckout(d, { product: 'acompanado', locale: 'es', session: slots[0] })
  assert.equal(checkout.launch, true)
  assert.equal(d.fakes.calendar.reservations.size, 1)
  // Otro cliente, el mismo hueco: ya no esta libre.
  await assert.rejects(createCheckout(d, { product: 'acompanado', locale: 'es', session: slots[0] }), (e: unknown) => e instanceof CheckoutError && e.code === 'slot_taken')
  await assert.rejects(createCheckout(d, { product: 'plan-pro', locale: 'es' }), (e: unknown) => e instanceof CheckoutError && e.code === 'company_required')
  await assert.rejects(createCheckout(d, { product: 'nada', locale: 'es' }), (e: unknown) => e instanceof CheckoutError && e.code === 'product')
  const plan = await createCheckout(d, { product: 'plan-esencial', locale: 'es', company: { ...company, id: 'c-sin-licencia' } })
  assert.ok(plan.url.includes('/api/dev/checkout'))
  // La copia de las condiciones de la version vigente queda guardada al abrir el primer pago.
  assert.ok([...d.fakes.storage.files.keys()].some((k) => /^customer-files\/condiciones\/\d{4}-\d{2}-\d{2}\/es\.html$/.test(k)))
  now = new Date(now.getTime() + 1000)
})

test('createCheckout: el precio de lanzamiento, 10 plazas en total y no mas de 2 abiertas por IP', async () => {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now })
  const same = await Promise.all([1, 2, 3].map(() => createCheckout(d, { product: 'hazlo-tu', locale: 'es', clientIp: '1.2.3.4' })))
  assert.deepEqual(same.map((c) => c.launch), [true, true, false])
  const others = []
  for (let i = 0; i < 10; i++) others.push(await createCheckout(d, { product: 'hazlo-tu', locale: 'es', clientIp: `9.9.9.${i}` }))
  assert.equal(others.filter((c) => c.launch).length, 8)
  // Los pagos que no se completan sueltan su plaza al caducar.
  now = new Date(now.getTime() + 40 * 60_000)
  assert.equal((await createCheckout(d, { product: 'hazlo-tu', locale: 'es', clientIp: '7.7.7.7' })).launch, true)
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
