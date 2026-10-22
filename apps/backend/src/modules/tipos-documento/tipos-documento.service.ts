import { Prisma, type TipoDocumento as TipoDocumentoRow } from '@prisma/client';
import {
  normalizarNombreTipoDocumento,
  type ActualizarEstadoTipoDocumentoDto,
  type CreateTipoDocumentoDto,
  type ListarTiposDocumentoQuery,
  type TipoDocumento,
  type UpdateTipoDocumentoDto,
} from '@realpolitik/shared';

import { conflict, notFound, type AppError } from '../../errors/app-error';
import { prisma } from '../../lib/prisma';

import { toTipoDocumentoDto } from './tipo-documento.mapper';

/**
 * Lista el catálogo de tipos de documento (HU2.1). Por defecto solo los activos; con
 * `incluirInactivos`, todos. Sin paginación, según el contrato.
 *
 * Ordena por `nombreNormalizado`: es único, así que el orden es total y no depende de cómo se
 * escribieron las mayúsculas o los acentos. La posición exacta de la `ñ` y de los espacios la
 * decide la collation de la base (ver el contrato, sección 4.1).
 */
export async function listarTiposDocumento({
  incluirInactivos,
}: ListarTiposDocumentoQuery): Promise<TipoDocumento[]> {
  const filas = await prisma.tipoDocumento.findMany({
    where: incluirInactivos ? {} : { activo: true },
    orderBy: { nombreNormalizado: 'asc' },
  });
  return filas.map(toTipoDocumentoDto);
}

/**
 * Crea un tipo de documento (HU2.1). Siempre nace activo.
 *
 * No se consulta antes si el nombre existe: la garantía es el índice único de
 * `nombreNormalizado`, y una preconsulta dejaría pasar dos altas simultáneas. Se intenta crear
 * y, si la base rechaza la clave, se informa qué tipo la tiene, esté activo o no.
 */
export async function crearTipoDocumento(input: CreateTipoDocumentoDto): Promise<TipoDocumento> {
  const nombreNormalizado = normalizarNombreTipoDocumento(input.nombre);
  const creado = await escribirConClave(nombreNormalizado, () =>
    prisma.tipoDocumento.create({
      data: {
        nombre: input.nombre,
        nombreNormalizado,
        descripcion: input.descripcion,
        activo: true,
      },
    }),
  );
  return toTipoDocumentoDto(creado);
}

/**
 * Modifica el nombre y/o la descripción de un tipo (HU2.1), esté activo o no. Lo que el pedido
 * no trae no se toca; `descripcion: null` la borra. `activo` no se cambia acá (ver
 * `cambiarEstadoTipoDocumento`).
 *
 * Un nombre nuevo actualiza también `nombreNormalizado`. Como el `update` no choca con la propia
 * fila, cambiar solo mayúsculas o acentos del nombre propio no es un duplicado. El id no cambia,
 * así que requisitos e ítems siguen apuntando al mismo tipo; los ítems de rendiciones ya
 * abiertas conservan su `nombreTipoDocumento` (ADR-0003, punto 2).
 */
export async function actualizarTipoDocumento(
  id: string,
  input: UpdateTipoDocumentoDto,
): Promise<TipoDocumento> {
  const nombre =
    input.nombre === undefined
      ? undefined
      : { nombre: input.nombre, nombreNormalizado: normalizarNombreTipoDocumento(input.nombre) };
  const data: Prisma.TipoDocumentoUpdateInput = {
    ...nombre,
    ...(input.descripcion !== undefined && { descripcion: input.descripcion }),
  };
  const actualizar = () => prisma.tipoDocumento.update({ where: { id }, data });

  try {
    const actualizado =
      nombre === undefined
        ? await actualizar()
        : await escribirConClave(nombre.nombreNormalizado, actualizar, id);
    return toTipoDocumentoDto(actualizado);
  } catch (error) {
    if (esRegistroInexistente(error)) {
      throw notFound('Tipo de documento no encontrado');
    }
    throw error;
  }
}

// Cuántas veces se vuelve a intentar si el estado cambia entre la escritura condicional y la
// lectura (otro pedido lo cambió justo en medio). Mismo criterio que en clientes.
const INTENTOS_DE_CAMBIO_DE_ESTADO = 3;

/**
 * Activa o desactiva un tipo (HU2.1). Solo cambia `activo`: nombre, descripción, requisitos e
 * ítems de rendiciones no se tocan. Pedir el estado que ya tiene responde con el tipo tal cual,
 * SIN escribir la fila (`updatedAt` no cambia).
 *
 * Igual que `cambiarEstadoCliente`: una sola sentencia decide si hay que escribir (`UPDATE …
 * WHERE id AND activo <> nuevo RETURNING …`). Si no matchea (P2025), el tipo no existe o ya
 * tiene ese estado, y se lee para distinguirlo. De dos pedidos iguales simultáneos solo uno
 * escribe, porque la condición la evalúa PostgreSQL al tomar el lock de la fila. Si al leer el
 * estado ya no es el pedido, otro pedido lo cambió en el medio y se reintenta.
 */
export async function cambiarEstadoTipoDocumento(
  id: string,
  activo: ActualizarEstadoTipoDocumentoDto['activo'],
): Promise<TipoDocumento> {
  for (let intento = 1; intento <= INTENTOS_DE_CAMBIO_DE_ESTADO; intento++) {
    try {
      const actualizado = await prisma.tipoDocumento.update({
        where: { id, activo: { not: activo } },
        data: { activo },
      });
      return toTipoDocumentoDto(actualizado);
    } catch (error) {
      if (!esRegistroInexistente(error)) {
        throw error;
      }
    }

    const actual = await prisma.tipoDocumento.findUnique({ where: { id } });
    if (actual === null) {
      throw notFound('Tipo de documento no encontrado');
    }
    if (actual.activo === activo) {
      return toTipoDocumentoDto(actual);
    }
  }
  throw new Error(
    `El estado del tipo de documento ${id} cambió durante ${INTENTOS_DE_CAMBIO_DE_ESTADO} intentos seguidos.`,
  );
}

// Cuántas veces se reintenta una escritura que chocó con la clave de otro tipo cuando ese tipo
// ya no la tiene al ir a buscarlo (otro pedido lo renombró justo en medio).
const INTENTOS_ANTE_CHOQUE_DE_CLAVE = 3;

/**
 * Ejecuta una escritura que guarda `nombreNormalizado`. Si la base la rechaza por esa clave,
 * busca qué tipo la tiene y responde el conflicto con ese registro. Si ya no hay otro tipo con
 * la clave (lo renombraron entre el rechazo y la búsqueda), la escritura se reintenta: así la
 * respuesta refleja el estado real en vez de un 500. Agotados los intentos, se relanza el error
 * original, que termina en un 500 genérico.
 */
async function escribirConClave(
  nombreNormalizado: string,
  escribir: () => Promise<TipoDocumentoRow>,
  idPropio?: string,
): Promise<TipoDocumentoRow> {
  for (let intento = 1; ; intento++) {
    try {
      return await escribir();
    } catch (error) {
      if (!esNombreDuplicado(error)) {
        throw error;
      }
      const existente = await prisma.tipoDocumento.findUnique({
        where: { nombreNormalizado },
        select: { id: true, nombre: true, activo: true },
      });
      if (existente !== null && existente.id !== idPropio) {
        throw conflictoPorNombre(existente);
      }
      if (intento >= INTENTOS_ANTE_CHOQUE_DE_CLAVE) {
        throw error;
      }
    }
  }
}

// Con PostgreSQL, Prisma 5 informa en `meta.target` los campos del índice violado
// (`['nombreNormalizado']`). Solo ese índice es un nombre duplicado: cualquier otro P2002 sigue
// como error inesperado.
function esNombreDuplicado(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  return Array.isArray(target) && target.length === 1 && target[0] === 'nombreNormalizado';
}

// P2025: el `update` no encontró la fila (no existe, o no cumple el filtro extra del `where`).
function esRegistroInexistente(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

// El conflicto informa el tipo existente aunque esté inactivo: la clave queda reservada igual.
function conflictoPorNombre(
  existente: Pick<TipoDocumentoRow, 'id' | 'nombre' | 'activo'>,
): AppError {
  return conflict(
    'TIPO_DOCUMENTO_DUPLICADO',
    {
      tipoDocumentoExistente: {
        id: existente.id,
        nombre: existente.nombre,
        activo: existente.activo,
      },
    },
    'Ya existe un tipo de documento con ese nombre',
  );
}
