import {
  CanalEntrega,
  ClienteSector,
  ClienteSubtipoPublico,
  IvaCondicion,
} from '@realpolitik/shared';
import { useId, useState, type ReactNode } from 'react';
import { useForm, useWatch, type FieldError } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import type { NuevoCliente } from '@/modules/clientes/api/clientes.api';
import {
  etiquetasCanalEntrega,
  etiquetasIvaCondicion,
  etiquetasSector,
  etiquetasSubtipo,
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

interface CampoProps {
  id: string;
  etiqueta: string;
  ayuda?: string;
  error: FieldError | undefined;
  children: ReactNode;
}

/** Etiqueta, control, ayuda y error de un campo. Los ids los arma `describirCampo`. */
function Campo({ id, etiqueta, ayuda, error, children }: CampoProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {etiqueta}
      </label>
      {children}
      {ayuda !== undefined && (
        <p id={`${id}-ayuda`} className="text-xs text-muted-foreground">
          {ayuda}
        </p>
      )}
      {error?.message !== undefined && (
        <p id={`${id}-error`} className="text-[13px] text-destructive">
          {error.message}
        </p>
      )}
    </div>
  );
}

/** Atributos de accesibilidad que conectan el control con su ayuda y su error. */
function describirCampo(id: string, error: FieldError | undefined, conAyuda = false) {
  const descripciones = [conAyuda && `${id}-ayuda`, error && `${id}-error`].filter(Boolean);
  return {
    id,
    required: true,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': descripciones.length > 0 ? descripciones.join(' ') : undefined,
  };
}

/**
 * Formulario de los datos de un cliente (HU1.1). Valida con las reglas de shared antes de
 * enviar y muestra en cada campo los errores propios y los que devuelva el servidor.
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
    setValue,
    clearErrors,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClienteFormValues, unknown, NuevoCliente>({
    defaultValues: valoresIniciales,
    resolver: clienteFormResolver,
    mode: 'onTouched',
  });
  const sector = useWatch({ control, name: 'sector' });
  const canalEntrega = useWatch({ control, name: 'canalEntrega' });

  const enviar = handleSubmit(async (datos) => {
    setErrorGeneral(null);
    const errores = await onSubmit(datos);
    if (errores === undefined) {
      return;
    }
    const conError = Object.entries(errores.campos ?? {}) as [CampoClienteForm, string][];
    conError.forEach(([campo, message], indice) => {
      setError(campo, { type: 'server', message }, { shouldFocus: indice === 0 });
    });
    setErrorGeneral(errores.general ?? null);
  });

  const idDe = (campo: CampoClienteForm) => `${id}-${campo}`;
  const avisoGeneral = errorGeneral ?? errors.root?.message ?? null;

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        <Campo id={idDe('razonSocial')} etiqueta="Razón social" error={errors.razonSocial}>
          <Input
            autoComplete="organization"
            {...register('razonSocial')}
            {...describirCampo(idDe('razonSocial'), errors.razonSocial)}
          />
        </Campo>

        <Campo
          id={idDe('denominacion')}
          etiqueta="Denominación"
          ayuda="Nombre corto para reconocerlo en pantalla."
          error={errors.denominacion}
        >
          <Input
            autoComplete="off"
            {...register('denominacion')}
            {...describirCampo(idDe('denominacion'), errors.denominacion, true)}
          />
        </Campo>

        <Campo id={idDe('cuit')} etiqueta="CUIT" ayuda="Con o sin guiones." error={errors.cuit}>
          <Input
            inputMode="numeric"
            autoComplete="off"
            {...register('cuit')}
            {...describirCampo(idDe('cuit'), errors.cuit, true)}
          />
        </Campo>

        <Campo id={idDe('sector')} etiqueta="Sector" error={errors.sector}>
          <NativeSelect
            {...register('sector', {
              // Un subtipo elegido para un público no puede quedar guardado si pasa a privado.
              onChange: () => {
                setValue('subtipo', '');
                clearErrors('subtipo');
              },
            })}
            {...describirCampo(idDe('sector'), errors.sector)}
          >
            <option value="" disabled>
              Elegí el sector
            </option>
            {ClienteSector.options.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetasSector[valor]}
              </option>
            ))}
          </NativeSelect>
        </Campo>

        {sector === 'PUBLICO' && (
          <Campo id={idDe('subtipo')} etiqueta="Subtipo público" error={errors.subtipo}>
            <NativeSelect
              {...register('subtipo')}
              {...describirCampo(idDe('subtipo'), errors.subtipo)}
            >
              <option value="" disabled>
                Elegí el subtipo
              </option>
              {ClienteSubtipoPublico.options.map((valor) => (
                <option key={valor} value={valor}>
                  {etiquetasSubtipo[valor]}
                </option>
              ))}
            </NativeSelect>
          </Campo>
        )}

        <Campo
          id={idDe('ivaCondicion')}
          etiqueta="Condición frente al IVA"
          error={errors.ivaCondicion}
        >
          <NativeSelect
            {...register('ivaCondicion')}
            {...describirCampo(idDe('ivaCondicion'), errors.ivaCondicion)}
          >
            <option value="" disabled>
              Elegí la condición
            </option>
            {IvaCondicion.options.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetasIvaCondicion[valor]}
              </option>
            ))}
          </NativeSelect>
        </Campo>

        <Campo id={idDe('emailContacto')} etiqueta="Email de contacto" error={errors.emailContacto}>
          <Input
            type="email"
            autoComplete="email"
            {...register('emailContacto')}
            {...describirCampo(idDe('emailContacto'), errors.emailContacto)}
          />
        </Campo>

        {/* ─── Canal de entrega ─── */}
        <Campo
          id={idDe('canalEntrega')}
          etiqueta="Canal de entrega"
          ayuda="Por dónde se envían habitualmente las rendiciones."
          error={errors.canalEntrega}
        >
          <NativeSelect
            {...register('canalEntrega', {
              // Igual que sector/subtipo: el dato del canal anterior no debe quedar guardado
              // ni mostrar un error de un campo que ya no está en pantalla.
              onChange: () => {
                setValue('portalUrl', '');
                setValue('whatsappNumero', '');
                clearErrors(['portalUrl', 'whatsappNumero']);
              },
            })}
            {...describirCampo(idDe('canalEntrega'), errors.canalEntrega, true)}
          >
            {CanalEntrega.options.map((valor) => (
              <option key={valor} value={valor}>
                {etiquetasCanalEntrega[valor]}
              </option>
            ))}
          </NativeSelect>
        </Campo>

        {canalEntrega === 'PORTAL_WEB' && (
          <Campo
            id={idDe('portalUrl')}
            etiqueta="URL del portal"
            ayuda="Dirección completa, con https://"
            error={errors.portalUrl}
          >
            <Input
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://portal.ejemplo.gob.ar"
              {...register('portalUrl')}
              {...describirCampo(idDe('portalUrl'), errors.portalUrl, true)}
            />
          </Campo>
        )}

        {canalEntrega === 'WHATSAPP' && (
          <Campo
            id={idDe('whatsappNumero')}
            etiqueta="Número de WhatsApp"
            ayuda="Con código de país, p. ej. +54 9 351 123 4567."
            error={errors.whatsappNumero}
          >
            <Input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              {...register('whatsappNumero')}
              {...describirCampo(idDe('whatsappNumero'), errors.whatsappNumero, true)}
            />
          </Campo>
        )}

        {avisoGeneral !== null && (
          <p
            role="alert"
            className="rounded-control border border-destructive-border bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {avisoGeneral}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : textoEnviar}
        </Button>
      </div>
    </form>
  );
}
