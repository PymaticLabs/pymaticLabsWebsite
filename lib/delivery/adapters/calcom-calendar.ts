// Sesiones del Acompanado en Cal.com (API v2): un tipo de evento de 1 hora por persona (Eric y
// Sergio), cada uno con su horario (de lunes a viernes de 18:00 a 22:00 y los sabados de 10:00 a
// 14:00, hora peninsular). La web lee los huecos libres, aparta el elegido mientras se paga y lo
// reserva al cobrar. Si la compra se devuelve, cancela las que aun no han llegado.
//
// CALCOM_API_KEY (cal_...) y CALCOM_EVENT_TYPES, JSON: {"eric": 123, "sergio": 456}.

import { request, requestJson, requireEnv } from './http.ts'
import { errorMessage } from '../util.ts'
import { PermanentError, SlotUnavailableError, type BookingResult, type Calendar, type CancelResult, type Locale, type Slot } from '../types.ts'

const SLOTS_VERSION = '2024-09-04'
const BOOKINGS_VERSION = '2024-08-13'

export class CalcomCalendar implements Calendar {
  readonly name = 'calcom'
  private base: string
  private key: string
  private eventTypes: Record<string, number>

  constructor(env: Record<string, string | undefined>) {
    this.key = requireEnv(env, 'CALCOM_API_KEY')
    this.base = (env.CALCOM_API_URL || 'https://api.cal.com/v2').replace(/\/+$/, '')
    try {
      this.eventTypes = JSON.parse(requireEnv(env, 'CALCOM_EVENT_TYPES'))
    } catch {
      throw new PermanentError('CALCOM_EVENT_TYPES no es JSON: {"eric": <id>, "sergio": <id>}')
    }
  }

  private eventType(host: string): number {
    const id = Number(this.eventTypes[host])
    if (!Number.isInteger(id) || id <= 0) throw new PermanentError(`CALCOM_EVENT_TYPES no tiene el evento de ${host}`)
    return id
  }

  private headers(version: string) {
    return { Authorization: `Bearer ${this.key}`, 'cal-api-version': version }
  }

  async availability(fromIso: string, toIso: string): Promise<Slot[]> {
    const slots: Slot[] = []
    for (const host of Object.keys(this.eventTypes)) {
      const params = new URLSearchParams({ eventTypeId: String(this.eventType(host)), start: fromIso, end: toIso, timeZone: 'UTC' })
      const body = await requestJson<{ data: Record<string, { start: string }[]> }>('Cal.com', `${this.base}/slots?${params}`, {
        headers: this.headers(SLOTS_VERSION),
      })
      for (const day of Object.values(body.data ?? {})) {
        for (const slot of day) slots.push({ host, start: new Date(slot.start).toISOString() })
      }
    }
    return slots.sort((a, b) => (a.start === b.start ? a.host.localeCompare(b.host) : a.start < b.start ? -1 : 1))
  }

  async reserve(slot: Slot, minutes: number): Promise<string | null> {
    try {
      const body = await requestJson<{ data: { reservationUid: string } }>('Cal.com', `${this.base}/slots/reservations`, {
        method: 'POST',
        headers: this.headers(SLOTS_VERSION),
        json: { eventTypeId: this.eventType(slot.host), slotStart: slot.start, reservationDuration: minutes },
      })
      return body.data.reservationUid
    } catch (error) {
      if (isUnavailable(error)) throw new SlotUnavailableError()
      throw error
    }
  }

  async release(reservationId: string): Promise<void> {
    try {
      await request('Cal.com', `${this.base}/slots/reservations/${encodeURIComponent(reservationId)}`, {
        method: 'DELETE',
        headers: this.headers(SLOTS_VERSION),
      })
    } catch (error) {
      // Ya caducada o ya borrada: es lo que se queria.
      if ((error as { status?: number }).status !== 404) throw error
    }
  }

  async book(input: {
    slot: Slot
    attendee: { name: string; email: string; locale: Locale }
    reservationId: string | null
    metadata: Record<string, string>
  }): Promise<BookingResult> {
    // El hueco apartado durante el pago se suelta justo antes de reservarlo (si no, se bloquea a si mismo).
    if (input.reservationId) await this.release(input.reservationId)
    try {
      const body = await requestJson<{ data: { uid: string; start: string; end?: string; meetingUrl?: string; location?: string } }>(
        'Cal.com',
        `${this.base}/bookings`,
        {
          method: 'POST',
          headers: this.headers(BOOKINGS_VERSION),
          json: {
            start: input.slot.start,
            eventTypeId: this.eventType(input.slot.host),
            attendee: { name: input.attendee.name, email: input.attendee.email, timeZone: 'Europe/Madrid', language: input.attendee.locale },
            metadata: input.metadata,
          },
        }
      )
      const data = body.data
      return {
        uid: data.uid,
        start: data.start,
        end: data.end ?? null,
        meetingUrl: data.meetingUrl ?? (data.location?.startsWith('http') ? data.location : null),
      }
    } catch (error) {
      if (isUnavailable(error)) throw new SlotUnavailableError()
      throw error
    }
  }

  async cancel(uid: string, reason: string): Promise<CancelResult> {
    try {
      await request('Cal.com', `${this.base}/bookings/${encodeURIComponent(uid)}/cancel`, {
        method: 'POST',
        headers: this.headers(BOOKINGS_VERSION),
        json: { cancellationReason: reason },
      })
      return 'cancelled'
    } catch (error) {
      const status = (error as { status?: number }).status
      // Borrada a mano en Cal.com: nada que cancelar.
      if (status === 404) return 'gone'
      // 400 "Cannot cancel a booking that has already ended" (o ya cancelada): reintentar no cambia nada.
      if (status === 400 && /already ended/i.test(errorMessage(error))) return 'ended'
      if (status === 400 && /already.*cancel/i.test(errorMessage(error))) return 'gone'
      throw error
    }
  }
}

/** Cal.com responde 400 o 409 cuando el hueco ya no esta libre (nuestros datos son validos). */
function isUnavailable(error: unknown): boolean {
  const status = (error as { status?: number }).status
  return status === 400 || status === 409
}
