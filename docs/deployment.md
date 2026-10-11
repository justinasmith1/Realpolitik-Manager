# Despliegue

Cómo está preparado el repositorio para integración continua y despliegue, y qué configuración queda fuera de Git.

> **Estado:** el repositorio ya trae el CI y la configuración de Vercel versionada. Los proyectos de Vercel y Railway **todavía no están creados**: lo que se describe para ellos es la configuración objetivo y se completa cuando se creen. Este documento no incluye URLs ni valores reales.

## Arquitectura

```
GitHub (main)
   ├── Vercel  ── frontend (SPA estática)
   └── Railway ── backend (Express)
                    └── Railway PostgreSQL  (red privada)

Navegador ──HTTPS──► Backend ──red privada──► PostgreSQL
```

- El navegador **nunca** accede a la base de datos: solo habla con el backend, y solo el backend habla con PostgreSQL.
- Vercel y Railway son **proveedores de despliegue**, no dependencias del dominio. El código no usa SDKs ni APIs propias de ninguno de los dos, y el backend solo necesita las variables de entorno de abajo. Migrar a otra nube (GCP, AWS) debería cambiar la infraestructura y las variables, no el código.
- Un solo repositorio (monorepo) y **ambos servicios se construyen desde la raíz**, con comandos filtrados por workspace (`pnpm --filter`). El backend y el frontend dependen de `@realpolitik/shared`, que vive en `packages/shared` y se compila antes de usarlo; por eso no se usa "Root Directory" en un subdirectorio (dejaría afuera el lockfile, el workspace y el paquete compartido).

## Qué vive en Git y qué en el proveedor

| En Git                                                            | En el proveedor                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| Workflow de CI (`.github/workflows/ci.yml`)                       | `DATABASE_URL`, `CORS_ORIGINS`, `VITE_API_URL` de producción |
| `vercel.json` (build, salida y routing del frontend)              | `ENABLE_EXPERIMENTAL_COREPACK`, `RAILPACK_NODE_VERSION`      |
| Scripts del repositorio (`package.json`)                          | Vínculo entre servicios y dominios                           |
| Esta documentación (comandos y nombres de variables, sin valores) | Comandos de Railway (build, pre-deploy, start, healthcheck)  |

Nunca se versionan secretos. `VITE_API_URL` tampoco es un secreto, pero su valor de producción se define en el proveedor.

## Node y pnpm

- **Runtime objetivo de despliegue y CI: Node 24.** `engines.node` sigue siendo `>=20.19.0` para que el desarrollo local con Node 20.19+ siga funcionando.
- **pnpm 9.7.1**, declarado en `packageManager` del `package.json` raíz.
  - En CI lo respeta `pnpm/action-setup` (lee `packageManager`).
  - En Vercel hay que definir `ENABLE_EXPERIMENTAL_COREPACK=1` en el proyecto; si no, Vercel elige la versión de pnpm por su cuenta (con un `installCommand` propio puede terminar usando una versión muy vieja, incapaz de leer este lockfile).
  - En Railway, `RAILPACK_NODE_VERSION=24` fija Node; Railpack toma pnpm de `packageManager`.

## Integración continua

El workflow [`ci.yml`](../.github/workflows/ci.yml) corre en cada Pull Request y en cada push a `main`, con permisos mínimos (`contents: read`) y sin secretos.

Levanta un **PostgreSQL efímero** (`postgres:16-alpine`, base `realpolitik_test`) como service del job. Sus credenciales están escritas en el workflow a propósito: el contenedor nace y muere con el job y no tiene datos reales. El nombre termina en `_test` para que las guardas de los tests permitan usarla.

Pasos, en orden:

1. instalación con `--frozen-lockfile` y generación del cliente Prisma;
2. `format:check`, `lint`, `typecheck`;
3. tests de `shared` y tests **unitarios** del backend (sin base);
4. `db:migrate:deploy` sobre la base vacía: aplica **todo** el historial de migraciones, CHECK incluidos. Si alguna falla, el CI falla;
5. tests de **integración** del backend contra PostgreSQL (`test:integration`: todos los `*.integration.test.ts`);
6. tests del frontend;
7. tests del frontend **contra la API real** (`test:api`): levanta el backend contra la misma base, espera `/health`, corre los `*.api.test.tsx` y apaga el backend aunque fallen;
8. build de `frontend` y `backend`.

Para reproducirlo en local (con la base descartable de [Base de datos](development/database.md#tests-de-integración)):

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @realpolitik/shared test
pnpm --filter @realpolitik/backend test
pnpm --filter @realpolitik/backend test:integration   # con TEST_DATABASE_URL
pnpm --filter @realpolitik/frontend test
pnpm --filter @realpolitik/frontend build
pnpm --filter @realpolitik/backend build
```

## Frontend (Vercel)

La configuración versionada está en [`vercel.json`](../vercel.json), en la raíz:

| Clave             | Valor                                                              | Por qué                                                                                                         |
| ----------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `framework`       | `vite`                                                             | La raíz no tiene Vite entre sus dependencias, así que no se puede detectar solo.                                |
| `installCommand`  | `pnpm install --frozen-lockfile --filter @realpolitik/frontend...` | Instala el frontend y sus dependencias de workspace (`shared`). No descarga Prisma ni dependencias del backend. |
| `buildCommand`    | `pnpm --filter @realpolitik/frontend build`                        | Compila `shared` (hook `prebuild`), verifica tipos y corre `vite build`.                                        |
| `outputDirectory` | `apps/frontend/dist`                                               | Es la salida de Vite.                                                                                           |
| `rewrites`        | `/((?!assets/).*)` → `/index.html`                                 | Routing de la SPA (ver abajo).                                                                                  |

### Routing de la SPA

React Router resuelve `/clientes` en el navegador. Sin un rewrite, abrir `/clientes` directamente o recargar la página daría 404, porque en el servidor no existe ese archivo. El rewrite devuelve `index.html` para cualquier ruta que no sea un archivo.

- Según la documentación de Vercel, el sistema de archivos tiene **precedencia** sobre los rewrites: los archivos estáticos que existen (JS, CSS, fuentes) se sirven tal cual.
- Se excluye `/assets/` (la carpeta de salida de Vite) para que un asset inexistente, por ejemplo un JS con hash viejo tras un deploy, responda **404** en lugar de `index.html` con status 200, que el navegador intentaría ejecutar como script.
- El patrón usa lookahead negativo dentro de un grupo de captura, que es la forma documentada por Vercel para `rewrites`.

> **Validación obligatoria en el primer Preview** (no se puede comprobar sin un deploy real): abrir `/clientes` directamente, recargar `/clientes`, abrir una ruta inexistente (debe mostrar la pantalla 404 de la app) y pedir `/assets/inexistente.js` (debe dar 404).

### Variable del frontend

| Variable       | Dónde                               | Descripción                                                                                                    |
| -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Vercel, solo entorno **Production** | URL pública del backend, con esquema y **sin barra final**. Es pública: queda dentro del bundle del navegador. |

- Se incorpora al bundle en el momento del build: si cambia, hay que volver a desplegar.
- No se define en **Preview**: los previews no deben apuntar a la API de producción. El frontend actual todavía no hace requests, y cuando los haga, un preview sin `VITE_API_URL` falla con un error de configuración explícito.

## Backend (Railway)

El backend se construye y arranca desde la raíz del repositorio (Root Directory `/`, el valor por defecto de Railway). Configuración objetivo:

| Paso        | Comando                                                |
| ----------- | ------------------------------------------------------ |
| Build       | `pnpm --filter @realpolitik/backend build`             |
| Pre-deploy  | `pnpm --filter @realpolitik/backend db:migrate:deploy` |
| Start       | `pnpm --filter @realpolitik/backend start`             |
| Healthcheck | `GET /health` (espera `200`)                           |

- El build compila `shared` y genera el cliente Prisma por sí mismo (hook `prebuild`).
- El pre-deploy corre en un contenedor aparte, con las variables del servicio y acceso a la red privada. Si falla, **el deploy no avanza** y sigue sirviendo la versión anterior.
- `/health` indica solo que el proceso está vivo; no consulta la base de datos. Que la base responde lo comprueba el pre-deploy en cada deploy.
- No se versiona `railway.toml`: Railway lo marcó como deprecado en favor de su Infrastructure as Code. Estos valores se cargan en el servicio y se dejan documentados acá.
- No activar `RAILPACK_PRUNE_DEPS`: el pre-deploy necesita el CLI de Prisma, que es una devDependency.

### Variables del backend

| Variable                | Valor                             | Origen en Railway                              | Secreto |
| ----------------------- | --------------------------------- | ---------------------------------------------- | ------- |
| `NODE_ENV`              | `production`                      | Manual                                         | No      |
| `PORT`                  | (lo define Railway)               | Automática: no se configura a mano             | No      |
| `DATABASE_URL`          | URL privada de PostgreSQL         | Referencia al servicio PostgreSQL del proyecto | **Sí**  |
| `CORS_ORIGINS`          | Origen de producción del frontend | Manual                                         | No      |
| `RAILPACK_NODE_VERSION` | `24`                              | Manual                                         | No      |

- `NODE_ENV=production` hay que definirlo siempre en el proveedor: el servidor arranca igual sin ella y asume `development` (conveniente en local, engañoso en producción). Si se olvida, el servidor no avisa; la única pista es el arranque, que imprime el entorno (`Backend escuchando en … (development)`). Lo que cambia por no definirla es poco hoy (no se registran las consultas de Prisma, que solo se activan con `NODE_ENV=development` explícito), pero cualquier lógica futura que dependa de `production` quedaría apagada. Por eso las guardas de seguridad no dependen solo de esta variable (ver el seed, abajo).
- `CORS_ORIGINS` es el origen exacto, `https://<host>` **sin barra final**. Se admiten varios, separados por comas. Si falta o es inválido, el servidor no arranca y el deploy falla el healthcheck. No se usa `*`.
- Los previews de Vercel tienen un hostname distinto en cada deploy y **no** se agregan a `CORS_ORIGINS`.
- Usar la URL **privada** de la base (mismo proyecto de Railway). La URL pública (proxy TCP) factura tráfico de salida y expone la base fuera de la red privada: no se usa.

### Variable de Vercel

| Variable                       | Valor | Descripción                                                                        |
| ------------------------------ | ----- | ---------------------------------------------------------------------------------- |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`   | Hace que Vercel respete `packageManager: pnpm@9.7.1`. Va en el proyecto de Vercel. |

## Base de datos y migraciones

- En producción solo se aplican migraciones con **`db:migrate:deploy`** (`prisma migrate deploy`): ejecuta las migraciones ya versionadas en `apps/backend/prisma/migrations/`.
- **`db:migrate` (`prisma migrate dev`) no se usa en producción.** Crea migraciones y es solo para desarrollo.
- **El seed no se ejecuta en producción.** `db:seed` es solo para desarrollo local y **borra todos los clientes** antes de insertar los de ejemplo. No lo ejecutes con un `DATABASE_URL` de producción, y no pongas esa URL en tu `.env` local. Como red de seguridad, el seed se niega a correr si `NODE_ENV=production` o si el host de `DATABASE_URL` no es `localhost`, `127.0.0.1` o `::1`; no hay forma de saltear esa guarda con una variable.
- Prisma Studio (`db:studio`) no forma parte del despliegue.
- Docker Compose (`docker-compose.yml`) es solo para la base local de desarrollo; Railway no lo usa y no hay Dockerfile.
- Una migración nueva se crea en desarrollo, se revisa y se versiona en el Pull Request; el pre-deploy la aplica al desplegar.

## Orden de puesta en marcha (cuando se creen los proveedores)

Frontend y backend se necesitan mutuamente (la URL del backend para `VITE_API_URL`, el origen del frontend para `CORS_ORIGINS`). Para romper el ciclo:

1. Railway: crear el proyecto y PostgreSQL.
2. Crear el servicio del backend con sus variables. `CORS_ORIGINS` lleva un valor provisorio válido (por ejemplo, `http://localhost:5173`), porque es obligatoria y se valida al arrancar.
3. Generar el dominio público del backend y comprobar `GET /health`.
4. Vercel: crear el proyecto, definir `ENABLE_EXPERIMENTAL_COREPACK` y `VITE_API_URL` (Production) con la URL del backend, y desplegar.
5. Poner el origen real del frontend en `CORS_ORIGINS` (el servicio se vuelve a desplegar).
6. Hacer la prueba de humo.

## Prueba de humo posterior al despliegue

- **Frontend:** `/`, `/clientes` por navegación directa y tras recargar; sin scroll horizontal; consola sin errores.
- **Backend:** `GET /health` por HTTPS responde `200` con `{ "status": "ok" }`.
- **Integración:** una llamada desde el navegador, desde la página del frontend desplegado, al backend no da error de CORS.
- **Base de datos:** la migración quedó aplicada, existe la tabla `Cliente` y no hay datos de seed.
