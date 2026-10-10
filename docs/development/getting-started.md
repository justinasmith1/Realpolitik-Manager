# Primeros pasos

Guía para preparar el entorno de desarrollo según el estado actual del repositorio.

> `apps/backend` (API Express), `apps/frontend` (base de la aplicación web) y `packages/shared` ya definen sus propios scripts.

## Requisitos

- **Node.js** >= 20.19.0.
- **pnpm** 9.7.1. El repositorio lo declara como `packageManager: pnpm@9.7.1` en el `package.json` raíz.

Se recomienda usar [Corepack](https://nodejs.org/api/corepack.html) (incluido con Node) para obtener la versión de pnpm declarada:

```bash
corepack enable
```

### Windows / PowerShell

Si PowerShell bloquea la ejecución de scripts (por ejemplo, un error de "execution policies" al invocar `pnpm`), es un comportamiento habitual del sistema y no del proyecto. Opciones razonables:

- usar otra terminal (por ejemplo, Git Bash o CMD) para este repositorio;
- ajustar la política solo para tu usuario y con el alcance mínimo necesario, siguiendo la [documentación oficial de Microsoft](https://learn.microsoft.com/powershell/module/microsoft.powershell.core/about/about_execution_policies).

No se recomienda deshabilitar la protección de forma global ni usar políticas permisivas para toda la máquina.

## Instalación

```bash
git clone https://github.com/justinasmith1/Realpolitik-Manager.git
cd Realpolitik-Manager
pnpm install --frozen-lockfile
```

`--frozen-lockfile` instala exactamente lo que indica `pnpm-lock.yaml` y falla si el lockfile no está sincronizado con los `package.json`.

## Scripts de la raíz

| Script              | Qué hace                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `pnpm lint`         | Ejecuta ESLint sobre archivos `.ts` y `.tsx`.                                  |
| `pnpm lint:fix`     | Igual que `lint`, aplicando correcciones automáticas.                          |
| `pnpm format`       | Formatea con Prettier (`ts`, `tsx`, `json`, `yaml`, `md`).                     |
| `pnpm format:check` | Verifica el formato sin modificar archivos.                                    |
| `pnpm typecheck`    | Ejecuta el script `typecheck` de cada workspace que lo defina (ver más abajo). |

`typecheck` no compila el repositorio como un todo: delega en los workspaces que tengan su propio script `typecheck`. Mientras un workspace no lo defina, se omite sin error.

## Trabajar con un workspace

Para ejecutar un script en un workspace puntual se usa `--filter` con el nombre del paquete:

```bash
pnpm --filter @realpolitik/<workspace> <script>
```

Los nombres actuales son `@realpolitik/backend`, `@realpolitik/frontend` y `@realpolitik/shared`. Solo se pueden ejecutar los scripts que ese workspace defina.

## Frontend

La aplicación web (React, Vite y TypeScript) está en `apps/frontend`. Desde la raíz del repositorio:

```bash
pnpm --filter @realpolitik/frontend dev        # servidor de desarrollo (Vite)
pnpm --filter @realpolitik/frontend test       # tests
pnpm --filter @realpolitik/frontend build      # build de producción
pnpm --filter @realpolitik/frontend typecheck  # verificación de tipos
```

El servidor de desarrollo usa el puerto por defecto de Vite (`http://localhost:5173`).

### Variables de entorno

El frontend lee la URL de la API desde `VITE_API_URL`:

1. Copiá `apps/frontend/.env.example` como `apps/frontend/.env.local` (Git ignora ese archivo).
2. Completá el valor en `.env.local`:

   ```bash
   VITE_API_URL=
   ```

En desarrollo local el backend escucha en `http://localhost:3000` y sus rutas no llevan prefijo (ver [Backend](#backend)). El valor de producción lo define el proveedor de despliegue (ver [Despliegue](../deployment.md)). `.env.example` deja el valor vacío y no sugiere uno.

Las variables `VITE_*` quedan dentro del bundle que se descarga en el navegador: **son públicas**. Nunca pongas en ellas tokens, contraseñas, claves ni credenciales.

La pantalla actual no hace requests, así que el frontend arranca aunque `VITE_API_URL` no esté configurada. Las llamadas HTTP que se agreguen más adelante van a fallar de forma explícita (con un error de configuración) hasta que se la defina. Si cambiás su valor, hay que reiniciar el servidor de desarrollo o volver a generar el build.

### Paquete compartido

El frontend importa `@realpolitik/shared` desde su build (`packages/shared/dist`, que no se versiona). Por eso `pnpm lint` en la raíz y los scripts `dev`, `typecheck`, `test` y `build` del frontend reconstruyen ese paquete antes de ejecutarse; no hace falta compilarlo a mano.

## Backend

La API (Express 5 y TypeScript, en ESM) está en `apps/backend`. Desde la raíz del repositorio:

```bash
pnpm --filter @realpolitik/backend dev        # servidor de desarrollo con recarga (tsx watch)
pnpm --filter @realpolitik/backend test       # tests (vitest y supertest)
pnpm --filter @realpolitik/backend build      # genera dist/
pnpm --filter @realpolitik/backend start      # arranca dist/server.js (requiere build previo)
pnpm --filter @realpolitik/backend typecheck  # verificación de tipos
```

El servidor escucha en `http://localhost:3000` (variable `PORT`). Las rutas no llevan prefijo: `GET /health` responde `{ "status": "ok" }` sin consultar la base de datos.

### Variables de entorno

1. Copiá `apps/backend/.env.example` como `apps/backend/.env` (Git lo ignora).
2. Ajustá los valores. El script `dev` lo carga con `--env-file=.env`.

| Variable       | Obligatoria | Descripción                                                                                                           |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | No          | `development` (default), `test` o `production`. En producción se define siempre (ver [Despliegue](../deployment.md)). |
| `PORT`         | No          | Entero entre 1 y 65535 (default 3000).                                                                                |
| `DATABASE_URL` | Sí          | URL de PostgreSQL. Si tu Docker usa otro puerto (p. ej. 5433), ajustalo.                                              |
| `CORS_ORIGINS` | Sí          | Orígenes del frontend permitidos, separados por comas y sin barra final.                                              |

Si falta o es inválida alguna, el servidor no arranca y el mensaje nombra la variable sin mostrar su valor (`DATABASE_URL` contiene la contraseña). En producción las variables vienen del entorno del servidor, no de un archivo `.env`.

### Formato de error

Todos los errores de la API responden `{ "error": { "code", "message", "details" } }`. Códigos: `VALIDATION_ERROR` (400), `NOT_FOUND` (404), `CONFLICT` (409) e `INTERNAL_ERROR` (500). Un endpoint lanza errores con los helpers de `src/errors/app-error.ts` y valida sus entradas con el middleware `validate` de `src/middleware/validate.ts`.

### Paquete compartido y cliente Prisma

Igual que el frontend, el backend consume `@realpolitik/shared` desde su `dist`. Además, usa el cliente de Prisma, que se genera a partir de `apps/backend/prisma/schema.prisma` (no se versiona, y un `pnpm install` no lo genera porque el schema no está en una ubicación por defecto).

Por eso `dev`, `typecheck`, `test` y `build` del backend, y `pnpm lint` en la raíz, ejecutan antes el script interno `build:deps` del backend, que compila `shared` y genera el cliente. No hace falta hacerlo a mano ni tener una base de datos: generar el cliente no necesita `DATABASE_URL`. Para regenerarlo por separado: `pnpm --filter @realpolitik/backend db:generate`.

No se usa un script `postinstall` para esto: en Windows deja el cliente generado en un lugar donde Node no lo encuentra.

## Verificar antes de abrir un Pull Request

El CI corre estos mismos comandos (ver [Despliegue](../deployment.md#integración-continua)):

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm --filter @realpolitik/shared test
pnpm --filter @realpolitik/backend test
pnpm --filter @realpolitik/frontend test
pnpm --filter @realpolitik/frontend build
pnpm --filter @realpolitik/backend build
```

## Siguiente lectura

- [Convenciones](conventions.md)
- [Base de datos](database.md)
- [Despliegue](../deployment.md)
- [Baseline de seguridad](../security/security-baseline.md)
