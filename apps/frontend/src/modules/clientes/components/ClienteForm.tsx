import {
  CanalEntrega,
  ClienteSector,
  ClienteSubtipoPublico,
  IvaCondicion,
  PeriodicidadTipo,
} from '@realpolitik/shared';
import { useId, useState } from 'react';
import { Controller, useForm, useWatch, type Control, type FieldError } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField, FormSection } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { enfocarYMostrar } from '@/lib/focus';
import type { NuevoCliente } from '@/modules/clientes/api/clientes.api';
import {
  etiquetasCanalEntrega,
  etiquetasIvaCondicion,
  etiquetasPeriodicidad,
  etiquetasSector,
  etiquetasSubtipo,
  nombresDeMes,
} from '@/modules/clientes/clientes.etiquetas';
import {
  clienteFormResolver,
  valoresInicialesClienteForm,
  type CampoClienteForm,
  type ClienteFormValues,
} from '@/modules/clientes/components/clienteForm.validation';

/** Errores que informó el servidor al enviar: por campo y/o uno general. */
export interface ErroresDeEnvio {
  campos?: Partial<Record<CampoClienteForm, string>>;
  general?: string;
}

interface ClienteFormProps {
  /** Recibe los datos ya validados. Devuelve los errores del servidor, o nada si salió bien. */
  onSubmit: (datos: NuevoCliente) => Promise<ErroresDeEnvio | undefined>;
  onCancel: () => void;
  textoEnviar: string;
  /** Datos con los que arranca el formulario. Sin ellos arranca vacío (alta). */
  valoresIniciales?: ClienteFormValues;
}

// Opciones de cada select, derivadas de los enums compartidos y sus etiquetas.
const opcionesSector: SelectOption[] = ClienteSector.options.map((valor) => ({
  value: valor,
  label: etiquetasSector[valor],
}));
const opcionesSubtipo: SelectOption[] = ClienteSubtipoPublico.options.map((valor) => ({
  value: valor,
  label: etiquetasSubtipo[valor],
}));
const opcionesIva: SelectOption[] = IvaCondicion.options.map((valor) => ({
  value: valor,
  label: etiquetasIvaCondicion[valor],
}));
const opcionesCanal: SelectOption[] = CanalEntrega.options.map((valor) => ({
  value: valor,
  label: etiquetasCanalEntrega[valor],
}));
const opcionesPeriodicidad: SelectOption[] = [
  { value: '', label: 'Sin configurar' },
  ...PeriodicidadTipo.options.map((valor) => ({
    value: valor,
    label: etiquetasPeriodicidad[valor],
  })),
];
const opcionesMes: SelectOption[] = nombresDeMes.map((nombre, indice) => ({
  value: String(indice + 1),
  label: nombre,
}));

/** Campos en el orden en que aparecen: el primero con error es el que recibe el foco. */
const ordenDeCampos: readonly CampoClienteForm[] = [
  'razonSocial',
  'denominacion',
  'cuit',
  'sector',
  'subtipo',
  'ivaCondicion',
  'emailContacto',
  'canalEntrega',
  'portalUrl',
  'whatsappNumero',
  'periodicidadTipo',
  'periodicidadDiaLimite',
  'periodicidadMesInicioCiclo',
];

// El CUIT tiene 11 dígitos: con esos ya hay información para evaluar el formato y el dígito
// verificador, así que se avisa mientras escribe y no recién al salir del campo.
const DIGITOS_DEL_CUIT = 11;

const soloDigitos = (texto: string) => texto.replace(/\D/g, '');

interface SelectCampoProps {
  nombre: Extract<
    CampoClienteForm,
    | 'sector'
    | 'subtipo'
    | 'ivaCondicion'
    | 'canalEntrega'
    | 'periodicidadTipo'
    | 'periodicidadMesInicioCiclo'
  >;
  control: Control<ClienteFormValues, unknown, NuevoCliente>;
  id: string;
  error: FieldError | undefined;
  options: readonly SelectOption[];
  placeholder?: string;
  hint?: boolean;
  required?: boolean;
  /** Se llama con el valor nuevo, además de actualizar el formulario. */
  onCambio?: (valor: string) => void;
}

/** Select de Base UI conectado al formulario: valor, foco al primer error y atributos de a11y. */
function SelectCampo({
  nombre,
  control,
  id,
  error,
  options,
  placeholder,
  hint,
  required,
  onCambio,
}: SelectCampoProps) {
  return (
    <Controller
      name={nombre}
      control={control}
      render={({ field }) => {
        const { 'aria-invalid': invalido, ...descripcion } = describirCampo(id, error, {
          hint,
          required,
        });
        return (
          <Select
            {...descripcion}
            invalid={invalido === true}
            value={field.value}
            onValueChange={(valor) => {
              field.onChange(valor);
              onCambio?.(valor);
            }}
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
 * Formulario de los datos de un cliente (HU1.1, HU1.4, HU1.5). Valida con las reglas de shared
 * y muestra en cada campo los errores propios y los que devuelva el servidor.
 *
 * Validación progresiva (shared/Zod sigue siendo la única fuente de verdad: el resolver):
 * - Antes del primer envío no se marca un campo obligatorio solo por pasar por él. Un campo con
 *   contenido se valida al salir; el CUIT, además, mientras se escribe cuando ya tiene los 11
 *   dígitos.
 * - Al primer envío se muestran todos los errores y el foco va al primer campo inválido.
 * - Después de un envío fallido, React Hook Form revalida en cada cambio: el error desaparece
 *   apenas el valor es válido.
 */
export function ClienteForm({
  onSubmit,
  onCancel,
  textoEnviar,
  valoresIniciales = valoresInicialesClienteForm,
}: ClienteFormProps) {
  const id = useId();
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const {
    control,
    register,
    handleSubmit,
    getValues,
    setValue,
    clearErrors,
    setError,
    trigger,
    formState: { errors, isSubmitting, submitCount },
  } = useForm<ClienteFormValues, unknown, NuevoCliente>({
    defaultValues: valoresIniciales,
    resolver: clienteFormResolver,
    // Nada se valida hasta el primer envío (salvo lo que se pide a mano, abajo); después,
    // en cada cambio. El foco al error lo maneja `enfocarPrimerError`.
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const sector = useWatch({ control, name: 'sector' });
  const canalEntrega = useWatch({ control, name: 'canalEntrega' });
  const periodicidadTipo = useWatch({ control, name: 'periodicidadTipo' });

  const idDe = (campo: CampoClienteForm) => `${id}-${campo}`;

  // Recibe los errores del resolver o los del servidor: solo importa qué campos tienen error.
  const enfocarPrimerError = (conError: Partial<Record<CampoClienteForm, unknown>>) => {
    const primero = ordenDeCampos.find((campo) => conError[campo] !== undefined);
    if (primero !== undefined) {
      enfocarYMostrar(document.getElementById(idDe(primero)));
    }
  };

  // Al salir de un campo, antes del primer envío: lo vacío no se marca (todavía no se intentó
  // enviar) y lo que tiene contenido se valida. Después del primer envío ya revalida RHF.
  const validarAlSalir = (campo: CampoClienteForm) => {
    if (submitCount > 0) return;
    const valor = getValues(campo);
    if (typeof valor === 'string' && valor.trim() === '') {
      clearErrors(campo);
      return;
    }
    void trigger(campo);
  };

  const validarCuitMientrasEscribe = (texto: string) => {
    if (submitCount > 0) return;
    if (soloDigitos(texto).length >= DIGITOS_DEL_CUIT) {
      void trigger('cuit');
    } else {
      clearErrors('cuit');
    }
  };

  const campo = (nombre: CampoClienteForm) =>
    register(nombre, { onBlur: () => validarAlSalir(nombre) });

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) {
        return;
      }
      const conError = Object.entries(errores.campos ?? {}) as [CampoClienteForm, string][];
      for (const [nombre, message] of conError) {
        setError(nombre, { type: 'server', message });
      }
      enfocarPrimerError(errores.campos ?? {});
      setErrorGeneral(errores.general ?? null);
    },
    (invalidos) => enfocarPrimerError(invalidos),
  );

  const avisoGeneral = errorGeneral ?? errors.root?.message ?? null;

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

      <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-5">
        <FormSection title="Identificación">
          <FormField id={idDe('razonSocial')} label="Razón social" error={errors.razonSocial}>
            <Input
              autoComplete="organization"
              {...campo('razonSocial')}
              {...describirCampo(idDe('razonSocial'), errors.razonSocial)}
            />
          </FormField>

          <FormField
            id={idDe('denominacion')}
            label="Denominación"
            hint="Nombre corto para reconocerlo en pantalla."
            error={errors.denominacion}
          >
            <Input
              autoComplete="off"
              {...campo('denominacion')}
              {...describirCampo(idDe('denominacion'), errors.denominacion, { hint: true })}
            />
          </FormField>
        </FormSection>

        <FormSection title="Datos fiscales">
          <FormField id={idDe('cuit')} label="CUIT" hint="Con o sin guiones." error={errors.cuit}>
            <Input
              inputMode="numeric"
              autoComplete="off"
              {...register('cuit', {
                onBlur: () => validarAlSalir('cuit'),
                onChange: (evento: { target: { value: string } }) =>
                  validarCuitMientrasEscribe(evento.target.value),
              })}
              {...describirCampo(idDe('cuit'), errors.cuit, { hint: true })}
            />
          </FormField>

          <div className={sector === 'PUBLICO' ? 'grid gap-4 sm:grid-cols-2' : 'grid gap-4'}>
            <FormField id={idDe('sector')} label="Sector" error={errors.sector}>
              <SelectCampo
                nombre="sector"
                control={control}
                id={idDe('sector')}
                error={errors.sector}
                options={opcionesSector}
                placeholder="Elegí el sector"
                // Un subtipo elegido para un público no puede quedar guardado si pasa a privado.
                onCambio={() => {
                  setValue('subtipo', '');
                  clearErrors('subtipo');
                }}
              />
            </FormField>

            {sector === 'PUBLICO' && (
              <FormField id={idDe('subtipo')} label="Subtipo público" error={errors.subtipo}>
                <SelectCampo
                  nombre="subtipo"
                  control={control}
                  id={idDe('subtipo')}
                  error={errors.subtipo}
                  options={opcionesSubtipo}
                  placeholder="Elegí el subtipo"
                />
              </FormField>
            )}
          </div>

          <FormField
            id={idDe('ivaCondicion')}
            label="Condición frente al IVA"
            error={errors.ivaCondicion}
          >
            <SelectCampo
              nombre="ivaCondicion"
              control={control}
              id={idDe('ivaCondicion')}
              error={errors.ivaCondicion}
              options={opcionesIva}
              placeholder="Elegí la condición"
            />
          </FormField>
        </FormSection>

        <FormSection title="Contacto">
          <FormField
            id={idDe('emailContacto')}
            label="Email de contacto"
            error={errors.emailContacto}
          >
            <Input
              type="email"
              autoComplete="email"
              {...campo('emailContacto')}
              {...describirCampo(idDe('emailContacto'), errors.emailContacto)}
            />
          </FormField>
        </FormSection>

        <FormSection title="Entrega de rendiciones">
          <FormField
            id={idDe('canalEntrega')}
            label="Canal de entrega"
            hint="Por dónde se envían habitualmente las rendiciones."
            error={errors.canalEntrega}
          >
            <SelectCampo
              nombre="canalEntrega"
              control={control}
              id={idDe('canalEntrega')}
              error={errors.canalEntrega}
              options={opcionesCanal}
              hint
              // Igual que sector/subtipo: el dato del canal anterior no debe quedar guardado
              // ni mostrar un error de un campo que ya no está en pantalla.
              onCambio={() => {
                setValue('portalUrl', '');
                setValue('whatsappNumero', '');
                clearErrors(['portalUrl', 'whatsappNumero']);
              }}
            />
          </FormField>

          {canalEntrega === 'PORTAL_WEB' && (
            <FormField
              id={idDe('portalUrl')}
              label="URL del portal"
              hint="Dirección completa, con https://"
              error={errors.portalUrl}
            >
              <Input
                type="url"
                inputMode="url"
                autoComplete="url"
                placeholder="https://portal.ejemplo.gob.ar"
                {...campo('portalUrl')}
                {...describirCampo(idDe('portalUrl'), errors.portalUrl, { hint: true })}
              />
            </FormField>
          )}

          {canalEntrega === 'WHATSAPP' && (
            <FormField
              id={idDe('whatsappNumero')}
              label="Número de WhatsApp"
              hint="Con código de país, p. ej. +54 9 351 123 4567."
              error={errors.whatsappNumero}
            >
              <Input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                {...campo('whatsappNumero')}
                {...describirCampo(idDe('whatsappNumero'), errors.whatsappNumero, { hint: true })}
              />
            </FormField>
          )}
        </FormSection>

        <FormSection title="Periodicidad de rendición">
          <FormField
            id={idDe('periodicidadTipo')}
            label="Periodicidad"
            optional
            hint="Cada cuánto se rinde. Podés configurarla más adelante."
            error={errors.periodicidadTipo}
          >
            <SelectCampo
              nombre="periodicidadTipo"
              control={control}
              id={idDe('periodicidadTipo')}
              error={errors.periodicidadTipo}
              options={opcionesPeriodicidad}
              hint
              required={false}
              // Igual que el canal: lo que el tipo nuevo no usa se descarta, y sus errores
              // no quedan colgados de un campo que ya no está en pantalla.
              onCambio={(tipo) => {
                if (tipo !== 'BIMESTRAL') {
                  setValue('periodicidadMesInicioCiclo', '');
                  clearErrors('periodicidadMesInicioCiclo');
                }
                if (tipo === '') {
                  setValue('periodicidadDiaLimite', '');
                  clearErrors('periodicidadDiaLimite');
                }
              }}
            />
          </FormField>

          {periodicidadTipo !== '' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                id={idDe('periodicidadDiaLimite')}
                label="Día límite"
                hint="Del 1 al 28, para que exista en todos los meses."
                error={errors.periodicidadDiaLimite}
              >
                <Input
                  inputMode="numeric"
                  autoComplete="off"
                  {...campo('periodicidadDiaLimite')}
                  {...describirCampo(idDe('periodicidadDiaLimite'), errors.periodicidadDiaLimite, {
                    hint: true,
                  })}
                />
              </FormField>

              {periodicidadTipo === 'BIMESTRAL' && (
                <FormField
                  id={idDe('periodicidadMesInicioCiclo')}
                  label="Mes de inicio del ciclo"
                  error={errors.periodicidadMesInicioCiclo}
                >
                  <SelectCampo
                    nombre="periodicidadMesInicioCiclo"
                    control={control}
                    id={idDe('periodicidadMesInicioCiclo')}
                    error={errors.periodicidadMesInicioCiclo}
                    options={opcionesMes}
                    placeholder="Elegí el mes"
                  />
                </FormField>
              )}
            </div>
          )}
        </FormSection>
      </div>

      <div className="flex justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingText="Guardando…"
          className="min-w-40"
        >
          {textoEnviar}
        </LoadingButton>
      </div>
    </form>
  );
}
