// El formulario de contacto, sin Next: lo que decide la ruta (app/api/contact/route.ts), para probarlo
// con node --test. Por orden: que venga de la propia web, la trampa para robots, la validacion y un limite
// de envios por IP (con la zona montada, en la tabla rate_limits de la entrega). Lo que pasa, se manda.
// El limite solo cuenta lo que se va a mandar: un envio que no vale no manda nada, y asi quien lo corrige
// tras varios intentos no se queda sin cupo. Nunca tumba el formulario: si la entrega no se puede montar
// (una variable mal puesta), si la base de datos falla o si tarda mas de unos segundos, el mensaje sale
// igual (y queda en el registro).

import { z } from 'zod'
import { CONTACT_INTERESTS } from '../../../lib/contact.ts'
import { ipBucket, withinLimit } from '../../../lib/delivery/limits.ts'
import { withTimeout } from '../../../lib/delivery/util.ts'
import type { Delivery } from '../../../lib/delivery/container.ts'

/** Envios por bloque de IP y hora: de sobra para quien escribe, poco para un bucle. */
export const CONTACT_LIMIT = { hits: 5, windowSeconds: 3600 }

/** Lo que se espera a la base de datos para contar el envio: despues, el mensaje sale sin contar. */
export const CONTACT_LIMIT_TIMEOUT_MS = 2500

/** Lo mas largo de cada campo: los mismos maxLength en el formulario (components/contact-form.tsx). */
export const CONTACT_MAX = { name: 200, email: 320, company: 200, phone: 50, message: 5000 }

const contactSchema = z.object({
  name: z.string().trim().min(2).max(CONTACT_MAX.name),
  email: z.string().trim().email().max(CONTACT_MAX.email),
  company: z.string().trim().max(CONTACT_MAX.company).optional(),
  phone: z.string().trim().max(CONTACT_MAX.phone).optional(),
  interest: z.union([z.enum(CONTACT_INTERESTS), z.literal('')]).optional(),
  message: z.string().trim().min(20).max(CONTACT_MAX.message),
  locale: z.enum(['es', 'en']).optional(),
})

export type ContactMessage = z.infer<typeof contactSchema>

export interface ContactRequest {
  /** El cuerpo ya leido como JSON (null si no lo era). */
  body: unknown
  /** sameOrigin() de lib/api-route.ts: false si el Origin es de otra web. */
  sameOrigin: boolean
  ip: string | null
}

export interface ContactDeps {
  /**
   * La entrega, con la zona montada (zoneAvailable); sin ella no hay donde contar y no se limita. Se
   * pide al contar (dentro del try): montarla lanza si la configuracion de la entrega esta mal.
   */
  delivery: () => Delivery | null
  send: (message: ContactMessage) => Promise<void>
  /** El plazo para contar el envio (por defecto, CONTACT_LIMIT_TIMEOUT_MS). */
  limitTimeoutMs?: number
}

export async function handleContact(deps: ContactDeps, req: ContactRequest): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!req.sameOrigin) return { status: 403, body: { error: 'origen no permitido' } }

  // La trampa: una persona no la ve ni llega a ella con el teclado. Relleno, se contesta igual que si
  // hubiera salido, para que el robot no aprenda nada, y no se manda.
  const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : null
  if (typeof body?.website === 'string' && body.website.trim()) {
    // Sin datos de nadie: para ver en el registro de Vercel si alguna vez la rellena una persona (un autorrelleno).
    console.warn('[contacto] trampa rellena: no se manda')
    return { status: 200, body: { success: true } }
  }

  const parsed = contactSchema.safeParse(body)
  if (!parsed.success) return { status: 400, body: { error: 'Validation error' } }

  // El limite, solo para lo que se va a mandar: lo de arriba no gasta cupo.
  let allowed = true
  try {
    const delivery = deps.delivery()
    if (delivery) {
      allowed = await withTimeout(
        withinLimit(delivery, 'contacto-ip', ipBucket(req.ip), CONTACT_LIMIT.hits, CONTACT_LIMIT.windowSeconds),
        deps.limitTimeoutMs ?? CONTACT_LIMIT_TIMEOUT_MS,
        'la base de datos no contesta'
      )
    }
  } catch (error) {
    // Sin poder contar (la entrega mal configurada, la base caida o colgada), el mensaje sale: el
    // formulario no se cae por esto.
    console.error('[contacto] limite sin comprobar:', error)
  }
  if (!allowed) return { status: 429, body: { error: 'demasiados intentos', code: 'rate_limited' } }

  try {
    await deps.send(parsed.data)
  } catch (error) {
    console.error('Contact form error:', error)
    return { status: 500, body: { error: 'Internal server error' } }
  }
  return { status: 200, body: { success: true } }
}
