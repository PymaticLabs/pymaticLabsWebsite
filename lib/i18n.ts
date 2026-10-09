export const locales = ['es', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'es'

/** Las rutas son las mismas en los dos idiomas; el ingles va bajo /en. */
export function localePath(locale: string, path = '') {
  const prefix = locale === 'en' ? '/en' : ''
  return `${prefix}${path}` || '/'
}
