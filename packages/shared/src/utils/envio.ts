import type { CanalEntrega, Cliente } from '../schemas/cliente.schema.js';
import { CanalEntrega as CanalEntregaSchema } from '../schemas/cliente.schema.js';
import type { Contacto } from '../schemas/contacto.schema.js';
import type { DocumentoDeItem } from '../schemas/documentoDeItem.schema.js';
import type { MotivoNoEnviable } from '../schemas/envio.schema.js';

// Envío de los documentos de una rendición (HU2.5). Funciones puras: no leen la base ni envían
// nada. El canal de cada ítem ya viene resuelto (`requisito.canalEntrega ?? cliente.canalEntrega`)
// desde la apertura: acá no se vuelve a resolver.

/**
 * Por qué un ítem no se puede enviar, o `null` si se puede (HU2.8): tiene que estar completado y
 * tener un documento vigente. Un `documento` que no se conoce (`undefined`) cuenta como que no
 * tiene: nunca se supone uno. La rendición tiene que estar activa: eso se comprueba aparte, para
 * toda la selección. La usan el checklist (qué se puede elegir) y el backend (lo que se acepta).
 */
export function motivoNoEnviable(item: {
  completado: boolean;
  documento?: DocumentoDeItem | null | undefined;
}): MotivoNoEnviable | null {
  if (!item.completado) return 'ITEM_PENDIENTE';
  if (item.documento === null || item.documento === undefined) return 'ITEM_SIN_DOCUMENTO_VIGENTE';
  return null;
}

/** Cómo se envía una selección de ítems. */
export type CanalDeSeleccion =
  | { tipo: 'vacia' }
  | { tipo: 'un-canal'; canal: CanalEntrega }
  | { tipo: 'mezclados'; canales: CanalEntrega[] };

/**
 * El canal de una selección de ítems: todos por el mismo canal, o mezclados. Un envío va por un
 * solo canal, así que una selección mezclada hay que separarla. Los canales mezclados salen en
 * el orden del enum (`CORREO`, `PORTAL_WEB`, `WHATSAPP`), no en el de la selección.
 */
export function canalDeSeleccion(
  items: readonly { canalEntrega: CanalEntrega }[],
): CanalDeSeleccion {
  const presentes = new Set(items.map((item) => item.canalEntrega));
  const canales = CanalEntregaSchema.options.filter((canal) => presentes.has(canal));
  const [unico] = canales;
  if (unico === undefined) return { tipo: 'vacia' };
  if (canales.length === 1) return { tipo: 'un-canal', canal: unico };
  return { tipo: 'mezclados', canales };
}

/** Un destinatario de un envío por correo. `nombre` y `area` solo si es un contacto. */
export interface DestinatarioDeCorreo {
  email: string;
  nombre: string | null;
  area: string | null;
}

/**
 * Quiénes reciben una rendición por correo: el email de rendición del cliente, sus emails
 * adicionales y los contactos que reciben rendiciones (contrato, sección 3). Los contactos dados
 * de baja no llegan: la API no los devuelve.
 *
 * Sin repetidos, sin distinguir mayúsculas: si un contacto tiene el mismo email que el del
 * cliente, aparece una vez, con el nombre y el área del contacto. El orden es ese: primero el del
 * cliente, después los adicionales y al final los contactos.
 */
export function destinatariosDeCorreo(
  cliente: Pick<Cliente, 'emailContacto' | 'emailsAdicionales'>,
  contactos: readonly Pick<Contacto, 'nombre' | 'area' | 'email' | 'recibeRendiciones'>[],
): DestinatarioDeCorreo[] {
  const porEmail = new Map<string, DestinatarioDeCorreo>();
  const sumar = (email: string, nombre: string | null, area: string | null) => {
    const clave = email.trim().toLowerCase();
    if (clave === '') return;
    const existente = porEmail.get(clave);
    if (existente === undefined) {
      porEmail.set(clave, { email: email.trim(), nombre, area });
    } else if (existente.nombre === null && nombre !== null) {
      porEmail.set(clave, { ...existente, nombre, area });
    }
  };

  sumar(cliente.emailContacto, null, null);
  for (const email of cliente.emailsAdicionales) sumar(email, null, null);
  for (const contacto of contactos) {
    if (contacto.recibeRendiciones) sumar(contacto.email, contacto.nombre, contacto.area);
  }
  return [...porEmail.values()];
}
