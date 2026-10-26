import { NextRequest, NextResponse, after } from 'next/server'
import { hasSecret } from '@/lib/api-route'
import { getDelivery } from '@/lib/delivery/container'
import { runJobs } from '@/lib/delivery/jobs'
import { VersionError, publishVersion, type PublishVersionInput } from '@/lib/delivery/versions'

// Version nueva del esqueleto, solo para PymaticLabs (Authorization: Bearer <ADMIN_SECRET>). Sus
// ficheros ya estan en el bucket releases (scripts/publicar-version.mts los sube y llama aqui).
// Con "announce": true, cada persona de cada cliente recibe un correo con las notas.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(request: NextRequest) {
  if (!hasSecret(request, 'ADMIN_SECRET')) return NextResponse.json({ error: 'no autorizado' }, { status: 401 })
  let input: PublishVersionInput
  try {
    input = (await request.json()) as PublishVersionInput
  } catch {
    return NextResponse.json({ error: 'se esperaba JSON' }, { status: 400 })
  }
  const delivery = getDelivery()
  try {
    const result = await publishVersion(delivery, { ...input, files: input.files ?? [], announce: input.announce === true })
    if (result.announced) after(() => runJobs(delivery, { budgetMs: 50_000 }).catch((error) => console.error('[entrega] cola:', error)))
    return NextResponse.json({ version: result.version.id, files: result.files.length, announced: result.announced })
  } catch (error) {
    if (error instanceof VersionError) return NextResponse.json({ error: error.message }, { status: 400 })
    console.error('[versiones]', error)
    return NextResponse.json({ error: 'error interno' }, { status: 500 })
  }
}
