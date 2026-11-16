// Piezas comunes de las suites de integración de la administración de usuarios (PostgreSQL real).
//
// - Todas las cuentas llevan en el email la marca de la corrida y solo esas se borran: nunca se
//   tocan cuentas ajenas (por ejemplo, la de QA manual).
// - El login es el de producción (`iniciarSesion` → `crearSesion`), con la conexión de
//   `lib/prisma`; los servicios administrativos reciben otros `PrismaClient` (conexiones propias),
//   como dos procesos distintos.
// - `retenerFilas` y `esperarEnEspera` ordenan las carreras con bloqueos reales de PostgreSQL, sin
//   esperas a ciegas.

import { type Prisma, PrismaClient, type RolUsuario } from '@prisma/client';
import { vi } from 'vitest';

export const PASSWORD = 'tranvía ámbar sobre el puente 47';

export function nuevaMarca(prefijo: string): string {
  return `${prefijo}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const conexion = (url: string) => new PrismaClient({ datasourceUrl: url, log: [] });

/** Lo único que la guarda usa de una conexión: consultas de lectura. */
export type Consultable = Pick<PrismaClient, '$queryRaw'>;
type Abrir = (url: string) => Consultable & Pick<PrismaClient, '$disconnect'>;

const BASE_DESCARTABLE = /_(audit|test)$/;

const nombreDeLaBase = (url: string) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));

/**
 * A qué base está conectada de verdad una conexión: el nombre (`current_database()`) y una huella
 * del servidor (inicio del postmaster y puerto), para distinguir dos servidores con una base del
 * mismo nombre. Solo lee.
 */
async function identidad(db: Consultable): Promise<{ base: string; servidor: string }> {
  const [fila] = await db.$queryRaw<{ base: string; servidor: string }[]>`
    SELECT current_database() AS "base",
      pg_postmaster_start_time()::text || '@' || coalesce(inet_server_port()::text, 'socket') AS "servidor"`;
  if (fila === undefined) throw new Error('La base no informó su identidad: no se ejecuta nada.');
  return fila;
}

/**
 * Guarda de aislamiento, ANTES de cualquier escritura (también de los datos de prueba):
 * 1. el nombre de `url` (la de `TEST_DATABASE_URL`) tiene que ser `*_audit` o `*_test`;
 * 2. una conexión de referencia abierta con esa misma `url` tiene que estar en esa base;
 * 3. cada conexión de la suite tiene que estar en la MISMA base y el mismo servidor que la
 *    referencia. Un `TEST_DATABASE_URL` válido no alcanza: atrapa, por ejemplo, un `lib/prisma`
 *    cargado antes de fijar `DATABASE_URL`, que tomaría la base del `.env`.
 * Si algo no coincide, lanza y no escribe nada. `abrir` existe para los tests de la guarda.
 */
export async function exigirBaseDePrueba(
  url: string,
  conexiones: Consultable[],
  { abrir = conexion }: { abrir?: Abrir } = {},
): Promise<void> {
  const esperada = nombreDeLaBase(url);
  if (!BASE_DESCARTABLE.test(esperada)) {
    throw new Error(
      `"${esperada}" no es una base descartable (*_audit o *_test): no se ejecuta nada.`,
    );
  }
  const referencia = abrir(url);
  let deLaUrl: { base: string; servidor: string };
  try {
    deLaUrl = await identidad(referencia);
  } finally {
    await referencia.$disconnect();
  }
  if (deLaUrl.base !== esperada) {
    throw new Error(
      `La URL de prueba lleva a "${deLaUrl.base}", no a "${esperada}": no se ejecuta nada.`,
    );
  }
  for (const db of conexiones) {
    const efectiva = await identidad(db);
    if (efectiva.base !== deLaUrl.base || efectiva.servidor !== deLaUrl.servidor) {
      throw new Error(
        `Una conexión de la suite apunta a "${efectiva.base}" y no a "${esperada}" de ese servidor: no se ejecuta nada.`,
      );
    }
  }
}

/** Una conexión nueva, ya verificada con `exigirBaseDePrueba`. */
export async function conexionVerificada(url: string): Promise<PrismaClient> {
  const db = conexion(url);
  try {
    await exigirBaseDePrueba(url, [db]);
  } catch (error) {
    await db.$disconnect();
    throw error;
  }
  return db;
}

export interface Cuentas {
  crear(opciones?: {
    rol?: RolUsuario;
    activo?: boolean;
    debeCambiarPassword?: boolean;
    nombre?: string;
    alias?: string;
  }): Promise<{ id: string; email: string; nombre: string; rol: RolUsuario }>;
  email(alias: string): string;
  limpiar(): Promise<void>;
  propias: Prisma.UsuarioWhereInput;
}

type Escribible = Consultable & Pick<PrismaClient, 'usuario'>;

/**
 * Cuentas de prueba con la marca, todas con `PASSWORD` (hash calculado una vez). Primero pasa la
 * guarda (`exigirBaseDePrueba`) sobre `prisma` y `otras`: si falla, rechaza sin haber escrito nada
 * y la suite no arranca (vitest no corre los tests de un `beforeAll` que lanzó).
 */
export async function cuentasDePrueba({
  url,
  prisma,
  otras = [],
  marca,
  hash,
  abrir,
}: {
  url: string;
  prisma: Escribible;
  otras?: Consultable[];
  marca: string;
  hash: string;
  abrir?: Abrir;
}): Promise<Cuentas> {
  await exigirBaseDePrueba(url, [prisma, ...otras], abrir === undefined ? {} : { abrir });
  let secuencia = 0;
  const email = (alias: string) => `${marca}-${alias}@pruebas.example`;
  // Con el guion: la marca de otra corrida que empiece igual no queda incluida.
  const propias = { email: { startsWith: `${marca}-` } };
  return {
    email,
    propias,
    async crear({
      rol = 'ADMINISTRATIVO',
      activo = true,
      debeCambiarPassword = false,
      nombre,
      alias,
    } = {}) {
      secuencia += 1;
      return prisma.usuario.create({
        data: {
          email: email(alias ?? `u${secuencia}`),
          nombre: nombre ?? `Persona ${marca} ${secuencia}`,
          rol,
          activo,
          debeCambiarPassword,
          passwordHash: hash,
          passwordActualizadaEn: new Date('2026-01-01T00:00:00.000Z'),
        },
        select: { id: true, email: true, nombre: true, rol: true },
      });
    },
    async limpiar() {
      // Las sesiones se borran en cascada con su usuario.
      await prisma.usuario.deleteMany({ where: propias });
    },
  };
}

export interface EventoRegistrado {
  /** Un `EventoAdministrativo` o un evento de autenticación. */
  evento: string;
  actorId?: string;
  usuarioId?: string;
  [clave: string]: unknown;
}

/** Captura las líneas de eventos (sin dejarlas salir) y devuelve las administrativas parseadas. */
export function capturarEventos() {
  const escritura = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const lineas = () => escritura.mock.calls.map(([texto]) => String(texto));
  return {
    lineas,
    administrativos(): EventoRegistrado[] {
      return lineas()
        .filter((linea) => linea.startsWith('{'))
        .map((linea) => JSON.parse(linea) as EventoRegistrado)
        .filter(
          (e) => e.evento.startsWith('usuarios.') || e.evento === 'auth.password.restablecida',
        );
    },
    soltar: () => escritura.mockRestore(),
  };
}

/**
 * PIDs de las conexiones que esperan un bloqueo (de fila, de aviso o de transacción) con una
 * consulta que contiene alguno de los fragmentos.
 */
export async function enEspera(db: PrismaClient, fragmento: string | string[]): Promise<number[]> {
  const patrones = ([] as string[]).concat(fragmento).map((f) => `%${f}%`);
  const filas = await db.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND query LIKE ANY(${patrones}::text[])`;
  return filas.map((fila) => fila.pid);
}

/** Espera a que `cantidad` conexiones esperen un bloqueo en una consulta con `fragmento`. */
export async function esperarEnEspera(
  db: PrismaClient,
  fragmento: string | string[],
  cantidad = 1,
): Promise<number[]> {
  for (let i = 0; i < 500; i += 1) {
    const pids = await enEspera(db, fragmento);
    if (pids.length >= cantidad) return pids;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `no hay ${cantidad} conexión(es) esperando en: ${([] as string[]).concat(fragmento).join(' | ')}`,
  );
}

/**
 * Retiene `FOR UPDATE` sobre filas de una tabla desde `db` hasta `soltar()`, como otra transacción
 * en curso. Devuelve cuando el bloqueo ya está tomado.
 */
export async function retenerFilas(db: PrismaClient, tabla: 'Usuario' | 'Sesion', ids: string[]) {
  let soltar!: () => void;
  const suelta = new Promise<void>((resolve) => (soltar = resolve));
  let tomada!: () => void;
  const lista = new Promise<void>((resolve) => (tomada = resolve));
  const transaccion = db.$transaction(
    async (tx) => {
      if (tabla === 'Usuario') {
        await tx.$queryRaw`SELECT "id" FROM "Usuario" WHERE "id" = ANY(${ids}::uuid[]) FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT "id" FROM "Sesion" WHERE "id" = ANY(${ids}::uuid[]) FOR UPDATE`;
      }
      tomada();
      await suelta;
    },
    { timeout: 60_000 },
  );
  await Promise.race([lista, transaccion]);
  const liberar = async () => {
    retenidas.delete(liberar);
    soltar();
    await transaccion.catch(() => undefined);
  };
  retenidas.add(liberar);
  return {
    async soltar() {
      retenidas.delete(liberar);
      soltar();
      await transaccion;
    },
  };
}

/** Bloqueos retenidos que un test todavía no soltó (por ejemplo, porque falló antes). */
const retenidas = new Set<() => Promise<void>>();

/**
 * Suelta todo lo que siga retenido. Va en `afterEach`, antes de limpiar: así un test que falla no
 * deja filas bloqueadas que hagan esperar (y vencer) a los siguientes.
 */
export async function soltarRetenidas(): Promise<void> {
  await Promise.all([...retenidas].map((liberar) => liberar()));
}

/** Consultas reconocibles en `pg_stat_activity`. */
export const CONSULTA = {
  /** El bloqueo de la fila del usuario en la administración (`bloquearUsuario`). */
  bloqueoAdministrativo: 'usuarios:bloquear-usuario',
  /** El bloqueo de aviso de la composición de administradores. */
  bloqueoDeAdministradores: 'usuarios:bloquear-administradores',
  /** El bloqueo de la fila del usuario en `crearSesion` (login). */
  bloqueoDelLogin: 'auth:crear-sesion',
  /** La revocación de sesiones (`revocarSesionesDeUsuario`). */
  revocacion: 'UPDATE "Sesion"',
} as const;
