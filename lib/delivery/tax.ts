// El IVA de cada factura, con lo que dice Stripe Tax (no adivinado por el pais y el tipo de NIF).
//
// Al llegar el aviso se apunta un IVA provisional con lo que trae (importe, pais, tipo de NIF). El
// paso de la factura pregunta a Stripe el motivo de cada impuesto (taxability_reason) y la
// verificacion del NIF-IVA, y decide:
// - con IVA: el espanol (standard);
// - sin IVA a una empresa de otro pais de la UE: inversion del sujeto pasivo solo si Stripe la
//   aplico y el NIF-IVA esta verificado en VIES. Stripe la aplica con un NIF bien escrito aunque VIES
//   no lo confirme: sin verificar, borrador y aviso, nunca se emite sola;
// - fuera de la UE: no sujeta (export);
// - en Espana sin IVA, a la UE sin inversion, o con importes que no cuadran: no se factura sola,
//   aviso para hacerla a mano (un IVA mal puesto en Verifactu no se deshace).
// En USD, la factura necesita el cambio a euros: borrador y aviso. Y USD desde la UE no deberia
// pasar (el precio en USD es para Norteamerica): aviso.

import { EU_COUNTRIES } from './util.ts'
import type { Company, Purchase, TaxDetails, TaxTreatment } from './types.ts'

/** El IVA provisional, con lo que trae el aviso (lo confirma el paso de la factura con decideTax). */
export function taxTreatment(input: { country: string | null; taxIdType: string | null; amountTax: number; net: number }): {
  treatment: TaxTreatment
  rate: number | null
} {
  if (input.amountTax > 0) return { treatment: 'standard', rate: taxRate(input.amountTax, input.net) }
  if (input.country && input.country !== 'ES' && EU_COUNTRIES.has(input.country) && input.taxIdType === 'eu_vat') {
    return { treatment: 'reverse_charge', rate: 0 }
  }
  if (input.country && !EU_COUNTRIES.has(input.country)) return { treatment: 'export', rate: 0 }
  return { treatment: 'exempt', rate: 0 }
}

function taxRate(tax: number, net: number): number | null {
  return net > 0 ? Math.round((tax / net) * 10000) / 100 : null
}

export interface TaxDecision {
  treatment: TaxTreatment
  rate: number | null
  /**
   * Por que no se emite sola. draft: se crea en borrador y se avisa (se emite a mano tras mirarla);
   * manual: ni se crea, se hace a mano.
   */
  hold: { reason: string; mode: 'draft' | 'manual' } | null
  /** Stripe aun esta preguntando a VIES por el NIF-IVA (tarda segundos o minutos): mejor esperar un poco. */
  vatPending: boolean
}

export function decideTax(purchase: Purchase, company: Company, details: TaxDetails): TaxDecision {
  const country = company.country
  const net = purchase.amountSubtotal - purchase.amountDiscount
  const reasons = new Set(details.reasons)
  const holds: { reason: string; mode: 'draft' | 'manual' }[] = []
  // Todos los motivos juntos; con uno que pide hacerla a mano, a mano.
  const hold = (): TaxDecision['hold'] =>
    holds.length ? { reason: holds.map((h) => h.reason).join('. '), mode: holds.some((h) => h.mode === 'manual') ? 'manual' : 'draft' } : null

  if (details.amountTax !== null && details.amountTax !== purchase.amountTax) {
    holds.push({ reason: `Stripe dice ${details.amountTax} céntimos de IVA y el aviso traía ${purchase.amountTax}`, mode: 'manual' })
  }
  if (purchase.currency !== 'eur') {
    holds.push({ reason: `cobrada en ${purchase.currency.toUpperCase()}: poner en Holded el cambio a euros de Stripe (balance transaction) antes de emitirla`, mode: 'draft' })
    if (country && EU_COUNTRIES.has(country)) {
      holds.push({ reason: `pagó en ${purchase.currency.toUpperCase()} con dirección en ${country}: el precio en dólares es solo para fuera de la UE`, mode: 'draft' })
    }
  }

  if (purchase.amountTax > 0) {
    return { treatment: 'standard', rate: taxRate(purchase.amountTax, net), hold: hold(), vatPending: false }
  }
  if (!country) {
    holds.push({ reason: 'sin IVA y sin país de facturación', mode: 'manual' })
    return { treatment: purchase.taxTreatment, rate: 0, hold: hold(), vatPending: false }
  }
  if (country === 'ES') {
    holds.push({ reason: 'venta en España sin IVA: Stripe Tax no lo cobró (revisar el registro de España en Stripe Tax)', mode: 'manual' })
    return { treatment: 'standard', rate: 0, hold: hold(), vatPending: false }
  }
  if (!EU_COUNTRIES.has(country)) return { treatment: 'export', rate: 0, hold: hold(), vatPending: false }
  if (!reasons.has('reverse_charge')) {
    holds.push({ reason: `venta a ${country} sin IVA y sin inversión del sujeto pasivo según Stripe (${[...reasons].join(', ') || 'sin motivo'})`, mode: 'manual' })
    return { treatment: purchase.taxTreatment, rate: 0, hold: hold(), vatPending: false }
  }
  const vat = details.taxIds.filter((t) => t.type === 'eu_vat')
  const verified = vat.some((t) => t.verification === 'verified')
  if (!verified) {
    const status = vat.map((t) => `${t.value}: ${t.verification ?? 'sin dato'}`).join(', ') || 'sin NIF-IVA en el cliente de Stripe'
    holds.push({ reason: `NIF-IVA sin verificar en VIES (${status}): comprobarlo antes de emitir con inversión del sujeto pasivo`, mode: 'draft' })
  }
  return { treatment: 'reverse_charge', rate: 0, hold: hold(), vatPending: !verified && vat.some((t) => t.verification === 'pending') }
}
