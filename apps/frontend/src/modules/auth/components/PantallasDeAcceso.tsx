// Pantallas completas, fuera del shell, para los estados en los que no se puede mostrar el
// sistema: sesión resolviéndose, servicio no disponible y rol no habilitado.

import { Loader2Icon } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { LoadingButton } from '@/components/ui/loading-button';
import { causaDeError, diagnosticoDeError } from '@/lib/errores-api';
import { AccesoLayout, EncabezadoDeAcceso } from '@/modules/auth/components/AccesoLayout';
import { MENSAJE_ROL_NO_HABILITADO } from '@/modules/auth/erroresDeAuth';
import { useCerrarSesion } from '@/modules/auth/hooks/useSesion';

/** Mientras se resuelve `GET /auth/sesion`: sin shell, para no mostrar navegación y después echar. */
export function CargandoSesion() {
  return (
    <div
      role="status"
      className="flex min-h-svh items-center justify-center gap-2.5 bg-background text-sm text-content-secondary"
    >
      <Loader2Icon aria-hidden="true" className="size-4 animate-spin" />
      Cargando…
    </div>
  );
}

const detalleDeCausa = {
  conexion: 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.',
  servidor: 'El servicio no está disponible en este momento. Probá de nuevo en unos minutos.',
  configuracion: 'La aplicación no tiene bien configurada la dirección del servidor.',
  inesperado: 'Algo salió mal al comprobar tu sesión. Probá de nuevo.',
} as const;

interface ServicioNoDisponibleProps {
  error: unknown;
  reintentando: boolean;
  onReintentar: () => void;
}

/**
 * No se pudo saber si hay sesión (503, red caída, 502/504 del proxy). NO es "sin sesión": no se
 * manda a `/login` y la URL queda igual; al reintentar se vuelve a preguntar.
 */
export function ServicioNoDisponible({
  error,
  reintentando,
  onReintentar,
}: ServicioNoDisponibleProps) {
  const causa = causaDeError(error);
  return (
    <AccesoLayout>
      <div role="alert" className="flex flex-col gap-3">
        <span className="inline-flex items-center gap-1.75 self-start rounded-pill border border-destructive-border bg-destructive-soft px-2.75 py-0.75 text-[12.5px] font-medium text-destructive">
          <span aria-hidden="true" className="size-1.75 rounded-full bg-destructive" />
          Servicio no disponible
        </span>
        <EncabezadoDeAcceso
          titulo="No pudimos conectarnos con el sistema"
          bajada={`${detalleDeCausa[causa]} Tu sesión no se cerró.`}
        />
        <p className="font-mono text-xs text-content-secondary">{diagnosticoDeError(error)}</p>
      </div>
      <LoadingButton
        className="h-12 md:h-12"
        loading={reintentando}
        loadingText="Reintentando…"
        onClick={onReintentar}
      >
        Reintentar
      </LoadingButton>
    </AccesoLayout>
  );
}

/**
 * TEMPORAL (HU4.1): una cuenta con sesión cuyo rol todavía no entra al sistema (CONSULTA, hasta
 * HU4.3). No se muestra el shell ni ninguna pantalla de negocio; solo se puede salir.
 */
export function RolNoHabilitado({ nombre }: { nombre: string }) {
  const { cerrar, cerrando, error } = useCerrarSesion();
  return (
    <AccesoLayout pie="Si creés que deberías tener acceso, consultalo con quien administra las cuentas.">
      <EncabezadoDeAcceso
        quien={nombre}
        titulo={MENSAJE_ROL_NO_HABILITADO}
        bajada="Iniciaste sesión correctamente, pero tu cuenta todavía no está habilitada para usar Realpolitik Manager."
      />
      {error !== null && <Alert>{error}</Alert>}
      <LoadingButton
        className="h-12 md:h-12"
        loading={cerrando}
        loadingText="Cerrando sesión…"
        onClick={cerrar}
      >
        Cerrar sesión
      </LoadingButton>
    </AccesoLayout>
  );
}
