# ADR-0003 — Modelado de requisitos y rendiciones

## Estado

Accepted

## Fecha

2026-10-20 (actualizada el 2026-10-21 con la unicidad del nombre del tipo de documento, HU2.1: ver punto 8; el 2026-10-27 con la corrección del canal de un ítem, punto 9, y las reglas confirmadas con el negocio; y el 2026-10-30 con el emisor del cliente y de la rendición, y la unicidad del número de factura por emisor, HU2.9: ver punto 11)

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
- **`Cliente`** suma tres campos:
  - `matrizConfigurada` (default `false`): indica si el cliente ya tiene su matriz configurada, es decir, al menos un requisito activo. La mantiene el backend: pasa a `true` al haber un requisito activo y vuelve a `false` al dar de baja el último. No se edita a mano. Una matriz sin requisitos activos significa que todavía no se configuró: no existe la "matriz vacía a propósito".
  - `indicacionesArmado` (`VARCHAR(1000)`, opcional): indicaciones de armado del legajo.
  - `observaciones` (`VARCHAR(1000)`, opcional): nota interna con hechos puntuales de la cuenta (HU2.10). Es una sola nota que se reemplaza al guardar, con la misma lógica que `indicacionesArmado`: un campo de `Cliente`, sin tabla aparte.
- **`Rendicion`**: cliente + `anio` + `mes` + `numeroFactura` (número de factura, obligatorio). Un número de factura está en una sola rendición **activa por emisor**, sin importar el período ni el cliente: desde HU2.9 la unicidad es (`emisor`, `numeroFactura`) entre las activas, incluso entre clientes distintos (punto 11; antes era (cliente, `numeroFactura`)). Un cliente puede tener varias rendiciones en el mismo mes, una por factura, y recibir facturas de los dos emisores. `Rendicion.emisor` es una foto tomada al abrirla; es `NULL` en las anteriores a HU2.9, que conservan la regla por cliente. La orden de compra se modela aparte en otra HU. Con baja lógica: una rendición abierta con un período o un número de factura mal cargados se anula (`isDeleted`) en vez de borrarse, porque tiene valor fiscal (corrección en HU2.5).
- **`ItemChecklist`**: un documento a presentar en una rendición.

### 2. El checklist es una foto (snapshot)

Al abrir una rendición, cada requisito activo de la matriz se copia en ítems: uno por ocurrencia (un requisito con cantidad 5 genera 5 ítems, ordinal 1 a 5 de `totalOrdinal` 5). Después, el ítem **no se vuelve a leer de la matriz**.

Motivo: inmutabilidad histórica. La matriz cambia con el tiempo (se agregan, quitan o modifican requisitos, se renombra o desactiva un tipo). Una rendición ya abierta, y sobre todo un legajo ya entregado, tiene que mostrar lo que se pidió en su momento.

El snapshot no se re-lee de la matriz. Dos excepciones explícitas, siempre a mano y solo en una rendición activa:

- la operadora puede agregar a una rendición activa los ítems de un requisito nuevo que el cliente empieza a pedir ese mes; los ítems existentes no cambian. Nunca es automático: el alta en la matriz no toca rendiciones abiertas (endpoint `POST /rendiciones/:id/requisitos/:requisitoId`, T2.3);
- la operadora puede corregir el **canal** de los ítems: de a uno (punto 9) o todos los de un requisito en las rendiciones que elija (punto 10). El resto del snapshot no cambia.

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

Un cliente no puede tener dos requisitos **activos** del mismo tipo, pero un requisito dado de baja no debe impedir volver a agregarlo. Lo mismo con las rendiciones: un número de factura no puede estar en dos rendiciones activas, pero una rendición anulada no debe impedir volver a usarlo en otra bien cargada. Se resuelve con índices únicos parciales, creados a mano en la migración (el de la factura, tal como se creó en T2.1b; **HU2.9 lo reemplazó por dos**, ver punto 11):

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

### 9. Corrección del canal de un ítem (27/10/2026)

**Problema.** Cada ítem guarda el canal efectivo del momento en que se abrió la rendición (o se le sumó el requisito). Si el requisito tenía un canal equivocado, corregir el requisito después no arregla las rendiciones ya abiertas, y no había forma de corregirlas.

**Decisión de PO.**

- El canal de un ítem se corrige desde el detalle de la rendición, **ítem por ítem** (`PATCH /rendiciones/:id/items/:itemId/canal`).
- **Solo el canal.** El tipo, el nombre, el ordinal y el día aproximado siguen siendo la foto del punto 2: no se editan.
- **Solo en rendiciones activas.** Una anulada responde `409 RENDICION_ANULADA`: se conserva como historial, tal cual.
- **Local a esa rendición.** No modifica el requisito del cliente ni los ítems de otras rendiciones. Si el requisito también está mal, se corrige aparte, en la matriz (y desde ahí se puede propagar, punto 10).
- Con el mismo canal no se escribe (idempotente).

### 10. Propagar el canal de un requisito a rendiciones abiertas (27/10/2026)

**Problema.** Con el punto 9, si cambia el canal de un requisito (por ejemplo, Print pasa de WhatsApp a Portal web), hay que entrar a cada rendición abierta y cambiar cada ítem: con Print x3, tres cambios por rendición.

**Decisión de PO.**

- Al guardar la edición de un requisito en la que cambió el **canal efectivo** (el propio o, si hereda, el del cliente; incluye volver a heredar, si el del cliente es distinto), si el cliente tiene rendiciones **activas** con ítems de ese requisito, se ofrece actualizarlas. Mismo patrón que sumar un requisito nuevo: la lista de esas rendiciones (período y factura), **ninguna tildada**, "Ahora no" y "Actualizar las elegidas".
- Si el canal efectivo no cambió, o no hay rendiciones activas con ese requisito, no se ofrece nada.
- En cada rendición elegida pasan al canal efectivo nuevo **todos** los ítems de ese requisito. Ningún otro campo del snapshot ni otros ítems cambian (`POST /clientes/:id/requisitos/:requisitoId/propagar-canal`).
- Las **anuladas** nunca se ofrecen ni se modifican.
- **Todo o nada.** Si una rendición elegida dejó de cumplir (se anuló, no tiene ítems del requisito, es de otro cliente), no se cambia ninguna. El requisito ya quedó guardado igual.
- El canal no viaja en el pedido: el backend lo resuelve con el requisito y el cliente, como al abrir una rendición.
- La corrección ítem por ítem del punto 9 sigue existiendo para los casos puntuales.

### 11. Emisor del cliente (HU2.9, 30/10/2026)

Se factura con dos emisores: una persona física y una persona jurídica (sociedad). Cuál se usa depende de lo que exige el organismo destinatario. Este punto cubre el emisor **habitual del cliente** y el emisor de **cada rendición**, con la unicidad del número de factura por emisor.

**Decisión (implementada).**

- `Cliente.emisor` es un enum de PostgreSQL `Emisor` con dos valores, `PERSONA_FISICA` y `SOCIEDAD`, declarado en `schema.prisma` e isomorfo con `Emisor` de `@realpolitik/shared`. La columna es opcional y sin valor por defecto: las filas existentes quedan en `NULL` (sin emisor). La migración es `20261030120000_hu2_9_emisor_cliente`.
- **Enum y no tabla de emisores.** Son dos valores fijos y de negocio, y el repositorio ya usa enums isomorfos con shared (ADR-0002). Una tabla agregaría una clave foránea, un seed y una pantalla de administración sin beneficio. Si apareciera un tercer emisor, alcanza con agregar el valor al enum (`ALTER TYPE … ADD VALUE`) y su etiqueta.
- **Códigos y etiquetas.** Los códigos del enum (`PERSONA_FISICA`, `SOCIEDAD`) son los tipos de emisor y es lo que viaja por la API y se guarda en la base. Lo que ve la persona es el nombre de cada emisor, definido en un solo lugar del frontend, `etiquetasEmisor` en `clientes.etiquetas.ts`; ningún otro archivo repite esos textos.
- **Va en el DTO de Cliente**, no en un endpoint propio como las indicaciones y las observaciones: es un dato fiscal corto, como el canal o la condición de IVA, y el listado y la ficha lo necesitan. Opcional en lectura y en el alta; en la edición, `null` lo quita.
- **Opcional y nunca bloquea.** Un cliente sin emisor es un dato pendiente: la ficha y el formulario lo marcan con "Pendiente", con el patrón de punto y texto con tokens de diseño. El listado no lo marca y no hay filtro por emisor.

**Regla confirmada con el negocio (30/10/2026), implementada en el bloque de la rendición de HU2.9.** Reemplaza lo que decía el "A resolver" de Consecuencias (la unicidad por cliente y la numeración propia de cada razón social).

- Cada emisor tiene su propia numeración de facturas.
- El número de factura no se repite para el mismo emisor entre las rendiciones activas, aunque sean de clientes distintos: la unicidad pasa de (cliente, `numeroFactura`) a (`emisor`, `numeroFactura`). Las rendiciones anuladas siguen liberando el número, con el mismo predicado del índice actual (`"isDeleted" = false`). El número ya incluye la letra y el punto de venta (`B 00002-00001482`).
- La misma factura del mismo emisor **ya no se acepta en dos clientes**; el mismo número con distinto emisor se acepta, también entre clientes.
- `Rendicion.emisor` es una foto: se copia del cliente al abrirla, se puede elegir otro en ese momento (un cliente puede recibir facturas de los dos emisores el mismo mes) y después no se edita; se corrige anulando, como el número y el período. Si el cliente no tiene emisor, hay que elegir uno para abrir la rendición.
- Las rendiciones existentes quedan sin emisor (`NULL`) y conservan la regla vieja, única por cliente, con un segundo índice parcial. Como `Cliente.emisor` nace vacío no hay nada que copiar, y la migración no puede abortar por eso.

**Decisión (rendición, implementada).**

- **Base.** `Rendicion.emisor Emisor?`, migración `20261030130000_hu2_9_emisor_rendicion`, escrita a mano porque Prisma no declara índices parciales. Las filas existentes quedan en `NULL` (sin valor por defecto ni backfill: copiar el emisor habitual del cliente sería adivinar un dato fiscal, justo el caso de un cliente que recibe de los dos emisores). Reemplaza `uq_rendicion_factura_activa` por dos índices con el mismo predicado de baja lógica (`"isDeleted" = false`):

```sql
CREATE UNIQUE INDEX "uq_rendicion_factura_activa_sin_emisor"
  ON "Rendicion"("clienteId", "numeroFactura")
  WHERE "isDeleted" = false AND "emisor" IS NULL;

CREATE UNIQUE INDEX "uq_rendicion_emisor_factura_activa"
  ON "Rendicion"("emisor", "numeroFactura")
  WHERE "isDeleted" = false AND "emisor" IS NOT NULL;
```

- **La migración no puede abortar por datos existentes:** la columna es `NULL` en todas las filas, `..._sin_emisor` cubre las mismas filas y columnas que el índice anterior (que ya las garantizaba únicas) y `..._emisor_factura` empieza sin ninguna fila que lo cubra. Se verificó con datos heredados (la misma factura activa en dos clientes y anuladas repetidas) y con `prisma migrate diff` vacío contra el schema.
- **Servicio.** `emisor = pedido.emisor ?? cliente.emisor`, resuelto dentro de la transacción del alta; si no hay ninguno, `400` con `campo: 'emisor'`. Toda rendición nueva nace con emisor, así que solo puede chocar con el índice por emisor. No hay verificación previa: se inserta y, si el índice rechaza la fila, se responde `409 RENDICION_DUPLICADA` con la existente, buscada por (emisor, número) entre las activas de **todos** los clientes. `details.rendicionExistente` incluye el `clienteId` porque puede ser de otro cliente. No se busca entre las heredadas sin emisor: con una heredada la alta no choca (no comparten índice) y buscarlas podría llevar a la rendición equivocada.
- **Foto.** El emisor de la rendición no se vuelve a leer del cliente: cambiar o quitar el emisor del cliente no modifica una rendición abierta, y la rendición no se edita (se corrige anulando).
- **Frontend.** "Abrir rendición" tiene un selector de emisor, precargado con el del cliente y editable para esa rendición; si el cliente no tiene, arranca vacío y es obligatorio. "Ver rendición" del 409 navega con el `clienteId` de la existente. Las rendiciones heredadas muestran "Sin emisor" en tono neutro.

**Consecuencias de la migración.**

- **(a)** Una rendición heredada sin emisor y una nueva con emisor pueden repetir el número de factura en el mismo cliente sin que los índices lo detecten: cada una cae en un índice distinto. Es lo que resulta de que las existentes mantengan la regla vieja. Hoy solo hay datos de prueba, así que no se asigna un emisor a las heredadas.
- **(b)** `uq_rendicion_factura_activa_sin_emisor` queda sin uso cuando no queden rendiciones heredadas activas, y se puede quitar entonces (con una migración que lo elimine).
- **(c)** Con índices parciales creados en SQL, Prisma informa como `meta.target` del P2002 las **columnas** del índice (`['emisor', 'numeroFactura']` o `['clienteId', 'numeroFactura']`) y no su nombre. Se verificó contra PostgreSQL 16, también dentro de una transacción serializable y con altas concurrentes. Por eso `esFacturaDuplicada` acepta ambas formas (columnas y nombres de los dos índices), y hay un test de integración que provoca cada violación y comprueba lo que informa Prisma.

### Reglas de negocio adicionales (T2.2)

Reglas de validación que se suman en los schemas Zod de T2.2, sobre el modelo anterior:

- ~~**`CANTIDAD_MAX` provisoria de 100**~~: reemplazada por la regla confirmada (31), ver "Reglas confirmadas con el negocio".
- **Período máximo**: se acepta hasta el mes siguiente al actual; un período posterior se rechaza.
- ~~**`numeroFactura` en mayúsculas**~~: reemplazada por el formato de factura argentina, ver "Reglas confirmadas con el negocio".
- **`diasAproximados` ordenado**: el array se ordena automáticamente (de menor a mayor) al guardar.

### Reglas confirmadas con el negocio (Trinidad, 27/10/2026)

- **Cantidad por mes.** Los documentos comunes se piden una vez por mes; los Prints pueden pedirse varias veces, como máximo uno por día. `CANTIDAD_MAX` pasa de 100 (provisorio) a **31**. La base no fija un máximo (su CHECK solo exige `cantidad >= 1`): el tope lo valida `@realpolitik/shared`, y lo que ya estuviera guardado por encima se sigue pudiendo leer.
- **Período.** No se puede abrir una rendición más allá del **mes siguiente** al actual. Sí se pueden abrir rendiciones de **meses anteriores** (por ejemplo, si reclaman una rendición vieja). El único piso es técnico: el año va de 2020 (`ANIO_MIN`) a 2100.
- **Número de factura.** Formato de factura argentina: letra `A`, `B` o `C`, punto de venta de 5 dígitos y número de comprobante de 8 dígitos. Formato canónico: `B 00002-00001482`. Al escribir se normaliza antes de validar (letra en mayúscula, con o sin espacio, y ceros a la izquierda en el punto de venta y el número: `b 2-1482` → `B 00002-00001482`). La unicidad (punto 5) compara el valor canónico, así dos escrituras del mismo comprobante son la misma factura. La lectura no valida el formato: las rendiciones cargadas antes con otro formato se siguen viendo.
- **Días aproximados.** Solo son relevantes para los Prints. El orden no le importa a la operadora, así que ordenarlos al guardar se mantiene.
- **Canal de un ítem.** Se puede corregir en rendiciones activas, de a uno (punto 9) o todos los de un requisito al cambiarle el canal (punto 10); el resto del snapshot no cambia.

## Alternativas consideradas

- **Requisitos condicionales** (obligatorio / condicional, con una decisión por período): descartados en la validación con la administradora el 18/10/2026. Todo requisito de la matriz entra siempre en el checklist.
- **Rendición única por cliente + mes**: no alcanza; un cliente puede tener varias facturas en el mismo mes, cada una con su legajo. La unicidad es por número de factura.
- **Referencia libre (factura u orden)**: un único campo `referencia` que admitiera el número de factura o el de la orden de compra, con unicidad por cliente + período + referencia. Descartada el 20/10/2026 (confirmado por el dueño): la orden de compra se repite entre meses y entre facturas del mismo mes, y puede no existir, así que no identifica una rendición. La factura sí: el campo pasa a ser `numeroFactura`, único por cliente entre las activas (desde HU2.9, por emisor: punto 11), y la orden de compra se modela aparte en otra HU.
- **Tabla aparte para las indicaciones de armado**: es un único texto libre por cliente, sin historial ni estructura propia; una tabla agregaba un join sin beneficio. Queda como campo de `Cliente`.
- **Tabla aparte o historial para las observaciones internas** (HU2.10): misma lógica que las indicaciones. Es una sola nota por cliente, que se reemplaza al guardar, sin historial ni estructura propia. Queda como campo de `Cliente` (`observaciones`).
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
- **Tabla de emisores** (HU2.9): descartada por lo del punto 11. Dos valores fijos no justifican una tabla con su clave foránea, su seed y su administración; si hiciera falta un tercero, se agrega al enum.
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
  - Hecho (HU2.9, confirmado con el negocio el 30/10/2026): la unicidad de `numeroFactura` ya no es por cliente sino por emisor, (`emisor`, `numeroFactura`) entre las rendiciones activas e incluso entre clientes, porque cada emisor tiene su propia numeración. Un mismo cliente puede recibir facturas de los dos emisores: cada rendición guarda el suyo. Las rendiciones anteriores, sin emisor, conservan la regla por cliente. Ver el punto 11, con las consecuencias de la migración.
  - El seed actual borra todos los clientes con `deleteMany`. Con `Rendicion → Cliente` en `Restrict`, ese borrado va a fallar en cuanto la base de desarrollo tenga rendiciones. Se decidió dejarlo así (frenar es más seguro que borrar rendiciones en silencio) y revisarlo cuando existan.
  - Si en algún momento cambia la estrategia de índices de Prisma (por ejemplo, una versión que soporte índices parciales en el schema), conviene declarar `uq_requisito_cliente_tipo_activo` también ahí.
  - Hecho (HU2.1): los endpoints de tipos de documento calculan `nombreNormalizado` en cada alta y edición, traducen el `P2002` sobre `nombreNormalizado` en un conflicto, y el contrato de API (4.1) quedó actualizado.
