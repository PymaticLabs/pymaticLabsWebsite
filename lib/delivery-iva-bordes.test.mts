import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDelivery } from './delivery/container.ts'
import { handleStripeEvent } from './delivery/events.ts'
import { runJobs } from './delivery/jobs.ts'
import { fakeCheckoutSession, fakeEvent } from './delivery/fake-stripe.ts'
import { priceCents } from './delivery/products.ts'
import { cifWithControl } from './delivery/checkout-nif.ts'
import { checkPaidTax, decideTax, declaredTax } from './delivery/tax.ts'
import { HoldedInvoicer } from './delivery/adapters/holded-invoicer.ts'
import { createCheckout, type CheckoutRequest } from './checkout.ts'
import { LEGAL_VERSIONS } from './legal-versions.ts'
import type { Company, Purchase } from './delivery/types.ts'
import type { ModalityId } from './offer.ts'

// Bordes del IVA (revision fiscal de la venta a todo el mundo): el tipo del 21 % de un prorrateo,
// la direccion de Espana con el codigo postal y la provincia que no dicen lo mismo, y la empresa que
// vuelve a comprar con otros datos fiscales (un NIF-IVA validado ahora, una mudanza a Canarias).

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

const TAXES = { HOLDED_TAX_REVERSE_CHARGE: 's_iva_intras', HOLDED_TAX_EXPORT: 's_iva_nosujeto' }
const HOUR = 3600_000

function world() {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now, env: TAXES })
  return { d, f: d.fakes, advance: (ms: number) => (now = new Date(now.getTime() + ms)), now: () => now }
}

type World = ReturnType<typeof world>
type Tax = Pick<CheckoutRequest, 'country' | 'territory' | 'taxId' | 'vatId' | 'otherTaxId'>
let counter = 0

function buyer() {
  const n = ++counter
  return { company: `Borde ${n} SL`, taxId: cifWithControl(`B${String(5000000 + n)}`), email: `compras${n}@borde${n}.test` }
}

/** Abre el pago (lo declarado, como en /comprar) y lo deja listo para pagarlo como Stripe, con sus metadatos. */
async function open(w: World, product: ModalityId, tax: Tax, b: ReturnType<typeof buyer>) {
  const checkout = await createCheckout(w.d, { product, locale: 'es', ...tax, clientIp: `10.7.${counter % 250}.${(counter * 3) % 250}` })
  const params = w.f.payments.sessions.get(checkout.sessionId)!.params
  const prices = priceCents(product)
  return fakeCheckoutSession({
    sessionId: checkout.sessionId,
    product,
    buyer: b,
    metadata: { ...(params.metadata as Record<string, string>), terms_version: LEGAL_VERSIONS.condiciones },
    amountSubtotal: prices.list,
    amountDiscount: params.discounts ? prices.list - prices.launch! : 0,
    created: Math.floor(w.now().getTime() / 1000),
  }) as Record<string, any>
}

async function pay(w: World, session: Record<string, any>) {
  const { outcome } = await handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session))
  await runJobs(w.d)
  const purchase = (await w.d.repo.getPurchaseByCheckoutSession(String(session.id)))!
  return { outcome, purchase, company: purchase.companyId ? (await w.d.repo.getCompany(purchase.companyId))! : null }
}

async function monthlyParams(w: World, company: Company) {
  const checkout = await createCheckout(w.d, { product: 'plan-pro', locale: 'es', company })
  return w.f.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
}

test('un prorrateo del mensual con el 21 % (19,99 euros al subir de plan): el tipo es el 21 % y Holded la factura', async () => {
  // El IVA redondeado entre la base da 21,01 %: Holded no factura un tipo que no es el 21 %.
  const net = 1999
  const amountTax = Math.round(net * 0.21)
  const declared = declaredTax({ tax_country: 'ES', tax_territory: 'peninsula', tax_id: 'B12345674', tax_id_type: 'es_cif', tax_treatment: 'standard' })!
  const paid = checkPaidTax({ declared, billing: { country: 'ES', postalCode: '28001', state: 'M' }, currency: 'eur', amountTax, net })
  assert.deepEqual([paid.rate, paid.vatProblems], [21, []])
  const purchase = { amountSubtotal: net, amountDiscount: 0, amountTax, currency: 'eur', taxTreatment: 'standard', taxRate: paid.rate } as Purchase
  const company = { country: 'ES', address: { line1: null, line2: null, city: 'Madrid', postal_code: '28001', state: 'M', country: 'ES' }, taxId: 'B12345674', taxIdType: 'es_cif' } as Company
  const decision = decideTax(purchase, company, { reasons: [], amountTax, taxIds: [] })
  assert.deepEqual([decision.treatment, decision.rate, decision.hold], ['standard', 21, null])
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: 'doc1' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch
  const doc = await new HoldedInvoicer({ HOLDED_API_KEY: 'x' }).createDocument('invoice', {
    contactId: 'c',
    reference: 'r',
    date: '2026-11-02',
    currency: 'eur',
    language: 'es',
    taxTreatment: 'standard',
    taxRate: decision.rate,
    lines: [{ name: 'Plan Pro', description: null, units: 1, price: net / 100 }],
    body: null,
    notes: '',
  })
  assert.equal(doc.id, 'doc1')
  // Un IVA que no es el 21 % sigue sin facturarse solo: el tipo que sale de dividir.
  const wrong = decideTax({ ...purchase, amountTax: 200 }, company, { reasons: [], amountTax: 200, taxIds: [] })
  assert.deepEqual([wrong.rate, wrong.hold?.mode], [10.01, 'manual'])
})

test('Espana con el codigo postal y la provincia que no dicen lo mismo: a revisar, no a 0 %', async () => {
  const w = world()
  const b = buyer()
  const session = await open(w, 'hazlo-tu', { territory: 'canarias', taxId: b.taxId }, b)
  Object.assign(session.customer_details.address, { postal_code: '28001', city: 'Madrid', state: 'GC' })
  const { outcome, purchase } = await pay(w, session)
  assert.equal(outcome, 'needs-review')
  const data = purchase.reviewData as { reason: string; problems: string[] }
  assert.equal(data.reason, 'country_mismatch')
  assert.match(data.problems.join(' · '), /el código postal «28001» es de península y Baleares y la provincia o la ciudad, de Canarias/)
  // Con los dos de Canarias, sin IVA y sin revisar.
  const c = buyer()
  const ok = await open(w, 'hazlo-tu', { territory: 'canarias', taxId: c.taxId }, c)
  Object.assign(ok.customer_details.address, { postal_code: '38001', city: 'Santa Cruz de Tenerife', state: 'TF' })
  assert.deepEqual([(await pay(w, ok)).purchase.taxTreatment, (await w.d.repo.getPurchaseByCheckoutSession(String(ok.id)))!.status], ['export', 'paid'])
})

test('la empresa que vuelve a comprar con otros datos fiscales: el mensual y la factura llevan los de hoy', async () => {
  const w = world()
  // Alemania: primero sin NIF-IVA (con el 21 %) y despues con el NIF-IVA validado en VIES.
  const de = buyer()
  // Entonces VIES aun no lo daba por valido (si no, /comprar pide escribirlo como NIF-IVA).
  w.f.vies.results.set('DE123456789', 'invalid')
  const first = await pay(w, await open(w, 'hazlo-tu', { country: 'DE', otherTaxId: 'DE 123 456 789' }, de))
  w.f.vies.results.delete('DE123456789')
  assert.deepEqual([first.purchase.taxTreatment, first.company!.taxIdType, first.company!.taxId], ['standard', 'other', 'DE123456789'])
  w.advance(HOUR)
  const second = await pay(w, await open(w, 'hazlo-tu-equipo', { country: 'DE', vatId: 'DE123456789' }, de))
  assert.deepEqual([second.purchase.taxTreatment, second.company!.taxIdType], ['reverse_charge', 'eu_vat'])
  const plan = await monthlyParams(w, second.company!)
  assert.deepEqual([plan.subscription_data.metadata.tax_treatment, plan.subscription_data.default_tax_rates], ['reverse_charge', undefined])

  // Espana: primero en la peninsula y, ya en Canarias, otra compra declarada alli.
  const es = buyer()
  const p1 = await pay(w, await open(w, 'hazlo-tu', { taxId: es.taxId }, es))
  assert.equal(p1.company!.address?.postal_code, '12001')
  // Un pago abierto antes de mudarse, cuyo aviso llega despues de la compra de Canarias.
  const old = await open(w, 'hazlo-tu-equipo', { taxId: es.taxId }, es)
  w.advance(HOUR)
  const p2 = await pay(w, await open(w, 'hazlo-tu-equipo', { territory: 'canarias', taxId: es.taxId }, es))
  assert.deepEqual([p2.purchase.status, p2.purchase.taxTreatment, p2.company!.address?.postal_code], ['paid', 'export', '35001'])
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${p2.purchase.id}`))!
  assert.equal(invoice.holdReason, null)
  assert.equal(w.f.invoicer.documents.get(String(invoice.providerId))!.draft.taxTreatment, 'export')
  const canarias = await monthlyParams(w, p2.company!)
  assert.deepEqual([canarias.subscription_data.metadata.tax_territory, canarias.subscription_data.metadata.tax_treatment], ['canarias', 'export'])
  // El aviso viejo no pisa la direccion de la compra posterior.
  await pay(w, old)
  assert.equal((await w.d.repo.getCompany(p2.company!.id))!.address?.postal_code, '35001')
})
