# Base de datos

Guía para levantar la base de datos PostgreSQL, aplicar migraciones y cargar datos de prueba en el entorno de desarrollo.

## Requisitos previos

- **Docker** y **Docker Compose** instalados y corriendo.
- Dependencias del repositorio instaladas (`pnpm install`).
- Archivos de variables de entorno configurados (ver paso 2 más abajo).

## Setup inicial

### 1. Levantar Postgres

```bash
docker compose up -d db
```

Levanta solo el contenedor de PostgreSQL en segundo plano (`docker compose up` a secas levanta también backend y frontend, ver [Primeros pasos](getting-started.md)). El servicio queda disponible en `127.0.0.1:${POSTGRES_PORT}` (5432 por defecto). Necesita el `.env` de la raíz (paso 2): de ahí toma usuario, contraseña, base y puerto.

### 2. Configurar variables de entorno (primera vez)

```bash
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
cp apps/frontend/.env.example apps/frontend/.env.local   # VITE_API_URL=http://localhost:3000
```

Revisá los valores en `apps/backend/.env` y ajustá credenciales o puerto si diferís del default. Los tres archivos los ignora Git.

**Si el puerto 5432 está ocupado** (por ejemplo, por un PostgreSQL instalado en la máquina), usá otro para el de Docker: `POSTGRES_PORT=5433` en el `.env` de la raíz y el mismo puerto en el `DATABASE_URL` de `apps/backend/.env` (`…@127.0.0.1:5433/realpolitik_db…`). Así ninguna operación del proyecto llega a ese otro servidor.

### 3. Instalar dependencias (si no se hizo)

```bash
pnpm install
```

### 4. Generar el cliente Prisma

```bash
pnpm --filter @realpolitik/backend db:generate
```

> Este paso es opcional: el siguiente (`db:migrate`) lo ejecuta automáticamente.

### 5. Aplicar migraciones

```bash
pnpm --filter @realpolitik/backend db:migrate
```

Aplica las migraciones que falten en tu base local y regenera el cliente. Si cambiaste `schema.prisma`, Prisma te pide un nombre y crea además una migración nueva (por ejemplo: `init_cliente`). Es un comando **solo de desarrollo** (ver [Scripts disponibles](#scripts-disponibles)).

### 6. Seedear datos de prueba

```bash
pnpm --filter @realpolitik/backend db:seed
```

Carga el catálogo de tipos de documento (sin borrar nada, ver [Tipos de documento](#tipos-de-documento-hu21)) y los 10 clientes de ejemplo. **Antes de cargar los clientes borra todos los clientes** (y, en cascada, sus contactos): úsalo solo en tu base local de desarrollo. Requisitos y detalles en [`db:seed`](#dbseed-destructivo-solo-desarrollo).

### 7. Verificar en Prisma Studio (opcional)

```bash
pnpm --filter @realpolitik/backend db:studio
```

Abre una UI en `http://localhost:5555` para explorar y editar los datos directamente.

## Scripts disponibles

| Script              | Qué hace                                                       | Dónde se usa              |
| ------------------- | -------------------------------------------------------------- | ------------------------- |
| `db:generate`       | Regenera el cliente Prisma a partir del schema                 | Cualquier entorno         |
| `db:migrate`        | `prisma migrate dev`: crea y aplica migraciones                | **Solo desarrollo**       |
| `db:migrate:deploy` | `prisma migrate deploy`: aplica las migraciones ya versionadas | Producción y staging      |
| `db:seed`           | Carga tipos de documento; borra e inserta clientes de ejemplo  | **Solo desarrollo local** |
| `db:studio`         | Abre Prisma Studio en `http://localhost:5555`                  | Desarrollo                |

Todos se ejecutan con `pnpm --filter @realpolitik/backend <script>`.

### `db:migrate` (solo desarrollo)

Es `prisma migrate dev`. Puede **crear** migraciones nuevas a partir de los cambios del schema y, si la base local no coincide con el historial de migraciones (drift, o una migración ya aplicada fue modificada), **propone resetearla**: eso borra todos sus datos. Por eso nunca se apunta a una base que importe.

### `db:migrate:deploy` (producción y staging)

Es `prisma migrate deploy`. Solo aplica las migraciones que ya están versionadas en `apps/backend/prisma/migrations/`; no crea migraciones, no compara contra el schema y no ofrece resetear nada. Es el único comando de migraciones que se usa en producción (ver [Despliegue](../deployment.md)).

### `db:seed` (destructivo, solo desarrollo)

Borra **todos los clientes** (los contactos caen en cascada) y los reemplaza por los de ejemplo. No es incremental ni se puede deshacer. Nunca se ejecuta en producción: el seed se niega a correr si `NODE_ENV=production` o si el host de `DATABASE_URL` no es `localhost`, `127.0.0.1` o `::1`, y no hay una variable para saltear esa guarda.

`pnpm --filter @realpolitik/backend db:seed` carga `apps/backend/.env` con `node --env-file=.env` (Node 24, la versión del proyecto). Si `DATABASE_URL` **ya está definida** en el entorno, Node no la reemplaza: gana la del entorno. Así `prisma db seed` sigue funcionando —Prisma carga el mismo `.env` y después ejecuta `pnpm run db:seed`— y un valor heredado no se cambia en silencio por el archivo. Antes de borrar clientes, el script imprime host, puerto y nombre de la base, nunca la contraseña. Con la base en Docker de esta guía (`127.0.0.1` y el `POSTGRES_PORT` del `.env`) no hace falta exportar nada.

Hace, en este orden:

1. Verifica la guarda, antes de tocar la base.
2. Carga el catálogo de tipos de documento. Esta parte no es destructiva: no borra tipos y respeta los cambios hechos después (ver [Catálogo inicial](#catálogo-inicial)).
3. **Borra todos los clientes** y carga los de ejemplo.

Si el paso 2 falla (por ejemplo, porque en la base están a la vez "Orden de compra" y "OC"), el seed se detiene ahí y no borra clientes. Si la base de desarrollo ya tiene rendiciones, el borrado del paso 3 falla por la FK `Rendicion → Cliente` en `Restrict` (ADR-0003, "A resolver").

Requisitos para ejecutarlo:

- Migraciones aplicadas, incluida `20261021120000_hu2_1_tipo_documento_nombre_normalizado`.
- Cliente de Prisma generado con el schema actual. `db:migrate` lo regenera; si aplicaste las migraciones con `db:migrate:deploy`, corré antes `db:generate`.
- `@realpolitik/shared` compilado, porque el seed importa de ahí la normalización de nombres. No hace falta hacerlo a mano: `predb:seed` ejecuta `build:shared` antes de `db:seed`. Cuando Prisma corre el seed por su cuenta (`prisma migrate reset`, o `migrate dev` cuando resetea la base), usa `prisma.seed` del `package.json` del backend, que es `pnpm run db:seed`: pasa por el mismo paso. `predb:seed` no regenera el cliente de Prisma a propósito: en Windows, `prisma generate` falla si un `pnpm dev` en el host tiene cargado el motor de Prisma.

## Integridad en la base (CHECK)

Las reglas de Cliente y Contacto se validan **primero** en la aplicación (`@realpolitik/shared` y el backend, que responden `400` antes de llegar a la base). PostgreSQL además las garantiza con CHECK constraints, como última línea de defensa frente a lo que no pasa por la API (scripts, Prisma Studio, SQL manual, un bug futuro):

| Constraint                          | Regla                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `ck_cliente_sector_subtipo`         | `PUBLICO` tiene subtipo; `PRIVADO` no                                                         |
| `ck_cliente_portal_requerido`       | `PORTAL_WEB` tiene `portalUrl` no vacía                                                       |
| `ck_cliente_whatsapp_requerido`     | `WHATSAPP` tiene `whatsappNumero` no vacío                                                    |
| `ck_cliente_periodicidad_coherente` | Sin configurar (las tres columnas en null), o tipo + día 1..28, y mes 1..12 solo en BIMESTRAL |
| `ck_cliente_baja_logica`            | `isDeleted` y `deletedAt` van juntos                                                          |
| `ck_contacto_baja_logica`           | Ídem para contactos                                                                           |

Viven en SQL, en la migración `20261010120000_integridad_cliente_contacto`: Prisma Schema no puede representarlos (por eso no aparecen en `schema.prisma`, que los menciona en comentarios). `prisma migrate diff` no los ve, así que una migración generada con `db:migrate` no los borra. No se exige que los datos de los canales no usados estén vacíos.

`SUSPENDIDO` sigue en el enum `ClienteEstado`, reservado para el futuro: la API no lo asigna y la UI no lo ofrece ni lo lista.

## Tipos de documento (HU2.1)

Catálogo de los documentos que un cliente puede pedir en su matriz de requisitos. La decisión de diseño está en [ADR-0003](../adr/0003-modelado-requisitos-y-rendiciones.md), puntos 1 y 8.

### Estructura de `TipoDocumento`

| Columna                   | Tipo                     | Notas                                                            |
| ------------------------- | ------------------------ | ---------------------------------------------------------------- |
| `id`                      | UUID                     |                                                                  |
| `nombre`                  | `VARCHAR(100)`           | Tal como lo escribió la administradora. No es único por sí solo  |
| `nombreNormalizado`       | `VARCHAR(100)`           | Clave de unicidad, con índice único. Técnica: no sale por la API |
| `descripcion`             | `VARCHAR(500)`, opcional |                                                                  |
| `activo`                  | booleano, default `true` | Desactivado no se ofrece al armar matrices; no se borra          |
| `createdAt` / `updatedAt` | fecha y hora             | Auditoría                                                        |

Las FK de `RequisitoCliente` e `ItemChecklist` hacia `TipoDocumento` son `Restrict`: un tipo en uso no se borra físicamente.

### Unicidad por nombre normalizado

Dos tipos no pueden tener el mismo nombre si se ignoran las mayúsculas, los acentos y los espacios repetidos o en los bordes. La `ñ` cuenta como otra letra:

- `Constancia ARCA`, `constancia  arca` y `Constancía ARCA` dan la clave `constancia arca`: son el mismo tipo.
- `Año` (clave `año`) y `Ano` (clave `ano`) son tipos distintos.

Lo garantiza el índice único `TipoDocumento_nombreNormalizado_key`, también ante dos altas simultáneas. Un duplicado se rechaza con el error `P2002` de Prisma sobre `nombreNormalizado`.

La clave se calcula **siempre** con `normalizarNombreTipoDocumento` de `@realpolitik/shared`, y se guarda junto con `nombre` en la misma escritura. Si cambiás `nombre` a mano (SQL, Prisma Studio), recalculá también `nombreNormalizado` con esa función. Si no, la base no detecta duplicados contra ese tipo.

### Migración y comportamiento ante conflictos

La migración `20261021120000_hu2_1_tipo_documento_nombre_normalizado` agrega `nombreNormalizado`, la completa para las filas existentes y pasa la unicidad de `nombre` a `nombreNormalizado`. No borra filas ni cambia ids, así que requisitos e ítems no se tocan. Corre entera en una transacción: si falla, la tabla queda como estaba.

Antes de cambiar nada, aborta con un error que nombra los tipos problemáticos si:

- algún nombre existente no es ASCII imprimible o está vacío (la migración solo sabe calcular la clave de nombres ASCII, que es lo único que cargaba el seed anterior);
- dos nombres existentes darían la misma clave (por ejemplo, `Factura` y `FACTURA`). No los fusiona, porque requisitos e ítems pueden apuntar a cualquiera de los dos.

Para seguir, corregí esos nombres a mano en la base (por ejemplo, renombrando uno de los dos), marcá la migración como revertida y volvé a aplicarla:

```bash
pnpm --filter @realpolitik/backend exec prisma migrate resolve --schema=prisma/schema.prisma \
  --rolled-back 20261021120000_hu2_1_tipo_documento_nombre_normalizado
pnpm --filter @realpolitik/backend db:migrate
```

### Catálogo inicial

El seed carga los 9 tipos validados con la administradora, en este orden: Factura, Print, Constancia escrita, CAE, OC, Constancia ARCA, Libre deuda, Pago IIBB y Constancia IIBB. Solo OC tiene descripción ("Orden de compra"), porque es la única confirmada. La lista está en `apps/backend/src/lib/seed-tipos-documento.ts`.

- **Idempotente.** Cada tipo se busca por su clave normalizada. Si ya existe, no se toca: un tipo desactivado sigue desactivado y una descripción cargada no se pisa. Si no existe, se crea activo. Correrlo varias veces no duplica nada.
- **No borra.** Un tipo que se agregó a mano y no está en el catálogo queda como está.
- **Renombre de "Orden de compra" a "OC".** El seed anterior cargaba "Orden de compra". Si la base lo tiene, el seed lo renombra a "OC" **en la misma fila** (mismo id), así que los requisitos que lo usan no cambian. Si la fila no tenía descripción, recibe "Orden de compra". Los ítems de rendiciones ya abiertas conservan el nombre anterior, porque es una foto del momento (ADR-0003, punto 2).
- **Conflicto.** Si la base tiene a la vez "Orden de compra" y "OC", el seed falla con un error que nombra los dos, no los fusiona y no llega a borrar clientes. Resolvelo a mano y volvé a ejecutarlo.

## Estado de la rendición (HU3.1)

En qué paso está cada rendición, con su historial de cambios. La decisión de diseño está en [ADR-0005](../adr/0005-estados-de-la-rendicion.md).

- **Enum `EstadoRendicion`:** `EN_CURSO`, `COMPLETA`, `ENVIADA`, `APROBADA` y `RECHAZADA`. Isomorfo con `EstadoRendicion` de `@realpolitik/shared`. "Atrasada" no es un valor: la calcula el sistema (HU3.4).
- **`Rendicion.estado`:** obligatorio, con default `EN_CURSO`. Es independiente de la baja lógica (`isDeleted`): una rendición anulada conserva el último estado que tenía.
- **Enum `OrigenCambioEstado` (HU4.6):** `MANUAL` y `AUTOMATICO`. Isomorfo con `OrigenCambioEstado` de `@realpolitik/shared`.
- **Tabla `HistorialEstadoRendicion`:** una fila por cambio de estado. Es historial: no se edita ni se borra (cae en cascada solo si se borra físicamente la rendición).

| Columna           | Tipo                           | Notas                                                                                                                                                                                          |
| ----------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`              | UUID                           |                                                                                                                                                                                                |
| `rendicionId`     | UUID, FK a `Rendicion`         | `onDelete: Cascade`                                                                                                                                                                            |
| `estadoAnterior`  | `EstadoRendicion`, opcional    | `NULL` solo en la primera entrada, la del alta                                                                                                                                                 |
| `estadoNuevo`     | `EstadoRendicion`              |                                                                                                                                                                                                |
| `fecha`           | fecha y hora                   | Cuándo se registró el cambio. Default: el momento del insert. Ordena el historial                                                                                                              |
| `fechaEfectiva`   | fecha (`DATE`), opcional       | (HU3.7) El día en que ocurrió, si la operadora lo indicó: hoy, solo la fecha de envío de la entrada `ENVIADA`, que puede ser anterior al registro. `NULL` en las demás                         |
| `motivo`          | texto, opcional                | Lo usan la vuelta automática a En curso (HU3.6) y el rechazo (HU3.8: qué pidió corregir el cliente)                                                                                            |
| `registradoPorId` | UUID, FK a `Usuario`, opcional | (HU4.6) Quién registró el cambio: el usuario de la sesión. `onDelete: Restrict`: una cuenta con cambios registrados no se borra (se desactiva). `NULL` solo en las entradas anteriores a HU4.6 |
| `origen`          | `OrigenCambioEstado`, opcional | (HU4.6) `MANUAL` (lo pidió la persona) o `AUTOMATICO` (la vuelta a En curso al sumar un requisito). `NULL` en las mismas entradas que `registradoPorId`                                        |
| `createdAt`       | fecha y hora                   | Auditoría                                                                                                                                                                                      |

Índice `HistorialEstadoRendicion_rendicionId_fecha_idx` sobre `(rendicionId, fecha)`: el historial de una rendición se lee en orden. No hay índice sobre `registradoPorId`: solo lo usaría el chequeo de la FK al borrar una cuenta, que no ocurre.

CHECK `ck_historial_responsable_con_origen` (HU4.6): `registradoPorId` y `origen` van los dos cargados o los dos en `NULL`. No obliga a que una entrada nueva los tenga: lo garantiza el backend, que exige el responsable en los tres caminos que escriben historial (ADR-0005, punto 14).

La migración `20261103120000_hu3_1_estado_rendicion` crea el enum, la columna y la tabla, y le da a **cada rendición existente** (también a las anuladas) el estado `EN_CURSO` y una entrada inicial (`NULL` → `EN_CURSO`) con su `createdAt` como fecha. Las altas nuevas crean esa entrada en la misma transacción que la rendición. Los cambios posteriores pasan por un solo punto del backend (`registrarCambioDeEstado`), que actualiza el estado y agrega la entrada juntos.

La migración `20261112120000_hu3_7_fecha_efectiva_historial` (HU3.7) agrega `fechaEfectiva` (`DATE`, opcional). Es aditiva: las entradas existentes quedan en `NULL` y se siguen mostrando con su `fecha`. Es un `DATE` y no una fecha y hora porque la operadora elige un día; Prisma lo lee como la medianoche UTC de ese día, y la API lo devuelve como `AAAA-MM-DD` (contrato 4.5).

La migración `20261116120000_hu4_6_responsable_historial` (HU4.6) crea el enum `OrigenCambioEstado`, agrega `registradoPorId` y `origen` (los dos opcionales y sin default), la FK a `Usuario` (`ON DELETE RESTRICT ON UPDATE CASCADE`) y el CHECK de arriba. Es aditiva y **sin backfill**: las entradas existentes quedan con los dos campos en `NULL` y se muestran como "Sin responsable registrado", porque no se sabe quién hizo esos cambios. El DDL es el que genera Prisma (comprobado con `prisma migrate diff`); el CHECK se agrega a mano, como los demás.

## Tests de integración

Las suites `*.integration.test.ts` del backend (y los `*.api.test.tsx` del frontend) corren contra PostgreSQL real. Sin `TEST_DATABASE_URL` se saltan, y **se niegan a correr** si esa base no se llama `*_audit` o `*_test`: nunca apuntan a la de desarrollo. Cada suite borra lo que crea. Las de requisitos (`requisitos.integration` y `requisitos.masivo`) exigen además que se llame exactamente `realpolitik_test`; el host y el puerto son los de `TEST_DATABASE_URL`, como en las demás.

> **Las suites que escriben datos van contra una instancia descartable.** Si tu `realpolitik_test` local tiene las cuentas de la QA manual (el administrador de QA, la cuenta `CONSULTA` de [qa-consulta.md](qa-consulta.md)), no la uses para `test:integration` ni para `test:api`: usá otra base descartable (por ejemplo, `realpolitik_hu45_test`, ver [Pruebas de HU4.5](#pruebas-de-hu45-administración-de-usuarios)) o, para las de requisitos, otra instancia de PostgreSQL con una base `realpolitik_test` vacía. Los ejemplos de abajo usan ese nombre porque es el del CI, que crea una base efímera. **`docker-compose.yml` también define `TEST_DATABASE_URL` hacia `realpolitik_test`** en el servicio `backend`: antes de correr pruebas, dentro o fuera del contenedor, verificá a qué base apunta de verdad.

En los ejemplos, `<usuario>`, `<clave>` y `<puerto>` son los de tu `.env` de la raíz (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`).

```bash
# una vez: crear la base descartable, dentro del contenedor del servicio `db` de Compose
docker compose exec -T db createdb -U <usuario> realpolitik_test

# migrarla: Prisma usa DATABASE_URL (TEST_DATABASE_URL no cambia su destino), así que se la
# pasa explícita para este comando, sin tocar apps/backend/.env. Antes de aplicar nada, Prisma
# imprime el destino ("Datasource … realpolitik_test … at 127.0.0.1:<puerto>"): revisalo.
DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend db:migrate:deploy

# backend
TEST_DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend test:integration
```

`test:integration` corre las suites **de a una** (`--no-file-parallelism`), también en el CI. Todas comparten la misma base y varias operaciones usan transacciones `SERIALIZABLE` (abrir una rendición, aplicar o reemplazar un documento…). Con las suites en paralelo, PostgreSQL detecta conflictos de serialización entre transacciones que tocan datos distintos (en tablas chicas los predicate locks cubren páginas o tablas enteras), se agotan los reintentos y un alta responde 500: los tests fallaban de forma intermitente. Medido en local con 259 tests: en paralelo, 3 de 3 corridas fallaron (11–16 s); de a una, 3 de 3 pasaron (23–25 s). Para correr solo algunas, usá `vitest` directo con el mismo flag: `pnpm --filter @realpolitik/backend exec vitest run --no-file-parallelism rendiciones.envio.integration`.

**Suites de autenticación (HU4.1 y HU4.2):**

- `cambioDeContrasena.integration` solo corre contra un PostgreSQL **local**: fuerza fallas terminando conexiones con `pg_terminate_backend`.
- La misma suite crea además, durante un solo test, un trigger de restricción diferido y su función, para forzar que falle el `COMMIT`.
  - Se llaman `rp_prueba_falla_al_confirmar_<marca de la corrida>`.
  - Solo afectan al usuario de esa prueba.
  - Los borra al terminar el test y otra vez en `afterAll`.
  - Como las suites corren de a una, no afectan a las demás.
- `primerAdministrador.integration` necesita que la base no tenga ningún `ADMINISTRADOR` activo. Si hay uno (por ejemplo, una cuenta creada a mano para probar la app), la suite falla con un mensaje y no la toca.

El frontend contra la API real (`test:api`) necesita además un backend levantado contra esa misma base, en otro puerto (el CI usa el 3999), y `TEST_API_URL`:

```bash
# backend de prueba, en otra terminal (no lee apps/backend/.env: todo va explícito)
cd apps/backend
DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_test?schema=public" \
  PORT=3999 CORS_ORIGINS=http://localhost:5173 NODE_ENV=test node --import tsx src/server.ts

# frontend
TEST_API_URL=http://127.0.0.1:3999 \
TEST_DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/frontend test:api
```

En el CI todo esto lo hace el workflow con una base efímera. Esos archivos (`EditarClienteSheet.api.test.tsx`, `MatrizPage.api.test.tsx` y `TiposDocumentoPage.api.test.tsx`) corren en jsdom contra ese backend: no son una prueba de navegador real.

**Sesión (desde HU4.1).** La API exige sesión, así que cada archivo inicia una de verdad con `src/test/sesionDeApi.ts`: crea una cuenta `ADMINISTRATIVO` de prueba en la base de `TEST_DATABASE_URL` (script `usuarioDeApiDeTest.ts` del backend, con la misma guarda `*_audit` / `*_test`; la contraseña es al azar y viaja por stdin), entra por `POST /auth/login`, manda la cookie y un `Origin` permitido en cada pedido, y al terminar cierra la sesión y borra la cuenta. No hay ningún atajo de autenticación. El `Origin` es `http://localhost:5173` (el del CI): el backend de prueba tiene que tenerlo en `CORS_ORIGINS`, o se cambia con `TEST_API_ORIGIN`.

**Cuenta CONSULTA (desde HU4.3).** `sesionDeApi(API, { rol: 'CONSULTA' })` crea la cuenta de prueba con el rol `CONSULTA` (`usuarioDeApiDeTest.ts crear CONSULTA`); sin opción, `ADMINISTRATIVO`. El script rechaza cualquier otro rol: nunca crea un `ADMINISTRADOR`. Cada sesión tiene su propia cuenta y su cookie, y se borra con ella: un archivo que necesita los dos roles (como `consultaSoloLectura.api.test.tsx`) abre dos sesiones. Esas cuentas efímeras son distintas de la de QA manual ([qa-consulta.md](qa-consulta.md)).

**El backend de prueba tiene que correr el código y el cliente Prisma actuales.** Un proceso sin modo _watch_ sigue con el código con el que arrancó, y unos `node_modules` en un volumen pueden tener un cliente Prisma generado con un schema anterior (síntoma: `500` con `PrismaClientValidationError`). Ante la duda, levantalo desde el host como el CI (`PORT=3999 CORS_ORIGINS=http://localhost:5173 NODE_ENV=test` y `DATABASE_URL` igual a `TEST_DATABASE_URL`).

> **El seed no es para estas bases.** `db:seed` borra todos los clientes de la base a la que apunta, y su guarda solo exige un host local: no distingue la base de desarrollo de la de tests. Nunca lo corras con `DATABASE_URL` apuntando a `realpolitik_test`. Para probar el seed, creá otra base descartable (p. ej. `realpolitik_seed_audit`), migrala y corré el seed con `DATABASE_URL` apuntando explícitamente a ella.

## Pruebas de HU4.5 (administración de usuarios)

Las suites de Usuarios desactivan cuentas, cambian roles, restablecen contraseñas y revocan sesiones, así que cada base tiene un uso:

| Base                    | Uso                                                         | Suites que escriben                    |
| ----------------------- | ----------------------------------------------------------- | -------------------------------------- |
| `realpolitik_db`        | Desarrollo (`apps/backend/.env`)                            | Nunca: la rechazan todas las guardas   |
| `realpolitik_test`      | QA manual, con su administrador y sus cuentas de prueba     | No (ver "Suites de Requisitos" abajo)  |
| `realpolitik_hu45_test` | Integración automatizada de HU4.5 (y del resto del backend) | Sí, de a una (`--no-file-parallelism`) |

`realpolitik_hu45_test` se crea y se migra como `realpolitik_test` (sección anterior), cambiando el nombre. `usuarios.concurrencia.integration` y `primerAdministrador.integration` necesitan además que no haya **ningún** `ADMINISTRADOR` activo ajeno: si lo hay, fallan con un mensaje sin tocarlo. Por eso no pueden correr en la base de QA manual.

**Guardas de las suites de Usuarios** (`modules/usuarios/__tests__/entornoDeUsuarios.ts`), todas antes de la primera escritura:

- El nombre de la base de `TEST_DATABASE_URL` tiene que terminar en `_audit` o `_test`.
- Una conexión abierta con esa URL tiene que informar ese nombre en `current_database()`.
- **Cada** conexión de la suite (la de `lib/prisma` que usa el login, y las de los servicios) tiene que estar en la misma base y en el mismo servidor (inicio del postmaster y puerto) que esa referencia. Una URL válida no alcanza: si `lib/prisma` se cargó antes de fijar `DATABASE_URL`, toma la base del `.env`, y esta comprobación lo detecta.
- Solo se crean y se borran cuentas cuyo email empieza con la marca de la corrida (`<marca>-…@pruebas.example`). Las sesiones se borran en cascada con ellas.
- Los `afterAll` limpian solo si la guarda pasó (`verificada`). Si falló, no se ejecuta ninguna escritura, tampoco la limpieza.
- `lib/prisma` y los servicios se importan dinámicamente después de fijar `DATABASE_URL`, nunca con un import estático.

Motivo: durante el desarrollo de HU4.5, una suite con un `lib/prisma` inicializado antes de tiempo se conectó a la base de desarrollo aunque `TEST_DATABASE_URL` apuntaba a una de prueba. La tercera guarda existe para que eso no pueda volver a escribir en una base equivocada.

**Suites de Requisitos.** `requisitos.integration` y `requisitos.masivo` exigen una base llamada exactamente `realpolitik_test` y rechazan `realpolitik_hu45_test`. Decisión del proyecto: **no se corren contra la instancia de `realpolitik_test` usada para QA manual**. Si hay que correrlas, se usa una instancia de PostgreSQL descartable (otro contenedor u otro puerto) con una base de ese nombre. Sus guardas no se debilitan.

**Vitest en Windows.** Con el directorio de trabajo escrito con la unidad en minúscula (`d:\…`), algunos `vi.mock(ruta, async (original) => …)` parciales no interceptan el módulo y el test termina en el cliente HTTP real (en el frontend, `Pedido no simulado`). Con la unidad en mayúscula (`D:\…`) pasan. Se reprodujo igual con el código de `main`: no es un defecto de la aplicación. El CI corre en Linux y no le afecta. En Windows, abrí la terminal (o el editor) en la ruta con la unidad en mayúscula antes de correr los tests.

## Pruebas de HU4.6 (responsable de los cambios de estado)

Las seis suites del historial corren contra una base descartable, de a una (`--no-file-parallelism`). En la HU se usó `realpolitik_hu46_test`, creada y migrada como `realpolitik_test` (sección "Tests de integración"):

- `rendiciones.responsable.integration`: alta, cambio manual con un responsable forjado en el cuerpo, vuelta automática, idempotencia, transición inválida, `CONSULTA` y acceso sin sesión, entrada anterior a HU4.6 y CHECK, cuenta renombrada o desactivada con la FK `RESTRICT`, y rollback ante un responsable inexistente. Antes de crear nada, verifica la conexión real con `exigirBaseDePrueba` (la guarda de las suites de Usuarios).
- `rendiciones.estado`, `.enviada`, `.cobro`, `.delMes` y `.atrasadas`: las suites anteriores, ahora con el responsable obligatorio (`sesionesDePrueba().idDe(identidad)` da el id de una cuenta real para la FK).

Resultado: 60 de 60. Las suites que crean rendiciones las borran antes que las cuentas (`limpiar()`), porque la FK del responsable es `RESTRICT`.

**Fallos preexistentes de concurrencia (no son de HU4.6).** En la corrida completa de integración, en Windows con Docker Desktop, fallan siempre cuatro pruebas de módulos que HU4.6 no toca:

| Suite                               | Prueba                                                             | Síntoma                                                                            |
| ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `sesiones.service.integration`      | Veinte inicios de sesión simultáneos                               | Algunos rechazados con `P2028` ("Unable to start a transaction in the given time") |
| `contactos.integration`             | Dos guardados simultáneos; escritura concurrente sobre un contacto | `P2028` en lugar del `409 CONFLICT` esperado                                       |
| `cambioDeContrasena.integration`    | PostgreSQL corta la transacción después de guardar el hash         | Timeout del test (5 s)                                                             |
| `usuarios.concurrencia.integration` | Toda la suite (22 omitidos)                                        | Timeout del `beforeAll` (10 s)                                                     |

Evidencia:

- Se reproducen corridas solas y repetidas.
- Siguen fallando con `connection_limit=40` y con `UV_THREADPOOL_SIZE=16`.
- La latencia de commit del contenedor es de 1 a 2 ms.
- **Fallan igual en una base migrada sin la migración de HU4.6.**

La causa queda para la historia de deuda técnica: son tiempos de las pruebas de carreras en este entorno, no un defecto de la aplicación demostrado.

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [ADR 0003 — Modelado de requisitos y rendiciones](../adr/0003-modelado-requisitos-y-rendiciones.md)
- [Primeros pasos](getting-started.md)
