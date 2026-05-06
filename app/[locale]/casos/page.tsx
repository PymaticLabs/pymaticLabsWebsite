import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Clock, FileText, CheckCircle2 } from 'lucide-react'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'casos' })
  return { title: t('title'), description: t('subtitle') }
}

export default async function CasosPage({
  params,
}: {
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'casos' })
  const prefix = locale === 'en' ? '/en' : ''

  return (
    <div className="pt-24 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-16">
          <h1 className="text-4xl sm:text-5xl font-bold text-[#1E3A5F] mb-4">
            {t('title')}
          </h1>
          <p className="text-xl text-[#64748B] max-w-3xl mx-auto">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="md:col-span-1 border-2 border-[#1E3A5F] hover:shadow-lg transition-shadow">
            <CardContent className="p-6 space-y-4">
              <Badge variant="default" className="text-xs">
                {locale === 'es' ? 'Automatización operativa' : 'Operations automation'}
              </Badge>
              <h2 className="font-bold text-[#1E3A5F] text-lg">
                {locale === 'es'
                  ? 'Estación de servicio + bar · Castellón'
                  : 'Service station + bar · Castellón'}
              </h2>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-[#64748B]">
                  <Clock className="h-4 w-4 text-[#7A5C2E]" />
                  {locale === 'es' ? '~10h ahorradas/semana' : '~10h saved/week'}
                </div>
                <div className="flex items-center gap-2 text-sm text-[#64748B]">
                  <FileText className="h-4 w-4 text-[#7A5C2E]" />
                  {locale === 'es' ? '4 automatizaciones activas' : '4 active automations'}
                </div>
                <div className="flex items-center gap-2 text-sm text-[#64748B]">
                  <CheckCircle2 className="h-4 w-4 text-[#7A5C2E]" />
                  {locale === 'es' ? '0 errores manuales en contabilidad' : '0 manual accounting errors'}
                </div>
              </div>
              <Link
                href={`${prefix}/casos/estacion-servicio-castellon`}
                className="inline-flex items-center text-sm font-medium text-[#1E3A5F] hover:underline"
              >
                {t('readCase')}
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
