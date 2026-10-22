// Unicidad del nombre de TipoDocumento (HU2.1) y catálogo del seed, contra PostgreSQL REAL.
//
// Prueba lo que un mock no puede: que la base rechaza dos tipos con la misma clave normalizada
// (también si llegan a la vez), que la clave de cada fila coincide con
// `normalizarNombreTipoDocumento`, y cómo se comporta el seed del catálogo (idempotencia y el
// renombre "Orden de compra" → "OC") sobre filas reales.
//
// Igual que las demás suites de integración: sin `TEST_DATABASE_URL` se saltan, y solo corren
// contra una base descartable (`*_audit` o `*_test`) con las migraciones aplicadas. Los tipos de
// prueba llevan una marca única y se borran al final: no se tocan los tipos reales del catálogo.
// Cada test crea sus propios datos, así que ninguno depende de lo que dejó otro ni del orden.

import { randomBytes, randomInt } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';
import { normalizarNombreTipoDocumento as normalizar } from '@realpolitik/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// La misma guarda de base descartable que usan todas las suites de integración. No se copia a
// propósito: dos copias de una guarda de seguridad pueden dejar de coincidir.
import { urlDeBaseDescartable } from '../modules/clientes/__tests__/baseDescartable';

import { sembrarTiposDocumento, type TipoDeCatalogo } from './seed-tipos-documento';

const url = urlDeBaseDescartable();

let prisma: PrismaClient;
const clientesCreados: string[] = [];

/**
 * Marca única de esta corrida (hora + azar, solo ASCII). Todas las claves de prueba empiezan con
 * su versión normalizada: así se reconocen y se borran sin tocar otros tipos.
 */
const MARCA = `TESTHU21${Date.now().toString(36)}${randomBytes(3).toString('hex')}`.toUpperCase();
const MARCA_NORMALIZADA = normalizar(MARCA);

/** Un nombre de prueba: la marca + un texto. */
const n = (texto: string) => `${MARCA} ${texto}`;

beforeAll(() => {
  if (url === undefined) return;
  prisma = new PrismaClient({ datasources: { db: { url } } });
});

afterAll(async () => {
  if (url === undefined) return;
  // Primero lo que apunta a los tipos (Restrict), después los tipos de prueba.
  await prisma.requisitoCliente.deleteMany({ where: { clienteId: { in: clientesCreados } } });
  await prisma.cliente.deleteMany({ where: { id: { in: clientesCreados } } });
  await prisma.tipoDocumento.deleteMany({
    where: { nombreNormalizado: { startsWith: MARCA_NORMALIZADA } },
  });
  await prisma.$disconnect();
});

/** Crea un tipo de prueba como lo hará la aplicación: con la clave calculada por shared. */
function crearTipo(nombre: string, descripcion: string | null = null) {
  return prisma.tipoDocumento.create({
    data: { nombre, nombreNormalizado: normalizar(nombre), descripcion },
  });
}

/** Los tipos de prueba cuya clave es alguna de las de estos nombres. */
function buscar(...nombres: string[]) {
  return prisma.tipoDocumento.findMany({
    where: { nombreNormalizado: { in: nombres.map(normalizar) } },
    orderBy: { nombreNormalizado: 'asc' },
  });
}

/**
 * CUIT único para un cliente de prueba. La base no valida el dígito verificador (varchar(13),
 * @unique). El prefijo 35 no lo usa ninguna otra suite (27, 33, 34, 9X y 99 ya están tomados).
 */
function cuitDePrueba(): string {
  return `35-${String(randomInt(1e8)).padStart(8, '0')}-${randomInt(10)}`;
}

/** Un índice de la tabla TipoDocumento, leído del catálogo de PostgreSQL. */
interface Indice {
  nombre: string;
  unico: boolean;
  columnas: string[];
}

describe.skipIf(url === undefined)('TipoDocumento: unicidad de nombreNormalizado', () => {
  it('rechaza un segundo tipo con la misma clave, aunque el nombre cambie en mayúsculas o acentos', async () => {
    await crearTipo(n('Constancia ARCA'));

    for (const repetido of [n('constancia  arca'), n('Constancía ARCA'), n('CONSTANCIA ARCA ')]) {
      const error: unknown = await crearTipo(repetido).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      const conocido = error as Prisma.PrismaClientKnownRequestError;
      expect(conocido.code).toBe('P2002');
      // El backend reconoce el duplicado por este target (HU2.1, bloque de endpoints).
      expect(conocido.meta?.target).toEqual(['nombreNormalizado']);
    }

    expect(await buscar(n('Constancia ARCA'))).toHaveLength(1);
  });

  it('con dos altas simultáneas del mismo tipo, la base deja pasar solo una', async () => {
    // Sin consulta previa de por medio: lo que decide es el índice único, no la aplicación.
    const resultados = await Promise.allSettled([
      crearTipo(n('Pago simultaneo')),
      crearTipo(n('PAGO SIMULTÁNEO')),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazos = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rechazos).toHaveLength(1);
    const motivo: unknown = rechazos[0]?.reason;
    expect(motivo).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(motivo).toMatchObject({ code: 'P2002' });
    expect(await buscar(n('Pago simultaneo'))).toHaveLength(1);
  });

  it('acepta nombres que solo se parecen: la ñ no es una n', async () => {
    await crearTipo(n('Año'));
    await crearTipo(n('Ano'));

    const filas = await buscar(n('Año'), n('Ano'));
    expect(filas.map((fila) => fila.nombre).sort()).toEqual([n('Ano'), n('Año')].sort());
  });

  it('la unicidad está en el índice de nombreNormalizado, no en uno sobre nombre', async () => {
    // Se miran solo las propiedades que importan: otro índice válido que se agregue a la tabla
    // no rompe este test.
    const indices = await prisma.$queryRaw<Indice[]>`
      SELECT i.relname::text AS nombre,
             x.indisunique AS unico,
             array_agg(a.attname::text ORDER BY k.orden) AS columnas
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        CROSS JOIN LATERAL unnest(x.indkey::int2[]) WITH ORDINALITY AS k(attnum, orden)
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = k.attnum
       WHERE x.indrelid = '"TipoDocumento"'::regclass
       GROUP BY i.relname, x.indisunique`;

    expect(indices).toContainEqual({
      nombre: 'TipoDocumento_nombreNormalizado_key',
      unico: true,
      columnas: ['nombreNormalizado'],
    });
    const unicosSobreNombre = indices.filter((i) => i.unico && i.columnas.join() === 'nombre');
    expect(unicosSobreNombre).toEqual([]);
  });
});

describe.skipIf(url === undefined)('catálogo de tipos de documento del seed', () => {
  /** Un catálogo de prueba propio de cada test. */
  function catalogoDePrueba(sufijo: string): TipoDeCatalogo[] {
    return [
      { nombre: n(`Factura ${sufijo}`), descripcion: null },
      { nombre: n(`Constancía Ñandú ${sufijo}`), descripcion: null },
      { nombre: n(`OC ${sufijo}`), descripcion: 'Orden de compra' },
    ];
  }

  it('crea el catálogo con la clave calculada por shared', async () => {
    const catalogo = catalogoDePrueba('A');

    await sembrarTiposDocumento(prisma, catalogo, []);

    const filas = await buscar(...catalogo.map((tipo) => tipo.nombre));
    expect(filas).toHaveLength(catalogo.length);
    for (const fila of filas) {
      expect(fila.nombreNormalizado).toBe(normalizar(fila.nombre));
      expect(fila.activo).toBe(true);
    }
    expect(filas.find((fila) => fila.nombre === n('OC A'))?.descripcion).toBe('Orden de compra');
    expect(filas.find((fila) => fila.nombre === n('Factura A'))?.descripcion).toBeNull();
  });

  it('es idempotente y respeta lo que se cambió después', async () => {
    const catalogo = catalogoDePrueba('B');
    const nombres = catalogo.map((tipo) => tipo.nombre);
    await sembrarTiposDocumento(prisma, catalogo, []);
    const antes = await buscar(...nombres);
    expect(antes).toHaveLength(catalogo.length);

    // Alguien desactivó un tipo y le cargó una descripción: el seed no lo pisa.
    const factura = antes.find((fila) => fila.nombre === n('Factura B'));
    if (factura === undefined) throw new Error('El seed no creó el tipo de prueba "Factura B".');
    await prisma.tipoDocumento.update({
      where: { id: factura.id },
      data: { activo: false, descripcion: 'Cargada a mano' },
    });

    await sembrarTiposDocumento(prisma, catalogo, []);
    await sembrarTiposDocumento(prisma, catalogo, []);

    const despues = await buscar(...nombres);
    expect(despues.map((fila) => fila.id)).toEqual(antes.map((fila) => fila.id));
    const facturaDespues = despues.find((fila) => fila.id === factura.id);
    expect(facturaDespues?.activo).toBe(false);
    expect(facturaDespues?.descripcion).toBe('Cargada a mano');
  });
});

describe.skipIf(url === undefined)('seed: renombre "Orden de compra" → "OC"', () => {
  /** Catálogo y renombre de prueba, con nombres propios de cada test. */
  function escenario(sufijo: string) {
    const anterior = n(`Orden de compra ${sufijo}`);
    const nuevo = n(`OC ${sufijo}`);
    return {
      anterior,
      nuevo,
      catalogo: [{ nombre: nuevo, descripcion: 'Orden de compra' }],
      renombres: [{ anterior, nuevo }],
    };
  }

  it('renombra la MISMA fila: conserva el id y los requisitos que la usan', async () => {
    const { anterior, nuevo, catalogo, renombres } = escenario('R1');
    const viejo = await crearTipo(anterior);
    // Un requisito real apuntando al tipo viejo (FK Restrict).
    const cliente = await prisma.cliente.create({
      data: {
        razonSocial: `${MARCA} renombre`,
        denominacion: MARCA,
        cuit: cuitDePrueba(),
        ivaCondicion: 'EXENTO',
        emailContacto: 'renombre@ejemplo.example',
        sector: 'PRIVADO',
      },
    });
    clientesCreados.push(cliente.id);
    const requisito = await prisma.requisitoCliente.create({
      data: { clienteId: cliente.id, tipoDocumentoId: viejo.id },
    });

    const aplicados = await sembrarTiposDocumento(prisma, catalogo, renombres);

    expect(aplicados).toEqual(renombres);
    const filas = await buscar(anterior, nuevo);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      id: viejo.id,
      nombre: nuevo,
      nombreNormalizado: normalizar(nuevo),
      descripcion: 'Orden de compra',
    });
    const requisitoDespues = await prisma.requisitoCliente.findUnique({
      where: { id: requisito.id },
    });
    expect(requisitoDespues?.tipoDocumentoId).toBe(viejo.id);

    // Otra corrida no vuelve a renombrar ni crea nada.
    expect(await sembrarTiposDocumento(prisma, catalogo, renombres)).toEqual([]);
    expect((await buscar(anterior, nuevo)).map((fila) => fila.id)).toEqual([viejo.id]);
  });

  it('conserva la descripción que ya tenía la fila', async () => {
    const { anterior, nuevo, catalogo, renombres } = escenario('R2');
    const viejo = await crearTipo(anterior, 'Descripción propia');

    await sembrarTiposDocumento(prisma, catalogo, renombres);

    const [fila] = await buscar(nuevo);
    expect(fila).toMatchObject({ id: viejo.id, nombre: nuevo, descripcion: 'Descripción propia' });
  });

  it('si ya existe solo el nombre nuevo, no crea otra fila', async () => {
    const { anterior, nuevo, catalogo, renombres } = escenario('R3');
    const existente = await crearTipo(nuevo, 'Orden de compra');

    expect(await sembrarTiposDocumento(prisma, catalogo, renombres)).toEqual([]);

    expect((await buscar(anterior, nuevo)).map((fila) => fila.id)).toEqual([existente.id]);
  });

  it('si existen el nombre viejo y el nuevo, falla con un error claro y no toca nada', async () => {
    const { anterior, nuevo, catalogo, renombres } = escenario('R4');
    const viejo = await crearTipo(anterior);
    const actual = await crearTipo(nuevo);

    await expect(sembrarTiposDocumento(prisma, catalogo, renombres)).rejects.toThrow(
      /ya existen los dos .*no los fusiona/,
    );

    const filas = await buscar(anterior, nuevo);
    expect(filas.map((fila) => [fila.id, fila.nombre]).sort()).toEqual(
      [
        [viejo.id, anterior],
        [actual.id, nuevo],
      ].sort(),
    );
  });

  it('falla antes de escribir si el propio catálogo repite un tipo', async () => {
    const repetido: TipoDeCatalogo[] = [
      { nombre: n('Repetido'), descripcion: null },
      { nombre: n('REPETÍDO'), descripcion: null },
    ];

    await expect(sembrarTiposDocumento(prisma, repetido, [])).rejects.toThrow(/repite un nombre/);
    expect(await buscar(n('Repetido'))).toEqual([]);
  });
});

describe.skipIf(url === undefined)('coherencia de la clave en toda la tabla', () => {
  it('nombreNormalizado de cada fila es exactamente normalizarNombreTipoDocumento(nombre)', async () => {
    // Incluye las filas que completó la migración de HU2.1 y las del seed, si la base las tiene.
    const filas = await prisma.tipoDocumento.findMany({
      select: { nombre: true, nombreNormalizado: true },
    });
    const distintas = filas.filter((fila) => fila.nombreNormalizado !== normalizar(fila.nombre));
    expect(distintas).toEqual([]);
  });
});
