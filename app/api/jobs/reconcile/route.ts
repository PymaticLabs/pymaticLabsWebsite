import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { runJobs } from '@/lib/delivery/jobs'
import { reconcile } from '@/lib/delivery/reconcile'

// La conciliacion diaria de licencias y pagos (pg_cron, 05:15 UTC). ?dias=N mira mas atras.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!hasSecret(request, 'JOBS_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const days = Number(request.nextUrl.searchParams.get('dias')) || undefined
  const delivery = getDelivery()
  const report = await reconcile(delivery, { days })
  // Lo recuperado se entrega ya.
  if (report.recovered.length) await runJobs(delivery, { budgetMs: 15_000 })
  return NextResponse.json(report)
}
