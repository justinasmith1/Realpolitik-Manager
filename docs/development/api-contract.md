# Contrato de API: clientes y contactos

> **Versión:** 1.0, para revisión del equipo (T0.7).
> **Fuente de verdad de los campos:** los schemas de `@realpolitik/shared`
> (`packages/shared/src/schemas/`). Este documento define los endpoints, parámetros,
> respuestas y errores. Si el código contradice a este documento, se corrige el que corresponda
> en un PR y queda registrado el motivo.
> La sección 5 lista los cambios que este contrato exigió en `@realpolitik/shared` y en la base de datos; todos están hechos.

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

| `code`              | Estado HTTP | Cuándo                                                                                         | `details`                                                                                                                          |
| ------------------- | ----------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR`  | 400         | Falta un dato, un dato tiene mal formato, un parámetro no es válido o el JSON está mal formado | Lista de `{ campo, mensaje }`. `campo` usa notación de puntos (`periodicidad.diaLimite`). Con JSON mal formado, `campo` es `body`  |
| `NOT_FOUND`         | 404         | El cliente o el contacto no existe, o la ruta no existe                                        | No lleva                                                                                                                           |
| `CONFLICT`          | 409         | El pedido choca con datos existentes                                                           | Objeto con `motivo` y el registro existente: `clienteExistente` para `CUIT_DUPLICADO` o `contactoExistente` para `EMAIL_DUPLICADO` |
| `PAYLOAD_TOO_LARGE` | 413         | El cuerpo de la solicitud supera los 100 KB                                                    | No lleva                                                                                                                           |
| `INTERNAL_ERROR`    | 500         | Error inesperado                                                                               | No lleva. Nunca expone detalles internos                                                                                           |

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
  "periodicidad": { "tipo": "MENSUAL", "diaLimite": 10, "mesInicioCiclo": null },
  "estado": "ACTIVO",
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
- **Estado:** `ACTIVO`, `INACTIVO` o `SUSPENDIDO`. En este sprint ningún endpoint asigna `SUSPENDIDO`; queda reservado (por ejemplo, para clientes que pausan la publicidad en verano).
- El resto de los campos (`ivaCondicion`, `telefono`, `emailsAdicionales`) se validan según el schema.

### Resumen

| Historia | Método y ruta                | Qué hace                        | Pedido (shared)                 | Respuesta (shared)       |
| -------- | ---------------------------- | ------------------------------- | ------------------------------- | ------------------------ |
| HU1.1    | `POST /clientes`             | Registra un cliente             | `CreateClienteSchema`           | `ClienteSchema`          |
| HU1.6    | `GET /clientes`              | Lista y busca clientes          | `ListarClientesQuerySchema`     | Lista de `ClienteSchema` |
| HU1.7    | `PATCH /clientes/:id`        | Modifica datos de un cliente    | `UpdateClienteSchema`           | `ClienteSchema`          |
| HU1.8    | `PATCH /clientes/:id/estado` | Desactiva o reactiva un cliente | `ActualizarEstadoClienteSchema` | `ClienteSchema`          |

No existe `GET /clientes/:id`: el listado (`GET /clientes`) devuelve cada cliente completo, y la edición y los contactos trabajan con ese dato. Si una pantalla necesita traer un solo cliente por su id, se agrega entonces.

### `POST /clientes` (HU1.1, HU1.2, HU1.4, HU1.5)

- **Pedido:** los campos del cliente, sin `id`, `estado`, `creadoEn` ni `actualizadoEn`. La periodicidad es opcional al crear: si no se envía, el cliente queda sin periodicidad (`"periodicidad": null` en la respuesta). En el alta no se acepta `"periodicidad": null`; para no configurarla se omite la clave. `canalEntrega` toma `CORREO` por defecto. Si se envía `PORTAL_WEB` es obligatoria la `portalUrl`; si se envía `WHATSAPP` es obligatorio `whatsappNumero`.
- **Respuesta 201:** el cliente creado, con `estado` `ACTIVO`.
- **Errores:**
  - `400 VALIDATION_ERROR`: falta la razón social, la denominación (o supera los 60 caracteres), el CUIT, el sector, el email de rendición o la condición de IVA; CUIT con dígito verificador incorrecto; subtipo ausente en un cliente público; día límite fuera de 1 a 28 o no entero; periodicidad bimestral sin mes de inicio, o con mes fuera de 1 a 12; mes de inicio distinto de `null` en una periodicidad mensual o por campaña; canal `PORTAL_WEB` sin `portalUrl` válida; canal `WHATSAPP` sin `whatsappNumero` válido; canal `CORREO` sin emails de contacto; un texto que supera el largo de su columna (razón social, denominación, emails, teléfono, `portalUrl`) o que tiene caracteres de control; `portalUrl` con un protocolo distinto de `http`/`https` o con usuario y contraseña; emails adicionales repetidos o iguales al email de rendición.
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

| Parámetro | Obligatorio | Descripción                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `q`       | No          | Texto que se busca dentro de la razón social, la denominación o el CUIT. No distingue mayúsculas. El CUIT se busca con o sin guiones. Hasta 150 caracteres (`MAX_BUSQUEDA_CLIENTES` en shared: el largo de la razón social, el campo más largo donde se busca; el buscador de la pantalla limita lo que se escribe con la misma constante). Se busca tal cual: `%`, `_` y `\` son caracteres comunes, no comodines |
| `estado`  | No          | `ACTIVO` (por defecto), `INACTIVO` o `SUSPENDIDO`                                                                                                                                                                                                                                                                                                                                                                  |
| `sector`  | No          | `PUBLICO` o `PRIVADO`                                                                                                                                                                                                                                                                                                                                                                                              |
| `subtipo` | No          | Un subtipo del sector público                                                                                                                                                                                                                                                                                                                                                                                      |

- **Respuesta 200:** lista de clientes **ordenada alfabéticamente por razón social**. Si no hay resultados, devuelve una lista vacía: no es un error. El mensaje de "no hay resultados" y la invitación a registrar el primer cliente los muestra el front.
- **Estado:** si no se envía `estado`, solo devuelve clientes `ACTIVO`. Para ver los desactivados se pide `estado=INACTIVO` (HU1.8), y se combina con `q`, `sector` y `subtipo`. Por ahora no hay forma de listar activos e inactivos juntos (ver sección 6). El front solo ofrece las vistas de activos e inactivos: `SUSPENDIDO` está reservado.
- **Errores:** `400 VALIDATION_ERROR` si un parámetro tiene un valor no válido, o si `q` supera los 150 caracteres o tiene caracteres de control.

### `PATCH /clientes/:id` (HU1.7, HU1.2, HU1.4, HU1.5)

- **Pedido:** cualquier subconjunto de los campos del cliente, con al menos uno. Solo se modifican los campos enviados. No se envían `id`, `estado`, `creadoEn` ni `actualizadoEn`: si llegan, se ignoran sin error. El estado se cambia solo con `PATCH /clientes/:id/estado`.
- **Periodicidad:**
  - Sin la clave `periodicidad`, se conserva la que tenga el cliente.
  - Con un objeto, se configura o se reemplaza completa (`tipo`, `diaLimite` y `mesInicioCiclo`), con las mismas reglas que en el alta.
  - Con `"periodicidad": null`, se borra: el cliente queda sin periodicidad configurada.
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
  - `400 VALIDATION_ERROR`: pedido sin campos, CUIT inválido, sector y subtipo inconsistentes, canal y datos de entrega inconsistentes, periodicidad inválida, o cualquiera de los datos inválidos del alta (largos, caracteres de control, `portalUrl`, emails repetidos).
  - `404 NOT_FOUND`.
  - `409 CONFLICT`: el CUIT nuevo pertenece **a otro** cliente. Mismo `details` que en `POST`. El CUIT del propio cliente no cuenta como duplicado.
- **Cómo lo usa el front:** envía **solo los campos que la persona modificó** respecto de los datos con los que abrió la edición, con los grupos que la API exige juntos (sector `PUBLICO` con su `subtipo`, el canal nuevo con su dato de entrega, la periodicidad completa o `null`). Así, si otra persona cambió un campo distinto mientras tanto, ese cambio no se pisa. Sin cambios, no envía nada: "Guardar cambios" queda deshabilitado.
- **Valores idénticos:** el contrato no define un "sin cambios" para este endpoint. Un `PATCH` que envía valores iguales a los guardados responde 200 igual y puede actualizar `actualizadoEn`. El front evita mandar un pedido sin cambios, pero la API no lo garantiza. A diferencia de `PATCH /clientes/:id/estado`, que sí responde 200 sin escribir cuando el estado no cambia.
- **Concurrencia:** no hay control de versión. Dos ediciones del **mismo** campo se resuelven por la última que llega (_last write wins_). Ver la sección 6.

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

## 4. Fuera del alcance de este documento

Autenticación y permisos, carga de documentos, requisitos por cliente, rendiciones,
vencimientos y despacho. Se documentan cuando se implementen.

## 5. Cambios que este contrato exige

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

## 6. Criterios de este borrador

| Tema                       | Decisión                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listar activos e inactivos | `GET /clientes` sin `estado` devuelve solo clientes `ACTIVO`. Si el front necesita ver ambos a la vez, se agrega `estado=TODOS`: es un cambio compatible que no rompe lo ya acordado.                                                                                                                                                                               |
| Mensajes de validación     | El front se apoya en `campo` para saber qué falló y muestra el `mensaje` del servidor cuando lo define `shared` o el backend (están en español). Los mensajes por defecto de Zod, en inglés, no se muestran: el front usa un aviso propio. Traducir el resto con un `errorMap` es un ajuste posterior del backend.                                                  |
| Baja del cliente           | `estado` es la única fuente de verdad. La API no expone ni usa `activo`, `isDeleted` ni `deletedAt`. El ajuste del modelo de datos queda en la sección 5.                                                                                                                                                                                                           |
| SUSPENDIDO                 | Existe en `shared` y en la base y se mantiene. Cuando se use, hay que definir en qué listados aparece un cliente suspendido.                                                                                                                                                                                                                                        |
| PATCH sin cambios reales   | `PATCH /clientes/:id` con valores idénticos a los guardados puede actualizar `actualizadoEn`: no hay contrato de "sin cambios" para la edición general (sí lo hay para `PATCH /clientes/:id/estado`). No es bloqueante; si hace falta, comparar contra lo guardado antes de escribir.                                                                               |
| Ediciones concurrentes     | `PATCH /clientes/:id` es _last write wins_ por campo: el front manda solo lo modificado, así dos personas que editan campos distintos no se pisan, pero si editan el mismo campo gana la última. Pendiente: control optimista con `actualizadoEn` como versión (`If-Match` o precondición en el cuerpo, `409`/`412` si cambió) y una UI para resolver el conflicto. |
