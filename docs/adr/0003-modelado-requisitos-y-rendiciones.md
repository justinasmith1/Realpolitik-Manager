# ADR-0003 — Modelado de requisitos y rendiciones

## Estado

Proposed

## Fecha

2026-10-20

## Contexto

El Sprint 2 introduce el núcleo del producto: cada cliente exige un conjunto de documentos para aceptar una rendición (la **matriz de requisitos**), y cada rendición se arma con un **checklist** de esos documentos. La tarea T2.1 define solo la capa de datos (schema Prisma, migración, seed); los schemas Zod, la generación del checklist (T2.2) y el contrato de API (T2.3) vienen después.

Decisiones de negocio ya cerradas con la administradora, que este modelo respeta:

- No hay requisitos condicionales: todo requisito de la matriz entra siempre en el checklist.
- Un cliente puede tener varias rendiciones en el mismo período (una por factura u orden).
- Un requisito tiene una cantidad por período (ej. Print x5) y, opcionalmente, un día aproximado por cada ocurrencia.
- Un cliente puede mandar documentos por más de un canal, pero tiene un canal por defecto (`Cliente.canalEntrega`, HU1.4).
- Un ítem del checklist se completa solo al aplicarle un documento (HU2.8); no hay tilde manual.
- Las indicaciones de armado del legajo (HU2.4) son un texto libre por cliente.

Restricciones heredadas de ADR-0002: UUID como clave, baja lógica (`isDeleted` + `deletedAt`) y auditoría (`createdAt` / `updatedAt`).

## Decisión

### 1. Modelos

- **`TipoDocumento`**: catálogo (`nombre` único). Un tipo no se borra: se desactiva con `activo = false` y deja de ofrecerse al armar matrices.
- **`RequisitoCliente`** (la matriz): cliente + tipo de documento, `cantidad` por período, `diasAproximados`, `canalEntrega` opcional y `nota`. Con baja lógica.
- **`Cliente`** suma dos campos:
  - `matrizConfigurada` (default `false`): distingue "matriz vacía a propósito" (el cliente se rinde solo con la factura) de "todavía no se configuró".
  - `indicacionesArmado` (`VARCHAR(1000)`, opcional): indicaciones de armado del legajo.
- **`Rendicion`**: cliente + `anio` + `mes` + `referencia` (número de factura u orden, obligatorio). Única por esa combinación, así que un cliente puede tener varias en el mismo mes.
- **`ItemChecklist`**: un documento a presentar en una rendición.

### 2. El checklist es una foto (snapshot)

Al abrir una rendición, cada requisito activo de la matriz se copia en ítems: uno por ocurrencia (un requisito con cantidad 5 genera 5 ítems, ordinal 1 a 5 de `totalOrdinal` 5). Después, el ítem **no se vuelve a leer de la matriz**.

Motivo: inmutabilidad histórica. La matriz cambia con el tiempo (se agregan, quitan o modifican requisitos, se renombra o desactiva un tipo). Una rendición ya abierta, y sobre todo un legajo ya entregado, tiene que mostrar lo que se pidió en su momento.

**Qué se copia en el ítem** (columnas tipadas):

| Columna                    | Origen                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `tipoDocumentoId`          | del requisito                                               |
| `nombreTipoDocumento`      | nombre del tipo en ese momento, como texto                  |
| `ordinal` / `totalOrdinal` | número de ocurrencia y cantidad del requisito               |
| `diaAproximado`            | el día de esa ocurrencia, si el requisito tenía días        |
| `canalEntrega`             | el canal **efectivo ya resuelto** (ver punto 3), nunca null |

**Qué no se copia**: la `nota` del requisito, la descripción del tipo y los datos del cliente. `requisitoClienteId` se guarda solo como trazabilidad ("de qué requisito salió"); no se usa para leer datos actuales.

El ítem además tiene `aplica` (default `true`), `completado` y `completadoAt`. `completado` lo marca HU2.8 al aplicar un documento; se guarda en el ítem para poder consultar el progreso sin recorrer documentos.

### 3. Canal por requisito, con el del cliente como fallback

`Cliente.canalEntrega` sigue siendo **un solo valor**: el canal por defecto. Cada `RequisitoCliente` tiene un `canalEntrega` propio y opcional que lo pisa solo para ese tipo de documento; `null` significa "usa el del cliente". Al abrir la rendición, el ítem guarda el canal efectivo (`requisito.canalEntrega ?? cliente.canalEntrega`).

### 4. Días aproximados como array, con CHECK

`diasAproximados` es una lista de enteros en el requisito (ej. `[1, 8, 15, 22, 31]`). Reglas, garantizadas en la base:

- `ck_requisito_dias_coherentes`: la lista existe y está vacía o tiene exactamente `cantidad` días.
- `ck_requisito_dias_rango`: cada día entre 1 y 31, sin elementos `NULL`, en una lista de una dimensión.

Detalle técnico: Prisma crea las listas (`Int[]`) **sin** `NOT NULL`, y en SQL `x >= ALL(arr)` da `NULL` (que un CHECK acepta) si el array tiene un elemento `NULL`. Por eso los CHECK exigen `IS NOT NULL` y `array_position(arr, NULL) IS NULL` explícitamente.

### 5. Unicidad del requisito con baja lógica: índice único parcial

Un cliente no puede tener dos requisitos **activos** del mismo tipo, pero un requisito dado de baja no debe impedir volver a agregarlo. Se resuelve con un índice único parcial, creado a mano en la migración:

```sql
CREATE UNIQUE INDEX "uq_requisito_cliente_tipo_activo"
  ON "RequisitoCliente"("clienteId", "tipoDocumentoId")
  WHERE "isDeleted" = false;
```

Prisma 5 no puede declarar índices parciales en `schema.prisma`, así que el índice no aparece ahí (está listado en el bloque de comentarios). **Evidencia de que Prisma no lo borra**: con la migración ya aplicada,

- `prisma migrate diff --from-url <base> --to-schema-datamodel prisma/schema.prisma --script` devuelve `-- This is an empty migration.`;
- `prisma migrate dev --create-only` genera una migración vacía (sin `DROP INDEX`);
- `prisma migrate status` informa `Database schema is up to date!`.

Por qué no reactivar la fila dada de baja (la alternativa): obliga a toda la capa de aplicación a buscar primero una fila borrada y "revivirla" en vez de insertar, mezcla el historial del requisito anterior con el nuevo (fechas de alta, `requisitoClienteId` de ítems viejos apuntando a una fila con otra cantidad) y la regla queda en código, no en la base.

### 6. Reglas `onDelete`

En este proyecto las bajas son lógicas: estas reglas solo actúan ante un borrado físico (SQL manual, scripts, el seed). El criterio es que **borrar un requisito o un tipo de documento nunca borre ni rompa ítems de rendiciones ya abiertas**.

| Relación                             | Regla      | Motivo                                                                                                                      |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ItemChecklist` → `Rendicion`        | `Cascade`  | Los ítems son parte de la rendición.                                                                                        |
| `ItemChecklist` → `RequisitoCliente` | `Restrict` | Conserva la trazabilidad; un requisito con ítems no se borra físicamente.                                                   |
| `ItemChecklist` → `TipoDocumento`    | `Restrict` | El tipo se desactiva, no se borra.                                                                                          |
| `RequisitoCliente` → `TipoDocumento` | `Restrict` | Ídem.                                                                                                                       |
| `RequisitoCliente` → `Cliente`       | `Cascade`  | Configuración del cliente, como `Contacto`. Si el requisito ya tiene ítems, el `Restrict` de arriba frena el borrado igual. |
| `Rendicion` → `Cliente`              | `Restrict` | El histórico de rendiciones nunca queda huérfano (ADR-0002).                                                                |

### 7. Otras reglas garantizadas en la base

| CHECK                              | Regla                           |
| ---------------------------------- | ------------------------------- |
| `ck_requisito_cantidad_positiva`   | `cantidad >= 1`                 |
| `ck_requisito_baja_logica`         | `isDeleted` ⇔ `deletedAt`       |
| `ck_rendicion_mes`                 | `mes` 1..12 y `anio` 2020..2100 |
| `ck_rendicion_referencia_no_vacia` | `btrim(referencia) <> ''`       |
| `ck_item_ordinal`                  | `1 <= ordinal <= totalOrdinal`  |
| `ck_item_completado_coherente`     | `completado` ⇔ `completadoAt`   |
| `ck_item_dia_rango`                | `diaAproximado` null o 1..31    |

Como en el resto del modelo, la aplicación valida primero (T2.2) y los CHECK son la última línea de defensa.

## Alternativas consideradas

- **Requisitos condicionales** (obligatorio / condicional, con una decisión por período): descartados en la validación con la administradora el 18/10/2026. Todo requisito de la matriz entra siempre en el checklist.
- **Rendición única por cliente + mes**: no alcanza; un cliente puede tener varias facturas u órdenes en el mismo mes, cada una con su legajo. Se agrega `referencia` a la unicidad.
- **Tabla aparte para las indicaciones de armado**: es un único texto libre por cliente, sin historial ni estructura propia; una tabla agregaba un join sin beneficio. Queda como campo de `Cliente`.
- **Tilde manual del checklist**: descartado el 19/10/2026. Un ítem se completa solo al aplicarle un documento (HU2.8), así el progreso siempre está respaldado por un archivo.
- **Canales como array en `Cliente`**: dice por qué canales se manda, pero no qué documento va por cuál. El override por requisito sí lo dice, y `Cliente.canalEntrega` queda como un único canal por defecto (sin cambiar HU1.4).
- **Snapshot del requisito como campo `Json`**: más simple de escribir, pero pierde tipado, no admite CHECK ni FK, y no se puede filtrar ni consultar con normalidad (ej. "ítems pendientes por canal"). Se usan columnas tipadas.
- **Reactivar la fila dada de baja en vez del índice parcial**: ver punto 5.

## Consecuencias

- **Positivas**: los legajos históricos no cambian cuando cambia la matriz; la base rechaza datos incoherentes aunque no pasen por la API; el canal efectivo de cada documento queda explícito en el ítem; el modelo admite varias rendiciones por mes sin casos especiales.
- **Negativas**: el snapshot duplica datos (nombre del tipo, canal) en cada ítem. Los CHECK y el índice parcial viven solo en SQL: quien lea `schema.prisma` tiene que mirar el bloque de comentarios o la migración.
- **A resolver**:
  - T2.2 tiene que implementar la generación del checklist con exactamente estas reglas de copia y resolución de canal.
  - El seed actual borra todos los clientes con `deleteMany`. Con `Rendicion → Cliente` en `Restrict`, ese borrado va a fallar en cuanto la base de desarrollo tenga rendiciones. Se decidió dejarlo así (frenar es más seguro que borrar rendiciones en silencio) y revisarlo cuando existan.
  - Si en algún momento cambia la estrategia de índices de Prisma (por ejemplo, una versión que soporte índices parciales en el schema), conviene declarar `uq_requisito_cliente_tipo_activo` también ahí.
