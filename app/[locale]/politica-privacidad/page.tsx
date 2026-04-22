import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })
  return { title: t('privacidadTitle') }
}

export default async function PoliticaPrivacidadPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'legal' })

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold text-[#1E3A5F] mb-2">{t('privacidadTitle')}</h1>
        <p className="text-sm text-[#64748B] mb-8">{t('lastUpdated')}</p>

        <div className="prose prose-slate max-w-none space-y-6 text-[#64748B]">
          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">1. Responsable del tratamiento</h2>
            <ul className="list-disc pl-6 space-y-1">
              <li><strong>Denominación:</strong> {t('denominacionSocial')}</li>
              <li><strong>Email:</strong> hola@pymaticlabs.com</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">2. Finalidad del tratamiento</h2>
            <p>Los datos personales que nos facilite a través del formulario de contacto se tratarán con las siguientes finalidades:</p>
            <ul className="list-disc pl-6 space-y-1">
              <li>Atender las consultas realizadas</li>
              <li>Enviar información sobre nuestros servicios cuando así lo solicite</li>
              <li>Gestionar la relación comercial si procede</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">3. Base jurídica</h2>
            <p>El tratamiento de sus datos está basado en el consentimiento que usted nos presta al cumplimentar el formulario de contacto (art. 6.1.a RGPD) y/o en la ejecución de un contrato o precontrato (art. 6.1.b RGPD).</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">4. Conservación de datos</h2>
            <p>Los datos se conservarán mientras dure la relación comercial o durante los años necesarios para cumplir con las obligaciones legales.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">5. Destinatarios</h2>
            <p>No se cederán datos a terceros salvo obligación legal. Utilizamos Resend (proveedor de email) como encargado del tratamiento.</p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-[#1E3A5F]">6. Derechos</h2>
            <p>Puede ejercer sus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad enviando un email a hola@pymaticlabs.com con asunto &quot;Protección de datos&quot;.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
