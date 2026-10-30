# Contrato de API: clientes, contactos, requisitos y rendiciones

> **Versión:** 1.0, para revisión del equipo (T0.7).
> **Fuente de verdad de los campos:** los schemas de `@realpolitik/shared`
> (`packages/shared/src/schemas/`). Este documento define los endpoints, parámetros,
> respuestas y errores. Si el código contradice a este documento, se corrige el que corresponda
> en un PR y queda registrado el motivo.
> La sección 6 lista los cambios que este contrato exigió en `@realpolitik/shared` y en la base de datos; todos están hechos.
> La sección 4 (requisitos y rendiciones, T2.3) es un borrador para revisión. Ya están implementados el catálogo de tipos de documento (4.1, HU2.1), el CRUD de requisitos de la matriz (4.2, HU2.2), `GET /clientes/:id` y el campo y filtro `matrizConfigurada` (4.7). Siguen pendientes la carga masiva (4.3), las indicaciones de armado (4.4), las rendiciones (4.5 y 4.6) y el resto de las historias de esta sección.

## 1. Convenciones generales

| Tema                | Regla                                                                         |
| ------------------- | ----------------------------------------------------------------------------- |
| Formato             | JSON en pedidos y respuestas                                                  |
| ID                  | `uuid`, generado por el servidor                                              |
| Fechas              | Texto ISO 8601, por ejemplo `2026-10-02T15:30:00.000Z`                        |
| CUIT                | Se acepta con o sin guiones. La API siempre lo devuelve como `XX-XXXXXXXX-X`  |
| Baja                | Lógica: un cliente inactivo conserva todos sus datos. No se borra físicamente |
| Listados            | Sin paginación                                                                |
| Campos desconocidos | Se ignoran                                                                    |
| Textos              | Se recortan los espacios de los bordes. No pueden tener caracteres de control |
| Largos máximos      | Son los de las columnas de la base: pasarse es `400`, nunca un error interno  |

Un texto con caracteres de control (`NUL`, saltos de línea, tabulaciones, etc.) en el medio de un nombre, una URL o una búsqueda es `400 VALIDATION_ERROR`. `NUL` en particular no se puede guardar en PostgreSQL.

### Formato de error

Todos los errores responden con la misma forma:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Los datos enviados no son válidos",
    "details": [{ "campo": "cuit", "mensaje": "El CUIT ingresado no es válido" }]
  }
}
```

| `code`                | Estado HTTP | Cuándo                                                                                                               | `details`                                                                                                                                                                                                                                                                 |
| --------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`    | 400         | Falta un dato, un dato tiene mal formato, un parámetro no es válido o el JSON está mal formado                       | Lista de `{ campo, mensaje }`. `campo` usa notación de puntos (`periodicidad.diaLimite`). Con JSON mal formado, `campo` es `body`                                                                                                                                         |
| `NOT_FOUND`           | 404         | El recurso pedido (cliente, contacto, tipo de documento, requisito, rendición o ítem) no existe, o la ruta no existe | No lleva                                                                                                                                                                                                                                                                  |
| `CONFLICT`            | 409         | El pedido choca con datos existentes                                                                                 | Objeto con `motivo` y el registro existente: `clienteExistente` para `CUIT_DUPLICADO`, `contactoExistente` para `EMAIL_DUPLICADO` o `tipoDocumentoExistente` para `TIPO_DOCUMENTO_DUPLICADO` (sección 4.1). Los motivos de requisitos y rendiciones están en la sección 4 |
| `PAYLOAD_TOO_LARGE`   | 413         | El cuerpo de la solicitud supera los 100 KB                                                                          | No lleva                                                                                                                                                                                                                                                                  |
| `SERVICE_UNAVAILABLE` | 503         | Un servicio del que depende el pedido (el almacenamiento de documentos, 4.10) no respondió. Se puede reintentar      | No lleva                                                                                                                                                                                                                                                                  |
| `INTERNAL_ERROR`      | 500         | Error inesperado                                                                                                     | No lleva. Nunca expone detalles internos                                                                                                                                                                                                                                  |

> Los textos de `mensaje` pueden estar en inglés cuando no los define `@realpolitik/shared`
> (por ejemplo, `Required`). El front debe apoyarse en `campo` y mostrar sus propios textos.

## 2. Clientes

### Cómo es un cliente

```json
{
  "id": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "razonSocial": "Cliente de Ejemplo S.A.",
  "denominacion": "Cliente Ejemplo",
  "cuit": "20-12345678-6",
  "sector": "PUBLICO",
  "subtipo": "MUNICIPAL",
  "ivaCondicion": "EXENTO",
  "emailContacto": "rendiciones@ejemplo.gob.ar",
  "emailsAdicionales": [],
  "canalEntrega": "CORREO",
  "portalUrl": null,
  "whatsappNumero": null,
  "emisor": "SOCIEDAD",
  "periodicidad": { "tipo": "MENSUAL", "diaLimite": 10, "mesInicioCiclo": null },
  "estado": "ACTIVO",
  "matrizConfigurada": false,
  "creadoEn": "2026-10-02T15:30:00.000Z",
  "actualizadoEn": "2026-10-02T15:30:00.000Z"
}
```

Reglas de los datos:

- **Razón social (`razonSocial`):** obligatoria, de 2 a 150 caracteres.
- **Denominación (`denominacion`):** obligatoria, de 2 a 60 caracteres. Es el alias o nombre corto del cliente para identificarlo en pantalla cuando la razón social es muy extensa.
- **Sector y subtipo:** si el sector es `PUBLICO`, el `subtipo` es obligatorio. Si es `PRIVADO`, el campo `subtipo` no se envía ni aparece en la respuesta.
- **Email de rendición (`emailContacto`):** obligatorio, hasta 254 caracteres, guardado sin espacios en los bordes y en minúsculas. Es el destinatario principal de las rendiciones.
- **Emails adicionales (`emailsAdicionales`):** hasta 10, cada uno con las mismas reglas que el email de rendición (hasta 254 caracteres, sin espacios en los bordes, en minúsculas).
  - No pueden repetirse entre sí ni repetir el `emailContacto`, sin distinguir mayúsculas. Un pedido con repetidos se rechaza con `400` (marca cada repetido, por ejemplo `emailsAdicionales.1`): no se descartan en silencio. Repetir el principal no aportaría nada, porque las rendiciones por correo ya le llegan.
  - Esta regla rige al crear y al editar. En una edición parcial se aplica al **estado resultante** (lo enviado más lo guardado): cambiar solo `emailContacto` a un email que ya es un adicional guardado, o enviar solo `emailsAdicionales` con el `emailContacto` guardado, es `400` y no modifica nada. Si el pedido no trae los adicionales, solo se compara el principal nuevo con los guardados; los repetidos que ya hubiera entre ellos no bloquean la edición.
- **Teléfono (`telefono`):** opcional, sin espacios en los bordes; entre 7 y 20 caracteres que pueden ser dígitos, espacio común, `-`, `(`, `)` o `.`, con un `+` opcional al principio. No admite tabulaciones, saltos de línea ni otros caracteres de control.
- **Canal de entrega habitual (`canalEntrega`):** `CORREO` (por defecto), `PORTAL_WEB` o `WHATSAPP`.
  - Si es `PORTAL_WEB`: `portalUrl` es obligatorio y debe ser una URL válida (ver abajo).
  - Si es `WHATSAPP`: `whatsappNumero` es obligatorio, con código de país y formato E.164 (`+5493511234567`: un `+` y de 10 a 15 dígitos, como máximo 16 caracteres). Se aceptan separadores (espacios, guiones, paréntesis) y la API siempre lo devuelve normalizado.
  - Si es `CORREO`: el cliente debe contar con al menos un email de contacto destinatario (`emailContacto` o adicionales).
- **URL del portal (`portalUrl`):** hasta 500 caracteres, sin espacios en los bordes.
  - Solo `http:` o `https:` (por ejemplo `https://portal.ejemplo.com/login?next=%2Fhome#seccion` o `http://localhost:8080/path`). Se rechazan `javascript:`, `data:`, `file:`, `ftp:` y cualquier otro protocolo.
  - No puede incluir usuario ni contraseña (`https://usuario:clave@host` es `400`): quedarían guardados en claro.
  - Se guarda tal como se escribió (recortada), no reescrita.
  - La respuesta se valida con el mismo schema: un `portalUrl` guardado antes de estas reglas (con otro protocolo o con credenciales) hace que las respuestas que incluyen a ese cliente fallen con `500` hasta que se corrija el dato en la base.
- **Periodicidad (`periodicidad`):** `tipo` es `MENSUAL`, `BIMESTRAL` o `POR_CAMPANIA`. `diaLimite` es un entero de 1 a 28. `mesInicioCiclo` es un entero de 1 a 12, obligatorio si el tipo es `BIMESTRAL`, y debe ser `null` en los demás.
  - Un cliente sin periodicidad configurada la devuelve como `"periodicidad": null`. La clave siempre está presente en la respuesta.
- **Emisor habitual (`emisor`, HU2.9):** con qué emisor se factura al cliente: `PERSONA_FISICA` (el emisor persona física) o `SOCIEDAD` (el emisor persona jurídica). Cuál corresponde depende de lo que exige el organismo destinatario. Los valores son los tipos de emisor; el nombre de cada emisor que ve la persona vive en un solo lugar del frontend (`etiquetasEmisor`).
  - **Opcional.** Un cliente sin emisor se guarda igual: el emisor nunca bloquea el alta ni la edición. En la respuesta, un cliente sin emisor **no trae la clave** (como `telefono` o `portalUrl`), a diferencia de `periodicidad`, que viaja como `null`.
  - **Dato pendiente.** Un cliente sin emisor es un dato pendiente: la ficha del cliente y el formulario lo marcan con "Pendiente". Es un aviso, no un error; el listado no lo marca ni se filtra por emisor. Los clientes anteriores a HU2.9 quedan sin emisor.
  - Es el emisor **habitual**: un cliente que recibe facturas de los dos emisores el mismo mes elige el emisor de cada una al abrir la rendición. El emisor de la rendición (que copia el del cliente al abrirla) y la unicidad del número de factura por emisor se documentan en la sección 4.5 cuando se implementen; hoy ese contrato no cambió.
- **Estado:** `ACTIVO`, `INACTIVO` o `SUSPENDIDO`. En este sprint ningún endpoint asigna `SUSPENDIDO`; queda reservado (por ejemplo, para clientes que pausan la publicidad en verano).
- **Matriz configurada (`matrizConfigurada`):** booleano de solo lectura. `true` si el cliente tiene al menos un requisito activo; `false` si la matriz todavía no se configuró. Lo mantiene el backend. No se envía en el alta ni en la edición: si llega, se ignora. El alta responde `false`.
- El resto de los campos (`ivaCondicion`, `telefono`, `emailsAdicionales`) se validan según el schema.

### Resumen

| Historia | Método y ruta                | Qué hace                        | Pedido (shared)                 | Respuesta (shared)       |
| -------- | ---------------------------- | ------------------------------- | ------------------------------- | ------------------------ |
| HU1.1    | `POST /clientes`             | Registra un cliente             | `CreateClienteSchema`           | `ClienteSchema`          |
| HU1.6    | `GET /clientes`              | Lista y busca clientes          | `ListarClientesQuerySchema`     | Lista de `ClienteSchema` |
| HU2.2    | `GET /clientes/:id`          | Devuelve un cliente             | id UUID en la ruta              | `ClienteSchema`          |
| HU1.7    | `PATCH /clientes/:id`        | Modifica datos de un cliente    | `UpdateClienteSchema`           | `ClienteSchema`          |
| HU1.8    | `PATCH /clientes/:id/estado` | Desactiva o reactiva un cliente | `ActualizarEstadoClienteSchema` | `ClienteSchema`          |

`GET /clientes/:id` (HU2.2) devuelve un solo cliente, con el mismo `ClienteSchema` que cada ítem del listado. Un id que no es UUID es `400 VALIDATION_ERROR`. Un cliente inexistente o con baja lógica es `404 NOT_FOUND`. Se puede consultar en estado `ACTIVO`, `INACTIVO` o `SUSPENDIDO`.

### `POST /clientes` (HU1.1, HU1.2, HU1.4, HU1.5)

- **Pedido:** los campos del cliente, sin `id`, `estado`, `matrizConfigurada`, `creadoEn` ni `actualizadoEn`. La periodicidad es opcional al crear: si no se envía, el cliente queda sin periodicidad (`"periodicidad": null` en la respuesta). En el alta no se acepta `"periodicidad": null`; para no configurarla se omite la clave. `canalEntrega` toma `CORREO` por defecto. Si se envía `PORTAL_WEB` es obligatoria la `portalUrl`; si se envía `WHATSAPP` es obligatorio `whatsappNumero`. Si llega `matrizConfigurada`, se ignora. El `emisor` es opcional: se omite la clave para no asignarlo, y `null` no se acepta en el alta (no hay nada que quitar).
- **Respuesta 201:** el cliente creado, con `estado` `ACTIVO` y `matrizConfigurada` `false`.
- **Errores:**
  - `400 VALIDATION_ERROR`: falta la razón social, la denominación (o supera los 60 caracteres), el CUIT, el sector, el email de rendición o la condición de IVA; CUIT con dígito verificador incorrecto; subtipo ausente en un cliente público; día límite fuera de 1 a 28 o no entero; periodicidad bimestral sin mes de inicio, o con mes fuera de 1 a 12; mes de inicio distinto de `null` en una periodicidad mensual o por campaña; canal `PORTAL_WEB` sin `portalUrl` válida; canal `WHATSAPP` sin `whatsappNumero` válido; canal `CORREO` sin emails de contacto; un texto que supera el largo de su columna (razón social, denominación, emails, teléfono, `portalUrl`) o que tiene caracteres de control; `portalUrl` con un protocolo distinto de `http`/`https` o con usuario y contraseña; emails adicionales repetidos o iguales al email de rendición; `emisor` con un valor que no es `PERSONA_FISICA` ni `SOCIEDAD`, o `null` (el error cae en `details[].campo: "emisor"`).
  - `409 CONFLICT`: ya existe un cliente con ese CUIT, **activo o inactivo**. Se devuelve cuál es, porque HU1.1 pide mostrarlo:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Ya existe un cliente con ese CUIT",
    "details": {
      "motivo": "CUIT_DUPLICADO",
      "clienteExistente": { "id": "…", "razonSocial": "…", "estado": "INACTIVO" }
    }
  }
}
```

### `GET /clientes` (HU1.6, HU1.2, HU1.8)

| Parámetro           | Obligatorio | Descripción                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`                 | No          | Texto que se busca dentro de la razón social, la denominación o el CUIT. No distingue mayúsculas. El CUIT se busca con o sin guiones. Hasta 150 caracteres (`MAX_BUSQUEDA_CLIENTES` en shared: el largo de la razón social, el campo más largo donde se busca; el buscador de la pantalla limita lo que se escribe con la misma constante). Se busca tal cual: `%`, `_` y `\` son caracteres comunes, no comodines |
| `estado`            | No          | `ACTIVO` (por defecto), `INACTIVO` o `SUSPENDIDO`                                                                                                                                                                                                                                                                                                                                                                  |
| `sector`            | No          | `PUBLICO` o `PRIVADO`                                                                                                                                                                                                                                                                                                                                                                                              |
| `subtipo`           | No          | Un subtipo del sector público                                                                                                                                                                                                                                                                                                                                                                                      |
| `matrizConfigurada` | No          | `true` o `false`. Sin el parámetro no se filtra. Se combina con `q`, `estado`, `sector` y `subtipo`                                                                                                                                                                                                                                                                                                                |

- **Respuesta 200:** lista de clientes **ordenada alfabéticamente por razón social**. Si no hay resultados, devuelve una lista vacía: no es un error. El mensaje de "no hay resultados" y la invitación a registrar el primer cliente los muestra el front.
- **Estado:** si no se envía `estado`, solo devuelve clientes `ACTIVO`. Para ver los desactivados se pide `estado=INACTIVO` (HU1.8), y se combina con `q`, `sector`, `subtipo` y `matrizConfigurada`. Por ahora no hay forma de listar activos e inactivos juntos (ver sección 7). El front solo ofrece las vistas de activos e inactivos: `SUSPENDIDO` está reservado.
- **Errores:** `400 VALIDATION_ERROR` si un parámetro tiene un valor no válido, o si `q` supera los 150 caracteres o tiene caracteres de control. `matrizConfigurada` solo admite `true` o `false`.
- **Sprint 2 (HU2.2, implementado):** cada cliente incluye `matrizConfigurada` y el listado acepta ese filtro. El detalle está en la sección 4.7. La lectura individual está en `GET /clientes/:id`.

### `GET /clientes/:id` (HU2.2)

- **Pedido:** sin cuerpo. `id` es un UUID en la ruta.
- **Respuesta 200:** el cliente, con el mismo `ClienteSchema` que `GET /clientes`, incluido `matrizConfigurada`.
- **Estados:** se puede leer un cliente `ACTIVO`, `INACTIVO` o `SUSPENDIDO`. El estado comercial no bloquea la consulta.
- **Errores:** `400 VALIDATION_ERROR` si el id no es un UUID. `404 NOT_FOUND` si el cliente no existe o tiene baja lógica. No se exponen clientes dados de baja ni campos internos (`isDeleted`, `deletedAt`, `indicacionesArmado`, `observaciones`).

### `PATCH /clientes/:id` (HU1.7, HU1.2, HU1.4, HU1.5)

- **Pedido:** cualquier subconjunto de los campos del cliente, con al menos uno. Solo se modifican los campos enviados. No se envían `id`, `estado`, `matrizConfigurada`, `creadoEn` ni `actualizadoEn`: si llegan, se ignoran sin error. El estado se cambia solo con `PATCH /clientes/:id/estado`. `matrizConfigurada` la mantiene el backend y la respuesta conserva el valor guardado.
- **Periodicidad:**
  - Sin la clave `periodicidad`, se conserva la que tenga el cliente.
  - Con un objeto, se configura o se reemplaza completa (`tipo`, `diaLimite` y `mesInicioCiclo`), con las mismas reglas que en el alta.
  - Con `"periodicidad": null`, se borra: el cliente queda sin periodicidad configurada.
- **Emisor (HU2.9):** tiene tres estados, como la periodicidad:
  - Sin la clave `emisor`, se conserva el que tenga el cliente.
  - Con `"PERSONA_FISICA"` o `"SOCIEDAD"`, se asigna o se reemplaza.
  - Con `"emisor": null`, se quita: el cliente queda sin emisor (pendiente) y la respuesta no trae la clave.
  - Cualquier otro valor es `400 VALIDATION_ERROR` con `details[].campo: "emisor"`, y no modifica nada.
- **Cambio de sector:**
  - De `PUBLICO` a `PRIVADO`: el subtipo anterior se descarta.
  - De `PRIVADO` a `PUBLICO`: hay que enviar el `subtipo` en el mismo pedido.
  - Enviar `subtipo` para un cliente privado es un error.
- **Cambio de canal:**
  - Si se cambia a `PORTAL_WEB`, debe enviarse `portalUrl` válida en el mismo pedido.
  - Si se cambia a `WHATSAPP`, debe enviarse `whatsappNumero` válido en el mismo pedido.
  - Al cambiar el canal, el dato del otro canal se borra (`portalUrl` queda vacía salvo en `PORTAL_WEB`, y `whatsappNumero` salvo en `WHATSAPP`).
  - Enviar `portalUrl` o `whatsappNumero` sin cambiar el canal modifica solo ese dato, pero únicamente si el canal guardado es el que lo usa (la URL con `PORTAL_WEB`, el número con `WHATSAPP`). En otro caso es `400 VALIDATION_ERROR`.
- **Sector sin `sector` en el pedido:** enviar solo `subtipo` modifica el subtipo de un cliente público; para un cliente privado es `400 VALIDATION_ERROR`. Enviar `sector: "PUBLICO"` exige `subtipo` en el mismo pedido.
- **Campos que no se envían:** `telefono` y `emailsAdicionales` se conservan si el pedido no los trae.
- **Respuesta 200:** el cliente actualizado.
- **Errores:**
  - `400 VALIDATION_ERROR`: pedido sin campos, CUIT inválido, sector y subtipo inconsistentes, canal y datos de entrega inconsistentes, periodicidad inválida, `emisor` desconocido, o cualquiera de los datos inválidos del alta (largos, caracteres de control, `portalUrl`, emails repetidos).
  - `404 NOT_FOUND`.
  - `409 CONFLICT`: el CUIT nuevo pertenece **a otro** cliente. Mismo `details` que en `POST`. El CUIT del propio cliente no cuenta como duplicado.
- **Cómo lo usa el front:** envía **solo los campos que la persona modificó** respecto de los datos con los que abrió la edición, con los grupos que la API exige juntos (sector `PUBLICO` con su `subtipo`, el canal nuevo con su dato de entrega, la periodicidad completa o `null`). El emisor viaja solo si se modificó: "Sin asignar" sobre un emisor existente es `null`. Así, si otra persona cambió un campo distinto mientras tanto, ese cambio no se pisa. Sin cambios, no envía nada: "Guardar cambios" queda deshabilitado.
- **Valores idénticos:** el contrato no define un "sin cambios" para este endpoint. Un `PATCH` que envía valores iguales a los guardados responde 200 igual y puede actualizar `actualizadoEn`. El front evita mandar un pedido sin cambios, pero la API no lo garantiza. A diferencia de `PATCH /clientes/:id/estado`, que sí responde 200 sin escribir cuando el estado no cambia.
- **Concurrencia:** no hay control de versión. Dos ediciones del **mismo** campo se resuelven por la última que llega (_last write wins_). Ver la sección 7.

### `PATCH /clientes/:id/estado` (HU1.8)

- **Pedido:** `{ "estado": "INACTIVO" }` o `{ "estado": "ACTIVO" }`. Enviar `SUSPENDIDO` devuelve `400 VALIDATION_ERROR` (reservado para un sprint futuro).
- **Qué hace:** cambia solo `estado`. Desactivar no borra nada: los datos y los contactos del cliente se conservan, y tampoco usa la baja lógica (`isDeleted`). Un cliente `INACTIVO` sigue pudiéndose editar y reactivar.
- **Respuesta 200:** el cliente con su nuevo estado. Los datos se conservan. Pedir el estado que el cliente ya tiene responde 200 con el cliente tal cual, **sin escribirlo**: `actualizadoEn` no cambia. Dos pedidos simultáneos del mismo estado escriben una sola vez, y cada respuesta muestra el estado pedido.
- **Errores:** `400 VALIDATION_ERROR` (estado ausente, `SUSPENDIDO` o un valor desconocido, o id que no es un uuid), `404 NOT_FOUND` (no existe o está dado de baja lógica).
- **Cómo lo usa el front:** "Desactivar" pide confirmación antes de llamar a este endpoint; "Reactivar" no. El listado de inactivos se pide con `GET /clientes?estado=INACTIVO`.

## 3. Contactos (HU1.3)

Un contacto pertenece a un cliente.

```json
{
  "id": "b2c3d4e5-f6a7-4890-bcde-f01234567890",
  "clienteId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "nombre": "Nombre de Ejemplo",
  "area": "Tesorería",
  "email": "contacto@ejemplo.gob.ar",
  "recibeRendiciones": true,
  "creadoEn": "2026-10-02T15:30:00.000Z",
  "actualizadoEn": "2026-10-02T15:30:00.000Z"
}
```

> **Nombres de las fechas:** el contacto devuelve `creadoEn` y `actualizadoEn`, igual que el cliente. En la base las columnas se llaman `createdAt` y `updatedAt`; el backend hace la traducción.

- `nombre` (de 2 a 150 caracteres), `area` (de 2 a 100) y `email` son obligatorios. El `email` debe tener formato válido, no superar los 254 caracteres y se guarda en minúsculas y sin espacios en los bordes.
- `recibeRendiciones` es `false` por defecto. Los contactos con `true` son los destinatarios de las rendiciones del cliente, además del email de rendición.
- Dentro de un mismo cliente no puede haber dos contactos no eliminados con el mismo email.
- Eliminar un contacto es una baja lógica: deja de figurar en el listado, pero queda registrado.
- Se pueden ver y modificar los contactos de un cliente inactivo.
- Un cliente dado de baja lógica (`isDeleted`) se trata como inexistente: **todas** las operaciones de contactos responden `404 NOT_FOUND`, igual que los endpoints del cliente. No es lo mismo que un cliente `INACTIVO`, que sigue existiendo.
- Los ids de la ruta (`:id`, `:contactoId`) se validan: uno que no es un uuid responde `400 VALIDATION_ERROR`, nunca un error del servidor.

| Método y ruta                                | Qué hace                                                                               | Código HTTP         | Pedido (shared)             | Respuesta (shared)        |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------- | --------------------------- | ------------------------- |
| `GET /clientes/:id/contactos`                | Lista los contactos del cliente. Primero los que reciben rendiciones, luego por nombre | 200 con la lista    | Sin cuerpo                  | Lista de `ContactoSchema` |
| `POST /clientes/:id/contactos`               | Agrega un contacto                                                                     | 201 con el contacto | `CreateContactoSchema`      | `ContactoSchema`          |
| `PUT /clientes/:id/contactos`                | Guarda la colección completa de contactos, todo o nada (ver abajo)                     | 200 con la lista    | `ReemplazarContactosSchema` | Lista de `ContactoSchema` |
| `PATCH /clientes/:id/contactos/:contactoId`  | Modifica un contacto o marca si recibe rendiciones. Al menos un campo (`{}` es 400)    | 200 con el contacto | `UpdateContactoSchema`      | `ContactoSchema`          |
| `DELETE /clientes/:id/contactos/:contactoId` | Elimina un contacto                                                                    | 204 sin cuerpo      | Sin cuerpo                  | Sin cuerpo                |

### `PUT /clientes/:id/contactos`

Guarda de una vez todos los contactos del cliente, como los muestra el editor. Los endpoints de a un contacto siguen existiendo.

- **Pedido:** `{ "contactos": [ { "id"?, "nombre", "area", "email", "recibeRendiciones" } ] }`.
  - Con `id`, el contacto ya existe y se actualiza; sin `id`, es nuevo.
  - Lo que el cliente ya tiene y **no** viene en la lista se elimina (baja lógica). Una lista vacía elimina todos.
  - No se envían `clienteId`, fechas ni baja lógica: si llegan, se ignoran. No hay un máximo de contactos.
  - No puede haber dos contactos con el mismo email (comparado sin espacios y en minúsculas) ni el mismo `id` en la lista.
- **Respuesta 200:** la colección final de contactos activos, ordenada igual que `GET`.
- **Todo o nada:** el guardado ocurre en una única transacción. Si algo falla, no se aplica ningún cambio. Los contactos que no cambiaron no se modifican.
- **Emails intercambiados:** permitido. Dos contactos pueden intercambiar sus emails, y uno puede tomar el email de otro que se elimina en el mismo guardado, sin conflicto.
- **Errores:**
  - `400 VALIDATION_ERROR`: estructura inválida, dato inválido de algún contacto (`campo` es la ruta, por ejemplo `contactos.1.email`), email o `id` repetido dentro de la lista.
  - `404 NOT_FOUND`: el cliente no existe o está dado de baja; o un `id` no corresponde a un contacto activo de este cliente.
  - `409 CONFLICT`: `motivo: "EMAIL_DUPLICADO"` si un email choca con un contacto ajeno al guardado (no debería ocurrir salvo concurrencia), o `motivo: "CONTACTOS_MODIFICADOS"` si otra operación modificó los contactos del cliente mientras se guardaba; se reintenta.

### Errores de los endpoints de a un contacto

- `400 VALIDATION_ERROR`: email con formato inválido o de más de 254 caracteres, nombre de más de 150 o área de más de 100 caracteres, nombre o área con caracteres de control, falta un campo obligatorio, `PATCH` sin ningún campo, ids que no son uuid.
- `404 NOT_FOUND`: el cliente no existe o está dado de baja, o el contacto no existe, está eliminado o no pertenece a ese cliente.
- `409 CONFLICT`: el email ya existe en otro contacto del mismo cliente. `details` trae `motivo: "EMAIL_DUPLICADO"` y el contacto existente (`id` y `nombre`).

## 4. Requisitos y rendiciones (Sprint 2, T2.3)

> **Estado:** borrador para revisión. Solo están implementados los endpoints de tipos de documento (4.1, HU2.1). El modelo
> de datos es el de T2.1 (`schema.prisma` y [ADR-0003](../adr/0003-modelado-requisitos-y-rendiciones.md)).
> Las decisiones de negocio se cerraron con la administradora el 20/10/2026. Lo que surja sin
> definir va a la sección 4.8, "Preguntas abiertas". Los schemas de `@realpolitik/shared` que hacen
> falta se listan en la sección 4.9.

Reglas que valen para toda la sección (además de las de la sección 1):

- **Cliente borrado:** igual que en clientes y contactos, un cliente con baja lógica (`isDeleted`) se trata como inexistente. Todas las rutas `/clientes/:id/...` responden `404 NOT_FOUND`.
- **Cliente no activo:** solo un cliente `ACTIVO` puede tener su matriz editada (alta, modificación o baja de requisitos), sus indicaciones de armado editadas, rendiciones nuevas o requisitos agregados a una rendición abierta. `INACTIVO` y `SUSPENDIDO` se tratan igual (un cliente que dejó de operar temporalmente y puede volver): esas operaciones responden `409 CONFLICT` con `motivo: "CLIENTE_NO_ACTIVO"`, y primero hay que reactivarlo. Las lecturas (`GET`) responden igual para cualquier estado. La anulación de una rendición tampoco se restringe, en ningún estado: es la corrección de un error, no una operación nueva. **Excepción:** las observaciones internas (HU2.10) se leen y se guardan con el cliente en cualquier estado, porque son una nota interna y no generan operaciones (ver 4.4).
- **Ids de la ruta:** `:id` y `:requisitoId` se validan. Uno que no es un uuid responde `400 VALIDATION_ERROR`.
- **Bajas lógicas:** un requisito dado de baja o una rendición anulada no aparecen en ningún listado ni detalle y se tratan como inexistentes (`404`). Hay siete excepciones: `GET /clientes/:id/rendiciones`, que con `estado=ANULADA` o `estado=TODAS` lista también las anuladas (ver 4.5); `GET /rendiciones/:id`, que muestra una rendición anulada como historial (ver 4.5); `PATCH /rendiciones/:id/estado` (ver 4.6), `POST /rendiciones/:id/requisitos/:requisitoId`, `PATCH /rendiciones/:id/items/:itemId/canal`, `POST /rendiciones/:id/preparar-envio` y `POST /clientes/:id/requisitos/:requisitoId/propagar-canal`, que con una rendición anulada responden `409 RENDICION_ANULADA` (ver 4.5).
- **Fechas:** como en clientes y contactos, la API devuelve `creadoEn` y `actualizadoEn`; las columnas `createdAt` y `updatedAt` se traducen en el backend. `isDeleted` y `deletedAt` no se exponen.
- **Sin requisitos condicionales:** ningún pedido lleva decisiones del tipo "este período aplica / no aplica". Todo requisito activo entra siempre en el checklist.
- **La factura es un requisito más:** no es implícita. Todo cliente pide al menos la factura, que figura en su matriz como requisito del tipo "Factura".
- **Canal efectivo:** `Cliente.canalEntrega` es el canal por defecto. `RequisitoCliente.canalEntrega` es un override opcional (`null` = usa el del cliente). El ítem guarda el canal ya resuelto: `requisito.canalEntrega ?? cliente.canalEntrega`.
- **Snapshot:** al abrir una rendición, los requisitos se copian en ítems. Cambiar después la matriz, renombrar o desactivar un tipo no altera las rendiciones ya abiertas. Única excepción, siempre explícita y nunca automática: la operadora puede agregar a una rendición activa los ítems de un requisito nuevo que el cliente empieza a pedir ese mes (ver 4.5). Los ítems existentes no se tocan.
- **`matrizConfigurada`:** la mantiene el backend. Pasa a `true` cuando el cliente tiene al menos un requisito activo y vuelve a `false` al dar de baja el último. No tiene endpoint ni se edita a mano.

Nuevos valores de `motivo` en `409 CONFLICT` (misma forma que en la sección 1: `details` trae `motivo` y, cuando corresponde, el registro existente):

| `motivo`                    | Datos en `details`                      | Cuándo                                                                                                                                          |
| --------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `TIPO_DOCUMENTO_DUPLICADO`  | `tipoDocumentoExistente`                | Ya existe un tipo de documento con ese nombre, sin distinguir mayúsculas ni acentos                                                             |
| `REQUISITO_DUPLICADO`       | `requisitoExistente`                    | El cliente ya tiene un requisito activo para ese tipo de documento                                                                              |
| `RENDICION_DUPLICADA`       | `rendicionExistente`                    | Ese número de factura ya está en otra rendición activa del cliente, de cualquier mes y año                                                      |
| `MATRIZ_VACIA`              | No lleva                                | Se intenta abrir una rendición para un cliente sin requisitos activos                                                                           |
| `RENDICION_ANULADA`         | `rendicionId` solo al propagar un canal | Se intenta agregar un requisito, corregir el canal de un ítem o propagar el canal de un requisito en una rendición anulada                      |
| `REQUISITO_NO_EN_RENDICION` | `rendicionId`                           | Se intenta propagar el canal de un requisito a una rendición que no tiene ítems de ese requisito                                                |
| `REQUISITO_YA_EN_RENDICION` | No lleva                                | Se intenta agregar a una rendición un requisito cuyo tipo de documento ya tiene ítems en ella, aunque sea de otro requisito                     |
| `CLIENTE_NO_ACTIVO`         | `estado` del cliente                    | Se intenta editar la matriz o las indicaciones de armado, abrir una rendición o agregarle un requisito, de un cliente `INACTIVO` o `SUSPENDIDO` |

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "El cliente no está activo",
    "details": { "motivo": "CLIENTE_NO_ACTIVO", "estado": "INACTIVO" }
  }
}
```

### Resumen

| Historia    | Método y ruta                                               | Qué hace                                                                | Código HTTP |
| ----------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- | ----------- |
| Catálogo    | `GET /tipos-documento`                                      | Lista los tipos de documento                                            | 200         |
| Catálogo    | `POST /tipos-documento`                                     | Crea un tipo de documento                                               | 201         |
| Catálogo    | `PATCH /tipos-documento/:id`                                | Modifica nombre o descripción                                           | 200         |
| Catálogo    | `PATCH /tipos-documento/:id/estado`                         | Activa o desactiva un tipo                                              | 200         |
| Matriz      | `GET /clientes/:id/requisitos`                              | Lista la matriz del cliente                                             | 200         |
| Matriz      | `POST /clientes/:id/requisitos`                             | Agrega un requisito                                                     | 201         |
| Matriz      | `PATCH /clientes/:id/requisitos/:requisitoId`               | Modifica un requisito                                                   | 200         |
| Matriz      | `DELETE /clientes/:id/requisitos/:requisitoId`              | Da de baja un requisito (baja lógica)                                   | 204         |
| HU2.3       | `POST /requisitos/masivo`                                   | Agrega un mismo requisito a varios clientes                             | 200         |
| HU2.4       | `GET /clientes/:id/indicaciones-armado`                     | Lee las indicaciones de armado                                          | 200         |
| HU2.4       | `PUT /clientes/:id/indicaciones-armado`                     | Guarda las indicaciones de armado                                       | 200         |
| HU2.10      | `GET /clientes/:id/observaciones`                           | Lee las observaciones internas                                          | 200         |
| HU2.10      | `PUT /clientes/:id/observaciones`                           | Guarda o borra las observaciones internas                               | 200         |
| Rendiciones | `POST /clientes/:id/rendiciones`                            | Abre una rendición y genera su checklist                                | 201         |
| Rendiciones | `GET /clientes/:id/rendiciones`                             | Lista las rendiciones del cliente (por defecto, las activas)            | 200         |
| Rendiciones | `GET /rendiciones/:id`                                      | Trae una rendición con su checklist                                     | 200         |
| Rendiciones | `POST /rendiciones/:id/requisitos/:requisitoId`             | Agrega a una rendición activa los ítems de un requisito nuevo           | 200         |
| Rendiciones | `PATCH /rendiciones/:id/items/:itemId/canal`                | Corrige el canal de un ítem de una rendición activa                     | 200         |
| HU2.5       | `POST /rendiciones/:id/preparar-envio`                      | Valida los ítems elegidos para enviar y devuelve sus datos (no envía)   | 200         |
| Rendiciones | `POST /clientes/:id/requisitos/:requisitoId/propagar-canal` | Pasa el canal actual de un requisito a sus ítems en rendiciones activas | 200         |
| HU2.5       | `PATCH /rendiciones/:id/estado`                             | Anula una rendición (baja lógica, no reversible)                        | 200         |
| Clientes    | `GET /clientes` (extensión)                                 | Agrega `matrizConfigurada` y un filtro por ese campo                    | 200         |
| Clientes    | `GET /clientes/:id`                                         | Devuelve un cliente con el mismo DTO, incluido el flag                  | 200         |

El completado de ítems se define en HU2.8 (aplicar documento); no hay endpoint de tilde manual.

### 4.1 Tipos de documento

```json
{
  "id": "c1d2e3f4-a5b6-4789-8abc-def012345678",
  "nombre": "Constancia ARCA",
  "descripcion": null,
  "activo": true,
  "creadoEn": "2026-10-20T12:00:00.000Z",
  "actualizadoEn": "2026-10-20T12:00:00.000Z"
}
```

- **Nombre (`nombre`):** obligatorio, hasta 100 caracteres. Se guarda y se devuelve tal como llegó (con los bordes recortados). Único **sin distinguir mayúsculas, acentos ni espacios repetidos**: `Constancia ARCA`, `constancia  arca` y `Constancía ARCA` son el mismo nombre. La `ñ` es otra letra: `Año` y `Ano` son nombres distintos. Lo garantiza la base con un índice único sobre una clave normalizada (`nombreNormalizado`, calculada con `normalizarNombreTipoDocumento` de `@realpolitik/shared`), también ante dos altas simultáneas. Esa clave es interna: no se envía ni se devuelve (ver [ADR-0003](../adr/0003-modelado-requisitos-y-rendiciones.md), punto 8).
- **Descripción (`descripcion`):** opcional, hasta 500 caracteres. Sin descripción se devuelve `null`; la clave siempre está.
- **Activo (`activo`):** un tipo no se borra. Un tipo inactivo no se puede usar en requisitos nuevos. Los requisitos que ya lo usan **no cambian**: siguen en la matriz y siguen entrando en el checklist de las rendiciones nuevas. Para que un cliente deje de pedirlo, se da de baja ese requisito.

#### `GET /tipos-documento`

| Parámetro          | Obligatorio | Descripción                                                                         |
| ------------------ | ----------- | ----------------------------------------------------------------------------------- |
| `incluirInactivos` | No          | `true` devuelve activos e inactivos. Sin el parámetro (o con `false`), solo activos |

- **Respuesta 200:** lista de tipos ordenada alfabéticamente por la clave normalizada del nombre (sin mayúsculas ni acentos), así `beta` queda entre `Ácido` y `Gama`. Dónde caen exactamente la `ñ` y los espacios lo decide la collation de la base. Lista vacía si no hay resultados.
- **Errores:** `400 VALIDATION_ERROR` si `incluirInactivos` no es `true` ni `false`.

#### `POST /tipos-documento`

- **Pedido:** `{ "nombre": "Constancia ARCA", "descripcion": "Opcional" }`. No se envían `id`, `activo` ni fechas: si llegan, se ignoran. Un tipo nuevo nace `activo: true`.
- **Respuesta 201:** el tipo creado.
- **Errores:**
  - `400 VALIDATION_ERROR`: falta el nombre, o el nombre o la descripción superan su largo o tienen caracteres de control.
  - `409 CONFLICT`: `motivo: "TIPO_DOCUMENTO_DUPLICADO"` si ya existe un tipo con ese nombre (sin distinguir mayúsculas, acentos ni espacios repetidos), activo o inactivo. `tipoDocumentoExistente` trae `id`, `nombre` y `activo` del tipo que ya tiene el nombre. Con dos altas simultáneas del mismo nombre se crea una sola; la otra recibe este `409`:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Ya existe un tipo de documento con ese nombre",
    "details": {
      "motivo": "TIPO_DOCUMENTO_DUPLICADO",
      "tipoDocumentoExistente": { "id": "…", "nombre": "Constancia ARCA", "activo": false }
    }
  }
}
```

#### `PATCH /tipos-documento/:id`

- **Pedido:** `nombre` y/o `descripcion`, al menos uno (`{}` es `400`). Lo que no se envía no cambia. `"descripcion": null` la borra. `activo` se cambia solo con `/estado`; si llega acá, se ignora. Un tipo inactivo también se puede editar y sigue inactivo.
- **Qué hace con lo ya abierto:** renombrar no cambia los ítems de rendiciones ya abiertas, que guardan el nombre de ese momento (`nombreTipoDocumento`). Los requisitos de las matrices sí muestran el nombre nuevo, porque leen el tipo.
- **Respuesta 200:** el tipo actualizado.
- **Errores:** `400 VALIDATION_ERROR` (pedido vacío, largos, caracteres de control, id que no es uuid), `404 NOT_FOUND` (el tipo no existe), `409 CONFLICT` (`TIPO_DOCUMENTO_DUPLICADO`: el nombre nuevo pertenece **a otro** tipo; el propio no cuenta, aunque cambie solo en mayúsculas o acentos).

#### `PATCH /tipos-documento/:id/estado`

- **Pedido:** `{ "activo": false }` o `{ "activo": true }`.
- **Qué hace:** cambia solo `activo`. Se puede desactivar un tipo en uso: sus requisitos existentes no se tocan y siguen entrando en el checklist. Igual que `PATCH /clientes/:id/estado`, pedir el estado que el tipo ya tiene responde 200 **sin escribir**.
- **Respuesta 200:** el tipo con su nuevo estado.
- **Errores:** `400 VALIDATION_ERROR` (`activo` ausente o no booleano, id que no es uuid), `404 NOT_FOUND`.

### 4.2 Requisitos (matriz del cliente)

Un requisito es un documento que el cliente exige en cada rendición.

```json
{
  "id": "d1e2f3a4-b5c6-4789-8abc-def012345678",
  "clienteId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "tipoDocumento": {
    "id": "c1d2e3f4-a5b6-4789-8abc-def012345678",
    "nombre": "Print",
    "activo": true
  },
  "cantidad": 3,
  "diasAproximados": [1, 10, 20],
  "canalEntrega": null,
  "nota": "Prints de la pauta de radio",
  "creadoEn": "2026-10-20T12:00:00.000Z",
  "actualizadoEn": "2026-10-20T12:00:00.000Z"
}
```

- **Tipo (`tipoDocumentoId` en el pedido, `tipoDocumento` en la respuesta):** obligatorio al crear y **no editable**: para cambiar de tipo se da de baja el requisito y se crea otro. Tiene que ser un tipo activo. Un cliente no puede tener dos requisitos **activos** del mismo tipo; uno dado de baja no impide volver a agregarlo.
- **Cantidad (`cantidad`):** entero, al menos 1, `1` por defecto. Cuántos documentos de ese tipo por rendición. Máximo **31** (`CANTIDAD_MAX`), confirmado con el negocio el 27/10/2026: los documentos comunes se piden una vez por mes y los Prints, como máximo uno por día (ADR-0003, "Reglas confirmadas con el negocio"). Lo valida `@realpolitik/shared`, no la base, que no fija un máximo: un requisito guardado antes con más de 31 se sigue pudiendo leer.
- **Días aproximados (`diasAproximados`):** lista de enteros de 1 a 31, `[]` por defecto. Vacía, o con **exactamente** `cantidad` días. Se permiten días repetidos y desordenados, pero se guardan **ordenados de menor a mayor** (`[15, 1, 15]` se guarda como `[1, 15, 15]`), para que el ítem N de la rendición tome siempre el día N.
- **Canal (`canalEntrega`):** `CORREO`, `PORTAL_WEB`, `WHATSAPP` o `null`. `null` (por defecto) significa "usa el canal principal del cliente". La respuesta devuelve el valor guardado, no el canal resuelto. **Pendiente de backend:** un requisito con canal `PORTAL_WEB` o `WHATSAPP` cuando el cliente no tiene `portalUrl` o `whatsappNumero` no se valida en `@realpolitik/shared` (ver 4.8).
- **Nota (`nota`):** opcional, hasta 500 caracteres, `null` si no hay.
- **Cambios y rendiciones abiertas:** dar de alta, modificar o dar de baja un requisito no altera las rendiciones ya abiertas (snapshot). Solo afecta a las que se abran después.

#### `GET /clientes/:id/requisitos`

- **Respuesta 200:** los requisitos activos del cliente, ordenados alfabéticamente por el nombre del tipo de documento. Lista vacía si no tiene (matriz sin configurar). Responde igual para cualquier estado del cliente.
- **Errores:** `400 VALIDATION_ERROR` (id que no es uuid), `404 NOT_FOUND` (el cliente no existe o está borrado).

#### `POST /clientes/:id/requisitos`

- **Pedido:**

```json
{
  "tipoDocumentoId": "c1d2e3f4-a5b6-4789-8abc-def012345678",
  "cantidad": 3,
  "diasAproximados": [1, 10, 20],
  "canalEntrega": null,
  "nota": "Prints de la pauta de radio"
}
```

Solo `tipoDocumentoId` es obligatorio. No se envían `clienteId`, fechas ni baja lógica: si llegan, se ignoran.

- **Qué hace:** crea el requisito. Si es el primer requisito activo del cliente, `matrizConfigurada` pasa a `true`.
- **Respuesta 201:** el requisito creado.
- **Errores:**
  - `400 VALIDATION_ERROR`: falta `tipoDocumentoId` o no es un uuid; el tipo de documento está inactivo (`campo: "tipoDocumentoId"`); `cantidad` no es un entero, es menor que 1 o supera 31; `diasAproximados` con un día fuera de 1 a 31, con un valor no entero o con una cantidad de días distinta de 0 y de `cantidad`; `canalEntrega` desconocido; `nota` de más de 500 caracteres o con caracteres de control.
  - `404 NOT_FOUND`: el cliente no existe o está borrado; el tipo de documento no existe.
  - `409 CONFLICT`: `motivo: "CLIENTE_NO_ACTIVO"` si el cliente es `INACTIVO` o `SUSPENDIDO`; `motivo: "REQUISITO_DUPLICADO"` si el cliente ya tiene un requisito activo de ese tipo:

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "El cliente ya tiene un requisito para ese tipo de documento",
    "details": {
      "motivo": "REQUISITO_DUPLICADO",
      "requisitoExistente": { "id": "…", "tipoDocumentoId": "…", "cantidad": 3 }
    }
  }
}
```

#### `PATCH /clientes/:id/requisitos/:requisitoId`

- **Pedido:** cualquier subconjunto de `cantidad`, `diasAproximados`, `canalEntrega` y `nota`, con al menos uno (`{}` es `400`). `"canalEntrega": null` quita el override; `"nota": null` borra la nota. `tipoDocumentoId` no es editable: si llega, se ignora.
- **Regla de los días sobre el resultado:** igual que los emails del cliente, se valida el **estado resultante** (lo enviado más lo guardado). Cambiar solo `cantidad` en un requisito con días cargados, sin enviar la lista nueva, deja días y cantidad incoherentes y es `400 VALIDATION_ERROR`, sin modificar nada.
- **Respuesta 200:** el requisito actualizado.
- **Errores:** `400 VALIDATION_ERROR` (pedido vacío, datos inválidos como en `POST`, días incoherentes con la cantidad resultante, ids que no son uuid), `404 NOT_FOUND` (el cliente no existe o está borrado; el requisito no existe, está dado de baja o es de otro cliente), `409 CONFLICT` (`CLIENTE_NO_ACTIVO`).

#### `DELETE /clientes/:id/requisitos/:requisitoId`

- **Qué hace:** baja lógica (`isDeleted`, `deletedAt`). El requisito deja de figurar en la matriz y no entra en las rendiciones que se abran después. Los ítems de rendiciones ya abiertas que salieron de él se conservan sin cambios. Si era el último requisito activo del cliente, `matrizConfigurada` vuelve a `false`.
- **Respuesta 204:** sin cuerpo.
- **Errores:** `400 VALIDATION_ERROR` (ids que no son uuid), `404 NOT_FOUND` (el cliente no existe o está borrado; el requisito no existe, ya estaba dado de baja o es de otro cliente), `409 CONFLICT` (`CLIENTE_NO_ACTIVO`).

#### Pantalla `/clientes/:id/matriz` (HU2.2)

La pantalla consulta la matriz (`GET` del cliente y `GET` de sus requisitos), da de alta, edita y da de baja lógica un requisito. `matrizConfigurada` lo calcula el servidor al crear el primero o al dar de baja el último: el front no lo envía. Un tipo de documento desactivado sigue visible y se puede editar; no se ofrece para un alta. Un cliente `INACTIVO` o `SUSPENDIDO` se lee y no se modifica.

La cantidad es un entero de 1 a 31. Los días aproximados se cargan de a uno, o se dejan vacíos; una lista a medias no se envía. Bajar la cantidad no borra días: hay que quitar los que sobran. Se pueden repetir y se guardan ordenados. Son orientativos y no generan alertas.

Queda fuera de esta pantalla la carga masiva (HU2.3), las indicaciones de armado (HU2.4) y las rendiciones (HU2.5).

### 4.3 Carga masiva de un requisito (HU2.3)

Agrega **un mismo** requisito a **varios** clientes a la vez. Reemplaza a "copiar la matriz de otro cliente", que se descartó en la Planning del 18/10/2026.

#### `POST /requisitos/masivo`

- **Pedido:**

```json
{
  "tipoDocumentoId": "c1d2e3f4-a5b6-4789-8abc-def012345678",
  "canalEntrega": "PORTAL_WEB",
  "nota": "Constancia del mes anterior",
  "clientes": [
    { "clienteId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789", "cantidad": 1 },
    {
      "clienteId": "b2c3d4e5-f6a7-4890-bcde-f01234567890",
      "cantidad": 2,
      "diasAproximados": [5, 20]
    }
  ]
}
```

| Campo                        | Obligatorio | Descripción                                                                 |
| ---------------------------- | ----------- | --------------------------------------------------------------------------- |
| `tipoDocumentoId`            | Sí          | Tipo de documento activo                                                    |
| `clientes`                   | Sí          | Lista no vacía. Un mismo `clienteId` no puede repetirse. Sin tope de largo  |
| `clientes[].clienteId`       | Sí          | uuid del cliente                                                            |
| `clientes[].cantidad`        | No          | Entero de 1 a 31. `1` por defecto                                           |
| `clientes[].diasAproximados` | No          | Vacía o exactamente `cantidad` días, cada uno de 1 a 31. `[]` por defecto   |
| `canalEntrega`               | No          | Override de canal. Si se envía, se aplica a todos los requisitos creados    |
| `nota`                       | No          | Hasta 500 caracteres. Si se envía, se aplica a todos los requisitos creados |

- **Qué hace:** crea el requisito en cada cliente indicado, con las mismas reglas que `POST /clientes/:id/requisitos`. En una sola transacción.
  - A un cliente que ya tiene un requisito **activo** de ese tipo no se le duplica ni se le modifica: se omite con `motivo: "REQUISITO_DUPLICADO"`.
  - Un cliente que no está `ACTIVO` (`INACTIVO` o `SUSPENDIDO`) se omite con `motivo: "CLIENTE_NO_ACTIVO"`. No hace fallar el pedido.
  - En cada cliente al que se le crea el requisito, `matrizConfigurada` pasa a `true` si no lo estaba.
- **Respuesta 200:** qué clientes recibieron el requisito y cuáles se omitieron. Puede no crearse ninguno (todos omitidos): sigue siendo 200.

```json
{
  "creados": ["a1b2c3d4-e5f6-4789-abcd-ef0123456789"],
  "omitidos": [
    { "clienteId": "b2c3d4e5-f6a7-4890-bcde-f01234567890", "motivo": "REQUISITO_DUPLICADO" }
  ]
}
```

- **Errores** (en todos los casos no se crea ningún requisito):
  - `400 VALIDATION_ERROR`: falta `tipoDocumentoId` o no es un uuid; el tipo está inactivo; `clientes` falta o está vacía; un `clienteId` se repite en el pedido o no es un uuid; una `cantidad` inválida; días que no coinciden con la cantidad o fuera de 1 a 31 (`campo` señala el cliente, por ejemplo `clientes.1.diasAproximados`); `canalEntrega` desconocido; `nota` inválida.
  - `404 NOT_FOUND`: el tipo de documento no existe, o algún cliente no existe o está borrado.

### 4.4 Indicaciones de armado (HU2.4) y observaciones internas (HU2.10)

Un texto libre por cliente con indicaciones para armar el legajo. Se lee y se guarda aparte de los datos del cliente.

#### `GET /clientes/:id/indicaciones-armado`

- **Respuesta 200:** `{ "indicacionesArmado": "Ordenar los prints por fecha.\nFactura siempre primero." }`. Sin indicaciones cargadas: `{ "indicacionesArmado": null }`.
- **Errores:** `400 VALIDATION_ERROR` (id que no es uuid), `404 NOT_FOUND` (el cliente no existe o está borrado).

#### `PUT /clientes/:id/indicaciones-armado`

- **Pedido:** `{ "indicacionesArmado": "texto" }` o `{ "indicacionesArmado": null }` para borrarlas. La clave es obligatoria.
- **Solo clientes activos:** igual que la matriz, las indicaciones de un cliente `INACTIVO` o `SUSPENDIDO` no se pueden editar: primero hay que reactivarlo. `GET` sigue respondiendo en cualquier estado.
- **Reglas del texto:**
  - Hasta 1000 caracteres, recortado en los bordes.
  - Un texto vacío o de solo espacios se guarda como `null`.
  - **Se admiten saltos de línea:** es una excepción explícita a la regla de la sección 1 sobre caracteres de control. El resto de los caracteres de control sigue siendo `400`.
- **Respuesta 200:** el mismo objeto que `GET`, con lo guardado.
- **Errores:** `400 VALIDATION_ERROR` (falta la clave, no es texto ni `null`, supera los 1000 caracteres, tiene caracteres de control que no son saltos de línea, id que no es uuid), `404 NOT_FOUND` (el cliente no existe o está borrado), `409 CONFLICT` (`CLIENTE_NO_ACTIVO`: el cliente es `INACTIVO` o `SUSPENDIDO`).

Las **observaciones internas** (HU2.10) son una nota por cliente con hechos puntuales de la cuenta (por ejemplo: cambió el mail, pausó la pauta, cambió el importe). No se repite mes a mes y no reemplaza a las indicaciones de armado, que son reglas fijas del legajo. Igual que las indicaciones, se leen y se guardan aparte de los datos del cliente: **no** salen en `ClienteSchema` ni en `GET /clientes/:id`. Es una sola nota: guardar reemplaza la anterior, sin historial. En la interfaz se leen en la pantalla del cliente y se editan en la hoja "Editar cliente" (también se pueden cargar en "Nuevo cliente"), como las indicaciones.

#### `GET /clientes/:id/observaciones` (HU2.10)

- **Respuesta 200:** `{ "observaciones": "Cambió el mail.\nPausó la pauta hasta marzo." }`. Sin observaciones cargadas: `{ "observaciones": null }`.
- **Cualquier estado:** responde igual para un cliente `ACTIVO`, `INACTIVO` o `SUSPENDIDO`.
- **Errores:** `400 VALIDATION_ERROR` (id que no es uuid), `404 NOT_FOUND` (el cliente no existe o está borrado).

#### `PUT /clientes/:id/observaciones` (HU2.10)

- **Pedido:** `{ "observaciones": "texto" }` o `{ "observaciones": null }` para borrarla. La clave es obligatoria.
- **Cualquier estado del cliente:** es una excepción a la regla de la sección 4 ("Cliente no activo"). Las observaciones se guardan con el cliente `ACTIVO`, `INACTIVO` o `SUSPENDIDO`: son una nota interna y no generan operaciones, y es justo lo que se anota cuando una cuenta se pausa. No existe `409 CLIENTE_NO_ACTIVO` para este endpoint.
- **Reglas del texto:** las mismas que las de las indicaciones de armado.
  - Hasta 1000 caracteres, recortado en los bordes.
  - Un texto vacío o de solo espacios se guarda como `null`.
  - **Se admiten saltos de línea:** excepción explícita a la regla de la sección 1 sobre caracteres de control. El resto de los caracteres de control sigue siendo `400`.
- **Sin comparar con lo guardado:** guardar el mismo texto otra vez también escribe la fila (y actualiza `actualizadoEn` del cliente), como en las indicaciones.
- **Respuesta 200:** el mismo objeto que `GET`, con lo guardado.
- **Errores:** `400 VALIDATION_ERROR` (falta la clave, no es texto ni `null`, supera los 1000 caracteres, tiene caracteres de control que no son saltos de línea, id que no es uuid), `404 NOT_FOUND` (el cliente no existe o está borrado).

### 4.5 Rendiciones

Una rendición es un período (`anio`, `mes`) y una factura (`numeroFactura`) de un cliente. Un cliente puede tener varias en el mismo mes, una por factura.

> **Nota:** la orden de compra se modela aparte en otra HU.

```json
{
  "id": "e1f2a3b4-c5d6-4789-8abc-def012345678",
  "clienteId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
  "anio": 2026,
  "mes": 10,
  "numeroFactura": "B 00002-00001482",
  "estado": "ACTIVA",
  "anuladaEn": null,
  "creadoEn": "2026-10-20T12:00:00.000Z",
  "actualizadoEn": "2026-10-20T12:00:00.000Z",
  "items": [
    {
      "id": "f1a2b3c4-d5e6-4789-8abc-def012345678",
      "requisitoClienteId": "d1e2f3a4-b5c6-4789-8abc-def012345678",
      "tipoDocumentoId": "c1d2e3f4-a5b6-4789-8abc-def012345678",
      "nombreTipoDocumento": "Print",
      "ordinal": 1,
      "totalOrdinal": 3,
      "diaAproximado": 1,
      "canalEntrega": "CORREO",
      "completado": false,
      "completadoEn": null,
      "creadoEn": "2026-10-20T12:00:00.000Z",
      "actualizadoEn": "2026-10-20T12:00:00.000Z"
    }
  ]
}
```

- **Año (`anio`):** entero de 2020 a 2100.
- **Mes (`mes`):** entero de 1 a 12.
- **Período:** cualquier mes pasado es válido (desde enero de 2020) y, como máximo, el **mes siguiente al actual**. "El mes actual" se mide en horario de Buenos Aires (`America/Argentina/Buenos_Aires`), no en UTC, también en el front, para coincidir con el backend. El error se informa en el campo `mes`.
- **Número de factura (`numeroFactura`):** obligatorio, con formato de factura argentina: letra `A`, `B` o `C`, punto de venta de 5 dígitos y número de comprobante de 8 dígitos. Se guarda y se devuelve en su **formato canónico** `B 00002-00001482`. Al escribir se normaliza antes de validar: la letra puede venir en minúscula, con o sin espacio; el guion puede tener espacios alrededor; y el punto de venta y el número se completan con ceros a la izquierda si vienen más cortos (`b 2-1482` se guarda como `B 00002-00001482`). Se normaliza porque la unicidad de la base compara el texto exacto: así dos escrituras del mismo comprobante son la misma factura. **Al leer no se valida el formato:** una rendición cargada antes con otro formato se sigue viendo tal cual.
- **Unicidad:** un número de factura está en una sola rendición **activa** del cliente, sin importar el mes ni el año. La misma factura en dos clientes distintos se acepta. Una rendición anulada no impide volver a usar su número de factura.
- **Estado (`estado`, `anuladaEn`):** `ACTIVA` o `ANULADA`, derivado de la baja lógica; `anuladaEn` es la fecha de anulación (`deletedAt`) o `null`. El listado devuelve por defecto solo `ACTIVA` y muestra las anuladas solo si se piden con el filtro `estado`; el detalle devuelve también una anulada, que se conserva como historial.
- **Ítems (`items`):** solo en el detalle y en la respuesta de alta. Cada ítem es un documento a presentar, ordenados por `nombreTipoDocumento` y luego por `ordinal`. `completadoEn` es la columna `completadoAt`, con el mismo criterio de nombres que `creadoEn`. El completado de ítems se define en HU2.8 (aplicar documento); no hay endpoint de tilde manual.

#### `POST /clientes/:id/rendiciones`

- **Pedido:** `{ "anio": 2026, "mes": 10, "numeroFactura": "B 00002-00001482" }`. Ningún otro dato: no hay decisiones de condicionales, todos los requisitos activos entran.
- **Qué hace**, en una sola transacción:
  1. Crea la rendición.
  2. Por cada requisito **activo** de la matriz del cliente crea `cantidad` ítems, con `ordinal` de 1 a `cantidad` y `totalOrdinal` = `cantidad`. Entran también los requisitos cuyo tipo de documento está inactivo.
  3. Cada ítem copia: `tipoDocumentoId`, el nombre del tipo en ese momento (`nombreTipoDocumento`), el día de su ocurrencia (`diasAproximados[ordinal - 1]`, o `null` si el requisito no tenía días) y el canal efectivo (`requisito.canalEntrega ?? cliente.canalEntrega`, nunca `null`). Los ítems nacen con `completado: false`.
  4. No copia la nota del requisito, la descripción del tipo ni datos del cliente.
- **Respuesta 201:** la rendición con su checklist (`items`).
- **Errores:**
  - `400 VALIDATION_ERROR`: falta `anio`, `mes` o `numeroFactura`; `anio` fuera de 2020 a 2100 o no entero; `mes` fuera de 1 a 12 o no entero; período posterior al mes siguiente al actual (el error cae en `mes`); `numeroFactura` vacío, de solo espacios o que, después de normalizarlo, no cumple el formato (sin letra, otra letra que A, B o C, punto de venta de más de 5 dígitos, número de más de 8, letras en los números o sin guion; el mensaje dice el formato esperado con el ejemplo `B 00002-00001482`); id que no es uuid.
  - `404 NOT_FOUND`: el cliente no existe o está borrado.
  - `409 CONFLICT`:
    - `motivo: "CLIENTE_NO_ACTIVO"`: el cliente es `INACTIVO` o `SUSPENDIDO`.
    - `motivo: "MATRIZ_VACIA"`: el cliente no tiene requisitos activos. Todo cliente pide al menos la factura, así que una matriz vacía significa que falta configurarla.
    - `motivo: "RENDICION_DUPLICADA"`: ese número de factura ya está en otra rendición activa del cliente, de cualquier mes y año. `rendicionExistente` dice en qué período está. También si dos pedidos con la misma factura llegan a la vez: el índice único de la base rechaza el segundo.

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "Ese número de factura ya está en otra rendición del cliente",
    "details": {
      "motivo": "RENDICION_DUPLICADA",
      "rendicionExistente": {
        "id": "…",
        "anio": 2026,
        "mes": 9,
        "numeroFactura": "B 00002-00001482"
      }
    }
  }
}
```

#### `GET /clientes/:id/rendiciones`

| Parámetro     | Obligatorio | Descripción                                                                                            |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------ |
| `anio`        | No          | Entero de 2020 a 2100                                                                                  |
| `mes`         | No          | Entero de 1 a 12. Se puede combinar con `anio` o usar solo                                             |
| `estado`      | No          | `ACTIVA`, `ANULADA` o `TODAS`. Sin el parámetro, `ACTIVA`. Se combina con el período                   |
| `requisitoId` | No          | uuid de un requisito. Solo las rendiciones que tienen ítems de ese requisito. Se combina con los demás |

- **Respuesta 200:** las rendiciones del cliente según `estado`, sin `items` y con un resumen de avance. Sin el parámetro, solo las **activas**, como antes: las anuladas se consultan pidiéndolas. Lista vacía si no hay. Orden: `anio` descendente, `mes` descendente y, dentro del mismo mes, la más reciente primero (`creadoEn` descendente). Con `TODAS`, primero las activas y después las anuladas, cada grupo con ese orden.
- **Estado y baja lógica:** una rendición anulada es su baja lógica (no hay otro estado oculto). Las rendiciones de un cliente borrado no se listan con ningún filtro: el cliente no existe (`404`).

```json
[
  {
    "id": "e1f2a3b4-c5d6-4789-8abc-def012345678",
    "clienteId": "a1b2c3d4-e5f6-4789-abcd-ef0123456789",
    "anio": 2026,
    "mes": 10,
    "numeroFactura": "B 00002-00001482",
    "estado": "ACTIVA",
    "anuladaEn": null,
    "resumen": { "totalItems": 4, "completados": 1 },
    "creadoEn": "2026-10-20T12:00:00.000Z",
    "actualizadoEn": "2026-10-20T12:00:00.000Z"
  }
]
```

- **Errores:** `400 VALIDATION_ERROR` (id que no es uuid; `anio` o `mes` fuera de rango o no enteros; `estado` que no es `ACTIVA`, `ANULADA` ni `TODAS`, o repetido; `requisitoId` que no es uuid, o repetido), `404 NOT_FOUND` (el cliente no existe o está borrado). Un `requisitoId` de otro cliente no es un error: la lista sale vacía.

#### `GET /rendiciones/:id`

- **Respuesta 200:** la rendición con su checklist (`items`), también si está anulada (`"estado": "ANULADA"` y `anuladaEn`): el detalle se conserva como historial, en solo lectura.
- **Errores:** `400 VALIDATION_ERROR` (id que no es uuid), `404 NOT_FOUND` (la rendición no existe o su cliente está borrado).

#### `POST /rendiciones/:id/requisitos/:requisitoId`

Para cuando un cliente empieza a pedir un documento nuevo justo en un mes cuya rendición ya está abierta: el requisito se agrega a la matriz y también a esa rendición.

- **Pedido:** sin cuerpo. `:id` es la rendición y `:requisitoId`, un requisito activo de la matriz del cliente de esa rendición.
- **Qué hace:** agrega a la rendición **activa** los ítems de ese requisito, uno por unidad de `cantidad`, con el mismo snapshot que al abrirla (ver `POST /clientes/:id/rendiciones`, pasos 2 a 4): ordinal, nombre del tipo, día y canal efectivo del momento en que se agregan. Los ítems que la rendición ya tenía no cambian.
- **Se compara por tipo de documento:** si la rendición ya tiene ítems de ese tipo de documento, no se agrega nada, aunque vengan de otro requisito (por ejemplo, uno dado de baja y vuelto a crear, que tiene otro id).
- **Acción explícita:** la hace la operadora; nunca es automática. El alta en la matriz (`POST /clientes/:id/requisitos`) no cambia y no agrega nada a rendiciones abiertas.
- **Respuesta 200:** la rendición actualizada, con su checklist (`items`).
- **Errores:**
  - `400 VALIDATION_ERROR`: ids que no son uuid.
  - `404 NOT_FOUND`: la rendición no existe o su cliente está borrado; el requisito no existe, está dado de baja o es de otro cliente.
  - `409 CONFLICT`:
    - `motivo: "RENDICION_ANULADA"`: la rendición está anulada.
    - `motivo: "REQUISITO_YA_EN_RENDICION"`: la rendición ya tiene ítems de ese tipo de documento, aunque sean de otro requisito.
    - `motivo: "CLIENTE_NO_ACTIVO"`: el cliente es `INACTIVO` o `SUSPENDIDO`.
- **Cómo lo usa el front:** justo después de agregar un requisito a la matriz, si el cliente tiene una rendición abierta, ofrece agregarlo también a esa rendición.

#### `PATCH /rendiciones/:id/items/:itemId/canal`

Para cuando un requisito tenía un canal equivocado: los ítems guardan el canal efectivo del momento en que se abrió la rendición (o se sumó el requisito), así que corregir el requisito después no los cambia. Ver [ADR-0003](../adr/0003-modelado-requisitos-y-rendiciones.md), punto 9.

- **Pedido:** `{ "canalEntrega": "PORTAL_WEB" }`. `canalEntrega` es obligatorio: `CORREO`, `PORTAL_WEB` o `WHATSAPP` (el mismo enum que el canal del cliente; `ActualizarCanalDeItemSchema` de `@realpolitik/shared`). Otros campos se ignoran: es la única parte del snapshot que se corrige; el tipo, el ordinal y el día aproximado no cambian.
- **Qué hace:** cambia el canal de ese ítem en esa rendición. No modifica el requisito del cliente ni los ítems de otras rendiciones. Corre en una transacción serializable, así no se cruza con una anulación simultánea.
- **Idempotente:** con el canal que el ítem ya tiene, responde 200 **sin escribir** (`actualizadoEn` del ítem no cambia).
- **Respuesta 200:** la rendición con su checklist (`items`), como `GET /rendiciones/:id`.
- **Errores:**
  - `400 VALIDATION_ERROR`: ids que no son uuid; `canalEntrega` ausente o fuera del enum.
  - `404 NOT_FOUND`: la rendición no existe o su cliente está borrado; el ítem no existe o es de otra rendición.
  - `409 CONFLICT` con `motivo: "RENDICION_ANULADA"`: la rendición está anulada.
- **Cómo lo usa el front:** desde el detalle de una rendición activa, ítem por ítem, con confirmación. En una anulada no se ofrece.

#### `POST /rendiciones/:id/preparar-envio`

Prepara el envío de los ítems elegidos (HU2.5 con HU2.8). **No envía nada ni guarda nada**: comprueba con los datos de ahora que los ítems se pueden enviar y devuelve sus datos, para que la operadora los mande por el canal. No cambia el estado de la rendición ni de los ítems.

- **Pedido:** `{ "itemIds": ["uuid", …] }`: al menos uno, sin repetir, hasta 500 (`PrepararEnvioSchema` de `@realpolitik/shared`).
- **Qué valida:** la rendición está activa; cada ítem es de esta rendición, está completado **y tiene una aplicación documental vigente** (no alcanza con `completado`: un ítem completado sin aplicación, por ejemplo un dato anterior a HU2.8, no se envía). Es la regla `motivoNoEnviable` de shared, la misma que usa el checklist para habilitar la casilla. Como en HU2.5, todos los ítems van por el mismo canal. Lee con una foto consistente (transacción `REPEATABLE READ` de solo lectura).
- **Respuesta 200:** `{ rendicionId, canal, items }` (`PreparacionEnvioSchema`): el canal único de la selección y los ítems en el orden del checklist, cada uno con `completado: true` y su `documento` vigente (`ItemEnviableSchema`, una especialización de `ItemChecklistSchema`: en el checklist general `documento` sigue opcional).
- **Errores:**
  - `400 VALIDATION_ERROR`: id de la rendición que no es uuid; `itemIds` ausente, vacío, con repetidos o con ids inválidos.
  - `404 NOT_FOUND`: la rendición no existe o su cliente está borrado; un ítem no existe o es de otra rendición.
  - `409 CONFLICT`, sin escribir nada:
    - `motivo: "RENDICION_ANULADA"`: la rendición está anulada.
    - `motivo: "ITEM_PENDIENTE"`, con `itemId`: el primer ítem (en el orden pedido) que no está completado.
    - `motivo: "ITEM_SIN_DOCUMENTO_VIGENTE"`, con `itemId`: el primer ítem completado sin aplicación vigente.
    - `motivo: "CANALES_DISTINTOS"`, con `canales`: los ítems se envían por canales distintos.
- **Cómo lo usa el front:** al tocar «Enviar» en el detalle de una rendición activa. Solo se pueden marcar los ítems que se pueden enviar; si el servidor responde 409 (algo cambió entre la selección y el envío), se vuelve a pedir la rendición y se avisa.

#### `POST /clientes/:id/requisitos/:requisitoId/propagar-canal`

Para cuando cambia el canal de un requisito (por ejemplo, Print pasa de WhatsApp a Portal web) y el cliente ya tiene rendiciones abiertas con ese documento: en vez de corregir cada ítem de cada rendición, se pasan al canal nuevo todos los ítems del requisito en las rendiciones elegidas. Ver [ADR-0003](../adr/0003-modelado-requisitos-y-rendiciones.md), punto 10.

- **Pedido:** `{ "rendicionIds": ["e1f2a3b4-c5d6-4789-8abc-def012345678"] }`. De 1 a 200 uuid, sin repetir (`PropagarCanalDeRequisitoSchema` de `@realpolitik/shared`). El canal no viaja en el pedido: es el canal efectivo actual del requisito (`requisito.canalEntrega ?? cliente.canalEntrega`), el mismo que tomaría una rendición que se abriera ahora. Otros campos se ignoran.
- **Qué hace:** en cada rendición elegida, pasa a ese canal **todos** los ítems de ese requisito. No cambia ningún otro campo del snapshot, ni los ítems de otros requisitos, ni otras rendiciones, ni el requisito. Un ítem que ya tiene ese canal no se reescribe (su `actualizadoEn` no cambia).
- **Todo o nada:** corre en una transacción serializable. Cada rendición tiene que ser del cliente, estar activa y tener ítems del requisito; si una no cumple, no se cambia ninguna. Los `409` informan la primera que no cumple, en el orden del pedido.
- **Cliente inactivo:** se permite, como corregir el canal de un ítem o anular. En la práctica viene después de editar el requisito, que sí exige un cliente activo.
- **Respuesta 200:** el canal aplicado y, por cada rendición pedida (en el mismo orden), cuántos de sus ítems cambiaron (`ResultadoPropagarCanalSchema`).

```json
{
  "canalEntrega": "PORTAL_WEB",
  "rendiciones": [{ "rendicionId": "e1f2a3b4-c5d6-4789-8abc-def012345678", "itemsActualizados": 3 }]
}
```

- **Errores:**
  - `400 VALIDATION_ERROR`: ids de la ruta que no son uuid; `rendicionIds` ausente, vacía, con más de 200, con un id repetido o con un id que no es uuid.
  - `404 NOT_FOUND`: el cliente no existe o está borrado; el requisito no existe, está dado de baja o es de otro cliente; una rendición no existe o es de otro cliente.
  - `409 CONFLICT`:
    - `motivo: "RENDICION_ANULADA"`, con `rendicionId`: una rendición está anulada.
    - `motivo: "REQUISITO_NO_EN_RENDICION"`, con `rendicionId`: una rendición no tiene ítems de ese requisito.
- **Cómo lo usa el front:** al guardar la edición de un requisito en la que cambió el canal efectivo (también al volver a heredar el del cliente, si es distinto), pide `GET /clientes/:id/rendiciones?estado=ACTIVA&requisitoId=…`. Si hay alguna, ofrece "¿Actualizar el canal en las rendiciones abiertas?", con la lista (período y factura) y ninguna tildada. Si el canal efectivo no cambió o no hay rendiciones, no muestra nada. Si el pedido falla, el requisito ya quedó guardado: el error se muestra en el mismo diálogo, con la selección intacta.

### 4.6 Anular una rendición (HU2.5)

Sigue el patrón de `PATCH /clientes/:id/estado`: un endpoint aparte, que solo cambia el estado.

#### `PATCH /rendiciones/:id/estado`

- **Pedido:** `{ "estado": "ANULADA" }`. La anulación **no es reversible**: enviar `ACTIVA` es `400 VALIDATION_ERROR`. No se registra un motivo.
- **Qué hace:** baja lógica: marca `isDeleted` y guarda `deletedAt`. No borra la rendición ni sus ítems, que conservan su valor fiscal. Desde ese momento no aparece en listados ni en el detalle, y su número de factura se puede usar en otra rendición.
- **Idempotente:** anular una rendición ya anulada responde 200 con la rendición tal cual, **sin escribir** (`anuladaEn` no cambia), igual que pedir el estado que un cliente ya tiene.
- **Cualquier estado del cliente:** se puede anular aunque el cliente esté `INACTIVO` o `SUSPENDIDO`: es la corrección de un error, no una operación nueva. No responde `CLIENTE_NO_ACTIVO`.
- **Respuesta 200:** la rendición con `"estado": "ANULADA"` y `anuladaEn`, sin `items`.
- **Errores:** `400 VALIDATION_ERROR` (estado ausente, `ACTIVA` o un valor desconocido, id que no es uuid), `404 NOT_FOUND` (la rendición no existe o su cliente está borrado).
- **Cómo lo usa el front:** "Anular" pide confirmación antes de llamar, como "Desactivar" un cliente.

### 4.7 Extensión de `GET /clientes`

**Implementado (HU2.2).**

- **Campo nuevo en la respuesta:** `matrizConfigurada` (booleano) en cada cliente de `ClienteSchema`. `true` = tiene al menos un requisito activo; `false` = la matriz todavía no se configuró. También lo devuelven `GET /clientes/:id`, `POST /clientes`, `PATCH /clientes/:id` y `PATCH /clientes/:id/estado`, porque usan el mismo DTO.
- **Parámetro nuevo:** `matrizConfigurada`, opcional, `true` o `false`. Se combina con `q`, `estado`, `sector` y `subtipo`. Sin el parámetro no se filtra.
- **Errores:** `400 VALIDATION_ERROR` si `matrizConfigurada` no es `true` ni `false`.
- El campo lo mantiene el backend (ver las reglas generales de esta sección): no se puede enviar en `POST` ni `PATCH /clientes`; si llega, se ignora. `indicacionesArmado` y `observaciones` **no** se agregan a `ClienteSchema`: cada una se lee con su propio endpoint (4.4).

### 4.8 Preguntas abiertas

Las preguntas de negocio se cerraron el 20/10/2026 y están aplicadas en esta sección. Quedan estos pendientes, que no bloquean la implementación:

| Tema                        | Qué falta                                                                                                                                                                                                                | A cargo |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Tope de clientes por pedido | `POST /requisitos/masivo` no limita cuántos clientes lleva una lista: el negocio no lo definió.                                                                                                                          | Negocio |
| Canal propio del requisito  | Un requisito con canal `PORTAL_WEB` o `WHATSAPP`, cuando el cliente no tiene `portalUrl` o `whatsappNumero`, no se valida: `@realpolitik/shared` no puede consultar al cliente. Hay que decidir y validar en el backend. | Backend |

### 4.9 Schemas a crear en `@realpolitik/shared`

Todos están implementados en `@realpolitik/shared` (T2.2), incluido el punto 7.

1. **Hecho.** `TipoDocumentoSchema`, `CreateTipoDocumentoSchema`, `UpdateTipoDocumentoSchema`, `ActualizarEstadoTipoDocumentoSchema` y `ListarTiposDocumentoQuerySchema` (`incluirInactivos`).
2. **Hecho.** `RequisitoClienteSchema`, `CreateRequisitoClienteSchema` y `UpdateRequisitoClienteSchema` (sin `tipoDocumentoId`, con la regla de días sobre el estado resultante).
3. **Hecho.** `CargaMasivaRequisitoSchema` (pedido) y `ResultadoCargaMasivaSchema` (`creados`, `omitidos`).
4. **Hecho.** `IndicacionesArmadoSchema`, que admite saltos de línea.
5. **Hecho.** `RendicionSchema`, `RendicionDetalleSchema` (con `items`), `RendicionResumenSchema` (con `resumen`), `ItemChecklistSchema`, `CreateRendicionSchema` (`anio`, `mes`, `numeroFactura`), `ListarRendicionesQuerySchema` (`anio`, `mes`) y `ActualizarEstadoRendicionSchema` (solo `ANULADA`). Todos usan `numeroFactura`, no `referencia`.
6. **Hecho.** Para `POST /rendiciones/:id/requisitos/:requisitoId` no hace falta schema de pedido (no lleva cuerpo): valida los dos uuid de la ruta y responde con `RendicionDetalleSchema`.
7. **Hecho (HU2.2).** En `ClienteSchema`, el campo `matrizConfigurada`; en `ListarClientesQuerySchema`, el filtro `matrizConfigurada`. El backend lo expone en el DTO de cliente y filtra `GET /clientes`. No es editable en el alta ni en el `PATCH`.
8. **Hecho.** `ActualizarCanalDeItemSchema` (corregir el canal de un ítem), `PropagarCanalDeRequisitoSchema` (pedido de la propagación) y `ResultadoPropagarCanalSchema` (su respuesta). Todos usan el enum `CanalEntrega` del cliente. `ListarRendicionesQuerySchema` suma `estado` y `requisitoId`.
9. **Hecho (HU2.10).** `ObservacionesClienteSchema` (cuerpo de `PUT /clientes/:id/observaciones`, admite saltos de línea) y `ObservacionesClienteLecturaSchema` (respuesta del `GET`, que no rechaza caracteres de control ya guardados), con el tope `OBSERVACIONES_CLIENTE_MAX` (1000).

Además de los schemas, `@realpolitik/shared` exporta `generarChecklist(matriz, cliente)`, `calcularFaltantes(items)`, `ChecklistError` y `esChecklistError` (que reconoce el error por `codigo`, sin `instanceof`). `generarChecklist` lanza `MATRIZ_VACIA` ante una matriz sin requisitos activos: el backend lo responde como `409 CONFLICT` con `motivo: "MATRIZ_VACIA"`.

### 4.10 Documentos (HU2.8)

Un archivo se carga **una vez**, con su tipo de documento y su período, y después se aplica a ítems de rendiciones de varios clientes (ADR-0004). Esta sección cubre la carga, las consultas, los candidatos, la aplicación a varios ítems, el reemplazo y el historial. Los schemas están en `@realpolitik/shared` (`documento.schema.ts` y `aplicacionDocumento.schema.ts`).

> **Deshabilitado en producción.** No hay autenticación: con `NODE_ENV=production`, `/documentos` (y el reemplazo y el historial, que cuelgan de `/rendiciones`) no se monta (cualquier ruta responde `404 NOT_FOUND`) salvo `DOCUMENTOS_HABILITADOS=true`. Esa variable solo se define cuando hay una protección efectiva del lado del servidor o de la infraestructura. CORS no lo es. En desarrollo y en tests está habilitado. Ver [Despliegue](../deployment.md#variables-del-backend).

| Método y ruta                                     | Qué hace                                               | Respuesta OK                               |
| ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------ |
| `POST /documentos`                                | Carga un documento (sin aplicarlo)                     | `201` `ResultadoCargaDocumentoSchema`      |
| `GET /documentos`                                 | Repositorio de un período                              | `200` lista de `DocumentoResumenSchema`    |
| `GET /documentos/:id`                             | Un documento y dónde está aplicado                     | `200` `DocumentoConAplicacionesSchema`     |
| `GET /documentos/:id/archivo`                     | Descarga el archivo a través del backend               | `200` el contenido (no JSON)               |
| `GET /documentos/:id/candidatos`                  | Ítems a los que se podría aplicar el documento         | `200` lista de `CandidatoAplicacionSchema` |
| `POST /documentos/:id/aplicaciones`               | Aplica el documento a los ítems elegidos (todo o nada) | `200` `DocumentoConAplicacionesSchema`     |
| `POST /rendiciones/:id/items/:itemId/reemplazo`   | Reemplaza el documento vigente de un ítem              | `200` `RendicionDetalleSchema`             |
| `GET /rendiciones/:id/items/:itemId/aplicaciones` | Historial de documentos de un ítem                     | `200` `HistorialDeItemSchema`              |

Ninguna respuesta incluye el hash, la clave del almacenamiento ni URLs del proveedor.

#### `POST /documentos`

- **Pedido:** `multipart/form-data` con el archivo en el campo `archivo` (uno solo) y los campos de texto `tipoDocumentoId`, `anio` y `mes` (`CargarDocumentoSchema`; el año y el mes, solo dígitos).
- **Archivo:** PDF, JPG/JPEG, PNG o DOCX, de 1 byte a 10 MB. El formato se decide por el **contenido**: la firma de los primeros bytes y, en un DOCX, su estructura interna (`word/document.xml` y el tipo de contenido principal de Word en `[Content_Types].xml`). Un ZIP cualquiera, un `.xlsx` o un `.docm` no pasan. La extensión del nombre tiene que corresponder a ese formato. El MIME que declara el navegador también, aunque se acepta vacío o `application/octet-stream`. Se guarda el nombre sin carpetas.
- **Tipo de documento:** tiene que existir (si no, `404`). Uno desactivado solo se acepta si todavía hay ítems pendientes de ese tipo en rendiciones activas del período; si no, `409` con `motivo: "TIPO_DOCUMENTO_INACTIVO"`.
- **Contenido repetido:** no se rechaza. Los documentos ya cargados con el mismo contenido, tipo y período vuelven en `posiblesDuplicados`, del más viejo al más nuevo, para ofrecer reutilizarlos.
- **Orden y consistencia:** se valida todo, se guarda el objeto en el almacenamiento y después se registra en la base. Si la base falla, el objeto se borra.

| Error                     | Cuándo                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400 VALIDATION_ERROR`    | Falta el archivo, formato no admitido, extensión o MIME que no coinciden, archivo vacío, más de un archivo, formulario mal formado o campos inválidos (`campo`: `archivo`, `body`, `tipoDocumentoId`, `anio`, `mes`) |
| `404 NOT_FOUND`           | El tipo de documento no existe                                                                                                                                                                                       |
| `409 CONFLICT`            | `TIPO_DOCUMENTO_INACTIVO`                                                                                                                                                                                            |
| `413 PAYLOAD_TOO_LARGE`   | El archivo supera los 10 MB                                                                                                                                                                                          |
| `503 SERVICE_UNAVAILABLE` | El almacenamiento no respondió: no se registró nada y se puede reintentar                                                                                                                                            |

#### `GET /documentos?anio=2026&mes=10[&tipoDocumentoId=…]`

Los documentos del período (`anio` y `mes` obligatorios), del más nuevo al más viejo. `aplicacionesVigentes` cuenta las aplicaciones vigentes en rendiciones **activas**: las reemplazadas y las de rendiciones anuladas son historial y se ven en el detalle.

#### `GET /documentos/:id`

El documento con todas sus aplicaciones (`aplicaciones`), cada una con su `estado` (`VIGENTE` o `REEMPLAZADA`) y su `ubicacion`: cliente (con su estado), rendición (con `estado` `ACTIVA` o `ANULADA`) e ítem (el snapshot: nombre del tipo, ordinal). Primero las vigentes y después las reemplazadas, cada grupo de la más reciente a la más vieja. No incluye las de clientes dados de baja. `404` si el documento no existe.

#### `GET /documentos/:id/archivo`

El contenido, enviado como stream por el backend, con el `Content-Type` guardado y estas cabeceras:

- `Content-Disposition: attachment`, con el nombre en ASCII (`filename`) y en UTF-8 (`filename*`), saneado;
- `X-Content-Type-Options: nosniff`;
- `Content-Security-Policy: default-src 'none'; sandbox`;
- `Cache-Control: private, no-store`.

Errores: `404` si el documento no existe y `503 SERVICE_UNAVAILABLE` si el almacenamiento no responde, ambos en JSON. Si el objeto falta en el almacenamiento es una inconsistencia: `500`.

#### `GET /documentos/:id/candidatos`

Los ítems a los que se podría aplicar el documento: **mismo `tipoDocumentoId`** que el del snapshot del ítem (no el de la matriz actual), **mismo año y mes**, rendición **activa** de un cliente no borrado e ítem **pendiente** (sin documento vigente). Incluye varias rendiciones del mismo cliente y clientes `INACTIVO` con rendiciones activas (`cliente.estado` lo indica). Cada candidato lleva el UUID del ítem y su ordinal (Print 2/5). Vienen ordenados para agrupar: por cliente, por rendición y, dentro de ella, en el orden del checklist. Hoy todos son `elegibilidad: "ELEGIBLE"`. El sistema solo sugiere: no elige ninguno. `404` si el documento no existe.

#### `POST /documentos/:id/aplicaciones`

- **Pedido:** `{ "itemIds": [...] }` (`AplicarDocumentoSchema`): de 1 a 500 UUID, sin repetir. La operadora los elige: nada se aplica solo.
- **Reglas:** cada ítem tiene que ser del mismo tipo que el documento (el del snapshot del ítem), de una rendición **activa** del mismo período, de un cliente no borrado (un cliente `INACTIVO` con la rendición activa se admite) y estar **pendiente**. Se puede aplicar a varios ítems de la misma rendición.
- **Todo o nada**, en una transacción serializable: si un ítem no cumple, no se aplica a ninguno. Cada ítem recibe una aplicación vigente y queda `completado` (con `completadoEn`), en la misma transacción. Las rendiciones involucradas se bloquean contra una anulación simultánea.
- **Concurrencia:** si dos pedidos aplican documentos al mismo ítem a la vez, uno gana y el otro responde `409 ITEM_NO_PENDIENTE`, sin aplicaciones parciales.

| Error          | Cuándo                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `400`          | `itemIds` vacío, con repetidos, con un id inválido o con más de 500                                                                                     |
| `404`          | El documento, o algún ítem (o su cliente), no existe                                                                                                    |
| `409 CONFLICT` | `RENDICION_ANULADA`, `TIPO_DOCUMENTO_DISTINTO`, `PERIODO_DISTINTO` o `ITEM_NO_PENDIENTE`, con el `itemId` del primero que no cumple, en el orden pedido |

#### `POST /rendiciones/:id/items/:itemId/reemplazo`

- **Pedido:** `{ "documentoId": "…", "aplicacionVigenteId": "…" }` (`ReemplazarDocumentoDeItemSchema`). `aplicacionVigenteId` es la aplicación que la operadora vio como vigente (concurrencia optimista).
- **Reglas:** el ítem es de esa rendición, la rendición está activa, el documento nuevo es del mismo tipo y período, y es otro que el vigente.
- **Efecto, atómico:** la aplicación anterior recibe `reemplazadaEn` y se crea una nueva con `reemplazaAId`. El ítem sigue completado, con su fecha original. Las aplicaciones del documento anterior en otros ítems no cambian.
- **Respuesta:** la rendición con su checklist, como la corrección del canal.

| Error          | Cuándo                                                                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `404`          | La rendición, el ítem (en esa rendición) o el documento no existen                                                                                                       |
| `409 CONFLICT` | `APLICACION_DESACTUALIZADA` (con la `aplicacionVigenteId` actual, o `null`), `DOCUMENTO_YA_VIGENTE`, `RENDICION_ANULADA`, `TIPO_DOCUMENTO_DISTINTO` o `PERIODO_DISTINTO` |

Dos reemplazos simultáneos de la misma aplicación: uno gana y el otro responde `409 APLICACION_DESACTUALIZADA`.

#### `GET /rendiciones/:id/items/:itemId/aplicaciones`

Todas las aplicaciones del ítem, de la más reciente a la más vieja, cada una con su `estado`, `reemplazaAId` y su documento (`DocumentoSchema`). También de una rendición anulada: es historial. `404` si el ítem no es de esa rendición.

#### El documento vigente en el checklist

En el detalle de una rendición (y en toda respuesta que lleve sus ítems), cada ítem trae `documento`: su documento vigente (`aplicacionId`, `documentoId`, `nombreOriginal`, `tipoContenido`, `tamanioBytes`, `aplicadaEn`) o `null` si no tiene. En `ItemChecklistSchema` el campo todavía es opcional, para no romper al frontend: el backend siempre lo manda.

## 5. Fuera del alcance de este documento

Autenticación y permisos, eliminación de documentos, vencimientos y despacho. Se documentan cuando se implementen.

## 6. Cambios que este contrato exige

Todos los puntos están implementados. Se conservan, con su numeración, como registro de qué exigió el contrato.

### En `@realpolitik/shared`

1. **Hecho.** Agregar `denominacion` (obligatoria, hasta 60 caracteres). Ya existe en la base de datos.
2. **Hecho (HU1.5).** Agregar `periodicidad` (`tipo`, `diaLimite`, `mesInicioCiclo`) con las reglas de la sección 2: `PeriodicidadTipo` y `PeriodicidadSchema`, incorporados a `ClienteSchema`, `CreateClienteSchema` y `UpdateClienteSchema`.
3. **Hecho.** En la edición, no exigir `sector` ni permitir enviar `estado`.
4. **Hecho (HU1.3).** Crear los schemas de contacto: `ContactoSchema`, `CreateContactoSchema`, `UpdateContactoSchema` y `ReemplazarContactosSchema`.
5. **Hecho (HU1.6).** Crear el schema de los parámetros de `GET /clientes` (`q`, `estado`, `sector`, `subtipo`): `ListarClientesQuerySchema`.
6. **Hecho (HU1.8).** Crear el schema del cuerpo de `PATCH /clientes/:id/estado`: `ActualizarEstadoClienteSchema`, que solo acepta `ACTIVO` e `INACTIVO`.

### En la base de datos

7. **Hecho (HU1.3).** Modelo `Contacto` con baja lógica, y un índice único sobre cliente y email entre los contactos no eliminados.
8. **Hecho (HU1.5).** En el cliente: columnas para la periodicidad (`periodicidadTipo`, `periodicidadDiaLimite` y `periodicidadMesInicioCiclo`, las tres opcionales; sin periodicidad configurada quedan las tres en `null`).
9. **Hecho.** Quitar `activo` del modelo de Cliente: `estado` es la única fuente de verdad del estado del cliente. `isDeleted` y `deletedAt` no forman parte de este contrato; se definen al ajustar el modelo de datos.
10. **Hecho (HU1.3).** Crear el índice único de contactos con SQL a mano en la migración, porque Prisma no soporta índices parciales.

## 7. Criterios de este borrador

| Tema                       | Decisión                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listar activos e inactivos | `GET /clientes` sin `estado` devuelve solo clientes `ACTIVO`. Si el front necesita ver ambos a la vez, se agrega `estado=TODOS`: es un cambio compatible que no rompe lo ya acordado.                                                                                                                                                                               |
| Mensajes de validación     | El front se apoya en `campo` para saber qué falló y muestra el `mensaje` del servidor cuando lo define `shared` o el backend (están en español). Los mensajes por defecto de Zod, en inglés, no se muestran: el front usa un aviso propio. Traducir el resto con un `errorMap` es un ajuste posterior del backend.                                                  |
| Baja del cliente           | `estado` es la única fuente de verdad. La API no expone ni usa `activo`, `isDeleted` ni `deletedAt`. El ajuste del modelo de datos queda en la sección 6.                                                                                                                                                                                                           |
| SUSPENDIDO                 | Existe en `shared` y en la base y se mantiene. Cuando se use, hay que definir en qué listados aparece un cliente suspendido.                                                                                                                                                                                                                                        |
| PATCH sin cambios reales   | `PATCH /clientes/:id` con valores idénticos a los guardados puede actualizar `actualizadoEn`: no hay contrato de "sin cambios" para la edición general (sí lo hay para `PATCH /clientes/:id/estado`). No es bloqueante; si hace falta, comparar contra lo guardado antes de escribir.                                                                               |
| Ediciones concurrentes     | `PATCH /clientes/:id` es _last write wins_ por campo: el front manda solo lo modificado, así dos personas que editan campos distintos no se pisan, pero si editan el mismo campo gana la última. Pendiente: control optimista con `actualizadoEn` como versión (`If-Match` o precondición en el cuerpo, `409`/`412` si cambió) y una UI para resolver el conflicto. |
