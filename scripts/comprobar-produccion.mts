// La comprobacion antes de abrir la venta: con el entorno de produccion, que esten todas las
// variables de los modos elegidos (LICENSE_MODE, HOLDED_INVOICE_MODE...) y que cada servicio conteste
// lo que la entrega necesita (Supabase con sus migraciones y buckets privados, Stripe con el webhook,
// Tax, precios y cupones, Brevo con el remitente, Holded, Cal.com, KMS si firma la web, y la web
// publicada con el boton Entrar). Solo lee: ni cobra, ni manda correos, ni factura. Nunca ensena el
// valor de un secreto. Sale con error si falta algo.
//
// Con el entorno en un fichero (vercel env pull --environment=production, o a mano):
//   node --env-file=.env.produccion scripts/comprobar-produccion.mts [--pruebas]
// O preguntando a la web desplegada, que tiene sus variables (las Sensitive no se pueden bajar):
//   node --env-file=.env.local scripts/comprobar-produccion.mts --web https://pymaticlabs.com
//   (con el ADMIN_SECRET de esa web en .env.local)
// --pruebas: un entorno de pruebas (Stripe de prueba, LICENSE_MANUAL_PUBLIC_KEY de pruebas).

import { formatReport, productionCheck, type HealthReport } from '../lib/delivery/health.ts'

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i > 0 ? (process.argv[i + 1] ?? null) : null
}

async function main() {
  const test = process.argv.includes('--pruebas')
  const web = arg('--web')?.replace(/\/+$/, '')
  let report: HealthReport
  if (web) {
    const admin = process.env.ADMIN_SECRET
    if (!admin) throw new Error('falta ADMIN_SECRET (el de esa web) en el entorno')
    const res = await fetch(`${web}/api/admin/health${test ? '?pruebas=1' : ''}`, { headers: { Authorization: `Bearer ${admin}` } })
    if (res.status === 401) throw new Error(`${web} dice 401: ADMIN_SECRET no es el de esa web`)
    if (!res.ok) throw new Error(`${web}/api/admin/health contesta ${res.status}`)
    report = (await res.json()) as HealthReport
  } else {
    report = await productionCheck(process.env, { expectLive: !test, checkSite: true })
  }
  console.log(formatReport(report))
  process.exitCode = report.ready ? 0 : 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
