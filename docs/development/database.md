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

Las suites `*.integration.test.ts` del backend (y los `*.api.test.tsx` del frontend) corren contra PostgreSQL real. Sin `TEST_DATABASE_URL` se saltan. Con ella, cada suite comprueba el destino antes de escribir (ver [Qué se verifica antes de escribir](#qué-se-verifica-antes-de-escribir)) y borra solo lo que crea.

**La batería completa (`test:integration`) necesita una instancia PostgreSQL descartable con una base llamada exactamente `realpolitik_test`.** Ese nombre lo exigen las suites de requisitos (`requisitos.integration` y `requisitos.masivo`). Con otro nombre (por ejemplo, `realpolitik_hu45_test`), esas dos fallan en el `beforeAll` sin escribir nada y la corrida no queda en verde. Es el nombre que usa el CI, que crea una base efímera en cada job. Otras suites aceptan cualquier base `*_audit` o `*_test` cuando se corren sueltas (ver [Suites sueltas](#suites-sueltas)).

> **La `realpolitik_test` de la batería no es la de QA manual.** Las dos se llaman igual, pero las guardas solo pueden comprobar el nombre y que la conexión real llegue a la base de la URL, en el servidor de la URL. No distinguen una instancia descartable de la de QA manual, que tiene su administrador y la cuenta `CONSULTA` de [qa-consulta.md](qa-consulta.md). Las suites crean y borran cuentas, sesiones y datos, y algunas (`usuarios.concurrencia`, `primerAdministrador`) exigen que no haya ningún `ADMINISTRADOR` activo ajeno. Por eso la batería va contra **otra instancia** de PostgreSQL (otro contenedor, en otro puerto), nueva y vacía, que se elimina al terminar. Nunca uses la base de desarrollo, la de QA manual, la de producción ni una compartida. **`docker-compose.yml` también define `TEST_DATABASE_URL` hacia `realpolitik_test`** en el servicio `backend`: antes de correr pruebas, dentro o fuera del contenedor, verificá a qué base apunta de verdad.

### Toda la integración

```bash
# 1. Una instancia descartable NUEVA (no el servicio `db` de Compose), escuchando solo en
#    127.0.0.1 y en un puerto libre. Las credenciales son de este contenedor efímero, como en el CI.
docker run -d --rm --name rp-integracion -p 127.0.0.1:55432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=realpolitik_test \
  postgres:16-alpine

# 2. Migrarla. Prisma usa DATABASE_URL (TEST_DATABASE_URL no cambia su destino), así que se la
#    pasa explícita para este comando, sin tocar apps/backend/.env. Antes de aplicar nada, Prisma
#    imprime el destino ("Datasource … realpolitik_test … at 127.0.0.1:55432"): revisalo.
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend db:migrate:deploy

# 3. La batería, de a una suite
TEST_DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:55432/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend test:integration

# 4. Eliminar la instancia (con --rm, detenerla la borra junto con sus datos)
docker stop rp-integracion
```

`test:integration` corre las suites **de a una** (`--no-file-parallelism`), también en el CI. Todas comparten la misma base y varias operaciones usan transacciones `SERIALIZABLE` (abrir una rendición, aplicar o reemplazar un documento…). Con las suites en paralelo, PostgreSQL detecta conflictos de serialización entre transacciones que tocan datos distintos (en tablas chicas los predicate locks cubren páginas o tablas enteras), se agotan los reintentos y un alta responde 500: los tests fallaban de forma intermitente. Medido en local con 259 tests: en paralelo, 3 de 3 corridas fallaron (11–16 s); de a una, 3 de 3 pasaron (23–25 s).

### Suites sueltas

Para correr solo algunas, usá `vitest` directo con el mismo flag: `pnpm --filter @realpolitik/backend exec vitest run --no-file-parallelism rendiciones.envio.integration` (`exec vitest` no corre `build:deps`: compilá shared y generá el cliente de Prisma antes). Cada suite acepta estos nombres de base, siempre en una instancia descartable:

| Suites                                                                | Base de `TEST_DATABASE_URL`                            |
| --------------------------------------------------------------------- | ------------------------------------------------------ |
| `requisitos.integration`, `requisitos.masivo`                         | Solo `realpolitik_test`                                |
| `documentos.permisos.integration`                                     | `*_test`                                               |
| `cambioDeContrasena.integration`, `usuarios.concurrencia.integration` | `*_audit` o `*_test`, y además en un host local        |
| Las demás                                                             | `*_audit` o `*_test` (p. ej., `realpolitik_hu45_test`) |

**Suites de autenticación (HU4.1 y HU4.2):**

- `cambioDeContrasena.integration` solo corre contra un PostgreSQL **local**: fuerza fallas terminando conexiones con `pg_terminate_backend`.
- La misma suite crea además, durante un solo test, un trigger de restricción diferido y su función, para forzar que falle el `COMMIT`.
  - Se llaman `rp_prueba_falla_al_confirmar_<marca de la corrida>`.
  - Solo afectan al usuario de esa prueba.
  - Los borra al terminar el test y otra vez en `afterAll`.
  - Como las suites corren de a una, no afectan a las demás.
- `primerAdministrador.integration` necesita que la base no tenga ningún `ADMINISTRADOR` activo. Si hay uno (por ejemplo, una cuenta creada a mano para probar la app), la suite falla con un mensaje y no la toca.

### Qué se verifica antes de escribir

Son tres protecciones distintas que se suman. Ninguna se puede saltear con una variable, y las dos primeras corren antes de la primera escritura, incluidas las cuentas y sesiones de prueba.

**1. Restricción de nombres.** `urlDeBaseDescartable` rechaza, al cargar el archivo, una base cuyo nombre no termine en `_audit` o `_test`. Algunas suites agregan su propia restricción ([Suites sueltas](#suites-sueltas)):

- Requisitos exige exactamente `realpolitik_test` y PostgreSQL 16 en `requisitos.integration`.
- `documentos.permisos` exige el sufijo `_test`.
- `cambioDeContrasena` y `usuarios.concurrencia` exigen un host local.

El nombre solo dice a qué base apunta la URL, no a cuál se conecta de verdad la suite.

**2. Verificación de la conexión efectiva (todas las suites).** En el `beforeAll`, `conectarBaseDePrueba` (`clientes/__tests__/baseVerificada.ts`) hace, en este orden:

1. Aplica la restricción propia de la suite, si la tiene.
2. Fija `DATABASE_URL` e importa `lib/prisma` dinámicamente.
3. Abre una conexión de referencia con la URL y exige que `current_database()` sea la base de su nombre.
4. Exige que `lib/prisma` y cualquier otra conexión de la suite (por ejemplo, la `otraConexion` de `cambioDeContrasena`) estén en esa misma base y en el mismo servidor. Para eso compara una huella: el inicio del postmaster y el puerto.

Así atrapa un `lib/prisma` creado antes con otra URL: el singleton de `globalThis` o un import estático que tomó el `.env`. Solo lee. Si algo no coincide, desconecta lo que se abrió y lanza; no escribe, no limpia ni migra la base equivocada.

La suite se marca como verificada recién después de esa comprobación, y solo entonces crea las cuentas (`sesiones.preparar()`) y los datos. El `afterAll` solo limpia si la suite quedó verificada. Si la preparación falla después de verificar, el `afterAll` igual borra lo de la corrida (`finally`), siempre por la marca propia de cada suite.

Las suites de Usuarios (`cuentasDePrueba`) y de Requisitos (`verificarConexionDeRequisitos`) usan la misma verificación con sus restricciones.

**3. Instancia descartable.** Verificar bien la conexión no distingue la instancia de QA manual de una descartable si las dos tienen una base con el mismo nombre. Las dos primeras protecciones solo confirman que la suite escribe en la base de la URL. Que esa URL lleve a una instancia nueva, vacía y descartable depende de quien corre las pruebas ([Toda la integración](#toda-la-integración)).

### Si una guarda rechaza la corrida

El mensaje dice qué base recibió. **No cambies la guarda, el nombre esperado ni la URL para que pase contra una base existente.**

- **Nombre no permitido** (`solo se permiten bases descartables`, `solo puede utilizar realpolitik_test`, `no termina en _test`): levantá una instancia descartable con el nombre que pide esa suite (para la batería, `realpolitik_test`), o corré solo las suites que aceptan tu base.
- **La conexión apunta a otra base** (`Una conexión de la suite apunta a…`, `La URL de prueba lleva a…`, `La conexión no es realpolitik_test`): `lib/prisma` se creó con otra URL (un import estático, o un `DATABASE_URL` distinto ya cargado) o la URL no lleva a la base de su nombre. Si el mensaje nombra la misma base dos veces (`apunta a "realpolitik_test" y no a "realpolitik_test" de ese servidor`), la conexión está en una base con ese nombre pero en otro servidor, por ejemplo la instancia de QA manual. La suite no escribió nada. Revisá los imports y las variables antes de volver a correrla.
- **Versión** (`no es PostgreSQL 16`): usá la imagen `postgres:16`, como el CI.
- **Datos ajenos** (por ejemplo, `primerAdministrador` encuentra un `ADMINISTRADOR` activo): la base no está vacía. Creá una instancia nueva; no borres esos datos.

### Si falla una prueba de concurrencia

Las pruebas de carreras ordenan las operaciones con bloqueos reales de PostgreSQL. Una conexión retiene una fila y el test espera, en `pg_stat_activity`, a que la operación quede bloqueada esperándola (`esperarEnEspera`, en `usuarios/__tests__/entornoDeUsuarios.ts`). Cada espera tiene un plazo menor que el timeout de su test. Si no se cumple, el test falla con un mensaje propio y no con un timeout de Vitest:

| Dónde                                                                 | Plazo                                  | Timeout del test                               |
| --------------------------------------------------------------------- | -------------------------------------- | ---------------------------------------------- |
| `usuarios.concurrencia`, `usuarios.http`                              | 10 s por espera (el valor por defecto) | 30 s                                           |
| `cambioDeContrasena`                                                  | 2 s por espera (hay tests con dos)     | 5 s                                            |
| `contactos`, escritura concurrente sobre un contacto                  | 2 s                                    | 5 s (y 5 s la transacción que retiene la fila) |
| `sesiones.service`, creaciones simultáneas (sin bloqueos que esperar) | 4 s desde que empieza el test          | 5 s                                            |

En un entorno sano, estas esperas tardan milisegundos. No subas plazos ni timeouts para que una corrida pase: primero mirá qué dice el mensaje.

**Cómo leer el mensaje:**

- **`una operación terminó antes de quedar esperando (… ms): …`**: la operación no llegó al bloqueo; terminó con el resultado que se muestra:
  - Un error de Prisma, por ejemplo `P2028` con "Unable to start a transaction in the given time", significa que no pudo abrir la transacción a tiempo: el pool o la base estaban saturados.
  - `respondió 200`, o cualquier éxito, significa que la retención no bloqueó lo que el test suponía (por ejemplo, retuvo otra fila).
- **`a los … ms (… consultas, plazo … ms) había 0 de 1 …`**: se agotó el plazo. Debajo va la lista de conexiones de la base que no están inactivas en ese momento. Las marcadas con `*` contienen el fragmento que el test busca.
  - Si la consulta de la operación no aparece, no llegó a la base: el entorno está lento (argon2, pool, Docker).
  - Si aparece con `*` pero sin `Lock/…`, avanzó por otro camino.
  - Si hay una consulta bloqueada (`Lock/…`) sin `*`, la operación espera en otro lugar o el texto de la consulta cambió y el fragmento del test ya no coincide. Los fragmentos identifican consultas por comentarios como `usuarios:bloquear-usuario` o `auth:crear-sesion`.
- **`De N creaciones simultáneas terminaron M antes del plazo del test`** (`sesiones.service`): no es un fallo del límite de sesiones. La base tarda demasiado en cada transacción.
- **`Test timed out in 5000ms` o `Hook timed out in 10000ms`**: puede seguir apareciendo si lo lento es la preparación (crear cuentas, calcular hashes) y no la carrera. Es la misma señal de entorno degradado.

Una retención que el test no llegó a soltar se suelta en el `afterEach`. Así una falla no deja filas bloqueadas que hagan vencer la limpieza o los tests siguientes.

**Diagnóstico del entorno**, siempre contra la instancia descartable, nunca contra una base compartida:

1. **Docker Desktop:** `docker desktop status` tiene que decir `running`. Si `docker ps` responde `Docker Desktop is unable to start`, el motor está detenido y ningún contenedor corre. Antes de reiniciarlo con `docker desktop restart`, recordá que el reinicio detiene todos los contenedores. `docker stats --no-stream <contenedor>` muestra si el contenedor está sin CPU o sin memoria.
2. **PostgreSQL:** `docker exec <contenedor> psql -U postgres -d realpolitik_test -c '\timing on' -c 'SELECT 1'` tiene que responder en pocos milisegundos. Si una corrida quedó colgada, `SELECT pid, state, wait_event_type, left(query, 80) FROM pg_stat_activity WHERE datname = current_database() AND state <> 'idle';` muestra quién espera a quién.
3. **Prisma:** los códigos dicen qué se agotó:
   - `P2028` con "Unable to start a transaction in the given time": no consiguió conexión para abrir la transacción (2 s).
   - `P2028` con "Transaction already closed" o "expired transaction": la transacción superó sus 5 s.
   - `P2024`: se agotó la espera de una conexión del pool.

   El pool por defecto abre `núcleos × 2 + 1` conexiones. Limitarlo no reproduce las fallas en un entorno sano: con 5 y con 2 conexiones, las pruebas pasan.

4. **Repetí la suite sola**, con la ruta exacta, porque el filtro de Vitest también toma archivos cuyo nombre la contiene: `pnpm --filter @realpolitik/backend exec vitest run --no-file-parallelism src/modules/<módulo>/__tests__/<suite>.integration.test.ts`. Si pasa sola y repetida, fue un error transitorio del entorno. Si falla siempre con el mismo mensaje en un entorno sano, es un defecto y hay que investigarlo.

### Frontend contra la API real

En los ejemplos que siguen, `<usuario>`, `<clave>` y `<puerto>` son los de tu `.env` de la raíz (`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT`).

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

| Base                    | Uso                                                                           | Suites que escriben                    |
| ----------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| `realpolitik_db`        | Desarrollo (`apps/backend/.env`)                                              | Nunca: la rechazan todas las guardas   |
| `realpolitik_test`      | QA manual, con su administrador y sus cuentas de prueba                       | No (ver "Suites de Requisitos" abajo)  |
| `realpolitik_hu45_test` | Integración automatizada de HU4.5 (y del resto del backend, salvo Requisitos) | Sí, de a una (`--no-file-parallelism`) |

`realpolitik_hu45_test` se crea y se migra como `realpolitik_test` (sección anterior), cambiando el nombre. `usuarios.concurrencia.integration` y `primerAdministrador.integration` necesitan además que no haya **ningún** `ADMINISTRADOR` activo ajeno: si lo hay, fallan con un mensaje sin tocarlo. Por eso no pueden correr en la base de QA manual.

**Guardas de las suites de Usuarios** (`modules/usuarios/__tests__/entornoDeUsuarios.ts`), todas antes de la primera escritura:

- El nombre de la base de `TEST_DATABASE_URL` tiene que terminar en `_audit` o `_test`.
- Una conexión abierta con esa URL tiene que informar ese nombre en `current_database()`.
- **Cada** conexión de la suite (la de `lib/prisma` que usa el login, y las de los servicios) tiene que estar en la misma base y en el mismo servidor (inicio del postmaster y puerto) que esa referencia. Una URL válida no alcanza: si `lib/prisma` se cargó antes de fijar `DATABASE_URL`, toma la base del `.env`, y esta comprobación lo detecta.
- Solo se crean y se borran cuentas cuyo email empieza con la marca de la corrida (`<marca>-…@pruebas.example`). Las sesiones se borran en cascada con ellas.
- Los `afterAll` limpian solo si la guarda pasó (`verificada`). Si falló, no se ejecuta ninguna escritura, tampoco la limpieza.
- `lib/prisma` y los servicios se importan dinámicamente después de fijar `DATABASE_URL`, nunca con un import estático.

Motivo: durante el desarrollo de HU4.5, una suite con un `lib/prisma` inicializado antes de tiempo se conectó a la base de desarrollo aunque `TEST_DATABASE_URL` apuntaba a una de prueba. La tercera guarda existe para que eso no pueda volver a escribir en una base equivocada.

**Suites de Requisitos.** `requisitos.integration` y `requisitos.masivo` exigen una base llamada exactamente `realpolitik_test` y rechazan `realpolitik_hu45_test`. Por eso la batería completa no corre contra `realpolitik_hu45_test`. Decisión del proyecto: **no se corren contra la instancia de `realpolitik_test` usada para QA manual**. Si hay que correrlas, se usa una instancia de PostgreSQL descartable (otro contenedor u otro puerto) con una base de ese nombre ([Toda la integración](#toda-la-integración)). Antes de crear nada verifican la conexión real ([Qué se verifica antes de escribir](#qué-se-verifica-antes-de-escribir)). Sus guardas no se debilitan.

**Vitest en Windows.** Con el directorio de trabajo escrito con la unidad en minúscula (`d:\…`), algunos `vi.mock(ruta, async (original) => …)` parciales no interceptan el módulo y el test termina en el cliente HTTP real (en el frontend, `Pedido no simulado`). Con la unidad en mayúscula (`D:\…`) pasan. Se reprodujo igual con el código de `main`: no es un defecto de la aplicación. El CI corre en Linux y no le afecta. En Windows, abrí la terminal (o el editor) en la ruta con la unidad en mayúscula antes de correr los tests.

## Pruebas de HU4.6 (responsable de los cambios de estado)

Las seis suites del historial corren contra una base descartable, de a una (`--no-file-parallelism`). En la HU se usó `realpolitik_hu46_test`, creada y migrada como `realpolitik_test` (sección "Tests de integración"):

- `rendiciones.responsable.integration`: alta, cambio manual con un responsable forjado en el cuerpo, vuelta automática, idempotencia, transición inválida, `CONSULTA` y acceso sin sesión, entrada anterior a HU4.6 y CHECK, cuenta renombrada o desactivada con la FK `RESTRICT`, y rollback ante un responsable inexistente. Antes de crear nada, verifica la conexión real con `exigirBaseDePrueba` (la guarda de las suites de Usuarios).
- `rendiciones.estado`, `.enviada`, `.cobro`, `.delMes` y `.atrasadas`: las suites anteriores, ahora con el responsable obligatorio (`sesionesDePrueba().idDe(identidad)` da el id de una cuenta real para la FK).

Resultado: 60 de 60. Las suites que crean rendiciones las borran antes que las cuentas (`limpiar()`), porque la FK del responsable es `RESTRICT`.

**Fallos de concurrencia observados durante HU4.6 (entorno degradado, no son de HU4.6).** Durante HU4.6, en la corrida completa de integración en Windows con Docker Desktop, fallaban de manera repetida cuatro pruebas de módulos que HU4.6 no toca. Es un registro histórico: una revisión posterior no los reprodujo en un entorno sano (ver más abajo).

| Suite                               | Prueba                                                             | Síntoma                                                                            |
| ----------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `sesiones.service.integration`      | Veinte inicios de sesión simultáneos                               | Algunos rechazados con `P2028` ("Unable to start a transaction in the given time") |
| `contactos.integration`             | Dos guardados simultáneos; escritura concurrente sobre un contacto | `P2028` en lugar del `409 CONFLICT` esperado                                       |
| `cambioDeContrasena.integration`    | PostgreSQL corta la transacción después de guardar el hash         | Timeout del test (5 s)                                                             |
| `usuarios.concurrencia.integration` | Toda la suite (22 omitidos)                                        | Timeout del `beforeAll` (10 s)                                                     |

Lo que se registró entonces:

- Se reproducían en corridas solas y repetidas.
- Seguían fallando con `connection_limit=40` y con `UV_THREADPOOL_SIZE=16`.
- La latencia de commit del contenedor era de 1 a 2 ms.
- **Fallaban igual en una base migrada sin la migración de HU4.6.**

**Revisión en el cierre de la Épica 4 (noviembre de 2026).** Contra una instancia descartable nueva y sana, en la misma máquina:

- **20 de 20 corridas en verde:** cada una de las cuatro suites corrió 5 veces. Después de los cambios descritos en [Si falla una prueba de concurrencia](#si-falla-una-prueba-de-concurrencia) se repitió: otras 25 corridas (las cuatro suites y `usuarios.http`), todas en verde.
- **Margen amplio:** las cuatro pruebas de la tabla tardan entre 27 y 429 ms frente a timeouts de 5 s. Los tests que esperan bloqueos tardan como mucho 340 ms. La suite `usuarios.concurrencia` completa tarda 4 a 6 s, y su `beforeAll` entra holgado en sus 10 s.
- **El pool no es la causa:** con el pool limitado a 5 y a 2 conexiones, los 20 inicios de sesión simultáneos pasan.
- **Con la CPU de PostgreSQL limitada:** con 0,1 núcleos pasan las cuatro suites. Con 0,02 núcleos, de esas cuatro suites solo fallan las dos pruebas de creaciones simultáneas de `sesiones.service`, ahora con el mensaje de [Si falla una prueba de concurrencia](#si-falla-una-prueba-de-concurrencia).

Conclusión: **no hay un defecto sistemático de la aplicación ni de las pruebas.** Las fallas aparecen solo con un entorno degradado, cuando cada transacción tarda del orden de 100 ms o más. Eso es compatible con el `ERROR_NO_SYSTEM_RESOURCES` que registró el [ADR-0006](../adr/0006-autenticacion-y-control-de-acceso.md) en esta máquina y con los estados en que Docker Desktop quedaba sin arrancar. Si vuelven a fallar, se pueden repetir como errores transitorios. Lo que faltaba era que fallaran con un mensaje que lo explicara, en vez de un timeout opaco. Eso se agregó sin subir ningún timeout ([Si falla una prueba de concurrencia](#si-falla-una-prueba-de-concurrencia)).

## Pruebas de HU4.4 (permisos de documentos)

`documentos.permisos.integration` prueba los permisos de documentos con PostgreSQL real, sesiones reales (`sesionesDePrueba()`, una cuenta por rol y una con la contraseña temporal) y el almacenamiento en memoria. En la HU se usó `realpolitik_hu44_test`, creada y migrada como `realpolitik_test` (sección "Tests de integración"), sin seed.

**Guardas, antes de escribir nada:** el nombre de la base de `TEST_DATABASE_URL` tiene que terminar en `_test` (más estricto que la guarda común, que también admite `_audit`); `lib/prisma` y la app se importan dinámicamente después de fijar `DATABASE_URL`; `exigirBaseDePrueba` confirma con `current_database()` que esa conexión es la de la URL, en el mismo servidor. Recién después se crean las cuentas y los datos. Todo lleva una marca de la corrida y la limpieza borra solo eso: aplicaciones, documentos, rendiciones (con sus ítems y su historial, en cascada), requisitos, clientes y tipos, y al final las cuentas (la FK del responsable de HU4.6 es `RESTRICT`).

| Escenario             | Qué verifica                                                                                                                                                                                              |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Sin sesión         | Listado, detalle, descarga e historial: 401 en JSON, sin metadatos ni bytes, y sin leer el almacenamiento (sin cookie y con un token inexistente)                                                         |
| B. `CONSULTA` lee     | Repositorio, detalle, historial y descarga: los bytes son idénticos a los cargados, a los del almacenamiento y al SHA-256 de la base; cabeceras de descarga; ninguna respuesta expone la clave ni el hash |
| C. `CONSULTA` escribe | Cargar (multipart válido y uno roto, que daría 400 si `multer` lo leyera), candidatos, aplicar y reemplazar: 403 `PERMISO_INSUFICIENTE`                                                                   |
| D. Integridad         | Una foto antes y después de C (filas del escenario, detalle de la rendición, repositorio y el hash de cada objeto almacenado) es igual                                                                    |
| E. `ADMINISTRATIVO`   | Candidatos, reemplazo, historial y descarga (lo demás, en `documentos.integration` y `aplicaciones.integration`)                                                                                          |
| F. `ADMINISTRADOR`    | Cargar, candidatos, aplicar, ver, descargar, reemplazar e historial                                                                                                                                       |
| G. Sin regresiones    | Con la contraseña temporal, 403 sin tocar el almacenamiento; al final, cada ítem completo tiene una sola aplicación vigente y cada objeto coincide con su hash                                            |

Resultado con Node 22 local (Windows, PostgreSQL 16 de Docker Compose): 16 de 16, y 62 de 62 junto con `documentos.integration`, `aplicaciones.integration` y `autorizacion.integration`, de a una. En el CI con Node 24, en verde al integrarse en `main` (PR #63).

```bash
# `exec vitest` no corre `build:deps`: shared compilado y el cliente de Prisma al día antes
# (`pnpm --filter @realpolitik/backend build:deps`)
TEST_DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_hu44_test?schema=public" \
DATABASE_URL="postgresql://<usuario>:<clave>@127.0.0.1:<puerto>/realpolitik_hu44_test?schema=public" \
  pnpm --filter @realpolitik/backend exec vitest run --no-file-parallelism documentos.permisos.integration
```

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [ADR 0003 — Modelado de requisitos y rendiciones](../adr/0003-modelado-requisitos-y-rendiciones.md)
- [Primeros pasos](getting-started.md)
