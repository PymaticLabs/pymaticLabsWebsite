import { NextRequest, NextResponse } from 'next/server'
import { devToolsEnabled } from '@/lib/delivery/config'
import { getDelivery } from '@/lib/delivery/container'

// Solo en modo falso: lo que contesta el VIES de mentira (lib/delivery/adapters/fakes.ts, FakeVies),
// para recorrer en local y en la prueba de punta a punta un NIF-IVA que VIES rechaza o VIES caido.
//   POST {"vatId": "DE111111111", "result": "invalid"}   ese NIF-IVA, con su prefijo (valid lo quita)
//   POST {"down": true}                                    VIES sin contestar (false, otra vez de vuelta)
//   POST {"vatId": "DE111111111", "name": "Otra GmbH"}     el titular que da VIES (name y address; sin
//                                                          ellos, «---», como en Espana): uno de otra
//                                                          empresa deja la factura en borrador
// Contesta lo que queda puesto y las consultas que se le han hecho.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESULTS = ['valid', 'invalid', 'unavailable'] as const

export async function POST(request: NextRequest) {
  // Sin DELIVERY_MODE=fake no existe (ni se monta la entrega, que sin claves fallaria).
  if (process.env.DELIVERY_MODE !== 'fake') return new NextResponse(null, { status: 404 })
  const delivery = getDelivery()
  if (!devToolsEnabled(delivery.config)) return new NextResponse(null, { status: 404 })
  void delivery.vies
  const vies = delivery.fakes.vies
  if (!vies) return new NextResponse(null, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { vatId?: unknown; result?: unknown; down?: unknown; name?: unknown; address?: unknown }
  if (typeof body.down === 'boolean') vies.down = body.down
  const holder = body.name !== undefined || body.address !== undefined
  if (body.vatId !== undefined || body.result !== undefined || holder) {
    const vatId = typeof body.vatId === 'string' ? body.vatId.trim().toUpperCase().replace(/[\s.-]/g, '') : ''
    const result = RESULTS.find((r) => r === body.result)
    if (!/^[A-Z]{2}[A-Z0-9]{2,12}$/.test(vatId) || (body.result !== undefined && !result) || (!result && !holder)) {
      return NextResponse.json({ error: 'vatId (con su prefijo) y result (valid, invalid o unavailable), o name y address' }, { status: 400 })
    }
    if (result === 'valid') vies.results.delete(vatId)
    else if (result) vies.results.set(vatId, result)
    if (holder) {
      const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : null)
      const named = { name: text(body.name), address: text(body.address) }
      if (named.name || named.address) vies.holders.set(vatId, named)
      else vies.holders.delete(vatId)
    }
  }
  return NextResponse.json({ down: vies.down, results: Object.fromEntries(vies.results), holders: Object.fromEntries(vies.holders), checks: vies.checks })
}
