// El aviso de Stripe tal cual llega: se comprueba la firma (STRIPE_WEBHOOK_SECRET) antes de mirar
// nada, se apunta y se encola. Contestar rapido es parte del contrato con Stripe: el trabajo lo
// hace la cola, que el webhook lanza al momento (after()) y que pg_cron repasa cada minuto.

import type Stripe from 'stripe'
import { constructStripeEvent } from './adapters/stripe-payments.ts'
import { handleStripeEvent } from './events.ts'
import type { Delivery } from './container.ts'

export interface WebhookResult {
  status: number
  body: Record<string, unknown>
}

export async function processStripeWebhook(
  d: Delivery,
  payload: string,
  signature: string | null,
  secret: string | undefined
): Promise<WebhookResult> {
  if (!secret || !signature) return { status: 400, body: { error: 'webhook sin configurar o sin firma' } }
  let event: Stripe.Event
  try {
    event = constructStripeEvent(payload, signature, secret)
  } catch {
    return { status: 400, body: { error: 'firma no valida' } }
  }
  try {
    const { outcome } = await handleStripeEvent(d, event)
    return { status: 200, body: { received: true, outcome } }
  } catch (error) {
    // Un 500 hace que Stripe reintente el aviso; lo ya hecho no se repite.
    console.error(`[entrega] ${event.type} ${event.id}:`, error)
    return { status: 500, body: { error: 'fallo al registrar el aviso' } }
  }
}
