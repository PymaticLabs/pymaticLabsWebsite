"use client"

import { useEffect } from 'react'

// Marca con data-shown cada elemento con data-reveal de la pagina cuando entra en pantalla, una sola vez:
// el CSS (globals.css) hace la aparicion. Asi las secciones siguen siendo del servidor.
// Si el JS llego tarde y el seguro del CSS ya las ensena (a los 3 s, ver reveal-failsafe), lo que esta a
// la vista se da por visto antes de quitar el seguro con data-reveals: no se vuelve a tapar.
export default function Reveals() {
  useEffect(() => {
    const items = [...document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-shown])')]
    const root = document.documentElement
    for (const el of items) {
      const box = el.getBoundingClientRect()
      const seen = box.bottom > 0 && box.top < window.innerHeight
      if (seen && getComputedStyle(el).opacity !== '0') el.setAttribute('data-shown', '')
    }
    root.setAttribute('data-reveals', '')

    const waiting = items.filter((el) => !el.hasAttribute('data-shown'))
    if (!('IntersectionObserver' in window)) {
      waiting.forEach((el) => el.setAttribute('data-shown', ''))
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.setAttribute('data-shown', '')
          io.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 }
    )
    waiting.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return null
}
