"use client"

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import TaxIdField, { type TaxIdTexts } from './tax-id-field'
import { parseSpanishTaxId } from '@/lib/delivery/checkout-nif'
import { SPAIN_TERRITORIES, isEuCountry, parseEuVatId, parseOtherTaxId, vatPrefix, type SpainTerritory } from '@/lib/delivery/checkout-tax'

// El pais de la empresa y su identificacion fiscal en /comprar, antes de ir al pago (los socios,
// 27-10-2026: se vende a todo el mundo, solo a empresas). De ellos depende el IVA
// (lib/delivery/checkout-tax.ts): en Espana, el territorio y el NIF; en otro pais de la UE (y en
// Monaco, con el NIF-IVA frances), el NIF-IVA (vacio: con el 21 % y su identificacion fiscal); fuera
// de la UE, la identificacion fiscal.
//
// Sin JavaScript salen todos, cada grupo con para quien es, y el servidor ignora los que no tocan.
// Con JavaScript, solo los del pais elegido: los demas se esconden desde el primer pintado (CSS con
// scripting: enabled, antes de que cargue React) y, ya cargado, se desactivan (ni se comprueban ni
// se envian). El IVA de cada caso lo dice el precio, encima (purchase.price): aqui no se repite.

export interface TaxFieldsTexts {
  country: { label: string; hint: string }
  /** Para quien es cada grupo (solo se ve sin JavaScript). */
  scope: { spain: string; eu: string; other: string }
  territory: { label: string; options: Record<SpainTerritory, string> }
  taxId: TaxIdTexts
  /** El placeholder lleva {prefix}, el del pais (DE, EL...); placeholderAny, sin pais de la UE elegido (sin JavaScript). */
  vatId: TaxIdTexts & { placeholderAny: string }
  /** En la UE (junto al NIF-IVA): requiredEu, si estan vacios los dos; hintEu, que es solo para quien no lo tiene. */
  otherTaxId: TaxIdTexts & { requiredEu: string; hintEu: string }
}

export default function TaxFields({
  countries,
  initialCountry,
  initialTerritory,
  texts,
}: {
  /** Todos los paises (se vende a cualquiera), con su nombre en el idioma de la pagina (Espana primero). */
  countries: { code: string; name: string }[]
  initialCountry: string
  initialTerritory: SpainTerritory
  texts: TaxFieldsTexts
}) {
  const ids = { country: useId(), territory: useId() }
  const countryRef = useRef<HTMLSelectElement>(null)
  const [country, setCountry] = useState(initialCountry)
  const [vatEntered, setVatEntered] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // El pais elegido antes de que cargara el JavaScript (o el que repuso el navegador al volver atras).
    if (countryRef.current?.value) setCountry(countryRef.current.value)
    setReady(true)
  }, [])

  const spain = country === 'ES'
  const eu = !spain && isEuCountry(country)
  const on = { spain, eu, other: !spain && !(eu && vatEntered) }
  // Un grupo que no toca: escondido desde el primer pintado con JavaScript; sin el, a la vista.
  const group = (shown: boolean) => ({ hidden: ready && !shown, className: shown ? 'space-y-4' : 'space-y-4 [@media(scripting:enabled)]:hidden' })
  const scope = (text: string) => <p className="hidden text-sm font-medium text-ink [@media(scripting:none)]:block">{text}</p>

  // Las comprobaciones, las mismas que en el servidor; una por pais (TaxIdField vuelve a mirar al cambiar).
  const checks = useMemo(
    () => ({
      spain: (value: string) => Boolean(parseSpanishTaxId(value)),
      vat: (value: string) => Boolean(parseEuVatId(country, value)),
      other: (value: string) => Boolean(parseOtherTaxId(country, value)),
    }),
    [country]
  )
  const vatPlaceholder = eu ? texts.vatId.placeholder.replace('{prefix}', vatPrefix(country) ?? '') : texts.vatId.placeholderAny

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={ids.country} className="text-ink">
          {texts.country.label}
        </Label>
        <Select
          ref={countryRef}
          id={ids.country}
          name="country"
          required
          autoComplete="country"
          defaultValue={initialCountry}
          aria-describedby={`${ids.country}-hint`}
          className="max-w-sm"
          onChange={(e) => setCountry(e.currentTarget.value)}
        >
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <p id={`${ids.country}-hint`} className="text-xs text-muted">
          {texts.country.hint}
        </p>
      </div>

      <div {...group(on.spain)}>
        {scope(texts.scope.spain)}
        <div className="space-y-2">
          <Label htmlFor={ids.territory} className="text-ink">
            {texts.territory.label}
          </Label>
          <Select
            id={ids.territory}
            name="territory"
            defaultValue={initialTerritory}
            disabled={ready && !on.spain}
            className="max-w-sm"
          >
            {SPAIN_TERRITORIES.map((t) => (
              <option key={t} value={t}>
                {texts.territory.options[t]}
              </option>
            ))}
          </Select>
        </div>
        <TaxIdField name="taxId" texts={texts.taxId} check={checks.spain} required={ready && on.spain} disabled={ready && !on.spain} />
      </div>

      <div {...group(on.eu)}>
        {scope(texts.scope.eu)}
        <TaxIdField
          name="vatId"
          texts={{ ...texts.vatId, placeholder: vatPlaceholder }}
          check={checks.vat}
          required={false}
          disabled={ready && !on.eu}
          onValue={(value) => setVatEntered(value.trim() !== '')}
        />
      </div>

      <div {...group(on.other)}>
        {scope(texts.scope.other)}
        <TaxIdField
          name="otherTaxId"
          texts={{ ...texts.otherTaxId, ...(eu ? { required: texts.otherTaxId.requiredEu, hint: texts.otherTaxId.hintEu } : {}) }}
          check={checks.other}
          required={ready && on.other}
          disabled={ready && !on.other}
          maxLength={40}
        />
      </div>
    </div>
  )
}
