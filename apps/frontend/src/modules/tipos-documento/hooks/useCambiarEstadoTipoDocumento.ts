import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';

import {
  cambiarEstadoTipoDocumento,
  interpretarFalloCambioEstadoTipoDocumento,
  tiposDocumentoQueryKey,
} from '@/modules/tipos-documento/api/tipos-documento.api';

interface CambioDeEstado {
  id: string;
  activo: boolean;
}

const cambioDeEstadoKey = [...tiposDocumentoQueryKey, 'cambiar-estado'] as const;

/**
 * Mutation de desactivar o reactivar un tipo de documento. Igual que en clientes: si sale bien,
 * invalida las queries del catálogo; si falla, solo cuando el tipo ya no existe (`404` del
 * contrato). Ante otros errores (sin conexión, 500…) no cambió nada en la base. Sin reintentos:
 * un PATCH no se repite solo.
 */
export function useCambiarEstadoTipoDocumento() {
  const queryClient = useQueryClient();
  const refrescar = () => queryClient.invalidateQueries({ queryKey: tiposDocumentoQueryKey });

  return useMutation({
    mutationKey: cambioDeEstadoKey,
    mutationFn: ({ id, activo }: CambioDeEstado) => cambiarEstadoTipoDocumento(id, activo),
    retry: false,
    onSuccess: refrescar,
    onError: (error) =>
      interpretarFalloCambioEstadoTipoDocumento(error).tipo === 'no-existe'
        ? refrescar()
        : undefined,
  });
}

/**
 * Tipos con un cambio de estado en curso, de TODAS las mutations pendientes. La mutation de
 * `useCambiarEstadoTipoDocumento` solo recuerda el último pedido: si se cambia A y enseguida B,
 * `variables` pasa a ser B mientras A sigue en vuelo, y A volvería a quedar habilitado.
 */
export function useTiposDocumentoCambiandoEstado(): readonly string[] {
  return useMutationState({
    filters: { mutationKey: cambioDeEstadoKey, status: 'pending' },
    select: (mutation) => (mutation.state.variables as CambioDeEstado | undefined)?.id ?? '',
  }).filter((id) => id !== '');
}
