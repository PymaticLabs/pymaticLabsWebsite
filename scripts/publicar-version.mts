// Sube una version del esqueleto al almacen privado de la entrega y la publica en la web, con el
// correo a cada cliente (como-publicar-una-version-del-esqueleto, paso 5).
//
//   node --env-file=.env.local scripts/publicar-version.mts --version 1.2.0 --dir <SALIDA> \
//     --notas <NOTAS> --notas-en <NOTAS_EN> [--sin-aviso]
//
// Lee de <SALIDA> las dos extensiones, el instalador del registro, sus .sha256 y sus SBOM (los que
// esten), comprueba cada sha256, los sube a releases/versiones/<VERSION>/ y llama a
// /api/admin/versions. Necesita SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_SECRET y
// DELIVERY_SITE_URL (o NEXT_PUBLIC_SITE_URL). Ficheros de mas de 50 MB: el plan de Supabase tiene
// que admitirlos (Storage > Settings > Upload file size limit).

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i > 0 ? process.argv[i + 1] ?? null : null
}

const version = arg('--version')
const dir = arg('--dir')
const notesEs = arg('--notas')
const notesEn = arg('--notas-en')
if (!version || !/^\d+\.\d+\.\d+$/.test(version) || !dir || !notesEs || !notesEn) {
  throw new Error('uso: --version X.Y.Z --dir <SALIDA> --notas <fichero> --notas-en <fichero> [--sin-aviso]')
}
const supabase = process.env.SUPABASE_URL?.replace(/\/+$/, '')
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
const admin = process.env.ADMIN_SECRET
const site = (process.env.DELIVERY_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
if (!supabase || !serviceRole || !admin || !site) throw new Error('faltan SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_SECRET o la URL de la web')

const files = [
  { kind: 'mac', name: `cerebro-digital-${version}.mcpb` },
  { kind: 'checksum', name: `cerebro-digital-${version}.mcpb.sha256` },
  { kind: 'sbom', name: `cerebro-digital-${version}.cdx.json` },
  { kind: 'windows', name: `cerebro-digital-${version}-windows.mcpb` },
  { kind: 'checksum', name: `cerebro-digital-${version}-windows.mcpb.sha256` },
  { kind: 'sbom', name: `cerebro-digital-${version}-windows.cdx.json` },
  { kind: 'registry', name: `cerebro-registro-${version}-windows.zip`, teamOnly: true },
  { kind: 'checksum', name: `cerebro-registro-${version}-windows.zip.sha256`, teamOnly: true },
]

async function main() {
  const published = []
  for (const file of files) {
    const local = path.join(dir!, file.name)
    if (!fs.existsSync(local)) {
      if (file.kind === 'mac' || file.kind === 'windows') throw new Error(`falta ${local}`)
      console.log(`  (sin ${file.name})`)
      continue
    }
    const content = fs.readFileSync(local)
    const sha256 = createHash('sha256').update(content).digest('hex')
    const declared = path.join(dir!, `${file.name}.sha256`)
    if (fs.existsSync(declared) && !fs.readFileSync(declared, 'utf-8').startsWith(sha256)) throw new Error(`${file.name}: el sha256 no es el de su .sha256`)
    const storagePath = `versiones/${version}/${file.name}`
    const res = await fetch(`${supabase}/storage/v1/object/releases/${storagePath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceRole}`, apikey: serviceRole!, 'Content-Type': 'application/octet-stream', 'x-upsert': 'true' },
      body: content,
    })
    if (!res.ok) throw new Error(`subir ${file.name}: ${res.status} ${await res.text()}`)
    published.push({ kind: file.kind, fileName: file.name, storagePath, sizeBytes: content.length, sha256, teamOnly: Boolean(file.teamOnly) })
    console.log(`  subido ${file.name} (${(content.length / 1e6).toFixed(1)} MB)`)
  }
  const res = await fetch(`${site}/api/admin/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version,
      notesEs: fs.readFileSync(notesEs!, 'utf-8'),
      notesEn: fs.readFileSync(notesEn!, 'utf-8'),
      files: published,
      announce: !process.argv.includes('--sin-aviso'),
    }),
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`publicar: ${res.status} ${body}`)
  console.log(`OK: ${body}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
