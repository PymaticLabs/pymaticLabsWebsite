// Version nueva del esqueleto (como-publicar-una-version-del-esqueleto, paso 5): sus ficheros ya
// estan en el almacen privado (bucket releases, versiones/<X.Y.Z>/...: los sube
// scripts/publicar-version.mts); aqui se apunta la version y, si se pide, se avisa por correo a
// cada persona de cada cliente con acceso. Una sola linea: todos bajan la ultima.
//
// Y la lista de anuladas para el esqueleto: licencias y claves que el cerebro debe rechazar.

import { compareVersions } from './adapters/memory-repository.ts'
import { fingerprint } from './limits.ts'
import { sha256Hex } from './util.ts'
import type { Delivery } from './container.ts'
import type { NewJob, VersionFileKind } from './types.ts'

const VERSION_RE = /^\d+\.\d+\.\d+$/
const KINDS: VersionFileKind[] = ['mac', 'windows', 'registry', 'sbom', 'checksum', 'other']

export interface PublishVersionInput {
  version: string
  notesEs: string
  notesEn: string
  files: { kind: VersionFileKind; lang?: 'es' | 'en' | null; fileName: string; storagePath: string; sizeBytes?: number | null; sha256?: string | null; teamOnly?: boolean }[]
  announce: boolean
}

export class VersionError extends Error {}

export async function publishVersion(d: Delivery, input: PublishVersionInput) {
  if (!VERSION_RE.test(input.version)) throw new VersionError(`version ${input.version}: no es X.Y.Z`)
  if (!input.notesEs.trim() || !input.notesEn.trim()) throw new VersionError('faltan las notas en castellano o en ingles')
  const latest = await d.repo.getLatestVersion()
  if (latest && compareVersions(input.version, latest.version.id) < 0) throw new VersionError(`la ultima publicada es la ${latest.version.id}`)
  const prefix = `versiones/${input.version}/`
  const missing: string[] = []
  for (const file of input.files) {
    if (!KINDS.includes(file.kind)) throw new VersionError(`${file.fileName}: tipo ${file.kind} no vale`)
    if (!file.storagePath.startsWith(prefix) || file.storagePath.includes('..')) throw new VersionError(`${file.storagePath}: tiene que ir en ${prefix}`)
    if (file.sha256 && !/^[0-9a-f]{64}$/.test(file.sha256)) throw new VersionError(`${file.fileName}: sha256 no vale`)
    if (!(await d.storage.exists('releases', file.storagePath))) missing.push(file.storagePath)
  }
  if (missing.length) throw new VersionError(`no estan en el almacen: ${missing.join(', ')}`)
  if (!input.files.some((f) => f.kind === 'mac') || !input.files.some((f) => f.kind === 'windows')) {
    throw new VersionError('faltan la extension de Mac o la de Windows')
  }

  const version = await d.repo.upsertVersion({ id: input.version, notesEs: input.notesEs.trim(), notesEn: input.notesEn.trim() })
  const files = await d.repo.addVersionFiles(
    input.files.map((f) => ({
      versionId: input.version,
      kind: f.kind,
      lang: f.lang ?? null,
      fileName: f.fileName,
      storagePath: f.storagePath,
      sizeBytes: f.sizeBytes ?? null,
      sha256: f.sha256 ?? null,
      // El instalador del registro, solo con equipo.
      teamOnly: f.teamOnly ?? f.kind === 'registry',
    }))
  )

  let announced = 0
  if (input.announce && !version.announcedAt) {
    const jobs: NewJob[] = []
    for (const company of await d.repo.listActiveCompanies()) {
      for (const member of await d.repo.listMembers(company.id)) {
        jobs.push({
          // Con la huella del correo: nada personal en la clave (sale en el registro de Vercel).
          key: `announce:${input.version}:${fingerprint(d, member.email)}`,
          kind: 'announce',
          payload: { versionId: input.version, email: member.email, locale: company.locale, company: company.name },
        })
      }
    }
    await d.repo.enqueueJobs(jobs, d.clock())
    await d.repo.setVersionAnnounced(input.version, d.clock().toISOString())
    announced = jobs.length
  }
  return { version, files, announced }
}

/**
 * La lista de anuladas que viaja con cada version del esqueleto (cambio de Eric): las licencias
 * anuladas por devolucion o contracargo, y las claves de la web que ya no valen (LICENSE_REVOKED_KEYS).
 * Cada licencia va con la publica que la firmo y la huella (SHA-256) de su fichero: el esqueleto la
 * compara con esas, no solo con el id (asi nunca anula una del Mac de Eric con el mismo numero).
 */
export async function revocationList(d: Delivery, env: Record<string, string | undefined> = process.env) {
  const licenses = await d.repo.listRevokedLicenses()
  return {
    formato: 1,
    generada: d.clock().toISOString().slice(0, 10),
    licencias: licenses.map((l) => ({
      id: l.id,
      // refund, dispute (y las del mensual que caen con su pago unico: refund:<compra> -> refund).
      motivo: l.revokedReason?.split(':')[0] ?? null,
      desde: l.revokedAt?.slice(0, 10) ?? null,
      clave: l.publicKey,
      huella: sha256Hex(l.content),
    })),
    claves: (env.LICENSE_REVOKED_KEYS ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  }
}
