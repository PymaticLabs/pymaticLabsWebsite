"use client"

import { motion, useReducedMotion, type MotionValue } from 'motion/react'
import { useTranslations } from 'next-intl'
import { Check, FileSpreadsheet, FileText, Folder, Lock, Mail, Image as ImageIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

// El portatil del cliente: el protagonista de la home. Esta fijo mientras se baja y cambia con
// cada escena (0 = portada, 1 = local, 2 = historial, 3 = equipo, 4 = documentos, 5 = carpetas,
// 6 = tareas). Todo es HTML y CSS: sin imagenes ni capturas de Claude.

export const SCENES = ['hero', 'local', 'history', 'team', 'documents', 'folders', 'tasks'] as const

const EASE = [0.22, 1, 0.36, 1] as const

interface LaptopProps {
  scene: number
  /** Giro suave ligado al scroll (en grados). */
  tilt?: MotionValue<number>
}

export default function Laptop({ scene, tilt }: LaptopProps) {
  const reduce = useReducedMotion()
  const t = useTranslations('home.visual')
  const transition = reduce ? { duration: 0 } : { duration: 0.7, ease: EASE }
  const isTeam = scene === 3

  return (
    <div className="relative w-full max-w-[620px] mx-auto aspect-[5/4] [perspective:1600px]" aria-hidden="true">
      {/* Local: el borde de "tus equipos" y Claude fuera, consultando solo lo necesario */}
      <motion.div
        className="absolute inset-[10%_22%_12%_0%] rounded-[2rem] border-2 border-dashed border-brand/50"
        initial={false}
        animate={{ opacity: scene === 1 ? 1 : 0, scale: scene === 1 ? 1 : 0.94 }}
        transition={transition}
      >
        <span className="absolute -top-3 left-6 rounded-full bg-white px-3 py-0.5 text-[11px] sm:text-xs font-semibold text-brand border border-brand/30">
          {t('yourComputers')}
        </span>
      </motion.div>
      <motion.div
        className="absolute right-0 top-[40%] z-20 flex w-[20%] flex-col items-center gap-1 text-center"
        initial={false}
        animate={{ opacity: scene === 1 ? 1 : 0, x: scene === 1 ? 0 : 20 }}
        transition={transition}
      >
        <span className="rounded-full bg-ink px-3 py-1 text-[11px] sm:text-xs font-semibold text-white">Claude</span>
        <span className="text-[10px] sm:text-[11px] leading-tight text-muted">← {t('onlyNeeded')}</span>
      </motion.div>

      {/* Equipo: mas ordenadores con el mismo cerebro */}
      {[
        { x: '-4%', y: '4%', who: 'LA', locked: false },
        { x: '74%', y: '0%', who: 'JO', locked: true },
        { x: '-2%', y: '68%', who: 'PE', locked: false },
        { x: '76%', y: '66%', who: 'AN', locked: true },
      ].map((peer, i) => (
        <motion.div
          key={peer.who}
          className="absolute w-[26%]"
          style={{ left: peer.x, top: peer.y }}
          initial={false}
          animate={{ opacity: isTeam ? 1 : 0, scale: isTeam ? 1 : 0.6 }}
          transition={{ ...transition, delay: isTeam && !reduce ? 0.15 + i * 0.08 : 0 }}
        >
          <MiniLaptop who={peer.who} locked={peer.locked} />
        </motion.div>
      ))}

      {/* Documentos: los ficheros de la empresa entrando en el ordenador */}
      {scene === 4 && <FlyingFiles reduce={!!reduce} />}

      {/* El portatil */}
      <motion.div className="absolute inset-0 flex items-center justify-center" style={{ rotateY: tilt }}>
        <motion.div
          className="w-[78%]"
          initial={false}
          animate={{
            scale: isTeam ? 0.62 : scene === 1 ? 0.8 : 1,
            x: scene === 1 ? '-14%' : '0%',
            y: isTeam ? '6%' : '0%',
          }}
          transition={transition}
        >
          <motion.div
            className="relative rounded-t-[14px] bg-[#111] p-[2.2%] shadow-2xl shadow-ink/20 origin-bottom"
            initial={reduce ? false : { rotateX: -88 }}
            animate={{ rotateX: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 1.2, ease: EASE, delay: 0.2 }}
          >
            <div className="relative aspect-[16/10] overflow-hidden rounded-[6px] bg-white">
              <div className="flex items-center gap-1 border-b border-line bg-paper-2 px-2 py-1">
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
                <span className="h-1.5 w-1.5 rounded-full bg-line" />
                <span className="ml-auto mr-auto text-[8px] sm:text-[10px] font-medium text-muted">Claude</span>
              </div>
              <div className="relative h-[calc(100%-1.25rem)]">
                <Layer active={scene === 0} transition={transition}>
                  <ChatScreen />
                </Layer>
                <Layer active={scene === 1 || scene === 3} transition={transition}>
                  <BrainScreen lockedLabel={isTeam ? t('lockedArea') : null} />
                </Layer>
                <Layer active={scene === 2} transition={transition}>
                  <HistoryScreen />
                </Layer>
                <Layer active={scene === 4} transition={transition}>
                  <ReadingScreen active={scene === 4} reduce={!!reduce} />
                </Layer>
                <Layer active={scene === 5} transition={transition}>
                  <FoldersScreen active={scene === 5} reduce={!!reduce} />
                </Layer>
                <Layer active={scene === 6} transition={transition}>
                  <TaskScreen active={scene === 6} reduce={!!reduce} />
                </Layer>
              </div>
            </div>
          </motion.div>
          {/* Base */}
          <div className="relative mx-[-7%] h-[10px] sm:h-[14px] rounded-b-[14px] bg-gradient-to-b from-[#d9dbe0] to-[#a9adb5]">
            <div className="absolute left-1/2 top-0 h-[40%] w-[16%] -translate-x-1/2 rounded-b-md bg-[#c4c7cd]" />
          </div>
        </motion.div>
      </motion.div>
    </div>
  )
}

function Layer({
  active,
  transition,
  children,
}: {
  active: boolean
  transition: object
  children: React.ReactNode
}) {
  return (
    <motion.div
      className={cn('absolute inset-0 p-[4%]', !active && 'pointer-events-none')}
      initial={false}
      animate={{ opacity: active ? 1 : 0, y: active ? 0 : 8 }}
      transition={transition}
    >
      {children}
    </motion.div>
  )
}

function ChatScreen() {
  const t = useTranslations('home.hero')
  return (
    <div className="flex h-full flex-col justify-center gap-[6%] text-[9px] sm:text-[12px] leading-snug">
      <div className="self-end max-w-[78%] rounded-xl rounded-br-sm bg-brand px-[4%] py-[2.5%] text-white">
        {t('chatUser')}
      </div>
      <div className="self-start max-w-[86%]">
        <div className="rounded-xl rounded-bl-sm bg-paper-2 px-[4%] py-[2.5%] text-ink">{t('chatReply')}</div>
        <p className="mt-1 px-1 text-[8px] sm:text-[10px] font-medium text-brand">{t('chatSource')}</p>
      </div>
    </div>
  )
}

function BrainScreen({ lockedLabel }: { lockedLabel: string | null }) {
  return (
    <div className="grid h-full grid-cols-3 grid-rows-2 gap-[4%]">
      {Array.from({ length: 6 }).map((_, i) => {
        const locked = lockedLabel && i === 5
        return (
          <div
            key={i}
            className={cn(
              'relative flex flex-col gap-[10%] rounded-md border p-[8%]',
              locked ? 'border-ink/20 bg-ink/5' : 'border-line bg-paper-2'
            )}
          >
            <span className="h-[10%] w-[70%] rounded-full bg-ink/70" />
            <span className="h-[7%] w-full rounded-full bg-line" />
            <span className="h-[7%] w-[85%] rounded-full bg-line" />
            <span className="h-[7%] w-[60%] rounded-full bg-line" />
            {locked && (
              <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 rounded-md bg-white/80 text-[8px] sm:text-[10px] font-semibold text-ink">
                <Lock className="h-3 w-3 sm:h-4 sm:w-4" />
                {lockedLabel}
              </span>
            )}
          </div>
        )
      })}
      {!lockedLabel && (
        <span className="absolute left-1/2 top-1/2 flex h-[30%] aspect-square -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/30">
          <Lock className="h-[45%] w-[45%]" />
        </span>
      )}
    </div>
  )
}

function HistoryScreen() {
  const t = useTranslations('home.visual')
  const versions = t.raw('versions') as { who: string; when: string; what: string }[]
  return (
    <div className="flex h-full flex-col text-[9px] sm:text-[12px]">
      <p className="font-semibold text-ink">{t('docTitle')}</p>
      <ol className="mt-[4%] flex flex-1 flex-col justify-around">
        {versions.map((version, i) => (
          <li key={version.what} className="flex items-start gap-[3%]">
            <span
              className={cn(
                'mt-[0.2em] h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5',
                i === 0 ? 'bg-brand ring-4 ring-brand/15' : 'bg-line'
              )}
            />
            <div>
              <p className={cn('font-medium', i === 0 ? 'text-ink' : 'text-muted')}>{version.what}</p>
              <p className="text-[8px] sm:text-[10px] text-muted">
                {version.who} · {version.when}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ReadingScreen({ active, reduce }: { active: boolean; reduce: boolean }) {
  const t = useTranslations('home.visual')
  return (
    <div className="flex h-full flex-col justify-center gap-[6%] text-[9px] sm:text-[12px]">
      <p className="font-medium text-ink">{t('reading')}</p>
      <div className="h-[6%] w-full overflow-hidden rounded-full bg-paper-2">
        <motion.div
          className="h-full rounded-full bg-brand"
          initial={false}
          animate={{ width: active ? '40%' : '12%' }}
          transition={reduce ? { duration: 0 } : { duration: active ? 3 : 0, ease: 'easeOut' }}
        />
      </div>
      <ul className="space-y-[2%]">
        {(t.raw('files') as { name: string; status: string }[]).map((file, i, all) => {
          const skipped = i === all.length - 1
          return (
            <motion.li
              key={file.name}
              className="flex items-center justify-between gap-2 text-[8px] sm:text-[11px]"
              initial={false}
              animate={{ opacity: active ? 1 : 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.3, delay: active ? 0.4 + i * 0.35 : 0 }}
            >
              <span className={cn('truncate', skipped ? 'text-muted line-through' : 'text-ink')}>{file.name}</span>
              <span className={cn('shrink-0 font-medium', skipped ? 'text-ink' : 'text-brand')}>
                {skipped ? <Lock className="mr-0.5 inline h-2.5 w-2.5" /> : <Check className="mr-0.5 inline h-2.5 w-2.5" />}
                {file.status}
              </span>
            </motion.li>
          )
        })}
      </ul>
    </div>
  )
}

function FoldersScreen({ active, reduce }: { active: boolean; reduce: boolean }) {
  const t = useTranslations('home.visual')
  const folders = t.raw('folders') as string[]
  return (
    <ul className="flex h-full flex-col justify-around text-[9px] sm:text-[12px]">
      {folders.map((folder, i) => {
        const sensitive = i === 3
        const review = i === 4
        return (
          <motion.li
            key={folder}
            className="flex items-center gap-[3%]"
            initial={false}
            animate={{ opacity: active ? 1 : 0, x: active ? 0 : -12 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, delay: active ? 0.15 + i * 0.12 : 0 }}
          >
            <Folder className={cn('h-3 w-3 sm:h-4 sm:w-4', review ? 'text-muted' : 'text-brand')} />
            <span className={cn('font-medium', review ? 'text-muted' : 'text-ink')}>{folder}</span>
            {sensitive && <Lock className="h-3 w-3 text-ink" />}
          </motion.li>
        )
      })}
    </ul>
  )
}

function TaskScreen({ active, reduce }: { active: boolean; reduce: boolean }) {
  const t = useTranslations('home.visual')
  const steps = t.raw('taskSteps') as string[]
  const step = (i: number) => (reduce ? { duration: 0 } : { duration: 0.3, delay: active ? 0.3 + i * 0.45 : 0 })
  return (
    <div className="relative flex h-full flex-col text-[9px] sm:text-[12px]">
      <p className="font-semibold text-ink">{t('taskTitle')}</p>
      <ul className="mt-[4%] space-y-[3%]">
        {steps.map((label, i) => (
          <li key={label} className="flex items-center gap-[3%]">
            <motion.span
              className="flex h-3.5 w-3.5 sm:h-4 sm:w-4 items-center justify-center rounded-full border border-brand"
              initial={false}
              animate={{ backgroundColor: active ? '#0463FE' : '#ffffff' }}
              transition={step(i)}
            >
              <Check className="h-2.5 w-2.5 text-white" />
            </motion.span>
            <span className="text-ink">{label}</span>
          </li>
        ))}
      </ul>
      <motion.div
        className="absolute bottom-[4%] right-0 w-[70%] rounded-lg border border-line bg-white p-[3%] shadow-lg"
        initial={false}
        animate={{ opacity: active ? 1 : 0, y: active ? 0 : 10 }}
        transition={step(steps.length)}
      >
        <p className="font-medium text-ink">{t('permission')}</p>
        <div className="mt-[4%] flex justify-end gap-1.5">
          <span className="rounded-md border border-line px-2 py-0.5 text-muted">{t('no')}</span>
          <span className="rounded-md bg-brand px-2 py-0.5 text-white">{t('yes')}</span>
        </div>
      </motion.div>
    </div>
  )
}

function MiniLaptop({ who, locked }: { who: string; locked: boolean }) {
  return (
    <div>
      <div className="relative rounded-t-md bg-[#111] p-[4%]">
        <div className="flex aspect-[16/10] items-center justify-center gap-1 rounded-sm bg-white">
          <span className="flex h-[44%] aspect-square items-center justify-center rounded-full bg-brand-soft text-[8px] sm:text-[10px] font-semibold text-brand">
            {who}
          </span>
          {locked && <Lock className="h-2.5 w-2.5 sm:h-3 sm:w-3 text-ink" />}
        </div>
      </div>
      <div className="mx-[-6%] h-1 sm:h-1.5 rounded-b-md bg-[#b9bcc3]" />
    </div>
  )
}

function FlyingFiles({ reduce }: { reduce: boolean }) {
  const files = [
    { Icon: FileText, top: '14%', delay: 0 },
    { Icon: FileSpreadsheet, top: '38%', delay: 0.5 },
    { Icon: Mail, top: '62%', delay: 1 },
    { Icon: ImageIcon, top: '26%', delay: 1.5 },
    { Icon: FileText, top: '50%', delay: 2 },
  ]
  return (
    <>
      {files.map(({ Icon, top, delay }, i) => (
        <motion.span
          key={i}
          className="absolute left-0 z-10 flex h-7 w-7 sm:h-9 sm:w-9 items-center justify-center rounded-lg border border-line bg-white text-brand shadow-md"
          style={{ top }}
          initial={{ x: 0, opacity: 0 }}
          animate={reduce ? { x: 0, opacity: 1 } : { x: ['0%', '520%'], opacity: [0, 1, 1, 0], scale: [1, 1, 0.6] }}
          transition={reduce ? { duration: 0 } : { duration: 2.4, delay, repeat: Infinity, repeatDelay: 0.6, ease: 'easeIn' }}
        >
          <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
        </motion.span>
      ))}
    </>
  )
}
