"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Answer, Ask, ChatWindow, Source, Typing, type ChatFrame } from '@/components/home/chat'
import { cn } from '@/lib/utils'

export interface HeroChatTexts extends ChatFrame {
  caption: string
  replay: string
  q1: string
  a1: string
  source1: string
}

interface Play {
  /** Letras de la pregunta escritas en la caja. */
  typed: number
  sent: boolean
  thinking: boolean
  /** Palabras de la respuesta que ya se ven. */
  words: number
  source: boolean
  done: boolean
}

const IDLE: Play = { typed: 0, sent: false, thinking: false, words: 0, source: false, done: false }

// La conversacion de la portada, como si pasara de verdad, una sola vez y cuando se ve: la pregunta se
// escribe en la caja y se envia, el cerebro "escribe", la respuesta sale palabra a palabra y al final, de
// donde la saca. Despues se queda quieta y se puede ver otra vez. Del servidor (y con "reducir
// movimiento") llega ya entera; con JS, el CSS la tapa hasta que empieza (ver data-ready en globals.css).
export default function HeroChat({ texts }: { texts: HeroChatTexts }) {
  const words = texts.a1.split(' ')
  const final: Play = { typed: 0, sent: true, thinking: false, words: words.length, source: true, done: true }
  const [play, setPlay] = useState<Play>(final)
  const [ready, setReady] = useState(false)
  const [animated, setAnimated] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id))
    timers.current = []
  }

  const start = useCallback(() => {
    clear()
    setPlay(IDLE)
    const at = (ms: number, next: Partial<Play>) =>
      timers.current.push(window.setTimeout(() => setPlay((p) => ({ ...p, ...next })), ms))
    let t = 250
    // La pregunta, letra a letra en la caja (unas 40 por segundo)
    for (let i = 1; i <= texts.q1.length; i++) at((t += 24), { typed: i })
    t += 350
    at(t, { typed: 0, sent: true })
    at((t += 420), { thinking: true })
    t += 1100
    at(t, { thinking: false, words: 1 })
    // La respuesta, palabra a palabra
    for (let w = 2; w <= words.length; w++) at((t += 70), { words: w })
    at((t += 320), { source: true })
    at((t += 700), { done: true })
  }, [texts.q1, words.length])

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setReady(true)
      return
    }
    setAnimated(true)
    setPlay(IDLE)
    setReady(true)
    const el = box.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        start()
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => {
      io.disconnect()
      clear()
    }
  }, [start])

  return (
    <figure ref={box} data-chat="" data-ready={ready ? '' : undefined}>
      {/* Para lectores de pantalla, la conversacion entera de una vez (la ventana es solo imagen) */}
      <figcaption className="sr-only">
        {texts.caption}: «{texts.q1}» — «{texts.a1}» ({texts.source1})
      </figcaption>
      <div aria-hidden="true">
        {/* Alto fijo, el de la conversacion entera: nada salta mientras se escribe */}
        <ChatWindow frame={texts} input={texts.q1.slice(0, play.typed)} className="h-[31rem] sm:h-[27rem]">
          <div data-chat-body="" className="flex flex-col gap-3">
            {play.sent && <Ask pop={animated}>{texts.q1}</Ask>}
            {play.thinking && <Typing />}
            {play.words > 0 && (
              <Answer pop={animated}>
                {words.slice(0, play.words).join(' ')}
                {play.source && (
                  <>
                    <br />
                    <Source pop={animated}>{texts.source1}</Source>
                  </>
                )}
              </Answer>
            )}
          </div>
        </ChatWindow>
      </div>
      {/* Siempre ocupa su sitio (nada salta al aparecer); solo se ve y se pulsa al acabar */}
      <button
        type="button"
        onClick={start}
        tabIndex={animated && play.done ? 0 : -1}
        aria-hidden={animated && play.done ? undefined : true}
        className={cn(
          'mx-auto mt-6 flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-muted transition-opacity duration-500 hover:text-ink',
          animated && play.done ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {texts.replay}
      </button>
    </figure>
  )
}
