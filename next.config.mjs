import createMDX from '@next/mdx'
import remarkGfm from 'remark-gfm'
import createNextIntlPlugin from 'next-intl/plugin'

const withMDX = createMDX({
  options: {
    remarkPlugins: [remarkGfm],
  },
})

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ['js', 'jsx', 'mdx', 'ts', 'tsx'],
}

export default withNextIntl(withMDX(nextConfig))
