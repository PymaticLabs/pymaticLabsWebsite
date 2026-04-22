import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = await requestLocale
  const resolvedLocale = locale && routing.locales.includes(locale as 'es' | 'en') ? locale : routing.defaultLocale

  return {
    locale: resolvedLocale,
    messages: (await import(`../messages/${resolvedLocale}.json`)).default,
  }
})
