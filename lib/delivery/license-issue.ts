// Firma de una licencia con un Signer (KMS o la clave local de prueba): los mismos bytes y el mismo
// fichero que signLicense() de lib/license.ts y que firmar_licencia.py, sin la privada en el
// servidor.

import {
  LICENSE_FORMAT,
  LicenseError,
  canonical,
  licenseFields,
  licenseFileName,
  serializeLicense,
  validateLicense,
  verifyLicense,
  type LicenseData,
} from '../license.ts'
import { PermanentError, type Signer } from './types.ts'

/**
 * Los numeros de licencia de la web: del 5001 al 9999 de cada anyo. Del 0001 al 5000 son del Mac de
 * Eric (a medida, demos, internas): asi los dos nunca dan el mismo id.
 */
export const WEB_LICENSE_FIRST = 5001

export async function issueLicense(
  data: LicenseData,
  signer: Signer,
  options: { expectedPublicKey: string | null }
): Promise<{ text: string; fileName: string; publicKey: string }> {
  const license = licenseFields(data)
  try {
    validateLicense(license)
  } catch (error) {
    // Datos que no valen (NIF, fechas): reintentar no lo arregla.
    if (error instanceof LicenseError) throw new PermanentError(`licencia ${license.id}: ${error.message}`)
    throw error
  }
  const publicKey = await signer.publicKey()
  // Como firmar_licencia.py: no firma con una clave que no es la esperada (sus licencias no
  // valdrian en ningun cerebro).
  if (options.expectedPublicKey && publicKey !== options.expectedPublicKey) {
    throw new PermanentError('la clave de firma no es la de LICENSE_WEB_PUBLIC_KEY: no se emite')
  }
  const signature = await signer.sign(canonical(license))
  const text = serializeLicense({ formato: LICENSE_FORMAT, licencia: license, firma: signature.toString('base64') })
  // Lo firmado se comprueba antes de entregarlo.
  try {
    verifyLicense(text, publicKey, { allowPayment: license.pago !== undefined })
  } catch (error) {
    throw new PermanentError(`la licencia firmada no verifica: ${error instanceof Error ? error.message : error}`)
  }
  return { text, fileName: licenseFileName(license.cliente), publicKey }
}
