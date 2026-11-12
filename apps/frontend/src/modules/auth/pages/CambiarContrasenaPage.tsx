import {
  CambiarContrasenaSchema,
  CONTRASENA_LARGO_MINIMO,
  contarCaracteresDeContrasena,
  MENSAJE_CONTRASENA_PREVISIBLE,
} from '@realpolitik/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckIcon } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { LoadingButton } from '@/components/ui/loading-button';
import { cambiarContrasena } from '@/modules/auth/api/auth.api';
import { AccesoLayout, EncabezadoDeAcceso } from '@/modules/auth/components/AccesoLayout';
import { CampoContrasena } from '@/modules/auth/components/CampoContrasena';
import { CargandoSesion, ServicioNoDisponible } from '@/modules/auth/components/PantallasDeAcceso';
import {
  avisoDeErrorDeAuth,
  clasificarErrorDeAuth,
  mensajeDeCampo,
} from '@/modules/auth/erroresDeAuth';
import { useCerrarSesion, useSesion } from '@/modules/auth/hooks/useSesion';
import {
  destinoDespuesDeEntrar,
  META_DE_SESION,
  terminarSesion,
  urlDeLogin,
} from '@/modules/auth/sesion';

export const MENSAJE_CONFIRMACION_DISTINTA = 'Las contraseñas no coinciden.';
export const MENSAJE_CONFIRMACION_VACIA = 'Repetí la contraseña nueva.';
export const MENSAJE_GUARDADO_FALLIDO =
  'No pudimos guardar la contraseña. Lo que escribiste sigue acá: probá de nuevo.';

type Campo = 'actual' | 'nueva' | 'confirmacion';
type Errores = Partial<Record<Campo, string>>;

const errorDeCampo = (mensaje: string | undefined) =>
  mensaje === undefined ? undefined : { type: 'manual', message: mensaje };

function Requisito({ cumplido, children }: { cumplido: boolean; children: string }) {
  return (
    <li
      className={`flex items-center gap-2 text-[13px] ${cumplido ? 'text-success' : 'text-content-secondary'}`}
    >
      <span
        aria-hidden="true"
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] ${cumplido ? 'border-success bg-success text-white' : 'border-input bg-card'}`}
      >
        {cumplido && <CheckIcon className="size-2.5" strokeWidth={3.5} />}
      </span>
      {children}
      <span className="sr-only">{cumplido ? ' (cumplido)' : ' (pendiente)'}</span>
    </li>
  );
}

/**
 * Cambio OBLIGATORIO de contraseña (HU4.1): quien entró con una contraseña temporal no puede usar
 * el sistema hasta elegir una propia. Con el 204 el servidor revocó todas las sesiones, también
 * esta: se termina la sesión local y se vuelve a `/login` para entrar con la nueva.
 */
export function CambiarContrasenaPage() {
  const queryClient = useQueryClient();
  const [parametros] = useSearchParams();
  const volverA = parametros.get('volverA');
  const sesion = useSesion();
  const salida = useCerrarSesion();

  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState<Errores>({});
  const [aviso, setAviso] = useState<{ variante: 'destructive' | 'warning'; texto: string } | null>(
    null,
  );

  const avisoRef = useRef<HTMLDivElement>(null);

  function mostrarErrores(nuevos: Errores) {
    setErrores(nuevos);
    const primero = (['actual', 'nueva', 'confirmacion'] as const).find(
      (campo) => nuevos[campo] !== undefined,
    );
    if (primero !== undefined) {
      document.getElementById(`cc-${primero}`)?.focus();
    }
  }

  const cambio = useMutation({
    mutationFn: cambiarContrasena,
    meta: META_DE_SESION,
    onSuccess: () => terminarSesion(queryClient, 'contrasena'),
    onError: (error) => {
      const clasificado = clasificarErrorDeAuth(error);
      switch (clasificado.clase) {
        case 'sin-sesion':
          // La sesión venció en el medio: a `/login`, con su aviso.
          terminarSesion(queryClient, clasificado.vencida ? 'vencida' : 'terminada');
          return;
        case 'validacion': {
          const deActual = mensajeDeCampo(clasificado.detalles, 'actual');
          const tieneNueva = clasificado.detalles.some((d) => d.campo === 'nueva');
          if (deActual !== null || tieneNueva) {
            // La contraseña temporal rechazada no se conserva; las nuevas sí.
            if (deActual !== null) {
              setActual('');
            }
            mostrarErrores({
              ...(deActual !== null && { actual: deActual }),
              ...(tieneNueva && {
                nueva:
                  mensajeDeCampo(clasificado.detalles, 'nueva') ?? MENSAJE_CONTRASENA_PREVISIBLE,
              }),
            });
            return;
          }
          setAviso({ variante: 'destructive', texto: MENSAJE_GUARDADO_FALLIDO });
          return;
        }
        case 'no-disponible':
        case 'red':
        case 'inesperado':
          setAviso({ variante: 'destructive', texto: MENSAJE_GUARDADO_FALLIDO });
          return;
        default:
          setAviso(avisoDeErrorDeAuth(clasificado));
      }
    },
  });

  const lista = sesion.data?.usuario.debeCambiarPassword === true;
  useEffect(() => {
    if (lista) {
      document.getElementById('cc-actual')?.focus();
    }
  }, [lista]);

  useEffect(() => {
    if (aviso !== null) {
      avisoRef.current?.focus();
    }
  }, [aviso]);

  if (sesion.data === undefined) {
    return sesion.isError ? (
      <ServicioNoDisponible
        error={sesion.error}
        reintentando={sesion.isFetching}
        onReintentar={() => void sesion.refetch()}
      />
    ) : (
      <CargandoSesion />
    );
  }
  if (sesion.data === null) {
    return <Navigate to={urlDeLogin(queryClient, volverA)} replace />;
  }
  const { usuario } = sesion.data;
  if (!usuario.debeCambiarPassword) {
    return <Navigate to={destinoDespuesDeEntrar(volverA)} replace />;
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (cambio.isPending) {
      return;
    }
    setAviso(null);
    const resultado = CambiarContrasenaSchema.safeParse({ actual, nueva });
    const campos = resultado.success ? {} : resultado.error.flatten().fieldErrors;
    const nuevos: Errores = {
      ...(campos.actual?.[0] !== undefined && { actual: campos.actual[0] }),
      ...(campos.nueva?.[0] !== undefined && { nueva: campos.nueva[0] }),
      ...(confirmacion === ''
        ? { confirmacion: MENSAJE_CONFIRMACION_VACIA }
        : confirmacion !== nueva && { confirmacion: MENSAJE_CONFIRMACION_DISTINTA }),
    };
    if (!resultado.success || nuevos.confirmacion !== undefined) {
      mostrarErrores(nuevos);
      return;
    }
    setErrores({});
    cambio.mutate(resultado.data);
  }

  const ocupado = cambio.isPending;
  const eActual = errorDeCampo(errores.actual);
  const eNueva = errorDeCampo(errores.nueva);
  const eConfirmacion = errorDeCampo(errores.confirmacion);
  const largoSuficiente = contarCaracteresDeContrasena(nueva) >= CONTRASENA_LARGO_MINIMO;
  const distinta = nueva !== '' && nueva.normalize('NFC') !== actual.normalize('NFC');

  return (
    <AccesoLayout pie="Si la contraseña temporal no funciona, pedile una nueva a un administrador.">
      <EncabezadoDeAcceso
        quien={`Primer ingreso · ${usuario.nombre} · ${usuario.email}`}
        titulo="Configurá tu contraseña"
        bajada="Por seguridad, necesitás establecer una contraseña propia antes de continuar. Después vas a ingresar de nuevo con ella."
      />
      {aviso !== null && (
        <Alert ref={avisoRef} tabIndex={-1} variant={aviso.variante} className="outline-none">
          {aviso.texto}
        </Alert>
      )}
      {salida.error !== null && <Alert>{salida.error}</Alert>}
      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        <FormField id="cc-actual" label="Contraseña temporal" error={eActual}>
          <CampoContrasena
            {...describirCampo('cc-actual', eActual)}
            nombre="contraseña temporal"
            name="actual"
            autoComplete="current-password"
            value={actual}
            readOnly={ocupado}
            onChange={(e) => setActual(e.target.value)}
          />
        </FormField>
        <FormField
          id="cc-nueva"
          label="Nueva contraseña"
          hint="Podés usar una frase. Los espacios cuentan."
          error={eNueva}
        >
          <CampoContrasena
            {...describirCampo('cc-nueva', eNueva, { hint: true })}
            nombre="nueva contraseña"
            name="nueva"
            autoComplete="new-password"
            value={nueva}
            readOnly={ocupado}
            onChange={(e) => setNueva(e.target.value)}
          />
          <ul aria-label="Requisitos de la contraseña" className="flex flex-col gap-1">
            <Requisito cumplido={largoSuficiente}>
              {`Al menos ${CONTRASENA_LARGO_MINIMO} caracteres`}
            </Requisito>
            <Requisito cumplido={distinta}>Distinta de la contraseña temporal</Requisito>
          </ul>
        </FormField>
        <FormField id="cc-confirmacion" label="Confirmar nueva contraseña" error={eConfirmacion}>
          <CampoContrasena
            {...describirCampo('cc-confirmacion', eConfirmacion)}
            nombre="confirmación de la contraseña"
            name="confirmacion"
            autoComplete="new-password"
            value={confirmacion}
            readOnly={ocupado}
            onChange={(e) => setConfirmacion(e.target.value)}
          />
        </FormField>
        <LoadingButton
          type="submit"
          className="mt-1 h-12 md:h-12"
          loading={ocupado}
          loadingText="Guardando…"
        >
          Guardar contraseña
        </LoadingButton>
        <button
          type="button"
          onClick={salida.cerrar}
          disabled={salida.cerrando || ocupado}
          className="min-h-11 self-center rounded-md px-2 text-[13.5px] underline underline-offset-2 hover:text-content-secondary focus-visible:ring-3 focus-visible:ring-ring/25 focus-visible:outline-none disabled:opacity-60"
        >
          {salida.cerrando ? 'Cerrando sesión…' : 'Salir sin cambiarla'}
        </button>
      </form>
    </AccesoLayout>
  );
}
