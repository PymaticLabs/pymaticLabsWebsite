import { ArrowUp, Check, FileText, Laptop, ListChecks } from 'lucide-react'
import { CerebroIcon } from '@/components/cerebro-icon'
import { cn } from '@/lib/utils'

// Las piezas del chat de la home (la portada y la historia de las tareas), con el aire de una app de
// mensajes que cualquiera conoce: lo que preguntas, a la derecha y en azul; lo que contesta el cerebro, a
// la izquierda y en gris, con su sello. Todo es ilustracion: nada se pulsa.

export interface ChatFrame {
  name: string
  company: string
  local: string
  example: string
  /** La fecha de arriba de la conversacion ("Hoy"), como en las apps de mensajes. */
  today?: string
  placeholder: string
}

/** La ventana: cabecera con el sello, la conversacion (abajo del todo, como en un chat) y la caja de escribir. */
export function ChatWindow({
  frame,
  input,
  className,
  bodyClassName,
  children,
}: {
  frame: ChatFrame
  /** Lo que se esta escribiendo en la caja; si no hay nada, se ve el texto de ayuda. */
  input?: string
  className?: string
  bodyClassName?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-[28px] border border-black/[0.06] bg-white/95 text-left shadow-[0_40px_100px_-30px_rgb(4_40_120/0.35)] backdrop-blur-xl',
        'dark:border-white/10 dark:bg-[#0C111C]/95 dark:shadow-[0_40px_100px_-30px_rgb(0_0_0/0.8)]',
        className
      )}
    >
      <div className="flex items-center gap-3 border-b border-line px-4 py-3.5 sm:px-5">
        <CerebroIcon className="h-9 w-9" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold leading-tight text-ink">{frame.name}</p>
          <p className="truncate text-sm text-muted">{frame.company}</p>
        </div>
        <span className="hidden items-center gap-1.5 rounded-full bg-paper-2 px-3 py-1 text-xs font-medium text-muted sm:inline-flex">
          <Laptop className="h-3.5 w-3.5" aria-hidden="true" />
          {frame.local}
        </span>
        <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-medium text-muted">{frame.example}</span>
      </div>
      <div className={cn('flex flex-1 flex-col justify-end gap-3 px-4 py-5 sm:px-5', bodyClassName)}>
        {frame.today && <p className="mb-auto self-center rounded-full bg-paper-2 px-3 py-0.5 text-xs font-medium text-muted">{frame.today}</p>}
        {children}
      </div>
      <div className="px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="flex items-center gap-2 rounded-full border border-line bg-paper-2/80 py-1.5 pl-4 pr-1.5 sm:pl-5">
          <span className={cn('min-w-0 flex-1 truncate text-[15px] sm:text-base', input ? 'text-ink' : 'text-muted')}>
            {input || frame.placeholder}
            {input && <span className="ml-0.5 inline-block h-[1.1em] w-px translate-y-[0.2em] bg-brand motion-safe:animate-pulse" />}
          </span>
          <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-colors', input ? 'bg-brand' : 'bg-field/60')}>
            <ArrowUp className="h-5 w-5" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  )
}

/** Entrada de un mensaje nuevo (solo con movimiento permitido). */
const POP = 'motion-safe:animate-[pop-in_0.45s_cubic-bezier(0.2,0.7,0.2,1)_both]'

/** Lo que pregunta la persona: el blanco, por encima de 4,5:1 en todo el degradado. */
export function Ask({ children, pop }: { children: React.ReactNode; pop?: boolean }) {
  return (
    <div className={cn('flex justify-end', pop && POP)}>
      <p className="max-w-[85%] rounded-[22px] rounded-br-md bg-gradient-to-b from-brand to-brand-dark px-4 py-2.5 text-[15px] leading-snug text-white sm:text-base">
        {children}
      </p>
    </div>
  )
}

/** Lo que contesta el cerebro. */
export function Answer({ children, pop }: { children: React.ReactNode; pop?: boolean }) {
  return (
    <div className={cn('flex items-end gap-2', pop && POP)}>
      <CerebroIcon className="mb-0.5 h-7 w-7" />
      <div className="max-w-[85%] rounded-[22px] rounded-bl-md bg-[#EDEEF1] px-4 py-2.5 text-[15px] leading-snug text-ink dark:bg-[#1C2230] sm:text-base">
        {children}
      </div>
    </div>
  )
}

/**
 * "Escribiendo...": tres puntos mientras piensa. Saltan tres veces (unos 3,6 s) y se quedan quietos en
 * reposo, sin bucles: en la historia de las tareas los puntos se quedan a la vista mientras se lee.
 */
export function Typing() {
  return (
    <div className="flex items-end gap-2">
      <CerebroIcon className="mb-0.5 h-7 w-7" />
      <div className="flex gap-1 rounded-[22px] rounded-bl-md bg-[#EDEEF1] px-4 py-3.5 dark:bg-[#1C2230]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-2 w-2 rounded-full bg-muted motion-safe:animate-[typing-dot_1.1s_ease-in-out_3_both]" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  )
}

/** De donde sale la respuesta. */
export function Source({ children, pop }: { children: React.ReactNode; pop?: boolean }) {
  return (
    <span
      className={cn(
        'mt-2.5 inline-flex max-w-full items-start gap-1.5 rounded-2xl border border-brand/20 bg-surface px-3 py-1 text-[13px] font-medium leading-snug text-brand shadow-[0_0_0_4px_rgb(4_99_254/0.06)]',
        pop && POP
      )}
    >
      <FileText className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}

/** Un fichero que ha preparado (el PDF con tu logo). */
export function FileCard({ name, meta }: { name: string; meta: string }) {
  return (
    <span className="mt-2.5 flex items-center gap-3 rounded-2xl bg-surface p-2.5 pr-4 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D13438] text-[11px] font-bold tracking-wide text-white">PDF</span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{name}</span>
        <span className="block text-sm text-muted">{meta}</span>
      </span>
    </span>
  )
}

/** Una tarea que ha aprendido. */
export function TaskCard({ name, meta }: { name: string; meta: string }) {
  return (
    <span className="mt-2.5 flex items-center gap-3 rounded-2xl bg-surface p-2.5 pr-4 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand text-white">
        <ListChecks className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-semibold text-ink">{name}</span>
        <span className="block text-sm text-muted">{meta}</span>
      </span>
    </span>
  )
}

/** Los dos botones del permiso: con "chosen", el si ya esta pulsado. */
export function Choices({ yes, no, chosen }: { yes: string; no: string; chosen?: boolean }) {
  return (
    <span className="mt-3 flex gap-2">
      <span
        className={cn(
          'rounded-full bg-brand px-4 py-1.5 text-sm font-semibold text-white transition-shadow duration-500',
          chosen ? 'shadow-[0_0_0_4px_rgb(4_99_254/0.25)]' : 'motion-safe:animate-[nudge_1.6s_ease-in-out_0.6s_2]'
        )}
      >
        {chosen && <Check className="-ml-1 mr-1 inline h-4 w-4 align-[-3px]" aria-hidden="true" />}
        {yes}
      </span>
      <span className={cn('rounded-full border border-field/50 bg-surface px-4 py-1.5 text-sm font-medium text-ink transition-opacity', chosen && 'opacity-40')}>{no}</span>
    </span>
  )
}

/** Aviso del sistema en medio de la conversacion (por ejemplo, que ya esta guardado). */
export function Notice({ children, pop }: { children: React.ReactNode; pop?: boolean }) {
  return (
    <p className={cn('flex items-center justify-center gap-1.5 text-sm font-medium text-muted', pop && POP)}>
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#30A46C] text-white">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      {children}
    </p>
  )
}
