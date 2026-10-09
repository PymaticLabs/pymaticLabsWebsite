"use client"

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DemoMessage {
  role: 'user' | 'assistant'
  text: string
  source?: string
}

interface Scenario {
  id: string
  label: string
  messages: DemoMessage[]
}

const STEP_MS = 1400

// Demo de la web: una conversacion con guion fijo, sin backend ni descargas (Eric, 05-10-2026:
// "muy simple, nada de cosas raras").
export default function Demo() {
  const t = useTranslations('demo')
  const scenarios = t.raw('scenarios') as Scenario[]
  const [active, setActive] = useState(0)
  const [shown, setShown] = useState(1)
  const [run, setRun] = useState(0)

  const messages = scenarios[active].messages

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion) {
      setShown(messages.length)
      return
    }
    setShown(1)
    const timers = messages.slice(1).map((_, i) => setTimeout(() => setShown(i + 2), STEP_MS * (i + 1)))
    return () => timers.forEach(clearTimeout)
  }, [active, run, messages.length])

  const isTyping = shown < messages.length && messages[shown]?.role === 'assistant'

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{t('subtitle')}</p>
      <div role="tablist" aria-label={t('title')} className="flex flex-wrap gap-2">
        {scenarios.map((scenario, i) => (
          <button
            key={scenario.id}
            role="tab"
            aria-selected={active === i}
            onClick={() => {
              setActive(i)
              setRun((r) => r + 1)
            }}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              active === i ? 'bg-ink text-white' : 'bg-white border border-line text-ink hover:bg-paper-2'
            )}
          >
            {scenario.label}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-line bg-white shadow-xl shadow-ink/5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3 bg-paper-2">
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span className="h-3 w-3 rounded-full bg-line" />
            <span className="h-3 w-3 rounded-full bg-line" />
            <span className="h-3 w-3 rounded-full bg-line" />
          </div>
          <p className="text-xs font-medium text-muted">{t('windowTitle')}</p>
          <button
            onClick={() => setRun((r) => r + 1)}
            className="flex items-center gap-1 text-xs text-muted hover:text-ink"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('replay')}
          </button>
        </div>

        <div role="tabpanel" aria-live="polite" className="min-h-[340px] p-4 sm:p-5 space-y-4">
          {messages.slice(0, shown).map((message, i) => (
            <div
              key={`${active}-${run}-${i}`}
              className={cn(
                'flex flex-col gap-1 animate-[fadeUp_.35s_ease-out]',
                message.role === 'user' ? 'items-end' : 'items-start'
              )}
            >
              <span className="text-xs text-muted px-1">
                {message.role === 'user' ? t('you') : t('assistant')}
              </span>
              <div
                className={cn(
                  'max-w-[88%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
                  message.role === 'user' ? 'bg-brand text-white rounded-br-md' : 'bg-paper-2 text-ink rounded-bl-md'
                )}
              >
                {message.text}
              </div>
              {message.source && (
                <span className="text-xs text-brand font-medium px-1">{message.source}</span>
              )}
            </div>
          ))}
          {isTyping && (
            <div className="flex gap-1 px-4 py-3 w-fit rounded-2xl bg-paper-2" aria-hidden="true">
              <span className="h-2 w-2 rounded-full bg-muted animate-bounce" />
              <span className="h-2 w-2 rounded-full bg-muted animate-bounce [animation-delay:150ms]" />
              <span className="h-2 w-2 rounded-full bg-muted animate-bounce [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">{t('disclaimer')}</p>
    </div>
  )
}
