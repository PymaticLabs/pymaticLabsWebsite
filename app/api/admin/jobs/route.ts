import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { oneTimeJobs, renewalJobs } from '@/lib/delivery/events'
import { runJobs } from '@/lib/delivery/jobs'

// La cola, para PymaticLabs (Authorization: Bearer <ADMIN_SECRET>).
// GET ?status=dead: los pasos parados. POST {"action":"retry","id":"..."}: reintentar uno ya
// arreglado; {"action":"run"}: correr la cola ahora; {"action":"deliver","purchaseId":"..."}:
// entregar una compra que se reviso a mano.

export const runtime = 'nodejs'
export const maxDuration = 60

const STATUSES = ['pending', 'running', 'done', 'dead'] as const

export async function GET(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const status = request.nextUrl.searchParams.get('status')
  const jobs = await getDelivery().repo.listJobs({
    status: STATUSES.find((s) => s === status),
    limit: Math.min(500, Number(request.nextUrl.searchParams.get('limit')) || 100),
  })
  return NextResponse.json({ jobs })
}

export async function POST(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { action?: string; id?: string; purchaseId?: string }
  const delivery = getDelivery()
  if (body.action === 'retry' && body.id) {
    const retried = await delivery.repo.retryJob(String(body.id), delivery.clock())
    if (!retried) return NextResponse.json({ error: 'no existe o no esta parado' }, { status: 404 })
    return NextResponse.json({ retried: true, run: await runJobs(delivery, { budgetMs: 40_000 }) })
  }
  if (body.action === 'run') return NextResponse.json(await runJobs(delivery, { budgetMs: 50_000 }))
  if (body.action === 'deliver' && body.purchaseId) {
    // Una compra a revisar ya completada a mano (empresa puesta y status paid): se entrega.
    const purchase = await delivery.repo.getPurchase(String(body.purchaseId))
    if (!purchase?.companyId || purchase.status !== 'paid') return NextResponse.json({ error: 'la compra no existe, no tiene empresa o no esta pagada' }, { status: 409 })
    await delivery.repo.enqueueJobs(purchase.kind === 'one_time' ? oneTimeJobs(purchase) : renewalJobs(purchase), delivery.clock())
    return NextResponse.json({ queued: true, run: await runJobs(delivery, { budgetMs: 40_000 }) })
  }
  return NextResponse.json({ error: 'action: retry, run o deliver' }, { status: 400 })
}
