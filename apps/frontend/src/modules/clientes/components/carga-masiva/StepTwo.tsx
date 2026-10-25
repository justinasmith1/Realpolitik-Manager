import type { ClienteSectorType, ClienteSubtipoPublicoType } from '@realpolitik/shared';
import { SearchIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useFormContext, useWatch } from 'react-hook-form';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';
import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useRequisitosMultiplesClientes } from '@/modules/clientes/hooks/useRequisitosMultiplesClientes';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

import { validarFilaCliente, type CargaMasivaFormValues } from './cargaMasiva.types';

const opcionesSector: SelectOption[] = [
  { value: '', label: 'Todos los sectores' },
  { value: 'PUBLICO', label: 'Público' },
  { value: 'PRIVADO', label: 'Privado' },
];

const opcionesSubtipo: SelectOption[] = [
  { value: '', label: 'Todos los subtipos' },
  { value: 'MUNICIPAL', label: etiquetasSubtipo.MUNICIPAL ?? 'Municipio' },
  { value: 'PROVINCIAL_ORGANISMO', label: 'Provincial / Organismo' },
  { value: 'SINDICAL_OBRA_SOCIAL', label: 'Sindical / Obra social' },
];

export function StepTwo() {
  const searchId = useId();
  const sectorId = useId();
  const subtipoId = useId();

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroSector, setFiltroSector] = useState<ClienteSectorType | ''>('');
  const [filtroSubtipo, setFiltroSubtipo] = useState<ClienteSubtipoPublicoType | ''>('');

  const { data: clientes, isLoading, isError, refetch } = useClientes({ estado: 'ACTIVO' });
  const { data: tipos } = useTiposDocumento({ incluirInactivos: false });

  const { setValue, control } = useFormContext<CargaMasivaFormValues>();
  const tipoDocumentoId = useWatch({ control, name: 'tipoDocumentoId' });
  const rawClientes = useWatch({ control, name: 'clientes' });
  const clientesForm = useMemo(() => rawClientes ?? {}, [rawClientes]);

  const tipoSeleccionado = useMemo(() => {
    return tipos?.find((t) => t.id === tipoDocumentoId);
  }, [tipos, tipoDocumentoId]);

  const clienteIds = useMemo(() => {
    return clientes?.map((c) => c.id) ?? [];
  }, [clientes]);

  const { requisitosPorCliente } = useRequisitosMultiplesClientes(clienteIds, {
    enabled: clienteIds.length > 0,
  });

  // Filtrado en memoria por texto (razón social, denominación, CUIT), sector y subtipo
  const clientesFiltrados = useMemo(() => {
    if (!clientes) return [];
    return clientes.filter((c) => {
      if (filtroSector && c.sector !== filtroSector) return false;
      if (filtroSubtipo && c.subtipo !== filtroSubtipo) return false;
      if (filtroTexto.trim() !== '') {
        const query = filtroTexto.toLowerCase().trim();
        const coincideRazon = c.razonSocial.toLowerCase().includes(query);
        const coincideDenom = c.denominacion.toLowerCase().includes(query);
        const coincideCuit = c.cuit.includes(query);
        if (!coincideRazon && !coincideDenom && !coincideCuit) return false;
      }
      return true;
    });
  }, [clientes, filtroSector, filtroSubtipo, filtroTexto]);

  const seleccionadosCount = useMemo(() => {
    return Object.values(clientesForm).filter((c) => c?.seleccionado).length;
  }, [clientesForm]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-4" aria-busy="true">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-card border bg-card p-4">
        <p className="text-sm text-destructive">No pudimos cargar la lista de clientes activos.</p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="text-xs font-semibold underline text-primary"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const toggleCliente = (clienteId: string, actualSeleccionado: boolean) => {
    const nuevo = !actualSeleccionado;
    if (nuevo) {
      setValue(
        `clientes.${clienteId}`,
        {
          seleccionado: true,
          cantidad: clientesForm[clienteId]?.cantidad ?? 1,
          diasAproximados: clientesForm[clienteId]?.diasAproximados ?? '',
        },
        { shouldDirty: true, shouldValidate: true },
      );
    } else {
      setValue(`clientes.${clienteId}.seleccionado`, false, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  };

  const seleccionarTodosDelFiltro = () => {
    const todosSeleccionados =
      clientesFiltrados.length > 0 &&
      clientesFiltrados.every((c) => clientesForm[c.id]?.seleccionado);
    for (const c of clientesFiltrados) {
      if (todosSeleccionados) {
        setValue(`clientes.${c.id}.seleccionado`, false, {
          shouldDirty: true,
          shouldValidate: true,
        });
      } else {
        setValue(
          `clientes.${c.id}`,
          {
            seleccionado: true,
            cantidad: clientesForm[c.id]?.cantidad ?? 1,
            diasAproximados: clientesForm[c.id]?.diasAproximados ?? '',
          },
          { shouldDirty: true, shouldValidate: true },
        );
      }
    }
  };

  const todosFiltradosSeleccionados =
    clientesFiltrados.length > 0 &&
    clientesFiltrados.every((c) => clientesForm[c.id]?.seleccionado);

  const nombreDoc = tipoSeleccionado?.nombre ?? 'el documento seleccionado';

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <h3 className="text-base font-semibold text-foreground whitespace-nowrap">
            Clientes y configuración
          </h3>
          <span className="text-xs font-medium text-content-secondary whitespace-nowrap">
            {seleccionadosCount} clientes seleccionados
          </span>
        </div>
        <p className="text-sm text-content-secondary">
          ¿A qué clientes agregás <strong>{nombreDoc}</strong>? Ajustá la cantidad mensual y, si
          querés, los días aproximados separados por coma.
        </p>
      </div>

      {/* Barra de búsqueda, filtro por sector y filtro por subtipo */}
      <div className="flex flex-wrap gap-2.5 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <SearchIcon
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            value={filtroTexto}
            onChange={(e) => setFiltroTexto(e.target.value)}
            placeholder="Buscar clientes…"
            className="pl-9 text-sm"
          />
        </div>
        <div className="w-[160px]">
          <Select
            id={sectorId}
            value={filtroSector}
            onValueChange={(val) => setFiltroSector(val as ClienteSectorType | '')}
            options={opcionesSector}
            placeholder="Todos los sectores"
          />
        </div>
        <div className="w-[180px]">
          <Select
            id={subtipoId}
            value={filtroSubtipo}
            onValueChange={(val) => setFiltroSubtipo(val as ClienteSubtipoPublicoType | '')}
            options={opcionesSubtipo}
            placeholder="Todos los subtipos"
          />
        </div>
      </div>

      {/* Checkbox para seleccionar todos los clientes del filtro */}
      {clientesFiltrados.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm font-medium text-foreground">
            <Checkbox
              checked={todosFiltradosSeleccionados}
              onCheckedChange={seleccionarTodosDelFiltro}
            />
            <span>Seleccionar los {clientesFiltrados.length} del filtro</span>
          </label>
        </div>
      )}

      {/* Listado de clientes */}
      <div className="max-h-[380px] overflow-y-auto divide-y rounded-md border border-border bg-card">
        {clientesFiltrados.length === 0 ? (
          <div className="p-6 text-center text-sm text-content-secondary">
            No se encontraron clientes activos con los filtros aplicados.
          </div>
        ) : (
          clientesFiltrados.map((cliente) => {
            const rowData = clientesForm[cliente.id];
            const seleccionado = rowData?.seleccionado ?? false;
            const cantidad = rowData?.cantidad ?? 1;
            const diasAproximados = rowData?.diasAproximados ?? '';
            const cantidadNum = Number(cantidad);

            const validacion = validarFilaCliente(rowData);

            // Requisitos actuales del cliente para verificar si ya tiene el documento
            const requisitosCliente = requisitosPorCliente.get(cliente.id) ?? [];
            const reqExistente = requisitosCliente.find(
              (r) => r.tipoDocumento.id === tipoDocumentoId,
            );

            // Texto de estado de matriz debajo de la denominación
            let textoEstadoMatriz: React.ReactNode;
            if (reqExistente) {
              textoEstadoMatriz = (
                <span className="text-xs text-muted-foreground font-normal">
                  Ya tiene {tipoSeleccionado?.nombre ?? 'este requisito'} ×{reqExistente.cantidad} ·
                  se va a omitir
                </span>
              );
            } else if (!cliente.matrizConfigurada) {
              const etiquetaSub = cliente.subtipo
                ? (etiquetasSubtipo[cliente.subtipo] ?? 'Público')
                : 'Privado';
              textoEstadoMatriz = (
                <span className="text-xs text-warning font-medium">
                  {etiquetaSub} · matriz pendiente
                </span>
              );
            } else {
              textoEstadoMatriz = (
                <span className="text-xs text-content-secondary font-normal">
                  Sin {tipoSeleccionado?.nombre ?? 'este requisito'} · se agregará
                </span>
              );
            }

            return (
              <div
                key={cliente.id}
                className={`flex flex-col gap-2 p-3.5 transition-colors ${
                  seleccionado ? 'bg-accent/30' : 'hover:bg-muted/40'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <label className="flex items-start gap-3 cursor-pointer select-none min-w-0">
                      <Checkbox
                        id={`chk-${cliente.id}`}
                        checked={seleccionado}
                        onCheckedChange={() => toggleCliente(cliente.id, seleccionado)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex flex-col">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {cliente.denominacion}
                        </span>
                        {textoEstadoMatriz}
                      </div>
                    </label>
                  </div>

                  {/* Controles cuando está seleccionado */}
                  {seleccionado && (
                    <div className="flex flex-wrap items-center gap-2 ml-7 sm:ml-0">
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor={`cant-${cliente.id}`}
                          className="text-xs text-content-secondary font-medium whitespace-nowrap"
                        >
                          Cantidad:
                        </label>
                        <Input
                          id={`cant-${cliente.id}`}
                          type="number"
                          min={1}
                          max={100}
                          value={cantidad}
                          onChange={(e) => {
                            setValue(`clientes.${cliente.id}.cantidad`, e.target.value, {
                              shouldDirty: true,
                              shouldValidate: true,
                            });
                          }}
                          className={`w-16 h-8 text-center text-sm ${
                            validacion.errorCantidad ? 'border-destructive' : ''
                          }`}
                          aria-label={`Cantidad para ${cliente.denominacion}`}
                        />
                      </div>

                      {/* Input de días si cantidad > 1 */}
                      {cantidadNum > 1 && (
                        <div className="flex items-center gap-1.5">
                          <label
                            htmlFor={`dias-${cliente.id}`}
                            className="text-xs text-content-secondary font-medium whitespace-nowrap"
                          >
                            Días aprox:
                          </label>
                          <Input
                            id={`dias-${cliente.id}`}
                            type="text"
                            placeholder="ej. 1, 8, 15"
                            value={diasAproximados}
                            onChange={(e) => {
                              setValue(`clientes.${cliente.id}.diasAproximados`, e.target.value, {
                                shouldDirty: true,
                                shouldValidate: true,
                              });
                            }}
                            className={`w-32 h-8 text-sm ${
                              validacion.errorDias ? 'border-destructive' : ''
                            }`}
                            aria-label={`Días aproximados para ${cliente.denominacion}`}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Mensajes de error inline para esta fila */}
                {seleccionado && !validacion.valido && (
                  <div className="ml-7 flex flex-col gap-0.5">
                    {validacion.errorCantidad && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {validacion.errorCantidad}
                      </p>
                    )}
                    {validacion.errorDias && (
                      <p role="alert" className="text-xs font-medium text-destructive">
                        {validacion.errorDias}
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
