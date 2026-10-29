# ADR-0004 — Reutilización y almacenamiento de documentos

## Estado

Proposed

Quedan decisiones de negocio y de infraestructura por validar (ver "Decisiones pendientes"). El modelo de datos de este ADR ya está en `schema.prisma` y en la migración `20261029120000_hu2_8_documentos_aplicaciones`, que todavía **no se aplicó** en ninguna base.

## Fecha

2026-10-29

## Contexto

**HU2.8 — Cargar un documento y aplicarlo a los clientes que corresponda, para no repetir la carga cuando varios lo comparten.**

Hoy cada rendición tiene un checklist de ítems (ADR-0003). Un ítem se completa **solo** al aplicarle un documento: no hay tilde manual (descartado el 19/10/2026). HU2.8 es la historia que da esa forma de completar el checklist.

**Problema de negocio.** Muchos documentos son iguales para varios clientes del mismo período (por ejemplo, una constancia de la empresa o el print de una pauta que salió para varios). Hoy la operadora tendría que cargar el mismo archivo una vez por cliente: es trabajo repetido, ocupa espacio y no deja ver qué archivo se presentó dónde.

Reglas confirmadas para esta historia:

- Un archivo se carga **una vez**, con su tipo de documento y su período, y se aplica a ítems de varias rendiciones. No se guarda una copia por cliente.
- El sistema **sugiere** candidatos y la operadora **elige** cada ítem a mano. Nunca se aplica automáticamente a todos los que piden ese tipo.
- Si una rendición pide varios documentos del mismo tipo (Print 1/5, 2/5…), la operadora elige el ítem exacto.
- Aplicar un documento marca el ítem como reunido.
- Un documento aplicado se puede **reemplazar**. El anterior queda en el historial y reemplazar en una rendición no cambia las aplicaciones de ese archivo en otras.
- La operadora consulta los documentos cargados por período y dónde está aplicado cada uno.
- Solo los ítems con documento se pueden elegir para el envío.
- Fuera de alcance: reutilización entre períodos, vencimientos, envío automático, OCR, clasificación con IA y versionado avanzado.

## Decisión

### 1. Dos modelos: `Documento` y `AplicacionDocumento`

- **`Documento`**: el archivo cargado, uno por objeto físico. Tipo de documento (FK `Restrict`), período (`anio`, `mes`), metadatos (`nombreOriginal`, `tipoContenido`, `tamanioBytes`, `sha256`) y `claveAlmacenamiento`, la clave opaca del objeto. Puede existir sin aplicaciones.
- **`AplicacionDocumento`**: un documento aplicado a un ítem del checklist. `aplicadaEn`, `reemplazadaEn` (null = vigente) y `reemplazaAId` (la aplicación anterior del mismo ítem). Es una **tabla histórica única**: las aplicaciones no se borran.

El contenido del archivo **no** va en PostgreSQL. La base no guarda URLs, buckets ni proveedores.

### 2. Historial de reemplazos

Al reemplazar el documento de un ítem, en una sola transacción:

1. la aplicación vigente recibe `reemplazadaEn`;
2. se crea la aplicación nueva, con `reemplazaAId` apuntando a la anterior.

La FK va en la fila **nueva** (y no un `reemplazadaPorId` en la vieja) para que, al insertarla, la fila apuntada ya exista, sin FK diferidas. El historial de un ítem son todas sus aplicaciones, encadenadas por `reemplazaAId`. Las aplicaciones del documento anterior en **otros** ítems no se tocan: el reemplazo es local al ítem.

### 3. `completado` del ítem

`ItemChecklist.completado` y `completadoAt` no cambian de forma ni de significado. La regla es: **un ítem está completado si tiene una aplicación vigente**. El servicio que registra aplicaciones (bloque siguiente) los actualiza **en la misma transacción**. Se guarda en el ítem, como dice ADR-0003, para calcular el avance sin recorrer aplicaciones. Reemplazar no lo cambia, porque el ítem sigue teniendo una vigente.

La coherencia "completado ⇔ hay una vigente" la mantiene el servicio. La controla un test de integración sobre toda la tabla, como el de `nombreNormalizado` (ADR-0003 §8). No se usa un trigger: no hay otra vía de escritura que lo justifique.

### 4. Integridad garantizada en la base

| Regla                                     | Mecanismo                                                                                                                                                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Una sola aplicación vigente por ítem      | Índice único **parcial** `uq_aplicacion_documento_item_vigente` sobre `itemChecklistId`, `WHERE "reemplazadaEn" IS NULL` (SQL manual, como los de ADR-0003 §5)                                                               |
| El tipo del documento = el tipo del ítem  | **Dos FK compuestas** que comparten `AplicacionDocumento.tipoDocumentoId`: `(documentoId, tipoDocumentoId)` → `Documento(id, tipoDocumentoId)` y `(itemChecklistId, tipoDocumentoId)` → `ItemChecklist(id, tipoDocumentoId)` |
| Un reemplazo es del **mismo** ítem        | FK compuesta `(reemplazaAId, itemChecklistId)` → `AplicacionDocumento(id, itemChecklistId)`. Con `reemplazaAId` null no se evalúa (MATCH SIMPLE)                                                                             |
| Una aplicación se reemplaza una sola vez  | `UNIQUE(reemplazaAId)` (varios NULL están permitidos)                                                                                                                                                                        |
| Una aplicación no se reemplaza a sí misma | `ck_aplicacion_no_se_reemplaza_a_si_misma`                                                                                                                                                                                   |
| Fechas coherentes                         | `ck_aplicacion_fechas_coherentes`: `reemplazadaEn` null o `>= aplicadaEn`                                                                                                                                                    |
| Período válido                            | `ck_documento_mes`: el mismo rango que `ck_rendicion_mes`                                                                                                                                                                    |
| Tamaño positivo                           | `ck_documento_tamanio_positivo` (el tope de 10 MB es de shared)                                                                                                                                                              |
| SHA-256 bien formado                      | `ck_documento_sha256_formato`: 64 hexadecimales en minúscula                                                                                                                                                                 |
| Nombre y clave no vacíos                  | `ck_documento_nombre_original_no_vacio`, `ck_documento_clave_no_vacia`                                                                                                                                                       |
| Forma de MIME                             | `ck_documento_tipo_contenido_formato` (la lista de formatos admitidos es de shared)                                                                                                                                          |
| Clave única                               | `UNIQUE(claveAlmacenamiento)`                                                                                                                                                                                                |

**Costo de las FK compuestas:** `AplicacionDocumento` repite `tipoDocumentoId` (una columna), y hacen falta índices únicos `(id, tipoDocumentoId)` en `Documento` e `ItemChecklist` y `(id, itemChecklistId)` en `AplicacionDocumento`. Como `id` ya es único, esos índices nunca rechazan una fila: solo existen como destino de las FK. A cambio, ni un script ni un bug pueden aplicar un documento de otro tipo ni encadenar reemplazos entre ítems.

**El SHA-256 no es único.** Sirve para avisar de un posible duplicado y ofrecer reutilizar el documento existente, no para impedirlo. Tiene un índice simple para esa búsqueda.

**Un documento puede estar vigente en varios ítems de la misma rendición** si la operadora los elige: no hay ninguna restricción que lo prohíba.

### 5. Período: lo valida el servicio, no la base

El período del documento tiene que ser el de la rendición del ítem. Lo valida el servicio, dentro de la transacción que aplica.

Garantizarlo en la base exigiría copiar `rendicionId`, `anio` y `mes` en `AplicacionDocumento` y agregar índices únicos `(id, rendicionId)` en `ItemChecklist` y `(id, anio, mes)` en `Rendicion` y en `Documento`. Son tres columnas desnormalizadas e índices nuevos sobre dos tablas existentes. Además, la regla podría cambiar: la reutilización entre períodos quedó **fuera de alcance**, no descartada. Si se decide que la regla es permanente, se agrega en una migración posterior.

### 6. Relación con el snapshot (ADR-0003)

- Los candidatos salen de los **ítems** (la foto) y no de la matriz actual. Se compara el `tipoDocumentoId` del ítem, no su nombre. Un requisito agregado, editado o dado de baja después de abrir la rendición no cambia qué ítems existen. Un tipo desactivado sigue en los ítems ya abiertos.
- Aplicar o reemplazar no modifica ningún campo del snapshot (tipo, nombre, ordinal, día, canal): solo crea aplicaciones y actualiza `completado`/`completadoAt`.
- Solo se aplica o reemplaza en rendiciones **activas**. Una anulada se conserva tal cual (como en ADR-0003 §9): sus aplicaciones quedan como historial y se siguen viendo, marcadas.

### 7. Reglas `onDelete` y protección del historial

| Relación                                                  | Regla      | Motivo                                                          |
| --------------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| `Documento` → `TipoDocumento`                             | `Restrict` | El tipo se desactiva, no se borra.                              |
| `AplicacionDocumento` → `Documento`                       | `Restrict` | Un documento aplicado (aunque sea en el historial) no se borra. |
| `AplicacionDocumento` → `ItemChecklist`                   | `Restrict` | El historial de un ítem no desaparece en cascada.               |
| `AplicacionDocumento` → `AplicacionDocumento` (reemplazo) | `Restrict` | La cadena de reemplazos no se corta.                            |

`ItemChecklist` → `Rendicion` sigue en `Cascade` (ADR-0003 §6) y **no se cambia**: los ítems son parte de la rendición. Como la aplicación es `Restrict` hacia el ítem, un borrado físico de una rendición con documentos aplicados intenta borrar sus ítems en cascada y falla. Así, el `Cascade` no puede llevarse el historial. La anulación es una baja lógica y no toca nada de esto.

Consecuencia operativa: los scripts y los tests que borran datos físicamente tienen que borrar primero las aplicaciones y los documentos.

### 8. Almacenamiento desacoplado (a implementar en el bloque siguiente)

- **Un puerto propio** en el backend, con solo las operaciones que soportan los proveedores S3-compatibles evaluados: guardar, obtener, consultar si existe y eliminar un objeto por clave. Sin versionado, escrituras condicionales, tags ni cabeceras de cifrado (Supabase no las soporta).
- **Implementaciones:** un adaptador **S3-compatible** genérico (endpoint, región, bucket y credenciales por variables de entorno), una **local en disco** para desarrollo y una **en memoria** para los tests. El CI no necesita credenciales ni un bucket real.
- **Proveedor inicial previsto: Supabase Storage (plan Free).** Según su documentación (consultada el 29/10/2026), al exceder la cuota del plan Free se aplican restricciones, no cobros. Tiene 1 GB de espacio, 5 GB de egress y 50 MB por archivo. Un proyecto Free se pausa tras una semana de poca actividad. No se usa el SDK de Supabase: la lógica de negocio no depende del proveedor.
- **Claves opacas** generadas por el backend (por ejemplo, `documentos/<uuid>`). No llevan el nombre del archivo, datos del cliente, bucket ni proveedor. Cambiar de proveedor es cambiar variables de entorno y copiar los objetos con las mismas claves (verificables con `sha256`). Las referencias en PostgreSQL no cambian.
- **Bucket privado** y credenciales **solo en el backend**. El frontend nunca habla con el proveedor.

### 9. Consistencia entre PostgreSQL y el almacenamiento

No comparten una transacción. Orden:

1. el backend recibe y valida el archivo, calcula su `sha256` y genera la clave;
2. **guarda el objeto**;
3. después, en una transacción, crea la fila `Documento` (y las aplicaciones, si corresponde).

- Si falla el almacenamiento, no se escribe nada en la base.
- Si falla la base, se intenta borrar el objeto (compensación). Si eso también falla, queda un objeto **huérfano**: privado, sin referencias, y solo ocupa espacio. Se limpia con un script de conciliación (claves sin fila y más viejas que cierto margen).
- Invariante resultante: **toda fila `Documento` apunta a un objeto que existe**, salvo un borrado externo.
- La subida nunca va **dentro** de la transacción de la base: retendría una conexión durante la E/S de red y chocaría con el timeout de las transacciones interactivas.

Concurrencia (bloque siguiente):

- Aplicar y reemplazar usan la transacción serializable con reintento que ya tiene el módulo de rendiciones.
- Dos aplicaciones simultáneas al mismo ítem: una gana y la otra choca con el índice parcial y se responde como conflicto.
- El reemplazo recibe la aplicación vigente que vio la operadora (concurrencia optimista): si cambió, se rechaza.
- Aplicar varios ítems es **todo o nada**, como la propagación del canal (ADR-0003 §10).
- Para no aplicar sobre una rendición que otro pedido está anulando, la transacción bloquea las rendiciones involucradas (`FOR SHARE`). Una transacción serializable no detecta ese choque, porque la anulación no corre en serializable y aplicar no escribe la fila de la rendición.

### 10. Formatos y tamaño

- Formatos admitidos (`@realpolitik/shared`): **PDF, JPG/JPEG, PNG y DOCX**. Tamaño máximo inicial: **10 MB**. Los dos se cambian en shared, sin migración.
- El backend tiene que validar el **contenido efectivo** (la firma de los primeros bytes), no solo la extensión ni el MIME que declara el navegador, y guardar el `tipoContenido` del contenido.
- La descarga se entrega con `Content-Disposition: attachment` (con el nombre saneado) y `X-Content-Type-Options: nosniff`.

### 11. Seguridad

- **Hoy no hay autenticación ni autorización.** El repositorio es público y la API no identifica a nadie.
- **CORS no es autenticación**: solo limita qué páginas del navegador pueden leer respuestas. Un pedido directo (curl, un script) no pasa por CORS.
- Los UUID no son secretos: aparecen en URLs, en el historial y en capturas.
- **Mientras no haya autorización efectiva, no se cargan archivos reales de clientes en ningún entorno accesible públicamente.** Las pruebas y la demo usan **archivos ficticios**.
- Cuando exista autenticación, el backend **autoriza** cada pedido antes de entregar un documento o una URL temporal. **Una URL firmada no reemplaza esa autorización**: solo limita por cuánto tiempo sirve un enlace que ya se entregó.
- No se agrega una "clave de API" en el frontend: quedaría en el bundle y sería una protección aparente.
- La autenticación y la autorización completas son una **dependencia** de HU2.8 para usar datos reales. No son parte de esta historia.

### 12. Eliminación

HU2.8 **no** borra documentos ni aplicaciones (no hay baja lógica ni física). Queda por definir, con el negocio y en otra historia:

- la política de **retención** (ya pendiente en `docs/product/contexto-negocio.md`);
- la **baja lógica** de un documento y su **restauración**;
- la **purga física** del objeto y de la fila;
- qué pasa con un documento **compartido** por varias aplicaciones, vigentes o históricas;
- cómo se **protege el historial** (hoy lo protegen las FK `Restrict`).

El modelo lo admite: se puede agregar `isDeleted`/`deletedAt` a `Documento` (como en el resto del modelo, ADR-0002) sin tocar las aplicaciones.

## Alternativas consideradas

- **Clave del archivo en el ítem** (`ItemChecklist.claveAlmacenamiento`): reutilizar es repetir la clave en cada ítem y duplicar los metadatos. El historial de reemplazos se pierde o exige otra tabla, y el repositorio por período hay que reconstruirlo desde los ítems.
- **`Documento` + puntero al vigente en el ítem** (`ItemChecklist.documentoVigenteId`) **+ tabla de historial**: la lectura del vigente es directa, pero hay **dos** fuentes de verdad (el puntero y el historial) que se tienen que mantener sincronizadas. Con la tabla única, el vigente es la fila sin `reemplazadaEn` y el índice parcial garantiza que hay una sola.
- **`reemplazadaPorId` en la aplicación vieja** en vez de `reemplazaAId` en la nueva: al reemplazar, la vieja apuntaría a una fila que todavía no existe, lo que exige FK diferidas (SQL manual que Prisma no declara).
- **Versionado del documento** (`DocumentoVersion`): un reemplazo es otro archivo, no otra versión del mismo. El versionado avanzado está fuera de alcance.
- **SHA-256 único**: impediría para siempre dos registros con el mismo contenido. Se prefiere avisar y ofrecer reutilizar.
- **Prohibir el mismo documento en dos ítems de la misma rendición**: no está confirmado como regla. Se deja permitido.
- **Período garantizado con FK compuestas**: ver el punto 5.
- **Triggers** para `completado` o para las reglas que cruzan filas: no hay otra vía de escritura que lo justifique. El servicio y los tests de integración alcanzan.
- **Fila `Documento` "pendiente" antes de subir el archivo**: obliga a filtrar por estado en todas las consultas y deja filas que apuntan a objetos inexistentes. Subir primero deja como única falla posible un objeto huérfano, que es inocuo.
- **Subida directa del navegador al bucket con URL prefirmada**: ahorra pasar el archivo por el backend, pero exige CORS en el bucket, un paso de confirmación y no permite validar el contenido antes de guardarlo. Queda como evolución.
- **Cloudflare R2**: tramo gratuito más amplio, pero su documentación cobra por unidad lo que lo exceda. No cumple la preferencia de "sin posibilidad de cargos". Se puede usar sin cambios de código si se acepta ese riesgo (es S3-compatible).
- **Archivos en PostgreSQL** (`bytea`): agranda la base y sus backups y mezcla dos ciclos de vida distintos.

## Consecuencias

- **Positivas:**
  - Un archivo existe una sola vez y se sabe dónde se usó.
  - El historial de reemplazos es completo y la base lo protege.
  - La base rechaza un documento de otro tipo, dos vigentes en un ítem y reemplazos cruzados entre ítems, aunque la escritura no pase por la API.
  - Cambiar de proveedor de almacenamiento no toca la base.
- **Negativas:**
  - `AplicacionDocumento.tipoDocumentoId` repite un dato. Hay índices únicos que solo existen como destino de FK compuestas.
  - El índice parcial y los CHECK viven solo en SQL: quien lea `schema.prisma` los encuentra en el bloque de comentarios.
  - El período y la coherencia de `completado` dependen del servicio y de sus tests.
  - Pueden quedar objetos huérfanos en el almacenamiento.
- **A resolver en los bloques siguientes:**
  - El servicio de aplicar y reemplazar (`completado` en la misma transacción, período, rendición activa, bloqueo `FOR SHARE`, todo o nada).
  - La carga multipart con validación del contenido.
  - Los adaptadores de almacenamiento y sus variables de entorno.
  - Los endpoints y su sección en el contrato de API.
  - Que el detalle de la rendición devuelva `documento` en cada ítem: hoy es opcional en `ItemChecklistSchema` y pasa a obligatorio (nullable) cuando el backend lo devuelva.
  - Que el envío solo admita ítems reunidos: contradice a propósito un test de HU2.5 que hoy cuenta pendientes.
  - Actualizar los helpers de limpieza de los tests (punto 7).

### Decisiones pendientes de validación

| Decisión                                                                                   | Recomendación                                                                    | Valida       |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------ |
| ¿Se puede cargar un documento sin aplicarlo?                                               | Sí (el modelo lo admite)                                                         | Negocio      |
| ¿Se avisa o se bloquea un contenido repetido (mismo SHA-256)?                              | Avisar y ofrecer reutilizar                                                      | Negocio      |
| Tipos ofrecidos al cargar: ¿solo activos, o también los desactivados con ítems pendientes? | Activos más los que tienen pendientes (si no, esos ítems no se pueden completar) | Negocio      |
| ¿Se aplica a rendiciones de clientes INACTIVOS?                                            | Sí, marcado (como corregir el canal)                                             | Negocio      |
| ¿Se limita el período del documento como el de la rendición (hasta el mes siguiente)?      | Sí, por coherencia; hoy no se limita                                             | Negocio      |
| Formatos y tamaño definitivos                                                              | PDF, JPG, PNG, DOCX; 10 MB                                                       | Negocio      |
| Uso de documentos reales sin autenticación                                                 | No                                                                               | Negocio / PO |
| Proveedor de almacenamiento definitivo                                                     | Supabase Free + adaptador local                                                  | Equipo       |
| Retención y eliminación                                                                    | Otra historia                                                                    | Negocio      |

### Posibles evoluciones

- Baja lógica, restauración y purga de documentos, cuando haya una política de retención.
- Subida directa con URL prefirmada, con autorización previa en el backend.
- Escaneo antivirus de los archivos subidos.
- Auditoría de quién cargó, aplicó o reemplazó (cuando haya usuarios).
- Reutilización entre períodos, si el negocio la confirma (el período ya lo valida el servicio, no una FK).
- Script de conciliación periódico entre el almacenamiento y `Documento`.
