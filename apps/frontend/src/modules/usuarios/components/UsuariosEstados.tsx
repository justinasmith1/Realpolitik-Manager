// Estados del listado de usuarios que no son el listado: la carga inicial, el error y los vacíos.
// Mismo tratamiento visual que los de tipos de documento.

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CausaDeFalloDeCarga } from '@/lib/errores-api';
import { cn } from '@/lib/utils';

// Anchos de las barras: solo comunican el patrón (nombre y email, estado), no son datos.
const filas = [
  { nombre: 'w-[30%]', email: 'w-[24%]' },
  { nombre: 'w-[22%]', email: 'w-[30%]' },
  { nombre: 'w-[36%]', email: 'w-[20%]' },
  { nombre: 'w-[26%]', email: 'w-[28%]' },
];

/**
 * Esqueleto de la carga inicial. El aviso para lectores de pantalla va aparte, como región
 * `status`: una región en vivo dentro de un contenedor `aria-busy` puede no anunciarse.
 */
export function UsuariosCargando() {
  return (
    <>
      <p role="status" className="sr-only">
        Cargando usuarios…
      </p>
      <div aria-busy="true" className="overflow-hidden rounded-card border bg-card">
        <div aria-hidden="true">
          <div className="h-10 border-b bg-table-head" />
          {filas.map((fila, indice) => (
            <div
              key={indice}
              className="flex min-h-16 items-center gap-3 border-b border-muted px-4 py-3 last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Skeleton className={cn('h-2.5 rounded-full bg-border', fila.nombre)} />
                <Skeleton className={cn('h-2 rounded-full', fila.email)} />
              </div>
              <Skeleton className="h-6 w-20 flex-none rounded-pill" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** Por qué no se pudo cargar: las causas de cualquier listado, más la falta de permiso (403). */
export type CausaDeFalloDeUsuarios = CausaDeFalloDeCarga | 'permiso';

const textosDeError: Record<CausaDeFalloDeUsuarios, { etiqueta: string; detalle: string }> = {
  conexion: {
    etiqueta: 'Error de conexión',
    detalle: 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.',
  },
  servidor: {
    etiqueta: 'Error del servidor',
    detalle:
      'El servidor respondió con un error y no pudo entregarnos las cuentas. Probá de nuevo en unos segundos.',
  },
  configuracion: {
    etiqueta: 'Error de configuración',
    detalle: 'La aplicación no tiene bien configurada la dirección del servidor.',
  },
  permiso: {
    etiqueta: 'Sin permiso',
    detalle: 'Tu cuenta no tiene permiso para administrar usuarios.',
  },
  inesperado: {
    etiqueta: 'Error inesperado',
    detalle: 'Algo salió mal al cargar las cuentas.',
  },
};

interface UsuariosErrorProps {
  causa: CausaDeFalloDeUsuarios;
  /** Código técnico para soporte (`diagnosticoDeError`). Sin él, no se menciona. */
  diagnostico?: string | undefined;
  onReintentar: () => void;
}

/** Falló la carga: dice que no se pudieron cargar las cuentas, nunca que no hay ninguna. */
export function UsuariosError({ causa, diagnostico, onReintentar }: UsuariosErrorProps) {
  const tieneDiagnostico = diagnostico !== undefined && diagnostico.trim() !== '';
  const { etiqueta, detalle } = textosDeError[causa];
  return (
    <div
      role="alert"
      className="flex min-h-80 flex-col items-center justify-center gap-2.5 rounded-card border bg-card p-8 text-center"
    >
      <span className="inline-flex items-center gap-1.75 rounded-pill border border-destructive-border bg-destructive-soft px-2.75 py-0.75 text-[12.5px] font-medium text-destructive">
        <span aria-hidden="true" className="size-1.75 rounded-full bg-destructive" />
        {etiqueta}
      </span>
      <h2 className="text-[17px] font-semibold">No pudimos cargar los usuarios</h2>
      <p className="max-w-115 text-sm leading-normal text-content-secondary">
        {detalle}
        {tieneDiagnostico && ' Si sigue pasando, avisale a soporte con el código de abajo.'}
      </p>
      {tieneDiagnostico && (
        <p className="font-mono text-xs text-content-secondary">{diagnostico}</p>
      )}
      <Button variant="outline" onClick={onReintentar}>
        Reintentar
      </Button>
    </div>
  );
}

interface UsuariosVacioProps {
  /** La búsqueda o el rol acotan el listado. */
  hayBusqueda: boolean;
  incluirDesactivados: boolean;
  onIncluirDesactivados: () => void;
  onLimpiarFiltros: () => void;
}

/**
 * Sin cuentas para mostrar. Distingue por qué: filtros sin coincidencias, solo las activas a la
 * vista, o ninguna cuenta. No ofrece crear una cuenta: para eso está "Nuevo usuario" arriba.
 */
export function UsuariosVacio({
  hayBusqueda,
  incluirDesactivados,
  onIncluirDesactivados,
  onLimpiarFiltros,
}: UsuariosVacioProps) {
  let titulo: string;
  let detalle: string;
  if (hayBusqueda) {
    titulo = 'No encontramos usuarios con esos filtros.';
    detalle = incluirDesactivados
      ? 'Probá con otra búsqueda u otro rol.'
      : 'Probá con otra búsqueda u otro rol, o incluí también las cuentas desactivadas.';
  } else if (!incluirDesactivados) {
    titulo = 'No hay cuentas activas';
    detalle = 'Las cuentas desactivadas se conservan y se pueden ver con el filtro.';
  } else {
    titulo = 'Todavía no hay cuentas';
    detalle = 'Acá se administran las cuentas de acceso al sistema.';
  }
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">{titulo}</h2>
      <p className="max-w-140 text-sm text-content-secondary">{detalle}</p>
      <div className="flex flex-wrap gap-2">
        {!incluirDesactivados && (
          <Button variant="outline" onClick={onIncluirDesactivados}>
            Incluir desactivados
          </Button>
        )}
        {hayBusqueda && (
          <Button variant="outline" onClick={onLimpiarFiltros}>
            Limpiar filtros
          </Button>
        )}
      </div>
    </div>
  );
}
