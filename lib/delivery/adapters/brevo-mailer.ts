// Correo por Brevo (UE), por su API REST (POST /v3/smtp/email). Es un adaptador: Postmark u otro
// lo sustituye implementando Mailer.
//
// BREVO_API_KEY. El remitente (DELIVERY_FROM_EMAIL) tiene que estar verificado en Brevo, con el
// dominio autenticado (SPF y DKIM).
//
// Brevo solo admite unas extensiones en los adjuntos: lo demas (la .cerebro-licencia) va dentro de
// un .zip, sin tocar. IdempotencyKey: un reintento del mismo paso no manda el correo dos veces.

import { zip } from '../zip.ts'
import { requestJson, requireEnv } from './http.ts'
import type { Mail, MailAttachment, Mailer } from '../types.ts'

const ALLOWED = new Set(
  'xlsx xls ods docx docm doc csv pdf txt gif jpg jpeg png tif tiff rtf bmp cgm css shtml html htm zip xml ppt pptx tar ez ics mobi msg pub eps odt mp3 m4a m4v wma ogg flac wav aif aifc aiff mp4 mov avi mkv mpeg mpg wmv pkpass xlsm'.split(
    ' '
  )
)

/** Los adjuntos que Brevo no admite, dentro de un .zip con su mismo nombre. */
export function brevoAttachments(attachments: MailAttachment[]): { name: string; content: string }[] {
  return attachments.map((attachment) => {
    const extension = attachment.name.split('.').pop()?.toLowerCase() ?? ''
    if (ALLOWED.has(extension)) return { name: attachment.name, content: attachment.content.toString('base64') }
    const base = attachment.name.replace(/\.[^.]+$/, '')
    return { name: `${base}.zip`, content: zip([{ name: attachment.name, content: attachment.content }]).toString('base64') }
  })
}

export class BrevoMailer implements Mailer {
  readonly name = 'brevo'
  private key: string
  private from: { email: string; name: string }
  private replyTo: string

  constructor(env: Record<string, string | undefined>, from: { email: string; name: string }, replyTo: string) {
    this.key = requireEnv(env, 'BREVO_API_KEY')
    this.from = from
    this.replyTo = replyTo
  }

  async send(mail: Mail) {
    const headers: Record<string, string> = {}
    if (mail.idempotencyKey) headers.IdempotencyKey = mail.idempotencyKey
    const body = await requestJson<{ messageId?: string; messageIds?: string[] }>('Brevo', 'https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': this.key },
      json: {
        sender: this.from,
        to: [{ email: mail.to }],
        replyTo: { email: mail.replyTo ?? this.replyTo },
        subject: mail.subject,
        htmlContent: mail.html,
        textContent: mail.text,
        ...(mail.attachments?.length ? { attachment: brevoAttachments(mail.attachments) } : {}),
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(mail.tags?.length ? { tags: mail.tags } : {}),
      },
    })
    return { id: body.messageId ?? body.messageIds?.[0] ?? 'brevo' }
  }
}
