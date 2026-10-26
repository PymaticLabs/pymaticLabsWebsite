// Almacen privado en Supabase Storage (UE), por su API REST con la clave service_role. Los buckets
// son privados (supabase/migrations/20261021120100_almacen.sql): las descargas salen con enlaces
// firmados que caducan en minutos.
//
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (solo en el servidor; nunca NEXT_PUBLIC_).

import { request, requestJson, requireEnv } from './http.ts'
import { RetryableError, type Bucket, type Storage } from '../types.ts'

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export class SupabaseStorage implements Storage {
  private url: string
  private key: string

  constructor(env: Record<string, string | undefined>) {
    this.url = requireEnv(env, 'SUPABASE_URL').replace(/\/+$/, '')
    this.key = requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY')
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.key}`, apikey: this.key, ...extra }
  }

  async put(bucket: Bucket, path: string, content: Buffer, contentType: string) {
    await request('Supabase Storage', `${this.url}/storage/v1/object/${bucket}/${encodePath(path)}`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'no-store' }),
      body: new Uint8Array(content),
      timeoutMs: 120_000,
    })
  }

  async get(bucket: Bucket, path: string) {
    let res: Response
    try {
      res = await fetch(`${this.url}/storage/v1/object/authenticated/${bucket}/${encodePath(path)}`, { headers: this.headers(), cache: 'no-store' })
    } catch (error) {
      throw new RetryableError(`Supabase Storage: sin respuesta (${error instanceof Error ? error.message : error})`)
    }
    // Lo que no existe llega como 400 o 404 segun la version del almacen.
    if (res.status === 400 || res.status === 404) return null
    if (!res.ok) throw new RetryableError(`Supabase Storage ${res.status} al leer ${bucket}/${path}`)
    return Buffer.from(await res.arrayBuffer())
  }

  async exists(bucket: Bucket, path: string) {
    let res: Response
    try {
      res = await fetch(`${this.url}/storage/v1/object/info/${bucket}/${encodePath(path)}`, { headers: this.headers(), cache: 'no-store' })
    } catch (error) {
      throw new RetryableError(`Supabase Storage: sin respuesta (${error instanceof Error ? error.message : error})`)
    }
    if (res.ok) return true
    if (res.status === 400 || res.status === 404) return false
    throw new RetryableError(`Supabase Storage ${res.status} al mirar ${bucket}/${path}`)
  }

  async signedUrl(bucket: Bucket, path: string, expiresInSeconds: number, downloadName?: string) {
    const body = await requestJson<{ signedURL: string }>('Supabase Storage', `${this.url}/storage/v1/object/sign/${bucket}/${encodePath(path)}`, {
      method: 'POST',
      headers: this.headers(),
      json: { expiresIn: expiresInSeconds },
    })
    const url = new URL(`${this.url}/storage/v1${body.signedURL}`)
    if (downloadName) url.searchParams.set('download', downloadName)
    return url.toString()
  }
}
