// VIES, el sistema de la Comision Europea que dice si un NIF-IVA de la UE esta dado de alta en las
// operaciones intracomunitarias (iva-en-ventas.md: sin el NIF-IVA validado en VIES en el momento
// de la venta no hay inversion del sujeto pasivo). Se le pregunta antes de abrir cada pago sin IVA a
// una empresa de la UE (lib/checkout.ts) con el NIF-IVA de PymaticLabs como solicitante: asi VIES da
// un numero de consulta (requestIdentifier), que va con el pedido (vies_request y vies_checked_at en
// los metadatos del pago) como prueba de que se comprobo, con el nombre y la direccion del titular si
// los da (vies_name y vies_address; varios paises, Espana entre ellos, contestan «---»).
//
// La API REST publica (https://ec.europa.eu/taxation_customs/vies/rest-api, POST /check-vat-number,
// contrato en swagger_publicVAT.yaml): contesta valid true o false, o errorWrappers con el motivo
// (MS_UNAVAILABLE, TIMEOUT, SERVICE_UNAVAILABLE, MS_MAX_CONCURRENT_REQ, GLOBAL_MAX_CONCURRENT_REQ,
// IP_BLOCKED... y INVALID_INPUT, VAT_BLOCKED o INVALID_REQUESTER_INFO). Lo que no sea un si o un no
// claros es unavailable: nunca se vende a 0 % sin la respuesta.
//
// La comprobacion de produccion pregunta por el propio NIF-IVA de PymaticLabs (health.ts).

import type { ViesResult } from './types.ts'

/** El NIF-IVA de PymaticLabs, de alta en el ROI y valido en VIES (modelo-036-y-roi.md): el solicitante. */
export const PYMATICLABS_VAT_ID = 'ESB88781745'

/** VIES_REQUESTER (o el de PymaticLabs) partido como lo pide VIES: el pais y el numero, sin el prefijo. */
export function viesRequester(vatId: string): { memberState: string; number: string } {
  const id = vatId.trim().toUpperCase().replace(/[\s.-]/g, '')
  const match = /^([A-Z]{2})([A-Z0-9]{2,12})$/.exec(id)
  if (!match) throw new Error(`VIES_REQUESTER=${vatId}: tiene que ser un NIF-IVA con su prefijo (como ${PYMATICLABS_VAT_ID})`)
  return { memberState: match[1], number: match[2] }
}

// Los motivos de VIES que son un no (el numero no vale o no se puede comprobar nunca); los demas, que
// ahora no contesta (se reintenta en unos minutos).
const INVALID_ERRORS = ['INVALID_INPUT', 'VAT_BLOCKED']

function text(value: unknown): string | null {
  const s = typeof value === 'string' ? value.trim() : ''
  return s && s !== '---' ? s : null
}

/**
 * Lo que contesta POST /check-vat-number (el estado HTTP y el JSON, o null si no lo era). valid
 * sin numero de consulta no vale como prueba: unavailable.
 */
export function readViesResponse(status: number, body: unknown, now: Date = new Date()): ViesResult {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const wrappers = Array.isArray(data.errorWrappers) ? (data.errorWrappers as { error?: unknown; message?: unknown }[]) : []
  const errors = wrappers.map((w) => String(w.error ?? '')).filter(Boolean)
  // La API GET de cada pais lo dice con userError; por si la POST lo trajera igual.
  const userError = typeof data.userError === 'string' && !['VALID', 'INVALID'].includes(data.userError) ? data.userError : null
  if (userError) errors.push(userError)
  if (errors.length) {
    const reason = errors.join(', ')
    return errors.every((e) => INVALID_ERRORS.includes(e)) ? { status: 'invalid', reason } : { status: 'unavailable', reason }
  }
  if (status >= 400 || typeof data.valid !== 'boolean') return { status: 'unavailable', reason: `respuesta ${status} sin valid` }
  if (!data.valid) return { status: 'invalid', reason: null }
  const requestIdentifier = text(data.requestIdentifier)
  if (!requestIdentifier) return { status: 'unavailable', reason: 'valido pero sin numero de consulta (requestIdentifier): revisar VIES_REQUESTER' }
  const date = typeof data.requestDate === 'string' && Number.isFinite(Date.parse(data.requestDate)) ? new Date(data.requestDate) : now
  return { status: 'valid', requestIdentifier, requestDate: date.toISOString(), name: text(data.name), address: text(data.address) }
}
