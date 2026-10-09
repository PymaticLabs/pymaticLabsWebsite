import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { CONTACT_INTERESTS } from '@/lib/contact'

const contactSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(320),
  company: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  interest: z.union([z.enum(CONTACT_INTERESTS), z.literal('')]).optional(),
  message: z.string().trim().min(20).max(5000),
  locale: z.enum(['es', 'en']).optional(),
})

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function POST(request: NextRequest) {
  try {
    const parsed = contactSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation error' }, { status: 400 })
    }

    const { name, email, company, phone, interest, message, locale } = parsed.data
    const contactEmail = process.env.CONTACT_EMAIL || 'info@pymaticlabs.com'

    if (process.env.RESEND_API_KEY) {
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
    } else {
      console.log('[contacto] RESEND_API_KEY sin configurar; mensaje no enviado:', { name, email, interest })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact form error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
