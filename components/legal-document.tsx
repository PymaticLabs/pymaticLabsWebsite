import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { ChevronDown } from 'lucide-react'
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
  const content = renderContent('legal', locale, id)
  const { html, sections } = withSections(content.html)
  const { fallback } = content
  const date = new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(VERSIONS[id])
  )

  return (
    <div className="pt-24 pb-16 sm:pt-32 sm:pb-20">
      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3 mb-2">
          <h1 className="text-balance text-3xl sm:text-4xl font-bold tracking-tight text-ink">{t(`titles.${id}`)}</h1>
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
        {/* El indice: cerrado, para no empujar el texto; abierto, un enlace a cada apartado */}
        {sections.length > 2 && (
          <details className="group mt-6 rounded-2xl bg-paper-2" lang={fallback ? 'es' : undefined}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
              {t('toc', { count: sections.length })}
              <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ol className="px-2 pb-2">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex min-h-11 items-center rounded-xl px-2 py-1.5 text-[15px] leading-snug text-body transition-colors hover:bg-surface hover:text-brand"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        )}
        <div className="prose-content mt-8" lang={fallback ? 'es' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
      </article>
    </div>
  )
}

/** El texto de un titulo en HTML: sin etiquetas y con las entidades que pone marked, deshechas. */
function plainText(html: string) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/**
 * Cada apartado (h2) con un id, para el indice de arriba: un texto de 20 o 30 pantallas en el movil no se
 * recorre a dedo. El id sale del titulo, sin tildes («1-quien-vende-contacto-y-definiciones»).
 */
function withSections(source: string) {
  const sections: { id: string; title: string }[] = []
  const used = new Set<string>()
  const html = source.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, inner: string) => {
    const title = plainText(inner)
    const base =
      title
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'apartado'
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    sections.push({ id, title })
    return `<h2 id="${id}">${inner}</h2>`
  })
  return { html, sections }
}
