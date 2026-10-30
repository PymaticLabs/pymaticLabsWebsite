"use client"

import { useEffect, useRef } from 'react'

// Lo que pasa hoy en la empresa, dicho de una vez y en grande, que se enciende palabra a palabra al bajar;
// la ultima frase, la promesa, en azul. El JS solo mueve --p (de 0 a 1) en el parrafo y cada palabra
// calcula su opacidad en CSS (.manifesto en globals.css). Sin JS o con "reducir movimiento", todo encendido.
export default function Manifesto({ problem, promise }: { problem: string; promise: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const words = [...problem.split(' ').map((word) => ({ word, promise: false })), ...promise.split(' ').map((word) => ({ word, promise: true }))]

  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const update = () => {
      frame = 0
      const box = el.getBoundingClientRect()
      const vh = window.innerHeight
      // Empieza cuando su borde de arriba llega al 85 % de la pantalla y acaba cuando el de abajo llega al 55 %.
      const start = vh * 0.85
      const end = vh * 0.55
      const p = (start - box.top) / (start - end + box.height)
      el.style.setProperty('--p', String(Math.min(1, Math.max(0, p))))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  return (
    <section className="bg-paper py-16 sm:py-40">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <p
          ref={ref}
          className="manifesto text-[1.6rem] font-semibold leading-[1.25] tracking-[-0.025em] text-ink sm:text-5xl sm:leading-[1.16]"
          style={{ '--n': words.length } as React.CSSProperties}
        >
          {words.map(({ word, promise }, i) => (
            <span key={i} className={promise ? 'text-brand' : undefined} style={{ '--i': i } as React.CSSProperties}>
              {word}{' '}
            </span>
          ))}
        </p>
      </div>
    </section>
  )
}
