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
| `CHECKOUT_OPEN` | Cobro | `true` enseña los botones de compra. Apagado hasta que el abogado revise las condiciones. Se lee al construir: cambiarlo pide redesplegar. |
| `STRIPE_PAYMENT_LINKS` | Cobro | JSON `{"hazlo-tu": {"url": "https://buy.stripe.com/...", "id": "plink_..."}, "hazlo-tu-equipo": {...}}` |
| `STRIPE_SECRET_KEY` | Entrega | Clave secreta de Stripe (`sk_test_...` en pruebas) |
| `STRIPE_WEBHOOK_SECRET` | Entrega | Secreto del endpoint `/api/stripe/webhook` (`whsec_...`) |
| `LICENSE_SIGNING_KEY` | Entrega | Privada de licencias: base64 de la semilla de 32 bytes, la que crea `firmar_licencia.py --crear-clave`. Secreto. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Entrega | Secuencia de ids de licencia y entregas hechas |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Entrega | Cuenta de servicio con acceso a la carpeta de la versión (JSON o base64) |
| `DRIVE_RELEASE_FOLDER_ID` | Entrega | Carpeta de Drive de la versión vigente |
| `BOOKING_URL` | Opcional | Reserva de las sesiones de montaje (por defecto https://cal.com/pymaticlabs) |

## Cobro y entrega

Hazlo tú: enlace de pago de Stripe → `/api/stripe/webhook` firma la licencia (`lib/license.ts`, igual byte a byte que `firmar_licencia.py`), comparte la carpeta de Drive con el correo del cliente y le manda la licencia por Resend. A info@ llega un aviso para emitir la factura en Holded. Acompañado: factura de Holded primero (el botón lleva al contacto).

Configurar cada enlace de pago en Stripe:

- Casilla de condiciones obligatoria (*Require customers to accept your terms of service*).
- Recoger el nombre de la empresa y el número fiscal (*Tax ID collection*). Si no, campos propios con clave `empresa` y `nif`.
- Tras el pago, redirigir a `https://pymaticlabs.com/gracias` (`/en/gracias` en inglés).
- Endpoint del webhook: `https://pymaticlabs.com/api/stripe/webhook` con los eventos `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` y `charge.dispute.created`.

Antes de abrir:

1. Llevar la secuencia de ids del Mac de Eric a Redis: `SET licencias:secuencia:2026 <último número usado>`.
2. Compra de 1 € en modo de prueba de Stripe y comprobar en un cerebro que la licencia recibida verifica (`licencia.py`).
3. Abrir con `CHECKOUT_OPEN=true` cuando el abogado haya revisado las condiciones.

## Tests

```bash
pnpm test
```

`lib/license.test.mts` comprueba la firma contra una licencia real emitida por `firmar_licencia.py`.

## Estructura

```
app/
  [locale]/
    page.tsx            # Home
    funciones/          # Funciones y especificaciones
    precios/            # Modalidades, mensual, Pack España y A medida
    seguridad/          # Promesa de privacidad y política de vulnerabilidades
    contacto/
    aviso-legal/, politica-privacidad/, politica-cookies/
  api/contact/          # Formulario de contacto (Resend)
  api/stripe/webhook/   # Entrega tras el pago
components/
  home/                 # Home: scrolly.tsx (recorrido con scroll) y laptop.tsx (el portátil animado)
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
