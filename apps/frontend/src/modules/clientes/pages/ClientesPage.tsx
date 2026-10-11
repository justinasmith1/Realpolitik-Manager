import type { Cliente } from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  causaDeError,
  diagnosticoDeError,
  interpretarFalloCambioEstado,
  type EstadoAsignable,
} from '@/modules/clientes/api/clientes.api';
import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';
import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';
import { ClientesFiltros } from '@/modules/clientes/components/ClientesFiltros';
import { ClientesInactivosVacio } from '@/modules/clientes/components/ClientesInactivosVacio';
import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';
import { ClientesSinActivos } from '@/modules/clientes/components/ClientesSinActivos';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';
import { DesactivarClienteDialog } from '@/modules/clientes/components/DesactivarClienteDialog';
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

export function ClientesPage() {
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [ultimoCreado, setUltimoCreado] = useState<Cliente | null>(null);
  const [clienteAAdministrar, setClienteAAdministrar] = useState<Cliente | null>(null);
  const [clienteAEditar, setClienteAEditar] = useState<Cliente | null>(null);
  const [ultimoEditado, setUltimoEditado] = useState<Cliente | null>(null);
  const [clienteADesactivar, setClienteADesactivar] = useState<Cliente | null>(null);
  const [avisoEstado, setAvisoEstado] = useState<{ tipo: 'exito' | 'error'; texto: string } | null>(
    null,
  );

  const { filtros, hayFiltros, estado, textoBusqueda, ...acciones } = useFiltrosClientes();
  const consulta = useClientes(filtros);
  const cambioDeEstado = useCambiarEstadoCliente();
  const idsCambiandoEstado = useClientesCambiandoEstado();

  const abrirAlta = () => {
    setUltimoCreado(null);
    setUltimoEditado(null);
    setAvisoEstado(null);
    setAltaAbierta(true);
  };

  /** Desactiva o reactiva y avisa el resultado. El listado se refresca desde el hook. */
  const cambiarEstado = async (cliente: Cliente, nuevo: EstadoAsignable) => {
    setUltimoCreado(null);
    setUltimoEditado(null);
    setAvisoEstado(null);
    try {
      await cambioDeEstado.mutateAsync({ id: cliente.id, estado: nuevo });
      setAvisoEstado({
        tipo: 'exito',
        texto:
          nuevo === 'INACTIVO'
            ? `Se desactivó el cliente ${cliente.razonSocial}.`
            : `Se reactivó el cliente ${cliente.razonSocial}.`,
      });
    } catch (error) {
      setAvisoEstado({
        tipo: 'error',
        texto: mensajeFalloCambioEstado(
          interpretarFalloCambioEstado(error),
          nuevo === 'INACTIVO' ? 'desactivar' : 'reactivar',
        ),
      });
    }
  };

  const confirmarDesactivacion = (cliente: Cliente) => {
    setClienteADesactivar(null);
    void cambiarEstado(cliente, 'INACTIVO');
  };

  const alCrear = (cliente: Cliente) => {
    setUltimoCreado(cliente);
    setAltaAbierta(false);
  };

  const abrirEdicion = (cliente: Cliente) => {
    setUltimoCreado(null);
    setUltimoEditado(null);
    setAvisoEstado(null);
    setClienteAEditar(cliente);
  };

  const alActualizar = (cliente: Cliente) => {
    setUltimoEditado(cliente);
    setClienteAEditar(null);
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
          <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
          <p className="mt-0.5 text-sm text-content-secondary">
            Catálogo de clientes y su configuración de rendición.
          </p>
        </div>
        <Button variant="brand" onClick={abrirAlta} className="max-sm:w-full">
          <PlusIcon aria-hidden="true" />
          Nuevo cliente
        </Button>
      </div>

      {ultimoCreado !== null && (
        <Alert variant="success">
          Se registró el cliente {ultimoCreado.razonSocial} (CUIT {ultimoCreado.cuit}).
        </Alert>
      )}

      {ultimoEditado !== null && (
        <Alert variant="success">Se actualizó el cliente {ultimoEditado.razonSocial}.</Alert>
      )}

      {avisoEstado?.tipo === 'exito' && <Alert variant="success">{avisoEstado.texto}</Alert>}

      {avisoEstado?.tipo === 'error' && <Alert>{avisoEstado.texto}</Alert>}

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
              onLimpiarFiltros={acciones.limpiar}
              onAdministrarContactos={setClienteAAdministrar}
              onEditar={abrirEdicion}
              onDesactivar={setClienteADesactivar}
              onReactivar={(cliente) => void cambiarEstado(cliente, 'ACTIVO')}
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
      <DesactivarClienteDialog
        cliente={clienteADesactivar}
        onConfirmar={confirmarDesactivacion}
        onCancelar={() => setClienteADesactivar(null)}
      />
      <GestionarContactosSheet
        cliente={clienteAAdministrar}
        onClose={() => setClienteAAdministrar(null)}
      />
    </div>
  );
}
