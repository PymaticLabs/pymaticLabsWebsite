// VIES de verdad: POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number (sin
// clave), con el NIF-IVA de PymaticLabs como solicitante (VIES_REQUESTER, ESB88781745 si no se
// dice) y un tiempo maximo corto (VIES_TIMEOUT_MS, 6 s): quien espera es el cliente en /comprar.
// VIES_API_URL cambia solo la direccion base (la ruta la pone el adaptador): para otro servidor con
// la misma API, por ejemplo uno de mentira en local. Como el servicio de prueba, readConfig no lo
// deja con Stripe en vivo ni en produccion (salvo la direccion de verdad).
//
// El servicio de prueba de la misma API (POST .../check-vat-test-service) contesta por el numero, no
// por el registro: 100, valido; 200, no valido; otros, cada uno su error (301, MS_UNAVAILABLE...).
// Fuera de produccion, VIES_TEST_SERVICE=true pregunta ahi: en /comprar se prueba con Rumania, cuyo
// NIF-IVA admite tres cifras (RO100, RO200, RO301). readConfig no lo deja con Stripe en vivo ni en
// produccion: daria por valido un NIF-IVA sin mirarlo. Un valido sin numero de consulta sale
// unavailable, como en el de verdad.
//
// Como lo lee lib/delivery/vies.ts: nunca lanza, un fallo es unavailable.

import { readViesResponse, viesRequester } from '../vies.ts'
import type { VatChecker, ViesResult } from '../types.ts'

export const VIES_REST_API = 'https://ec.europa.eu/taxation_customs/vies/rest-api'

export class ViesChecker implements VatChecker {
  readonly name = 'vies'
  private url: string
  private requester: { memberState: string; number: string }
  private timeoutMs: number

  constructor(env: Record<string, string | undefined>, options: { requester: string; timeoutMs: number; testService?: boolean }) {
    const base = (env.VIES_API_URL || VIES_REST_API).replace(/\/+$/, '')
    this.url = `${base}/${options.testService ? 'check-vat-test-service' : 'check-vat-number'}`
    this.requester = viesRequester(options.requester)
    this.timeoutMs = options.timeoutMs
  }

  async check(query: { countryCode: string; vatNumber: string }): Promise<ViesResult> {
    let res: Response
    try {
      res = await fetch(this.url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          countryCode: query.countryCode,
          vatNumber: query.vatNumber,
          requesterMemberStateCode: this.requester.memberState,
          requesterNumber: this.requester.number,
        }),
        cache: 'no-store',
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      return { status: 'unavailable', reason: `sin respuesta (${error instanceof Error ? error.message : error})` }
    }
    const body = await res.text().catch(() => '')
    let json: unknown = null
    try {
      json = JSON.parse(body)
    } catch {
      // no era JSON: una pagina de error de su servidor
    }
    return readViesResponse(res.status, json)
  }
}
