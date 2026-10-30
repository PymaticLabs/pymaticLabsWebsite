"use client"

import { useEffect, useRef, useState } from 'react'
import { Answer, Ask, ChatWindow, Choices, FileCard, Notice, TaskCard, Typing, type ChatFrame } from '@/components/home/chat'
import SwipeRow from '@/components/home/swipe-row'
import { cn } from '@/lib/utils'

export interface StoryTexts {
  frame: ChatFrame
  steps: { title: string; text: string }[]
  chat: {
    q1: string
    a1: string
    file: string
    fileMeta: string
    ask: string
    yes: string
    no: string
    saved: string
    q2: string
    a2: string
    task: string
    taskMeta: string
  }
}

// La historia de las tareas. En el ordenador, el chat se queda fijo a la derecha mientras a la izquierda
// pasan los cuatro pasos: el que cruza el centro de la pantalla manda, y el chat avanza hasta el (pedirlo,
// hecho con tu logo, el permiso, aprender una tarea). Cada paso se queda quieto mientras se lee. En el
// movil (y hasta lg), los pasos se deslizan de lado, cada uno con su trozo de conversacion: la historia
// ocupa una pantalla en vez de tres. labelledBy: el id del titulo de la seccion, que nombra la fila.
export default function StorySteps({ texts, labelledBy }: { texts: StoryTexts; labelledBy?: string }) {
  const { steps, chat, frame } = texts
  const [step, setStep] = useState(0)
  const items = useRef<(HTMLLIElement | null)[]>([])

  useEffect(() => {
    // Una franja fina en el centro de la pantalla: el paso que la cruza es el activo.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setStep(Number((entry.target as HTMLElement).dataset.step))
      },
      { rootMargin: '-48% 0px -48% 0px' }
    )
    items.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  // Los trozos de la conversacion, por paso (el chat fijo enseña todos hasta el activo).
  const parts = [
    [<Ask key="q1" pop>{chat.q1}</Ask>],
    [
      <Answer key="a1" pop>
        {chat.a1}
        <FileCard name={chat.file} meta={chat.fileMeta} />
      </Answer>,
    ],
    [
      <Answer key="ask" pop>
        {chat.ask}
        <Choices yes={chat.yes} no={chat.no} chosen={step >= 3} />
      </Answer>,
    ],
    [
      <Notice key="saved" pop>
        {chat.saved}
      </Notice>,
      <Ask key="q2" pop>
        {chat.q2}
      </Ask>,
      <Answer key="a2" pop>
        {chat.a2}
        <TaskCard name={chat.task} meta={chat.taskMeta} />
      </Answer>,
    ],
  ]

  // En el movil, cada tarjeta con su trozo; el cuarto, solo la pregunta y la tarea aprendida (sin el aviso
  // ni el texto de la respuesta): asi las cuatro miden casi lo mismo y la fila no deja huecos debajo. La
  // conversacion entera, en el chat fijo del ordenador.
  const cardParts = [
    [...parts[0], <Typing key="t" />],
    parts[1],
    parts[2],
    [
      <Ask key="q2">{chat.q2}</Ask>,
      <Answer key="a2">
        <TaskCard name={chat.task} meta={chat.taskMeta} className="mt-0" />
      </Answer>,
    ],
  ]

  return (
    <div className="lg:grid lg:grid-cols-[1fr_minmax(0,30rem)] lg:gap-16 xl:gap-24">
      <SwipeRow
        as="ol"
        labelledBy={labelledBy}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 items-start gap-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:block lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
        dotsClassName="lg:hidden"
      >
        {steps.map((s, i) => (
          <li
            key={s.title}
            ref={(el) => void (items.current[i] = el)}
            data-step={i}
            className="w-[85%] max-w-sm shrink-0 snap-start lg:flex lg:w-auto lg:max-w-none lg:min-h-[78vh] lg:shrink lg:flex-col lg:justify-center"
          >
            <p className="text-sm font-semibold tabular-nums text-brand">{String(i + 1).padStart(2, '0')}</p>
            <h3
              className={cn(
                'mt-2 text-balance text-[1.75rem] font-bold leading-[1.08] tracking-[-0.03em] text-ink transition-opacity duration-500 sm:mt-3 sm:text-5xl',
                i !== step && 'lg:opacity-25'
              )}
            >
              {s.title}
            </h3>
            <p className={cn('mt-3 max-w-md text-pretty text-lg leading-relaxed text-muted transition-opacity duration-500 sm:mt-4 sm:text-xl', i !== step && 'lg:opacity-25')}>
              {s.text}
            </p>
            {/* En el movil, su trozo de conversacion debajo, sin la fecha ni la caja de escribir */}
            <div className="mt-5 lg:hidden" aria-hidden="true">
              <ChatWindow frame={frame} compact>{cardParts[i]}</ChatWindow>
            </div>
          </li>
        ))}
      </SwipeRow>
      <div className="hidden lg:block" aria-hidden="true">
        {/* Centrado en alto, sin meterse bajo la barra en las pantallas bajas */}
        <div className="sticky top-[max(5.5rem,calc(50vh-17.5rem))]">
          <ChatWindow
            frame={frame}
            className="h-[min(35rem,calc(100vh-7rem))]"
            bodyClassName="overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,#000_3.5rem)]"
          >
            {parts.slice(0, step + 1).flat()}
            {step === 0 && <Typing />}
          </ChatWindow>
        </div>
      </div>
    </div>
  )
}
