import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['es', 'en'],
  defaultLocale: 'es',
  localePrefix: 'as-needed',
  localeDetection: false,
  // Sin cookie de idioma: la web no pone ninguna cookie (ver /politica-cookies).
  localeCookie: false,
})
