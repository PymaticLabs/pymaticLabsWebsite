import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['es', 'en'],
  defaultLocale: 'es',
  localePrefix: 'as-needed',
  localeDetection: false,
  // Sin cookie de idioma: la unica cookie de la web es la del tema, y solo si se cambia (ver /politica-cookies).
  localeCookie: false,
})
