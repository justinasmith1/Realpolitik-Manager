# ADR-0003 — Modelado de requisitos y rendiciones

## Estado

Proposed

## Fecha

2026-10-20 (actualizada el 2026-10-21 con la unicidad del nombre del tipo de documento, HU2.1: ver punto 8)

## Contexto

El Sprint 2 introduce el núcleo del producto: cada cliente exige un conjunto de documentos para aceptar una rendición (la **matriz de requisitos**), y cada rendición se arma con un **checklist** de esos documentos. La tarea T2.1 define solo la capa de datos (schema Prisma, migración, seed); los schemas Zod, la generación del checklist (T2.2) y el contrato de API (T2.3) vienen después.

Decisiones de negocio ya cerradas con la administradora, que este modelo respeta:

- No hay requisitos condicionales: todo requisito de la matriz entra siempre en el checklist.
- Un cliente puede tener varias rendiciones en el mismo período (una por factura).
- Un requisito tiene una cantidad por período (ej. Print x5) y, opcionalmente, un día aproximado por cada ocurrencia.
- Un cliente puede mandar documentos por más de un canal, pero tiene un canal por defecto (`Cliente.canalEntrega`, HU1.4).
- Un ítem del checklist se completa solo al aplicarle un documento (HU2.8); no hay tilde manual.
- La factura no es implícita: es un requisito más de la matriz (tipo "Factura" del catálogo). Todo cliente pide al menos la factura (confirmado con la administradora el 20/10/2026).
- Las indicaciones de armado del legajo (HU2.4) son un texto libre por cliente.

Restricciones heredadas de ADR-0002: UUID como clave, baja lógica (`isDeleted` + `deletedAt`) y auditoría (`createdAt` / `updatedAt`).

## Decisión

### 1. Modelos

- **`TipoDocumento`**: catálogo. El nombre es único sin distinguir mayúsculas, acentos ni espacios repetidos, mediante la clave persistida `nombreNormalizado` (punto 8). Un tipo no se borra: se desactiva con `activo = false` y deja de ofrecerse al armar matrices.
- **`RequisitoCliente`** (la matriz): cliente + tipo de documento, `cantidad` por período, `diasAproximados`, `canalEntrega` opcional y `nota`. Con baja lógica.
- **`Cliente`** suma dos campos:
  - `matrizConfigurada` (default `false`): indica si el cliente ya tiene su matriz configurada, es decir, al menos un requisito activo. La mantiene el backend: pasa a `true` al haber un requisito activo y vuelve a `false` al dar de baja el último. No se edita a mano. Una matriz sin requisitos activos significa que todavía no se configuró: no existe la "matriz vacía a propósito".
  - `indicacionesArmado` (`VARCHAR(1000)`, opcional): indicaciones de armado del legajo.
- **`Rendicion`**: cliente + `anio` + `mes` + `numeroFactura` (número de factura, obligatorio). Un número de factura está en una sola rendición **activa** del cliente, sin importar el período: la unicidad es (cliente, `numeroFactura`) entre las activas. Un cliente puede tener varias rendiciones en el mismo mes, una por factura, y la misma factura en dos clientes distintos se acepta. La orden de compra se modela aparte en otra HU. Con baja lógica: una rendición abierta con un período o un número de factura mal cargados se anula (`isDeleted`) en vez de borrarse, porque tiene valor fiscal (corrección en HU2.5).
- **`ItemChecklist`**: un documento a presentar en una rendición.

### 2. El checklist es una foto (snapshot)

Al abrir una rendición, cada requisito activo de la matriz se copia en ítems: uno por ocurrencia (un requisito con cantidad 5 genera 5 ítems, ordinal 1 a 5 de `totalOrdinal` 5). Después, el ítem **no se vuelve a leer de la matriz**.

Motivo: inmutabilidad histórica. La matriz cambia con el tiempo (se agregan, quitan o modifican requisitos, se renombra o desactiva un tipo). Una rendición ya abierta, y sobre todo un legajo ya entregado, tiene que mostrar lo que se pidió en su momento.

El snapshot no se re-lee de la matriz. Excepción explícita: la operadora puede agregar a una rendición activa los ítems de un requisito nuevo que el cliente empieza a pedir ese mes; los ítems existentes no cambian. Nunca es automático: el alta en la matriz no toca rendiciones abiertas (endpoint `POST /rendiciones/:id/requisitos/:requisitoId`, T2.3).

**Qué se copia en el ítem** (columnas tipadas):

| Columna                    | Origen                                                      |
| -------------------------- | ----------------------------------------------------------- |
| `tipoDocumentoId`          | del requisito                                               |
| `nombreTipoDocumento`      | nombre del tipo en ese momento, como texto                  |
| `ordinal` / `totalOrdinal` | número de ocurrencia y cantidad del requisito               |
| `diaAproximado`            | el día de esa ocurrencia, si el requisito tenía días        |
| `canalEntrega`             | el canal **efectivo ya resuelto** (ver punto 3), nunca null |

**Qué no se copia**: la `nota` del requisito, la descripción del tipo y los datos del cliente. `requisitoClienteId` se guarda solo como trazabilidad ("de qué requisito salió"); no se usa para leer datos actuales.

El ítem además tiene `completado` y `completadoAt`. `completado` lo marca HU2.8 al aplicar un documento; se guarda en el ítem para poder consultar el progreso sin recorrer documentos.

### 3. Canal por requisito, con el del cliente como fallback

`Cliente.canalEntrega` sigue siendo **un solo valor**: el canal por defecto. Cada `RequisitoCliente` tiene un `canalEntrega` propio y opcional que lo pisa solo para ese tipo de documento; `null` significa "usa el del cliente". Al abrir la rendición, el ítem guarda el canal efectivo (`requisito.canalEntrega ?? cliente.canalEntrega`).

### 4. Días aproximados como array, con CHECK

`diasAproximados` es una lista de enteros en el requisito (ej. `[1, 8, 15, 22, 31]`). Reglas, garantizadas en la base:

- `ck_requisito_dias_coherentes`: la lista existe y está vacía o tiene exactamente `cantidad` días.
- `ck_requisito_dias_rango`: cada día entre 1 y 31, sin elementos `NULL`, en una lista de una dimensión.

Detalle técnico: Prisma crea las listas (`Int[]`) **sin** `NOT NULL`, y en SQL `x >= ALL(arr)` da `NULL` (que un CHECK acepta) si el array tiene un elemento `NULL`. Por eso los CHECK exigen `IS NOT NULL` y `array_position(arr, NULL) IS NULL` explícitamente.

### 5. Unicidad con baja lógica: índices únicos parciales

Un cliente no puede tener dos requisitos **activos** del mismo tipo, pero un requisito dado de baja no debe impedir volver a agregarlo. Lo mismo con las rendiciones: un número de factura no puede estar en dos rendiciones activas del cliente, pero una rendición anulada no debe impedir volver a usarlo en otra bien cargada. Se resuelve con índices únicos parciales, creados a mano en la migración:

```sql
CREATE UNIQUE INDEX "uq_requisito_cliente_tipo_activo"
  ON "RequisitoCliente"("clienteId", "tipoDocumentoId")
  WHERE "isDeleted" = false;

CREATE UNIQUE INDEX "uq_rendicion_factura_activa"
  ON "Rendicion"("clienteId", "numeroFactura")
  WHERE "isDeleted" = false;
```

Prisma 5 no puede declarar índices parciales en `schema.prisma`, así que no aparecen ahí (están listados en el bloque de comentarios). **Evidencia de que Prisma no los borra**: con la migración ya aplicada,

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

| CHECK                                  | Regla                           |
| -------------------------------------- | ------------------------------- |
| `ck_requisito_cantidad_positiva`       | `cantidad >= 1`                 |
| `ck_requisito_baja_logica`             | `isDeleted` ⇔ `deletedAt`       |
| `ck_rendicion_mes`                     | `mes` 1..12 y `anio` 2020..2100 |
| `ck_rendicion_numero_factura_no_vacio` | `btrim(numeroFactura) <> ''`    |
| `ck_rendicion_baja_logica`             | `isDeleted` ⇔ `deletedAt`       |
| `ck_item_ordinal`                      | `1 <= ordinal <= totalOrdinal`  |
| `ck_item_completado_coherente`         | `completado` ⇔ `completadoAt`   |
| `ck_item_dia_rango`                    | `diaAproximado` null o 1..31    |

Como en el resto del modelo, la aplicación valida primero (T2.2) y los CHECK son la última línea de defensa.

### 8. Nombre del tipo de documento: clave normalizada persistida (HU2.1)

**Regla de negocio.** Dos tipos de documento son el mismo si sus nombres coinciden sin distinguir mayúsculas, acentos ni espacios repetidos: `Constancia ARCA`, `constancia  arca` y `Constancía ARCA` son un único tipo. La `ñ` es otra letra: `Año` y `Ano` son tipos distintos.

**Decisión.** `TipoDocumento` tiene una columna técnica `nombreNormalizado` (`VARCHAR(100) NOT NULL`) con un índice único (`TipoDocumento_nombreNormalizado_key`, declarado con `@unique` en `schema.prisma`). `nombre` guarda el texto tal como lo escribió la administradora y **ya no es único por sí solo**.

- La clave la calcula `normalizarNombreTipoDocumento`, de `@realpolitik/shared`, que es la **única** implementación de la regla. Toda escritura del nombre (alta, edición, seed) calcula la clave con esa función y guarda las dos columnas juntas.
- Normalización: recorta los bordes y colapsa los espacios internos (`\s`, incluido el espacio duro) en uno solo; descompone en NFD; pasa a minúsculas; elimina las marcas combinantes salvo la tilde que sigue a una `n`; recompone en NFC. La `ñ` da la misma clave escrita como un carácter (U+00F1) o como `n` + U+0303. Las letras que Unicode no descompone (`ø`, `ł`, `ß`) quedan como están. Es idempotente y el resultado nunca es más largo que la entrada.
- `nombreNormalizado` **no forma parte de la API**: es un detalle de persistencia.
- Un duplicado lo rechaza la base con `P2002` y `target = ["nombreNormalizado"]`. El backend (`modules/tipos-documento`) lo responde como `409 CONFLICT` con `motivo: "TIPO_DOCUMENTO_DUPLICADO"` y el tipo que ya tiene la clave (contrato de API, 4.1).

**Motivos.**

- La base garantiza la regla también ante dos altas simultáneas. Un "buscar y después crear" en la aplicación tiene una carrera, y no protege de un script ni de Prisma Studio.
- La regla vive en un solo lugar. El backend no reimplementa la normalización, y el frontend puede usar la misma función para avisar antes de enviar.
- No requiere extensiones de PostgreSQL ni collations especiales (ver Alternativas).
- Como es una columna común con `@unique`, `schema.prisma` refleja la regla y `prisma migrate diff` la conoce. No queda solo en SQL, como los índices parciales del punto 5.

**Migración** (`20261021120000_hu2_1_tipo_documento_nombre_normalizado`, escrita a mano):

1. Va entera en una transacción explícita (`BEGIN` … `COMMIT`). Si algo falla, la tabla queda como estaba.
2. Dos guardas antes de cualquier cambio:
   - aborta si algún nombre no es ASCII imprimible o está vacío;
   - aborta si dos nombres dan la misma clave, y los nombra. No adivina cuál conservar ni los fusiona: requisitos e ítems pueden apuntar a cualquiera de los dos.
3. Agrega la columna y la completa con `lower(regexp_replace(btrim(nombre), ' {2,}', ' ', 'g') COLLATE "C")`. Para texto ASCII imprimible (lo único que pudo cargar el seed de T2.1) eso es exactamente la regla de shared. Después la marca `NOT NULL`.
4. Reemplaza el índice único de `nombre` por el de `nombreNormalizado`.

No borra filas ni cambia ids: las FK de requisitos e ítems no se tocan.

**Renombre del catálogo.** El seed de T2.1 cargaba "Orden de compra"; el nombre validado es "OC", con "Orden de compra" como descripción. El seed renombra la **misma fila** (mismo id), así que requisitos e ítems siguen apuntando a ella. Si en la base están los dos nombres, el seed falla con un error claro y no los fusiona. Los ítems de rendiciones ya abiertas conservan su `nombreTipoDocumento` anterior: es el snapshot del punto 2.

## Alternativas consideradas

- **Requisitos condicionales** (obligatorio / condicional, con una decisión por período): descartados en la validación con la administradora el 18/10/2026. Todo requisito de la matriz entra siempre en el checklist.
- **Rendición única por cliente + mes**: no alcanza; un cliente puede tener varias facturas en el mismo mes, cada una con su legajo. La unicidad es por número de factura.
- **Referencia libre (factura u orden)**: un único campo `referencia` que admitiera el número de factura o el de la orden de compra, con unicidad por cliente + período + referencia. Descartada el 20/10/2026 (confirmado por el dueño): la orden de compra se repite entre meses y entre facturas del mismo mes, y puede no existir, así que no identifica una rendición. La factura sí: el campo pasa a ser `numeroFactura`, único por cliente entre las activas, y la orden de compra se modela aparte en otra HU.
- **Tabla aparte para las indicaciones de armado**: es un único texto libre por cliente, sin historial ni estructura propia; una tabla agregaba un join sin beneficio. Queda como campo de `Cliente`.
- **Tilde manual del checklist**: descartado el 19/10/2026. Un ítem se completa solo al aplicarle un documento (HU2.8), así el progreso siempre está respaldado por un archivo.
- **Canales como array en `Cliente`**: dice por qué canales se manda, pero no qué documento va por cuál. El override por requisito sí lo dice, y `Cliente.canalEntrega` queda como un único canal por defecto (sin cambiar HU1.4).
- **Snapshot del requisito como campo `Json`**: más simple de escribir, pero pierde tipado, no admite CHECK ni FK, y no se puede filtrar ni consultar con normalidad (ej. "ítems pendientes por canal"). Se usan columnas tipadas.
- **Reactivar la fila dada de baja en vez del índice parcial**: ver punto 5.
- **Unicidad del nombre del tipo de documento** (punto 8):
  - **Índice único sobre una expresión** (`lower(unaccent(nombre))`): necesita la extensión `unaccent`, que no es `IMMUTABLE` (hay que envolverla para usarla en un índice) y además le quita la tilde a la `ñ`. La regla quedaría duplicada en SQL y en TypeScript, y Prisma 5 no puede declarar el índice.
  - **Collation ICU no determinista** (insensible a mayúsculas y acentos): depende de la versión de ICU del servidor, también confunde `ñ` con `n`, no admite `LIKE` y Prisma no la declara.
  - **`citext`**: solo ignora mayúsculas, no acentos, y es otra extensión.
  - **Validar solo en la aplicación**: carrera entre altas simultáneas y nada protege lo que no pasa por la API.
  - **Guardar el nombre ya normalizado en `nombre`**: se pierde cómo lo escribió la administradora ("Constancia ARCA" se mostraría "constancia arca").
- **Factura implícita / matriz vacía a propósito**: la idea era que la factura acompañara siempre a la rendición sin figurar en la matriz, y que `matrizConfigurada = true` con la matriz vacía marcara a un cliente que se rinde solo con la factura. Descartada el 20/10/2026: todo cliente pide al menos la factura, así que conviene tratarla como un requisito más (con su cantidad, días y canal, y como ítem del checklist). Así, una matriz sin requisitos activos solo puede significar que falta configurarla, y `matrizConfigurada` se deduce de los requisitos en vez de cargarse a mano.

## Consecuencias

- **Positivas**: los legajos históricos no cambian cuando cambia la matriz; la base rechaza datos incoherentes aunque no pasen por la API; el canal efectivo de cada documento queda explícito en el ítem; el modelo admite varias rendiciones por mes sin casos especiales.
- **Negativas**: el snapshot duplica datos (nombre del tipo, canal) en cada ítem. Los CHECK y el índice parcial viven solo en SQL: quien lea `schema.prisma` tiene que mirar el bloque de comentarios o la migración.
- **Del punto 8 (HU2.1)**:
  - `nombreNormalizado` es un dato derivado que se guarda. Si alguien escribe `nombre` sin recalcular la clave (SQL manual, Prisma Studio), la base no lo detecta. El test de integración "coherencia de la clave en toda la tabla" lo controla en la base de test.
  - Cambiar la regla de normalización obliga a una migración de datos que recalcule todas las claves y vuelva a buscar colisiones.
  - La migración de HU2.1 solo sabe completar nombres ASCII. Ante otro dato, aborta y hay que corregirlo a mano.
- **A resolver**:
  - T2.2 tiene que implementar la generación del checklist con exactamente estas reglas de copia y resolución de canal.
  - Las consultas de rendiciones tienen que filtrar `isDeleted = false`. El endpoint o botón para anular una rendición lo define T2.3 / HU2.5.
  - La unicidad de `numeroFactura` es por cliente, no global, porque facturan dos razones sociales, cada una con su numeración propia.
  - Un mismo cliente puede recibir facturas de las dos razones sociales emisoras, cada una con su numeración; cuando se modele el emisor (HU2.9–2.12), la unicidad pasa a (emisor, numeroFactura).
  - El seed actual borra todos los clientes con `deleteMany`. Con `Rendicion → Cliente` en `Restrict`, ese borrado va a fallar en cuanto la base de desarrollo tenga rendiciones. Se decidió dejarlo así (frenar es más seguro que borrar rendiciones en silencio) y revisarlo cuando existan.
  - Si en algún momento cambia la estrategia de índices de Prisma (por ejemplo, una versión que soporte índices parciales en el schema), conviene declarar `uq_requisito_cliente_tipo_activo` también ahí.
  - Hecho (HU2.1): los endpoints de tipos de documento calculan `nombreNormalizado` en cada alta y edición, traducen el `P2002` sobre `nombreNormalizado` en un conflicto, y el contrato de API (4.1) quedó actualizado.
