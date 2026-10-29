// Lo del IVA que es de la entrega, sobre lo que comprueba lib/delivery/tax.ts (checkPaidTax y
// decideTax, de la parte del pago, con las reglas de lib/delivery/checkout-tax.ts):
//
// - lo declarado de una compra o un cobro que no lo trae en los metadatos: un pago de antes (sin
//   tax_country: Espana peninsular con el 21 %, con el NIF que llegue) o un cobro del mensual de una
//   suscripcion de antes (lo de la empresa);
// - que la consulta de VIES de una venta sin IVA a la UE sea de justo antes de pagar;
// - lo que va impreso en la factura sin IVA (knowledge/10_Fiscal/iva-en-ventas.md): la inversion
//   del sujeto pasivo con el NIF-IVA del cliente, o la no sujecion de Canarias, Ceuta, Melilla y de
//   fuera de la UE;
// - las ventas con IVA espanol a la UE sin NIF-IVA del ano, para el limite de 10.000 euros (OSS).

import { parseSpanishTaxId } from './checkout-nif.ts'
import { isEuCountry, treatmentFor } from './checkout-tax.ts'
import { territoryOf, type DeclaredTax } from './tax.ts'
import { formatMoney, normalizeTaxId } from './util.ts'
import type { Company, Locale, Purchase, TaxTreatment } from './types.ts'

/**
 * Lo declarado de un pago de antes que declaredTax no reconoce (sin tax_country y sin un NIF espanol
 * bueno en los metadatos): el NIF de Stripe o del campo propio, como Espana peninsular con el 21 %.
 * checkPaidTax lo da por no valido si no es un NIF espanol.
 */
export function legacyDeclaration(written: string | null, writtenType: string | null): DeclaredTax {
  const spanish = parseSpanishTaxId(written)
  return {
    country: 'ES',
    territory: 'peninsula',
    taxId: spanish?.taxId ?? normalizeTaxId(written) ?? '',
    // es_cif es como llama Stripe al NIF espanol (de sociedad, de persona o NIE).
    taxIdType: spanish ? 'es_cif' : (writtenType ?? 'otro'),
    treatment: 'standard',
    viesRequest: null,
    viesCheckedAt: null,
    legacy: true,
  }
}

/** Lo declarado por una empresa que ya es cliente: un cobro del mensual sin el contrato en los metadatos de su suscripcion. */
export function companyDeclaration(company: Company): DeclaredTax {
  const country = company.country ?? 'ES'
  const territory = country === 'ES' ? (territoryOf(company.address ? { postalCode: company.address.postal_code, state: company.address.state, city: company.address.city } : null) ?? 'peninsula') : null
  const taxIdType = company.taxIdType ?? (country === 'ES' ? 'es_cif' : 'other')
  return {
    country,
    territory,
    taxId: company.taxId,
    taxIdType,
    treatment: treatmentFor(country, territory, taxIdType === 'eu_vat'),
    viesRequest: null,
    viesCheckedAt: null,
    legacy: true,
  }
}

/** La consulta de VIES se hace al abrir el pago, que dura media hora: una de mas de un dia antes no vale. */
const VIES_MAX_AGE_MS = 24 * 3600_000

/** Por que la consulta de VIES de una venta con inversion del sujeto pasivo no vale (vacio si vale). */
export function viesProblems(declared: DeclaredTax, paidAt: string): string[] {
  if (declared.treatment !== 'reverse_charge') return []
  const checkedAt = declared.viesCheckedAt ? Date.parse(declared.viesCheckedAt) : NaN
  if (Number.isNaN(checkedAt)) return ['NIF-IVA sin la fecha de la consulta a VIES']
  const paid = Date.parse(paidAt)
  if (paid - checkedAt > VIES_MAX_AGE_MS || checkedAt - paid > 10 * 60_000) return [`la consulta a VIES es del ${declared.viesCheckedAt}, no de justo antes del pago`]
  return []
}

/** Como se llama cada IVA en los avisos internos. */
export const TREATMENT_NAMES: Record<TaxTreatment, string> = {
  standard: 'IVA del 21 %',
  reverse_charge: 'sin IVA: inversión del sujeto pasivo',
  export: 'sin IVA español: no sujeta (art. 69 LIVA)',
  exempt: 'exenta',
}

const MENTIONS: Record<'reverse_charge' | 'offshore' | 'abroad', Record<Locale, string>> = {
  reverse_charge: {
    es: 'Inversión del sujeto pasivo. Operación no sujeta a IVA español por reglas de localización (art. 69.Uno.1.º de la Ley 37/1992, del IVA). IVA a liquidar por el destinatario (art. 196 de la Directiva 2006/112/CE).',
    en: 'Reverse charge. Not subject to Spanish VAT under the place-of-supply rules (Article 69.One.1 of Spanish VAT Law 37/1992). VAT to be accounted for by the recipient (Article 196 of Directive 2006/112/EC).',
  },
  // Canarias, Ceuta y Melilla: fuera del territorio del IVA, el servicio a una empresa se localiza alli.
  offshore: {
    es: 'Operación no sujeta a IVA por reglas de localización (art. 69.Uno.1.º de la Ley 37/1992 del IVA).',
    en: 'Not subject to VAT under the place-of-supply rules (Article 69.One.1 of Spanish VAT Law 37/1992).',
  },
  abroad: {
    es: 'Operación no sujeta a IVA por localización en destino (art. 69 de la Ley 37/1992 del IVA).',
    en: 'Not subject to VAT: supplied where the customer is established (Article 69 of Spanish VAT Law 37/1992).',
  },
}

/**
 * Lo que va impreso en una factura o rectificativa sin IVA (null con el 21 %): la mencion y, en la
 * inversion del sujeto pasivo, el NIF-IVA del cliente con su prefijo. En ingles, tambien el texto en
 * castellano (el que pide el Reglamento de facturacion, art. 6.1.m).
 */
export function taxMention(treatment: TaxTreatment, company: Pick<Company, 'country' | 'taxId'>, locale: Locale): string | null {
  const kind = treatment === 'reverse_charge' ? 'reverse_charge' : treatment === 'export' ? (company.country === 'ES' ? 'offshore' : 'abroad') : null
  if (!kind) return null
  const lines = locale === 'en' ? [MENTIONS[kind].en, MENTIONS[kind].es] : [MENTIONS[kind].es]
  if (kind === 'reverse_charge') lines.push(locale === 'en' ? `Customer VAT number: ${company.taxId}` : `NIF-IVA del destinatario: ${company.taxId}`)
  return lines.join('\n')
}

/**
 * El IVA de la venta en el aviso interno, y si va al modelo 349. El importe, solo con el 21 %: una
 * sin IVA que lo cobro de mas ya lo devolvio (decideTax) y no lleva IVA.
 */
export function treatmentLine(purchase: Pick<Purchase, 'taxTreatment' | 'amountTax' | 'currency'>): string {
  const amount = purchase.amountTax && purchase.taxTreatment === 'standard' ? ` (${formatMoney(purchase.amountTax, purchase.currency, 'es')})` : ''
  return `${TREATMENT_NAMES[purchase.taxTreatment]}${amount}${purchase.taxTreatment === 'reverse_charge' ? '; va al modelo 349' : ''}`
}

/** Una venta a otro pais de la UE sin NIF-IVA (como a un particular), con el 21 %: cuenta para el limite de 10.000 euros. */
export function isEuNoVatSale(purchase: Pick<Purchase, 'taxTreatment'>, company: Pick<Company, 'country'>): boolean {
  return purchase.taxTreatment === 'standard' && Boolean(company.country) && company.country !== 'ES' && isEuCountry(company.country)
}
