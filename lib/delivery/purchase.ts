import type Stripe from 'stripe'
import { modalities, type ModalityId } from '@/lib/offer'
import { addMonths, type LicenseData, type LicenseModality } from '@/lib/license'

export interface Purchase {
  sessionId: string
  modality: ModalityId
  company: string | null
  taxId: string | null
  email: string | null
  country: string | null
  locale: 'es' | 'en'
  amountTotal: number | null
  currency: string | null
  /** Fecha de compra en hora peninsular, AAAA-MM-DD. */
  purchasedOn: string
}

function customField(session: Stripe.Checkout.Session, key: string): string | null {
  const field = session.custom_fields?.find((f) => f.key === key)
  return field?.text?.value?.trim() || null
}

/** Los datos de la compra, sacados de la sesion de Checkout que crea el enlace de pago. */
export function purchaseFromSession(session: Stripe.Checkout.Session, modality: ModalityId): Purchase {
  const details = session.customer_details
  const country = details?.address?.country ?? null
  const sessionLocale = session.locale ?? ''
  const locale = sessionLocale.startsWith('es') || (!sessionLocale.startsWith('en') && country === 'ES') ? 'es' : 'en'

  return {
    sessionId: session.id,
    modality,
    // El nombre de la empresa: el de empresa de Stripe, o un campo propio "empresa" del enlace.
    company: details?.business_name?.trim() || customField(session, 'empresa') || details?.name?.trim() || null,
    // El NIF-IVA: el de la recogida de numeros fiscales de Stripe, o un campo propio "nif".
    taxId: details?.tax_ids?.[0]?.value?.trim() || customField(session, 'nif'),
    email: details?.email ?? null,
    country,
    locale,
    amountTotal: session.amount_total,
    currency: session.currency,
    purchasedOn: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(
      new Date(session.created * 1000)
    ),
  }
}

/**
 * Lo que va en la licencia segun la modalidad (oferta v1.3): la modalidad de licencia.py, si trae
 * equipo y hasta cuando hay mantenimiento y soporte. Sin meses del mensual incluidos (Hazlo tu sin
 * equipo), soporte_hasta es la fecha de compra, como hace firmar_licencia.py.
 */
export function licenseTerms(modality: ModalityId, purchasedOn: string): Omit<LicenseData, 'id' | 'cliente' | 'nif'> {
  const offer = modalities.find((m) => m.id === modality)
  if (!offer) throw new Error(`modalidad desconocida: ${modality}`)
  const licenseModality: LicenseModality = offer.guided ? 'acompanado' : 'hazlo-tu'
  return {
    modalidad: licenseModality,
    equipo: offer.team,
    emitida: purchasedOn,
    soporte_hasta: offer.includedMonths ? addMonths(purchasedOn, offer.includedMonths.months) : purchasedOn,
  }
}
