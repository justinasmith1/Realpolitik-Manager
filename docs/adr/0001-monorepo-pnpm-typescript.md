# ADR-0001 — Monorepo con pnpm workspaces y TypeScript

## Estado

Accepted

## Fecha

2026-09-30

## Contexto

Un equipo pequeño trabaja en simultáneo sobre frontend, backend y código compartido. Hace falta coordinar los contratos entre ellos y el tooling común (lint, formato, chequeo de tipos), y conviene tener una única instalación y un único lockfile.

## Decisión

- Un solo repositorio (monorepo) organizado con **pnpm workspaces**:
  - `apps/frontend`
  - `apps/backend`
  - `packages/shared`
- **TypeScript** como lenguaje transversal a los tres workspaces.
- Existe una configuración de TypeScript compartida en la raíz (`tsconfig.base.json`), limitada a las reglas realmente transversales (rigor e interoperabilidad).
- Cada workspace define en su propio `tsconfig` las opciones específicas de su entorno (módulos, `lib`, salida, etc.).

## Alternativas consideradas

- Repositorios separados por componente.
- Otros gestores de paquetes o herramientas de workspaces/orquestación.

No se seleccionaron en esta etapa; no se realizó una evaluación formal de ellas.

## Consecuencias

**Positivas**

- Una instalación y un lockfile comunes.
- Cambios que afectan a varios workspaces pueden revisarse en un único Pull Request.
- Tooling y convenciones unificados.
- El código compartido se reutiliza sin publicar paquetes.

**Negativas / a tener en cuenta**

- Los workspaces comparten ciclo de vida del repositorio y su historial.
- Hay que mantener límites claros entre workspaces para evitar acoplamiento indebido.
- Los scripts raíz (por ejemplo `typecheck`) delegan en cada workspace, que debe definir los suyos.
- Quedan abiertas las decisiones de módulos y configuración de TypeScript para backend y shared.
