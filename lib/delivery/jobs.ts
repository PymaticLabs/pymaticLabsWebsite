// El trabajador de la cola: coge los pasos que tocan (con sus dependencias hechas), los corre de
// pocos en pocos y apunta el resultado. Un fallo temporal se reintenta con espera exponencial (30 s,
// 1 min, 2 min... hasta 1 h, o lo que diga Retry-After); con 100 ventas seguidas, un limite de Holded
// o de Stripe retrasa, no pierde.
//
// Tras JOBS_ALERT_AFTER fallos seguidos de un paso se avisa a PymaticLabs con el motivo, y otra vez
// si muere (JOBS_MAX_ATTEMPTS, o un error permanente). Un paso muerto se reintenta a mano desde
// /api/admin/jobs.
//
// Lo llaman el webhook (al momento, con after()) y /api/jobs/run (cada minuto, con pg_cron).

import { internalEmail } from './emails.ts'
import { HANDLERS, type StepHandler } from './steps.ts'
import { errorMessage } from './util.ts'
import type { Delivery } from './container.ts'
import { PermanentError, RetryableError, type Job } from './types.ts'

export interface RunStats {
  claimed: number
  done: number
  retried: number
  dead: number
}

export function backoffMs(attempts: number, base: number, max: number, retryAfterMs: number | null = null, random = Math.random): number {
  const exponential = Math.min(max, base * 2 ** Math.max(0, attempts - 1))
  const jittered = Math.round(exponential * (0.8 + random() * 0.4))
  return Math.max(jittered, retryAfterMs ?? 0)
}

async function alert(d: Delivery, job: Job, message: string, state: 'retrying' | 'dead') {
  const mail = internalEmail(
    `${state === 'dead' ? 'URGENTE · Paso parado' : 'Paso fallando'}: ${job.kind} (${job.key})`,
    {
      'Qué hacer':
        state === 'dead'
          ? 'Arreglar la causa y reintentarlo: POST /api/admin/jobs {"action":"retry","id":"' + job.id + '"}'
          : 'Nada aún: se sigue reintentando solo. Si es una clave o un permiso, arreglarlo',
      Paso: job.kind,
      Clave: job.key,
      Intentos: `${job.attempts} de ${Math.min(job.maxAttempts, d.config.jobs.maxAttempts)}`,
      Motivo: message,
      Datos: JSON.stringify(job.payload),
    }
  )
  try {
    await d.mailer.send({ to: d.config.alertEmail, ...mail, idempotencyKey: `alert:${job.key}:${state}:${job.attempts}`, tags: ['alerta'] })
  } catch (error) {
    // Sin correo no hay a quien avisar: al menos al registro de Vercel.
    console.error(`[entrega] alerta sin enviar (${job.key}): ${message} / ${errorMessage(error)}`)
  }
}

async function runOne(d: Delivery, handlers: Record<string, StepHandler>, job: Job, stats: RunStats) {
  const handler = handlers[job.kind]
  try {
    if (!handler) throw new PermanentError(`paso desconocido: ${job.kind}`)
    const result = await handler(d, job)
    await d.repo.completeJob(job.id, result ?? null, d.clock())
    stats.done += 1
  } catch (error) {
    const message = errorMessage(error)
    const now = d.clock()
    // El tope del paso, o el de la configuracion si es menor (JOBS_MAX_ATTEMPTS).
    const dead = error instanceof PermanentError || job.attempts >= Math.min(job.maxAttempts, d.config.jobs.maxAttempts)
    console.error(`[entrega] ${job.kind} ${job.key} intento ${job.attempts}: ${message}`)
    if (dead) {
      await d.repo.failJob(job.id, message, { dead: true }, now)
      stats.dead += 1
      await alert(d, job, message, 'dead')
      return
    }
    const retryAfter = error instanceof RetryableError ? error.retryAfterMs : null
    const delay = backoffMs(job.attempts, d.config.jobs.baseDelayMs, d.config.jobs.maxDelayMs, retryAfter)
    await d.repo.failJob(job.id, message, { runAt: new Date(now.getTime() + delay).toISOString() }, now)
    stats.retried += 1
    if (job.attempts >= d.config.jobs.alertAfter && !job.alertedAt) {
      await alert(d, job, message, 'retrying')
      await d.repo.markJobAlerted(job.id, now)
    }
  }
}

/** Corre la cola hasta que no quede nada que toque o se acabe el tiempo. */
export async function runJobs(
  d: Delivery,
  options: { budgetMs?: number; handlers?: Record<string, StepHandler> } = {}
): Promise<RunStats> {
  const handlers = options.handlers ?? HANDLERS
  const budget = options.budgetMs ?? 45_000
  const started = Date.now()
  const stats: RunStats = { claimed: 0, done: 0, retried: 0, dead: 0 }
  while (Date.now() - started < budget) {
    const jobs = await d.repo.claimJobs(d.config.jobs.concurrency, d.config.jobs.lockSeconds, d.clock())
    if (!jobs.length) break
    stats.claimed += jobs.length
    await Promise.all(jobs.map((job) => runOne(d, handlers, job, stats)))
  }
  return stats
}
