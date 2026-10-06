# Realpolitik Manager

Plataforma web para centralizar la gestión de rendiciones de pauta publicitaria de la agencia Realpolitik.

El sistema busca reemplazar un proceso hoy mayormente manual, apoyado en planillas y documentación dispersa, por un flujo centralizado que mejore la trazabilidad, reduzca errores y disminuya la dependencia de tareas manuales.

Es un proyecto desarrollado por un equipo para un cliente real, en el marco de la materia Metodologías Ágiles (UTN FRLP).

## Stack actual

- TypeScript
- React + Vite
- Node.js + Express
- PostgreSQL + Prisma
- pnpm workspaces

## Estructura

```
apps/
  backend/
  frontend/
packages/
  shared/
docs/
.github/
```

`apps/backend` (API Express con Prisma), `apps/frontend` (base de la aplicación web) y `packages/shared` (tipos y schemas compartidos) ya tienen su código base y sus propios scripts.

## Inicio rápido

Requisitos: Node.js >= 20 y pnpm 9.

```bash
pnpm install --frozen-lockfile
```

Más detalle en [Primeros pasos](docs/development/getting-started.md).

## Scripts

| Script              | Descripción                                                       |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm lint`         | ESLint sobre archivos `.ts` y `.tsx`.                             |
| `pnpm lint:fix`     | ESLint con correcciones automáticas.                              |
| `pnpm format`       | Formatea con Prettier.                                            |
| `pnpm format:check` | Verifica el formato sin modificar archivos.                       |
| `pnpm typecheck`    | Delega en los workspaces que tengan su propio script `typecheck`. |

## Documentación

- [Índice de documentación](docs/README.md)
- [Contexto de negocio](docs/product/contexto-negocio.md)
- [Primeros pasos](docs/development/getting-started.md)
- [Convenciones](docs/development/conventions.md)
- [Contrato de API](docs/development/api-contract.md)
- [Despliegue y CI](docs/deployment.md)
- [Baseline de seguridad](docs/security/security-baseline.md)
- [Decisiones de arquitectura (ADR)](docs/adr/README.md)

## Licencia

No se ha definido todavía una licencia de distribución o reutilización.
