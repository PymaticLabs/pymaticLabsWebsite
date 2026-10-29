import { useTranslations } from 'next-intl'
import { Handshake, Wrench } from 'lucide-react'
import ModalityCard from '@/components/pricing/modality-card'
import { modalities, type Modality } from '@/lib/offer'
import { cn } from '@/lib/utils'

// Las cuatro modalidades, en sus dos familias: en solitario (lo montas tu, con
// las guias) y acompanado (te lo montamos nosotros), cada una con la de una persona y la de equipo. La
// familia acompanada va en el azul suave de la marca, para que se distingan de un vistazo.
const FAMILIES = [
  { key: 'solo', guided: false, Icon: Wrench },
  { key: 'guided', guided: true, Icon: Handshake },
] as const

interface PlanFamiliesProps {
  launchOpen: boolean
  extras: (modality: Modality) => string[]
  action: (modality: Modality) => React.ReactNode
}

export default function PlanFamilies({ launchOpen, extras, action }: PlanFamiliesProps) {
  const t = useTranslations('offer.families')

  return (
    // Las dos familias lado a lado solo en pantallas anchas: por debajo de 1280 px, las cuatro tarjetas en
    // fila quedan estrechas y los precios se desalinean; ahi va una familia encima de la otra.
    <div className="grid gap-6 xl:grid-cols-2">
      {FAMILIES.map(({ key, guided, Icon }) => (
        <section
          key={key}
          aria-labelledby={`familia-${key}`}
          className={cn(
            'flex flex-col rounded-[28px] p-2',
            guided ? 'bg-brand-soft ring-1 ring-inset ring-brand/15' : 'bg-paper-2 ring-1 ring-inset ring-black/[0.04] dark:ring-white/[0.06]'
          )}
        >
          <div className="px-4 pb-6 pt-5 sm:px-5">
            <h2 id={`familia-${key}`} className="flex items-center gap-3 text-3xl font-bold tracking-[-0.035em] text-ink">
              <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-brand shadow-[0_1px_2px_rgb(0_0_0/0.06)] dark:shadow-none">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              {t(`${key}.name`)}
            </h2>
            {/* Lado a lado, el texto de las dos con el alto de dos lineas: las tarjetas empiezan a la misma altura */}
            <p className="mt-3 max-w-md text-pretty text-base leading-relaxed text-body xl:min-h-[3.25rem]">{t(`${key}.text`)}</p>
          </div>
          <div className="grid flex-1 gap-2 sm:grid-cols-2">
            {modalities
              .filter((modality) => modality.guided === guided)
              .map((modality) => (
                <ModalityCard key={modality.id} modality={modality} extras={extras(modality)} launchOpen={launchOpen}>
                  {action(modality)}
                </ModalityCard>
              ))}
          </div>
        </section>
      ))}
    </div>
  )
}
