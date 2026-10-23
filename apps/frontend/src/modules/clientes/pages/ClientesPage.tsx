import type { Cliente } from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { ColumnPicker } from '@/components/data-table/ColumnPicker';
import { useColumnPreferences } from '@/components/data-table/useColumnPreferences';
import { ClientesNav } from '@/components/layout/ClientesNav';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useIsCompactLayout } from '@/hooks/use-media-query';
import { enfocarYMostrar } from '@/lib/focus';
import {
  causaDeError,
  diagnosticoDeError,
  interpretarFalloCambioEstado,
  type EstadoAsignable,
} from '@/modules/clientes/api/clientes.api';
import {
  CLIENTES_COLUMNAS_CONFIGURABLES,
  CLIENTES_COLUMNAS_CONFIGURABLES_IDS,
  CLIENTES_COLUMNAS_DEFAULT,
  CLIENTES_TABLA_ID,
} from '@/modules/clientes/clientes.columnas';
import {
  CambiarEstadoClienteDialog,
  type CambioAConfirmar,
  type ResultadoCambioEstado,
} from '@/modules/clientes/components/CambiarEstadoClienteDialog';
import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';
import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';
import { ClientesFiltros } from '@/modules/clientes/components/ClientesFiltros';
import { ClientesInactivosVacio } from '@/modules/clientes/components/ClientesInactivosVacio';
import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';
import { ClientesSinActivos } from '@/modules/clientes/components/ClientesSinActivos';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';
import { mensajeFalloCambioEstado } from '@/modules/clientes/components/erroresDeEnvio';
import { GestionarContactosSheet } from '@/modules/clientes/components/GestionarContactosSheet';
import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';
import {
  useCambiarEstadoCliente,
  useClientesCambiandoEstado,
} from '@/modules/clientes/hooks/useCambiarEstadoCliente';
import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useFiltrosClientes } from '@/modules/clientes/hooks/useFiltrosClientes';
import { stateDeListado } from '@/modules/clientes/matriz.navegacion';

/**
 * Resultado de la última acción, sobre el listado. Uno solo a la vez: se retira solo, al tocar su
 * cerrar o cuando empieza otra acción, que lo limpia o lo reemplaza.
 *
 * Cada aviso tiene su `id`: el cierre de uno (su temporizador, su animación de salida) nunca
 * alcanza a otro que lo reemplazó. `cerrando` = está en la animación de salida.
 */
type AvisoPagina = {
  id: number;
  variante: 'success' | 'destructive';
  texto: string;
  cerrando: boolean;
} | null;

/** Cuánto queda visible el aviso de la página antes de retirarse solo. */
const DURACION_AVISO_MS = 8000;

export function ClientesPage() {
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [clienteAAdministrar, setClienteAAdministrar] = useState<Cliente | null>(null);
  const [clienteAEditar, setClienteAEditar] = useState<Cliente | null>(null);
  const [cambioAConfirmar, setCambioAConfirmar] = useState<CambioAConfirmar | null>(null);
  const [aviso, setAviso] = useState<AvisoPagina>(null);
  // Destino del foco cuando lo que lo tenía desaparece: la fila que salió del listado al
  // desactivarla o reactivarla, o el botón de cerrar del aviso.
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const ultimoIdDeAviso = useRef(0);

  const avisar = (variante: 'success' | 'destructive', texto: string) => {
    ultimoIdDeAviso.current += 1;
    setAviso({ id: ultimoIdDeAviso.current, variante, texto, cerrando: false });
  };

  /**
   * Empieza la salida del aviso `id` (la X y el temporizador pasan por acá). Si el foco estaba en
   * él (su botón cerrar), pasa al título y no se pierde cuando el aviso se quite.
   */
  const cerrarAviso = useCallback((id: number) => {
    if (avisoRef.current?.contains(document.activeElement)) enfocarYMostrar(tituloRef.current);
    setAviso((actual) =>
      actual?.id === id && !actual.cerrando ? { ...actual, cerrando: true } : actual,
    );
  }, []);

  /** Terminada la animación de salida del aviso `id`, lo quita (si sigue siendo ese). */
  const quitarAviso = useCallback((id: number) => {
    setAviso((actual) => (actual?.id === id ? null : actual));
  }, []);

  // Cada aviso se retira solo a los `DURACION_AVISO_MS`. Uno nuevo trae su propia cuenta (la del
  // anterior se cancela), y cerrarlo antes o limpiarlo también la cancela.
  const idDelAviso = aviso?.id;
  const avisoCerrando = aviso?.cerrando ?? false;
  useEffect(() => {
    if (idDelAviso === undefined || avisoCerrando) return;
    const temporizador = setTimeout(() => cerrarAviso(idDelAviso), DURACION_AVISO_MS);
    return () => clearTimeout(temporizador);
  }, [idDelAviso, avisoCerrando, cerrarAviso]);

  const location = useLocation();
  const navigate = useNavigate();
  const { filtros, hayFiltros, estado, textoBusqueda, ...acciones } = useFiltrosClientes();
  const consulta = useClientes(filtros);
  const cambioDeEstado = useCambiarEstadoCliente();
  const idsCambiandoEstado = useClientesCambiandoEstado();
  // Columnas de la tabla de escritorio. Una sola preferencia para activos e inactivos: es la
  // misma tabla. Sin auth todavía, el dueño es el anónimo por defecto del hook.
  const columnas = useColumnPreferences({
    tableId: CLIENTES_TABLA_ID,
    availableIds: CLIENTES_COLUMNAS_CONFIGURABLES_IDS,
    defaultIds: CLIENTES_COLUMNAS_DEFAULT,
  });
  // El mismo corte que usa la tabla para pasar a tarjetas, que no tienen columnas que elegir.
  const compacto = useIsCompactLayout();

  const avisarExito = (texto: string) => avisar('success', texto);

  const abrirAlta = () => {
    setAviso(null);
    setAltaAbierta(true);
  };

  /**
   * Desactiva o reactiva. El listado se refresca desde el hook (también ante un 404). Devuelve
   * `null` si salió bien, o el fallo junto con el mensaje para mostrar.
   */
  const cambiarEstado = async (cliente: Cliente, nuevo: EstadoAsignable) => {
    setAviso(null);
    try {
      await cambioDeEstado.mutateAsync({ id: cliente.id, estado: nuevo });
      return null;
    } catch (error) {
      const fallo = interpretarFalloCambioEstado(error);
      const accion = nuevo === 'INACTIVO' ? 'desactivar' : 'reactivar';
      return { ...fallo, mensaje: mensajeFalloCambioEstado(fallo, accion) };
    }
  };

  /** Desde el diálogo de confirmación: un error cualquiera queda ahí, para reintentar. */
  const confirmarCambio = async ({
    cliente,
    accion,
  }: CambioAConfirmar): Promise<ResultadoCambioEstado> => {
    const fallo = await cambiarEstado(cliente, accion === 'desactivar' ? 'INACTIVO' : 'ACTIVO');
    if (fallo?.tipo === 'inesperado') {
      return { tipo: 'error', mensaje: fallo.mensaje };
    }
    // Salió bien, o el cliente ya no existe y no hay nada que reintentar: se cierra el diálogo
    // y se avisa en la página.
    const hecho =
      accion === 'desactivar'
        ? `Se desactivó el cliente ${cliente.razonSocial}.`
        : `Se reactivó el cliente ${cliente.razonSocial}.`;
    if (fallo === null) avisar('success', hecho);
    else avisar('destructive', fallo.mensaje);
    setCambioAConfirmar(null);
    return fallo === null ? { tipo: 'hecho' } : { tipo: 'no-existe' };
  };

  const alCrear = (cliente: Cliente) => {
    avisarExito(`Se registró el cliente ${cliente.razonSocial} (CUIT ${cliente.cuit}).`);
    setAltaAbierta(false);
  };

  const abrirEdicion = (cliente: Cliente) => {
    setAviso(null);
    setClienteAEditar(cliente);
  };

  const alActualizar = (cliente: Cliente) => {
    avisarExito(`Se actualizó el cliente ${cliente.razonSocial}.`);
    setClienteAEditar(null);
  };

  const abrirContactos = (cliente: Cliente) => {
    setAviso(null);
    setClienteAAdministrar(cliente);
  };

  const verMatriz = (cliente: Cliente) => {
    void navigate(`/clientes/${cliente.id}/matriz`, { state: stateDeListado(location.search) });
  };

  const alGuardarContactos = (cliente: Cliente) => {
    avisarExito(`Se guardaron los contactos de ${cliente.razonSocial}.`);
    setClienteAAdministrar(null);
  };

  const clientes = consulta.data;
  // Mientras se pide un filtro nuevo, `data` es la respuesta anterior: no sirve para concluir
  // que "no hay ningún cliente".
  const sinActivos = clientes?.length === 0 && !hayFiltros && !consulta.isPlaceholderData;
  // Sin activos todavía no se sabe si es el primer uso o si están todos desactivados: se
  // consulta cuántos inactivos hay para no decir "todavía no cargaste clientes" si los hay.
  const inactivos = useClientes({ estado: 'INACTIVO' }, { enabled: sinActivos });
  const cantidadInactivos = inactivos.data?.length ?? 0;
  // Un dato viejo (el listado se invalidó al desactivar el último) no sirve: se espera el fresco.
  const verificandoInactivos = sinActivos && (inactivos.isPending || inactivos.isFetching);
  const sinClientes = sinActivos && cantidadInactivos === 0 && !verificandoInactivos;
  const soloInactivos = sinActivos && cantidadInactivos > 0;
  // Vista de inactivos vacía y sin búsqueda ni otros filtros: no es el primer uso, así que se
  // dice que no hay inactivos y los filtros siguen a la vista para poder volver a los activos.
  const sinInactivos =
    clientes?.length === 0 &&
    estado === 'INACTIVO' &&
    filtros.q === undefined &&
    filtros.sector === undefined &&
    filtros.subtipo === undefined &&
    !consulta.isPlaceholderData;

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
            Clientes
          </h1>
          <p className="mt-0.5 text-sm text-content-secondary">
            Catálogo de clientes y su configuración de rendición.
          </p>
        </div>
        <Button variant="brand" onClick={abrirAlta} className="max-sm:w-full">
          <PlusIcon aria-hidden="true" />
          Nuevo cliente
        </Button>
      </div>

      <ClientesNav />

      {aviso !== null && (
        <Alert
          // Un aviso nuevo es otro elemento: entra con su animación y no hereda la salida del
          // anterior.
          key={aviso.id}
          ref={avisoRef}
          variant={aviso.variante}
          saliendo={aviso.cerrando}
          onCerrar={() => cerrarAviso(aviso.id)}
          onAnimationEnd={(evento) => {
            if (aviso.cerrando && evento.target === evento.currentTarget) quitarAviso(aviso.id);
          }}
        >
          {aviso.texto}
        </Alert>
      )}

      {consulta.isPending || verificandoInactivos ? (
        <ClientesLoadingState />
      ) : consulta.isError ? (
        <ClientesErrorState
          causa={causaDeError(consulta.error)}
          diagnostico={diagnosticoDeError(consulta.error)}
          onReintentar={() => void consulta.refetch()}
        />
      ) : sinClientes ? (
        <ClientesEmptyState onNuevoCliente={abrirAlta} />
      ) : (
        <>
          <ClientesFiltros
            textoBusqueda={textoBusqueda}
            estado={estado}
            sector={filtros.sector}
            subtipo={filtros.subtipo}
            hayFiltros={hayFiltros}
            total={clientes?.length ?? 0}
            onTextoChange={acciones.cambiarTexto}
            onEstadoChange={acciones.elegirEstado}
            onSectorChange={acciones.elegirSector}
            onSubtipoChange={acciones.elegirSubtipo}
            onLimpiar={acciones.limpiar}
            accionesListado={
              compacto ? undefined : (
                <ColumnPicker
                  items={CLIENTES_COLUMNAS_CONFIGURABLES}
                  visibleIds={columnas.visibleIds}
                  onVisibleIdsChange={columnas.setVisibleIds}
                  onReset={columnas.reset}
                  isCustomized={columnas.isCustomized}
                  fixedColumnsNote="Cliente y Acciones siempre están visibles."
                />
              )
            }
          />
          {soloInactivos ? (
            <ClientesSinActivos
              cantidadInactivos={cantidadInactivos}
              onVerInactivos={() => acciones.elegirEstado('INACTIVO')}
            />
          ) : sinInactivos ? (
            <ClientesInactivosVacio />
          ) : (
            <ClientesTabla
              clientes={clientes ?? []}
              columnasVisibles={columnas.visibleIds}
              onLimpiarFiltros={acciones.limpiar}
              onAdministrarContactos={abrirContactos}
              onEditar={abrirEdicion}
              onVerMatriz={verMatriz}
              onDesactivar={(cliente) => setCambioAConfirmar({ cliente, accion: 'desactivar' })}
              onReactivar={(cliente) => setCambioAConfirmar({ cliente, accion: 'reactivar' })}
              idsCambiandoEstado={idsCambiandoEstado}
            />
          )}
        </>
      )}

      <NuevoClienteSheet
        abierto={altaAbierta}
        onAbiertoChange={setAltaAbierta}
        onCreado={alCrear}
      />
      <EditarClienteSheet
        cliente={clienteAEditar}
        onClose={() => setClienteAEditar(null)}
        onActualizado={alActualizar}
      />
      <CambiarEstadoClienteDialog
        cambio={cambioAConfirmar}
        onConfirmar={confirmarCambio}
        onCancelar={() => setCambioAConfirmar(null)}
        focoTrasConfirmar={tituloRef}
      />
      <GestionarContactosSheet
        cliente={clienteAAdministrar}
        onClose={() => setClienteAAdministrar(null)}
        onGuardado={alGuardarContactos}
      />
    </div>
  );
}
