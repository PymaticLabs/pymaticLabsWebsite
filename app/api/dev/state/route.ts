import { NextResponse } from 'next/server'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'

// Solo en modo falso (DELIVERY_MODE=fake): lo que han hecho las piezas falsas, para la prueba de
// punta a punta (scripts/e2e-entrega.mts). En cualquier otro modo, no existe.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  const delivery = getDelivery()
  if (!devToolsEnabled(delivery.config)) return new NextResponse(null, { status: 404 })
  // Se crean las piezas que aun no se hayan usado, para que salgan todas.
  for (const key of ['repo', 'mailer', 'signer', 'invoicer', 'calendar', 'payments'] as const) void delivery[key]
  const { repo, mailer, signer, invoicer, calendar, payments } = delivery.fakes
  return NextResponse.json({
    db: repo?.state ?? null,
    publicKey: signer ? await signer.publicKey() : null,
    mail: (mailer?.sent ?? []).map((m) => ({
      to: m.to,
      subject: m.subject,
      text: m.text,
      tags: m.tags ?? [],
      attachments: (m.attachments ?? []).map((a) => ({ name: a.name, contentType: a.contentType, base64: a.content.toString('base64') })),
    })),
    invoicer: invoicer ? { calls: invoicer.calls, documents: [...invoicer.documents.values()] } : null,
    calendar: calendar ? { booked: [...calendar.booked.values()], reservations: [...calendar.reservations.entries()] } : null,
    payments: payments ? { sessions: [...payments.sessions.values()].map((s) => ({ id: s.id, params: s.params })), known: Object.fromEntries(payments.payments) } : null,
  })
}
