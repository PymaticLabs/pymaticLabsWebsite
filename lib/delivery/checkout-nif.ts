// El NIF espanol que pide /comprar antes de pagar a las empresas de Espana (las de otros paises dan
// su NIF-IVA o su identificacion fiscal: checkout-tax.ts): su formato y su letra o digito de
// control, sin servicios externos. Lo comprueban la pagina (en el navegador), /api/checkout y el
// aviso del pago (lib/delivery/events.ts), con esta misma funcion. Que el NIF exista no se mira: el
// IVA lo decide el territorio (el 21 % en la peninsula y Baleares; sin IVA espanol en Canarias, Ceuta
// y Melilla, comprobado tras el pago por el codigo postal), y uno mal puesto no deja IVA sin pagar
// (solo impide al cliente deducirlo). Sin dependencias: se carga tambien en el navegador.
//
// - sociedad (CIF): letra, 7 cifras y el control (cifra o letra, segun la letra del principio);
// - persona (DNI): 8 cifras y la letra;
// - extranjero residente (NIE): X, Y o Z, 7 cifras y la letra.
// Con el prefijo ES del NIF-IVA espanol (ESB12345674) tambien vale: se guarda sin el. Un NIF-IVA de
// otro pais no es un NIF espanol.

export type SpanishTaxIdKind = 'cif' | 'dni' | 'nie'

const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE'
const CIF_FIRST = 'ABCDEFGHJNPQRSUVW'
// El control de estas va en letra; el de A, B, E y H, en cifra; las demas admiten las dos.
const CIF_LETTER_CONTROL = 'NPQRSW'
const CIF_DIGIT_CONTROL = 'ABEH'
const CIF_CONTROL_LETTERS = 'JABCDEFGHI'

/** Mayusculas, sin espacios, puntos, guiones, barras ni caracteres invisibles (como lo escribe cada uno). */
function clean(value: string): string {
  return value.normalize('NFKC').toUpperCase().replace(/[\s.\-\/­​-‏⁠﻿]/g, '')
}

/** El digito de control (0 a 9) de las 7 cifras de un CIF. */
function cifDigit(digits: string): number {
  let sum = 0
  for (let i = 0; i < 7; i++) {
    const n = Number(digits[i])
    // Las cifras 1.a, 3.a, 5.a y 7.a se doblan y se suman sus dos cifras; las otras, tal cual.
    sum += i % 2 === 0 ? Math.floor((n * 2) / 10) + ((n * 2) % 10) : n
  }
  return (10 - (sum % 10)) % 10
}

/** El NIF limpio y de que tipo es, o null si no es un NIF espanol bien escrito. */
export function parseSpanishTaxId(value: string | null | undefined): { taxId: string; kind: SpanishTaxIdKind } | null {
  if (!value) return null
  let id = clean(value)
  if (id.length === 11 && id.startsWith('ES')) id = id.slice(2)
  if (/^\d{8}[A-Z]$/.test(id)) return DNI_LETTERS[Number(id.slice(0, 8)) % 23] === id[8] ? { taxId: id, kind: 'dni' } : null
  if (/^[XYZ]\d{7}[A-Z]$/.test(id)) {
    const n = Number(`${'XYZ'.indexOf(id[0])}${id.slice(1, 8)}`)
    return DNI_LETTERS[n % 23] === id[8] ? { taxId: id, kind: 'nie' } : null
  }
  if (/^[A-Z]\d{7}[0-9A-J]$/.test(id) && CIF_FIRST.includes(id[0])) {
    const digit = cifDigit(id.slice(1, 8))
    const asDigit = id[8] === String(digit)
    const asLetter = id[8] === CIF_CONTROL_LETTERS[digit]
    const ok = CIF_LETTER_CONTROL.includes(id[0]) ? asLetter : CIF_DIGIT_CONTROL.includes(id[0]) ? asDigit : asDigit || asLetter
    return ok ? { taxId: id, kind: 'cif' } : null
  }
  return null
}

/** Un CIF con su control, para las pruebas y los datos de muestra: cifWithControl('B1234567') es 'B12345674'. */
export function cifWithControl(start: string): string {
  if (!/^[A-Z]\d{7}$/.test(start) || !CIF_FIRST.includes(start[0])) throw new Error(`no es el principio de un CIF: ${start}`)
  const digit = cifDigit(start.slice(1))
  return `${start}${CIF_LETTER_CONTROL.includes(start[0]) ? CIF_CONTROL_LETTERS[digit] : digit}`
}
