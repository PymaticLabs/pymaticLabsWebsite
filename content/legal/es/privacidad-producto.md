Esta política informa (artículos 13 y 14 del Reglamento General de Protección de Datos, RGPD) de los datos personales que Pymatic Labs trata al vender el Cerebro Digital, entregarlo, dar acceso a la zona de socio y dar soporte, y de los que no trata. Lo que pasa al visitar la web se explica en la [política de privacidad de la web](/politica-privacidad).

## 1. En corto

«Tu información es tuya. Tu cerebro vive en tus equipos y los procedimientos se ejecutan en ellos. Cuando el asistente necesita algo, consulta solo lo que le hace falta, te responde y ya: no se usa para entrenar ningún modelo y no se queda en la memoria de Claude. Lo único que queda es tu conversación, en tu cuenta de Claude, y la borras cuando quieras. Para que sea así, en el montaje te enseñamos a apagar el entrenamiento y la memoria de Claude; con Claude Team, el entrenamiento está apagado por contrato y la memoria viene apagada de serie.»

Anthropic fija dos excepciones, en la sección 3: las valoraciones de respuestas y lo que marquen sus filtros de seguridad.

Lo que sí trata Pymatic Labs es lo de la compra: quién compra, la factura, la licencia, quién entra en la zona de socio y las sesiones de montaje. Está en la sección 4.

## 2. Responsable

PYMATICLABS, SOCIEDAD LIMITADA («Pymatic Labs»), NIF B88781745, Calle Alfred Giner Sorolla 3, 2º 5ª, 12006 Castellón de la Plana. Correo de privacidad: [info@pymaticlabs.com](mailto:info@pymaticlabs.com). No está obligada a designar delegado de protección de datos (artículo 37 del RGPD: no observa a personas a gran escala ni trata categorías especiales como actividad principal) y no lo ha designado.

## 3. Lo que Pymatic Labs no trata

- **El contenido del cerebro.** Documentos, procedimientos, datos e historial de cambios viven en los equipos del Cliente (su ordenador o su NAS). El Cerebro Digital no envía a Pymatic Labs ese contenido ni datos de uso.
- **Las contraseñas.** Están en la caja fuerte de contraseñas del cerebro, en los equipos del Cliente. Pymatic Labs nunca las pide. La zona de socio tampoco tiene contraseñas: se entra con un código de un solo uso que llega por correo.
- **Lo que el asistente lee.** Viaja a su proveedor (Anthropic, con Claude) según el contrato del Cliente con él, y queda en el historial de Claude hasta que se borra; después se aplican los plazos de Anthropic. Con Claude Team o Enterprise, Anthropic trata esos datos como encargado del Cliente, con contrato de encargado, y no entrena con ellos; la memoria de Claude viene apagada para cada miembro. Con Pro o Max los trata como responsable, con sus condiciones de consumidor: la memoria viene encendida y el entrenamiento se decide en sus ajustes de privacidad. Con el entrenamiento apagado, guarda las conversaciones borradas 30 días; con el encendido, hasta cinco años. En todos los planes, una valoración enviada sobre una respuesta deja a Anthropic guardar esa conversación hasta cinco años y usarla para entrenar, y lo que marquen sus filtros de seguridad lo puede guardar hasta dos años para sus sistemas de seguridad. Borrar una conversación no borra lo que ya esté en la memoria: se borra aparte.
- **Cowork en la nube.** En las sesiones en la nube, Claude se lleva una copia de cada fichero que lee, los ficheros que se le dan directamente se copian a la sesión y la memoria de Claude cruza entre Cowork y el chat. Las herramientas del cerebro solo responden con Claude Desktop abierto en un equipo del Cliente.

## 4. Datos que trata Pymatic Labs, para qué y con qué base

- **Compra y facturación.** Razón social, identificación fiscal, dirección de facturación y país, nombre y correo de quien compra, producto, importes, impuestos y fechas, y el identificador del pago en Stripe. La página de compra pide el país y la identificación fiscal antes de pagar, porque de ellos depende el IVA (cláusula 4 de las [condiciones de uso y venta](/condiciones)), y Stripe recoge el resto en su página de pago. Con ellos se crea la factura en Holded, que la emite y la envía por correo. Para cumplir el contrato, facturar y llevar la contabilidad. Base: ejecución del contrato y obligación legal (artículo 6.1.b y c del RGPD). Sin estos datos no se puede contratar. El número completo de la tarjeta y su código de seguridad los trata Stripe; Pymatic Labs no los recibe. Ve solo la marca, los últimos cuatro dígitos, la caducidad, el país y una huella de la tarjeta.
- **Comprobación del NIF-IVA.** Si el Cliente es de otro país de la Unión Europea o de Mónaco y da su NIF-IVA (o, como identificación fiscal, un número con su forma), antes de pagar se consulta en VIES, el sistema de la Comisión Europea que lo comprueba con la administración tributaria que lo emitió; la consulta lleva el NIF-IVA del Cliente y el de Pymatic Labs, que la hace. Si el NIF-IVA es válido, se guardan con el pedido el número de la consulta y su fecha y, si VIES los da, el nombre y la dirección que tiene registrados. De la consulta de un número dado como identificación fiscal no se guarda nada: si es válido, se pide escribirlo como NIF-IVA. Para facturar sin IVA español solo con el NIF-IVA comprobado (artículo 18 del Reglamento de Ejecución (UE) 282/2011). Base: obligación legal (artículo 6.1.c del RGPD).
- **Aceptación de las condiciones.** La versión de las condiciones que se aceptó, su huella (un resumen que prueba qué texto era), quién y cuándo. Se guarda una copia y llega en el correo de bienvenida. Para probar el contrato. Base: ejecución del contrato e interés legítimo en poder probarlo (artículo 6.1.b y f).
- **Licencia.** El fichero de licencia lleva la razón social y la identificación fiscal del Cliente, la modalidad, si es con equipo, la fecha de compra y el fin del mantenimiento y soporte, y se guarda junto al identificador de su pago. Lo firma Pymatic Labs con su clave de licencias: hoy, en un equipo propio, con los datos que le llegan por correo; más adelante, en un almacén de claves en la nube (Google Cloud KMS), que recibe esos datos solo para firmarlos y no los guarda. Cada día se cruzan las licencias con los pagos, para detectar una licencia sin pago. Base: ejecución del contrato e interés legítimo en evitar licencias falsas (artículo 6.1.b y f).
- **Zona de socio.** El correo de cada persona con acceso (quien compró y, con equipo, las personas que da de alta), quién dio de alta a quién y cuándo, las altas y bajas, los códigos de un solo uso (caducan a los minutos), la sesión y los registros de acceso (fecha, hora, dirección IP y navegador). Para entrar sin contraseñas, bajar la licencia, las descargas y las facturas, y proteger las cuentas. Base: ejecución del contrato con quien compró e interés legítimo, del Cliente y de Pymatic Labs, en dar acceso a las personas que el Cliente autoriza (artículo 6.1.b y f; artículo 19 de la Ley Orgánica 3/2018, LOPDGDD). Las cuentas solo las crea una compra o un alta del equipo: nadie se registra por su cuenta.
- **Sesiones de montaje** (Acompañado). Nombre, correo, empresa, el día, la hora y la persona de Pymatic Labs que se elige, y lo que se hable o se vea en la sesión, sin grabar. La reserva se hace en Cal.com al comprar o desde la zona. Para preparar y dar las sesiones. Base: contrato (artículo 6.1.b).
- **Correos de la entrega.** La bienvenida, los códigos para entrar, el acceso del equipo, cada licencia nueva del mensual, el aviso de un cobro del mensual que no se pudo hacer, con la fecha en que se suspende, las devoluciones y los avisos de versión nueva, que llegan a cada persona con acceso. Base: ejecución del contrato y, en los avisos de seguridad, el deber de informar de las actualizaciones de seguridad (Reglamento (UE) 2024/2847, CRA).
- **Precio de lanzamiento y límites contra el abuso.** Mientras un pago con ese precio está abierto se guarda una huella cifrada de la dirección IP (nunca la IP), para que nadie acapare las plazas. El pago lleva además en Stripe otra huella cifrada de la IP, distinta en cada pago, para reconocer a quien vuelve atrás y abre otro, y pasarle su plaza. Para frenar a quien abra pagos o aparte huecos sin fin, o pruebe códigos para entrar en la zona, se cuentan los intentos por la huella cifrada de la IP y del correo (nunca el dato). Se borran al día siguiente, salvo la que lleva el pago, que se queda con él en Stripe. Base: interés legítimo en repartir las plazas y en la seguridad de la zona (artículo 6.1.f).
- **Soporte.** Correos y notas de cada incidencia, para resolverla. Base: contrato. Lo que se ve en las sesiones con pantalla compartida o con acceso remoto se trata por cuenta del Cliente, como encargado, según el contrato de encargado del soporte, anexo a las [condiciones de uso y venta](/condiciones).
- **Contacto profesional.** Nombre, cargo y datos de contacto de las personas de la empresa cliente, que facilita el Cliente. Base: interés legítimo en mantener la relación (artículo 19 de la LOPDGDD).
- **Comunicaciones comerciales.** Al pagar se elige si se quieren recibir novedades. A clientes, novedades sobre productos parecidos a los comprados, con un enlace para darse de baja en cada envío (artículo 21.2 de la Ley 34/2002, LSSI-CE); a quien no es cliente, solo con su consentimiento. Base: interés legítimo o consentimiento.

No hay decisiones automatizadas con efectos jurídicos ni perfiles (artículo 22 del RGPD). La entrega es automática (al pagar se emiten la factura y el acceso, y la licencia llega en unas horas), pero no decide nada sobre las personas: si faltan datos, o el país o el IVA del pago no cuadran con lo declarado, la revisa una persona.

**Stripe.** Cuando el Cliente paga, Stripe Payments Europe, Limited (Irlanda) y las demás empresas de su grupo tratan los datos del pago con dos papeles. Por cuenta de Pymatic Labs, como encargado, procesan el pago, la suscripción y el portal del Cliente, según el contrato de encargado que Stripe incluye en su contrato de servicios. Por cuenta propia, como responsable, eligen y usan bancos y medios de pago, previenen y detectan el fraude y las pérdidas, cumplen la ley contra el blanqueo de capitales y los requerimientos de autoridades, gestionan su relación y su facturación y analizan y mejoran sus productos, incluidos sus modelos antifraude; para eso aplican su [política de privacidad](https://stripe.com/privacy) y pueden usar cookies y datos del dispositivo en la página de pago. Si el comprador guarda sus datos en Link, el servicio de pago rápido de Stripe, Stripe también actúa como responsable. Pymatic Labs recibe de Stripe: nombre o razón social, correo, dirección de facturación, teléfono si lo pide el formulario, producto, importe y fechas; y, del medio de pago, solo la marca, los últimos cuatro dígitos, la caducidad, el país y una huella.

> Pendiente: confirmar la base de los avisos de versión a las personas del equipo del Cliente.

> Pendiente: el documento (versión 0.7) no cuenta la venta fuera de España ni la consulta a VIES (socios, 27-10-2026; la base de la consulta, obligación legal): ponerlo igual en el documento.

## 5. Quién recibe los datos

- **Stripe**, que cobra y da el portal de cliente del mensual. Stripe Payments Europe, Limited (Irlanda) y su grupo tratan los datos del pago con dos papeles: por cuenta de Pymatic Labs, como encargado, y por cuenta propia, como responsable (ver la sección 4 y la política de privacidad de Stripe).
- **Proveedores que los tratan por cuenta de Pymatic Labs**, con contrato de encargado que se acepta con sus condiciones:
  - Supabase, en su región de la Unión Europea (Irlanda): base de datos de la entrega y de las licencias, acceso a la zona de socio con código por correo y almacén privado de descargas, facturas y condiciones aceptadas.
  - Google Cloud (Cloud KMS), en una región europea: cuando las licencias se firmen en la nube, las firma sin dejar salir la clave.
  - Brevo (Sendinblue SAS, Francia): los correos de la entrega y los códigos de un solo uso para entrar en la zona sin contraseña.
  - Holded: facturación por su API y contabilidad; envía las facturas por correo.
  - Cal.com: el calendario de las sesiones de montaje.
  - Vercel: aloja la web y la entrega.
  - Google (Google Workspace): correo, documentos y videollamada con Google Meet.
  - AnyDesk (AnyDesk Software GmbH, Alemania): el acceso remoto en el soporte.
- **La Comisión Europea**, con VIES, y la administración tributaria del país del Cliente, cuando se comprueba un NIF-IVA de la Unión Europea (sección 4).
- La Agencia Tributaria, otras administraciones y los juzgados, cuando la ley obliga.

Pymatic Labs no vende datos ni los cede a nadie más.

> Pendiente: Holded no se ha comprobado: pedir su contrato de encargado y su lista de subencargados. Comprobar en la consola de Google que el Cloud Data Processing Addendum está aceptado.

## 6. Transferencias internacionales

Algunos proveedores pueden tratar datos fuera del Espacio Económico Europeo, sobre todo en Estados Unidos. Solo con las garantías del capítulo V del RGPD: la decisión de adecuación del Marco de Privacidad de Datos UE-EE. UU. para las empresas adheridas, o cláusulas contractuales tipo de la Comisión Europea.

Las garantías de cada proveedor son estas:

- Marco de Privacidad de Datos UE-EE. UU. (decisión de adecuación de la Comisión, artículo 45 del RGPD): Stripe, Google, Vercel y Cal.com figuran como adheridos y activos en la lista oficial ([dataprivacyframework.gov](https://www.dataprivacyframework.gov), consultada el 25 de octubre de 2026).
- Cláusulas contractuales tipo de la Comisión Europea (Decisión de Ejecución (UE) 2021/914; artículo 46.2.c del RGPD), incluidas en el contrato de encargado de todos ellos. Son la garantía principal en Supabase, que guarda los datos en su región de la Unión Europea (Irlanda) pero usa una entidad de Singapur y no está en el Marco; en los demás respaldan al Marco cuando este no cubre la transferencia.

Quien lo pida a [info@pymaticlabs.com](mailto:info@pymaticlabs.com) recibe copia de las garantías de cada proveedor.

> Pendiente: la lista de subencargados de AnyDesk (filiales en Hong Kong y en Florida) y la región de las funciones de Vercel.

## 7. Cuánto tiempo se guardan

- Compra, facturación (con la consulta a VIES), licencias, condiciones aceptadas y correspondencia del negocio: seis años (artículo 30 del Código de Comercio).
- Acceso a la zona de socio: mientras la empresa tenga una licencia vigente. Una persona dada de baja del equipo deja de entrar al momento; su alta y su baja se guardan como el resto de la compra.
- Códigos para entrar: minutos, hasta que se usan o caducan. Sesión de la zona: hasta que se cierra o tras 7 días sin usarla. Registros de acceso: el plazo corto del proveedor.
- Huella de la IP del precio de lanzamiento y huellas de IP y de correo de los límites: hasta el día siguiente; la que lleva el pago en Stripe, mientras se guarde ese pago.
- Soporte: mientras dure la relación, y después como la correspondencia.
- Comunicaciones comerciales: hasta la baja o la retirada del consentimiento.

Cuando ya no hacen falta para su fin, los datos se bloquean mientras puedan exigirse responsabilidades (artículo 32 de la LOPDGDD) y después se borran.

> Pendiente: el plazo de los registros de acceso de Supabase según el plan contratado. Si un día hay sesiones de montaje sin compra, fijar su plazo (propuesta del documento: 12 meses).

## 8. Derechos

Cualquier persona puede pedir acceso, rectificación, supresión, oposición, limitación del tratamiento y portabilidad (artículos 15 a 22 del RGPD), y retirar el consentimiento que dio, escribiendo a [info@pymaticlabs.com](mailto:info@pymaticlabs.com). Pymatic Labs responde en un mes (artículo 12.3). Si los datos son de alguien que el Cliente enseña en el soporte, el responsable es el Cliente y Pymatic Labs le pasa la petición. Quien no quede satisfecho puede reclamar ante la Agencia Española de Protección de Datos (AEPD), en [www.aepd.es](https://www.aepd.es), o ante la autoridad de su país de la Unión Europea (artículo 77 del RGPD).

## 9. Seguridad

Pymatic Labs aplica medidas técnicas y organizativas adecuadas al riesgo (artículo 32 del RGPD): acceso solo de quien lo necesita y ninguna copia del contenido de los cerebros de sus clientes. En la zona de socio: sin contraseñas, con códigos de un solo uso; cada empresa solo ve lo suyo, comprobado por la web y otra vez por la base de datos; las descargas y las facturas salen de un almacén privado con enlaces que caducan en minutos, nunca públicos; y la clave que firma las licencias no sale del equipo de Pymatic Labs donde está (ni, cuando se firmen en la nube, del almacén de claves, que registra cada firma).

> Pendiente: cuando Eric confirme la verificación en dos pasos y el cifrado de discos en todas las cuentas y equipos, volver a poner «verificación en dos pasos en sus cuentas, equipos con el disco cifrado» tras «acceso solo de quien lo necesita» (documento, versión 0.7, sección 9).

## 10. Cambios

Cada versión de esta política se publica con su fecha. Los cambios importantes se avisan por correo a los clientes.
