import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return { title: t('cookiesTitle') }
}

export default async function PoliticaCookiesPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-ink mb-2">{t('cookiesTitle')}</h1>
        <p className="text-sm text-body mb-8">{t('lastUpdated')}</p>

        <div className="space-y-6 text-body">
          <section>
            <h2 className="text-xl font-semibold text-ink">1. ¿Qué son las cookies?</h2>
            <p>Las cookies son pequeños archivos de texto que se almacenan en su dispositivo cuando visita un sitio web. Permiten al sitio web recordar sus acciones y preferencias durante un período de tiempo.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">2. Cookies que utilizamos</h2>
            <p>Este sitio web utiliza únicamente cookies técnicas estrictamente necesarias para su funcionamiento:</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-[#E2E8F0]">
                <thead>
                  <tr className="bg-[#FAFAF9]">
                    <th className="border border-[#E2E8F0] px-3 py-2 text-left text-ink">Cookie</th>
                    <th className="border border-[#E2E8F0] px-3 py-2 text-left text-ink">Finalidad</th>
                    <th className="border border-[#E2E8F0] px-3 py-2 text-left text-ink">Duración</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border border-[#E2E8F0] px-3 py-2">NEXT_LOCALE</td>
                    <td className="border border-[#E2E8F0] px-3 py-2">Guardar preferencia de idioma</td>
                    <td className="border border-[#E2E8F0] px-3 py-2">1 año</td>
                  </tr>
                  <tr>
                    <td className="border border-[#E2E8F0] px-3 py-2">pymatic_theme</td>
                    <td className="border border-[#E2E8F0] px-3 py-2">Guardar preferencia de tema (claro/oscuro)</td>
                    <td className="border border-[#E2E8F0] px-3 py-2">1 año</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">3. Cómo desactivar las cookies</h2>
            <p>Puede configurar su navegador para que no acepte cookies. Sin embargo, esto podría afectar al funcionamiento del sitio web.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-ink">4. Más información</h2>
            <p>Para más información sobre el uso de sus datos personales, consulte nuestra <a href="/politica-privacidad" className="text-ink underline">Política de Privacidad</a>.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
