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

`pnpm --filter @realpolitik/backend db:seed` carga `apps/backend/.env` con `node --env-file=.env` (Node >= 20.19, el mínimo del proyecto). Si `DATABASE_URL` **ya está definida** en el entorno, Node no la reemplaza: gana la del entorno. Así `prisma db seed` sigue funcionando —Prisma carga el mismo `.env` y después ejecuta `pnpm run db:seed`— y un valor heredado no se cambia en silencio por el archivo. Antes de borrar clientes, el script imprime host, puerto y nombre de la base, nunca la contraseña. Con la base en Docker de esta guía (`127.0.0.1` y el `POSTGRES_PORT` del `.env`) no hace falta exportar nada.

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

## Tests de integración

Las suites `*.integration.test.ts` del backend (y los `*.api.test.tsx` del frontend) corren contra PostgreSQL real. Sin `TEST_DATABASE_URL` se saltan, y **se niegan a correr** si esa base no se llama `*_audit` o `*_test`: nunca apuntan a la de desarrollo. Cada suite borra lo que crea.

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

En el CI todo esto lo hace el workflow con una base efímera. Esos archivos (`EditarClienteSheet.api.test.tsx` y `TiposDocumentoPage.api.test.tsx`) corren en jsdom contra ese backend: no son una prueba de navegador real.

> **El seed no es para estas bases.** `db:seed` borra todos los clientes de la base a la que apunta, y su guarda solo exige un host local: no distingue la base de desarrollo de la de tests. Nunca lo corras con `DATABASE_URL` apuntando a `realpolitik_test`. Para probar el seed, creá otra base descartable (p. ej. `realpolitik_seed_audit`), migrala y corré el seed con `DATABASE_URL` apuntando explícitamente a ella.

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [ADR 0003 — Modelado de requisitos y rendiciones](../adr/0003-modelado-requisitos-y-rendiciones.md)
- [Primeros pasos](getting-started.md)
