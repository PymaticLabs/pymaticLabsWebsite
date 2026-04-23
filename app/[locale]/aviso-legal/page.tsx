import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return { title: t('avisoTitle') }
}

export default async function AvisoLegalPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-[#1E3A5F] mb-2">{t('avisoTitle')}</h1>
        <p className="text-sm text-[#64748B] mb-8">{t('lastUpdated')}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-[#64748B]">
          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">1. Datos identificativos</h2>
            <p>En cumplimiento con el deber de información recogido en el artículo 10 de la Ley 34/2002, de 11 de julio, de Servicios de la Sociedad de la Información y del Comercio Electrónico, a continuación se reflejan los datos identificativos:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Denominación social:</strong> {t('denominacionSocial')}</li>
              <li><strong>CIF/NIF:</strong> {t('CIF/NIF')}</li>
              <li><strong>Domicilio social:</strong> Castellón, España</li>
              <li><strong>Email:</strong> info@pymaticlabs.com</li>
              <li><strong>Web:</strong> https://pymaticlabs.com</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">2. Objeto</h2>
            <p>El presente Aviso Legal regula el uso del sitio web pymaticlabs.com, del que es titular Pymatic Labs. La navegación por el sitio web atribuye la condición de usuario del mismo e implica la aceptación plena y sin reservas de todas y cada una de las disposiciones incluidas en este Aviso Legal.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">3. Propiedad intelectual e industrial</h2>
            <p>Pymatic Labs es titular o, en su caso, cuenta con las licencias correspondientes sobre los derechos de explotación de propiedad intelectual e industrial de la web, así como de todos los contenidos ofrecidos en la misma, incluyendo la propia plataforma tecnológica sobre la que opera.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">4. Exclusión de responsabilidades</h2>
            <p>Pymatic Labs no se hace responsable de los daños y perjuicios de cualquier naturaleza que pudieran ocasionar, a título enunciativo: errores u omisiones en los contenidos, falta de disponibilidad del portal o la transmisión de virus o programas maliciosos.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">5. Legislación aplicable</h2>
            <p>La relación entre Pymatic Labs y el Usuario se regirá por la normativa española vigente y cualquier controversia se someterá a los Juzgados y Tribunales de Castellón.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
