# ADR-0006 — Autenticación y control de acceso

## Estado

Proposed

Diseño de la épica 4 (Sprint 3), consolidado antes de implementar HU4.1. Del código, están implementados el transporte de mismo origen, sin activar (§7 y [deployment.md](../deployment.md#proxy-de-mismo-origen-preparado-sin-activar)), el modelo de usuarios y sesiones con el hash de contraseñas (§6) y los endpoints `POST /auth/login`, `GET /auth/sesion`, `POST /auth/logout` y `PUT /auth/password` con la cookie, la validación de `Origin` y la protección del login (Backend 2C y cierre de la etapa 2, §1, §3 y §4). **Desde la etapa 3, toda la API de negocio exige sesión y el permiso de la matriz** (§5, implementado y verificado localmente; sin desplegar): lo demás que este ADR describe como "se agrega" o "cambia" es la propuesta a implementar. Se mantiene `Proposed` porque quedan decisiones arquitectónicas sin validar en un entorno real: el proxy de mismo origen en Vercel (Anexo A), la carga de la biblioteca de contraseñas en Railway y los tiempos de sesión. La matriz de permisos vive en [`docs/security/matriz-permisos.md`](../security/matriz-permisos.md); la experiencia de usuario, en el [borrador UX](../product/borrador-ux-usuarios-y-acceso.md).

## Fecha

2026-11-09 (bloques 0A, 0B y 0C; consolidación previa a HU4.1). Ver "Registro de cambios".

## Estado de las decisiones

Para no confundir lo aprobado con lo propuesto, cada decisión de este ADR cae en uno de estos grupos.

**Decisiones funcionales aprobadas**

- La épica 4 se divide en HU4.1 (inicio de sesión y primer acceso), HU4.2 (gestión de sesión y contraseña), HU4.3 (acceso de Consulta en modo lectura), HU4.4 (protección y acceso a documentos), HU4.5 (administración de usuarios) y HU4.6 (registro del responsable de los cambios de estado de rendiciones).
- Tres roles: `ADMINISTRADOR`, `ADMINISTRATIVO` y `CONSULTA` (ver §5).
- `CONSULTA` lee todo, incluidos contactos, observaciones internas, montos, órdenes de compra y documentos con su descarga, y no modifica nada.
- Solo `ADMINISTRADOR` administra usuarios.
- El rol es independiente del área o categoría de la persona: una categoría como "Contabilidad" no concede permisos.
- Sin permisos por cliente u organización.
- Sin registro público de usuarios. El primer `ADMINISTRADOR` se crea con un procedimiento técnico seguro.
- La autorización se aplica en el backend; ocultar botones en la interfaz no es seguridad.
- No se cargan datos ni documentos reales en producción hasta que los controles de acceso estén implementados y verificados.

**Propuestas técnicas (base aprobada como dirección, sujetas a validación)**

- Sesiones opacas y revocables en PostgreSQL, cookie `HttpOnly` y `Secure`, denegación por defecto, protección CSRF (§1, §4).
- Argon2id con la biblioteca `argon2` (§2).
- Protección del login con demoras temporales y sin bloqueos permanentes (§3).
- Proxy de mismo origen Vercel → Railway, en los **proyectos existentes** (decidido el 2026-11-11: no se crean proyectos ni servicios descartables). Transporte implementado y sin activar; la verificación en Vercel se hace al activar (Anexo A).
- Largo mínimo de contraseña de 8 caracteres, decidido por el usuario el 2026-11-12 (§2; ver la discrepancia documentada).

**Pendientes**: ver "Decisiones pendientes".

## Contexto

### El problema

La API no identifica a nadie. Cualquiera que conozca la URL del backend puede leer y modificar clientes, contactos, rendiciones y montos de órdenes de compra, con un `curl`. CORS no lo impide: solo limita qué páginas del navegador leen las respuestas ([baseline](../security/security-baseline.md), [ADR-0004 §11](0004-reutilizacion-y-almacenamiento-documentos.md)). Por eso:

- en producción los documentos están **deshabilitados** (`DOCUMENTOS_HABILITADOS`, no se montan las rutas);
- no se pueden cargar datos ni archivos reales de clientes en un entorno accesible públicamente;
- no se puede saber quién hizo un cambio (por ejemplo, quién marcó una rendición como enviada, épica 3).

### Estado real del sistema (`main` en `c53f0b1`, con los PR #44 a #46 integrados)

| Área                                                                                                                                         | Situación actual                                                                                                                                                                                                                                                                                       | Qué implica                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `createApp` ([app.ts](../../apps/backend/src/app.ts))                                                                                        | Monta `/health`, `/clientes`, `/requisitos`, `/rendiciones`, `/tipos-documento` y, solo si recibe almacenamiento, `/documentos` y el reemplazo/historial de ítems. CORS con lista explícita, sin `credentials`. `json()` global de 100 KB. Sin cookies ni headers de seguridad                         | Único punto de composición: ahí se agregan la sesión obligatoria y los controles globales                                        |
| Rutas                                                                                                                                        | 44 endpoints de negocio más `/health`, en 8 routers (5 archivos `*.routes.ts` y `routes/health.ts`). Cada ruta usa `validate(...)` antes del controlador. Los routers solo usan `get`, `post`, `put`, `patch` y `delete`. Desde `6c3b9e8` solo se sumó `PATCH /rendiciones/:id/estado` (HU3.6, PR #46) | La autorización va **antes** de `validate` y antes de leer cualquier cuerpo grande                                               |
| Carga de documentos ([recibirArchivo.ts](../../apps/backend/src/modules/documentos/recibirArchivo.ts))                                       | `multer` con `memoryStorage`: el archivo (hasta 10 MB) entra entero en memoria                                                                                                                                                                                                                         | La sesión y el permiso se verifican **antes** de `recibirArchivo`                                                                |
| Errores ([app-error.ts](../../apps/backend/src/errors/app-error.ts), [error-handler.ts](../../apps/backend/src/middleware/error-handler.ts)) | No hay 401, 403 ni 429. Un fallo de conexión con PostgreSQL termina como `500 INTERNAL_ERROR`                                                                                                                                                                                                          | Se agregan `UNAUTHENTICATED`, `FORBIDDEN`, `TOO_MANY_REQUESTS`, y la base caída pasa a `503 SERVICE_UNAVAILABLE` (que ya existe) |
| Tests del backend                                                                                                                            | ~42 archivos crean la app con `createApp({ corsOrigins })`; los de rutas mockean Prisma                                                                                                                                                                                                                | Hace falta un punto de inyección de la sesión (como el almacenamiento de documentos)                                             |
| `registrarCambioDeEstado` (rendiciones.service.ts)                                                                                           | Punto único de cambio de estado, sin actor. Desde HU3.6 delega en `registrarCambioDeEstadoEnTx`, que usan dos caminos: el cambio manual (`PATCH /rendiciones/:id/estado`) y la vuelta automática a En curso al sumar un requisito                                                                      | Donde se registrará el responsable (HU4.6), distinguiendo quién actuó de qué operación produjo el cambio                         |
| Frontend: cliente HTTP ([http.ts](../../apps/frontend/src/lib/http.ts), [env.ts](../../apps/frontend/src/lib/env.ts))                        | `fetch` a `VITE_API_URL` absoluta; `buildUrl` usa `new URL(base)`                                                                                                                                                                                                                                      | Con proxy de mismo origen, la base pasa a ser relativa (`/api`)                                                                  |
| Frontend: routing y estado                                                                                                                   | Todo cuelga de `AppLayout`; TanStack Query sin manejo global de 401; preferencias de columnas en `localStorage` (no son datos de clientes). La ficha completa del cliente y los contactos solo se ven en paneles de **edición**                                                                        | `/login` fuera del layout, guarda, limpieza de caché al cerrar sesión. `CONSULTA` necesita vistas de solo lectura (HU4.3)        |
| Despliegue ([deployment.md](../deployment.md), [vercel.json](../../vercel.json))                                                             | Frontend en `*.vercel.app`, backend en `*.up.railway.app`: **sitios distintos** (ambos en la Public Suffix List). `vercel.json` solo tiene el rewrite de la SPA. Imagen de desarrollo `node:24-bookworm-slim` (glibc)                                                                                  | Una cookie del backend sería de terceros: condiciona toda la arquitectura                                                        |
| Node                                                                                                                                         | El proyecto exige Node ≥ 24 (`engines`, `.nvmrc`, CI, Docker). Al menos una máquina de desarrollo usa Node 22.23.4, donde `crypto.argon2` **no existe** (verificado)                                                                                                                                   | Refuerza la elección de una biblioteca para Argon2id (§2). Conviene alinear Node antes de implementar                            |
| Seed                                                                                                                                         | Se niega a correr en producción o con host no local                                                                                                                                                                                                                                                    | No sirve para crear el primer usuario: hace falta un script propio                                                               |

## Alternativas evaluadas

### Arquitectura de autenticación

| Criterio                         | A. Sesiones opacas en PostgreSQL | B. JWT de acceso + refresh (como MAPS)                    | C. Proveedor externo                                                                                         |
| -------------------------------- | -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Revocación inmediata             | Sí                               | Solo el refresh; el access dura hasta vencer              | Depende del proveedor                                                                                        |
| Expiración por inactividad       | Nativa (`ultimaActividadEn`)     | Hay que construirla                                       | Configurable, con límites                                                                                    |
| Token legible por XSS            | No (`HttpOnly`)                  | Access token en memoria o `localStorage`                  | `localStorage` por defecto (Supabase)                                                                        |
| Complejidad backend / frontend   | Baja / baja                      | Media / alta (refresh, carreras entre pedidos y pestañas) | Media / media                                                                                                |
| Secretos nuevos                  | Ninguno                          | 1 o 2 de firma                                            | Claves del proveedor                                                                                         |
| Costo y disponibilidad           | Ninguno                          | Ninguno                                                   | Supabase Free **se pausa** tras una semana de poca actividad (nadie podría entrar); otros cobran por usuario |
| Entre sitios distintos sin proxy | No (cookie de terceros)          | No (refresh en cookie)                                    | Mismo problema si usa cookies                                                                                |

- **B (MAPS)**: MAPS guarda igual sus refresh en `SesionToken`, o sea, sesiones en base **más** JWT. Las ventajas del JWT (verificar sin base, varios servicios) no aplican a un solo backend con pocos usuarios.
- **C**: su ventaja real (recuperación por correo, MFA, SSO) no compensa hoy: no hay proveedor de correo y los usuarios son pocos e internos. Contradice además [conventions.md](../development/conventions.md) y el criterio de ADR-0004 de no acoplarse al SDK de Supabase.

### Comunicación frontend ↔ backend

1. **Cookies entre sitios** (`SameSite=None`): Safari las bloquea por defecto, los modos privados también. **Descartada.**
2. **Token en `localStorage` + `Authorization`**: cualquier XSS lo roba. **Descartada**; contingencia si 3 y 4 fallan.
3. **Proxy de mismo origen** (elegida; transporte implementado, **sin activar ni verificar en Vercel**): Vercel reescribe `/api/*` hacia Railway; en desarrollo, el proxy de Vite. Cookie de primera parte, `SameSite=Strict`, sin CORS. No se asume que Vercel soporte todo. Según su documentación (consultada el 2026-11-11):
   - espera hasta 120 s a que el backend **empiece** a responder;
   - no documenta un límite de tamaño de cuerpo para rewrites externos (el de 4,5 MB es de las Functions, que no se usan);
   - en los proyectos creados desde el 6 de abril de 2026 respeta las cabeceras de caché del origen: se desactiva con `x-vercel-enable-rewrite-caching: 0` en `vercel.json`, ya agregado.

   Hay que comprobar cookies, `Origin`, cargas de 10 MB, descargas, caché y la IP que llega a Railway (Anexo A).

4. **Dominio propio compartido** (`app.<dominio>` / `api.<dominio>`): mismo sitio, sin proxy intermedio. Requiere un dominio del cliente. Plan B si 3 no pasa la validación.

El backend es **el mismo** para 3 y 4; solo cambia la configuración. La seguridad no depende del proxy: Railway sigue accesible directamente y exige sesión igual.

## Decisión recomendada

**Sesiones opacas y revocables en PostgreSQL, con cookie `HttpOnly` de primera parte servida por un proxy de mismo origen (`/api`, pendiente de validación); contraseñas con la biblioteca mantenida `argon2` (argon2id, formato PHC), previa verificación de carga en cada entorno; protección del login con demoras temporales por cuenta, límites por origen y de concurrencia, sin bloqueos permanentes; y autorización por tres roles y permisos declarados ruta por ruta, con sesión obligatoria y denegación por defecto verificada también en tiempo de ejecución.**

## Arquitectura propuesta

### 1. Sesiones

#### Identificadores

- Token de sesión: `crypto.randomBytes(32)` (256 bits de un CSPRNG), codificado en base64url. Nunca se deriva de datos del usuario ni de la hora.
- En la base se guarda **solo** `SHA-256(token)` en hexadecimal, con índice único. Un hash rápido alcanza porque el token tiene 256 bits de entropía (no es una contraseña). La búsqueda es por igualdad del hash: no hay comparación de secretos en la aplicación.
- El token en claro solo existe en la cookie y, durante el pedido, en memoria. **Nunca** se registra en logs, ni se devuelve en un cuerpo JSON, ni va en una URL.

#### Duración (pendiente de confirmación)

- **Propuesta funcional actual**: 24 horas de inactividad y 7 días de duración máxima. **No está confirmada** (P2).
- Los valores son configurables: confirmarlos no cambia el diseño.
- **Implementado (Backend 2A), sin persistencia:** `modules/auth/vigenciaDeSesion.ts`, con funciones puras que reciben `ahora`.
  - `DURACIONES_DE_SESION` es la única fuente de las duraciones, con los valores propuestos. Pasarlas a variables de entorno queda para el servicio de sesiones.
  - `fechasDeSesionNueva` fija `createdAt`, `ultimaActividadEn` y `expiraEn` con el mismo `ahora`, para cumplir `ck_sesion_fechas_coherentes`.
  - `evaluarSesion` decide, en este orden: revocada; vencida por duración (con el `expiraEn` guardado, así cambiar la duración no altera las sesiones existentes); vencida por inactividad (con la duración vigente); vigente. En el instante exacto del límite, la sesión ya venció.
  - `debeRegistrarActividad` usa la misma comparación estricta que la consulta (`ultimaActividadEn < ahora − 60 s`).
  - Las fechas son instantes UTC: 24 h son 24 horas reales, también cruzando un cambio de horario (probado en cuatro zonas).
  - Los campos del modelo `Sesion` alcanzan: no hizo falta cambiar la migración.
- Consecuencia a decidir junto con P2: con 24 h / 7 días, una cookie de sesión del navegador (sin `Max-Age`) se borraría al cerrar el navegador y la persona tendría que volver a entrar antes de vencer la sesión. Si se quiere que la sesión sobreviva al cierre del navegador, la cookie lleva `Max-Age` igual al tiempo restante hasta `expiraEn` (P16).
- Compensación: una inactividad de 24 h protege menos una computadora compartida u olvidada que una corta. El cierre de sesión explícito pasa a ser más importante (entra en HU4.1).

#### Ciclo de vida

| Evento                                                                                  | Qué pasa                                                                                                                                                                                                                     |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login correcto                                                                          | Se crea una sesión **nueva** (nunca se reutiliza un token recibido). Si el pedido traía una cookie de sesión válida, esa sesión se revoca. Se borran de forma oportunista las sesiones vencidas o revocadas de más de 7 días |
| Cada pedido autenticado                                                                 | Se busca la sesión vigente (hash + no revocada + no vencida por inactividad ni por tiempo absoluto) junto con el usuario activo, en **una** consulta                                                                         |
| Actividad                                                                               | `UPDATE … SET ultimaActividadEn = ahora WHERE id = :id AND revocadaEn IS NULL AND ultimaActividadEn < ahora − 60 s`. Condicional e idempotente: como mucho una escritura por minuto por sesión, sin transacción              |
| Logout                                                                                  | `UPDATE … SET revocadaEn = ahora WHERE tokenHash = :hash AND revocadaEn IS NULL` y se borra la cookie con los mismos atributos con que se creó. Idempotente: 204 aunque la sesión ya no exista                               |
| Cambio de la propia contraseña                                                          | En una transacción: nuevo hash, `debeCambiarPassword = false` y revocar **todas** las sesiones del usuario, **incluida la del pedido**; se borra la cookie y hay que volver a entrar (etapa 2, ver "Cambio de contraseña")   |
| Restablecimiento (por un `ADMINISTRADOR` en HU4.5; antes, por el procedimiento técnico) | Contraseña temporal generada, `debeCambiarPassword`, revocar todas sus sesiones                                                                                                                                              |
| Desactivación                                                                           | En una transacción: `activo = false` y revocar todas sus sesiones. Además, cada pedido verifica `usuario.activo` (defensa en profundidad)                                                                                    |
| Cambio de rol                                                                           | Revoca las sesiones del usuario: vuelve a entrar con el rol nuevo                                                                                                                                                            |

- **Límite de sesiones por usuario**: 10 vigentes (**propuesta técnica, sin aprobación funcional registrada**). Al crear la undécima se revoca la de actividad más vieja (`ultimaActividadEn`, después `createdAt`): así se cierra antes un dispositivo abandonado que uno en uso. Las revocadas y las vencidas no cuentan.
- **Reloj**: el de la aplicación, inyectado (`ahora()`), para testear los bordes como `esAtrasada` (ADR-0005). Hay una sola instancia.

#### Concurrencia

- **Pedidos en paralelo con la misma sesión**: cada uno lee la sesión; la escritura de actividad es condicional, así que a lo sumo uno escribe. No hay condición de carrera que extienda o corte la sesión.
- **Logout mientras hay pedidos en vuelo**: un pedido que ya pasó la verificación termina; los siguientes reciben 401.
- **Cambio de contraseña frente a creaciones de sesión**: ver "Cambio de contraseña" (§1). Ninguna sesión nacida de la contraseña anterior sobrevive al cambio.
- **"Siempre queda un `ADMINISTRADOR` activo"**: desactivar a un `ADMINISTRADOR` o cambiarle el rol corre en una transacción serializable, para que dos administradores no se quiten el rol o se desactiven mutuamente a la vez. `enTransaccionSerializable` existe, pero hoy como función propia de `rendiciones` y de `requisitos`: HU4.5 decide si la lleva a `lib/`.
- **Implementado (Backend 2B), en `modules/auth/sesiones.service.ts`, comprobado contra PostgreSQL:**
  - **Creación simultánea y límite:** crear una sesión bloquea la fila del usuario (`SELECT … FOR UPDATE`) en una transacción READ COMMITTED. Las creaciones del mismo usuario quedan en fila y cada una ve las anteriores ya confirmadas. Se descartó `Serializable` con reintentos: con varios inicios de sesión simultáneos del mismo usuario aborta transacciones, y los 3 reintentos del proyecto pueden agotarse (un 500 sin motivo). Con el bloqueo no hay reintentos, y solo esperan los pedidos de ese usuario.
  - **Prueba de que el bloqueo es lo que funciona:** sin el `FOR UPDATE`, fallan las tres pruebas de concurrencia (se supera el límite y queda utilizable una sesión creada durante la desactivación). Con el bloqueo pasan: 20 creaciones simultáneas desde cero dejan exactamente 10 vigentes, sin errores.
  - **Desactivación mientras se crea una sesión:** la desactivación (HU4.5) actualiza primero la fila del usuario y después revoca, en una transacción. La creación espera ese bloqueo y después encuentra la cuenta inactiva.
  - **Actividad y revocación:** una sola escritura condicional cada una. PostgreSQL reevalúa el `WHERE` sobre la fila ya actualizada, así: la actividad escribe como mucho una vez por minuto, nunca retrocede y no revive una sesión revocada o vencida; revocar dos veces escribe una sola.
  - **Revocación con el reloj atrasado:** `revocadaEn` usa `GREATEST(ahora, createdAt)`, así un reloj que retrocede no viola `ck_sesion_fechas_coherentes`.
  - **Validación seguida de revocación:** un pedido que ya validó su sesión termina, y los siguientes la encuentran revocada.

#### Cambio de contraseña (implementado en el cierre de la etapa 2)

`PUT /auth/password` con `{ actual, nueva }` (`CambiarContrasenaSchema` en shared). Resuelve el cambio obligatorio del primer acceso (`debeCambiarPassword = true`) y sirve también sin esa marca, para que HU4.2 lo reutilice.

**Decisión de este bloque:** el cambio revoca **todas** las sesiones, incluida la del pedido, borra la cookie y exige iniciar sesión otra vez con la contraseña nueva. Reemplaza la rotación que proponía este ADR (revocar todo y crear una sesión nueva para el pedido actual). Para el cambio voluntario de HU4.2, el borrador UX propone que la sesión actual siga: **queda pendiente** decidir si HU4.2 rota o también exige volver a entrar.

| Orden | Paso                                                                                                   | Si falla                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1     | `Origin` exacto (como toda escritura en `/auth`)                                                       | `403 ORIGEN_NO_PERMITIDO`                                                    |
| 2     | Sesión válida (`requerirSesion`, la misma que usa `GET /auth/sesion`)                                  | `401 SESION_REQUERIDA` o `SESION_VENCIDA`, borra la cookie; base caída `503` |
| 3     | Cuerpo: `actual` no vacía (≤ 128); `nueva` con formato y largo; `nueva ≠ actual` (comparadas tras NFC) | `400 VALIDATION_ERROR` en el campo                                           |
| 4     | Política completa de la nueva: lista de bloqueo, contexto (email y nombre), repetición trivial         | `400` en `nueva`, sin consumir la protección ni argon2                       |
| 5     | Reserva en la protección del login, con el email de la cuenta                                          | `429` (`DEMASIADOS_INTENTOS` o `INTENTO_EN_CURSO`)                           |
| 6     | Verificar `actual` y calcular el hash de `nueva`, ambos por `limiteDeHash`, fuera de la transacción    | `400` en `actual` (cuenta como fallo); capacidad agotada `503`               |
| 7     | Transacción (abajo)                                                                                    | Nada se confirma; `401` si la sesión dejó de valer, `503` si la base falla   |
| 8     | Borrar la cookie y responder `204` sin cuerpo                                                          | —                                                                            |

**La transacción** (READ COMMITTED, como `crearSesion`):

1. `SELECT … FROM "Usuario" … FOR UPDATE`: el mismo bloqueo que toma `crearSesion`.
2. La cuenta sigue activa, la sesión del pedido sigue vigente (otro cambio o un logout pudo revocarla mientras se calculaba argon2) y el hash sigue siendo el que se verificó.
3. Guarda el hash nuevo, `debeCambiarPassword = false` y `passwordActualizadaEn`.
4. Revoca todas las sesiones del usuario (`revocarSesionesDeUsuario` con la transacción).

**Garantías frente a sesiones concurrentes**, todas comprobadas con PostgreSQL real:

- **Un login que confirmó antes que el cambio:** la revocación del paso 4 alcanza su sesión.
- **Un login que verificó la contraseña vieja y espera el bloqueo del usuario:** este era el hueco. Sin más, creaba una sesión válida después del cambio. Ahora `crearSesion` recibe el hash que se verificó y, bajo el bloqueo, lo compara con el guardado; si cambió, no crea nada (`CredencialesDesactualizadasError`, `401 CREDENCIALES_INVALIDAS`).
  - La prueba retiene una fila para dejar el cambio en medio de su transacción y lanza el login desde otra instancia. Con la comparación desactivada, el login recibe `200` y una sesión utilizable; con la comparación, `401`, y no queda ninguna sesión vigente.
- **Dos cambios simultáneos desde dos sesiones de la misma cuenta:** uno confirma; el otro encuentra su sesión revocada (`401`) o, en la misma instancia, recibe `429 INTENTO_EN_CURSO`. El hash final corresponde a exactamente una de las dos contraseñas nuevas.
- **La base falla en medio** (se terminó la conexión con `pg_terminate_backend` después de actualizar el usuario y antes de revocar): `503`, el hash, la marca y las sesiones quedan como estaban y la cookie no se borra; reintentar funciona.
- **Límite conocido:** si la conexión se corta justo durante el `COMMIT`, el cliente recibe `503` aunque PostgreSQL pudo confirmar. Es fail-closed: las sesiones quedaron revocadas y el siguiente pedido recibe `401`. Nunca se informa un cambio que no ocurrió.

**Primer acceso:** una cuenta con `debeCambiarPassword = true` inicia sesión (`200`, con la marca en el cuerpo de login y de `/auth/sesion`), consulta su sesión, cambia la contraseña y cierra sesión. La marca solo la apaga este cambio y nunca llega del cliente. Fuera de `/auth/*` recibe `403 CAMBIO_DE_PASSWORD_REQUERIDO` (`exigirPasswordDefinitiva`, implementado en la etapa 3), también en rutas inexistentes.

#### Cuando PostgreSQL no responde

- **Se falla cerrado**: si la sesión no se puede verificar, el pedido **no** pasa. No hay caché de sesiones en memoria (rompería la revocación inmediata).
- La respuesta es `503 SERVICE_UNAVAILABLE`, **no** 401: un 401 haría que el frontend borre la caché y mande a todos a iniciar sesión por un problema que no es de la sesión.
- Se reconocen como "base no disponible" los errores de conexión y de pool de Prisma (inicialización, `P1001`, `P1002`, `P1017`, `P2024`) y, desde el cierre de la etapa 2, `P2010` con un SQLSTATE de conexión perdida (clase `08`, o `57P01` a `57P03`). Es lo que reciben las consultas raw (`FOR UPDATE`, revocaciones) cuando PostgreSQL termina la conexión a mitad de una transacción; comprobado con `pg_terminate_backend`, que da `P2010` con `57P01`. Antes daba 500. Cualquier otro error sigue siendo 500.
- El login con la base caída también responde 503, sin calcular hashes.
- **Implementado (Backend 2B):** `lib/baseDeDatosNoDisponible.ts` traduce esos errores a `BaseDeDatosNoDisponibleError`, sin causa ni detalles (el mensaje de Prisma incluye el host). Todas las operaciones del servicio de sesiones la lanzan. Con la base caída, Prisma lanza `PrismaClientInitializationError` (comprobado con una conexión real a un puerto cerrado), y una validación nunca concede acceso. La traducción a 503 es de la capa HTTP (Backend 2C).

#### Accesos por rutas directas

- Toda la autorización ocurre en el backend; las guardas del frontend son experiencia de uso. Abrir `/clientes/…` directamente carga la SPA (archivos estáticos públicos, sin datos ni secretos) y la primera llamada a `/api/auth/sesion` decide.
- Pedir directamente el backend de Railway funciona igual que vía proxy: sin cookie válida, 401. La cookie de la app (del dominio de Vercel) no se envía al dominio de Railway.
- Descargar `/api/documentos/:id/archivo` exige sesión y permiso; el backend no lee el almacenamiento si el pedido no está autorizado.
- Un anónimo recibe 401 también en rutas inexistentes: no se puede mapear la API sin entrar.

### 2. Contraseñas

#### Biblioteca: `argon2` (node-argon2), previa verificación de carga

- **API nativa descartada**: `crypto.argon2` aparece recién en Node 24.7 (estable en la línea 24 desde 24.19) y **no existe en Node 22**, que usa hoy al menos una máquina de desarrollo (verificado). Además obligaría a escribir a mano la codificación, el parseo y la verificación del formato PHC, que es donde suelen aparecer errores sutiles.
- **Biblioteca `argon2`**: genera la sal, produce y verifica PHC (`$argon2id$v=19$m=…,t=…,p=…$sal$hash`) y trae `needsRehash()`. Según el registro de npm (consultado al consolidar este ADR, sin instalarla): versión 0.45.2, licencia MIT, `engines.node >= 16.17.0`, addon N-API (`node-addon-api`) con binarios precompilados elegidos por `node-gyp-build`. Sirve en Node 22 y 24.
- **Versión fijada: `argon2` 0.45.1** (exacta en `apps/backend/package.json`), publicada en julio de 2026. Se eligió en lugar de la 0.45.2 (noviembre de 2026, con 8 días de publicada al instalar) porque trae los mismos binarios precompilados y solo cambia una dependencia de compilación (`node-addon-api`): más antigüedad, mismo resultado. Dependencias: `@phc/format`, `node-addon-api`, `node-gyp-build` y `cross-env`, que el paquete usa en su script de instalación y declara como dependencia de ejecución.
- **Verificación por entorno** (Backend 1 de HU4.1, 2026-11-11):

| Entorno                                        | Qué verificar                                                                                                                                                                                                        | Estado                                                                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows x64 (desarrollo)                       | Instala con el binario precompilado, sin compilar; `hash` y `verify` funcionan                                                                                                                                       | **Verificado con Node 22** (no hay Node 24 en esa máquina): binario `win32-x64`, ~26 ms por hash con los parámetros de abajo                                 |
| `node:24-bookworm-slim` (Docker de desarrollo) | Ídem en Linux glibc                                                                                                                                                                                                  | **Verificado con Node 24.22.3** (imagen de desarrollo del proyecto): carga `prebuilds/linux-x64/argon2.glibc.node` sin compilar; `hash` y `verify` funcionan |
| CI (`ubuntu-latest`, Node 24)                  | Ídem; los tests de integración la usan                                                                                                                                                                               | Pendiente: se comprueba en el primer PR                                                                                                                      |
| Railway (Railpack, Node 24)                    | Carga en producción: la comprueba el primer despliegue del núcleo de autenticación (paso 2 de la secuencia de despliegue), sin endpoint de prueba público: si no carga, el servicio no arranca y el deploy no avanza | Pendiente                                                                                                                                                    |
| pnpm 9.7.1                                     | Corre los scripts de instalación (`node-gyp-build` elige el binario). Si el proyecto pasa a pnpm 10, hay que habilitarla en `onlyBuiltDependencies`                                                                  | **Verificado** (pnpm 9.7.1 vía Corepack)                                                                                                                     |
| Build (`tsup`)                                 | La biblioteca queda como dependencia externa, no se empaqueta (es un addon nativo)                                                                                                                                   | **Verificado (Backend 2C)**: `dist/server.js` la importa (`from "argon2"`) sin empaquetarla; el bundle arranca con Node 22.23.4 y con Node 24.22.3           |
| Cadena de suministro                           | Versión exacta en el lockfile, licencia (MIT), `pnpm audit`, dependencias transitivas revisadas, mantenimiento activo                                                                                                | **Verificado**: 0.45.1 exacta, MIT, sin avisos de `pnpm audit` en su árbol (los dos avisos actuales son de `zod` y `qs`, previos)                            |

Si alguna verificación falla, la alternativa es `@node-rs/argon2` (MIT, binarios precompilados por plataforma, mismo formato PHC), sujeta a la misma verificación. Los hashes PHC son intercambiables entre ambas.

#### Parámetros y concurrencia (Railway Free, 512 MB por servicio)

- **argon2id** con parámetros **explícitos** (los valores por defecto de la biblioteca usan 64 MiB y paralelismo 4, demasiado para este plan): memoria 19 MiB (`memoryCost: 19456`), 2 pasadas (`timeCost: 2`), paralelismo 1, hash de 32 bytes (mínimo recomendado por OWASP).
- **Semáforo**: 2 cálculos simultáneos (pico ~40 MiB), cola de 8; más allá, `503` con `Retry-After`, sin calcular. Evita además ocupar los 4 hilos del threadpool de libuv, que comparten el sistema de archivos, el DNS y el resto de `crypto`.
  - **Implementado (Backend 2A):** `lib/limitadorDeConcurrencia.ts`, genérico y sin colas ilimitadas, con `CapacidadAgotadaError`, distinta de una credencial incorrecta.
  - La instancia del proceso está en `modules/auth/limiteDeHash.ts`, con 2 simultáneos y 8 en espera. El lugar se libera aunque la operación falle.
  - **Medido en desarrollo** (Node 22, Windows, 12 CPU lógicas): 2 cálculos simultáneos suman ~19 MiB de pico y tardan lo mismo que uno (~28 ms); 8 simultáneos corren de a 4 (el threadpool), suman ~57 MiB y tardan ~120 ms.
  - Railway no está medido. La respuesta HTTP a la saturación (503 con `Retry-After`) se define con los endpoints.
- **Ajuste al consumo real**: se mide en Railway con el primer despliegue del núcleo (métricas del servicio y el tiempo del hash ficticio en el registro de arranque), sin endpoint de prueba público: memoria en reposo y con dos cálculos simultáneos. Si el pico supera el 60 % de los 512 MB, el semáforo baja a 1 o se usa la otra configuración mínima de OWASP (12 MiB, 3 pasadas). Los parámetros se cambian sin migración: `needsRehash()` actualiza cada hash en el siguiente login correcto.
- El hash ficticio (para igualar tiempos con emails inexistentes) se calcula una vez al arrancar.
- **Sin pepper por ahora** (sería un secreto nuevo que rotar).

#### Política de contraseñas

| Regla                           | Valor                                                                                                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normalización                   | Unicode **NFC** antes de validar y de calcular el hash (también al verificar)                                                                                                       |
| Largo mínimo                    | **8 caracteres** (puntos de código, después de normalizar) para las elegidas por el usuario. **Decidido por el usuario el 2026-11-12** (P5, ver abajo); la propuesta técnica era 15 |
| Largo máximo                    | **128 caracteres** (se exige permitir al menos 64); el schema rechaza más antes de tocar argon2                                                                                     |
| Caracteres                      | Todos los imprimibles, espacios y Unicode incluidos. Sin reglas de composición (mayúsculas, símbolos)                                                                               |
| Vencimiento periódico           | No. Solo se cambia por decisión de la persona, por restablecimiento o ante sospecha de compromiso                                                                                   |
| Pistas y preguntas de seguridad | No                                                                                                                                                                                  |
| Lista de bloqueo                | Sí (ver abajo)                                                                                                                                                                      |
| Contraseñas temporales          | Las genera el sistema: 20 caracteres de un CSPRNG, sin caracteres ambiguos. Se muestran una sola vez y obligan a elegir una propia                                                  |

**Discrepancia sobre el largo mínimo (documentada, no resuelta):** las versiones 0A y 0B de este ADR recomendaban 12 caracteres; la versión 0C y el borrador UX usan 15. Ninguna de las dos cifras tiene una aprobación registrada del cliente o del PO. **Recomendación técnica (no adoptada): 15**, porque la contraseña es el único factor de autenticación (no hay MFA) y NIST SP 800-63B-4 fija ese mínimo para ese caso; 12 sería razonable solo si se agregara un segundo factor. Las frases con espacios hacen que 15 sea manejable. Hasta que se confirme, la implementación usa 15 en un solo lugar (`@realpolitik/shared`), de modo que cambiarlo no exige migración.

**Lista de bloqueo, sin servicios externos:**

1. **Contraseñas comunes y filtradas**: un archivo derivado de una lista pública con licencia compatible, **filtrado a las entradas que alcanzan el largo mínimo** (las más cortas ya las rechaza el largo mínimo). Se carga una vez en un `Set` al arrancar. Comparación sin distinguir mayúsculas, después de NFC. Vive solo en el backend.
   - **Implementado (Backend 2A):** `modules/auth/listaDeContrasenasComunes.ts`, generado a partir de SecLists (MIT, licencia copiada en el archivo), commit `913b327317496d062bcc7cace524aaad8a693be2`: `Pwdb_top-1000000.txt` y `xato-net-10-million-passwords-1000000.txt`.
   - Filtro: NFC, minúsculas, de 8 a 128 caracteres, sin las repeticiones triviales que ya rechaza la regla 3. Resultado con el mínimo de 8: **847 489 entradas, unos 12,8 MB** (con 15 eran 15 667 y 275 KB). Costo medido al cargarla: unos 0,4 s y 74 MB de heap, permanentes. Si pesa demasiado, el generador admite quedarse con las N entradas más frecuentes de cada fuente (hoy no lo hace).
   - **Regenerable (Backend 2B):** con `node scripts/generar-lista-contrasenas-comunes.mjs` (en `apps/backend`). El script verifica el SHA-256 de las dos fuentes antes de usarlas (con una fuente alterada no escribe nada), no usa secretos ni dependencias y es determinista: dos corridas locales y una con descarga dieron el mismo archivo.
   - Al cambiar la regla 3 se agregaron 85 entradas y no se quitó ninguna. Son contraseñas comunes con menos de 5 caracteres distintos que no son una repetición pura (`1111222233334444`, `1234432112344321`): antes las rechazaba la regla vieja; ahora las cubre la lista.
   - **Cobertura real:** bloquea las contraseñas largas más repetidas en esas listas (secuencias, filas del teclado, palabras repetidas, frases conocidas). **No** detecta la mayoría de las contraseñas comprometidas (las bases completas tienen cientos de millones) ni frases comunes en español.
   - Si cambia el largo mínimo (P5), hay que regenerarla con el mismo filtro. Un test comprueba que el archivo lo cumple. **Con un mínimo de 8 la lista pasa a ser la defensa principal contra contraseñas previsibles** (junto con la demora por cuenta y las palabras del contexto): por eso se regeneró al bajarlo; sin regenerarla, `password` o `12345678` habrían sido válidas.
2. **Palabras del contexto** (corregida en Backend 2B). Como pide NIST SP 800-63B-4 (_"the entire password SHALL be subject to comparison, not substrings or words that might be contained therein"_), se compara la contraseña **entera**, reducida a sus letras, contra:
   - el nombre del servicio (`realpolitik`, `realpolitikmanager`);
   - la parte local del email y cada una de sus partes;
   - el nombre completo, en su orden y al revés, y cada una de sus partes.

   Se rechaza si las letras de la contraseña son exactamente una de esas palabras (con números, símbolos o espacios en cualquier lugar: `Mariana2026!!!!`) o su repetición (`marianamariana1`). No se prueban sustituciones (`m4r14n4`).
   - **Falsos positivos que tenía la regla anterior** (rechazaba si la contraseña _contenía_ el dato), ahora aceptados: `la rosa del jardín es azul` para Rosa Flores; `info sobre el balance anual` para `info@…`; `mi clave de Realpolitik es larga`; `soy mariana gómez y tomo mate` para Mariana Gómez.

3. **Repetición trivial** (corregida en Backend 2B): toda la contraseña es una unidad de 1 a 4 caracteres repetida, aunque la última quede incompleta (`zzzzzzzzzzzzzzz`, `919191919191919`, `abcdabcdabcdabcd`). Reemplaza al mínimo de 5 caracteres distintos, que se parecía a una regla de composición, cosa que NIST no admite. Las repeticiones de unidades más largas (`passwordpassword`) las cubre la lista.

El mensaje es único y no dice qué regla falló: "Esa contraseña es muy común o fácil de adivinar. Elegí otra." La consulta en línea a un servicio de contraseñas comprometidas queda como evolución.

**Implementado (Backend 2A), sin endpoints:**

- `@realpolitik/shared` (`usuario.schema.ts`), compartido por el frontend y el backend:
  - `CONTRASENA_LARGO_MINIMO` (8, P5 decidido por el usuario) y `CONTRASENA_LARGO_MAXIMO` (128);
  - `contarCaracteresDeContrasena`, que cuenta puntos de código después de NFC (un emoji vale 1; una bandera, 2);
  - `ContrasenaNuevaSchema`: rechaza caracteres de control y sustitutos UTF-16 sueltos, valida el largo y no recorta ni modifica la contraseña;
  - los mensajes.
- `modules/auth/politicaDeContrasenas.ts` (`evaluarContrasenaNueva`): el schema más la lista, el contexto y los patrones. Solo para contraseñas nuevas; nunca al verificar.
- `contrasenas.ts` cuenta igual que shared y no acepta sustitutos sueltos, que al pasar a bytes se volverían U+FFFD y harían que dos contraseñas distintas dieran el mismo hash.

### 3. Protección del inicio de sesión

#### Diseño (sin Redis ni CAPTCHA, sin bloqueos permanentes)

| Control                 | Clave                                        | Regla inicial                                                                                                                                                                | Al superarlo                                                                                  |
| ----------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Demora por cuenta       | Email normalizado, **exista o no** la cuenta | Desde el 5.º fallo consecutivo, espera obligatoria antes del próximo intento: 30 s, 1, 2, 4, 8 y como máximo 15 min. Se reinicia con un login correcto o tras 1 h sin fallos | `429` con `Retry-After`. Un intento durante la espera **no** se verifica ni cuenta como fallo |
| Límite por origen       | IP vista por el backend                      | 20 fallos en 15 min                                                                                                                                                          | `429` para esa IP durante 15 min, en cualquier cuenta                                         |
| Concurrencia por cuenta | Email normalizado                            | 1 verificación en curso                                                                                                                                                      | El segundo intento simultáneo recibe `429` sin calcular                                       |
| Capacidad global        | —                                            | Semáforo de argon2 (2 + cola de 8)                                                                                                                                           | `503` con `Retry-After`                                                                       |

- **Sin bloqueos permanentes**: la espera máxima es de 15 minutos y vence sola. Ningún estado del login requiere intervención manual.
- **Atomicidad**: Node atiende de a un evento, así que la reserva del intento (contar el intento en curso y verificar la espera) se hace de forma sincrónica **antes** de esperar al hash. Cincuenta pedidos simultáneos no pueden leer todos "cero fallos".
- **Sin enumeración**: las claves son el email tal como se escribió (normalizado), exista o no la cuenta; las demoras y el 429 se comportan igual para cuentas existentes e inexistentes.
- **Contadores en memoria acotados**: un mapa por control, con tope de 10 000 claves (se descartan las más viejas), vencimiento por tiempo y limpieza cada minuto: unos pocos MB como máximo. Supone **una sola instancia**; si se escala, los contadores pasan a una tabla de PostgreSQL (no a Redis). Un reinicio los pone en cero.
- **El límite por origen depende de la IP**: si el Anexo A muestra que detrás del proxy todos llegan con la IP de Vercel, este límite frenaría a todos a la vez; en ese caso se sube su umbral o se desactiva, y queda la demora por cuenta (P15).
- **Implementado (etapa 5):** en `production` el límite por origen solo se aplica con `TRUST_PROXY_SALTOS` > 0 (`limitePorOrigenAplicable`); con 0, todos comparten la IP del borde y un solo atacante bloquearía el login de todos. La demora por cuenta y la concurrencia siguen activas. Fuera de producción se aplica siempre. El arranque informa si está activo.

**Implementado (Backend 2C)** en `modules/auth/proteccionDeLogin.ts` y `autenticacion.service.ts`, con las reglas de la tabla:

- Una sola reserva sincrónica (`reservar(email, ip)`) aplica en orden el límite por origen, la demora por cuenta y la concurrencia, **antes** de cualquier `await`. El intento se cierra exactamente una vez como fallo, éxito o liberado (sin contar).
- Cambio respecto del diseño: **sin limpieza cada minuto**. Los mapas se podan al escribir (vencidos primero, después los más viejos hasta 10 000 claves), sin temporizadores que mantengan vivo el proceso.
- Orden del login: reserva → búsqueda del usuario → `limiteDeHash` (la única cola de argon2; con capacidad agotada, `503` sin contar el fallo) → verificación contra el hash real o el **hash ficticio** → resultado.
- El hash ficticio se calcula una vez al arrancar (`prepararHashFicticio`, antes de `listen`; ~30 ms medidos en desarrollo), no en el primer login: así el primer intento con email inexistente no tarda más.
- La cuenta desactivada verifica igual la contraseña. La que se desactiva entre la verificación y `crearSesion` también cuenta como `inactiva`.
- **No cuentan como fallo:** la base caída (`503`, nunca `401`) y un hash guardado ilegible (`hash-invalido`: `401` genérico, registrado, sin sumar demora a una persona que no tiene la culpa).
- Los contadores son **por instancia** y se pierden al reiniciar, como estaba previsto.
- La IP es `req.ip`, con `trust proxy` en `TRUST_PROXY_SALTOS` (por defecto 0: la IP del socket; ver §4).
- Mensaje del 429: "Demasiados intentos. Probá de nuevo en un minuto." o "… en N minutos.", redondeado hacia arriba, con `Retry-After` en segundos.

#### Riesgo aceptado: denegación temporal de acceso

Quien conozca el email de una persona puede mantener su cuenta en la espera máxima mandando un intento fallido cada vez que vence (unos 4 por hora). Mientras dure el ataque, la persona legítima puede no lograr entrar, porque su intento compite con el del atacante. Es **temporal** (termina cuando el ataque se detiene, con a lo sumo 15 minutos de espera) y no permanente.

- Mitigaciones: el tope de 15 minutos; los emails del personal no son públicos; los eventos `auth.login.limitado` repetidos para una cuenta quedan en los logs; reiniciar el servicio pone los contadores en cero (palanca operativa de último recurso).
- Si el riesgo se materializara, la evolución es reconocer los navegadores donde la persona ya inició sesión (descartado en este sprint por simplicidad) o avisar por correo cuando haya proveedor.

#### Respuestas

- Email inexistente, contraseña incorrecta y cuenta desactivada: **la misma respuesta** — `401 UNAUTHENTICATED`, `motivo: "CREDENCIALES_INVALIDAS"`, mensaje "Email o contraseña incorrectos" — y un tiempo similar (con email inexistente se verifica contra el hash ficticio; con cuenta desactivada se verifica igual la contraseña).
- Espera o límite: `429 TOO_MANY_REQUESTS`, `motivo: "DEMASIADOS_INTENTOS"`, con `Retry-After` y "Demasiados intentos. Probá de nuevo en N segundos." (menos de un minuto) o "… en N minutos." (redondeado hacia arriba). Mensaje y `Retry-After` salen del mismo número de segundos: la demora de 30 s ya no dice "un minuto".
- Otro intento de la misma cuenta en curso (concurrencia por cuenta): `429`, `motivo: "INTENTO_EN_CURSO"`, `Retry-After: 1` y "Ya hay otro intento en curso para esta cuenta. Esperá un momento y probá de nuevo." Antes decía "un minuto" con `Retry-After: 1`. No es una sanción ni cuenta como fallo. Revela que hay un intento en curso para ese email, exista o no la cuenta: no sirve para enumerar.
- Contraseña temporal correcta: 200 con `debeCambiarPassword: true`; la sesión solo sirve para `/auth/*` hasta cambiarla.
- Cuentas desactivadas: no pueden iniciar sesión ni usar sesiones previas. La persona ve el mensaje genérico; un `ADMINISTRADOR` sabe por qué.
- Contraseña actual incorrecta al cambiarla (`PUT /auth/password`): **`400`** con `campo: "actual"`, nunca `401` (dispararía el cierre global de sesión en el frontend). Cuenta para la demora por cuenta. **Implementado:** `400 VALIDATION_ERROR` con `details: [{ campo: "actual", mensaje: "La contraseña actual no es correcta." }]`; cinco seguidas activan la misma demora que el login.
- Un login con credenciales incorrectas **no** toca la sesión que traía el navegador. Con credenciales correctas, la sesión anterior se revoca **en la misma transacción** que crea la nueva (`crearSesion` con `reemplazaA`). Antes se revocaba después, fuera de la transacción, y si la base fallaba en ese momento el login respondía `200` y la sesión vieja seguía vigente. Ahora, si la base falla, no hay sesión nueva ni vieja revocada (`503`).

#### Registro de eventos

Una línea JSON por evento, en la salida estándar (como hoy, sin librería de logs):

- Eventos: `auth.login.ok`, `auth.login.fallo`, `auth.login.limitado`, `auth.logout`, `auth.sesion.vencida`, `auth.password.cambiada`, `auth.password.restablecida`, `usuarios.creado`, `usuarios.desactivado`, `usuarios.reactivado`, `usuarios.rol_cambiado`, `auth.origen_rechazado`, `auth.permiso_denegado`.
- Campos: fecha, evento, `usuarioId` (si se conoce), `motivo` (enumerado: `credenciales`, `inactiva`, `demora-cuenta`, `limite-origen`, `concurrencia`, `capacidad`), IP vista truncada (/24 en IPv4, /48 en IPv6) y un id de pedido.
- **Nunca**: contraseñas (tampoco la escrita por error en el campo email: por eso un fallo con email inexistente no registra el email), tokens, cookies, hashes, cuerpos de pedido.
- **Implementado (Backend 2C)** en `modules/auth/registroDeEventos.ts`: `auth.login.ok`, `auth.login.fallo`, `auth.login.limitado`, `auth.logout` y `auth.origen_rechazado`, con fecha, `usuarioId` (solo en `login.ok`), `motivo` (además de los enumerados, `hash-invalido`) e IP truncada. Revisado en la prueba con navegador: ni la contraseña ni la cookie aparecen en el registro. **Pendientes:** el id de pedido (no hay middleware de request id) y `auth.sesion.vencida`. Los eventos de contraseña y usuarios van con sus historias.
- **Implementado (cierre de la etapa 2):** `auth.password.cambiada` y `auth.password.fallo` (nuevo, no estaba en la lista), con `usuarioId`, el `motivo` (`credenciales` o el de la protección) y la IP truncada. Sin contraseñas ni hashes.

### 4. Seguridad HTTP y cookies

#### Cookie de sesión

`__Host-rp_sesion` con `Path=/; Secure; HttpOnly; SameSite=Strict`, sin `Domain`. Sin `Max-Age` (cookie de sesión del navegador; la vigencia real la decide el servidor), salvo que P2/P16 pidan que la sesión sobreviva al cierre del navegador: en ese caso, `Max-Age` igual al tiempo restante hasta `expiraEn`. Es la **única** cookie del sistema.

- El prefijo `__Host-` obliga al navegador a exigir `Secure`, `Path=/` y ningún `Domain`: un subdominio no puede pisarla.
- En desarrollo se usan **los mismos atributos**: no hizo falta la excepción sin prefijo ni `Secure` que preveía el diseño. Los navegadores tratan `http://localhost` como contexto seguro. **Verificado (Backend 2C)** con Edge (Chromium) sin interfaz por el proxy de Vite: guarda `__Host-rp_sesion` con `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, sin `Domain` y como cookie de sesión; `document.cookie` no la ve; viaja en un `fetch` del mismo origen; un pedido desde otro sitio (`127.0.0.1`) la bloquea por `SchemefulSameSiteStrict`; el logout la borra y después `/auth/sesion` da `401`. Firefox no se probó. Si un navegador no la aceptara, se usa `localhost` (no la IP) antes que debilitar la cookie.
- **Implementado (Backend 2C)** en `modules/auth/cookieDeSesion.ts`. El token se lee de la cabecera `Cookie` sin `cookie-parser`: se usa la primera aparición, y un valor mal codificado se trata como ausente. Nunca va en el cuerpo de la respuesta ni en los registros.
- `SameSite=Strict` no molesta a una SPA: el primer pedido al abrir un enlace externo es el `index.html` estático, y los `fetch` siguientes son del mismo sitio.

#### CSRF y validación de `Origin`

- Primera barrera: `SameSite=Strict`.
- Segunda barrera, en el backend, para **todos** los métodos que escriben (`POST`, `PUT`, `PATCH`, `DELETE`), **incluidos** `/auth/login` (evita que otro sitio inicie sesión en nombre de la víctima con una cuenta del atacante) y `/auth/logout`: el header `Origin` tiene que estar presente y ser exactamente uno de los orígenes permitidos (el del frontend). Si falta o no coincide: `403 FORBIDDEN`, `motivo: "ORIGEN_NO_PERMITIDO"`.
- Cubre también `POST /documentos`, que es `multipart/form-data` y un sitio ajeno podría mandar sin preflight de CORS.
- Ningún `GET` modifica datos (verificado en las rutas actuales; regla para las nuevas).
- **Implementado (Backend 2C), solo en `/auth`** (`modules/auth/verificarOrigen.ts`, montado antes de leer el cuerpo). Coincidencia exacta con `CORS_ORIGINS`: sin `Origin`, con `Origin: null` o con un origen parecido (otro puerto, otro esquema, prefijo o sufijo), `403`. Se rechaza también `Sec-Fetch-Site: cross-site` aunque el `Origin` coincida. No hay respaldo con `Referer`: el frontend envía `Referrer-Policy: no-referrer`, así que el `Referer` no llega. Tampoco se usan `Host` ni `X-Forwarded-Host`. Extenderlo al resto de los métodos que escriben es parte de Backend 2D.

#### CORS

- Con proxy de mismo origen, CORS queda con la lista explícita actual (para desarrollo sin proxy) y **sin** `credentials`.
- Con dominio propio (opción 4), CORS pasa a `credentials: true` con el origen exacto del frontend, y el frontend usa `credentials: 'include'`. Nunca `*`.

#### Cabeceras de seguridad

En la API (middleware propio de pocas líneas; Helmet es la alternativa, P12):

- `Cache-Control: no-store` en **todas** las respuestas de la API (las descargas ya usan `private, no-store`). Crítico con el proxy: el CDN de Vercel no debe guardar una respuesta autenticada (Anexo A). Además, `vercel.json` ya lleva `x-vercel-enable-rewrite-caching: 0` y `Cache-Control: no-store` en `/api/:path*`.
- **Implementado (Backend 2C), solo en `/auth`:** `Cache-Control: no-store` en todas sus respuestas, incluidos los errores (400, 401, 403, 429, 503) y el 404 de rutas inexistentes bajo `/auth`. El resto de la API, con el middleware de cabeceras (P12).
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy: same-origin`, `Strict-Transport-Security` en producción. `x-powered-by` sigue deshabilitado.

En el frontend (`headers` de `vercel.json`, al poner en producción): CSP con `default-src 'self'`, `script-src 'self'`, `connect-src 'self'`, `img-src 'self' data: blob:`, `font-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`; estilos en línea solo si la interfaz los necesita. La CSP exacta se valida en un Preview.

#### Proxies confiables y `X-Forwarded-*`

- `trust proxy` se fija en la **cantidad exacta de saltos** medida al activar el proxy (Anexo A). Nunca `true`.
- **Implementado (Backend 2C):** variable `TRUST_PROXY_SALTOS`, un entero de 0 a 5 con 0 por defecto. Con 0 no se configura `trust proxy` y `req.ip` es la IP del socket, así que un `X-Forwarded-For` enviado por el cliente se ignora (probado). El valor de Railway y Vercel se fija con T8 y T9. Hasta entonces, con 0 detrás de Railway, todos los pedidos comparten la IP del borde: el límite por origen actuaría sobre todos a la vez (P15).
- Por Vercel llegan dos saltos (Vercel → borde de Railway) y directo a Railway, uno. Con cualquier número fijo, alguien que llama directo a Railway puede inventar un `X-Forwarded-For`, o la IP real queda tapada por la de Vercel. Sin un secreto compartido con Vercel (un rewrite no lo agrega; una regla `routes` con `transforms` de `vercel.json` podría: mejora opcional, fuera de HU4.1), **ningún** valor de `X-Forwarded-For` es confiable para decisiones de acceso.
- La IP solo se usa para **registro** y para el límite por origen del login (ajustable o desactivable según el Anexo A). Ninguna decisión de acceso depende de ella.
- **Valor recomendado al activar (etapa 5): `TRUST_PROXY_SALTOS=0`**, con el límite por origen inactivo en producción (§3), hasta medir T8/T9. Nunca `true`.
- `X-Forwarded-Proto` y `X-Forwarded-Host` no se usan: `Secure` y los orígenes permitidos salen de la configuración.

#### 401, 403, 429 y 503

| Código                    | `motivo`                       | Cuándo                                                                  | Qué hace el frontend                                                              |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `401 UNAUTHENTICATED`     | `SESION_REQUERIDA`             | Sin cookie, cookie desconocida o revocada, usuario inactivo             | Limpia la caché y va a `/login?volverA=…`                                         |
| `401 UNAUTHENTICATED`     | `SESION_VENCIDA`               | La cookie corresponde a una sesión vencida por inactividad o por tiempo | Igual, con el aviso "Tu sesión venció"                                            |
| `401 UNAUTHENTICATED`     | `CREDENCIALES_INVALIDAS`       | Login fallido                                                           | Mensaje genérico en el formulario                                                 |
| `403 FORBIDDEN`           | `PERMISO_INSUFICIENTE`         | El rol no tiene el permiso                                              | Aviso "No tenés permiso para esta acción"; **no** cierra la sesión                |
| `403 FORBIDDEN`           | `CAMBIO_DE_PASSWORD_REQUERIDO` | Contraseña temporal sin cambiar                                         | Lleva a la pantalla de cambio obligatorio                                         |
| `403 FORBIDDEN`           | `ORIGEN_NO_PERMITIDO`          | `Origin` ausente o ajeno en un método que escribe                       | Error inesperado                                                                  |
| `403 FORBIDDEN`           | `ROL_NO_HABILITADO`            | Regla temporal de HU4.1: `CONSULTA` en cualquier ruta de negocio        | "Tu cuenta todavía no tiene acceso al sistema." y Cerrar sesión (borrador UX 3.8) |
| `429 TOO_MANY_REQUESTS`   | `DEMASIADOS_INTENTOS`          | Demoras y límites del login (con `Retry-After`)                         | Mensaje con el tiempo de espera                                                   |
| `429 TOO_MANY_REQUESTS`   | `INTENTO_EN_CURSO`             | Otro intento de la misma cuenta en curso (`Retry-After: 1`)             | Reintentar en un momento (o evitar el doble envío)                                |
| `503 SERVICE_UNAVAILABLE` | —                              | Base no disponible o capacidad de login agotada                         | Estado "servicio no disponible" con Reintentar; no cierra la sesión               |

Orden de los controles en cada pedido: origen (en métodos que escriben) → sesión (401/503) → contraseña temporal (403) → permiso (403) → lectura del cuerpo multipart → validación (400) → existencia (404) → reglas de negocio (409).

#### Exposición de información

- Cuerpo de `/auth/sesion` y `/auth/login`: id, nombre, email, rol, `debeCambiarPassword` y permisos. Nunca hash, contadores, tokens ni ids de sesión.
- **Implementado (Backend 2C):** `{ usuario: { id, email, nombre, rol, debeCambiarPassword } }` (`SesionActualSchema` en shared, el mismo cuerpo en login y sesión). **Sin `permisos` todavía**: se agregan cuando exista la matriz en código (Backend 2D o HU4.3). Hay tests que comprueban que no aparecen el token, su hash ni el hash de la contraseña.
- `/usuarios` nunca devuelve `passwordHash` ni datos de sesiones.
- Al cerrar sesión, el frontend navega con recarga completa a `/login` y recarga si la página vuelve desde la caché de "atrás/adelante" (`pageshow` con `persisted`).

### 5. Roles y autorización

#### Roles (aprobados)

| Rol              | Puede                                                                                                                                         | No puede                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ADMINISTRADOR`  | Todo lo operativo (consultar y modificar clientes, requisitos, rendiciones y documentos) **y** administrar usuarios                           | —                                                                                  |
| `ADMINISTRATIVO` | Todo lo operativo                                                                                                                             | Administrar usuarios                                                               |
| `CONSULTA`       | Leer todo: clientes, contactos, observaciones internas, requisitos, montos, órdenes de compra, rendiciones y documentos, incluida su descarga | Crear, editar, eliminar, anular o ejecutar cualquier operación que modifique datos |

- Los permisos se componen: `CONSULTA` ⊂ `ADMINISTRATIVO` ⊂ `ADMINISTRADOR`. Separar el permiso administrativo (`usuarios:administrar`) de los operativos permite que un `ADMINISTRATIVO` opere sin poder crear cuentas ni cambiar roles.
- El rol no depende del área de la persona; el modelo no tiene un campo de área que influya en los permisos.
- Sin permisos por cliente u organización: una sola organización, usuarios internos.
- Agregar un rol en el futuro es agregar un valor al enum y su conjunto de permisos en `PERMISOS_POR_ROL`, con su fila en la matriz y su test.

#### Autoprotección de la administración de usuarios (HU4.5)

- **Siempre queda al menos un `ADMINISTRADOR` activo**: desactivar o cambiar el rol del último se rechaza (`409`), en transacción serializable.
- **Nadie cambia su propio rol ni se desactiva a sí mismo** (`409`): retirar privilegios administrativos lo hace otro `ADMINISTRADOR`, nunca la propia persona, aunque no sea el último. Evita perder el acceso administrativo por error y que una sesión robada se use para cambiar el propio rol sin otra persona de por medio.
- Nadie se eleva a sí mismo: solo un `ADMINISTRADOR` cambia roles, y no puede cambiar el suyo.
- El restablecimiento de la propia contraseña no pasa por `/usuarios`: cada persona usa el cambio voluntario (HU4.2).
- Cambiar el rol de otra persona revoca sus sesiones.

#### Cadena del backend

**Implementada en la etapa 3** (`app.ts`, `modules/auth/autorizacion.ts`, `modules/auth/permisos.ts`). Difiere del diseño de abajo en tres puntos, por seguridad o simplicidad:

- `verificarOrigen` corre **antes** de las rutas públicas y de leer cualquier cuerpo, para TODO método que escribe: cubre `/auth`, el negocio y las rutas inexistentes con un solo montaje.
- El cuerpo JSON se lee **después** de la sesión, la contraseña definitiva y la regla de solo lectura de `CONSULTA`, y antes del `autorizar` de cada ruta. Un anónimo o un `CONSULTA` que escribe reciben 401/403 sin que se lea el cuerpo (probado con 200 KB: 401/403, no 413). Un rol operativo puede hacer leer hasta 100 KB antes del `autorizar` de una ruta que no le corresponde; hoy ninguna ruta de negocio le es ajena (`usuarios:administrar` no tiene rutas). Los archivos (multer) siempre van después de `autorizar`.
- **No hay puerto `resolverSesion` ni doble `sesionFija`.** La sesión la resuelve siempre `requerirSesion` (cookie → `validarSesion` contra la base). Los tests de rutas con la base simulada simulan también la tabla `Sesion` (`__tests__/sesionSimulada.ts`), y los de integración crean sesiones reales con `crearSesion` (`__tests__/sesionReal.ts`). Así no existe ningún camino de autenticación propio de los tests.

```
createApp({ corsOrigins, documentos, … })
  ├─ sinCache                    (Cache-Control: no-store en TODA respuesta, también errores y preflight)
  ├─ cors                        (el preflight OPTIONS termina acá: 204, sin datos)
  ├─ verificarOrigen             (todo método que escribe, en cualquier ruta)
  ├─ crearRouterPublico          (/health; /auth con su json y sus reglas de sesión)
  ├─ requerirSesion              (desde acá TODO exige sesión: 401 / 503; también rutas inexistentes)
  ├─ exigirPasswordDefinitiva    (403 CAMBIO_DE_PASSWORD_REQUERIDO)
  ├─ bloquearRolesNoHabilitados  (TEMPORAL HU4.1 → HU4.3: 403 ROL_NO_HABILITADO a CONSULTA en todo)
  ├─ soloLecturaParaConsulta     (permanente: 403 PERMISO_INSUFICIENTE a POST/PUT/PATCH/DELETE de CONSULTA)
  ├─ json(100kb)
  ├─ crearRouter (x7, montados con montar(): solo routers protegidos)
  │     cada ruta: autorizar(PERMISO) → [recibirArchivo] → validate(...) → controlador
  ├─ notFound
  └─ errorHandler
```

El diseño original:

```
createApp({ corsOrigins, documentos, autenticacion })
  ├─ cabeceras de seguridad
  ├─ json(100kb)                (/auth usa un límite propio de 2 KB)
  ├─ routers públicos           (crearRouterPublico: /health, /auth)
  │     verificarOrigen en los métodos que escriben de /auth
  ├─ verificarOrigen            (métodos que escriben, desde acá para abajo)
  ├─ requerirSesion             (desde acá, TODO exige sesión: 401 / 503)
  ├─ exigirPasswordDefinitiva   (403 CAMBIO_DE_PASSWORD_REQUERIDO)
  ├─ soloLecturaParaConsulta    (CONSULTA nunca escribe: red de seguridad global)
  ├─ routers protegidos         (crearRouter: /usuarios, /clientes, /requisitos, /rendiciones,
  │                              /tipos-documento, /documentos)
  │     cada ruta: autorizar(PERMISO) → [recibirArchivo] → validate(...) → controlador
  ├─ notFound
  └─ errorHandler
```

#### Denegación por defecto en tiempo de ejecución

1. **`crearRouter()`** (rutas de negocio) exige que el **primer** handler de cada `get`, `post`, `put`, `patch` y `delete` sea un `autorizar(PERMISO)` (lo reconoce por una marca interna). Si no lo es, **lanza un error al registrar la ruta**: el servidor no arranca y cualquier test que cree la app falla. `use`, `all` y `route` lanzan siempre.
2. **`crearRouterPublico()`** (solo `/health` y `/auth`) es la única forma de declarar una ruta sin permiso.
3. **`createApp`** se niega a montar después de `requerirSesion` un router que no venga de `crearRouter()`.
4. **`autorizar(permiso)`** deniega si no hay sesión o si el rol no tiene el permiso. `PERMISOS_POR_ROL` es un mapa explícito: lo que no figura está denegado.
5. ESLint (`no-restricted-imports`) impide importar `Router` de `express` fuera de las fábricas.

Son unas decenas de líneas, sin framework. A eso se suman la sesión obligatoria global y la regla global de solo lectura para `CONSULTA`.

**Implementado (etapa 3):** los cinco puntos. `crearRouter()` lanza al registrar una ruta cuyo primer handler no sea `autorizar(...)`, y `use`, `all` y `route` lanzan. `createApp` monta los routers de negocio solo con `montar()`, que rechaza los que no vienen de `crearRouter()` y guarda cada ruta con su permiso (`rutasProtegidasDe(app)`). ESLint prohíbe `Router` de express (import y `express.Router`) fuera de `autorizacion.ts`. `/health` y `/auth` usan `crearRouterPublico()`.

#### Resto

- **(Reemplazado en la etapa 3, ver "Cadena del backend": no hay puerto ni doble.)** `autenticacion` es obligatoria en `AppConfig`: lleva el puerto `resolverSesion(req)`. En producción lee la cookie y consulta la base. En los tests de rutas, un doble (`sesionFija(usuario)`) que vive en `__tests__`, fuera del build. ESLint impide importar `__tests__` desde código de producción. **No existe** un modo "sin autenticación".
- **Test de inventario** (CI): cada ruta montada figura en la matriz con el mismo permiso. Un segundo test, guiado por la matriz, pide cada ruta como anónimo y con cada uno de los tres roles. **Implementado** en `__tests__/matrizDePermisos.test.ts`, que lee `docs/security/matriz-permisos.md`.
  - Compara las 44 rutas montadas con sus filas; las 5 de `/usuarios` (HU4.5) son las únicas filas sin montar permitidas.
  - Comprueba `PERMISOS_POR_ROL` contra las columnas Sí/No.
  - Pide cada ruta como anónimo, con un token desconocido, con la contraseña pendiente y con cada rol, y como escritura sin `Origin`. En cada denegación verifica que no se tocó ninguna tabla de negocio.
  - Control negativo: con `ultima-oc` en `rendiciones:ver`, fallan el inventario y la fila de `CONSULTA`.
- **Lecturas**: hoy ningún rol tiene lecturas restringidas, así que **no se filtran campos por rol** (no se construye ese mecanismo sin necesidad). Si un rol futuro necesitara restringir datos, se filtran en el backend (omitiendo claves), nunca solo en la interfaz.
- **Identidad del autor**: los controladores la leen de `res.locals.sesion.usuario.id`, nunca del cuerpo.

### 6. Modelo de datos (implementado en HU4.1, Backend 1)

En [`schema.prisma`](../../apps/backend/prisma/schema.prisma) y la migración `20261111120000_hu4_1_usuarios_sesiones`, que solo **agrega** (un enum y dos tablas) y no crea usuarios.

- **`RolUsuario`**: `ADMINISTRADOR`, `ADMINISTRATIVO`, `CONSULTA`. Enum de PostgreSQL, isomorfo con `RolUsuario` de `@realpolitik/shared` (un test lo comprueba). Los permisos de cada rol van en el código, no en la base.
- **`Usuario`**: `id`, `email` (único), `nombre`, `rol`, `passwordHash` (PHC de argon2id), `activo` (por defecto `true`), `debeCambiarPassword` (por defecto `true`), `passwordActualizadaEn`, `ultimoAccesoEn`, `createdAt`, `updatedAt`.
- **`Sesion`**: `id`, `usuarioId` (FK, `onDelete: Cascade`), `tokenHash` (`CHAR(64)`, único), `ultimaActividadEn`, `expiraEn`, `revocadaEn`, `createdAt`; índice por `usuarioId`.
- **`createdAt` en lugar de `creadaEn`** (cambio respecto de la propuesta): todos los modelos del proyecto usan `createdAt` para la auditoría. En `Sesion` es también el inicio de la sesión, y no lleva `updatedAt` porque sus únicos cambios (actividad y revocación) tienen columna propia.
- **CHECK de PostgreSQL** (documentados en la cabecera del schema):
  - `ck_usuario_email_normalizado`: minúscula, sin espacios en los bordes, forma `x@y`. Así el índice único no distingue mayúsculas.
  - `ck_usuario_nombre_no_vacio`.
  - `ck_usuario_password_hash_argon2id`: solo PHC de argon2id. Impide guardar por error una contraseña en claro o un hash de otro algoritmo, sin fijar los parámetros.
  - `ck_sesion_token_hash_formato`: SHA-256 en hexadecimal en minúscula.
  - `ck_sesion_fechas_coherentes`: `expiraEn > createdAt`; actividad y revocación no anteriores a `createdAt`. Al crear una sesión, la aplicación fija `createdAt`, `ultimaActividadEn` y `expiraEn` con el mismo reloj (`ahora()`).
- Sin tablas de roles ni de permisos: tres roles fijos de negocio (como los estados de ADR-0005). Sin campo de área, IP ni user agent. Los contadores del login viven en memoria.
- La validez de una sesión (revocada, vencida por inactividad o por tiempo, usuario activo) la decide la aplicación con su reloj: las duraciones siguen pendientes (P2) y no están en la base.
- Código de este bloque, sin uso todavía desde HTTP: `modules/auth/contrasenas.ts` (hash, verificación y `necesitaRehash`, con NFC y el tope de 128 caracteres de shared) y `modules/auth/tokenDeSesion.ts` (token de 32 bytes en base64url y su SHA-256).
- HU4.6 agrega después `HistorialEstadoRendicion.registradoPorId` (ver "Integración con la épica 3").

### 7. Frontend

- **Implementado, sin activar:** `VITE_API_URL` admite un path de mismo origen (`/api`; nunca `/`, que compartiría las rutas de la SPA) además de una URL absoluta. `http()` valida que la URL no salga del prefijo y envía la URL relativa. Las credenciales quedan en el modo por defecto de `fetch` (`same-origin`): la cookie viaja sola por `/api` y nunca a otro origen. `server.proxy` de Vite reenvía `/api` a un backend **local** (`API_PROXY_TARGET`, por defecto `http://localhost:3000`). En producción, `VITE_API_URL=/api` se define al activar.
- **Implementado (etapa 4):** `/login` y `/cambiar-contrasena` fuera de `AppLayout`. La guarda es un componente (`RequiereSesion`) que envuelve al layout, no un loader: decide con el estado de la sesión y no monta el shell ni ninguna página hasta que haya un usuario habilitado. `volverA` solo admite rutas internas.
- **Estado de sesión, una sola fuente de verdad:** la caché de TanStack Query bajo `['sesion']`, llenada solo con lo que responde el servidor (`GET /auth/sesion` o el login). Pendiente = inicializando; `{ usuario }` = autenticado; `null` = no autenticado (401, logout confirmado, cambio de contraseña); query en error = error temporal (503, red), que **no** termina la sesión. Nada se guarda en `localStorage` ni `sessionStorage`.
- **Implementado:** `QueryCache`/`MutationCache` con `onError` (`manejarErrorGlobal`): 401 termina la sesión y descarta los datos en memoria; 403 `CAMBIO_DE_PASSWORD_REQUERIDO` y `ROL_NO_HABILITADO` descartan los datos y revalidan la sesión; 403 `PERMISO_INSUFICIENTE` solo revalida; 429, 503, red y 403 de origen nunca tocan la sesión.
- **Cierre de sesión:** la sesión local termina solo cuando el servidor lo confirma (204, o 401 porque ya no existía). Con 503 o sin red, la interfaz informa el error y la sesión sigue: no simula un cierre.
- La interfaz oculta acciones según los permisos (experiencia de uso, no seguridad). El mapa rol → permisos del frontend (`modules/auth/permisos.ts`) es un espejo de la matriz, comparado con ella por un test; la respuesta de sesión no trae `permisos`.
- **Las pantallas nuevas no se diseñan sin revisar antes el handoff visual**, que no está en el repositorio.

## Estrategia de implementación

Reglas:

- Ningún incremento deja el backend exigiendo sesión sin que el frontend permita iniciarla.
- Ningún estado desplegado muestra un login mientras la API sigue abierta, ni se presenta como protegido algo que no lo está.
- Ningún incremento agrega un modo para saltear la autenticación.
- Un usuario `CONSULTA` nunca tiene permisos de escritura, tampoco durante una implementación parcial.

### Historias y dependencias

| Historia                                         | Contenido técnico                                                                                                                                                                                                                                                                          | Depende de                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Prerrequisito                                    | Verificación del proxy al activarlo (pedidos de lectura) y de `argon2` en el primer despliegue del núcleo (Anexo A). Para desarrollo local no bloquea                                                                                                                                      | Dominio público del backend y hosts de producción del frontend (de los proyectos existentes) |
| **HU4.1** — inicio de sesión y primer acceso     | Ver "Delimitación de HU4.1"                                                                                                                                                                                                                                                                | Prerrequisito (para desplegar en producción)                                                 |
| **HU4.2** — gestión de sesión y contraseña       | Cambio voluntario de contraseña, menú de cuenta completo, avisos de sesión vencida con regreso a la página, cierre de las otras sesiones (si se decide)                                                                                                                                    | HU4.1                                                                                        |
| **HU4.3** — Consulta en modo lectura             | **Infraestructura de permisos** (`crearRouter`, `autorizar`, `PERMISOS_POR_ROL`, `soloLecturaParaConsulta`, tests de inventario y de matriz, si no la trajo antes HU4.5); habilitar el rol `CONSULTA`; vistas de solo lectura (ficha del cliente y contactos); la interfaz oculta acciones | HU4.1                                                                                        |
| **HU4.4** — protección y acceso a documentos     | Permisos de documentos verificados (lectura y descarga para los tres roles, operaciones solo para los operativos), política de habilitación documental, validación de 10 MB y caché del proxy                                                                                              | HU4.1 e infraestructura de permisos                                                          |
| **HU4.5** — administración de usuarios           | `/usuarios` con `usuarios:administrar` (solo `ADMINISTRADOR`), autoprotección, pantalla, contraseña temporal                                                                                                                                                                               | HU4.1 e infraestructura de permisos (la trae si llega antes que HU4.3)                       |
| **HU4.6** — responsable de los cambios de estado | `registradoPorId` en el historial, coordinado con la épica 3                                                                                                                                                                                                                               | HU4.1 y los endpoints de cambio de estado de la épica 3                                      |

### Delimitación de HU4.1

**Incluye (funcional):**

- Inicio de sesión seguro (`POST /auth/login`, pantalla `/login`).
- Credenciales incorrectas sin revelar qué falló (misma respuesta para email inexistente, contraseña incorrecta y cuenta desactivada).
- Primer acceso con contraseña temporal y cambio obligatorio (`PUT /auth/password` y pantalla `/cambiar-contrasena`).
- Creación técnica segura del primer `ADMINISTRADOR` (script operativo; ver abajo).
- Persistencia y validación de sesiones (§1), con expiración por inactividad y absoluta aplicada en el servidor (valores configurables mientras se confirma P2).
- Protección de **todos** los endpoints de negocio frente a usuarios no autenticados (`requerirSesion` global), también al llamar directamente al backend de Railway.
- Redirección segura a Rendiciones o a la ruta interna pedida antes (`volverA` validado).
- Controles básicos contra intentos abusivos (§3).
- Pruebas de seguridad y de criterios de aceptación (ver abajo).

**Incluye (dependencias técnicas mínimas, identificadas como tales):**

| Dependencia                                                                                                                                                                                                                      | Por qué es necesaria en HU4.1                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transporte de mismo origen: `/api` en el cliente y proxy de Vite (**implementados**); rewrite de Vercel (pendiente de los valores de producción)                                                                                 | Sin él la cookie no llega al backend en producción                                                                                                          |
| Costura de tests (`crearAppDePrueba()`)                                                                                                                                                                                          | Sin ella, los ~42 tests del backend fallan al exigir sesión                                                                                                 |
| Biblioteca `argon2` verificada, política de contraseñas y lista de bloqueo                                                                                                                                                       | El cambio obligatorio necesita la política                                                                                                                  |
| Errores 401/403/429/503 y base caída → 503                                                                                                                                                                                       | Sin ellos el frontend no distingue sesión, permiso, abuso y caída                                                                                           |
| `verificarOrigen` (CSRF) y cabeceras con `no-store`                                                                                                                                                                              | La cookie de sesión sin protección CSRF abre otra vulnerabilidad                                                                                            |
| **Cierre de sesión básico** (`POST /auth/logout` y la opción en la interfaz)                                                                                                                                                     | Con sesiones largas (P2), no poder cerrar la sesión en una computadora compartida sería una falla de seguridad                                              |
| Identificación mínima del usuario en el shell                                                                                                                                                                                    | La persona tiene que saber con qué cuenta entró y poder salir                                                                                               |
| Regla temporal: **solo `ADMINISTRADOR` y `ADMINISTRATIVO` usan el sistema**; `CONSULTA` recibe 403 `ROL_NO_HABILITADO` en todo lo que no es `/auth/*` (**vigente**, implementada en la etapa 3 con `bloquearRolesNoHabilitados`) | Garantiza que `CONSULTA` no use el negocio antes de HU4.3. Sus permisos ya están implementados y probados contra la matriz; en HU4.3 se borra solo la regla |

**No incluye como funcionalidad completa:**

- Administración de usuarios (HU4.5): hasta entonces, altas, restablecimientos y bajas por el procedimiento técnico.
- Matriz operativa completa del rol Consulta e infraestructura de permisos por ruta (HU4.3).
- Operaciones específicas de documentos y su habilitación en producción (HU4.4); los documentos siguen deshabilitados en producción.
- Registro del responsable de los cambios de estado (HU4.6).
- Cambio voluntario de contraseña, cierre de otras sesiones y avisos avanzados de sesión (HU4.2).

**Procedimiento técnico del primer `ADMINISTRADOR`:**

> **Implementado en la etapa 5, con diferencias respecto del diseño de abajo** (decididas por las restricciones de la etapa: no mostrar credenciales e ingreso seguro): comando `admin:crear` / `dist/crear-primer-administrador.js` que crea **solo** el primer `ADMINISTRADOR` y solo si no hay ninguno activo; nunca modifica cuentas existentes (no reactiva, no cambia contraseña ni rol). La contraseña inicial **la escribe** quien opera, sin eco y dos veces (o por stdin sin terminal); el script no la genera ni la muestra. Rechaza argumentos, pide confirmar el nombre de la base y registra `auth.usuario.creado` con el id. Las altas de `ADMINISTRATIVO` quedan para HU4.5. Uso en [deployment.md](../deployment.md#primer-administrador-hu41).

Diseño original:

- Script `usuarios:crear` del backend. Crea `ADMINISTRADOR` o `ADMINISTRATIVO` (nunca `CONSULTA` hasta HU4.3). Email y nombre por argumento; la contraseña temporal la **genera** el script y la muestra una sola vez (o se pide sin eco). Nunca por argumento de línea de comandos ni variable de entorno.
- Funciona en producción a propósito (a diferencia del seed), dentro de la red privada de Railway (P8). Se niega a crear un segundo usuario con el mismo email.
- Deja `debeCambiarPassword = true`: el cambio obligatorio tiene que estar disponible en la misma entrega.
- Queda registrado en el log (`usuarios.creado`, sin la contraseña).

**Pruebas mínimas:**

- Cada endpoint de negocio responde 401 sin sesión, con cookie inventada, revocada, vencida o de un usuario desactivado; también en rutas inexistentes.
- Login: misma respuesta y tiempo similar en los tres casos de fallo; 429 en los límites y sin contar intentos durante la espera; 503 con la base caída.
- Cookie con sus atributos; token nuevo en cada login (sin fijación de sesión); logout revoca en la base y es idempotente.
- Contraseña temporal: todo lo que no es `/auth/*` responde 403 (etapa 3); el cambio aplica la política, revoca todas las sesiones y exige volver a entrar; la contraseña actual incorrecta responde 400, no 401.
- `Origin` ajeno o ausente en métodos que escriben (incluidos login y multipart) → 403.
- `CONSULTA` recibe 403 `ROL_NO_HABILITADO` en cualquier ruta de negocio mientras dure la regla temporal (hasta HU4.3).
- `volverA` externo (`//…`, `https://…`, `javascript:`) se ignora.
- Frontend: guarda, redirecciones, manejo de 401/403/429/503, cambio obligatorio; los tests contra la API real inician sesión.
- El script de alta no expone la contraseña en logs ni en el historial de la terminal.

### Secuencia de despliegue de HU4.1

HU4.1 se integra en varios PR, pero **la activación se despliega una sola vez y completa**:

1. Transporte de mismo origen y costura de tests: sin efecto de seguridad; nada lo presenta como protección. El código del transporte ya está (sin activar). Activarlo es agregar el rewrite a `vercel.json` y pasar `VITE_API_URL` de Production a `/api`, con la verificación de lectura del Anexo A; puede hacerse antes del paso 2, con revisión del equipo. La API sigue abierta, por Railway y por el proxy ([deployment.md](../deployment.md#proxy-de-mismo-origen-preparado-sin-activar)).
2. Núcleo de autenticación en el backend (modelo, `argon2`, sesiones, `/auth/*`, límites, cabeceras, script): la API de negocio sigue **abierta como hoy** y la interfaz no muestra login. La documentación lo dice así; no se cargan datos reales.
3. **Activación** (frontend y backend en el mismo PR): pantallas de login y cambio obligatorio, guarda, cierre de sesión, `requerirSesion` y `verificarOrigen` globales, regla temporal para `CONSULTA`. Se despliega el frontend antes que el backend (el frontend nuevo funciona contra el backend del paso 2); la ventana dura lo que tarda el segundo despliegue y no es un estado entregado.
4. Antes de dar la activación por terminada en producción: crear el primer `ADMINISTRADOR`, comprobar con `curl` directo a Railway que la API responde 401 sin sesión y registrar el resultado.

### Política de habilitación documental en producción (HU4.4)

Los documentos siguen **deshabilitados** en producción. `DOCUMENTOS_HABILITADOS=true` solo cuando se cumplan **todas**:

1. HU4.1 y la infraestructura de permisos en producción, con el test de matriz en verde (incluida la descarga).
2. Bucket comprobado como privado: un `GET` anónimo a la URL pública del objeto en Supabase falla.
3. Subidas y descargas de 10 MB verificadas a través del rewrite real, con sesión y sin caché del CDN (Anexo A).
4. Aprobación explícita del cliente para cargar documentos reales (ADR-0004).

## Integración con la épica 3

- **Archivos compartidos:** `app.ts`, `rendiciones.routes.ts`, `rendiciones.service.ts`, `schema.prisma` y migraciones, `packages/shared/src/index.ts`, `router.tsx`, `api-contract.md`, los helpers de test y la plantilla de PR.
- **Contrato entre épicas:**
  - Desde HU4.1, los tests nuevos usan `crearAppDePrueba()` y toda ruta nueva queda detrás de `requerirSesion`.
  - Desde la infraestructura de permisos (HU4.3 o HU4.5), toda ruta nueva se registra con `crearRouter()` y `autorizar(PERMISO)`, con su fila en la matriz. Lo que escribe es de los roles operativos; una lectura nueva se habilita para `CONSULTA` en la matriz.
- **Responsable de los cambios de estado (HU4.6):** columna `HistorialEstadoRendicion.registradoPorId` (nullable, FK a `Usuario`, `onDelete: Restrict`) con el usuario cuyo pedido produjo el cambio (`res.locals.sesion.usuario.id`), pasado a `registrarCambioDeEstadoEnTx` dentro de la misma transacción. Desde HU3.6 hay dos orígenes, y HU4.6 tiene que distinguirlos:
  - **cambio manual:** `PATCH /rendiciones/:id/estado`, y las transiciones que sumen HU3.7–HU3.9;
  - **vuelta automática:** `POST /rendiciones/:id/requisitos/:requisitoId` devuelve una `COMPLETA` a `EN_CURSO`. El usuario es quien sumó el requisito, pero el cambio de estado lo decidió el sistema.

  Hoy la vuelta automática solo se reconoce por el texto de `motivo`, que HU3.8 usará para el motivo del rechazo. Propuesta, a decidir en HU4.6: un campo explícito para la operación que produjo el cambio (por ejemplo, un enum `origen`), en lugar de deducirla del texto. Las entradas anteriores quedan con `registradoPorId` en `null`. No es una auditoría completa.

- **Orden de migraciones:** la segunda épica en integrarse rebasa; el CI aplica el historial completo desde cero.

## Riesgos y compensaciones

| Riesgo                                                                                | Mitigación                                                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| El proxy de Vercel limita el cuerpo, cachea respuestas o altera `Set-Cookie`/`Origin` | Verificación de lectura al activar; cookies, caché autenticada y 10 MB con la autenticación (Anexo A); plan B: dominio propio |
| La IP del cliente no es confiable detrás del proxy                                    | Ninguna decisión de acceso depende de la IP                                                                                   |
| Denegación temporal de acceso a una cuenta                                            | Espera máxima de 15 min, sin bloqueo permanente; riesgo aceptado (§3)                                                         |
| Agotamiento de memoria o CPU (argon2, subidas)                                        | Parámetros explícitos, semáforo ajustado a la medición, sesión y permiso antes de `multer`                                    |
| `argon2` no instala o no carga en algún entorno                                       | Verificación al empezar HU4.1; alternativa `@node-rs/argon2`                                                                  |
| Node 22 en desarrollo frente a Node 24 en CI y producción                             | Alinear Node antes de implementar; la biblioteca funciona en ambas, pero los tests deben correr en la versión del proyecto    |
| Sesiones largas (propuesta de 24 h / 7 días)                                          | Cierre de sesión en HU4.1; revocación inmediata; decisión pendiente (P2)                                                      |
| Una ruta nueva sin permiso                                                            | Sesión global desde HU4.1; desde la infraestructura de permisos, la app no arranca con una ruta sin `autorizar`               |
| `CONSULTA` con escritura durante una implementación parcial                           | Regla temporal de HU4.1 (`CONSULTA` sin acceso) y script que no crea `CONSULTA` hasta HU4.3                                   |
| Pérdida del acceso administrativo                                                     | Siempre un `ADMINISTRADOR` activo; nadie cambia su propio rol; el script técnico como recuperación                            |
| Base caída                                                                            | Falla cerrado con 503                                                                                                         |
| Los Previews hablan con la API de producción                                          | Rewrite condicionado al host de producción                                                                                    |
| Sin recuperación por correo                                                           | Restablecimiento con contraseña temporal (procedimiento técnico hasta HU4.5)                                                  |

## Impacto en módulos existentes

| Módulo / archivo                                                                       | Cambio                                                                                    | Historia      | Conflicto con la épica 3            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------- | ----------------------------------- |
| `apps/backend/src/app.ts`                                                              | `autenticacion` obligatoria, controles globales; luego verificación de routers protegidos | HU4.1, HU4.3  | Medio                               |
| `errors/app-error.ts`, `middleware/error-handler.ts`                                   | 401, 403, 429; base caída → 503                                                           | HU4.1         | Bajo                                |
| Los 5 `*.routes.ts`                                                                    | `crearRouter()` y `autorizar(...)` por ruta; en documentos, antes de `recibirArchivo`     | HU4.3 / HU4.5 | **Alto** en `rendiciones.routes.ts` |
| `routes/health.ts`                                                                     | `crearRouterPublico()`                                                                    | HU4.3 / HU4.5 | Bajo                                |
| ~42 tests del backend                                                                  | `crearAppDePrueba()`                                                                      | HU4.1         | Medio                               |
| `config/env.ts`, `.env.example`                                                        | Orígenes permitidos, duraciones de sesión, nombre de la cookie por entorno                | HU4.1         | Bajo                                |
| `schema.prisma` + migración                                                            | `RolUsuario`, `Usuario`, `Sesion`; después `registradoPorId`                              | HU4.1, HU4.6  | Bajo                                |
| `rendiciones.service.ts`                                                               | Responsable del cambio de estado                                                          | HU4.6         | Alto                                |
| `apps/backend/package.json`                                                            | Dependencia `argon2` (tras verificarla); script `usuarios:crear`                          | HU4.1         | Bajo                                |
| Frontend: `env.ts`, `http.ts`, `router.tsx`, `providers.tsx`, layout, `errores-api.ts` | Base relativa, guarda, manejo de 401/403/429/503, usuario y cierre de sesión              | HU4.1, HU4.2  | Medio                               |
| Componentes con acciones de escritura                                                  | Ocultar según permisos; vistas de solo lectura                                            | HU4.3         | Medio                               |
| `vite.config.ts`, `docker-compose.yml`, `vercel.json`                                  | Proxy `/api`, cabeceras                                                                   | HU4.1         | Bajo                                |
| CI (`test:api`)                                                                        | Iniciar sesión con un usuario creado en la base de test                                   | HU4.1         | Bajo                                |
| `.eslintrc.cjs`                                                                        | Reglas de importación (`__tests__`; luego `Router` de `express`)                          | HU4.1, HU4.3  | Bajo                                |
| Documentación                                                                          | Contrato de API, `deployment.md`, baseline                                                | Cada HU       | Bajo                                |

## Decisiones pendientes

### Requieren respuesta del cliente o del PO

| #   | Decisión                                                                                                             | Recomendación                                                                                                                             | Mientras tanto                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1b | ¿Hay o habrá un dominio propio?                                                                                      | Usarlo cuando exista                                                                                                                      | Proxy, si pasa el Anexo A                                                     |
| P2  | Inactividad y duración máxima de la sesión. **Propuesta funcional: 24 h y 7 días, sin confirmar**                    | Confirmar sabiendo que 24 h protege menos una computadora olvidada; el cierre de sesión mitiga                                            | Valores configurables; 24 h / 7 días como valores por defecto propuestos      |
| P5  | Largo mínimo de contraseña (12 en 0A/0B, 15 en 0C y en el borrador UX). **Decidido por el usuario el 2026-11-12: 8** | Se recomendaba 15 (único factor, NIST SP 800-63B-4); con 8 la lista de bloqueo, la demora por cuenta y el contexto pasan a ser la defensa | 8, en un solo lugar de shared; la lista de bloqueo se regeneró con ese mínimo |
| P9  | ¿Las operaciones irreversibles (anular) piden la contraseña otra vez?                                                | No; diálogo de confirmación como hoy                                                                                                      | Como hoy                                                                      |
| P10 | ¿Se cargan documentos reales en producción?                                                                          | Solo después de la política de habilitación (HU4.4)                                                                                       | Deshabilitados                                                                |

### Las resuelve el equipo

| #   | Decisión                                                        | Recomendación                                                                                     |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| P6  | Versión de `argon2` a fijar y verificación de carga             | La última estable que pase la verificación en los cuatro entornos                                 |
| P8  | Cómo se ejecuta el script del primer `ADMINISTRADOR` en Railway | Shell del servicio, dentro de la red privada                                                      |
| P12 | Middleware de cabeceras propio o Helmet                         | Propio                                                                                            |
| P14 | Fuente y licencia de la lista de contraseñas comunes            | Implementada con SecLists (MIT), filtrada al largo mínimo: confirmar si alcanza su cobertura (§2) |
| P15 | Umbral del límite por origen                                    | Según el Anexo A                                                                                  |
| P16 | Cookie persistente (`Max-Age`) o de sesión del navegador        | Depende de P2: persistente si se confirman 24 h / 7 días                                          |

**Resueltas en esta consolidación:** quién administra las cuentas (antes P3: `ADMINISTRADOR`); qué ve `CONSULTA` (antes P4a–P4e: lectura completa, incluida la descarga); si se registra el responsable de los cambios de estado (antes P7: sí, HU4.6); administración de usuarios en el sistema (antes P11: HU4.5, alcance de pantalla a refinar). Dispositivo reconocido: descartado en 0C. Proxy o dominio propio (antes P1): proxy en los proyectos existentes (2026-11-11); si la verificación falla, P1b.

## Consecuencias

- **Positivas:** API cerrada por defecto desde HU4.1; revocación real; sin secretos nuevos; sin código criptográfico propio; sin bloqueos permanentes; una ruta sin permiso no puede servirse; roles simples y componibles; activación en un único paso completo.
- **Negativas:** una consulta por pedido; una dependencia nativa; contadores en memoria atados a una instancia; riesgo aceptado de denegación temporal; despliegue atado a un rewrite de Vercel o a un dominio propio; ~42 tests cambian de forma; `CONSULTA` necesita vistas de solo lectura nuevas.

## Posibles evoluciones

- Recuperación de contraseña por correo; MFA (TOTP), al menos para `ADMINISTRADOR`.
- Reconocer navegadores conocidos para eximirlos de las demoras.
- Consulta en línea de contraseñas comprometidas.
- Pantalla de sesiones con "cerrar las demás sesiones"; reautenticación sin perder el formulario.
- Auditoría general; SSO del cliente.

## Registro de cambios

**Bloque 0B:** ciclo de vida, concurrencia y base caída de las sesiones; eliminación del bloqueo de cuentas del 0A; cookies `__Host-`, `Origin` en login y logout, `no-store`, `trust proxy` y tabla de 401/403/429/503; verificación antes de `multer`; incrementos que separan lo preparado de las activaciones; Anexo A.

**Bloque 0C:** biblioteca `argon2` en lugar de PHC propio; política de contraseñas (NFC, máximo 128, lista de bloqueo); demoras por cuenta sin `DispositivoReconocido`; denegación por defecto en tiempo de ejecución con `crearRouter()`; activación de frontend y backend juntos.

**Consolidación previa a HU4.1:**

- Tres roles aprobados (`ADMINISTRADOR`, `ADMINISTRATIVO`, `CONSULTA`); `CONSULTA` con lectura completa y descarga; solo `ADMINISTRADOR` administra usuarios; el rol no depende del área.
- Se retira el filtrado de campos por rol (ningún rol lo necesita); se conserva el principio de filtrar en el backend si un rol futuro lo requiere.
- Autoprotección: al menos un `ADMINISTRADOR` activo; nadie cambia su propio rol ni se desactiva.
- Modelo: `RolUsuario` con tres valores.
- Estrategia: alineada con HU4.1–HU4.6, con la delimitación de HU4.1, sus dependencias técnicas mínimas (incluido el cierre de sesión básico) y la regla temporal que deja a `CONSULTA` sin acceso hasta HU4.3.
- Sesiones: propuesta de 24 h / 7 días como pendiente (antes se recomendaban 30 min / 12 h), con la decisión dependiente sobre la cookie (P16).
- Contraseñas: el largo mínimo de 15 pasa de "resuelto" a propuesta técnica pendiente, con la discrepancia con 12 documentada. Verificado que `crypto.argon2` no existe en Node 22.
- Contexto actualizado a `main` en `ceefb44`.

**HU4.1, etapa 3: verificación y cierre (2026-11-12).**

- **Regla temporal de `CONSULTA` restaurada:** es la decisión funcional documentada, y la entrada anterior la había dado por superada por error.
  - `bloquearRolesNoHabilitados`, un solo middleware global después de la contraseña definitiva, responde `403 ROL_NO_HABILITADO` ("Tu cuenta todavía no tiene acceso al sistema.") a `CONSULTA` en cualquier método de cualquier ruta de negocio, también inexistente.
  - `/auth/*` sigue disponible para `CONSULTA`.
  - No cambia `PERMISOS_POR_ROL` ni la matriz. Las lecturas de `CONSULTA` siguen implementadas y probadas (`autorizar` las concede, y el test de matriz compara el catálogo con las columnas Sí/No). `soloLecturaParaConsulta` sigue siendo la regla permanente.
  - Para que no quede como regla de arquitectura: está marcada como TEMPORAL en el código, sin interruptor de configuración. En HU4.3 se borran el middleware, su línea en `createApp` y su test, y el test de matriz pasa solo a esperar las columnas de la matriz.
- Corrida completa con PostgreSQL real (`realpolitik_test`) y con Node 24: ver los resultados en la devolución de este bloque.

**HU4.1, etapa 3 (2026-11-12): autenticación obligatoria y autorización de la API.**

- Toda ruta de negocio exige sesión (`requerirSesion` global), contraseña definitiva y el permiso de la matriz (`autorizar`, primer handler obligatorio de `crearRouter()`). `CONSULTA` solo lee (regla global). `Origin` en toda escritura y `no-store` en toda respuesta.
- Las 44 rutas, con los 12 permisos de la matriz: sin cambios en la matriz ni en los roles.
- La regla temporal de `CONSULTA` se dio por superada en esta etapa y **se restauró en su verificación** (ver la entrada siguiente).
- Uploads y descargas se autorizan antes de multer y del almacenamiento (probado: 401/403 en lugar del 400 de multer; el almacenamiento no se toca).
- Tests adaptados sin modo sin autenticación:
  - los de rutas simulan la tabla `Sesion` y piden como `ADMINISTRATIVO`;
  - los de integración usan sesiones reales de `crearSesion`, con cuentas sin contraseña que se borran al terminar.
- Nuevos tests: autorización (16), matriz (306 casos), base caída en la API de negocio (4) e integración con sesiones reales (10).
- Corridas en esta etapa (Node 22.23.4, sin la batería completa por pedido explícito):
  - unitarias del backend 1439;
  - integración de `clientes.integration` y `autorizacion.integration`;
  - lint, typecheck, Prettier, build y `prisma validate`.
- **Pendiente de correr:** el resto de las suites de integración adaptadas y la batería con Node 24.
- **Pendiente en Vercel y Railway:** T5–T9 y T14 (acceso directo a Railway → 401).

**HU4.1, cierre de la etapa 2 (2026-11-12):** cambio de contraseña del primer acceso y correcciones del login, sin exigir sesión en la API de negocio:

- `PUT /auth/password` (§1 "Cambio de contraseña"). Revoca todas las sesiones, incluida la actual, borra la cookie y exige volver a entrar: **reemplaza la rotación** propuesta antes. Para HU4.2 queda pendiente si se rota.
- Carrera corregida: un login que verificó la contraseña vieja y esperaba el bloqueo del usuario creaba una sesión válida después del cambio. Ahora `crearSesion` compara bajo el bloqueo el hash que se verificó (control negativo: sin la comparación, el test recibe `200`).
- Reemplazo de sesión en el login: atómico, dentro de la transacción de `crearSesion`. Un intento fallido no toca la sesión anterior.
- 429 por concurrencia: `motivo: "INTENTO_EN_CURSO"` con su propio mensaje. Los mensajes de espera usan los mismos segundos que `Retry-After`.
- `P2010` con SQLSTATE de conexión perdida (`08…`, `57P01`–`57P03`) se trata como base no disponible (`503`). Antes daba `500` (comprobado con `pg_terminate_backend`).
- `requerirSesion` (solo en `GET /auth/sesion` y `PUT /auth/password`). Eventos `auth.password.cambiada` y `auth.password.fallo`.
- Pruebas: 24 de integración nuevas del cambio y del reemplazo, con fallas y carreras forzadas con bloqueos de fila reales y conexiones terminadas; además, 4 del servicio de sesiones, 11 de shared, 13 HTTP, 1 con la base caída y 18 de la clasificación de errores.
- Suite completa con Node 22.23.4 y con Node 24.22.3 (Docker): `shared` 1081, frontend 1735 (11 omitidas, previas), unitarias del backend 1110, integración 414, más lint, typecheck, Prettier, build y `prisma validate`.
- `realpolitik_test` y la base de desarrollo quedaron sin usuarios ni sesiones.
- **Sigue pendiente (etapa 3):** la restricción de `debeCambiarPassword` y la de `CONSULTA` sobre la API de negocio. P2, P5, P14, P15, P16 y el límite de 10 sesiones siguen sin aprobación.

**HU4.1, Backend 2C (2026-11-11):** autenticación HTTP, sin exigir sesión en la API de negocio:

- Endpoints `POST /auth/login`, `GET /auth/sesion` (nombre del ADR, la matriz y el borrador UX, en lugar de `/auth/me`) y `POST /auth/logout`.
- Cookie `__Host-rp_sesion` sin excepción de desarrollo, verificada en navegador real. `Origin` exacto, más `Sec-Fetch-Site`, en `/auth`. `no-store` en `/auth`.
- Protección del login en memoria (demora por cuenta, límite por origen, concurrencia por cuenta), con el hash ficticio precalculado y `503` por capacidad o por base caída. `TRUST_PROXY_SALTOS` (por defecto 0).
- Un login con una cookie previa revoca esa sesión y emite un token nuevo.
- Una sesión vencida o revocada borra la cookie. Con la base caída, `/auth/sesion` y `/auth/logout` responden `503` **sin** borrarla.
- `AppError` admite `Retry-After`.
- Pruebas: 14 de la protección, 45 HTTP sin base (incluido `X-Forwarded-For` con 0 y 1 saltos), 4 con base inaccesible real y 23 de integración contra `realpolitik_test`.
- Suite completa con Node 22.23.4 y con Node 24.22.3 (Docker): `shared` 1070, frontend 1735 (11 omitidas, previas), unitarias del backend 1079, integración 386, más lint, typecheck, Prettier, build y `prisma validate`.
- **Pendientes:**
  - `PUT /auth/password` (cambio en el primer acceso);
  - la restricción de `debeCambiarPassword` y la regla temporal de `CONSULTA` sobre la API de negocio (Backend 2D);
  - `permisos` en la respuesta;
  - rehash al iniciar sesión (`necesitaRehash`);
  - el procedimiento del primer `ADMINISTRADOR` (P8);
  - el id de pedido y `auth.sesion.vencida` en el registro;
  - T5–T9 y T14 del Anexo A.

P2, P5, P14, P15, P16 y el límite de 10 sesiones siguen pendientes.

**HU4.1, Backend 2B (2026-11-11):** servicio persistente de sesiones, sin endpoints ni cookies:

- `crearSesion`, `validarSesion`, `registrarActividad`, `revocarSesionPorToken`, `revocarSesionDeUsuario` y `revocarSesionesDeUsuario`, con el límite de 10 vigentes (propuesta) y fallo cerrado ante la base caída.
- Reglas de contraseña corregidas: contexto por comparación entera y repetición trivial en lugar de 5 caracteres distintos. Lista regenerada (+85 entradas) con el script reproducible.
- Pruebas: 26 de integración del servicio (con concurrencia real y un control negativo sin el bloqueo), 8 de base caída y las unitarias de las reglas.
- Suite completa con Node 24.22.3: `shared` 1062, unitarias 1016, integración 363, typecheck y build.

P2, P5 y P14, y el límite de 10, siguen pendientes. HU4.1 no está completa: faltan los endpoints, la cookie y el middleware (Backend 2C).

**HU4.1, validación de Backend 1 (2026-11-11):** con PostgreSQL 16.15 local (contenedor `db` de Compose):

- La migración `20261111120000_hu4_1_usuarios_sesiones` se aplicó con `migrate deploy`, primero sobre `realpolitik_test` (creada vacía, con todo el historial) y después sobre la base de desarrollo, con copia previa y conservando sus datos.
- `migrate status` da al día en las dos bases, y no hay diferencias entre las bases y `schema.prisma`.
- Pruebas de integración de usuarios y sesiones: 30 de 30 (las 28 previstas y 2 nuevas: fechas de `fechasDeSesionNueva` y transacción que falla sin persistencia parcial), ninguna omitida.
- Cada restricción se sondeó además con SQL directo.
- Suite completa de integración: 337 de 337.
- Con Node 24.22.3 (imagen `node:24-bookworm-slim` del proyecto) pasan `shared`, las unitarias y la integración del backend, el typecheck y el build, y `argon2` usa su binario precompilado.
- Pendientes: el CI en el primer PR y Railway.

**HU4.1, Backend 2A (2026-11-11):** componentes que no dependen de PostgreSQL, con tests unitarios:

- política de contraseñas en shared y en el backend;
- lista de contraseñas comunes generada desde SecLists (P14, con la cobertura documentada);
- reglas temporales de sesión como funciones puras;
- limitador de concurrencia de argon2 (2 + 8), medido en desarrollo.

P2 y P5 siguen pendientes: los valores implementados son las propuestas. **Backend 1 sigue sin validar contra PostgreSQL:** la migración no se aplicó y las 28 pruebas de integración no corrieron (Docker no arranca por falta de recursos del sistema, `ERROR_NO_SYSTEM_RESOURCES`).

**HU4.1, Backend 1 (2026-11-11):** modelo `Usuario`, `Sesion` y enum `RolUsuario` con su migración (solo agrega) y sus CHECK; `createdAt` en lugar de `creadaEn`; `argon2` 0.45.1 fijada y verificada en Windows con Node 22 (Docker, CI y Railway con Node 24, pendientes); utilidades de contraseña y de token de sesión con sus tests. Sin endpoints ni middleware.

**Transporte de mismo origen (2026-11-11):** no se crean proyectos descartables: el proxy se activa en los proyectos existentes y la sonda queda como referencia (Anexo A reescrito con dónde y cuándo se verifica cada prueba). Implementado sin activar: `VITE_API_URL=/api`, URLs relativas en `http()`, proxy de Vite con destino local, y en `vercel.json` el fallback sin `/api` y la caché desactivada en `/api`. Pendiente: el rewrite hacia Railway (faltan el dominio del backend y los hosts de producción). Actualizados: comportamiento documentado de los rewrites de Vercel (caché por defecto, 120 s hasta el primer byte), verificación de `argon2` en el primer despliegue del núcleo, P1 resuelta.

**Integración de HU3.5 y HU3.6 (2026-11-11):** contexto actualizado a `main` en `c53f0b1`; 44 endpoints de negocio (HU3.6 sumó `PATCH /rendiciones/:id/estado`, con `rendiciones:operar` en la matriz); HU4.6 distingue el cambio manual de la vuelta automática a En curso.

**HU4.1, etapa 5 — integración, primer administrador y preparación del despliegue (2026-11-12):**

- **P5 decidido por el usuario: largo mínimo de contraseña 8** (antes, propuesta de 15). Se regeneró la lista de contraseñas comunes con ese mínimo (847 489 entradas, 12,8 MB; ver §2). Se actualizan la constante de shared, el generador, los textos de la interfaz y los tests.

- Primer `ADMINISTRADOR`: servicio `crearPrimerAdministrador` (validación con el email del login y la política de contraseñas, Argon2id, `debeCambiarPassword`, sin sesiones, bloqueo de aviso + email único, base caída → `BaseDeDatosNoDisponibleError`) y comando de terminal. Diferencias con el diseño anotadas en "Procedimiento técnico del primer `ADMINISTRADOR`". Probado contra `realpolitik_test` (unidad, integración, concurrencia y el comando como proceso).
- Límite por origen inactivo en producción sin `TRUST_PROXY_SALTOS` (§3, §4). Recomendación de activación: `TRUST_PROXY_SALTOS=0`.
- Tests del frontend contra la API real: inician una sesión real (`sesionDeApi.ts` + `usuarioDeApiDeTest.ts`), sin atajos; los 11 pasan contra el backend de prueba.
- Corrida integrada local (Edge → proxy de Vite → Express → `realpolitik_test`): bootstrap con el comando real, primer ingreso, cambio obligatorio con revocación, segundo ingreso, navegación, operaciones de `ADMINISTRADOR` y `ADMINISTRATIVO`, 401 sin sesión, `CONSULTA` bloqueado, sesión vencida durante el uso, logout, recarga, CSRF, PostgreSQL caído y recuperación: 18/18. **No valida Vercel ni Railway.**
- Sigue pendiente: el rewrite de `vercel.json` (faltan el dominio público del backend y los hosts de producción del frontend) y todas las pruebas del Anexo A en el entorno real.

**HU4.1, etapa 4 — frontend de autenticación (2026-11-12):**

- Módulo `apps/frontend/src/modules/auth`: servicio HTTP (`iniciarSesion`, `obtenerSesionActual`, `cerrarSesion`, `cambiarContrasena`) sobre el `http()` existente; estado de sesión en `['sesion']`; guarda `RequiereSesion`; pantallas de inicio de sesión y de cambio obligatorio; pantallas completas de "Servicio no disponible" y "Rol no habilitado"; cuenta con "Cerrar sesión" al pie del sidebar. Sin dependencias nuevas.
- `ApiClientError` suma `retryAfterSegundos` (cabecera `Retry-After` en segundos): el aviso del 429 dice la misma espera que el servidor.
- Cambio obligatorio: valida con `CambiarContrasenaSchema` de shared (la lista de contraseñas comunes sigue solo en el backend). Con el 204 se termina la sesión local y se vuelve a `/login?motivo=contrasena` con "Elegiste tu contraseña. Ingresá con la nueva." (texto confirmado).
- `CONSULTA` (regla temporal de HU4.1): inicia sesión pero ve solo la pantalla "Tu cuenta todavía no tiene acceso al sistema." con "Cerrar sesión"; no se monta ninguna pantalla de negocio. Se retira en HU4.3 junto con la regla del backend.
- Diferencias con el borrador de UX, decididas en la implementación: la guarda es un componente y no un loader; el cierre de sesión no navega si el servidor no lo confirma; el cambio voluntario de contraseña y el ítem "Usuarios" del menú quedan para HU4.2 y HU4.5.
- Visual: handoff "Realpolitik Manager · Épica 4" (pantallas Login y Primer ingreso, cuenta en el sidebar). Las pantallas de Consulta en solo lectura y de Usuarios del handoff no se implementan en HU4.1.
- Verificado con tests (unidad, integración con las rutas reales y `fetch` simulado) y en Edge real contra el backend y `realpolitik_test` por el proxy de Vite: 18 comprobaciones, entre ellas atributos de la cookie, ausencia de datos de sesión en el almacenamiento del navegador y pedidos solo a `/api` del mismo origen.
- Pendiente para la etapa 5: los tres `*.api.test.tsx` (11 tests, opcionales, se saltean sin `TEST_API_URL`) llaman a la API sin sesión; desde la etapa 3 recibirían 401. No se tocaron: reactivarlos exige un arnés con usuario de prueba, login y reenvío de la cookie.

## Anexo A — Verificación del proxy de mismo origen

**Decisión (2026-11-11):** no se crean cuentas, proyectos ni servicios descartables en Vercel o Railway. La sonda externa (`realpolitik-proxy-sonda`) queda como referencia técnica: no se despliega ni se integra al monorepo. Las pruebas T0–T15 se reubican en tres momentos:

- **Local (hecho):** con los tests del frontend y el proxy de Vite.
- **Activación del proxy:** en los proyectos existentes, solo con pedidos de lectura (`GET`) y sin endpoints de prueba.
- **Con autenticación:** lo que necesita sesión real o documentos habilitados.

Ninguna prueba se considera aprobada en Vercel o Railway mientras no se haga allí.

### Estado

| #   | Qué se comprueba              | Dónde y cuándo                                                                                    | Estado                                                                                             |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| T0  | `argon2` y Node 24 en Railway | Primer despliegue del núcleo de autenticación (arranque, métricas y registro)                     | Pendiente                                                                                          |
| T1  | Subidas de hasta 10 MB        | Local: proxy de Vite. Real: con HU4.4 (documentos deshabilitados en producción)                   | Local: 10 MiB íntegros por el proxy de Vite. **Real: pendiente**                                   |
| T2  | Subida lenta (más de 120 s)   | Con HU4.4                                                                                         | Pendiente                                                                                          |
| T3  | Descarga de 10 MB             | Con HU4.4                                                                                         | Pendiente                                                                                          |
| T4  | Sin caché del CDN             | Activación: dos `GET` seguidos, `x-vercel-cache` nunca `HIT`. Con sesión: respuestas autenticadas | Configuración en `vercel.json` (interruptor + `no-store`) con test. **En Vercel: pendiente**       |
| T5  | `Set-Cookie` de la sesión     | Con HU4.1 activada (cookie real, navegador real)                                                  | Local: `Set-Cookie` y `Cookie` atraviesan el proxy de Vite. **Real: pendiente**                    |
| T6  | `Origin` intacto              | Local; real con HU4.1 (`verificarOrigen`)                                                         | Local: llega intacto por el proxy de Vite. **Real: pendiente**                                     |
| T7  | Pedido desde otro sitio       | Con HU4.1 activada (cookie real; el backend rechaza por `Origin`)                                 | Pendiente                                                                                          |
| T8  | IP del cliente y saltos       | Activación: registro del backend, sin exponer IP en respuestas                                    | Pendiente (define `trust proxy` y P15)                                                             |
| T9  | `X-Forwarded-For` falso       | Activación, con el mismo registro                                                                 | Pendiente                                                                                          |
| T10 | Tiempos                       | Sin endpoint lento en producción: se acepta el límite documentado (120 s hasta el primer byte)    | No se prueba; riesgo aceptado                                                                      |
| T11 | Métodos y cuerpos             | Local; real con HU4.1 (escrituras con sesión)                                                     | Local: GET, POST, PUT, PATCH y DELETE con cuerpo intacto por el proxy de Vite. **Real: pendiente** |
| T12 | Previews aislados             | Activación: `GET /api/health` desde un Preview → 404 de Vercel                                    | Regla `has: host` exigida por el test de `vercel.json`. **En Vercel: pendiente**                   |
| T13 | Fallback de la SPA            | Activación: `/api/inexistente`, `/assets/inexistente.js`, `/clientes`                             | Patrón con test contra todas las rutas de React Router. **En Vercel: pendiente**                   |
| T14 | Acceso directo a Railway      | Con HU4.1 activada: `curl` directo sin sesión → 401                                               | Pendiente. Hasta entonces la API sigue abierta por Railway                                         |
| T15 | Compresión                    | Activación: un `GET` JSON grande                                                                  | Pendiente                                                                                          |

### Criterios

- **Proxy aprobado para activar la autenticación** si en la activación pasan T4 (lectura), T12 y T13, y con HU4.1 pasan T5, T6, T7 y T14.
- **Documentos (HU4.4):** además, T1, T2 y T3 con sesión, antes de `DOCUMENTOS_HABILITADOS=true`.
- **Falla T4:** bloqueante; se revierte `VITE_API_URL` y se analiza antes de seguir.
- **Falla T5 o T6:** dominio propio (P1b).
- **Falla T1 o T3 por tamaño:** dominio propio o bajar el tope de documentos (decisión de negocio).
- **T0, T8 y T9** no deciden el proxy: fijan los parámetros de `argon2`, `trust proxy` y P15.
- **Reversión:** ver [deployment.md](../deployment.md#reversión).
