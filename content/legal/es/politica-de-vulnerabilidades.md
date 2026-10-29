### Qué cubre

- La extensión Cerebro Digital para Claude Desktop, de Mac y de Windows.
- El esqueleto que viaja dentro, en castellano y en inglés.
- Los componentes de terceros que se entregan con ella: el Python embebido de la extensión de Windows, Gitea, los instaladores oficiales de Git, KeePassXC y Visual C++ (cuyas cuatro DLL se ponen junto al KeePassXC del cerebro, verificadas una a una, y se renuevan con cada versión), las dependencias de Python y los paquetes del catálogo de servidores MCP (Model Context Protocol).

Fuera quedan Claude y los servicios de terceros (Anthropic, Holded, Gmail...), cuyos fallos se reportan a ellos, y lo que cada cliente escribe en su cerebro. Un fallo de un componente que viaja con la extensión sí entra: Pymatic Labs lo corrige y avisa a quien lo mantiene (art. 13.6 del Reglamento (UE) 2024/2847).

### Contacto de seguridad

Escribe a [info@pymaticlabs.com](mailto:info@pymaticlabs.com?subject=Seguridad) con «Seguridad» en el asunto. Vale también cualquier otro contacto de Pymatic Labs. Esta política y los avisos de seguridad están en esta página, y el fichero [security.txt](/.well-known/security.txt) de la web (RFC 9116) apunta aquí. El inventario de componentes de cada versión va con ella (ver más abajo).

### Cómo reportar

El reporte incluye:

1. La versión afectada (la de la extensión y la del fichero `esqueleto/VERSION` del cerebro) y el sistema, Mac o Windows.
2. Qué pasa y cómo reproducirlo, paso a paso.
3. Qué consigue quien lo aprovecha (leer o cambiar datos, ejecutar código...).
4. Si alguien la está aprovechando ya: es lo más urgente.
5. Un contacto, y si se quiere aparecer citado en el aviso público.

Sin datos personales ni contraseñas reales: basta un ejemplo inventado. Y sin publicar el fallo hasta que haya corrección o venza el plazo de divulgación.

### Investigación de buena fe

Si investigas de buena fe y sigues esta política, Pymatic Labs no emprenderá acciones legales contra ti por esa investigación. De buena fe es: probar solo en tu propia instalación del Cerebro Digital; no acceder, cambiar ni borrar datos ajenos más allá de lo mínimo para demostrar el fallo; no degradar ningún servicio; avisar sin demora y no publicar antes de tiempo. Esto no autoriza a probar en equipos de clientes ni en servicios de terceros (Anthropic, Stripe, GitHub y otros), que tienen sus propias políticas, y Pymatic Labs no puede autorizarlo en su nombre.

### Objetivos de respuesta

Son objetivos, no plazos contractuales; los únicos firmes son los legales de la sección siguiente.

- Acuse de recibo: en 2 días hábiles.
- Evaluación inicial (si es vulnerabilidad, a qué versiones afecta, gravedad): en 5 días hábiles; el mismo día si hay indicios de que alguien la está aprovechando.
- Corrección, según la gravedad del Common Vulnerability Scoring System (CVSS): crítica o alta, en 14 días; media, en 30; baja, en la versión siguiente y como mucho en 90.
- Divulgación coordinada: el aviso público sale cuando la corrección está disponible y, salvo acuerdo con quien la reportó, como mucho 90 días después del reporte.

### Qué hace Pymatic Labs

1. Evalúa el reporte y lo registra con sus fechas.
2. La corrige en una versión de corrección, separada de los cambios de funcionalidad cuando se puede, y gratis.
3. Avisa a sus clientes de la corrección y de qué tienen que hacer.
4. Publica en esta página un aviso de la vulnerabilidad corregida: qué es, versiones afectadas, gravedad y cómo corregirla. Si el riesgo lo pide, cuando los clientes han podido actualizar.
5. Si la vulnerabilidad se está aprovechando activamente, o hay un incidente grave que afecta a la seguridad del producto, lo notifica a INCIBE-CERT, el equipo de respuesta a incidentes (CSIRT) coordinador en España, por la plataforma única de notificación de la Agencia de la Unión Europea para la Ciberseguridad (ENISA): alerta temprana en 24 horas, notificación en 72 horas e informe final 14 días después de que haya corrección (en un incidente grave, un mes después de la notificación). Y avisa enseguida a los clientes afectados de qué pueden hacer mientras tanto (art. 14).

### Periodo de soporte

Cada versión recibe correcciones de seguridad durante su periodo de soporte, cuya fecha de fin va en sus notas y en la página de compra. Se corrige en la última versión, que todo cliente instala gratis y sin costes añadidos, tenga o no suscripción (art. 13.10 y cláusula 11 de las [condiciones de uso y venta](/condiciones)).

El periodo de soporte de seguridad es de cinco años desde la publicación de cada versión. La fecha de fin, con mes y año, consta en las notas de la versión y en la página de compra. Una versión de corrección (solo cambia la Z de X.Y.Z) conserva la fecha de fin de la versión que corrige. Cada actualización de seguridad sigue disponible para descargar al menos diez años desde su publicación, o hasta el fin del periodo de soporte si este es posterior (art. 13.9).

### Inventario de componentes

Cada versión publica su inventario de componentes de software (SBOM, por sus siglas en inglés), en formato CycloneDX, legible por máquina. Va junto a la extensión, en las descargas de la zona de socio: `cerebro-digital-<versión>.cdx.json` y el de Windows, `cerebro-digital-<versión>-windows.cdx.json`, desde la versión 1.0.0 del 8 de octubre de 2026.

Cada noche, una comprobación automática consulta la base pública de vulnerabilidades [OSV](https://osv.dev) con las dependencias de Python fijadas de la extensión y avisa a Pymatic Labs de cualquier vulnerabilidad conocida; solo informa, no sube versiones.

> Pendiente: el documento (versión 1.7) dice que esta página enlaza el inventario de la última versión. Decidir si se publica en abierto y enlazarlo aquí.

### Lo que esta política no hace

Reportar no crea un contrato ni da derecho a recompensa: no hay programa de recompensas. Esta política no amplía las garantías de las [condiciones de uso y venta del Cerebro Digital](/condiciones). Los datos personales de un reporte se usan solo para gestionarlo, según la [política de privacidad del Cerebro Digital](/privacidad-producto).
