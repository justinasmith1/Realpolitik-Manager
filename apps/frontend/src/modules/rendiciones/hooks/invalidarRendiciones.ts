import type { QueryClient } from '@tanstack/react-query';

import { rendicionesKeys } from '@/modules/rendiciones/api/rendiciones.keys';

/**
 * Lo que hay que volver a pedir cuando cambia la vigencia, el estado o el avance de una rendición
 * (anularla, abrirla, agregarle un requisito, aplicar o reemplazar un documento en sus ítems y, en
 * las HU3.6 a HU3.9, cada cambio de estado): las rendiciones del cliente (listado,
 * detalles, última OC) y las de la pantalla Rendiciones (el listado del mes y las atrasadas, que
 * mueven la tarjeta Atrasadas). Las próximas mutaciones solo tienen que llamar a esta función.
 */
export function invalidarRendiciones(queryClient: QueryClient, clienteId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: rendicionesKeys.deCliente(clienteId) }),
    queryClient.invalidateQueries({ queryKey: rendicionesKeys.pantalla }),
  ]);
}
