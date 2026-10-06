# Contrato de API: clientes y contactos

> **Versión:** 1.0, para revisión del equipo (T0.7).
> **Fuente de verdad de los campos:** los schemas de `@realpolitik/shared`
> (`packages/shared/src/schemas/`). Este documento define los endpoints, parámetros,
> respuestas y errores. Si el código contradice a este documento: mientras no estén hechos los
> cambios de la sección 5, manda el código; después se corrige el que corresponda en un PR y queda registrado el motivo.
> La sección 5 lista los cambios que este contrato exige en `@realpolitik/shared` y en la base de datos.

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

| `code`             | Estado HTTP | Cuándo                                                                                         | `details`                                                                                                                          |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION_ERROR` | 400         | Falta un dato, un dato tiene mal formato, un parámetro no es válido o el JSON está mal formado | Lista de `{ campo, mensaje }`. `campo` usa notación de puntos (`periodicidad.diaLimite`). Con JSON mal formado, `campo` es `body`  |
| `NOT_FOUND`        | 404         | El cliente o el contacto no existe, o la ruta no existe                                        | No lleva                                                                                                                           |
| `CONFLICT`         | 409         | El pedido choca con datos existentes                                                           | Objeto con `motivo` y el registro existente: `clienteExistente` para `CUIT_DUPLICADO` o `contactoExistente` para `EMAIL_DUPLICADO` |
| `INTERNAL_ERROR`   | 500         | Error inesperado                                                                               | No lleva. Nunca expone detalles internos                                                                                           |

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
  "periodicidad": { "tipo": "MENSUAL", "diaLimite": 10, "mesInicioCiclo": null },
  "estado": "ACTIVO",
  "creadoEn": "2026-10-02T15:30:00.000Z",
  "actualizadoEn": "2026-10-02T15:30:00.000Z"
}
```

Reglas de los datos:

- **Denominación (`denominacion`):** obligatoria, hasta 60 caracteres. Es el alias o nombre corto del cliente para identificarlo en pantalla cuando la razón social es muy extensa.
- **Sector y subtipo:** si el sector es `PUBLICO`, el `subtipo` es obligatorio. Si es `PRIVADO`, el campo `subtipo` no se envía ni aparece en la respuesta.
- **Email de rendición (`emailContacto`):** obligatorio, guardado en minúsculas. Es el destinatario principal de las rendiciones.
- **Periodicidad:** `tipo` es `MENSUAL`, `BIMESTRAL` o `POR_CAMPANIA`. `diaLimite` es un entero de 1 a 28. `mesInicioCiclo` (1 a 12) es obligatorio si el tipo es `BIMESTRAL` y debe ser `null` en los demás.
- **Estado:** `ACTIVO`, `INACTIVO` o `SUSPENDIDO`. En este sprint ningún endpoint asigna `SUSPENDIDO`; queda reservado (por ejemplo, para clientes que pausan la publicidad en verano).
- El resto de los campos (`ivaCondicion`, `telefono`, `portalUrl`, `emailsAdicionales`) se validan según el schema.

### Resumen

| Historia | Método y ruta                | Qué hace                        | Pedido (shared)                   | Respuesta (shared)       |
| -------- | ---------------------------- | ------------------------------- | --------------------------------- | ------------------------ |
| HU1.1    | `POST /clientes`             | Registra un cliente             | `CreateClienteSchema`             | `ClienteSchema`          |
| HU1.6    | `GET /clientes`              | Lista y busca clientes          | A crear en shared (ver sección 5) | Lista de `ClienteSchema` |
| HU1.6    | `GET /clientes/:id`          | Devuelve un cliente             | Sin cuerpo                        | `ClienteSchema`          |
| HU1.7    | `PATCH /clientes/:id`        | Modifica datos de un cliente    | `UpdateClienteSchema`             | `ClienteSchema`          |
| HU1.8    | `PATCH /clientes/:id/estado` | Desactiva o reactiva un cliente | A crear en shared (ver sección 5) | `ClienteSchema`          |

### `POST /clientes` (HU1.1, HU1.2, HU1.5)

- **Pedido:** los campos del cliente, sin `id`, `estado`, `creadoEn` ni `actualizadoEn`. La periodicidad es opcional al crear.
- **Respuesta 201:** el cliente creado, con `estado` `ACTIVO`.
- **Errores:**
  - `400 VALIDATION_ERROR`: falta la razón social, la denominación (o supera los 60 caracteres), el CUIT, el sector, el email de rendición o la condición de IVA; CUIT con dígito verificador incorrecto; subtipo ausente en un cliente público; día límite fuera de 1 a 28; periodicidad bimestral sin mes de inicio.
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

| Parámetro | Obligatorio | Descripción                                                                                                                          |
| --------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `q`       | No          | Texto que se busca dentro de la razón social, la denominación o el CUIT. No distingue mayúsculas. El CUIT se busca con o sin guiones |
| `estado`  | No          | `ACTIVO` (por defecto), `INACTIVO` o `SUSPENDIDO`                                                                                    |
| `sector`  | No          | `PUBLICO` o `PRIVADO`                                                                                                                |
| `subtipo` | No          | Un subtipo del sector público                                                                                                        |

- **Respuesta 200:** lista de clientes **ordenada alfabéticamente por razón social**. Si no hay resultados, devuelve una lista vacía: no es un error. El mensaje de "no hay resultados" y la invitación a registrar el primer cliente los muestra el front.
- **Estado:** si no se envía `estado`, solo devuelve clientes `ACTIVO`. Por ahora no hay forma de listar activos e inactivos juntos (ver sección 6).
- **Errores:** `400 VALIDATION_ERROR` si un parámetro tiene un valor no válido.

### `GET /clientes/:id`

- **Respuesta 200:** el cliente, aunque esté `INACTIVO`.
- **Errores:** `400 VALIDATION_ERROR` (el id no es un uuid), `404 NOT_FOUND`.

### `PATCH /clientes/:id` (HU1.7, HU1.2, HU1.5)

- **Pedido:** cualquier subconjunto de los campos del cliente, con al menos uno. Solo se modifican los campos enviados. No se envían `id`, `estado`, `creadoEn` ni `actualizadoEn`: si llegan, se ignoran sin error. El estado se cambia solo con `PATCH /clientes/:id/estado`. Enviar `"periodicidad": null` borra la periodicidad.
- **Cambio de sector:**
  - De `PUBLICO` a `PRIVADO`: el subtipo anterior se descarta.
  - De `PRIVADO` a `PUBLICO`: hay que enviar el `subtipo` en el mismo pedido.
  - Enviar `subtipo` para un cliente privado es un error.
- **Respuesta 200:** el cliente actualizado.
- **Errores:**
  - `400 VALIDATION_ERROR`: pedido sin campos, CUIT inválido, o sector y subtipo inconsistentes.
  - `404 NOT_FOUND`.
  - `409 CONFLICT`: el CUIT nuevo pertenece **a otro** cliente. Mismo `details` que en `POST`. El CUIT del propio cliente no cuenta como duplicado.

### `PATCH /clientes/:id/estado` (HU1.8)

- **Pedido:** `{ "estado": "INACTIVO" }` o `{ "estado": "ACTIVO" }`. Enviar `SUSPENDIDO` devuelve `400 VALIDATION_ERROR` (reservado para un sprint futuro).
- **Respuesta 200:** el cliente con su nuevo estado. Los datos se conservan. Pedir el estado que el cliente ya tiene responde 200 sin cambios.
- **Errores:** `400 VALIDATION_ERROR`, `404 NOT_FOUND`.

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

- `nombre`, `area` y `email` son obligatorios. El `email` debe tener formato válido y se guarda en minúsculas.
- `recibeRendiciones` es `false` por defecto. Los contactos con `true` son los destinatarios de las rendiciones del cliente, además del email de rendición.
- Dentro de un mismo cliente no puede haber dos contactos no eliminados con el mismo email.
- Eliminar un contacto es una baja lógica: deja de figurar en el listado, pero queda registrado.
- Se pueden ver y modificar los contactos de un cliente inactivo.

| Método y ruta                                | Qué hace                                                                               | Código HTTP         | Pedido (shared)                   | Respuesta (shared)                |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------- | --------------------------------- | --------------------------------- |
| `GET /clientes/:id/contactos`                | Lista los contactos del cliente. Primero los que reciben rendiciones, luego por nombre | 200 con la lista    | Sin cuerpo                        | A crear en shared (ver sección 5) |
| `POST /clientes/:id/contactos`               | Agrega un contacto                                                                     | 201 con el contacto | A crear en shared (ver sección 5) | A crear en shared (ver sección 5) |
| `PATCH /clientes/:id/contactos/:contactoId`  | Modifica un contacto o marca si recibe rendiciones. Al menos un campo                  | 200 con el contacto | A crear en shared (ver sección 5) | A crear en shared (ver sección 5) |
| `DELETE /clientes/:id/contactos/:contactoId` | Elimina un contacto                                                                    | 204 sin cuerpo      | Sin cuerpo                        | Sin cuerpo                        |

**Errores:**

- `400 VALIDATION_ERROR`: email con formato inválido, falta un campo obligatorio, ids que no son uuid.
- `404 NOT_FOUND`: el cliente o el contacto no existe, o el contacto no pertenece a ese cliente.
- `409 CONFLICT`: el email ya existe en otro contacto del mismo cliente. `details` trae `motivo: "EMAIL_DUPLICADO"` y el contacto existente (`id` y `nombre`).

## 4. Fuera del alcance de este documento

Autenticación y permisos, carga de documentos, requisitos por cliente, rendiciones,
vencimientos, despacho y canal de entrega (HU1.4). Se documentan cuando se implementen.

## 5. Cambios que este contrato exige

### En `@realpolitik/shared`

1. Agregar `denominacion` (obligatoria, hasta 60 caracteres). Ya existe en la base de datos.
2. Agregar `periodicidad` (`tipo`, `diaLimite`, `mesInicioCiclo`) con las reglas de la sección 2.
3. En la edición, no exigir `sector` ni permitir enviar `estado`.
4. Crear los schemas de contacto: alta, edición y el tipo `Contacto`.
5. Crear el schema de los parámetros de `GET /clientes` (`q`, `estado`, `sector`, `subtipo`).
6. Crear el schema del cuerpo de `PATCH /clientes/:id/estado`.

### En la base de datos

7. Modelo `Contacto` con baja lógica, y un índice único sobre cliente y email entre los contactos no eliminados.
8. En el cliente: columnas para la periodicidad.
9. Quitar `activo` del modelo de Cliente: `estado` es la única fuente de verdad del estado del cliente. `isDeleted` y `deletedAt` no forman parte de este contrato; se definen al ajustar el modelo de datos.
10. Crear el índice único de contactos con SQL a mano en la migración, porque Prisma no soporta índices parciales.

## 6. Criterios de este borrador

| Tema                       | Decisión                                                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Listar activos e inactivos | `GET /clientes` sin `estado` devuelve solo clientes `ACTIVO`. Si el front necesita ver ambos a la vez, se agrega `estado=TODOS`: es un cambio compatible que no rompe lo ya acordado.                        |
| Mensajes de validación     | El front se apoya en `campo` para saber qué falló y muestra sus propios textos. Los mensajes definidos en `shared` están en español. Traducir el resto con un `errorMap` es un ajuste posterior del backend. |
| Baja del cliente           | `estado` es la única fuente de verdad. La API no expone ni usa `activo`, `isDeleted` ni `deletedAt`. El ajuste del modelo de datos queda en la sección 5.                                                    |
| SUSPENDIDO                 | Existe en `shared` y en la base y se mantiene. Cuando se use, hay que definir en qué listados aparece un cliente suspendido.                                                                                 |
