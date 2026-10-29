"use client"

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

// El boton «Ir al pago» de /comprar. El formulario es un POST normal a /api/checkout (sin JavaScript
// tambien va): al enviarse (solo si es valido: el navegador no lo envia con el NIF mal), el boton se
// desactiva para que un doble clic no abra dos pagos a la vez (con la ultima plaza de lanzamiento,
// el segundo saldria al precio de lista). Al volver atras con el navegador, la pagina puede salir de
// la cache del historial con el boton desactivado: en pageshow se vuelve a activar.

export default function PayButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const sending = useRef(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    const onSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return
      // El segundo envio, antes de que React pinte el boton desactivado.
      if (sending.current) {
        event.preventDefault()
        return
      }
      sending.current = true
      setBusy(true)
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return
      sending.current = false
      setBusy(false)
    }
    form.addEventListener('submit', onSubmit)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      form.removeEventListener('submit', onSubmit)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  // autocomplete=off: Firefox guarda el disabled puesto desde aqui y lo restaura al recargar o al volver
  // atras sin la cache del historial (sin pageshow persisted), y React no lo corrige al hidratar: el boton
  // se quedaria desactivado. Va con spread porque los tipos de React no lo dan en un button.
  return (
    <Button ref={ref} type="submit" size="lg" disabled={disabled || busy} aria-busy={busy || undefined} {...{ autoComplete: 'off' }}>
      {label}
    </Button>
  )
}
