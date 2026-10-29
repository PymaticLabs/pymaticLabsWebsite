import { useTranslations, useLocale } from 'next-intl'
import { Check, User, Users } from 'lucide-react'
import { formatPrice, type Modality } from '@/lib/offer'

interface ModalityCardProps {
  modality: Modality
  /** Lo que trae de mas cada modalidad. */
  extras?: string[]
  /** Si quedan licencias de lanzamiento: sin ninguna, solo el precio de lista. */
  launchOpen?: boolean
  children?: React.ReactNode
}

// Una modalidad en /precios, dentro de su familia (ver plan-families.tsx): su nombre propio, para
// cuantas personas, el precio (el de lanzamiento, con el de lista tachado y lo que se ahorra) y lo que
// trae. El boton de compra, abajo del todo, a la misma altura en las dos de cada familia.
export default function ModalityCard({ modality, extras, launchOpen = true, children }: ModalityCardProps) {
  const t = useTranslations('offer')
  const locale = useLocale()
  const PeopleIcon = modality.team ? Users : User

  return (
    <div className="flex flex-col rounded-[20px] bg-surface p-6 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_10px_28px_-14px_rgb(0_0_0/0.14)] dark:shadow-none dark:ring-1 dark:ring-inset dark:ring-white/[0.07]">
      <h3 className="text-2xl font-bold tracking-[-0.03em] text-ink">{t(`modalities.${modality.id}.name`)}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
        <PeopleIcon className="h-4 w-4" aria-hidden="true" />
        {t(`modalities.${modality.id}.people`)}
      </p>
      <p className="mt-3 text-base text-body">{t(`modalities.${modality.id}.tagline`)}</p>

      {/* El precio solo en su linea y, debajo, lo demas: asi las cuatro tarjetas quedan alineadas */}
      <div className="mt-6">
        <p className="text-5xl font-bold tabular-nums tracking-[-0.04em] text-ink">
          {formatPrice(launchOpen ? modality.launchPrice : modality.listPrice, locale)}
        </p>
        {launchOpen && (
          <p className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-muted">
            <span>
              <span className="sr-only">{t('list')}: </span>
              <s className="tabular-nums">{formatPrice(modality.listPrice, locale)}</s>
            </span>
            <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">
              {t('save', { amount: formatPrice(modality.listPrice - modality.launchPrice, locale) })}
            </span>
          </p>
        )}
        <p className="mt-1.5 text-sm text-muted first-letter:uppercase">
          {t('oneOff')} · {t('noVat')}
        </p>
      </div>

      {extras && (
        <ul className="mt-6 flex-1 space-y-2.5">
          {extras.map((extra) => (
            <li key={extra} className="flex gap-2 text-sm text-body">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
              {extra}
            </li>
          ))}
        </ul>
      )}

      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
