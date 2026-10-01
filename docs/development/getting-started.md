# Primeros pasos

Guía para preparar el entorno de desarrollo según el estado actual del repositorio.

> Los workspaces (`apps/backend`, `apps/frontend`, `packages/shared`) están en fase de setup: por ahora solo tienen su `package.json`. Los scripts propios de cada uno irán apareciendo a medida que avance el desarrollo.

## Requisitos

- **Node.js** >= 20.
- **pnpm** 9. El repositorio declara `packageManager: pnpm@9.7.1` en el `package.json` raíz.

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

## Siguiente lectura

- [Convenciones](conventions.md)
- [Baseline de seguridad](../security/security-baseline.md)
