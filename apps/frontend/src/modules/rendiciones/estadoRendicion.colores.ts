import type { EstadoRendicionType } from '@realpolitik/shared';

// Clases de color de cada estado, con los tokens `estado-*` del tema (los mismos en todo el
// sistema). Son literales completos para que Tailwind los genere. `Record` obliga a cubrir cada
// estado.

/** Texto en el color del estado. */
export const textoDeEstado: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'text-estado-en-curso',
  COMPLETA: 'text-estado-completa',
  ENVIADA: 'text-estado-enviada',
  APROBADA: 'text-estado-aprobada',
  RECHAZADA: 'text-estado-rechazada',
};

/** Relleno sólido: la barra de avance y el punto de las tarjetas y los chips. */
export const rellenoDeEstado: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'bg-estado-en-curso',
  COMPLETA: 'bg-estado-completa',
  ENVIADA: 'bg-estado-enviada',
  APROBADA: 'bg-estado-aprobada',
  RECHAZADA: 'bg-estado-rechazada',
};

/** Fondo suave: el monograma de la fila. */
export const fondoDeEstado: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'bg-estado-en-curso-soft',
  COMPLETA: 'bg-estado-completa-soft',
  ENVIADA: 'bg-estado-enviada-soft',
  APROBADA: 'bg-estado-aprobada-soft',
  RECHAZADA: 'bg-estado-rechazada-soft',
};

/** Seleccionado: fondo suave y borde marcado en el color del estado (la tarjeta de resumen activa). */
export const seleccionDeEstado: Record<EstadoRendicionType, string> = {
  EN_CURSO: 'border-estado-en-curso bg-estado-en-curso-soft ring-1 ring-estado-en-curso',
  COMPLETA: 'border-estado-completa bg-estado-completa-soft ring-1 ring-estado-completa',
  ENVIADA: 'border-estado-enviada bg-estado-enviada-soft ring-1 ring-estado-enviada',
  APROBADA: 'border-estado-aprobada bg-estado-aprobada-soft ring-1 ring-estado-aprobada',
  RECHAZADA: 'border-estado-rechazada bg-estado-rechazada-soft ring-1 ring-estado-rechazada',
};
