# Pymatic Labs · Cerebro Digital

Web de pymaticlabs.com, rehecha solo para el Cerebro Digital (Eric, 02-10-2026). Castellano (fuente) e inglés.

Las fuentes de verdad del contenido están en el repo `cerebro-pymaticlabs`:

- Oferta y precios: `knowledge/11_Comercial/oferta-del-cerebro-digital.md` → aquí, `lib/offer.ts` (único sitio con cifras).
- Mensual: `knowledge/11_Comercial/retainers-y-mantenimiento.md`.
- Qué hace el cerebro: `esqueleto/guias/guia-del-cerebro.md` (y su versión en inglés en `esqueleto/idiomas/en/guias/`).
- Promesa de privacidad: `knowledge/11_Comercial/promesa-de-privacidad-del-cerebro-digital.md`. Va literal, sin tocar.
- Marca: `knowledge/01_Empresa/identidad-y-marca.md` (azul `#0463FE`, negro, fondo blanco).

## Stack

- Next.js 16 (App Router, Turbopack), React 19, TypeScript
- Tailwind CSS 4 (tokens de marca en `app/globals.css`)
- next-intl (`es` por defecto, `en` bajo `/en`; las rutas son las mismas en los dos idiomas)
- marked, para los textos largos de `content/`
- Resend para el formulario de contacto
- Vercel (hosting y Web Analytics, sin cookies)

## Desarrollo

```bash
pnpm install
pnpm dev
```

## Variables de entorno

| Variable | Dónde | Para qué |
|----------|-------|----------|
| `RESEND_API_KEY` | Producción | Enviar los correos del formulario de contacto |
| `CONTACT_EMAIL` | Opcional | Buzón del formulario (por defecto info@pymaticlabs.com) |
| `NEXT_PUBLIC_SITE_URL` | Opcional | URL pública (por defecto https://pymaticlabs.com) |

## Estructura

```
app/
  [locale]/
    page.tsx            # Home
    como-funciona/      # Qué es y todo lo que sabe hacer
    precios/            # Modalidades, mensual, Pack España y A medida
    seguridad/          # Promesa de privacidad y política de vulnerabilidades
    contacto/
    aviso-legal/, politica-privacidad/, politica-cookies/
  api/contact/          # Formulario de contacto (Resend)
components/
  home/                 # Secciones de la home (la demo es home/demo.tsx)
  pricing/              # Tarjeta de modalidad
  ui/                   # Primitivas shadcn/ui
content/legal/{es,en}/  # Textos largos en Markdown
lib/
  offer.ts              # Precios y modalidades
  markdown.ts           # Renderiza content/
messages/{es,en}.json   # Textos de la web
public/.well-known/security.txt
```

Las URL de la web de agencia (`/servicios`, `/casos`, `/blog`, `/sobre-nosotros`) redirigen con 301 a la home (`next.config.mjs`).
