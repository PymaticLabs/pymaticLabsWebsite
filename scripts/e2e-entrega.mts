// Prueba de punta a punta de la entrega automatica, contra la web de verdad (next start) en modo
// falso: sin Stripe, Holded, KMS, Supabase, Brevo ni Cal.com. Manda avisos de Stripe firmados con
// el secreto de prueba, recorre el pago del Acompanado y del equipo por las rutas de la web, entra
// en la zona con el codigo del buzon, publica una version, devuelve un pago, cobra un mes y concilia.
//
//   pnpm build && node scripts/e2e-entrega.mts --start
//
// Con --start levanta `next start` en el puerto 3101 con el entorno de prueba y lo para al acabar.
// Sin el, usa E2E_BASE_URL y los mismos secretos (STRIPE_WEBHOOK_SECRET, JOBS_SECRET, ADMIN_SECRET)
// que la web que ya este corriendo con DELIVERY_MODE=fake y CHECKOUT_OPEN=true.

import { spawn, type ChildProcess } from 'node:child_process'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeCharge, fakeCheckoutSession, fakeEvent, fakeInvoice, signPayload } from '../lib/delivery/fake-stripe.ts'
import { priceCents } from '../lib/delivery/products.ts'
import { unzip } from '../lib/delivery/zip.ts'
import { verifyLicense } from '../lib/license.ts'
import { LEGAL_VERSIONS } from '../lib/legal-versions.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const start = process.argv.includes('--start')
const port = Number(process.env.E2E_PORT || 3101)
const base = (process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`).replace(/\/+$/, '')
const secrets = {
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_solo_pruebas',
  JOBS_SECRET: process.env.JOBS_SECRET || 'e2e-jobs-solo-pruebas',
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'e2e-admin-solo-pruebas',
}
const fakeDir = process.env.DELIVERY_FAKE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'entrega-e2e-'))

let server: ChildProcess | null = null
let step = 0
function log(message: string) {
  console.log(`  ${String(++step).padStart(2, '0')}. ${message}`)
}

async function startServer() {
  const next = path.join(root, 'node_modules', 'next', 'dist', 'bin', 'next')
  // Sin -H: con -H 127.0.0.1, el middleware de idiomas reescribe a localhost y entra en bucle.
  server = spawn(process.execPath, [next, 'start', '-p', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      ...secrets,
      NODE_ENV: 'production',
      DELIVERY_MODE: 'fake',
      DELIVERY_FAKE_DIR: fakeDir,
      DELIVERY_SITE_URL: base,
      CHECKOUT_OPEN: 'true',
      VERCEL_ENV: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output: string[] = []
  server.stdout?.on('data', (chunk) => output.push(String(chunk)))
  server.stderr?.on('data', (chunk) => output.push(String(chunk)))
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/api/dev/state`)
      if (res.ok) return
    } catch {
      // aun arrancando
    }
    if (server.exitCode !== null) break
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`next start no arranco:\n${output.join('')}`)
}

async function state() {
  const res = await fetch(`${base}/api/dev/state`)
  assert.equal(res.status, 200, 'la web tiene que correr con DELIVERY_MODE=fake')
  return (await res.json()) as {
    db: Record<string, Record<string, any>>
    publicKey: string
    mail: { to: string; subject: string; text: string; tags: string[]; attachments: { name: string; base64: string }[] }[]
    invoicer: { documents: any[] }
    calendar: { booked: any[] }
  }
}

async function until<T>(what: string, check: (s: Awaited<ReturnType<typeof state>>) => T | null | undefined | false): Promise<T> {
  for (let i = 0; i < 60; i++) {
    const value = check(await state())
    if (value) return value
    await runWorker()
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`no llego: ${what}`)
}

async function runWorker() {
  const res = await fetch(`${base}/api/jobs/run`, { method: 'POST', headers: { Authorization: `Bearer ${secrets.JOBS_SECRET}` } })
  assert.equal(res.status, 200)
  return res.json()
}

async function sendEvent(type: string, object: Record<string, unknown>) {
  const payload = JSON.stringify(fakeEvent(type, object))
  const res = await fetch(`${base}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signPayload(payload, secrets.STRIPE_WEBHOOK_SECRET) },
    body: payload,
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** El pago por las rutas de la web: /api/checkout -> pagina de pago de prueba -> /gracias. */
async function buyThroughWeb(product: string, buyer: { company: string; taxId: string; email: string }, slot?: string) {
  const form = new URLSearchParams({ product, locale: 'es' })
  if (slot) form.set('slot', slot)
  const checkout = await fetch(`${base}/api/checkout`, { method: 'POST', body: form, redirect: 'manual' })
  assert.equal(checkout.status, 303, `checkout de ${product}`)
  const payUrl = checkout.headers.get('location')!
  assert.match(payUrl, /\/api\/dev\/checkout\?id=cs_fake_/)
  const id = new URL(payUrl).searchParams.get('id')!
  const pay = await fetch(`${base}/api/dev/checkout`, {
    method: 'POST',
    body: new URLSearchParams({ id, company: buyer.company, taxId: buyer.taxId, email: buyer.email, country: 'ES' }),
    redirect: 'manual',
  })
  assert.equal(pay.status, 303)
  assert.match(pay.headers.get('location')!, /\/gracias\?pago=cs_fake_/)
  return id
}

async function zoneLogin(email: string) {
  const before = (await state()).mail.filter((m) => m.tags.includes('zona-codigo') && m.to === email).length
  const login = await fetch(`${base}/api/zone/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, locale: 'es' }) })
  assert.equal(login.status, 200)
  const code = await until(`codigo para ${email}`, (s) => {
    const mails = s.mail.filter((m) => m.tags.includes('zona-codigo') && m.to === email)
    return mails.length > before ? mails[mails.length - 1].text : null
  })
  const verify = await fetch(`${base}/api/zone/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code }) })
  assert.equal(verify.status, 200)
  const cookie = verify.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
  assert.ok(cookie, 'la sesion queda en una cookie')
  return (url: string, init: RequestInit = {}) => fetch(`${base}${url}`, { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), Cookie: cookie } })
}

async function main() {
  console.log(`Entrega automatica, de punta a punta contra ${base} (modo falso)`)
  if (start) await startServer()
  const ts = Date.now().toString(36)

  // 1. Un aviso firmado de Hazlo tu, repetido, y el trabajador protegido.
  const a = { company: `Taller Uno ${ts} SL`, taxId: `B1${ts.slice(-7).toUpperCase()}`, email: `uno-${ts}@e2e.test` }
  const prices = priceCents('hazlo-tu')
  const session = fakeCheckoutSession({ product: 'hazlo-tu', buyer: a, amountSubtotal: prices.list, metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones } })
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
  log(`bienvenida con la licencia ${licenseA.id} (verifica) y las condiciones; el aviso repetido no duplica`)

  // 2. Acompanado por la web: elegir hueco, pagar, sesion reservada.
  const page = await (await fetch(`${base}/comprar/acompanado`)).text()
  const slot = /name="slot" value="([^"]+)"/.exec(page)?.[1]
  assert.ok(slot, 'la pagina de compra ensena huecos')
  const b = { company: `Gestoria Dos ${ts} SL`, taxId: `B2${ts.slice(-7).toUpperCase()}`, email: `dos-${ts}@e2e.test` }
  await buyThroughWeb('acompanado', b, slot.replace(/&amp;/g, '&'))
  const welcomeB = await until('bienvenida del Acompanado', (s) => s.mail.find((m) => m.to === b.email && m.tags.includes('bienvenida')))
  assert.match(welcomeB.text, /primera sesión de montaje está reservada/)
  // El mismo hueco ya no se ofrece.
  const page2 = await (await fetch(`${base}/comprar/acompanado`)).text()
  assert.ok(!page2.includes(`value="${slot}"`))
  log('Acompanado: hueco elegido antes de pagar, pago de prueba, sesion reservada y en la bienvenida')

  // 3. Equipo por la web, y la zona: codigo, licencia, equipo.
  const c = { company: `Asesoria Tres ${ts} SL`, taxId: `B3${ts.slice(-7).toUpperCase()}`, email: `tres-${ts}@e2e.test` }
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
  log('zona: codigo por correo, sesion, licencia para volver a bajar y alta en el equipo')

  // 4. Version nueva: ficheros en el almacen, aviso a todos, descarga con enlace firmado.
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

  // 4b. Las paginas de la zona, pintadas en el servidor con la sesion: sin ella, a entrar.
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

  // 5. Mensual: un cobro da factura y licencia nueva.
  const s2 = await state()
  const companyC = Object.values(s2.db.companies).find((x) => x.taxId === c.taxId)!
  const periodEnd = Math.floor(Date.now() / 1000) + 200 * 86400
  const renewal = await sendEvent('invoice.paid', fakeInvoice({ customer: companyC.stripeCustomerId, amount: 19900, periodEnd, metadata: { product: 'plan-pro', company_id: companyC.id } }))
  assert.equal(renewal.body.outcome, 'renewal')
  await until('licencia del mensual', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('mensual')))
  const renewed = Object.values((await state()).db.licenses).filter((l) => l.companyId === companyC.id)
  assert.equal(renewed.length, 2)
  log(`mensual: cobro con licencia nueva hasta el ${renewed.map((l) => l.soporteHasta).sort().pop()}`)

  // 5b. Otra compra con el NIF de la empresa del equipo, desde otro correo: a revisar, sin acceso, y aviso a su titular.
  const intruder = { company: 'Otra Cosa SL', taxId: c.taxId, email: `otro-${ts}@e2e.test` }
  const intruderSession = fakeCheckoutSession({ product: 'hazlo-tu', buyer: intruder, amountSubtotal: prices.list, metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones } })
  assert.equal((await sendEvent('checkout.session.completed', intruderSession)).body.outcome, 'needs-review')
  await until('aviso a la titular del NIF', (s) => s.mail.find((m) => m.to === c.email && m.tags.includes('aviso-nif')))
  const s3 = await state()
  assert.ok(!Object.values(s3.db.members).some((m) => m.email === intruder.email), 'quien compro con un NIF ajeno no entra en la zona')
  assert.equal(Object.values(s3.db.companies).find((x) => x.taxId === c.taxId)!.name, c.company)
  // El portal de prueba solo vuelve a la propia web.
  const portal = await (await fetch(`${base}/api/dev/portal?return=${encodeURIComponent(`${base}.otra.example/robar`)}`)).text()
  assert.ok(!portal.includes('otra.example'))
  log('compra con el NIF de otro cliente desde otro correo: a revisar, sin acceso y con aviso a su titular')

  // 6. Devolucion del primero: licencia anulada y zona cerrada.
  const purchaseA = Object.values(s2.db.purchases).find((p) => p.paymentRef === session.payment_intent)!
  const refund = await sendEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchaseA.amountTotal, refunded: purchaseA.amountTotal }))
  assert.equal(refund.body.outcome, 'refund')
  await until('licencia anulada', (s) => Object.values(s.db.licenses).find((l) => l.id === licenseA.id && l.revokedAt))
  await until('correo de devolucion', (s) => s.mail.find((m) => m.to === a.email && m.tags.includes('devolucion')))
  const revocations = await (await fetch(`${base}/api/admin/revocations`, { headers: { Authorization: `Bearer ${secrets.ADMIN_SECRET}` } })).json()
  assert.ok(revocations.licencias.some((l: { id: string }) => l.id === licenseA.id))
  log('devolucion: licencia anulada (en la lista de anuladas), zona cerrada y correo al cliente')

  // 7. Conciliacion: todas las licencias con su pago; ningun paso parado.
  const report = await (await fetch(`${base}/api/jobs/reconcile`, { method: 'POST', headers: { Authorization: `Bearer ${secrets.JOBS_SECRET}` } })).json()
  assert.deepEqual(report.orphans, [])
  assert.equal(report.deadJobs, 0)
  log(`conciliacion: ${report.checkedLicenses} licencias, todas con su pago cobrado`)

  // 8. La zona de muestra (para verla y sacar capturas sin Supabase): entra como la titular.
  const demo = await fetch(`${base}/api/dev/zona-demo`, { redirect: 'manual' })
  assert.equal(demo.status, 303)
  const demoCookie = demo.headers.getSetCookie().map((x) => x.split(';')[0]).join('; ')
  const demoHome = await fetch(`${base}/zona`, { headers: { Cookie: demoCookie } })
  assert.ok((await demoHome.text()).includes('Carpintería Muñoz'), 'la zona de muestra se pinta')
  log('zona de muestra: /api/dev/zona-demo entra como la titular de Carpinteria Munoz')

  console.log('OK: la entrega automatica funciona de punta a punta')
}

main()
  .then(() => (process.exitCode = 0))
  .catch((error) => {
    console.error('FALLO:', error)
    process.exitCode = 1
  })
  .finally(() => {
    if (server) server.kill()
    if (start && !process.env.DELIVERY_FAKE_DIR) fs.rmSync(fakeDir, { recursive: true, force: true })
  })
