# Matriz de permisos

> **Estado:** propuesta técnica (Proposed), junto con [ADR-0006](../adr/0006-autenticacion-y-control-de-acceso.md). Los **roles y su alcance están aprobados**; el catálogo de permisos y su implementación son propuestas. **Implementada en el backend (etapa 3 de HU4.1):** toda ruta de negocio exige sesión y el permiso de esta matriz. Verificado localmente (tests); todavía no desplegado ni validado en Vercel y Railway.
>
> Esta matriz es la fuente de verdad de lo que cada rol puede hacer y, cuando exista la infraestructura de permisos (HU4.3 o HU4.5, la que llegue primero), la base del test que recorre cada ruta con cada rol. Inventario verificado contra `main` en `c53f0b1`: 44 endpoints de negocio más `/health`, que es técnico y queda aparte (desde `6c3b9e8` solo se sumó `PATCH /rendiciones/:id/estado`, HU3.6). Si el código y esta matriz no coinciden, el test de inventario falla y se corrige el que corresponda en el mismo PR.

## Roles (aprobados)

| Rol              | Alcance                                                                                                                                                                      | No puede                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sin sesión       | Iniciar sesión y el healthcheck                                                                                                                                              | Todo lo demás (401)                                                                |
| `CONSULTA`       | Lectura completa: clientes, contactos, observaciones internas, requisitos, tipos de documento, rendiciones, montos, órdenes de compra y documentos, **incluida su descarga** | Crear, editar, eliminar, anular o ejecutar cualquier operación que modifique datos |
| `ADMINISTRATIVO` | Lo de `CONSULTA` más todas las operaciones sobre clientes, requisitos, rendiciones y documentos                                                                              | Administrar usuarios                                                               |
| `ADMINISTRADOR`  | Lo de `ADMINISTRATIVO` más la administración de usuarios                                                                                                                     | —                                                                                  |

- Los permisos se componen: `CONSULTA` ⊂ `ADMINISTRATIVO` ⊂ `ADMINISTRADOR`.
- El rol es independiente del área o categoría de la persona: una categoría como "Contabilidad" no concede permisos.
- No hay permisos por cliente ni por organización.
- **Durante HU4.1** solo `ADMINISTRADOR` y `ADMINISTRATIVO` usan el sistema: `CONSULTA` recibe `403 ROL_NO_HABILITADO` en todo lo que no es `/auth/*` y el script de alta no crea usuarios `CONSULTA`. Se habilita en HU4.3. **Estado:** los permisos de `CONSULTA` de esta matriz ya están implementados y probados; la regla temporal (`bloquearRolesNoHabilitados`, un único middleware global) corta antes, y es lo único que hay que quitar en HU4.3.

## Principios

1. **Denegado por defecto, también en ejecución.** Desde la infraestructura de permisos, una ruta de negocio solo se registra con `crearRouter()` y un `autorizar(PERMISO)` como primer handler: si falta, la aplicación **no arranca** (y el CI falla). Lo público se declara con `crearRouterPublico()` (solo `/health` y `/auth`). Un permiso que no figura para un rol en `PERMISOS_POR_ROL` está denegado (ADR-0006 §5). Antes de eso, desde HU4.1, toda ruta de negocio exige sesión.
2. **El backend decide.** La interfaz oculta acciones, pero eso es experiencia de uso: un pedido directo a la API se autoriza igual.
3. **Orden de los controles** (implementado; el cuerpo JSON se lee después de la regla global de `CONSULTA` y antes del permiso de la ruta, ver ADR-0006 §5): origen (en métodos que escriben) → sesión (401) → contraseña temporal (403) → permiso (403) → lectura del cuerpo → validación (400) → existencia (404) → negocio (409). Un pedido sin permiso no recibe detalles de validación ni sabe si el recurso existe. Un anónimo recibe 401 también en rutas inexistentes.
4. **Ningún `GET` es inocuo por ser `GET`, ningún `POST` es equivalente a otro.** Cada ruta se decide por lo que expone o produce.
5. **`CONSULTA` nunca escribe.** Además del permiso de cada ruta, una regla global le rechaza `POST`, `PUT`, `PATCH` y `DELETE` fuera de `/auth/*`.
6. **Permisos administrativos separados de los operativos.** `usuarios:administrar` es el único permiso administrativo y solo lo tiene `ADMINISTRADOR`.
7. **Sin autorización por objeto.** Una sola organización, usuarios internos: quien tiene el permiso lo tiene sobre todos los clientes. Si algún día accede alguien externo, esto cambia y requiere otro ADR.
8. **La identidad sale de la sesión**, nunca del cuerpo del pedido.

## Catálogo de permisos

Criterio: un permiso propio solo cuando **un rol podría tenerlo y otro no**. Convención de nombres: `:ver` para lecturas, `:editar` u `:operar` para escrituras operativas, `:administrar` solo para la administración de usuarios.

| Permiso                  | Tipo           | Cubre                                                                                                | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| ------------------------ | -------------- | ---------------------------------------------------------------------------------------------------- | ---------- | ---------------- | --------------- |
| `cuenta:propia`          | Cuenta         | Mi sesión, cerrar sesión, cambiar mi contraseña                                                      | Sí         | Sí               | Sí              |
| `clientes:ver`           | Lectura        | Listado y ficha del cliente, contactos y observaciones internas                                      | Sí         | Sí               | Sí              |
| `requisitos:ver`         | Lectura        | Matriz e indicaciones de armado                                                                      | Sí         | Sí               | Sí              |
| `tipos-documento:ver`    | Lectura        | Catálogo                                                                                             | Sí         | Sí               | Sí              |
| `rendiciones:ver`        | Lectura        | Listados, detalle, checklist, historial de estados, órdenes de compra y montos                       | Sí         | Sí               | Sí              |
| `documentos:ver`         | Lectura        | Repositorio, detalle con aplicaciones, historial de un ítem y **descarga** del contenido             | Sí         | Sí               | Sí              |
| `clientes:editar`        | Operativo      | Alta, edición, estado, contactos y observaciones                                                     | No         | Sí               | Sí              |
| `requisitos:editar`      | Operativo      | Matriz, carga masiva e indicaciones                                                                  | No         | Sí               | Sí              |
| `tipos-documento:editar` | Operativo      | Alta, edición y estado de tipos                                                                      | No         | Sí               | Sí              |
| `rendiciones:operar`     | Operativo      | Abrir, sugerencia de OC, editar OC, checklist, canal, anular, preparar envío, cambiar estado, cobros | No         | Sí               | Sí              |
| `documentos:operar`      | Operativo      | Cargar, candidatos, aplicar, reemplazar                                                              | No         | Sí               | Sí              |
| `usuarios:administrar`   | Administrativo | Listar, crear, cambiar rol, desactivar, reactivar y restablecer contraseña de **otras** personas     | No         | No               | Sí              |

El frontend tiene un espejo de este catálogo (`apps/frontend/src/modules/auth/permisos.ts`) solo para decidir qué mostrar; un test lo compara con esta tabla. Quien autoriza es siempre la API.

> **Cambio de la consolidación previa a HU4.1: de 16 a 12 permisos.** `contactos:ver`, `observaciones:ver`, `rendiciones:ver-montos` y `documentos:descargar` existían solo porque estaba pendiente si `CONSULTA` vería esos datos. Ahora los ven los tres roles, así que, por el criterio de arriba, se fusionan con la lectura de su módulo. `tipos-documento:administrar` pasa a `tipos-documento:editar` para que "administrar" quede reservado a la administración de usuarios. Si un rol futuro necesitara separar alguna de esas lecturas, se vuelve a crear el permiso (un cambio de código, matriz y test).

**Leyenda:** **Sí** = permitido · **No** = denegado (403) · **401** = sin sesión.

## Endpoints técnicos, sesiones y credenciales

| Método y ruta                             | Operación                                                                                                                                  | Permiso                         | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` | Historia      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | ---------- | ---------- | ---------------- | --------------- | ------------- |
| `GET /health`                             | Healthcheck (sin datos)                                                                                                                    | Público                         | Sí         | Sí         | Sí               | Sí              | Implementada  |
| `POST /auth/login`                        | Iniciar sesión                                                                                                                             | Público, con `Origin` y límites | Sí         | Sí         | Sí               | Sí              | HU4.1         |
| `POST /auth/logout`                       | Cerrar sesión (idempotente)                                                                                                                | Público, con `Origin`           | Sí         | Sí         | Sí               | Sí              | HU4.1         |
| `GET /auth/sesion`                        | Mi usuario, rol y permisos                                                                                                                 | `cuenta:propia`                 | 401        | Sí         | Sí               | Sí              | HU4.1         |
| `PUT /auth/password`                      | Cambiar mi contraseña (obligatorio en HU4.1, voluntario en HU4.2); revoca todas las sesiones, también la actual (HU4.2: pendiente si rota) | `cuenta:propia`                 | 401        | Sí         | Sí               | Sí              | HU4.1 / HU4.2 |
| `GET /usuarios`                           | Listar usuarios                                                                                                                            | `usuarios:administrar`          | 401        | No         | No               | Sí              | HU4.5         |
| `POST /usuarios`                          | Crear con contraseña temporal                                                                                                              | `usuarios:administrar`          | 401        | No         | No               | Sí              | HU4.5         |
| `PATCH /usuarios/:id`                     | Cambiar nombre o rol de otra persona (revoca sus sesiones)                                                                                 | `usuarios:administrar`          | 401        | No         | No               | Sí              | HU4.5         |
| `PATCH /usuarios/:id/estado`              | Desactivar / reactivar a otra persona (revoca sus sesiones)                                                                                | `usuarios:administrar`          | 401        | No         | No               | Sí              | HU4.5         |
| `POST /usuarios/:id/restablecer-password` | Contraseña temporal para otra persona (revoca sus sesiones)                                                                                | `usuarios:administrar`          | 401        | No         | No               | Sí              | HU4.5         |

- `CONSULTA` usa `/auth/*` también durante HU4.1 (puede iniciar sesión, cambiar la contraseña temporal y salir), pero recibe `403 ROL_NO_HABILITADO` en las rutas de negocio hasta HU4.3. Las columnas `CONSULTA` de esta matriz describen lo que podrá hacer desde entonces.
- Con una contraseña temporal, solo `/auth/*` responde; todo lo demás es `403 CAMBIO_DE_PASSWORD_REQUERIDO`.
- **Autoprotección** (409, reglas de negocio de HU4.5): siempre queda al menos un `ADMINISTRADOR` activo; nadie cambia su propio rol ni se desactiva a sí mismo (lo hace otro `ADMINISTRADOR`); el restablecimiento de la propia contraseña no pasa por `/usuarios` (se usa el cambio voluntario).
- **Datos que nunca salen de la API:** hash de contraseña, tokens e ids de sesión, contadores de intentos. `/usuarios` devuelve id, nombre, email, rol, estado, `debeCambiarPassword` y último acceso.
- Hasta HU4.5, las altas, bajas, cambios de rol y restablecimientos se hacen con el procedimiento técnico (script), que no crea usuarios `CONSULTA` antes de HU4.3.
- Fuera del alcance actual: ver y cerrar mis otras sesiones (`GET /auth/sesiones`, `DELETE /auth/sesiones/:id`), a evaluar en HU4.2.

## Clientes y contactos

| Método y ruta                                | Operación              | Permiso           | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| -------------------------------------------- | ---------------------- | ----------------- | ---------- | ---------- | ---------------- | --------------- |
| `GET /clientes`                              | Listar y filtrar       | `clientes:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /clientes/:id`                          | Ficha                  | `clientes:ver`    | 401        | Sí         | Sí               | Sí              |
| `POST /clientes`                             | Alta                   | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /clientes/:id`                        | Edición                | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /clientes/:id/estado`                 | Activar / desactivar   | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `GET /clientes/:id/contactos`                | Listar contactos       | `clientes:ver`    | 401        | Sí         | Sí               | Sí              |
| `POST /clientes/:id/contactos`               | Agregar                | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `PUT /clientes/:id/contactos`                | Reemplazar la lista    | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /clientes/:id/contactos/:contactoId`  | Editar                 | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `DELETE /clientes/:id/contactos/:contactoId` | Baja lógica            | `clientes:editar` | 401        | No         | Sí               | Sí              |
| `GET /clientes/:id/observaciones`            | Leer notas internas    | `clientes:ver`    | 401        | Sí         | Sí               | Sí              |
| `PUT /clientes/:id/observaciones`            | Guardar / borrar notas | `clientes:editar` | 401        | No         | Sí               | Sí              |

## Requisitos, carga masiva e indicaciones

| Método y ruta                                  | Operación                         | Permiso             | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| ---------------------------------------------- | --------------------------------- | ------------------- | ---------- | ---------- | ---------------- | --------------- |
| `GET /clientes/:id/requisitos`                 | Matriz del cliente                | `requisitos:ver`    | 401        | Sí         | Sí               | Sí              |
| `POST /clientes/:id/requisitos`                | Agregar requisito                 | `requisitos:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /clientes/:id/requisitos/:requisitoId`  | Editar requisito                  | `requisitos:editar` | 401        | No         | Sí               | Sí              |
| `DELETE /clientes/:id/requisitos/:requisitoId` | Baja lógica                       | `requisitos:editar` | 401        | No         | Sí               | Sí              |
| `POST /requisitos/masivo`                      | Mismo requisito a varios clientes | `requisitos:editar` | 401        | No         | Sí               | Sí              |
| `GET /clientes/:id/indicaciones-armado`        | Leer indicaciones                 | `requisitos:ver`    | 401        | Sí         | Sí               | Sí              |
| `PUT /clientes/:id/indicaciones-armado`        | Guardar indicaciones              | `requisitos:editar` | 401        | No         | Sí               | Sí              |

## Tipos de documento

| Método y ruta                       | Operación            | Permiso                  | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| ----------------------------------- | -------------------- | ------------------------ | ---------- | ---------- | ---------------- | --------------- |
| `GET /tipos-documento`              | Catálogo             | `tipos-documento:ver`    | 401        | Sí         | Sí               | Sí              |
| `POST /tipos-documento`             | Crear                | `tipos-documento:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /tipos-documento/:id`        | Editar               | `tipos-documento:editar` | 401        | No         | Sí               | Sí              |
| `PATCH /tipos-documento/:id/estado` | Activar / desactivar | `tipos-documento:editar` | 401        | No         | Sí               | Sí              |

## Rendiciones, checklist y orden de compra

| Método y ruta                                               | Operación                                     | Permiso              | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| ----------------------------------------------------------- | --------------------------------------------- | -------------------- | ---------- | ---------- | ---------------- | --------------- |
| `GET /rendiciones?anio=&mes=`                               | Pantalla Rendiciones                          | `rendiciones:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /rendiciones/atrasadas`                                | Atrasadas                                     | `rendiciones:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /rendiciones/:id`                                      | Detalle con checklist, historial, OC y montos | `rendiciones:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /clientes/:id/rendiciones`                             | Rendiciones de un cliente                     | `rendiciones:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /clientes/:id/ultima-oc`                               | Sugerencia de OC para el alta                 | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `POST /clientes/:id/rendiciones`                            | Abrir rendición                               | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `PATCH /rendiciones/:id`                                    | Editar OC                                     | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `PATCH /rendiciones/:id/vigencia`                           | Anular (irreversible)                         | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `PATCH /rendiciones/:id/estado`                             | Marcar Completa o volver a En curso (HU3.6)   | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `POST /rendiciones/:id/requisitos/:requisitoId`             | Sumar un requisito nuevo                      | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `PATCH /rendiciones/:id/items/:itemId/canal`                | Corregir el canal de un ítem                  | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `POST /clientes/:id/requisitos/:requisitoId/propagar-canal` | Propagar canal                                | `rendiciones:operar` | 401        | No         | Sí               | Sí              |
| `POST /rendiciones/:id/preparar-envio`                      | Validar ítems para enviar (no modifica)       | `rendiciones:operar` | 401        | No         | Sí               | Sí              |

- `ultima-oc` es un `GET`, pero solo lo usa el formulario de alta: va con el permiso de operar. `CONSULTA` ve las OC y los montos en el detalle y en los listados.
- `preparar-envio` es un `POST` que no escribe, pero es parte de la operación de envío: va con operar.
- La vuelta automática de una `COMPLETA` a `EN_CURSO` (HU3.6) no es una ruta: ocurre dentro de `POST /rendiciones/:id/requisitos/:requisitoId` y queda cubierta por el permiso de esa ruta.

## Repositorio de documentos (HU4.4)

Hoy estas rutas **no se montan en producción** (`DOCUMENTOS_HABILITADOS`). Se habilitan según la política de ADR-0006 (HU4.4).

| Método y ruta                                     | Operación                          | Permiso             | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` |
| ------------------------------------------------- | ---------------------------------- | ------------------- | ---------- | ---------- | ---------------- | --------------- |
| `GET /documentos?anio=&mes=`                      | Repositorio (metadatos)            | `documentos:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /documentos/:id`                             | Documento y dónde está aplicado    | `documentos:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /documentos/:id/archivo`                     | Descargar el contenido             | `documentos:ver`    | 401        | Sí         | Sí               | Sí              |
| `GET /documentos/:id/candidatos`                  | Ítems donde aplicarlo              | `documentos:operar` | 401        | No         | Sí               | Sí              |
| `POST /documentos`                                | Cargar (multipart)                 | `documentos:operar` | 401        | No         | Sí               | Sí              |
| `POST /documentos/:id/aplicaciones`               | Aplicar a ítems                    | `documentos:operar` | 401        | No         | Sí               | Sí              |
| `POST /rendiciones/:id/items/:itemId/reemplazo`   | Reemplazar el documento de un ítem | `documentos:operar` | 401        | No         | Sí               | Sí              |
| `GET /rendiciones/:id/items/:itemId/aplicaciones` | Historial de un ítem               | `documentos:ver`    | 401        | Sí         | Sí               | Sí              |

- **Carga:** sesión, permiso y `Origin` se verifican **antes** de que `multer` lea el archivo (10 MB en memoria).
- **Descarga:** siempre a través del backend, que autoriza antes de leer el almacenamiento; nunca URLs firmadas del proveedor. Respuesta con `Content-Disposition: attachment`, `nosniff` y `Cache-Control: private, no-store` (ya implementado), que el CDN no debe cachear (ADR-0006, Anexo A, prueba T4). Aunque comparte el permiso de lectura, la descarga tiene su propio caso en el test de matriz.
- `candidatos` es un `GET`, pero solo lo usa el asistente de aplicación: va con operar.

## Lecturas y exposición de información

- Ningún rol tiene hoy lecturas restringidas: **no se filtran campos por rol**. Las respuestas de lectura son las mismas para los tres roles.
- Las respuestas de escritura (incluidos los `409` con `clienteExistente`, `rendicionExistente`, etc.) solo llegan a roles operativos, porque solo ellos pueden escribir.
- Si un rol futuro necesitara restringir datos, se filtran en el backend omitiendo las claves (no poniéndolas en `null`, que hoy significa "sin dato cargado"), con tests que verifiquen la ausencia.

## Operaciones futuras de la épica 3 (sin ruta todavía)

| Operación                                                         | Ruta probable                                                                | Permiso              | Sin sesión | `CONSULTA` | `ADMINISTRATIVO` | `ADMINISTRADOR` | Estado                      |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------- | -------------------- | ---------- | ---------- | ---------------- | --------------- | --------------------------- |
| Marcar Enviada (HU3.7)                                            | `PATCH /rendiciones/:id/estado` (existe desde HU3.6; se amplían sus valores) | `rendiciones:operar` | 401        | No         | Sí               | Sí              | Futura (E3)                 |
| Aprobada o Rechazada con motivo (HU3.8)                           | ídem                                                                         | `rendiciones:operar` | 401        | No         | Sí               | Sí              | Futura (E3)                 |
| Corregir una rechazada (HU3.9)                                    | ídem                                                                         | `rendiciones:operar` | 401        | No         | Sí               | Sí              | Futura (E3)                 |
| Facturación o cobro                                               | A definir                                                                    | `rendiciones:operar` | 401        | No         | Sí               | Sí              | Futura, alcance a confirmar |
| Ver quién hizo cada cambio de estado y si fue manual o automático | En el `historial` del detalle                                                | `rendiciones:ver`    | 401        | Sí         | Sí               | Sí              | HU4.6                       |

Una lectura nueva de la épica 3 (resumen, exportación) se agrega a esta matriz con `rendiciones:ver` u otro permiso de lectura; mientras no figure acá, la infraestructura de permisos no la deja servir.

## Decisiones

- **Aprobadas:** los tres roles y su alcance; lectura completa de `CONSULTA`, incluida la descarga; solo `ADMINISTRADOR` administra usuarios; rol independiente del área; sin permisos por cliente u organización.
- **Propuestas técnicas:** el catálogo de 12 permisos y sus nombres; la composición de roles; la infraestructura de denegación por defecto; las reglas de autoprotección.
- **Pendientes que afectan a esta matriz:** ninguna funcional. Las pendientes del ADR (tiempos de sesión, largo de contraseña, proxy) no cambian quién puede hacer qué.

## Cómo se mantiene esta matriz

- **Toda ruta nueva** se registra con `crearRouter()` y `autorizar(PERMISO)`, y lleva su fila acá **en el mismo PR**. Sin permiso, la app no arranca; sin fila, falla el test de inventario.
- **Cambiar un permiso** es cambiar `PERMISOS_POR_ROL` y esta tabla en el mismo PR, con su test.
- **Un permiso nuevo** solo si un rol podría tenerlo y otro no; si no, se usa el del módulo.
- **Un rol nuevo** es un valor nuevo del enum y su columna en esta matriz, con su conjunto de permisos y sus tests.
- **Revisión:** quien revisa el PR verifica que el permiso sea el mínimo necesario.
