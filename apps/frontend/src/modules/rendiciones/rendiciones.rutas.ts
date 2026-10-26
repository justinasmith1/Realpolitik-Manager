/** Detalle de una rendición: `/clientes/:id/rendiciones/:rendicionId`. */
export const rutaDeRendicion = (clienteId: string, rendicionId: string) =>
  `/clientes/${encodeURIComponent(clienteId)}/rendiciones/${encodeURIComponent(rendicionId)}`;

/** Matriz del cliente, donde está el listado de sus rendiciones. */
export const rutaDeMatriz = (clienteId: string) =>
  `/clientes/${encodeURIComponent(clienteId)}/matriz`;

/** Estado de navegación del detalle: el aviso de la acción que llevó hasta ahí (p. ej. el alta). */
export interface EstadoDeDetalle {
  aviso?: string;
}
