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
| `CHECKOUT_OPEN` | Cobro | `true` enseña los botones de compra. Apagado hasta abrir la venta (docs/entrega-automatica.md, sección 0). La página de precios lo lee al construir: cambiarlo pide redesplegar. |

Las de la entrega automática (Stripe, Supabase, las licencias a mano o Google Cloud KMS, Holded, Brevo, Cal.com, la cola y el modo falso) están en `.env.example`, cada una con su comentario.

## Cobro y entrega

Pago en Stripe Checkout con sesiones creadas por el servidor (`/api/checkout`) y entrega automática con el aviso firmado de Stripe (`/api/stripe/webhook`): factura en Holded, licencia, cuenta en la zona de socio (Supabase), bienvenida con la licencia y las condiciones aceptadas, y aviso a PymaticLabs; todo en una cola con reintentos. También el mensual, las devoluciones y contracargos, las versiones nuevas y la conciliación diaria de licencias y pagos.

**Licencias.** Hasta que el producto acepte la clave de la web, a mano (`LICENSE_MODE=manual`): cada venta se la pide a Eric por correo con los campos, él la firma en su Mac y la sube con `scripts/subir-licencia.mts`; la web la comprueba con su publica y con la compra, se la manda al cliente y la deja en la zona (la bienvenida sale antes, sin ella). Después, la firmará la web con su clave en Google Cloud KMS (`LICENSE_MODE=kms`; `lib/license.ts`, igual byte a byte que `firmar_licencia.py`).

**Abrir la venta:** la sección 0 de [docs/entrega-automatica.md](docs/entrega-automatica.md), con `scripts/comprobar-produccion.mts` (o `GET /api/admin/health`), que mira cada variable y cada servicio de producción sin tocar nada.

**Zona de socio** (`/zona`, con el botón Entrar de arriba a la derecha y, con la sesión abierta, el perfil): se entra con el correo y un código de un solo uso (Supabase Auth, sin contraseñas) y dentro están la licencia, las descargas con enlaces que caducan, las facturas, el mensual (con el portal de Stripe), el equipo y las sesiones del Acompañado. En modo falso, `/api/dev/zona-demo` enseña una zona de muestra sin ninguna cuenta.

Cómo funciona, qué hay que crear en cada servicio, todas las variables, cómo probarlo y lo que necesita el esqueleto: [docs/entrega-automatica.md](docs/entrega-automatica.md).

## Tests

```bash
pnpm test
```

`lib/license.test.mts` comprueba la firma contra una licencia real emitida por `firmar_licencia.py`. `lib/delivery.test.mts` y `lib/delivery-adapters.test.mts` prueban la entrega entera con las piezas falsas, sin cuentas ni red, `lib/zone.test.mts` la zona de socio (lo que ve cada persona, la seguridad por filas y la sesión de Supabase), `lib/delivery-review.test.mts` lo de la revisión de seguridad y fiscal (compras con el NIF de otro cliente, devoluciones y contracargos con el mensual, el IVA de Stripe Tax, límites), `lib/manual-license.test.mts` las licencias a mano y `lib/production-check.test.mts` la comprobación de producción. `pnpm build && pnpm test:e2e` la prueba de punta a punta contra `next start` en modo falso.

## Estructura

```
app/
  [locale]/
    page.tsx            # Home
    funciones/          # Funciones y especificaciones
    precios/            # Modalidades, mensual y A medida
    seguridad/          # Promesa de privacidad y política de vulnerabilidades
    contacto/
    zona/               # Zona de socio: entrar, licencia, descargas, sesiones, equipo, mensual y facturas
    aviso-legal/, politica-privacidad/, politica-cookies/
  api/contact/          # Formulario de contacto (Resend)
    comprar/[producto]/ # Página de compra (en el Acompañado, elegir la primera sesión)
  api/checkout/         # Crea el pago en Stripe Checkout
  api/stripe/webhook/   # Entrega tras el pago
  api/jobs/, api/admin/ # Cola, conciliación, versiones, licencias a mano y comprobación de producción (con secreto)
  api/zone/             # Zona de socio
components/
  home/                 # Home: chat que se escribe solo, párrafo que se enciende al bajar, tareas con el chat fijo, baldosas, privacidad, pasos, precios, dudas y cierre
  cerebro-icon.tsx      # El sello del Cerebro Digital (el mismo trazo que public/icon.svg)
  pymatic-mark.tsx      # El símbolo de Pymatic Labs (las dos piezas, negra y azul), en la barra y el pie
  pricing/              # Las dos familias (en solitario y acompañado), la tarjeta de cada modalidad y las licencias de lanzamiento que quedan
  zone/                 # Piezas de la zona de socio
  ui/                   # Primitivas shadcn/ui
content/legal/{es,en}/  # Textos largos en Markdown
lib/
  offer.ts              # Precios y modalidades
  markdown.ts           # Renderiza content/
  checkout.ts           # Sesiones de Stripe Checkout
  delivery/             # Entrega automática: pasos, cola, zona y un adaptador por proveedor
supabase/migrations/    # Base de datos, seguridad por filas, almacén y pg_cron
scripts/                # Prueba de punta a punta, Stripe, versiones y la publica de la clave
docs/                   # Entrega automática
messages/{es,en}.json   # Textos de la web
public/.well-known/security.txt
```

Las URL de la web de agencia (`/servicios`, `/casos`, `/blog`, `/sobre-nosotros`) redirigen con 301 a la home (`next.config.mjs`).
