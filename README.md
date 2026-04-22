# Pymatic Labs Website

Official website for Pymatic Labs — AI automation agency for Spanish SMBs.

## Tech Stack

- Next.js 15 (App Router + Turbopack)
- TypeScript (strict mode)
- Tailwind CSS v4
- shadcn/ui (manual components)
- next-intl (es default, en with /en/ prefix)
- lucide-react
- MDX for blog posts
- Resend for contact form emails
- Zod v4 for form validation

## Development

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Build

```bash
pnpm build
pnpm start
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RESEND_API_KEY` | Production | Resend API key for sending contact form emails |
| `CONTACT_EMAIL` | Optional | Email to receive contact form submissions (default: hola@pymaticlabs.com) |
| `NEXT_PUBLIC_SITE_URL` | Optional | Full site URL (default: https://pymaticlabs.com) |

## Project Structure

```
app/
  [locale]/          # All pages with i18n routing
    layout.tsx       # Root layout with Navbar/Footer
    page.tsx         # Landing page
    servicios/       # Services page
    casos/           # Case studies
    blog/            # Blog listing + posts
    sobre-nosotros/  # About page
    contacto/        # Contact page
    aviso-legal/     # Legal notice
    politica-privacidad/
    politica-cookies/
  api/contact/       # Contact form API route
  robots.ts          # robots.txt
  sitemap.ts         # sitemap.xml
components/
  navbar.tsx
  footer.tsx
  sections/          # Landing page sections
  ui/                # shadcn/ui components
content/
  blog/              # MDX blog posts
  cases/             # Case study data
lib/
  i18n.ts            # Locale config
  utils.ts           # cn() utility
  metadata.ts        # Metadata helpers
  schemas.ts         # JSON-LD schema generators
  blog.ts            # Blog post utilities
messages/
  es.json            # Spanish translations
  en.json            # English translations
```

## Launch Checklist

- [ ] Set `RESEND_API_KEY` in Vercel environment variables
- [ ] Set `NEXT_PUBLIC_SITE_URL=https://pymaticlabs.com` in Vercel
- [ ] Set `CONTACT_EMAIL` in Vercel
- [ ] Add OG image at `/public/og-image.png` (1200x630px)
- [ ] Add logo at `/public/logo.png`
- [ ] Add blog cover images at `/public/blog/covers/`
- [ ] Update `[RAZÓN SOCIAL PENDIENTE]` in legal pages with real company name
- [ ] Update `[PENDIENTE]` CIF in aviso-legal
- [ ] Create Cal.com account and update URL in contact section
- [ ] Create LinkedIn company page and update URLs in footer
- [ ] Create GitHub organization and update URLs in footer
- [ ] Add Google Analytics or Plausible (optional)
- [ ] Set up Google Search Console and submit sitemap
- [ ] Verify Google My Business listing
- [ ] Test contact form end-to-end in production
- [ ] Test all pages on mobile
- [ ] Run Lighthouse audit (aim for 90+ on all metrics)
