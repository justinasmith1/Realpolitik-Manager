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

Prisma pedirá un nombre para la nueva migración (por ejemplo: `init_cliente`). Crea y aplica la migración, y regenera el cliente.

### 6. Seedear datos de prueba

```bash
pnpm --filter @realpolitik/backend db:seed
```

Inserta datos iniciales (10 clientes de ejemplo).

### 7. Verificar en Prisma Studio (opcional)

```bash
pnpm --filter @realpolitik/backend db:studio
```

Abre una UI en `http://localhost:5555` para explorar y editar los datos directamente.

## Scripts disponibles

| Script              | Qué hace                                                |
| ------------------- | ------------------------------------------------------- |
| `db:generate`       | Regenera el cliente Prisma a partir del schema          |
| `db:migrate`        | Crea y aplica una nueva migración en desarrollo         |
| `db:migrate:deploy` | Aplica migraciones pendientes sin crearlas (producción) |
| `db:seed`           | Inserta datos de prueba en la base de datos             |
| `db:studio`         | Abre Prisma Studio en `http://localhost:5555`           |

Todos se ejecutan con `pnpm --filter @realpolitik/backend <script>`.

## Siguiente lectura

- [ADR 0002 — Modelado de datos](../adr/0002-modelado-datos.md)
- [Primeros pasos](getting-started.md)
