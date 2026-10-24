import { ArrowRightIcon, PlusIcon, SearchIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';

import { ClientesNav } from '@/components/layout/ClientesNav';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { etiquetasSubtipo } from '@/modules/clientes/clientes.etiquetas';
import { CargaMasivaWizard } from '@/modules/clientes/components/carga-masiva/CargaMasivaWizard';
import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useRequisitosMultiplesClientes } from '@/modules/clientes/hooks/useRequisitosMultiplesClientes';

type FiltroEstadoMatriz = 'TODAS' | 'CONFIGURADAS' | 'PENDIENTES';
type OrdenMatriz = 'NOMBRE_ASC' | 'PENDIENTES_PRIMERO' | 'REQUISITOS_DESC';

const opcionesOrden: SelectOption[] = [
  { value: 'NOMBRE_ASC', label: 'Nombre (A–Z)' },
  { value: 'PENDIENTES_PRIMERO', label: 'Pendientes primero' },
  { value: 'REQUISITOS_DESC', label: 'Más requisitos primero' },
];

export function MatricesPage() {
  const navigate = useNavigate();
  const searchId = useId();
  const ordenId = useId();

  const [wizardAbierto, setWizardAbierto] = useState(false);
  const [avisoExito, setAvisoExito] = useState<string | null>(null);
  const [avisoWarning, setAvisoWarning] = useState<string | null>(null);

  const [filtroTexto, setFiltroTexto] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoMatriz>('TODAS');
  const [orden, setOrden] = useState<OrdenMatriz>('NOMBRE_ASC');

  // Solo clientes activos para matrices
  const { data: clientes, isLoading, isError, refetch } = useClientes({ estado: 'ACTIVO' });

  const clienteIds = useMemo(() => {
    return clientes?.map((c) => c.id) ?? [];
  }, [clientes]);

  const { requisitosPorCliente, isLoading: cargandoRequisitos } = useRequisitosMultiplesClientes(
    clienteIds,
    {
      enabled: clienteIds.length > 0,
    },
  );

  // Clientes filtrados y ordenados
  const clientesProcesados = useMemo(() => {
    if (!clientes) return [];

    let resultado = clientes.filter((c) => {
      // Filtro de estado
      if (filtroEstado === 'CONFIGURADAS' && !c.matrizConfigurada) return false;
      if (filtroEstado === 'PENDIENTES' && c.matrizConfigurada) return false;

      // Filtro de texto
      if (filtroTexto.trim() !== '') {
        const query = filtroTexto.toLowerCase().trim();
        const coincideRazon = c.razonSocial.toLowerCase().includes(query);
        const coincideDenom = c.denominacion.toLowerCase().includes(query);
        const coincideCuit = c.cuit.includes(query);
        if (!coincideRazon && !coincideDenom && !coincideCuit) return false;
      }
      return true;
    });

    // Ordenamiento
    resultado = [...resultado].sort((a, b) => {
      if (orden === 'NOMBRE_ASC') {
        return a.denominacion.localeCompare(b.denominacion);
      }
      if (orden === 'PENDIENTES_PRIMERO') {
        // Pendiente primero (matrizConfigurada: false)
        if (!a.matrizConfigurada && b.matrizConfigurada) return -1;
        if (a.matrizConfigurada && !b.matrizConfigurada) return 1;
        return a.denominacion.localeCompare(b.denominacion);
      }
      if (orden === 'REQUISITOS_DESC') {
        const cantA = requisitosPorCliente.get(a.id)?.length ?? 0;
        const cantB = requisitosPorCliente.get(b.id)?.length ?? 0;
        if (cantB !== cantA) return cantB - cantA;
        return a.denominacion.localeCompare(b.denominacion);
      }
      return 0;
    });

    return resultado;
  }, [clientes, filtroEstado, filtroTexto, orden, requisitosPorCliente]);

  const totalActivos = clientes?.length ?? 0;
  const totalPendientes = clientes?.filter((c) => !c.matrizConfigurada).length ?? 0;

  const handleExitoMasivo = (resultado: {
    creadosCount: number;
    omitidos: Array<{ clienteId: string; motivo: string }>;
  }) => {
    if (resultado.creadosCount > 0) {
      setAvisoExito(
        resultado.creadosCount === 1
          ? 'Se añadió el requisito a 1 cliente.'
          : `Se añadieron los requisitos a ${resultado.creadosCount} clientes.`,
      );
    }

    const duplicados = resultado.omitidos.filter((o) => o.motivo === 'REQUISITO_DUPLICADO');
    if (duplicados.length > 0) {
      const mapa = new Map(clientes?.map((c) => [c.id, c.denominacion]));
      const nombres = duplicados.map((d) => mapa.get(d.clienteId) ?? 'Cliente').join(', ');
      setAvisoWarning(
        `No se aplicó la regla a los siguientes clientes porque ya tenían este requisito: ${nombres}.`,
      );
    } else {
      setAvisoWarning(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      {/* Header con botón "Añadir requisitos a varios clientes" arriba a la izquierda */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight">
            Clientes
          </h1>
          <p className="text-sm text-content-secondary">
            Matrices de requisitos: qué documentación necesita cada cliente para sus rendiciones.
          </p>
        </div>

        {/* Botón negro con letras blancas y (+) en rojo */}
        <button
          type="button"
          onClick={() => {
            setAvisoExito(null);
            setAvisoWarning(null);
            setWizardAbierto(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black cursor-pointer"
        >
          <span className="text-brand-accent font-black text-base leading-none">+</span>
          <span>Añadir requisitos a varios clientes</span>
        </button>
      </div>

      <ClientesNav />

      {/* Avisos */}
      {avisoExito && (
        <Alert variant="success" onCerrar={() => setAvisoExito(null)}>
          {avisoExito}
        </Alert>
      )}
      {avisoWarning && (
        <Alert variant="warning" onCerrar={() => setAvisoWarning(null)}>
          {avisoWarning}
        </Alert>
      )}

      {/* Barra de filtros y ordenamiento */}
      <div className="flex flex-col gap-3 pt-2">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          {/* Búsqueda por cliente */}
          <div className="relative flex-1 min-w-[240px]">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              value={filtroTexto}
              onChange={(e) => setFiltroTexto(e.target.value)}
              placeholder="Filtrar clientes…"
              className="pl-9 text-sm bg-card"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Botones de filtro por Estado */}
            <div className="inline-flex rounded-lg border border-border bg-card p-1 text-xs font-medium">
              <button
                type="button"
                onClick={() => setFiltroEstado('TODAS')}
                className={`rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                  filtroEstado === 'TODAS'
                    ? 'bg-black text-white font-semibold shadow-xs'
                    : 'text-content-secondary hover:text-foreground'
                }`}
              >
                Todas
              </button>
              <button
                type="button"
                onClick={() => setFiltroEstado('CONFIGURADAS')}
                className={`rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                  filtroEstado === 'CONFIGURADAS'
                    ? 'bg-black text-white font-semibold shadow-xs'
                    : 'text-content-secondary hover:text-foreground'
                }`}
              >
                Configuradas
              </button>
              <button
                type="button"
                onClick={() => setFiltroEstado('PENDIENTES')}
                className={`rounded-md px-3 py-1.5 transition-colors cursor-pointer ${
                  filtroEstado === 'PENDIENTES'
                    ? 'bg-black text-white font-semibold shadow-xs'
                    : 'text-content-secondary hover:text-foreground'
                }`}
              >
                Pendientes
              </button>
            </div>

            {/* Desplegable de Ordenamiento */}
            <div className="w-[190px]">
              <Select
                id={ordenId}
                value={orden}
                onValueChange={(val) => setOrden(val as OrdenMatriz)}
                options={opcionesOrden}
                placeholder="Ordenar por"
              />
            </div>
          </div>
        </div>

        {/* Contador resumen */}
        <p className="text-xs text-content-secondary">
          {totalActivos} clientes activos · {totalPendientes} con matriz pendiente
        </p>
      </div>

      {/* Tabla de Matrices */}
      {isLoading ? (
        <div className="flex flex-col gap-3 py-6" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-3 rounded-card border bg-card p-6"
        >
          <p className="text-sm text-destructive">No pudimos cargar los clientes y sus matrices.</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Reintentar
          </Button>
        </div>
      ) : clientesProcesados.length === 0 ? (
        <div className="rounded-card border bg-card p-8 text-center text-sm text-content-secondary">
          No hay clientes que coincidan con los filtros aplicados.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border bg-card shadow-xs">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Listado de matrices por cliente</caption>
            <thead className="border-b bg-table-head text-xs font-semibold uppercase tracking-wider text-content-secondary">
              <tr>
                <th scope="col" className="py-3 px-4 min-w-[200px]">
                  CLIENTE
                </th>
                <th scope="col" className="py-3 px-4 min-w-[250px]">
                  REQUISITOS
                </th>
                <th scope="col" className="py-3 px-4 text-right">
                  ESTADO
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clientesProcesados.map((cliente) => {
                const reqs = requisitosPorCliente.get(cliente.id) ?? [];
                const tieneMatriz = cliente.matrizConfigurada;
                const cantReqs = reqs.length;

                // Subtexto de subtipo / sector
                const subtituloSector = cliente.subtipo
                  ? `Público · ${etiquetasSubtipo[cliente.subtipo] ?? 'Municipio'}`
                  : 'Privado';

                // Resumen de requisitos
                let requisitosResumen: React.ReactNode;
                if (!tieneMatriz || cantReqs === 0) {
                  requisitosResumen = <span className="text-muted-foreground">—</span>;
                } else {
                  const nombres = reqs.slice(0, 3).map((r) => r.tipoDocumento.nombre);
                  const extra = cantReqs > 3 ? ` +${cantReqs - 3}` : '';
                  const linea1 = `${nombres.join(' · ')}${extra}`;

                  requisitosResumen = (
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground truncate max-w-md">
                        {linea1}
                      </span>
                      <span className="text-xs text-content-secondary">
                        {cantReqs === 1 ? '1 requisito' : `${cantReqs} requisitos`}
                      </span>
                    </div>
                  );
                }

                return (
                  <tr
                    key={cliente.id}
                    onClick={() => navigate(`/clientes/${cliente.id}/matriz`)}
                    className="group cursor-pointer hover:bg-muted/40 transition-colors"
                  >
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-foreground group-hover:text-brand-accent transition-colors">
                          {cliente.denominacion}
                        </span>
                        <span className="text-xs text-content-secondary">{subtituloSector}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4">
                      {cargandoRequisitos && reqs.length === 0 && tieneMatriz ? (
                        <Skeleton className="h-4 w-40" />
                      ) : (
                        requisitosResumen
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        {tieneMatriz ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <span className="size-2 rounded-full bg-emerald-500" />
                            Configurada
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-warning">
                            <span className="size-2 rounded-full bg-amber-500" />
                            Pendiente
                          </span>
                        )}
                        <ArrowRightIcon className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Wizard de carga masiva */}
      <CargaMasivaWizard
        open={wizardAbierto}
        onOpenChange={setWizardAbierto}
        onSuccess={handleExitoMasivo}
      />
    </div>
  );
}
