import { RolUsuario, type RolUsuarioType } from '@realpolitik/shared';
import { useId, useMemo, useState, type FormEvent } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { Select, type SelectOption } from '@/components/ui/select';
import { enfocarYMostrar } from '@/lib/focus';
import { ETIQUETA_DE_ROL } from '@/modules/auth/permisos';
import type { AvisoDeFallo, ErroresDeEnvio } from '@/modules/usuarios/components/erroresDeUsuario';
import {
  resolverDeUsuario,
  sinCambiosRespectoDe,
  valoresInicialesUsuarioForm,
  type CampoUsuarioForm,
  type DatosDeUsuario,
  type UsuarioFormValues,
} from '@/modules/usuarios/components/usuarioForm.validation';

/** Qué puede hacer cada rol, en una línea: ayuda a elegir sin ir a otra pantalla. */
export const DESCRIPCION_DE_ROL: Readonly<Record<RolUsuarioType, string>> = {
  ADMINISTRADOR: 'Administra las cuentas de acceso y opera todo el sistema.',
  ADMINISTRATIVO: 'Opera clientes, requisitos, documentos y rendiciones.',
  CONSULTA: 'Consulta la información en modo lectura, sin modificarla.',
};

export const AVISO_CAMBIO_DE_ROL =
  'Al cambiar el rol, se cerrarán las sesiones actuales de esta persona. Tendrá que volver a ingresar.';

const opcionesDeRol: SelectOption[] = RolUsuario.options.map((rol) => ({
  value: rol,
  label: ETIQUETA_DE_ROL[rol],
}));

/** Campos en el orden en que aparecen: el primero con error recibe el foco. */
const ordenDeCampos: readonly CampoUsuarioForm[] = ['nombre', 'email', 'rol'];

interface UsuarioFormProps {
  /**
   * Recibe los datos ya validados y normalizados por shared. Devuelve los errores del servidor, o
   * nada si salió bien.
   */
  onSubmit: (datos: DatosDeUsuario) => Promise<ErroresDeEnvio | undefined>;
  onCancel: () => void;
  textoEnviar: string;
  textoEnviando?: string;
  textoEnviado?: string;
  /** El envío salió bien y se está confirmando (ver `useExitoBreve`). */
  exito?: boolean;
  /**
   * La edición: los datos de la cuenta. El email se muestra como dato (no se modifica), y el
   * botón queda deshabilitado mientras no haya cambios. Sin esto, es el alta, vacía.
   */
  valoresIniciales?: UsuarioFormValues;
  /** El rol se puede elegir. En la propia cuenta no: se muestra, sin control. */
  rolEditable?: boolean;
  /** Ya no se puede enviar (p. ej. la cuenta dejó de existir): solo cancelar. */
  envioBloqueado?: boolean;
}

/**
 * Formulario de una cuenta, para el alta (nombre, email y rol) y la edición (nombre y rol; el email
 * es de lectura). Valida con las reglas de shared, con la validación progresiva de tipos de
 * documento y clientes:
 * - antes del primer envío no se marca un campo vacío solo por pasar por él; uno con contenido se
 *   valida al salir;
 * - al enviar se muestran todos los errores y el foco va al primero;
 * - después de un envío fallido se revalida en cada cambio.
 */
export function UsuarioForm({
  onSubmit,
  onCancel,
  textoEnviar,
  textoEnviando = 'Guardando…',
  textoEnviado = 'Guardado',
  exito = false,
  valoresIniciales,
  rolEditable = true,
  envioBloqueado = false,
}: UsuarioFormProps) {
  const id = useId();
  const edicion = valoresIniciales !== undefined;
  const iniciales = valoresIniciales ?? valoresInicialesUsuarioForm;
  const [errorGeneral, setErrorGeneral] = useState<AvisoDeFallo | null>(null);
  const resolver = useMemo(
    () => resolverDeUsuario({ email: !edicion, rol: rolEditable }),
    [edicion, rolEditable],
  );
  const formulario = useForm<UsuarioFormValues, unknown, DatosDeUsuario>({
    defaultValues: iniciales,
    resolver,
    mode: 'onSubmit',
    reValidateMode: 'onChange',
    shouldFocusError: false,
  });
  const { control, register, handleSubmit, getValues, clearErrors, setError, trigger } = formulario;
  const { errors, isSubmitting, submitCount } = formulario.formState;
  const nombre = useWatch({ control, name: 'nombre' });
  const rol = useWatch({ control, name: 'rol' });
  const sinCambios = edicion && sinCambiosRespectoDe({ nombre, rol }, iniciales);
  const cambiaElRol = edicion && rolEditable && rol !== iniciales.rol;

  const idDe = (campo: CampoUsuarioForm) => `${id}-${campo}`;

  const enfocarPrimerError = (conError: Partial<Record<CampoUsuarioForm, unknown>>) => {
    const primero = ordenDeCampos.find((campo) => conError[campo] !== undefined);
    if (primero !== undefined) enfocarYMostrar(document.getElementById(idDe(primero)));
  };

  // Antes del primer envío: lo vacío no se marca al salir; lo que tiene contenido, sí.
  const validarAlSalir = (campo: CampoUsuarioForm) => {
    if (submitCount > 0) return;
    if (getValues(campo).trim() === '') {
      clearErrors(campo);
      return;
    }
    void trigger(campo);
  };

  const campo = (nombreDelCampo: 'nombre' | 'email') =>
    register(nombreDelCampo, { onBlur: () => validarAlSalir(nombreDelCampo) });

  const enviar = handleSubmit(
    async (datos) => {
      setErrorGeneral(null);
      const errores = await onSubmit(datos);
      if (errores === undefined) return;
      const conError = Object.entries(errores.campos ?? {}) as [CampoUsuarioForm, string][];
      for (const [nombreDelCampo, message] of conError) {
        setError(nombreDelCampo, { type: 'server', message });
      }
      enfocarPrimerError(errores.campos ?? {});
      setErrorGeneral(errores.general ?? null);
    },
    (invalidos) => enfocarPrimerError(invalidos),
  );

  const alEnviar = (evento: FormEvent<HTMLFormElement>) => {
    // Sin doble envío: un Enter mientras se guarda (el botón está ocupado) no repite el pedido.
    if (isSubmitting || exito) {
      evento.preventDefault();
      return;
    }
    void enviar(evento);
  };

  const rolElegido = rol === '' ? undefined : rol;
  const ayudaDeRol =
    rolElegido === undefined
      ? 'Define qué puede hacer la persona en el sistema.'
      : DESCRIPCION_DE_ROL[rolElegido];
  const motivoDeshabilitado = sinCambios ? `${id}-sin-cambios` : undefined;

  return (
    <form noValidate onSubmit={alEnviar} className="flex min-h-0 flex-1 flex-col">
      {/* Zona fija, fuera del área con scroll: el aviso se ve sin tener que buscarlo. */}
      {errorGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert variant={errorGeneral.variante}>{errorGeneral.texto}</Alert>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <FormField id={idDe('nombre')} label="Nombre" error={errors.nombre}>
          <Input
            autoComplete="off"
            placeholder="Ej. María Gómez"
            {...campo('nombre')}
            {...describirCampo(idDe('nombre'), errors.nombre)}
          />
        </FormField>

        {edicion ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Email</span>
            <p className="text-sm wrap-anywhere">{iniciales.email}</p>
            <p className="text-xs text-muted-foreground">El email de una cuenta no se modifica.</p>
          </div>
        ) : (
          <FormField id={idDe('email')} label="Email" error={errors.email}>
            <Input
              type="email"
              autoComplete="off"
              spellCheck={false}
              placeholder="nombre@ejemplo.com"
              {...campo('email')}
              {...describirCampo(idDe('email'), errors.email)}
            />
          </FormField>
        )}

        {rolEditable ? (
          <FormField id={idDe('rol')} label="Rol" hint={ayudaDeRol} error={errors.rol}>
            <Controller
              name="rol"
              control={control}
              render={({ field }) => {
                const { 'aria-invalid': invalido, ...descripcion } = describirCampo(
                  idDe('rol'),
                  errors.rol,
                  { hint: true },
                );
                return (
                  <Select
                    {...descripcion}
                    invalid={invalido === true}
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    triggerRef={field.ref}
                    options={opcionesDeRol}
                    placeholder="Elegí un rol"
                  />
                );
              }}
            />
          </FormField>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">Rol</span>
            <p className="text-sm">{rolElegido === undefined ? '' : ETIQUETA_DE_ROL[rolElegido]}</p>
            <p className="text-xs text-muted-foreground">
              Tu rol lo tiene que cambiar otra persona administradora.
            </p>
          </div>
        )}

        {cambiaElRol && <Alert variant="warning">{AVISO_CAMBIO_DE_ROL}</Alert>}
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
