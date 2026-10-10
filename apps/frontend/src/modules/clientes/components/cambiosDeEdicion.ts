// Arma el cuerpo del PATCH de la edición (HU1.7) con SOLO lo que la persona modificó.
//
// Mandar el formulario entero pisaría cambios ajenos: si otra persona cambió la razón social
// mientras este formulario estaba abierto, reenviar la razón social vieja la deshace aunque acá
// solo se haya tocado el email. Por eso viajan únicamente los campos modificados respecto de los
// valores con los que se abrió el formulario (los `dirtyFields` de React Hook Form, que se
// recalculan contra los valores iniciales: un campo que vuelve a su valor original deja de
// estar modificado y no viaja).
//
// Algunos campos no se pueden mandar sueltos, porque la API los valida en grupo:
// - Sector: un sector Público siempre va con su subtipo; uno Privado va solo (el backend borra
//   el subtipo). Si cambia solo el subtipo, va solo el subtipo.
// - Canal: el canal nuevo va con su dato (la URL del portal o el número de WhatsApp); Correo va
//   solo (el backend borra los datos de los otros canales). Sin cambio de canal, va el dato
//   del canal actual si se modificó.
// - Periodicidad: es un único objeto en la API. Si se modificó cualquiera de sus partes viaja
//   completa; "Sin configurar" sobre una periodicidad existente es `null` (borrarla).
//
// Los valores salen de `datos`, ya normalizados por shared (CUIT canónico, email en minúsculas…).

import type { CambiosCliente, NuevoCliente } from '@/modules/clientes/api/clientes.api';
import type {
  CampoClienteForm,
  ClienteFormValues,
} from '@/modules/clientes/components/clienteForm.validation';

/** Campos del formulario que la persona modificó respecto de los valores iniciales. */
export type CamposModificados = ReadonlySet<CampoClienteForm>;

/** Los campos marcados en `dirtyFields` de React Hook Form (`true` = modificado). */
export function camposModificados(
  dirtyFields: Partial<Readonly<Record<CampoClienteForm, boolean | undefined>>>,
): CamposModificados {
  return new Set(
    (Object.keys(dirtyFields) as CampoClienteForm[]).filter((campo) => dirtyFields[campo] === true),
  );
}

const CAMPOS_DE_PERIODICIDAD: readonly CampoClienteForm[] = [
  'periodicidadTipo',
  'periodicidadDiaLimite',
  'periodicidadMesInicioCiclo',
];

/**
 * El PATCH de la edición: solo lo modificado, con los grupos que la API exige juntos. Si no se
 * modificó nada, devuelve `{}` (quien lo usa no debe enviar el pedido).
 *
 * @param datos el formulario completo, ya validado y normalizado por shared.
 * @param modificados los campos que cambiaron respecto de `inicial`.
 * @param inicial los valores con los que se abrió el formulario (los del cliente guardado).
 */
export function construirCambiosCliente(
  datos: NuevoCliente,
  modificados: CamposModificados,
  inicial: ClienteFormValues,
): CambiosCliente {
  const cambios: CambiosCliente = {};

  // Los que viajan solos, tal cual.
  if (modificados.has('razonSocial')) cambios.razonSocial = datos.razonSocial;
  if (modificados.has('denominacion')) cambios.denominacion = datos.denominacion;
  if (modificados.has('cuit')) cambios.cuit = datos.cuit;
  if (modificados.has('ivaCondicion')) cambios.ivaCondicion = datos.ivaCondicion;
  if (modificados.has('emailContacto')) cambios.emailContacto = datos.emailContacto;

  if (modificados.has('sector')) {
    cambios.sector = datos.sector;
    if (datos.sector === 'PUBLICO') {
      cambios.subtipo = datos.subtipo;
    }
  } else if (modificados.has('subtipo') && datos.sector === 'PUBLICO') {
    cambios.subtipo = datos.subtipo;
  }

  if (modificados.has('canalEntrega')) {
    cambios.canalEntrega = datos.canalEntrega;
    if (datos.canalEntrega === 'PORTAL_WEB') cambios.portalUrl = datos.portalUrl;
    if (datos.canalEntrega === 'WHATSAPP') cambios.whatsappNumero = datos.whatsappNumero;
  } else if (datos.canalEntrega === 'PORTAL_WEB' && modificados.has('portalUrl')) {
    cambios.portalUrl = datos.portalUrl;
  } else if (datos.canalEntrega === 'WHATSAPP' && modificados.has('whatsappNumero')) {
    cambios.whatsappNumero = datos.whatsappNumero;
  }

  if (CAMPOS_DE_PERIODICIDAD.some((campo) => modificados.has(campo))) {
    if (datos.periodicidad !== undefined) {
      cambios.periodicidad = datos.periodicidad;
    } else if (inicial.periodicidadTipo !== '') {
      // Quedó "Sin configurar" y el cliente tenía una: se borra. Si no tenía, no hay cambio.
      cambios.periodicidad = null;
    }
  }

  return cambios;
}

/** ¿Hay algo para enviar? */
export const hayCambios = (cambios: CambiosCliente) => Object.keys(cambios).length > 0;
