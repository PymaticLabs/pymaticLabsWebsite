// Para la prueba de punta a punta con las cuentas de prueba (docs/entrega-automatica.md, seccion 5):
// como va la entrega de una compra en la base de datos de verdad (Supabase), paso a paso, y si su
// licencia verifica con la publica de la web. Solo lee: no cambia nada.
//
//   node --env-file=.env.local scripts/comprobar-compra.mts <correo de la compra | pi_... | in_... | cs_...>
//
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY, y LICENSE_WEB_PUBLIC_KEY (o GCP_KMS_KEY_VERSION
// con GOOGLE_SERVICE_ACCOUNT_JSON, para leer la publica de KMS). Sale con error si algun paso esta
// parado o si una licencia no verifica.

import { createDelivery } from '../lib/delivery/container.ts'
import { verifyLicense } from '../lib/license.ts'
import type { Purchase } from '../lib/delivery/types.ts'

const target = process.argv[2]?.trim()
if (!target) throw new Error('uso: scripts/comprobar-compra.mts <correo | pi_... | in_... | cs_...>')

const d = createDelivery({ ...process.env, DELIVERY_REPOSITORY: 'supabase' })
let failed = false
const line = (ok: boolean | null, text: string) => console.log(`  ${ok === null ? '·' : ok ? 'ok' : 'XX'}  ${text}`)

async function purchases(): Promise<Purchase[]> {
  if (/^(pi|in)_/.test(target)) return [await d.repo.getPurchaseByPaymentRef(target)].filter((p): p is Purchase => Boolean(p))
  if (target.startsWith('cs_')) return [await d.repo.getPurchaseByCheckoutSession(target)].filter((p): p is Purchase => Boolean(p))
  const found: Purchase[] = []
  for (const member of await d.repo.listMembershipsByEmail(target.toLowerCase())) {
    found.push(...(await d.repo.listPurchasesByCompany(member.companyId)))
  }
  return found
}

async function publicKey(): Promise<string | null> {
  if (process.env.LICENSE_WEB_PUBLIC_KEY) return process.env.LICENSE_WEB_PUBLIC_KEY.trim()
  try {
    return await d.signer.publicKey()
  } catch (error) {
    console.warn(`  (sin la publica de la web: ${error instanceof Error ? error.message : error})`)
    return null
  }
}

const list = await purchases()
if (!list.length) {
  console.log(`No hay ninguna compra de ${target}. ¿Llego el aviso de Stripe? Mira Developers > Webhooks en Stripe y la tabla stripe_events.`)
  process.exit(1)
}
const pub = await publicKey()

for (const purchase of list.sort((a, b) => a.paidAt.localeCompare(b.paidAt))) {
  console.log(`\n${purchase.product} · ${purchase.paymentRef} · ${purchase.status} · ${(purchase.amountTotal / 100).toFixed(2)} ${purchase.currency.toUpperCase()} (IVA: ${purchase.taxTreatment}${purchase.taxRate !== null ? ` ${purchase.taxRate} %` : ''})`)
  const kinds = purchase.kind === 'renewal' ? ['invoice', 'license', 'renewal_email', 'notice'] : ['invoice', 'license', 'account', ...(purchase.sessionHost ? ['booking'] : []), 'welcome', 'notice']
  for (const kind of kinds) {
    const job = await d.repo.getJobByKey(`${kind}:${purchase.id}`)
    if (!job) {
      line(false, `${kind}: no esta en la cola`)
      failed = true
      continue
    }
    const ok = job.status === 'done' ? true : job.status === 'dead' ? false : null
    if (ok === false) failed = true
    line(ok, `${kind}: ${job.status}${job.attempts > 1 ? ` (${job.attempts} intentos)` : ''}${job.lastError && job.status !== 'done' ? ` · ${job.lastError}` : ''}`)
  }

  const license = await d.repo.getLicenseByPurchase(purchase.id)
  if (license) {
    let verified: boolean | null = null
    if (pub) {
      try {
        verifyLicense(license.content, pub, { allowPayment: true })
        verified = true
      } catch {
        verified = false
        failed = true
      }
    }
    line(verified, `licencia ${license.id}: ${license.modalidad}${license.equipo ? ' con equipo' : ''}, soporte hasta ${license.soporteHasta}${license.revokedAt ? `, ANULADA (${license.revokedReason})` : ''}${verified === false ? ' · NO VERIFICA con la publica de la web' : ''}`)
  }
  const invoice = await d.repo.getInvoiceByRef(`invoice:${purchase.id}`)
  if (invoice) line(null, `factura: ${invoice.status}${invoice.number ? ` ${invoice.number}` : ''}${invoice.storagePath ? ', PDF en la zona' : ''}`)
  if (purchase.companyId) {
    const members = await d.repo.listMembers(purchase.companyId)
    line(null, `zona: ${members.map((m) => `${m.email} (${m.role})`).join(', ') || 'nadie'}`)
    for (const booking of (await d.repo.listBookingsByCompany(purchase.companyId)).filter((b) => b.purchaseId === purchase.id)) {
      line(booking.status === 'booked', `sesion ${booking.number}: ${booking.status} con ${booking.host}, ${booking.startAt}`)
    }
  }
}

process.exitCode = failed ? 1 : 0
