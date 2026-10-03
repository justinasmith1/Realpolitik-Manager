# Primeros pasos

Guía para preparar el entorno de desarrollo según el estado actual del repositorio.

> `apps/backend` todavía no tiene implementación ni scripts propios. `apps/frontend` (base de la aplicación web) y `packages/shared` ya definen los suyos; los del backend irán apareciendo a medida que avance el desarrollo.

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

El backend todavía no define host, puerto ni prefijo, por eso `.env.example` deja el valor vacío y no sugiere uno.

Las variables `VITE_*` quedan dentro del bundle que se descarga en el navegador: **son públicas**. Nunca pongas en ellas tokens, contraseñas, claves ni credenciales.

La pantalla actual no hace requests, así que el frontend arranca aunque `VITE_API_URL` no esté configurada. Las llamadas HTTP que se agreguen más adelante van a fallar de forma explícita (con un error de configuración) hasta que se la defina. Si cambiás su valor, hay que reiniciar el servidor de desarrollo o volver a generar el build.

### Paquete compartido

El frontend importa `@realpolitik/shared` desde su build (`packages/shared/dist`, que no se versiona). Por eso `pnpm lint` en la raíz y los scripts `dev`, `typecheck`, `test` y `build` del frontend reconstruyen ese paquete antes de ejecutarse; no hace falta compilarlo a mano.

## Siguiente lectura

- [Convenciones](conventions.md)
- [Base de datos](database.md)
- [Baseline de seguridad](../security/security-baseline.md)
