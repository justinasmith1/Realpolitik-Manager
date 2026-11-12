import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import {
  CargandoSesion,
  RolNoHabilitado,
  ServicioNoDisponible,
} from '@/modules/auth/components/PantallasDeAcceso';
import { useSesion } from '@/modules/auth/hooks/useSesion';
import { rolHabilitado } from '@/modules/auth/permisos';
import { urlDeCambioDeContrasena, urlDeLogin } from '@/modules/auth/sesion';

/**
 * Guarda de las rutas protegidas. Decide con el estado de la sesión (`['sesion']`), que viene
 * siempre del servidor, y no muestra nada del sistema hasta que haya un usuario habilitado:
 *
 * - resolviendo → carga de pantalla completa;
 * - error temporal (503, red) → "Servicio no disponible", sin ir a `/login`;
 * - sin sesión → `/login?volverA=<ruta y query actuales>`, reemplazando el historial;
 * - contraseña temporal → `/cambiar-contrasena`;
 * - rol no habilitado (CONSULTA, hasta HU4.3) → pantalla de bloqueo;
 * - si no, el contenido.
 *
 * Es solo presentación: la API rechaza por su cuenta cada pedido sin sesión o sin permiso.
 */
export function RequiereSesion({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { pathname, search } = useLocation();
  const sesion = useSesion();
  const volverA = `${pathname}${search}`;

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
  if (usuario.debeCambiarPassword) {
    return <Navigate to={urlDeCambioDeContrasena(volverA)} replace />;
  }
  if (!rolHabilitado(usuario.rol)) {
    return <RolNoHabilitado nombre={usuario.nombre} />;
  }
  return children;
}
