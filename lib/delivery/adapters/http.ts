// fetch a las APIs de los proveedores con los errores ya clasificados para la cola:
// - 408, 409 (en curso), 425, 429 y 5xx, o la red caida: RetryableError (se reintenta; con 429
//   se respeta Retry-After);
// - el resto de 4xx: PermanentError (clave mal puesta, permiso o datos que no valen: reintentar
//   no lo arregla, hay que mirarlo).

import { PermanentError, RetryableError } from '../types.ts'

export interface HttpOptions {
  method?: string
  headers?: Record<string, string>
  json?: unknown
  body?: BodyInit
  /** Tiempo maximo de la llamada. */
  timeoutMs?: number
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

export async function request(service: string, url: string, options: HttpOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers }
  let body = options.body
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.json)
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: options.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    })
  } catch (error) {
    throw new RetryableError(`${service}: sin respuesta (${error instanceof Error ? error.message : error})`)
  }
  if (res.ok) return res

  const text = await res.text().catch(() => '')
  let detail = text.slice(0, 300)
  try {
    const parsed = JSON.parse(text)
    detail = parsed.detail || parsed.message || parsed.error_description || parsed.error?.message || parsed.msg || parsed.title || detail
    if (typeof detail !== 'string') detail = JSON.stringify(detail).slice(0, 300)
  } catch {
    // no era JSON
  }
  const message = `${service} ${res.status}: ${detail || res.statusText}`
  if ([408, 409, 425, 429].includes(res.status) || res.status >= 500) {
    throw Object.assign(new RetryableError(message, retryAfterMs(res.headers.get('retry-after'))), { status: res.status })
  }
  throw Object.assign(new PermanentError(message), { status: res.status })
}

export async function requestJson<T>(service: string, url: string, options: HttpOptions = {}): Promise<T> {
  const res = await request(service, url, options)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export function requireEnv(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new PermanentError(`${name} sin configurar`)
  return value
}
