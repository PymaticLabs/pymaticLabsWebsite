import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { runJobs } from '@/lib/delivery/jobs'

// El trabajador de la cola. Lo llama pg_cron cada minuto mientras haya pasos que tocan
// (supabase/migrations/20261021120200_cron.sql), con Authorization: Bearer <JOBS_SECRET>.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!hasSecret(request, 'JOBS_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const stats = await runJobs(getDelivery(), { budgetMs: 50_000 })
  return NextResponse.json(stats)
}
