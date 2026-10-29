"use client"

import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Un campo de identificacion fiscal de /comprar (el NIF espanol, el NIF-IVA o la identificacion de
// fuera de la UE: tax-fields.tsx dice cual y como se comprueba). Se mira aqui su forma, con la misma
// funcion que el servidor (lib/delivery/checkout-tax.ts y checkout-nif.ts), sin servicios externos:
// mientras no valga, el navegador no deja enviar el formulario; sin JavaScript, lo dice el servidor
// al volver aqui. Los textos llegan de la pagina: el proveedor de textos del navegador no los lleva.

type Problem = 'required' | 'invalid'

export interface TaxIdTexts {
  label: string
  placeholder: string
  hint: string
  required: string
  invalid: string
}

export default function TaxIdField({
  name,
  texts,
  check,
  required,
  disabled = false,
  maxLength = 20,
  onValue,
}: {
  name: string
  texts: TaxIdTexts
  /** Si lo escrito (sin espacios a los lados, no vacio) tiene la forma que toca. */
  check: (value: string) => boolean
  /** Obligatorio (si no, vacio vale). */
  required: boolean
  /** No toca (otro pais): ni se comprueba ni se envia. */
  disabled?: boolean
  maxLength?: number
  /** Lo escrito, en cada cambio (y lo que ya habia al cargar, si el navegador lo relleno). */
  onValue?: (value: string) => void
}) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<Problem | null>(null)

  // show: ensenar el error ya (al salir del campo o al intentar pagar), no mientras se escribe.
  function validate(input: HTMLInputElement, show: boolean) {
    const value = input.value.trim()
    const found: Problem | null = !value ? (required ? 'required' : null) : check(value) ? null : 'invalid'
    input.setCustomValidity(found && !disabled ? texts[found] : '')
    if (show || !found) setProblem(found)
  }

  // Al cambiar de pais (otra forma, obligatorio o no), se vuelve a mirar lo escrito, sin ensenar el
  // error. validate cambia en cada render: lo que cuenta es lo que le dice que mirar.
  useEffect(() => {
    if (ref.current) validate(ref.current, false)
  }, [required, disabled, check])

  // Solo al cargar: lo que relleno el navegador antes de que llegara el JavaScript.
  useEffect(() => {
    if (ref.current?.value) onValue?.(ref.current.value)
  }, [])

  const shown = problem && !disabled ? problem : null
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-ink">
        {texts.label}
      </Label>
      <Input
        ref={ref}
        id={id}
        name={name}
        required={required && !disabled}
        disabled={disabled}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={maxLength}
        placeholder={texts.placeholder}
        aria-invalid={shown ? true : undefined}
        aria-describedby={`${id}-hint`}
        className="max-w-xs uppercase placeholder:normal-case"
        onInput={(e) => {
          onValue?.(e.currentTarget.value)
          validate(e.currentTarget, problem !== null)
        }}
        onBlur={(e) => {
          if (e.currentTarget.value.trim()) validate(e.currentTarget, true)
        }}
        onInvalid={(e) => validate(e.currentTarget, true)}
      />
      <p id={`${id}-hint`} role={shown ? 'alert' : undefined} className={shown ? 'text-sm font-medium text-ink' : 'text-xs text-muted'}>
        {shown ? texts[shown] : texts.hint}
      </p>
    </div>
  )
}
