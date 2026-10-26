// Firma de licencias con la clave de la web dentro de Google Cloud KMS (EC_SIGN_ED25519): Ed25519
// puro sobre los bytes canonicos de la licencia, como firma Python. La privada nunca sale de KMS;
// el servidor solo puede pedir firmas, y cada una queda en el registro de auditoria de Google.
//
// GCP_KMS_KEY_VERSION: projects/<p>/locations/europe-west1/keyRings/<r>/cryptoKeys/<k>/cryptoKeyVersions/1
// GOOGLE_SERVICE_ACCOUNT_JSON: cuenta de servicio con solo roles/cloudkms.signer en esa clave (y
// roles/cloudkms.publicKeyViewer para leer la publica): firmar, sin poder ver ni sacar la privada.
//
// Cada llamada lleva y comprueba CRC32C, como pide Google, para descartar datos danados en el
// camino.

import { createPublicKey, verify } from 'node:crypto'
import { rawPublicKey } from '../../license.ts'
import { crc32c } from '../util.ts'
import { GoogleTokenSource, parseServiceAccount } from './google-auth.ts'
import { requestJson } from './http.ts'
import { PermanentError, RetryableError, type Signer } from '../types.ts'

const API = 'https://cloudkms.googleapis.com/v1'
const KEY_VERSION_RE = /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/\d+$/

export class GcpKmsSigner implements Signer {
  readonly keyId: string
  private tokens: GoogleTokenSource
  private cachedPublic: string | null = null

  constructor(env: Record<string, string | undefined>) {
    const keyVersion = env.GCP_KMS_KEY_VERSION?.trim() ?? ''
    if (!KEY_VERSION_RE.test(keyVersion)) throw new PermanentError('GCP_KMS_KEY_VERSION sin configurar o sin la version de la clave')
    this.keyId = keyVersion
    this.tokens = new GoogleTokenSource(parseServiceAccount(env.GOOGLE_SERVICE_ACCOUNT_JSON), 'https://www.googleapis.com/auth/cloudkms')
  }

  /** La publica de la clave (getPublicKey), en base64 de los 32 bytes: la que va al esqueleto. */
  async publicKey(): Promise<string> {
    if (this.cachedPublic) return this.cachedPublic
    const body = await requestJson<{ pem: string; algorithm: string; pemCrc32c?: string; name?: string }>(
      'Google Cloud KMS',
      `${API}/${this.keyId}/publicKey`,
      { headers: { Authorization: `Bearer ${await this.tokens.token()}` } }
    )
    if (body.algorithm !== 'EC_SIGN_ED25519') throw new PermanentError(`la clave de KMS es ${body.algorithm}, no EC_SIGN_ED25519`)
    if (body.name && body.name !== this.keyId) throw new PermanentError(`KMS devolvio la publica de otra clave: ${body.name}`)
    if (body.pemCrc32c !== undefined && Number(body.pemCrc32c) !== crc32c(Buffer.from(body.pem, 'utf-8'))) {
      throw new RetryableError('la publica de KMS llego danada (CRC32C)')
    }
    this.cachedPublic = rawPublicKey(createPublicKey(body.pem))
    return this.cachedPublic
  }

  async sign(message: Buffer): Promise<Buffer> {
    const body = await requestJson<{ signature: string; signatureCrc32c?: string; verifiedDataCrc32c?: boolean; name?: string }>(
      'Google Cloud KMS',
      `${API}/${this.keyId}:asymmetricSign`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${await this.tokens.token()}` },
        json: { data: message.toString('base64'), dataCrc32c: String(crc32c(message)) },
      }
    )
    if (body.verifiedDataCrc32c !== true) throw new RetryableError('KMS no confirmo el CRC32C de lo firmado')
    if (body.name && body.name !== this.keyId) throw new PermanentError(`KMS firmo con otra clave: ${body.name}`)
    const signature = Buffer.from(body.signature, 'base64')
    if (body.signatureCrc32c !== undefined && Number(body.signatureCrc32c) !== crc32c(signature)) {
      throw new RetryableError('la firma de KMS llego danada (CRC32C)')
    }
    if (signature.length !== 64) throw new PermanentError(`la firma de KMS tiene ${signature.length} bytes, no 64`)
    // Antes de fiarse: la firma tiene que verificar con la publica de la clave.
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(await this.publicKey(), 'base64')])
    if (!verify(null, message, createPublicKey({ key: spki, format: 'der', type: 'spki' }), signature)) {
      throw new PermanentError('la firma de KMS no verifica con su publica')
    }
    return signature
  }
}
