import { modalities, type ModalityId } from '@/lib/offer'

// Cobro: Stripe directo, con un enlace de pago por modalidad (Eric, 05-10-2026). El Acompañado
// va con factura de Holded primero, asi que normalmente solo el Hazlo tu tiene enlace.
//
// STRIPE_PAYMENT_LINKS, JSON: {"hazlo-tu": {"url": "https://buy.stripe.com/...", "id": "plink_..."}, ...}
// CHECKOUT_OPEN=true enseña los botones de compra. Se deja apagado hasta que el abogado revise
// las condiciones (traspaso, seccion 7).

export interface PaymentLink {
  url: string
  id: string
}

export function paymentLinks(): Partial<Record<ModalityId, PaymentLink>> {
  const raw = process.env.STRIPE_PAYMENT_LINKS
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.error('STRIPE_PAYMENT_LINKS no es JSON valido')
    return {}
  }
  const links: Partial<Record<ModalityId, PaymentLink>> = {}
  for (const { id } of modalities) {
    const link = (parsed as Record<string, Partial<PaymentLink>>)?.[id]
    if (link?.url?.startsWith('https://') && link.id?.startsWith('plink_')) {
      links[id] = { url: link.url, id: link.id }
    }
  }
  return links
}

export function isCheckoutOpen(): boolean {
  return process.env.CHECKOUT_OPEN === 'true'
}

/** La modalidad que vende un enlace de pago, por su id (el `payment_link` de la sesion de Stripe). */
export function modalityForPaymentLink(paymentLinkId: string | null | undefined): ModalityId | null {
  if (!paymentLinkId) return null
  const entry = Object.entries(paymentLinks()).find(([, link]) => link?.id === paymentLinkId)
  return (entry?.[0] as ModalityId | undefined) ?? null
}
