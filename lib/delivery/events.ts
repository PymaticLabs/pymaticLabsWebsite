// Del aviso de Stripe (ya con la firma comprobada) a la cola de pasos.
//
// Cada pago se procesa una sola vez: la compra es unica por su pago (pi_... o in_...) y cada paso
// tiene una clave unica (invoice:<compra>, license:<compra>...). Si Stripe repite el aviso, o
// llegan dos a la vez, no se duplica nada. El aviso se apunta como procesado solo al final: si el
// servidor se cae a mitad, Stripe lo reintenta y se completa lo que faltaba.
//
// Aqui casi no se llama a ningun proveedor (a Stripe, para las devoluciones y el plan de un cobro
// del mensual): el aviso se contesta en segundos y el trabajo lo hace la cola.
//
// Lo que no se entrega solo, sino que va a revisar a mano (con aviso a PymaticLabs):
// - una compra sin razon social, NIF o correo;
// - una compra con el NIF de una empresa que ya es cliente desde un correo que no es de sus
//   titulares: el NIF lo escribe el comprador (Stripe solo mira el formato), y daria las facturas, las
//   licencias y el portal de esa empresa a cualquiera. Tambien se avisa a sus titulares;
// - un cobro del mensual de una empresa sin pago unico vigente, o con otro NIF que el suyo.

import type Stripe from 'stripe'
import { isGuided, isOneTimeProduct, isPlanProduct, productFromLookupKey, seatsFor } from './products.ts'
import { validBases } from './steps.ts'
import { taxTreatment } from './tax.ts'
import { cleanCompanyName, madridDate, normalizeEmail, normalizeTaxId, unixToIso } from './util.ts'
import type { Delivery } from './container.ts'
import type { Address, Company, Locale, NewJob, Purchase } from './types.ts'

export type EventOutcome = string

export { taxTreatment }

export async function handleStripeEvent(d: Delivery, event: Stripe.Event): Promise<{ outcome: EventOutcome }> {
  // El Stripe de mentira aprende de los avisos que "manda" (para la conciliacion en modo falso).
  const observer = d.payments as unknown as { observe?: (e: unknown) => void }
  observer.observe?.(event)

  const { processed } = await d.repo.recordStripeEvent({
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    createdAt: unixToIso(event.created),
  })
  if (processed) return { outcome: 'duplicate' }
  // Un aviso de prueba en la web de verdad (o al reves) no entrega nada.
  if (d.config.stripeLive !== null && event.livemode !== d.config.stripeLive) {
    console.warn(`[entrega] aviso ${event.id} con livemode=${event.livemode} y claves de Stripe ${d.config.stripeLive ? 'en vivo' : 'de prueba'}: no se procesa`)
    await d.repo.markStripeEventProcessed(event.id, 'ignored-livemode')
    return { outcome: 'ignored-livemode' }
  }
  const outcome = await dispatch(d, event)
  await d.repo.markStripeEventProcessed(event.id, outcome)
  return { outcome }
}

async function dispatch(d: Delivery, event: Stripe.Event): Promise<EventOutcome> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      return ingestCheckoutSession(d, event.data.object, { paidAtUnix: event.created })
    case 'checkout.session.expired':
    case 'checkout.session.async_payment_failed':
      return releaseCheckout(d, event.data.object)
    case 'invoice.paid':
      return ingestInvoice(d, event.data.object)
    case 'charge.refunded':
      return onRefund(d, event.data.object)
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.funds_withdrawn':
      return onDisputeOpen(d, event.data.object)
    case 'charge.dispute.closed':
      return onDisputeClosed(d, event.data.object)
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      return onSubscription(d, event.data.object, event.type, event.created)
    default:
      return 'ignored'
  }
}

// --- Pago unico ---------------------------------------------------------------------------------

function address(value: Stripe.Address | null | undefined): Address | null {
  if (!value) return null
  return {
    line1: value.line1 ?? null,
    line2: value.line2 ?? null,
    city: value.city ?? null,
    postal_code: value.postal_code ?? null,
    state: value.state ?? null,
    country: value.country ?? null,
  }
}

function asLocale(value: unknown): Locale {
  return value === 'en' ? 'en' : 'es'
}

function idOf(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

export function oneTimeJobs(purchase: Purchase): NewJob[] {
  const payload = { purchaseId: purchase.id }
  const key = (kind: string) => `${kind}:${purchase.id}`
  const guided = isGuided(purchase.product)
  const jobs: NewJob[] = [
    { key: key('invoice'), kind: 'invoice', payload },
    { key: key('license'), kind: 'license', payload },
    { key: key('account'), kind: 'account', payload },
  ]
  // La reserva no frena la entrega: si Cal.com no responde, a los pocos intentos se da por fallida
  // (la bienvenida dice que se la confirmamos) y PymaticLabs lo sabe por el aviso.
  if (guided) jobs.push({ key: key('booking'), kind: 'booking', payload })
  jobs.push({
    key: key('welcome'),
    kind: 'welcome',
    payload,
    dependsOn: [key('license'), key('account'), ...(guided ? [key('booking')] : [])],
  })
  jobs.push({ key: key('notice'), kind: 'notice', payload: { ...payload, event: 'sale' }, dependsOn: [key('welcome'), key('invoice')] })
  return jobs
}

/** manualLicense (LICENSE_MODE=manual): el correo con la licencia nueva sale al subirla, no aqui. */
export function renewalJobs(purchase: Purchase, manualLicense = false): NewJob[] {
  const payload = { purchaseId: purchase.id }
  const key = (kind: string) => `${kind}:${purchase.id}`
  if (manualLicense) {
    return [
      { key: key('invoice'), kind: 'invoice', payload },
      { key: key('license'), kind: 'license', payload },
      { key: key('notice'), kind: 'notice', payload: { ...payload, event: 'renewal' }, dependsOn: [key('license'), key('invoice')] },
    ]
  }
  return [
    { key: key('invoice'), kind: 'invoice', payload },
    { key: key('license'), kind: 'license', payload },
    { key: key('renewal_email'), kind: 'renewal_email', payload, dependsOn: [key('license')] },
    { key: key('notice'), kind: 'notice', payload: { ...payload, event: 'renewal' }, dependsOn: [key('renewal_email'), key('invoice')] },
  ]
}

export type ReviewReason = 'missing_data' | 'nif_conflict' | 'unknown_company' | 'no_base' | 'tax_id_changed'

function reviewJobs(purchase: Purchase, reason: ReviewReason, companyId: string | null = null): NewJob[] {
  const jobs: NewJob[] = [{ key: `notice:review:${purchase.id}`, kind: 'notice', payload: { purchaseId: purchase.id, event: 'review', reason, companyId } }]
  // Los titulares de la empresa de ese NIF, avisados: alguien ha comprado en su nombre.
  if (reason === 'nif_conflict' && companyId) jobs.push({ key: `company_alert:${purchase.id}`, kind: 'company_alert', payload: { purchaseId: purchase.id, companyId } })
  return jobs
}

/** Si ese correo es (o fue) quien compro para esa empresa: un titular activo, o el correo de la primera compra. */
async function isOwnerEmail(d: Delivery, company: Company, email: string): Promise<boolean> {
  if (company.email === email) return true
  return (await d.repo.listMembers(company.id)).some((m) => m.role === 'owner' && m.email === email)
}

/** Una sesion de Checkout pagada: la compra y sus pasos. La usa tambien la conciliacion. */
export async function ingestCheckoutSession(d: Delivery, session: Stripe.Checkout.Session, options: { paidAtUnix?: number } = {}): Promise<EventOutcome> {
  const meta = session.metadata ?? {}
  if (meta.launch_ref && session.payment_status === 'paid') await d.repo.markLaunchSlot(meta.launch_ref, 'used')

  if (session.mode === 'subscription') {
    // El mensual: la factura llega con invoice.paid. Aqui solo se apunta la suscripcion en la empresa.
    const company = meta.company_id ? await d.repo.getCompany(meta.company_id) : null
    if (company) {
      await d.repo.updateCompany(company.id, {
        stripeCustomerId: company.stripeCustomerId ?? idOf(session.customer),
        subscriptionId: idOf(session.subscription),
        subscriptionPlan: meta.product ?? company.subscriptionPlan,
      })
    }
    return 'subscription-started'
  }
  if (session.mode !== 'payment') return 'ignored'
  if (session.payment_status !== 'paid') {
    // Solo se paga con tarjeta (lib/checkout.ts): un pago pendiente no deberia llegar. Si llega, se
    // avisa; la entrega espera a async_payment_succeeded.
    await d.repo.enqueueJobs(
      [{ key: `notice:awaiting:${session.id}`, kind: 'notice', payload: { event: 'awaiting_payment', sessionId: session.id, product: meta.product ?? '' } }],
      d.clock()
    )
    return 'awaiting-payment'
  }
  const product = meta.product
  if (!isOneTimeProduct(product)) {
    // Un pago que la web no reconoce (un enlace de pago antiguo, una sesion creada a mano): cobrado
    // y sin entregar. Que lo sepa PymaticLabs.
    await d.repo.enqueueJobs(
      [
        {
          key: `notice:unknown-product:${session.id}`,
          kind: 'notice',
          payload: { event: 'unknown_product', sessionId: session.id, paymentIntent: idOf(session.payment_intent) ?? '', product: product ?? '', amount: session.amount_total ?? 0, currency: session.currency ?? 'eur' },
        },
      ],
      d.clock()
    )
    return 'ignored-product'
  }

  const details = session.customer_details
  const country = details?.address?.country ?? null
  const taxIdRaw = details?.tax_ids?.[0]
  // Donde Checkout no pide NIF (Estados Unidos, por ejemplo), llega en el campo propio "nif".
  const customTaxId = session.custom_fields?.find((f) => f.key === 'nif')?.text?.value ?? null
  const taxId = normalizeTaxId(taxIdRaw?.value ?? customTaxId)
  const taxIdType = taxIdRaw?.type ?? (customTaxId ? (country === 'US' ? 'us_ein' : 'otro') : null)
  const name = cleanCompanyName(details?.business_name || session.collected_information?.business_name || details?.name)
  const email = normalizeEmail(details?.email)
  const locale = asLocale(meta.locale ?? (session.locale === 'en' ? 'en' : 'es'))
  // Cuando se pago (el aviso), no cuando se abrio el pago: la fecha de la factura y el anyo de la licencia.
  const paidAt = unixToIso(options.paidAtUnix ?? session.created)
  const net = (session.amount_subtotal ?? 0) - (session.total_details?.amount_discount ?? 0)
  const amountTax = session.total_details?.amount_tax ?? 0
  const tax = taxTreatment({ country, taxIdType, amountTax, net })
  const paymentRef = idOf(session.payment_intent) ?? session.id
  const novedades = session.custom_fields?.find((f) => f.key === 'novedades')?.dropdown?.value

  // Sin razon social, NIF o correo no se puede firmar una licencia que valga: a revisar a mano.
  let review: ReviewReason | null = taxId && name && email ? null : 'missing_data'
  let company: Company | null = null
  let conflictCompanyId: string | null = null
  if (!review) {
    const existing = await d.repo.getCompanyByTaxId(taxId!)
    if (existing && !(await isOwnerEmail(d, existing, email!))) {
      review = 'nif_conflict'
      conflictCompanyId = existing.id
    } else {
      company = await d.repo.upsertCompany({
        name: name!,
        taxId: taxId!,
        taxIdType,
        country,
        address: address(details?.address),
        email: email!,
        locale,
        currency: session.currency ?? 'eur',
        stripeCustomerId: idOf(session.customer),
      })
      // Dos compras a la vez con un NIF nuevo: la que llega segunda encuentra la empresa ya creada por la otra.
      if (!(await isOwnerEmail(d, company, email!))) {
        review = 'nif_conflict'
        conflictCompanyId = company.id
        company = null
      }
    }
  }

  const { purchase } = await d.repo.createPurchase({
    companyId: company?.id ?? null,
    kind: 'one_time',
    product,
    paymentRef,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: idOf(session.payment_intent),
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    stripeCustomerId: idOf(session.customer),
    email: email ?? details?.email ?? 'sin-correo',
    locale,
    currency: session.currency ?? 'eur',
    amountSubtotal: session.amount_subtotal ?? 0,
    amountDiscount: session.total_details?.amount_discount ?? 0,
    amountTax,
    amountTotal: session.amount_total ?? 0,
    taxTreatment: tax.treatment,
    taxRate: tax.rate,
    launch: Boolean(meta.launch_ref) || (session.total_details?.amount_discount ?? 0) > 0,
    seats: Number(meta.seats) || seatsFor(product),
    termsVersion: meta.terms_version ?? null,
    termsSha256: meta.terms_sha256 ?? null,
    termsAcceptedAt: session.consent?.terms_of_service === 'accepted' ? paidAt : null,
    marketingOptIn: novedades === 'si',
    sessionHost: meta.session_host ?? null,
    sessionStart: meta.session_start ?? null,
    calendarReservation: meta.calendar_reservation ?? null,
    supportUntil: null,
    status: review ? 'needs_review' : 'paid',
    livemode: session.livemode === true,
    reviewData: review
      ? { reason: review, companyId: conflictCompanyId, customer_details: details ?? null, taxId, session: session.id }
      : null,
    paidAt,
  })
  // Siempre se encola (sin duplicar): si un intento anterior se corto tras crear la compra, ahora se completa.
  if (purchase.status === 'needs_review') {
    const data = (purchase.reviewData ?? {}) as { reason?: ReviewReason; companyId?: string | null }
    await d.repo.enqueueJobs(reviewJobs(purchase, data.reason ?? 'missing_data', data.companyId ?? null), d.clock())
    return 'needs-review'
  }
  await d.repo.enqueueJobs(oneTimeJobs(purchase), d.clock())
  return 'purchase'
}

async function releaseCheckout(d: Delivery, session: Stripe.Checkout.Session): Promise<EventOutcome> {
  const meta = session.metadata ?? {}
  if (meta.launch_ref) await d.repo.markLaunchSlot(meta.launch_ref, 'released')
  if (meta.calendar_reservation) {
    try {
      await d.calendar.release(meta.calendar_reservation)
    } catch {
      // caduca sola
    }
  }
  return 'released'
}

// --- Mensual -------------------------------------------------------------------------------------

/** Un cobro del mensual: factura y licencia nueva con el soporte_hasta del periodo. */
export async function ingestInvoice(d: Delivery, invoice: Stripe.Invoice): Promise<EventOutcome> {
  // Por el total, no por lo cobrado a la tarjeta: un cobro pagado con el saldo a favor del cliente
  // (tras bajar de plan) tambien es un mes facturado. Los meses incluidos (prueba) son de 0 €.
  if (!(invoice.total > 0)) return 'ignored-zero'
  const subscription = invoice.parent?.subscription_details
  if (!subscription) return 'ignored-not-subscription'
  const meta = subscription.metadata ?? {}
  const customerId = idOf(invoice.customer as string | { id: string } | null)
  const company =
    (meta.company_id ? await d.repo.getCompany(meta.company_id) : null) ??
    (customerId ? await d.repo.getCompanyByStripeCustomer(customerId) : null)

  const line = invoice.lines?.data?.find((l) => l.parent?.type === 'subscription_item_details') ?? invoice.lines?.data?.[0]
  // El plan, por el precio cobrado: tras cambiar de plan en el portal, los metadatos de la suscripcion siguen con el viejo.
  const priceId = line?.pricing?.price_details?.price ?? null
  const fromPrice = priceId ? productFromLookupKey(await d.payments.priceLookupKey(priceId)) : null
  const product = [fromPrice, meta.product, company?.subscriptionPlan].find((p) => isPlanProduct(p)) ?? null
  if (!product) {
    await d.repo.enqueueJobs(
      [{ key: `notice:unknown-product:${invoice.id}`, kind: 'notice', payload: { event: 'unknown_product', invoiceId: invoice.id, price: priceId ?? '', amount: invoice.total, currency: invoice.currency } }],
      d.clock()
    )
    return 'ignored-product'
  }
  const periodEnd = line?.period?.end ?? invoice.period_end
  const amountTax = (invoice.total_taxes ?? []).reduce((sum, t) => sum + t.amount, 0)
  const amountDiscount = (invoice.total_discount_amounts ?? []).reduce((sum, t) => sum + t.amount, 0)
  const net = invoice.total_excluding_tax ?? invoice.total - amountTax
  const taxIds = (invoice.customer_tax_ids ?? []).map((t) => normalizeTaxId(t.value)).filter(Boolean)
  const tax = taxTreatment({ country: invoice.customer_address?.country ?? company?.country ?? null, taxIdType: invoice.customer_tax_ids?.[0]?.type ?? company?.taxIdType ?? null, amountTax, net })
  const paidAt = unixToIso(invoice.status_transitions?.paid_at ?? invoice.created)

  let review: ReviewReason | null = null
  if (!company) review = 'unknown_company'
  // El NIF de la factura de Stripe tiene que ser el de la empresa (la licencia y Holded van con ese).
  else if (taxIds.length && !taxIds.includes(company.taxId)) review = 'tax_id_changed'
  // Sin pago unico vigente (devuelto o con contracargo), el mensual no da licencia.
  else if (company.accessRevokedAt || !(await validBases(d, company.id)).length) review = 'no_base'

  const { purchase } = await d.repo.createPurchase({
    companyId: company?.id ?? null,
    kind: 'renewal',
    product,
    paymentRef: invoice.id,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeInvoiceId: invoice.id,
    stripeSubscriptionId: idOf(subscription.subscription),
    stripeCustomerId: customerId,
    email: company?.email ?? normalizeEmail(invoice.customer_email) ?? 'sin-correo',
    locale: company?.locale ?? 'es',
    currency: invoice.currency,
    amountSubtotal: net + amountDiscount,
    amountDiscount,
    amountTax,
    amountTotal: invoice.total,
    taxTreatment: tax.treatment,
    taxRate: tax.rate,
    launch: false,
    seats: company?.seats ?? 1,
    termsVersion: meta.terms_version ?? null,
    termsSha256: null,
    termsAcceptedAt: null,
    marketingOptIn: false,
    sessionHost: null,
    sessionStart: null,
    calendarReservation: null,
    supportUntil: madridDate(new Date(periodEnd * 1000)),
    status: review ? 'needs_review' : 'paid',
    livemode: invoice.livemode === true,
    reviewData: review ? { reason: review, invoice: invoice.id, customer: customerId, taxIds } : null,
    paidAt,
  })
  if (purchase.status === 'needs_review') {
    const reason = ((purchase.reviewData ?? {}) as { reason?: ReviewReason }).reason ?? 'unknown_company'
    await d.repo.enqueueJobs(reviewJobs(purchase, reason), d.clock())
    return 'needs-review'
  }
  if (company && company.subscriptionPlan !== product) await d.repo.updateCompany(company.id, { subscriptionPlan: product })
  await d.repo.enqueueJobs(renewalJobs(purchase, d.config.licenseMode === 'manual'), d.clock())
  return 'renewal'
}

const ALIVE = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused']

async function onSubscription(d: Delivery, subscription: Stripe.Subscription, type: string, eventCreated: number): Promise<EventOutcome> {
  const customerId = idOf(subscription.customer as string | { id: string })
  const company =
    (subscription.metadata?.company_id ? await d.repo.getCompany(subscription.metadata.company_id) : null) ??
    (customerId ? await d.repo.getCompanyByStripeCustomer(customerId) : null)
  if (!company) return 'subscription-unknown-company'
  // Los avisos llegan desordenados: uno anterior al ultimo aplicado no lo pisa (un updated que llega
  // tras el deleted la daria por viva y no dejaria contratar otra).
  const at = unixToIso(eventCreated)
  const deleted = type === 'customer.subscription.deleted'
  if (company.subscriptionEventAt) {
    // Por el instante, no por el texto: Supabase la devuelve como ...T10:00:00+00:00 y aqui sale ...T10:00:00.000Z.
    const ms = eventCreated * 1000
    const last = Date.parse(company.subscriptionEventAt)
    if (ms < last) return 'subscription-stale'
    if (ms === last && company.subscriptionStatus === 'canceled' && !deleted && company.subscriptionId === subscription.id) return 'subscription-stale'
  }
  // Un aviso de una suscripcion vieja, con otra ya viva, tampoco.
  if (company.subscriptionId && company.subscriptionId !== subscription.id && ALIVE.includes(company.subscriptionStatus ?? '') && type !== 'customer.subscription.created') {
    return 'subscription-stale'
  }
  const fromPrice = productFromLookupKey(subscription.items?.data?.[0]?.price?.lookup_key ?? null)
  await d.repo.updateCompany(company.id, {
    subscriptionId: subscription.id,
    subscriptionStatus: deleted ? 'canceled' : subscription.status,
    subscriptionPlan: fromPrice ?? subscription.metadata?.product ?? company.subscriptionPlan,
    subscriptionEventAt: at,
  })
  if (deleted) {
    await d.repo.enqueueJobs(
      [{ key: `notice:subscription-ended:${subscription.id}`, kind: 'notice', payload: { companyId: company.id, event: 'subscription_ended', subscriptionId: subscription.id } }],
      d.clock()
    )
  }
  return 'subscription-updated'
}

// --- Devoluciones y contracargos ------------------------------------------------------------------

async function purchaseForPaymentIntent(d: Delivery, paymentIntent: string | null): Promise<Purchase | null> {
  if (!paymentIntent) return null
  const direct = await d.repo.getPurchaseByPaymentIntent(paymentIntent)
  if (direct) return direct
  // Un cobro del mensual: la compra va por su factura.
  const invoiceId = await d.payments.invoiceIdForPaymentIntent(paymentIntent)
  return invoiceId ? d.repo.getPurchaseByPaymentRef(invoiceId) : null
}

/**
 * Una devolucion: una rectificativa por cada devolucion de Stripe, con su id y su importe. Dos avisos
 * a la vez (una parcial y enseguida el resto) dan las mismas claves: ni se duplica ni se abona de mas.
 */
async function onRefund(d: Delivery, charge: Stripe.Charge): Promise<EventOutcome> {
  const purchase = await purchaseForPaymentIntent(d, idOf(charge.payment_intent))
  if (!purchase) {
    await d.repo.enqueueJobs(
      [{ key: `notice:refund-unknown:${charge.id}:${charge.amount_refunded}`, kind: 'notice', payload: { event: 'refund_unknown', chargeId: charge.id, amount: charge.amount_refunded } }],
      d.clock()
    )
    return 'refund-unknown'
  }
  const full = charge.refunded === true
  const p = purchase.id
  const refunds = (await d.payments.refundsOf(charge)).filter((r) => r.status !== 'failed' && r.status !== 'canceled').sort((a, b) => (a.id < b.id ? -1 : 1))
  // Devuelta entera, el Acompanado pierde sus sesiones: el aviso espera a saber cuales se cancelaron.
  const cancel = full ? cancelBookingsJob(purchase, `cancel_bookings:${p}:refund`, 'refund') : null
  const jobs: NewJob[] = []
  let credited = 0
  for (const refund of refunds) {
    // Nunca mas de lo cobrado, aunque Stripe dijera otra cosa.
    const amount = Math.min(refund.amount, Math.max(0, purchase.amountTotal - credited))
    credited += refund.amount
    if (!(amount > 0)) continue
    jobs.push({
      key: `rectify:${p}:${refund.id}`,
      kind: 'rectify',
      payload: { purchaseId: p, amount, ref: `credit:${p}:${refund.id}`, reason: 'refund', refundId: refund.id },
      dependsOn: [`invoice:${p}`],
    })
    jobs.push({
      key: `notice:refund:${refund.id}`,
      kind: 'notice',
      payload: { purchaseId: p, event: 'refund', amount, full, refundId: refund.id },
      ...(cancel ? { dependsOn: [cancel.key] } : {}),
    })
  }
  if (full) {
    jobs.push({ key: `revoke:${p}:refund`, kind: 'revoke', payload: { purchaseId: p, reason: 'refund', final: true } })
    jobs.push({ key: `refund_email:${p}`, kind: 'refund_email', payload: { purchaseId: p, amount: charge.amount_refunded }, dependsOn: [`revoke:${p}:refund`] })
    if (cancel) jobs.push(cancel)
  }
  // Primero la cola, despues la compra: si se corta en medio, el reintento de Stripe encola lo que falte.
  await d.repo.enqueueJobs(jobs, d.clock())
  const changed = await d.repo.recordRefund(p, charge.amount_refunded, full)
  if (!changed) return 'refund-already'
  return full ? 'refund' : 'partial-refund'
}

/**
 * Cancelar las sesiones del Acompanado (devolucion entera o contracargo perdido). Espera a la reserva
 * de la primera: si aun estaba en curso, cancela tambien la que deje hecha.
 */
function cancelBookingsJob(purchase: Purchase, key: string, reason: 'refund' | 'dispute'): NewJob | null {
  if (purchase.kind !== 'one_time' || !isGuided(purchase.product)) return null
  return { key, kind: 'cancel_bookings', payload: { purchaseId: purchase.id, reason }, dependsOn: [`booking:${purchase.id}`] }
}

/** Un contracargo de verdad (no una peticion de informacion): el banco ya retiro el dinero. */
const FORMAL_DISPUTE = ['needs_response', 'under_review']

async function onDisputeOpen(d: Delivery, dispute: Stripe.Dispute): Promise<EventOutcome> {
  const purchase = await purchaseForPaymentIntent(d, idOf(dispute.payment_intent))
  if (!purchase) {
    await d.repo.enqueueJobs([{ key: `notice:dispute-unknown:${dispute.id}`, kind: 'notice', payload: { event: 'dispute_unknown', disputeId: dispute.id, amount: dispute.amount } }], d.clock())
    return 'dispute-unknown'
  }
  const p = purchase.id
  if (dispute.status === 'warning_needs_response' || dispute.status === 'warning_under_review') {
    // Una peticion de informacion: el dinero sigue en la cuenta y puede quedarse en nada. Solo aviso
    // para responder; si pasa a contracargo, llega otro aviso (updated) y entonces se anula.
    await d.repo.enqueueJobs(
      [{ key: `notice:inquiry:${dispute.id}`, kind: 'notice', payload: { purchaseId: p, event: 'inquiry', amount: dispute.amount, disputeId: dispute.id } }],
      d.clock()
    )
    return 'inquiry'
  }
  if (!FORMAL_DISPUTE.includes(dispute.status)) return 'dispute-ignored'
  // Clausula 5: un contracargo del pago unico tiene los efectos de la devolucion (mientras dura,
  // licencia anulada y zona cerrada; si se gana, vuelven).
  await d.repo.enqueueJobs(
    [
      { key: `revoke:${p}:dispute:${dispute.id}`, kind: 'revoke', payload: { purchaseId: p, reason: 'dispute', final: false } },
      { key: `notice:dispute:${dispute.id}`, kind: 'notice', payload: { purchaseId: p, event: 'dispute', amount: dispute.amount, disputeId: dispute.id } },
    ],
    d.clock()
  )
  if (purchase.status === 'paid' || purchase.status === 'partially_refunded') await d.repo.updatePurchase(p, { status: 'disputed' })
  return 'dispute'
}

/** Resueltos a favor: ganado, peticion cerrada sin contracargo o evitado. Solo lost es definitivo. */
const DISPUTE_RESTORED = ['won', 'warning_closed', 'prevented']

async function onDisputeClosed(d: Delivery, dispute: Stripe.Dispute): Promise<EventOutcome> {
  const purchase = await purchaseForPaymentIntent(d, idOf(dispute.payment_intent))
  if (!purchase) return 'dispute-unknown'
  const p = purchase.id
  const jobs: NewJob[] = [
    { key: `notice:dispute-closed:${dispute.id}`, kind: 'notice', payload: { purchaseId: p, event: 'dispute_closed', status: dispute.status, disputeId: dispute.id } },
  ]
  if (DISPUTE_RESTORED.includes(dispute.status)) {
    // El dinero se queda (o vuelve): la licencia y la zona tambien, si se habian quitado.
    jobs.push({ key: `reinstate:${p}:${dispute.id}`, kind: 'reinstate', payload: { purchaseId: p, reason: 'dispute' }, dependsOn: [`revoke:${p}:dispute:${dispute.id}`] })
    await d.repo.enqueueJobs(jobs, d.clock())
    if (purchase.status === 'disputed') await d.repo.updatePurchase(p, { status: purchase.amountRefunded > 0 ? 'partially_refunded' : 'paid' })
    return dispute.status === 'won' ? 'dispute-won' : 'dispute-closed'
  }
  if (dispute.status === 'lost') {
    jobs.push(
      {
        key: `rectify:${p}:dispute:${dispute.id}`,
        kind: 'rectify',
        payload: { purchaseId: p, amount: Math.min(dispute.amount, purchase.amountTotal), ref: `credit:${p}:dispute:${dispute.id}`, reason: 'dispute' },
        dependsOn: [`invoice:${p}`],
      },
      // Definitivo: como una devolucion (y sin pago unico vigente, se cancela el mensual).
      { key: `revoke:${p}:dispute-lost:${dispute.id}`, kind: 'revoke', payload: { purchaseId: p, reason: 'dispute', final: true } }
    )
    // Y, como en la devolucion, las sesiones del Acompanado que aun no han llegado (antes del aviso).
    const cancel = cancelBookingsJob(purchase, `cancel_bookings:${p}:dispute-lost:${dispute.id}`, 'dispute')
    if (cancel) {
      jobs.push(cancel)
      jobs[0].dependsOn = [cancel.key]
    }
    await d.repo.enqueueJobs(jobs, d.clock())
    await d.repo.updatePurchase(p, { status: 'dispute_lost' })
    return 'dispute-lost'
  }
  await d.repo.enqueueJobs(jobs, d.clock())
  return 'dispute-closed'
}
