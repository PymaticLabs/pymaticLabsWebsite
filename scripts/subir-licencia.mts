// Sube la licencia que Eric firmo en su Mac para una compra (LICENSE_MODE=manual). La web la
// comprueba con la publica del Mac y con la compra (NIF, modalidad, equipo y soporte_hasta), la
// guarda, se la manda al cliente por correo (en un .zip, como siempre) y la deja en su zona de socio.
//
//   node --env-file=.env.local scripts/subir-licencia.mts --compra <id o pi_...> --fichero <licencia.cerebro-licencia> [--web https://pymaticlabs.com]
//   node --env-file=.env.local scripts/subir-licencia.mts --pendientes [--web ...]
//
// Necesita ADMIN_SECRET (el de esa web) y su direccion: --web, o DELIVERY_SITE_URL /
// NEXT_PUBLIC_SITE_URL. Sale con error si la web no la acepta, y dice por que.
//
// Solo para probar el camino con un pago de prueba, en la web de pruebas (con
// LICENSE_MANUAL_PUBLIC_KEY de una clave de pruebas): --crear-clave-prueba crea esa clave, y
// --firmar-prueba firma la licencia pedida con ella (LICENSE_TEST_SEED) y la sube. Nunca con la
// clave del Mac: esa solo la usa firmar_licencia.py.

import fs from 'node:fs'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { LICENSES_PUBLIC_KEY, formatLicenseId, privateKeyFromSeed, rawPublicKey, signLicense, type LicenseData } from '../lib/license.ts'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? null) : null
}

// Una Preview con la proteccion de Vercel: el secreto de Protection Bypass for Automation, en .env.local.
function bypassHeader(): Record<string, string> {
  const secret = process.env.VERCEL_BYPASS_SECRET?.trim()
  return secret ? { 'x-vercel-protection-bypass': secret } : {}
}
const has = (name: string) => process.argv.includes(name)

interface RequestView {
  compra: string
  tipo: string
  estado: string
  prueba: boolean
  plazas: number
  pedida: string
  campos: Omit<LicenseData, 'id'>
}

async function main() {
  if (has('--crear-clave-prueba')) {
    const { privateKey } = generateKeyPairSync('ed25519')
    const der = privateKey.export({ format: 'der', type: 'pkcs8' })
    console.log('Una clave de PRUEBAS para firmar licencias de pagos de prueba (nunca para clientes de verdad):')
    console.log(`  LICENSE_TEST_SEED=${der.subarray(der.length - 32).toString('base64')}   -> solo en tu .env.local`)
    console.log(`  LICENSE_MANUAL_PUBLIC_KEY=${rawPublicKey(privateKey)}   -> en Preview de Vercel, nunca en Production`)
    return
  }

  const site = (arg('--web') || process.env.DELIVERY_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
  const admin = process.env.ADMIN_SECRET
  if (!site || !admin) throw new Error('faltan ADMIN_SECRET y la direccion de la web (--web https://pymaticlabs.com)')
  const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${site}${path}`, { ...init, headers: { Authorization: `Bearer ${admin}`, ...bypassHeader(), ...(init.headers as Record<string, string>) } })
    return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> }
  }

  if (has('--pendientes')) {
    const { status, body } = await api('/api/admin/licenses')
    if (status !== 200) throw new Error(`la web contesta ${status}: ${body.error ?? 'sin detalle'}`)
    const list = body.pedidas as RequestView[]
    console.log(`${list.length} licencia(s) sin firmar en ${site} (modo ${body.modo}, clave ${body.clave === 'production' ? 'del Mac' : 'de pruebas'})`)
    for (const r of list) {
      console.log(`\n  compra ${r.compra}${r.prueba ? ' (PAGO DE PRUEBA)' : ''}, pedida ${r.pedida.slice(0, 16).replace('T', ' ')} UTC, ${r.tipo === 'one_time' ? 'pago único' : 'cobro del mensual'}`)
      console.log(`    ${JSON.stringify(r.campos)}`)
    }
    return
  }

  const compra = arg('--compra')
  if (!compra || (!arg('--fichero') && !has('--firmar-prueba'))) {
    throw new Error('uso: --compra <id o pi_...> --fichero <licencia.cerebro-licencia> [--web <url>]  (o --pendientes)')
  }

  let content: string
  if (has('--firmar-prueba')) {
    const seed = process.env.LICENSE_TEST_SEED?.trim()
    if (!seed) throw new Error('falta LICENSE_TEST_SEED (scripts/subir-licencia.mts --crear-clave-prueba)')
    const publicKey = rawPublicKey(privateKeyFromSeed(seed))
    if (publicKey === LICENSES_PUBLIC_KEY) throw new Error('esa es la clave del Mac: las licencias de verdad se firman con firmar_licencia.py, no aqui')
    const { status, body } = await api(`/api/admin/licenses?compra=${encodeURIComponent(compra)}`)
    if (status !== 200) throw new Error(`la web contesta ${status}: ${body.error ?? 'sin detalle'}`)
    const pedida = body.pedida as RequestView
    // Un numero de prueba fijo por compra (repetir la subida da la misma licencia), del 4000 al 4999.
    const number = Number(arg('--numero')) || 4000 + (Number.parseInt(createHash('sha256').update(pedida.compra).digest('hex').slice(0, 8), 16) % 1000)
    content = signLicense({ id: formatLicenseId(Number(pedida.campos.emitida.slice(0, 4)), number), ...pedida.campos }, seed, publicKey).text
    console.log('Firmada con la clave de PRUEBAS (solo vale en la web de pruebas).')
  } else {
    content = fs.readFileSync(arg('--fichero')!, 'utf-8')
  }

  let license: LicenseData
  try {
    license = (JSON.parse(content) as { licencia: LicenseData }).licencia
  } catch {
    throw new Error('el fichero no es una licencia (.cerebro-licencia, JSON)')
  }
  console.log(`Subiendo ${license?.id} (${license?.cliente}, ${license?.nif}, ${license?.modalidad}${license?.equipo ? ' con equipo' : ''}, soporte hasta ${license?.soporte_hasta}) a ${site}`)
  const { status, body } = await api(`/api/admin/licenses?compra=${encodeURIComponent(compra)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: content,
  })
  if (status !== 200) {
    console.error(`NO SE HA SUBIDO (${status}): ${body.error ?? 'sin detalle'}`)
    process.exitCode = 1
    return
  }
  for (const warning of (body.warnings as string[]) ?? []) console.warn(`  aviso: ${warning}`)
  console.log(
    body.already
      ? `OK: la licencia ${body.licenseId} ya estaba subida para esa compra; no se manda nada otra vez.`
      : `OK: licencia ${body.licenseId} guardada para ${body.company}. El cliente la recibe por correo y la tiene en su zona de socio.`
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
