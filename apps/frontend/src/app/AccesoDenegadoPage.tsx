import { Link } from 'react-router';

import { RUTA_DE_ENTRADA } from '@/modules/auth/sesion';

/**
 * La sección existe, pero la sesión no tiene el permiso que pide (p. ej. `/usuarios` sin
 * `usuarios:administrar`). Dentro del shell, con el molde de `NotFoundPage`: no es una página
 * inexistente, y no se dice qué hay adentro.
 */
export function AccesoDenegadoPage() {
  return (
    <div className="px-6 py-5.5">
      <h1 className="text-xl font-semibold tracking-tight">No tenés acceso a esta sección</h1>
      <p className="mt-2 text-sm text-content-secondary">
        Si creés que deberías tenerlo, consultalo con quien administra las cuentas.
      </p>
      <Link
        to={RUTA_DE_ENTRADA}
        className="mt-4 inline-block text-sm font-medium underline underline-offset-2"
      >
        Ir a Rendiciones
      </Link>
    </div>
  );
}
