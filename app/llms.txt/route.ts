import es from '@/messages/es.json'
import en from '@/messages/en.json'
import { offerStatus } from '../[locale]/precios/offer-status'
import { buildLlmsTxt } from './llms'

// /llms.txt, con la oferta y los textos de la web (ver llms.ts). Se rehace cada 5 minutos, como
// /precios: sin plazas de lanzamiento, solo el precio de lista.
export const revalidate = 300

export async function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://pymaticlabs.com'
  const { launchOpen } = await offerStatus()
  return new Response(buildLlmsTxt({ es, en, baseUrl, launchOpen }), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
