import {
  EstadoRendicion,
  type EstadoRendicionType,
  type RendicionDelMes,
} from '@realpolitik/shared';

import {
  claveDeTipoDeCliente,
  TIPOS_DE_CLIENTE,
  type TipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';

// Filtros de la pantalla Rendiciones (HU3.3). Se aplican en el frontend, sobre el listado del mes
// que ya trae `GET /rendiciones?anio=&mes=` (de 40 a 50 rendiciones): ver ADR-0005, punto 7.

/** Los estados, en el orden de sus tarjetas y chips. */
export const ESTADOS_DE_RENDICION: readonly EstadoRendicionType[] = EstadoRendicion.options;

export interface FiltrosDelMes {
  estado: EstadoRendicionType | undefined;
  tipo: TipoDeCliente | undefined;
  /** El texto buscado, recortado pero sin normalizar. Cada filtro, `undefined` si no se aplica. */
  q: string | undefined;
}

/** Cuántas rendiciones hay en cada estado. Cuenta todas las que recibe: no mira los filtros. */
export function contarPorEstado(
  rendiciones: readonly RendicionDelMes[],
): Record<EstadoRendicionType, number> {
  const conteo: Record<EstadoRendicionType, number> = {
    EN_CURSO: 0,
    COMPLETA: 0,
    ENVIADA: 0,
    APROBADA: 0,
    RECHAZADA: 0,
  };
  for (const { estado } of rendiciones) conteo[estado] += 1;
  return conteo;
}

/** Los tipos de cliente presentes en el mes, en el orden de los chips: así no hay chips vacíos. */
export function tiposPresentes(rendiciones: readonly RendicionDelMes[]): TipoDeCliente[] {
  const presentes = new Set(rendiciones.map(({ cliente }) => claveDeTipoDeCliente(cliente)));
  return TIPOS_DE_CLIENTE.filter((tipo) => presentes.has(tipo));
}

const MARCAS_DIACRITICAS = /\p{M}/gu;

/** Para comparar textos: sin acentos, en minúscula y con los espacios repetidos colapsados. */
const normalizarTexto = (texto: string): string =>
  texto.normalize('NFD').replace(MARCAS_DIACRITICAS, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Para comparar facturas: además, sin espacios ni guiones ("B 00002-00001482" → "b0000200001482"). */
const compactarFactura = (texto: string): string => normalizarTexto(texto).replace(/[\s-]/g, '');

/**
 * La rendición coincide con lo buscado: parte del nombre del cliente, sin distinguir mayúsculas ni
 * acentos, o parte de la factura, además sin espacios ni guiones ("0000148", "00002-00001482" y
 * "b 00002 00001482" encuentran "B 00002-00001482"). Sin texto, coinciden todas.
 */
export function coincideConLaBusqueda(rendicion: RendicionDelMes, q: string): boolean {
  const texto = normalizarTexto(q);
  if (texto === '') return true;
  if (normalizarTexto(rendicion.cliente.denominacion).includes(texto)) return true;
  const factura = compactarFactura(q);
  return factura !== '' && compactarFactura(rendicion.numeroFactura).includes(factura);
}

/** Las rendiciones que cumplen todos los filtros a la vez (Y), en el mismo orden. */
export function filtrarRendicionesDelMes(
  rendiciones: readonly RendicionDelMes[],
  { estado, tipo, q }: FiltrosDelMes,
): RendicionDelMes[] {
  return rendiciones.filter(
    (rendicion) =>
      (estado === undefined || rendicion.estado === estado) &&
      (tipo === undefined || claveDeTipoDeCliente(rendicion.cliente) === tipo) &&
      (q === undefined || coincideConLaBusqueda(rendicion, q)),
  );
}
