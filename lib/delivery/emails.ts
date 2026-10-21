// Los correos de la entrega, en castellano y en ingles: bienvenida, licencia nueva del mensual,
// devolucion, version nueva, alta en el equipo y el aviso a los titulares de una compra con su NIF;
// y los internos (venta, alertas, conciliacion). Cada uno con HTML y texto plano.

import { BRAND, hostName, productName } from './products.ts'
import { escapeHtml, formatMoney } from './util.ts'
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

export function welcomeEmail(input: {
  locale: Locale
  company: string
  product: string
  licenseId: string
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
        ? `Thank you for buying ${productName(input.product, locale)}. Everything is ready in your customer area: your license, the downloads for Mac and Windows and your invoices. You sign in with this email address and a one-time code we send you; there is no password.`
        : `Gracias por comprar ${productName(input.product, locale)}. Ya tienes todo en tu zona de clientes: tu licencia, las descargas para Mac y Windows y tus facturas. Se entra con este correo y un código de un solo uso que te mandamos; no hay contraseña.`,
      link: { href: input.zoneUrl, label: en ? 'Open your customer area' : 'Entrar en tu zona de clientes' },
    },
    {
      text: en
        ? `Your license ${input.licenseId} is attached (inside a .zip: open it and keep the .cerebro-licencia file). Setup will ask you for it. It is perpetual; maintenance and support run until ${formatDate(input.supportUntil, locale)}.`
        : `Te adjuntamos tu licencia ${input.licenseId} (dentro de un .zip: ábrelo y guarda el fichero .cerebro-licencia). El montaje te la pedirá. Es perpetua; el mantenimiento y el soporte llegan hasta el ${formatDate(input.supportUntil, locale)}.`,
    },
  ]
  if (input.supportUntil === input.emitida) {
    blocks[2].text = en
      ? `Your license ${input.licenseId} is attached (inside a .zip: open it and keep the .cerebro-licencia file). Setup will ask you for it. It is perpetual and gets security fixes for free; it does not include maintenance or support.`
      : `Te adjuntamos tu licencia ${input.licenseId} (dentro de un .zip: ábrelo y guarda el fichero .cerebro-licencia). El montaje te la pedirá. Es perpetua y recibe gratis las correcciones de seguridad; no incluye mantenimiento ni soporte.`
  }
  if (input.guided && input.booking && 'start' in input.booking) {
    const when = formatDateTime(input.booking.start, locale)
    blocks.push({
      text: en
        ? `Your first setup session is booked with ${hostName(input.booking.host)}: ${when} (Spanish peninsular time), 1 hour by video call. You will get the calendar invitation separately. You book the second one from your customer area.`
        : `Tu primera sesión de montaje está reservada con ${hostName(input.booking.host)}: ${when} (hora peninsular), 1 hora por videollamada. La invitación del calendario te llega aparte. La segunda la reservas desde tu zona de clientes.`,
      ...(input.booking.meetingUrl ? { link: { href: input.booking.meetingUrl, label: en ? 'Video call link' : 'Enlace de la videollamada' } } : {}),
    })
  } else if (input.guided && input.booking && 'failed' in input.booking && input.booking.calendar) {
    blocks.push({
      text: en
        ? 'We could not confirm your first setup session in the calendar just now. We will confirm it by email shortly; you can also pick a slot in your customer area.'
        : 'No hemos podido confirmar ahora tu primera sesión de montaje en el calendario. Te la confirmamos por correo en breve; también puedes elegir hueco en tu zona de clientes.',
    })
  } else if (input.guided && input.booking) {
    blocks.push({
      text: en
        ? 'The session slot you chose was taken just before your payment. Please pick another one in your customer area; we have been notified too.'
        : 'El hueco que elegiste para tu primera sesión se ocupó justo antes de tu pago. Elige otro en tu zona de clientes; nosotros también estamos avisados.',
    })
  } else if (input.guided) {
    blocks.push({
      text: en
        ? 'Book your two setup sessions (1 hour by video call, with Eric or with Sergio) from your customer area.'
        : 'Reserva tus dos sesiones de montaje (1 hora por videollamada, con Eric o con Sergio) desde tu zona de clientes.',
    })
  }
  if (input.termsAttached) {
    blocks.push({
      text: en
        ? 'We also attach the terms of use and sale you accepted, so you can keep them. They are in your customer area too.'
        : 'Te adjuntamos también las condiciones de uso y venta que aceptaste, para que las guardes. Están también en tu zona de clientes.',
    })
  }
  blocks.push({ text: en ? 'Your invoice arrives in a separate email.' : 'La factura te llega en un correo aparte.' })
  return {
    subject: en ? `Your ${BRAND.en}: license, downloads and terms` : `Tu ${BRAND.es}: licencia, descargas y condiciones`,
    ...layout(blocks, locale),
  }
}

export function renewalEmail(input: { locale: Locale; company: string; licenseId: string; supportUntil: string; zoneUrl: string; plan: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `We have received the payment of your ${productName(input.plan, 'en')}. Your new license ${input.licenseId} covers maintenance and support until ${formatDate(input.supportUntil, 'en')}. It is attached (inside a .zip) and in your customer area: give it to your brain so new features switch on.`
        : `Hemos recibido el pago de tu ${productName(input.plan, 'es')}. Tu licencia nueva ${input.licenseId} cubre el mantenimiento y el soporte hasta el ${formatDate(input.supportUntil, 'es')}. Va adjunta (dentro de un .zip) y está en tu zona de clientes: dásela a tu cerebro para que se enciendan las novedades.`,
      link: { href: input.zoneUrl, label: en ? 'Customer area' : 'Zona de clientes' },
    },
    { text: en ? 'Your invoice arrives in a separate email.' : 'La factura te llega en un correo aparte.' },
  ]
  return { subject: en ? `Your new ${BRAND.en} license` : `Tu licencia nueva del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

export function refundEmail(input: { locale: Locale; company: string; amount: number; currency: string; subscriptionCanceled?: boolean }): RenderedMail {
  const en = input.locale === 'en'
  const amount = formatMoney(input.amount, input.currency, input.locale)
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `We have refunded ${amount}. As the terms say (clause 5), the license ends and your customer area is closed. Within 7 days, please remove the extension and the skeleton, with its standard documents, from all your computers and confirm it to us in writing. Your own brain is yours and you keep it.`
        : `Te hemos devuelto ${amount}. Como dicen las condiciones (cláusula 5), la licencia termina y se cierra tu zona de clientes. En 7 días, borra la extensión y el esqueleto, con sus documentos estándar, de todos tus equipos y confírmanoslo por escrito. Tu cerebro es tuyo y te lo quedas.`,
    },
  ]
  if (input.subscriptionCanceled) {
    blocks.push({
      text: en
        ? 'Your monthly plan has been cancelled too, with no further charges: without the license it no longer applies.'
        : 'También hemos cancelado tu mensual, sin más cobros: sin la licencia ya no tiene sentido.',
    })
  }
  blocks.push({ text: en ? 'The corrective invoice arrives in a separate email.' : 'La factura rectificativa te llega en un correo aparte.' })
  return { subject: en ? `Refund of your ${BRAND.en}` : `Devolución de tu ${BRAND.es}`, ...layout(blocks, input.locale) }
}

export function versionEmail(input: { locale: Locale; company: string; version: string; notes: string; zoneUrl: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `Version ${input.version} of the ${BRAND.en} is out. Download it from your customer area and install it when it suits you: it brings the latest security fixes. New features switch on if your license covers this version's date.`
        : `Ya está la versión ${input.version} del ${BRAND.es}. Bájala de tu zona de clientes e instálala cuando te venga bien: trae las últimas correcciones de seguridad. Lo nuevo se enciende si tu licencia cubre la fecha de esta versión.`,
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
        ? `${input.company} has given you access to its ${BRAND.en} customer area, where you can download the extension for Mac or Windows. You sign in with this email address and a one-time code; there is no password.`
        : `${input.company} te ha dado acceso a su zona de clientes del ${BRAND.es}, donde puedes bajar la extensión para Mac o Windows. Se entra con este correo y un código de un solo uso; no hay contraseña.`,
      link: { href: input.zoneUrl, label: en ? 'Open the customer area' : 'Entrar en la zona de clientes' },
    },
  ]
  return { subject: en ? `Access to the ${BRAND.en} customer area` : `Acceso a la zona de clientes del ${BRAND.es}`, ...layout(blocks, input.locale) }
}

/**
 * A los titulares de una empresa cliente: alguien ha comprado con su NIF desde otro correo. No se le
 * da acceso a nada hasta que PymaticLabs lo compruebe (el correo de quien compro no se dice).
 */
export function companyAlertEmail(input: { locale: Locale; company: string; product: string; date: string }): RenderedMail {
  const en = input.locale === 'en'
  const blocks: Block[] = [
    { text: en ? `Hello ${input.company},` : `Hola, ${input.company}:` },
    {
      text: en
        ? `On ${formatDate(input.date, 'en')} someone bought ${productName(input.product, 'en')} with your company's tax ID, from an email address that is not one of the people who bought for you. We have not given them access to your customer area, your invoices or your licenses: we will check it with you first.`
        : `El ${formatDate(input.date, 'es')} alguien ha comprado ${productName(input.product, 'es')} con el NIF de vuestra empresa desde un correo que no es de quien compró para vosotros. No le hemos dado acceso a vuestra zona de clientes, ni a vuestras facturas ni licencias: lo comprobamos antes con vosotros.`,
    },
    {
      text: en
        ? 'If it was someone from your company, just reply to this email and tell us. If not, reply too and we will refund it.'
        : 'Si ha sido alguien de vuestra empresa, contesta a este correo y nos lo dices. Si no, contesta también y lo devolvemos.',
    },
  ]
  return { subject: en ? `A purchase with your tax ID (${BRAND.en})` : `Una compra con vuestro NIF (${BRAND.es})`, ...layout(blocks, input.locale) }
}

// --- Internos ------------------------------------------------------------------------------------

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
