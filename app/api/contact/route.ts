import { NextRequest, NextResponse } from 'next/server'
import { clientIp, sameOrigin } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { zoneAvailable } from '@/lib/delivery/config'
import { handleContact, type ContactMessage } from './handle'

// El formulario de contacto: lo decide handle.ts (origen, limite por IP, trampa y validacion) y aqui
// se manda por Resend a info@.

export const runtime = 'nodejs'

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

async function send({ name, email, company, phone, interest, message, locale }: ContactMessage) {
  const contactEmail = process.env.CONTACT_EMAIL || 'info@pymaticlabs.com'

  if (!process.env.RESEND_API_KEY) {
    console.log('[contacto] RESEND_API_KEY sin configurar; mensaje no enviado:', { name, email, interest })
    return
  }
  const { Resend } = await import('resend')
  const resend = new Resend(process.env.RESEND_API_KEY)

  const rows = [
    ['Nombre', name],
    ['Correo', email],
    ['Empresa', company],
    ['Teléfono', phone],
    ['Le interesa', interest],
    ['Idioma de la web', locale],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `<p><strong>${label}:</strong> ${escapeHtml(value as string)}</p>`)
    .join('')

  const { error } = await resend.emails.send({
    from: 'Pymatic Labs <no-reply@pymaticlabs.com>',
    to: [contactEmail],
    subject: `Contacto web: ${name}${company ? ` (${company})` : ''}`,
    html: `<h2>Nuevo mensaje de contacto</h2>${rows}<p><strong>Mensaje:</strong></p><p>${escapeHtml(message).replace(/\n/g, '<br/>')}</p>`,
    replyTo: email,
  })
  if (error) throw new Error(error.message)
}

export async function POST(request: NextRequest) {
  const result = await handleContact(
    // La entrega se monta al contar el envio, dentro de su try: un fallo de su configuracion no tumba el formulario.
    { delivery: () => (zoneAvailable() ? getDelivery() : null), send },
    { body: await request.json().catch(() => null), sameOrigin: sameOrigin(request), ip: clientIp(request) }
  )
  return NextResponse.json(result.body, { status: result.status })
}
