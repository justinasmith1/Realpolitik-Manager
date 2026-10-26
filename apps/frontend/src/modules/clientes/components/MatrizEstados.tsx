import type { Ref } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { CausaDeFalloDeCarga } from '@/lib/errores-api';
import { cn } from '@/lib/utils';

const textosDeError: Record<CausaDeFalloDeCarga, { etiqueta: string; detalle: string }> = {
  conexion: {
    etiqueta: 'Error de conexión',
    detalle: 'No pudimos conectarnos con el servidor. Revisá tu conexión y probá de nuevo.',
  },
  servidor: {
    etiqueta: 'Error del servidor',
    detalle: 'El servidor respondió con un error. Probá de nuevo en unos segundos.',
  },
  configuracion: {
    etiqueta: 'Error de configuración',
    detalle: 'La aplicación no tiene bien configurada la dirección del servidor.',
  },
  inesperado: {
    etiqueta: 'Error inesperado',
    detalle: 'Algo salió mal al cargar esta información.',
  },
};

const tituloDeError = {
  cliente: 'No pudimos cargar el cliente',
  requisitos: 'No pudimos cargar los requisitos',
} as const;

interface MatrizErrorProps {
  recurso: keyof typeof tituloDeError;
  causa: CausaDeFalloDeCarga;
  diagnostico?: string | undefined;
  onReintentar: () => void;
}

/**
 * Falló la carga del cliente o de sus requisitos. Un error no es una matriz vacía: el texto
 * dice qué no se pudo cargar y ofrece reintentar.
 */
export function MatrizError({ recurso, causa, diagnostico, onReintentar }: MatrizErrorProps) {
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
      <h2 className="text-[17px] font-semibold">{tituloDeError[recurso]}</h2>
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

const filas = ['w-[46%]', 'w-[62%]', 'w-[38%]'];

/**
 * Esqueleto de la matriz. Con `incluirEncabezado`, también reserva el lugar del título para
 * que la página no salte cuando llega el cliente. El aviso para lectores de pantalla va
 * aparte: una región en vivo dentro de `aria-busy` puede no anunciarse.
 */
export function MatrizCargando({ incluirEncabezado }: { incluirEncabezado: boolean }) {
  return (
    <>
      <p role="status" className="sr-only">
        Cargando los requisitos…
      </p>
      <div aria-busy="true" className="flex flex-col gap-4">
        {incluirEncabezado && (
          <div aria-hidden="true" className="flex flex-col gap-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-40" />
            <div className="flex gap-2">
              <Skeleton className="h-6 w-16 rounded-pill" />
              <Skeleton className="h-6 w-20 rounded-pill" />
            </div>
          </div>
        )}
        <div aria-hidden="true" className="overflow-hidden rounded-card border bg-card">
          <div className="h-10 border-b bg-table-head" />
          {filas.map((ancho) => (
            <div
              key={ancho}
              className="flex h-14 items-center gap-3 border-b border-muted px-4 last:border-b-0"
            >
              <Skeleton className={cn('h-2.5 rounded-full bg-border', ancho)} />
              <Skeleton className="ml-auto h-2.5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** El id de la URL no es un UUID: no se consulta la API. */
export function MatrizEnlaceInvalido({ tituloRef }: { tituloRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-6">
      <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
        El enlace a estos requisitos no es válido
      </h1>
      <p className="max-w-140 text-sm text-content-secondary">
        Revisá la dirección o volvé al listado de clientes.
      </p>
    </div>
  );
}

/** `GET /clientes/:id` respondió 404. No se mezcla con un error de la matriz. */
export function MatrizClienteAusente({ tituloRef }: { tituloRef: Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-6">
      <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
        Este cliente ya no está disponible
      </h1>
      <p className="max-w-140 text-sm text-content-secondary">
        Puede que se haya dado de baja. Volvé al listado para elegir otro.
      </p>
    </div>
  );
}

/**
 * El cliente existe y no tiene requisitos activos. No es un error y no se inventa la factura:
 * también se carga como un requisito, cuando haya alta.
 */
export function MatrizVacia() {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border bg-card p-6">
      <h2 className="text-base font-semibold">Este cliente todavía no tiene requisitos</h2>
      <p className="max-w-140 text-sm leading-normal text-content-secondary">
        La factura también se configura como un requisito. No se agrega sola.
      </p>
    </div>
  );
}
