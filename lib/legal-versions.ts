// Fechas de las versiones publicadas de los textos legales (las politicas prometen publicar cada
// version con su fecha). Se cambia aqui cada vez que se cambia el texto. La de las condiciones es
// tambien la version que acepta cada compra: va en la compra y en la copia del correo de
// bienvenida (lib/delivery/terms.ts).
//
// Sin imports: lo usan la pagina legal y la entrega (que corre en las pruebas sin compilar).

export type LegalDocumentId = 'aviso-legal' | 'politica-privacidad' | 'politica-cookies' | 'condiciones' | 'privacidad-producto'

// Las de 2026-10-29 copian las versiones del cerebro: condiciones 0.9 con el contrato de encargado
// del soporte 0.3 en el anexo y politica de privacidad 0.7 (la del producto y, en lo que toca, la de
// la web), sin sus notas internas, con la venta a empresas de cualquier pais y el IVA de cada caso
// (socios, 27-10-2026), la identificacion fiscal del Cliente en vez del NIF y las condiciones y la
// privacidad del producto tambien en ingles. Los cinco cambian respecto a lo publicado (2026-10-21;
// el aviso legal, 2026-10-09) y se publican el 29-10-2026: las fechas de dias anteriores no llegaron
// a publicarse ni las acepto nadie. Si se publican otro dia, la fecha de ese dia. Las condiciones,
// 2026-10-30: los nombres de las modalidades (Solista, Banda, Duo y Orquesta; Sergio, 29-10-2026). La copia guardada
// de cada version e idioma no se rehace: si el texto cambia con una copia ya guardada, el pago falla
// hasta cambiar la fecha (lib/delivery/terms.ts); las de versiones anteriores se quedan para sus
// compras. lib/legal.test.mts guarda la huella de cada texto con su fecha: si cambia el texto, falla.
export const LEGAL_VERSIONS: Record<LegalDocumentId, string> = {
  'aviso-legal': '2026-10-29',
  'politica-privacidad': '2026-10-29',
  'politica-cookies': '2026-10-29',
  condiciones: '2026-10-30',
  'privacidad-producto': '2026-10-29',
}

/** Una nota interna de borrador: una cita de una linea que empieza por Pendiente o Pending. No se publica. */
export const PENDING_NOTE = /^> *(Pendiente|Pending):.*(\r?\n)?/gm
