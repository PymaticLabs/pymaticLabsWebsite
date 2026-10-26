# Entrega automática tras el pago: guía de puesta en marcha

Lo que diseñó Eric el 21-10-2026 (PML-KB-0261, *Entrega automática tras el pago del Cerebro Digital*), construido en la web. El pago en Stripe lanza solo, a cualquier hora, la factura, la licencia, la cuenta en la zona de socio y los correos, sin que nadie de PymaticLabs intervenga, y aguanta 100 ventas seguidas. Hasta que el producto acepte la clave de la web, la licencia es lo único que no va solo: se le pide a Eric, que la firma y la sube (sección 0).

Esta guía dice **qué hay que crear y configurar en cada servicio**, en qué orden, todas las variables y cómo probarlo: primero sin ninguna cuenta (modo falso) y después con las cuentas en modo de prueba. Nada de esto cobra de verdad mientras `CHECKOUT_OPEN` no sea `true` y las claves sean de prueba.

Reglas que valen para todo:

- **Todo primero en pruebas:** claves `sk_test_` de Stripe, un proyecto de Supabase solo para pruebas, una cuenta de Holded de pruebas. Lo de producción se monta igual, al final, con otras claves.
- **Ningún secreto en el repo.** Van en `.env.local` (en tu ordenador, ya ignorado por git) y en Vercel. `.env.example` solo tiene los nombres.
- **`CHECKOUT_OPEN=false`** hasta acabar la sección 0. Con las licencias a mano no hay que esperar a la versión del esqueleto que acepta la clave de la web (sección 9).

## 0. Abrir la venta hoy

Con las licencias **a mano** (`LICENSE_MODE=manual`). Hasta que Eric publique la versión del esqueleto que acepta la clave de la web, la web no firma licencias: cada venta se la pide a Eric por correo, él la firma en su Mac con la clave que el producto ya conoce y la sube. Todo lo demás va solo: pago, factura, cuenta en la zona, bienvenida, sesiones, mensual, devoluciones y conciliación. Para abrir no hace falta Google Cloud KMS.

**Lo legal, primero.** Las condiciones de uso y venta y las políticas son **borradores pendientes del abogado**. Abrir la venta con ellas es una decisión de los fundadores, no de la web. La web guarda la versión y la huella de las condiciones que acepta cada cliente, y le manda la copia, así que una versión revisada después no cambia las compras ya hechas.

El camino mínimo, en orden. Los tiempos cuentan con las cuentas ya creadas. Dar de alta la empresa en Stripe en vivo puede tardar días, y el DNS de Brevo, de minutos a unas horas.

| # | Qué | Tiempo | Dónde |
|---|---|---|---|
| 1 | **Supabase de producción**: proyecto en Irlanda, como el de pruebas (plan Pro), las cuatro migraciones, los dos secretos de Vault y el acceso con código | 45 min | 3.1 |
| 2 | **Brevo**: dominio autenticado, remitente verificado, la clave de la API y la SMTP (va en Supabase) | 30 min + DNS | 3.2 |
| 3 | **Stripe en vivo**: Stripe Tax con el registro de España, los datos públicos y `stripe-setup.mts --live --webhook https://pymaticlabs.com/api/stripe/webhook` | 45 min | 3.4 |
| 4 | **Holded**: la clave de la API y los ids de los impuestos, con `HOLDED_INVOICE_MODE=draft` | 20 min | 3.5 |
| 5 | **Cal.com**: el equipo, los dos eventos con su horario y la clave | 30 min | 3.6 |
| 6 | **Vercel**: las variables de Production (abajo), la región dub1 y volver a desplegar | 20 min | 3.7 |
| 7 | **La versión vigente, en producción**: el Supabase de producción empieza sin ninguna y la bienvenida promete las descargas. `node --env-file=.env.produccion.local scripts/publicar-version.mts --version X.Y.Z --dir <SALIDA> --notas notas.md --notas-en notes.md --sin-aviso`, con `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `DELIVERY_SITE_URL=https://pymaticlabs.com` de producción en ese fichero solo para este paso (la clave secreta, borrada después) | 15 min | abajo |
| 8 | **La comprobación**, hasta que no diga FALTA | 10 min | abajo |
| 9 | **Una compra de prueba** de punta a punta, en Preview | 45 min | abajo |
| 10 | **Abrir**: `CHECKOUT_OPEN=true` en Production y volver a desplegar | 5 min | — |

En total, unas cuatro horas y media de trabajo, más lo que tarden el DNS y, si hace falta, la verificación de Stripe.

### Las variables de Production

`DELIVERY_MODE=live` (o sin poner), **`LICENSE_MODE=manual`**, escrita, y `LICENSE_REQUEST_EMAIL` con el correo de Eric. Sin KMS, `manual` es lo que sale por defecto; pero si `GCP_KMS_KEY_VERSION` y `GOOGLE_SERVICE_ACCOUNT_JSON` siguen en Production de antes (esta guía pedía montarlas), sin `LICENSE_MODE` firmaría la web, con una clave que el producto de hoy no acepta, y cada cliente recibiría una licencia que no vale. La comprobación lo da como FALTA. Después, `NEXT_PUBLIC_SITE_URL`, `DELIVERY_IP_SALT`, `JOBS_SECRET`, `ADMIN_SECRET`, `STRIPE_SECRET_KEY` (la `sk_live_`), `STRIPE_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BREVO_API_KEY`, `DELIVERY_FROM_EMAIL`, `DELIVERY_INTERNAL_EMAIL`, `DELIVERY_ALERT_EMAIL`, `HOLDED_API_KEY`, `HOLDED_INVOICE_MODE=draft`, los `HOLDED_TAX_*`, `CALCOM_API_KEY`, `CALCOM_EVENT_TYPES` y `CHECKOUT_OPEN=false` hasta el paso 10.

**No** van en Production: `GCP_KMS_KEY_VERSION`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `LICENSE_MANUAL_PUBLIC_KEY` (sin ella vale la clave del Mac de Eric, que es la que tiene que ser) ni ninguna `DELIVERY_*` de piezas falsas. Todo lo de la sección 4 que no se dice aquí tiene un valor por defecto que vale.

**Las páginas se hacen al desplegar.** El botón **Entrar** solo sale si Supabase y `DELIVERY_IP_SALT` ya estaban puestos al desplegar. Los botones de compra solo salen si `CHECKOUT_OPEN=true` ya estaba puesto, y `/gracias` dice cuándo llega la licencia según el `LICENSE_MODE` de ese despliegue (a mano, «en unas horas»). Tras cambiar cualquiera de esas variables, hay que volver a desplegar (*Redeploy*).

**Las migraciones, antes que el código.** Esta versión de la web lee la tabla `license_requests` (de `20261021130000_licencias_a_mano.sql`). Hay que aplicar `npx supabase db push` en cada proyecto de Supabase que use (también el de Preview) **antes** de desplegarla. Sin la tabla, la zona y las devoluciones siguen funcionando, pero con `LICENSE_MODE=manual` ninguna venta podría pedir su licencia. La comprobación da FALTA si no está.

### La comprobación

```bash
node --env-file=.env.local scripts/comprobar-produccion.mts --web https://pymaticlabs.com
```

En `.env.local` va el `ADMIN_SECRET` de producción. El script pregunta a la web desplegada (`GET /api/admin/health`), que tiene sus variables, también las marcadas *Sensitive*. Con el entorno en un fichero, sin `--web`: `node --env-file=<fichero> scripts/comprobar-produccion.mts` (si `vercel env pull` deja vacías las *Sensitive*, usar `--web`).

Mira que estén todas las variables de los modos elegidos. Después pregunta a cada servicio, solo leyendo:

- **Supabase**: que contesta, las migraciones aplicadas, las tareas de pg_cron, los dos secretos de Vault (sin leerlos), los buckets privados, el acceso con correo y las altas libres apagadas.
- **Stripe**: la clave en vivo, el webhook con sus 13 avisos, Tax activo con el registro de España, los precios, los cupones y el portal.
- **Brevo**: el remitente verificado y el dominio autenticado.
- **Holded**: la clave, los permisos y los impuestos.
- **Cal.com**: los huecos de Eric y de Sergio.
- **KMS**: solo si firma la web.
- **La web publicada**: la zona, el botón Entrar y los botones de compra según `CHECKOUT_OPEN`.

Nunca enseña el valor de un secreto. Cada FALTA dice cómo arreglarlo, y el script sale con error mientras falte algo. Lo que no se ve desde fuera (el SMTP de Supabase, la plantilla del código, Verifactu...) sale al final como «a mano», para repasarlo en su panel.

### La compra de prueba (en Preview)

Preview lleva Stripe de prueba, su Supabase de pruebas, `LICENSE_MODE=manual`, `CHECKOUT_OPEN=true` y una **clave de pruebas** para las licencias. Con la clave del Mac, la web no acepta licencias de pagos de prueba: así nadie tiene una licencia de verdad pagando con la tarjeta `4242…`.

1. `node scripts/subir-licencia.mts --crear-clave-prueba`. `LICENSE_TEST_SEED` va a tu `.env.local`, junto con el `ADMIN_SECRET` de Preview. `LICENSE_MANUAL_PUBLIC_KEY` va a Preview, nunca a Production. Después, volver a desplegar Preview.
2. `node --env-file=.env.local scripts/comprobar-produccion.mts --web <la web de pruebas> --pruebas`.
3. Comprar un Hazlo tú con equipo con la tarjeta `4242 4242 4242 4242` (sección 5, paso 1). Tienen que llegar:
   - la bienvenida, sin licencia («te llega en unas horas»);
   - «PRUEBA · Licencia a firmar» en `LICENSE_REQUEST_EMAIL`;
   - el aviso «Venta: licencia a mano» y la factura en borrador en Holded.

   En la zona, la licencia sale «en camino».
4. `node --env-file=.env.local scripts/subir-licencia.mts --web <la web de pruebas> --compra <la compra del correo> --firmar-prueba`. Llega «Tu licencia del Cerebro Digital» con el `.zip`, y la zona la ofrece para bajarla.
5. Devolver el pago en Stripe. La licencia queda anulada, la zona se cierra y el cliente recibe el correo.

Abierta la venta, cada compra se sigue con `scripts/comprobar-compra.mts <correo>`.

### Cuando llega una licencia a firmar (Eric)

1. El correo «Licencia a firmar: <empresa> (<modalidad>)» lleva la compra, los campos tal cual y cómo subirla. Los campos son `cliente`, `nif`, `modalidad`, `equipo`, `emitida` y `soporte_hasta`, también en JSON. El cliente ya tiene la bienvenida y la zona, y espera la licencia en unas horas.
2. Firmarla en el Mac con `firmar_licencia.py`, con esos campos y el número siguiente de **su** numeración: `PML-LIC-<año>-NNNN`, del 0001 al 5000. La web no reparte ninguno y rechaza los del 5001 en adelante. `emitida` es la fecha del pago: en un Hazlo tú, `soporte_hasta` es ese mismo día, y una `emitida` posterior no vale.
3. Subirla, con el `ADMIN_SECRET` de producción en `.env.local`:
   ```bash
   node --env-file=.env.local scripts/subir-licencia.mts --web https://pymaticlabs.com --compra <compra> --fichero licencia-<cliente>.cerebro-licencia
   ```
   Sin el repo, vale lo mismo con curl:
   ```bash
   curl -X POST -H "Authorization: Bearer <ADMIN_SECRET>" --data-binary @licencia-<cliente>.cerebro-licencia "https://pymaticlabs.com/api/admin/licenses?compra=<compra>"
   ```
   La web la comprueba con la publica del Mac (`licencias.pub`) y con la compra: NIF, modalidad, equipo y plazas, `emitida`, `soporte_hasta` y el pago, si lo lleva. Si algo no cuadra, dice qué y no la guarda: hay que firmarla otra vez. «No verifica con la clave del Mac» es que la firma no es de esa clave (u otro fichero); «la firma es buena, pero los campos no valen» es que la firma vale y un campo no (lo más común, `emitida` con la fecha de hoy en vez de la del pago). Si la acepta, se la manda al cliente en un `.zip` y la deja en su zona. Subirla dos veces no duplica nada. Con curl vale también `-H "Content-Type: application/json"`: el fichero ya es JSON.
4. Las que faltan: `scripts/subir-licencia.mts --pendientes`. A las 12 horas sin firmar (`LICENSE_PENDING_ALERT_HOURS`) llega un aviso a Eric y a las alertas, y la conciliación lo repite cada día.
5. «No firmar: <empresa>»: el pago se devolvió, o hay un contracargo, antes de firmarla. La web ya no la acepta. Si el contracargo se gana, llega «Otra vez: Licencia a firmar». Si la devolución llega justo mientras se sube, gana la devolución: la web la guarda anulada, contesta 409 y no se la manda al cliente. Si era un contracargo y se gana, se la manda entonces, sin pedirla otra vez.
6. El mensual: cada cobro pide su licencia nueva igual, con el `soporte_hasta` del periodo pagado. Al subirla, sale el correo del mensual.

Cuando Eric publique la versión que acepta la clave de la web (sección 9), toca montar KMS (3.3), poner `LICENSE_MODE=kms` (escrita: la comprobación no da por buena la que sale sola) y volver a desplegar. Las licencias que sigan pedidas se suben a mano igual.

## 1. Qué pasa cuando un cliente paga

1. **Pago** (`/api/checkout` → Stripe Checkout). La sesión la crea el servidor: NIF o NIF-IVA obligatorio y razón social (en dólares, el EIN en un campo propio: Checkout no pide NIF en Estados Unidos), dirección de facturación, solo tarjeta (con Apple Pay y Google Pay; nada de pagos diferidos), Stripe Tax, la casilla de las condiciones con la versión que se acepta, el permiso para novedades y los metadatos (producto, plazas, versión de las condiciones, sesión elegida). En el Acompañado, antes se eligen la primera sesión y la persona (`/comprar/<modalidad>`) y el hueco se aparta en Cal.com mientras dura el pago. La ruta es pública: tiene límites por IP (por /64 en IPv6) de pagos abiertos y de huecos apartados, y un tope de huecos apartados en total (`LIMIT_*`).
2. **Precio de lanzamiento.** Un cupón de Stripe por modalidad con 10 usos como tope; las 10 plazas en total las cuenta la web (función `reserve_launch_slot`), que aparta una mientras dura cada pago. Una misma IP (o /64) no puede tener más de 2 abiertas a la vez. La venta 11 paga el de lista sin que nadie cambie nada.
3. **Aviso de Stripe** (`/api/stripe/webhook`). Se comprueba la firma, se apunta el pago una sola vez (con si es de Stripe en vivo o de prueba) y se encolan los pasos. Se contesta a Stripe al momento y la cola corre justo después. Un aviso de prueba con claves `sk_live_` (o al revés) no se procesa.
4. **Lo que no se entrega solo**, sino que va a revisar a mano con un aviso a PymaticLabs (sección 7): una compra sin razón social, NIF o correo; **una compra con el NIF de una empresa que ya es cliente desde un correo que no es de sus titulares** (Stripe solo mira el formato del NIF: si se fusionara, cualquiera vería las facturas, las licencias y el portal de esa empresa; sus titulares reciben un aviso); un cobro del mensual de una empresa sin pago único vigente o con otro NIF; un pago de un producto que la web no conoce (un enlace de pago antiguo).
5. **Cola** (tabla `jobs`), cada paso idempotente:
   - `invoice`: el IVA lo dice Stripe Tax (el motivo de cada impuesto y la verificación del NIF-IVA en VIES), no se adivina. Contacto por NIF en Holded, factura y, con `HOLDED_INVOICE_MODE=emit`, emitirla (Verifactu), que Holded la mande y guardar su PDF para la zona. Por defecto (`draft`) queda en borrador y el aviso interno dice que hay que emitirla a mano. **Nunca se emite sola** (queda en borrador con su motivo y un aviso) si el NIF-IVA de una inversión del sujeto pasivo no está verificado en VIES (Stripe la aplica con un NIF bien escrito aunque VIES no lo confirme), si está en dólares (falta el cambio a euros) o si el total y el IVA que da Holded no son los que cobró Stripe. **Ni se crea** (aviso «Facturar a mano») si es una venta en España sin IVA o a la UE sin IVA ni inversión.
   - `license`: con `LICENSE_MODE=manual` (lo de hoy, sección 0), no firma. Apunta la licencia pedida (tabla `license_requests`, con la modalidad, el equipo y el `soporte_hasta` del producto), se la pide a Eric por correo y, si a las 12 horas sigue sin firmar, avisa. Al subirla firmada, llega al cliente (`license_email`) y a la zona. Con `LICENSE_MODE=kms`, firma con la clave de la web en Google Cloud KMS, con id `PML-LIC-<año>-NNNN` de una secuencia atómica **del 5001 al 9999** (del 0001 al 5000 son del Mac de Eric). Un pago de prueba nunca se firma con la clave de producción, ni al revés (`LICENSE_KEY_ENV`); a mano, lo mismo con la clave del Mac y una de pruebas.
   - `account`: la cuenta en la zona (Supabase Auth) con el correo de la compra, como titular por esa compra.
   - `booking` (Acompañado): reserva en Cal.com el hueco elegido. Si se ocupó durante el pago, el cliente elige otro en la zona. Si Cal.com no responde, a los 3 intentos se da por fallida: la bienvenida sale igual («te la confirmamos») y el aviso de la venta dice que hay que reservarla a mano.
   - `welcome`: el correo con el enlace a la zona, la licencia (en un `.zip`: Brevo no admite `.cerebro-licencia`), la copia de las condiciones aceptadas y, en el Acompañado, la cita. A mano, sale sin la licencia y dice que llega en unas horas.
   - `notice`: un correo a PymaticLabs por venta.
6. **Reintentos.** Un fallo temporal se reintenta con espera (30 s, 1 min, 2 min… hasta 1 h, o lo que diga `Retry-After`). Al tercer fallo seguido llega un aviso a PymaticLabs; al décimo, o con un error permanente (una clave mal puesta, un IVA sin configurar), el paso se para y llega un aviso urgente. pg_cron llama al trabajador cada minuto mientras quede algo pendiente.

**Mensual.** Se contrata desde la zona (página *Mensual*). Si aún quedan meses incluidos (o pagados), con ese plan o uno menor el primer cobro llega al día siguiente de su `soporte_hasta`; con uno mayor, se cobra desde que se contrata. Cada cobro (`invoice.paid`) da factura y licencia nueva (a mano, pedida a Eric como la del pago único) con el `soporte_hasta` del periodo pagado, con el plan del precio cobrado (si se cambia de plan en el portal, el cobro siguiente ya es del nuevo). Solo con un pago único vigente: si no, a revisar y sin licencia.

**Devolución o contracargo** (cláusula 5). Licencia anulada (o, si aún estaba pedida a Eric sin firmar, cancelada, con un «No firmar» para él), zona cerrada, una factura rectificativa por cada devolución de Stripe (o aviso para hacerla a mano si la factura seguía en borrador) y correo al cliente. Sin otro pago único vigente, también se anulan las licencias del mensual y, si es definitivo (devolución o contracargo perdido), se cancela la suscripción en Stripe. Si la empresa sigue por otra compra, quien entró como titular por la devuelta pierde ese acceso. Una **petición de información** del banco (`warning_*`) solo avisa; un **contracargo** anula mientras dura, y si se gana (o la petición se cierra sin contracargo) vuelven la licencia, las del mensual y la zona. La rectificativa queda en borrador con un aviso (`HOLDED_CREDIT_NOTE_MODE=draft`): la API v2 de Holded no la enlaza con su factura y Verifactu lo pide.

**Versión nueva.** `scripts/publicar-version.mts` sube los ficheros al almacén privado y la publica; cada persona de cada cliente recibe un correo.

**Conciliación diaria** (05:15 UTC). Toda licencia de la web (también las firmadas a mano) tiene que tener su pago cobrado en Stripe: una sin pago es un aviso urgente (sale en cuanto se ve, de pocos en pocos a la vez y con tiempo tasado; si no da tiempo a todas, el aviso lo dice). Un pago cobrado que la web no conoce (un aviso perdido) se entrega en ese momento, salvo que ya se haya devuelto o tenga contracargo. Una licencia pedida a Eric que lleva más de `LICENSE_PENDING_ALERT_HOURS` sin firmar da un aviso cada día.

## 2. Probar sin ninguna cuenta (modo falso)

Con `DELIVERY_MODE=fake` todo corre con piezas falsas: base de datos en memoria, firma con una clave local de prueba, Holded, Stripe y Cal.com de mentira, y los correos en una carpeta (`.delivery-fake/buzon/`). Nunca se monta en falso con `VERCEL_ENV=production`.

Los comandos van con `node` y `npx`: no hace falta pnpm (para instalar dependencias, `corepack pnpm@9 install`).

1. **Pruebas** (sin red, un par de segundos):
   ```bash
   node --test lib/*.test.mts
   ```
   Pago, reintentos, devoluciones, mensual, 100 ventas seguidas, la zona (lo que ve cada persona, la seguridad por filas, los códigos que frenan) y los adaptadores de verdad contra un `fetch` de mentira (KMS, Holded, Brevo, Cal.com, Supabase Storage y Supabase Auth). `lib/delivery-review.test.mts` prueba lo de la revisión: compras con el NIF de otro cliente, devoluciones a la vez, peticiones de información y contracargos con el mensual, el IVA de Stripe Tax, límites de la zona y del pago, etc. `lib/manual-license.test.mts`, las licencias a mano: la pedida y su correo, la bienvenida sin licencia, lo que se comprueba al subirla, el aviso si tarda, la devolución y el contracargo antes de firmarla y el mensual. `lib/production-check.test.mts`, la comprobación de producción contra servicios de mentira (y que no enseña secretos).
2. **Punta a punta contra la web de verdad** (`next start` en modo falso, con avisos de Stripe firmados con un secreto de prueba):
   ```bash
   npx next build
   node scripts/e2e-entrega.mts --start
   ```
   Recorre: aviso firmado y repetido, Acompañado comprado desde `/comprar`, compra con equipo, entrar en la zona con el código del buzón, bajar la licencia, dar de alta a alguien del equipo, publicar una versión y bajarla con enlace firmado, las páginas de la zona con y sin sesión, un cobro del mensual, una compra con el NIF de otro cliente (a revisar, sin acceso), una devolución, la conciliación y la zona de muestra. Después levanta otra web con `LICENSE_MODE=manual` (en el puerto siguiente) y recorre las licencias a mano: la compra, el correo a Eric con los campos, `scripts/subir-licencia.mts` contra esa web (una que no cuadra y la buena), el correo al cliente con la licencia, bajarla de la zona, un cobro del mensual firmado con `--firmar-prueba` y `/api/admin/health`. Tiene que acabar en `OK`.
3. **La zona de muestra**, para verla o sacar capturas sin Supabase:
   ```bash
   DELIVERY_MODE=fake DELIVERY_SITE_URL=http://127.0.0.1:3005 CHECKOUT_OPEN=true STRIPE_WEBHOOK_SECRET=whsec_local npx next start -p 3005
   ```
   (`DELIVERY_SITE_URL`, para que las descargas y el portal de prueba se queden en local.)
   y abrir `http://127.0.0.1:3005/api/dev/zona-demo` (la titular de una compra Acompañado con equipo), `/api/dev/zona-demo/miembro` (una persona de su equipo), `/api/dev/zona-demo/solo` (Hazlo tú para una persona) o con `/en` al final (en inglés). Monta la muestra comprando por el camino de verdad con las piezas falsas y entra con el código del buzón. Sin `-H 127.0.0.1`: con él, el middleware de idiomas entra en bucle.
4. **Una compra a mano en local:** lo mismo, comprando desde `/precios` o `/comprar/acompanado`. La página de pago de prueba (`/api/dev/checkout`) manda al webhook los avisos que mandaría Stripe. Lo que han hecho las piezas, en `/api/dev/state`; los correos (y los códigos para entrar), en `.delivery-fake/buzon/`.

## 3. Lo que hay que crear en cada servicio

En este orden: Supabase y Brevo primero (Supabase manda los códigos por el SMTP de Brevo), luego Google Cloud KMS, Stripe, Holded, Cal.com y por último Vercel. Cada valor que sale de aquí va a la variable que se dice entre paréntesis (lista completa en la sección 4).

### 3.1 Supabase (base de datos, acceso a la zona y almacén)

1. **Proyecto.** En [supabase.com](https://supabase.com), *New project*, región **West EU (Ireland)**, la del de pruebas (`Cerebro`, ref `drckfsbbopevlnaayxqq`). Uno para pruebas y, más adelante, otro para producción, **en la misma región**: con el plan Hobby de Vercel las funciones están en una sola región para todo. Para producción, el plan **Pro**: el gratuito pausa el proyecto tras una semana sin uso (se pararían la cola y la zona) y no tiene copias de seguridad diarias.
2. **Claves.** *Project Settings > API Keys*: la URL del proyecto (`SUPABASE_URL`), la clave publicable `sb_publishable_...` (`SUPABASE_ANON_KEY`) y una clave secreta `sb_secret_...` (`SUPABASE_SERVICE_ROLE_KEY`). Valen también las antiguas `anon` y `service_role`, pero con la secreta nueva los límites de los códigos cuentan por la IP de cada persona (paso 7). La secreta, solo en el servidor: nunca en una variable `NEXT_PUBLIC_`.
3. **Las tablas.** Aplicar las cuatro migraciones de `supabase/migrations/`, en orden. Con la CLI:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref del proyecto>
   npx supabase db push
   ```
   o pegándolas una a una en *SQL Editor*. Crean las tablas, las funciones atómicas, la seguridad por filas (RLS), los dos buckets privados (`releases` y `customer-files`), las extensiones `pg_cron` y `pg_net`, las tareas programadas (la cola cada minuto, la conciliación diaria y los borrados de huellas de IP y de límites), las licencias pedidas a Eric (`license_requests`) y `entrega_estado()`, que usa la comprobación de producción para ver las tareas, Vault y los buckets. Comprobar en *Database > Extensions* que `pg_cron` y `pg_net` quedan activas (la comprobación de producción también lo mira).
   Si se pegan en el *SQL Editor*, apuntarlas después como aplicadas, o un `npx supabase db push` posterior intentará repetirlas y parará en la primera tabla (es lo mismo que `npx supabase migration repair --status applied <versiones>`):
   ```sql
   create schema if not exists supabase_migrations;
   create table if not exists supabase_migrations.schema_migrations (version text not null primary key);
   alter table supabase_migrations.schema_migrations add column if not exists statements text[];
   alter table supabase_migrations.schema_migrations add column if not exists name text;
   insert into supabase_migrations.schema_migrations (version, name) values
     ('20261021120000', 'entrega'), ('20261021120100', 'almacen'), ('20261021120200', 'cron'), ('20261021130000', 'licencias_a_mano')
   on conflict (version) do nothing;
   ```
   Los permisos de las tablas van explícitos en las migraciones: valen igual con «Automatically expose new tables» encendido o apagado (en los proyectos nuevos viene apagado).
4. **Los secretos del trabajador**, en *SQL Editor* (viven en Vault, nunca en el repo; la URL es la de la web que recibe las llamadas: la de pruebas en el proyecto de pruebas):
   ```sql
   select vault.create_secret('https://<la web de pruebas>', 'entrega_site_url');
   select vault.create_secret('<el mismo valor que JOBS_SECRET>', 'entrega_jobs_secret');
   ```
   Si la web de pruebas es una Preview con la protección de Vercel (3.7, paso 4), un tercero con el secreto de *Protection Bypass for Automation*; el trabajador lo manda en la cabecera `x-vercel-protection-bypass`. En producción no hace falta.
   ```sql
   select vault.create_secret('<el secreto de bypass de Vercel>', 'entrega_vercel_bypass');
   ```
5. **La secuencia de licencias.** No hay que sembrarla: la web numera sola **del 5001 al 9999 de cada año**. Del 0001 al 5000 son del Mac de Eric: las que él sube a mano (`origin = 'manual'`) solo pueden ir ahí, y las de la web solo del 5001 (la tabla `licenses` lo comprueba).
6. **El acceso con código** (*Authentication*):
   - *Sign In / Providers > Email*: activo. **Email OTP Expiration: 600** (10 minutos) y **Email OTP Length: 8** (la zona lo dice así; 8 cifras en vez de 6 hacen inútil probar códigos).
   - *Sign In / Providers > Email*: **«Confirm email» y «Secure email change» encendidos**. La zona reconoce por su correo confirmado a quien se dio de alta antes de tener cuenta; sin esos dos, un cambio de correo sin confirmar podría heredar esas altas.
   - *Sign In / Providers*: **apagar «Allow new users to sign up»**. Las cuentas solo las crean las compras y las altas del equipo (con la clave secreta); la web pide los códigos con `shouldCreateUser: false`.
   - *Emails > SMTP Settings*: **SMTP propio con Brevo** (sección 3.2): host `smtp-relay.brevo.com`, puerto `587`, usuario el *SMTP login* de Brevo, contraseña una *SMTP key* de Brevo, remitente `info@pymaticlabs.com` (o el que esté verificado en Brevo) con el nombre «Pymatic Labs». El correo propio de Supabase solo sirve para probar: manda 2 a la hora.
   - *Emails > Templates > Magic Link*: es el que lleva el código. Asunto `Tu código para entrar · Your access code` y un cuerpo con `{{ .Token }}`, por ejemplo:
     ```html
     <p>Tu código para entrar en la zona de socio del Cerebro Digital:</p>
     <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
     <p>Vale 10 minutos y una sola vez. Si no lo has pedido tú, ignora este correo.</p>
     <hr>
     <p>Your code to sign in to the Digital Brain member area: <strong>{{ .Token }}</strong>. It is valid for 10 minutes, once.</p>
     ```
     Sin enlaces: la zona no usa el enlace mágico.
   - *URL Configuration*: *Site URL* la de la web (`https://pymaticlabs.com`; en pruebas, la de pruebas).
7. **Los límites** (*Authentication > Rate Limits*). Todas las peticiones a Supabase Auth salen del servidor de la web, así que los límites por IP serían de todos los clientes a la vez:
   - Usar la clave secreta `sb_secret_...` y encender **IP address forwarding**: la web manda la IP de cada persona y el límite es suyo. **No subir** los límites globales de *sign-ins* y *token verifications* para compensar: con ellos altos, probar códigos sale barato.
   - **Rate limit for sending emails**: subirlo (por ejemplo, 100 por hora): tras un aviso de versión nueva entran muchos a la vez.
   - El de «un código por correo cada 60 segundos» se deja: la zona ya pide esperar ese minuto.
   - Además, la web tiene los suyos (tabla `rate_limits`, con huellas de la IP y del correo): 5 códigos probados por correo cada 15 minutos y ese correo espera (aunque cambie de IP), 30 por IP; 5 códigos pedidos por correo cada hora y 10 por IP cada 15 minutos. El código se manda después de contestar, así que la respuesta tarda igual sea o no cliente.
8. **Almacén** (*Storage*): los buckets los crea la migración; comprobar que `releases` y `customer-files` son **privados**. En *Storage > Settings*, el tamaño máximo de fichero tiene que admitir las extensiones (unos 20 MB; el plan gratuito llega a 50 MB).
9. **Data API** (en los ajustes del proyecto): activa, con el esquema `public` expuesto. La zona la usa para la segunda comprobación por filas (RLS) con la sesión de cada persona.

### 3.2 Brevo (correo, en la UE)

1. Cuenta en [brevo.com](https://www.brevo.com) a nombre de PymaticLabs. El plan gratuito manda 300 correos al día; para 100 ventas seguidas (bienvenida, código, aviso interno y factura por cada una) hace falta un plan de pago.
2. **Dominio** (*Senders, Domains & Dedicated IPs > Domains*): añadir `pymaticlabs.com` y poner en el DNS los registros que da Brevo: el `brevo-code` (TXT), **DKIM** y **DMARC**. **SPF**: un solo registro SPF por dominio; si ya está el de Google Workspace, se añade el de Brevo al mismo (`v=spf1 include:_spf.google.com include:spf.brevo.com ~all`). Esperar a que salga «Authenticated».
3. **Remitente** (*Senders*): `info@pymaticlabs.com` (`DELIVERY_FROM_EMAIL`) verificado.
4. **Clave de la API** (*SMTP & API > API keys*): una nueva (`BREVO_API_KEY`).
5. **Clave SMTP** (*SMTP & API > SMTP*): una *SMTP key* y el *SMTP login*: van en Supabase (3.1, paso 6), no en Vercel.
6. Si se puede, apagar el seguimiento de aperturas y clics en los correos transaccionales: los correos llevan enlaces a la zona y no hace falta medirlos.

### 3.3 Google Cloud KMS (la clave que firma las licencias)

**Solo con `LICENSE_MODE=kms`**, cuando el producto acepte la publica de la web (sección 9). Para abrir la venta hoy no hace falta: las licencias las firma Eric (sección 0).

La web firma con una **clave propia, distinta de la del Mac de Eric**, que no sale nunca de KMS: el servidor solo puede pedir firmas.

**Una clave y una cuenta de servicio por entorno.** La de producción firma solo pagos de Stripe en vivo, y su publica es la que conoce el producto. Para Preview (Stripe en pruebas, `CHECKOUT_OPEN=true`) se crea otra clave en otro anillo (por ejemplo `licencias-pruebas`) con su propia cuenta de servicio, se pone `LICENSE_KEY_ENV=test` y **su publica nunca va al producto**: si no, cualquiera que pagara con la tarjeta de prueba `4242…` en la web de pruebas tendría una licencia que vale de verdad. La web lo comprueba: con `LICENSE_KEY_ENV=production` no firma pagos de prueba, con `test` no firma pagos en vivo, y la clave de KMS nunca se monta con pagos de mentira (`DELIVERY_MODE=fake` o `DELIVERY_PAYMENTS=fake`).

1. Un proyecto de Google Cloud (por ejemplo `pymaticlabs-licencias`) con facturación y la **Cloud Key Management Service (KMS) API** activada.
2. **Anillo y clave**, en una región europea (`europe-west1`, Bélgica, o `europe-southwest1`, Madrid):
   ```bash
   gcloud kms keyrings create licencias --location europe-west1
   gcloud kms keys create web --keyring licencias --location europe-west1 \
     --purpose asymmetric-signing --default-algorithm ec-sign-ed25519 --protection-level software
   ```
   `EC_SIGN_ED25519` firma Ed25519 puro sobre el texto tal cual, como firma la licencia `licencia.py`. Su nombre completo, con la versión, va en `GCP_KMS_KEY_VERSION`: `projects/<proyecto>/locations/europe-west1/keyRings/licencias/cryptoKeys/web/cryptoKeyVersions/1`. Una clave asimétrica no rota sola, y así tiene que ser.
3. **Una cuenta de servicio que solo firma**, con permiso sobre esa clave y nada en el proyecto:
   ```bash
   gcloud iam service-accounts create entrega-web --display-name "Entrega de la web (solo firma)"
   gcloud kms keys add-iam-policy-binding web --keyring licencias --location europe-west1 \
     --member serviceAccount:entrega-web@<proyecto>.iam.gserviceaccount.com --role roles/cloudkms.signer
   gcloud kms keys add-iam-policy-binding web --keyring licencias --location europe-west1 \
     --member serviceAccount:entrega-web@<proyecto>.iam.gserviceaccount.com --role roles/cloudkms.publicKeyViewer
   gcloud iam service-accounts keys create entrega-web.json \
     --iam-account entrega-web@<proyecto>.iam.gserviceaccount.com
   ```
   El contenido de `entrega-web.json` (o en base64, más cómodo en Vercel) va en `GOOGLE_SERVICE_ACCOUNT_JSON`, **marcada Sensitive y solo en el entorno Production** de Vercel: las variables de Preview las ve el despliegue de cualquier rama, así que quien pudiera subir una rama podría firmar con la clave de producción. Después se borra el fichero del ordenador. Si Google no deja crear la clave JSON, es la política de la organización `iam.disableServiceAccountKeyCreation` (viene puesta en las organizaciones nuevas): quien administre la organización la quita para este proyecto. Lo mejor, cuando se pueda, es no tener clave JSON: *Workload Identity Federation* de Google con el OIDC de Vercel, limitado al entorno Production (la web aún no lo usa: hoy lee la clave JSON).
4. **Que cada firma deje rastro.** *IAM & Admin > Audit Logs > Cloud Key Management Service (KMS) API*: activar los registros de lectura y escritura de datos. En *Logging*, una alerta por correo con el filtro `protoPayload.methodName="AsymmetricSign"` y el anillo `licencias`: cada licencia firmada da un aviso, y una firma sin venta salta a la vista. Las firmas hechas fuera de la web no llegan a la tabla `licenses` y la conciliación no las ve: para eso, una métrica de registros con ese filtro y, en *Cloud Monitoring*, una alerta si las firmas del día superan las licencias nuevas del día (`select count(*) from licenses where created_at > now() - interval '1 day'`).
5. **La publica, para Eric y para la web.** Con `GCP_KMS_KEY_VERSION` y `GOOGLE_SERVICE_ACCOUNT_JSON` en `.env.local`:
   ```bash
   node --env-file=.env.local scripts/clave-web-publica.mts
   ```
   imprime la publica en el formato de `esqueleto/firmas/licencias.pub` (base64 de los 32 bytes). También `GET /api/admin/public-key` (con `ADMIN_SECRET`), o con gcloud y openssl:
   ```bash
   gcloud kms keys versions get-public-key 1 --key web --keyring licencias --location europe-west1 --output-file web.pem
   openssl pkey -pubin -in web.pem -outform DER | tail -c 32 | base64
   ```
   Esa publica va en `LICENSE_WEB_PUBLIC_KEY` (si KMS diera otra, la web no firma) y a Eric, para el esqueleto (sección 9).
6. **Si la clave se compromete:** desactivar su versión en KMS, crear la versión 2, cambiar `GCP_KMS_KEY_VERSION` y `LICENSE_WEB_PUBLIC_KEY`, poner la publica vieja en `LICENSE_REVOKED_KEYS` y que Eric la anule en la versión siguiente del esqueleto, sin tocar las demás licencias.

*AWS KMS* sería la alternativa (clave `ECC_NIST_EDWARDS25519`, firma `ED25519_SHA_512` con `MessageType: RAW`), pero no está hecha en la web.

### 3.4 Stripe (en modo de prueba)

1. **Modo de prueba** (o un *sandbox*) en la cuenta de PymaticLabs. *Developers > API keys*: la clave secreta `sk_test_...` (`STRIPE_SECRET_KEY`).
2. **Datos públicos** (*Settings > Business > Public details*): la URL de las condiciones `https://pymaticlabs.com/condiciones` (la exige la casilla de Checkout), la de privacidad `https://pymaticlabs.com/privacidad-producto`, el correo de soporte y el nombre que se ve en el pago.
3. **Stripe Tax** (*Tax*): activarlo con la dirección de origen de PymaticLabs (Castellón) y el **registro del IVA de España**. Solo se vende a empresas, así que no hace falta la ventanilla única (OSS). El código de impuesto de los productos lo pone el script (`txcd_10000000`, servicios electrónicos; se cambia con `STRIPE_TAX_CODE`).
4. **Métodos de pago:** la web pide solo tarjeta (`payment_method_types: card`, con Apple Pay y Google Pay), así que no hace falta tocar *Settings > Payment methods*; un pago diferido (SEPA) dejaría la plaza de lanzamiento y el hueco sin apartar mientras se cobra.
5. **Productos, precios, cupones, portal y webhook**, de una vez y sin duplicar si se repite:
   ```bash
   node --env-file=.env.local scripts/stripe-setup.mts --webhook https://<la web de pruebas>/api/stripe/webhook
   ```
   Crea un producto por modalidad con su precio en EUR y en USD (sin IVA, por `lookup_key` `cerebro-<modalidad>`), el mensual con un producto y un precio por plan (el portal no deja cambiar entre precios de un mismo producto), Stripe Tax si falta (la sede de Castellón y el registro del IVA de España), el cupón de lanzamiento de cada modalidad (`cerebro-lanzamiento-<modalidad>`, 10 usos), el **portal de cliente** (cambiar de plan, tarjeta, dirección, correo, facturas y cancelar al final del periodo; **ni el NIF ni la razón social**, que son los de la licencia y de Holded) y el **endpoint del webhook** con estos avisos: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `invoice.paid`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.funds_withdrawn`, `charge.dispute.closed`, `customer.subscription.created`, `customer.subscription.updated` y `customer.subscription.deleted`. Imprime una sola vez el secreto del webhook: va en `STRIPE_WEBHOOK_SECRET`. Si ya se había creado antes, volver a pasarlo: pone al día los avisos y el portal.
6. **Comprobar en el panel:** *Settings > Billing > Customer portal* (la configuración «cerebro» activa, con los enlaces de condiciones y privacidad) y *Developers > Webhooks* (el endpoint, en verde tras la primera compra).
7. **En local**, en vez del endpoint: [Stripe CLI](https://docs.stripe.com/stripe-cli) con `stripe listen --forward-to localhost:3000/api/stripe/webhook`, que da su propio `whsec_...` para `.env.local`.

### 3.5 Holded (facturas)

**Holded no tiene modo de prueba, y una factura emitida con Verifactu no se deshace.** Para las pruebas: una cuenta de Holded aparte (de prueba, sin Verifactu) o, si no, la de verdad con `HOLDED_INVOICE_MODE=draft` y borrando los borradores después.

1. **Clave de la API** (*Configuración > Desarrolladores*): una nueva con permisos de facturas (`sales:invoices.read` y `.write`) y contactos (`contacts:contacts.read` y `.write`) (`HOLDED_API_KEY`).
2. **Los impuestos de la cuenta:**
   ```bash
   curl -s -H "Authorization: Bearer <HOLDED_API_KEY>" https://api.holded.com/api/v2/taxes
   ```
   Los ids del IVA del 21 % (`HOLDED_TAX_STANDARD`, por defecto `s_iva_21`), de la inversión del sujeto pasivo a la UE (`HOLDED_TAX_REVERSE_CHARGE`), de las ventas fuera de la UE (`HOLDED_TAX_EXPORT`) y del exento (`HOLDED_TAX_EXEMPT`). Sin el que toca, esa factura no se hace y llega un aviso: un IVA mal puesto en Verifactu no se arregla solo.
3. **Series** (opcional): una serie propia para las facturas de la web y otra para las rectificativas (`HOLDED_INVOICE_SERIES_ID`, `HOLDED_CREDIT_NOTE_SERIES_ID`).
4. **Modo:** `HOLDED_INVOICE_MODE=draft` hasta confirmar con Holded que aprobar por la API registra en Verifactu. Con `emit`, antes de aprobar cada factura la web la vuelve a leer y compara el total y el IVA con lo que cobró Stripe: si no cuadran (o Holded no los diera: la referencia de la v2 los da como texto, `"121.00"`), la deja en borrador y avisa. Las rectificativas van aparte, con `HOLDED_CREDIT_NOTE_MODE=draft` por defecto (borrador y aviso para enlazarla a su factura y emitirla): pasarlo a `emit` solo tras comprobar una de verdad, con el signo de los importes (`HOLDED_CREDIT_NOTE_SIGN`). La referencia de la v2 (octubre de 2026) confirma que `POST /credit-notes` no tiene campo para la factura que rectifica; `POST /documents/convert` (de `invoice` a `creditnote`) sí crea una rectificativa **vinculada** a la factura: es el camino para hacerlas solas, a probar en la cuenta (copia la factura entera: en una devolución parcial habría que ajustar las líneas). Las facturas en dólares admiten `currency_change` (el cambio), pero la web aún no lo pone: quedan en borrador con aviso.
5. **Cuota:** Holded limita las llamadas al mes según el plan (Plus, 500). Cada venta gasta unas 6: para 100 ventas al mes, el plan Basic o superior.

### 3.6 Cal.com (sesiones del Acompañado)

1. Un **equipo** de PymaticLabs en Cal.com con Eric y Sergio.
2. **Dos tipos de evento de 1 hora**, uno por persona («Montaje con Eric», con Eric de anfitrión, y «Montaje con Sergio»), por videollamada, sin «requiere confirmación».
3. **Horario** de cada uno en `Europe/Madrid`: de lunes a viernes de 18:00 a 22:00 y los sábados de 10:00 a 14:00. Antelación mínima de 24 horas (la web ofrece desde mañana).
4. **Los ids** de los dos eventos (salen en la dirección al editarlos: `.../event-types/<id>`) en `CALCOM_EVENT_TYPES`, como JSON: `{"eric": 123, "sergio": 456}`.
5. **Clave de la API v2** (*Settings > Developer > API Keys*) de alguien que administre el equipo (`CALCOM_API_KEY`).

### 3.7 Vercel (la web)

1. Las variables de la sección 4 en *Settings > Environment Variables*: las de prueba en **Preview** (y en *Development* si se usa `vercel env pull`); las de producción, más adelante, en **Production**. En Production, `CHECKOUT_OPEN=false` y `DELIVERY_MODE=live` (o sin poner). Los secretos de producción (`GOOGLE_SERVICE_ACCOUNT_JSON`, `STRIPE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `HOLDED_API_KEY`, `BREVO_API_KEY`, `JOBS_SECRET`, `ADMIN_SECRET`, `DELIVERY_IP_SALT`), **Sensitive y solo en Production**; Preview lleva los suyos de pruebas, nunca los mismos.
2. `JOBS_SECRET` y `ADMIN_SECRET`: largos y aleatorios, distintos en pruebas y en producción (por ejemplo, `openssl rand -hex 32`). El `JOBS_SECRET` es el mismo que se guardó en Vault (3.1, paso 4).
3. **Región de las funciones** (*Settings > Functions > Function Region*): **Dublín (dub1)**, junto a Supabase (Irlanda): menos espera en cada paso y los datos se quedan en la UE. Si algún día Supabase se va a otra región, la de las funciones va con él.
4. La web de pruebas tiene que tener una dirección fija para Stripe y para Vault (un dominio de pruebas o la de la rama de Preview) y, si tiene la protección de Vercel activada, Stripe y pg_cron no podrán llamarla: usar *Protection Bypass for Automation* (*Settings > Deployment Protection > Add Secret*): el secreto va en Vault (`entrega_vercel_bypass`, 3.1, paso 4) y en la dirección del webhook de Stripe, `https://<la web de pruebas>/api/stripe/webhook?x-vercel-protection-bypass=<el secreto>`. Con el plan Hobby no se pueden excluir rutas. Para los scripts que llaman a la web de pruebas (`comprobar-produccion.mts --web`, `subir-licencia.mts --web`), el mismo secreto en `.env.local` como `VERCEL_BYPASS_SECRET`; la web lo recibe sola de Vercel (`VERCEL_AUTOMATION_BYPASS_SECRET`) para comprobar sus propias páginas.

## 4. Todas las variables

Las mismas que en `.env.example`. «Prueba» es lo que va en `.env.local` y en Preview; «producción», en Production.

### Web y compra

| Variable | Qué es | De dónde sale | Prueba / producción |
|---|---|---|---|
| `RESEND_API_KEY` | Correo del formulario de contacto | Resend | la misma |
| `CONTACT_EMAIL` | Buzón del formulario y, si no se dice otro, de los avisos internos | — | `hola@pymaticlabs.com` |
| `NEXT_PUBLIC_SITE_URL` | La dirección pública de la web | — | la de pruebas / `https://pymaticlabs.com` |
| `CHECKOUT_OPEN` | `true` enseña los botones de compra y deja contratar el mensual | — | `true` en pruebas / `false` hasta abrir la venta |
| `CHECKOUT_MINUTES` | Lo que dura un pago abierto (mínimo 30): lo que se apartan la plaza y el hueco | — | `30` |
| `LAUNCH_LIMIT` | Plazas del precio de lanzamiento, en total | Oferta | `10` |
| `LAUNCH_CLIENT_LIMIT` | Plazas abiertas a la vez desde una misma IP (o /64) | — | `2` |
| `DELIVERY_IP_SALT` | Sal de las huellas de IP y de correo. **Obligatoria en vivo** (sin ella no arranca) | `openssl rand -hex 32` | una distinta en cada sitio |
| `LIMIT_CHECKOUT_PER_IP`, `LIMIT_HOLDS_PER_IP`, `LIMIT_HOLDS_TOTAL` | Pagos abiertos por IP cada 10 min; huecos de Cal.com apartados por IP y en total mientras dura un pago | — | `10`, `3`, `30` |
| `LIMIT_LOGIN_PER_IP`, `LIMIT_LOGIN_PER_EMAIL`, `LIMIT_VERIFY_PER_IP`, `LIMIT_VERIFY_PER_EMAIL`, `LIMIT_TEAM_ADDS_PER_DAY` | Códigos pedidos por IP (15 min) y por correo (hora); probados por IP y por correo (15 min); altas en el equipo por empresa y día | — | `10`, `5`, `30`, `5`, `20` |

### Entrega: modo y correos

| Variable | Qué es | De dónde sale | Prueba / producción |
|---|---|---|---|
| `DELIVERY_MODE` | `fake` (todo falso, sin cuentas) o `live` | — | `live` con las cuentas de prueba / `live` |
| `DELIVERY_REPOSITORY`, `DELIVERY_SIGNER`, `DELIVERY_INVOICER`, `DELIVERY_MAILER`, `DELIVERY_STORAGE`, `DELIVERY_CALENDAR`, `DELIVERY_AUTH`, `DELIVERY_PAYMENTS` | Cambiar una sola pieza a la falsa o a la de verdad (por ejemplo, todo de verdad menos `DELIVERY_INVOICER=fake`) | — | sin poner |
| `DELIVERY_SITE_URL` | La dirección de la web en los enlaces de correos y pagos (por defecto, `NEXT_PUBLIC_SITE_URL`) | — | la de pruebas / sin poner |
| `DELIVERY_FAKE_DIR`, `DELIVERY_FAKE_SECRET`, `DELIVERY_FAKE_SIGNING_SEED`, `DELIVERY_FAKE_BUSY_DAYS` | Solo en modo falso: carpeta del buzón y del almacén, secreto de sus cookies y enlaces, clave de prueba fija y días llenos del calendario falso | — | sin poner |
| `DELIVERY_FROM_EMAIL`, `DELIVERY_FROM_NAME` | Remitente de los correos a clientes (verificado en Brevo) | Brevo | `info@pymaticlabs.com`, `Pymatic Labs` |
| `DELIVERY_INTERNAL_EMAIL` | Avisos de cada venta | — | `info@pymaticlabs.com` |
| `DELIVERY_ALERT_EMAIL` | Alertas (pasos parados, licencias sin pago) | — | `info@pymaticlabs.com` |
| `BREVO_API_KEY` | API de correo transaccional | Brevo (3.2) | una por entorno |

### Entrega: Stripe y Supabase

| Variable | Qué es | De dónde sale | Prueba / producción |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Clave secreta de Stripe (con una `sk_live_` solo se procesan avisos en vivo; con una de prueba, solo de prueba) | Stripe (3.4) | `sk_test_...` / `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Secreto del endpoint del webhook | `scripts/stripe-setup.mts --webhook` o `stripe listen` | uno por endpoint |
| `STRIPE_TAX_CODE` | Solo para `stripe-setup.mts`: código de impuesto de los productos | Stripe Tax | sin poner (`txcd_10000000`) |
| `SUPABASE_URL` | URL del proyecto | Supabase (3.1) | el proyecto de pruebas / el de producción |
| `SUPABASE_ANON_KEY` | Clave publicable (sesión de cada persona, RLS) | Supabase | `sb_publishable_...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave secreta (crear cuentas, la cola, el almacén) | Supabase | `sb_secret_...` |

### Entrega: licencias, facturas y sesiones

| Variable | Qué es | De dónde sale | Prueba / producción |
|---|---|---|---|
| `LICENSE_MODE` | `manual`: la web no firma; pide cada licencia a Eric y él la sube (sección 0). `kms`: la firma la web con su clave de KMS. Sin poner: `manual` en vivo salvo que KMS esté puesto; en falso, firma la clave local de prueba. En Production, siempre escrita (sin ella y con KMS puesto, la comprobación da FALTA) | — | `manual` / **`manual`** hasta la sección 9 |
| `LICENSE_REQUEST_EMAIL` | A quién se piden las licencias a mano (y los «No firmar») | — | el de Eric |
| `LICENSE_MANUAL_PUBLIC_KEY` | La publica con la que tienen que verificar las licencias subidas. Sin poner, la del Mac de Eric (`licencias.pub`), que solo entrega pagos en vivo; otra es una clave de pruebas, que solo entrega pagos de prueba | `scripts/subir-licencia.mts --crear-clave-prueba` | la de pruebas en Preview / **sin poner** |
| `LICENSE_PENDING_ALERT_HOURS` | Horas sin firmar tras las que una licencia pedida da aviso | — | `12` |
| `LICENSE_TEST_SEED` | Solo en tu `.env.local`, para `subir-licencia.mts --firmar-prueba`: la privada de la clave de pruebas | `--crear-clave-prueba` | la de pruebas / nunca |
| `GCP_KMS_KEY_VERSION` | La versión de la clave de la web en KMS | Google Cloud (3.3) | **una clave distinta en cada entorno**: la de pruebas nunca va al producto |
| `LICENSE_KEY_ENV` | De qué entorno es la clave: `production` solo firma pagos en vivo; `test` solo de prueba | — | `test` / sin poner (`production`) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | La cuenta de servicio que solo firma (JSON o base64) | Google Cloud | **una por entorno**; la de producción, Sensitive y solo en Production |
| `LICENSE_WEB_PUBLIC_KEY` | La publica que debe dar KMS; si no, no se firma | `scripts/clave-web-publica.mts` | la de la clave de cada entorno |
| `LICENSE_INCLUDE_PAYMENT` | Mete el pago de Stripe en la licencia (campo `pago`) | — | `false` hasta que `licencia.py` lo acepte |
| `LICENSE_REVOKED_KEYS` | Publicas anuladas, separadas por comas (lista de anuladas del esqueleto) | — | vacío |
| `HOLDED_API_KEY` | Clave de la API de Holded | Holded (3.5) | la de la cuenta de pruebas / la de verdad |
| `HOLDED_INVOICE_MODE` | `draft` (borrador y aviso para emitirla a mano) o `emit` | — | `draft` / `draft` hasta confirmar Verifactu |
| `HOLDED_TAX_STANDARD`, `HOLDED_TAX_REVERSE_CHARGE`, `HOLDED_TAX_EXPORT`, `HOLDED_TAX_EXEMPT` | Ids de impuesto de la cuenta | `GET /api/v2/taxes` | los de cada cuenta |
| `HOLDED_INVOICE_SERIES_ID`, `HOLDED_CREDIT_NOTE_SERIES_ID` | Series de facturas y rectificativas (opcional) | Holded | los de cada cuenta |
| `HOLDED_CREDIT_NOTE_SIGN` | Signo de las rectificativas: `negative` o `positive` | La primera rectificativa | `negative` |
| `HOLDED_CREDIT_NOTE_MODE` | `draft` (borrador y aviso para enlazarla y emitirla a mano) o `emit` | — | `draft` / `draft` hasta comprobar una |
| `HOLDED_API_URL` | Dirección de la API | — | `https://api.holded.com/api/v2` |
| `CALCOM_API_KEY` | Clave de la API v2 | Cal.com (3.6) | la misma |
| `CALCOM_EVENT_TYPES` | Los eventos de cada persona: `{"eric": 123, "sergio": 456}` | Cal.com | los mismos |
| `CALCOM_API_URL` | Dirección de la API | — | `https://api.cal.com/v2` |

### Entrega: cola, descargas y llamadas internas

| Variable | Qué es | De dónde sale | Prueba / producción |
|---|---|---|---|
| `JOBS_SECRET` | Lo manda pg_cron a `/api/jobs/run` y `/api/jobs/reconcile` (también en Vault) | `openssl rand -hex 32` | uno por entorno |
| `ADMIN_SECRET` | Para `/api/admin/*` (licencias a mano, comprobación, versiones, cola, anuladas, publica) | `openssl rand -hex 32` | uno por entorno |
| `JOBS_MAX_ATTEMPTS`, `JOBS_ALERT_AFTER`, `JOBS_BASE_DELAY_MS`, `JOBS_MAX_DELAY_MS`, `JOBS_LOCK_SECONDS`, `JOBS_CONCURRENCY` | Reintentos: tope, aviso tras N fallos, esperas, bloqueo de un intento y pasos a la vez | — | `10`, `3`, `30000`, `3600000`, `120`, `4` |
| `DOWNLOAD_URL_TTL_SECONDS` | Lo que valen los enlaces de descarga | — | `300` |
| `RECONCILE_DAYS` | Días hacia atrás que mira la conciliación | — | `40` |
| `E2E_BASE_URL`, `E2E_PORT` | Solo para `scripts/e2e-entrega.mts` sin `--start` | — | sin poner |
| `E2E_MANUAL_BASE_URL`, `E2E_MANUAL_SEED` | Solo para `scripts/e2e-entrega.mts` sin `--start`: la web con `LICENSE_MODE=manual` y la semilla de su `LICENSE_MANUAL_PUBLIC_KEY` | — | sin poner |

## 5. Prueba de punta a punta con las cuentas de prueba

Con todo lo de la sección 3 en pruebas y la web de pruebas desplegada (o en local con `stripe listen`), `CHECKOUT_OPEN=true` en Preview. En cada paso, `node --env-file=.env.local scripts/comprobar-compra.mts <correo o pi_...>` dice cómo va cada paso de la cola de esa compra, si la licencia verifica con la publica de la web, la factura, quién está en la zona y las sesiones. Sale con error si algo está parado.

Tarjeta de prueba: `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC. En modo de prueba Stripe acepta cualquier NIF con el formato correcto.

Con `LICENSE_MODE=manual` (lo de hoy), donde abajo dice que llega la licencia, llega primero la bienvenida sin ella y la pedida a Eric: se firma con la clave de pruebas y se sube con `scripts/subir-licencia.mts --firmar-prueba` (sección 0), y entonces llega.

1. **Hazlo tú, empresa española.** Comprar desde `/precios` con un correo tuyo, NIF `A12345678` (tipo «ES NIF») y dirección en España. Probar también un NIF de autónomo con letra al final (`12345678Z`): Stripe lo pide como «ES NIF» (`es_cif`) y tiene que aceptarlo. Comprobar:
   - Stripe: el pago con **21 % de IVA** y, en *Developers > Webhooks*, el aviso entregado con 200.
   - `comprobar-compra.mts`: todos los pasos `done`; licencia `hazlo-tu` con `soporte_hasta` del mismo día, que **verifica**.
   - Holded: el contacto con ese NIF y la factura en borrador con el IVA del 21 %; en `info@`, el aviso «Venta» que dice que hay que emitirla.
   - Tu correo: la bienvenida con el `.zip` de la licencia y la copia de las condiciones (con la versión, la huella y quién las aceptó). En Brevo, *Transactional > Logs*, los correos enviados.
2. **La zona.** Entrar en `/zona` con ese correo: llega el código (por el SMTP de Brevo), se entra, se baja la licencia (el mismo fichero), una descarga (cuando haya versión, paso 6) y la copia de las condiciones. Pedir el código dos veces seguidas: la zona pide esperar un minuto. Un correo que no es cliente: la misma respuesta, y no llega nada.
3. **Acompañado con equipo, empresa alemana.** Desde `/comprar/acompanado-equipo`, elegir hueco con Eric o con Sergio, pagar con NIF-IVA `DE000000000` (tipo «EU VAT»; en pruebas, los acabados en `000000000` salen verificados en VIES, en `111111111` no verificados y en `222222222` pendientes para siempre) y dirección en Alemania. Comprobar: **sin IVA** (inversión del sujeto pasivo) en Stripe y en el borrador de Holded, con la mención; repetir con `DE111111111`: la factura se queda en borrador con el aviso de VIES, aunque Stripe no cobre IVA; la reserva en el calendario de Cal.com de esa persona; la bienvenida con la cita; en la zona, la página *Sesiones* con la primera y los huecos para la segunda (reservarla); *Equipo*: dar de alta a otro correo tuyo, que entra y ve la licencia y las descargas pero no las facturas ni el equipo.
4. **Otro correo con un NIF que ya es cliente.** Comprar un Hazlo tú con el NIF de la compra 1 y otro correo: llega «URGENTE · Compra con el NIF de otro cliente» a `info@`, el titular de la compra 1 recibe el aviso y el nuevo correo no recibe licencia ni puede entrar en la zona.
5. **Precio de lanzamiento.** Las compras anteriores salen con el cupón. En SQL, `select status, count(*) from launch_slots group by status;` cuenta las plazas usadas.
6. **El mensual.** En la zona, *Mensual*: contratar un plan. Con meses incluidos (con equipo, 3 de Pro), con Pro o Esencial Stripe crea la suscripción en prueba hasta el día siguiente al `soporte_hasta`; con Premium, se cobra ya. Para ver un cobro sin esperar: crearla con un [*test clock*](https://docs.stripe.com/billing/testing/test-clocks) de Stripe y adelantarlo; el `invoice.paid` da factura en Holded y una licencia nueva en la zona con la fecha nueva. El botón «Cambiar la tarjeta, el plan o cancelar» abre el portal de Stripe y vuelve a la zona; cambiar de plan ahí y adelantar el reloj: el cobro siguiente sale con el plan nuevo.
7. **Versión nueva.** Con una salida de prueba del esqueleto:
   ```bash
   node --env-file=.env.local scripts/publicar-version.mts --version 0.0.1 --dir <SALIDA> --notas notas.md --notas-en notes.md
   ```
   Los ficheros quedan en el bucket `releases`, llega un correo a cada persona con acceso y la zona los ofrece; el enlace de descarga deja de valer a los 5 minutos.
8. **Devolución.** En Stripe, devolver el pago del Hazlo tú. Comprobar: licencia anulada (`comprobar-compra.mts` dice ANULADA y sale en `GET /api/admin/revocations`), la zona de ese correo dice «Tu acceso a la zona está cerrado», el aviso «rectificar a mano» (la factura era borrador) y el correo al cliente. Con la compra del mensual (paso 6): devolver su pago único anula también sus licencias del mensual y cancela la suscripción.
9. **Contracargo.** Pagar otra compra con la tarjeta `4000 0000 0000 0259` (abre un contracargo al momento): licencia anulada; ganarlo desde el panel de pruebas la devuelve. Con `4000 0000 0000 1976` (petición de información): solo llega el aviso para responder; no se anula nada.
10. **La cola y la conciliación.**
   - En SQL, `select jobname, status, start_time from cron.job_run_details order by start_time desc limit 10;`: pg_cron llama cada minuto (solo cuando hay algo pendiente) y la conciliación a las 05:15 UTC.
   - A mano: `curl -X POST -H "Authorization: Bearer <JOBS_SECRET>" https://<la web de pruebas>/api/jobs/reconcile` tiene que dar `"orphans": []`.
   - Un fallo a propósito: poner mal `HOLDED_API_KEY` en Preview, comprar, ver que el paso `invoice` se reintenta y que al tercer fallo llega la alerta a `info@`; arreglarla y `POST /api/admin/jobs {"action":"retry","id":"<id>"}` si llegó a pararse.
11. **Cien de golpe** (opcional, en local): `node --test lib/delivery.test.mts` ya hace 100 ventas seguidas con las piezas falsas; contra las cuentas de prueba, la cuota de Holded es lo primero que se acaba.

## 6. Antes de abrir la venta

1. La sección 0, entera: con las licencias a mano no hace falta esperar a Eric ni a KMS.
2. Las condiciones y las políticas son borradores: que las revise el abogado. Abrir antes con ellas es decisión de los fundadores. Eric confirma lo pendiente.
3. Si se quiere, además de la de Preview, una compra real de las baratas con una empresa de PymaticLabs, de principio a fin (con la licencia firmada por Eric), y devolverla.
4. `CHECKOUT_OPEN=true` en Production y volver a desplegar.
5. Más adelante, para que la web firme sola: Eric publica la versión del esqueleto que acepta la publica de la web y la lista de anuladas (sección 9), se monta KMS (3.3), `LICENSE_MODE=kms`, y la comprobación otra vez.

## 7. Operación

- **Pasos parados.** `GET /api/admin/jobs?status=dead` (con `Authorization: Bearer <ADMIN_SECRET>`). Arreglada la causa: `POST /api/admin/jobs {"action":"retry","id":"<id>"}`. En SQL: `select key, attempts, last_error from jobs where status <> 'done' order by updated_at desc;`.
- **Cómo va una compra:** `scripts/comprobar-compra.mts <correo | pi_...>` (con las licencias a mano, también si la pedida sigue sin firmar).
- **Licencias a mano** (sección 0): las que faltan, `scripts/subir-licencia.mts --pendientes` o `GET /api/admin/licenses` (`?estado=issued|cancelled` para las demás, `?compra=<id>` para una con sus campos); subir una, `scripts/subir-licencia.mts --compra <id> --fichero <licencia>` o `POST /api/admin/licenses?compra=<id>` con el fichero tal cual. En SQL: `select purchase_id, cliente, status, created_at from license_requests where status = 'pending' order by created_at;`.
- **La comprobación de producción:** `scripts/comprobar-produccion.mts --web https://pymaticlabs.com` (o `GET /api/admin/health`), tras cualquier cambio de variables o de cuentas.
- **Reenviar una licencia.** Está en la zona; el fichero, en `licenses.content`.
- **Lista de anuladas** para el esqueleto: `GET /api/admin/revocations`.
- **Compras a revisar**: llega «Venta a revisar» (o «URGENTE · Compra con el NIF de otro cliente»); quedan en `purchases` con `status = 'needs_review'` y el motivo en `review_data.reason`:
  - `missing_data` (sin NIF, razón social o correo): con los datos del cliente, crear o elegir su fila en `companies`, poner `company_id` y `status = 'paid'` en la compra, y entregarla: `POST /api/admin/jobs {"action":"deliver","purchaseId":"<id>"}`.
  - `nif_conflict` (el NIF de una empresa que ya es cliente, desde un correo que no es de sus titulares; `review_data.companyId` es esa empresa, y sus titulares ya tienen un aviso): **antes de nada, comprobarlo con los titulares**. Si es alguien de la empresa, poner ese `company_id` y `status = 'paid'` y entregarla como arriba (entra como titular por esa compra; si se devuelve, sale). Si no, devolver el pago en Stripe.
  - `no_base` (un cobro del mensual sin pago único vigente): no se firma. Cancelar la suscripción en Stripe si sigue viva y devolver el cobro.
  - `tax_id_changed` (el NIF de la factura de Stripe no es el de la empresa) y `unknown_company`: mirarlo en Stripe antes de facturar.
- **Facturas retenidas**: «Facturar a mano» (ni se creó: IVA dudoso) o «Factura en borrador, sin emitir» (`invoices.hold_reason`: NIF-IVA sin verificar, dólares, totales que no cuadran). Revisarla en Holded y emitirla a mano; la conciliación guarda su PDF para la zona cuando esté emitida.

## 8. La zona de socio

En `/zona` (`/en/zona`), donde enlazan los correos, en el pie de la web y en el botón **Entrar** de arriba a la derecha (los dos, solo con la zona montada: Supabase y `DELIVERY_IP_SALT`, o el modo falso). Se entra en `/zona/entrar` con el correo y un código de un solo uso (Supabase Auth, sin contraseñas). Con la sesión abierta, en lugar de Entrar sale el perfil (las iniciales de la empresa): su correo, su empresa, la zona de socio, la licencia, las descargas, las facturas (solo quien compró) y cerrar la sesión. Las páginas de la web siguen siendo estáticas: la barra pregunta quién es a `/api/zone/me?perfil=1` desde el navegador. Entrar y el perfil ocupan el mismo hueco, así que la barra no se mueve al saberlo; y en un navegador donde ya se entró (una pista en `localStorage`, `pymatic_socio`, sin datos de nadie), mientras pregunta sale un círculo neutro en vez de Entrar. La pista no da acceso a nada: sin sesión, se quita y vuelve Entrar. Las de la zona se pintan en el servidor con la sesión:

| Página | Quién | Qué hay |
|---|---|---|
| `/zona` | todos | Lo de la compra de un vistazo: licencia, versión, próxima sesión, mensual, equipo y facturas |
| `/zona/licencia` | todos | La licencia vigente para bajarla, las anteriores y las anuladas (con las licencias a mano, la que Eric aún no ha firmado sale «en camino») |
| `/zona/descargas` | todos | La última versión para Mac y Windows, en castellano e inglés, el instalador del registro (con equipo) y el SBOM. Cada botón firma el enlace al pulsarlo |
| `/zona/sesiones` | Acompañado | Las sesiones reservadas y, si falta alguna, los huecos de Eric y de Sergio para reservarla (solo quien compró) |
| `/zona/equipo` | quien compró, con equipo | Altas y bajas hasta las plazas de la licencia |
| `/zona/mensual` | quien compró | Su mantenimiento y soporte, el portal de Stripe o los planes para contratarlo |
| `/zona/facturas` | quien compró | Los PDF de facturas y rectificativas y, por compra, las condiciones que aceptó |

**Seguridad.** Cada página y cada acción comprueba en el servidor que la persona tiene acceso a esa empresa (`lib/delivery/zone.ts`); el navegador no decide nada. Con Supabase, además, la base de datos tiene que estar de acuerdo: la zona solo abre las empresas que la seguridad por filas (RLS) deja ver con la sesión de esa persona. La sesión va en cookies `sb-<proyecto>-auth-token` que solo lee el servidor (httpOnly) y caducan a los 7 días sin usar la zona; `proxy.ts` la renueva antes de pintar cada página. Las descargas y facturas salen del almacén privado con enlaces que caducan en minutos. Pedir un código responde siempre igual, sea o no cliente ese correo.

La API que usan las páginas (y que se puede llamar con la sesión):

| Ruta | Qué hace |
|---|---|
| `POST /api/zone/login` `{email, locale}` | Manda el código si el correo tiene acceso (responde igual si no) |
| `POST /api/zone/verify` `{email, code}` | Abre la sesión; 429 si hay demasiados intentos |
| `POST /api/zone/logout` | La cierra |
| `GET /api/zone/me[?company=]` | Todo lo de la zona de una vez |
| `GET /api/zone/me?perfil=1` | Para la barra de arriba: `{available, user}` con el correo y las empresas (sin sesión, `user: null`; sin la zona montada, `available: false`). Siempre 200 |
| `GET /api/zone/licenses/<id>` | El fichero de la licencia |
| `GET /api/zone/downloads/<id>[?json=1]` | Enlace firmado de una descarga |
| `GET /api/zone/invoices/<id>[?json=1]` | El PDF de una factura (solo quien compró) |
| `GET /api/zone/terms/<compra>` | La copia de las condiciones aceptadas |
| `POST`/`DELETE /api/zone/team` `{company, email}` | Alta o baja en el equipo |
| `POST /api/zone/portal` `{company, locale}` | El portal de cliente de Stripe |
| `GET`/`POST /api/zone/sessions` | Huecos libres y reservar la sesión que falta |
| `POST /api/checkout` `{product: "plan-pro", locale, company}` | Contratar el mensual |

## 9. Cambios en el producto (Eric)

Lo que el esqueleto necesita para que la web firme sola (`LICENSE_MODE=kms`: la extensión que se vende tiene que conocer la publica de la web). Hasta entonces, las licencias las firma Eric a mano con la clave de siempre (sección 0), así que esto no frena la venta:

1. **Varias publicas de licencias.** `esqueleto/firmas/licencias.pub` con una línea por clave (la del Mac y la de la web; las líneas con `#` son comentarios), y `verificar()` que acepte la firma de cualquiera. La de la web sale de `scripts/clave-web-publica.mts` (sección 3.3, paso 5).
2. **Lista de anuladas** que viaja con cada versión, por ejemplo `esqueleto/firmas/licencias-anuladas.json`, con el formato de `GET /api/admin/revocations`:
   ```json
   {"formato": 1, "generada": "2026-11-02",
    "licencias": [{"id": "PML-LIC-2026-5007", "motivo": "refund", "desde": "2026-11-02",
                   "clave": "<publica que la firmó, base64>", "huella": "<sha256 del fichero .cerebro-licencia>"}],
    "claves": ["<publica anulada en base64>"]}
   ```
   Una licencia de la lista no vale, pero **se compara por su `clave` y su `huella`** (SHA-256 del fichero tal cual), no solo por el id: así nunca se anula una del Mac con el mismo número. Y una firmada con una clave de `claves` tampoco vale.
3. **Los números de licencia, repartidos.** La web numera del **5001 al 9999** de cada año; el Mac de Eric, del 0001 al 5000 (la web ya no acepta subir una del Mac por encima del 5000). `firmar_licencia.py` debería negarse a pasar del 5000 (su secuencia está en `<CLAVE>.ids.json`).
4. **El pago dentro de la licencia.** El diseño pide el identificador del pago de Stripe en la licencia, pero `licencia.py` rechaza cualquier campo que no sea uno de los siete. Propuesta: un campo opcional `pago` (`pi_...` en el pago único, `in_...` en cada cobro del mensual), firmado como los demás. `lib/license.ts` ya lo sabe escribir y comprobar. Hasta que el esqueleto lo acepte, `LICENSE_INCLUDE_PAYMENT=false`: el pago queda junto a la licencia en la base de datos (`licenses.payment_ref`), que es lo que cruza la conciliación.
5. **Lo nuevo según `soporte_hasta`**, como dice la cláusula 11 (una sola línea de versiones; lo nuevo, apagado si la licencia no cubre la fecha de la versión).

## 10. Pendiente

- Las licencias a mano dependen de que Eric las firme en unas horas: el aviso a las 12 horas y la conciliación diaria lo vigilan, pero si Eric no está, alguien tiene que tener su Mac (o esperar). Lo que lo quita del todo es la sección 9.
- Confirmar con Holded que aprobar por la API registra en Verifactu (hasta entonces, borrador), el signo de las rectificativas, si `POST /documents/convert` sirve para las rectificativas vinculadas (hasta entonces, borrador) y en qué sentido va `currency_change` para poner el cambio de Stripe en las facturas en dólares (hasta entonces, borrador).
- El NIF-IVA se comprueba al facturar (verificación de Stripe en VIES); si VIES tarda más de un par de minutos, la factura queda en borrador con aviso.
- No hay comprobación contra bots (Turnstile o similar) antes de apartar un hueco: los límites por IP y el tope de huecos a la vez frenan, pero alguien con muchas IP podría ocupar ese tope.
- La firma con clave JSON de cuenta de servicio; mejor *Workload Identity Federation* con el OIDC de Vercel (3.3).
- Si las 10 plazas de lanzamiento cuentan por mercado o en total (hoy, en total).
- Los 90 días para usar las sesiones (cláusula 3): no se aplican todavía.
- La página de precios sigue diciendo «2 sesiones de montaje» en las cuatro modalidades y enseña el precio de lanzamiento aunque se acaben las plazas (en el pago se cobra el que toca).
- Las condiciones y la política de privacidad del Cerebro Digital aún no tienen versión en inglés (la web enseña la castellana).

## Dónde está cada cosa

| | |
|---|---|
| `supabase/migrations/` | Tablas, funciones atómicas, seguridad por filas, buckets y pg_cron |
| `lib/checkout.ts` | Las sesiones de Stripe Checkout y los huecos de la primera sesión |
| `lib/delivery/events.ts`, `steps.ts`, `jobs.ts` | Del aviso de Stripe a la cola, los pasos y el trabajador |
| `lib/delivery/manual-license.ts`, `app/api/admin/licenses/` | Las licencias a mano: pedirlas a Eric, comprobar y guardar la que sube, cancelarlas y avisar si tardan |
| `lib/delivery/health.ts`, `app/api/admin/health/` | La comprobación de producción |
| `lib/delivery/tax.ts` | El IVA de cada factura, con lo que dice Stripe Tax, y cuándo se retiene |
| `lib/delivery/limits.ts` | Límites por IP (por /64 en IPv6) y por correo, con huellas |
| `lib/delivery/zone.ts` | Lo que hace la zona (y comprueba quién puede) |
| `lib/zone-view.ts`, `lib/zone-page.ts`, `app/[locale]/zona/`, `components/zone/` | Las páginas de la zona |
| `lib/delivery/demo.ts` | La zona de muestra del modo falso |
| `lib/delivery/reconcile.ts`, `versions.ts` | Conciliación, versiones y lista de anuladas |
| `lib/delivery/adapters/` | Un adaptador por proveedor, con su versión falsa (`fakes.ts`, `memory-repository.ts`) |
| `proxy.ts` | Idiomas y la renovación de la sesión de la zona |
| `scripts/` | `e2e-entrega.mts`, `comprobar-produccion.mts`, `subir-licencia.mts`, `comprobar-compra.mts`, `stripe-setup.mts`, `publicar-version.mts`, `clave-web-publica.mts` |
