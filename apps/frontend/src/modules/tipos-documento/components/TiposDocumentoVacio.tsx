import { PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface TiposDocumentoVacioProps {
  onNuevoTipo: () => void;
}

/**
 * El catálogo no tiene ningún tipo, ni activo ni desactivado. Explica para qué sirve la pantalla
 * e invita a crear el primero, con el mismo estilo que "Nuevo tipo" del encabezado.
 */
export function TiposDocumentoVacio({ onNuevoTipo }: TiposDocumentoVacioProps) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">Todavía no hay tipos de documento</h2>
      <p className="max-w-140 text-sm text-content-secondary">
        Acá se administran los tipos de documento que se pueden pedir en los requisitos de cada
        cliente.
      </p>
      <Button variant="brand" onClick={onNuevoTipo}>
        <PlusIcon aria-hidden="true" />
        Crear el primer tipo
      </Button>
    </div>
  );
}
