// El perfil de la barra de arriba de la web (components/navbar.tsx): quien tiene sesion en la zona de
// socio, de que empresa es y sus atajos. El navegador lo pide a /api/zone/me?perfil=1, asi las
// paginas siguen siendo estaticas. Lo prueba lib/zone.test.mts.
//
// Sin imports: lo usa un componente de cliente y las pruebas corren con `node --test`, sin compilar.

export interface ZoneProfile {
  email: string
  /** Sus empresas con acceso vigente; ninguna si se le cerro la zona (devolucion, contracargo o baja). */
  companies: { name: string; role: 'owner' | 'member' }[]
}

/** Lo que contesta /api/zone/me?perfil=1: sin la zona montada, available false; sin sesion, user null. */
export type ZoneProfileResponse = { available: false } | { available: true; user: ZoneProfile | null }

/**
 * La pista de que en este navegador hay alguien de la zona (localStorage, sin datos de nadie): con
 * ella, la barra pinta un circulo neutro en vez de Entrar mientras pregunta la sesion, y no salta de
 * Entrar al perfil. No es la sesion: la que vale es la de /api/zone/me, y sin ella se quita.
 */
export const PROFILE_HINT_KEY = 'pymatic_socio'

/** Para el head, antes de pintar: con la pista, <html data-socio="1"> (globals.css cambia Entrar por el circulo). */
export const profileHintScript = `(function(){try{if(localStorage.getItem('${PROFILE_HINT_KEY}')==='1')document.documentElement.dataset.socio='1';}catch(e){}})();`

/** Pone la pista (al entrar o al saber que hay sesion) o la quita (al salir, o sin sesion): sin ella, Entrar. */
export function setProfileHint(on: boolean): void {
  try {
    if (on) localStorage.setItem(PROFILE_HINT_KEY, '1')
    else localStorage.removeItem(PROFILE_HINT_KEY)
  } catch {
    // sin almacenamiento (ventana privada, bloqueado): sin pista, como la primera vez
  }
  if (!on && typeof document !== 'undefined') delete document.documentElement.dataset.socio
}

/** Las secciones de la zona que el menu del perfil ofrece como atajo. */
export const PROFILE_SHORTCUTS = ['licencia', 'descargas', 'facturas'] as const
export type ProfileShortcut = (typeof PROFILE_SHORTCUTS)[number]

/**
 * Los atajos de esa persona: la licencia y las descargas, si tiene acceso a alguna empresa; las
 * facturas, solo si es quien compro en alguna (la zona solo se las ensena a ella).
 */
export function profileShortcuts(profile: ZoneProfile): ProfileShortcut[] {
  if (!profile.companies.length) return []
  const owner = profile.companies.some((c) => c.role === 'owner')
  return PROFILE_SHORTCUTS.filter((s) => s !== 'facturas' || owner)
}

/** La forma juridica al final del nombre ("Carpinteria Munoz, S.L.", "SLP", "S.A."): no cuenta para las iniciales. */
const LEGAL_FORM = /(?:^|[\s,]+)(?:s\.?\s?l\.?\s?(?:[upl]\.?|n\.?\s?e\.?)?|s\.?\s?a\.?\s?(?:u\.?)?|s\.?\s?c\.?\s?(?:p\.?)?|s\.?\s?coop\.?|c\.?\s?b\.?|gmbh|ltd\.?|llc|inc\.?|sarl|sas|b\.?\s?v\.?|ag)$/i
/** Palabras que no dan inicial ("Gestoria de la Plana" es GP), salvo que no haya otras. */
const SMALL = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'i', 'the', 'and', 'of', 'for'])
const ALNUM = /[\p{L}\p{N}]/u

function initialsOf(words: string[]): string {
  const letters = words.map((w) => Array.from(w).find((ch) => ALNUM.test(ch))).filter((ch): ch is string => Boolean(ch))
  return letters.slice(0, 2).join('').toLocaleUpperCase('es')
}

/**
 * Hasta dos iniciales para el boton del perfil: las de la empresa, sin su forma juridica, o si no
 * las del correo (ana.lopez@... es AL).
 */
export function profileInitials(company: string | null | undefined, email: string): string {
  let name = (company ?? '').trim()
  for (let i = 0; i < 2 && LEGAL_FORM.test(name); i++) name = name.replace(LEGAL_FORM, '').trim()
  const words = name.split(/[\s,.;:/()&+-]+/).filter((w) => ALNUM.test(w))
  const main = words.filter((w) => !SMALL.has(w.toLocaleLowerCase('es')))
  const fromCompany = initialsOf(main.length ? main : words)
  if (fromCompany) return fromCompany
  return initialsOf((email.split('@')[0] ?? '').split(/[._+-]+/)) || '?'
}
