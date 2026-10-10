# Base de datos

Guía para levantar la base de datos PostgreSQL, aplicar migraciones y cargar datos de prueba en el entorno de desarrollo.

## Requisitos previos

- **Docker** y **Docker Compose** instalados y corriendo.
- Dependencias del repositorio instaladas (`pnpm install`).
- Archivos de variables de entorno configurados (ver paso 2 más abajo).

## Setup inicial

### 1. Levantar Postgres

```bash
docker compose up -d
```

Levanta el contenedor de PostgreSQL en segundo plano. El servicio queda disponible en `localhost:5432`.

### 2. Configurar variables de entorno (primera vez)

```bash
cp .env.example .env
cp apps/backend/.env.example apps/backend/.env
```

Revisá los valores en `apps/backend/.env` y ajustá credenciales o puerto si diferís del default.

### 3. Instalar dependencias (si no se hizo)

```bash
pnpm install
```

### 4. Generar el cliente Prisma

```bash
pnpm --filter @realpolitik/backend db:generate
```

> Este paso es opcional: el siguiente (`db:migrate`) lo ejecuta automáticamente.

### 5. Aplicar migraciones

```bash
pnpm --filter @realpolitik/backend db:migrate
```

Aplica las migraciones que falten en tu base local y regenera el cliente. Si cambiaste `schema.prisma`, Prisma te pide un nombre y crea además una migración nueva (por ejemplo: `init_cliente`). Es un comando **solo de desarrollo** (ver [Scripts disponibles](#scripts-disponibles)).

### 6. Seedear datos de prueba

```bash
pnpm --filter @realpolitik/backend db:seed
```

Inserta datos iniciales (10 clientes de ejemplo). **Antes borra todos los clientes** (y, en cascada, sus contactos): úsalo solo en tu base local de desarrollo.

### 7. Verificar en Prisma Studio (opcional)

```bash
pnpm --filter @realpolitik/backend db:studio
```

Abre una UI en `http://localhost:5555` para explorar y editar los datos directamente.

## Scripts disponibles

| Script              | Qué hace                                                       | Dónde se usa              |
| ------------------- | -------------------------------------------------------------- | ------------------------- |
| `db:generate`       | Regenera el cliente Prisma a partir del schema                 | Cualquier entorno         |
| `db:migrate`        | `prisma migrate dev`: crea y aplica migraciones                | **Solo desarrollo**       |
| `db:migrate:deploy` | `prisma migrate deploy`: aplica las migraciones ya versionadas | Producción y staging      |
| `db:seed`           | Borra los clientes e inserta datos de ejemplo                  | **Solo desarrollo local** |
| `db:studio`         | Abre Prisma Studio en `http://localhost:5555`                  | Desarrollo                |

Todos se ejecutan con `pnpm --filter @realpolitik/backend <script>`.

### `db:migrate` (solo desarrollo)

Es `prisma migrate dev`. Puede **crear** migraciones nuevas a partir de los cambios del schema y, si la base local no coincide con el historial de migraciones (drift, o una migración ya aplicada fue modificada), **propone resetearla**: eso borra todos sus datos. Por eso nunca se apunta a una base que importe.

### `db:migrate:deploy` (producción y staging)

Es `prisma migrate deploy`. Solo aplica las migraciones que ya están versionadas en `apps/backend/prisma/migrations/`; no crea migraciones, no compara contra el schema y no ofrece resetear nada. Es el único comando de migraciones que se usa en producción (ver [Despliegue](../deployment.md)).

### `db:seed` (destructivo, solo desarrollo)

Borra **todos los clientes** (los contactos caen en cascada) y los reemplaza por los de ejemplo. No es incremental ni se puede deshacer. Nunca se ejecuta en producción: el seed se niega a correr si `NODE_ENV=production` o si el host de `DATABASE_URL` no es `localhost`, `127.0.0.1` o `::1`, y no hay una variable para saltear esa guarda. Con la base en Docker de esta guía (`localhost`) no hace falta hacer nada especial.

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [Primeros pasos](getting-started.md)
