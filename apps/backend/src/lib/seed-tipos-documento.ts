// Catálogo de tipos de documento que carga el seed (`prisma/seed.ts`). Está separado del seed
// para poder probarlo contra una base descartable sin ejecutar el seed completo (que borra los
// clientes). Solo toca la tabla TipoDocumento.
//
// - Idempotente: se busca por `nombreNormalizado` (la clave de unicidad, ADR-0003) y lo que ya
//   existe no se pisa. Un tipo desactivado o con la descripción cambiada queda como está.
// - Renombres: un nombre viejo del catálogo que ya esté en la base se renombra en la MISMA fila
//   (mismo id), así los requisitos y rendiciones que apuntan a él no se tocan. Si están el nombre
//   viejo y el nuevo a la vez, no se adivina cuál conservar: falla con un error claro.

import type { PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento } from '@realpolitik/shared';

export interface TipoDeCatalogo {
  nombre: string;
  /** Solo si el negocio la confirmó; si no, `null`. */
  descripcion: string | null;
}

/** Catálogo validado con la administradora (HU2.1). La única descripción confirmada es la de OC. */
export const CATALOGO_TIPOS_DOCUMENTO: readonly TipoDeCatalogo[] = [
  { nombre: 'Factura', descripcion: null },
  { nombre: 'Print', descripcion: null },
  { nombre: 'Constancia escrita', descripcion: null },
  { nombre: 'CAE', descripcion: null },
  { nombre: 'OC', descripcion: 'Orden de compra' },
  { nombre: 'Constancia ARCA', descripcion: null },
  { nombre: 'Libre deuda', descripcion: null },
  { nombre: 'Pago IIBB', descripcion: null },
  { nombre: 'Constancia IIBB', descripcion: null },
];

export interface RenombreDeCatalogo {
  anterior: string;
  nuevo: string;
}

/** Nombres que el catálogo tuvo antes y pueden seguir en una base de desarrollo. */
export const RENOMBRES_TIPOS_DOCUMENTO: readonly RenombreDeCatalogo[] = [
  // El seed de T2.1 lo cargaba como "Orden de compra"; el nombre validado es "OC".
  { anterior: 'Orden de compra', nuevo: 'OC' },
];

/**
 * Carga el catálogo de tipos de documento. Devuelve los renombres que aplicó (para informarlos
 * en la consola del seed). Recibe el catálogo y los renombres como parámetros para que los tests
 * usen datos propios sin tocar los tipos reales.
 */
export async function sembrarTiposDocumento(
  db: PrismaClient,
  catalogo: readonly TipoDeCatalogo[] = CATALOGO_TIPOS_DOCUMENTO,
  renombres: readonly RenombreDeCatalogo[] = RENOMBRES_TIPOS_DOCUMENTO,
): Promise<RenombreDeCatalogo[]> {
  exigirClavesDistintas(catalogo);

  const aplicados: RenombreDeCatalogo[] = [];
  for (const renombre of renombres) {
    if (await renombrar(db, catalogo, renombre)) aplicados.push(renombre);
  }

  for (const tipo of catalogo) {
    const nombreNormalizado = normalizarNombreTipoDocumento(tipo.nombre);
    await db.tipoDocumento.upsert({
      where: { nombreNormalizado },
      update: {},
      create: { nombre: tipo.nombre, nombreNormalizado, descripcion: tipo.descripcion },
    });
  }
  return aplicados;
}

/** Dos tipos del catálogo con la misma clave serían el mismo: es un error del propio catálogo. */
function exigirClavesDistintas(catalogo: readonly TipoDeCatalogo[]): void {
  const vistas = new Map<string, string>();
  for (const { nombre } of catalogo) {
    const clave = normalizarNombreTipoDocumento(nombre);
    const anterior = vistas.get(clave);
    if (anterior !== undefined) {
      throw new Error(
        `El catálogo de tipos de documento repite un nombre: "${anterior}" y "${nombre}" son el mismo tipo.`,
      );
    }
    vistas.set(clave, nombre);
  }
}

/** Renombra en la misma fila. `true` si renombró; `false` si no había nada que renombrar. */
async function renombrar(
  db: PrismaClient,
  catalogo: readonly TipoDeCatalogo[],
  { anterior, nuevo }: RenombreDeCatalogo,
): Promise<boolean> {
  const claveNueva = normalizarNombreTipoDocumento(nuevo);
  const viejo = await db.tipoDocumento.findUnique({
    where: { nombreNormalizado: normalizarNombreTipoDocumento(anterior) },
  });
  if (viejo === null) return false;

  const actual = await db.tipoDocumento.findUnique({ where: { nombreNormalizado: claveNueva } });
  if (actual !== null) {
    throw new Error(
      `No se puede renombrar el tipo de documento "${viejo.nombre}" a "${nuevo}": ya existen los ` +
        `dos ("${viejo.nombre}" y "${actual.nombre}"). El seed no los fusiona porque requisitos y ` +
        'rendiciones pueden apuntar a cualquiera de ellos. Resolvelo a mano y volvé a ejecutarlo.',
    );
  }

  const descripcionDelCatalogo =
    catalogo.find((tipo) => normalizarNombreTipoDocumento(tipo.nombre) === claveNueva)
      ?.descripcion ?? null;
  // La descripción del catálogo solo completa una fila que no tenía; nunca pisa una cargada.
  const completarDescripcion =
    descripcionDelCatalogo !== null && (viejo.descripcion ?? '').trim() === '';
  await db.tipoDocumento.update({
    where: { id: viejo.id },
    data: {
      nombre: nuevo,
      nombreNormalizado: claveNueva,
      ...(completarDescripcion && { descripcion: descripcionDelCatalogo }),
    },
  });
  return true;
}
