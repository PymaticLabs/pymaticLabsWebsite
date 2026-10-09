import { createSign } from 'node:crypto'

// La descarga: una carpeta de Google Drive por version (las dos extensiones, sus .sha256, el
// inventario de componentes y las notas), compartida en lectura con el correo del cliente.
// Lo hace una cuenta de servicio de Google con acceso a esa carpeta.
//
// GOOGLE_SERVICE_ACCOUNT_JSON: la clave JSON de la cuenta de servicio (tal cual o en base64).
// DRIVE_RELEASE_FOLDER_ID: la carpeta de la version vigente.

const SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/drive/v3'

interface ServiceAccount {
  client_email: string
  private_key: string
}

function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON sin configurar')
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf-8')
  return JSON.parse(json) as ServiceAccount
}

export function releaseFolderId(): string {
  const id = process.env.DRIVE_RELEASE_FOLDER_ID
  if (!id) throw new Error('DRIVE_RELEASE_FOLDER_ID sin configurar')
  return id
}

export function folderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`
}

async function accessToken(): Promise<string> {
  const { client_email, private_key } = serviceAccount()
  const now = Math.floor(Date.now() / 1000)
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(private_key, 'base64url')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }),
  })
  const body = (await res.json()) as { access_token?: string; error_description?: string }
  if (!res.ok || !body.access_token) throw new Error(`Google OAuth: ${body.error_description ?? res.status}`)
  return body.access_token
}

async function drive(path: string, init: RequestInit & { token: string }) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${init.token}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 204) return null
  const body = await res.json()
  if (!res.ok) {
    const error = new Error(`Drive ${path}: ${body?.error?.message ?? res.status}`) as Error & { status?: number }
    error.status = res.status
    throw error
  }
  return body
}

/**
 * Comparte la carpeta en lectura con `email`. Primero sin aviso de Google (el correo lo mandamos
 * nosotros); si el correo no tiene cuenta de Google, Drive exige avisar, y se repite con aviso.
 */
export async function shareFolder(folderId: string, email: string): Promise<void> {
  const token = await accessToken()
  const body = JSON.stringify({ role: 'reader', type: 'user', emailAddress: email })
  const path = (notify: boolean) =>
    `/files/${folderId}/permissions?supportsAllDrives=true&sendNotificationEmail=${notify}`
  try {
    await drive(path(false), { method: 'POST', body, token })
  } catch (error) {
    if ((error as { status?: number }).status !== 400) throw error
    await drive(path(true), { method: 'POST', body, token })
  }
}

/** Deja de compartir la carpeta con `email` (devolucion o contracargo). La licencia no se revoca. */
export async function unshareFolder(folderId: string, email: string): Promise<boolean> {
  const token = await accessToken()
  const list = await drive(
    `/files/${folderId}/permissions?supportsAllDrives=true&fields=permissions(id,emailAddress)`,
    { method: 'GET', token }
  )
  const matches = (list?.permissions ?? []).filter(
    (p: { id: string; emailAddress?: string }) => p.emailAddress?.toLowerCase() === email.toLowerCase()
  )
  for (const permission of matches) {
    await drive(`/files/${folderId}/permissions/${permission.id}?supportsAllDrives=true`, { method: 'DELETE', token })
  }
  return matches.length > 0
}
