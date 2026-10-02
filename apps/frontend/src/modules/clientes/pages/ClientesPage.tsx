import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { ClientesEmptyState } from '@/modules/clientes/components/ClientesEmptyState';
import { ClientesErrorState } from '@/modules/clientes/components/ClientesErrorState';
import { ClientesLoadingState } from '@/modules/clientes/components/ClientesLoadingState';

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

  return (
    <div className="flex flex-col gap-3.5 px-6 pt-5.5 pb-10">
      <h1 className="text-xl font-semibold tracking-tight">Clientes</h1>
      {vistaDePreview(params) ?? <ClientesEmptyState />}
    </div>
  );
}
