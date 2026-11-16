import type { UsuarioAdministrado } from '@realpolitik/shared';
import { KeyRoundIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { ETIQUETA_DE_ROL } from '@/modules/auth/permisos';
import {
  UsuarioAccionesMenu,
  type AccionesUsuario,
} from '@/modules/usuarios/components/UsuarioAccionesMenu';

/**
 * Debajo de este ancho el listado se muestra como tarjetas: con cinco columnas (y emails largos)
 * la tabla no entra antes, y no se opera con scroll horizontal.
 */
export const USUARIOS_COMPACTO_QUERY = '(max-width: 1023px)';

export const TEXTO_NUNCA_INGRESO = 'Nunca ingresó';

const claseEncabezado = 'px-4 py-3 font-medium whitespace-nowrap';

interface UsuariosListadoProps extends AccionesUsuario {
  /** En el orden de la API (por nombre y después por email). */
  usuarios: UsuarioAdministrado[];
  /** El id de la cuenta de la sesión: se reconoce por el id, nunca por el nombre o el email. */
  idPropio: string;
}

// Como las demás fechas de la interfaz: "10 nov 2026", en horario de Buenos Aires. Cada módulo
// tiene su formato (documentos, rendiciones): no se depende de otro dominio para esto.
const formatoDeFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeZone: 'America/Argentina/Buenos_Aires',
});

const ultimoAcceso = (usuario: UsuarioAdministrado) =>
  usuario.ultimoAccesoEn === null
    ? TEXTO_NUNCA_INGRESO
    : formatoDeFecha.format(usuario.ultimoAccesoEn);

/** "Tu cuenta": discreta, junto al nombre. */
function TuCuenta() {
  return (
    <Badge tone="neutral" className="ml-2 h-5 px-2 align-middle text-[11px] leading-[18px]">
      Tu cuenta
    </Badge>
  );
}

/**
 * El estado de la cuenta y, aparte, si tiene una contraseña temporal sin cambiar: son dos cosas
 * distintas (una cuenta activa puede tener el cambio pendiente). Con contraseña propia no se suma
 * ningún badge.
 */
function EstadoDeCuenta({ usuario }: { usuario: UsuarioAdministrado }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Los mismos tokens que el estado de clientes y tipos: activo en verde de éxito,
          desactivada apagada. La información la lleva el texto; el punto es decorativo. */}
      <Badge
        layout="icon"
        tone={usuario.activo ? 'none' : 'muted'}
        className={cn(usuario.activo && 'border-success-border bg-success-soft text-success')}
      >
        <span
          aria-hidden="true"
          className={cn(
            'size-1.5 rounded-full',
            usuario.activo ? 'bg-success' : 'bg-muted-foreground',
          )}
        />
        {usuario.activo ? 'Activo' : 'Desactivado'}
      </Badge>
      {usuario.debeCambiarPassword && (
        <Badge
          layout="icon"
          className="border-dashed border-warning bg-warning-soft text-foreground"
        >
          <KeyRoundIcon aria-hidden="true" className="size-3" />
          Cambio pendiente
        </Badge>
      )}
    </div>
  );
}

/** El nombre, como botón que abre la edición (como en tipos de documento): no compite con el ⋯. */
function NombreDeUsuario({
  usuario,
  onEditar,
  className,
}: {
  usuario: UsuarioAdministrado;
  onEditar: (usuario: UsuarioAdministrado) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={() => onEditar(usuario)}
      className={cn(
        'rounded-chip text-left leading-snug break-words underline-offset-2 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/30',
        !usuario.activo && 'text-content-secondary',
        className,
      )}
    >
      {usuario.nombre}
    </button>
  );
}

/**
 * Listado de cuentas: tabla en escritorio, tarjetas en pantallas angostas, con los mismos datos y
 * las mismas acciones. Respeta el orden de la API. Es presentacional: las acciones solo se avisan.
 */
export function UsuariosListado({ usuarios, idPropio, ...acciones }: UsuariosListadoProps) {
  const compacto = useMediaQuery(USUARIOS_COMPACTO_QUERY);

  if (compacto) {
    return (
      <ul aria-label="Usuarios" className="grid gap-3">
        {usuarios.map((usuario) => {
          const propia = usuario.id === idPropio;
          return (
            <li key={usuario.id} className="rounded-card border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <NombreDeUsuario
                    usuario={usuario}
                    onEditar={acciones.onEditar}
                    className="font-semibold"
                  />
                  {propia && <TuCuenta />}
                  <p className="mt-0.5 text-sm wrap-anywhere text-content-secondary">
                    {usuario.email}
                  </p>
                </div>
                <div className="-mt-2 -mr-2 shrink-0">
                  <UsuarioAccionesMenu usuario={usuario} propia={propia} {...acciones} />
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-content-secondary">Rol</dt>
                <dd>{ETIQUETA_DE_ROL[usuario.rol]}</dd>
                <dt className="text-content-secondary">Estado</dt>
                <dd>
                  <EstadoDeCuenta usuario={usuario} />
                </dd>
                <dt className="text-content-secondary">Último acceso</dt>
                <dd>{ultimoAcceso(usuario)}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="rounded-card border bg-card">
      <table className="w-full table-fixed text-left text-sm">
        <caption className="sr-only">Usuarios</caption>
        <thead className="border-b bg-table-head text-xs text-content-secondary">
          <tr>
            <th scope="col" className={claseEncabezado}>
              Usuario
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-36')}>
              Rol
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-64')}>
              Estado
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-36')}>
              Último acceso
            </th>
            <th scope="col" className={cn(claseEncabezado, 'w-20 text-right')}>
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {usuarios.map((usuario) => {
            const propia = usuario.id === idPropio;
            return (
              <tr key={usuario.id} className="hover:bg-panel-alt">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  <NombreDeUsuario
                    usuario={usuario}
                    onEditar={acciones.onEditar}
                    className="font-medium"
                  />
                  {propia && <TuCuenta />}
                  <span className="mt-0.5 block text-xs wrap-anywhere text-content-secondary">
                    {usuario.email}
                  </span>
                </th>
                <td className="px-4 py-3">{ETIQUETA_DE_ROL[usuario.rol]}</td>
                <td className="px-4 py-3">
                  <EstadoDeCuenta usuario={usuario} />
                </td>
                <td className="px-4 py-3">{ultimoAcceso(usuario)}</td>
                <td className="px-2 py-2">
                  <div className="flex justify-end">
                    <UsuarioAccionesMenu usuario={usuario} propia={propia} {...acciones} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
