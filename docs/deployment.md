# Despliegue

Cómo está preparado el repositorio para integración continua y despliegue, y qué configuración queda fuera de Git.

> **Estado:** el repositorio trae el CI y la configuración de Vercel versionada, y los proyectos de Vercel y Railway ya existen. Este documento no incluye URLs ni valores reales: viven en los proveedores. El proxy de mismo origen (`/api`, ADR-0006) está **preparado en el código pero no activado** (ver [Proxy de mismo origen](#proxy-de-mismo-origen-preparado-sin-activar)).

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

- **Node 24 en todos lados:** despliegue, CI, `Dockerfile.dev` y desarrollo local. La versión está en `.nvmrc` (el CI la lee de ahí con `node-version-file`) y `engines.node` exige `>=24.0.0`. En Railway la fija `RAILPACK_NODE_VERSION=24`, que vive en el proveedor: si se cambia la versión del proyecto, hay que cambiarla también ahí.
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
5. tests de **integración** del backend contra PostgreSQL (`test:integration`: todos los `*.integration.test.ts`, de a una suite: ver [Base de datos](development/database.md#tests-de-integración));
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

| Clave             | Valor                                                                              | Por qué                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `framework`       | `vite`                                                                             | La raíz no tiene Vite entre sus dependencias, así que no se puede detectar solo.                                             |
| `installCommand`  | `pnpm install --frozen-lockfile --filter @realpolitik/frontend...`                 | Instala el frontend y sus dependencias de workspace (`shared`). No descarga Prisma ni dependencias del backend.              |
| `buildCommand`    | `pnpm --filter @realpolitik/frontend build`                                        | Compila `shared` (hook `prebuild`), verifica tipos y corre `vite build`.                                                     |
| `outputDirectory` | `apps/frontend/dist`                                                               | Es la salida de Vite.                                                                                                        |
| `rewrites`        | `/((?!api/\|api$\|assets/).*)` → `/index.html`                                     | Routing de la SPA (ver abajo).                                                                                               |
| `headers`         | En `/api/:path*`: `x-vercel-enable-rewrite-caching: 0` y `Cache-Control: no-store` | Que el CDN nunca guarde una respuesta de la API (ver [Proxy de mismo origen](#proxy-de-mismo-origen-preparado-sin-activar)). |

### Routing de la SPA

React Router resuelve `/clientes` en el navegador. Sin un rewrite, abrir `/clientes` directamente o recargar la página daría 404, porque en el servidor no existe ese archivo. El rewrite devuelve `index.html` para cualquier ruta que no sea un archivo.

- Según la documentación de Vercel, el sistema de archivos tiene **precedencia** sobre los rewrites: los archivos estáticos que existen (JS, CSS, fuentes) se sirven tal cual.
- Se excluye `/assets/` (la carpeta de salida de Vite) para que un asset inexistente, por ejemplo un JS con hash viejo tras un deploy, responda **404** en lugar de `index.html` con status 200, que el navegador intentaría ejecutar como script.
- Se excluyen también `/api` y `/api/...`: son de la API. Mientras el proxy no esté activado responden **404** de Vercel; nunca `index.html` con 200, que un cliente de la API confundiría con una respuesta válida. `/apix` y similares siguen siendo rutas de la SPA.
- Un test del frontend ([despliegue-vercel.test.ts](../apps/frontend/src/app/despliegue-vercel.test.ts)) comprueba estos patrones contra todas las rutas de React Router. Emula el patrón; el motor real es el de Vercel y se verifica en el primer despliegue.
- El patrón usa lookahead negativo dentro de un grupo de captura, que es la forma documentada por Vercel para `rewrites`.

> **Validación obligatoria en el primer Preview** (no se puede comprobar sin un deploy real): abrir `/clientes` directamente, recargar `/clientes`, abrir una ruta inexistente (debe mostrar la pantalla 404 de la app) y pedir `/assets/inexistente.js` (debe dar 404).

### Variable del frontend

| Variable       | Dónde                               | Descripción                                                                                                                                                           |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Vercel, solo entorno **Production** | Base de la API. Hoy, la URL pública del backend, con esquema y **sin barra final**. Con el proxy activado, `/api`. Es pública: queda dentro del bundle del navegador. |

- Admite una URL absoluta `http(s)` o un path de mismo origen (`/api`, nunca `/`): ver [lib/env.ts](../apps/frontend/src/lib/env.ts).
- Se incorpora al bundle en el momento del build: si cambia, hay que volver a desplegar.
- No se define en **Preview**: los previews no deben apuntar a la API de producción. Un preview sin `VITE_API_URL` falla con un error de configuración explícito.

## Proxy de mismo origen (preparado, sin activar)

Diseño en [ADR-0006](adr/0006-autenticacion-y-control-de-acceso.md): el navegador pide `/api/...` a su propio origen y Vercel lo reenvía al backend de Railway con un rewrite externo, sin el prefijo. Así la cookie de sesión de HU4.1 es de primera parte. **No es una protección**: Railway sigue accesible directamente y, hasta que HU4.1 exija sesión en el backend, la API sigue abierta.

| Parte                                                           | Estado                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend: `VITE_API_URL=/api` y URLs relativas en `http()`      | Implementado y con tests                                                                                                                                                                   |
| Desarrollo: proxy `/api` de Vite (`API_PROXY_TARGET`)           | Implementado; verificado en local con un backend de reemplazo                                                                                                                              |
| `vercel.json`: fallback sin `/api`, caché desactivada en `/api` | Implementado; test de patrones. Sin verificar en Vercel                                                                                                                                    |
| `vercel.json`: rewrite `/api/:path*` → Railway                  | **Pendiente**: faltan el dominio público del backend y los hosts de producción del frontend. Vercel no interpola variables de entorno en `rewrites`: los valores se escriben en el archivo |
| Backend                                                         | Sin cambios. CORS sigue igual (el proxy es mismo origen; CORS solo cuenta en desarrollo sin proxy)                                                                                         |

### Rewrite que se agrega al activar

Primero en la lista de `rewrites`, antes del fallback de la SPA, con una entrada por cada host de producción del frontend (el dominio `*.vercel.app` de producción y, si lo hay, el propio):

```json
{
  "source": "/api/:path*",
  "has": [{ "type": "host", "value": "<host-de-produccion-del-frontend>" }],
  "destination": "https://<dominio-publico-del-backend>/:path*"
}
```

- **`has: host`**: solo los hosts de producción usan el proxy. En un Preview no coincide, el fallback tampoco toma `/api`, y la respuesta es 404 de Vercel: ningún Preview puede mandar pedidos, tampoco escrituras, al backend de producción. Los Previews tampoco tienen `VITE_API_URL`, así que fallan antes, en el cliente.
- **Caché:** desde el 6 de abril de 2026, Vercel respeta las cabeceras de caché del origen en los rewrites externos de los proyectos nuevos. `x-vercel-enable-rewrite-caching: 0` lo desactiva para `/api`, y `Cache-Control: no-store` queda como segunda barrera. Ya están en `vercel.json`.
- **Tiempo:** Vercel espera hasta 120 s a que el backend **empiece** a responder.
- **Tamaño:** Vercel no documenta un límite de cuerpo para rewrites externos (el de 4,5 MB es de las Functions, que no se usan). No hay que agregar Functions ni middleware en `/api`.
- El test del frontend exige esa forma: `https`, `/:path*` sin prefijo, antes del fallback y con `has: host`.

### Qué pasa al integrar en `main` (sin activar)

- El fallback deja de tomar `/api`: esas rutas pasan a responder 404 de Vercel. El frontend no las usa: sigue con la `VITE_API_URL` absoluta de Production.
- Las cabeceras de `/api` no tienen efecto mientras no haya rewrite.
- El frontend sigue llamando al backend como hoy. No hay cambios en Railway.

### Activación (HU4.1, con revisión del equipo)

Es el paso 1 de la secuencia de despliegue de HU4.1 (ADR-0006). Se puede activar antes que la autenticación, porque no cambia la seguridad: la API sigue abierta, por Railway y por el proxy. Requiere la revisión del equipo:

1. Conseguir los dos valores pendientes: el dominio público del backend (panel de Railway, red del servicio) y los hosts de producción del frontend (panel de Vercel, dominios del proyecto).
2. PR con el rewrite. El test de `vercel.json` tiene que pasar.
3. Desplegar y comprobar, con pedidos de **lectura** (`GET`):
   - `/api/health` por el dominio de producción → 200 del backend;
   - `x-vercel-cache` ausente, `MISS` o `BYPASS`, nunca `HIT`, en dos pedidos seguidos;
   - `/api/inexistente` → 404 JSON del backend;
   - `/clientes` → la SPA; `/assets/inexistente.js` → 404;
   - el mismo `/api/health` desde un Preview → 404 de Vercel.
4. Cambiar `VITE_API_URL` de Production a `/api` y volver a desplegar el frontend.
5. Prueba de humo de la app: listados y una pantalla de detalle, mirando en DevTools que los pedidos vayan a `/api/...` del mismo origen.

### Reversión

- **Rápida:** volver `VITE_API_URL` de Production a la URL absoluta del backend y volver a desplegar. El rewrite puede quedar: no molesta.
- **Completa:** revertir el PR del rewrite.
- Mientras la autenticación no dependa de la cookie, las dos son inmediatas. Cuando HU4.1 la use, volver a la URL absoluta rompe el inicio de sesión (la cookie sería de terceros): la reversión pasa a ser la de toda la activación.

### Verificaciones que solo se pueden completar con autenticación

No se crean endpoints de prueba en el backend productivo para adelantarlas:

- cookie de sesión real a través del rewrite (`Set-Cookie`, `__Host-`, `SameSite=Strict`, cierre de sesión);
- protección CSRF (validación de `Origin` en el backend);
- que una respuesta autenticada nunca salga de la caché del CDN;
- acceso directo a Railway sin sesión → 401;
- documentos de 10 MiB por el rewrite real (los endpoints de documentos están deshabilitados en producción hasta HU4.4).

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

| Variable                 | Valor                             | Origen en Railway                              | Secreto |
| ------------------------ | --------------------------------- | ---------------------------------------------- | ------- |
| `NODE_ENV`               | `production`                      | Manual                                         | No      |
| `PORT`                   | (lo define Railway)               | Automática: no se configura a mano             | No      |
| `DATABASE_URL`           | URL privada de PostgreSQL         | Referencia al servicio PostgreSQL del proyecto | **Sí**  |
| `CORS_ORIGINS`           | Origen de producción del frontend | Manual                                         | No      |
| `RAILPACK_NODE_VERSION`  | `24`                              | Manual                                         | No      |
| `TRUST_PROXY_SALTOS`     | `0` (ver límite por origen)       | Manual (opcional; 0 por defecto)               | No      |
| `DOCUMENTOS_HABILITADOS` | Sin definir (deshabilitados)      | Manual, solo con protección efectiva           | No      |
| `ALMACENAMIENTO`         | `s3`                              | Manual                                         | No      |
| `S3_ENDPOINT`            | Endpoint S3 del proveedor (HTTPS) | Manual                                         | No      |
| `S3_REGION`              | Región del proveedor              | Manual                                         | No      |
| `S3_BUCKET`              | Bucket **privado**                | Manual                                         | No      |
| `S3_ACCESS_KEY_ID`       | Clave de acceso S3                | Manual                                         | **Sí**  |
| `S3_SECRET_ACCESS_KEY`   | Clave secreta S3                  | Manual                                         | **Sí**  |

- `NODE_ENV=production` hay que definirlo siempre en el proveedor: el servidor arranca igual sin ella y asume `development` (conveniente en local, engañoso en producción). Si se olvida, el servidor no avisa; la única pista es el arranque, que imprime el entorno (`Backend escuchando en … (development)`). Lo que cambia por no definirla es poco hoy (no se registran las consultas de Prisma, que solo se activan con `NODE_ENV=development` explícito), pero cualquier lógica futura que dependa de `production` quedaría apagada. Por eso las guardas de seguridad no dependen solo de esta variable (ver el seed, abajo).
- `CORS_ORIGINS` es el origen exacto, `https://<host>` **sin barra final**. Se admiten varios, separados por comas. Si falta o es inválido, el servidor no arranca y el deploy falla el healthcheck. No se usa `*`.
- Los previews de Vercel tienen un hostname distinto en cada deploy y **no** se agregan a `CORS_ORIGINS`.
- Con el proxy de mismo origen, el navegador no hace pedidos entre orígenes y CORS deja de intervenir en producción. `CORS_ORIGINS` sigue siendo obligatoria y conserva el origen de producción.
- Documentos (HU2.8, [ADR-0004](adr/0004-reutilizacion-y-almacenamiento-documentos.md)): en producción los endpoints `/documentos` están **deshabilitados** (no se montan: responden 404) mientras `DOCUMENTOS_HABILITADOS` no valga `true`. La API ya exige sesión y permisos en el código (etapa 3 de HU4.1, todavía sin desplegar ni validar en Railway), pero los documentos solo se habilitan con la política de HU4.4 (ADR-0006); CORS no es una protección. Deshabilitados, no hace falta ninguna variable de almacenamiento. Habilitados, el servidor **no arranca** sin `ALMACENAMIENTO=s3` y las cinco variables `S3_*` (endpoint HTTPS). Memoria y disco no se admiten en producción: se pierden con el contenedor. `S3_FORCE_PATH_STYLE` es opcional (`true` por defecto, lo que exige Supabase). Las claves `S3_*` no se comparten entre entornos y nunca van al frontend.
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

## Primer administrador (HU4.1)

Sin administración de usuarios (HU4.5), la primera cuenta se crea con un comando del backend. Crea **solo** un `ADMINISTRADOR`, y solo si no hay ninguno activo:

- Nunca modifica una cuenta existente: no cambia contraseñas, no reactiva cuentas desactivadas y no cambia roles. Si el email ya existe (activo o no) lo informa y termina.
- Repetirlo no duplica nada (sale con código 2). Dos ejecuciones simultáneas crean una sola cuenta (bloqueo de aviso de PostgreSQL y email único).
- La contraseña inicial pasa por la política de contraseñas, se guarda con Argon2id y es **temporal**: el primer ingreso obliga a cambiarla (`debeCambiarPassword`). No se crea ninguna sesión.
- La contraseña **nunca** va en argumentos (el comando rechaza cualquier argumento), en variables de entorno, en archivos versionados ni en la salida. Con terminal interactiva se escribe sin eco y dos veces; sin terminal se lee una línea de la entrada estándar.
- Antes de escribir muestra el destino (host y base, sin credenciales) y exige escribir el nombre de la base.
- Registra `auth.usuario.creado` con el id (sin email ni contraseña).

```bash
# Local / desarrollo (con DATABASE_URL de la base elegida)
pnpm --filter @realpolitik/backend admin:crear

# Build de producción (sin tsx): el build genera dist/crear-primer-administrador.js
node apps/backend/dist/crear-primer-administrador.js

# Sin terminal (aprovisionamiento automatizado): email/nombre por variables, contraseña por stdin
ADMIN_EMAIL=… ADMIN_NOMBRE=… ADMIN_CONFIRMAR_BASE=<nombre-de-la-base>   node apps/backend/dist/crear-primer-administrador.js < <archivo-temporal-fuera-del-repo>
```

**En producción (no ejecutado; requiere autorización expresa):** desde una terminal dentro del servicio del backend en Railway (`railway ssh` al servicio, que tiene `DATABASE_URL` con la URL privada), ejecutar `node apps/backend/dist/crear-primer-administrador.js` de forma interactiva. Antes de usarlo hay que **verificar en el entorno real** que `railway ssh` está disponible para el servicio, que la terminal es interactiva (sin eco) y que el `dist` del deploy incluye el comando. Si no, la alternativa es la entrada estándar desde una terminal confiable. La contraseña inicial se entrega a la persona por un canal separado y deja de valer en su primer ingreso. No se usa la URL pública de la base.

## Límite por origen del login detrás de proxies (HU4.1)

Con `TRUST_PROXY_SALTOS=0` detrás de Railway (y de Vercel), `req.ip` es la IP del proxy, la misma para todos. El límite por origen (20 fallos en 15 min → 15 min sin intentos) dejaría entonces que **una sola persona bloquee el inicio de sesión de todo el estudio**. Por eso:

- En `production` el límite por origen **solo se aplica si `TRUST_PROXY_SALTOS` > 0**. Fuera de producción se aplica siempre (la IP del socket es la del cliente).
- La demora por cuenta (desde el 5.º fallo: 30 s … 15 min) y el tope de concurrencia por cuenta y de argon2 siguen activos siempre.
- El arranque informa `límite de login por origen: activo|inactivo`.
- **Valor recomendado al activar: `TRUST_PROXY_SALTOS=0`** (límite por origen inactivo) hasta medir los saltos reales (T8/T9). No hay un número fijo correcto para los dos caminos (por Vercel: dos saltos; directo a Railway: uno) y un valor mayor que los saltos reales permite falsificar la IP con `X-Forwarded-For`. Activarlo con un valor medido, o con un secreto compartido desde Vercel, es una mejora posterior (P15).

## Prueba de humo posterior al despliegue

- **Frontend:** `/`, `/clientes` por navegación directa y tras recargar; sin scroll horizontal; consola sin errores.
- **Backend:** `GET /health` por HTTPS responde `200` con `{ "status": "ok" }`.
- **Integración:** una llamada desde el navegador, desde la página del frontend desplegado, al backend no da error de CORS.
- **Base de datos:** la migración quedó aplicada, existe la tabla `Cliente` y no hay datos de seed.
