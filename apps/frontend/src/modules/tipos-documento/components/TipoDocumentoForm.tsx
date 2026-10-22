import type { CreateTipoDocumentoDto } from '@realpolitik/shared';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { enfocarYMostrar } from '@/lib/focus';
import type { ErroresDeEnvio } from '@/modules/tipos-documento/components/erroresDeTipoDocumento';
import {
  sinCambiosRespectoDe,
  tipoDocumentoFormResolver,
  valoresInicialesTipoDocumentoForm,
  type CampoTipoDocumentoForm,
  type TipoDocumentoFormValues,
} from '@/modules/tipos-documento/components/tipoDocumentoForm.validation';

interface TipoDocumentoFormProps {
  /**
   * Recibe los datos ya validados y normalizados por shared. Devuelve los errores del servidor,
   * o nada si salió bien.
   */
  onSubmit: (datos: CreateTipoDocumentoDto) => Promise<ErroresDeEnvio | undefined>;
  onCancel: () => void;
  textoEnviar: string;
  /** Texto del botón mientras se envía. */
  textoEnviando?: string;
  /** Texto del botón mientras se confirma el éxito. */
  textoEnviado?: string;
  /** El envío salió bien y se está confirmando (ver `useExitoBreve`). */
  exito?: boolean;
  /** Datos con los que arranca. Sin ellos arranca vacío (alta). */
  valoresIniciales?: TipoDocumentoFormValues;
  /**
   * El envío solo tiene sentido si algo cambió (la edición): mientras el formulario siga igual a
   * `valoresIniciales`, el botón queda deshabilitado y se avisa por qué.
   */
  soloConCambios?: boolean;
  /**
   * Ya no se puede enviar (p. ej. el tipo dejó de existir): el botón queda deshabilitado y solo
   * se puede cancelar.
   */
  envioBloqueado?: boolean;
}

/** Campos en el orden en que aparecen: el primero con error es el que recibe el foco. */
const ordenDeCampos: readonly CampoTipoDocumentoForm[] = ['nombre', 'descripcion'];

/**
 * Formulario de un tipo de documento (nombre y descripción), para el alta y la edición. Valida con
 * las reglas de shared y muestra en cada campo los errores propios y los del servidor (p. ej. un
 * nombre que ya existe).
 *
 * Validación progresiva, como el formulario de clientes:
 * - Antes del primer envío no se marca un campo vacío solo por pasar por él; uno con contenido
 *   se valida al salir.
 * - Al enviar se muestran todos los errores y el foco va al primero.
 * - Después de un envío fallido se revalida en cada cambio: el error (también el del servidor)
 *   desaparece apenas el valor es válido.
 */
export function TipoDocumentoForm({
  onSubmit,
  onCancel,
  textoEnviar,
  textoEnviando = 'Guardando…',
  textoEnviado = 'Guardado',
  exito = false,
  valoresIniciales = valoresInicialesTipoDocumentoForm,
  soloConCambios = false,
  envioBloqueado = false,
}: TipoDocumentoFormProps) {
  const id = useId();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const formulario = useForm<TipoDocumentoFormValues, unknown, CreateTipoDocumentoDto>({
    defaultValues: valoresIniciales,
    resolver: tipoDocumentoFormResolver,
    // Nada se valida hasta el primer envío (salvo al salir de un campo con contenido); después,
    // en cada cambio. El foco al error lo maneja `enfocarPrimerError`.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { control, register, handleSubmit, getValues, clearErrors, setError, trigger } = formulario;
  const { errors, isSubmitting, submitCount } = formulario.formState;
  const nombre = useWatch({ control, name: 'nombre' });
  const descripcion = useWatch({ control, name: 'descripcion' });
  const sinCambios =
    soloConCambios && sinCambiosRespectoDe({ nombre, descripcion }, valoresIniciales);

  const idDe = (campo: CampoTipoDocumentoForm) => `${id}-${campo}`;

  const enfocarPrimerError = (conError: Partial<Record<CampoTipoDocumentoForm, unknown>>) => {
    const primero = ordenDeCampos.find((campo) => conError[campo] !== undefined);
    if (primero !== undefined) {
      enfocarYMostrar(document.getElementById(idDe(primero)));
    }
  };

  // Al salir de un campo, antes del primer envío: lo vacío no se marca y lo que tiene contenido
  // se valida (p. ej. un nombre demasiado largo). Después del primer envío ya revalida RHF.
  const validarAlSalir = (campo: CampoTipoDocumentoForm) => {
    if (submitCount > 0) return;
    if (getValues(campo).trim() === '') {
      clearErrors(campo);
      return;
    }
    void trigger(campo);
  };

  const campo = (nombreDelCampo: CampoTipoDocumentoForm) =>
    register(nombreDelCampo, { onBlur: () => validarAlSalir(nombreDelCampo) });

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) {
        return;
      }
      const conError = Object.entries(errores.campos ?? {}) as [CampoTipoDocumentoForm, string][];
      for (const [nombreDelCampo, message] of conError) {
        setError(nombreDelCampo, { type: 'server', message });
      }
      enfocarPrimerError(errores.campos ?? {});
      setErrorGeneral(errores.general ?? null);
    },
    (invalidos) => enfocarPrimerError(invalidos),
  );

  const avisoGeneral = errorGeneral ?? errors.root?.message ?? null;
  const motivoDeshabilitado = sinCambios ? `${id}-sin-cambios` : undefined;

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Zona fija, fuera del área con scroll: el aviso se ve sin tener que buscarlo. */}
      {avisoGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert>{avisoGeneral}</Alert>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <FormField id={idDe('nombre')} label="Nombre" error={errors.nombre}>
          <Input
            autoComplete="off"
            placeholder="Ej. Constancia de inscripción"
            {...campo('nombre')}
            {...describirCampo(idDe('nombre'), errors.nombre)}
          />
        </FormField>

        <FormField id={idDe('descripcion')} label="Descripción" error={errors.descripcion} optional>
          <Input
            autoComplete="off"
            {...campo('descripcion')}
            {...describirCampo(idDe('descripcion'), errors.descripcion, { required: false })}
          />
        </FormField>
      </div>

      <div className="flex items-center justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        {sinCambios && (
          <p id={`${id}-sin-cambios`} className="mr-auto text-xs text-muted-foreground">
            Sin cambios para guardar.
          </p>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          // Durante el éxito `isSubmitting` sigue en true (el envío espera la confirmación);
          // `success` tiene prioridad sobre `loading`.
          loading={isSubmitting}
          loadingText={textoEnviando}
          success={exito}
          successText={textoEnviado}
          disabled={sinCambios || envioBloqueado}
          aria-describedby={motivoDeshabilitado}
          className="min-w-36"
        >
          {textoEnviar}
        </LoadingButton>
      </div>
    </form>
  );
}
