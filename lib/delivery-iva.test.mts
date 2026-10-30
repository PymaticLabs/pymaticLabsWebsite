import { afterEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { createFakeDelivery } from './delivery/container.ts'
import { deliverJobs, handleStripeEvent } from './delivery/events.ts'
import { runJobs } from './delivery/jobs.ts'
import { coversVersion, publishVersion } from './delivery/versions.ts'
import { fakeCharge, fakeCheckoutSession, fakeEvent, fakeInvoice } from './delivery/fake-stripe.ts'
import { priceCents } from './delivery/products.ts'
import { cifWithControl } from './delivery/checkout-nif.ts'
import { HoldedInvoicer } from './delivery/adapters/holded-invoicer.ts'
import { StripePayments } from './delivery/adapters/stripe-payments.ts'
import { checkPaidTax, declaredTax, sameVatCountry, viesNameMismatch } from './delivery/tax.ts'
import { outsideEuVatTerritory, taxMetadata, writtenOtherTaxId, type CheckoutTax } from './delivery/checkout-tax.ts'
import { EU_NO_VAT_STOP, euNoVatLevel, euNoVatSales, euNoVatStop } from './delivery/eu-sales.ts'
import { taxMention } from './delivery/tax-check.ts'
import { SupabaseRepository } from './delivery/adapters/supabase-repository.ts'
import { CheckoutError, createCheckout, type CheckoutRequest } from './checkout.ts'
import { downloadLink, termsFile, zoneOverview } from './delivery/zone.ts'
import { monthlyState } from './zone-view.ts'
import { verifyLicense } from './license.ts'
import { LEGAL_VERSIONS } from './legal-versions.ts'
import { madridDate } from './delivery/util.ts'
import { PermanentError, RetryableError, type Company, type PurchaseStatus } from './delivery/types.ts'
import type { ModalityId } from './offer.ts'

// La entrega con el IVA de cada caso (se vende a todo el mundo, solo a empresas y profesionales, en
// euros): el pago lo abre createCheckout con lo declarado y sus metadatos (el contrato comun), Stripe
// lo cobra y la entrega lo comprueba antes de dar nada: la empresa, la licencia y la factura con su
// impuesto y su mencion; lo que no cuadra, a revisar; el mensual de cada caso, con VIES otra vez en
// cada cobro sin IVA a la UE; y los 15 dias de margen de un cobro fallido. Piezas falsas, sin red.

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

// Los de la cuenta de verdad (revision fiscal del 30-10-2026): la casilla 59 y el 349, y la 120.
const TAXES = { HOLDED_TAX_REVERSE_CHARGE: 's_iva_intras', HOLDED_TAX_EXPORT: 's_iva_nosujeto' }

function world(env: Record<string, string> = {}) {
  let now = new Date('2026-11-02T10:00:00Z')
  const d = createFakeDelivery({ clock: () => now, env: { ...TAXES, ...env } })
  return {
    d,
    f: d.fakes,
    advance(ms: number) {
      now = new Date(now.getTime() + ms)
    },
    now: () => now,
  }
}

type World = ReturnType<typeof world>
type Tax = Pick<CheckoutRequest, 'country' | 'territory' | 'taxId' | 'vatId' | 'otherTaxId'>

const HOUR = 3600_000
const DAY = 24 * HOUR
let counter = 0

function buyer(n = ++counter) {
  return { company: `Mundo ${n} SL`, taxId: cifWithControl(`B${String(3000000 + n)}`), email: `compras${n}@mundo${n}.test` }
}

/**
 * Abre el pago con createCheckout (lo declarado, como en /comprar) y lo cobra como Stripe, con los
 * metadatos que puso: la direccion de facturacion y el IVA salen de ellos (fake-stripe.ts). patch
 * cambia la sesion antes del aviso (una direccion o un IVA que no cuadran).
 */
async function buy(
  w: World,
  product: ModalityId,
  tax: (b: ReturnType<typeof buyer>) => Tax,
  options: { locale?: 'es' | 'en'; buyer?: ReturnType<typeof buyer>; patch?: (session: Record<string, any>) => void } = {}
) {
  const b = options.buyer ?? buyer()
  const checkout = await createCheckout(w.d, { product, locale: options.locale ?? 'es', ...tax(b), clientIp: `10.1.${counter % 250}.${(counter * 7) % 250}` })
  const params = w.f.payments.sessions.get(checkout.sessionId)!.params
  const prices = priceCents(product)
  const session = fakeCheckoutSession({
    sessionId: checkout.sessionId,
    product,
    buyer: b,
    metadata: { ...(params.metadata as Record<string, string>), terms_version: LEGAL_VERSIONS.condiciones },
    amountSubtotal: prices.list,
    amountDiscount: params.discounts ? prices.list - prices.launch! : 0,
    created: Math.floor(w.now().getTime() / 1000),
  }) as Record<string, any>
  options.patch?.(session)
  const { outcome } = await handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session))
  return { session, outcome, buyer: b }
}

async function purchaseOf(w: World, session: Record<string, unknown>) {
  const purchase = await w.d.repo.getPurchaseByCheckoutSession(String(session.id))
  assert.ok(purchase, 'hay compra')
  return purchase
}

function docOf(w: World, providerId: string | null | undefined) {
  const doc = w.f.invoicer.documents.get(String(providerId))
  assert.ok(doc, 'hay documento en Holded')
  return doc
}

// Los cinco casos, con lo que tiene que salir.
const CASES = [
  { name: 'peninsula', tax: (b: ReturnType<typeof buyer>) => ({ taxId: b.taxId }), treatment: 'standard', rate: 21, country: 'ES', type: 'es_cif', mention: null },
  {
    name: 'canarias',
    tax: (b: ReturnType<typeof buyer>) => ({ territory: 'canarias', taxId: b.taxId }),
    treatment: 'export',
    rate: 0,
    country: 'ES',
    type: 'es_cif',
    // En Canarias (codigo postal 35001), ademas, que el IGIC lo liquida el cliente.
    mention: /^Operación no sujeta a IVA por reglas de localización \(art\. 69\.Uno\.1\.º de la Ley 37\/1992 del IVA\)\. IGIC a liquidar por el destinatario \(art\. 19\.1\.2\.º a\) de la Ley 20\/1991\)\.$/,
  },
  {
    name: 'ue-con-nif-iva',
    tax: () => ({ country: 'DE', vatId: 'DE 123 456 789' }),
    treatment: 'reverse_charge',
    rate: 0,
    country: 'DE',
    type: 'eu_vat',
    taxId: 'DE123456789',
    mention:
      /^Inversión del sujeto pasivo\. Operación no sujeta a IVA español por reglas de localización \(art\. 69\.Uno\.1\.º de la Ley 37\/1992, del IVA\)\. IVA a liquidar por el destinatario \(art\. 196 de la Directiva 2006\/112\/CE\)\. \nNIF-IVA del destinatario: DE123456789\. \nNIF-IVA del proveedor: ESB88781745\.$/,
  },
  { name: 'ue-sin-nif-iva', tax: () => ({ country: 'FR', otherTaxId: '552 100 554' }), treatment: 'standard', rate: 21, country: 'FR', type: 'other', taxId: 'FR552100554', mention: null },
  {
    name: 'fuera-de-la-ue',
    tax: () => ({ country: 'US', otherTaxId: '12-3456789' }),
    treatment: 'export',
    rate: 0,
    country: 'US',
    type: 'other',
    taxId: 'US12-3456789',
    mention: /^Operación no sujeta al IVA español por reglas de localización \(art\. 69\.Uno\.1\.º de la Ley 37\/1992, del IVA\)\.$/,
  },
] as const

test('cada caso de IVA de punta a punta: la empresa, la licencia y la factura con su impuesto y su mencion', async () => {
  const w = world()
  for (const c of CASES) {
    const { session, outcome, buyer: b } = await buy(w, 'hazlo-tu', c.tax)
    assert.equal(outcome, 'purchase', c.name)
    await runJobs(w.d)
    const purchase = await purchaseOf(w, session)
    const net = purchase.amountSubtotal - purchase.amountDiscount
    assert.deepEqual([purchase.status, purchase.taxTreatment, purchase.taxRate, purchase.amountTax], ['paid', c.treatment, c.rate, c.rate ? Math.round(net * 0.21) : 0], c.name)
    const taxId = 'taxId' in c ? c.taxId : b.taxId
    const company = (await w.d.repo.getCompany(purchase.companyId!))!
    assert.deepEqual([company.country, company.taxIdType, company.taxId], [c.country, c.type, taxId], c.name)
    if (c.name === 'canarias') assert.equal(company.address?.postal_code, '35001')
    // La licencia, con la identificacion de la empresa.
    const license = (await w.d.repo.getLicenseByPurchase(purchase.id))!
    assert.equal(verifyLicense(license.content, await w.f.signer.publicKey()).nif, taxId, c.name)
    assert.ok(w.f.mailer.sent.some((m) => m.to === purchase.email && m.tags?.includes('bienvenida')), c.name)
    // La factura en Holded: el impuesto de su caso, la mencion y, sin IVA a la UE, la consulta de VIES en
    // las notas, que salen impresas: solo eso (el pago de Stripe va en la descripcion, la referencia).
    const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
    // La de la UE sin NIF-IVA nunca se emite sola, tampoco con HOLDED_INVOICE_MODE=emit: la regla de
    // Verifactu de Holded le pondria NIF/IVA (02) y hay que cambiarlo a mano antes de aprobarla.
    if (c.name === 'ue-sin-nif-iva') assert.match(invoice.holdReason ?? '', /UE sin NIF-IVA \(FR\): .*«Documento oficial» \(04\)/, c.name)
    else assert.equal(invoice.holdReason, null, c.name)
    const doc = docOf(w, invoice.providerId)
    assert.deepEqual([doc.draft.taxTreatment, doc.draft.taxRate, doc.draft.lines[0].price], [c.treatment, c.rate, net / 100], c.name)
    if (c.mention) assert.match(doc.draft.body ?? '', c.mention, c.name)
    else assert.equal(doc.draft.body, null, c.name)
    if (c.treatment === 'reverse_charge') assert.match(doc.draft.notes ?? '', /^VIES WAPIFALSO\d+ \(2026-11-02T10:00:00\.000Z\)$/)
    else assert.equal(doc.draft.notes, null, c.name)
    assert.ok(doc.draft.reference.endsWith(` · ${purchase.paymentRef}`), c.name)
    // El contacto de Holded: la identificacion de fuera, tal como la escribio (sin el pais que pone la web).
    const contact = w.f.invoicer.contacts.get(taxId)!
    assert.equal(contact.code, { 'ue-sin-nif-iva': '552100554', 'fuera-de-la-ue': '12-3456789' }[c.name as string] ?? taxId, c.name)
    // El aviso de la venta: el IVA, el 349 y la consulta de VIES; las de la UE sin NIF-IVA, cuanto llevan este ano.
    const notice = w.f.mailer.sent.find((m) => /^Venta: /.test(m.subject) && m.text.includes(purchase.paymentRef))!
    assert.match(notice.text, c.treatment === 'reverse_charge' ? /IVA: sin IVA: inversión del sujeto pasivo; va al modelo 349/ : c.rate ? /IVA: IVA del 21 %/ : /IVA: sin IVA español: no sujeta/, c.name)
    if (c.treatment === 'reverse_charge') assert.match(notice.text, /VIES: consulta WAPIFALSO\d+/)
    if (c.name === 'ue-sin-nif-iva') assert.match(notice.text, /Ventas a la UE sin NIF-IVA: 500,00\s€ este año \(límite: 10\.000,00\s€ al año\)/)
    else assert.doesNotMatch(notice.text, /Ventas a la UE sin NIF-IVA/, c.name)
  }

  // Grecia: su NIF-IVA lleva EL (no GR), en la empresa, la licencia y la factura.
  const { session: greek } = await buy(w, 'hazlo-tu', () => ({ country: 'GR', vatId: '094259216' }))
  await runJobs(w.d)
  const pGreek = await purchaseOf(w, greek)
  const cGreek = (await w.d.repo.getCompany(pGreek.companyId!))!
  assert.deepEqual([cGreek.country, cGreek.taxId, pGreek.taxTreatment], ['GR', 'EL094259216', 'reverse_charge'])
  assert.match(docOf(w, (await w.d.repo.getInvoiceByRef(`invoice:${pGreek.id}`))!.providerId).draft.body ?? '', /NIF-IVA del destinatario: EL094259216\. \nNIF-IVA del proveedor: ESB88781745\.$/)

  // En ingles, la mencion en ingles y, debajo, la de la ley en castellano.
  const { session: english } = await buy(w, 'hazlo-tu', () => ({ country: 'AT', vatId: 'ATU12345678' }), { locale: 'en' })
  await runJobs(w.d)
  const pEnglish = await purchaseOf(w, english)
  const body = docOf(w, (await w.d.repo.getInvoiceByRef(`invoice:${pEnglish.id}`))!.providerId).draft.body ?? ''
  assert.deepEqual(body.split('\n').map((l) => l.slice(0, 32)), ['Reverse charge. Not subject to S', 'Inversión del sujeto pasivo. Ope', 'Customer VAT number: ATU12345678', 'Supplier VAT number: ESB88781745'])
})

test('lo que no cuadra tras el pago, a revisar antes de crear la empresa, la licencia, la factura o la bienvenida', async () => {
  const w = world()
  const addressOf = (s: Record<string, any>) => s.customer_details.address as Record<string, string | null>
  const chargeTax = (s: Record<string, any>, tax: number) => {
    s.amount_total = s.amount_total - s.total_details.amount_tax + tax
    s.total_details.amount_tax = tax
  }
  const cases: { name: string; tax: (b: ReturnType<typeof buyer>) => Tax; patch: (s: Record<string, any>) => void; reason: string; problem: RegExp }[] = [
    { name: 'otro pais', tax: () => ({ country: 'DE', vatId: 'DE111111111' }), patch: (s) => (addressOf(s).country = 'FR'), reason: 'country_mismatch', problem: /dirección de facturación en FR y antes de pagar se declaró DE/ },
    {
      name: 'Canarias declarada peninsula',
      tax: (b) => ({ taxId: b.taxId }),
      patch: (s) => Object.assign(addressOf(s), { postal_code: '38001', city: 'Santa Cruz de Tenerife', state: 'TF' }),
      reason: 'country_mismatch',
      problem: /dirección en Canarias y antes de pagar se declaró península y Baleares/,
    },
    { name: 'peninsula declarada Canarias', tax: (b) => ({ territory: 'canarias', taxId: b.taxId }), patch: (s) => Object.assign(addressOf(s), { postal_code: '12001', city: 'Castellón', state: 'CS' }), reason: 'country_mismatch', problem: /dirección en península y Baleares y antes de pagar se declaró Canarias/ },
    { name: 'Melilla declarada Ceuta', tax: (b) => ({ territory: 'ceuta', taxId: b.taxId }), patch: (s) => Object.assign(addressOf(s), { postal_code: '52001', city: 'Melilla', state: 'ML' }), reason: 'country_mismatch', problem: /dirección en Melilla y antes de pagar se declaró Ceuta/ },
    { name: 'sin codigo postal', tax: (b) => ({ taxId: b.taxId }), patch: (s) => (addressOf(s).postal_code = null), reason: 'country_mismatch', problem: /sin código postal/ },
    { name: 'el 21 % a la UE con NIF-IVA', tax: () => ({ country: 'DE', vatId: 'DE222222222' }), patch: (s) => chargeTax(s, Math.round(s.amount_subtotal * 0.21)), reason: 'vat_mismatch', problem: /en una venta sin IVA español \(reverse_charge\)/ },
    { name: 'el 21 % fuera de la UE', tax: () => ({ country: 'CH', otherTaxId: 'CHE-123.456.788' }), patch: (s) => chargeTax(s, Math.round(s.amount_subtotal * 0.21)), reason: 'vat_mismatch', problem: /en una venta sin IVA español \(export\)/ },
    { name: 'sin IVA a la UE sin NIF-IVA', tax: () => ({ country: 'IT', otherTaxId: 'CF RSSMRA80A01H501U' }), patch: (s) => chargeTax(s, 0), reason: 'vat_mismatch', problem: /IVA cobrado de 0 céntimos y el 21 %/ },
    {
      name: 'consulta de VIES vieja',
      tax: () => ({ country: 'NL', vatId: 'NL123456789B01' }),
      patch: (s) => (s.metadata.vies_checked_at = new Date(Date.parse(s.metadata.vies_checked_at) - 3 * DAY).toISOString()),
      reason: 'country_mismatch',
      problem: /la consulta a VIES es del 2026-10-30T10:00:00\.000Z, no de justo antes del pago/,
    },
    { name: 'sin consulta de VIES', tax: () => ({ country: 'BE', vatId: 'BE0123456789' }), patch: (s) => delete s.metadata.vies_request, reason: 'country_mismatch', problem: /NIF-IVA sin el número de la consulta a VIES/ },
    { name: 'el IVA que no toca', tax: () => ({ country: 'PT', vatId: 'PT123456789' }), patch: (s) => (s.metadata.tax_treatment = 'export'), reason: 'country_mismatch', problem: /IVA declarado «export» y a PT le toca «reverse_charge»/ },
  ]
  for (const c of cases) {
    const before = w.f.mailer.sent.length
    const { session, outcome } = await buy(w, 'hazlo-tu', c.tax, { patch: c.patch })
    assert.equal(outcome, 'needs-review', c.name)
    await runJobs(w.d)
    const purchase = await purchaseOf(w, session)
    const data = purchase.reviewData as { reason: string; problems: string[]; todo: string }
    assert.deepEqual([purchase.status, purchase.companyId, data.reason], ['needs_review', null, c.reason], c.name)
    assert.match(data.problems.join(' · '), c.problem, c.name)
    assert.equal(await w.d.repo.getLicenseByPurchase(purchase.id), null, c.name)
    assert.equal(await w.d.repo.getJobByKey(`invoice:${purchase.id}`), null, c.name)
    const sent = w.f.mailer.sent.slice(before)
    assert.ok(!sent.some((m) => m.to === purchase.email), `${c.name}: al cliente no le llega nada`)
    const notice = sent.find((m) => /^Venta a revisar/.test(m.subject))
    assert.ok(notice, c.name)
    assert.ok(notice.text.includes(c.reason === 'vat_mismatch' ? 'El IVA cobrado no es el que toca' : 'no cuadra con la dirección de facturación de Stripe'), c.name)
  }
  assert.equal(Object.keys(w.f.repo.state.companies).length, 0)
  assert.equal(w.f.invoicer.documents.size, 0)

  // El NIF-IVA de una empresa cliente desde otro correo, y ademas con la direccion en otro pais: el
  // NIF de otro cliente va primero (y sus titulares, avisados); lo del IVA queda en los problemas.
  const owner = buyer()
  const { session: first } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE333333333' }), { buyer: owner })
  await runJobs(w.d)
  const victim = (await w.d.repo.getCompany((await purchaseOf(w, first)).companyId!))!
  const before = w.f.mailer.sent.length
  const { session: other } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE333333333' }), { buyer: buyer(), patch: (s) => (addressOf(s).country = 'AT') })
  await runJobs(w.d)
  const data = (await purchaseOf(w, other)).reviewData as { reason: string; companyId: string; problems: string[] }
  assert.deepEqual([data.reason, data.companyId], ['nif_conflict', victim.id])
  assert.match(data.problems.join(), /dirección de facturación en AT y antes de pagar se declaró DE/)
  assert.ok(w.f.mailer.sent.slice(before).some((m) => m.to === owner.email && m.tags?.includes('aviso-nif')))
})

/** Una empresa con su pago unico, el mensual contratado desde la zona (lo que pone el pago en la suscripcion) y su primer cobro. */
async function monthlyFor(w: World, tax: (b: ReturnType<typeof buyer>) => Tax) {
  const { session } = await buy(w, 'hazlo-tu', tax)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const company = (await w.d.repo.getCompany(purchase.companyId!))!
  const checkout = await createCheckout(w.d, { product: 'plan-pro', locale: 'es', company })
  const params = w.f.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
  return { company, metadata: params.subscription_data.metadata as Record<string, string>, taxRates: params.subscription_data.default_tax_rates as string[] | undefined }
}

async function charge(
  w: World,
  m: { company: Company; metadata: Record<string, string> },
  periodEnd: string,
  extra: Partial<Parameters<typeof fakeInvoice>[0]> = {},
  address: Record<string, string> | null = null
) {
  const invoice = fakeInvoice({ customer: m.company.stripeCustomerId!, amount: 19900, periodEnd: Math.floor(Date.parse(`${periodEnd}T10:00:00Z`) / 1000), metadata: m.metadata, created: Math.floor(w.now().getTime() / 1000), ...extra })
  // La direccion de facturacion cambiada en el portal.
  if (address) Object.assign(invoice.customer_address as Record<string, string>, address)
  const { outcome } = await handleStripeEvent(w.d, fakeEvent('invoice.paid', invoice))
  return { invoice, outcome }
}

test('el mensual de cada caso: el IVA de su empresa en cada cobro, la factura con su mencion y, con NIF-IVA, VIES otra vez', async () => {
  const w = world()
  for (const c of CASES) {
    const m = await monthlyFor(w, c.tax)
    // El pago del mensual lleva el contrato comun en la suscripcion, y el 21 % solo si toca.
    assert.deepEqual([m.metadata.tax_country, m.metadata.tax_id_type, m.metadata.tax_treatment], [c.country, c.type, c.treatment], c.name)
    assert.equal(Boolean(m.taxRates?.length), c.rate === 21, c.name)
    const checksBefore = w.f.vies.checks.length
    const { invoice, outcome } = await charge(w, m, '2026-12-02')
    assert.equal(outcome, 'renewal', c.name)
    await runJobs(w.d)
    const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!
    assert.deepEqual([renewal.status, renewal.taxTreatment, renewal.taxRate, renewal.amountTax], ['paid', c.treatment, c.rate, c.rate ? 4179 : 0], c.name)
    // Licencia del periodo con los 15 dias de margen, y su factura.
    assert.equal((await w.d.repo.getLicenseByPurchase(renewal.id))!.soporteHasta, '2026-12-17', c.name)
    const doc = docOf(w, (await w.d.repo.getInvoiceByRef(`invoice:${renewal.id}`))!.providerId)
    assert.equal(doc.draft.taxTreatment, c.treatment, c.name)
    if (c.mention) assert.match(doc.draft.body ?? '', c.mention, c.name)
    else assert.equal(doc.draft.body, null, c.name)
    if (c.treatment === 'reverse_charge') {
      // VIES otra vez en el cobro, con el NIF-IVA de la empresa, y su numero en las notas.
      assert.deepEqual(w.f.vies.checks.slice(checksBefore), [{ countryCode: 'DE', vatNumber: '123456789' }])
      assert.match(doc.draft.notes ?? '', /VIES WAPIFALSO\d+/)
    } else {
      assert.equal(w.f.vies.checks.length, checksBefore, c.name)
    }
  }

  // Canarias que pasa la direccion del portal a la peninsula: ya no es la declarada, a revisar.
  const offshore = await monthlyFor(w, (b) => ({ territory: 'canarias', taxId: b.taxId }))
  const moved = await charge(w, offshore, '2026-12-02', {}, { postal_code: '28001', city: 'Madrid', state: 'M' })
  assert.equal(moved.outcome, 'needs-review')
  const pMoved = (await w.d.repo.getPurchaseByPaymentRef(String(moved.invoice.id)))!
  assert.equal((pMoved.reviewData as { reason: string }).reason, 'country_mismatch')
  assert.match((pMoved.reviewData as { todo: string }).todo, /la zona y la licencia del pago único siguen/)
  // Una empresa de la UE con NIF-IVA a la que se le cobra el 21 %: a revisar.
  const eu = await monthlyFor(w, () => ({ country: 'DE', vatId: 'DE444444444' }))
  const taxed = await charge(w, eu, '2026-12-02', { taxRate: 21 })
  assert.equal(taxed.outcome, 'needs-review')
  assert.equal(((await w.d.repo.getPurchaseByPaymentRef(String(taxed.invoice.id)))!.reviewData as { reason: string }).reason, 'vat_mismatch')
  await runJobs(w.d)
  assert.equal(await w.d.repo.getLicenseByPurchase(pMoved.id), null)
})

test('un NIF-IVA que deja de valer en VIES en un cobro del mensual: la factura no se hace sola (llevaba el 21 %) y se avisa; si VIES no contesta, se reintenta y queda en borrador', async () => {
  const w = world()
  const m = await monthlyFor(w, () => ({ country: 'DE', vatId: 'DE555555555' }))
  w.f.vies.results.set('DE555555555', 'invalid')
  const before = w.f.mailer.sent.length
  const { invoice } = await charge(w, m, '2026-12-02')
  await runJobs(w.d)
  const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!
  const job = (await w.d.repo.getJobByKey(`invoice:${renewal.id}`))!
  assert.equal(job.result?.status, 'held')
  assert.equal(await w.d.repo.getInvoiceByRef(`invoice:${renewal.id}`), null)
  const held = w.f.mailer.sent.slice(before).find((x) => /^Facturar a mano/.test(x.subject))
  assert.ok(held)
  assert.match(held.text, /el NIF-IVA DE555555555 ya no es válido en VIES: este cobro tenía que llevar el 21 % de IVA/)
  // La licencia del cobro sale igual (el cobro esta pagado); el aviso del cobro dice que la factura esta retenida.
  assert.ok(await w.d.repo.getLicenseByPurchase(renewal.id))
  assert.match(w.f.mailer.sent.slice(before).find((x) => /^Cobro del mensual/.test(x.subject))!.text, /Factura retenida: el NIF-IVA DE555555555 ya no es válido/)

  // VIES sin contestar: se reintenta; a los 3 intentos, en borrador con el motivo, sin el numero de consulta.
  w.f.vies.results.delete('DE555555555')
  w.f.vies.down = true
  const { invoice: next } = await charge(w, m, '2027-01-02')
  await runJobs(w.d)
  const pNext = (await w.d.repo.getPurchaseByPaymentRef(String(next.id)))!
  assert.equal((await w.d.repo.getJobByKey(`invoice:${pNext.id}`))!.status, 'pending')
  for (let i = 0; i < 4; i++) {
    w.advance(HOUR)
    await runJobs(w.d)
  }
  const draft = (await w.d.repo.getInvoiceByRef(`invoice:${pNext.id}`))!
  assert.equal(draft.status, 'draft')
  assert.match(draft.holdReason ?? '', /VIES no contestó \(MS_UNAVAILABLE \(falso\)\): comprobar el NIF-IVA DE555555555 antes de emitirla/)
  assert.doesNotMatch(docOf(w, draft.providerId).draft.notes ?? '', /VIES/)
})

test('15 dias de margen: con un cobro del mensual fallido siguen las versiones nuevas durante el aviso; si no se paga, dejan de llegar', async () => {
  const w = world()
  // Sin IVA espanol (fuera de la UE): el correo no dice «IVA incluido».
  const m = await monthlyFor(w, () => ({ country: 'US', otherTaxId: '98-7654321' }))
  const subscription = { id: 'sub_margen', object: 'subscription', customer: m.company.stripeCustomerId, status: 'active', metadata: m.metadata }
  await handleStripeEvent(w.d, fakeEvent('customer.subscription.created', subscription))
  await charge(w, m, '2026-12-02')
  await runJobs(w.d)
  const licenses = await w.d.repo.listLicensesByCompany(m.company.id)
  const monthly = licenses.find((l) => l.soporteHasta > l.emitida)!
  // Pagado hasta el 2 de diciembre; la licencia cubre hasta el 17.
  assert.equal(monthly.soporteHasta, '2026-12-17')

  // El 2 de diciembre falla el cobro siguiente: el aviso de la clausula 4, con la fecha.
  w.advance(Date.parse('2026-12-02T10:00:00Z') - w.now().getTime())
  const failed = fakeInvoice({ customer: m.company.stripeCustomerId!, amount: 19900, periodEnd: Math.floor(Date.parse('2027-01-02T10:00:00Z') / 1000), metadata: m.metadata, status: 'open' })
  await handleStripeEvent(w.d, fakeEvent('invoice.payment_failed', failed, undefined, Math.floor(w.now().getTime() / 1000)))
  await handleStripeEvent(w.d, fakeEvent('customer.subscription.updated', { ...subscription, status: 'past_due' }, undefined, Math.floor(w.now().getTime() / 1000)))
  await runJobs(w.d)
  const mail = w.f.mailer.sent.find((x) => x.tags?.includes('mensual-impagado'))!
  assert.match(mail.text, /Mensual Pro \(199,00\s€\)/)
  assert.doesNotMatch(mail.text, /IVA incluido/)
  assert.match(mail.text, /hasta el 17 de diciembre de 2026 sigues teniendo el mantenimiento y el soporte, versiones nuevas incluidas; si para entonces sigue sin pagarse, se suspenden/)
  // La zona: el cobro sin pagar, con lo pagado (sin el margen) y la descarga de la ultima version.
  const user = { id: (await w.d.repo.listMembers(m.company.id))[0].userId!, email: m.company.email }
  assert.deepEqual(monthlyState(await zoneOverview(w.d, user), w.now()), { kind: 'subscribed', product: 'plan-pro', status: 'past_due', supportUntil: '2026-12-02' })

  // Una version de durante el aviso: la licencia la cubre (lo nuevo se enciende). Una de despues, no.
  const publish = async (version: string) => {
    for (const name of ['mac.mcpb', 'windows.mcpb']) await w.d.storage.put('releases', `versiones/${version}/${name}`, Buffer.from(name), 'application/octet-stream')
    const { version: published, files } = await publishVersion(w.d, {
      version,
      notesEs: 'n',
      notesEn: 'n',
      announce: false,
      files: [
        { kind: 'mac', fileName: 'mac.mcpb', storagePath: `versiones/${version}/mac.mcpb` },
        { kind: 'windows', fileName: 'windows.mcpb', storagePath: `versiones/${version}/windows.mcpb` },
      ],
    })
    return { published, files }
  }
  w.advance(10 * DAY)
  const during = await publish('1.3.0')
  assert.equal(madridDate(new Date(during.published.publishedAt)), '2026-12-12')
  assert.ok(coversVersion(monthly, during.published))
  // La zona la da para bajarla (siempre la ultima).
  assert.match(await downloadLink(w.d, user, during.files[0].id), /\/api\/dev\/storage\?/)
  w.advance(10 * DAY)
  const after = await publish('1.4.0')
  assert.equal(coversVersion(monthly, after.published), false)
  // Si al final paga, el cobro trae su licencia y la de despues vuelve a encenderse.
  const paid = fakeInvoice({ customer: m.company.stripeCustomerId!, amount: 19900, periodEnd: Math.floor(Date.parse('2027-01-02T10:00:00Z') / 1000), metadata: m.metadata, invoiceId: String(failed.id) })
  assert.equal((await handleStripeEvent(w.d, fakeEvent('invoice.paid', paid))).outcome, 'renewal')
  await runJobs(w.d)
  const renewed = (await w.d.repo.getLicenseByPurchase((await w.d.repo.getPurchaseByPaymentRef(String(failed.id)))!.id))!
  assert.deepEqual([renewed.soporteHasta, coversVersion(renewed, after.published)], ['2027-01-17', true])

  // Sin margen que cubra el aviso (un Hazlo tu sin meses incluidos cuyo primer cobro falla): el correo no lo promete.
  const bare = await monthlyFor(w, (b) => ({ taxId: b.taxId }))
  const firstFailed = fakeInvoice({ customer: bare.company.stripeCustomerId!, amount: 19900, periodEnd: Math.floor(Date.parse('2027-01-22T10:00:00Z') / 1000), metadata: bare.metadata, status: 'open' })
  await handleStripeEvent(w.d, fakeEvent('invoice.payment_failed', firstFailed, undefined, Math.floor(w.now().getTime() / 1000)))
  await runJobs(w.d)
  const bareMail = w.f.mailer.sent.find((x) => x.tags?.includes('mensual-impagado') && x.to === bare.company.email)!
  assert.match(bareMail.text, /IVA incluido/)
  assert.match(bareMail.text, /Lo nuevo de las versiones que salgan mientras tanto se enciende cuando se pague/)
  assert.doesNotMatch(bareMail.text, /versiones nuevas incluidas/)
})

test('una factura parada con una devolucion esperandola: sus rectificativas dejan de esperarla y salen el correo de la devolucion y el aviso', async () => {
  const w = world()
  const { session } = await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  // Holded rechaza el contacto en cada intento: la factura se reintenta...
  w.f.invoicer.failures.failNext('ensureContact', 50)
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  assert.equal((await w.d.repo.getJobByKey(`invoice:${purchase.id}`))!.status, 'pending')
  // ... y la devolucion llega mientras: su rectificativa la espera.
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: purchase.amountTotal })))
  const key = `rectify:${purchase.id}:re_${session.payment_intent}_${purchase.amountTotal}`
  assert.deepEqual((await w.d.repo.getJobByKey(key))!.dependsOn, [`invoice:${purchase.id}`])
  const before = w.f.mailer.sent.length
  // Hasta que la factura se para: entonces la rectificativa corre (a mano) y, tras ella, el correo y el aviso.
  for (let i = 0; i < 14; i++) {
    w.advance(2 * HOUR)
    await runJobs(w.d)
  }
  assert.equal((await w.d.repo.getJobByKey(`invoice:${purchase.id}`))!.status, 'dead')
  assert.deepEqual((await w.d.repo.getJobByKey(key))!.dependsOn, [])
  assert.equal((await w.d.repo.getJobByKey(key))!.result?.status, 'manual')
  const sent = w.f.mailer.sent.slice(before)
  assert.ok(sent.some((x) => /^Rectificar a mano/.test(x.subject) && /el paso invoice está parado/.test(x.text)))
  assert.ok(sent.some((x) => x.to === purchase.email && x.tags?.includes('devolucion')))
  assert.ok(sent.some((x) => /^Devolución: /.test(x.subject)))
  assert.equal((await w.d.repo.getJobByKey(`refund_email:${purchase.id}`))!.status, 'done')
})

test('Supabase: los pasos pendientes dejan de esperar a uno parado, uno a uno y solo si siguen pendientes', async () => {
  const calls: { method: string; url: string; body: string | null }[] = []
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const call = { method: init.method ?? 'GET', url: String(input), body: typeof init.body === 'string' ? init.body : null }
    calls.push(call)
    if (call.method === 'GET') {
      const row = (id: number, depends: string[]) => ({ id, key: `rectify:p1:re_${id}`, kind: 'rectify', payload: {}, depends_on: depends, status: 'pending' })
      return new Response(JSON.stringify([row(7, ['invoice:p1', 'booking:p1']), row(8, ['invoice:p1'])]), { status: 200 })
    }
    return new Response(JSON.stringify(call.url.includes('id=eq.7') ? [{ id: 7 }] : []), { status: 200 })
  }) as typeof fetch
  const repo = new SupabaseRepository({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' })
  // El 8 ya no estaba pendiente al cambiarlo (lo cogio el trabajador): no cuenta.
  assert.equal(await repo.releaseDependency('invoice:p1', 'rectify:p1:', new Date('2026-11-02T10:00:00Z')), 1)
  const [list, ...patches] = calls
  const query = new URL(list.url).searchParams
  assert.deepEqual([query.get('key'), query.get('status'), query.get('depends_on')], ['like.rectify:p1:%', 'eq.pending', 'cs.{invoice:p1}'])
  assert.deepEqual(patches.map((p) => [p.method, new URL(p.url).searchParams.get('id'), new URL(p.url).searchParams.get('status'), JSON.parse(p.body!).depends_on]), [
    ['PATCH', 'eq.7', 'eq.pending', ['booking:p1']],
    ['PATCH', 'eq.8', 'eq.pending', []],
  ])
})

test('Holded: el contacto de una empresa de fuera, con su pais, su NIF-IVA y su direccion; el impuesto de cada caso, o un aviso claro si falta', async () => {
  const bodies: Record<string, unknown>[] = []
  const lookups: string[] = []
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (init.body) bodies.push(JSON.parse(String(init.body)))
    if (url.includes('/contacts?')) {
      lookups.push(new URL(url).searchParams.get('code')!)
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }
    return new Response(JSON.stringify({ id: 'x1' }), { status: 200 })
  }) as typeof fetch
  const company: Company = {
    id: 'c1',
    name: 'Grüne Werkstatt GmbH',
    taxId: 'DE123456789',
    taxIdType: 'eu_vat',
    country: 'DE',
    address: { line1: 'Hauptstraße 5', line2: null, city: 'Berlin', postal_code: '10115', state: null, country: 'DE' },
    email: 'ap@werkstatt.test',
    locale: 'en',
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
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk', ...TAXES })
  await holded.ensureContact(company)
  // La de fuera, tal como la escribio el cliente (sin el US que le pone la web): se busca asi y, por si
  // es un contacto de antes, con el prefijo (companies.tax_id); se crea sin el.
  await holded.ensureContact({ ...company, name: 'Acme Inc', taxId: 'US12-3456789', taxIdType: 'other', country: 'US', address: { ...company.address!, country: 'US', state: 'NY' } }, '12-3456789')
  const [eu, us] = bodies as { code: string; vat_number: string | null; bill_address: { country_code: string; city: string }; defaults: Record<string, unknown> }[]
  assert.deepEqual([eu.code, eu.vat_number, eu.bill_address.country_code, eu.bill_address.city], ['DE123456789', 'DE123456789', 'DE', 'Berlin'])
  assert.deepEqual([us.code, us.vat_number, us.bill_address.country_code], ['12-3456789', null, 'US'])
  assert.deepEqual(lookups, ['DE123456789', '12-3456789', 'US12-3456789'])
  // Con NIF-IVA, va al 349 y no acumula en el 347 (art. 33.2.i del RD 1065/2007); la de fuera, como siempre.
  assert.equal(eu.defaults.accumulate_in_form_347, false)
  assert.equal('accumulate_in_form_347' in us.defaults, false)
  // Y el contacto, intracomunitario: Holded lo pide para el 349 (la de fuera, sin tipo de operacion).
  assert.equal((eu as unknown as { tax_operation?: string }).tax_operation, 'intra')
  assert.equal('tax_operation' in us, false)

  const draft = { contactId: 'ct1', reference: 'r', date: '2026-11-02', currency: 'eur', language: 'en' as const, taxRate: 0, lines: [{ name: 'n', description: null, units: 1, price: 990 }], body: 'm', notes: 'VIES X' }
  await holded.createDocument('invoice', { ...draft, taxTreatment: 'reverse_charge' })
  await holded.createDocument('invoice', { ...draft, taxTreatment: 'export' })
  const taxes = bodies.slice(2).map((b) => (b as { items: { taxes: string[] }[] }).items[0].taxes[0])
  assert.deepEqual(taxes, ['s_iva_intras', 's_iva_nosujeto'])
  assert.deepEqual([(bodies[2] as { body: string }).body, (bodies[2] as { notes: string }).notes], ['m', 'VIES X'])
  const missing = new HoldedInvoicer({ HOLDED_API_KEY: 'hk' })
  await assert.rejects(missing.createDocument('invoice', { ...draft, taxTreatment: 'export' }), (e: unknown) => e instanceof PermanentError && /HOLDED_TAX_EXPORT/.test(e.message))
})

test('Holded: la identificacion escrita no es unica entre paises: por ella solo vale el contacto de esa empresa (su pais o, sin direccion, su nombre); si no, el de antes con el prefijo o uno nuevo', async () => {
  let items: Record<string, unknown[]> = {}
  const lookups: string[] = []
  const created: { code: string }[] = []
  globalThis.fetch = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/contacts') && url.searchParams.has('code')) {
      lookups.push(url.searchParams.get('code')!)
      return new Response(JSON.stringify({ items: items[url.searchParams.get('code')!] ?? [] }), { status: 200 })
    }
    created.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ id: 'ct_nuevo' }), { status: 200 })
  }) as typeof fetch
  const acme = {
    id: 'c2',
    name: 'Acme Inc',
    taxId: 'US12-3456789',
    taxIdType: 'other',
    country: 'US',
    address: { line1: '1 Main St', line2: null, city: 'New York', postal_code: '10001', state: 'NY', country: 'US' },
    email: 'ap@acme.test',
    locale: 'en',
    currency: 'eur',
    holdedContactId: null,
  } as unknown as Company
  const holded = new HoldedInvoicer({ HOLDED_API_KEY: 'hk', ...TAXES })
  const canada = { id: 'ct_ca', name: 'Maple Ltd', bill_address: { country_code: 'CA' } }
  // Una empresa de Canada escribio el mismo numero: su contacto no es el de Acme (iria su factura a otra empresa).
  items = { '12-3456789': [canada] }
  assert.equal(await holded.ensureContact(acme, '12-3456789'), 'ct_nuevo')
  assert.deepEqual(lookups, ['12-3456789', 'US12-3456789'])
  assert.deepEqual(created.map((c) => c.code), ['12-3456789'])
  // El de Acme, por su pais (aunque venga detras) o, sin direccion, por su nombre.
  items = { '12-3456789': [canada, { id: 'ct_us', name: 'Acme Inc', bill_address: { country_code: 'us' } }] }
  assert.equal(await holded.ensureContact(acme, '12-3456789'), 'ct_us')
  items = { '12-3456789': [{ id: 'ct_sin', name: 'Acme Inc', bill_address: null }] }
  assert.equal(await holded.ensureContact(acme, '12-3456789'), 'ct_sin')
  // Uno de antes, con el prefijo de la web en code (companies.tax_id, unico): vale.
  items = { 'US12-3456789': [{ id: 'ct_antes', name: 'Acme Inc.', bill_address: null }] }
  assert.equal(await holded.ensureContact(acme, '12-3456789'), 'ct_antes')
  assert.equal(created.length, 1)
})

test('zona: la copia de las condiciones aceptadas lleva el <base> de la web, como la de la bienvenida', async () => {
  const w = world()
  const { session } = await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const user = { id: (await w.d.repo.listMembers(purchase.companyId!))[0].userId!, email: purchase.email }
  // Sin la copia guardada de esa version (la hace la zona al pedirla), con los enlaces a esta web.
  for (const key of [...w.f.storage.files.keys()]) if (key.startsWith('customer-files/condiciones/')) w.f.storage.files.delete(key)
  const file = await termsFile(w.d, user, purchase.id)
  assert.ok(file.content.toString('utf-8').includes(`<base href="${w.d.config.siteUrl}/">`))
})

test('el primer cobro tras los meses incluidos que falla: el correo promete las versiones hasta donde cubre la licencia', async () => {
  const w = world()
  const { session } = await buy(w, 'hazlo-tu-equipo', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  const company = (await w.d.repo.getCompany((await purchaseOf(w, session)).companyId!))!
  // Incluido hasta el 2 de febrero; la licencia, con el margen, hasta el 17.
  assert.equal((await w.d.repo.listLicensesByCompany(company.id))[0].soporteHasta, '2027-02-17')
  const checkout = await createCheckout(w.d, { product: 'plan-pro', locale: 'es', company })
  const params = w.f.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
  const trialEnd = params.subscription_data.trial_end as number
  // La prueba acaba al empezar el 3 (en Madrid) y Stripe intenta el cobro una hora despues: falla.
  w.advance(trialEnd * 1000 + HOUR - w.now().getTime())
  const failed = fakeInvoice({ customer: company.stripeCustomerId!, amount: 19900, periodEnd: trialEnd + 28 * 86400, metadata: params.subscription_data.metadata, status: 'open' })
  await handleStripeEvent(w.d, fakeEvent('invoice.payment_failed', failed, undefined, Math.floor(w.now().getTime() / 1000)))
  await runJobs(w.d)
  const mail = w.f.mailer.sent.find((x) => x.tags?.includes('mensual-impagado'))!
  // El aviso es del 3: se suspende el 18. Lo nuevo se enciende hasta el 17, lo que cubre la licencia.
  assert.equal((await w.d.repo.getJobByKey(`payment_failed_email:${failed.id}`))!.payload.suspendFrom, '2027-02-18')
  assert.match(mail.text, /hasta el 17 de febrero de 2027 sigues teniendo el mantenimiento y el soporte, versiones nuevas incluidas/)
})

test('un cobro con el NIF-IVA que ya no vale en VIES: el aviso no lo manda al modelo 349 mientras la factura esta retenida', async () => {
  const w = world()
  const m = await monthlyFor(w, () => ({ country: 'DE', vatId: 'DE666666666' }))
  w.f.vies.results.set('DE666666666', 'invalid')
  const before = w.f.mailer.sent.length
  await charge(w, m, '2026-12-02')
  await runJobs(w.d)
  const notice = w.f.mailer.sent.slice(before).find((x) => /^Cobro del mensual/.test(x.subject))!
  assert.match(notice.text, /IVA: sin IVA: inversión del sujeto pasivo, pendiente: factura retenida \(ver Qué hacer\); no va al modelo 349 hasta aclararla/)
  assert.doesNotMatch(notice.text, /va al modelo 349\n/)
})

// --- Remate de la venta a todo el mundo: el nombre de VIES, la tarjeta, Monaco y la entrega a mano ---

test('el nombre que da VIES frente a la razon social: sin forma juridica, signos ni mayusculas; sin nombre o en otro alfabeto, no se sabe', () => {
  const alike: [string, string][] = [
    ['PYMATICLABS SL', 'Pymatic Labs'],
    ['MUSTERFIRMA HANDELS GMBH', 'Musterfirma GmbH'],
    ['S.A.R.L. Dupont & Fils', 'Dupont et Fils'],
    ['SOCIÉTÉ GÉNÉRALE SA', 'Societe Generale'],
    ['MARIO ROSSI', 'Studio Rossi'],
    ['Grüne Werkstatt Ges.m.b.H.', 'GRUNE WERKSTATT'],
    // Las dieresis escritas a la alemana: lo mismo.
    ['MUELLER UND SOEHNE GMBH', 'Müller & Söhne GmbH'],
    ['Österreichische Werbung', 'OESTERREICHISCHE WERBUNG GESMBH'],
  ]
  for (const [vies, company] of alike) assert.equal(viesNameMismatch(vies, company), false, `${vies} / ${company}`)
  // Otra empresa, o solo una palabra de todo negocio en comun.
  assert.equal(viesNameMismatch('OTRA FIRMA HANDELS GMBH', 'Mundo 5 SL'), true)
  assert.equal(viesNameMismatch('Acme Solutions BV', 'Beta Solutions SL'), true)
  // Sin nombre (VIES da «---» en muchos paises) o en griego: no se puede decir que no se parezca.
  assert.equal(viesNameMismatch(null, 'Mundo 5 SL'), false)
  assert.equal(viesNameMismatch('ΕΤΑΙΡΕΙΑ ΑΕ', 'Etaireia AE'), false)
  // Con un nombre de VIES que se puede comparar, una razon social que es solo la forma juridica (o letras
  // sueltas) no deja nada que comparar: no se parece. En otro alfabeto, no se sabe.
  for (const name of ['GmbH', 'S.L.', 'Ges.m.b.H.', 'SARL & Cie', 'A & B']) assert.equal(viesNameMismatch('MUSTERMANN SOFTWARE GMBH', name), true, name)
  // Con letras sueltas, se parece si VIES empieza por las mismas (aunque escriba la forma juridica entera).
  assert.equal(viesNameMismatch('A & B TRADING SRL', 'A & B'), false)
  assert.equal(viesNameMismatch('K+S AKTIENGESELLSCHAFT', 'K+S AG'), false)
  assert.equal(viesNameMismatch('ABC TRADING SRL', 'A & B'), true)
  assert.equal(viesNameMismatch('TRADING A & B SRL', 'A & B'), true)
  assert.equal(viesNameMismatch('MUSTERMANN GMBH', 'ΕΤΑΙΡΕΙΑ ΑΕ'), false)
  assert.equal(viesNameMismatch('GMBH', 'GmbH'), false)
  // El «---» de los metadatos no llega como nombre.
  const declared = declaredTax({ tax_country: 'DE', tax_id: 'DE123456789', tax_id_type: 'eu_vat', tax_treatment: 'reverse_charge', vies_request: 'W1', vies_checked_at: '2026-11-02T10:00:00Z', vies_name: '---', vies_address: ' Hauptstraße 5,  Berlin ' })!
  assert.deepEqual([declared.viesName, declared.viesAddress], [null, 'Hauptstraße 5, Berlin'])
})

test('VIES da el NIF-IVA a otro nombre: la venta sale igual; la factura, en borrador con ese nombre en el motivo (no en sus notas, que salen impresas), y el aviso lo dice', async () => {
  const w = world()
  w.f.vies.holders.set('DE701000001', { name: 'OTRA FIRMA HANDELS GMBH', address: 'Hauptstraße 5\n10115 Berlin' })
  const { session, outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000001' }))
  assert.equal(outcome, 'purchase')
  assert.equal(session.metadata.vies_name, 'OTRA FIRMA HANDELS GMBH')
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  // Ni a revisar ni sin entregar: la licencia y la bienvenida salen.
  assert.equal(purchase.status, 'paid')
  assert.ok(await w.d.repo.getLicenseByPurchase(purchase.id))
  assert.ok(w.f.mailer.sent.some((m) => m.to === purchase.email && m.tags?.includes('bienvenida')))
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
  assert.equal(invoice.status, 'draft')
  assert.match(
    invoice.holdReason ?? '',
    /^VIES da el NIF-IVA DE701000001 a nombre de «OTRA FIRMA HANDELS GMBH» \(Hauptstraße 5, 10115 Berlin\), que no se parece a «Mundo \d+ SL»: comprobar con la empresa que es suyo antes de emitirla/
  )
  // Si no es suyo, todo lo que hay que deshacer: el IVA, la empresa, la licencia y el mensual.
  assert.match(
    invoice.holdReason ?? '',
    /si no lo es, le tocaba el 21 % \(cobrar la diferencia o devolver el pago, y la factura, a mano\); corregir tax_id y tax_id_type de la empresa en companies, pedir una licencia nueva con la identificación buena y, si tiene el mensual, pasarlo al 21 % \(el tipo de IVA de la suscripción y sus metadatos tax_\*\)$/
  )
  // Las notas del borrador salen impresas en el PDF («Observaciones»): solo la consulta de VIES. El
  // nombre y que hay que comprobarlo, en el motivo y en el aviso de la factura retenida (con el pago y la compra).
  assert.match(docOf(w, invoice.providerId).draft.notes ?? '', /^VIES WAPIFALSO\d+ \(2026-11-02T10:00:00\.000Z\)$/)
  assert.doesNotMatch(invoice.holdReason ?? '', /quitar/)
  const heldNotice = w.f.mailer.sent.find((m) => /^Factura en borrador, sin emitir/.test(m.subject) && m.text.includes(purchase.paymentRef))!
  assert.match(heldNotice.text, /comprobar con la empresa que es suyo antes de emitirla/)
  assert.ok(heldNotice.text.includes(`Compra: ${purchase.id}`))
  const notice = w.f.mailer.sent.find((m) => /^Venta: /.test(m.subject) && m.text.includes(purchase.paymentRef))!
  assert.match(notice.text, /Factura retenida: VIES da el NIF-IVA DE701000001 a nombre de «OTRA FIRMA HANDELS GMBH»/)
  assert.match(notice.text, /VIES: consulta WAPIFALSO\d+, a nombre de «OTRA FIRMA HANDELS GMBH», que no se parece a la razón social \(ver Qué hacer\)/)
  // Puede no ser suyo: no va al modelo 349 mientras no se aclare (como una factura retenida).
  assert.match(notice.text, /IVA: sin IVA: inversión del sujeto pasivo, pendiente: factura retenida \(ver Qué hacer\); no va al modelo 349 hasta aclararla/)
  assert.doesNotMatch(notice.text, /va al modelo 349\n/)

  // Con el nombre de la empresa (en mayusculas y con otra forma juridica): ni retenida ni en las notas; el aviso lo ensena.
  const b = buyer()
  const holder = `${b.company.replace(/ SL$/, '').toUpperCase()} GMBH`
  w.f.vies.holders.set('DE701000002', { name: holder, address: null })
  const { session: same } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000002' }), { buyer: b })
  await runJobs(w.d)
  const pSame = await purchaseOf(w, same)
  const iSame = (await w.d.repo.getInvoiceByRef(`invoice:${pSame.id}`))!
  assert.equal(iSame.holdReason, null)
  assert.doesNotMatch(docOf(w, iSame.providerId).draft.notes ?? '', /a nombre de|Antes de emitirla/)
  const nSame = w.f.mailer.sent.find((m) => /^Venta: /.test(m.subject) && m.text.includes(pSame.paymentRef))!
  assert.ok(nSame.text.includes(`VIES: consulta ${String(same.metadata.vies_request)}, a nombre de «${holder}»\n`))
  assert.match(nSame.text, /IVA: sin IVA: inversión del sujeto pasivo; va al modelo 349\n/)

  // En cada cobro del mensual, con la consulta nueva: lo mismo, y la licencia del cobro sale. El
  // nombre y la direccion de esa consulta, limpios como los del pago (en una linea, sin «---»).
  const m = await monthlyFor(w, () => ({ country: 'DE', vatId: 'DE701000003' }))
  w.f.vies.holders.set('DE701000003', { name: '  GANZ   ANDERE AG ', address: 'Ringstraße 1\n10115 Berlin\n' })
  const { invoice: charged } = await charge(w, m, '2026-12-02')
  await runJobs(w.d)
  const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(charged.id)))!
  assert.ok(await w.d.repo.getLicenseByPurchase(renewal.id))
  const iRenewal = (await w.d.repo.getInvoiceByRef(`invoice:${renewal.id}`))!
  assert.match(iRenewal.holdReason ?? '', /^VIES da el NIF-IVA DE701000003 a nombre de «GANZ ANDERE AG» \(Ringstraße 1, 10115 Berlin\), que no se parece a/)
  assert.match(docOf(w, iRenewal.providerId).draft.notes ?? '', /^VIES WAPIFALSO\d+ \([^)]+\)$/)
  // Con «---» (como Espana o Alemania): ni nombre que comparar, ni retenida por eso.
  w.f.vies.holders.set('DE701000003', { name: '---', address: '---' })
  const { invoice: plain } = await charge(w, m, '2027-01-02')
  await runJobs(w.d)
  const pPlain = (await w.d.repo.getPurchaseByPaymentRef(String(plain.id)))!
  assert.equal((await w.d.repo.getInvoiceByRef(`invoice:${pPlain.id}`))!.holdReason, null)
})

test('venta sin IVA fuera de la UE con una tarjeta de Espana o de la UE: a revisar (card_country); la tarjeta nunca se rechaza y sin ella no se frena nada', async (t) => {
  t.mock.method(console, 'warn', () => {})
  const w = world()
  const cards = new Map<string, string | Error>()
  const asked: string[] = []
  Object.assign(w.f.payments, {
    cardCountry: async (pi: string) => {
      asked.push(pi)
      const card = cards.get(pi)
      if (card instanceof Error) throw card
      return card ?? null
    },
  })
  const withCard = (card: string | Error | null) => ({
    patch: (s: Record<string, any>) => {
      if (card !== null) cards.set(String(s.payment_intent), card)
    },
  })

  // Una empresa de Estados Unidos con una tarjeta espanola, y una suiza con una alemana: a revisar, sin crear nada.
  const flagged: [(b: ReturnType<typeof buyer>) => Tax, string, RegExp][] = [
    [() => ({ country: 'US', otherTaxId: '12-3456789' }), 'ES', /tarjeta emitida en ES y venta sin IVA a US, fuera de la UE: la empresa puede ser de España/],
    [() => ({ country: 'CH', otherTaxId: 'CHE-123.456.788' }), 'DE', /tarjeta emitida en DE y venta sin IVA a CH, fuera de la UE: la empresa puede ser de la UE/],
  ]
  for (const [tax, card, problem] of flagged) {
    const before = w.f.mailer.sent.length
    const { session, outcome } = await buy(w, 'hazlo-tu', tax, withCard(card))
    assert.equal(outcome, 'needs-review')
    await runJobs(w.d)
    const purchase = await purchaseOf(w, session)
    const data = purchase.reviewData as { reason: string; problems: string[] }
    assert.deepEqual([purchase.status, purchase.companyId, data.reason], ['needs_review', null, 'card_country'])
    assert.match(data.problems.join(), problem)
    assert.equal(await w.d.repo.getLicenseByPurchase(purchase.id), null)
    const notice = w.f.mailer.sent.slice(before).find((x) => /^Venta a revisar/.test(x.subject))!
    assert.match(notice.text, /Pedirle una prueba de que está establecida en el país declarado/)
    assert.match(notice.text, /La tarjeta no se rechaza nunca por su país \(Reglamento \(UE\) 2018\/302\)/)
  }
  assert.equal(Object.keys(w.f.repo.state.companies).length, 0)

  // Con una tarjeta de alli, sin tarjeta en el cargo, o si Stripe no lo sabe decir: se entrega.
  for (const card of ['US', null, new PermanentError('Stripe payment_intents: sin permiso')]) {
    const { outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'US', otherTaxId: `98-${String(++counter).padStart(7, '0')}` }), withCard(card))
    assert.equal(outcome, 'purchase', String(card))
  }
  // Ni se pregunta en Canarias ni en la UE con NIF-IVA, aunque la tarjeta sea de Espana.
  const asking = asked.length
  assert.equal((await buy(w, 'hazlo-tu', (b) => ({ territory: 'canarias', taxId: b.taxId }), withCard('ES'))).outcome, 'purchase')
  assert.equal((await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000004' }), withCard('ES'))).outcome, 'purchase')
  assert.equal(asked.length, asking)

  // Stripe sin contestar: el aviso falla (Stripe lo reintenta) sin crear nada; el reintento entrega.
  let flaky: Record<string, any> | null = null
  await assert.rejects(
    buy(w, 'hazlo-tu', () => ({ country: 'US', otherTaxId: '55-5555555' }), {
      patch: (s) => {
        flaky = s
        cards.set(String(s.payment_intent), new RetryableError('Stripe payment_intents: sin respuesta'))
      },
    }),
    RetryableError
  )
  const session = flaky as unknown as Record<string, any>
  assert.equal(await w.d.repo.getPurchaseByCheckoutSession(String(session.id)), null)
  cards.set(String(session.payment_intent), 'US')
  assert.equal((await handleStripeEvent(w.d, fakeEvent('checkout.session.completed', session))).outcome, 'purchase')
})

test('el Stripe falso sabe el pais de la tarjeta (cards, como lo pide la pagina de pago de prueba): asi se prueba card_country en local', async () => {
  const w = world()
  // Sin decir nada, sin tarjeta: no frena nada (la prueba de punta a punta de siempre no cambia).
  assert.equal(await w.f.payments.cardCountry('pi_nada'), null)
  assert.equal((await buy(w, 'hazlo-tu', () => ({ country: 'US', otherTaxId: '31-0000001' }))).outcome, 'purchase')
  // Con una tarjeta espanola en una venta de Estados Unidos, a revisar; con una de alli, se entrega.
  const card = (country: string) => ({ patch: (s: Record<string, any>) => void w.f.payments.cards.set(String(s.payment_intent), country) })
  const { session, outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'US', otherTaxId: '31-0000002' }), card('ES'))
  assert.equal(outcome, 'needs-review')
  assert.equal(((await purchaseOf(w, session)).reviewData as { reason: string }).reason, 'card_country')
  assert.equal((await buy(w, 'hazlo-tu', () => ({ country: 'US', otherTaxId: '31-0000003' }), card('US'))).outcome, 'purchase')
  // Un fallo provocado es temporal, como Stripe sin contestar.
  w.f.payments.failures.failNext('cardCountry')
  await assert.rejects(w.f.payments.cardCountry('pi_nada'), RetryableError)
})

test('Stripe: el pais de la tarjeta de un pago, del cargo (latest_charge); sin cargo, sin tarjeta o sin el pago, null', async () => {
  const payments = new StripePayments({ STRIPE_SECRET_KEY: 'sk_test_51Prueba' })
  const calls: unknown[] = []
  const intents: Record<string, unknown> = {
    pi_es: { id: 'pi_es', latest_charge: { id: 'ch_1', payment_method_details: { type: 'card', card: { brand: 'visa', country: 'ES' } } } },
    pi_sin_cargo: { id: 'pi_sin_cargo', latest_charge: null },
    pi_sepa: { id: 'pi_sepa', latest_charge: { id: 'ch_2', payment_method_details: { type: 'sepa_debit', sepa_debit: { country: 'DE' } } } },
  }
  let down = false
  Object.assign(payments as unknown as Record<string, unknown>, {
    stripe: {
      paymentIntents: {
        retrieve: async (id: string, params: unknown) => {
          calls.push([id, params])
          if (down) throw Object.assign(new Error('sin conexion'), { type: 'StripeConnectionError' })
          if (!(id in intents)) throw Object.assign(new Error(`No such payment_intent: '${id}'`), { type: 'StripeInvalidRequestError', statusCode: 404, code: 'resource_missing' })
          return intents[id]
        },
      },
    },
  })
  assert.equal(await payments.cardCountry('pi_es'), 'ES')
  assert.deepEqual(calls[0], ['pi_es', { expand: ['latest_charge'] }])
  assert.equal(await payments.cardCountry('pi_sin_cargo'), null)
  assert.equal(await payments.cardCountry('pi_sepa'), null)
  assert.equal(await payments.cardCountry('pi_no_existe'), null)
  // Stripe sin contestar: un fallo temporal (el aviso se reintenta).
  down = true
  await assert.rejects(payments.cardCountry('pi_es'), RetryableError)
})

test('Monaco va con Francia en el IVA: con su NIF-IVA frances, la direccion de Monaco o de Francia vale; sin NIF-IVA, la de Monaco', async () => {
  // La regla, sola: Francia y Monaco valen por uno solo con un NIF-IVA frances.
  const fr = { taxIdType: 'eu_vat', taxId: 'FR11123456789' }
  assert.equal(sameVatCountry('MC', 'FR', fr), true)
  assert.equal(sameVatCountry('FR', 'MC', fr), true)
  assert.equal(sameVatCountry('MC', 'FR', { taxIdType: 'other', taxId: 'MC17S12345' }), false)
  assert.equal(sameVatCountry('DE', 'AT', { taxIdType: 'eu_vat', taxId: 'DE123456789' }), false)
  const declared = declaredTax({ tax_country: 'FR', tax_id: 'FR11123456789', tax_id_type: 'eu_vat', tax_treatment: 'reverse_charge', vies_request: 'W1', vies_checked_at: '2026-11-02T10:00:00Z' })!
  assert.deepEqual(checkPaidTax({ declared, billing: { country: 'MC', postalCode: '98000', state: null }, currency: 'eur', amountTax: 0, net: 49900 }).countryProblems, [])

  const w = world()
  const addressOf = (s: Record<string, any>) => s.customer_details.address as Record<string, string | null>
  // Declarada Monaco con NIF-IVA frances y la direccion en Monaco: sin IVA, inversion del sujeto pasivo, VIES de Francia.
  const checks = w.f.vies.checks.length
  const { session, outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'MC', vatId: 'FR22123456789' }), { patch: (s) => void Object.assign(addressOf(s), { postal_code: '98000', city: 'Monaco', state: null }) })
  assert.equal(outcome, 'purchase')
  assert.deepEqual(w.f.vies.checks.slice(checks), [{ countryCode: 'FR', vatNumber: '22123456789' }])
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const company = (await w.d.repo.getCompany(purchase.companyId!))!
  assert.deepEqual([purchase.taxTreatment, company.country, company.taxId, company.taxIdType], ['reverse_charge', 'MC', 'FR22123456789', 'eu_vat'])
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
  assert.equal(invoice.holdReason, null)
  assert.match(docOf(w, invoice.providerId).draft.body ?? '', /NIF-IVA del destinatario: FR22123456789\. \nNIF-IVA del proveedor: ESB88781745\.$/)

  // Con NIF-IVA frances, declarada Francia y la direccion en Monaco, o al reves: se entrega.
  assert.equal((await buy(w, 'hazlo-tu', () => ({ country: 'FR', vatId: 'FR33123456789' }), { patch: (s) => void (addressOf(s).country = 'MC') })).outcome, 'purchase')
  assert.equal((await buy(w, 'hazlo-tu', () => ({ country: 'MC', vatId: 'FR44123456789' }), { patch: (s) => void (addressOf(s).country = 'FR') })).outcome, 'purchase')
  // Sin NIF-IVA, con el 21 %: la direccion en Monaco vale (y cuenta para los 10.000 €); en Francia, no.
  const { session: local } = await buy(w, 'hazlo-tu', () => ({ country: 'MC', otherTaxId: '17S12345' }))
  await runJobs(w.d)
  const pLocal = await purchaseOf(w, local)
  assert.deepEqual([pLocal.status, pLocal.taxTreatment, pLocal.taxRate], ['paid', 'standard', 21])
  assert.match(w.f.mailer.sent.find((m) => /^Venta: /.test(m.subject) && m.text.includes(pLocal.paymentRef))!.text, /Ventas a la UE sin NIF-IVA: /)
  const { session: moved, outcome: movedOutcome } = await buy(w, 'hazlo-tu', () => ({ country: 'MC', otherTaxId: '17S12346' }), { patch: (s) => void (addressOf(s).country = 'FR') })
  assert.equal(movedOutcome, 'needs-review')
  const data = (await purchaseOf(w, moved)).reviewData as { reason: string; problems: string[] }
  assert.equal(data.reason, 'country_mismatch')
  assert.match(data.problems.join(), /dirección de facturación en FR y antes de pagar se declaró MC/)

  // El mensual de la empresa de Monaco, con la direccion pasada a Francia en el portal: el mismo IVA, se entrega.
  const m = await monthlyFor(w, () => ({ country: 'MC', vatId: 'FR55123456789' }))
  const { outcome: renewal } = await charge(w, m, '2026-12-02', {}, { country: 'FR', postal_code: '06000', city: 'Nice', state: null } as unknown as Record<string, string>)
  assert.equal(renewal, 'renewal')
})

/** Una compra a revisar aclarada a mano: su empresa con los datos buenos, y la compra con ella y pagada (como dice el aviso). */
async function completeByHand(w: World, purchaseId: string, company: Pick<Company, 'name' | 'taxId' | 'taxIdType' | 'country' | 'address'>) {
  const purchase = (await w.d.repo.getPurchase(purchaseId))!
  const created = await w.d.repo.upsertCompany({ ...company, email: purchase.email, locale: purchase.locale, currency: 'eur', stripeCustomerId: purchase.stripeCustomerId })
  return w.d.repo.updatePurchase(purchase.id, { companyId: created.id, status: 'paid' })
}

const BERLIN = { line1: 'Hauptstraße 5', line2: null, city: 'Berlin', postal_code: '10115', state: null, country: 'DE' }

test('una compra a revisar con NIF-IVA que se entrega a mano lleva a su factura la consulta de VIES de antes del pago, si es de justo antes', async () => {
  const w = world()
  const addressOf = (s: Record<string, any>) => s.customer_details.address as Record<string, string | null>
  // Declarada Alemania y la direccion de Stripe en Francia (mal puesta): a revisar, con la consulta entera en review_data.
  const { session } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000010' }), { patch: (s) => void (addressOf(s).country = 'FR') })
  await runJobs(w.d)
  const reviewed = await purchaseOf(w, session)
  const declared = (reviewed.reviewData as { declared: Record<string, unknown> }).declared
  assert.deepEqual([declared.vies, declared.viesCheckedAt], [session.metadata.vies_request, session.metadata.vies_checked_at])
  const purchase = await completeByHand(w, reviewed.id, { name: 'Mundo Alemania GmbH', taxId: 'DE701000010', taxIdType: 'eu_vat', country: 'DE', address: BERLIN })
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, purchase), w.now())
  await runJobs(w.d)
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
  assert.equal(invoice.holdReason, null)
  assert.match(docOf(w, invoice.providerId).draft.notes ?? '', new RegExp(`^VIES ${String(session.metadata.vies_request)} \\(`))
  assert.ok(await w.d.repo.getLicenseByPurchase(purchase.id))

  // Con la consulta de hace 3 dias (por eso quedo a revisar): no vale para la factura, en borrador para mirar VIES otra vez.
  const { session: stale } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000011' }), {
    patch: (s) => void (s.metadata.vies_checked_at = new Date(Date.parse(s.metadata.vies_checked_at) - 3 * DAY).toISOString()),
  })
  const pStale = await completeByHand(w, (await purchaseOf(w, stale)).id, { name: 'Mundo Vieja GmbH', taxId: 'DE701000011', taxIdType: 'eu_vat', country: 'DE', address: BERLIN })
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, pStale), w.now())
  await runJobs(w.d)
  assert.match((await w.d.repo.getInvoiceByRef(`invoice:${pStale.id}`))!.holdReason ?? '', /sin la consulta de VIES de antes del pago/)
})

test('IVA cobrado de mas: el aviso pide devolver solo el IVA y, entregada a mano, su factura sale como «Facturar a mano»', async () => {
  const w = world()
  let tax = 0
  const { session, outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'CH', otherTaxId: 'CHE-123.456.788' }), {
    patch: (s) => {
      tax = Math.round((s.amount_subtotal - s.total_details.amount_discount) * 0.21)
      s.amount_total += tax
      s.total_details.amount_tax = tax
    },
  })
  assert.equal(outcome, 'needs-review')
  await runJobs(w.d)
  let purchase = await purchaseOf(w, session)
  assert.equal((purchase.reviewData as { reason: string }).reason, 'vat_mismatch')
  const review = w.f.mailer.sent.find((m) => /^Venta a revisar/.test(m.subject) && m.text.includes(purchase.paymentRef))!
  assert.match(review.text, /Si se cobró IVA de más, devolver solo el IVA \(devolución parcial en Stripe\)/)
  assert.match(review.text, /con el IVA de más devuelto, su factura sale como «Facturar a mano»/)
  // Se devuelve solo el IVA: sigue a revisar (ni factura que rectificar).
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: tax })))
  await runJobs(w.d)
  purchase = (await w.d.repo.getPurchase(purchase.id))!
  assert.deepEqual([purchase.status, purchase.amountRefunded], ['needs_review', tax])
  const before = w.f.mailer.sent.length
  const taxId = (purchase.reviewData as { taxId: string }).taxId
  const delivered = await completeByHand(w, purchase.id, { name: 'Helvetia Werk AG', taxId, taxIdType: 'other', country: 'CH', address: { ...BERLIN, city: 'Zürich', postal_code: '8001', country: 'CH' } })
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, delivered), w.now())
  await runJobs(w.d)
  // La licencia y la bienvenida salen; la factura, ni se crea: «Facturar a mano».
  assert.ok(await w.d.repo.getLicenseByPurchase(delivered.id))
  assert.equal((await w.d.repo.getJobByKey(`invoice:${delivered.id}`))!.result?.status, 'held')
  const sent = w.f.mailer.sent.slice(before)
  assert.ok(sent.some((m) => m.to === delivered.email && m.tags?.includes('bienvenida')))
  const held = sent.find((m) => /^Facturar a mano/.test(m.subject))!
  assert.match(held.text, /se cobró el 21 % a una venta sin IVA español \(CH\) y ese IVA ya se devolvió: hacerla a mano, sin IVA/)
  assert.match(held.text, /IVA: sin IVA español: no sujeta/)
  assert.ok(!sent.some((m) => /^Rectificar a mano/.test(m.subject)))
  // Con el IVA devuelto, la venta es sin IVA (la de su caso), no con el 21 %: asi la guarda y lo dice el aviso.
  const after = (await w.d.repo.getPurchase(delivered.id))!
  assert.deepEqual([after.taxTreatment, after.taxRate], ['export', 0])
  assert.match(sent.find((m) => /^Venta: /.test(m.subject))!.text, /IVA: sin IVA español: no sujeta por reglas de localización \(art\. 69\.Uno\.1\.º LIVA\)\n/)
})

test('IVA cobrado de mas a una empresa de la UE con NIF-IVA: devuelto y entregada a mano, ni cuenta para los 10.000 € ni sale del 349', async () => {
  const w = world()
  let tax = 0
  const { session } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000020' }), {
    patch: (s) => {
      tax = Math.round((s.amount_subtotal - s.total_details.amount_discount) * 0.21)
      s.amount_total += tax
      s.total_details.amount_tax = tax
    },
  })
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  assert.equal((purchase.reviewData as { reason: string }).reason, 'vat_mismatch')
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: String(session.payment_intent), amount: purchase.amountTotal, refunded: tax })))
  await runJobs(w.d)
  // Como dice el aviso: la empresa con sus datos, la compra con su IVA (inversion del sujeto pasivo) y deliver.
  const done = await completeByHand(w, purchase.id, { name: 'Mundo Zwanzig GmbH', taxId: 'DE701000020', taxIdType: 'eu_vat', country: 'DE', address: BERLIN })
  const delivered = await w.d.repo.updatePurchase(done.id, { taxTreatment: 'reverse_charge' })
  const before = w.f.mailer.sent.length
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, delivered), w.now())
  await runJobs(w.d)
  const after = (await w.d.repo.getPurchase(delivered.id))!
  assert.deepEqual([after.taxTreatment, after.taxRate], ['reverse_charge', 0])
  const sent = w.f.mailer.sent.slice(before)
  assert.match(sent.find((m) => /^Facturar a mano/.test(m.subject))!.text, /\(DE, NIF-IVA DE701000020\) y ese IVA ya se devolvió: hacerla a mano, sin IVA/)
  const sale = sent.find((m) => /^Venta: /.test(m.subject))!.text
  assert.match(sale, /IVA: sin IVA: inversión del sujeto pasivo, pendiente: factura retenida \(ver Qué hacer\); no va al modelo 349 hasta aclararla/)
  assert.doesNotMatch(sale, /Ventas a la UE sin NIF-IVA|IVA del 21 %/)
  // Sin devolver el IVA, como antes: con el 21 % y «devolver el IVA o facturar a mano».
  const { session: kept } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000021' }), {
    patch: (s) => {
      s.amount_total += tax
      s.total_details.amount_tax = tax
    },
  })
  await runJobs(w.d)
  const pKept = await completeByHand(w, (await purchaseOf(w, kept)).id, { name: 'Mundo Einundzwanzig GmbH', taxId: 'DE701000021', taxIdType: 'eu_vat', country: 'DE', address: BERLIN })
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, pKept), w.now())
  await runJobs(w.d)
  assert.deepEqual([(await w.d.repo.getPurchase(pKept.id))!.taxTreatment, (await w.d.repo.getPurchase(pKept.id))!.taxRate], ['standard', 21])
  assert.match((await w.d.repo.getJobByKey(`invoice:${pKept.id}`))!.result?.hold as string, /NIF-IVA DE701000021\): devolver el IVA o facturar a mano/)
})

test('IVA cobrado de mas en un cobro del mensual: el aviso pide devolver solo el IVA y, entregado a mano, la factura sale como «Facturar a mano» sin IVA', async () => {
  const w = world()
  const m = await monthlyFor(w, () => ({ country: 'DE', vatId: 'DE701000022' }))
  const before = w.f.mailer.sent.length
  const { invoice, outcome } = await charge(w, m, '2026-12-02', { taxRate: 21 })
  assert.equal(outcome, 'needs-review')
  await runJobs(w.d)
  const review = w.f.mailer.sent.slice(before).find((x) => /^Venta a revisar/.test(x.subject))!
  // Como en el pago unico: no «devolver el cobro» y entregarlo, sino devolver solo el IVA.
  assert.match(review.text, /Si se cobró IVA de más, devolver solo el IVA \(devolución parcial en Stripe\); si faltó, cobrar la diferencia o devolver el cobro/)
  assert.match(review.text, /con el IVA de más devuelto, su factura sale como «Facturar a mano»/)
  const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!
  w.f.payments.invoiceByPaymentIntent.set('pi_cobro_iva_de_mas', String(invoice.id))
  await handleStripeEvent(w.d, fakeEvent('charge.refunded', fakeCharge({ paymentIntent: 'pi_cobro_iva_de_mas', amount: renewal.amountTotal, refunded: renewal.amountTax })))
  await runJobs(w.d)
  const paid = await w.d.repo.updatePurchase(renewal.id, { status: 'paid' })
  const sentBefore = w.f.mailer.sent.length
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, paid), w.now())
  await runJobs(w.d)
  assert.ok(await w.d.repo.getLicenseByPurchase(renewal.id))
  assert.deepEqual([(await w.d.repo.getPurchase(renewal.id))!.taxTreatment, (await w.d.repo.getPurchase(renewal.id))!.taxRate], ['reverse_charge', 0])
  const sent = w.f.mailer.sent.slice(sentBefore)
  assert.match(sent.find((x) => /^Facturar a mano/.test(x.subject))!.text, /\(DE, NIF-IVA DE701000022\) y ese IVA ya se devolvió: hacerla a mano, sin IVA/)
  assert.doesNotMatch(sent.find((x) => /^Cobro del mensual/.test(x.subject))!.text, /Ventas a la UE sin NIF-IVA|IVA del 21 %/)
})

test('entrega a mano con la consulta de VIES: la empresa que compro antes sin NIF-IVA pasa a eu_vat, y su mensual va sin IVA', async () => {
  const w = world()
  // La primera compra, sin NIF-IVA en VIES todavia: other, con el 21 %.
  w.f.vies.results.set('DE701000030', 'invalid')
  const { session: first } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', otherTaxId: '701 000 030' }))
  w.f.vies.results.delete('DE701000030')
  await runJobs(w.d)
  const company = (await w.d.repo.getCompany((await purchaseOf(w, first)).companyId!))!
  assert.deepEqual([company.taxId, company.taxIdType], ['DE701000030', 'other'])
  // Otra persona de la empresa, desde otro correo y con el NIF-IVA ya valido: nif_conflict. Comprobado con los titulares, a mano.
  const { session: second } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000030' }))
  const reviewed = await purchaseOf(w, second)
  assert.equal((reviewed.reviewData as { reason: string }).reason, 'nif_conflict')
  const purchase = await w.d.repo.updatePurchase(reviewed.id, { companyId: company.id, status: 'paid' })
  await w.d.repo.enqueueJobs(await deliverJobs(w.d, purchase), w.now())
  await runJobs(w.d)
  assert.equal((await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!.holdReason, null)
  const updated = (await w.d.repo.getCompany(company.id))!
  assert.equal(updated.taxIdType, 'eu_vat')
  const checkout = await createCheckout(w.d, { product: 'plan-pro', locale: 'es', company: updated })
  const params = w.f.payments.sessions.get(checkout.sessionId)!.params as Record<string, any>
  assert.equal(params.subscription_data.metadata.tax_treatment, 'reverse_charge')
  assert.equal(params.subscription_data.default_tax_rates, undefined)
})

// --- Revision fiscal del 30-10-2026 ------------------------------------------------------------------

/** Una venta con el 21 % apuntada tal cual en la base de datos (de una empresa, o a revisar sin ella). */
async function seedSale(
  w: World,
  net: number,
  options: { country?: string; paidAt?: string; status?: PurchaseStatus; revoked?: boolean; withoutCompany?: boolean; livemode?: boolean; refunded?: boolean } = {}
) {
  const n = ++counter
  const country = options.country ?? 'IT'
  const company = options.withoutCompany
    ? null
    : await w.d.repo.upsertCompany({ name: `Vendida ${n} SRL`, taxId: `${country}CF${n}0000`, taxIdType: 'other', country, address: null, email: `ue${n}@ue.test`, locale: 'es', currency: 'eur', stripeCustomerId: `cus_ue_${n}` })
  if (company && options.revoked) await w.d.repo.updateCompany(company.id, { accessRevokedAt: '2026-06-01T10:00:00Z' })
  const tax = Math.round(net * 0.21)
  const { purchase } = await w.d.repo.createPurchase({
    companyId: company?.id ?? null,
    kind: 'one_time',
    product: 'hazlo-tu',
    paymentRef: `pi_ue_${n}`,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: `pi_ue_${n}`,
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    email: `ue${n}@ue.test`,
    locale: 'es',
    currency: 'eur',
    amountSubtotal: net,
    amountDiscount: 0,
    amountTax: tax,
    amountTotal: net + tax,
    taxTreatment: 'standard',
    taxRate: 21,
    launch: false,
    seats: 1,
    termsVersion: null,
    termsSha256: null,
    termsAcceptedAt: null,
    marketingOptIn: false,
    sessionHost: null,
    sessionStart: null,
    calendarReservation: null,
    supportUntil: null,
    status: options.status ?? 'paid',
    livemode: options.livemode ?? false,
    reviewData: options.withoutCompany ? { reason: 'country_mismatch', declared: { country } } : null,
    paidAt: options.paidAt ?? '2026-06-01T10:00:00Z',
  })
  if (options.refunded) await w.d.repo.recordRefund(purchase.id, net + tax, true)
  return { company, purchase }
}

test('las ventas a la UE sin NIF-IVA se suman de todas las compras: tambien de empresas sin acceso y las que esperan revision ya cobradas; ni devueltas, ni de Espana, ni del otro modo', async () => {
  const w = world()
  await seedSale(w, 300_000, { paidAt: '2026-03-01T10:00:00Z' })
  // Una empresa con el acceso cerrado (listActiveCompanies no la da): su venta cuenta igual.
  await seedSale(w, 200_000, { country: 'FR', revoked: true, paidAt: '2026-04-01T10:00:00Z' })
  // A revisar sin empresa: con el pais declarado (de la UE, cuenta; de fuera, no).
  await seedSale(w, 100_000, { withoutCompany: true, status: 'needs_review', paidAt: '2026-05-01T10:00:00Z' })
  await seedSale(w, 900_000, { withoutCompany: true, status: 'needs_review', country: 'US' })
  await seedSale(w, 900_000, { country: 'DE', refunded: true })
  await seedSale(w, 900_000, { country: 'ES' })
  await seedSale(w, 900_000, { livemode: true })
  await seedSale(w, 900_000, { status: 'dispute_lost' })
  await seedSale(w, 500_000, { paidAt: '2025-06-01T10:00:00Z' })
  // El 31 de diciembre a las 23:30 UTC ya es 1 de enero en Madrid; uno de hace dos anos, fuera.
  await seedSale(w, 10_000, { paidAt: '2025-12-31T23:30:00Z' })
  await seedSale(w, 900_000, { paidAt: '2024-06-01T10:00:00Z' })
  assert.deepEqual(await euNoVatSales(w.d.repo, w.now(), false), { year: 2026, current: 610_000, previous: 500_000 })
  assert.deepEqual(await euNoVatSales(w.d.repo, w.now(), true), { year: 2026, current: 900_000, previous: 0 })

  // Los umbrales: el pago se para con las de este ano y la de ahora por encima de 8.000 €, o con el
  // ano anterior por encima de 10.000 €; el aviso, urgente desde 8.000 € (stop) o pasado el limite (over).
  const t = (current: number, previous = 0) => ({ year: 2026, current, previous })
  assert.deepEqual([euNoVatStop(t(700_000), 100_000), euNoVatStop(t(700_000), 100_001), euNoVatStop(t(0, 1_000_000), 1), euNoVatStop(t(0, 1_000_001), 1)], [null, 'current', null, 'previous'])
  assert.deepEqual([euNoVatLevel(t(799_999)), euNoVatLevel(t(800_000)), euNoVatLevel(t(1_000_001)), euNoVatLevel(t(0, 1_000_001)), euNoVatLevel(t(0, 1_000_000))], [null, 'stop', 'over', 'over', null])
  assert.equal(EU_NO_VAT_STOP, 800_000)
})

test('la UE sin NIF-IVA cerca del limite: el pago no se abre (ni plaza ni hueco) y el mensual de la zona tampoco; los mensuales que ya hay siguen, con aviso urgente', async () => {
  const w = world()
  const blocked = (e: unknown) => e instanceof CheckoutError && e.code === 'eu_no_vat_limit'
  // Una empresa de Italia sin NIF-IVA con su mensual (el pago unico, 500 € con el de lanzamiento).
  const m = await monthlyFor(w, () => ({ country: 'IT', otherTaxId: 'RSSMRA80A01H501U' }))
  await w.d.repo.updateCompany(m.company.id, { subscriptionId: 'sub_it', subscriptionStatus: 'active', subscriptionPlan: 'plan-pro' })
  const { company: other } = await seedSale(w, 300_000, { paidAt: '2026-03-01T10:00:00Z' })
  await seedSale(w, 200_000, { country: 'FR', revoked: true, paidAt: '2026-04-01T10:00:00Z' })
  await seedSale(w, 100_000, { withoutCompany: true, status: 'needs_review', paidAt: '2026-05-01T10:00:00Z' })
  assert.equal((await euNoVatSales(w.d.repo, w.now(), false)).current, 650_000)

  // 6.500 € y una Solista (990 € de lista): 7.490 €, se abre. Una Banda (1.990 €): 8.490 €, no.
  const tax = { country: 'IT', otherTaxId: 'VRDLGU80A01H501X' }
  assert.ok(await createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', ...tax, clientIp: '10.9.0.1' }))
  const sessions = w.f.payments.sessions.size
  const slots = Object.keys(w.f.repo.state.launchSlots).length
  await assert.rejects(createCheckout(w.d, { product: 'hazlo-tu-equipo', locale: 'es', ...tax, clientIp: '10.9.0.2' }), blocked)
  // La Orquesta tampoco, y antes de mirar o apartar su hueco.
  await assert.rejects(createCheckout(w.d, { product: 'acompanado-equipo', locale: 'en', ...tax, clientIp: '10.9.0.3' }), blocked)
  assert.deepEqual([w.f.payments.sessions.size, Object.keys(w.f.repo.state.launchSlots).length, w.f.calendar.reservations.size], [sessions, slots, 0])
  // Con NIF-IVA (sin IVA), en Espana o fuera de la UE, no cuenta: se abre.
  for (const [i, other2] of [{ country: 'IT', vatId: 'IT12345678901' }, { taxId: buyer().taxId }, { country: 'US', otherTaxId: '12-3456789' }].entries()) {
    assert.ok(await createCheckout(w.d, { product: 'hazlo-tu-equipo', locale: 'es', ...other2, clientIp: `10.9.1.${i}` }))
  }
  // El mensual desde la zona, igual: el Premium al ano (2.990 €), no; el Esencial al mes (99 €), si.
  const company = (await w.d.repo.updateCompany(other!.id, { stripeCustomerId: 'cus_otra' }))!
  await assert.rejects(createCheckout(w.d, { product: 'plan-premium', period: 'year', locale: 'es', company }), blocked)
  assert.ok(await createCheckout(w.d, { product: 'plan-esencial', locale: 'es', company }))

  // Con las del ano anterior por encima de 10.000 €, ni una Solista.
  const { purchase: big } = await seedSale(w, 1_000_100, { paidAt: '2025-06-01T10:00:00Z' })
  await assert.rejects(createCheckout(w.d, { product: 'hazlo-tu', locale: 'es', ...tax, clientIp: '10.9.0.4' }), (e: unknown) => blocked(e) && /ano anterior/.test((e as Error).message))
  // Devuelta, deja de contar.
  await w.d.repo.recordRefund(big.id, big.amountTotal, true)

  // Los cobros del mensual que ya hay no se cortan: el de la empresa de Italia sale (licencia y
  // factura) y, con las de este ano ya en 8.000 €, el aviso es urgente y dice que siguen cobrando.
  await seedSale(w, 150_000, { paidAt: '2026-07-01T10:00:00Z' })
  const before = w.f.mailer.sent.length
  const { invoice, outcome } = await charge(w, m, '2026-12-02')
  assert.equal(outcome, 'renewal')
  await runJobs(w.d)
  const renewal = (await w.d.repo.getPurchaseByPaymentRef(String(invoice.id)))!
  assert.deepEqual([renewal.status, renewal.taxTreatment], ['paid', 'standard'])
  assert.ok(await w.d.repo.getLicenseByPurchase(renewal.id))
  assert.ok(await w.d.repo.getInvoiceByRef(`invoice:${renewal.id}`))
  const notice = w.f.mailer.sent.slice(before).find((x) => /Cobro del mensual/.test(x.subject))!
  assert.match(notice.subject, /^URGENTE · Cobro del mensual: /)
  const text = notice.text.replace(/ /g, ' ')
  assert.match(text, /van por 8\.199,00 € este año: desde 8\.000,00 € la web ya no abre pagos nuevos así \(piden escribir a info@pymaticlabs\.com\), pero los mensuales que ya hay siguen cobrando el 21 %/)
  assert.ok(text.includes(`${m.company.name} (IT, Cerebro Digital`), text)
  assert.match(text, /ventanilla única \(OSS, modelo 035\)/)
})

test('el contacto de Holded con una identificacion de fuera: la que escribio el cliente (tax_id_written, en los metadatos del pago) o, sin ella, sin el pais que pone la web', async () => {
  // Lo que deduce sin los metadatos: el prefijo fuera si detras hay cifras; con letras, se deja.
  assert.equal(writtenOtherTaxId('US', 'US12-3456789'), '12-3456789')
  assert.equal(writtenOtherTaxId('FR', 'FR552100554'), '552100554')
  assert.equal(writtenOtherTaxId('CH', 'CHE-123456789'), 'CHE-123456789')
  assert.equal(writtenOtherTaxId('IT', 'ITRSSMRA80A01H501U'), 'ITRSSMRA80A01H501U')
  assert.equal(writtenOtherTaxId('IT', 'ITRSSMRA80A01H501U', 'rssmra 80a01 h501u'), 'RSSMRA80A01H501U')
  // Una escrita que no da esa identificacion no vale (y se deduce).
  assert.equal(writtenOtherTaxId('US', 'US12-3456789', '99-9999999'), '12-3456789')
  assert.equal(writtenOtherTaxId(null, 'X1234'), 'X1234')
  // En los metadatos del pago, solo con una de fuera, limpia y solo si da la misma.
  const it: CheckoutTax = { country: 'IT', territory: null, taxId: 'ITRSSMRA80A01H501U', taxIdType: 'other', treatment: 'standard', vies: null }
  assert.equal(taxMetadata(it, null, ' rssmra 80a01 h501u ').tax_id_written, 'RSSMRA80A01H501U')
  assert.equal(taxMetadata(it, null, 'otra cosa').tax_id_written, undefined)
  assert.equal(taxMetadata({ ...it, taxIdType: 'es_cif', country: 'ES', taxId: 'B12345674' }, null, 'B12345674').tax_id_written, undefined)

  // De punta a punta: el pago lleva tax_id_written y el contacto sale con ella; la empresa, con el prefijo.
  const w = world()
  const { session } = await buy(w, 'hazlo-tu', () => ({ country: 'CH', otherTaxId: '123.456.789' }))
  assert.equal(session.metadata.tax_id_written, '123456789')
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const company = (await w.d.repo.getCompany(purchase.companyId!))!
  assert.equal(company.taxId, 'CH123456789')
  assert.deepEqual([w.f.invoicer.contacts.get('CH123456789')!.code, company.holdedContactId], ['123456789', w.f.invoicer.contacts.get('CH123456789')!.id])

  // Sin el pago de Stripe (un cobro del mensual de una empresa sin contacto): se deduce.
  const m = await monthlyFor(w, () => ({ country: 'US', otherTaxId: '98-7654321' }))
  w.f.invoicer.contacts.delete('US98-7654321')
  await w.d.repo.updateCompany(m.company.id, { holdedContactId: null })
  await charge(w, m, '2026-12-02')
  await runJobs(w.d)
  assert.equal(w.f.invoicer.contacts.get('US98-7654321')!.code, '98-7654321')
})

test('las notas de la factura (salen impresas) solo llevan la consulta de VIES; el pago de Stripe va en la descripcion, y con ella un reintento encuentra la factura sin repetirla', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  // Holded crea la factura y no contesta al leerla para cruzar los totales: el paso se reintenta.
  w.f.invoicer.failures.failNext('getDocument', 1)
  const { session } = await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  assert.equal((await w.d.repo.getJobByKey(`invoice:${purchase.id}`))!.status, 'pending')
  assert.equal(w.f.invoicer.documents.size, 1)
  w.advance(HOUR)
  await runJobs(w.d)
  // La encuentra por la descripcion (con el pago de Stripe) y la emite: una sola.
  assert.equal(w.f.invoicer.documents.size, 1)
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
  assert.equal(invoice.status, 'sent')
  const doc = docOf(w, invoice.providerId)
  assert.equal(doc.draft.reference, `Cerebro Digital · Solista · ${purchase.paymentRef}`)
  assert.equal(doc.draft.notes, null)
})

test('emitida sola (HOLDED_INVOICE_MODE=emit): si Verifactu no la da por aceptada, aviso urgente; aceptada, nada', async () => {
  const w = world({ HOLDED_INVOICE_MODE: 'emit' })
  w.f.invoicer.verifactuStatus = 'rejected'
  const { session } = await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const invoice = (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!
  // Ya esta aprobada: sale igual al cliente y a su zona; el aviso pide mirarla en Holded.
  assert.equal(invoice.status, 'sent')
  const alert = w.f.mailer.sent.find((m) => /^URGENTE · Verifactu: factura /.test(m.subject))!
  assert.equal(alert.subject, `URGENTE · Verifactu: factura ${invoice.number} sin aceptar`)
  assert.match(alert.text, /su estado en Verifactu es «rejected», no «accepted»/)
  assert.ok(alert.text.includes(`Compra: ${purchase.id}`))
  // Holded sin el estado: tambien (no se sabe si se registro).
  w.f.invoicer.verifactuStatus = null
  await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  assert.ok(w.f.mailer.sent.some((m) => /^URGENTE · Verifactu: /.test(m.subject) && /«sin dar»/.test(m.text)))
  // Aceptada: ningun aviso mas.
  w.f.invoicer.verifactuStatus = 'accepted'
  const alerts = w.f.mailer.sent.filter((m) => /Verifactu/.test(m.subject)).length
  await buy(w, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(w.d)
  assert.equal(w.f.mailer.sent.filter((m) => /Verifactu/.test(m.subject)).length, alerts)
  // En borrador (lo de hoy) no se aprueba ni se mira.
  const draft = world()
  draft.f.invoicer.verifactuStatus = 'rejected'
  await buy(draft, 'hazlo-tu', (b) => ({ taxId: b.taxId }))
  await runJobs(draft.d)
  assert.ok(!draft.f.mailer.sent.some((m) => /Verifactu/.test(m.subject)))
})

test('las menciones: el NIF-IVA de PymaticLabs (el de VIES_REQUESTER) en la inversion del sujeto pasivo; el IGIC solo en Canarias, no en Ceuta ni Melilla', async () => {
  const at = (postal_code: string) => ({ country: 'ES', taxId: 'B12345674', address: { line1: null, line2: null, city: null, postal_code, state: null, country: 'ES' } })
  const igic = /IGIC a liquidar por el destinatario \(art\. 19\.1\.2\.º a\) de la Ley 20\/1991\)\./
  assert.match(taxMention('export', at('38001'), 'es', 'ESB88781745')!, igic)
  for (const postal of ['51001', '52001']) assert.doesNotMatch(taxMention('export', at(postal), 'es', 'ESB88781745')!, /IGIC/, postal)
  // En ingles, cada linea con la suya.
  assert.deepEqual(taxMention('export', at('35001'), 'en', 'ESB88781745')!.split('\n').map((l) => /IGIC/.test(l)), [true, true])
  assert.match(taxMention('export', at('35001'), 'en', 'ESB88781745')!, /IGIC to be accounted for by the recipient \(Article 19\.1\.2\.a of Law 20\/1991\)\./)
  // Fuera de la UE: no sujeta al IVA espanol, con el articulo exacto.
  assert.equal(
    taxMention('export', { country: 'US', taxId: 'US12-3456789', address: null }, 'en', 'ESB88781745'),
    'Not subject to Spanish VAT under the place-of-supply rules (Article 69.One.1 of Spanish VAT Law 37/1992). \nOperación no sujeta al IVA español por reglas de localización (art. 69.Uno.1.º de la Ley 37/1992, del IVA).'
  )
  assert.equal(taxMention('standard', at('12001'), 'es', 'ESB88781745'), null)

  // El de PymaticLabs sale de VIES_REQUESTER (el mismo que pregunta a VIES), no escrito dos veces.
  const w = world({ VIES_REQUESTER: 'ESB12345674' })
  const { session } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000040' }))
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  const body = docOf(w, (await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`))!.providerId).draft.body ?? ''
  assert.match(body, /\nNIF-IVA del destinatario: DE701000040\. \nNIF-IVA del proveedor: ESB12345674\.$/)
})

test('un territorio de un Estado de la UE fuera del IVA europeo (ultramar, Aland, Helgoland...): la factura, retenida para hacerla a mano (s_iva_nosujeto, sin 349); el cobro no se toca', async () => {
  // Por el pais y el codigo postal de la direccion de facturacion (la de Stripe da el del Estado).
  const yes: [string, string][] = [['FR', '97100'], ['FR', '97400'], ['FI', '22100'], ['FI', '22999'], ['DE', '27498'], ['DE', '78266'], ['IT', '23041'], ['IT', '22061'], ['GR', '63086'], ['GR', '630 86'], ['FI', 'AX-22100']]
  const no: [string, string | null][] = [['FR', '75001'], ['FI', '22000'], ['FI', '23000'], ['DE', '27499'], ['IT', '23030'], ['GR', '63085'], ['ES', '35001'], ['MC', '98000'], ['DE', null]]
  for (const [country, postal] of yes) assert.ok(outsideEuVatTerritory(country, postal), `${country} ${postal}`)
  for (const [country, postal] of no) assert.equal(outsideEuVatTerritory(country, postal), null, `${country} ${postal}`)

  const w = world()
  const postal = (code: string) => (s: Record<string, any>) => void (s.customer_details.address.postal_code = code)
  // Helgoland, con NIF-IVA aleman valido: se entrega (licencia, zona), pero la factura no se hace sola.
  const { session, outcome } = await buy(w, 'hazlo-tu', () => ({ country: 'DE', vatId: 'DE701000050' }), { patch: postal('27498') })
  assert.equal(outcome, 'purchase')
  await runJobs(w.d)
  const purchase = await purchaseOf(w, session)
  assert.deepEqual([purchase.taxTreatment, purchase.amountTax], ['reverse_charge', 0])
  assert.ok(await w.d.repo.getLicenseByPurchase(purchase.id))
  assert.equal((await w.d.repo.getJobByKey(`invoice:${purchase.id}`))!.result?.status, 'held')
  assert.equal(await w.d.repo.getInvoiceByRef(`invoice:${purchase.id}`), null)
  const held = w.f.mailer.sent.find((m) => /^Facturar a mano/.test(m.subject) && m.text.includes(purchase.paymentRef))!
  assert.match(held.text, /territorio fuera del IVA de la UE: s_iva_nosujeto, sin 349 \(DE 27498, Helgoland; art\. 6 de la Directiva 2006\/112\/CE\)/)
  // Y no va al 349 mientras no se aclare.
  assert.match(w.f.mailer.sent.find((m) => /^Venta: /.test(m.subject) && m.text.includes(purchase.paymentRef))!.text, /no va al modelo 349 hasta aclararla/)
  // Guadalupe sin NIF-IVA, con el 21 % cobrado: lo mismo, y el motivo dice que se cobro el IVA.
  const { session: dom } = await buy(w, 'hazlo-tu', () => ({ country: 'FR', otherTaxId: '552 100 555' }), { patch: postal('97100') })
  await runJobs(w.d)
  const pDom = await purchaseOf(w, dom)
  assert.deepEqual([pDom.taxTreatment, pDom.amountTax > 0], ['standard', true])
  assert.equal(await w.d.repo.getInvoiceByRef(`invoice:${pDom.id}`), null)
  assert.match(w.f.mailer.sent.find((m) => /^Facturar a mano/.test(m.subject) && m.text.includes(pDom.paymentRef))!.text, /FR 97100, un departamento de ultramar de Francia; .*se cobró el 21 %: devolver ese IVA o facturarlo con él, con Manel/)
})
