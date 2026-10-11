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

## Integridad en la base (CHECK)

Las reglas de Cliente y Contacto se validan **primero** en la aplicación (`@realpolitik/shared` y el backend, que responden `400` antes de llegar a la base). PostgreSQL además las garantiza con CHECK constraints, como última línea de defensa frente a lo que no pasa por la API (scripts, Prisma Studio, SQL manual, un bug futuro):

| Constraint                          | Regla                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `ck_cliente_sector_subtipo`         | `PUBLICO` tiene subtipo; `PRIVADO` no                                                         |
| `ck_cliente_portal_requerido`       | `PORTAL_WEB` tiene `portalUrl` no vacía                                                       |
| `ck_cliente_whatsapp_requerido`     | `WHATSAPP` tiene `whatsappNumero` no vacío                                                    |
| `ck_cliente_periodicidad_coherente` | Sin configurar (las tres columnas en null), o tipo + día 1..28, y mes 1..12 solo en BIMESTRAL |
| `ck_cliente_baja_logica`            | `isDeleted` y `deletedAt` van juntos                                                          |
| `ck_contacto_baja_logica`           | Ídem para contactos                                                                           |

Viven en SQL, en la migración `20261010120000_integridad_cliente_contacto`: Prisma Schema no puede representarlos (por eso no aparecen en `schema.prisma`, que los menciona en comentarios). `prisma migrate diff` no los ve, así que una migración generada con `db:migrate` no los borra. No se exige que los datos de los canales no usados estén vacíos.

`SUSPENDIDO` sigue en el enum `ClienteEstado`, reservado para el futuro: la API no lo asigna y la UI no lo ofrece ni lo lista.

## Tests de integración

Las suites `*.integration.test.ts` del backend (y los `*.api.test.tsx` del frontend) corren contra PostgreSQL real. Sin `TEST_DATABASE_URL` se saltan, y **se niegan a correr** si esa base no se llama `*_audit` o `*_test`: nunca apuntan a la de desarrollo. Cada suite borra lo que crea.

```bash
# una vez: crear la base descartable y migrarla
docker exec realpolitik_db psql -U realpolitik -d postgres -c "CREATE DATABASE realpolitik_test"
DATABASE_URL="postgresql://realpolitik:realpolitik_dev@localhost:5432/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend db:migrate:deploy

# backend
TEST_DATABASE_URL="postgresql://realpolitik:realpolitik_dev@localhost:5432/realpolitik_test?schema=public" \
  pnpm --filter @realpolitik/backend test:integration
```

El frontend contra la API real (`test:api`) necesita además un backend levantado contra esa misma base y `TEST_API_URL` (ver el comentario de `EditarClienteSheet.api.test.tsx`). En el CI todo esto lo hace el workflow con una base efímera.

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [Primeros pasos](getting-started.md)
