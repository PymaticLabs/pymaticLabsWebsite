import type { Metadata } from 'next'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Download, FileCheck2, Laptop, Monitor, Network } from 'lucide-react'
import ZoneFrame from '@/components/zone/zone-frame'
import { ButtonLink, Card, Notice, PageTitle } from '@/components/zone/zone-ui'
import { getDelivery } from '@/lib/delivery/container'
import { formatDate } from '@/lib/delivery/emails'
import { generatePageMetadata } from '@/lib/metadata'
import { companyParam, loadZone } from '@/lib/zone-page'
import { downloadGroups, formatBytes, type DownloadGroupKind } from '@/lib/zone-view'

// Las descargas de la ultima version (una sola linea: todos bajan la ultima, con la seguridad).
// Cada boton va a /api/zone/downloads/<id>, que comprueba el acceso y firma en ese momento un
// enlace del almacen privado que caduca en minutos. Nunca un enlace publico ni guardado en la pagina.

export const dynamic = 'force-dynamic'

type Params = Promise<{ locale: string }>

const ICONS: Record<DownloadGroupKind, typeof Laptop> = { mac: Laptop, windows: Monitor, registry: Network, extra: FileCheck2 }

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { locale } = await params
  const t = await getTranslations({ locale, namespace: 'zone' })
  return generatePageMetadata({ title: t('downloads.title'), description: t('meta.description'), path: '/zona/descargas', locale, noindex: true })
}

export default async function DescargasPage({ params, searchParams }: { params: Params; searchParams: Promise<{ empresa?: string }> }) {
  const { locale } = await params
  const { empresa } = await searchParams
  setRequestLocale(locale)
  const state = await loadZone(locale, '/zona/descargas', empresa ?? null)
  if (state.status === 'closed') return <ZoneFrame locale={locale} state={state} section="descargas" />

  const t = await getTranslations({ locale, namespace: 'zone.downloads' })
  const loc = locale === 'en' ? 'en' : 'es'
  const { data } = state
  const version = data.version
  const company = companyParam(data)
  const href = (id: string) => `/api/zone/downloads/${encodeURIComponent(id)}${company ? `?company=${encodeURIComponent(company)}` : ''}`

  return (
    <ZoneFrame locale={locale} state={state} section="descargas">
      <PageTitle title={t('title')} intro={t('intro')} />

      {!version ? (
        <div className="mt-8 max-w-3xl">
          <Notice role="status">{t('none')}</Notice>
        </div>
      ) : (
        <div className="mt-8 space-y-6">
          <div className="max-w-3xl rounded-2xl bg-paper-2 p-6">
            <p className="text-xl font-semibold text-ink">{t('version', { version: version.id })}</p>
            <p className="mt-1 text-body">{t('published', { date: formatDate(version.publishedAt.slice(0, 10), loc) })}</p>
            <p className="mt-4 whitespace-pre-line text-base text-body">{loc === 'en' ? version.notes.en : version.notes.es}</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {downloadGroups(version.files, loc).map((group) => (
              <Card key={group.kind} icon={ICONS[group.kind]} title={t(`groups.${group.kind}.title`)}>
                <p>{t(`groups.${group.kind}.text`)}</p>
                <ul className="space-y-4 pt-1">
                  {group.files.map((file) => {
                    const size = formatBytes(file.sizeBytes, loc)
                    return (
                      <li key={file.id} className="rounded-xl border border-line p-3 sm:p-4">
                        <ButtonLink href={href(file.id)} variant={group.kind === 'extra' ? 'outline' : 'primary'}>
                          <Download className="h-5 w-5 shrink-0" aria-hidden="true" />
                          {group.kind === 'extra' ? (
                            <span className="break-all">{file.fileName}</span>
                          ) : file.lang ? (
                            t('button', { what: t(`groups.${group.kind}.short`), lang: t(`langs.${file.lang}`) })
                          ) : (
                            t('buttonNoLang', { what: t(`groups.${group.kind}.short`) })
                          )}
                        </ButtonLink>
                        <p className="mt-3 text-sm text-muted">
                          {group.kind !== 'extra' && <span className="break-all">{file.fileName}</span>}
                          {size && <span className="whitespace-nowrap">{group.kind !== 'extra' && ' · '}{size}</span>}
                        </p>
                        {file.sha256 && (
                          <details className="mt-2 text-sm">
                            <summary className="min-h-11 cursor-pointer py-2 text-brand">{t('checksum')}</summary>
                            <code className="block break-all rounded-md bg-paper-2 px-3 py-2 font-mono text-xs text-ink">{file.sha256}</code>
                          </details>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </Card>
            ))}
          </div>

          <div className="max-w-3xl">
            <Notice>{t('expiry', { minutes: Math.max(1, Math.round(getDelivery().config.downloadTtlSeconds / 60)) })}</Notice>
          </div>
        </div>
      )}
    </ZoneFrame>
  )
}
