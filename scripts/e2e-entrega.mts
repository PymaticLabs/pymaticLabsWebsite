// Prueba de punta a punta de la entrega automatica, contra la web de verdad (next start) en modo
// falso: sin Stripe, Holded, KMS, Supabase, Brevo, Cal.com ni VIES. Manda avisos de Stripe firmados
// con el secreto de prueba y recorre por las rutas de la web (/comprar -> /api/checkout -> pagina de
// pago de prueba) el IVA de cada caso (se vende a todo el mundo, solo a empresas: los socios,
// 27-10-2026): Espana peninsular con el 21 %, Canarias sin IVA, una empresa de la UE con NIF-IVA
// valido en VIES (inversion del sujeto pasivo), una de la UE sin NIF-IVA con el 21 %, una de fuera
// de la UE sin IVA, Monaco con NIF-IVA frances (como Francia) y un NIF-IVA que VIES da a otro
// nombre (se entrega; la factura, en borrador); un NIF-IVA que VIES rechaza, VIES caido y un NIF-IVA
// escrito como identificacion fiscal no abren el pago; la vuelta desde Stripe sin pagar lleva a
// /comprar con el pais elegido; una direccion de facturacion que no cuadra con lo declarado, un IVA
// cobrado que no toca o una venta de fuera de la UE con tarjeta espanola va a revisar; con las
// plazas de lanzamiento apartadas por pagos a medias, launch_busy. Despues entra en la zona con el
// codigo del buzon, publica una version, cobra el mensual (tambien el de la empresa de la UE, con
// VIES otra vez); con las ventas a la UE sin NIF-IVA en 7.901 euros, lo que pasaria de 8.000 no abre
// el pago (ni en /comprar ni en la zona) y el mensual que ya hay sigue cobrando con aviso urgente;
// devuelve un pago, concilia y mira que las notas de las facturas solo lleven la consulta de VIES.
//
//   pnpm build && node scripts/e2e-entrega.mts --start
//
// Con --start levanta `next start` en el puerto 3101 con el entorno de prueba y lo para al acabar.
// Sin el, usa E2E_BASE_URL y los mismos secretos (STRIPE_WEBHOOK_SECRET, JOBS_SECRET, ADMIN_SECRET)
// que la web que ya este corriendo con DELIVERY_MODE=fake y CHECKOUT_OPEN=true.
//
// Despues, las licencias a mano (LICENSE_MODE=manual, como ira en produccion hasta que el producto
// acepte la clave de la web): con --start, otra web en el puerto siguiente; sin el, la de
// E2E_MANUAL_BASE_URL (con LICENSE_MANUAL_PUBLIC_KEY de la clave de E2E_MANUAL_SEED), o se salta.
// Compra, correo a Eric con los campos, scripts/subir-licencia.mts contra la web, correo al cliente
// con la licencia, descarga desde la zona y el cobro del mensual.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeCharge, fakeCheckoutSession, fakeEvent, fakeInvoice, signPayload } from '../lib/delivery/fake-stripe.ts'
import { priceCents } from '../lib/delivery/products.ts'
import { cifWithControl } from '../lib/delivery/checkout-nif.ts'
import { paidUntil, withUnpaidMargin } from '../lib/delivery/util.ts'
import { unzip } from '../lib/delivery/zip.ts'
import { privateKeyFromSeed, rawPublicKey, signLicense, verifyLicense, type LicenseData } from '../lib/license.ts'
import { LEGAL_VERSIONS } from '../lib/legal-versions.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const start = process.argv.includes('--start')
const port = Number(process.env.E2E_PORT || 3101)
const base = (process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '')
const manualBase = (process.env.E2E_MANUAL_BASE_URL || (start ? `http://127.0.0.1:${port + 1}` : '')).replace(/\/+$/, '')
const secrets = {
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_solo_pruebas',
  JOBS_SECRET: process.env.JOBS_SECRET || 'e2e-jobs-solo-pruebas',
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'e2e-admin-solo-pruebas',
}
const fakeDir = process.env.DELIVERY_FAKE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'entrega-e2e-'))
const manualDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entrega-e2e-manual-'))
// "La clave del Mac de Eric" de la prueba: una de pruebas (la de verdad no sale de su Mac).
const ericSeed =
  process.env.E2E_MANUAL_SEED ||
  (() => {
    const der = generateKeyPairSync('ed25519').privateKey.export({ format: 'der', type: 'pkcs8' })
    return der.subarray(der.length - 32).toString('base64')
  })()
const ericPublic = rawPublicKey(privateKeyFromSeed(ericSeed))
const ericEmail = 'eric@e2e.test'

// Identificaciones fiscales bien escritas, distintas en cada pasada (companies.tax_id es unico): CIF
// espanoles con su letra o digito de control, NIF-IVA con la forma de su pais y las de fuera de la UE.
const run = String(Date.now()).slice(-6)
// n de 0 a 9; letter, la de la forma de la sociedad (B, limitada; A, anonima).
const cif = (n: number, letter = 'B') => cifWithControl(`${letter}${n}${run}`)

// Cada comprador desde su IP (X-Forwarded-For, de 203.0.113.0/24, la de documentacion): como en la
// web de verdad, los limites por IP y las plazas de lanzamiento cuentan por cada uno.
let ipSeq = 0
const nextIp = () => `203.0.113.${++ipSeq}`

const servers: ChildProcess[] = []
// La web a la que hablan las ayudas de abajo: la de siempre y, despues, la de las licencias a mano.
let site = base
let step = 0
function log(message: string) {
  console.log(`  ${String(++step).padStart(2, '0')}. ${message}`)
}

async function startServer(url: string, listen: number, env: Record<string, string>) {
  const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
  // Sin -H: con -H 127.0.0.1, el middleware de idiomas reescribe a localhost y entra en bucle.
  const server = spawn(process.execPath, [next, 'start', '-p', String(listen)], {
    cwd: root,
    env: {
      ...process.env,
      ...secrets,
      NODE_ENV: 'production',
      DELIVERY_MODE: 'fake',
      DELIVERY_SITE_URL: url,
      CHECKOUT_OPEN: 'true',
      VERCEL_ENV: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  servers.push(server)
  const output: string[] = []
  server.stdout?.on('data', (chunk) => output.push(String(chunk)))
  server.stderr?.on('data', (chunk) => output.push(String(chunk)))
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${url}/api/dev/state`)
      if (res.ok) return
    } catch {
      // aun arrancando
    }
    if (server.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`next start no arranco:\n${output.join('')}`)
}

/** scripts/subir-licencia.mts contra la web de las licencias a mano, como lo correria Eric. */
function uploadScript(args: string[], env: Record<string, string> = {}) {
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', 'subir-licencia.mts'), '--web', site, ...args], {
    cwd: root,
    env: { ...process.env, ADMIN_SECRET: secrets.ADMIN_SECRET, ...env },
    encoding: 'utf-8',
  })
  return { status: run.status, out: `${run.stdout}${run.stderr}` }
}

type State = {
  db: Record<string, Record<string, any>>
  publicKey: string
  mail: { to: string; subject: string; text: string; tags: string[]; attachments: { name: string; base64: string }[] }[]
  invoicer: { documents: any[] }
  calendar: { booked: any[] }
  payments: { sessions: { id: string; params: Record<string, any> }[]; expired: string[] }
  vies: { down: boolean; checks: { countryCode: string; vatNumber: string }[] }
}

async function state(): Promise<State> {
  const res = await fetch(`${site}/api/dev/state`)
  assert.equal(res.status, 200, 'la web tiene que correr con DELIVERY_MODE=fake')
  return (await res.json()) as State
}

async function until<T>(what: string, check: (s: State) => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const value = check(await state())
    if (value) return value
    await runWorker()
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no llego: ${what}`)
}

async function runWorker() {
  const res = await fetch(`${site}/api/jobs/run`, { method: 'POST', headers: { Authorization: `Bearer ${secrets.JOBS_SECRET}` } })
  assert.equal(res.status, 200)
  return res.json()
}

async function sendEvent(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify(fakeEvent(type, object))
  const res = await fetch(`${site}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signPayload(payload, secrets.STRIPE_WEBHOOK_SECRET) },
    body: payload,
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Lo que dice el VIES de mentira (app/api/dev/vies): un NIF-IVA que no vale, VIES caido o el titular que da. */
async function setVies(body: { vatId?: string; result?: 'valid' | 'invalid' | 'unavailable'; down?: boolean; name?: string; address?: string }) {
  const res = await fetch(`${site}/api/dev/vies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal(res.status, 200, await res.clone().text())
}

/**
 * Quien compra y lo que escribe en /comprar: el pais (sin el, Espana) y, segun el, el territorio y el
 * NIF espanol, el NIF-IVA o la identificacion fiscal. ip: desde donde (por defecto, una suya).
 */
interface Buyer {
  company: string
  email: string
  country?: string
  territory?: string
  taxId?: string
  vatId?: string
  otherTaxId?: string
  locale?: 'es' | 'en'
  ip?: string
}

/** /comprar -> /api/checkout: el pago abierto en Stripe (su id) o el error con el que se vuelve a /comprar. */
async function openCheckout(product: string, buyer: Buyer, slot?: string): Promise<{ id: string; error?: undefined; back?: undefined } | { id?: undefined; error: string; back: URL }> {
  const form = new URLSearchParams({ product, locale: buyer.locale ?? 'es', country: buyer.country ?? 'ES' })
  for (const key of ['territory', 'taxId', 'vatId', 'otherTaxId'] as const) {
    const value = buyer[key]
    if (value !== undefined) form.set(key, value)
  }
  if (slot) form.set('slot', slot)
  buyer.ip ??= nextIp()
  const res = await fetch(`${site}/api/checkout`, { method: 'POST', body: form, redirect: 'manual', headers: { 'X-Forwarded-For': buyer.ip } })
  assert.equal(res.status, 303, `checkout de ${product}`)
  const location = new URL(res.headers.get('location')!, site)
  if (location.pathname === '/api/dev/checkout') {
    assert.match(location.searchParams.get('id') ?? '', /^cs_fake_/)
    return { id: location.searchParams.get('id')! }
  }
  return { error: location.searchParams.get('error') ?? '', back: location }
}

/** La direccion de facturacion en Stripe y el pais de la tarjeta (sin decirlo, sin tarjeta que mirar). */
type Billing = { country?: string; postalCode?: string; cardCountry?: string }

/**
 * La pagina de pago de prueba: la razon social, el correo y la direccion de facturacion (por defecto,
 * la del pais y el territorio declarados). De vuelta a /gracias (o, el mensual, a la zona: back).
 */
async function payOnStripe(id: string, buyer: Buyer, billing: Billing = {}, back = /\/gracias\?pago=cs_fake_/) {
  const fields = new URLSearchParams({ id, company: buyer.company, email: buyer.email })
  if (billing.country) fields.set('country', billing.country)
  if (billing.postalCode) fields.set('postalCode', billing.postalCode)
  if (billing.cardCountry) fields.set('cardCountry', billing.cardCountry)
  const pay = await fetch(`${site}/api/dev/checkout`, { method: 'POST', body: fields, redirect: 'manual' })
  assert.equal(pay.status, 303)
  assert.match(pay.headers.get('location')!, back)
}

/** El pago entero por las rutas de la web: /comprar -> /api/checkout -> pagina de pago de prueba -> /gracias. */
async function buyThroughWeb(product: string, buyer: Buyer, options: { slot?: string; billing?: Billing } = {}) {
  const opened = await openCheckout(product, buyer, options.slot)
  assert.ok(opened.id, `el pago de ${buyer.company} no se abrio: ${opened.error}`)
  await payOnStripe(opened.id, buyer, options.billing)
  return opened.id
}

/**
 * La vuelta desde Stripe sin pagar, por la cancel_url de ese pago, desde la IP de quien lo abrio: lo
 * cierra y suelta su plaza. Devuelve a donde lleva (/comprar con el pais y el territorio elegidos).
 */
async function cancelOnStripe(id: string, buyer: Buyer) {
  const url = String(sessionParams(await state(), id).cancel_url).replace('{CHECKOUT_SESSION_ID}', id)
  const res = await fetch(url, { redirect: 'manual', headers: { 'X-Forwarded-For': buyer.ip ?? '' } })
  assert.equal(res.status, 303)
  return new URL(res.headers.get('location')!, site)
}

const sessionParams = (s: State, id: string) => s.payments.sessions.find((x) => x.id === id)!.params
const purchaseOfSession = (s: State, id: string) => Object.values(s.db.purchases).find((p) => p.stripeCheckoutSessionId === id)
const companyOf = (s: State, purchase: { companyId: string | null }) => Object.values(s.db.companies).find((x) => x.id === purchase.companyId)
const invoiceOf = (s: State, purchase: { paymentRef: string }) => s.invoicer.documents.find((x) => x.kind === 'invoice' && String(x.draft.reference).endsWith(purchase.paymentRef))
const taxRatesOf = (params: Record<string, any>) => params.line_items[0].tax_rates ?? []
/** El 21 % de la base tras el cupon, como lo cobra Stripe. */
const vat21 = (p: { amountSubtotal: number; amountDiscount: number }) => Math.round(((p.amountSubtotal - p.amountDiscount) * 21) / 100)
/** Las plazas de lanzamiento que quedan: ni gastadas ni apartadas por un pago abierto. */
const launchFree = (s: State) => 10 - Object.values(s.db.launchSlots).filter((x) => x.status === 'used' || (x.status === 'reserved' && x.expiresAt > new Date().toISOString())).length

async function zoneLogin(email: string) {
  const before = (await state()).mail.filter((m) => m.tags.includes('zona-codigo') && m.to === email).length
  const login = await fetch(`${site}/api/zone/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, locale: 'es' }) })
  assert.equal(login.status, 200)
  const code = await until(`codigo para ${email}`, (s) => {
    const mails = s.mail.filter((m) => m.tags.includes('zona-codigo') && m.to === email)
    return mails.length > before ? mails[mails.length - 1].text : null
  })
  const verify = await fetch(`${site}/api/zone/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
  assert.equal(verify.status, 200)
  const cookie = verify.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  assert.ok(cookie, 'la sesion queda en una cookie')
  return (url: string, init: RequestInit = {}) => fetch(`${site}${url}`, { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), Cookie: cookie } })
}

/** Lo declarado de una empresa de Espana peninsular, como lo escribe /api/checkout en los metadatos del pago. */
const spainMetadata = (taxId: string) => ({ tax_country: 'ES', tax_territory: 'peninsula', tax_id: taxId, tax_id_type: 'es_cif', tax_treatment: 'standard' })

async function main() {
  console.log(`Entrega automatica, de punta a punta contra ${base} (modo falso)`)
  if (start) await startServer(base, port, { DELIVERY_FAKE_DIR: fakeDir })
  const ts = Date.now().toString(36)

  // 1. Un aviso firmado de Hazlo tu, repetido, y el trabajador protegido.
  const a = { company: `Taller Uno ${ts} SL`, taxId: cif(1), email: `uno-${ts}@e2e.test` }
  const prices = priceCents('hazlo-tu')
  const session = fakeCheckoutSession({ product: 'hazlo-tu', buyer: a, amountSubtotal: prices.list, metadata: { locale: 'es', ...spainMetadata(a.taxId), terms_version: LEGAL_VERSIONS.condiciones } })
  const first = await sendEvent('checkout.session.completed', session)
  assert.deepEqual([first.status, first.body.outcome], [200, 'purchase'])
  const bad = await fetch(`${base}/api/stripe/webhook`, { method: 'POST', headers: { 'Stripe-Signature': 't=1,v1=00' }, body: '{}' })
  assert.equal(bad.status, 400)
  assert.equal((await fetch(`${base}/api/jobs/run`, { method: 'POST' })).status, 401)
  log('aviso de Stripe firmado: compra apuntada; firma falsa rechazada; trabajador con secreto')

  const welcomeA = await until('bienvenida de Hazlo tu', (s) => s.mail.find((m) => m.to === a.email && m.tags.includes('bienvenida')))
  const again = await sendEvent('checkout.session.completed', session)
  assert.equal(again.status, 200)
  const zipA = welcomeA.attachments.find((x) => x.name.endsWith('.zip'))!
  const licenseText = unzip(Buffer.from(zipA.base64, 'base64'))[0].content.toString('utf-8')
  const s1 = await state()
  const licenseA = verifyLicense(licenseText, s1.publicKey)
  assert.equal(licenseA.modalidad, 'hazlo-tu')
  assert.equal(Object.values(s1.db.purchases).filter((p) => p.paymentRef === session.payment_intent).length, 1)
  assert.ok(welcomeA.attachments.some((x) => x.name.startsWith('condiciones-')))
  // El producto, con el nombre de la web (hazlo-tu es Solista; Sergio, 29-10-2026).
  assert.match(welcomeA.text, /Gracias por comprar Cerebro Digital · Solista\./)
  log(`bienvenida de Solista con la licencia ${licenseA.id} (verifica) y las condiciones; el aviso repetido no duplica`)

  // 2. La pagina de compra pide el pais y la identificacion que toca (sin JavaScript, todos los
  //    campos), y lo mal escrito vuelve a /comprar con su error, con el pais elegido, sin abrir el pago.
  const page = await (await fetch(`${base}/comprar/acompanado`)).text()
  const slot = /name="slot" value="([^"]+)"/.exec(page)?.[1]
  assert.ok(slot, 'la pagina de compra ensena huecos')
  for (const field of ['country', 'territory', 'taxId', 'vatId', 'otherTaxId']) assert.ok(page.includes(`name="${field}"`), `la pagina de compra lleva el campo ${field}`)
  assert.match(page, /<option value="ES" selected="">/, 'Espana, elegida por defecto')
  // Se vende a cualquier pais (los socios, 29-10-2026): en la lista estan todos, Rusia tambien.
  assert.ok(page.includes('<option value="RU">'), 'la lista de paises lleva todos')
  const sessionsBefore = (await state()).payments.sessions.length
  const tryCheckout = async (fields: Record<string, string>) => {
    const res = await fetch(`${base}/api/checkout`, { method: 'POST', body: new URLSearchParams({ product: 'hazlo-tu', locale: 'es', ...fields }), redirect: 'manual', headers: { 'X-Forwarded-For': '198.51.100.1' } })
    assert.equal(res.status, 303)
    return new URL(res.headers.get('location')!, base)
  }
  // Sin pais ni NIF (el boton Comprar de /precios), a /comprar, que los pide.
  assert.equal((await tryCheckout({})).pathname, '/comprar/hazlo-tu')
  const errors: [Record<string, string>, string][] = [
    [{ taxId: 'B12345678' }, '?error=tax_id_invalid'],
    [{ country: 'ES', taxId: 'DE123456789' }, '?error=tax_id_invalid&pais=ES'],
    [{ country: 'ES', territory: 'marte', taxId: a.taxId }, '?error=territory_invalid&pais=ES'],
    [{ country: 'ES', territory: 'peninsula', taxId: a.taxId, currency: 'usd' }, '?error=currency&pais=ES&territorio=peninsula'],
    [{ country: 'XX', otherTaxId: '12-3456789' }, '?error=country_invalid'],
    [{ country: 'DE', vatId: 'DE12' }, '?error=vat_id_invalid&pais=DE'],
    [{ country: 'IT', vatId: '', otherTaxId: '' }, '?error=eu_tax_id_required&pais=IT'],
    [{ country: 'US', otherTaxId: '' }, '?error=other_tax_id_required&pais=US'],
    [{ country: 'US', otherTaxId: '#?' }, '?error=other_tax_id_invalid&pais=US'],
  ]
  for (const [fields, search] of errors) assert.equal((await tryCheckout(fields)).search, search, JSON.stringify(fields))
  const errorPage = await (await fetch(`${base}/comprar/hazlo-tu?error=vat_id_invalid&pais=DE`)).text()
  assert.ok(errorPage.includes('no tiene la forma de los del país que has elegido'), 'la pagina dice el error')
  assert.match(errorPage, /<option value="DE" selected="">/, 'y vuelve con el pais elegido')
  assert.equal((await state()).payments.sessions.length, sessionsBefore, 'ningun pago abierto')
  log('/comprar: todos los paises; mal escrito, en dolares o con un pais que no existe, de vuelta con su error y el pais elegido, sin abrir el pago')

  // 3. Espana peninsular (el Acompanado, con su hueco): el NIF espanol y el 21 % del tipo fijo de Stripe.
  const b: Buyer = { company: `Gestoria Dos ${ts} SL`, taxId: cif(2), email: `dos-${ts}@e2e.test` }
  const bId = await buyThroughWeb('acompanado', b, { slot: slot.replace(/&amp;/g, '&') })
  const welcomeB = await until('bienvenida del Acompanado', (s) => s.mail.find((m) => m.to === b.email && m.tags.includes('bienvenida')))
  assert.match(welcomeB.text, /primera sesión de montaje está reservada/)
  assert.match(welcomeB.text, /\(hora de Madrid\)/)
  // El mismo hueco ya no se ofrece.
  const page2 = await (await fetch(`${base}/comprar/acompanado`)).text()
  assert.ok(!page2.includes(`value="${slot}"`))
  const sB = await until('factura del Acompanado', (s) => {
    const p = purchaseOfSession(s, bId)
    return p && invoiceOf(s, p) ? s : null
  })
  const paramsB = sessionParams(sB, bId)
  assert.deepEqual(taxRatesOf(paramsB), ['txr_fake_iva_21'])
  for (const metadata of [paramsB.metadata, paramsB.payment_intent_data.metadata]) assert.deepEqual({ ...metadata, ...spainMetadata(b.taxId!) }, metadata, 'lo declarado, en la sesion y en el pago')
  const purchaseB = purchaseOfSession(sB, bId)!
  assert.deepEqual([purchaseB.status, purchaseB.taxTreatment, purchaseB.amountTax, purchaseB.launch], ['paid', 'standard', vat21(purchaseB), true])
  const companyB = companyOf(sB, purchaseB)!
  assert.deepEqual([companyB.taxId, companyB.taxIdType, companyB.country], [b.taxId, 'es_cif', 'ES'])
  assert.deepEqual([invoiceOf(sB, purchaseB).draft.taxTreatment, invoiceOf(sB, purchaseB).draft.body], ['standard', null])
  // El cobro en Stripe y la factura, con el nombre de la web: acompanado es Duo.
  assert.equal(paramsB.payment_intent_data.description, 'Cerebro Digital · Dúo')
  assert.equal(invoiceOf(sB, purchaseB).draft.lines[0].name, 'Cerebro Digital · Dúo')
  log(`Espana peninsular: NIF espanol y el 21 % (${purchaseB.amountTax / 100} € sobre el precio de lanzamiento), hueco elegido antes de pagar, sesion reservada y en la bienvenida`)

  // 4. El IVA de cada caso, por las rutas de la web: lo declarado va en los metadatos del pago, el
  //    tipo del 21 % solo donde toca, y la factura con su mencion.
  const sale = async (buyer: Buyer, billing?: Billing) => {
    const id = await buyThroughWeb('hazlo-tu', buyer, { billing })
    await until(`bienvenida de ${buyer.company}`, (s) => s.mail.find((m) => m.to === buyer.email && m.tags.includes('bienvenida')))
    const s = await until(`aviso de la venta de ${buyer.company}`, (s) => (s.mail.some((m) => m.subject.startsWith('Venta:') && m.subject.includes(buyer.company)) ? s : null))
    const purchase = purchaseOfSession(s, id)!
    return { s, id, params: sessionParams(s, id), purchase, company: companyOf(s, purchase)!, invoice: invoiceOf(s, purchase), notice: s.mail.find((m) => m.subject.startsWith('Venta:') && m.subject.includes(buyer.company))! }
  }

  // 4a. Canarias: NIF espanol y sin IVA espanol (fuera del territorio del IVA).
  const ic: Buyer = { company: `Plataneras Tres ${ts} SL`, territory: 'canarias', taxId: cif(7), email: `canarias-${ts}@e2e.test` }
  const icSale = await sale(ic)
  assert.deepEqual(taxRatesOf(icSale.params), [])
  assert.deepEqual([icSale.params.metadata.tax_territory, icSale.params.metadata.tax_treatment], ['canarias', 'export'])
  assert.deepEqual([icSale.purchase.status, icSale.purchase.taxTreatment, icSale.purchase.amountTax], ['paid', 'export', 0])
  assert.equal(icSale.company.address.postal_code, '35001')
  assert.equal(icSale.invoice.draft.taxTreatment, 'export')
  assert.ok(icSale.invoice.draft.body.includes('Operación no sujeta a IVA por reglas de localización (art. 69.Uno.1.º de la Ley 37/1992 del IVA).'))
  assert.ok(icSale.invoice.draft.body.includes('IGIC a liquidar por el destinatario (art. 19.1.2.º a) de la Ley 20/1991).'))
  log('Canarias: NIF espanol, sin IVA (sin el tipo del 21 %) y la factura con la no sujecion por localizacion y el IGIC a cargo del cliente')

  // 4b. Una empresa de otro pais de la UE con NIF-IVA valido en VIES, en ingles: inversion del sujeto
  //     pasivo; VIES se pregunta antes de abrir el pago y su numero de consulta va con el pedido.
  const de: Buyer = { company: `Werkstatt Vier ${ts} GmbH`, country: 'DE', vatId: `DE ${run}123`, email: `de-${ts}@e2e.test`, locale: 'en' }
  const deVat = `DE${run}123`
  const checksBefore = (await state()).vies.checks.length
  const deSale = await sale(de)
  assert.deepEqual(deSale.s.vies.checks.slice(checksBefore)[0], { countryCode: 'DE', vatNumber: `${run}123` })
  assert.deepEqual(taxRatesOf(deSale.params), [])
  assert.deepEqual([deSale.params.metadata.tax_id, deSale.params.metadata.tax_id_type, deSale.params.metadata.tax_treatment], [deVat, 'eu_vat', 'reverse_charge'])
  assert.match(deSale.params.metadata.vies_request, /^WAPIFALSO\d+$/)
  assert.ok(Date.parse(deSale.params.metadata.vies_checked_at) > Date.now() - 600_000, 'la consulta, de justo antes del pago')
  assert.equal(deSale.params.payment_intent_data.metadata.vies_request, deSale.params.metadata.vies_request)
  assert.match(deSale.params.custom_text.submit.message, /^No VAT: reverse charge, with VAT number DE\d{9} checked in VIES\./)
  assert.deepEqual([deSale.purchase.status, deSale.purchase.taxTreatment, deSale.purchase.amountTax, deSale.purchase.locale], ['paid', 'reverse_charge', 0, 'en'])
  assert.deepEqual([deSale.company.taxId, deSale.company.taxIdType, deSale.company.country], [deVat, 'eu_vat', 'DE'])
  const deBody = String(deSale.invoice.draft.body)
  assert.ok(deBody.startsWith('Reverse charge.') && deBody.includes('Inversión del sujeto pasivo.') && deBody.includes(`Customer VAT number: ${deVat}`), deBody)
  assert.ok(deBody.endsWith('Supplier VAT number: ESB88781745.'), deBody)
  // Las notas salen impresas: solo la consulta de VIES (el pago de Stripe, en la descripcion).
  assert.match(String(deSale.invoice.draft.notes), new RegExp(`^VIES ${deSale.params.metadata.vies_request} \\([^)]+\\)$`))
  assert.ok(String(deSale.invoice.draft.reference).endsWith(` · ${deSale.purchase.paymentRef}`))
  assert.match(deSale.notice.text, /IVA: sin IVA: inversión del sujeto pasivo; va al modelo 349/)
  log(`UE con NIF-IVA (${deVat}): VIES antes de pagar (${deSale.params.metadata.vies_request}), sin IVA, factura con la inversion del sujeto pasivo y aviso del modelo 349`)

  // 4c. Una empresa de otro pais de la UE sin NIF-IVA: como un particular, con el 21 %, y su
  //     identificacion fiscal con el pais delante; el aviso lleva la cuenta del limite de 10.000 euros.
  const it: Buyer = { company: `Officina Cinque ${ts} SRL`, country: 'IT', vatId: '', otherTaxId: `rssmra ${run} h501u`, email: `it-${ts}@e2e.test` }
  const itSale = await sale(it)
  assert.deepEqual(taxRatesOf(itSale.params), ['txr_fake_iva_21'])
  assert.deepEqual([itSale.params.metadata.tax_id, itSale.params.metadata.tax_id_type, itSale.params.metadata.tax_treatment], [`ITRSSMRA${run}H501U`, 'other', 'standard'])
  assert.deepEqual([itSale.purchase.taxTreatment, itSale.purchase.amountTax], ['standard', vat21(itSale.purchase)])
  assert.deepEqual([itSale.company.taxIdType, itSale.company.country], ['other', 'IT'])
  assert.deepEqual([itSale.invoice.draft.taxTreatment, itSale.invoice.draft.body, itSale.invoice.draft.notes], ['standard', null, null])
  assert.match(itSale.notice.text, /Ventas a la UE sin NIF-IVA: .* este año \(límite: 10\.000,00\s€ al año\)/)
  log('UE sin NIF-IVA: con el 21 % de IVA espanol, su identificacion fiscal y la cuenta del limite de 10.000 € en el aviso')

  // 4d. Fuera de la UE: sin IVA espanol, con su identificacion fiscal.
  const us: Buyer = { company: `Workshop Six ${ts} LLC`, country: 'US', otherTaxId: `${run.slice(0, 2)}-${run}9`, email: `us-${ts}@e2e.test` }
  const usSale = await sale(us)
  assert.deepEqual(taxRatesOf(usSale.params), [])
  assert.deepEqual([usSale.params.metadata.tax_id, usSale.params.metadata.tax_treatment], [`US${run.slice(0, 2)}-${run}9`, 'export'])
  assert.deepEqual([usSale.purchase.taxTreatment, usSale.purchase.amountTax, usSale.company.country], ['export', 0, 'US'])
  assert.ok(String(usSale.invoice.draft.body).includes('Operación no sujeta al IVA español por reglas de localización (art. 69.Uno.1.º de la Ley 37/1992, del IVA).'))
  log('fuera de la UE: sin IVA, su identificacion fiscal y la factura con la no sujecion en destino')

  // 4e. Monaco va como Francia en el IVA: con su NIF-IVA frances (FR), que se pregunta al VIES de
  //     Francia, sin IVA (inversion del sujeto pasivo) y al modelo 349, con la direccion en Monaco.
  const mc: Buyer = { company: `Riviera Neuf ${ts} SAM`, country: 'MC', vatId: `FR 45 ${run} 321`, email: `mc-${ts}@e2e.test` }
  const mcVat = `FR45${run}321`
  const checksMc = (await state()).vies.checks.length
  const mcSale = await sale(mc)
  assert.deepEqual(mcSale.s.vies.checks.slice(checksMc)[0], { countryCode: 'FR', vatNumber: `45${run}321` })
  assert.deepEqual(taxRatesOf(mcSale.params), [])
  assert.deepEqual([mcSale.params.metadata.tax_country, mcSale.params.metadata.tax_id, mcSale.params.metadata.tax_id_type, mcSale.params.metadata.tax_treatment], ['MC', mcVat, 'eu_vat', 'reverse_charge'])
  assert.deepEqual([mcSale.purchase.status, mcSale.purchase.taxTreatment, mcSale.purchase.amountTax], ['paid', 'reverse_charge', 0])
  assert.deepEqual([mcSale.company.taxId, mcSale.company.taxIdType, mcSale.company.country], [mcVat, 'eu_vat', 'MC'])
  const mcBody = String(mcSale.invoice.draft.body)
  assert.ok(mcBody.startsWith('Inversión del sujeto pasivo.') && mcBody.includes(`NIF-IVA del destinatario: ${mcVat}`), mcBody)
  assert.match(mcSale.notice.text, /IVA: sin IVA: inversión del sujeto pasivo; va al modelo 349/)
  log(`Monaco con NIF-IVA frances (${mcVat}): VIES de Francia antes de pagar, sin IVA, inversion del sujeto pasivo y modelo 349`)

  // 4f. VIES da por valido el NIF-IVA, pero a nombre de otra empresa: la venta sale igual (licencia,
  //     bienvenida y zona); la factura queda en borrador con ese nombre en el motivo (sus notas salen
  //     impresas: solo la consulta), y el aviso lo dice.
  const at: Buyer = { company: `Werkstatt Elf ${ts} GmbH`, country: 'AT', vatId: `ATU${run}12`, email: `at-${ts}@e2e.test` }
  await setVies({ vatId: at.vatId!, name: 'ALPENBLICK HANDELS GMBH', address: 'Ringstraße 1\n1010 Wien' })
  const atSale = await sale(at)
  assert.deepEqual([atSale.params.metadata.vies_name, atSale.params.metadata.vies_address], ['ALPENBLICK HANDELS GMBH', 'Ringstraße 1, 1010 Wien'])
  assert.deepEqual([atSale.purchase.status, atSale.purchase.taxTreatment], ['paid', 'reverse_charge'])
  assert.ok(Object.values(atSale.s.db.licenses).some((l) => l.purchaseId === atSale.purchase.id), 'con su licencia')
  assert.ok(Object.values(atSale.s.db.members).some((m) => m.email === at.email), 'y su zona')
  const atInvoice = Object.values(atSale.s.db.invoices).find((x) => x.purchaseId === atSale.purchase.id)!
  assert.deepEqual([atInvoice.status, atSale.invoice.approved], ['draft', false])
  assert.match(atInvoice.holdReason, new RegExp(`^VIES da el NIF-IVA ATU${run}12 a nombre de «ALPENBLICK HANDELS GMBH» \\(Ringstraße 1, 1010 Wien\\), que no se parece a «${at.company}»`))
  assert.match(atInvoice.holdReason, /: comprobar con la empresa que es suyo antes de emitirla; si no lo es,/)
  assert.match(String(atSale.invoice.draft.notes), /^VIES WAPIFALSO\d+ \([^)]+\)$/)
  assert.match(atSale.notice.text, /VIES: consulta WAPIFALSO\d+, a nombre de «ALPENBLICK HANDELS GMBH», que no se parece a la razón social \(ver Qué hacer\)/)
  log('NIF-IVA valido en VIES a nombre de otra empresa: se entrega igual; la factura, en borrador con el nombre en el motivo, y el aviso lo dice')

  // 5. VIES dice que el NIF-IVA no vale: de vuelta a /comprar sin pago; sin el NIF-IVA, con el 21 %.
  const fr: Buyer = { company: `Atelier Sept ${ts} SARL`, country: 'FR', vatId: `FR12${run}789`, email: `fr-${ts}@e2e.test` }
  await setVies({ vatId: fr.vatId!, result: 'invalid' })
  const sessionsFr = (await state()).payments.sessions.length
  const rejected = await openCheckout('hazlo-tu', fr)
  assert.equal(rejected.back?.search, '?error=vat_invalid&pais=FR')
  assert.equal((await state()).payments.sessions.length, sessionsFr, 'sin pago abierto')
  const frPage = await (await fetch(rejected.back!)).text()
  assert.ok(frPage.includes('VIES, el registro europeo, dice que ese NIF-IVA no es válido'))
  const frOpened = await openCheckout('hazlo-tu', { ...fr, vatId: '', otherTaxId: `${run}789` })
  assert.ok(frOpened.id)
  const frParams = sessionParams(await state(), frOpened.id)
  assert.deepEqual([taxRatesOf(frParams), frParams.metadata.tax_treatment, frParams.metadata.tax_id_type], [['txr_fake_iva_21'], 'standard', 'other'])
  // La vuelta desde Stripe sin pagar: cierra el pago y lleva a /comprar con el pais elegido.
  const frBack = await cancelOnStripe(frOpened.id, fr)
  assert.ok((await state()).payments.expired.includes(frOpened.id), 'el pago a medias, cerrado al volver de Stripe')
  assert.equal(`${frBack.pathname}${frBack.search}`, '/comprar/hazlo-tu?pais=FR')
  assert.match(await (await fetch(frBack)).text(), /<option value="FR" selected="">/, 'de vuelta con Francia elegida')
  log('NIF-IVA que VIES rechaza: no se abre el pago y /comprar lo dice; sin el NIF-IVA, el pago con el 21 %, y al volver sin pagar, /comprar con su pais')

  // 5b. Una empresa de la UE que escribe su NIF-IVA en «Identificacion fiscal» (en Italia, la partita
  //     IVA es el mismo numero): VIES lo da por valido y /comprar le pide escribirlo como NIF-IVA, sin
  //     abrir el pago; escrito como NIF-IVA, sin IVA.
  const itVat: Buyer = { company: `Studio Dodici ${ts} SRL`, country: 'IT', vatId: '', otherTaxId: `${run}12345`, email: `it-iva-${ts}@e2e.test` }
  const before5b = await state()
  const asOther = await openCheckout('hazlo-tu', itVat)
  assert.equal(asOther.back?.search, '?error=other_tax_id_is_vat&pais=IT')
  const after5b = await state()
  assert.equal(after5b.payments.sessions.length, before5b.payments.sessions.length, 'sin pago abierto')
  assert.equal(launchFree(after5b), launchFree(before5b), 'ni plaza apartada')
  assert.deepEqual(after5b.vies.checks.at(-1), { countryCode: 'IT', vatNumber: `${run}12345` })
  assert.ok((await (await fetch(asOther.back!)).text()).includes('Escríbelo en el campo del NIF-IVA'), '/comprar dice que lo escriba como NIF-IVA')
  const asVat = await openCheckout('hazlo-tu', { ...itVat, vatId: `IT${run}12345`, otherTaxId: '' })
  assert.ok(asVat.id)
  assert.equal(sessionParams(await state(), asVat.id).metadata.tax_treatment, 'reverse_charge')
  await cancelOnStripe(asVat.id, itVat)
  log('UE con su NIF-IVA en «Identificacion fiscal»: VIES lo da por valido y /comprar pide escribirlo como NIF-IVA, sin abrir el pago; como NIF-IVA, sin IVA')

  // 6. VIES caido: no se vende a 0 %; ni pago ni plaza apartada, que pruebe en unos minutos.
  await setVies({ down: true })
  const before = await state()
  const nl: Buyer = { company: `Werkplaats Acht ${ts} BV`, country: 'NL', vatId: `NL${run}123B01`, email: `nl-${ts}@e2e.test` }
  const down = await openCheckout('hazlo-tu', nl)
  assert.equal(down.back?.search, '?error=vat_unavailable&pais=NL')
  const after = await state()
  assert.deepEqual([after.payments.sessions.length, launchFree(after)], [before.payments.sessions.length, launchFree(before)])
  assert.deepEqual(after.vies.checks.at(-1), { countryCode: 'NL', vatNumber: `${run}123B01` })
  await setVies({ down: false })
  log('VIES caido: ni pago ni plaza de lanzamiento apartada, de vuelta a /comprar con «inténtalo en unos minutos»')

  // 7. Lo que no cuadra va a revisar, sin empresa, licencia, factura ni zona: una direccion de
  //    facturacion en Canarias habiendo declarado la peninsula, un IVA cobrado que no toca y un pago
  //    de antes (sin lo declarado) con la direccion en Francia.
  const reviewed = async (what: string, paymentRef: string) => {
    await until(`aviso de ${what}`, (s) => s.mail.find((x) => /Venta a revisar/.test(x.subject) && x.text.includes(paymentRef)))
    const s = await state()
    return { s, purchase: Object.values(s.db.purchases).find((p) => p.paymentRef === paymentRef)! }
  }
  const moved: Buyer = { company: `Islas Nueve ${ts} SL`, taxId: cif(6), email: `islas-${ts}@e2e.test` }
  const movedId = await buyThroughWeb('hazlo-tu', moved, { billing: { postalCode: '35001' } })
  const movedRef = purchaseOfSession(await state(), movedId)!.paymentRef
  const movedReview = await reviewed('la venta que no cuadra', movedRef)
  assert.deepEqual([movedReview.purchase.status, movedReview.purchase.reviewData.reason], ['needs_review', 'country_mismatch'])
  assert.match(movedReview.purchase.reviewData.problems.join(), /dirección en Canarias y antes de pagar se declaró península y Baleares/)
  assert.ok(!Object.values(movedReview.s.db.companies).some((x) => x.taxId === moved.taxId), 'sin empresa')
  const usMetadata = { tax_country: 'US', tax_id: `US${run}77`, tax_id_type: 'other', tax_treatment: 'export' }
  const chargedEmail = `cobrado-${ts}@e2e.test`
  const charged = fakeCheckoutSession({ product: 'hazlo-tu', buyer: { company: `Charged Ten ${ts} Inc`, taxId: '', email: chargedEmail }, amountSubtotal: prices.list, taxRate: 21, metadata: { locale: 'en', ...usMetadata, terms_version: LEGAL_VERSIONS.condiciones } })
  assert.equal((await sendEvent('checkout.session.completed', charged)).body.outcome, 'needs-review')
  assert.equal((await reviewed('el IVA que no toca', String(charged.payment_intent))).purchase.reviewData.reason, 'vat_mismatch')
  const old = { company: `Societe Quatre ${ts} SARL`, taxId: cif(5), email: `vieja-${ts}@e2e.test` }
  const oldSession = fakeCheckoutSession({ product: 'hazlo-tu', buyer: { ...old, country: 'FR' }, amountSubtotal: prices.list, metadata: { locale: 'es', tax_id: old.taxId, terms_version: LEGAL_VERSIONS.condiciones } })
  assert.equal((await sendEvent('checkout.session.completed', oldSession)).body.outcome, 'needs-review')
  const oldReview = await reviewed('el pago de antes', String(oldSession.payment_intent))
  assert.deepEqual([oldReview.purchase.reviewData.reason, oldReview.purchase.reviewData.declared.legacy], ['country_mismatch', true])
  // Una venta sin IVA de fuera de la UE pagada con una tarjeta espanola (la segunda prueba del pais):
  // a revisar, sin rechazar la tarjeta.
  const carded: Buyer = { company: `Card Thirteen ${ts} LLC`, country: 'US', otherTaxId: `${run}-13`, email: `tarjeta-${ts}@e2e.test` }
  const cardedId = await buyThroughWeb('hazlo-tu', carded, { billing: { cardCountry: 'ES' } })
  const cardedReview = await reviewed('la tarjeta espanola', purchaseOfSession(await state(), cardedId)!.paymentRef)
  assert.deepEqual([cardedReview.purchase.status, cardedReview.purchase.reviewData.reason, cardedReview.purchase.companyId], ['needs_review', 'card_country', null])
  assert.match(cardedReview.purchase.reviewData.problems.join(), /tarjeta emitida en ES y venta sin IVA a US, fuera de la UE/)
  assert.ok(!Object.values(cardedReview.s.db.licenses).some((l) => l.purchaseId === cardedReview.purchase.id), 'sin licencia')
  for (const who of [moved.email, chargedEmail, old.email, carded.email]) {
    assert.ok(!cardedReview.s.mail.some((x) => x.to === who), `a ${who} no le llega ni la bienvenida ni la licencia`)
    assert.ok(!Object.values(cardedReview.s.db.members).some((x) => x.email === who), `${who} no entra en la zona`)
  }
  log('a revisar, con aviso y sin entregar: direccion en Canarias declarada la peninsula (country_mismatch), 21 % a una venta sin IVA (vat_mismatch), un pago de antes desde Francia y una venta de EE. UU. con tarjeta espanola (card_country)')

  // 8. Las plazas de lanzamiento que quedan, apartadas por pagos a medias de otros: el siguiente no
  //    paga el de lista, launch_busy (que pruebe en media hora); al soltarse una, se la lleva.
  const free = launchFree(await state())
  assert.ok(free > 0 && free < 10, `quedan ${free} plazas`)
  const holders: { buyer: Buyer; id: string }[] = []
  for (let i = 0; i < free; i++) {
    // El primero, de Canarias: al volver sin pagar, /comprar con el pais y el territorio.
    const holder: Buyer = { company: `A Medias ${i} ${ts} SL`, territory: i === 0 ? 'canarias' : undefined, taxId: cif(i, 'A'), email: `medias-${i}-${ts}@e2e.test` }
    const opened = await openCheckout('hazlo-tu', holder)
    assert.ok(opened.id, `pago a medias ${i}`)
    assert.ok(sessionParams(await state(), opened.id).discounts, 'con el precio de lanzamiento')
    holders.push({ buyer: holder, id: opened.id })
  }
  const late: Buyer = { company: `Llega Tarde ${ts} SL`, taxId: cif(9, 'A'), email: `tarde-${ts}@e2e.test` }
  const busy = await openCheckout('hazlo-tu', late)
  assert.equal(busy.back?.search, '?error=launch_busy&pais=ES')
  assert.ok((await (await fetch(busy.back!)).text()).includes('Vuelve a probar en media hora'))
  const canariasBack = await cancelOnStripe(holders[0].id, holders[0].buyer)
  assert.equal(`${canariasBack.pathname}${canariasBack.search}`, '/comprar/hazlo-tu?pais=ES&territorio=canarias')
  assert.match(await (await fetch(canariasBack)).text(), /<option value="canarias" selected="">/, 'de vuelta con Canarias elegida')
  const retried = await openCheckout('hazlo-tu', late)
  assert.ok(retried.id && sessionParams(await state(), retried.id).discounts, 'con una plaza suelta, el precio de lanzamiento')
  for (const held of [...holders.slice(1), { buyer: late, id: retried.id }]) await cancelOnStripe(held.id, held.buyer)
  assert.equal(launchFree(await state()), free, 'cerrados los pagos a medias, sus plazas vuelven a estar libres')
  const held = free === 1 ? 'la plaza que queda apartada por un pago a medias' : `las ${free} plazas que quedan apartadas por pagos a medias`
  log(`launch_busy: con ${held}, el siguiente espera; al cerrarse uno (vuelta a /comprar con Canarias), paga el de lanzamiento`)

  // 9. Equipo por la web, y la zona: codigo, licencia, equipo.
  const c: Buyer = { company: `Asesoria Tres ${ts} SL`, taxId: cif(3), email: `tres-${ts}@e2e.test` }
  await buyThroughWeb('hazlo-tu-equipo', c)
  await until('bienvenida del equipo', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('bienvenida')))
  const zone = await zoneLogin(c.email)
  const me = await (await zone('/api/zone/me')).json()
  assert.equal(me.role, 'owner')
  assert.equal(me.company.seats, 10)
  const licenseRes = await zone(`/api/zone/licenses/${me.licenses[0].id}`)
  assert.equal(licenseRes.status, 200)
  assert.equal(verifyLicense(await licenseRes.text(), s1.publicKey).equipo, true)
  const add = await zone('/api/zone/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company: me.company.id, email: `equipo-${ts}@e2e.test` }) })
  assert.deepEqual(await add.json(), { added: true })
  assert.equal((await fetch(`${base}/api/zone/me`)).status, 401)
  // La barra de arriba de cada pagina (estatica) pregunta quien es: sin sesion, 200 y nadie.
  assert.deepEqual(await (await fetch(`${base}/api/zone/me?perfil=1`)).json(), { available: true, user: null })
  assert.deepEqual(await (await zone('/api/zone/me?perfil=1')).json(), { available: true, user: { email: c.email, companies: [{ name: me.company.name, role: 'owner' }] } })
  log('zona: codigo por correo, sesion, licencia para volver a bajar, alta en el equipo y el perfil de la barra de arriba')

  // 10. Version nueva: ficheros en el almacen, aviso a todos, descarga con enlace firmado.
  const version = `9.${Number.parseInt(ts.slice(-4), 36) % 1000}.0`
  const names = [`cerebro-digital-${version}.mcpb`, `cerebro-digital-${version}-windows.mcpb`, `cerebro-registro-${version}-windows.zip`]
  for (const name of names) {
    const target = path.join(fakeDir, 'almacen', 'releases', 'versiones', version, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, `contenido de ${name}`)
  }
  const publish = await fetch(`${base}/api/admin/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secrets.ADMIN_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version,
      notesEs: 'Correcciones de seguridad.',
      notesEn: 'Security fixes.',
      announce: true,
      files: names.map((name, i) => ({ kind: ['mac', 'windows', 'registry'][i], fileName: name, storagePath: `versiones/${version}/${name}` })),
    }),
  })
  assert.equal(publish.status, 200, await publish.clone().text())
  await until('aviso de version', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('version')))
  const files = (await (await zone('/api/zone/me')).json()).version.files as { id: string; fileName: string }[]
  assert.equal(files.length, 3)
  const link = await (await zone(`/api/zone/downloads/${files[0].id}?json=1`)).json()
  const download = await fetch(link.url)
  assert.equal(await download.text(), `contenido de ${files[0].fileName}`)
  log(`version ${version}: aviso por correo y descarga por enlace firmado que caduca`)

  // 10b. Las paginas de la zona, pintadas en el servidor con la sesion: sin ella, a entrar.
  const anonymous = await fetch(`${base}/zona/licencia`, { redirect: 'manual' })
  assert.ok([302, 303, 307].includes(anonymous.status), `sin sesion, /zona/licencia redirige (${anonymous.status})`)
  assert.match(anonymous.headers.get('location') ?? '', /\/zona\/entrar\?volver=%2Fzona%2Flicencia$/)
  const zonePage = async (url: string) => {
    const res = await zone(url)
    assert.equal(res.status, 200, url)
    return res.text()
  }
  assert.ok((await zonePage('/zona')).includes(c.company), 'la zona dice de que empresa es')
  const downloadsPage = await zonePage('/zona/descargas')
  assert.ok(downloadsPage.includes(`/api/zone/downloads/${files[0].id}`), 'cada descarga pasa por la zona (enlace firmado al pulsar)')
  assert.ok(!downloadsPage.includes('/api/dev/storage'), 'la pagina no lleva enlaces firmados')
  assert.ok((await zonePage('/zona/equipo')).includes(`equipo-${ts}@e2e.test`))
  assert.ok((await zonePage('/zona/licencia')).includes(me.licenses[0].id))
  assert.ok((await zonePage('/en/zona/facturas')).includes('Invoices'))
  log('zona: las paginas se pintan con la sesion (inicio, licencia, descargas, equipo, facturas) y sin ella llevan a entrar')

  // 11. Mensual: un cobro da factura y licencia nueva.
  const s2 = await state()
  const companyC = Object.values(s2.db.companies).find((x) => x.taxId === c.taxId)!
  const periodEnd = Math.floor(Date.now() / 1000) + 200 * 86400
  const renewal = await sendEvent('invoice.paid', fakeInvoice({ customer: companyC.stripeCustomerId, amount: 19900, periodEnd, metadata: { product: 'plan-pro', company_id: companyC.id } }))
  assert.equal(renewal.body.outcome, 'renewal')
  await until('licencia del mensual', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('mensual')))
  const renewed = Object.values((await state()).db.licenses).filter((l) => l.companyId === companyC.id)
  assert.equal(renewed.length, 2)
  log(`mensual: cobro con licencia nueva hasta el ${renewed.map((l) => l.soporteHasta).sort().pop()}`)

  // 11a. Pasa a pagarlo por ano adelantado: el precio de 10 meses (cerebro-plan-pro-anual) y licencia
  //      de un ano, que cubre 15 dias mas (el margen de un cobro fallido: siguen las versiones nuevas).
  const yearEnd = periodEnd + 365 * 86400
  const yearly = await sendEvent('invoice.paid', fakeInvoice({ customer: companyC.stripeCustomerId, amount: priceCents('plan-pro', 'year').list, periodEnd: yearEnd, metadata: { product: 'plan-pro', period: 'year', company_id: companyC.id } }))
  assert.equal(yearly.body.outcome, 'renewal')
  const yearlyLicenses = await until('licencia del pago anual', (s) => {
    const all = Object.values(s.db.licenses).filter((l) => l.companyId === companyC.id)
    return all.length === 3 ? all : null
  })
  const yearUntil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date(yearEnd * 1000))
  const latest = yearlyLicenses.sort((x, y) => (x.soporteHasta < y.soporteHasta ? -1 : 1)).at(-1)!
  assert.deepEqual([latest.soporteHasta, paidUntil(latest)], [withUnpaidMargin(yearUntil), yearUntil])
  log(`mensual al ano: ${priceCents('plan-pro', 'year').list / 100} € sin IVA, pagado hasta el ${yearUntil} y la licencia con los 15 dias de margen (${latest.soporteHasta})`)

  // 11b. La empresa de la UE contrata el mensual desde la zona: sin IVA, con VIES otra vez antes de
  //      abrir el pago y en cada cobro, y cada factura con la inversion del sujeto pasivo.
  const companyDe = deSale.company
  const zoneDe = await zoneLogin(de.email)
  const viesBefore = (await state()).vies.checks.length
  const planRes = await zoneDe('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': de.ip! }, body: JSON.stringify({ product: 'plan-esencial', locale: 'en', company: companyDe.id, period: 'month' }) })
  assert.equal(planRes.status, 200, await planRes.clone().text())
  const planId = new URL((await planRes.json()).url).searchParams.get('id')!
  const planParams = sessionParams(await state(), planId)
  assert.equal(planParams.subscription_data.default_tax_rates, undefined, 'sin el tipo del 21 %')
  assert.deepEqual([planParams.subscription_data.metadata.tax_treatment, planParams.subscription_data.metadata.tax_id], ['reverse_charge', deVat])
  assert.match(planParams.subscription_data.metadata.vies_request, /^WAPIFALSO\d+$/)
  await payOnStripe(planId, de, {}, /\/en\/zona\?mensual=ok$/)
  const deRenewal = await until('factura del mensual de la UE', (s) => {
    const p = Object.values(s.db.purchases).find((x) => x.kind === 'renewal' && x.companyId === companyDe.id)
    return p && invoiceOf(s, p) ? { s, p } : null
  })
  assert.deepEqual([deRenewal.p.status, deRenewal.p.taxTreatment, deRenewal.p.amountTax, deRenewal.p.product], ['paid', 'reverse_charge', 0, 'plan-esencial'])
  assert.ok(String(invoiceOf(deRenewal.s, deRenewal.p).draft.body).includes(`Customer VAT number: ${deVat}`))
  assert.equal(deRenewal.s.vies.checks.slice(viesBefore).filter((q) => q.vatNumber === `${run}123`).length, 2, 'VIES al contratar y en el cobro')
  log('mensual de la empresa de la UE desde la zona: sin IVA, VIES al contratar y en el cobro, factura con la inversion del sujeto pasivo')

  // 11c. Otra compra con el NIF de la empresa del equipo, desde otro correo: a revisar, sin acceso, y aviso a su titular.
  const intruder = { company: 'Otra Cosa SL', taxId: c.taxId!, email: `otro-${ts}@e2e.test` }
  const intruderSession = fakeCheckoutSession({ product: 'hazlo-tu', buyer: intruder, amountSubtotal: prices.list, metadata: { locale: 'es', ...spainMetadata(intruder.taxId), terms_version: LEGAL_VERSIONS.condiciones } })
  assert.equal((await sendEvent('checkout.session.completed', intruderSession)).body.outcome, 'needs-review')
  await until('aviso a la titular del NIF', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('aviso-nif')))
  const s3 = await state()
  assert.ok(!Object.values(s3.db.members).some((m) => m.email === intruder.email), 'quien compro con un NIF ajeno no entra en la zona')
  assert.equal(Object.values(s3.db.companies).find((x) => x.taxId === c.taxId)!.name, c.company)
  // El portal de prueba solo vuelve a la propia web.
  const portal = await (await fetch(`${base}/api/dev/portal?return=${encodeURIComponent(`${base}.otra.example/robar`)}`)).text()
  assert.ok(!portal.includes('otra.example'))
  log('compra con el NIF de otro cliente desde otro correo: a revisar, sin acceso y con aviso a su titular')

  // 11d. La UE sin NIF-IVA (con el 21 %) cerca del limite de 10.000 euros (los socios, 30-10-2026): con
  //      las ventas asi de este ano y la de ahora por encima de 8.000, ni la licencia en /comprar ni el
  //      mensual en la zona abren el pago (eu_no_vat_limit: que escriba a info@pymaticlabs.com); con
  //      NIF-IVA, si. Los mensuales que ya hay no se cortan: desde 8.000, cada cobro con aviso urgente.
  //      Las ventas de antes, por el aviso de Stripe, con importes a medida para quedar en 7.901 euros:
  //      cabe el Esencial al mes (99 euros, justo hasta 8.000) y nada mas.
  const euTotal = (text: string) => {
    const found = /Ventas a la UE sin NIF-IVA: ([\d.]+,\d\d)\s€ este año/.exec(text)?.[1]
    assert.ok(found, text)
    return Number(found.replace(/\./g, '').replace(',', ''))
  }
  const euSale = async (n: number, amount: number) => {
    const buyer = { company: `Bottega ${n} ${ts} SRL`, taxId: '', email: `bottega-${n}-${ts}@e2e.test`, country: 'IT' }
    const metadata = { locale: 'es', tax_country: 'IT', tax_id: `ITBTG${n}${run}`, tax_id_type: 'other', tax_treatment: 'standard', terms_version: LEGAL_VERSIONS.condiciones }
    const sold = fakeCheckoutSession({ product: 'hazlo-tu', buyer, amountSubtotal: amount, metadata })
    assert.equal((await sendEvent('checkout.session.completed', sold)).body.outcome, 'purchase')
    return until(`aviso de la venta de ${buyer.company}`, (s) => s.mail.find((m) => /^(URGENTE · )?Venta:/.test(m.subject) && m.subject.includes(buyer.company)))
  }
  const soFar = euTotal((await euSale(1, prices.list)).text)
  const topped = await euSale(2, 790_100 - soFar)
  assert.equal(euTotal(topped.text), 790_100)
  assert.match(topped.subject, /^Venta:/, 'por debajo de 8.000 euros, aviso normal')
  // /comprar: una Solista (990 euros) desde Italia sin NIF-IVA pasaria de 8.000: de vuelta con el error, sin pago ni plaza.
  const itStop: Buyer = { company: `Officina Quattordici ${ts} SRL`, country: 'IT', vatId: '', otherTaxId: `bnchgv ${run} f205x`, email: `it-limite-${ts}@e2e.test` }
  const beforeStop = await state()
  const stopped = await openCheckout('hazlo-tu', itStop)
  assert.equal(stopped.back?.search, '?error=eu_no_vat_limit&pais=IT')
  const afterStop = await state()
  assert.deepEqual([afterStop.payments.sessions.length, launchFree(afterStop)], [beforeStop.payments.sessions.length, launchFree(beforeStop)], 'ni pago ni plaza apartada')
  const stopPage = await (await fetch(stopped.back!)).text()
  assert.ok(stopPage.includes('Ahora no podemos vender con IVA español a empresas de otros países de la UE'), '/comprar dice el error')
  assert.ok(stopPage.includes('escríbenos a info@pymaticlabs.com y lo resolvemos'), 'y pide escribir a info@pymaticlabs.com')
  assert.match(stopPage, /<option value="IT" selected="">/, 'con Italia elegida')
  const itWithVat = await openCheckout('hazlo-tu', { ...itStop, vatId: `IT${run}54321`, otherTaxId: '' })
  assert.ok(itWithVat.id, 'con NIF-IVA se vende')
  assert.equal(sessionParams(await state(), itWithVat.id).metadata.tax_treatment, 'reverse_charge')
  await cancelOnStripe(itWithVat.id, itStop)
  // La zona: el Esencial al ano (990 euros) pasaria de 8.000, de vuelta a /zona/mensual con el error; al mes (99), justo.
  const zoneIt = await zoneLogin(it.email)
  const subscribeIt = (period: string) =>
    zoneIt('/api/checkout', { method: 'POST', headers: { 'X-Forwarded-For': it.ip! }, body: new URLSearchParams({ product: 'plan-esencial', locale: 'es', company: itSale.company.id, period }) })
  const yearStop = await subscribeIt('year')
  assert.equal(yearStop.status, 303)
  const yearBack = new URL(yearStop.headers.get('location')!, site)
  assert.equal(`${yearBack.pathname}${yearBack.search}`, '/zona/mensual?error=eu_no_vat_limit')
  assert.ok((await (await zoneIt(`${yearBack.pathname}${yearBack.search}`)).text()).includes('Escríbenos a info@pymaticlabs.com y lo resolvemos'), '/zona/mensual dice el error')
  const monthOpen = await subscribeIt('month')
  assert.equal(monthOpen.status, 303)
  const itPlanId = new URL(monthOpen.headers.get('location')!, site).searchParams.get('id')
  assert.match(itPlanId ?? '', /^cs_fake_/, 'el Esencial al mes, justo hasta 8.000 euros, abre el pago')
  const itPlan = sessionParams(await state(), itPlanId!)
  assert.deepEqual([itPlan.subscription_data.default_tax_rates, itPlan.subscription_data.metadata.tax_treatment], [['txr_fake_iva_21'], 'standard'])
  await payOnStripe(itPlanId!, it, {}, /\/zona\?mensual=ok$/)
  // Cada cobro del mensual desde los 8.000 euros: entregado (su licencia) y con aviso urgente, que
  // dice que la web ya no abre pagos asi y que mensuales siguen cobrando.
  const itCharge = async (n: number) => {
    const s = await until(`cobro ${n} del mensual de ${it.company}`, (s) =>
      s.mail.filter((m) => m.to === it.email && m.tags.includes('mensual')).length >= n && s.mail.filter((m) => m.subject.startsWith(`URGENTE · Cobro del mensual:`) && m.subject.includes(it.company)).length >= n ? s : null
    )
    return s.mail.filter((m) => m.subject.startsWith(`URGENTE · Cobro del mensual:`) && m.subject.includes(it.company))[n - 1]
  }
  const firstCharge = await itCharge(1)
  assert.equal(euTotal(firstCharge.text), 800_000)
  assert.match(firstCharge.text, /desde 8\.000,00\s€ la web ya no abre pagos nuevos así \(piden escribir a info@pymaticlabs\.com\)/)
  const itNow = Object.values((await state()).db.companies).find((x) => x.id === itSale.company.id)!
  assert.ok(itNow.subscriptionId, 'con su mensual')
  const nextIt = await sendEvent('invoice.paid', fakeInvoice({ customer: itNow.stripeCustomerId, amount: priceCents('plan-esencial').list, periodEnd: Math.floor(Date.now() / 1000) + 62 * 86400, metadata: itPlan.metadata, subscription: itNow.subscriptionId }))
  assert.equal(nextIt.body.outcome, 'renewal', 'el mensual que ya hay no se corta')
  const secondCharge = await itCharge(2)
  assert.equal(euTotal(secondCharge.text), 809_900)
  assert.ok(secondCharge.text.includes(`siguen cobrando el 21 % (${it.company} (IT, `), secondCharge.text)
  log('UE sin NIF-IVA en 7.901 €: una Solista o el Esencial al ano pasarian de 8.000 y no abren el pago (piden escribir a info@pymaticlabs.com); con NIF-IVA si; el Esencial al mes, justo; cada cobro desde 8.000, entregado con aviso URGENTE')

  // 12. Devolucion del primero: licencia anulada y zona cerrada.
  const purchaseA = Object.values(s2.db.purchases).find((p) => p.paymentRef === session.payment_intent)!
  const refund = await sendEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchaseA.amountTotal, refunded: purchaseA.amountTotal }))
  assert.equal(refund.body.outcome, 'refund')
  await until('licencia anulada', (s) => Object.values(s.db.licenses).find((l) => l.id === licenseA.id && l.revokedAt))
  await until('correo de devolucion', (s) => s.mail.find((m) => m.to === a.email && m.tags.includes('devolucion')))
  const revocations = await (await fetch(`${base}/api/admin/revocations`, { headers: { Authorization: `Bearer ${secrets.ADMIN_SECRET}` } })).json()
  assert.ok(revocations.licencias.some((l: { id: string }) => l.id === licenseA.id))
  log('devolucion: licencia anulada (en la lista de anuladas), zona cerrada y correo al cliente')

  // 13. Conciliacion: todas las licencias con su pago; ningun paso parado.
  const report = await (await fetch(`${base}/api/jobs/reconcile`, { method: 'POST', headers: { Authorization: `Bearer ${secrets.JOBS_SECRET}` } })).json()
  assert.deepEqual(report.orphans, [])
  assert.equal(report.deadJobs, 0)
  log(`conciliacion: ${report.checkedLicenses} licencias, todas con su pago cobrado`)

  // 13b. Las notas de Holded salen impresas en el PDF (Observaciones): en todas las facturas (y las
  //      rectificativas, si las hay: con las facturas en borrador, la devolucion se rectifica a mano),
  //      solo la consulta de VIES (la inversion del sujeto pasivo) o nada. El pago de Stripe va en la
  //      descripcion, por la que un reintento la encuentra (findDocument).
  const docs = (await state()).invoicer.documents
  for (const doc of docs) {
    const { notes, reference, taxTreatment } = doc.draft
    if (taxTreatment === 'reverse_charge' && doc.kind === 'invoice') assert.match(String(notes), /^VIES WAPIFALSO\d+ \([^)]+\)$/, String(reference))
    else assert.equal(notes, null, `${reference}: ${notes}`)
    assert.match(String(reference), / · (pi|in)_\S+( · \S+)?$/, 'la descripcion lleva el pago de Stripe')
  }
  const viesNotes = docs.filter((x) => x.draft.notes).length
  log(`notas de las ${docs.length} facturas: solo la consulta de VIES (${viesNotes}) o nada; el pago de Stripe, en la descripcion`)

  // 14. La zona de muestra (para verla y sacar capturas sin Supabase): entra como la titular.
  const demo = await fetch(`${base}/api/dev/zona-demo`, { redirect: 'manual' })
  assert.equal(demo.status, 303)
  const demoCookie = demo.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ')
  const demoHome = await fetch(`${base}/zona`, { headers: { Cookie: demoCookie } })
  assert.ok((await demoHome.text()).includes('Carpintería Muñoz'), 'la zona de muestra se pinta')
  log('zona de muestra: /api/dev/zona-demo entra como la titular de Carpinteria Munoz')

  await manualLicenses(ts)

  console.log('OK: la entrega automatica funciona de punta a punta')
}

/** Lo que dice el correo a Eric: la compra y los campos (en JSON) de la licencia a firmar. */
function askedFields(text: string): { purchaseId: string; fields: Omit<LicenseData, 'id'> } {
  const purchaseId = /^Compra: (\S+)$/m.exec(text)?.[1]
  const fields = /^Campos \(JSON\): (\{.*\})$/m.exec(text)?.[1]
  assert.ok(purchaseId && fields, 'el correo a Eric lleva la compra y los campos')
  return { purchaseId, fields: JSON.parse(fields) }
}

async function manualLicenses(ts: string) {
  if (!manualBase) {
    console.log('  (sin --start ni E2E_MANUAL_BASE_URL: se saltan las licencias a mano)')
    return
  }
  if (start) {
    await startServer(manualBase, port + 1, { DELIVERY_FAKE_DIR: manualDir, LICENSE_MODE: 'manual', LICENSE_MANUAL_PUBLIC_KEY: ericPublic, LICENSE_REQUEST_EMAIL: ericEmail })
  }
  site = manualBase

  // 15. Compra con equipo: la licencia se pide a Eric y la bienvenida sale sin ella.
  const m: Buyer = { company: `Despacho Manual ${ts} SL`, taxId: cif(4), email: `manual-${ts}@e2e.test` }
  await buyThroughWeb('hazlo-tu-equipo', m)
  const welcome = await until('bienvenida a mano', (s) => s.mail.find((x) => x.to === m.email && x.tags.includes('bienvenida')))
  assert.match(welcome.text, /Tu licencia te llega en unas horas/)
  assert.ok(!welcome.attachments.some((x) => x.name.endsWith('.zip')), 'la bienvenida no lleva licencia')
  const ask = await until('la licencia pedida a Eric', (s) => s.mail.find((x) => x.to === ericEmail && /Licencia a firmar: Despacho Manual/.test(x.subject)))
  const { purchaseId, fields } = askedFields(ask.text)
  assert.deepEqual([fields.cliente, fields.nif, fields.modalidad, fields.equipo], [m.company, m.taxId, 'hazlo-tu', true])
  // Los meses incluidos y los 15 dias de margen de un cobro fallido: el correo a Eric lo explica.
  assert.match(ask.text, /^Margen: /m)
  assert.ok(ask.text.includes(`scripts/subir-licencia.mts --web ${manualBase} --compra ${purchaseId}`))
  const zone = await zoneLogin(m.email)
  const me = await (await zone('/api/zone/me')).json()
  assert.deepEqual([me.licenses.length, me.pendingLicenses.length], [0, 1])
  const pendingPage = await (await zone('/zona/licencia')).text()
  assert.ok(pendingPage.includes('Tu licencia, en camino'), 'la zona la ensena en camino')
  log('a mano: la compra pide la licencia a Eric con los campos, la bienvenida sale sin ella y la zona dice que esta en camino')

  // 16. Eric la firma (aqui, con la clave de prueba) y la sube con el script: una que no cuadra, no.
  const file = path.join(manualDir, `licencia-${ts}.cerebro-licencia`)
  const id = `PML-LIC-${fields.emitida.slice(0, 4)}-0042`
  fs.writeFileSync(file, signLicense({ id, ...fields, nif: 'B00000000' }, ericSeed, ericPublic).text)
  const wrong = uploadScript(['--compra', purchaseId, '--fichero', file])
  assert.equal(wrong.status, 1, wrong.out)
  assert.match(wrong.out, /NO SE HA SUBIDO \(409\): no cuadra con la compra: nif/)
  const text = signLicense({ id, ...fields }, ericSeed, ericPublic).text
  fs.writeFileSync(file, text)
  const good = uploadScript(['--compra', purchaseId, '--fichero', file])
  assert.equal(good.status, 0, good.out)
  assert.match(good.out, new RegExp(`OK: licencia ${id} guardada`))
  log(`a mano: subir-licencia.mts rechaza una que no cuadra (NIF) y sube la buena (${id}) contra la web`)

  // 17. El cliente la recibe en .zip y la baja de la zona; no queda ninguna sin firmar.
  const mail = await until('la licencia al cliente', (s) => s.mail.find((x) => x.to === m.email && x.tags.includes('licencia')))
  assert.equal(unzip(Buffer.from(mail.attachments.find((x) => x.name.endsWith('.zip'))!.base64, 'base64'))[0].content.toString('utf-8'), text)
  const download = await zone(`/api/zone/licenses/${id}`)
  assert.equal(download.status, 200)
  assert.equal(await download.text(), text)
  assert.equal(verifyLicense(text, ericPublic).id, id)
  const after = await (await zone('/api/zone/me')).json()
  assert.deepEqual([after.licenses.map((l: { id: string }) => l.id), after.pendingLicenses.length], [[id], 0])
  const admin = { Authorization: `Bearer ${secrets.ADMIN_SECRET}` }
  assert.deepEqual((await (await fetch(`${site}/api/admin/licenses`, { headers: admin })).json()).pedidas, [])
  assert.equal(uploadScript(['--compra', purchaseId, '--fichero', file]).status, 0, 'subirla otra vez no falla ni la repite')
  // El fichero ya es JSON: mandado tal cual con ese tipo (curl -H "Content-Type: application/json"), tambien vale.
  const asJson = await fetch(`${site}/api/admin/licenses?compra=${purchaseId}`, { method: 'POST', headers: { ...admin, 'Content-Type': 'application/json' }, body: text })
  assert.equal(asJson.status, 200, await asJson.clone().text())
  assert.equal((await asJson.json()).already, true)
  assert.equal((await state()).mail.filter((x) => x.to === m.email && x.tags.includes('licencia')).length, 1, 'sin correos de mas')
  log('a mano: el cliente recibe la licencia en .zip, la baja de la zona y no queda ninguna sin firmar')

  // 18. Un cobro del mensual: su licencia nueva se pide igual; firmada de prueba, sale el correo del mensual.
  const company = Object.values((await state()).db.companies).find((x) => x.taxId === m.taxId)!
  const periodEnd = Math.floor(Date.now() / 1000) + 120 * 86400
  const invoice = fakeInvoice({ customer: company.stripeCustomerId, amount: 9900, periodEnd, metadata: { product: 'plan-esencial', company_id: company.id } })
  assert.equal((await sendEvent('invoice.paid', invoice)).body.outcome, 'renewal')
  await until('la licencia del mensual pedida a Eric', (s) => s.mail.find((x) => x.to === ericEmail && /Licencia a firmar: Despacho Manual/.test(x.subject) && x.text.includes('Cobro del mensual')))
  const signed = uploadScript(['--compra', String(invoice.id), '--firmar-prueba'], { LICENSE_TEST_SEED: ericSeed })
  assert.equal(signed.status, 0, signed.out)
  const monthly = await until('el correo del mensual', (s) => s.mail.find((x) => x.to === m.email && x.tags.includes('mensual')))
  assert.ok(monthly.attachments.some((x) => x.name.endsWith('.zip')))
  log('a mano: el cobro del mensual pide su licencia y, firmada con --firmar-prueba, sale el correo del mensual con ella')

  // 19. La comprobacion de produccion por la web: con secreto; en modo falso, no esta lista.
  assert.equal((await fetch(`${site}/api/admin/health`)).status, 401)
  const health = await (await fetch(`${site}/api/admin/health`, { headers: admin })).json()
  assert.equal(health.ready, false)
  assert.ok(health.checks.some((c: { item: string; status: string }) => c.item === 'Entrega' && c.status === 'falta'))
  assert.ok(!JSON.stringify(health).includes(secrets.ADMIN_SECRET), 'sin secretos')
  log('comprobacion de produccion: /api/admin/health pide el secreto y, en modo falso, dice que no esta lista')
}

main()
  .then(() => (process.exitCode = 0))
  .catch((error) => {
    console.error('FALLO:', error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const server of servers) server.kill()
    if (start && !process.env.DELIVERY_FAKE_DIR) fs.rmSync(fakeDir, { recursive: true, force: true })
    fs.rmSync(manualDir, { recursive: true, force: true })
  })
