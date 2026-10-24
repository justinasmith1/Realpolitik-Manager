import type { Cliente } from '@realpolitik/shared';
import { CircleAlertIcon, PlusIcon } from 'lucide-react';
import type { Ref } from 'react';

import { Button } from '@/components/ui/button';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { EstadoBadge } from '@/modules/clientes/components/EstadoBadge';
import { PeriodicidadTexto } from '@/modules/clientes/components/PeriodicidadTexto';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';

interface MatrizEncabezadoProps {
  cliente: Cliente;
  tituloRef: Ref<HTMLHeadingElement>;
  /** Solo con un cliente activo y la matriz ya cargada. */
  onAgregar?: (() => void) | undefined;
  agregarRef?: Ref<HTMLButtonElement> | undefined;
}

/**
 * Identidad del cliente y estado de su matriz. `matrizConfigurada` solo dice si hay al menos
 * un requisito activo: no es una matriz completa ni un avance.
 *
 * Un cliente que no está activo se puede leer igual. Sin `onAgregar` no hay alta: la edición y
 * la baja tampoco se ofrecen en el listado.
 */
export function MatrizEncabezado({
  cliente,
  tituloRef,
  onAgregar,
  agregarRef,
}: MatrizEncabezadoProps) {
  const mismaDenominacion = cliente.razonSocial.trim() === cliente.denominacion.trim();
  const soloLectura = cliente.estado !== 'ACTIVO';

  return (
    <header className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            ref={tituloRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight break-words"
          >
            {cliente.denominacion}
          </h1>
          {!mismaDenominacion && (
            <p className="mt-0.5 text-sm break-words text-content-secondary">
              {cliente.razonSocial}
            </p>
          )}
        </div>
        {onAgregar !== undefined && (
          <Button ref={agregarRef} variant="brand" onClick={onAgregar} className="max-sm:w-full">
            <PlusIcon aria-hidden="true" />
            Agregar requisito
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <EstadoBadge estado={cliente.estado} />
        <SectorBadge sector={cliente.sector} />
        {cliente.sector === 'PUBLICO' && <SubtipoBadge subtipo={cliente.subtipo} />}
      </div>

      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-content-secondary">Canal habitual</dt>
          <dd>
            <CanalEntregaBadge canal={cliente.canalEntrega} />
          </dd>
        </div>
        {cliente.periodicidad !== null && (
          <div className="flex flex-wrap items-start gap-2">
            <dt className="text-content-secondary">Periodicidad</dt>
            <dd>
              <PeriodicidadTexto periodicidad={cliente.periodicidad} />
            </dd>
          </div>
        )}
      </dl>

      <p className="text-sm">
        <span className="text-content-secondary">Estado de la matriz: </span>
        <span className="font-medium">
          {cliente.matrizConfigurada ? 'Con requisitos' : 'Sin requisitos configurados'}
        </span>
      </p>

      {soloLectura && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-foreground"
        >
          <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-warning" />
          Este cliente debe estar activo para modificar su matriz.
        </p>
      )}
    </header>
  );
}
