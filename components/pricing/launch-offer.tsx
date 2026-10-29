import { useLocale, useTranslations } from 'next-intl'
import { CEREBRO_PATH } from '@/components/cerebro-icon'
import { LAUNCH_CUSTOMERS, formatPrice, modalities } from '@/lib/offer'
import { cn } from '@/lib/utils'

// Las 10 licencias de lanzamiento, a la vista: cuantas quedan, con una pieza por licencia. left es el
// numero que quedan (launchLeft de offerStatus, app/[locale]/precios/offer-status.ts); null si no se sabe
// (sin base de datos), y entonces se dice «las 10 primeras» sin contarlas ni pintar piezas: nunca un
// numero que no sea de verdad.

const bold = (chunks: React.ReactNode) => <strong className="font-bold tabular-nums text-brand-light">{chunks}</strong>

/** En /precios: el bloque oscuro bajo el titulo, con las 10 piezas. Sin plazas, una linea y el precio de lista. */
export function LaunchOffer({ left, className }: { left: number | null; className?: string }) {
  const t = useTranslations('offer.launchOffer')
  const tPricing = useTranslations('pricing')
  const locale = useLocale()
  // Lo que se ahorra, de la modalidad que menos a la que mas (de lib/offer.ts, nunca escrito a mano)
  const savings = modalities.map((m) => m.listPrice - m.launchPrice)

  if (left === 0) return <p className={cn('text-center text-base font-medium text-ink', className)}>{tPricing('launchOver')}</p>

  return (
    <div
      data-reveal
      className={cn('relative overflow-hidden rounded-[28px] bg-inverse px-6 py-8 text-white sm:px-10 sm:py-10', className)}
    >
      {/* La luz azul de detras, abajo a la derecha, como la de la portada */}
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -right-16 h-64 w-96 rounded-full bg-brand/30 blur-[90px]" />
      <div className="relative grid items-center gap-8 lg:grid-cols-[1fr_auto] lg:gap-12">
        <div>
          <h2 className="text-balance text-3xl font-bold leading-[1.12] tracking-[-0.03em] sm:text-4xl">
            {left === null ? t('unknown') : t.rich('left', { left, b: bold })}
          </h2>
          <p className="mt-3 max-w-xl text-pretty text-lg leading-relaxed text-white/70">
            {t('text', { min: formatPrice(Math.min(...savings), locale), max: formatPrice(Math.max(...savings), locale) })}
          </p>
        </div>
        {left !== null && (
          <div>
            <Seals left={left} />
            <p className="mt-4 flex gap-5 text-sm text-white/70">
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 rounded-[3px] bg-white/15" />
                {t('sold', { count: LAUNCH_CUSTOMERS - left })}
              </span>
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 rounded-[3px] bg-brand" />
                {t('free', { count: left })}
              </span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

/** Las 10 piezas: las vendidas, apagadas; las que quedan, el sello en azul, que se encienden una tras otra al aparecer. */
function Seals({ left }: { left: number }) {
  const sold = LAUNCH_CUSTOMERS - left
  return (
    <ol aria-hidden="true" className="grid w-full max-w-[34rem] grid-cols-10 gap-1.5 sm:gap-2.5">
      {Array.from({ length: LAUNCH_CUSTOMERS }, (_, i) => {
        const free = i >= sold
        return (
          <li
            key={i}
            style={free ? ({ '--d': `${0.25 + (i - sold) * 0.07}s` } as React.CSSProperties) : undefined}
            className={cn(
              'aspect-square rounded-[25%]',
              free
                ? 'enter bg-gradient-to-br from-[#3D86FF] to-brand-dark text-white shadow-[0_6px_16px_-6px_rgb(4_99_254/0.8)]'
                : 'bg-white/[0.07] text-white/25 ring-1 ring-inset ring-white/10'
            )}
          >
            <svg viewBox="0 0 32 32" fill="none" className="h-full w-full">
              <path d={CEREBRO_PATH} stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </li>
        )
      })}
    </ol>
  )
}

/** En la portada y en el resumen de precios: una pastilla con las 10 piezas en pequeno. */
export function LaunchBadge({ left, className }: { left: number | null; className?: string }) {
  const t = useTranslations('offer.launchOffer')
  if (left === 0) return null
  const sold = left === null ? 0 : LAUNCH_CUSTOMERS - left

  return (
    // Las piezas a la izquierda y el texto a su lado: en el movil, si no cabe, parte el texto y no las piezas
    <p className={cn('inline-flex max-w-full items-center gap-3 rounded-2xl bg-brand-soft px-4 py-2 text-left text-sm font-semibold text-brand sm:rounded-full', className)}>
      {left !== null && (
        <span aria-hidden="true" className="flex shrink-0 gap-[3px]">
          {Array.from({ length: LAUNCH_CUSTOMERS }, (_, i) => (
            <span key={i} className={cn('h-3 w-2 rounded-[2px]', i < sold ? 'bg-brand/20' : 'bg-brand')} />
          ))}
        </span>
      )}
      <span className="text-pretty">{left === null ? t('badgeUnknown') : t('badge', { left })}</span>
    </p>
  )
}
