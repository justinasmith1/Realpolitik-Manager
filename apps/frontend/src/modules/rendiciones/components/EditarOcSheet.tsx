import type { ActualizarRendicionDto, RendicionDetalle, UltimaOc } from '@realpolitik/shared';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { enfocarYMostrar } from '@/lib/focus';
import { interpretarFalloActualizacionOc } from '@/modules/rendiciones/api/rendiciones.api';
import {
  editarOcResolver,
  ocVacia,
  ordenDeCamposOc,
  valoresDeSugerencia,
  valoresInicialesOc,
  type CampoOc,
  type EditarOcFormValues,
} from '@/modules/rendiciones/components/editarOcForm.validation';
import { mensajeFalloActualizacionOc } from '@/modules/rendiciones/components/erroresDeRendicion';
import {
  useActualizarOcDeRendicion,
  useUltimaOc,
} from '@/modules/rendiciones/hooks/useRendiciones';
import { etiquetaDePeriodo } from '@/modules/rendiciones/rendiciones.etiquetas';

interface EditarOcSheetProps {
  rendicion: RendicionDetalle;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se guardó: quien abre el panel lo cierra y avisa. */
  onGuardada: (texto: string) => void;
}

export const TEXTO_OC_GUARDADA = 'Orden de compra guardada.';

/**
 * Panel para cargar o editar la orden de compra de una rendición (HU2.11): número de OC, monto
 * mensual y monto total, los tres opcionales. El período no se pide: es el de la rendición. Al
 * abrirlo con la OC vacía ofrece repetir la última OC del cliente.
 */
export function EditarOcSheet({
  rendicion,
  abierto,
  onAbiertoChange,
  onGuardada,
}: EditarOcSheetProps) {
  const actualizacion = useActualizarOcDeRendicion();
  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrirPanel) => {
        // Mientras se guarda no se cierra: el resultado tiene que verse.
        if (!abrirPanel && actualizacion.isPending) return;
        onAbiertoChange(abrirPanel);
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Orden de compra</SheetTitle>
          <SheetDescription>
            Rendición {etiquetaDePeriodo(rendicion)} · factura {rendicion.numeroFactura}. Los tres
            datos son opcionales.
          </SheetDescription>
        </SheetHeader>
        <EditarOcForm
          rendicion={rendicion}
          abierto={abierto}
          onCancel={() => onAbiertoChange(false)}
          onGuardada={onGuardada}
        />
      </SheetContent>
    </Sheet>
  );
}

interface EditarOcFormProps {
  rendicion: RendicionDetalle;
  abierto: boolean;
  onCancel: () => void;
  onGuardada: (texto: string) => void;
}

function EditarOcForm({ rendicion, abierto, onCancel, onGuardada }: EditarOcFormProps) {
  const id = useId();
  const actualizacion = useActualizarOcDeRendicion();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  // Se decide una vez, al abrir el panel: si la OC ya tenía datos no se sugiere nada.
  const [vacioAlAbrir] = useState(() => ocVacia(valoresInicialesOc(rendicion)));
  // Solo pide la sugerencia cuando el panel está abierto y la OC estaba vacía al abrirlo.
  const sugerencia = useUltimaOc(rendicion.clienteId, { enabled: abierto && vacioAlAbrir });
  const { register, handleSubmit, setValue, setError, control, formState } = useForm<
    EditarOcFormValues,
    unknown,
    ActualizarRendicionDto
  >({
    defaultValues: valoresInicialesOc(rendicion),
    resolver: editarOcResolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { errors, isSubmitting } = formState;
  const valoresActuales = useWatch({ control });
  const ultimaOc: UltimaOc | undefined = sugerencia.data;
  const ofrecerSugerencia =
    vacioAlAbrir &&
    ultimaOc !== undefined &&
    ultimaOc !== null &&
    ocVacia({
      numeroOc: valoresActuales.numeroOc ?? '',
      montoMensual: valoresActuales.montoMensual ?? '',
      montoTotal: valoresActuales.montoTotal ?? '',
    });

  const idDe = (campo: CampoOc) => `${id}-${campo}`;

  function repetirUltimaOc(ultima: NonNullable<UltimaOc>) {
    const valores = valoresDeSugerencia(ultima);
    for (const campo of ordenDeCamposOc) {
      setValue(campo, valores[campo], { shouldDirty: true, shouldValidate: false });
    }
  }

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      try {
        await actualizacion.mutateAsync({
          clienteId: rendicion.clienteId,
          rendicionId: rendicion.id,
          datos,
        });
      } catch (fallo) {
        const errores = mensajeFalloActualizacionOc(interpretarFalloActualizacionOc(fallo));
        for (const [campo, message] of Object.entries(errores.campos ?? {}) as [
          CampoOc,
          string,
        ][]) {
          setError(campo, { type: 'server', message });
          enfocarYMostrar(document.getElementById(idDe(campo)));
        }
        setErrorGeneral(errores.general ?? null);
        return;
      }
      onGuardada(TEXTO_OC_GUARDADA);
    },
    (invalidos) => {
      const primero = ordenDeCamposOc.find((campo) => invalidos[campo] !== undefined);
      if (primero !== undefined) enfocarYMostrar(document.getElementById(idDe(primero)));
    },
  );

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {errorGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert>{errorGeneral}</Alert>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {ofrecerSugerencia && (
          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => repetirUltimaOc(ultimaOc)}
            >
              ¿Repetir última OC ({ultimaOc.numeroOc})?
            </Button>
          </div>
        )}
        <FormField id={idDe('numeroOc')} label="Número de OC" optional error={errors.numeroOc}>
          <Input
            autoComplete="off"
            {...register('numeroOc')}
            {...describirCampo(idDe('numeroOc'), errors.numeroOc, { required: false })}
          />
        </FormField>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            id={idDe('montoMensual')}
            label="Monto mensual"
            optional
            hint="En pesos, por ejemplo 1250000 o 1250000,50."
            error={errors.montoMensual}
          >
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...register('montoMensual')}
              {...describirCampo(idDe('montoMensual'), errors.montoMensual, {
                hint: true,
                required: false,
              })}
            />
          </FormField>
          <FormField id={idDe('montoTotal')} label="Monto total" optional error={errors.montoTotal}>
            <Input
              inputMode="decimal"
              autoComplete="off"
              {...register('montoTotal')}
              {...describirCampo(idDe('montoTotal'), errors.montoTotal, { required: false })}
            />
          </FormField>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingText="Guardando…"
          className="min-w-32"
        >
          Guardar OC
        </LoadingButton>
      </div>
    </form>
  );
}
