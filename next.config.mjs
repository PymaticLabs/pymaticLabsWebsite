// @ts-check
import createNextIntlPlugin from 'next-intl/plugin'
import bundleAnalyzer from '@next/bundle-analyzer'

const withBundleAnalyzer = bundleAnalyzer({ enabled: process.env.ANALYZE === 'true' })
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

// Paginas de la web de agencia, retiradas al rehacer la web solo para el Cerebro Digital.
const retired = [
  ['/servicios', '/'],
  ['/casos', '/'],
  ['/casos/:slug', '/'],
  ['/blog', '/'],
  ['/blog/:slug', '/'],
  ['/sobre-nosotros', '/'],
  ['/como-funciona', '/funciones'],
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return retired.flatMap(([source, destination]) => [
      { source, destination, permanent: true },
      { source: `/en${source}`, destination: `/en${destination === '/' ? '' : destination}`, permanent: true },
    ])
  },
}

export default withBundleAnalyzer(withNextIntl(nextConfig))
