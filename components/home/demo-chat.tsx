import { useTranslations } from 'next-intl'
import { FileText, Laptop } from 'lucide-react'
import { CerebroIcon } from '@/components/cerebro-icon'

// Conversacion de ejemplo de la portada, con datos inventados: una pregunta que contesta con su fuente y
// una tarea que deja hecha y para la que pide el "si". Se lee entera de un vistazo y los botones son de
// adorno. En el ordenador, donde se ve al cargar, los mensajes entran una vez, uno detras de otro, con un
// fundido corto (nada con "reducir movimiento"); en el movil queda debajo del titular y ya esta quieta.
export default function DemoChat() {
  const t = useTranslations('home.demo')

  return (
    <figure className="rounded-3xl border border-line bg-surface p-4 shadow-xl shadow-brand/10 sm:p-6">
      <figcaption className="sr-only">{t('caption')}</figcaption>

      <div className="flex items-center gap-3 border-b border-line pb-4">
        <CerebroIcon className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-ink">{t('name')}</p>
          <p className="truncate text-sm text-muted">{t('company')}</p>
        </div>
        <span className="hidden items-center gap-1.5 text-sm text-muted sm:inline-flex">
          <Laptop className="h-4 w-4" aria-hidden="true" />
          {t('local')}
        </span>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">{t('example')}</span>
      </div>

      <ol className="mt-5 space-y-4 text-base leading-snug">
        <Ask step={0}>{t('q1')}</Ask>
        <Answer step={1}>
          <p>{t('a1')}</p>
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-brand/15 bg-surface px-2.5 py-1 text-sm text-brand">
            <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('source1')}
          </p>
        </Answer>
        <Ask step={2}>{t('q2')}</Ask>
        <Answer step={3}>
          <p>{t('a2')}</p>
          <p className="mt-3 flex items-center gap-3 rounded-xl border border-brand/15 bg-surface p-2.5 pr-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block font-semibold text-ink">{t('file')}</span>
              <span className="block text-sm text-muted">{t('fileMeta')}</span>
            </span>
          </p>
          <p className="mt-3">{t('save')}</p>
          <p className="mt-3 flex gap-2" aria-hidden="true">
            <span className="rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-white">{t('yes')}</span>
            <span className="rounded-full border border-field/60 bg-surface px-4 py-1.5 text-sm font-medium text-ink">{t('no')}</span>
          </p>
        </Answer>
      </ol>
    </figure>
  )
}

/** Entrada de cada mensaje, uno detras de otro (en s). */
const enter = (step: number) => ({ animationDelay: `${0.15 + step * 0.35}s` })
const ENTER = 'motion-safe:lg:animate-[fadeUp_0.45s_ease-out_both]'

/** Lo que pregunta la persona: a la derecha, en azul. */
function Ask({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <li className={`flex justify-end ${ENTER}`} style={enter(step)}>
      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand px-4 py-3 text-white">{children}</p>
    </li>
  )
}

/** Lo que contesta el cerebro: a la izquierda, con su sello. */
function Answer({ step, children }: { step: number; children: React.ReactNode }) {
  return (
    <li className={`flex items-start gap-2.5 ${ENTER}`} style={enter(step)}>
      <CerebroIcon className="mt-1 hidden h-7 w-7 sm:inline-flex" />
      <div className="max-w-[92%] rounded-2xl rounded-tl-md bg-brand-soft px-4 py-3 text-ink">{children}</div>
    </li>
  )
}
