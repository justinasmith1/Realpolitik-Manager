import {
  MENSAJE_CONTRASENA_PREVISIBLE,
  type CambiarContrasenaDto,
  type UsuarioDeSesion,
} from '@realpolitik/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import {
  cambiarContrasena,
  consultarSesionActual,
  type ConsultaDeSesion,
} from '@/modules/auth/api/auth.api';
import { CampoContrasena } from '@/modules/auth/components/CampoContrasena';
import { RequisitosDeContrasena } from '@/modules/auth/components/RequisitosDeContrasena';
import {
  avisoDeErrorDeAuth,
  clasificarErrorDeAuth,
  mensajeDeCampo,
} from '@/modules/auth/erroresDeAuth';
import { useSesion } from '@/modules/auth/hooks/useSesion';
import {
  CLAVE_CAMBIO_DE_CONTRASENA,
  confirmarSesion,
  establecerSesion,
  marcarRotacion,
  META_DE_SESION,
  terminarSesion,
} from '@/modules/auth/sesion';
import {
  primerCampoConError,
  validarCambioDeContrasena,
  type ErroresDeContrasena,
} from '@/modules/auth/validacionDeContrasena';

/** El aviso de la página cuando el servidor confirmó el cambio y la sesión rotada. */
export const MENSAJE_CONTRASENA_CAMBIADA =
  'Cambiaste tu contraseña. Cerramos tus otras sesiones abiertas.';
export const MENSAJE_CAMBIO_NO_CONFIRMADO = 'No pudimos cambiar la contraseña. Probá de nuevo.';

interface AvisoDelPanel {
  variante: 'destructive' | 'warning';
  texto: string;
}

/** Por qué no se cambió, para el formulario: errores por campo o un aviso en el panel. */
type FalloDelCambio = { campos: ErroresDeContrasena } | { aviso: AvisoDelPanel };

const errorDeCampo = (mensaje: string | undefined) =>
  mensaje === undefined ? undefined : { type: 'manual', message: mensaje };

const idDe = (campo: keyof ErroresDeContrasena) => `cv-${campo}`;

interface FormularioProps {
  usuario: UsuarioDeSesion;
  enviando: boolean;
  exito: boolean;
  onEnviar: (datos: CambiarContrasenaDto) => Promise<FalloDelCambio | null>;
  onCancelar: () => void;
}

/**
 * El formulario vive DENTRO del panel: al cerrarse se desmonta y lo escrito se descarta. Son
 * contraseñas: no hay borradores, ni en memoria ni en el navegador.
 */
function FormularioDeCambio({ usuario, enviando, exito, onEnviar, onCancelar }: FormularioProps) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<ErroresDeContrasena>({});
  const [aviso, setAviso] = useState<AvisoDelPanel | null>(null);
  const avisoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aviso !== null) {
      avisoRef.current?.focus();
    }
  }, [aviso]);

  function mostrarErrores(nuevos: ErroresDeContrasena) {
    setErrores(nuevos);
    const primero = primerCampoConError(nuevos);
    if (primero !== undefined) {
      document.getElementById(idDe(primero))?.focus();
    }
  }

  async function enviar(evento: FormEvent) {
    evento.preventDefault();
    // Sin doble envío: mientras se guarda o se confirma el éxito, el botón y Enter no hacen nada.
    if (enviando || exito) {
      return;
    }
    setAviso(null);
    const resultado = validarCambioDeContrasena({ actual, nueva, confirmacion });
    if (!resultado.valido) {
      mostrarErrores(resultado.errores);
      return;
    }
    setErrores({});
    const fallo = await onEnviar(resultado.datos);
    if (fallo === null) {
      return;
    }
    if ('aviso' in fallo) {
      setAviso(fallo.aviso);
      return;
    }
    // La actual rechazada no se conserva; las nuevas sí.
    if (fallo.campos.actual !== undefined) {
      setActual('');
    }
    mostrarErrores(fallo.campos);
  }

  const ocupado = enviando || exito;
  const eActual = errorDeCampo(errores.actual);
  const eNueva = errorDeCampo(errores.nueva);
  const eConfirmacion = errorDeCampo(errores.confirmacion);

  return (
    <form
      noValidate
      onSubmit={(evento) => void enviar(evento)}
      className="flex min-h-0 flex-1 flex-col"
    >
      {/* Zona fija, fuera del área con scroll: el aviso se ve sin tener que buscarlo. */}
      {aviso !== null && (
        <div className="px-5 pt-4">
          <Alert ref={avisoRef} tabIndex={-1} variant={aviso.variante} className="outline-none">
            {aviso.texto}
          </Alert>
        </div>
      )}
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        {/* Para los gestores de contraseñas: de qué cuenta es la contraseña que cambia. */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={usuario.email}
          readOnly
          hidden
        />
        <FormField id={idDe('actual')} label="Contraseña actual" error={eActual}>
          <CampoContrasena
            {...describirCampo(idDe('actual'), eActual)}
            nombre="contraseña actual"
            name="actual"
            autoComplete="current-password"
            value={actual}
            readOnly={ocupado}
            onChange={(e) => setActual(e.target.value)}
          />
        </FormField>
        <FormField
          id={idDe('nueva')}
          label="Nueva contraseña"
          hint="Podés usar una frase. Los espacios cuentan."
          error={eNueva}
        >
          <CampoContrasena
            {...describirCampo(idDe('nueva'), eNueva, { hint: true })}
            nombre="nueva contraseña"
            name="nueva"
            autoComplete="new-password"
            value={nueva}
            readOnly={ocupado}
            onChange={(e) => setNueva(e.target.value)}
          />
          <RequisitosDeContrasena actual={actual} nueva={nueva} distintaDe="la actual" />
        </FormField>
        <FormField
          id={idDe('confirmacion')}
          label="Confirmar nueva contraseña"
          error={eConfirmacion}
        >
          <CampoContrasena
            {...describirCampo(idDe('confirmacion'), eConfirmacion)}
            nombre="confirmación de la contraseña"
            name="confirmacion"
            autoComplete="new-password"
            value={confirmacion}
            readOnly={ocupado}
            onChange={(e) => setConfirmacion(e.target.value)}
          />
        </FormField>
      </div>
      <div className="flex items-center justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={enviando}
          loadingText="Guardando…"
          success={exito}
          successText="Guardada"
          className="min-w-36"
        >
          Guardar cambios
        </LoadingButton>
      </div>
    </form>
  );
}

interface CambiarContrasenaSheetProps {
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  /** El servidor confirmó el cambio y la sesión rotada: quien abrió el panel lo cierra y avisa. */
  onCambiada: () => void;
  /** A dónde vuelve el foco al cerrarse (el disparador del menú de cuenta, si sigue visible). */
  focoAlCerrar: () => HTMLElement | null;
}

/**
 * Cambio VOLUNTARIO de contraseña (HU4.2), desde el menú de cuenta. Pide la actual, la nueva y su
 * confirmación, con las mismas reglas que el servidor. Con el 204, el servidor revocó todas las
 * sesiones y emitió una cookie nueva para este navegador; se confirma con `GET /auth/sesion` y la
 * persona sigue en la misma pantalla, sin recargar los datos. El servidor decide el tipo de
 * cambio: si lo trató como obligatorio (le restablecieron la contraseña mientras tanto), borró la
 * cookie y hay que volver a entrar.
 *
 * Los errores no cierran la sesión: la actual incorrecta va en su campo, la nueva rechazada en el
 * suyo, y 429, 503, la red caída u otro fallo en un aviso del panel. Un 401 se confirma con el
 * servidor antes de dar la sesión por terminada (pudo rotarla otra pestaña).
 */
export function CambiarContrasenaSheet({
  abierto,
  onAbiertoChange,
  onCambiada,
  focoAlCerrar,
}: CambiarContrasenaSheetProps) {
  const queryClient = useQueryClient();
  const usuario = useSesion().data?.usuario;
  const exito = useExitoBreve();

  const cambio = useMutation({
    mutationKey: CLAVE_CAMBIO_DE_CONTRASENA,
    meta: META_DE_SESION,
    onMutate: () => marcarRotacion(queryClient),
    mutationFn: async (datos: CambiarContrasenaDto): Promise<ConsultaDeSesion | undefined> => {
      await cambiarContrasena(datos);
      // Con el 204 la cookie ya es otra (o ninguna): se confirma con el servidor. Si esta consulta
      // falla, el cambio igual está hecho; se sigue con la sesión que hay y el próximo pedido la
      // valida.
      try {
        return await consultarSesionActual();
      } catch {
        return undefined;
      }
    },
  });

  async function interpretarFallo(error: unknown): Promise<FalloDelCambio | null> {
    const clasificado = clasificarErrorDeAuth(error);
    switch (clasificado.clase) {
      case 'sin-sesion': {
        // ¿Terminó de verdad, o es un 401 atrasado porque otra pestaña rotó la cookie?
        const sigue = await confirmarSesion(queryClient, {
          motivo: clasificado.vencida ? 'vencida' : 'terminada',
          sinGuardar: true,
        });
        return sigue
          ? { aviso: { variante: 'destructive', texto: MENSAJE_CAMBIO_NO_CONFIRMADO } }
          : null;
      }
      case 'validacion': {
        const deActual = mensajeDeCampo(clasificado.detalles, 'actual');
        const tieneNueva = clasificado.detalles.some((d) => d.campo === 'nueva');
        if (deActual === null && !tieneNueva) {
          return { aviso: { variante: 'destructive', texto: MENSAJE_CAMBIO_NO_CONFIRMADO } };
        }
        return {
          campos: {
            ...(deActual !== null && { actual: deActual }),
            ...(tieneNueva && {
              nueva: mensajeDeCampo(clasificado.detalles, 'nueva') ?? MENSAJE_CONTRASENA_PREVISIBLE,
            }),
          },
        };
      }
      case 'inesperado':
        return { aviso: { variante: 'destructive', texto: MENSAJE_CAMBIO_NO_CONFIRMADO } };
      default:
        // 429 (espera), 503 u otro 5xx, red caída, origen: un aviso; la sesión sigue.
        return { aviso: avisoDeErrorDeAuth(clasificado) };
    }
  }

  async function enviar(datos: CambiarContrasenaDto): Promise<FalloDelCambio | null> {
    let confirmada: ConsultaDeSesion | undefined;
    try {
      confirmada = await cambio.mutateAsync(datos);
    } catch (error) {
      return interpretarFallo(error);
    }
    if (confirmada?.sesion === null) {
      // El servidor lo trató como cambio obligatorio y borró la cookie: hay que volver a entrar.
      terminarSesion(queryClient, 'contrasena');
      return null;
    }
    if (confirmada !== undefined) {
      establecerSesion(queryClient, confirmada.sesion);
    }
    await exito.mostrar();
    onCambiada();
    return null;
  }

  const ocupado = cambio.isPending || exito.activo;

  return (
    <Sheet
      open={abierto && usuario !== undefined}
      onOpenChange={(abrir) => {
        // Mientras se guarda o se confirma el éxito no se cierra: el resultado tiene que verse.
        if (!abrir && ocupado) {
          return;
        }
        onAbiertoChange(abrir);
      }}
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) {
          exito.reiniciar();
          cambio.reset();
        }
      }}
    >
      <SheetContent
        initialFocus={() => document.getElementById(idDe('actual')) ?? true}
        finalFocus={() => focoAlCerrar() ?? true}
        className="data-[side=right]:w-full data-[side=right]:sm:max-w-md"
      >
        <SheetHeader>
          <SheetTitle>Cambiar contraseña</SheetTitle>
          {usuario && (
            <p className="text-[12.5px] wrap-anywhere text-content-secondary">
              {`${usuario.nombre} · ${usuario.email}`}
            </p>
          )}
          <SheetDescription>
            Vas a seguir con la sesión abierta en este navegador. Al cambiarla, se cierran tus otras
            sesiones.
          </SheetDescription>
        </SheetHeader>
        {usuario && (
          <FormularioDeCambio
            usuario={usuario}
            enviando={cambio.isPending}
            exito={exito.activo}
            onEnviar={enviar}
            onCancelar={() => onAbiertoChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
