// La publica de la clave de licencias de la web, leida de Google Cloud KMS (getPublicKey), en el
// formato de esqueleto/firmas/licencias.pub: base64 de los 32 bytes. Es la que Eric anade al
// esqueleto (que aceptara varias publicas) y la que va en LICENSE_WEB_PUBLIC_KEY.
//
//   node --env-file=.env.local scripts/clave-web-publica.mts
//
// Necesita GCP_KMS_KEY_VERSION y GOOGLE_SERVICE_ACCOUNT_JSON (con publicKeyViewer). Lo mismo, con
// gcloud: gcloud kms keys versions get-public-key 1 --key <clave> --keyring <anillo>
//   --location europe-west1 --output-file web.pem (y su DER sin los 12 bytes de cabecera, en base64).

import { GcpKmsSigner } from '../lib/delivery/adapters/gcp-kms-signer.ts'

const signer = new GcpKmsSigner(process.env)
const publicKey = await signer.publicKey()
console.log(`# Clave de licencias de la web (${signer.keyId})`)
console.log(publicKey)
const expected = process.env.LICENSE_WEB_PUBLIC_KEY
if (expected && expected !== publicKey) {
  console.error('AVISO: no es la de LICENSE_WEB_PUBLIC_KEY: la web no firmara con esta clave')
  process.exitCode = 1
}
