// Estado de la funcion de entrega en Upstash Redis (API REST, sin dependencias):
// - la secuencia de ids de licencia por año, que tiene que ser unica (INCR es atomico);
// - las sesiones de Stripe ya entregadas, porque Stripe puede mandar el mismo aviso dos veces.
//
// La secuencia hoy vive en ~/.cerebro-licencias/licencias.ids.json del Mac de Eric. Antes de abrir
// la compra hay que llevarla aqui (SET licencias:secuencia:<año> <ultimo numero usado>) y emitir
// desde un solo sitio, o repartir rangos, para no repetir ids.

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN

export function isStoreConfigured(): boolean {
  return Boolean(url && token)
}

async function command<T>(...args: (string | number)[]): Promise<T> {
  if (!url || !token) throw new Error('Upstash Redis sin configurar (UPSTASH_REDIS_REST_URL y _TOKEN)')
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args.map(String)),
    cache: 'no-store',
  })
  const body = (await res.json()) as { result?: T; error?: string }
  if (!res.ok || body.error) throw new Error(`Redis ${args[0]}: ${body.error ?? res.status}`)
  return body.result as T
}

/** El siguiente numero de licencia del año, ya reservado. Una entrega que falla deja un hueco, nunca un id repetido. */
export async function nextLicenseSequence(year: number): Promise<number> {
  return command<number>('INCR', `licencias:secuencia:${year}`)
}

/**
 * Marca una sesion de Stripe como en curso. Devuelve false si ya estaba (otra entrega la tiene o
 * ya se hizo). La marca caduca a los 30 dias, mucho despues de que Stripe deje de reintentar.
 */
export async function claimSession(sessionId: string): Promise<boolean> {
  const result = await command<string | null>('SET', `entregas:sesion:${sessionId}`, 'en-curso', 'NX', 'EX', 60 * 60 * 24 * 30)
  return result === 'OK'
}

export async function completeSession(sessionId: string, licenseId: string): Promise<void> {
  await command('SET', `entregas:sesion:${sessionId}`, licenseId, 'EX', 60 * 60 * 24 * 30)
}

/** Si la entrega falla antes de mandar nada, se suelta la sesion para que el reintento de Stripe la haga. */
export async function releaseSession(sessionId: string): Promise<void> {
  await command('DEL', `entregas:sesion:${sessionId}`)
}
