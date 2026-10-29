// El pais, la identificacion fiscal y el IVA de cada compra, decididos antes de pagar (los socios,
// 27-10-2026: se vende a todo el mundo, solo a empresas y profesionales y en euros, con el IVA de
// cada caso de knowledge/10_Fiscal/iva-en-ventas.md y la seccion «Cuando se abra Europa» de
// iva-en-el-cobro-automatico.md; sin Stripe Tax). Lo usan la pagina de compra (en el navegador,
// para ensenar solo los campos que tocan y avisar antes de enviar), /api/checkout y el mensual
// desde la zona (lib/checkout.ts), con estas mismas funciones. Sin dependencias de Node: se carga
// tambien en el navegador.
//
// A cualquier pais (los socios, 29-10-2026: sin lista de paises a los que no se vende).
//
// 1. Espana, peninsula o Baleares: el NIF espanol (checkout-nif.ts) y el 21 % (standard).
// 2. Espana, Canarias, Ceuta o Melilla: el NIF espanol y sin IVA espanol (fuera del territorio del
//    IVA, art. 3 LIVA; servicio a empresa localizado en destino, art. 69.Uno.1.o): export.
// 3. Otro pais de la UE con NIF-IVA valido en VIES: sin IVA, inversion del sujeto pasivo
//    (reverse_charge). Aqui se mira solo su forma; VIES lo confirma en el servidor antes de abrir
//    el pago (lib/delivery/vies.ts), y si no contesta no se vende a 0 %.
// 4. Otro pais de la UE sin NIF-IVA: como un particular, con el 21 % de IVA espanol (standard),
//    mientras esas ventas no pasen de 10.000 euros al ano (arts. 70.Uno.8.o y 73 LIVA; lo vigila la
//    comprobacion de produccion). Se pide su identificacion fiscal: la licencia y la empresa
//    (companies.tax_id) no admiten un NIF vacio. Si la que escribe tiene la forma del NIF-IVA de su
//    pais y VIES la da por valida, el servidor pide escribirla como NIF-IVA (lib/checkout.ts).
// 5. Fuera de la UE (Andorra, Reino Unido, Suiza, Estados Unidos...): sin IVA espanol (export), con
//    la identificacion fiscal de la empresa.
// Monaco va como Francia en el IVA (art. 7 de la Directiva 2006/112/CE): casos 3 y 4, con su
// NIF-IVA frances (FR), que VIES comprueba en el de Francia.
//
// Lo que se guarda en tax_id: el NIF espanol sin prefijo (como siempre); el NIF-IVA con su prefijo
// (EL en Grecia, FR en Monaco); cualquier otra, con el codigo del pais delante si no lo trae: asi no
// choca con el NIF de otra empresa (companies.tax_id es unico).

import { parseSpanishTaxId } from './checkout-nif.ts'

export type SpainTerritory = 'peninsula' | 'canarias' | 'ceuta' | 'melilla'
export const SPAIN_TERRITORIES: readonly SpainTerritory[] = ['peninsula', 'canarias', 'ceuta', 'melilla']

/** El IVA que lleva el pago: el 21 % espanol, inversion del sujeto pasivo o sin IVA espanol (no sujeta). */
export type CheckoutTaxTreatment = 'standard' | 'reverse_charge' | 'export'
/** es_cif: NIF espanol (como lo llama Stripe); eu_vat: NIF-IVA validado en VIES; other: cualquier otra. */
export type CheckoutTaxIdType = 'es_cif' | 'eu_vat' | 'other'

export function isSpainTerritory(value: unknown): value is SpainTerritory {
  return SPAIN_TERRITORIES.includes(value as SpainTerritory)
}

// Los 27 (Grecia con EL, su prefijo de IVA; sin XI, Irlanda del Norte, que en servicios es Reino
// Unido) y Monaco, territorio frances del IVA (art. 7 de la Directiva 2006/112/CE: su NIF-IVA lleva
// FR y lo comprueba el VIES de Francia), con la forma de su NIF-IVA sin el prefijo, como la describe
// VIES. Espana no esta: sus empresas dan el NIF espanol.
const FR_VAT = { prefix: 'FR', pattern: /^[0-9A-HJ-NP-Z]{2}\d{9}$/ }
const EU_VAT: Record<string, { prefix: string; pattern: RegExp }> = {
  AT: { prefix: 'AT', pattern: /^U\d{8}$/ },
  BE: { prefix: 'BE', pattern: /^[01]\d{9}$/ },
  BG: { prefix: 'BG', pattern: /^\d{9,10}$/ },
  CY: { prefix: 'CY', pattern: /^\d{8}[A-Z]$/ },
  CZ: { prefix: 'CZ', pattern: /^\d{8,10}$/ },
  DE: { prefix: 'DE', pattern: /^\d{9}$/ },
  DK: { prefix: 'DK', pattern: /^\d{8}$/ },
  EE: { prefix: 'EE', pattern: /^\d{9}$/ },
  FI: { prefix: 'FI', pattern: /^\d{8}$/ },
  FR: FR_VAT,
  GR: { prefix: 'EL', pattern: /^\d{9}$/ },
  HR: { prefix: 'HR', pattern: /^\d{11}$/ },
  HU: { prefix: 'HU', pattern: /^\d{8}$/ },
  IE: { prefix: 'IE', pattern: /^(\d{7}[A-W][A-IW]?|\d[A-Z]\d{5}[A-W])$/ },
  IT: { prefix: 'IT', pattern: /^\d{11}$/ },
  LT: { prefix: 'LT', pattern: /^(\d{9}|\d{12})$/ },
  LU: { prefix: 'LU', pattern: /^\d{8}$/ },
  LV: { prefix: 'LV', pattern: /^\d{11}$/ },
  MC: FR_VAT,
  MT: { prefix: 'MT', pattern: /^\d{8}$/ },
  NL: { prefix: 'NL', pattern: /^\d{9}B\d{2}$/ },
  PL: { prefix: 'PL', pattern: /^\d{10}$/ },
  PT: { prefix: 'PT', pattern: /^\d{9}$/ },
  RO: { prefix: 'RO', pattern: /^[1-9]\d{1,9}$/ },
  SE: { prefix: 'SE', pattern: /^\d{10}01$/ },
  SI: { prefix: 'SI', pattern: /^\d{8}$/ },
  SK: { prefix: 'SK', pattern: /^\d{10}$/ },
}

/** La regla del NIF-IVA de ese pais, solo si es uno de los de la tabla (no constructor, __proto__...). */
function euRule(country: string | null | undefined): { prefix: string; pattern: RegExp } | null {
  return country && Object.hasOwn(EU_VAT, country) ? EU_VAT[country] : null
}

/** Un pais de la UE a efectos del IVA (ISO 3166-1): los 27, Espana incluida, y Monaco (con Francia). */
export function isEuCountry(country: string | null | undefined): boolean {
  return country === 'ES' || Boolean(euRule(country))
}

/** El prefijo del NIF-IVA de un pais de la UE (EL en Grecia, FR en Monaco), o null. */
export function vatPrefix(country: string): string | null {
  return country === 'ES' ? 'ES' : (euRule(country)?.prefix ?? null)
}

/**
 * Los paises a los que se vende: todos, por su codigo ISO 3166-1 alfa-2 (el de la direccion de
 * Stripe), y Kosovo (XK, el de Stripe y de Intl). Sin lista de paises a los que no se vende (los
 * socios, 29-10-2026): lo que Stripe no admite lo rechaza Stripe.
 */
export const SALE_COUNTRIES: readonly string[] =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW XK'.split(
    ' '
  )

/** Un codigo de pais de la lista (cualquiera de ISO 3166-1 y XK). */
export function isSaleCountry(value: unknown): value is string {
  return typeof value === 'string' && SALE_COUNTRIES.includes(value)
}

/** Mayusculas, sin espacios, puntos, guiones, barras ni caracteres invisibles. */
function compact(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s.\-\/­​-‏⁠﻿]/g, '')
}

/**
 * El NIF-IVA de una empresa de ese pais de la UE (no Espana), por su forma: con o sin el prefijo
 * (en Grecia, EL o GR; en Monaco, FR). vatId: con su prefijo, como se guarda y va en la factura;
 * viesCountry y number: lo que se pregunta a VIES. null si no tiene la forma de los de ese pais.
 */
export function parseEuVatId(country: string, value: string | null | undefined): { vatId: string; viesCountry: string; number: string } | null {
  const rule = euRule(country)
  if (!rule || !value) return null
  let id = compact(value)
  if (id.startsWith(rule.prefix)) id = id.slice(2)
  else if (country === 'GR' && id.startsWith('GR')) id = id.slice(2)
  // Los belgas de antes, de 9 cifras: hoy llevan un 0 delante.
  if (country === 'BE' && /^\d{9}$/.test(id)) id = `0${id}`
  return rule.pattern.test(id) ? { vatId: `${rule.prefix}${id}`, viesCountry: rule.prefix, number: id } : null
}

/**
 * La identificacion fiscal de una empresa de fuera de la UE (o de la UE sin NIF-IVA): letras sin
 * tildes, cifras y guiones (como la acepta firmar_licencia.py), de 4 a 30, con el codigo del pais
 * delante si no lo trae (US12-3456789; la suiza CHE-123.456.789 ya lo trae). null si no vale.
 */
export function parseOtherTaxId(country: string, value: string | null | undefined): string | null {
  if (!value || !/^[A-Z]{2}$/.test(country)) return null
  const body = value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  if (body.replace(/-/g, '').length < 4 || body.length > 30) return null
  return body.startsWith(country) ? body : `${country}${body}`
}

/** El territorio de Espana por el codigo postal: 35 y 38, Canarias; 51, Ceuta; 52, Melilla. null si no es un codigo de Espana. */
export function territoryOfPostalCode(postalCode: string | null | undefined): SpainTerritory | null {
  const postal = (postalCode ?? '').replace(/\s/g, '')
  if (!/^\d{5}$/.test(postal)) return null
  const province = Number(postal.slice(0, 2))
  if (province < 1 || province > 52) return null
  return province === 35 || province === 38 ? 'canarias' : province === 51 ? 'ceuta' : province === 52 ? 'melilla' : 'peninsula'
}

/** El IVA de cada caso: el 21 % en la peninsula y Baleares y en la UE sin NIF-IVA; sin IVA espanol en lo demas. */
export function treatmentFor(country: string, territory: SpainTerritory | null, vatId: boolean): CheckoutTaxTreatment {
  if (country === 'ES') return territory && territory !== 'peninsula' ? 'export' : 'standard'
  if (isEuCountry(country)) return vatId ? 'reverse_charge' : 'standard'
  return 'export'
}

/** Lo que se decide antes de pagar, y va en los metadatos del pago (taxMetadata). */
export interface CheckoutTax {
  /** ISO 3166-1 alfa-2, el que se declara. */
  country: string
  /** Solo en Espana. */
  territory: SpainTerritory | null
  taxId: string
  taxIdType: CheckoutTaxIdType
  treatment: CheckoutTaxTreatment
  /** Solo con NIF-IVA: lo que se pregunta a VIES antes de abrir el pago (su prefijo y el numero). */
  vies: { countryCode: string; vatNumber: string } | null
}

/** Lo que se escribe en /comprar (o llega en el JSON de /api/checkout). Los campos que no tocan se ignoran. */
export interface TaxInput {
  /** Sin pais, Espana (los botones y los clientes de antes solo mandaban el NIF). */
  country?: string | null
  /** En Espana; sin el, peninsula y Baleares. */
  territory?: string | null
  /** El NIF espanol. */
  taxId?: string | null
  /** El NIF-IVA, en otro pais de la UE (vacio: con el 21 %). */
  vatId?: string | null
  /** La identificacion fiscal, fuera de la UE o en la UE sin NIF-IVA. */
  otherTaxId?: string | null
}

export type TaxInputError =
  | 'country_invalid'
  | 'territory_invalid'
  | 'tax_id_required'
  | 'tax_id_invalid'
  | 'vat_id_invalid'
  | 'eu_tax_id_required'
  | 'other_tax_id_required'
  | 'other_tax_id_invalid'

/** El IVA y la identificacion de lo que se escribio, o el primer problema (sin llamar a nadie). */
export function readTaxInput(input: TaxInput): { tax: CheckoutTax } | { error: TaxInputError } {
  const country = (input.country ?? '').trim().toUpperCase() || 'ES'
  if (!isSaleCountry(country)) return { error: 'country_invalid' }
  if (country === 'ES') {
    const territory = (input.territory ?? '').trim() || 'peninsula'
    if (!isSpainTerritory(territory)) return { error: 'territory_invalid' }
    if (!input.taxId?.trim()) return { error: 'tax_id_required' }
    const nif = parseSpanishTaxId(input.taxId)
    if (!nif) return { error: 'tax_id_invalid' }
    return { tax: { country, territory, taxId: nif.taxId, taxIdType: 'es_cif', treatment: treatmentFor(country, territory, false), vies: null } }
  }
  const other = () => {
    if (!input.otherTaxId?.trim()) return null
    return parseOtherTaxId(country, input.otherTaxId)
  }
  if (isEuCountry(country)) {
    if (input.vatId?.trim()) {
      const vat = parseEuVatId(country, input.vatId)
      if (!vat) return { error: 'vat_id_invalid' }
      return { tax: { country, territory: null, taxId: vat.vatId, taxIdType: 'eu_vat', treatment: 'reverse_charge', vies: { countryCode: vat.viesCountry, vatNumber: vat.number } } }
    }
    if (!input.otherTaxId?.trim()) return { error: 'eu_tax_id_required' }
    const id = other()
    if (!id) return { error: 'other_tax_id_invalid' }
    return { tax: { country, territory: null, taxId: id, taxIdType: 'other', treatment: 'standard', vies: null } }
  }
  if (!input.otherTaxId?.trim()) return { error: 'other_tax_id_required' }
  const id = other()
  if (!id) return { error: 'other_tax_id_invalid' }
  return { tax: { country, territory: null, taxId: id, taxIdType: 'other', treatment: 'export', vies: null } }
}

/** La consulta a VIES que confirmo el NIF-IVA (solo con inversion del sujeto pasivo). */
export interface ViesProof {
  /** requestIdentifier de VIES: el numero de la consulta, la prueba de que se comprobo. */
  request: string
  /** Cuando, en ISO. */
  checkedAt: string
  /**
   * El titular de ese NIF-IVA segun VIES: su nombre y su direccion (art. 18.1.a del Reglamento de
   * Ejecucion (UE) 282/2011), para compararlos tras el pago con la razon social. null si VIES no los
   * da (algunos paises, como Espana, contestan «---»).
   */
  name?: string | null
  address?: string | null
}

/** Lo que admite Stripe en cada valor de los metadatos. */
export const STRIPE_METADATA_VALUE_MAX = 500

/**
 * El nombre o la direccion que da VIES, para los metadatos: en una linea (los saltos, con coma), sin
 * el «---» de los paises que no lo dan y recortado a lo que admite Stripe. null si no queda nada.
 */
export function viesText(value: string | null | undefined): string | null {
  const text = (value ?? '')
    .replace(/\s*[\r\n]+\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^,\s*|,\s*$/g, '')
  if (/^[-\s,]*$/.test(text)) return null
  if (text.length <= STRIPE_METADATA_VALUE_MAX) return text
  const cut = text.slice(0, STRIPE_METADATA_VALUE_MAX)
  // Sin partir en dos un caracter que ocupa dos (un emoji, una letra de fuera del plano basico).
  return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut
}

/**
 * Los metadatos del IVA en el pago (sesion de Checkout, payment_intent_data y, en el mensual,
 * subscription_data): los lee la entrega tras el pago para comprobar que la direccion de
 * facturacion y el IVA cobrado cuadran con lo declarado (lib/delivery/tax.ts, checkPaidTax). Con
 * inversion del sujeto pasivo, la consulta a VIES: vies_request y vies_checked_at y, si VIES los da,
 * vies_name y vies_address (viesText), que la entrega compara con la razon social y pone en la factura.
 */
export function taxMetadata(tax: CheckoutTax, vies: ViesProof | null): Record<string, string> {
  const proof = tax.treatment === 'reverse_charge' ? vies : null
  const name = viesText(proof?.name)
  const address = viesText(proof?.address)
  return {
    tax_country: tax.country,
    ...(tax.territory ? { tax_territory: tax.territory } : {}),
    tax_id: tax.taxId,
    tax_id_type: tax.taxIdType,
    tax_treatment: tax.treatment,
    ...(proof ? { vies_request: proof.request, vies_checked_at: proof.checkedAt } : {}),
    ...(name ? { vies_name: name } : {}),
    ...(address ? { vies_address: address } : {}),
  }
}
