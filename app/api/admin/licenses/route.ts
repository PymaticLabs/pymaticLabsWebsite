import { NextRequest, NextResponse } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { runJobs } from '@/lib/delivery/jobs'
import { LicenseUploadError, purchaseByRef, requestView, uploadManualLicense } from '@/lib/delivery/manual-license'
import type { LicenseRequestStatus } from '@/lib/delivery/types'

// Las licencias a mano (LICENSE_MODE=manual), para PymaticLabs (Authorization: Bearer <ADMIN_SECRET>).
// GET: las pedidas sin firmar (?estado=issued|cancelled para las demas); ?compra=<id o pi_...>: una,
// con los campos que tiene que llevar.
// POST ?compra=<id o pi_...> con el fichero .cerebro-licencia tal cual (curl --data-binary, tambien
// con Content-Type: application/json), o JSON {"compra": "...", "licencia": "<el fichero en texto>"}:
// la licencia que firmo Eric. Se comprueba con su publica y con la compra, se guarda, se manda al
// cliente y queda en su zona.
// scripts/subir-licencia.mts lo hace desde el ordenador.

export const runtime = 'nodejs'
export const maxDuration = 60

const STATUSES: LicenseRequestStatus[] = ['pending', 'issued', 'cancelled']

export async function GET(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  const delivery = getDelivery()
  const ref = request.nextUrl.searchParams.get('compra')
  const mode = { modo: delivery.config.licenseMode, clave: delivery.config.manualKeyEnv }
  if (ref) {
    const purchase = await purchaseByRef(delivery, ref)
    const found = purchase ? await delivery.repo.getLicenseRequestByPurchase(purchase.id) : null
    if (!found) return NextResponse.json({ error: 'esa compra no tiene licencia pedida a mano' }, { status: 404 })
    return NextResponse.json({ ...mode, pedida: requestView(found) })
  }
  const status = STATUSES.find((s) => s === request.nextUrl.searchParams.get('estado')) ?? 'pending'
  const list = await delivery.repo.listLicenseRequests({ status, limit: 200 })
  return NextResponse.json({ ...mode, estado: status, pedidas: list.map(requestView) })
}

export async function POST(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  let ref = request.nextUrl.searchParams.get('compra')
  // El fichero tal cual: lo que se guarda (y su huella) es lo que firmo Eric, byte a byte.
  let content = await request.text()
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    let body: { compra?: unknown; licencia?: unknown; formato?: unknown; firma?: unknown } | null = null
    try {
      body = JSON.parse(content)
    } catch {
      // no es JSON: se queda como fichero y la comprobacion dice que no vale
    }
    // El .cerebro-licencia ya es JSON ({formato, licencia, firma}): mandado con ese tipo, es el fichero.
    const isLicenseFile = body !== null && typeof body === 'object' && 'formato' in body && 'firma' in body && typeof body.licencia === 'object'
    if (body && !isLicenseFile) {
      if (typeof body.compra === 'string') ref = body.compra
      content = typeof body.licencia === 'string' ? body.licencia : ''
    }
  }
  if (!ref) return NextResponse.json({ error: 'falta la compra (?compra=<id o pi_...>)' }, { status: 400 })
  const delivery = getDelivery()
  try {
    const result = await uploadManualLicense(delivery, ref, content)
    // El correo al cliente sale ya (y si no, pg_cron lo recoge al minuto).
    const run = await runJobs(delivery, { budgetMs: 30_000 })
    return NextResponse.json({ ...result, run })
  } catch (error) {
    if (error instanceof LicenseUploadError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[licencias a mano]', error)
    return NextResponse.json({ error: 'error interno' }, { status: 500 })
  }
}
