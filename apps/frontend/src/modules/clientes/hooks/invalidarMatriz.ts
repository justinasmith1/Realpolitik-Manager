import type { QueryClient } from '@tanstack/react-query';

import { clienteDetalleQueryKey, clientesListaQueryKey } from '@/modules/clientes/api/clientes.api';
import {
  interpretarFalloRequisito,
  requisitosQueryKey,
} from '@/modules/clientes/api/requisitos.api';

/**
 * Después de crear, editar o dar de baja un requisito, `matrizConfigurada` puede haber cambiado.
 * Se refrescan solo la matriz de este cliente, su detalle y los listados. No se invalidan las
 * matrices de otros clientes ni el catálogo de tipos de documento.
 */
export function invalidarConsultasDeMatriz(queryClient: QueryClient, clienteId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: requisitosQueryKey(clienteId) }),
    queryClient.invalidateQueries({ queryKey: clienteDetalleQueryKey(clienteId) }),
    queryClient.invalidateQueries({ queryKey: clientesListaQueryKey }),
  ]);
}

/**
 * Un fallo que deja la pantalla desactualizada. El 404 y el cliente que dejó de estar activo
 * refrescan matriz, detalle y listados. El duplicado refresca solo la matriz: el requisito ya
 * estaba y el alta no escribió nada. El resto no invalida.
 */
export function invalidarTrasFalloDeRequisito(
  queryClient: QueryClient,
  clienteId: string,
  error: unknown,
) {
  const tipo = interpretarFalloRequisito(error).tipo;
  if (tipo === 'no-existe' || tipo === 'cliente-no-activo') {
    return invalidarConsultasDeMatriz(queryClient, clienteId);
  }
  if (tipo === 'requisito-duplicado') {
    return queryClient.invalidateQueries({ queryKey: requisitosQueryKey(clienteId) });
  }
  return undefined;
}
