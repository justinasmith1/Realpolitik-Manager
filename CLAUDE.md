# Realpolitik Manager

Plataforma web para centralizar la gestión de rendiciones de pauta publicitaria de la agencia Realpolitik. Proyecto desarrollado por un equipo para un cliente real, con repositorio **público**.

## Fuentes de verdad

- **Trello**: backlog, historias, sprint, responsables y estado. No duplicarlo en el repo.
- **Este repositorio (código)**: fuente de verdad técnica.
- `docs/`: contexto estable, convenciones y decisiones. Empezar por [docs/README.md](docs/README.md).

## Stack actual

TypeScript, React + Vite, Node.js + Express, PostgreSQL + Prisma, pnpm workspaces.

Los proveedores de hosting, autenticación, almacenamiento, correo e infraestructura **no están definidos**. No asumirlos ni acoplar el código a ninguno.

## Estructura

- `apps/frontend`: aplicación cliente.
- `apps/backend`: API del servidor.
- `packages/shared`: código y tipos compartidos.

Los workspaces están en fase de setup (solo `package.json`). Los scripts propios aparecen a medida que se implementan.

## Comandos

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck        # delega en workspaces que definan su propio script
pnpm format:check
pnpm --filter @realpolitik/<workspace> <script>
```

## Reglas de trabajo

- Hacer solo lo solicitado; no agregar funcionalidades fuera de alcance.
- Evitar dependencias, abstracciones y carpetas especulativas.
- Decisiones arquitectónicas relevantes: registrarlas en un ADR (`docs/adr/`). Las inciertas se mantienen reversibles.
- Respetar la responsabilidad de cada workspace.

## Seguridad

- Repo público: nunca incluir secretos, `.env` reales ni datos reales o confidenciales de clientes.
- Validar toda entrada en los límites del sistema; la validación del frontend no reemplaza la del backend.
- Detalle en [docs/security/security-baseline.md](docs/security/security-baseline.md).

## Convenciones

- Documentación en español.
- Conventional Commits, con la descripción en español.
- Más detalle en [docs/development/conventions.md](docs/development/conventions.md).
