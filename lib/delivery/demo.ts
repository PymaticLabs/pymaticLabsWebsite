// La zona de clientes de muestra, solo en modo falso (DELIVERY_MODE=fake): para verla y sacar
// capturas sin Supabase ni ninguna cuenta. No se inventan filas a mano: se compra por el camino de
// verdad (aviso de Stripe de mentira -> cola -> factura, licencia, cuenta, sesion y bienvenida), se
// publica una version y se da de alta al equipo, todo con las piezas falsas.
//
// - titular: Carpinteria Munoz, S.L., Acompanado con equipo a precio de lanzamiento; la primera
//   sesion reservada con Eric, la segunda por reservar; el mensual Pro contratado, que empieza a
//   cobrarse al acabar los 3 meses incluidos; dos personas en el equipo y la factura emitida.
// - miembro: una persona de ese equipo (ve la licencia, las descargas y las sesiones).
// - solo: Estudio Ruiz, Hazlo tu para una persona, sin mensual.

import { firstSessionSlots } from '../checkout.ts'
import { LEGAL_VERSIONS } from '../legal-versions.ts'
import { devToolsEnabled } from './config.ts'
import { fakeCheckoutSession, fakeEvent } from './fake-stripe.ts'
import { handleStripeEvent } from './events.ts'
import { runJobs } from './jobs.ts'
import { priceCents } from './products.ts'
import { storeInvoicePdf } from './steps.ts'
import { publishVersion } from './versions.ts'
import { addTeamMember } from './zone.ts'
import { sha256Hex } from './util.ts'
import type { Delivery } from './container.ts'
import type { OneTimeProductId } from './products.ts'

export const DEMO_PEOPLE = {
  titular: 'marta@carpinteria-munoz.test',
  miembro: 'luis@carpinteria-munoz.test',
  solo: 'pablo@estudio-ruiz.test',
} as const
export type DemoPerson = keyof typeof DEMO_PEOPLE

export const DEMO_VERSION = '1.4.0'

const DAY = 86400_000

async function buy(d: Delivery, input: { product: OneTimeProductId; company: string; taxId: string; email: string; daysAgo: number; launch: boolean; metadata?: Record<string, string> }) {
  const prices = priceCents(input.product)
  const session = fakeCheckoutSession({
    product: input.product,
    buyer: { company: input.company, taxId: input.taxId, email: input.email },
    amountSubtotal: prices.list,
    amountDiscount: input.launch && prices.launch ? prices.list - prices.launch : 0,
    created: Math.floor((d.clock().getTime() - input.daysAgo * DAY) / 1000),
    metadata: { locale: 'es', terms_version: LEGAL_VERSIONS.condiciones, ...input.metadata },
    marketing: 'si',
  })
  await handleStripeEvent(d, fakeEvent('checkout.session.completed', session))
  await runJobs(d, { budgetMs: 10_000 })
  const purchase = await d.repo.getPurchaseByCheckoutSession(String(session.id))
  if (!purchase?.companyId) throw new Error(`demo: la compra de ${input.company} no se entrego`)
  return purchase
}

/** Las facturas en borrador, emitidas "a mano" en el Holded falso y guardadas para la zona (como la conciliacion). */
async function emitDrafts(d: Delivery, companyId: string) {
  for (const invoice of await d.repo.listInvoicesByCompany(companyId)) {
    if (invoice.status !== 'draft' || !invoice.providerId) continue
    const doc = await d.invoicer.approveDocument(invoice.kind, invoice.providerId)
    const updated = await d.repo.updateInvoice(invoice.id, { status: 'approved', number: doc.number, approvedAt: d.clock().toISOString() })
    await storeInvoicePdf(d, updated, invoice.kind)
  }
}

const seeding = new WeakMap<Delivery, Promise<void>>()

/** Monta la muestra una sola vez por proceso (si ya esta, o se esta montando, espera a esa). */
export function seedZoneDemo(d: Delivery): Promise<void> {
  if (!devToolsEnabled(d.config)) return Promise.reject(new Error('la zona de muestra solo existe con todo en falso'))
  let running = seeding.get(d)
  if (!running) {
    running = seed(d)
    seeding.set(d, running)
    running.catch(() => seeding.delete(d))
  }
  return running
}

async function seed(d: Delivery): Promise<void> {
  if ((await d.repo.listMembershipsByEmail(DEMO_PEOPLE.titular)).length) return

  // Titular: Acompanado con equipo, con la primera sesion elegida antes de pagar.
  const { slots } = await firstSessionSlots(d)
  const slot = slots.find((s) => s.host === 'eric') ?? slots[0]
  const owner = await buy(d, {
    product: 'acompanado-equipo',
    company: 'Carpintería Muñoz, S.L.',
    taxId: 'B12345678',
    email: DEMO_PEOPLE.titular,
    daysAgo: 6,
    launch: true,
    metadata: slot ? { session_host: slot.host, session_start: slot.start } : {},
  })
  const companyId = owner.companyId!
  await emitDrafts(d, companyId)
  // El mensual Pro, contratado desde la zona: en prueba hasta que acaben los meses incluidos.
  const company = await d.repo.getCompany(companyId)
  await handleStripeEvent(
    d,
    fakeEvent('customer.subscription.created', {
      id: 'sub_demo_munoz',
      object: 'subscription',
      customer: company?.stripeCustomerId,
      status: 'trialing',
      metadata: { product: 'plan-pro', company_id: companyId },
    })
  )

  // La version publicada, con sus ficheros en el almacen falso.
  if (!(await d.repo.getLatestVersion())) {
    const v = DEMO_VERSION
    const files = [
      { kind: 'mac' as const, lang: 'es' as const, fileName: `cerebro-digital-${v}-mac-es.mcpb`, sizeBytes: 18_420_000 },
      { kind: 'mac' as const, lang: 'en' as const, fileName: `digital-brain-${v}-mac-en.mcpb`, sizeBytes: 18_390_000 },
      { kind: 'windows' as const, lang: 'es' as const, fileName: `cerebro-digital-${v}-windows-es.mcpb`, sizeBytes: 19_050_000 },
      { kind: 'windows' as const, lang: 'en' as const, fileName: `digital-brain-${v}-windows-en.mcpb`, sizeBytes: 19_020_000 },
      { kind: 'registry' as const, lang: null, fileName: `cerebro-registro-${v}-windows.zip`, sizeBytes: 2_310_000 },
      { kind: 'sbom' as const, lang: null, fileName: `cerebro-digital-${v}.sbom.json`, sizeBytes: 86_000 },
    ]
    for (const file of files) {
      await d.storage.put('releases', `versiones/${v}/${file.fileName}`, Buffer.from(`Fichero de muestra: ${file.fileName}\n`), 'application/octet-stream')
    }
    await publishVersion(d, {
      version: v,
      notesEs: 'Correcciones de seguridad y un arranque más rápido en Windows.\nLo nuevo de esta versión se activa si tu mantenimiento y soporte cubre su fecha.',
      notesEn: 'Security fixes and a faster start on Windows.\nWhat is new in this version switches on if your maintenance and support covers its date.',
      announce: false,
      files: files.map((f) => ({ ...f, storagePath: `versiones/${v}/${f.fileName}`, sha256: sha256Hex(`Fichero de muestra: ${f.fileName}\n`) })),
    })
  }

  // El equipo: dos personas dadas de alta por la titular.
  const ownerMember = (await d.repo.listMembers(companyId)).find((m) => m.role === 'owner')
  if (ownerMember?.userId) {
    const user = { id: ownerMember.userId, email: ownerMember.email }
    await addTeamMember(d, user, companyId, DEMO_PEOPLE.miembro)
    await addTeamMember(d, user, companyId, 'ana@carpinteria-munoz.test')
  }

  // Solo: Hazlo tu para una persona, sin meses del mensual.
  const solo = await buy(d, { product: 'hazlo-tu', company: 'Estudio Ruiz Arquitectura, S.L.P.', taxId: 'B87654321', email: DEMO_PEOPLE.solo, daysAgo: 30, launch: false })
  await emitDrafts(d, solo.companyId!)
  await runJobs(d, { budgetMs: 10_000 })
}
