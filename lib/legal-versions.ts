// Fechas de las versiones publicadas de los textos legales (las politicas prometen publicar cada
// version con su fecha). Se cambia aqui cada vez que se cambia el texto. La de las condiciones es
// tambien la version que acepta cada compra: va en la compra y en la copia del correo de
// bienvenida (lib/delivery/terms.ts).
//
// Sin imports: lo usan la pagina legal y la entrega (que corre en las pruebas sin compilar).

export type LegalDocumentId = 'aviso-legal' | 'politica-privacidad' | 'politica-cookies' | 'condiciones' | 'privacidad-producto'

export const LEGAL_VERSIONS: Record<LegalDocumentId, string> = {
  'aviso-legal': '2026-10-09',
  'politica-privacidad': '2026-10-21',
  'politica-cookies': '2026-10-21',
  condiciones: '2026-10-21',
  'privacidad-producto': '2026-10-21',
}

/** Una nota interna de borrador: una cita de una linea que empieza por Pendiente o Pending. No se publica. */
export const PENDING_NOTE = /^> *(Pendiente|Pending):.*(\r?\n)?/gm
