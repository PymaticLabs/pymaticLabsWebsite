import { NextRequest, NextResponse, after } from 'next/server'
import { getDelivery } from '@/lib/delivery/container'
import { runJobs } from '@/lib/delivery/jobs'
import { processStripeWebhook } from '@/lib/delivery/webhook'

// Entrega automatica tras el pago (PML-KB-0261): el aviso firmado de Stripe es lo unico que
// dispara la entrega (nunca la vuelta del cliente a la web: puede cerrar la pestana antes).
// 1. comprueba la firma; 2. apunta el pago una sola vez y encola sus pasos (factura, licencia,
// cuenta, sesion, bienvenida y aviso interno); 3. contesta a Stripe y, despues, corre la cola.
// Devoluciones, contracargos y cobros del mensual entran por aqui igual.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  const delivery = getDelivery()
  const result = await processStripeWebhook(
    delivery,
    await request.text(),
    request.headers.get('stripe-signature'),
    process.env.STRIPE_WEBHOOK_SECRET
  )
  if (result.status === 200 && result.body.outcome !== 'duplicate') {
    // Lo que falle aqui lo recoge pg_cron al minuto.
    after(() => runJobs(delivery, { budgetMs: 50_000 }).catch((error) => console.error('[entrega] cola:', error)))
  }
  return NextResponse.json(result.body, { status: result.status })
}
