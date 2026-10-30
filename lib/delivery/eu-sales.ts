// Las ventas con el 21 % de IVA espanol a empresas de otros paises de la UE sin NIF-IVA (el caso 3,
// como a particulares). Mientras no pasen de 10.000 euros al ano, este o el anterior, el IVA es el
// espanol (arts. 70.Uno.8.o y 73.Uno LIVA); pasado el limite, esa venta y las siguientes llevan el del
// pais del cliente por la ventanilla unica (OSS), que la web no sabe cobrar.
//
// Los socios (30-10-2026): se sigue vendiendo, pero el pago se para antes de llegar (lib/checkout.ts,
// la licencia en /comprar y el mensual en la zona) si las del ano anterior pasan de 10.000 euros, o si
// las de este ano con la de ahora pasan de 8.000 (EU_NO_VAT_STOP), con un error que pide escribir a
// info@pymaticlabs.com. El margen es para los mensuales que ya hay, que no se cortan: cada cobro
// desde los 8.000 da un aviso interno urgente (steps.ts, notice).
//
// Lo suman igual el pago, el aviso de cada venta y la comprobacion de produccion (health.ts), desde
// todas las compras (Repository.listEuNoVatSales), no solo las de empresas con acceso: las cobradas y
// entregadas (pagadas, devueltas en parte o con un contracargo abierto, tambien con la factura
// retenida) y las que esperan revision ya cobradas con el 21 %; la base sin IVA, menos lo devuelto en
// proporcion. Solo las de vivo, o solo las de prueba. El limite cuenta todas las ventas electronicas
// de la SL a no empresarios de la UE: las que se facturen fuera de la web las suma Manel aparte.

import { EU_DISTANCE_SALES_LIMIT } from './tax.ts'
import { isEuNoVatSale } from './tax-check.ts'
import { madridDate } from './util.ts'
import type { EuSaleRow, Purchase, PurchaseStatus, Repository } from './types.ts'

/** 8.000 euros (en centimos): con las de este ano y la de ahora por encima, el pago no se abre. */
export const EU_NO_VAT_STOP = 800_000

/**
 * Las que cuentan: cobradas y entregadas, y las que esperan revision (cobradas con el 21 %; si se
 * devuelven, dejan de contar). No cuentan las devueltas ni los contracargos perdidos (ya rectificados).
 */
export const EU_SALE_STATUSES: readonly PurchaseStatus[] = ['paid', 'partially_refunded', 'disputed', 'needs_review']

/** Lo que llevan esas ventas, en centimos sin IVA: el ano (en Madrid) y el anterior. */
export interface EuNoVatTotals {
  year: number
  current: number
  previous: number
}

/** El ano en Madrid de un instante. */
export function madridYear(at: Date | string): number {
  return Number(madridDate(typeof at === 'string' ? new Date(at) : at).slice(0, 4))
}

/** El pais declarado de una compra a revisar sin empresa (review_data.declared.country). */
export function reviewCountry(reviewData: Record<string, unknown> | null | undefined): string | null {
  const declared = reviewData?.declared
  const country = declared && typeof declared === 'object' ? (declared as Record<string, unknown>).country : null
  return typeof country === 'string' && country ? country : null
}

/** La base sin IVA de una venta, menos lo devuelto (en proporcion: lo devuelto lleva su IVA). */
export function euSaleNet(p: Pick<Purchase, 'amountSubtotal' | 'amountDiscount' | 'amountTotal' | 'amountRefunded'>): number {
  const net = p.amountSubtotal - p.amountDiscount
  const refunded = p.amountTotal > 0 ? Math.round((p.amountRefunded * net) / p.amountTotal) : 0
  return Math.max(0, net - refunded)
}

/** Suma las ventas a la UE sin NIF-IVA del ano dado y del anterior (lo demas, fuera). */
export function sumEuNoVatSales(rows: EuSaleRow[], year: number, livemode: boolean): EuNoVatTotals {
  const totals: EuNoVatTotals = { year, current: 0, previous: 0 }
  for (const { purchase: p, country } of rows) {
    if (p.livemode !== livemode || !EU_SALE_STATUSES.includes(p.status) || !isEuNoVatSale(p, { country })) continue
    const at = madridYear(p.paidAt)
    if (at === year) totals.current += euSaleNet(p)
    else if (at === year - 1) totals.previous += euSaleNet(p)
  }
  return totals
}

/** Lo que llevan las ventas a la UE sin NIF-IVA el ano de ese instante (en Madrid) y el anterior. */
export async function euNoVatSales(repo: Pick<Repository, 'listEuNoVatSales'>, at: Date, livemode: boolean): Promise<EuNoVatTotals> {
  const year = madridYear(at)
  // Desde el 31 de diciembre de dos anos antes (UTC): el 1 de enero en Madrid empieza la vispera a las 23:00.
  return sumEuNoVatSales(await repo.listEuNoVatSales(`${year - 2}-12-31T00:00:00.000Z`, livemode), year, livemode)
}

/**
 * Si una venta mas de amount centimos no se abre: previous, las del ano anterior pasaron del limite
 * (10.000 euros); current, las de este ano con esta pasan de 8.000. null si se puede vender.
 */
export function euNoVatStop(totals: EuNoVatTotals, amount: number): 'previous' | 'current' | null {
  if (totals.previous > EU_DISTANCE_SALES_LIMIT) return 'previous'
  if (totals.current + amount > EU_NO_VAT_STOP) return 'current'
  return null
}

/**
 * Para el aviso de cada venta o cobro: over, pasado el limite (este ano o el anterior); stop, este ano
 * ya en los 8.000 euros (la web deja de abrir pagos asi). Los dos, aviso urgente.
 */
export function euNoVatLevel(totals: EuNoVatTotals): 'over' | 'stop' | null {
  if (Math.max(totals.current, totals.previous) > EU_DISTANCE_SALES_LIMIT) return 'over'
  if (totals.current >= EU_NO_VAT_STOP) return 'stop'
  return null
}
