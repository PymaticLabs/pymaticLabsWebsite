import { useTranslations } from 'next-intl'
import {
  ChevronsDown,
  ChevronsRight,
  DraftingCompass,
  FileSpreadsheet,
  FileText,
  FileType,
  Folder,
  Lock,
  Mail,
  ScanLine,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { CerebroIcon } from '@/components/cerebro-icon'
import { cn } from '@/lib/utils'

/** Cada tipo de documento (en el orden de bento.read.kinds), con su icono y su color de siempre. */
const KINDS: { icon: LucideIcon; color: string }[] = [
  { icon: FileText, color: '#E5484D' },
  { icon: FileType, color: '#2B6CD4' },
  { icon: FileSpreadsheet, color: '#21A366' },
  { icon: Mail, color: '#0463FE' },
  { icon: DraftingCompass, color: '#8E4EC6' },
  { icon: ScanLine, color: '#E79A12' },
]

/** Personas del equipo de ejemplo (iniciales) y los tonos de sus circulos. */
const TEAM = [
  { initial: 'A', color: '#0463FE' },
  { initial: 'J', color: '#2F7BFF' },
  { initial: 'L', color: '#0350D0' },
  { initial: 'P', color: '#5B95FF' },
]

// "Se lee todo lo que ya tienes": baldosas grandes, sin bordes, cada una con su dibujo vivo. Al entrar en
// pantalla, la baldosa aparece y su dibujo se monta una vez (los .enter, ver globals.css).
export default function Bento() {
  const t = useTranslations('home.bento')
  const kinds = t.raw('read.kinds') as string[]
  const before = t.raw('order.before') as string[]
  const after = t.raw('order.after') as string[]
  const delay = (s: number) => ({ '--d': `${s}s` }) as React.CSSProperties

  return (
    <section id="documentos" className="bg-paper py-24 sm:py-36">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div data-reveal className="max-w-3xl">
          <p className="text-lg font-semibold text-brand">{t('eyebrow')}</p>
          <h2 className="mt-3 text-[2.75rem] font-bold leading-[1.04] tracking-[-0.04em] text-ink sm:text-7xl">{t('title')}</h2>
          <p className="mt-6 text-xl leading-relaxed text-muted sm:text-2xl sm:leading-relaxed">{t('text')}</p>
        </div>

        <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          <Tile title={t('read.title')} className="md:col-span-2">
            <div className="w-full">
              <div className="flex items-center gap-5">
                <ul className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {kinds.map((kind, i) => {
                    const { icon: Icon, color } = KINDS[i % KINDS.length]
                    return (
                      <li
                        key={kind}
                        className="enter enter-x flex items-center gap-2 rounded-2xl bg-surface px-2.5 py-2.5 shadow-[0_1px_2px_rgb(0_0_0/0.06)] sm:gap-2.5 sm:px-3"
                        style={delay(0.1 + i * 0.09)}
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white sm:h-8 sm:w-8" style={{ background: color }}>
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="truncate text-sm font-medium text-ink sm:text-[15px]">{kind}</span>
                      </li>
                    )
                  })}
                </ul>
                <ChevronsRight className="enter hidden h-7 w-7 shrink-0 text-brand/60 sm:block" style={delay(0.7)} aria-hidden="true" />
                <span className="enter hidden sm:block" style={delay(0.8)}>
                  <CerebroIcon className="h-20 w-20 shadow-xl shadow-brand/30" />
                </span>
              </div>
              <div className="mt-8">
                <div className="h-2 overflow-hidden rounded-full bg-line">
                  <div className="grow-x h-full w-[40%] rounded-full bg-gradient-to-r from-[#3D86FF] to-brand" style={delay(0.9)} />
                </div>
                <p className="mt-3 text-sm text-muted">{t('read.progress')}</p>
              </div>
            </div>
          </Tile>

          <Tile title={t('find.title')} text={t('find.text')} delay={0.1}>
            <div className="w-full">
              <p className="flex items-center gap-2.5 rounded-full bg-surface px-4 py-3 text-[15px] text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]">
                <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span className="truncate">{t('find.query')}</span>
              </p>
              <div className="enter mt-3 rounded-2xl bg-surface p-4 shadow-[0_12px_30px_-14px_rgb(4_40_120/0.3)]" style={delay(0.5)}>
                <p className="flex items-center gap-1.5 text-sm text-muted">
                  <Folder className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('find.path')}</span>
                </p>
                <p className="mt-1.5 flex items-center gap-2 font-semibold text-ink">
                  <FileText className="h-5 w-5 shrink-0 text-[#E5484D]" aria-hidden="true" />
                  <span className="truncate">{t('find.file')}</span>
                </p>
              </div>
            </div>
          </Tile>

          <Tile title={t('order.title')} text={t('order.text')} delay={0.05}>
            {/* Arriba, como estan hoy; abajo, la copia ordenada */}
            <div className="w-full text-sm">
              <ul className="flex flex-wrap gap-1.5">
                {before.map((name, i) => (
                  <li key={name} className="enter rounded-lg bg-surface/70 px-2.5 py-1 text-[13px] text-muted" style={delay(0.1 + i * 0.08)}>
                    {name}
                  </li>
                ))}
              </ul>
              <ChevronsDown className="enter mx-auto my-2 h-5 w-5 text-brand/60" style={delay(0.45)} aria-hidden="true" />
              <ul className="space-y-1.5">
                {after.map((name, i) => (
                  <li
                    key={name}
                    className="enter flex items-center gap-2 rounded-xl bg-surface px-3 py-2 font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                    style={delay(0.6 + i * 0.12)}
                  >
                    <Folder className="h-4 w-4 shrink-0 fill-brand/15 text-brand" aria-hidden="true" />
                    {name}
                  </li>
                ))}
              </ul>
            </div>
          </Tile>

          <Tile title={t('team.title')} text={t('team.text')} delay={0.12}>
            <div className="w-full">
              <div className="flex -space-x-3">
                {TEAM.map(({ initial, color }, i) => (
                  <span
                    key={initial}
                    className="enter flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-paper-2 text-base font-semibold text-white"
                    style={{ background: color, ...delay(i * 0.08) }}
                  >
                    {initial}
                  </span>
                ))}
                <span className="enter flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-paper-2 bg-surface text-sm font-semibold text-muted" style={delay(0.35)}>
                  +6
                </span>
              </div>
              <p
                className="enter mt-5 inline-flex items-center gap-2 rounded-full bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                style={delay(0.55)}
              >
                <Lock className="h-4 w-4 text-brand" aria-hidden="true" />
                {t('team.locked')}
              </p>
            </div>
          </Tile>

          <Tile title={t('mobile.title')} text={t('mobile.text')} delay={0.19}>
            <div className="mx-auto w-full max-w-[14rem]">
              <div className="rounded-[2.2rem] border-[7px] border-[#1d1d1f] bg-surface px-3 pb-5 pt-3 shadow-xl dark:border-[#2a3140]">
                <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-line" />
                <div className="space-y-2 text-[13px] leading-snug">
                  <p className="enter ml-auto w-fit max-w-[90%] rounded-2xl rounded-br-md bg-brand px-3 py-2 text-white" style={delay(0.2)}>
                    {t('mobile.q')}
                  </p>
                  <p className="enter w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-[#EDEEF1] px-3 py-2 text-ink dark:bg-[#1C2230]" style={delay(0.7)}>
                    {t('mobile.a')}
                  </p>
                </div>
              </div>
            </div>
          </Tile>
        </div>
      </div>
    </section>
  )
}

/** Una baldosa: titulo arriba, su dibujo abajo. */
function Tile({
  title,
  text,
  delay = 0,
  className,
  children,
}: {
  title: string
  text?: string
  delay?: number
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      data-reveal
      style={{ '--delay': `${delay}s` } as React.CSSProperties}
      className={cn('flex min-h-[21rem] flex-col overflow-hidden rounded-[28px] bg-paper-2 p-7 sm:p-9', className)}
    >
      <h3 className="text-2xl font-bold leading-tight tracking-[-0.025em] text-ink sm:text-[1.75rem]">{title}</h3>
      {text && <p className="mt-2 text-lg leading-snug text-muted">{text}</p>}
      <div className="mt-8 flex flex-1 items-end">{children}</div>
    </div>
  )
}
