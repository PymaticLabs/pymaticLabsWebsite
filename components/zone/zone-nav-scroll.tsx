"use client"

import { useEffect, useRef } from 'react'

// En el movil las secciones de la zona van en una fila que se desliza: al abrir una pagina, su
// seccion se centra en la fila (sin mover la pagina) para que se vea donde se esta.
export default function ZoneNavScroll({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const nav = ref.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!nav || !active || nav.scrollWidth <= nav.clientWidth) return
    nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2
  }, [])

  return (
    <nav ref={ref} aria-label={label} className={className}>
      {children}
    </nav>
  )
}
