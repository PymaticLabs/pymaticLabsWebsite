// Token de acceso de Google con una cuenta de servicio (JWT firmado con su clave, sin SDK), el
// mismo flujo que usaba la entrega por Drive. Se guarda hasta un minuto antes de caducar.
//
// GOOGLE_SERVICE_ACCOUNT_JSON: la clave JSON de la cuenta de servicio (tal cual o en base64). Para
// la firma de licencias, esa cuenta solo tiene roles/cloudkms.signer y roles/cloudkms.publicKeyViewer
// sobre la clave. Una cuenta y una clave de KMS por entorno: la de produccion, marcada Sensitive y
// solo en Production en Vercel (las ramas de Preview no la ven); Preview, la suya de pruebas.

import { createSign } from 'node:crypto'
import { requestJson } from './http.ts'
import { PermanentError } from '../types.ts'

interface ServiceAccount {
  client_email: string
  private_key: string
}

export function parseServiceAccount(raw: string | undefined): ServiceAccount {
  if (!raw) throw new PermanentError('GOOGLE_SERVICE_ACCOUNT_JSON sin configurar')
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')
  const parsed = JSON.parse(json) as Partial<ServiceAccount>
  if (!parsed.client_email || !parsed.private_key) throw new PermanentError('GOOGLE_SERVICE_ACCOUNT_JSON no es una clave de cuenta de servicio')
  return { client_email: parsed.client_email, private_key: parsed.private_key }
}

export class GoogleTokenSource {
  private account: ServiceAccount
  private scope: string
  private cached: { token: string; expires: number } | null = null

  constructor(account: ServiceAccount, scope: string) {
    this.account = account
    this.scope = scope
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expires > Date.now() + 60_000) return this.cached.token
    const now = Math.floor(Date.now() / 1000)
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
      iss: this.account.client_email,
      scope: this.scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })}`
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.account.private_key, 'base64url')
    const body = await requestJson<{ access_token: string; expires_in: number }>('Google OAuth', 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
    })
    this.cached = { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 }
    return body.access_token
  }
}
