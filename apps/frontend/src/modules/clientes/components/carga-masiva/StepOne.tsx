import { useFormContext } from 'react-hook-form';
import { Link } from 'react-router';

import { FormField } from '@/components/ui/form-field';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

import type { CargaMasivaFormValues } from './cargaMasiva.types';

export function StepOne() {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<CargaMasivaFormValues>();
  const tipoDocumentoId = watch('tipoDocumentoId');

  const {
    data: tipos,
    isLoading,
    isError,
    refetch,
  } = useTiposDocumento({ incluirInactivos: false });

  const tiposActivos = tipos?.filter((t) => t.activo) ?? [];

  const opciones: SelectOption[] = tiposActivos.map((t) => ({
    value: t.id,
    label: t.nombre,
  }));

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3 py-4" aria-busy="true">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-card border bg-card p-4">
        <p className="text-sm text-destructive">
          No pudimos cargar los tipos de documento disponibles.
        </p>
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

  if (tiposActivos.length === 0) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-4">
        <p className="text-sm text-content-secondary">
          No hay tipos de documento activos para seleccionar.
        </p>
        <Link
          to="/clientes/tipos-documento"
          className="text-sm font-medium text-brand-accent underline hover:opacity-80"
        >
          Ir al catálogo de tipos de documento
        </Link>
      </div>
    );
  }

  const errorTipo = errors.tipoDocumentoId?.message;

  return (
    <div className="flex flex-col gap-4 py-2">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-foreground">Selección del Requisito</h3>
        <p className="text-sm text-content-secondary">
          Elegí el tipo de documento del catálogo activo que deseas añadir a los clientes.
        </p>
      </div>

      <FormField
        label="Tipo de documento"
        id="tipo-documento-select"
        error={errors.tipoDocumentoId}
      >
        <Select
          id="tipo-documento-select"
          value={tipoDocumentoId ?? ''}
          onValueChange={(val) => {
            setValue('tipoDocumentoId', val, { shouldValidate: true, shouldDirty: true });
          }}
          options={opciones}
          placeholder="Seleccioná un tipo de documento…"
          invalid={Boolean(errorTipo)}
        />
      </FormField>
    </div>
  );
}
