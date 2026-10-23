import { CANTIDAD_MAX, type CanalEntregaType, type TipoDocumento } from '@realpolitik/shared';
import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldError } from 'react-hook-form';
import { Link } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { enfocarYMostrar } from '@/lib/focus';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import type { ErroresDeEnvio } from '@/modules/clientes/components/erroresDeRequisito';
import {
  diasTrasCambiarCantidad,
  esCanalDeFormulario,
  incompatibilidadDeDias,
  indicarDias,
  mensajeDeDia,
  quitarDiasSobrantes,
  resolverRequisito,
  valoresEquivalentes,
  type CampoRequisito,
  type RequisitoFormValues,
  type RequisitoNormalizado,
} from '@/modules/clientes/components/requisitoForm.validation';

/** Qué se puede elegir como tipo. `oculto` es la edición: el tipo no se cambia. */
export type EstadoCatalogo =
  'oculto' | 'cargando' | 'error' | 'sin-activos' | 'todos-asignados' | 'listo';

interface RequisitoFormProps {
  modo: 'alta' | 'edicion';
  valoresIniciales: RequisitoFormValues;
  estadoTipos: EstadoCatalogo;
  tiposDisponibles: readonly Pick<TipoDocumento, 'id' | 'nombre'>[];
  onReintentarTipos?: () => void;
  canalDelCliente: CanalEntregaType;
  /** En la edición, el tipo se muestra y no se elige. También si está desactivado. */
  tipoLectura?: { nombre: string; activo: boolean } | null;
  onSubmit: (datos: RequisitoNormalizado) => Promise<ErroresDeEnvio | undefined>;
  onCancel: () => void;
  onDirtyChange: (sucio: boolean) => void;
  textoEnviar: string;
  textoEnviando?: string;
  exito?: boolean;
  envioBloqueado?: boolean;
  /** Aviso de solo lectura (cliente inactivo). No se muestra como error. */
  avisoEstado?: string | null;
}

const ORDEN: readonly CampoRequisito[] = ['tipoDocumentoId', 'cantidad', 'dias', 'canal', 'nota'];

const AYUDA_DIAS =
  'Son orientativos y no generan alertas. Podés dejarlos vacíos o cargar uno por cada documento. Se pueden repetir y se guardan ordenados.';

function textoDeErrorDias(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const nodo = error as { message?: unknown; root?: { message?: unknown } };
  if (typeof nodo.message === 'string') return nodo.message;
  if (typeof nodo.root?.message === 'string') return nodo.root.message;
  return null;
}

function textoDeDia(error: unknown, indice: number): string | undefined {
  if (Array.isArray(error)) {
    const item = error[indice] as { message?: string } | undefined;
    return item?.message;
  }
  if (error && typeof error === 'object') {
    const item = (error as Record<number, { message?: string } | undefined>)[indice];
    return item?.message;
  }
  return undefined;
}

function SelectCampo({
  nombre,
  control,
  id,
  error,
  options,
  placeholder,
  hint,
}: {
  nombre: 'tipoDocumentoId' | 'canal';
  control: Control<RequisitoFormValues, unknown, RequisitoNormalizado>;
  id: string;
  error: FieldError | undefined;
  options: readonly SelectOption[];
  placeholder?: string;
  hint?: boolean;
}) {
  return (
    <Controller
      name={nombre}
      control={control}
      render={({ field }) => {
        const { 'aria-invalid': invalido, ...descripcion } = describirCampo(id, error, {
          hint,
          required: nombre === 'tipoDocumentoId',
        });
        return (
          <Select
            {...descripcion}
            invalid={invalido === true}
            value={field.value}
            onValueChange={(valor) =>
              field.onChange(nombre === 'canal' && !esCanalDeFormulario(valor) ? '' : valor)
            }
            onBlur={field.onBlur}
            triggerRef={field.ref}
            options={options}
            {...(placeholder === undefined ? {} : { placeholder })}
          />
        );
      }}
    />
  );
}

/**
 * Alta y edición de un requisito. La edición no cambia el tipo. Los días son un campo por
 * documento, dentro de una lista con scroll: bajar la cantidad no los borra.
 */
export function RequisitoForm({
  modo,
  valoresIniciales,
  estadoTipos,
  tiposDisponibles,
  onReintentarTipos,
  canalDelCliente,
  tipoLectura = null,
  onSubmit,
  onCancel,
  onDirtyChange,
  textoEnviar,
  textoEnviando = 'Guardando…',
  exito = false,
  envioBloqueado = false,
  avisoEstado = null,
}: RequisitoFormProps) {
  const id = useId();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [avisoLocal, setAvisoLocal] = useState<string | null>(null);
  const [bloqueadoLocal, setBloqueadoLocal] = useState(false);
  const resolver = useMemo(() => resolverRequisito(modo === 'alta'), [modo]);
  const formulario = useForm<RequisitoFormValues, unknown, RequisitoNormalizado>({
    defaultValues: valoresIniciales,
    resolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { control, register, handleSubmit, getValues, setValue, setError, clearErrors, trigger } =
    formulario;
  const { errors, isSubmitting, submitCount } = formulario.formState;
  const cantidad = useWatch({ control, name: 'cantidad' });
  const diasObservados = useWatch({ control, name: 'dias' });
  const dias = useMemo(() => diasObservados ?? [], [diasObservados]);
  const tipoDocumentoId = useWatch({ control, name: 'tipoDocumentoId' });
  const canal = useWatch({ control, name: 'canal' });
  const nota = useWatch({ control, name: 'nota' });
  const actuales: RequisitoFormValues = { tipoDocumentoId, cantidad, dias, canal, nota };
  const sinCambios = modo === 'edicion' && valoresEquivalentes(actuales, valoresIniciales);
  const altaSinOpciones = modo === 'alta' && estadoTipos !== 'listo';
  const bloqueado = envioBloqueado || bloqueadoLocal;
  const aviso = avisoEstado ?? avisoLocal;
  const mensajeDias =
    textoDeErrorDias(errors.dias) ??
    (submitCount === 0 ? incompatibilidadDeDias(actuales, false) : null);
  const cantidadValida = indicarDias(cantidad) !== null;
  const sobran = cantidadValida && dias.length > (indicarDias(cantidad)?.length ?? 0);

  useEffect(() => {
    onDirtyChange(
      !valoresEquivalentes({ tipoDocumentoId, cantidad, dias, canal, nota }, valoresIniciales),
    );
  }, [tipoDocumentoId, cantidad, dias, canal, nota, valoresIniciales, onDirtyChange]);

  useEffect(() => {
    if (modo === 'alta' && estadoTipos !== 'listo') return;
    const campo = modo === 'alta' ? 'tipo' : 'cantidad';
    const frame = requestAnimationFrame(() => {
      enfocarYMostrar(document.getElementById(`${id}-${campo}`));
    });
    return () => cancelAnimationFrame(frame);
  }, [modo, estadoTipos, id]);

  function idDe(campo: string) {
    return `${id}-${campo}`;
  }

  function enfocarCampo(campo: CampoRequisito, indice?: number) {
    if (campo === 'dias') {
      const dia = document.getElementById(idDe(`dia-${indice ?? 0}`));
      enfocarYMostrar(dia ?? document.getElementById(idDe('indicar')));
      return;
    }
    const mapa = {
      tipoDocumentoId: 'tipo',
      cantidad: 'cantidad',
      canal: 'canal',
      nota: 'nota',
    } as const;
    enfocarYMostrar(document.getElementById(idDe(mapa[campo])));
  }

  function enfocarPrimerError(conError: Partial<Record<CampoRequisito, unknown>>, indice?: number) {
    const primero = ORDEN.find((campo) => conError[campo] !== undefined);
    if (primero !== undefined) enfocarCampo(primero, indice);
  }

  const validarAlSalir = (campo: 'cantidad' | 'nota') => {
    if (submitCount > 0) return;
    if (getValues(campo).trim() === '') {
      clearErrors(campo);
      return;
    }
    void trigger(campo);
  };

  function empezarDias() {
    const siguientes = indicarDias(getValues('cantidad'));
    if (siguientes === null) {
      void trigger('cantidad');
      enfocarYMostrar(document.getElementById(idDe('cantidad')));
      return;
    }
    setValue('dias', siguientes, { shouldDirty: true });
    requestAnimationFrame(() => enfocarYMostrar(document.getElementById(idDe('dia-0'))));
  }

  function limpiarDias() {
    setValue('dias', [], { shouldDirty: true, shouldValidate: submitCount > 0 });
    clearErrors('dias');
    requestAnimationFrame(() => enfocarYMostrar(document.getElementById(idDe('indicar'))));
  }

  function quitarSobrantes() {
    setValue('dias', quitarDiasSobrantes(getValues('dias'), getValues('cantidad')), {
      shouldDirty: true,
      shouldValidate: submitCount > 0,
    });
  }

  const registroCantidad = register('cantidad');
  const registroNota = register('nota');

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      setAvisoLocal(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) return;
      if (errores.bloqueaEnvio) setBloqueadoLocal(true);
      if (errores.aviso !== undefined) setAvisoLocal(errores.aviso);
      const campos = errores.campos ?? {};
      for (const [nombre, message] of Object.entries(campos) as [CampoRequisito, string][]) {
        if (nombre === 'dias') setError('dias', { type: 'server', message });
        else setError(nombre, { type: 'server', message });
      }
      let primerIndice: number | undefined;
      for (const [indice, message] of Object.entries(errores.diasPorIndice ?? {})) {
        const posicion = Number(indice);
        primerIndice ??= posicion;
        setError(`dias.${posicion}` as 'dias.0', { type: 'server', message });
      }
      enfocarPrimerError(
        {
          ...campos,
          ...(errores.diasPorIndice !== undefined ? { dias: true } : {}),
        },
        primerIndice,
      );
      setErrorGeneral(errores.general ?? null);
    },
    (invalidos) => {
      const indice = dias.findIndex((_, i) => textoDeDia(invalidos.dias, i) !== undefined);
      enfocarPrimerError(invalidos, indice === -1 ? undefined : indice);
    },
  );

  const opcionesTipo: SelectOption[] = tiposDisponibles.map((tipo) => ({
    value: tipo.id,
    label: tipo.nombre,
  }));
  const canalOpciones: SelectOption[] = [
    {
      value: '',
      label: `Usar canal principal del cliente (${etiquetasCanalEntrega[canalDelCliente]})`,
    },
    ...(Object.keys(etiquetasCanalEntrega) as CanalEntregaType[]).map((valor) => ({
      value: valor,
      label: etiquetasCanalEntrega[valor],
    })),
  ];

  const avisoGeneral = errorGeneral ?? errors.root?.message ?? null;
  const motivoDeshabilitado = sinCambios ? `${id}-sin-cambios` : undefined;
  const idAyudaDias = `${id}-dias-ayuda`;
  const idErrorDias = `${id}-dias-error`;

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {aviso !== null && (
        <div className="px-5 pt-4">
          <p
            role="status"
            className="flex items-start gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5 text-sm text-foreground"
          >
            <CircleAlertIcon aria-hidden="true" className="mt-px size-4 shrink-0 text-warning" />
            {aviso}
          </p>
        </div>
      )}
      {avisoGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert>{avisoGeneral}</Alert>
        </div>
      )}

      <fieldset
        disabled={isSubmitting || exito}
        className="m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0"
      >
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          {modo === 'edicion' && tipoLectura !== null ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Tipo de documento</span>
              <p className="flex flex-wrap items-center gap-2 text-sm break-words">
                <span className="font-medium">{tipoLectura.nombre}</span>
                {tipoLectura.activo ? null : <Badge tone="muted">Desactivado</Badge>}
              </p>
              <p className="text-xs text-muted-foreground">
                El tipo no se cambia. Para usar otro, quitá este requisito y agregá uno nuevo.
              </p>
            </div>
          ) : (
            <CatalogoDeTipos
              id={idDe('tipo')}
              estado={estadoTipos}
              error={errors.tipoDocumentoId}
              control={control}
              opciones={opcionesTipo}
              onReintentar={onReintentarTipos}
            />
          )}

          <FormField
            id={idDe('cantidad')}
            label="Cantidad requerida"
            hint={`Entero de 1 a ${CANTIDAD_MAX}.`}
            error={errors.cantidad}
          >
            <Input
              inputMode="numeric"
              autoComplete="off"
              {...registroCantidad}
              onChange={(evento) => {
                void registroCantidad.onChange(evento);
                setValue('dias', diasTrasCambiarCantidad(getValues('dias'), evento.target.value), {
                  shouldDirty: true,
                  shouldValidate: submitCount > 0,
                });
              }}
              onBlur={(evento) => {
                void registroCantidad.onBlur(evento);
                validarAlSalir('cantidad');
              }}
              {...describirCampo(idDe('cantidad'), errors.cantidad, { hint: true })}
            />
          </FormField>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <span id={`${id}-dias-titulo`} className="text-sm font-medium text-foreground">
                Días aproximados
              </span>
              <span className="text-xs text-muted-foreground">Opcional</span>
            </div>
            <p id={idAyudaDias} className="text-xs text-muted-foreground">
              {AYUDA_DIAS}
            </p>
            {dias.length === 0 ? (
              <Button
                type="button"
                id={idDe('indicar')}
                variant="outline"
                className="w-fit"
                onClick={empezarDias}
              >
                Indicar días aproximados
              </Button>
            ) : (
              <>
                <div
                  role="group"
                  aria-labelledby={`${id}-dias-titulo`}
                  aria-describedby={[idAyudaDias, mensajeDias !== null ? idErrorDias : null]
                    .filter(Boolean)
                    .join(' ')}
                  className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto rounded-lg border p-2 sm:grid-cols-4"
                >
                  {dias.map((valor, indice) => {
                    const errorDia = textoDeDia(errors.dias, indice);
                    const inputId = idDe(`dia-${indice}`);
                    return (
                      <div key={inputId} className="flex min-w-0 flex-col gap-1">
                        <label htmlFor={inputId} className="text-xs text-content-secondary">
                          Día {indice + 1}
                        </label>
                        <Input
                          id={inputId}
                          inputMode="numeric"
                          autoComplete="off"
                          value={valor}
                          aria-invalid={errorDia !== undefined || undefined}
                          aria-describedby={errorDia !== undefined ? `${inputId}-error` : undefined}
                          className="px-2 text-center"
                          onFocus={(evento) => {
                            evento.currentTarget.scrollIntoView?.({ block: 'nearest' });
                          }}
                          onChange={(evento) => {
                            const copia = [...getValues('dias')];
                            copia[indice] = evento.target.value;
                            setValue('dias', copia, {
                              shouldDirty: true,
                              shouldValidate: submitCount > 0,
                            });
                          }}
                          onBlur={() => {
                            if (submitCount > 0) return;
                            const message = mensajeDeDia(getValues('dias')[indice] ?? '');
                            if (message !== null) {
                              setError(`dias.${indice}` as 'dias.0', { type: 'validate', message });
                            } else {
                              clearErrors(`dias.${indice}` as 'dias.0');
                            }
                          }}
                        />
                        {errorDia !== undefined && (
                          <p
                            id={`${inputId}-error`}
                            className="text-[13px] leading-snug text-destructive"
                          >
                            {errorDia}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-content-secondary">
                  {dias.filter((dia) => dia.trim() !== '').length} de {dias.length} días completos
                </p>
                <div className="flex flex-wrap gap-2">
                  {sobran && (
                    <Button type="button" variant="outline" onClick={quitarSobrantes}>
                      Quitar los días que sobran
                    </Button>
                  )}
                  <Button type="button" variant="outline" onClick={limpiarDias}>
                    Limpiar todos los días
                  </Button>
                </div>
              </>
            )}
            {mensajeDias !== null && (
              <p
                id={idErrorDias}
                className="flex items-start gap-1.5 text-[13px] leading-snug text-destructive"
              >
                <CircleAlertIcon aria-hidden="true" className="mt-px size-3.5 shrink-0" />
                {mensajeDias}
              </p>
            )}
          </div>

          <FormField
            id={idDe('canal')}
            label="Canal de entrega"
            hint={`El canal principal de este cliente es ${etiquetasCanalEntrega[canalDelCliente]}.`}
            error={errors.canal}
          >
            <SelectCampo
              nombre="canal"
              control={control}
              id={idDe('canal')}
              error={errors.canal}
              options={canalOpciones}
              hint
            />
          </FormField>

          <FormField id={idDe('nota')} label="Nota" error={errors.nota} optional>
            <Input
              autoComplete="off"
              {...registroNota}
              onBlur={(evento) => {
                void registroNota.onBlur(evento);
                validarAlSalir('nota');
              }}
              {...describirCampo(idDe('nota'), errors.nota, { required: false })}
            />
          </FormField>
        </div>
      </fieldset>

      <div className="flex items-center justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        {sinCambios && (
          <p id={`${id}-sin-cambios`} className="mr-auto text-xs text-muted-foreground">
            Sin cambios para guardar.
          </p>
        )}
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting || exito}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingText={textoEnviando}
          success={exito}
          successText="Guardado"
          disabled={sinCambios || bloqueado || altaSinOpciones}
          aria-describedby={motivoDeshabilitado}
          className="min-w-40"
        >
          {textoEnviar}
        </LoadingButton>
      </div>
    </form>
  );
}

function CatalogoDeTipos({
  id,
  estado,
  error,
  control,
  opciones,
  onReintentar,
}: {
  id: string;
  estado: EstadoCatalogo;
  error: FieldError | undefined;
  control: Control<RequisitoFormValues, unknown, RequisitoNormalizado>;
  opciones: readonly SelectOption[];
  onReintentar?: (() => void) | undefined;
}) {
  if (estado === 'cargando') {
    return (
      <p role="status" className="text-sm text-content-secondary">
        Cargando tipos de documento…
      </p>
    );
  }
  if (estado === 'error') {
    return (
      <div className="flex flex-col items-start gap-2">
        <Alert>No pudimos cargar los tipos de documento.</Alert>
        {onReintentar !== undefined && (
          <Button type="button" variant="outline" onClick={onReintentar}>
            Reintentar
          </Button>
        )}
      </div>
    );
  }
  if (estado === 'sin-activos') {
    return (
      <div className="flex flex-col items-start gap-2 text-sm">
        <p>No hay tipos de documento activos para agregar.</p>
        <Link
          to="/clientes/tipos-documento"
          className="rounded-chip font-medium text-foreground underline outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          Ir al catálogo de tipos de documento
        </Link>
        {error?.message !== undefined && <p className="text-destructive">{error.message}</p>}
      </div>
    );
  }
  if (estado === 'todos-asignados') {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-sm text-content-secondary">
          Todos los tipos activos ya están en esta matriz.
        </p>
        {error?.message !== undefined && (
          <p className="text-[13px] leading-snug text-destructive">{error.message}</p>
        )}
      </div>
    );
  }
  return (
    <FormField id={id} label="Tipo de documento" error={error}>
      <SelectCampo
        nombre="tipoDocumentoId"
        control={control}
        id={id}
        error={error}
        options={opciones}
        placeholder="Elegí el tipo de documento"
      />
    </FormField>
  );
}
