import type { Cliente } from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { causaDeError, diagnosticoDeError } from '@/modules/clientes/api/clientes.api';
import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';
import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';
import { ClientesFiltros } from '@/modules/clientes/components/ClientesFiltros';
import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';
import { ClientesTabla } from '@/modules/clientes/components/ClientesTabla';
import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';
import { GestionarContactosSheet } from '@/modules/clientes/components/GestionarContactosSheet';
import { useClientes } from '@/modules/clientes/hooks/useClientes';
import { useFiltrosClientes } from '@/modules/clientes/hooks/useFiltrosClientes';

export function ClientesPage() {
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [ultimoCreado, setUltimoCreado] = useState<Cliente | null>(null);
  const [clienteAAdministrar, setClienteAAdministrar] = useState<Cliente | null>(null);

  const { filtros, hayFiltros, textoBusqueda, ...acciones } = useFiltrosClientes();
  const consulta = useClientes(filtros);

  const abrirAlta = () => {
    setUltimoCreado(null);
    setAltaAbierta(true);
  };

  const alCrear = (cliente: Cliente) => {
    setUltimoCreado(cliente);
    setAltaAbierta(false);
  };

  const clientes = consulta.data;
  // Mientras se pide un filtro nuevo, `data` es la respuesta anterior: no sirve para concluir
  // que "no hay ningún cliente".
  const sinClientes = clientes?.length === 0 && !hayFiltros && !consulta.isPlaceholderData;

  return (
    <div className="flex flex-col gap-3.5 px-6 pt-5.5 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
        <Button onClick={abrirAlta}>
          <PlusIcon aria-hidden="true" />
          Nuevo cliente
        </Button>
      </div>

      {ultimoCreado !== null && (
        <p role="status" className="rounded-control border bg-card px-3 py-2 text-sm text-success">
          Se registró el cliente {ultimoCreado.razonSocial} (CUIT {ultimoCreado.cuit}).
        </p>
      )}

      {consulta.isPending ? (
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
            sector={filtros.sector}
            subtipo={filtros.subtipo}
            hayFiltros={hayFiltros}
            total={clientes?.length ?? 0}
            onTextoChange={acciones.cambiarTexto}
            onSectorChange={acciones.elegirSector}
            onSubtipoChange={acciones.elegirSubtipo}
            onLimpiar={acciones.limpiar}
          />
          <ClientesTabla 
            clientes={clientes ?? []} 
            onLimpiarFiltros={acciones.limpiar}
            onAdministrarContactos={setClienteAAdministrar}
          />
        </>
      )}

      <NuevoClienteSheet
        abierto={altaAbierta}
        onAbiertoChange={setAltaAbierta}
        onCreado={alCrear}
      />
      <GestionarContactosSheet
        cliente={clienteAAdministrar}
        onClose={() => setClienteAAdministrar(null)}
      />
    </div>
  );
}
