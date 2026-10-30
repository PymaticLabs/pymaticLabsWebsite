// El IVA del cobro y de cada factura (los socios, 27-10-2026: se vende a todo el mundo, solo a
// empresas y profesionales y en euros; knowledge/10_Fiscal/iva-en-ventas.md y la seccion «El IVA
// de cada caso» de iva-en-el-cobro-automatico.md). Sin Stripe Tax: el IVA lo decide la web antes de
// pagar (lib/delivery/checkout-tax.ts) y lo escribe en los metadatos del pago; en las ventas con IVA,
// con un tipo fijo del 21 % de Stripe (tax_rates), sin IVA dentro del precio. No se bloquea la pagina
// ni se rechazan tarjetas por su pais (Reglamento (UE) 2018/302).
//
// - Tras el pago, antes de entregar (el aviso, lib/delivery/events.ts): checkPaidTax compara lo
//   declarado (declaredTax, de los metadatos) con la direccion de facturacion de Stripe (el mismo
//   pais, con Francia y Monaco por uno con un NIF-IVA frances, y, en Espana, el mismo territorio
//   por el codigo postal) y con el IVA cobrado (el 21 % de la
//   base tras el cupon en standard, con un centimo de margen; nada en los demas). Si no cuadra, a
//   revisar a mano (sin licencia, ni factura, ni zona) con aviso a PymaticLabs.
// - Al facturar (decideTax): el 21 %, la inversion del sujeto pasivo (UE con NIF-IVA validado en
//   VIES antes de pagar) o sin IVA espanol (fuera de la UE, y Canarias, Ceuta y Melilla), segun la
//   empresa. Con otro tipo, o importes y paises que no cuadran, ni se crea: aviso para hacerla a
//   mano (un IVA mal puesto en Verifactu no se deshace). Lo mismo con la direccion en un territorio
//   de un Estado de la UE fuera del IVA europeo (outsideEuVatTerritory: Aland, Helgoland...).

import { parseSpanishTaxId } from './checkout-nif.ts'
import {
  isEuCountry,
  isSaleCountry,
  isSpainTerritory,
  outsideEuVatTerritory,
  parseEuVatId,
  parseOtherTaxId,
  territoryOfPostalCode,
  treatmentFor,
  viesText,
  type SpainTerritory,
} from './checkout-tax.ts'
import type { Address, Company, Purchase, TaxDetails, TaxTreatment } from './types.ts'

/** El tipo de IVA de las ventas con IVA (el general de Espana). */
export const SPAIN_VAT_RATE = 21

/** El tipo de IVA de Stripe se busca por este metadato (cerebro=iva-21), como los precios: lo crea scripts/stripe-setup.mts. */
export const TAX_RATE_TAG = 'iva-21'

/**
 * Las ventas con el 21 % a empresas de otros paises de la UE sin NIF-IVA (como a particulares) por
 * encima de las que el IVA pasa a ser el del pais del cliente, por la ventanilla unica (OSS): 10.000
 * euros al ano, en centimos (arts. 70.Uno.8.o y 73 LIVA). El pago se para antes (lib/delivery/eu-sales.ts).
 */
export const EU_DISTANCE_SALES_LIMIT = 1_000_000

/** Lo que sabe del tipo de IVA de Stripe la pieza de pagos (StripePayments y FakePayments). */
export interface TaxRateLookup {
  /** El id (txr_...) del tipo del 21 % activo, sin IVA dentro, de Espana. */
  taxRateId(): Promise<string>
}

/** El id del tipo de IVA del 21 % para las sesiones de pago con IVA. */
export async function spainTaxRateId(payments: object): Promise<string> {
  const lookup = payments as Partial<TaxRateLookup>
  if (typeof lookup.taxRateId !== 'function') throw new Error('la pieza de pagos no sabe buscar el tipo de IVA del 21 %')
  return lookup.taxRateId()
}

function taxRate(tax: number, net: number): number | null {
  return net > 0 ? Math.round((tax / net) * 10000) / 100 : null
}

/** El IVA del 21 % de esa base, en centimos (Stripe redondea igual, una sola linea por pago). */
export function spainVat(net: number): number {
  return Math.round((net * SPAIN_VAT_RATE) / 100)
}

/**
 * El tipo de una venta con IVA: el 21 % si lo cobrado es el 21 % de la base (con el centimo de
 * redondeo); si no, el que sale de dividir. Dividir el IVA redondeado entre una base de menos de
 * 100 euros (un prorrateo al subir de plan en el portal: 19,99 euros y 4,20 de IVA) da 21,01 %, y
 * Holded no factura un tipo que no es el 21 %.
 */
function standardRate(tax: number, net: number): number | null {
  return net > 0 && Math.abs(tax - spainVat(net)) <= 1 ? SPAIN_VAT_RATE : taxRate(tax, net)
}

const TERRITORY_NAMES: Record<SpainTerritory, string> = { peninsula: 'península y Baleares', canarias: 'Canarias', ceuta: 'Ceuta', melilla: 'Melilla' }

// Por la provincia que guarda Stripe (ISO 3166-2:ES, sin el ES-) o por el nombre, si el codigo
// postal no lo dice o dice otra cosa.
const OUTSIDE_VAT_STATES: Record<string, SpainTerritory> = { GC: 'canarias', TF: 'canarias', CN: 'canarias', CE: 'ceuta', ML: 'melilla' }

function plain(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function territoryByName(state: string | null, city: string | null): SpainTerritory | null {
  const code = (state ?? '').trim().toUpperCase().replace(/^ES-/, '')
  if (OUTSIDE_VAT_STATES[code]) return OUTSIDE_VAT_STATES[code]
  const text = plain(`${state ?? ''} ${city ?? ''}`)
  if (/canari|las palmas|tenerife/.test(text)) return 'canarias'
  if (/ceuta/.test(text)) return 'ceuta'
  if (/melilla/.test(text)) return 'melilla'
  return null
}

/**
 * El territorio de una direccion de Espana: por el codigo postal y, si la provincia o la ciudad
 * dicen Canarias, Ceuta o Melilla, eso. null si no se sabe (sin codigo postal de Espana).
 */
export function territoryOf(address: { postalCode: string | null; state: string | null; city?: string | null } | null): SpainTerritory | null {
  if (!address) return null
  const byPostal = territoryOfPostalCode(address.postalCode)
  if (!byPostal) return null
  return byPostal === 'peninsula' ? (territoryByName(address.state, address.city ?? null) ?? 'peninsula') : byPostal
}

function companyTerritory(address: Address | null): SpainTerritory | null {
  return address ? territoryOf({ postalCode: address.postal_code, state: address.state, city: address.city }) : null
}

// --- Tras el pago: lo declarado frente a lo que dice Stripe ------------------------------------------

/** Lo que se declaro antes de pagar: los metadatos del pago (lib/delivery/checkout-tax.ts, taxMetadata). */
export interface DeclaredTax {
  country: string
  territory: string | null
  taxId: string
  taxIdType: string
  treatment: string
  viesRequest: string | null
  viesCheckedAt: string | null
  /**
   * El nombre y la direccion que dio VIES (vies_name y vies_address), si los dio: muchos paises dan
   * «---». Limpios como los escribe el pago (viesText de checkout-tax.ts: en una linea, sin «---»).
   */
  viesName?: string | null
  viesAddress?: string | null
  /** Un pago de antes de abrir a todo el mundo (sin tax_country): solo Espana peninsular, con el 21 %. */
  legacy: boolean
}

/**
 * Lo declarado, de los metadatos de la sesion de Checkout o de la suscripcion. Sin tax_country, un
 * pago de antes: Espana peninsular y el 21 %, con el NIF espanol de tax_id. null si ni eso.
 */
export function declaredTax(metadata: Record<string, string | undefined> | null | undefined): DeclaredTax | null {
  const m = metadata ?? {}
  const country = m.tax_country?.trim().toUpperCase()
  if (!country) {
    const nif = parseSpanishTaxId(m.tax_id)
    return nif ? { country: 'ES', territory: 'peninsula', taxId: nif.taxId, taxIdType: 'es_cif', treatment: 'standard', viesRequest: null, viesCheckedAt: null, legacy: true } : null
  }
  return {
    country,
    territory: m.tax_territory?.trim() || null,
    taxId: m.tax_id?.trim() ?? '',
    taxIdType: m.tax_id_type?.trim() ?? '',
    treatment: m.tax_treatment?.trim() ?? '',
    viesRequest: m.vies_request?.trim() || null,
    viesCheckedAt: m.vies_checked_at?.trim() || null,
    viesName: viesText(m.vies_name),
    viesAddress: viesText(m.vies_address),
    legacy: false,
  }
}

// --- El nombre que da VIES frente a la razon social ------------------------------------------------

// Lo que no cuenta al comparar: las formas juridicas (sin puntos: S.L. es sl, Ges.m.b.H. gesmbh) y
// las palabras de enlace. Con las palabras de todo negocio (soluciones, consultoria...) dos nombres
// no se parecen solo por compartirlas.
const LEGAL_FORMS = new Set(
  (
    'sl slu sll slp slne sa sau sc scp scoop coop cb sociedad limitada anonima unipersonal ' +
    'gmbh mbh gesmbh ag kg kgaa ohg ug gbr ev eg se co cie sarl sas sasu eurl snc sci selarl ' +
    'srl srls spa sapa bv nv vof cv bvba sprl scrl cvba ltd limited plc llp lp llc inc incorporated corp corporation ' +
    'oy oyj ab hb kb as asa aps ivs ks sro spol vos kft zrt nyrt bt sp zoo oo ou uab mb sia doo dd ood eood ead ad ' +
    'lda ltda unipessoal ike oe ae epe'
  ).split(' ')
)
const CONNECTORS = new Set('de del la las el los y e i the and und et of van der den von di da du le les des'.split(' '))
const GENERIC = new Set(
  (
    'company compania empresa group grupo holding services servicios solutions soluciones consulting consultoria ' +
    'international internacional global systems sistemas software digital tech technologies tecnologia trading ' +
    'management partners europe europa studio estudio labs lab'
  ).split(' ')
)

/** Las palabras de un nombre que cuentan: sin forma juridica, enlaces ni letras sueltas. */
function nameWords(value: string): string[] {
  return nameTokens(value).filter((w) => w.length > 1 && !LEGAL_FORMS.has(w) && !CONNECTORS.has(w))
}

/**
 * Las palabras de un nombre en el alfabeto latino, sin tildes, signos ni mayusculas. Las dieresis
 * escritas a la alemana (ue, oe, ae) cuentan como sin ellas: Müller y MUELLER.
 */
function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[æ]/g, 'ae')
    .replace(/[œ]/g, 'oe')
    .replace(/[ø]/g, 'o')
    .replace(/[ł]/g, 'l')
    .replace(/[đ]/g, 'd')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/[.'’`´]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Si el nombre que da VIES de un NIF-IVA no se parece a la razon social de quien compra (art.
 * 18.1.a del Reglamento de Ejecucion (UE) 282/2011: el numero se confirma con su nombre): el
 * NIF-IVA puede ser de otra empresa. Se parecen si, sin forma juridica, signos ni mayusculas, uno
 * contiene al otro (Pymatic Labs y PYMATICLABS SL) o comparten al menos la mitad de las palabras del
 * mas corto y una que no es de todo negocio. Sin nombre en VIES, o sin letras que comparar (VIES da
 * el griego y el bulgaro en su alfabeto), no se sabe: false. Con un nombre de VIES que se puede
 * comparar, una razon social que es solo la forma juridica («GmbH», «S.L.») no se parece: true; una
 * de letras sueltas («A & B», «K+S AG»), solo si el de VIES empieza por esas mismas letras.
 */
export function viesNameMismatch(viesName: string | null | undefined, companyName: string): boolean {
  if (!viesName) return false
  const vies = nameWords(viesName)
  if (!vies.length) return false
  const company = nameWords(companyName)
  // Sin palabras que comparar: en otro alfabeto, no se sabe; si solo queda la forma juridica, no se
  // parece; con letras sueltas, las primeras del nombre de VIES (A & B y A & B TRADING SRL).
  if (!company.length) {
    const letters = (value: string) => nameTokens(value).filter((w) => !LEGAL_FORMS.has(w) && !CONNECTORS.has(w))
    const own = letters(companyName)
    if (!own.length) return nameTokens(companyName).length > 0
    return own.join(' ') !== letters(viesName).slice(0, own.length).join(' ')
  }
  const a = vies.join('')
  const b = company.join('')
  if (a.includes(b) || b.includes(a)) return false
  const shared = vies.filter((w) => company.includes(w))
  const enough = shared.length * 2 >= Math.min(vies.length, company.length)
  return !(enough && shared.some((w) => !GENERIC.has(w)))
}

/** Francia y Monaco, un solo territorio del IVA (art. 7 de la Directiva 2006/112/CE). */
const FRENCH_VAT_TERRITORY = ['FR', 'MC']

/**
 * Si dos paises valen por el mismo para lo declarado: el mismo, o Francia y Monaco con un NIF-IVA
 * frances (Monaco va con Francia en el IVA: su NIF-IVA lleva FR y lo comprueba el VIES de Francia,
 * lib/delivery/checkout-tax.ts). Sin NIF-IVA, cada uno el suyo: quien declara Monaco tiene la
 * direccion en Monaco.
 */
export function sameVatCountry(a: string, b: string, declared: Pick<DeclaredTax, 'taxIdType' | 'taxId'>): boolean {
  if (a === b) return true
  const french = declared.taxIdType === 'eu_vat' && declared.taxId.startsWith('FR')
  return french && FRENCH_VAT_TERRITORY.includes(a) && FRENCH_VAT_TERRITORY.includes(b)
}

/** Por que lo declarado no se sostiene solo (vacio si vale): pais, territorio, identificacion e IVA de cada caso. */
function declaredProblems(d: DeclaredTax): string[] {
  const problems: string[] = []
  if (!isSaleCountry(d.country)) problems.push(`país declarado «${d.country}»: no es un código de país válido`)
  if (d.country === 'ES' ? !isSpainTerritory(d.territory) : d.territory) problems.push(`territorio declarado «${d.territory ?? ''}» para ${d.country}`)
  const idOk =
    d.taxIdType === 'es_cif'
      ? d.country === 'ES' && parseSpanishTaxId(d.taxId)?.taxId === d.taxId
      : d.taxIdType === 'eu_vat'
        ? d.country !== 'ES' && parseEuVatId(d.country, d.taxId)?.vatId === d.taxId
        : d.taxIdType === 'other' && d.country !== 'ES' && parseOtherTaxId(d.country, d.taxId) === d.taxId
  if (!idOk) problems.push(`identificación fiscal «${d.taxId}» (${d.taxIdType || 'sin tipo'}) que no es la de ${d.country}`)
  if (d.taxIdType === 'eu_vat' && !d.viesRequest) problems.push('NIF-IVA sin el número de la consulta a VIES')
  const territory = isSpainTerritory(d.territory) ? d.territory : null
  const expected = treatmentFor(d.country, territory, d.taxIdType === 'eu_vat')
  if (d.treatment !== expected) problems.push(`IVA declarado «${d.treatment || 'sin poner'}» y a ${d.country}${territory ? ` (${TERRITORY_NAMES[territory]})` : ''} le toca «${expected}»`)
  return problems
}

/**
 * Lo que hay que mirar de un pago cobrado antes de entregarlo: countryProblems (la direccion de
 * facturacion no es del pais o del territorio declarados, o lo declarado no vale) y vatProblems (el
 * IVA cobrado no es el esperado, o no en euros). Vacios los dos: se entrega, con treatment y rate
 * (los de la compra). La entrega los convierte en sus motivos de revision.
 */
export function checkPaidTax(input: {
  declared: DeclaredTax
  billing: { country: string | null; postalCode: string | null; state: string | null; city?: string | null }
  currency: string | null
  amountTax: number
  net: number
}): { treatment: TaxTreatment; rate: number | null; countryProblems: string[]; vatProblems: string[] } {
  const { declared, billing } = input
  const countryProblems = declaredProblems(declared)
  if (!billing.country) countryProblems.push('sin país de facturación')
  else if (!sameVatCountry(billing.country, declared.country, declared)) {
    countryProblems.push(`dirección de facturación en ${billing.country} y antes de pagar se declaró ${declared.country}`)
  } else if (declared.country === 'ES') {
    const postal = (billing.postalCode ?? '').replace(/\s/g, '')
    const territory = territoryOf(billing)
    const byPostal = territoryOfPostalCode(postal)
    const byName = territoryByName(billing.state, billing.city ?? null)
    const wanted = isSpainTerritory(declared.territory) ? declared.territory : null
    if (!territory) countryProblems.push(postal ? `el código postal «${postal}» no es de España: no se sabe el territorio` : 'sin código postal: no se sabe si es de Canarias, Ceuta o Melilla')
    // El codigo postal y la provincia o la ciudad que no dicen lo mismo (28001 en Las Palmas): no se
    // sabe cual vale, y sin IVA solo se vende con la direccion clara.
    else if (byPostal && byName && byName !== byPostal) countryProblems.push(`el código postal «${postal}» es de ${TERRITORY_NAMES[byPostal]} y la provincia o la ciudad, de ${TERRITORY_NAMES[byName]}`)
    else if (wanted && territory !== wanted) countryProblems.push(`dirección en ${TERRITORY_NAMES[territory]} y antes de pagar se declaró ${TERRITORY_NAMES[wanted]}`)
  }

  const vatProblems: string[] = []
  if ((input.currency ?? 'eur') !== 'eur') vatProblems.push(`cobrada en ${String(input.currency).toUpperCase()}: solo se vende en euros`)
  const standard = declared.treatment === 'standard'
  if (!(input.net > 0)) vatProblems.push(`base imponible de ${input.net} céntimos`)
  // Un centimo de margen por el redondeo.
  else if (standard && Math.abs(input.amountTax - spainVat(input.net)) > 1) {
    vatProblems.push(`IVA cobrado de ${input.amountTax} céntimos y el 21 % de ${input.net} son ${spainVat(input.net)}: revisar el tipo de IVA de Stripe`)
  } else if (!standard && input.amountTax !== 0) {
    vatProblems.push(`IVA cobrado de ${input.amountTax} céntimos en una venta sin IVA español (${declared.treatment}): no se pone el tipo del 21 % en estos pagos`)
  }
  const treatment: TaxTreatment = ['standard', 'reverse_charge', 'export'].includes(declared.treatment) ? (declared.treatment as TaxTreatment) : 'exempt'
  return { treatment, rate: standard ? standardRate(input.amountTax, input.net) : 0, countryProblems, vatProblems }
}

// --- Al facturar ----------------------------------------------------------------------------------

export interface TaxDecision {
  treatment: TaxTreatment
  rate: number | null
  /**
   * Por que no se emite sola. draft: se crea en borrador y se avisa (se emite a mano tras mirarla);
   * manual: ni se crea, se hace a mano.
   */
  hold: { reason: string; mode: 'draft' | 'manual' } | null
  /** Esperar a VIES (de cuando se cobraba con Stripe Tax): VIES se consulta antes de pagar, siempre false. */
  vatPending: boolean
}

/**
 * El IVA de la factura, por lo que cobro Stripe y la empresa (pais, territorio por el codigo postal
 * y su NIF-IVA): el 21 % (standard); sin IVA, la inversion del sujeto pasivo (otro pais de la UE con
 * el NIF-IVA comprobado en VIES antes de pagar) o no sujeta (export: fuera de la UE, y Canarias,
 * Ceuta y Melilla). Lo que no cuadra, a mano.
 */
export function decideTax(purchase: Purchase, company: Company, details: TaxDetails): TaxDecision {
  const country = company.country
  const net = purchase.amountSubtotal - purchase.amountDiscount
  const holds: { reason: string; mode: 'draft' | 'manual' }[] = []
  // Todos los motivos juntos; con uno que pide hacerla a mano, a mano.
  const hold = (): TaxDecision['hold'] =>
    holds.length ? { reason: holds.map((h) => h.reason).join('. '), mode: holds.some((h) => h.mode === 'manual') ? 'manual' : 'draft' } : null
  const decision = (treatment: TaxTreatment, rate: number | null): TaxDecision => ({ treatment, rate, hold: hold(), vatPending: false })

  if (details.amountTax !== null && details.amountTax !== purchase.amountTax) {
    holds.push({ reason: `Stripe dice ${details.amountTax} céntimos de IVA y el aviso traía ${purchase.amountTax}`, mode: 'manual' })
  }
  if (purchase.currency !== 'eur') {
    holds.push({ reason: `cobrada en ${purchase.currency.toUpperCase()}: solo se vende en euros (devolverla o facturarla a mano con el cambio de Stripe)`, mode: 'manual' })
  }

  // Un territorio de un Estado de la UE fuera del IVA europeo (los departamentos de ultramar, Aland,
  // Helgoland...): ni la inversion del sujeto pasivo ni el 21 %, sino no sujeta y sin 349. Muy raro:
  // la factura, a mano (el cobro no se toca; con el 21 % cobrado, verlo con Manel).
  const outside = outsideEuVatTerritory(country, company.address?.postal_code)
  if (outside) {
    holds.push({
      reason: `territorio fuera del IVA de la UE: s_iva_nosujeto, sin 349 (${country} ${company.address?.postal_code}, ${outside}; art. 6 de la Directiva 2006/112/CE)${
        purchase.amountTax > 0 ? `; se cobró el ${SPAIN_VAT_RATE} %: devolver ese IVA o facturarlo con él, con Manel` : ''
      }`,
      mode: 'manual',
    })
  }

  const territory = country === 'ES' ? companyTerritory(company.address) : null
  const vat = country && country !== 'ES' && isEuCountry(country) ? parseEuVatId(country, company.taxId) : null
  const reverseCharge = Boolean(vat) && (company.taxIdType === 'eu_vat' || purchase.taxTreatment === 'reverse_charge')

  if (purchase.amountTax > 0) {
    const rate = standardRate(purchase.amountTax, net)
    // El 21 % cobrado a quien no le tocaba: se devuelve el IVA (o se rectifica) a mano.
    const noVat = country === 'ES' ? territory && territory !== 'peninsula' : country ? !isEuCountry(country) || reverseCharge : false
    const where = `${country}${territory ? `, ${TERRITORY_NAMES[territory]}` : ''}${reverseCharge ? `, NIF-IVA ${company.taxId}` : ''}`
    // Con ese IVA ya devuelto (vat_mismatch: se devuelve solo el IVA y se entrega a mano), la venta
    // es la de su caso, sin IVA: asi el aviso no la da con el 21 % ni la cuenta para los 10.000 € (ni
    // la saca del 349). La factura, a mano y sin IVA.
    if (noVat && purchase.amountRefunded >= purchase.amountTax) {
      holds.push({ reason: `se cobró el ${SPAIN_VAT_RATE} % a una venta sin IVA español (${where}) y ese IVA ya se devolvió: hacerla a mano, sin IVA`, mode: 'manual' })
      return decision(reverseCharge ? 'reverse_charge' : 'export', 0)
    }
    if (Math.abs(purchase.amountTax - spainVat(net)) > 1) {
      holds.push({ reason: `IVA del ${rate ?? '?'} %: solo se factura sola con el ${SPAIN_VAT_RATE} % (revisar el tipo de IVA de Stripe)`, mode: 'manual' })
    }
    if (noVat) holds.push({ reason: `se cobró el ${SPAIN_VAT_RATE} % a una venta sin IVA español (${where}): devolver el IVA o facturar a mano`, mode: 'manual' })
    // UE sin NIF-IVA, con el 21 %: la regla de Verifactu de Holded va por pais y le pondria el tipo de
    // identificacion NIF/IVA (02), que este cliente no tiene. Nunca se emite sola: en borrador, para
    // cambiarlo a mano antes de aprobar (tambien con HOLDED_INVOICE_MODE=emit).
    if (!noVat && country && country !== 'ES' && isEuCountry(country)) {
      holds.push({
        reason: `UE sin NIF-IVA (${country}): antes de aprobarla, en Holded, Opciones > Verifactu, tipo de identificación «Documento oficial» (04) u «Otro» (06), no NIF/IVA (02)`,
        mode: 'draft',
      })
    }
    return decision('standard', rate)
  }
  if (!country) {
    holds.push({ reason: 'sin IVA y sin país de facturación', mode: 'manual' })
    return decision(purchase.taxTreatment, 0)
  }
  if (country === 'ES') {
    if (territory && territory !== 'peninsula') return decision('export', 0)
    holds.push({
      reason: territory
        ? 'venta en España peninsular o Baleares sin IVA: no se aplicó el tipo del 21 % (revisar el tipo de IVA de Stripe)'
        : 'venta en España sin IVA y sin código postal que diga si es de Canarias, Ceuta o Melilla',
      mode: 'manual',
    })
    return decision('standard', 0)
  }
  if (isEuCountry(country)) {
    if (reverseCharge) return decision('reverse_charge', 0)
    holds.push({ reason: `venta a ${country} sin IVA y sin NIF-IVA comprobado en VIES: le tocaba el ${SPAIN_VAT_RATE} % (cobrar la diferencia o facturar a mano)`, mode: 'manual' })
    return decision(purchase.taxTreatment, 0)
  }
  return decision('export', 0)
}
