import { useMemo } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useRequisitosMultiplesClientes } from '@/modules/clientes/hooks/useRequisitosMultiplesClientes';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

import type { CargaMasivaFormValues } from './cargaMasiva.types';

export function StepThree() {
  const { control } = useFormContext<CargaMasivaFormValues>();
  const tipoDocumentoId = useWatch({ control, name: 'tipoDocumentoId' });
  const rawClientes = useWatch({ control, name: 'clientes' });
  const clientesForm = useMemo(() => rawClientes ?? {}, [rawClientes]);

  const { data: tipos } = useTiposDocumento({ incluirInactivos: false });
  const { data: clientes } = useClientes({ estado: 'ACTIVO' });

  const tipoSeleccionado = useMemo(() => {
    return tipos?.find((t) => t.id === tipoDocumentoId);
  }, [tipos, tipoDocumentoId]);

  const clienteIds = useMemo(() => {
    return clientes?.map((c) => c.id) ?? [];
  }, [clientes]);

  const { requisitosPorCliente } = useRequisitosMultiplesClientes(clienteIds, {
    enabled: clienteIds.length > 0,
  });

  const { seAgregan, seOmiten } = useMemo(() => {
    if (!clientes) return { seAgregan: [], seOmiten: [] };

    const agregados: Array<{
      cliente: (typeof clientes)[0];
      cantidad: number;
      dias?: string | undefined;
    }> = [];
    const omitidos: Array<{ cliente: (typeof clientes)[0]; cantidadExistente: number }> = [];

    for (const c of clientes) {
      if (!clientesForm[c.id]?.seleccionado) continue;

      const reqs = requisitosPorCliente.get(c.id) ?? [];
      const reqExistente = reqs.find((r) => r.tipoDocumento.id === tipoDocumentoId);

      if (reqExistente) {
        omitidos.push({ cliente: c, cantidadExistente: reqExistente.cantidad });
      } else {
        const datos = clientesForm[c.id];
        agregados.push({
          cliente: c,
          cantidad: Number(datos?.cantidad ?? 1),
          dias: datos?.diasAproximados?.trim() || undefined,
        });
      }
    }

    return { seAgregan: agregados, seOmiten: omitidos };
  }, [clientes, clientesForm, requisitosPorCliente, tipoDocumentoId]);

  const nombreDoc = tipoSeleccionado?.nombre ?? 'Documento';

  return (
    <div className="flex flex-col gap-5 py-2">
      {/* Sección Se agrega... */}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-bold text-foreground">
          {seAgregan.length === 1
            ? `Se agrega ${nombreDoc} a 1 cliente`
            : `Se agrega ${nombreDoc} a ${seAgregan.length} clientes`}
        </h4>

        {seAgregan.length === 0 ? (
          <p className="text-xs text-content-secondary italic">
            Ningún cliente nuevo recibirá este requisito (todos los seleccionados ya lo tienen).
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {seAgregan.map(({ cliente, cantidad }) => (
              <div
                key={cliente.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
              >
                <span className="font-semibold text-foreground">{cliente.denominacion}</span>
                <span className="text-xs text-content-secondary">
                  <strong className="text-foreground">{cantidad}</strong> por mes
                </span>
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-content-secondary mt-1">
          Cada requisito usa el canal principal de cada cliente. Se puede cambiar después desde sus
          requisitos.
        </p>

        {/* Avisos de clientes con matriz pendiente que quedarán configurados */}
        {seAgregan
          .filter(({ cliente }) => !cliente.matrizConfigurada)
          .map(({ cliente }) => (
            <div
              key={`pendiente-${cliente.id}`}
              className="rounded-lg bg-panel-alt border border-border/80 px-4 py-2.5 text-xs text-content-secondary"
            >
              <strong>{cliente.denominacion}</strong> todavía no tiene requisitos cargados: este va
              a ser el primero.
            </div>
          ))}
      </div>

      {/* Sección Se omiten... */}
      {seOmiten.length > 0 && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <h4 className="text-sm font-bold text-foreground">
            {seOmiten.length === 1 ? 'Se omite 1 cliente' : `Se omiten ${seOmiten.length} clientes`}
          </h4>

          <div className="flex flex-col gap-2">
            {seOmiten.map(({ cliente, cantidadExistente }) => (
              <div
                key={cliente.id}
                className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5 text-sm"
              >
                <span className="font-semibold text-foreground">{cliente.denominacion}</span>
                <span className="text-xs text-content-secondary">
                  ya tiene ×{cantidadExistente}
                </span>
              </div>
            ))}
          </div>

          <p className="text-xs text-content-secondary mt-1">
            Se omiten sin cambiar la cantidad que ya tienen.
          </p>
        </div>
      )}
    </div>
  );
}
