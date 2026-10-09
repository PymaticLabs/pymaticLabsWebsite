import { useTranslations, useLocale } from 'next-intl'
import { Check, Users } from 'lucide-react'
import { formatPrice, type Modality } from '@/lib/offer'
import { cn } from '@/lib/utils'

interface ModalityCardProps {
  modality: Modality
  /** En la pagina de precios se ven los extras de cada modalidad. */
  extras?: string[]
  highlighted?: boolean
  children?: React.ReactNode
}

export default function ModalityCard({ modality, extras, highlighted, children }: ModalityCardProps) {
  const t = useTranslations('offer')
  const locale = useLocale()

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl border bg-white p-6',
        highlighted ? 'border-brand ring-1 ring-brand shadow-lg shadow-brand/10' : 'border-line'
      )}
    >
      <h3 className="text-lg font-semibold text-ink">{t(`modalities.${modality.id}.name`)}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <Users className="h-4 w-4" aria-hidden="true" />
        {t(`modalities.${modality.id}.people`)}
      </p>
      <p className="mt-3 text-sm text-body leading-relaxed min-h-[2.75rem]">
        {t(`modalities.${modality.id}.tagline`)}
      </p>

      <div className="mt-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-brand">{t('launch')}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-4xl font-bold tracking-tight text-ink">
            {formatPrice(modality.launchPrice, locale)}
          </span>
          <span className="text-sm text-muted">{t('noVat')}</span>
        </p>
        <p className="mt-1 text-sm text-muted">
          {t('list')}: <s>{formatPrice(modality.listPrice, locale)}</s> · {t('oneOff')}
        </p>
      </div>

      {extras && (
        <ul className="mt-6 space-y-2.5 flex-1">
          {extras.map((extra) => (
            <li key={extra} className="flex gap-2 text-sm text-body">
              <Check className="h-4 w-4 shrink-0 text-brand mt-0.5" aria-hidden="true" />
              {extra}
            </li>
          ))}
        </ul>
      )}

      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
