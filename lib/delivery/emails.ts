// Los correos de la entrega, en castellano y en ingles: bienvenida (con la licencia, o diciendo que
// llega en unas horas si la firma Eric a mano), la licencia firmada a mano, licencia nueva del
// mensual, cobro del mensual sin pagar, devolucion, version nueva, alta en el equipo y el aviso a los
// titulares de una compra con su NIF; y los internos (venta, licencia a firmar, alertas,
// conciliacion). Cada uno con HTML y texto plano.

import { BRAND, hostName, productName } from './products.ts'
import { escapeHtml, formatMoney, paidUntil } from './util.ts'
import type { Locale } from './types.ts'

export interface RenderedMail {
  subject: string
  html: string
  text: string
}

export function zoneUrl(siteUrl: string, locale: Locale): string {
  return `${siteUrl}${locale === 'en' ? '/en' : ''}/zona`
}

export function formatDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Madrid',
  }).format(new Date(iso))
}

export function formatDate(isoDate: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`)
  )
}

/** Un parrafo: texto (se escapa) y, si se da, un enlace al final. */
interface Block {
  text: string
  link?: { href: string; label: string }
}

function layout(blocks: Block[], locale: Locale): { html: string; text: string } {
  const footer = locale === 'en' ? 'Pymatic Labs · info@pymaticlabs.com · Reply to this email if anything looks wrong.' : 'Pymatic Labs · info@pymaticlabs.com · Si algo no cuadra, contesta a este correo.'
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:16px;line-height:1.6;color:#1a1a1a;max-width:560px">',
    ...blocks.map((b) => {
      const link = b.link ? ` <a href="${escapeHtml(b.link.href)}" style="color:#2f5bea">${escapeHtml(b.link.label)}</a>` : ''
      return `<p>${escapeHtml(b.text)}${link}</p>`
    }),
    `<p style="color:#666;font-size:13px;margin-top:32px">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('\n')
  const text = [...blocks.map((b) => (b.link ? `${b.text} ${b.link.href}` : b.text)), '', footer].join('\n\n')
  return { html, text }
}

/**
 * Lo que dura la licencia: perpetua, y su mantenimiento y soporte hasta una fecha (o sin el). La
 * seguridad, gratis durante el periodo de soporte de cada version (oferta v1.9, clausula 11).
 */
function licenseTerms(supportUntil: string, emitida: string, locale: Locale): string {
  const en = locale === 'en'
  if (supportUntil === emitida) {
    return en
      ? 'It is perpetual and gets security fixes for free during the support period of each version (five years from its release); it does not include maintenance or support.'
      : 'Es perpetua y recibe gratis las correcciones de seguridad durante el periodo de soporte de cada versión (cinco años desde que se publica); no incluye mantenimiento ni soporte.'
  }
  return en
    ? `It is perpetual; maintenance and support run until ${formatDate(supportUntil, locale)}.`
    : `Es perpetua; el mantenimiento y el soporte llegan hasta el ${formatDate(supportUntil, locale)}.`
}

function attachedLicense(licenseId: string, locale: Locale): string {
  return locale === 'en'
    ? `Your license ${licenseId} is attached (inside a .zip: open it and keep the .cerebro-licencia file). Setup will ask you for it.`
    : `Te adjuntamos tu licencia ${licenseId} (dentro de un .zip: ábrelo y guarda el fichero .cerebro-licencia). El montaje te la pedirá.`
}

export function welcomeEmail(input: {
  locale: Locale
  company: string
  product: string
  /** null: la licencia se firma a mano (LICENSE_MODE=manual) y llega en otro correo. */
  licenseId: string | null
  supportUntil: string
  emitida: string
  zoneUrl: string
  guided: boolean
  booking: { host: string; start: string; meetingUrl: string | null } | { failed: true; calendar?: boolean } | null
  termsAttached: boolean
}): RenderedMail {
  const { locale } = input
  const en = locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `Thank you for buying ${productName(input.product, locale)}. ${
            input.licenseId
              ? 'In your member area you have your license, the downloads for Mac and Windows and, once they are issued, your invoices.'
              : 'In your member area you already have the downloads for Mac and Windows; your license and your invoices will appear there as soon as they are ready.'
          } You sign in with this email address and a one-time code we send you; there is no password.`
        : `Gracias por comprar ${productName(input.product, locale)}. ${
            input.licenseId
              ? 'En tu zona de socio tienes tu licencia, las descargas para Mac y Windows y, en cuanto se emitan, tus facturas.'
              : 'En tu zona de socio ya tienes las descargas para Mac y Windows; tu licencia y tus facturas aparecerán ahí en cuanto estén.'
          } Se entra con este correo y un código de un solo uso que te mandamos; no hay contraseña.`,
      link: { href: input.zoneUrl, label: en ? 'Open your member area' : 'Entrar en tu zona de socio' },
    },
    {
      text: input.licenseId
        ? `${attachedLicense(input.licenseId, locale)} ${licenseTerms(input.supportUntil, input.emitida, locale)}`
        : en
          ? `Your license reaches you within a few hours, in a separate email, and it will be in your member area too. Setup will ask you for it. ${licenseTerms(input.supportUntil, input.emitida, locale)}`
          : `Tu licencia te llega en unas horas, en otro correo, y estará también en tu zona de socio. El montaje te la pedirá. ${licenseTerms(input.supportUntil, input.emitida, locale)}`,
    },
  ]
  if (input.guided && input.booking && 'start' in input.booking) {
    const when = formatDateTime(input.booking.start, locale)
    blocks.push({
      text: en
        ? `Your first setup session is booked with ${hostName(input.booking.host)}: ${when} (Madrid time), 1 hour by video call. You will get the calendar invitation separately. You book the second one from your member area.`
        : `Tu primera sesión de montaje está reservada con ${hostName(input.booking.host)}: ${when} (hora de Madrid), 1 hora por videollamada. La invitación del calendario te llega aparte. La segunda la reservas desde tu zona de socio.`,
      ...(input.booking.meetingUrl ? { link: { href: input.booking.meetingUrl, label: en ? 'Video call link' : 'Enlace de la videollamada' } } : {}),
    })
  } else if (input.guided && input.booking && 'failed' in input.booking && input.booking.calendar) {
    blocks.push({
      text: en
        ? 'We could not confirm your first setup session in the calendar just now. We will confirm it by email shortly; you can also pick a slot in your member area.'
        : 'No hemos podido confirmar ahora tu primera sesión de montaje en el calendario. Te la confirmamos por correo en breve; también puedes elegir hueco en tu zona de socio.',
    })
  } else if (input.guided && input.booking) {
    blocks.push({
      text: en
        ? 'The session slot you chose was taken just before your payment. Please pick another one in your member area; we have been notified too.'
        : 'El hueco que elegiste para tu primera sesión se ocupó justo antes de tu pago. Elige otro en tu zona de socio; nosotros también estamos avisados.',
    })
  } else if (input.guided) {
    blocks.push({
      text: en
        ? 'Book your two setup sessions (1 hour by video call, with Eric or with Sergio) from your member area.'
        : 'Reserva tus dos sesiones de montaje (1 hora por videollamada, con Eric o con Sergio) desde tu zona de socio.',
    })
  }
  if (input.termsAttached) {
    blocks.push({
      text: en
        ? 'We also attach the terms of use and sale you accepted, so you can keep them. They are in your member area too.'
        : 'Te adjuntamos también las condiciones de uso y venta que aceptaste, para que las guardes. Están también en tu zona de socio.',
    })
  }
  blocks.push({ text: en ? 'Your invoice arrives in a separate email.' : 'La factura te llega en un correo aparte.' })
  return {
    subject: input.licenseId
      ? en
        ? `Your ${BRAND.en}: license, downloads and terms`
        : `Tu ${BRAND.es}: licencia, descargas y condiciones`
      : en
        ? `Your ${BRAND.en}: member area, downloads and terms`
        : `Tu ${BRAND.es}: zona de socio, descargas y condiciones`,
    ...layout(blocks, locale),
  }
}

/** La licencia firmada a mano, que llega despues de la bienvenida (LICENSE_MODE=manual). */
export function licenseReadyEmail(input: { locale: Locale; company: string; licenseId: string; supportUntil: string; emitida: string; zoneUrl: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    { text: `${attachedLicense(input.licenseId, input.locale)} ${licenseTerms(input.supportUntil, input.emitida, input.locale)}` },
    {
      text: en ? 'It is also in your member area, to download it again whenever you need it.' : 'También está en tu zona de socio, para volver a bajarla cuando la necesites.',
      link: { href: input.zoneUrl, label: en ? 'Member area' : 'Zona de socio' },
    },
  ]
  return { subject: en ? `Your ${BRAND.en} license` : `Tu licencia del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

export function renewalEmail(input: { locale: Locale; company: string; licenseId: string; supportUntil: string; zoneUrl: string; plan: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `We have received the payment of your ${productName(input.plan, 'en')}. Your new license ${input.licenseId} covers maintenance and support until ${formatDate(input.supportUntil, 'en')}. It is attached (inside a .zip) and in your member area: give it to your brain so new features switch on.`
        : `Hemos recibido el pago de tu ${productName(input.plan, 'es')}. Tu licencia nueva ${input.licenseId} cubre el mantenimiento y el soporte hasta el ${formatDate(input.supportUntil, 'es')}. Va adjunta (dentro de un .zip) y está en tu zona de socio: dásela a tu cerebro para que se enciendan las novedades.`,
      link: { href: input.zoneUrl, label: en ? 'Member area' : 'Zona de socio' },
    },
    { text: en ? 'Your invoice arrives in a separate email.' : 'La factura te llega en un correo aparte.' },
  ]
  return { subject: en ? `Your new ${BRAND.en} license` : `Tu licencia nueva del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

/**
 * La devolucion entera de un pago unico. accessRevoked false: la empresa tiene otro pago unico
 * vigente, asi que solo deja de valer la licencia de esta compra (la zona y la otra licencia siguen,
 * y no hay nada que borrar). ownAccessClosed: con la empresa por su otra compra, quien compro esta
 * (otra persona, entregada a mano) sale de la zona: no se le dice que sigue en ella. creditNote: la
 * factura ya se habia emitido, y la rectificativa llega (si seguia en borrador, el cliente no la
 * recibio: no se promete).
 */
export function refundEmail(input: {
  locale: Locale
  company: string
  amount: number
  currency: string
  subscriptionCanceled?: boolean
  accessRevoked?: boolean
  ownAccessClosed?: boolean
  licenseId?: string | null
  product?: string
  creditNote?: boolean
}): RenderedMail {
  const en = input.locale === 'en'
  const amount = formatMoney(input.amount, input.currency, input.locale)
  const which = [input.product ? productName(input.product, input.locale) : null, input.licenseId].filter(Boolean).join(', ')
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text:
        input.accessRevoked === false && input.ownAccessClosed
          ? en
            ? `We have refunded ${amount}. As the terms say (clause 5), the license of that purchase${which ? ` (${which})` : ''} is no longer valid. ${input.company} keeps its other purchase and its member area, which its owners manage; your own access to the member area is closed.`
            : `Te hemos devuelto ${amount}. Como dicen las condiciones (cláusula 5), la licencia de esa compra${which ? ` (${which})` : ''} deja de valer. ${input.company} sigue con su otra compra y su zona de socio, que llevan sus titulares; tu acceso a la zona se cierra.`
          : input.accessRevoked === false
          ? en
            ? `We have refunded ${amount}. As the terms say (clause 5), the license of that purchase${which ? ` (${which})` : ''} is no longer valid. ${input.company} keeps its other purchase, with its license and your member area: there is nothing to remove.`
            : `Te hemos devuelto ${amount}. Como dicen las condiciones (cláusula 5), la licencia de esa compra${which ? ` (${which})` : ''} deja de valer. ${input.company} sigue con su otra compra, con su licencia y tu zona de socio: no hay nada que borrar.`
          : en
            ? `We have refunded ${amount}. As the terms say (clause 5), the license ends and your member area is closed. Within 7 days, please remove the extension and the skeleton, with its standard documents, from all your computers and confirm it to us in writing. Your own brain is yours and you keep it.`
            : `Te hemos devuelto ${amount}. Como dicen las condiciones (cláusula 5), la licencia termina y se cierra tu zona de socio. En 7 días, borra la extensión y el esqueleto, con sus documentos estándar, de todos tus equipos y confírmanoslo por escrito. Tu cerebro es tuyo y te lo quedas.`,
    },
  ]
  if (input.subscriptionCanceled) {
    blocks.push({
      text: en
        ? 'Your monthly plan has been cancelled too, with no further charges: without the license it no longer applies.'
        : 'También hemos cancelado tu mensual, sin más cobros: sin la licencia ya no tiene sentido.',
    })
  }
  if (input.creditNote ?? true) blocks.push({ text: en ? 'The corrective invoice arrives in a separate email.' : 'La factura rectificativa te llega en un correo aparte.' })
  return { subject: en ? `Refund of your ${BRAND.en}` : `Devolución de tu ${BRAND.es}`, ...layout(blocks, input.locale) }
}

/**
 * Un cobro del mensual sin pagar (clausula 4: impagada, se suspende tras avisar con 15 dias): si el
 * dia suspendFrom sigue sin pagarse, sin mantenimiento ni soporte; hasta entonces siguen, con las
 * versiones nuevas, si la licencia vigente lo cubre (versionsUntilSuspension: cada licencia con
 * mantenimiento cubre 15 dias mas que lo pagado). La licencia y lo instalado siguen siempre.
 */
export function paymentFailedEmail(input: {
  locale: Locale
  company: string
  product: string | null
  amount: number
  currency: string
  /** El cobro lleva IVA espanol (sin el, a una empresa de la UE o de fuera, no se dice «IVA incluido»). */
  vatIncluded?: boolean
  suspendFrom: string
  versionsUntilSuspension?: boolean
  /**
   * El ultimo dia que cubre la licencia vigente, si es antes de suspendFrom (el primer cobro tras los
   * meses incluidos: la prueba acaba el dia siguiente a lo incluido): lo que promete el correo.
   */
  versionsUntil?: string
  /** El enlace de Stripe para pagar esa factura (hosted_invoice_url), si lo hay. */
  payUrl: string | null
  zoneUrl: string
}): RenderedMail {
  const en = input.locale === 'en'
  const plan = input.product ? productName(input.product, input.locale) : en ? `${BRAND.en} monthly plan` : `mensual del ${BRAND.es}`
  const amount = `${formatMoney(input.amount, input.currency, input.locale)}${(input.vatIncluded ?? true) ? (en ? ', VAT included' : ', IVA incluido') : ''}`
  const date = formatDate(input.suspendFrom, input.locale)
  const until = input.versionsUntil && input.versionsUntil < input.suspendFrom ? formatDate(input.versionsUntil, input.locale) : date
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `We could not charge the payment of your ${plan} (${amount}). Stripe will try again over the next few days with the card you have on file.`
        : `No hemos podido cobrar el pago de tu ${plan} (${amount}). Stripe lo vuelve a intentar estos días con la tarjeta que tienes puesta.`,
    },
    {
      text: en
        ? 'Check or change the card in the Stripe portal, from the Monthly page of your member area.'
        : 'Revisa la tarjeta, o cámbiala, en el portal de Stripe, desde la página Mensual de tu zona de socio.',
      link: { href: `${input.zoneUrl}/mensual`, label: en ? 'Monthly plan' : 'Mensual' },
    },
  ]
  if (input.payUrl) blocks.push({ text: en ? 'Or pay it now:' : 'O págalo ya:', link: { href: input.payUrl, label: en ? 'Pay the charge' : 'Pagar el cobro' } })
  blocks.push({
    text: input.versionsUntilSuspension === false
      ? en
        ? `As the terms say (clause 4), if it is still unpaid on ${date}, maintenance and support are suspended. What is new in the versions released in the meantime switches on once it is paid. Your license and what you have installed keep working, and security fixes still reach you.`
        : `Como dicen las condiciones (cláusula 4), si el ${date} sigue sin pagarse, se suspenden el mantenimiento y el soporte. Lo nuevo de las versiones que salgan mientras tanto se enciende cuando se pague. Tu licencia y lo que tienes instalado siguen funcionando, y las correcciones de seguridad te siguen llegando.`
      : en
        ? `As the terms say (clause 4), until ${until} you keep maintenance and support, new versions included; if it is still unpaid by then, they are suspended: no new features in later versions and no support. Your license and what you have installed keep working, and security fixes still reach you.`
        : `Como dicen las condiciones (cláusula 4), hasta el ${until} sigues teniendo el mantenimiento y el soporte, versiones nuevas incluidas; si para entonces sigue sin pagarse, se suspenden: sin lo nuevo de las versiones que salgan después ni soporte. Tu licencia y lo que tienes instalado siguen funcionando, y las correcciones de seguridad te siguen llegando.`,
  })
  return { subject: en ? `We could not charge your ${BRAND.en} monthly plan` : `No hemos podido cobrar tu mensual del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

export function versionEmail(input: { locale: Locale; company: string; version: string; notes: string; zoneUrl: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `Version ${input.version} of the ${BRAND.en} is out. Download it from your member area and install it when it suits you: it brings the latest security fixes. New features switch on if your license covers this version's date.`
        : `Ya está la versión ${input.version} del ${BRAND.es}. Bájala de tu zona de socio e instálala cuando te venga bien: trae las últimas correcciones de seguridad. Lo nuevo se enciende si tu licencia cubre la fecha de esta versión.`,
      link: { href: input.zoneUrl, label: en ? 'Download it' : 'Descargarla' },
    },
    ...input.notes
      .split(/\r?\n\s*\r?\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => ({ text: paragraph })),
  ]
  return { subject: en ? `${BRAND.en} ${input.version}: new version` : `${BRAND.es} ${input.version}: versión nueva`, ...layout(blocks, input.locale) }
}

export function teamInviteEmail(input: { locale: Locale; company: string; zoneUrl: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    {
      text: en
        ? `${input.company} has given you access to its ${BRAND.en} member area, where you can download the extension for Mac or Windows. You sign in with this email address and a one-time code; there is no password.`
        : `${input.company} te ha dado acceso a su zona de socio del ${BRAND.es}, donde puedes bajar la extensión para Mac o Windows. Se entra con este correo y un código de un solo uso; no hay contraseña.`,
      link: { href: input.zoneUrl, label: en ? 'Open the member area' : 'Entrar en la zona de socio' },
    },
  ]
  return { subject: en ? `Access to the ${BRAND.en} member area` : `Acceso a la zona de socio del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

/**
 * A los titulares de una empresa cliente: alguien ha comprado con su NIF desde otro correo. No se le
 * da acceso a nada hasta que PymaticLabs lo compruebe (el correo de quien compro no se dice). En
 * castellano, «identificacion fiscal»: la empresa puede ser de fuera de Espana, sin NIF.
 */
export function companyAlertEmail(input: { locale: Locale; company: string; product: string; date: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `On ${formatDate(input.date, 'en')} someone bought ${productName(input.product, 'en')} with your company's tax ID, from an email address that is not one of the people who bought for you. We have not given them access to your member area, your invoices or your licenses: we will check it with you first.`
        : `El ${formatDate(input.date, 'es')} alguien ha comprado ${productName(input.product, 'es')} con la identificación fiscal de vuestra empresa desde un correo que no es de quien compró para vosotros. No le hemos dado acceso a vuestra zona de socio, ni a vuestras facturas ni licencias: lo comprobamos antes con vosotros.`,
    },
    {
      text: en
        ? 'If it was someone from your company, just reply to this email and tell us. If not, reply too and we will refund it.'
        : 'Si ha sido alguien de vuestra empresa, contesta a este correo y nos lo dices. Si no, contesta también y lo devolvemos.',
    },
  ]
  return { subject: en ? `A purchase with your tax ID (${BRAND.en})` : `Una compra con vuestra identificación fiscal (${BRAND.es})`, ...layout(blocks, input.locale) }
}

// --- Internos ------------------------------------------------------------------------------------

/**
 * A Eric (LICENSE_MODE=manual): la licencia a firmar en su Mac, con los campos tal cual y como
 * subirla. El numero no se le dice: es de su numeracion (del 0001 al 5000).
 */
export function licenseRequestEmail(input: {
  purchaseId: string
  kind: 'one_time' | 'renewal'
  product: string
  paymentRef: string
  cliente: string
  nif: string
  modalidad: string
  equipo: boolean
  seats: number
  emitida: string
  soporteHasta: string
  livemode: boolean
  manualKeyEnv: 'production' | 'test'
  siteUrl: string
  again?: boolean
}): RenderedMail {
  const test = !input.livemode
  const fields = { cliente: input.cliente, nif: input.nif, modalidad: input.modalidad, equipo: input.equipo, emitida: input.emitida, soporte_hasta: input.soporteHasta }
  const upload = `node --env-file=.env.local scripts/subir-licencia.mts --web ${input.siteUrl} --compra ${input.purchaseId} --fichero <la .cerebro-licencia>`
  let caution: string | null = null
  if (test && input.manualKeyEnv === 'production') {
    caution = `Pago de PRUEBA de Stripe: NO firmarla con la clave del Mac (la web no la aceptaría). Para probar el camino, con una clave de pruebas: scripts/subir-licencia.mts --web ${input.siteUrl} --compra ${input.purchaseId} --firmar-prueba (docs/entrega-automatica.md, sección 0)`
  } else if (test) {
    caution = `Pago de PRUEBA de Stripe: esta web espera una clave de pruebas (LICENSE_MANUAL_PUBLIC_KEY). Firmarla con ella: scripts/subir-licencia.mts --web ${input.siteUrl} --compra ${input.purchaseId} --firmar-prueba`
  } else if (input.manualKeyEnv === 'test') {
    caution = 'Pago en vivo, pero esta web espera una clave de pruebas (LICENSE_MANUAL_PUBLIC_KEY): no se podrá subir. Quitar esa variable en producción y volver a desplegar'
  }
  return internalEmail(
    `${test ? 'PRUEBA · ' : ''}${input.again ? 'Otra vez: ' : ''}Licencia a firmar: ${input.cliente} (${input.modalidad}${input.equipo ? ' con equipo' : ''})`,
    {
      'Qué hacer': `Firmarla en tu Mac con firmar_licencia.py y estos campos tal cual, con el número siguiente de tu numeración (PML-LIC-<año>-NNNN, del 0001 al 5000), y subirla. ${
        input.kind === 'one_time' ? 'El cliente ya tiene la bienvenida y espera la licencia en unas horas.' : 'El cobro del mensual espera su licencia nueva.'
      }`,
      Prueba: caution,
      Compra: input.purchaseId,
      Tipo: input.kind === 'one_time' ? 'Pago único' : 'Cobro del mensual',
      Producto: productName(input.product, 'es'),
      Pago: `${input.paymentRef}${test ? ' (de prueba)' : ''}`,
      cliente: input.cliente,
      nif: input.nif,
      modalidad: input.modalidad,
      equipo: String(input.equipo),
      emitida: `${input.emitida} (la fecha del pago)`,
      soporte_hasta: input.soporteHasta,
      Margen:
        input.soporteHasta > input.emitida
          ? `soporte_hasta lleva 15 días más que lo pagado o incluido (hasta el ${paidUntil(input)}), el margen de un cobro fallido del mensual: firmarla tal cual`
          : null,
      Plazas: input.equipo ? `${input.seats} personas (equipo: true)` : '1 persona (equipo: false)',
      'Campos (JSON)': JSON.stringify(fields),
      Subirla: upload,
      'O con curl': `curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" --data-binary @<la .cerebro-licencia> "${input.siteUrl}/api/admin/licenses?compra=${input.purchaseId}"`,
      'Al subirla': 'La web la comprueba con la clave pública del Mac y con esta compra (NIF, modalidad, equipo, emitida y soporte_hasta), se la manda al cliente por correo y la deja en su zona de socio.',
    }
  )
}

/** Un aviso interno: asunto y una tabla de campos (los vacios no salen). */
export function internalEmail(subject: string, fields: Record<string, string | number | boolean | null | undefined>, intro?: string): RenderedMail {
  const rows = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined && v !== '')
  const html = [
    '<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">',
    intro ? `<p>${escapeHtml(intro)}</p>` : '',
    '<table cellpadding="4" style="border-collapse:collapse">',
    ...rows.map(([k, v]) => `<tr><td style="color:#666;vertical-align:top"><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(String(v))}</td></tr>`),
    '</table></div>',
  ].join('')
  const text = [intro ?? '', ...rows.map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join('\n')
  return { subject, html, text }
}
