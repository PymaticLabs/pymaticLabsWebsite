import { Resend } from 'resend'
import type { Purchase } from '@/lib/delivery/purchase'

// Correos de la entrega, por Resend. El de cliente lleva la licencia adjunta.

const FROM = 'Pymatic Labs <info@pymaticlabs.com>'
const SITE = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'

function resend(): Resend {
  if (!process.env.RESEND_API_KEY) throw new Error('RESEND_API_KEY sin configurar')
  return new Resend(process.env.RESEND_API_KEY)
}

function internalInbox(): string {
  return process.env.CONTACT_EMAIL || 'info@pymaticlabs.com'
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const copy = {
  es: {
    subject: 'Tu Cerebro Digital: licencia y descarga',
    hello: (company: string) => `Hola, ${company}:`,
    intro: 'Gracias por tu compra. Aquí tienes todo lo necesario para montar tu Cerebro Digital.',
    steps: (download: string, booking: string, terms: string, licenseId: string) => [
      `<strong>Descarga.</strong> La carpeta con la extensión para Mac y Windows está compartida con este correo: <a href="${download}">abrir la descarga</a>.`,
      `<strong>Licencia.</strong> Va adjunta (${licenseId}). Guárdala: el montaje te la pedirá.`,
      `<strong>Sesiones de montaje.</strong> Reserva tus dos sesiones de 1 hora (de 18:00 a 22:00, hora peninsular): <a href="${booking}">reservar</a>.`,
      `<strong>Condiciones.</strong> Las condiciones de uso y venta que aceptaste están en <a href="${terms}">${terms}</a>.`,
      '<strong>Factura.</strong> Te llega en un correo aparte.',
    ],
    outro: 'Si algo no cuadra, contesta a este correo.',
  },
  en: {
    subject: 'Your Digital Brain: license and download',
    hello: (company: string) => `Hello ${company},`,
    intro: 'Thank you for your purchase. Here is everything you need to set up your Digital Brain.',
    steps: (download: string, booking: string, terms: string, licenseId: string) => [
      `<strong>Download.</strong> The folder with the extension for Mac and Windows is shared with this email address: <a href="${download}">open the download</a>.`,
      `<strong>License.</strong> It is attached (${licenseId}). Keep it: setup will ask you for it.`,
      `<strong>Setup sessions.</strong> Book your two 1-hour sessions (18:00 to 22:00 Spanish peninsular time): <a href="${booking}">book</a>.`,
      `<strong>Terms.</strong> The terms of use and sale you accepted are at <a href="${terms}">${terms}</a>.`,
      '<strong>Invoice.</strong> It arrives in a separate email.',
    ],
    outro: 'If anything looks wrong, reply to this email.',
  },
}

export async function sendCustomerEmail(args: {
  purchase: Purchase
  company: string
  licenseId: string
  licenseText: string
  licenseFileName: string
  downloadUrl: string
}) {
  const { purchase, company, licenseId, licenseText, licenseFileName, downloadUrl } = args
  if (!purchase.email) throw new Error('la compra no trae correo')
  const t = copy[purchase.locale]
  const booking = process.env.BOOKING_URL || 'https://cal.com/pymaticlabs'
  const terms = `${SITE}${purchase.locale === 'en' ? '/en' : ''}/condiciones`

  const html = [
    `<p>${escapeHtml(t.hello(company))}</p>`,
    `<p>${t.intro}</p>`,
    `<ol>${t.steps(downloadUrl, booking, terms, licenseId)
      .map((step) => `<li style="margin-bottom:8px">${step}</li>`)
      .join('')}</ol>`,
    `<p>${t.outro}</p>`,
    '<p>Pymatic Labs · info@pymaticlabs.com</p>',
  ].join('')

  const { error } = await resend().emails.send({
    from: FROM,
    to: [purchase.email],
    replyTo: internalInbox(),
    subject: t.subject,
    html,
    attachments: [{ filename: licenseFileName, content: Buffer.from(licenseText, 'utf-8') }],
  })
  if (error) throw new Error(`Resend: ${error.message}`)
}

/** Aviso a info@ de cada venta, o de lo que hay que hacer a mano. */
export async function sendInternalEmail(subject: string, lines: Record<string, string | number | null | undefined>) {
  const rows = Object.entries(lines)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</p>`)
    .join('')
  const { error } = await resend().emails.send({
    from: 'Pymatic Labs <no-reply@pymaticlabs.com>',
    to: [internalInbox()],
    subject,
    html: rows,
  })
  if (error) throw new Error(`Resend: ${error.message}`)
}
