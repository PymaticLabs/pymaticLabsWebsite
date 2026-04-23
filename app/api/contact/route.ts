import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  businessType: z.string().optional(),
  message: z.string().min(20, 'Message must be at least 20 characters'),
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const parsed = contactSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || 'Validation error' },
        { status: 400 }
      )
    }

    const { name, email, phone, businessType, message } = parsed.data
    const contactEmail = process.env.CONTACT_EMAIL || 'info@pymaticlabs.com'

    if (process.env.RESEND_API_KEY) {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)

      await resend.emails.send({
        from: 'Pymatic Labs <no-reply@pymaticlabs.com>',
        to: [contactEmail],
        subject: `Nuevo mensaje de contacto de ${name}`,
        html: `
          <h2>Nuevo mensaje de contacto</h2>
          <p><strong>Nombre:</strong> ${name}</p>
          <p><strong>Email:</strong> ${email}</p>
          ${phone ? `<p><strong>Teléfono:</strong> ${phone}</p>` : ''}
          ${businessType ? `<p><strong>Tipo de negocio:</strong> ${businessType}</p>` : ''}
          <p><strong>Mensaje:</strong></p>
          <p>${message.replace(/\n/g, '<br/>')}</p>
        `,
        replyTo: email,
      })
    } else {
      // Dev mode: log to console
      console.log('📧 [DEV MODE] New contact form submission:', {
        name,
        email,
        phone,
        businessType,
        message,
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Contact form error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
