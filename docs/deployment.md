# Despliegue

Cómo está preparado el repositorio para integración continua y despliegue, y qué configuración queda fuera de Git.

> **Estado:** el repositorio trae el CI y la configuración de Vercel versionada, y los proyectos de Vercel y Railway ya existen. Este documento no incluye secretos: viven en los proveedores. Las únicas URLs reales son el host de producción del frontend y el dominio público del backend, que el rewrite necesita escritos en `vercel.json`. El proxy de mismo origen (`/api`, ADR-0006) está **preparado en el repositorio pero no activado** (ver [Proxy de mismo origen](#proxy-de-mismo-origen-preparado-sin-activar)).

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
| `headers`         | Fuera de `/api`: `X-Content-Type-Options`, `Referrer-Policy` y `X-Frame-Options`   | Cabeceras de seguridad del frontend (ver [Cabeceras de seguridad](#cabeceras-de-seguridad)).                                 |

### Routing de la SPA

React Router resuelve `/clientes` en el navegador. Sin un rewrite, abrir `/clientes` directamente o recargar la página daría 404, porque en el servidor no existe ese archivo. El rewrite devuelve `index.html` para cualquier ruta que no sea un archivo.

- Según la documentación de Vercel, el sistema de archivos tiene **precedencia** sobre los rewrites: los archivos estáticos que existen (JS, CSS, fuentes) se sirven tal cual.
- Se excluye `/assets/` (la carpeta de salida de Vite) para que un asset inexistente, por ejemplo un JS con hash viejo tras un deploy, responda **404** en lugar de `index.html` con status 200, que el navegador intentaría ejecutar como script.
- Se excluyen también `/api` y `/api/...`: son de la API. Mientras el proxy no esté activado responden **404** de Vercel; nunca `index.html` con 200, que un cliente de la API confundiría con una respuesta válida. `/apix` y similares siguen siendo rutas de la SPA.
- Un test del frontend ([despliegue-vercel.test.ts](../apps/frontend/src/app/despliegue-vercel.test.ts)) comprueba estos patrones contra todas las rutas de React Router. Emula el patrón; el motor real es el de Vercel y se verifica en el primer despliegue.
- El patrón usa lookahead negativo dentro de un grupo de captura, que es la forma documentada por Vercel para `rewrites`.

> **Validación obligatoria en el primer Preview** (no se puede comprobar sin un deploy real): abrir `/clientes` directamente, recargar `/clientes`, abrir una ruta inexistente (debe mostrar la pantalla 404 de la app) y pedir `/assets/inexistente.js` (debe dar 404).

### Variable del frontend

| Variable       | Dónde                               | Descripción                                                                                                                                                                       |
| -------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | Vercel, solo entorno **Production** | Base de la API: `/api`, el proxy de mismo origen (ver [Activación](#activación)). Se cambia recién después de probar el proxy. Es pública: queda dentro del bundle del navegador. |

- Admite una URL absoluta `http(s)` o un path de mismo origen (`/api`, nunca `/`): ver [lib/env.ts](../apps/frontend/src/lib/env.ts).
- Se incorpora al bundle en el momento del build: si cambia, hay que volver a desplegar.
- No se define en **Preview**: los previews no deben apuntar a la API de producción. Un preview sin `VITE_API_URL` falla con un error de configuración explícito.

## Proxy de mismo origen (preparado, sin activar)

Diseño en [ADR-0006](adr/0006-autenticacion-y-control-de-acceso.md): el navegador pide `/api/...` a su propio origen y Vercel lo reenvía al backend de Railway con un rewrite externo, sin el prefijo. Así la cookie de sesión (`__Host-rp_sesion`, `SameSite=Strict`) es de primera parte. **No es una protección:** Railway sigue accesible directamente, y la API exige sesión en los dos caminos.

| Parte                                                           | Estado                                                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Frontend: `VITE_API_URL=/api` y URLs relativas en `http()`      | Implementado y con tests                                                                               |
| Desarrollo: proxy `/api` de Vite (`API_PROXY_TARGET`)           | Implementado; verificado en local con un backend de reemplazo                                          |
| `vercel.json`: fallback sin `/api`, caché desactivada en `/api` | Implementado; test de patrones. Sin verificar en Vercel                                                |
| `vercel.json`: rewrite `/api/:path*` → Railway                  | **En el repositorio, sin activar.** Se activa al integrarse en `main`; ver [Activación](#activación)   |
| `VITE_API_URL=/api` en Vercel Production                        | **Pendiente.** Se cambia recién después de comprobar el proxy                                          |
| Backend                                                         | Sin cambios. CORS sigue igual: el proxy es de mismo origen, y CORS solo cuenta en desarrollo sin proxy |

### Rewrite

Es el primero de `rewrites`, antes del fallback de la SPA. Vercel no interpola variables de entorno en `rewrites`, así que los valores van escritos en el archivo:

```json
{
  "source": "/api/:path*",
  "has": [{ "type": "host", "value": "realpolitik-manager.vercel.app" }],
  "destination": "https://realpolitik-manager-production.up.railway.app/:path*"
}
```

- **`has: host`:** solo el host de producción usa el proxy. En un Preview no coincide, el fallback tampoco toma `/api`, y la respuesta es 404 de Vercel: ningún Preview puede mandar pedidos, tampoco escrituras, al backend de producción. Si el proyecto tiene otro dominio de producción (uno propio), hay que confirmarlo en Vercel y agregarle su entrada antes de usarlo.
- **Prefijo:** `/api/health` llega al backend como `/health`.
- **Caché:** desde el 6 de abril de 2026, Vercel respeta las cabeceras de caché del origen en los rewrites externos de los proyectos nuevos. `x-vercel-enable-rewrite-caching: 0` lo desactiva para `/api`, y `Cache-Control: no-store` queda como segunda barrera.
- **Tiempo:** Vercel espera hasta 120 s a que el backend **empiece** a responder.
- **Tamaño:** Vercel no documenta un límite de cuerpo para los rewrites externos (el de 4,5 MB es de las Functions, que no se usan). No hay que agregar Functions ni middleware en `/api`.
- **Tests:** el de `vercel.json` exige esta forma exacta: HTTPS, `/:path*` sin prefijo, el primero de la lista, con `has: host` de producción, y ningún otro rewrite externo.

### Activación

Integrar el rewrite y cambiar la variable son **dos operaciones distintas**, en este orden:

1. **Merge del rewrite:** al desplegarse `main`, el proxy queda disponible en el host de producción. El frontend todavía no lo usa: sigue con el `VITE_API_URL` de Production que tenga en ese momento.
2. **Prueba del proxy**, con pedidos de **lectura** (`GET`), antes de tocar la variable:
   - `https://realpolitik-manager.vercel.app/api/health` → 200 `{ "status": "ok" }` del backend;
   - `/api/clientes` sin sesión → 401 JSON del backend;
   - `/api/inexistente` sin sesión → también **401**, no 404: el backend exige sesión antes de resolver la ruta;
   - dos pedidos seguidos a `/api/health`: `x-vercel-cache` ausente, `MISS` o `BYPASS`, nunca `HIT`, y `Cache-Control: no-store`;
   - `/` y `/clientes` → la SPA; un asset del build → 200; `/assets/inexistente.js` → 404;
   - el mismo `/api/health` desde un Preview → 404 de Vercel.
3. **Variable:** recién entonces, `VITE_API_URL=/api` en Vercel **Production**, y un nuevo despliegue (la variable entra al bundle en el build). En **Preview** no se define.
4. **Comprobación en el navegador real:** en DevTools, los pedidos van a `/api/...` del mismo origen, y no a una URL absoluta. La autenticación se verifica con las cookies reales (ver [Verificaciones que solo se pueden completar con autenticación](#verificaciones-que-solo-se-pueden-completar-con-autenticación)).

### Reversión

Antes de la activación, anotar los valores vigentes: `VITE_API_URL` de Production y el despliegue de producción del frontend. Volver a un despliegue anterior **no** es una recuperación funcional si ese bundle llama a una URL absoluta incorrecta, o si el login depende de la cookie de primera parte.

- **Si falla la prueba del proxy (paso 2):** no se cambia la variable. Se revierte el PR del rewrite, o se corrige el destino en un PR nuevo. El frontend queda como estaba.
- **Si falla después de cambiar la variable (pasos 3 y 4):** con `/api` y el proxy corregido se avanza; no se vuelve a la URL absoluta. Si el problema es del backend, se resuelve en Railway, con su propio procedimiento de reversión.

### Verificaciones que solo se pueden completar con autenticación

No se crean endpoints de prueba en el backend productivo para adelantarlas:

- cookie de sesión real a través del rewrite (`Set-Cookie`, `__Host-`, `SameSite=Strict`, cierre de sesión);
- protección CSRF (validación de `Origin` en el backend);
- que una respuesta autenticada nunca salga de la caché del CDN;
- acceso directo a Railway sin sesión → 401;
- documentos de 10 MiB por el rewrite real (los endpoints de documentos siguen deshabilitados en el despliegue: ver [Habilitación de Documentos](#habilitación-de-documentos-en-el-despliegue-de-demostración-hu44)).

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
| `DOCUMENTOS_HABILITADOS` | Sin definir (deshabilitados)      | Manual, solo con el procedimiento de abajo     | No      |
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
- Documentos (HU2.8, [ADR-0004](adr/0004-reutilizacion-y-almacenamiento-documentos.md)): en producción los endpoints `/documentos` están **deshabilitados** (no se montan: responden 404) mientras `DOCUMENTOS_HABILITADOS` no valga `true`. En el código, toda la API, también los documentos, exige sesión y permiso (HU4.1, HU4.3), y HU4.4 lo verificó localmente para los tres roles; en Vercel y Railway, el login todavía no está configurado ni verificado (proxy sin activar, Anexo A de ADR-0006). Los documentos se habilitan solo con el [procedimiento de abajo](#habilitación-de-documentos-en-el-despliegue-de-demostración-hu44) (política de ADR-0006); CORS no es una protección. Deshabilitados, no hace falta ninguna variable de almacenamiento. Habilitados, el servidor **no arranca** sin `ALMACENAMIENTO=s3` y las cinco variables `S3_*` (endpoint HTTPS). Memoria y disco no se admiten en producción: se pierden con el contenedor. `S3_FORCE_PATH_STYLE` es opcional (`true` por defecto, lo que exige Supabase). Las claves `S3_*` no se comparten entre entornos y nunca van al frontend.
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

La primera cuenta se crea con un comando del backend; las demás, desde la pantalla Usuarios (HU4.5), que necesita un administrador para empezar. Crea **solo** un `ADMINISTRADOR`, y solo si no hay ninguno activo:

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

## Habilitación de Documentos en el despliegue de demostración (HU4.4)

> **Pendiente: nada de esta sección está configurado ni verificado.** El despliegue de Vercel y Railway es un entorno de demostración para la facultad, sin información real de clientes. HU4.4 dejó los controles de acceso implementados y probados localmente ([matriz de permisos](security/matriz-permisos.md#repositorio-de-documentos-hu44)); esta configuración queda para la etapa de preparación de la demo. No incluye dominios, buckets ni credenciales: viven en los proveedores. Cada comprobación se da por hecha solo cuando se hace en ese entorno y se registra.

Es la [política de habilitación documental de ADR-0006](adr/0006-autenticacion-y-control-de-acceso.md#política-de-habilitación-documental-en-producción-hu44) llevada a pasos. Mientras no se complete, `DOCUMENTOS_HABILITADOS` queda sin definir.

### 1. Requisitos previos, con los documentos deshabilitados

1. **Backend desplegado** desde `main`, con las migraciones aplicadas por el pre-deploy y `NODE_ENV=production`. El arranque dice `documentos: deshabilitados`. T0 del Anexo A (`argon2` y Node 24 en el arranque).
2. **Proxy de mismo origen activo** ([Activación](#activación)): el rewrite con los valores reales en `vercel.json` y `VITE_API_URL=/api` en Production, con T4 (lectura), T12 y T13. Sin el proxy no se puede iniciar sesión desde el frontend desplegado: la cookie `__Host-rp_sesion` es `SameSite=Strict` y no viaja a otro origen.
3. **Cuentas de la demo:** el [primer administrador](#primer-administrador-hu41) y, desde la pantalla Usuarios, una cuenta `ADMINISTRATIVO` y una `CONSULTA`, con nombres y emails ficticios.
4. **Sesión verificada en el entorno real:** T5 (la cookie por el rewrite), T6 y T7 (`Origin`) y T14 (un `curl` directo a Railway, sin cookie, a una ruta de negocio responde 401).

### 2. Almacenamiento S3-compatible

1. Crear un bucket **privado** (sin acceso público), solo para la demo. No se reutiliza el de otro entorno.
2. Generar las claves S3 del proveedor. **Son secretas** y dan acceso al almacenamiento: van solo en las variables del servicio del backend en Railway. Nunca en Vercel, en una variable `VITE_*`, en el repositorio, en capturas ni en mensajes.
3. Anotar el endpoint S3 (HTTPS) y la región del proveedor.

### 3. Variables del backend

| Variable                                    | Valor                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `ALMACENAMIENTO`                            | `s3`                                                                   |
| `S3_ENDPOINT`                               | Endpoint S3 del proveedor, con `https://` (en producción, obligatorio) |
| `S3_REGION`                                 | Región del proveedor                                                   |
| `S3_BUCKET`                                 | El bucket privado del paso anterior                                    |
| `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` | Las claves S3 (**secretas**)                                           |
| `S3_FORCE_PATH_STYLE`                       | Sin definir (`true` por defecto, lo que exige Supabase)                |
| `DOCUMENTOS_HABILITADOS`                    | `true` recién en el paso 4                                             |

- Las variables de almacenamiento se pueden cargar antes, con `DOCUMENTOS_HABILITADOS` sin definir: el servidor solo valida su forma y no se conecta al proveedor.
- Con `DOCUMENTOS_HABILITADOS=true`, el servidor **no arranca** si `ALMACENAMIENTO` no es `s3`, si falta alguna `S3_*` o si el endpoint no es HTTPS, y el deploy falla el healthcheck. El mensaje nombra las variables, nunca sus valores.

### 4. Activación controlada, con archivos ficticios

1. Definir `DOCUMENTOS_HABILITADOS=true` y volver a desplegar el backend. El arranque tiene que decir `documentos: s3`.
2. Hacer las comprobaciones en el navegador, desde el frontend desplegado, solo con archivos **ficticios**: un PDF y una imagen sin datos reales, y un PDF de cerca de 10 MiB para T1 y T3. Los pedidos directos a la API se hacen desde las herramientas del navegador, en la pestaña con la sesión, sin copiar cookies ni cabeceras.

| #   | Comprobación                                                                                                                                                                                                | Esperado                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| D1  | Sin sesión (ventana privada, y un `curl` directo a Railway): `GET /api/documentos?anio=…&mes=…` y `GET /api/documentos/<id>/archivo`                                                                        | 401, sin metadatos ni contenido                                                   |
| D2  | `ADMINISTRATIVO`: cargar un PDF, aplicarlo a un ítem, descargarlo y abrir la vista previa                                                                                                                   | Todo funciona; el archivo descargado es el cargado                                |
| D3  | `ADMINISTRADOR`: cargar, aplicar, reemplazar el documento de un ítem y ver su historial                                                                                                                     | El historial muestra el vigente y el reemplazado                                  |
| D4  | `CONSULTA`: repositorio, detalle, historial de un ítem, descarga y vista previa                                                                                                                             | Todo se ve y se descarga; no aparecen "Cargar documento", "Aplicar" ni reemplazar |
| D5  | `CONSULTA`, pedido directo: `POST /api/documentos` y `GET /api/documentos/<id>/candidatos`                                                                                                                  | 403 `PERMISO_INSUFICIENTE`; el repositorio no cambia                              |
| D6  | Bucket privado: un `GET` anónimo a la URL pública de un objeto de la prueba (en Supabase, `…/storage/v1/object/public/<bucket>/<clave>`; la clave se ve en el panel del proveedor, la API nunca la muestra) | No entrega el archivo                                                             |
| D7  | T1, T2 y T3 del Anexo A: subida de cerca de 10 MiB, subida lenta y descarga de cerca de 10 MiB por el rewrite, con sesión                                                                                   | Completas; el resultado de la subida lenta queda registrado                       |
| D8  | T4 sobre una descarga autenticada: dos pedidos seguidos                                                                                                                                                     | `x-vercel-cache` nunca `HIT`; `Cache-Control: private, no-store`                  |
| D9  | Cerrar la sesión en otra pestaña y descargar                                                                                                                                                                | Lleva a `/login` con el aviso de sesión terminada                                 |

3. Registrar el resultado de cada comprobación (en el PR o la tarjeta de la habilitación), sin capturas con datos de sesión. Los documentos quedan habilitados solo si pasan todas; si alguna falla, se revierte.

### 5. Reversión

- **Inmediata:** quitar `DOCUMENTOS_HABILITADOS` (o ponerla en `false`) y volver a desplegar el backend. Las rutas vuelven a responder 404 y el repositorio muestra "El repositorio de documentos no está disponible en este entorno". Las filas de la base y los objetos del bucket no se tocan y siguen privados.
- **Una clave S3 expuesta:** revocarla en el proveedor, generar otra y actualizarla en Railway.
- **Falla el login o el proxy:** primero se deshabilitan los documentos y después se sigue la [reversión del proxy](#reversión).
- No hay una operación para borrar documentos (ADR-0004 §12). Si hubiera que quitar los archivos de la prueba, es un procedimiento manual aparte, con su autorización; nunca con el seed.

No se agregan endpoints de prueba ni modos sin autenticación para adelantar estas comprobaciones. Los documentos reales de clientes quedan fuera de la demo: requieren la aprobación del negocio (política de ADR-0006, punto 4).

## Cabeceras de seguridad

| Cabecera                    | Frontend (`vercel.json`, fuera de `/api`) | Backend (`cabecerasDeSeguridad`, todas las respuestas) |
| --------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| `X-Content-Type-Options`    | `nosniff`                                 | `nosniff`                                              |
| `Referrer-Policy`           | `same-origin`                             | `no-referrer`                                          |
| `X-Frame-Options`           | `SAMEORIGIN`                              | `DENY`                                                 |
| `Content-Security-Policy`   | Pendiente (ver abajo)                     | `default-src 'none'; frame-ancestors 'none'`           |
| `Strict-Transport-Security` | La agrega Vercel (`max-age=63072000`)     | `max-age=31536000`                                     |

- **Frontend, `same-origin`:** no manda la URL de la app a otros sitios (más estricta que la del navegador por defecto, `strict-origin-when-cross-origin`) y la conserva en los pedidos del mismo origen.
  - **`Origin` no depende de esta política en la API.** El frontend escribe con `fetch()` en modo `cors`, el predeterminado. Según el [estándar Fetch](https://fetch.spec.whatwg.org/#origin-header), esos pedidos llevan su `Origin` real con cualquier `Referrer-Policy`, también del mismo origen con el proxy activo. Lo mismo dice [MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Origin).
  - **Dónde sí importa:** la política solo cambia `Origin` en escrituras que no van en modo `cors`, como un formulario HTML clásico. Ahí `no-referrer` lo vuelve `null` siempre, y `same-origin` solo en pedidos a otros sitios. Hoy la app no tiene esos formularios, así que `same-origin` no es una condición para que `verificarOrigen` funcione. Es la política elegida por privacidad, y deja ese margen.
- **Frontend, `SAMEORIGIN` y no `DENY`:** la vista previa de documentos muestra un `iframe` propio con una URL `blob:`. Ningún otro sitio puede enmarcar la app.
- **Backend:** la API solo devuelve JSON y descargas, así que una CSP que no permite nada es segura. La descarga de documentos usa su propia CSP, `default-src 'none'; sandbox`.
- **HSTS:**
  - Vercel la envía por defecto en sus dominios. No se repite en `vercel.json`.
  - No hay evidencia de que Railway la agregue, así que la envía el backend. Los navegadores la ignoran en HTTP.
  - Al desplegar, verificar con `curl -I https://<dominio-del-backend>/health` que llegue: hay reportes de que el borde de Railway quita cabeceras de la aplicación.

**CSP del frontend: propuesta, sin implementar.** Requiere decisiones y verificarla en el navegador desplegado:

- **`connect-src`:** el frontend llama a la API absoluta de `VITE_API_URL`, que cambia según el entorno y vive en Vercel. `vercel.json` no puede leerla. Con el proxy activo alcanzaría `'self'`; sin él, hay que fijar el dominio del backend en el archivo.
- **`img-src` y `frame-src`:** la vista previa usa `blob:`.
- **`style-src`:** hay que comprobar si los componentes de la interfaz insertan estilos en línea.

Propuesta inicial, para empezar como `Content-Security-Policy-Report-Only`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; frame-src blob:; connect-src 'self' https://<dominio-del-backend>; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
```

Recién después de una revisión sin violaciones en todas las pantallas se pasaría a `Content-Security-Policy`.

### Verificaciones pendientes (activación de producción y QA integral)

Los tests comprueban la configuración (`cabecerasDeSeguridad.test.ts` y `despliegue-vercel.test.ts`), no lo que entregan los proveedores. Al activar producción, sin cambiar variables ni dominios para hacerlo:

1. **Backend en Railway:** `curl -I https://<dominio-del-backend>/health` tiene que traer `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Content-Security-Policy` y `Cache-Control: no-store`. Hay reportes de que el borde de Railway quita cabeceras de la aplicación. Si falta alguna, se informa al equipo antes de seguir.
2. **Frontend en Vercel:** `curl -I https://<dominio-del-frontend>/` y `curl -I https://<dominio-del-frontend>/clientes` tienen que traer las tres cabeceras de `vercel.json` y la `Strict-Transport-Security` que agrega Vercel.
3. **En un navegador real, con las cabeceras activas:** el login, el cambio de contraseña, al menos una operación que escriba por rol habilitado y la vista previa de un PDF y de una imagen ficticios. Todo debe funcionar sin errores de consola ni de red (`403 ORIGEN_NO_PERMITIDO`, marcos bloqueados).
4. **CSP del frontend:** evaluarla primero como `Content-Security-Policy-Report-Only`, con la propuesta de arriba. Recién se hace obligatoria después de recorrer todas las pantallas sin violaciones.

## Prueba de humo posterior al despliegue

- **Frontend:** `/`, `/clientes` por navegación directa y tras recargar; sin scroll horizontal; consola sin errores.
- **Backend:** `GET /health` por HTTPS responde `200` con `{ "status": "ok" }`.
- **Integración:** una llamada desde el navegador, desde la página del frontend desplegado, al backend no da error de CORS.
- **Base de datos:** la migración quedó aplicada, existe la tabla `Cliente` y no hay datos de seed.
