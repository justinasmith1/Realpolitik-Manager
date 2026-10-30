import {
  NUMERO_FACTURA_EJEMPLO,
  type CreateRendicionDto,
  type EmisorType,
  type RendicionDetalle,
} from '@realpolitik/shared';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select } from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { enfocarYMostrar } from '@/lib/focus';
import { interpretarFalloApertura } from '@/modules/rendiciones/api/rendiciones.api';
import {
  abrirRendicionResolver,
  opcionesDeAnio,
  opcionesDeEmisor,
  opcionesDeMes,
  ordenDeCampos,
  valoresInicialesAbrirRendicion,
  type AbrirRendicionFormValues,
  type CampoAbrirRendicion,
} from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import {
  erroresDeApertura,
  type AccionSugerida,
  type ErroresDeApertura,
} from '@/modules/rendiciones/components/erroresDeRendicion';
import { useAbrirRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  AYUDA_EMISOR_DEL_CLIENTE,
  AYUDA_EMISOR_SIN_HABITUAL,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface AbrirRendicionSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** `emisor` es el habitual del cliente: precarga el selector (vacío si no tiene). */
  cliente: { id: string; denominacion: string; emisor?: EmisorType | undefined };
  /** Se llama con la rendición abierta. Quien abre el panel decide cómo seguir. */
  onAbierta: (rendicion: RendicionDetalle) => void;
  /**
   * Ir a la rendición que ya tiene la factura (cuando el alta responde que está repetida). Puede
   * ser de otro cliente: se informa el `clienteId` de la existente.
   */
  onVerRendicion: (existente: { rendicionId: string; clienteId: string }) => void;
  /** Ir a configurar la matriz. Sin esto (no se puede editar), no se ofrece. */
  onConfigurarMatriz?: (() => void) | undefined;
}

/**
 * Panel para abrir una rendición (HU2.5, HU2.9): período, emisor y número de factura. El emisor
 * viene precargado con el habitual del cliente y se puede cambiar solo para esta rendición; si el
 * cliente no tiene, hay que elegirlo. El checklist lo genera el backend con todos los requisitos
 * activos de la matriz. Si el alta falla, queda abierto con los
 * datos y el motivo; si sale bien, el botón confirma un instante y recién entonces avisa.
 */
export function AbrirRendicionSheet({
  abierto,
  onAbiertoChange,
  cliente,
  onAbierta,
  onVerRendicion,
  onConfigurarMatriz,
}: AbrirRendicionSheetProps) {
  const alta = useAbrirRendicion();
  const exito = useExitoBreve();

  async function abrir(datos: CreateRendicionDto): Promise<ErroresDeApertura | undefined> {
    let rendicion: RendicionDetalle;
    try {
      rendicion = await alta.mutateAsync({ clienteId: cliente.id, datos });
    } catch (error) {
      return erroresDeApertura(interpretarFalloApertura(error));
    }
    await exito.mostrar();
    onAbierta(rendicion);
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrirPanel) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrirPanel && (alta.isPending || exito.activo)) {
          return;
        }
        onAbiertoChange(abrirPanel);
      }}
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) exito.reiniciar();
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Abrir rendición</SheetTitle>
          <SheetDescription>
            Se genera el checklist con todos los requisitos activos de {cliente.denominacion}.
          </SheetDescription>
        </SheetHeader>
        <AbrirRendicionForm
          onSubmit={abrir}
          onCancel={() => onAbiertoChange(false)}
          exito={exito.activo}
          onAccion={(accion) => {
            if (accion.tipo === 'ver-rendicion') {
              onVerRendicion({ rendicionId: accion.rendicionId, clienteId: accion.clienteId });
            } else onConfigurarMatriz?.();
          }}
          puedeConfigurarMatriz={onConfigurarMatriz !== undefined}
          emisorDelCliente={cliente.emisor}
        />
      </SheetContent>
    </Sheet>
  );
}

interface AbrirRendicionFormProps {
  onSubmit: (datos: CreateRendicionDto) => Promise<ErroresDeApertura | undefined>;
  onCancel: () => void;
  exito: boolean;
  onAccion: (accion: AccionSugerida) => void;
  puedeConfigurarMatriz: boolean;
  emisorDelCliente: EmisorType | undefined;
}

const TEXTO_DE_ACCION: Record<AccionSugerida['tipo'], string> = {
  'ver-rendicion': 'Ver rendición',
  'configurar-matriz': 'Agregar requisito',
};

function AbrirRendicionForm({
  onSubmit,
  onCancel,
  exito,
  onAccion,
  puedeConfigurarMatriz,
  emisorDelCliente,
}: AbrirRendicionFormProps) {
  const id = useId();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [accion, setAccion] = useState<AccionSugerida | null>(null);
  // Se calculan al abrir el panel: el mes actual no cambia mientras se completa.
  const valoresIniciales = useMemo(
    () => valoresInicialesAbrirRendicion(new Date(), emisorDelCliente),
    [emisorDelCliente],
  );
  const anios = useMemo(() => opcionesDeAnio(), []);
  const { control, register, handleSubmit, setError, formState } = useForm<
    AbrirRendicionFormValues,
    unknown,
    CreateRendicionDto
  >({
    defaultValues: valoresIniciales,
    resolver: abrirRendicionResolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { errors, isSubmitting } = formState;

  const idDe = (campo: CampoAbrirRendicion) => `${id}-${campo}`;
  const enfocarPrimerError = (conError: Partial<Record<CampoAbrirRendicion, unknown>>) => {
    const primero = ordenDeCampos.find((campo) => conError[campo] !== undefined);
    if (primero !== undefined) enfocarYMostrar(document.getElementById(idDe(primero)));
  };

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      setAccion(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) return;
      const conError = Object.entries(errores.campos ?? {}) as [CampoAbrirRendicion, string][];
      for (const [campo, message] of conError) {
        setError(campo, { type: 'server', message });
      }
      enfocarPrimerError(errores.campos ?? {});
      setErrorGeneral(errores.general ?? null);
      const sugerida = errores.accion ?? null;
      setAccion(sugerida?.tipo === 'configurar-matriz' && !puedeConfigurarMatriz ? null : sugerida);
    },
    (invalidos) => enfocarPrimerError(invalidos),
  );

  const selectDe = (
    campo: 'mes' | 'anio' | 'emisor',
    options: typeof opcionesDeMes,
    extra: { placeholder?: string; hint?: boolean } = {},
  ) => (
    <Controller
      name={campo}
      control={control}
      render={({ field }) => {
        const { 'aria-invalid': invalido, ...descripcion } = describirCampo(
          idDe(campo),
          errors[campo],
          { hint: extra.hint },
        );
        return (
          <Select
            {...descripcion}
            invalid={invalido === true}
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
            triggerRef={field.ref}
            options={options}
            {...(extra.placeholder === undefined ? {} : { placeholder: extra.placeholder })}
          />
        );
      }}
    />
  );

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {errorGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert>
            <div className="flex flex-col items-start gap-2">
              <span>{errorGeneral}</span>
              {accion !== null && (
                <Button type="button" variant="outline" size="sm" onClick={() => onAccion(accion)}>
                  {TEXTO_DE_ACCION[accion.tipo]}
                </Button>
              )}
            </div>
          </Alert>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField id={idDe('mes')} label="Mes" error={errors.mes}>
            {selectDe('mes', opcionesDeMes)}
          </FormField>
          <FormField id={idDe('anio')} label="Año" error={errors.anio}>
            {selectDe('anio', anios)}
          </FormField>
        </div>
        <FormField
          id={idDe('emisor')}
          label="Emisor"
          hint={
            emisorDelCliente === undefined ? AYUDA_EMISOR_SIN_HABITUAL : AYUDA_EMISOR_DEL_CLIENTE
          }
          error={errors.emisor}
        >
          {selectDe('emisor', opcionesDeEmisor, { placeholder: 'Elegí el emisor', hint: true })}
        </FormField>
        <FormField
          id={idDe('numeroFactura')}
          label="Número de factura"
          hint={`Formato: ${NUMERO_FACTURA_EJEMPLO} (letra, punto de venta y número; se completa con ceros). No puede repetirse para el mismo emisor en otra rendición abierta, de este cliente o de otro.`}
          error={errors.numeroFactura}
        >
          <Input
            autoComplete="off"
            {...register('numeroFactura')}
            {...describirCampo(idDe('numeroFactura'), errors.numeroFactura, { hint: true })}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingText="Abriendo…"
          success={exito}
          successText="Abierta"
          className="min-w-40"
        >
          Abrir rendición
        </LoadingButton>
      </div>
    </form>
  );
}
