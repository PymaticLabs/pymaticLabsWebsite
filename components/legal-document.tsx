import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { renderContent } from '@/lib/markdown'
import { localePath } from '@/lib/i18n'
import { LEGAL_VERSIONS as VERSIONS, type LegalDocumentId } from '@/lib/legal-versions'

// Las fechas de cada version viven en lib/legal-versions.ts (la de las condiciones va tambien en
// cada compra).
export type { LegalDocumentId }

// Todos los textos legales son borradores hasta que los revise un abogado (traspaso, seccion 6): la
// venta se abre con la marca, en los dos idiomas (Sergio, 27-10-2026). Todos tienen su version
// inglesa, que dice al final que prevalece la castellana; si un dia falta una, en ingles va el
// castellano, con un aviso que dice que es el unico que vale y lo enlaza.
export default async function LegalDocument({ id, locale }: { id: LegalDocumentId; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'legal' })
  const { html, fallback } = renderContent('legal', locale, id)
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(VERSIONS[id])
  )

  return (
    <div className="pt-32 pb-20">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t(`titles.${id}`)}</h1>
          <Badge variant="accent">{t('draftBadge')}</Badge>
        </div>
        <p className="text-sm text-muted">{t('lastUpdated', { date })}</p>
        <p className="mt-4 rounded-xl bg-paper-2 px-4 py-3 text-sm text-body">{t('draftNote')}</p>
        {fallback && (
          <p className="mt-3 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-sm text-ink" lang={locale}>
            {t.rich('fallbackNote', {
              link: (chunks) => (
                <Link href={localePath('es', `/${id}`)} hrefLang="es" className="font-semibold text-brand underline underline-offset-4">
                  {chunks}
                </Link>
              ),
            })}
          </p>
        )}
        <div className="prose-content mt-8" lang={fallback ? 'es' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  )
}
