# QA manual del rol Consulta (HU4.3) — solo local

> **Procedimiento exclusivamente local.** Sirve para validar a mano, en el navegador, lo que `CONSULTA` ve y puede hacer. Usa la base de pruebas `realpolitik_test` del PostgreSQL local (contenedor `db` de Docker Compose, publicado en `127.0.0.1`). **Nunca** se ejecuta contra `realpolitik_db`, `realpolitik_audit`, Railway ni ninguna base con datos reales. No hay registro público ni endpoint para crear usuarios: hasta HU4.5, la cuenta se crea con este procedimiento técnico.

Este documento no contiene contraseñas, cookies, tokens ni credenciales. La contraseña temporal la elige quien hace la QA, la escribe en su terminal y la guarda por sus propios medios.

## 1. Antes de empezar: el entorno

1. **Backend de prueba con el código actual.** El que use la interfaz (por ejemplo, un contenedor que monte el repositorio y corra `node --import tsx src/server.ts` contra `realpolitik_test`) tiene que haberse **reiniciado después del último cambio**: sin modo _watch_, sigue corriendo el código con el que arrancó. Reiniciar el contenedor sirve si monta el árbol de trabajo (bind mount); no sirve si usa una imagen construida antes.
2. **Cliente Prisma al día.** Si el backend usa `node_modules` propios (un volumen de Docker), el cliente Prisma generado ahí tiene que corresponder al `schema.prisma` actual. Un síntoma de que está desactualizado es un `500` con `PrismaClientValidationError` en `GET /rendiciones?anio=&mes=` (no conoce `cobroFecha`, HU3.10). Se corrige regenerándolo dentro del contenedor (`pnpm --filter @realpolitik/backend db:generate`) y reiniciándolo: no toca la base.
3. **Qué base usa de verdad.** Confirmar sin mostrar credenciales que el proceso del backend tiene `DATABASE_URL` hacia `realpolitik_test` (por ejemplo, el nombre de la base en `/proc/1/environ` del contenedor).
4. **Documentos.** En `development` y `test` los endpoints de documentos se montan por defecto (almacenamiento en memoria o disco, según la configuración). En el despliegue siguen deshabilitados hasta su [procedimiento de habilitación](../deployment.md#habilitación-de-documentos-en-el-despliegue-de-demostración-hu44) (HU4.4 dejó los permisos verificados, no la infraestructura). No se habilitan en el despliegue para esta QA. Usá solo archivos ficticios.

## 2. Crear la cuenta CONSULTA de QA

El script vive **fuera del repositorio** (no forma parte del PR). Su código está al final de este documento, para que se pueda volver a crear.

Qué hace, en este orden, y qué no hace:

- **Destino fijo:** `127.0.0.1`, el puerto de `POSTGRES_PORT` (5432 por defecto) y la base `realpolitik_test`. El usuario y la clave de PostgreSQL salen del `.env` de la raíz y nunca se imprimen. No acepta otra base por parámetro ni variable.
- **Verificación de solo lectura** (transacción `READ ONLY`): `current_database()` tiene que ser exactamente `realpolitik_test` y el servidor PostgreSQL 16; no puede existir ya una cuenta `qa.consulta.…`. Si algo no coincide, termina sin escribir.
- **Contraseña temporal:** se escribe dos veces en una terminal interactiva, sin eco. No va en argumentos, no se guarda en archivos ni se imprime. Se valida con la política de la app (`ContrasenaNuevaSchema` y `evaluarContrasenaNueva`) y se guarda con Argon2id (`hashearContrasena`).
- **Alta:** una sola cuenta, `QA Consulta`, rol `CONSULTA`, activa, con `debeCambiarPassword`. El email lleva una marca única: `qa.consulta.<8 hex>@qa-local.example`.
- **No** crea sesiones, no modifica ni borra otras cuentas, no cambia roles, no toca clientes, requisitos, rendiciones ni documentos, no corre migraciones ni seeds.

Uso, en una terminal interactiva (PowerShell o cmd; en Git Bash, anteponer `winpty`):

```bash
cd apps/backend            # desde la raíz del repositorio
node --import tsx <ruta-fuera-del-repo>/crear-cuenta-qa-consulta.mts
```

Al terminar imprime el email, el rol, el estado y `debeCambiarPassword: true`. Anotá el email; la contraseña no se vuelve a mostrar.

## 3. Primer ingreso

1. Abrir el frontend local (por ejemplo, `http://localhost:5173`) e iniciar sesión con el email de QA y la contraseña temporal.
2. La app lleva a "Configurá tu contraseña": no se ve el shell ni datos. Probar una URL directa (`/clientes`): vuelve al cambio.
3. Elegir la contraseña definitiva. Con el cambio, la sesión termina y `/login` dice "Elegiste tu contraseña. Ingresá con la nueva.".
4. Entrar con la definitiva: se ve el shell; el menú de cuenta muestra `QA Consulta`, el email y el rol "Consulta".

## 4. Checklist

Marcá cada fila con **Aprobado**, **Falló**, **No aplica** o **Pendiente**. Cuando algo falla, anotá: la pantalla y la URL (con su query), el rol de la sesión, qué esperabas y qué pasó, una captura **sin datos de sesión** y, si hubo un pedido a la API, el método, la ruta y el status (de las herramientas del navegador, **sin copiar cookies ni cabeceras**).

### 4.1 Primer ingreso y cuenta

| #   | Verificación                                                    | Resultado |
| --- | --------------------------------------------------------------- | --------- |
| 1.1 | Login con la cuenta CONSULTA                                    |           |
| 1.2 | Cambio obligatorio de la contraseña temporal                    |           |
| 1.3 | Antes del cambio, ninguna pantalla de negocio (ni por URL)      |           |
| 1.4 | Nuevo login con la definitiva                                   |           |
| 1.5 | Shell visible; menú de cuenta con nombre, email y rol correctos |           |

### 4.2 Clientes

| #   | Verificación                                                                     | Resultado |
| --- | -------------------------------------------------------------------------------- | --------- |
| 2.1 | Listado de clientes                                                              |           |
| 2.2 | Búsqueda y filtros (estado, sector, subtipo)                                     |           |
| 2.3 | "Ver ficha": datos completos, sin campos editables                               |           |
| 2.4 | Datos condicionales (subtipo, portal, WhatsApp, periodicidad)                    |           |
| 2.5 | Indicaciones de armado en la ficha                                               |           |
| 2.6 | Observaciones internas en la ficha                                               |           |
| 2.7 | "Ver contactos": nombre, área, email, recibe rendiciones                         |           |
| 2.8 | Clientes inactivos (filtro de estado)                                            |           |
| 2.9 | Sin "Nuevo cliente", "Editar", "Contactos" (editor), "Desactivar" ni "Reactivar" |           |

### 4.3 Requisitos

| #   | Verificación                                                       | Resultado |
| --- | ------------------------------------------------------------------ | --------- |
| 3.1 | Listado de requisitos por cliente                                  |           |
| 3.2 | Filtros (Todos, Configurados, Pendientes) y orden                  |           |
| 3.3 | Matriz de un cliente                                               |           |
| 3.4 | Requisitos existentes, con canal y días                            |           |
| 3.5 | Matriz vacía: solo el título, sin instrucciones                    |           |
| 3.6 | Sin alta, edición, baja ni "Añadir requisitos a varios clientes"   |           |
| 3.7 | Cliente inactivo: sin el aviso "debe estar activo para modificar…" |           |

### 4.4 Rendiciones

| #    | Verificación                                                                   | Resultado |
| ---- | ------------------------------------------------------------------------------ | --------- |
| 4.1  | Pantalla del mes (cambio de mes)                                               |           |
| 4.2  | Rendiciones atrasadas                                                          |           |
| 4.3  | Filtros por estado y tipo de cliente                                           |           |
| 4.4  | Rendiciones de un cliente (en su matriz), con filtros y anuladas               |           |
| 4.5  | Detalle: período, factura, emisor, estado, vigencia, avance                    |           |
| 4.6  | Checklist con estado y canal de cada ítem; "Sin documento" en los pendientes   |           |
| 4.7  | "Ver solo faltantes"                                                           |           |
| 4.8  | Historial de estados                                                           |           |
| 4.9  | OC, monto mensual y monto total                                                |           |
| 4.10 | Cobro con fecha y nota, o "Sin cobro registrado"                               |           |
| 4.11 | Rendición anulada (fecha de anulación) y rechazada (motivo)                    |           |
| 4.12 | Sin cambios de estado, "Editar OC", cobro, casillas, "Enviar", canal ni anular |           |

### 4.5 Documentos (con los endpoints documentales habilitados en el entorno local)

| #   | Verificación                                        | Resultado |
| --- | --------------------------------------------------- | --------- |
| 5.1 | Repositorio del período                             |           |
| 5.2 | Búsqueda y filtros (mes, año, tipo)                 |           |
| 5.3 | Detalle de un documento                             |           |
| 5.4 | Dónde está vigente (aplicaciones)                   |           |
| 5.5 | Historial (reemplazados)                            |           |
| 5.6 | Descargar (listado, detalle e historial de un ítem) |           |
| 5.7 | Sin "Cargar documento", "Aplicar" ni reemplazar     |           |
| 5.8 | Vista previa de un PDF y de una imagen (HU3.11)     |           |
| 5.9 | Un DOCX solo ofrece descargar                       |           |

Si el backend local no monta los documentos, registrá esta sección como **No aplica (documentos deshabilitados)**, aparte del resto.

### 4.6 Tipos de documento

| #   | Verificación                                            | Resultado |
| --- | ------------------------------------------------------- | --------- |
| 6.1 | Catálogo                                                |           |
| 6.2 | Descripciones                                           |           |
| 6.3 | Estados (activo, desactivado)                           |           |
| 6.4 | "Incluir desactivados"                                  |           |
| 6.5 | Sin "Nuevo tipo", "Editar", "Desactivar" ni "Reactivar" |           |
| 6.6 | El nombre es texto, no un botón                         |           |
| 6.7 | Tabla (escritorio) y tarjetas (celular)                 |           |

### 4.7 Sesiones

| #   | Verificación                                                                  | Resultado |
| --- | ----------------------------------------------------------------------------- | --------- |
| 7.1 | Cerrar sesión                                                                 |           |
| 7.2 | Volver a la página pedida tras el login (`volverA`, con su query)             |           |
| 7.3 | Cambio voluntario de contraseña (menú de cuenta)                              |           |
| 7.4 | Tras el cambio voluntario, la sesión sigue en la misma pantalla               |           |
| 7.5 | Otra sesión de la misma cuenta (otro navegador) se cierra con ese cambio      |           |
| 7.6 | Avisos de sesión vencida o terminada                                          |           |
| 7.7 | Sin conectividad (backend apagado): "Servicio no disponible", la sesión sigue |           |

### 4.8 Responsive y accesibilidad (escritorio y celular)

| #   | Verificación                                                    | Resultado |
| --- | --------------------------------------------------------------- | --------- |
| 8.1 | Navegación                                                      |           |
| 8.2 | Tablas y tarjetas legibles                                      |           |
| 8.3 | Abrir y cerrar paneles (ficha, contactos, detalle de documento) |           |
| 8.4 | El foco vuelve a lo que abrió el panel                          |           |
| 8.5 | Navegación por teclado                                          |           |
| 8.6 | Ningún botón sin acción ni menú vacío                           |           |
| 8.7 | Sin desbordamiento horizontal                                   |           |
| 8.8 | Mensajes de error y estados vacíos neutros                      |           |

El cierre del cajón móvil al navegar es un pendiente conocido de HU4.2; registralo solo si aparece algo nuevo causado por HU4.3.

### 4.9 Seguridad: la API directa (solo contra el backend de `realpolitik_test`)

Con una sesión CONSULTA iniciada **en el navegador**, desde las herramientas del navegador (pestaña Red o consola de la misma pestaña, para que viaje la cookie `HttpOnly` sin copiarla):

| #   | Pedido                                                     | Esperado                           | Resultado |
| --- | ---------------------------------------------------------- | ---------------------------------- | --------- |
| 9.1 | `GET /api/clientes`                                        | 200                                |           |
| 9.2 | `POST /api/tipos-documento` con `Origin` del sitio         | 403 `PERMISO_INSUFICIENTE`         |           |
| 9.3 | `GET /api/clientes/<id>/ultima-oc`                         | 403 `PERMISO_INSUFICIENTE`         |           |
| 9.4 | `GET /api/clientes` sin sesión (ventana privada)           | 401                                |           |
| 9.5 | `GET /api/clientes` con la contraseña temporal sin cambiar | 403 `CAMBIO_DE_PASSWORD_REQUERIDO` |           |
| 9.6 | `POST /api/documentos` (HU4.4, con documentos montados)    | 403 `PERMISO_INSUFICIENTE`         |           |
| 9.7 | `GET /api/documentos/<id>/archivo` sin sesión              | 401, sin el archivo                |           |

No compartas cookies ni capturas con cabeceras. Las automatizadas equivalentes están en `consultaSoloLectura.api.test.tsx`.

## 5. Al terminar la QA

La cuenta no se borra sola: queda para volver a probar. Cuando la QA termine, y con la autorización de quien la pidió, se desactiva (`activo = false`) y se revocan sus sesiones con un procedimiento equivalente, también limitado a `realpolitik_test` y a esa cuenta.

## Anexo: el script

Guardalo **fuera del repositorio** como `crear-cuenta-qa-consulta.mts`:

```ts
// Cuenta CONSULTA para la QA manual de HU4.3, SOLO en realpolitik_test del PostgreSQL local.
// Se ejecuta desde apps/backend (ver qa-consulta.md). Vive fuera del repositorio.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Se ejecuta desde apps/backend del repositorio (ahí resuelve Prisma, shared y el código de auth).
const BACKEND = process.cwd().split('\\').join('/');
const RAIZ = resolve(BACKEND, '../..').split('\\').join('/');
if (JSON.parse(readFileSync(`${BACKEND}/package.json`, 'utf8')).name !== '@realpolitik/backend') {
  console.error('ABORTA: ejecutalo desde apps/backend del repositorio. No se creó ninguna cuenta.');
  process.exit(1);
}
const BASE = 'realpolitik_test';
const PREFIJO = 'qa.consulta.';
const DOMINIO = '@qa-local.example';

const requerir = createRequire(`${BACKEND}/package.json`);
const { PrismaClient } = requerir('@prisma/client') as typeof import('@prisma/client');
const { ContrasenaNuevaSchema } = requerir(
  '@realpolitik/shared',
) as typeof import('@realpolitik/shared');
const { hashearContrasena } = await import(`file:///${BACKEND}/src/modules/auth/contrasenas.ts`);
const { evaluarContrasenaNueva } = await import(
  `file:///${BACKEND}/src/modules/auth/politicaDeContrasenas.ts`
);

function abortar(mensaje: string): never {
  console.error(`ABORTA: ${mensaje} No se creó ninguna cuenta.`);
  process.exit(1);
}

/** Lee el .env de la raíz (solo las claves de PostgreSQL). */
function leerEnv(): Record<string, string> {
  const valores: Record<string, string> = {};
  for (const linea of readFileSync(`${RAIZ}/.env`, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(POSTGRES_[A-Z_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m?.[1] !== undefined) valores[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return valores;
}

/** Lee una línea de la terminal sin mostrar lo que se escribe. */
function leerOculto(pregunta: string): Promise<string> {
  const entrada = process.stdin;
  if (!entrada.isTTY) {
    abortar('la contraseña se escribe en una terminal interactiva (PowerShell, cmd o winpty).');
  }
  process.stdout.write(pregunta);
  entrada.setRawMode(true);
  entrada.resume();
  entrada.setEncoding('utf8');
  return new Promise((resolver) => {
    let texto = '';
    const alLeer = (trozo: string) => {
      for (const c of trozo) {
        if (c === '\r' || c === '\n') {
          entrada.setRawMode(false);
          entrada.pause();
          entrada.off('data', alLeer);
          process.stdout.write('\n');
          resolver(texto);
          return;
        }
        if (c === '\u0003') {
          entrada.setRawMode(false);
          process.stdout.write('\n');
          abortar('cancelado.');
        }
        if (c === '\u007f' || c === '\b') texto = texto.slice(0, -1);
        else texto += c;
      }
    };
    entrada.on('data', alLeer);
  });
}

const env = leerEnv();
const usuarioPg = env.POSTGRES_USER;
const clavePg = env.POSTGRES_PASSWORD;
const puerto = env.POSTGRES_PORT && env.POSTGRES_PORT !== '' ? env.POSTGRES_PORT : '5432';
if (!usuarioPg || !clavePg) abortar('faltan POSTGRES_USER o POSTGRES_PASSWORD en el .env.');
const url = `postgresql://${encodeURIComponent(usuarioPg)}:${encodeURIComponent(clavePg)}@127.0.0.1:${puerto}/${BASE}?schema=public`;

const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
try {
  // 1. Verificación de solo lectura: qué base es de verdad y si ya hay una cuenta de QA.
  const verificacion = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const [info] = await tx.$queryRaw<{ db: string; version: string }[]>`
      SELECT current_database() AS db, version() AS version`;
    const existentes = await tx.usuario.count({ where: { email: { startsWith: PREFIJO } } });
    return { db: info?.db, version: info?.version ?? '', existentes };
  });
  if (verificacion.db !== BASE) abortar(`la base conectada es "${verificacion.db}", no ${BASE}.`);
  if (!verificacion.version.startsWith('PostgreSQL 16')) abortar('no es el PostgreSQL 16 local.');
  if (verificacion.existentes > 0) {
    abortar('ya existe una cuenta de QA CONSULTA (qa.consulta.…): no se crea otra.');
  }
  console.log(`Destino verificado: 127.0.0.1:${puerto}, base ${verificacion.db} (solo lectura).`);

  // 2. La contraseña temporal, dos veces y sin eco.
  const email = `${PREFIJO}${randomBytes(4).toString('hex')}${DOMINIO}`;
  const nombre = 'QA Consulta';
  const temporal = await leerOculto('Contraseña temporal de la cuenta de QA: ');
  const repetida = await leerOculto('Repetila: ');
  if (temporal !== repetida) abortar('las dos contraseñas no coinciden.');
  const formato = ContrasenaNuevaSchema.safeParse(temporal);
  if (!formato.success) abortar(formato.error.issues[0]?.message ?? 'contraseña inválida.');
  const politica = evaluarContrasenaNueva(temporal, { email, nombre });
  if (!politica.aceptada) abortar(politica.mensaje);
  const passwordHash = await hashearContrasena(temporal);

  // 3. El alta, sola, en una transacción que vuelve a comprobar que no haya otra.
  const creada = await prisma.$transaction(async (tx) => {
    if ((await tx.usuario.count({ where: { email: { startsWith: PREFIJO } } })) > 0) {
      abortar('apareció otra cuenta de QA mientras tanto.');
    }
    return tx.usuario.create({
      data: {
        email,
        nombre,
        rol: 'CONSULTA',
        activo: true,
        passwordHash,
        passwordActualizadaEn: new Date(),
        debeCambiarPassword: true,
      },
      select: { email: true, nombre: true, rol: true, activo: true, debeCambiarPassword: true },
    });
  });
  console.log('Cuenta de QA creada (la contraseña no se muestra ni se guarda):');
  console.log(`  email: ${creada.email}`);
  console.log(`  nombre: ${creada.nombre} · rol: ${creada.rol} · activa: ${creada.activo}`);
  console.log(`  debeCambiarPassword: ${creada.debeCambiarPassword}`);
} catch (error) {
  // Solo mensajes propios: un error de Prisma puede citar datos de conexión.
  const propio = error instanceof Error && error.constructor === Error;
  console.error(propio ? error.message : 'No se pudo operar sobre la base de QA.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
```
