# Convenciones

Convenciones de trabajo del equipo. La versión vigente de la Definition of Ready y la Definition of Done, así como el backlog y el estado del sprint, viven en Trello y no se copian a este repositorio.

## Git

### Ramas

- `main` es la rama principal de integración.
- El trabajo se realiza en ramas separadas y se integra mediante Pull Requests.
- Patrones de nombre:
  - `feature/...` para nueva funcionalidad;
  - `fix/...` para corrección de errores;
  - `chore/...` para mantenimiento, configuración y tooling;
  - `docs/...` para cambios exclusivamente de documentación.
- Se usan nombres descriptivos. No se exige un formato adicional (por ejemplo, `chore/setup-*`), porque la práctica real ya emplea otras variantes.

### Commits

- Se siguen [Conventional Commits](https://www.conventionalcommits.org/): `tipo(alcance opcional): descripción`.
- Los tipos y el alcance son los estándar (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`, `ci`); la descripción se escribe en español.
- Los commits son pequeños y coherentes: un cambio lógico por commit.

Ejemplo:

```
docs(repo): agregar documentación base del proyecto
```

### Pull Requests

- Cada PR se asocia a su tarjeta de Trello cuando corresponda.
- Se completa la plantilla de PR del repositorio (`.github/pull_request_template.md`).
- Otra persona del equipo revisa el PR antes de considerar la tarea terminada.
- Se recomienda que `main` esté protegida (PR obligatorio, al menos una aprobación, sin force push). Es una configuración del repositorio en GitHub que el equipo debe mantener y verificar; no puede comprobarse desde los archivos del repo. El CI está en `.github/workflows/ci.yml` (ver [Despliegue](../deployment.md#integración-continua)).

## Desarrollo

- No introducir dependencias sin una necesidad concreta.
- No crear abstracciones ni carpetas especulativas: se agrega estructura cuando hay código que la necesita.
- Respetar la responsabilidad de cada workspace (`apps/frontend`, `apps/backend`, `packages/shared`).
- Mantener reversibles las decisiones todavía inciertas; no acoplarse a proveedores sin una decisión explícita.
- Documentar las decisiones arquitectónicas relevantes mediante un [ADR](../adr/README.md).
- Seguir el [baseline de seguridad](../security/security-baseline.md).
