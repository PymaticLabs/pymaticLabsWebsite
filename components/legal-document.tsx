import { getTranslations } from 'next-intl/server'
import { Badge } from '@/components/ui/badge'
import { renderContent } from '@/lib/markdown'

export type LegalDocumentId =
  | 'aviso-legal'
  | 'politica-privacidad'
  | 'politica-cookies'
  | 'condiciones'
  | 'privacidad-producto'

// Todos los textos legales son borradores hasta que los revise un abogado (traspaso, seccion 6).
export default async function LegalDocument({ id, locale }: { id: LegalDocumentId; locale: string }) {
  const t = await getTranslations({ locale, namespace: 'legal' })
  const { html, fallback } = renderContent('legal', locale, id)

  return (
    <div className="pt-32 pb-20">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t(`titles.${id}`)}</h1>
          <Badge variant="accent">{t('draftBadge')}</Badge>
        </div>
        <p className="text-sm text-muted">{t('lastUpdated')}</p>
        <p className="mt-4 rounded-xl bg-paper-2 px-4 py-3 text-sm text-body">{t('draftNote')}</p>
        {fallback && (
          <p className="mt-3 rounded-xl border border-brand/20 bg-brand-soft px-4 py-3 text-sm text-ink" lang="en">
            {t('fallbackNote')}
          </p>
        )}
        <div className="prose-content mt-8" lang={fallback ? 'es' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  )
}
