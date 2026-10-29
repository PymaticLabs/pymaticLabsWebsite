import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LEGAL_VERSIONS, PENDING_NOTE, type LegalDocumentId } from './legal-versions.ts'
import { DRAFT_MARK, currentTerms, ensureTermsSnapshot, renderTermsHtml, termsAttachment, termsPath } from './delivery/terms.ts'
import { shortProductName } from './delivery/products.ts'
import type { ModalityId } from './offer.ts'
import type { Storage } from './delivery/types.ts'
import { PROFILE_HINT_KEY } from './zone-profile.ts'
import { THEME_COOKIE } from './theme.ts'

// Los textos legales de content/legal tal como se publican (sin sus notas internas): las fechas de
// lib/legal-versions.ts, lo que piden las versiones del cerebro (condiciones 0.9 con el contrato de
// encargado 0.3, privacidad 0.7, vulnerabilidades 1.7) y las decisiones de los socios del 27-10-2026
// (se vende a empresas y profesionales de cualquier pais, con el IVA de cada caso segun
// iva-en-ventas.md, sin Stripe Tax y con el NIF-IVA de la UE comprobado en VIES; las condiciones y la
// privacidad del producto, tambien en ingles, con la castellana por encima).

const ROOT = process.cwd()
const DIR = path.join(ROOT, 'content', 'legal')
const IDS = Object.keys(LEGAL_VERSIONS) as LegalDocumentId[]
const ALL = [...IDS, 'politica-de-vulnerabilidades']

function file(locale: string, name: string): string {
  return path.join(DIR, locale, `${name}.md`)
}

/** El texto que se publica: el de la pagina legal (lib/markdown.ts) y el de la copia de la compra. */
function published(locale: string, name: string): string {
  return fs.readFileSync(file(locale, name), 'utf-8').replace(PENDING_NOTE, '')
}

/** Una clausula de las condiciones: de su titulo al siguiente. */
function clause(text: string, n: number): string {
  const start = text.search(new RegExp(`^## ${n}\\. `, 'm'))
  assert.ok(start >= 0, `clausula ${n}`)
  const end = text.slice(start + 1).search(/^## /m)
  return end < 0 ? text.slice(start) : text.slice(start, start + 1 + end)
}

/** Las cifras del texto, ordenadas: una traduccion fiel lleva las mismas (plazos, articulos, importes). */
function numbers(text: string): string[] {
  return (text.match(/\d+/g) ?? []).sort()
}

/** Los enlaces del texto; los del castellano, como quedan en ingles (/x pasa a /en/x). */
function links(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
}
function inEnglish(href: string): string {
  return href.startsWith('/') ? `/en${href}` : href.replace('anydesk.com/es/', 'anydesk.com/en/')
}

/** Un almacen en memoria, para la copia de las condiciones. */
function memoryStorage(): Storage & { files: Map<string, Buffer> } {
  const files = new Map<string, Buffer>()
  return {
    files,
    async put(bucket, filePath, content) {
      files.set(`${bucket}/${filePath}`, content)
    },
    async get(bucket, filePath) {
      return files.get(`${bucket}/${filePath}`) ?? null
    },
    async exists(bucket, filePath) {
      return files.has(`${bucket}/${filePath}`)
    },
    async signedUrl() {
      return 'https://almacen.example.test/firmado'
    },
  }
}

test('versiones: una fecha de verdad por texto legal, y cada uno tiene su castellano y su ingles', () => {
  for (const id of IDS) {
    const version = LEGAL_VERSIONS[id]
    assert.match(version, /^\d{4}-\d{2}-\d{2}$/, id)
    assert.equal(new Date(`${version}T00:00:00Z`).toISOString().slice(0, 10), version, id)
  }
  // Con su fichero en ingles, /en/<texto> lo ensena en ingles (lib/markdown.ts solo cae al castellano
  // si no esta): tambien las condiciones y la privacidad del producto.
  for (const name of ALL) {
    assert.ok(fs.existsSync(file('es', name)), `${name} en castellano`)
    assert.ok(fs.existsSync(file('en', name)), `${name} en ingles`)
  }
  // La copia de las condiciones lleva la version de la compra.
  assert.equal(currentTerms('es', ROOT).version, LEGAL_VERSIONS.condiciones)
  assert.equal(currentTerms('en', ROOT).version, LEGAL_VERSIONS.condiciones)
})

// Cada texto publicado con su fecha: los 16 primeros caracteres del SHA-256 de lo que se publica (sin
// notas internas, con saltos de linea \n). Los cinco cambian respecto a lo publicado (2026-10-21; el
// aviso legal, 2026-10-09) y salen el 29-10-2026. Si un texto cambia despues de publicarse, cambia su
// fecha en lib/legal-versions.ts; despues, su huella aqui.
const PUBLISHED: Record<LegalDocumentId, { version: string; es: string; en: string }> = {
  'aviso-legal': { version: '2026-10-29', es: '4172ba7a9a50f873', en: 'd0892172c66fba91' },
  'politica-privacidad': { version: '2026-10-29', es: '9a24005dcc9f5130', en: '409e72666e14ee59' },
  'politica-cookies': { version: '2026-10-29', es: '42d35a04318ba7d2', en: '29abf4b49b077d6e' },
  condiciones: { version: '2026-10-30', es: '97575b0b0060ed99', en: '0c2d7c3e939c085f' },
  'privacidad-producto': { version: '2026-10-29', es: 'ffa8d41ed8a0bef0', en: '74b1172903057f70' },
}

test('versiones: la fecha de cada texto va con su texto (el dia en que se publica)', () => {
  for (const id of IDS) {
    assert.equal(LEGAL_VERSIONS[id], PUBLISHED[id].version, id)
    for (const locale of ['es', 'en'] as const) {
      const sha = createHash('sha256').update(published(locale, id).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16)
      assert.equal(sha, PUBLISHED[id][locale], `${locale}/${id} ha cambiado: si ya se publico el ${LEGAL_VERSIONS[id]}, cambia su fecha en lib/legal-versions.ts; despues, su huella en esta prueba`)
    }
  }
})

test('notas internas: una cita de una linea que empieza por Pendiente o Pending no se publica', () => {
  const source = 'Uno.\n\n> Pendiente: algo interno.\n\nDos.\r\n> Pending: something.\r\n> Una cita normal.\n>Pendiente: pegada.\n'
  assert.equal(source.replace(PENDING_NOTE, ''), 'Uno.\n\n\nDos.\r\n> Una cita normal.\n')
})

test('textos publicados: sin pendientes a la vista, sin nombres de dentro y con la marca Pymatic Labs', () => {
  for (const locale of ['es', 'en']) {
    for (const name of ALL) {
      const text = published(locale, name)
      const where = `${locale}/${name}`
      assert.doesNotMatch(text, /PENDIENTE|Pendiente:|Pending:|pendiente de fijar|\[TODO/, where)
      assert.doesNotMatch(text, /\b(Eric|Manel|Sergio)\b/, where)
      assert.doesNotMatch(text, /PymaticLabs/, `${where}: la marca es Pymatic Labs`)
      assert.doesNotMatch(text, /Frankfurt/, `${where}: Supabase esta en Irlanda`)
    }
  }
})

test('marca de borrador: la copia de las condiciones que se lleva el cliente, la de la web en su idioma, sin cambiar la huella', () => {
  for (const locale of ['es', 'en'] as const) {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    // Los mismos textos que la pagina legal (legal.draftBadge y legal.draftNote).
    assert.deepEqual(DRAFT_MARK[locale], { badge: messages.legal.draftBadge, note: messages.legal.draftNote }, locale)
    const terms = currentTerms(locale, ROOT)
    const html = renderTermsHtml(terms, locale, 'https://web.example.test/')
    const header = html.slice(html.indexOf('<header>'), html.indexOf('</header>'))
    assert.ok(header.includes(`<span class="badge">${messages.legal.draftBadge}</span></h1>`), locale)
    assert.ok(header.includes(`<p class="draft">${messages.legal.draftNote}</p>`), locale)
    // Fuera del texto aceptado: la huella sigue siendo la del texto publicado, y el texto no la lleva.
    assert.equal(terms.sha256, createHash('sha256').update(published(locale, 'condiciones')).digest('hex'), locale)
    assert.ok(!terms.markdown.includes(messages.legal.draftNote), locale)
    assert.equal(html.split(messages.legal.draftNote).length, 2, `${locale}: la nota, una vez`)
  }
})

test('marca de borrador: todas las paginas legales, en castellano y en ingles, y la politica de /seguridad', () => {
  // components/legal-document.tsx pinta la marca y la nota para cualquier texto e idioma, no solo
  // cuando cae al castellano.
  const page = fs.readFileSync(path.join(ROOT, 'components', 'legal-document.tsx'), 'utf-8')
  const fallback = page.indexOf('{fallback &&')
  for (const mark of ["{t('draftBadge')}", "{t('draftNote')}"]) {
    const at = page.indexOf(mark)
    assert.ok(at >= 0 && at < fallback, `${mark} fuera del aviso de solo castellano`)
  }
  const security = fs.readFileSync(path.join(ROOT, 'app', '[locale]', 'seguridad', 'page.tsx'), 'utf-8')
  assert.ok(security.includes("{t('draftBadge')}") && security.includes("{t('draftNote')}"))
  for (const locale of ['es', 'en']) {
    const messages = JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
    assert.ok(messages.legal.draftBadge && messages.legal.draftNote, `${locale}: textos de la marca`)
  }
})

test('nadie lee que solo se vende en Espana', () => {
  for (const name of ALL) {
    assert.doesNotMatch(published('es', name), /establecid[oa]s? en España|(solo|únicamente) (a|en) España|fuera de España|IVA (fijo|español) del 21 %/, `es/${name}`)
    assert.doesNotMatch(published('en', name), /established in Spain|only (to|in) Spain|outside Spain|21 ?% VAT|VAT of 21/, `en/${name}`)
  }
})

test('condiciones: las de la version 0.9, a empresas de cualquier pais y con el IVA de cada caso', () => {
  const text = published('es', 'condiciones')
  // Clausula 2: empresas y profesionales de cualquier pais, nunca consumidores; castellano o ingles.
  const two = clause(text, 2)
  assert.match(two, /^Solo contratan empresas y profesionales de cualquier país, para su actividad: al comprar, el Cliente declara que no actúa como consumidor\. Si compra un consumidor, se le devuelve el pago\.$/m)
  assert.match(two, /Se contrata en castellano o en inglés; si las versiones difieren, prevalece la castellana\./)
  assert.doesNotMatch(text, /la única versión disponible/)
  // Clausula 4: el texto de la v0.9 con cada caso, sin Stripe Tax (el IVA lo decide la web antes de pagar).
  const four = clause(text, 4)
  assert.match(four, /El precio es el de la página de compra al comprar, en euros\./)
  assert.match(four, /Pymatic Labs emite la factura y la envía por correo, con los impuestos que correspondan según el país y la condición del Cliente/)
  assert.match(four, /con el IVA español si está establecido en la España peninsular o en Baleares/)
  assert.match(four, /si lo está en Canarias, Ceuta, Melilla u otro país, sin IVA español \(artículo 69 de la Ley 37\/1992 del IVA\)/)
  // Monaco, como Francia (territorio frances del IVA): como la UE, con su NIF-IVA o con el IVA espanol.
  assert.match(four, /en la Unión Europea y en Mónaco lo liquida el Cliente en su país, con su NIF-IVA válido en VIES, que Pymatic Labs comprueba antes del pago, y sin él se cobra el IVA español\./)
  assert.match(four, /El Cliente da sus datos fiscales correctos al comprar\./)
  assert.doesNotMatch(text, /Stripe Tax|21 %/)
  // El mensual, al mes o al ano.
  assert.match(text, /por meses o por años adelantados/)
  assert.match(text, /al final del mes o del año pagado/)
  // Mas personas de las licenciadas: aviso, 15 dias y, si no, incumplimiento grave.
  assert.match(text, /\*\*Uso por más personas de las licenciadas\.\*\*/)
  assert.match(text, /o usar la licencia con más personas de las licenciadas\)/)
  // Cinco anos de soporte de seguridad por version.
  assert.match(text, /\*\*Periodo de soporte de seguridad\.\*\* Es de cinco años desde la publicación de cada versión\./)
  // La fecha de fin, tambien en la pagina de compra (/comprar y /precios la ensenan), como la v0.9.
  assert.match(text, /consta en las notas de la versión y en la página de compra\./)
  // Las sesiones, de lunes a viernes por la tarde y los sabados por la manana.
  assert.match(text, /por videollamada, de lunes a viernes de 18:00 a 22:00 y los sábados de 10:00 a 14:00/)
  // Negociar 30 dias y luego el juzgado que toque: sin someterse a Castellon.
  assert.match(text, /negociando de buena fe durante 30 días \(artículo 5 de la Ley Orgánica 1\/2025\)/)
  assert.doesNotMatch(text, /se someten/)
  // El anexo: el contrato de encargado 0.3, con el acceso remoto y sus subencargados.
  assert.match(text, /pantalla compartida o con acceso remoto \(AnyDesk\) que el Cliente autoriza/)
  assert.match(text, /el correo y el programa de acceso remoto/)
  assert.match(text, /AnyDesk Software GmbH \(Stuttgart, Alemania\)/)
  // Las secciones, en su orden: 18 clausulas y el anexo.
  const sections = [...text.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1]))
  assert.deepEqual(sections, Array.from({ length: 18 }, (_, i) => i + 1))
  assert.match(text, /^## Anexo\. Contrato de encargado del tratamiento en el soporte$/m)
})

test('condiciones en ingles: la traduccion del texto castellano, con la marca Digital Brain y la castellana por encima', () => {
  const es = published('es', 'condiciones')
  const en = published('en', 'condiciones')
  const two = clause(en, 2)
  assert.match(two, /^Only businesses and professionals from any country may contract, for their business activity: when buying, the Customer declares that they are not acting as a consumer\. If a consumer buys, the payment is refunded\.$/m)
  assert.match(two, /The contract may be made in Spanish or in English; if the versions differ, the Spanish one prevails\./)
  const four = clause(en, 4)
  assert.match(four, /The price is the one on the purchase page at the time of purchase, in euros\./)
  assert.match(four, /with Spanish VAT if the Customer is established in mainland Spain or the Balearic Islands/)
  assert.match(four, /if established in the Canary Islands, Ceuta, Melilla or another country, without Spanish VAT \(Article 69 of Spanish VAT Act 37\/1992\)/)
  assert.match(four, /in the European Union and in Monaco, the Customer accounts for the VAT in their own country, with their VAT number valid in VIES, which Pymatic Labs checks before payment, and without it Spanish VAT is charged\./)
  assert.doesNotMatch(en, /Stripe Tax|21 ?%/)
  // La misma estructura, las mismas cifras y los mismos enlaces, en su version inglesa.
  assert.deepEqual([...en.matchAll(/^## (\d+)\./gm)].map((m) => Number(m[1])), Array.from({ length: 18 }, (_, i) => i + 1))
  assert.match(en, /^## Annex\. Data processing agreement for support$/m)
  assert.equal(en.match(/^#{2,3} /gm)?.length, es.match(/^#{2,3} /gm)?.length)
  assert.deepEqual(numbers(en), numbers(es))
  assert.deepEqual(links(en), links(es).map(inEnglish))
  // En ingles el producto es Digital Brain (y cada modalidad, su nombre en ingles), y al final dice que
  // prevalece el castellano.
  assert.doesNotMatch(en, /Cerebro Digital|Hazlo tú|Acompañado|En solitario|Solista|Banda|Dúo|Orquesta|zona de socio/)
  assert.match(en, /\n\*In case of discrepancy between this English version and the Spanish one, the Spanish version prevails\.\*\n$/)
})

test('condiciones: cada producto con el nombre de la web, el mismo que llevan el pago y la factura', () => {
  // Las modalidades, con nombre propio (Sergio, 29-10-2026): En solitario (Solista y Banda) y
  // Acompanado (Duo y Orquesta). Los nombres, los de lib/delivery/products.ts (Stripe y Holded).
  const WORDS = {
    es: { solo: 'En solitario', guided: 'Acompañado', guidedIn: 'En el Acompañado', one: 'para una persona', team: 'con equipo', and: 'y' },
    en: { solo: 'On your own', guided: 'Guided', guidedIn: 'In Guided', one: 'for one person', team: 'with a team', and: 'and' },
  } as const
  for (const locale of ['es', 'en'] as const) {
    const w = WORDS[locale]
    const name = (id: ModalityId) => shortProductName(id, locale)
    const text = published(locale, 'condiciones')
    // Clausula 3: cada familia, con su modalidad para una persona y la de equipo.
    const three = clause(text, 3)
    assert.ok(three.includes(`**${w.solo}: ${name('hazlo-tu')}, ${w.one}, ${w.and} ${name('hazlo-tu-equipo')}, ${w.team}.**`), locale)
    assert.ok(three.includes(`**${w.guided}: ${name('acompanado')}, ${w.one}, ${w.and} ${name('acompanado-equipo')}, ${w.team}.**`), locale)
    // Sin meses de Suscripcion, solo la de una persona sin sesiones.
    assert.ok(three.includes(`${name('hazlo-tu')} ${locale === 'es' ? 'no trae meses de Suscripción' : 'comes with no months of Subscription'}`), locale)
    // Clausula 5: la garantia de montaje de cada familia, con sus dos modalidades.
    const five = clause(text, 5)
    assert.ok(five.includes(`${w.guidedIn} (${name('acompanado')} ${w.and} ${name('acompanado-equipo')}): `), locale)
    assert.ok(five.includes(` ${w.solo} (${name('hazlo-tu')} ${w.and} ${name('hazlo-tu-equipo')}): `), locale)
  }
  // Los nombres de antes, en ningun texto publicado.
  for (const name of ALL) {
    assert.doesNotMatch(published('es', name), /Hazlo tú/, `es/${name}`)
    assert.doesNotMatch(published('en', name), /Do it yourself/i, `en/${name}`)
  }
})

test('copia de las condiciones: la del idioma del cliente, con su huella, y con el <base> de la web sus enlaces abren desde el fichero guardado', () => {
  const es = currentTerms('es', ROOT)
  const en = currentTerms('en', ROOT)
  assert.equal(es.lang, 'es')
  assert.equal(en.lang, 'en')
  // La huella es la del texto publicado de cada idioma.
  assert.equal(es.sha256, createHash('sha256').update(published('es', 'condiciones')).digest('hex'))
  assert.equal(en.sha256, createHash('sha256').update(published('en', 'condiciones')).digest('hex'))
  assert.notEqual(en.sha256, es.sha256)
  for (const [terms, locale, home] of [
    [es, 'es', ''],
    [en, 'en', '/en'],
  ] as const) {
    const html = renderTermsHtml(terms, locale, 'https://web.example.test/')
    const head = html.slice(0, html.indexOf('</head>'))
    assert.ok(head.includes(`<html lang="${locale}">`), locale)
    assert.ok(head.includes('<base href="https://web.example.test/">'), locale)
    assert.ok(html.includes(terms.sha256), locale)
    assert.doesNotMatch(html, /only one available/)
    // Los del texto (/zona, /privacidad-producto...) van a la web de su idioma, no a file:///zona.
    const local = [...html.matchAll(/href="(\/[^"]*)"/g)].map((m) => new URL(m[1], 'https://web.example.test/').href)
    assert.ok(local.includes(`https://web.example.test${home}/privacidad-producto`), locale)
    assert.ok(local.includes(`https://web.example.test${home}/zona`), locale)
  }
})

test('copia guardada de las condiciones: una por version e idioma, y si el texto cambia sin cambiar la fecha, no se cobra', async () => {
  const storage = memoryStorage()
  const es = await ensureTermsSnapshot(storage, 'es', 'https://web.example.test')
  const en = await ensureTermsSnapshot(storage, 'en', 'https://web.example.test')
  const saved = (locale: 'es' | 'en') => storage.files.get(`customer-files/${termsPath(LEGAL_VERSIONS.condiciones, locale)}`)?.toString('utf-8') ?? ''
  assert.ok(saved('es').includes(es.sha256))
  assert.ok(saved('en').includes(en.sha256))
  assert.ok(saved('en').includes('<html lang="en">'))
  // Otra vez con el mismo texto: la misma copia.
  const again = await ensureTermsSnapshot(storage, 'en', 'https://web.example.test')
  assert.equal(again.sha256, en.sha256)
  assert.equal(storage.files.size, 2)
  // Guardada con otro texto (el castellano que se ensenaba en ingles, o un texto cambiado con la misma
  // fecha): el pago no sale con una huella que no es la de su copia.
  storage.files.set(`customer-files/${termsPath(LEGAL_VERSIONS.condiciones, 'en')}`, Buffer.from(saved('es'), 'utf-8'))
  await assert.rejects(ensureTermsSnapshot(storage, 'en', 'https://web.example.test'), /cambia la fecha en lib\/legal-versions\.ts/)
})

test('copias de versiones anteriores: no frenan el pago con la vigente (2026-10-30) y cada compra recibe la que acepto', async () => {
  const storage = memoryStorage()
  // Una copia de 2026-10-28, guardada en una prueba antes de publicar, con otro texto.
  const old = '2026-10-28'
  storage.files.set(`customer-files/${termsPath(old, 'es')}`, Buffer.from('<p>Versión publicada el 2026-10-28. Huella SHA-256 del texto: 0000.</p><!--aceptacion-->', 'utf-8'))
  const terms = await ensureTermsSnapshot(storage, 'es', 'https://web.example.test')
  assert.equal(terms.version, '2026-10-30')
  assert.ok(storage.files.has(`customer-files/${termsPath('2026-10-30', 'es')}`))
  const accepted = (version: string) =>
    termsAttachment(storage, { version, locale: 'es', company: 'Acme SA de CV', taxId: 'MX-ACM010101AB1', acceptedAt: '2026-10-29T10:00:00Z', paymentRef: 'pi_1' })
  const before = await accepted(old)
  assert.equal(before?.version, old)
  assert.match(before!.attachment.content.toString('utf-8'), /Huella SHA-256 del texto: 0000\./)
  const now = await accepted(terms.version)
  assert.equal(now?.attachment.name, 'condiciones-2026-10-30.html')
  const html = now!.attachment.content.toString('utf-8')
  assert.ok(html.includes(terms.sha256))
  assert.match(html, /Versión publicada el 2026-10-30\./)
  assert.match(html, /Aceptadas por Acme SA de CV \(MX-ACM010101AB1\)/)
  // La que se lleva el cliente, con la marca de borrador de la web.
  assert.match(html, /<span class="badge">Borrador<\/span><\/h1>/)
  assert.ok(html.includes('<p class="draft">Pendiente de revisión legal. Puede cambiar antes de su versión definitiva.</p>'))
})

test('identificacion fiscal: el Cliente puede ser de cualquier pais; NIF, solo el de Pymatic Labs y en NIF-IVA', () => {
  // Las condiciones (clausula 6: titular, fichero de licencia y limites) dicen «identificacion fiscal»,
  // como la privacidad del producto y la version inglesa («tax ID»): el NIF es el espanol.
  for (const name of ALL) {
    assert.doesNotMatch(published('es', name).replace(/NIF(:\*\*)? B88781745|NIF-IVA/g, ''), /\bNIF\b/, `es/${name}`)
    assert.doesNotMatch(published('en', name).replace(/\(NIF\)(:\*\*)? B88781745/g, ''), /\bNIF\b/, `en/${name}`)
  }
  const es = clause(published('es', 'condiciones'), 6)
  const en = clause(published('en', 'condiciones'), 6)
  for (const [inSpanish, inEnglish] of [
    [/\*\*Titular y personas\.\*\* Es de la empresa o el profesional que compra, con su identificación fiscal\./, /\*\*Holder and people\.\*\* It belongs to the business or professional that buys it, with its tax ID\./],
    [/\*\*Fichero de licencia\.\*\* .* Dice el Cliente y su identificación fiscal, si es para una persona/, /\*\*License file\.\*\* .* It states the Customer and their tax ID, whether it is for one person/],
    [/\*\*Límites\.\*\* .* No pasa a otra identificación fiscal salvo con la cesión del contrato/, /\*\*Limits\.\*\* .* It does not pass to another tax ID except through an assignment of the contract/],
  ]) {
    assert.match(es, inSpanish)
    assert.match(en, inEnglish)
  }
  assert.match(published('es', 'privacidad-producto'), /la razón social y la identificación fiscal del Cliente/)
  // Lo que cambia respecto al documento 0.9 del cerebro, en una nota interna que no se publica.
  assert.match(clause(fs.readFileSync(file('es', 'condiciones'), 'utf-8'), 6), /^> Pendiente: el documento \(versión 0\.9\) dice «NIF» en «Titular y personas», «Fichero de licencia» y «Límites»; aquí, «identificación fiscal»/m)
})

test('privacidad del producto: Stripe con sus dos papeles, la consulta a VIES, AnyDesk y las garantias de cada proveedor', () => {
  const text = published('es', 'privacidad-producto')
  assert.match(text, /Stripe Payments Europe, Limited \(Irlanda\)/)
  assert.match(text, /Ve solo la marca, los últimos cuatro dígitos, la caducidad, el país y una huella de la tarjeta\./)
  assert.match(text, /AnyDesk \(AnyDesk Software GmbH, Alemania\)/)
  assert.match(text, /Supabase, en su región de la Unión Europea \(Irlanda\)/)
  assert.match(text, /usa una entidad de Singapur/)
  assert.match(text, /recibe copia de las garantías de cada proveedor/)
  assert.doesNotMatch(text, /Stripe Tax|inversión del sujeto pasivo|21 %/)
  // La pagina de compra pide pais e identificacion fiscal; el NIF-IVA de la UE se consulta en VIES,
  // por obligacion legal, y se guarda el numero de la consulta.
  assert.match(text, /La página de compra pide el país y la identificación fiscal antes de pagar, porque de ellos depende el IVA/)
  assert.match(text, /\*\*Comprobación del NIF-IVA\.\*\* .*VIES, el sistema de la Comisión Europea.*el número de la consulta y su fecha.*Base: obligación legal \(artículo 6\.1\.c del RGPD\)\./)
  // Lo que se guarda y a quien se pregunta, como lo hace la web (vies_name y vies_address de
  // lib/delivery/checkout-tax.ts; Monaco con Francia; other_tax_id_is_vat de lib/checkout.ts).
  assert.match(text, /\*\*Comprobación del NIF-IVA\.\*\* Si el Cliente es de otro país de la Unión Europea o de Mónaco y da su NIF-IVA \(o, como identificación fiscal, un número con su forma\)/)
  assert.match(text, /Si el NIF-IVA es válido, se guardan con el pedido el número de la consulta y su fecha y, si VIES los da, el nombre y la dirección que tiene registrados\./)
  // Uno escrito como identificacion fiscal no hace pedido si es valido (other_tax_id_is_vat): se pide
  // escribirlo como NIF-IVA, y de su consulta no se guarda nada.
  assert.match(text, /De la consulta de un número dado como identificación fiscal no se guarda nada: si es válido, se pide escribirlo como NIF-IVA\./)
  assert.match(text, /\*\*La Comisión Europea\*\*, con VIES, y la administración tributaria del país del Cliente/)
  assert.match(text, /el país o el IVA del pago no cuadran con lo declarado, la revisa una persona/)
  // Los correos de la entrega, tambien el aviso de la clausula 4 (payment_failed_email).
  assert.match(text, /el aviso de un cobro del mensual que no se pudo hacer, con la fecha en que se suspende/)
  // Lo que Eric aun no ha confirmado no se publica como hecho.
  for (const locale of ['es', 'en']) {
    assert.doesNotMatch(published(locale, 'privacidad-producto'), /verificación en dos pasos|disco cifrado|two-step|two-factor|encrypted disk/)
    assert.doesNotMatch(published(locale, 'condiciones'), /verificación en dos pasos|disco cifrado|two-step|two-factor|encrypted disk/)
  }
  // La web tambien da la copia de las garantias.
  assert.match(published('es', 'politica-privacidad'), /copia de las garantías de cada proveedor/)
  assert.match(published('en', 'politica-privacidad'), /copy of each provider's safeguards/)
})

test('privacidad del producto en ingles: la traduccion del texto castellano, con VIES y la castellana por encima', () => {
  const es = published('es', 'privacidad-producto')
  const en = published('en', 'privacidad-producto')
  assert.match(en, /\*\*VAT number check\.\*\* .*VIES, the European Commission's system.*the query number and its date.*Basis: legal obligation \(Article 6\(1\)\(c\) GDPR\)\./)
  assert.match(en, /\*\*VAT number check\.\*\* If the Customer is from another European Union country or from Monaco and gives their VAT number \(or, as tax ID, a number in that format\)/)
  assert.match(en, /If the VAT number is valid, the query number and its date are kept with the order and, if VIES provides them, the name and address it has on record\./)
  assert.match(en, /Nothing is kept from the check of a number given as tax ID: if it is valid, the Customer is asked to enter it as a VAT number\./)
  assert.match(en, /\*\*The European Commission\*\*, with VIES, and the tax authority of the Customer's country/)
  assert.match(en, /Stripe Payments Europe, Limited \(Ireland\)/)
  assert.doesNotMatch(en, /Stripe Tax|21 ?%|Cerebro Digital|zona de socio/)
  assert.equal(en.match(/^#{2,3} /gm)?.length, es.match(/^#{2,3} /gm)?.length)
  assert.equal(en.match(/^ *- /gm)?.length, es.match(/^ *- /gm)?.length)
  assert.deepEqual(numbers(en), numbers(es))
  assert.deepEqual(links(en), links(es).map(inEnglish))
  assert.match(en, /\n\*This English version is provided for convenience\. In case of discrepancy, the Spanish version prevails\.\*\n$/)
})

test('privacidad de la web: la pagina de compra pide pais e identificacion fiscal, y el NIF-IVA de la UE se consulta en VIES', () => {
  const es = published('es', 'politica-privacidad')
  assert.match(es, /\*\*Página de compra:\*\* el país y la identificación fiscal de tu empresa, que comprobamos antes de pagar si es de España o de otro país de la Unión Europea \(un NIF-IVA, en VIES\)/)
  assert.match(es, /la consulta a VIES, obligación legal \(artículo 6\.1\.c\)/)
  assert.match(es, /lo consultamos en \*\*VIES\*\*, el sistema de la Comisión Europea/)
  assert.match(es, /Si das un NIF-IVA de otro país de la Unión Europea o de Mónaco \(o, como identificación fiscal, un número con su forma\)/)
  assert.match(es, /Si el NIF-IVA es válido, guardamos con el pedido el número de la consulta y su fecha y, si VIES los da, el nombre y la dirección que tiene registrados\./)
  assert.match(es, /De la consulta de un número que das como identificación fiscal no guardamos nada: si es válido, te pedimos que lo escribas como NIF-IVA\./)
  const en = published('en', 'politica-privacidad')
  assert.match(en, /\*\*Purchase page:\*\* your company's country and tax ID, which we check before payment if it is from Spain or another European Union country \(an EU VAT number, in VIES\)/)
  assert.match(en, /the VIES check, legal obligation \(Article 6\(1\)\(c\)\)/)
  assert.match(en, /we check it in \*\*VIES\*\*, the European Commission's system/)
  assert.match(en, /If you give a VAT number from another European Union country or from Monaco \(or, as tax ID, a number in that format\)/)
  assert.match(en, /If the VAT number is valid, we keep the query number and its date with the order and, if VIES provides them, the name and address it has on record\./)
  assert.match(en, /We keep nothing from the check of a number you give as tax ID: if it is valid, we ask you to enter it as a VAT number\./)
  assert.deepEqual(numbers(en), numbers(es))
})

test('huella del pago con plaza (client_ref de lib/delivery/launch.ts): las dos privacidades la nombran, con que se queda en Stripe', () => {
  // client_ref va en los metadatos de la sesion de Stripe y no se borra al dia siguiente, como las demas huellas.
  const web = { es: published('es', 'politica-privacidad'), en: published('en', 'politica-privacidad') }
  assert.match(web.es, /Con el precio de lanzamiento, el pago lleva además otra huella cifrada de tu IP, distinta en cada pago, que se queda con él en Stripe: si vuelves atrás y abres otro pago, así te reconocemos y no pierdes la plaza\./)
  assert.match(web.es, /\(formulario, página de compra y zona de socio\): hasta el día siguiente; la que lleva un pago con el precio de lanzamiento, mientras se guarde ese pago en Stripe\./)
  assert.match(web.en, /With the launch price, the payment also carries another encrypted fingerprint of your IP, different for each payment, which stays with it in Stripe: if you go back and open another payment, that is how we recognise you and you do not lose your place\./)
  assert.match(web.en, /\(form, purchase page and member area\): until the next day; the one carried by a launch-price payment, for as long as that payment is kept in Stripe\./)
  const product = { es: published('es', 'privacidad-producto'), en: published('en', 'privacidad-producto') }
  assert.match(product.es, /El pago lleva además en Stripe otra huella cifrada de la IP, distinta en cada pago, para reconocer a quien vuelve atrás y abre otro, y pasarle su plaza\./)
  assert.match(product.es, /Se borran al día siguiente, salvo la que lleva el pago, que se queda con él en Stripe\./)
  assert.match(product.es, /de los límites: hasta el día siguiente; la que lleva el pago en Stripe, mientras se guarde ese pago\./)
  assert.match(product.en, /The payment also carries in Stripe another encrypted fingerprint of the IP, different for each payment, to recognise whoever goes back and opens another one, and give them their place\./)
  assert.match(product.en, /They are deleted the next day, except the one carried by the payment, which stays with it in Stripe\./)
  assert.match(product.en, /for the limits: until the next day; the one carried by the payment in Stripe, for as long as that payment is kept\./)
  // Lo que dicen es lo que hace la web: la huella va en la sesion con plaza, distinta en cada pago.
  const launch = fs.readFileSync(path.join(ROOT, 'lib/delivery/launch.ts'), 'utf-8')
  assert.match(launch, /fingerprint\(d, `\$\{bucket\}\|\$\{launchRef\}`\)/)
  assert.match(fs.readFileSync(path.join(ROOT, 'lib/checkout.ts'), 'utf-8'), /client_ref: input\.clientRef/)
})

test('aviso legal: venta a empresas y profesionales; los juzgados de Castellon, solo para el uso del sitio; la compra, por la clausula 18 de las condiciones', () => {
  const es = published('es', 'aviso-legal')
  assert.match(es, /La venta se dirige solo a empresas y profesionales, para su actividad, y se rige por las \[condiciones de uso y venta\]\(\/condiciones\)/)
  assert.match(es, /Para las controversias sobre el uso de este sitio web, las partes se someten a los juzgados y tribunales de Castellón de la Plana/)
  assert.match(es, /Las de la compra se rigen por la cláusula 18 de las \[condiciones de uso y venta\]\(\/condiciones\)\./)
  assert.doesNotMatch(es, /Para cualquier controversia/)
  const en = published('en', 'aviso-legal')
  assert.match(en, /Sales are addressed only to businesses and professionals, for their business activity, and are governed by the \[terms of use and sale\]\(\/en\/condiciones\)/)
  assert.match(en, /For disputes about the use of this website/)
  assert.match(en, /governed by clause 18 of the \[terms of use and sale\]\(\/en\/condiciones\)\./)
  assert.doesNotMatch(en, /For any dispute/)
})

test('cookies: lo que la web guarda de verdad en el navegador, con sus nombres', () => {
  for (const locale of ['es', 'en']) {
    const text = published(locale, 'politica-cookies')
    assert.ok(text.includes(`\`${THEME_COOKIE}\``), `${locale}: la cookie del tema`)
    assert.ok(text.includes(`\`${PROFILE_HINT_KEY}\``), `${locale}: la pista de la zona en el almacenamiento local`)
    assert.match(text, /sb-<(proyecto|project)>-auth-token/, `${locale}: la sesion de Supabase`)
    assert.match(text, /Vercel Web Analytics/, `${locale}: la medicion de visitas`)
  }
})

test('vulnerabilidades: cinco anos por version, el inventario donde esta y titulos por debajo del de la seccion', () => {
  for (const locale of ['es', 'en']) {
    const text = published(locale, 'politica-de-vulnerabilidades')
    assert.match(text, locale === 'es' ? /cinco años desde la publicación de cada versión/ : /five years from the release of each version/)
    assert.match(text, /cerebro-digital-<(versión|version)>\.cdx\.json/)
    // La fecha de fin del soporte, en las notas y en la pagina de compra (como la v1.7).
    assert.match(text, locale === 'es' ? /va en sus notas y en la página de compra\./ : /stated in its release notes and on the purchase page\./)
    assert.match(text, locale === 'es' ? /consta en las notas de la versión y en la página de compra\./ : /stated in the version's release notes and on the purchase page\./)
    // La pagina /seguridad pone el h2 de la politica: sus apartados van en h3.
    assert.doesNotMatch(text, /^## /m)
    assert.match(text, /^### /m)
  }
})
