import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { companyAlertEmail, paymentFailedEmail, welcomeEmail } from './delivery/emails.ts'
import { parseOtherTaxId } from './delivery/checkout-tax.ts'
import { productName, shortProductName } from './delivery/products.ts'

// Los textos de la web (messages/es.json y en.json): los dos idiomas con las mismas claves, marcadores
// y etiquetas; cada clave que usa el codigo, en los dos; y lo que piden la oferta v1.9 y las
// decisiones del 27-10-2026 (se vende a empresas y profesionales de cualquier pais, en euros, con el IVA
// de cada caso dicho una vez; el portal respeta los meses incluidos; 15 dias de margen con un cobro
// fallido; pasar a equipo se paga; la seguridad gratis, durante el periodo de soporte de cada version;
// lo que Claude lee va a Anthropic).

const ROOT = fileURLToPath(new URL('..', import.meta.url))
type Messages = Record<string, unknown>
const messages = (locale: string): Messages => JSON.parse(fs.readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf-8'))
const es = messages('es')
const en = messages('en')

const get = (o: unknown, key: string): unknown =>
  key.split('.').reduce<unknown>((at, part) => (at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined), o)
const str = (o: Messages, key: string): string => {
  const value = get(o, key)
  assert.equal(typeof value, 'string', key)
  return value as string
}

/** Todos los textos con su ruta (pricing.faq.3.a). */
function strings(node: unknown, at = ''): [string, string][] {
  if (typeof node === 'string') return [[at, node]]
  if (node && typeof node === 'object') return Object.entries(node).flatMap(([k, v]) => strings(v, at ? `${at}.${k}` : k))
  return []
}

/** Los marcadores ({x}, tambien los de {x, plural, ...}) y las etiquetas (<link>) de un texto. */
const tokens = (s: string) => [...s.matchAll(/\{(\w+)\s*[,}]|<\/?(\w+)>/g)].map((m) => (m[1] ? `{${m[1]}}` : m[0])).sort()

test('es y en: las mismas claves, con los mismos marcadores y etiquetas', () => {
  const left = new Map(strings(es))
  const right = new Map(strings(en))
  assert.deepEqual([...left.keys()].filter((k) => !right.has(k)), [], 'solo en es')
  assert.deepEqual([...right.keys()].filter((k) => !left.has(k)), [], 'solo en en')
  for (const [key, value] of left) assert.deepEqual(tokens(right.get(key)!), tokens(value), key)
})

/**
 * Los plural y select de ICU de un texto, con su argumento, su tipo, sus casos y cuantos # lleva:
 * «count plural =0 one other #2».
 */
function icu(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(/\{(\w+),\s*(plural|select|selectordinal),/g)) {
    const cases: string[] = []
    let depth = 0
    let word = ''
    let end = s.length
    for (let i = m.index + m[0].length; i < s.length; i++) {
      const c = s[i]
      if (c === '{') {
        if (depth === 0) cases.push(word.trim())
        word = ''
        depth++
      } else if (c === '}') {
        if (depth === 0) {
          end = i
          break
        }
        depth--
      } else if (depth === 0) word += c
    }
    const hashes = (s.slice(m.index, end).match(/#/g) ?? []).length
    out.push(`${m[1]} ${m[2]} ${cases.join(' ')} #${hashes}`)
  }
  return out
}

test('es y en: los plural y select de ICU, con el mismo argumento, los mismos casos y los mismos #', () => {
  const right = new Map(strings(en))
  let seen = 0
  for (const [key, value] of strings(es)) {
    const cases = icu(value)
    seen += cases.length
    assert.deepEqual(icu(right.get(key)!), cases, key)
    // Cada uno con su «other», que es el que usa ICU si no encaja ningun otro.
    for (const c of cases) assert.match(c, / other /, `${key}: ${c}`)
  }
  assert.ok(seen >= 3, `solo ${seen}: el buscador no encuentra los plural y select`)
  assert.deepEqual(icu('{count, plural, =0 {Nada} one {# cosa} other {# cosas}}'), ['count plural =0 one other #2'])
})

test('cada clave que usa el codigo esta en es y en', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) files.push(p)
    }
  }
  for (const dir of ['app', 'components', 'lib']) walk(path.join(ROOT, dir))
  let used = 0
  const missing: string[] = []
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf-8')
    // Cada t vale desde que se declara hasta la siguiente declaracion con el mismo nombre.
    const decls = [...src.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\(\s*([^)]*)\)/g)].flatMap((m) => {
      const arg = m[2].trim()
      const ns = arg === '' || /^\{\s*locale\s*\}$/.test(arg) ? '' : (arg.match(/^['"]([\w.-]+)['"]$/) ?? arg.match(/namespace:\s*['"]([\w.-]+)['"]/))?.[1]
      return ns === undefined ? [] : [{ name: m[1], ns, from: m.index }]
    })
    for (const [i, { name, ns, from }] of decls.entries()) {
      const until = decls.slice(i + 1).find((d) => d.name === name)?.from ?? src.length
      for (const m of src.slice(from, until).matchAll(new RegExp(`\\b${name}(?:\\.(?:raw|rich|markup|has))?\\(\\s*(['"\`])([^'"\`]*)\\1`, 'g'))) {
        used++
        const key = ns ? `${ns}.${m[2]}` : m[2]
        // Con una parte variable (extras.${id}), basta con lo de delante.
        const fixed = key.includes('${') ? key.slice(0, key.indexOf('${')).replace(/\.$/, '') : key
        for (const [locale, o] of [['es', es], ['en', en]] as const) {
          if (get(o, fixed) === undefined) missing.push(`${locale}: ${path.relative(ROOT, file)}: ${key}`)
        }
      }
    }
  }
  assert.ok(used > 300, `solo ${used} usos: el buscador de claves no encuentra las llamadas`)
  assert.deepEqual(missing, [])
})

test('se vende a cualquier pais, en euros: nada de «con sede en España», Stripe Tax ni dolares', () => {
  // Socios, 27-10-2026: a empresas y profesionales de cualquier pais (B2B), en euros, con el IVA de cada
  // caso decidido por la web antes de pagar (knowledge/10_Fiscal/iva-en-ventas.md), sin Stripe Tax.
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of strings(o)) {
      assert.doesNotMatch(
        value,
        /sede en Espa|establecid[oa]s en Espa|solo (?:a |en )?Espa|(?:established|based) in Spain|Spain only|only (?:in|to) Spain|Stripe Tax|Norteam|North America|d[oó]lares|dollars|\bUSD\b/i,
        `${locale} ${key}`
      )
    }
  }
  // Dicho donde toca: en /precios (y llms.txt), en el pie y en la descripcion de /comprar.
  assert.equal(str(es, 'pricing.b2b'), 'Venta a empresas y profesionales de cualquier país, en euros.')
  assert.equal(str(en, 'pricing.b2b'), 'Sold to businesses and professionals in any country, in euros.')
  assert.equal(str(es, 'footer.b2b'), 'Venta a empresas y profesionales de cualquier país.')
  assert.equal(str(en, 'footer.b2b'), 'Sold to businesses and professionals in any country.')
  for (const key of ['purchase.metaDescription', 'purchase.metaDescriptionManual']) {
    assert.match(str(es, key), /^Pago con Stripe para empresas y profesionales de cualquier país\./, key)
    assert.match(str(en, key), /^Payment with Stripe for businesses and professionals in any country\./, key)
  }
  // Sin paises a los que no se vende (socios, 29-10-2026): el mensual da country_invalid solo con una
  // empresa sin un pais valido guardado (companyTax de lib/checkout.ts), y el texto dice eso.
  assert.match(str(es, 'zone.monthly.errors.country_invalid'), /^No tenemos un país válido de tu empresa y sin él no podemos calcular el IVA\./)
  assert.match(str(en, 'zone.monthly.errors.country_invalid'), /^We do not have a valid country for your company, and without it we cannot work out the VAT\./)
  // Con espacio de no separacion (U+00A0), como «1 h»: el «%» no se queda solo en la linea siguiente.
  assert.match(str(es, 'pricing.markets'), /21 %/)
  assert.match(str(es, 'purchase.price'), /21 %/)
  for (const [key, value] of strings(es)) assert.doesNotMatch(value, /\d %/, `es ${key}: el % con espacio de no separacion`)
  // En ingles, pegado a la cifra («21%»), como en el pago (lib/checkout.ts).
  for (const [key, value] of strings(en)) assert.doesNotMatch(value, /\d[  ]%/, `en ${key}: el % pegado a la cifra`)
})

test('NIF, solo en el campo del NIF espanol de /comprar; a las empresas de fuera, identificacion fiscal', () => {
  // El NIF es el espanol: lo piden el campo de Espana (purchase.taxId) y sus errores (tax_id_*). Lo
  // demas dice «identificacion fiscal» («tax ID») o NIF-IVA, como las condiciones y la privacidad.
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of strings(o)) {
      if (/\bNIF\b(?!-IVA)/.test(value)) assert.match(key, /^purchase\.(taxId\.|errors\.tax_id_)/, `${locale} ${key}`)
    }
  }
  assert.equal(str(en, 'purchase.taxId.label'), 'Company tax ID (Spanish NIF)')
  assert.equal(str(es, 'purchase.otherTaxId.label'), 'Identificación fiscal de la empresa')
})

test('el IVA de cada caso, una vez por pantalla: en /precios, bajo las modalidades; en /comprar, con el precio', () => {
  // knowledge/10_Fiscal/iva-en-ventas.md: el 21 % en la peninsula y Baleares, y desde la UE sin NIF-IVA
  // valido (como a un particular); sin IVA espanol, la UE con NIF-IVA valido (inversion del sujeto
  // pasivo), Canarias, Ceuta y Melilla (fuera del territorio del IVA) y fuera de la UE.
  assert.equal(
    str(es, 'pricing.markets'),
    'Se suma el 21 % de IVA en España (península y Baleares) y desde otro país de la UE sin NIF-IVA válido. Sin IVA español: empresas de la UE con NIF-IVA válido, de Canarias, Ceuta y Melilla, y de fuera de la UE.'
  )
  assert.equal(
    str(en, 'pricing.markets'),
    '21% VAT is added in Spain (mainland and Balearic Islands) and from other EU countries without a valid VAT number. No Spanish VAT for EU businesses with a valid VAT number, or for businesses in the Canary Islands, Ceuta, Melilla or outside the EU.'
  )
  // /precios: el 21 % y los territorios, solo en esa linea. El titulo y las tarjetas dicen «sin IVA». Las
  // preguntas de /precios (con la del IVA) se quitaron (Sergio, 29-10-2026): como se decide, en /comprar.
  const cases = (o: Messages) => strings(get(o, 'pricing')).filter(([, v]) => /21\s?%|Canari|Ceuta|Melilla|Balear/.test(v)).map(([k]) => k)
  assert.deepEqual(cases(es), ['markets'])
  assert.deepEqual(cases(en), ['markets'])
  // /comprar: el precio (price o, sin plazas, priceList: se ve uno) dice cuando se suma el 21 %; lo demas
  // de la pagina que no es el formulario del pago, nada del IVA.
  for (const key of ['purchase.price', 'purchase.priceList']) {
    assert.match(str(es, key), /Sin IVA: se suma el 21 % en España \(península y Baleares\) y desde otro país de la UE sin NIF-IVA válido; en los demás casos, no se suma IVA español\.$/, key)
    assert.match(str(en, key), /VAT not included: 21% is added in Spain \(mainland and Balearic Islands\) and from other EU countries without a valid VAT number; otherwise, no Spanish VAT is added\.$/, key)
  }
  for (const key of ['purchase.subtitle', 'purchase.subtitleManual', 'purchase.b2b', 'purchase.chooseText', 'purchase.securityUntil', 'purchase.securityPeriod']) {
    assert.doesNotMatch(str(es, key), /IVA|21\s?%/, key)
    assert.doesNotMatch(str(en, key), /VAT|21%/, key)
  }
  // En el pie, solo a quien se vende; en la zona, las facturas llevan el IVA decidido al pagar (no siempre el 21 %).
  assert.doesNotMatch(str(es, 'footer.b2b'), /IVA/)
  assert.doesNotMatch(str(es, 'zone.invoices.taxNote'), /21/)
  assert.doesNotMatch(str(en, 'zone.invoices.taxNote'), /21/)
})

test('compra: la prima en persona en /precios y /comprar (la clausula 3 remite alli); solo empresas y profesionales', () => {
  // Oferta v1.9 (Eric, 25-10-2026): en persona, solo en fin de semana; el viaje, a lo que cueste, mas el 50 % del pago unico.
  for (const key of ['pricing.sessions.items.0', 'purchase.chooseText']) {
    assert.match(str(es, key), /En persona, solo en fin de semana y con prima: el viaje, a lo que cueste, más el 50 % del pago único\.$/, key)
    assert.match(str(en, key), /In person, only at weekends and with a surcharge: travel at cost plus 50% of the one-off payment\.$/, key)
  }
  // Debajo de los datos fiscales (los textos del formulario los trae el pago): B2B y las condiciones.
  assert.equal(str(es, 'purchase.b2b'), 'Solo para empresas y profesionales. Se aceptan las condiciones de uso y venta en el pago.')
  assert.equal(str(en, 'purchase.b2b'), 'Businesses and professionals only. You accept the terms of use and sale when paying.')
  assert.match(str(es, 'purchase.subtitle'), /^Indica los datos fiscales de tu empresa y pagas en Stripe\./)
  assert.doesNotMatch(str(es, 'purchase.subtitle'), /NIF/)
})

test('mensual: el portal respeta los meses incluidos en cualquier cambio; cada cosa, una vez por pantalla', () => {
  // Socios, 27-10-2026: trial_update_behavior 'continue_trial' en el portal (scripts/stripe-setup.mts, lo
  // exige lib/delivery/health.ts): ni pasar a anual ni cambiar de plan adelanta el primer cobro.
  // Suscrito: el estado (statuses.trialing) y, debajo, la nota del portal (portalNote), en la misma
  // pantalla; lo de los cambios con meses incluidos, solo en la nota.
  assert.equal(str(es, 'zone.monthly.statuses.trialing'), 'Aún no se cobra: el primer cobro llega cuando acaban los meses incluidos en tu compra.')
  assert.equal(str(en, 'zone.monthly.statuses.trialing'), 'Not charged yet: the first charge comes when the months included in your purchase end.')
  assert.match(
    str(es, 'zone.monthly.portalNote'),
    /pasar a anual o a un plan mayor se cobra ese día; bajar de plan o volver al pago mensual, al acabar el periodo pagado\. Mientras te queden meses incluidos, ningún cambio se cobra antes de que acaben\./
  )
  assert.match(
    str(en, 'zone.monthly.portalNote'),
    /moving to yearly payment or a bigger plan is charged that day; moving to a smaller plan or back to monthly payment, when the paid period ends\. While you have included months left, no change is charged before they end\./
  )
  // Sin suscribir, con meses incluidos (includedNextPlan, encima de los planes), lo que hace el pago
  // (createCheckout, lib/checkout.ts): con ese plan o uno menor, al mes o al ano, la prueba hasta esa
  // fecha; con uno mayor, sin prueba.
  assert.match(str(es, 'zone.monthly.includedNextPlan'), /con el plan \{plan\} o uno menor, pagues al mes o al año, no se cobra nada hasta el \{date\}; con uno mayor, se cobra desde que lo contratas\.$/)
  assert.match(str(en, 'zone.monthly.includedNextPlan'), /with the \{plan\} plan or a smaller one, paid monthly or yearly, nothing is charged until \{date\}; with a bigger one, it is charged from the day you subscribe\.$/)
  // Ya nada dice que un cambio en el portal pierde los meses incluidos (lo de antes de la decision).
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of [...strings(get(o, 'zone.monthly')), ...strings(get(o, 'pricing.monthly'))]) {
      assert.doesNotMatch(value, /pierdes los|meses incluidos que queden|you lose the|included months left\.$/i, `${locale} ${key}`)
    }
  }
})

test('mensual: con un cobro fallido, 15 dias de margen con versiones nuevas; despues, se suspende', () => {
  // Socios, 27-10-2026: durante los 15 dias del aviso (UNPAID_NOTICE_DAYS de lib/delivery/events.ts y el
  // correo paymentFailedEmail) sigue el mantenimiento, con las versiones nuevas; si no paga, se suspende.
  assert.match(str(es, 'zone.monthly.statuses.past_due'), /Durante 15 días desde el aviso sigues teniendo el mantenimiento y el soporte, versiones nuevas incluidas; si para entonces no se ha pagado, se suspenden\.$/)
  assert.match(str(en, 'zone.monthly.statuses.past_due'), /For 15 days after that email you keep maintenance and support, new versions included; if it is still unpaid by then, they are suspended\.$/)
  // Y suspendido (unpaid), la licencia y lo instalado siguen.
  assert.match(str(es, 'zone.monthly.statuses.unpaid'), /tu licencia y lo instalado siguen funcionando\.$/)
})

test('el horario de las sesiones, en la hora de Madrid (la de los huecos de /comprar), igual en todas partes', () => {
  // Quien compra desde fuera no sabe que es la «hora peninsular».
  for (const key of ['pricing.sessions.items.0', 'purchase.chooseText', 'zone.sessions.intro']) {
    assert.match(str(es, key), /hora de Madrid/, key)
    assert.match(str(en, key), /Madrid time/, key)
  }
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of strings(o)) assert.doesNotMatch(value, /peninsular/i, `${locale} ${key}`)
  }
})

test('contacto: la nota de privacidad dice todos los que tratan los datos (Supabase cuenta los envios) y los obligatorios van marcados', () => {
  assert.match(str(es, 'contact.privacyNote'), /\(Vercel, Resend, Google y Supabase\)/)
  assert.match(str(en, 'contact.privacyNote'), /\(Vercel, Resend, Google and Supabase\)/)
  // La politica de privacidad habla de «los campos marcados como obligatorios».
  for (const key of ['contact.name', 'contact.email', 'contact.message']) {
    assert.match(str(es, key), /\(obligatorio\)$/, key)
    assert.match(str(en, key), /\(required\)$/, key)
  }
})

test('la marca es Pymatic Labs (la razon social, PYMATICLABS, S.L.)', () => {
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of strings(o)) {
      assert.doesNotMatch(value.replace(/pymaticlabs\.com/gi, ''), /Pymatic(?! Labs)|PymaticLabs/, `${locale} ${key}`)
    }
  }
})

test('oferta: pasar a equipo se paga, la garantia es de montaje y la seguridad dura lo que el soporte de la version', () => {
  // 14 y 86: la diferencia entre el precio con equipo (o el acompanado) y lo pagado.
  assert.match(str(es, 'pricing.sessions.items.3'), /pagando la diferencia/)
  assert.match(str(en, 'pricing.sessions.items.3'), /paying the difference/)
  assert.match(str(es, 'zone.team.solo'), /pagando la diferencia/)
  // 49: de montaje, por un fallo del producto.
  assert.match(str(es, 'home.pricing.stats.1.text'), /garantía de montaje/)
  assert.match(str(en, 'home.pricing.stats.1.text'), /setup guarantee/)
  assert.ok((get(es, 'pricing.included') as string[]).includes('Garantía de montaje de 14 días'))
  // 16 y 91: gratis durante el periodo de soporte de la version, con o sin mensual.
  for (const key of ['pricing.monthly.securityNote', 'zone.home.monthly.security', 'zone.monthly.security']) {
    assert.match(str(es, key), /periodo de soporte de (tu|su) versión/, key)
    assert.match(str(en, key), /support period/, key)
  }
  assert.match((get(es, 'pricing.included') as string[])[3], /soporte de tu versión/)
  // 54: los packs, aun por construir.
  assert.match(str(es, 'pricing.monthly.rows.5.label'), /\(en preparación\)$/)
  // Sin Pack Espana (socios, 29-10-2026): Aparte, solo el A medida, igual para todos. Los packs del
  // mensual, al dia con la normativa, son otra cosa y siguen.
  for (const o of [es, en]) {
    assert.deepEqual(Object.keys(get(o, 'pricing.apart') as object), ['title', 'custom', 'moreThan10'])
    for (const [key, value] of strings(o)) assert.doesNotMatch(value, /Pack España|Spain Pack/, key)
  }
  assert.equal(str(es, 'pricing.apart.custom.text'), 'Te montamos el cerebro nosotros, con el plan Esencial.')
  assert.equal(str(en, 'pricing.apart.custom.text'), 'We set up the brain for you, with the Essential plan.')
  assert.match(str(es, 'pricing.monthly.rows.5.label'), /^Packs al día con la normativa/)
  for (const file of [['lib', 'offer.ts'], ['app', '[locale]', 'precios', 'page.tsx']]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, ...file), 'utf-8'), /packEspana|PACK_ESPANA/, file.join('/'))
  }
  // 55: el Acompanado con equipo trae las ideas de automatizaciones, como el Acompanado.
  for (const o of [es, en]) assert.ok((get(o, 'pricing.extras.acompanado-equipo') as string[]).includes((get(o, 'pricing.extras.acompanado') as string[])[1]))
  // 94: el Hazlo tu no repite las guias de «En las cuatro».
  assert.doesNotMatch((get(es, 'pricing.extras.hazlo-tu') as string[]).join(' '), /guías/)
  // 92: el horario, el mismo en /precios, /comprar y la zona.
  for (const key of ['pricing.sessions.items.0', 'purchase.chooseText', 'zone.sessions.intro']) {
    assert.match(str(es, key), /[Dd]e lunes a viernes de 18:00 a 22:00 y los sábados de 10:00 a 14:00/, key)
    assert.match(str(en, key), /Monday to Friday from 18:00 to 22:00 and Saturdays from 10:00 to 14:00/, key)
  }
})

test('privacidad: lo que Claude lee sale hacia Anthropic; desde el movil, con Claude abierto', () => {
  // 31 y 50: la promesa de privacidad marca como error decir que no sale nada.
  assert.match(str(es, 'home.faq.items.2.a'), /sí sale: viaja a Anthropic/)
  assert.match(str(en, 'home.faq.items.2.a'), /does leave: it goes to Anthropic/)
  assert.match(str(es, 'features.specs.7.1'), /Anthropic/)
  // 89: lo de salud no lo abre; nominas o DNI, si lo permites.
  assert.equal(str(es, 'home.privacy.items.3.title'), str(es, 'features.groups.4.items.3.title'))
  // 90: el ordenador encendido y con Claude abierto.
  for (const key of ['home.bento.mobile.text', 'features.groups.3.items.3.text']) {
    assert.match(str(es, key), /Claude abierto/, key)
    assert.match(str(en, key), /Claude (is )?open/, key)
  }
})

test('tipografia: tres puntos con su caracter y, en ingles, comillas y apostrofos curvos', () => {
  for (const [locale, o] of [['es', es], ['en', en]] as const) {
    for (const [key, value] of strings(o)) {
      assert.doesNotMatch(value, /\.\.\./, `${locale} ${key}`)
      assert.doesNotMatch(value, /"/, `${locale} ${key}`)
    }
  }
  for (const [key, value] of strings(en)) assert.doesNotMatch(value, /\p{L}'\p{L}/u, `en ${key}`)
  for (const [key, value] of strings(es)) assert.doesNotMatch(value, /[“”]/, `es ${key}: en castellano, «»`)
  // 97: tareas, en plural.
  assert.equal(str(es, 'features.groups.1.items.1.text'), 'Se las explicas una vez y quedan guardadas.')
})

test('correo de bienvenida: la licencia sin mantenimiento dice hasta cuando llega la seguridad', () => {
  const base = { company: 'Estudio Ruiz, S.L.P.', product: 'hazlo-tu', licenseId: 'PML-LIC-2026-0001', supportUntil: '2026-10-27', emitida: '2026-10-27', zoneUrl: 'https://pymaticlabs.com/zona', guided: false, booking: null, termsAttached: true }
  const mail = welcomeEmail({ ...base, locale: 'es' })
  assert.match(mail.text, /recibe gratis las correcciones de seguridad durante el periodo de soporte de cada versión \(cinco años desde que se publica\); no incluye mantenimiento ni soporte/)
  assert.match(welcomeEmail({ ...base, locale: 'en' }).text, /security fixes for free during the support period of each version \(five years from its release\)/)
  // Con meses incluidos, la fecha del mantenimiento y soporte, como siempre.
  assert.match(welcomeEmail({ ...base, locale: 'es', supportUntil: '2027-01-27' }).text, /el mantenimiento y el soporte llegan hasta el 27 de enero de 2027/)
})

test('lo que dice cada caso es lo que hace: launch_busy, los 15 dias, la identificacion de fuera y una empresa sin NIF', () => {
  // launch_busy salta tambien con la conexion en su tope (2 pagos abiertos desde la misma IP de otros
  // NIF) aunque queden plazas libres (lib/delivery/launch.ts): el texto vale para los dos casos, y la
  // e2e busca «Vuelve a probar en media hora».
  assert.match(str(es, 'purchase.errors.launch_busy'), /desde tu conexión \(la de una oficina, por ejemplo\) ya hay dos abiertos\. Vuelve a probar en media hora/)
  assert.match(str(en, 'purchase.errors.launch_busy'), /two are already open from your connection \(an office one, for example\)\. Try again in half an hour/)
  // Sin mantenimiento (Hazlo tu sin equipo) la licencia no lleva el margen: los 15 dias, solo con el.
  assert.match(str(es, 'zone.license.how.support'), /si sale hasta esa fecha y, con mantenimiento, también en los 15 días siguientes/)
  assert.match(str(en, 'zone.license.how.support'), /if it is released by that date and, with maintenance, also within the 15 days after it/)
  // La identificacion de fuera de la UE se limpia (espacios, puntos, barras): lo que la rechaza es
  // tener menos de 4 letras o numeros o mas de 30 caracteres, y el aviso lo dice con su unidad.
  assert.equal(parseOtherTaxId('CH', 'CHE-123.456.789'), 'CHE-123456789')
  assert.equal(parseOtherTaxId('US', '1-2-3'), null)
  for (const key of ['purchase.otherTaxId.invalid', 'purchase.errors.other_tax_id_invalid']) {
    assert.match(str(es, key), /letras, números y guiones.*de 4 a 30 caracteres\.$/, key)
    assert.match(str(en, key), /letters, digits and hyphens.*4 to 30 characters\.$/, key)
  }
  // El cobro fallido con una licencia sin el margen: se entiende cuando se encienden las versiones.
  const failed = paymentFailedEmail({ locale: 'es', company: 'Acme SL', product: 'plan-pro', amount: 19900, currency: 'eur', suspendFrom: '2026-12-17', versionsUntilSuspension: false, payUrl: null, zoneUrl: 'https://pymaticlabs.com/zona' })
  assert.match(failed.text, /Lo nuevo de las versiones que salgan mientras tanto se enciende cuando se pague\./)
  // Una compra con la identificacion de otra empresa: la empresa puede ser de fuera, sin NIF.
  const alert = companyAlertEmail({ locale: 'es', company: 'Acme SA de CV', product: 'hazlo-tu', date: '2026-11-02' })
  assert.doesNotMatch(`${alert.subject}\n${alert.text}`, /\bNIF\b/)
  assert.match(alert.subject, /^Una compra con vuestra identificación fiscal/)
})

test('las modalidades, con su nombre propio: lo que se paga, se recibe y se firma se llama como en la web', () => {
  // Sergio, 29-10-2026: En solitario (Solista y Banda) y Acompanado (Duo y Orquesta). Los ids no
  // cambian; los nombres, los de lib/delivery/products.ts (Stripe, Holded y los correos).
  const ids = ['hazlo-tu', 'hazlo-tu-equipo', 'acompanado', 'acompanado-equipo'] as const
  for (const [o, locale] of [
    [es, 'es'],
    [en, 'en'],
  ] as const) {
    // El formulario de contacto: cada modalidad, por su nombre y, entre parentesis, su familia.
    for (const id of ids) assert.ok(str(o, `contact.interestOptions.${id}`).startsWith(`${shortProductName(id, locale)} (`), `${locale}: ${id}`)
    // El correo de bienvenida y el de una compra con la identificacion de otro cliente, con ese nombre.
    const base = { company: 'Acme SL', licenseId: 'PML-LIC-2026-5001', supportUntil: '2027-01-29', emitida: '2026-10-29', zoneUrl: 'https://pymaticlabs.com/zona', guided: true, booking: null, termsAttached: true }
    assert.ok(welcomeEmail({ ...base, locale, product: 'acompanado-equipo' }).text.includes(`${productName('acompanado-equipo', locale)}.`), locale)
    assert.ok(companyAlertEmail({ locale, company: 'Acme SL', product: 'hazlo-tu', date: '2026-11-02' }).text.includes(productName('hazlo-tu', locale)), locale)
  }
  assert.match(welcomeEmail({ company: 'Acme SL', product: 'hazlo-tu', licenseId: null, supportUntil: '2026-10-29', emitida: '2026-10-29', zoneUrl: 'https://pymaticlabs.com/zona', guided: false, booking: null, termsAttached: true, locale: 'es' }).text, /Gracias por comprar Cerebro Digital · Solista\./)
  // Las sesiones, del Acompanado: Duo y Orquesta (/gracias y la zona, a quien compro Solista o Banda).
  for (const key of ['thanks.steps.2', 'thanks.stepsManual.2', 'zone.sessions.notGuided']) {
    assert.match(str(es, key), /Dúo y Orquesta/, key)
    assert.match(str(en, key), /Duo and Orchestra/, key)
  }
  // Fuera de la oferta y los precios (offer.* y pricing.*, los de /precios y la portada), ningun texto
  // con los nombres de antes.
  const old = (o: Messages, re: RegExp) => strings(o).filter(([k, v]) => !/^(offer|pricing)\./.test(k) && re.test(v)).map(([k]) => k)
  assert.deepEqual(old(es, /Hazlo tú|Acompañado con equipo/), [])
  assert.deepEqual(old(en, /Do it yourself|Guided, team|the Guided option/i), [])
})
