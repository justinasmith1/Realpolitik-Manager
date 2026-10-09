import {
  subtiposPorSector,
  type ClienteSector,
  type ClienteSubtipoPublico,
} from '../schemas/cliente.schema.js';

/** Clasificación de un cliente: el subtipo solo tiene valor en el sector público. */
export interface Clasificacion {
  sector: ClienteSector | undefined;
  subtipo: ClienteSubtipoPublico | undefined;
}

const subtipoValidoPara = (
  sector: ClienteSector | undefined,
  subtipo: ClienteSubtipoPublico | undefined,
): subtipo is ClienteSubtipoPublico =>
  sector !== undefined &&
  subtipo !== undefined &&
  (subtiposPorSector[sector] as readonly string[]).includes(subtipo);

/**
 * Aplica un cambio de sector: el subtipo se conserva solo si sigue siendo válido para el
 * nuevo sector (p. ej. al volver a elegir el mismo); en cualquier otro caso se descarta y
 * hay que elegir uno nuevo.
 */
export function cambiarSector(
  actual: Clasificacion,
  nuevoSector: ClienteSector | undefined,
): Clasificacion {
  return {
    sector: nuevoSector,
    subtipo: subtipoValidoPara(nuevoSector, actual.subtipo) ? actual.subtipo : undefined,
  };
}
