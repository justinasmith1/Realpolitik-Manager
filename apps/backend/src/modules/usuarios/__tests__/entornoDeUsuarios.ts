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
export async function enEspera(db: Consultable, fragmento: string | string[]): Promise<number[]> {
  const patrones = ([] as string[]).concat(fragmento).map((f) => `%${f}%`);
  const filas = await db.$queryRaw<{ pid: number }[]>`
    SELECT pid FROM pg_stat_activity
    WHERE datname = current_database() AND wait_event_type = 'Lock'
      AND pid <> pg_backend_pid() AND query LIKE ANY(${patrones}::text[])`;
  return filas.map((fila) => fila.pid);
}

/**
 * Plazo por defecto de `esperarEnEspera`: lo que antes eran 500 vueltas de 20 ms, ahora medido en
 * tiempo (con una base lenta, cada vuelta tarda más y las 500 superaban el timeout del test). En un
 * entorno sano la espera tarda milisegundos. Un test con el timeout de Vitest (5 s) pasa uno menor,
 * para que este mensaje llegue antes que el timeout.
 */
export const PLAZO_DE_ESPERA_MS = 10_000;

/** El nombre, el código y la última línea de un error (Prisma pone ahí el texto del motor). */
function describirError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const codigo = (error as { code?: unknown }).code;
  const lineas = error.message.split('\n').map((linea) => linea.trim());
  const ultima = lineas.filter((linea) => linea !== '').at(-1) ?? '';
  return `${error.name}${typeof codigo === 'string' ? ` ${codigo}` : ''}: ${ultima.slice(0, 200)}`;
}

/** Cómo terminó una operación que debía seguir esperando (respuesta HTTP, `resultado()` o valor). */
function describirFin(valor: unknown): string {
  if (typeof valor === 'object' && valor !== null) {
    const { status, body, ok, error } = valor as {
      status?: unknown;
      body?: { error?: { code?: unknown } };
      ok?: unknown;
      error?: unknown;
    };
    if (typeof status === 'number') {
      const codigo = body?.error?.code;
      return `respondió ${status}${typeof codigo === 'string' ? ` ${codigo}` : ''}`;
    }
    if (ok === false) return `falló con ${describirError(error)}`;
  }
  return 'se completó';
}

/** Qué hacen las otras conexiones de la base, para el mensaje de una espera que no se cumplió. */
async function actividad(db: Consultable, fragmentos: string[]): Promise<string> {
  try {
    const filas = await db.$queryRaw<
      {
        pid: number;
        estado: string | null;
        espera: string | null;
        ms: number | null;
        consulta: string;
      }[]
    >`
      SELECT pid, state AS "estado",
        wait_event_type || '/' || wait_event AS "espera",
        (extract(epoch FROM now() - query_start) * 1000)::int AS "ms",
        left(regexp_replace(query, '[[:space:]]+', ' ', 'g'), 110) AS "consulta"
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND backend_type = 'client backend' AND state IS DISTINCT FROM 'idle'
      ORDER BY query_start NULLS LAST LIMIT 12`;
    if (filas.length === 0) return '  (ninguna conexión activa ni en transacción)';
    return filas
      .map((f) => {
        const coincide = fragmentos.some((fragmento) => f.consulta.includes(fragmento));
        return `  ${coincide ? '*' : ' '} pid ${f.pid} · ${f.estado ?? '?'} · ${f.espera ?? 'sin espera'} · ${f.ms ?? '?'} ms · ${f.consulta}`;
      })
      .join('\n');
  } catch (error) {
    return `  (no se pudo leer pg_stat_activity: ${describirError(error)})`;
  }
}

/**
 * Espera a que `cantidad` conexiones esperen un bloqueo en una consulta con `fragmento`.
 *
 * Falla con un mensaje que dice qué pasó:
 * - si alguna operación de `mientras` termina antes (por ejemplo, la base rechazó abrir la
 *   transacción), falla en el acto con ese resultado, en vez de seguir esperando;
 * - si se agota `plazoMs`, muestra qué hacían las conexiones de la base en ese momento.
 */
export async function esperarEnEspera(
  db: Consultable,
  fragmento: string | string[],
  cantidad = 1,
  {
    plazoMs = PLAZO_DE_ESPERA_MS,
    mientras = [],
  }: {
    plazoMs?: number;
    /** Operaciones que deben seguir esperando hasta que se cumpla la condición. */
    mientras?: Promise<unknown> | Promise<unknown>[];
  } = {},
): Promise<number[]> {
  const fragmentos = ([] as string[]).concat(fragmento);
  const enQue = `${cantidad} conexión(es) esperando un bloqueo en: ${fragmentos.join(' | ')}`;
  const inicio = Date.now();
  let fin: string | undefined;
  for (const operacion of ([] as Promise<unknown>[]).concat(mientras)) {
    operacion.then(
      (valor) => (fin ??= describirFin(valor)),
      (error: unknown) => (fin ??= `rechazó con ${describirError(error)}`),
    );
  }
  let encontradas = 0;
  for (let consultas = 1; ; consultas += 1) {
    const pids = await enEspera(db, fragmentos);
    if (pids.length >= cantidad) return pids;
    encontradas = pids.length;
    const ms = Date.now() - inicio;
    if (fin !== undefined) {
      throw new Error(
        `esperarEnEspera: una operación terminó antes de quedar esperando (${ms} ms): ${fin}\n` +
          `Se esperaban ${enQue}; había ${encontradas}.`,
      );
    }
    if (ms >= plazoMs) {
      throw new Error(
        `esperarEnEspera: a los ${ms} ms (${consultas} consultas, plazo ${plazoMs} ms) había ` +
          `${encontradas} de ${enQue}.\n` +
          `Conexiones de la base que no están inactivas (* = la consulta coincide):\n` +
          `${await actividad(db, fragmentos)}\n` +
          'Si la consulta no aparece, la operación no llegó a la base (pool, argon2 o un entorno ' +
          'lento); si aparece sin "Lock/…", no quedó bloqueada donde el test supone. Ver ' +
          'docs/development/database.md, "Si falla una prueba de concurrencia".',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
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
