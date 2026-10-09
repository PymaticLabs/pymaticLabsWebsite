// Oferta del Cerebro Digital, v1.3 (knowledge/11_Comercial/oferta-del-cerebro-digital.md).
// Precios sin IVA. En Norteamerica, los mismos numeros en USD.
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

export const LAUNCH_CUSTOMERS = 10
export const TEAM_MAX_PEOPLE = 10
export const SETUP_SESSIONS = 2
export const GUARANTEE_DAYS = 14

export const modalities: Modality[] = [
  { id: 'hazlo-tu', listPrice: 990, launchPrice: 500, team: false, guided: false, includedMonths: null },
  { id: 'hazlo-tu-equipo', listPrice: 1990, launchPrice: 1000, team: true, guided: false, includedMonths: { plan: 'pro', months: 3 } },
  { id: 'acompanado', listPrice: 1990, launchPrice: 1000, team: false, guided: true, includedMonths: { plan: 'esencial', months: 1 } },
  { id: 'acompanado-equipo', listPrice: 3490, launchPrice: 2000, team: true, guided: true, includedMonths: { plan: 'pro', months: 3 } },
]

export const plans: { id: PlanId; monthly: number }[] = [
  { id: 'esencial', monthly: 99 },
  { id: 'pro', monthly: 199 },
  { id: 'premium', monthly: 299 },
]

export const PACK_ESPANA_PRICE = 1990
export const CUSTOM_FROM_PRICE = 10000

export function formatPrice(amount: number, locale: string, currency: 'EUR' | 'USD' = 'EUR') {
  return new Intl.NumberFormat(locale === 'en' ? 'en-IE' : 'es-ES', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}
