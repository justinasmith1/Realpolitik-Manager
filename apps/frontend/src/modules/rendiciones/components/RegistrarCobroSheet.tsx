import {
  hoyEnBuenosAires,
  type RegistrarCobroDto,
  type RendicionDetalle,
} from '@realpolitik/shared';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';

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
import { Textarea } from '@/components/ui/textarea';
import { enfocarYMostrar } from '@/lib/focus';
import { interpretarFalloCobro } from '@/modules/rendiciones/api/rendiciones.api';
import {
  mensajeFalloCobro,
  type ErroresDeCobro,
} from '@/modules/rendiciones/components/erroresDeRendicion';
import {
  ordenDeCamposCobro,
  registrarCobroResolver,
  valoresInicialesCobro,
  type CampoCobro,
  type RegistrarCobroFormValues,
} from '@/modules/rendiciones/components/registrarCobroForm.validation';
import { useRegistrarCobro } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  AVISO_COBRO_GUARDADO,
  AYUDA_NOTA_COBRO,
  DESCRIPCION_COBRO_SHEET,
  ETIQUETA_FECHA_COBRO,
  ETIQUETA_NOTA_COBRO,
  etiquetaDePeriodo,
  TEXTO_GUARDAR_COBRO,
  TEXTO_QUITAR_MARCA,
  TITULO_COBRO_SHEET,
} from '@/modules/rendiciones/rendiciones.etiquetas';

interface RegistrarCobroSheetProps {
  rendicion: RendicionDetalle;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** Se guardó: quien abre la hoja la cierra y avisa. */
  onGuardada: (texto: string) => void;
  /**
   * Quitar la marca, al corregir un cobro ya registrado. La hoja no confirma ni borra: lo pide a
   * quien la abrió, que muestra la confirmación. Sin esto, el botón no se ofrece.
   */
  onQuitar?: () => void;
}

/**
 * Hoja para registrar o corregir el cobro que el cliente informó (HU3.10): la fecha en que avisó
 * (obligatoria, hoy por defecto, no posterior a hoy) y una nota opcional. Reemplaza el cobro
 * entero. No se cierra mientras guarda: el resultado tiene que verse.
 */
export function RegistrarCobroSheet({
  rendicion,
  abierto,
  onAbiertoChange,
  onGuardada,
  onQuitar,
}: RegistrarCobroSheetProps) {
  // Una sola mutación, la de la hoja: el freno de cierre mira el mismo guardado que hace el form.
  const registro = useRegistrarCobro();

  async function guardar(datos: RegistrarCobroDto): Promise<ErroresDeCobro | undefined> {
    try {
      await registro.mutateAsync({
        clienteId: rendicion.clienteId,
        rendicionId: rendicion.id,
        datos,
      });
    } catch (fallo) {
      return mensajeFalloCobro(interpretarFalloCobro(fallo));
    }
    onGuardada(AVISO_COBRO_GUARDADO);
    return undefined;
  }

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrirHoja) => {
        // Mientras se guarda no se cierra: el resultado tiene que verse.
        if (!abrirHoja && registro.isPending) return;
        onAbiertoChange(abrirHoja);
      }}
    >
      <SheetContent className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{TITULO_COBRO_SHEET}</SheetTitle>
          <SheetDescription>
            Rendición {etiquetaDePeriodo(rendicion)} · factura {rendicion.numeroFactura}.{' '}
            {DESCRIPCION_COBRO_SHEET}
          </SheetDescription>
        </SheetHeader>
        <RegistrarCobroForm
          rendicion={rendicion}
          onSubmit={guardar}
          onCancel={() => onAbiertoChange(false)}
          {...(onQuitar !== undefined && rendicion.cobro !== null && { onQuitar })}
        />
      </SheetContent>
    </Sheet>
  );
}

interface RegistrarCobroFormProps {
  rendicion: RendicionDetalle;
  /** Guarda el cobro. Devuelve los errores a mostrar, o `undefined` si salió bien. */
  onSubmit: (datos: RegistrarCobroDto) => Promise<ErroresDeCobro | undefined>;
  onCancel: () => void;
  onQuitar?: () => void;
}

function RegistrarCobroForm({ rendicion, onSubmit, onCancel, onQuitar }: RegistrarCobroFormProps) {
  const id = useId();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const { register, handleSubmit, setError, formState } = useForm<
    RegistrarCobroFormValues,
    unknown,
    RegistrarCobroDto
  >({
    defaultValues: valoresInicialesCobro(rendicion.cobro),
    resolver: registrarCobroResolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { errors, isSubmitting } = formState;

  const idDe = (campo: CampoCobro) => `${id}-${campo}`;

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) return;
      for (const [campo, message] of Object.entries(errores.campos ?? {}) as [
        CampoCobro,
        string,
      ][]) {
        setError(campo, { type: 'server', message });
        enfocarYMostrar(document.getElementById(idDe(campo)));
      }
      setErrorGeneral(errores.general ?? null);
    },
    (invalidos) => {
      const primero = ordenDeCamposCobro.find((campo) => invalidos[campo] !== undefined);
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
        <FormField id={idDe('fecha')} label={ETIQUETA_FECHA_COBRO} error={errors.fecha}>
          <Input
            type="date"
            // Hoy se lee al abrir la hoja, no al importar el módulo. Sin fecha mínima.
            max={hoyEnBuenosAires()}
            {...register('fecha')}
            {...describirCampo(idDe('fecha'), errors.fecha)}
          />
        </FormField>
        <FormField
          id={idDe('nota')}
          label={ETIQUETA_NOTA_COBRO}
          optional
          hint={AYUDA_NOTA_COBRO}
          error={errors.nota}
        >
          <Textarea
            autoComplete="off"
            rows={3}
            className="min-h-20"
            {...register('nota')}
            {...describirCampo(idDe('nota'), errors.nota, { hint: true, required: false })}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-between gap-2 border-t bg-panel-alt px-5 py-4">
        <div>
          {onQuitar !== undefined && (
            <Button type="button" variant="ghost" onClick={onQuitar} disabled={isSubmitting}>
              {TEXTO_QUITAR_MARCA}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
          <LoadingButton
            type="submit"
            loading={isSubmitting}
            loadingText="Guardando…"
            className="min-w-32"
          >
            {TEXTO_GUARDAR_COBRO}
          </LoadingButton>
        </div>
      </div>
    </form>
  );
}
