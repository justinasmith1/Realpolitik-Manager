import { TEXTO_EMISOR_PENDIENTE } from '@/modules/clientes/clientes.etiquetas';

/**
 * Marca un cliente sin emisor asignado: un punto y la palabra "Pendiente", con los tokens de
 * diseño (la información la lleva el texto, el color solo la refuerza). Es el mismo patrón que
 * el estado de los requisitos en el listado de matrices. No bloquea nada: es un aviso.
 */
export function EmisorPendiente() {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
      <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
      {TEXTO_EMISOR_PENDIENTE}
    </span>
  );
}
