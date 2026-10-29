// Oferta del Cerebro Digital, v1.9 (knowledge/11_Comercial/oferta-del-cerebro-digital.md).
// Precios sin IVA, en euros. Se vende a empresas y profesionales de cualquier pais (socios, 27-10-2026);
// el IVA de cada caso lo decide el pago (knowledge/10_Fiscal/iva-en-ventas.md, lib/delivery/tax.ts).
// Si cambia la oferta, se cambia aqui y en ningun otro sitio.

export type ModalityId = 'hazlo-tu' | 'hazlo-tu-equipo' | 'acompanado' | 'acompanado-equipo'
export type PlanId = 'esencial' | 'pro' | 'premium'

export interface Modality {
  id: ModalityId
  listPrice: number
  launchPrice: number
  team: boolean
  guided: boolean
  /** Meses del mensual que van incluidos con la compra. */
  includedMonths: { plan: PlanId; months: number } | null
}

export interface Plan {
  id: PlanId
  /** Al mes. */
  monthly: number
  /** Por ano adelantado: el precio de ANNUAL_PAID_MONTHS meses. */
  yearly: number
}

export const LAUNCH_CUSTOMERS = 10
export const TEAM_MAX_PEOPLE = 10
export const SETUP_SESSIONS = 2
export const GUARANTEE_DAYS = 14
/** El mensual pagado por ano adelantado cuesta 10 meses (oferta v1.9; retainers-y-mantenimiento v2.8, Eric 25-10-2026). */
export const ANNUAL_PAID_MONTHS = 10

export const modalities: Modality[] = [
  { id: 'hazlo-tu', listPrice: 990, launchPrice: 500, team: false, guided: false, includedMonths: null },
  { id: 'hazlo-tu-equipo', listPrice: 1990, launchPrice: 1000, team: true, guided: false, includedMonths: { plan: 'pro', months: 3 } },
  { id: 'acompanado', listPrice: 1990, launchPrice: 1000, team: false, guided: true, includedMonths: { plan: 'esencial', months: 1 } },
  { id: 'acompanado-equipo', listPrice: 3490, launchPrice: 2000, team: true, guided: true, includedMonths: { plan: 'pro', months: 3 } },
]

export const plans: Plan[] = [
  { id: 'esencial', monthly: 99, yearly: 990 },
  { id: 'pro', monthly: 199, yearly: 1990 },
  { id: 'premium', monthly: 299, yearly: 2990 },
]

export const CUSTOM_FROM_PRICE = 10000

// Con punto de millar tambien en las de cuatro cifras («1.990 €», como la oferta y los textos de la
// web): es-ES solo lo pone desde 10.000.
export function formatPrice(amount: number, locale: string, currency: 'EUR' | 'USD' = 'EUR') {
  return new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
    useGrouping: 'always',
  }).format(amount)
}
