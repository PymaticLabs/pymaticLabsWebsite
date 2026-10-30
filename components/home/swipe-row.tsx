"use client"

import { Children, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

// Una fila que se desliza con el dedo, para el movil: cada tarjeta se para en su sitio, asoma la siguiente
// y unos puntos dicen por cual va. Mientras se puede deslizar, se alcanza con el tabulador (las flechas la
// mueven) y lleva el nombre de su titulo (labelledBy). En pantallas anchas, el className de quien la usa
// la vuelve rejilla o lista y dotsClassName esconde los puntos. Las tarjetas que esperan a aparecer
// (data-reveal) aparecen juntas en cuanto la fila entra en pantalla: si no, la que asoma por el borde se
// quedaria en blanco.
export default function SwipeRow({
  as: Tag = 'div',
  labelledBy,
  className,
  dotsClassName,
  children,
}: {
  as?: 'div' | 'ol'
  labelledBy?: string
  className?: string
  dotsClassName?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)
  const [scrollable, setScrollable] = useState(false)
  const count = Children.count(children)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      setScrollable(el.scrollWidth > el.clientWidth + 1)
      // La activa: la que esta mas cerca de donde se paran (el borde izquierdo, con su margen de parada).
      const stop = el.getBoundingClientRect().left + (parseFloat(getComputedStyle(el).scrollPaddingLeft) || 0)
      let best = 0
      let min = Infinity
      Array.from(el.children).forEach((child, i) => {
        const d = Math.abs(child.getBoundingClientRect().left - stop)
        if (d < min) {
          min = d
          best = i
        }
      })
      setActive(best)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el || !scrollable) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        io.disconnect()
        el.querySelectorAll('[data-reveal]:not([data-shown])').forEach((item) => item.setAttribute('data-shown', ''))
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [scrollable])

  return (
    <>
      <Tag
        ref={ref as React.Ref<never>}
        role={Tag === 'div' && scrollable ? 'region' : undefined}
        aria-labelledby={Tag === 'ol' || scrollable ? labelledBy : undefined}
        tabIndex={scrollable ? 0 : undefined}
        className={className}
      >
        {children}
      </Tag>
      {count > 1 && (
        <div aria-hidden="true" className={cn('mt-5 flex justify-center gap-1.5', dotsClassName)}>
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={cn('h-1.5 rounded-full transition-[width,background-color] duration-300', i === active ? 'w-5 bg-brand' : 'w-1.5 bg-ink/20')}
            />
          ))}
        </div>
      )}
    </>
  )
}
