import type { Cliente } from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { Button } from '@/components/ui/button';
import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';
import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';
import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';
import { NuevoClienteSheet } from '@/modules/clientes/components/NuevoClienteSheet';

// Herramienta de QA manual, solo en desarrollo: Loading y Error todavía no pueden ocurrir
// (no hay datos), así que `/clientes?estado=loading|error` permite verlos. Todo el preview
// vive tras `import.meta.env.DEV`: en producción el parámetro se ignora y el build elimina
// esta rama. Se reemplaza por el estado real de la consulta de clientes.
function vistaDePreview(params: URLSearchParams): ReactNode {
  if (!import.meta.env.DEV) {
    return null;
  }
  switch (params.get('estado')) {
    case 'loading':
      return <ClientesLoadingState />;
    case 'error':
      return <ClientesErrorState diagnostico="NETWORK_ERROR" />;
    default:
      return null;
  }
}

export function ClientesPage() {
  const [params] = useSearchParams();
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [ultimoCreado, setUltimoCreado] = useState<Cliente | null>(null);

  const abrirAlta = () => {
    setUltimoCreado(null);
    setAltaAbierta(true);
  };

  // El catálogo real llega con HU1.6: acá solo se confirma el alta, sin inventar una lista.
  const alCrear = (cliente: Cliente) => {
    setUltimoCreado(cliente);
    setAltaAbierta(false);
  };

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

      {vistaDePreview(params) ?? <ClientesEmptyState onNuevoCliente={abrirAlta} />}

      <NuevoClienteSheet
        abierto={altaAbierta}
        onAbiertoChange={setAltaAbierta}
        onCreado={alCrear}
      />
    </div>
  );
}
