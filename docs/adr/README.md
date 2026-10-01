# Decisiones de arquitectura (ADR)

Un Architecture Decision Record (ADR) es un documento corto que registra una decisión técnica relevante: qué se decidió, por qué y con qué consecuencias.

## Para qué sirven

- Conservar el contexto de una decisión para quien llegue después (incluidas futuras sesiones de trabajo).
- Evitar rediscutir lo ya resuelto sin información nueva.
- Hacer explícito qué decisiones siguen abiertas y cuáles son reversibles.

## Cuándo crear uno

- La decisión es costosa de revertir o condiciona varias partes del sistema.
- Hay alternativas razonables y conviene dejar constancia del criterio elegido.
- Reemplaza o modifica una decisión anterior.

## Cuándo no crear uno

- Cambios menores, locales o fáciles de revertir.
- Convenciones de trabajo del equipo (van en [conventions.md](../development/conventions.md)).
- Decisiones que todavía no se están tomando: se listan abajo como abiertas.

## Estados

- **Proposed**: en discusión, todavía no adoptada.
- **Accepted**: adoptada y vigente.
- **Superseded**: reemplazada por un ADR posterior (se indica cuál).

## Numeración

Secuencial, con cuatro dígitos y nombre descriptivo: `NNNN-titulo-en-kebab-case.md`. Se parte de la [plantilla](0000-plantilla.md). Un ADR aceptado no se reescribe: si la decisión cambia, se crea uno nuevo que lo reemplaza.

## Índice

| ADR                                      | Título                                    | Estado   |
| ---------------------------------------- | ----------------------------------------- | -------- |
| [0001](0001-monorepo-pnpm-typescript.md) | Monorepo con pnpm workspaces y TypeScript | Accepted |

## Decisiones todavía abiertas

Se listan sin resolverlas ni crear ADR todavía:

- estrategia de módulos y configuración de TypeScript para backend y shared;
- hosting del frontend;
- hosting del backend;
- hosting de PostgreSQL;
- almacenamiento de archivos;
- autenticación;
- proveedor de correo;
- estrategia de backup y auditoría;
- retención documental (decisión de negocio a validar con el cliente).
