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
// Lo que no se entrega solo, sino que va a revisar a mano (con aviso a PymaticLabs), antes de crear
// la empresa, la licencia, la factura o la bienvenida:
// - una compra sin razon social, NIF o correo (missing_data);
// - una compra cuyo IVA no cuadra (checkPaidTax de lib/delivery/tax.ts; se vende a todo el mundo,
//   solo a empresas y profesionales, con el IVA que la web decide antes de pagar y deja en los
//   metadatos): lo declarado no vale (un NIF espanol mal escrito, un NIF-IVA sin su consulta de VIES
//   de justo antes de pagar, el IVA que no toca a ese pais) o la direccion de facturacion de Stripe
//   no es la declarada (country_mismatch: otro pais o, en Espana, otro territorio por el codigo
//   postal); o el IVA cobrado no es el esperado (vat_mismatch: el 21 % de la base tras el cupon, o
//   nada); o, en una venta sin IVA fuera de la UE, la tarjeta es de Espana o de otro pais de la UE
//   (card_country: la segunda prueba del pais, que se pregunta a Stripe). Ni licencia, ni factura,
//   ni zona. La pagina y la tarjeta no se bloquean por pais (Reglamento (UE) 2018/302);
// - una compra con el NIF de una empresa que ya es cliente desde un correo que no es de sus
//   titulares (aunque ademas no cuadre el IVA: va primero). El NIF lo escribe el comprador, y daria
//   las facturas, las licencias y el portal de esa empresa a cualquiera. Tambien se avisa a sus
//   titulares;
// - un cobro del mensual de una empresa sin pago unico vigente, con otro NIF que el suyo, con la
//   direccion de facturacion cambiada a otro pais u otro territorio, o sin el IVA que le toca.
// Los pagos de antes (sin tax_country en los metadatos) se miran como entonces: Espana peninsular
// o Baleares, NIF espanol y el 21 %.

import type Stripe from 'stripe'
import { parseSpanishTaxId } from './checkout-nif.ts'
import { isEuCountry } from './checkout-tax.ts'
import { releaseCheckoutHolds } from './launch.ts'
import { isGuided, isOneTimeProduct, isPlanProduct, productFromLookupKey, seatsFor } from './products.ts'
import { REVIEW_TODO, validBases, type ViesEvidence } from './steps.ts'
import { checkPaidTax, declaredTax, sameVatCountry, type DeclaredTax } from './tax.ts'
import { companyDeclaration, legacyDeclaration, viesProblems } from './tax-check.ts'
import { UNPAID_NOTICE_DAYS, addDays, cleanCompanyName, madridDate, normalizeEmail, normalizeTaxId, unixToIso } from './util.ts'
import type { Delivery } from './container.ts'
import { RetryableError, type Address, type Company, type Locale, type NewJob, type Purchase } from './types.ts'

export type EventOutcome = string

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
    case 'invoice.payment_failed':
      return onPaymentFailed(d, event.data.object, event.created)
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

/** El NIF como lo guarda la empresa: el espanol sin el prefijo ES; los demas, limpios. */
function canonicalTaxId(value: string | null | undefined): string | null {
  return parseSpanishTaxId(value)?.taxId ?? normalizeTaxId(value)
}

/**
 * Los pasos del pago unico. vies: la consulta de VIES de antes de pagar (inversion del sujeto pasivo),
 * con el nombre y la direccion que dio VIES si los dio, que van a la factura. Sin ella, la factura
 * queda en borrador.
 */
export function oneTimeJobs(purchase: Purchase, vies: ViesEvidence | null = null): NewJob[] {
  const payload = { purchaseId: purchase.id }
  const key = (kind: string) => `${kind}:${purchase.id}`
  const guided = isGuided(purchase.product)
  const jobs: NewJob[] = [
    { key: key('invoice'), kind: 'invoice', payload: vies ? { ...payload, vies } : payload },
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

/**
 * Los pasos de una compra a revisar que se entrega a mano (POST /api/admin/jobs deliver), ya con su
 * empresa y status paid. Con inversion del sujeto pasivo, la consulta de VIES de antes del pago
 * (review_data.declared) va a su factura si es del NIF-IVA de la empresa y de justo antes del pago:
 * asi no queda retenida por no tenerla. Si no, en borrador, para mirar VIES otra vez a mano. Con
 * esa consulta, la empresa queda como eu_vat, como al pagar (refreshCompanyTax): una que compro antes
 * sin NIF-IVA (other, con el 21 %) y ahora con el, desde otro correo (nif_conflict), seguia con el
 * 21 % en su mensual.
 */
export async function deliverJobs(d: Delivery, purchase: Purchase): Promise<NewJob[]> {
  if (purchase.kind !== 'one_time') return renewalJobs(purchase, d.config.licenseMode === 'manual')
  const vies = await reviewedVies(d, purchase)
  if (vies && purchase.companyId) {
    const company = await d.repo.getCompany(purchase.companyId)
    if (company && company.taxIdType !== 'eu_vat') await d.repo.updateCompany(company.id, { taxIdType: 'eu_vat' })
  }
  return oneTimeJobs(purchase, vies)
}

async function reviewedVies(d: Delivery, purchase: Purchase): Promise<ViesEvidence | null> {
  if (purchase.taxTreatment !== 'reverse_charge' || !purchase.companyId) return null
  const data = (purchase.reviewData ?? {}) as { taxId?: unknown; declared?: Record<string, unknown> | null }
  const declared = data.declared ?? {}
  const text = (value: unknown) => (typeof value === 'string' && value ? value : null)
  const request = text(declared.vies)
  const checkedAt = text(declared.viesCheckedAt)
  if (!request || !checkedAt) return null
  const company = await d.repo.getCompany(purchase.companyId)
  if (!company || text(data.taxId) !== company.taxId) return null
  // Una consulta vieja (la compra pudo quedar a revisar por eso) no vale para esta factura.
  const decl: DeclaredTax = { country: company.country ?? '', territory: null, taxId: company.taxId, taxIdType: 'eu_vat', treatment: 'reverse_charge', viesRequest: request, viesCheckedAt: checkedAt, legacy: false }
  if (viesProblems(decl, purchase.paidAt).length) return null
  const name = text(declared.viesName)
  const address = text(declared.viesAddress)
  return { request, checkedAt, ...(name ? { name } : {}), ...(address ? { address } : {}) }
}

/**
 * Por que una compra queda a revisar. outside_spain y vat_not_21 son de cuando solo se vendia en
 * Espana (las de antes en la base de datos): hoy, country_mismatch y vat_mismatch.
 */
export type ReviewReason =
  | 'missing_data'
  | 'country_mismatch'
  | 'vat_mismatch'
  | 'card_country'
  | 'nif_conflict'
  | 'unknown_company'
  | 'no_base'
  | 'tax_id_changed'
  | 'outside_spain'
  | 'vat_not_21'

/** Los motivos del IVA: con el NIF de otro cliente, nif_conflict va antes (sus problemas quedan en review_data). */
const TAX_REASONS: ReviewReason[] = ['country_mismatch', 'vat_mismatch', 'card_country']

/** El primer motivo del IVA que falla: lo declarado o la direccion de facturacion, lo cobrado y la tarjeta. */
function taxReason(country: string[], vat: string[], card: string[] = []): ReviewReason | null {
  return country.length ? 'country_mismatch' : vat.length ? 'vat_mismatch' : card.length ? 'card_country' : null
}

/**
 * La segunda prueba del pais en una venta sin IVA espanol fuera de la UE (lo declarado y la
 * direccion de facturacion los escribe el cliente): el pais de la tarjeta del cargo, que se pregunta
 * a Stripe. Una de Espana o de otro pais de la UE, a revisar (card_country). Nunca se rechaza la
 * tarjeta por su pais (Reglamento (UE) 2018/302); sin cargo, sin tarjeta o sin saberlo, no se frena
 * nada. Con Stripe sin contestar, el aviso se reintenta (como las devoluciones).
 */
async function cardProblems(d: Delivery, decl: DeclaredTax, paymentIntent: string | null): Promise<string[]> {
  if (decl.treatment !== 'export' || isEuCountry(decl.country) || !paymentIntent || !d.payments.cardCountry) return []
  let card: string | null
  try {
    card = await d.payments.cardCountry(paymentIntent)
  } catch (error) {
    if (error instanceof RetryableError) throw error
    console.warn(`[entrega] sin el pais de la tarjeta de ${paymentIntent}: ${error instanceof Error ? error.message : error}`)
    return []
  }
  if (!card || !isEuCountry(card)) return []
  return [`tarjeta emitida en ${card} y venta sin IVA a ${decl.country}, fuera de la UE: la empresa puede ser de ${card === 'ES' ? 'España' : 'la UE'}`]
}

/** Lo que hay que hacer, tambien en los datos de la compra (review_data.todo). */
function todoFor(reason: ReviewReason, kind: Purchase['kind']): string | undefined {
  return (kind === 'renewal' ? REVIEW_TODO[`${reason}_renewal`] : undefined) ?? REVIEW_TODO[reason]
}

/**
 * Lo declarado, para los datos de una compra a revisar: con la consulta de VIES entera (numero,
 * fecha y, si los dio, nombre y direccion), para entregarla a mano con ella (deliverJobs).
 */
function declaredData(decl: DeclaredTax) {
  const vies = decl.viesRequest
    ? { vies: decl.viesRequest, viesCheckedAt: decl.viesCheckedAt, ...(decl.viesName ? { viesName: decl.viesName } : {}), ...(decl.viesAddress ? { viesAddress: decl.viesAddress } : {}) }
    : {}
  return { country: decl.country, territory: decl.territory, taxIdType: decl.taxIdType, treatment: decl.treatment, ...vies, legacy: decl.legacy }
}

/** La direccion de facturacion como la lee checkPaidTax. */
function billingOf(value: Address | null) {
  return { country: value?.country ?? null, postalCode: value?.postal_code ?? null, state: value?.state ?? null, city: value?.city ?? null }
}

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

function sameAddress(a: Address | null, b: Address | null): boolean {
  const keys = ['line1', 'line2', 'city', 'postal_code', 'state', 'country'] as const
  return keys.every((k) => (a?.[k] ?? null) === (b?.[k] ?? null))
}

/**
 * Una empresa que ya era cliente: lo fiscal de esta compra (lo declarado, comprobado al pagar con la
 * direccion de facturacion de Stripe y, con NIF-IVA, con VIES) manda sobre lo de la primera; el
 * nombre no cambia. Asi el mensual (companyTax) y las facturas (decideTax) llevan el IVA de hoy: un
 * NIF-IVA validado en esta compra (antes sin el, con el 21 %) o la mudanza a Canarias. Un aviso
 * viejo que llega tarde no pisa lo de una compra posterior.
 */
async function refreshCompanyTax(d: Delivery, company: Company, purchase: Purchase, decl: DeclaredTax, billing: Address | null) {
  const fresh = { taxIdType: decl.taxIdType, country: billing?.country ?? decl.country, address: billing ?? company.address }
  if (company.taxIdType === fresh.taxIdType && company.country === fresh.country && sameAddress(company.address, fresh.address)) return
  // Por el instante, no por el texto (Supabase da ...+00:00 y aqui sale ...Z).
  const paid = Date.parse(purchase.paidAt)
  const later = (await d.repo.listPurchasesByCompany(company.id)).some((p) => p.kind === 'one_time' && p.id !== purchase.id && Date.parse(p.paidAt) > paid)
  if (!later) await d.repo.updateCompany(company.id, fresh)
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
  const billing = address(details?.address)
  // Lo declarado antes de pagar (tax_country, tax_id...: lo escribe /api/checkout, comprobado alli).
  // En un pago de antes, el NIF de sus metadatos, el de Stripe (tax_id_collection) o el del campo
  // propio "nif", como Espana peninsular con el 21 %.
  const taxIdRaw = details?.tax_ids?.[0]
  const customTaxId = session.custom_fields?.find((f) => f.key === 'nif')?.text?.value ?? null
  const written = meta.tax_id || taxIdRaw?.value || customTaxId || null
  const decl = declaredTax(meta.tax_country ? meta : { ...meta, tax_id: written ?? undefined }) ?? legacyDeclaration(written, taxIdRaw?.type ?? null)
  const taxId = decl.taxId || null
  const name = cleanCompanyName(details?.business_name || session.collected_information?.business_name || details?.name)
  const email = normalizeEmail(details?.email)
  const locale = asLocale(meta.locale ?? (session.locale === 'en' ? 'en' : 'es'))
  // Cuando se pago (el aviso), no cuando se abrio el pago: la fecha de la factura y el anyo de la licencia.
  const paidAt = unixToIso(options.paidAtUnix ?? session.created)
  const net = (session.amount_subtotal ?? 0) - (session.total_details?.amount_discount ?? 0)
  const amountTax = session.total_details?.amount_tax ?? 0
  // Otra vez aqui, con lo que dice el aviso y no con lo que se pidio: lo declarado (la identificacion
  // para su tipo, el IVA de ese pais y la consulta de VIES), la direccion de facturacion de Stripe
  // frente a lo declarado y el IVA cobrado.
  const tax = checkPaidTax({ declared: decl, billing: billingOf(billing), currency: session.currency, amountTax, net })
  const paymentRef = idOf(session.payment_intent) ?? session.id
  const novedades = session.custom_fields?.find((f) => f.key === 'novedades')?.dropdown?.value

  // Sin razon social, NIF o correo no se puede firmar una licencia que valga: a revisar a mano.
  let review: ReviewReason | null = taxId && name && email ? null : 'missing_data'
  // Si el IVA no cuadra, a revisar, antes de crear la empresa o encolar nada.
  const countryProblems = review ? [] : [...tax.countryProblems, ...viesProblems(decl, paidAt)]
  const vatProblems = review ? [] : tax.vatProblems
  const cardIssues = review ? [] : await cardProblems(d, decl, idOf(session.payment_intent))
  review = review ?? taxReason(countryProblems, vatProblems, cardIssues)
  const problems = [...countryProblems, ...vatProblems, ...cardIssues]
  // Lo que pide hacer cada problema, tambien si el motivo pasa a nif_conflict.
  const taxTodo = review ? todoFor(review, 'one_time') : undefined
  let company: Company | null = null
  let conflictCompanyId: string | null = null
  // El NIF de una empresa cliente desde otro correo va antes que el IVA: con la direccion en otro
  // sitio (un codigo postal de Canarias basta), la unica fila con ese NIF es la suya y entregarla le
  // daria su zona a quien compro. Sus titulares, avisados igual; los problemas, en review_data.problems.
  if (review && TAX_REASONS.includes(review) && taxId && email) {
    const existing = await d.repo.getCompanyByTaxId(taxId)
    if (existing && !(await isOwnerEmail(d, existing, email))) {
      review = 'nif_conflict'
      conflictCompanyId = existing.id
    }
  }
  if (!review) {
    const existing = await d.repo.getCompanyByTaxId(taxId!)
    if (existing && !(await isOwnerEmail(d, existing, email!))) {
      review = 'nif_conflict'
      conflictCompanyId = existing.id
    } else {
      company = await d.repo.upsertCompany({
        name: name!,
        taxId: taxId!,
        taxIdType: decl.taxIdType,
        country: billing?.country ?? decl.country,
        address: billing,
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
      ? {
          reason: review,
          ...(problems.length ? { problems, todo: taxTodo } : {}),
          companyId: conflictCompanyId,
          customer_details: details ?? null,
          taxId,
          declared: declaredData(decl),
          session: session.id,
        }
      : null,
    paidAt,
  })
  // Siempre se encola (sin duplicar): si un intento anterior se corto tras crear la compra, ahora se completa.
  if (purchase.status === 'needs_review') {
    const data = (purchase.reviewData ?? {}) as { reason?: ReviewReason; companyId?: string | null }
    await d.repo.enqueueJobs(reviewJobs(purchase, data.reason ?? 'missing_data', data.companyId ?? null), d.clock())
    return 'needs-review'
  }
  if (company) await refreshCompanyTax(d, company, purchase, decl, billing)
  const vies =
    purchase.taxTreatment === 'reverse_charge' && decl.viesRequest && decl.viesCheckedAt
      ? { request: decl.viesRequest, checkedAt: decl.viesCheckedAt, ...(decl.viesName ? { name: decl.viesName } : {}), ...(decl.viesAddress ? { address: decl.viesAddress } : {}) }
      : null
  await d.repo.enqueueJobs(oneTimeJobs(purchase, vies), d.clock())
  return 'purchase'
}

async function releaseCheckout(d: Delivery, session: Stripe.Checkout.Session): Promise<EventOutcome> {
  await releaseCheckoutHolds(d, session.metadata ?? {})
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

  // La linea del periodo que se paga: la que llega mas lejos. Al pasar en el portal de pago mensual a
  // anual, la factura lleva tambien el abono del mes sin usar, con el precio viejo y su fin de mes.
  const items = (invoice.lines?.data ?? []).filter((l) => l.parent?.type === 'subscription_item_details')
  const line = items.sort((a, b) => (b.period?.end ?? 0) - (a.period?.end ?? 0) || b.amount - a.amount)[0] ?? invoice.lines?.data?.[0]
  // El plan, por el precio cobrado (al mes o al ano, cerebro-plan-<plan>[-anual]): tras cambiar de plan
  // en el portal, los metadatos de la suscripcion siguen con el viejo. El soporte_hasta, el fin de ese periodo.
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
  const taxIds = (invoice.customer_tax_ids ?? []).map((t) => canonicalTaxId(t.value)).filter(Boolean)
  const paidAt = unixToIso(invoice.status_transitions?.paid_at ?? invoice.created)

  // Lo declarado al contratar (los metadatos de la suscripcion, con el contrato comun) o, en una de
  // antes, lo de la empresa: el IVA que le toca a cada cobro. checkPaidTax pide la consulta de VIES de
  // antes de pagar; en un cobro del mensual la hace su factura (el paso invoice), asi que aqui no.
  const declared = meta.tax_country ? declaredTax(meta) : company ? companyDeclaration(company) : null
  const decl = declared && declared.taxIdType === 'eu_vat' && !declared.viesRequest ? { ...declared, viesRequest: 'cada cobro, en su factura' } : declared
  // Sin direccion en la factura, la de la empresa: la direccion se cambia en el pago del mensual y en el portal.
  const billing = address(invoice.customer_address) ?? company?.address ?? null
  const tax = decl ? checkPaidTax({ declared: decl, billing: billingOf(billing), currency: invoice.currency, amountTax, net }) : null

  let review: ReviewReason | null = null
  let problems: string[] = []
  if (!company || !decl || !tax) review = 'unknown_company'
  // El NIF de la factura de Stripe tiene que ser el de la empresa (la licencia y Holded van con ese).
  else if ((taxIds.length && !taxIds.includes(company.taxId)) || (decl.taxId && decl.taxId !== company.taxId) || (meta.tax_id && canonicalTaxId(meta.tax_id) !== company.taxId)) {
    review = 'tax_id_changed'
  }
  // Sin pago unico vigente (devuelto o con contracargo), el mensual no da licencia.
  else if (company.accessRevokedAt || !(await validBases(d, company.id)).length) review = 'no_base'
  else {
    // Lo mismo que en el pago unico, en cada cobro.
    const moved = company.country && !sameVatCountry(decl.country, company.country, decl)
    const countryProblems = [...tax.countryProblems, ...(moved ? [`la suscripción dice ${decl.country} y la empresa es de ${company.country}`] : [])]
    review = taxReason(countryProblems, tax.vatProblems)
    problems = [...countryProblems, ...tax.vatProblems]
  }
  const todo = review && problems.length ? todoFor(review, 'renewal') : null

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
    taxTreatment: tax?.treatment ?? 'standard',
    taxRate: tax?.rate ?? null,
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
    reviewData: review
      ? {
          reason: review,
          ...(problems.length ? { problems, todo } : {}),
          invoice: invoice.id,
          customer: customerId,
          taxIds,
          ...(declared ? { declared: declaredData(declared) } : {}),
          ...(review === 'country_mismatch' ? { address: billing } : {}),
        }
      : null,
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

// Clausula 4: el mensual impagado se suspende tras avisar con UNPAID_NOTICE_DAYS dias (lib/delivery/util.ts).
// Mientras, siguen llegando las versiones nuevas: cada licencia con mantenimiento cubre su periodo y
// esos dias mas (el paso license).
export { UNPAID_NOTICE_DAYS }

/**
 * Un cobro del mensual que no se pudo hacer (tarjeta rechazada, o que pide confirmarlo): el aviso de
 * la clausula 4 a los titulares, una vez por factura (al primer fallo), con el dia en que se suspende
 * si sigue sin pagarse y el enlace de Stripe para pagarla. Stripe sigue reintentando y, al acabar (no
 * antes de esos 15 dias: docs/entrega-automatica.md, 3.4), deja la suscripcion impagada.
 */
async function onPaymentFailed(d: Delivery, invoice: Stripe.Invoice, eventCreated: number): Promise<EventOutcome> {
  if (!(invoice.total > 0)) return 'ignored-zero'
  const subscription = invoice.parent?.subscription_details
  if (!subscription) return 'ignored-not-subscription'
  const meta = subscription.metadata ?? {}
  const customerId = idOf(invoice.customer as string | { id: string } | null)
  const company =
    (meta.company_id ? await d.repo.getCompany(meta.company_id) : null) ??
    (customerId ? await d.repo.getCompanyByStripeCustomer(customerId) : null)
  if (!company) return 'payment-failed-unknown-company'
  const product = [company.subscriptionPlan, meta.product].find((p) => isPlanProduct(p)) ?? null
  await d.repo.enqueueJobs(
    [
      {
        key: `payment_failed_email:${invoice.id}`,
        kind: 'payment_failed_email',
        payload: {
          companyId: company.id,
          invoiceId: invoice.id,
          product,
          amount: invoice.amount_due || invoice.total,
          // Sin IVA espanol (inversion del sujeto pasivo, fuera de la UE...), el correo no dice «IVA incluido».
          vatIncluded: (invoice.total_taxes ?? []).some((t) => t.amount > 0),
          currency: invoice.currency,
          suspendFrom: addDays(madridDate(new Date(eventCreated * 1000)), UNPAID_NOTICE_DAYS),
          payUrl: invoice.hosted_invoice_url ?? null,
        },
      },
    ],
    d.clock()
  )
  return 'payment-failed'
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
  const afterInvoice = await rectifyDependsOn(d, p)
  const jobs: NewJob[] = []
  const rectifies: string[] = []
  let credited = 0
  for (const refund of refunds) {
    // Nunca mas de lo cobrado, aunque Stripe dijera otra cosa.
    const amount = Math.min(refund.amount, Math.max(0, purchase.amountTotal - credited))
    credited += refund.amount
    if (!(amount > 0)) continue
    rectifies.push(`rectify:${p}:${refund.id}`)
    jobs.push({
      key: `rectify:${p}:${refund.id}`,
      kind: 'rectify',
      payload: { purchaseId: p, amount, ref: `credit:${p}:${refund.id}`, reason: 'refund', refundId: refund.id },
      dependsOn: afterInvoice,
    })
    // El aviso cuenta lo que paso de verdad: espera a la rectificativa, a la anulacion (devuelta
    // entera) y a las sesiones canceladas.
    jobs.push({
      key: `notice:refund:${refund.id}`,
      kind: 'notice',
      payload: { purchaseId: p, event: 'refund', amount, full, refundId: refund.id },
      dependsOn: [`rectify:${p}:${refund.id}`, ...(full ? [`revoke:${p}:refund`] : []), ...(cancel ? [cancel.key] : [])],
    })
  }
  if (full) {
    jobs.push({ key: `revoke:${p}:refund`, kind: 'revoke', payload: { purchaseId: p, reason: 'refund', final: true } })
    // Tras las rectificativas: si la factura se emitio a mano hoy, rectify la pone al dia y el correo
    // ya puede prometer la rectificativa.
    jobs.push({ key: `refund_email:${p}`, kind: 'refund_email', payload: { purchaseId: p, amount: charge.amount_refunded }, dependsOn: [`revoke:${p}:refund`, ...rectifies] })
    if (cancel) jobs.push(cancel)
  }
  // Primero la cola, despues la compra: si se corta en medio, el reintento de Stripe encola lo que falte.
  await d.repo.enqueueJobs(jobs, d.clock())
  const changed = await d.repo.recordRefund(p, charge.amount_refunded, full)
  if (!changed) return 'refund-already'
  return full ? 'refund' : 'partial-refund'
}

/**
 * La rectificativa espera a la factura, salvo si su paso ya esta parado: un paso muerto no deja
 * correr a quien depende de el, y con ella esperarian para siempre el correo de la devolucion y el
 * aviso. Sin esperar, rectify da el aviso de rectificar a mano.
 */
async function rectifyDependsOn(d: Delivery, purchaseId: string): Promise<string[]> {
  const invoice = await d.repo.getJobByKey(`invoice:${purchaseId}`)
  return invoice?.status === 'dead' ? [] : [`invoice:${purchaseId}`]
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
        dependsOn: await rectifyDependsOn(d, p),
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
