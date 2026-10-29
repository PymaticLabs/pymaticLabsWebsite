import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildLlmsTxt } from '../app/llms.txt/llms.ts'
import { BOOKING_URL } from '../app/[locale]/contacto/booking.ts'
import { ANNUAL_PAID_MONTHS, CUSTOM_FROM_PRICE, LAUNCH_CUSTOMERS, formatPrice, modalities, plans } from './offer.ts'
import { getOrganizationSchema, getProductSchema } from './schemas.ts'

// llms.txt sale de la oferta y de los textos de la web: los precios de lib/offer.ts, nada sin rellenar
// y lo que la oferta prohibe prometer (sesiones en el Hazlo tu, procedimientos montados o documentos
// cargados en el Acompanado), fuera. Y los datos para buscadores (lib/schemas.ts, JSON-LD).

const messages = (locale: string) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf-8'))
const txt = buildLlmsTxt({ es: messages('es'), en: messages('en'), baseUrl: 'https://pymaticlabs.com' })
const line = (start: string) => txt.split('\n').find((l) => l.startsWith(start)) ?? ''

test('llms.txt: precios y planes de lib/offer.ts, sin huecos', () => {
  for (const m of modalities) {
    assert.ok(txt.includes(`${formatPrice(m.listPrice, 'en')} list, ${formatPrice(m.launchPrice, 'en')} launch price`), m.id)
  }
  for (const p of plans) assert.ok(txt.includes(formatPrice(p.monthly, 'en')), p.id)
  // Al ano, el precio de 10 meses: el que cobra el pago (plan.yearly de lib/offer.ts).
  assert.ok(txt.includes(`Paid yearly, the price of ${ANNUAL_PAID_MONTHS} months: ${plans.map((p) => formatPrice(p.yearly, 'en')).join(', ')}.`))
  assert.ok(txt.includes(formatPrice(CUSTOM_FROM_PRICE, 'en')))
  assert.doesNotMatch(txt, /undefined|\{[a-z]+\}/)
  assert.ok(txt.startsWith('# Pymatic Labs'))
})

test('llms.txt: el Hazlo tu sin sesiones; el Acompanado no monta procedimientos ni carga documentos', () => {
  assert.doesNotMatch(txt, /All include two/i)
  assert.doesNotMatch(txt, /processes set up and documents loaded/i)
  assert.match(line('- Do it yourself (Hazlo tú)'), /no setup sessions/)
  assert.match(line('- Do it yourself, team'), /no setup sessions/)
  const guided = line('- Guided (Acompañado)')
  assert.match(guided, /2 one-hour video calls/)
  assert.match(guided, /does not set up the customer's own procedures or load the customer's documents/)
  assert.match(guided, /1 month of the Essential monthly plan included/)
  assert.match(line('- Do it yourself (Hazlo tú)'), /no monthly plan included/)
})

test('llms.txt: sin Pack Espana (socios, 29-10-2026); el A medida, con el plan Esencial; las sesiones, con la prima en persona', () => {
  assert.doesNotMatch(txt, /Spain Pack|Pack España/)
  assert.equal(
    line('- Custom:'),
    `- Custom: from ${formatPrice(CUSTOM_FROM_PRICE, 'en')}. We set up the brain for you, with the Essential plan. More than 10 people? We quote it as a custom project.`
  )
  // La clausula 3 de las condiciones remite a la prima de la pagina de compra (oferta v1.9).
  assert.match(line('- Setup sessions:'), /In person, only at weekends and with a surcharge: travel at cost plus 50% of the one-off payment\.$/)
})

test('llms.txt: la videollamada, en la pagina publica de Cal.com', () => {
  assert.equal(BOOKING_URL, 'https://cal.com/pymaticlabs/videollamada')
  assert.ok(txt.includes(`Book a video call: ${BOOKING_URL}`))
})

test('llms.txt: si falta un texto de la web, no se genera', () => {
  const en = messages('en')
  delete en.pricing.b2b
  assert.throws(() => buildLlmsTxt({ es: messages('es'), en, baseUrl: 'https://pymaticlabs.com' }), /pricing\.b2b/)
})

test('llms.txt: con plazas, el precio de lanzamiento; sin ninguna, solo el de lista (como /precios)', () => {
  assert.ok(txt.includes(`- Launch prices apply to the first ${LAUNCH_CUSTOMERS} customers; after that, the list price.`))
  const over = buildLlmsTxt({ es: messages('es'), en: messages('en'), baseUrl: 'https://pymaticlabs.com', launchOpen: false })
  assert.doesNotMatch(over, /launch price\b|first 10 customers/i)
  assert.ok(over.includes('- Launch prices are over. The 10 launch-price places have been taken: list prices apply.'))
  for (const m of modalities) {
    const name = over.split('\n').find((l) => l.startsWith(`- ${messages('en').offer.modalities[m.id].name} (`))!
    assert.ok(name.includes(`: ${formatPrice(m.listPrice, 'en')}; `), m.id)
    assert.ok(!name.includes(formatPrice(m.launchPrice, 'en') + ' '), m.id)
  }
})

test('llms.txt: a empresas y profesionales de cualquier pais, en euros, y debajo el IVA de cada caso (como /precios)', () => {
  const lines = txt.split('\n')
  const b2b = lines.indexOf('- Sold to businesses and professionals in any country, in euros.')
  assert.ok(b2b > 0, 'falta a quien se vende')
  assert.match(lines[b2b + 1], /^- 21% VAT is added in Spain \(mainland and Balearic Islands\) and from other EU countries without a valid VAT number\. /)
  assert.match(lines[b2b + 1], /No Spanish VAT for EU businesses with a valid VAT number, or for businesses in the Canary Islands, Ceuta, Melilla or outside the EU\.$/)
  assert.doesNotMatch(txt, /established in Spain|based in Spain|Spain only|only (?:in|to) Spain|Stripe Tax/i)
  // Las condiciones ya tienen version inglesa (/en/condiciones), y llms.txt esta en ingles.
  assert.equal(line('- Terms of use and sale:'), '- Terms of use and sale: https://pymaticlabs.com/condiciones (English: https://pymaticlabs.com/en/condiciones)')
})

test('JSON-LD: PymaticLabs con su NIF y su NIF-IVA (el del ROI), y los precios en euros', () => {
  const org = getOrganizationSchema()
  assert.equal(org.taxID, 'B88781745')
  assert.equal(org.vatID, 'ES' + org.taxID)
  assert.equal(org.address.addressCountry, 'ES')
  const product = getProductSchema({ locale: 'en', description: 'x' })
  assert.equal(product.offers.priceCurrency, 'EUR')
  assert.equal(product.offers.lowPrice, Math.min(...modalities.map((m) => m.launchPrice)))
  assert.equal(getProductSchema({ locale: 'es', description: 'x', launchOpen: false }).offers.lowPrice, Math.min(...modalities.map((m) => m.listPrice)))
  // Sin nada que limite la venta a un pais (ni areaServed ni eligibleRegion).
  assert.doesNotMatch(JSON.stringify([org, product]), /areaServed|eligibleRegion|Spain only|con sede/)
  // Ni el Pack Espana, que ya no se ofrece: las cuatro modalidades.
  assert.equal(product.offers.offerCount, 4)
  assert.doesNotMatch(JSON.stringify([org, product, getProductSchema({ locale: 'es', description: 'x' })]), /Pack/)
})
