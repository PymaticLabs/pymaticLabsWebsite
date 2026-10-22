"use client"

import { useEffect } from 'react'

// Marca con data-shown cada elemento con data-reveal de la pagina cuando entra en pantalla, una sola vez:
// el CSS (globals.css) hace la aparicion. Asi las secciones siguen siendo del servidor.
export default function Reveals() {
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>('[data-reveal]:not([data-shown])')
    if (!('IntersectionObserver' in window)) {
      items.forEach((el) => el.setAttribute('data-shown', ''))
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
    items.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  return null
}
