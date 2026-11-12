# Borrador de trabajo — Experiencia de usuarios y acceso (épica 4)

> **Estado (revisión del PR #47, 2026-11-12): se conserva como referencia de trabajo para HU4.2, HU4.3 y HU4.5.** HU4.1 ya está implementada; lo implementado y lo que cambió respecto de este texto está en la nota "Estado (etapa 4 de HU4.1)" más abajo, y el comportamiento real está en el código, en [ADR-0006](../adr/0006-autenticacion-y-control-de-acceso.md) y en el [contrato de la API](../development/api-contract.md#8-autenticación-auth-hu41). Las secciones de cambio voluntario de contraseña, cierre de otras sesiones, administración de usuarios e interfaz por rol describen **propuestas para historias pendientes**, no funcionalidades existentes.
>
> **Borrador, no es backlog ni documentación estable.** Especificación funcional y de experiencia del bloque 1A, actualizada en la consolidación previa a HU4.1 (tres roles aprobados y división en HU4.1–HU4.6). Se apoya en [ADR-0006](../adr/0006-autenticacion-y-control-de-acceso.md) y en la [matriz de permisos](../security/matriz-permisos.md), ambos `Proposed`. Se descarta o se consolida cuando esté el handoff visual de Design. No está en el índice de `docs/` porque no es documentación estable.
>
> **Referencia visual:** el código del frontend en `main` (`ceefb44`; sin cambios de shell ni de componentes base relevantes desde `6c3b9e8`). El handoff original de Design **no está disponible**: lo que acá se describe como "propuesta visual" se arma con los tokens y componentes existentes y tiene que validarse contra el handoff cuando llegue. No se inventan especificaciones del handoff.

## 1. El frontend actual, como referencia

### Shell y navegación

- `AppLayout`: `SidebarProvider` con sidebar oscuro (`--sidebar #161314`), 220 px expandido / 64 px colapsado a íconos / cajón en mobile; `AppHeader` solo en mobile (botón de 44 px y título de la sección tomado de `handle.title`); `<main>` con las páginas. Envuelto en `TooltipProvider`.
- `AppSidebar`: marca "Realpolitik Manager •" (punto `--brand-accent #E23B43`) y monograma "R•" en colapsado; navegación con Rendiciones, Clientes y Documentos (barra roja a la izquierda en el activo, `aria-current="page"`). **No tiene pie**: `SidebarFooter` existe en `components/ui/sidebar.tsx` pero no se usa.
- Router (`createBrowserRouter`): todas las rutas cuelgan de `AppLayout`. Los únicos loaders son redirecciones (`/` → `/rendiciones`, `/documentos` → `/documentos/archivos`, ruta vieja de tipos). No hay rutas fuera del shell ni guardas.

### Datos y errores

- `http()` arma `VITE_API_URL + path`, clasifica fallos en `configuration`, `network` y `http`, conserva el cuerpo de error y no reintenta.
- TanStack Query: un solo `QueryClient`; queries reintentan **una vez** solo ante red o 5xx; mutations nunca. `refetchOnWindowFocus` queda en su valor por defecto (activo): volver a la pestaña vuelve a pedir datos.
- `causaDeError` devuelve `conexion`, `servidor` (5xx), `configuracion` o `inesperado` (todo 4xx). `diagnosticoDeError` arma códigos como `HTTP_503` o `NETWORK_ERROR` para mostrar en mono.

### Componentes y patrones reutilizables

| Pieza                                                | Uso actual                                                         | Rasgos a conservar                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Input`                                              | Todos los formularios                                              | 44 px en mobile / 36 en escritorio, borde `--input`, foco con anillo, `aria-invalid` en rojo                                                            |
| `FormField` + `describirCampo`                       | Formularios de clientes, tipos, OC                                 | Etiqueta visible, ayuda (`-ayuda`) y error (`-error`) conectados por `aria-describedby`; los obligatorios no se marcan, los opcionales dicen "Opcional" |
| `FormSection`                                        | Ficha del cliente                                                  | Título en versalitas con línea                                                                                                                          |
| React Hook Form + resolvers de `@realpolitik/shared` | Todos los formularios                                              | Validación al enviar (`mode: 'onSubmit'`), foco al primer campo inválido, intérpretes de errores de la API por módulo (`erroresDe*.ts`)                 |
| `LoadingButton`                                      | Guardar en paneles y diálogos                                      | Spinner y texto "…ando", bloqueado pero enfocable (`aria-busy`), éxito breve en verde                                                                   |
| `Alert`                                              | Avisos en formularios y páginas                                    | Error como `role="alert"`, éxito/advertencia como `status`, ícono además del color, botón de cerrar opcional                                            |
| `useAvisoDePagina`                                   | Resultado de una acción sobre un listado                           | Un aviso por vez, 8 s, el foco vuelve al título si estaba en el aviso                                                                                   |
| `useExitoBreve`                                      | Confirmación antes de cerrar un panel                              | 500 ms de éxito visible                                                                                                                                 |
| `Sheet`                                              | Alta y edición (cliente, contactos, requisito, OC, tipo)           | Panel lateral derecho con título, cuerpo con scroll y pie con acciones                                                                                  |
| `AlertDialog`                                        | Confirmaciones (desactivar, anular, quitar)                        | Acción destructiva explícita y Cancelar                                                                                                                 |
| `DropdownMenu`                                       | Menús "⋯" de acciones                                              | Ítems con ícono; destructivos en rojo; separadores                                                                                                      |
| Estados de página                                    | `ClientesErrorState`, `MatrizError`, vacíos por módulo, `Skeleton` | Etiqueta de causa en píldora, título, detalle, código de diagnóstico en mono, Reintentar                                                                |
| `NotFoundPage`                                       | Ruta inexistente                                                   | Título, una línea y un enlace                                                                                                                           |
| Monograma                                            | `ClienteMonogram`                                                  | Iniciales sobre `--border`                                                                                                                              |

**Tokens** (`styles/globals.css`): fondo `#F5F4F2`, tarjeta blanca, texto `#1A1A1A` / `#4A4A4A` / `#6B6B6B`, primario `#161314`, acento `#E23B43`, error `#B8262E`, advertencia `#A97914`, éxito `#1F5F3F`; IBM Plex Sans y Mono; radios 4/8/10/12; movimiento de 150 ms que respeta `prefers-reduced-motion`; foco visible de 2 px.

**Accesibilidad observada:** títulos de página `h1` enfocables (`tabIndex={-1}`) para devolver el foco; `enfocarYMostrar`; áreas táctiles de 44 px; tooltips que no capturan el Escape en mobile; contraste documentado en los tokens; textos en español con voseo.

**Precedente de solo lectura:** varios componentes reciben sus acciones como callbacks **opcionales** y, sin ellos, se muestran en solo lectura: `MatrizEncabezado` (`onAgregar`), `MatrizListado` (`acciones`), `ObservacionesClientePanel` y `MatrizIndicacionesArmado` (`onEditarCliente`), `RendicionesSection` (`onConfigurarMatriz`), `ItemChecklistFila` (`onAsociar`, `onReemplazar`). Hoy lo decide el estado del cliente (`puedeModificar` en `MatrizPage`). Es el patrón a extender para los permisos, sin crear un framework.

## 2. Flujos de autenticación

> **Estado (etapa 4 de HU4.1, 2026-11-12):** 2.1 a 2.7, 2.9 a 2.11 y las interfaces 3.1, 3.5, 3.6, 3.7 y 3.8 (rol no habilitado) están implementadas, junto con una versión mínima de 3.2/3.3 (cuenta y "Cerrar sesión"). Lo que cambió respecto de este borrador:
>
> - La guarda es un componente que envuelve al layout, no un loader (mismo comportamiento).
> - Textos: el login usa los del handoff ("Iniciar sesión", "Configurá tu contraseña") y los avisos de sesión "Tu sesión venció. Iniciá sesión de nuevo." y "Tu sesión terminó. Iniciá sesión de nuevo.". El aviso de espera es el del servidor: "Demasiados intentos. Probá de nuevo en N segundos / un minuto / N minutos."
> - 2.9: el cierre de sesión **no** se da por hecho si el servidor no responde 204 (o 401): con 503 o sin red se avisa "No pudimos cerrar la sesión: seguís con la sesión abierta. Probá de nuevo." y la sesión sigue. No hay recarga completa: se descarta la caché y se navega a `/login?motivo=cerrada`.
> - 2.10: el aviso "Lo que estabas guardando no se guardó." no se implementó.
> - 3.8 "Sección" (acceso denegado dentro del shell) no hace falta todavía: los dos roles habilitados tienen los mismos permisos operativos y no hay rutas de `usuarios:administrar`.

Convenciones de respuesta (ADR-0006 §4):

| Código                                                             | Significado para la interfaz                            | Qué **nunca** hace la interfaz       |
| ------------------------------------------------------------------ | ------------------------------------------------------- | ------------------------------------ |
| **401** `SESION_REQUERIDA` / `SESION_VENCIDA`                      | No hay sesión válida: hay que entrar de nuevo           | Mostrarlo como "no tenés permiso"    |
| **401** `CREDENCIALES_INVALIDAS`                                   | Solo en el login: datos incorrectos                     | Redirigir (ya está en `/login`)      |
| **403** `PERMISO_INSUFICIENTE`                                     | Hay sesión, pero esa acción o sección no está permitida | Cerrar la sesión o borrar la caché   |
| **403** `CAMBIO_DE_PASSWORD_REQUERIDO`                             | Hay sesión con contraseña temporal                      | Mostrar datos del sistema            |
| **429** `DEMASIADOS_INTENTOS`                                      | Esperar (`Retry-After`)                                 | Cerrar la sesión                     |
| **503** (o red caída, o 502/504 del proxy sin cuerpo del contrato) | El servicio no responde; reintentar más tarde           | Mandar a `/login` o cerrar la sesión |

### 2.1 Acceder sin sesión

1. La persona abre cualquier URL interna (por ejemplo, un enlace a `/clientes/…/rendiciones/…`).
2. Se carga la SPA (estática). El loader de la ruta protegida pide `GET /api/auth/sesion`, **antes** de renderizar el shell.
3. Respuestas:
   - `401` → redirección (con `replace`, sin dejar entrada en el historial) a `/login?volverA=<ruta y query originales>`.
   - `200` → se renderiza el shell con el usuario.
   - `200` con `debeCambiarPassword` → redirección a `/cambiar-contrasena?volverA=…`.
   - `503`/red → pantalla "Servicio no disponible" (2.11), sin redirigir a login.
4. Datos en memoria: ninguno se pidió todavía. Mientras resuelve, se ve una carga mínima de pantalla completa (sin el shell, para no mostrar navegación y después echar a la persona).

### 2.2 Iniciar sesión correctamente

1. Ve `/login` (3.1). Completa email y contraseña y envía.
2. `POST /api/auth/login` con `{ email, password }` (el navegador agrega `Origin`).
3. `200` + `Set-Cookie` → la respuesta trae usuario, rol, permisos y `debeCambiarPassword`.
4. Si `debeCambiarPassword` es `false`: navegación con `replace` a `volverA` (si es válido) o a `/rendiciones`. Se guarda la sesión en la caché de TanStack Query (clave `['sesion']`) para que el shell no la vuelva a pedir.
5. `volverA` válido: empieza con una sola `/`, no con `//`, no es `/login` ni `/cambiar-contrasena`. Cualquier otro valor se ignora en silencio.

### 2.3 Credenciales incorrectas

- Respuesta: `401 CREDENCIALES_INVALIDAS` (el mismo para email inexistente, contraseña incorrecta y cuenta desactivada).
- Interfaz: `Alert` de error arriba del formulario: "Email o contraseña incorrectos." El foco va al aviso. Se **conserva el email** y se **vacía la contraseña**; al cerrar o reintentar, el foco va al campo contraseña.
- No se marca un campo en particular (no se insinúa cuál falló).
- Datos: nada nuevo en memoria; la URL (con `volverA`) se mantiene.

### 2.4 Límite de intentos

- Respuesta: `429 DEMASIADOS_INTENTOS` con `Retry-After` (segundos). También puede llegar `429` si hay otro intento simultáneo de la misma cuenta.
- Interfaz: `Alert` de advertencia: "Hubo demasiados intentos. Probá de nuevo en N minutos." (N redondeado hacia arriba; "en unos segundos" si es menos de un minuto). El botón queda habilitado: un intento antes de tiempo recibe otra vez `429` y no cuenta como fallo. No hay cuenta regresiva animada (evita anuncios repetidos en lectores de pantalla).
- No se dice si la cuenta existe ni se ofrece otra vía.

### 2.5 Contraseña temporal

- Respuesta del login: `200` con `debeCambiarPassword: true` (la cookie ya existe, pero el backend solo atiende `/auth/*`).
- Interfaz: redirección con `replace` a `/cambiar-contrasena?volverA=…` (3.5). El shell no se muestra.
- Si en cualquier momento una llamada recibe `403 CAMBIO_DE_PASSWORD_REQUERIDO` (por ejemplo, se restableció la contraseña mientras la persona tenía la app abierta), se navega a la misma pantalla y se limpia la caché de datos.

### 2.6 Cambio obligatorio de contraseña

1. Ve la pantalla 3.5. Completa los campos y envía.
2. `PUT /api/auth/password` con `{ actual, nueva }`.
3. Respuestas:
   - `204` sin cuerpo y con la cookie borrada: el backend revoca **todas** las sesiones, también la actual (contrato implementado en la etapa 2, ADR-0006 §1 "Cambio de contraseña"). Se limpia la caché de sesión y se navega con `replace` a `/login?volverA=…`, con el aviso "Elegiste tu contraseña. Ingresá con la nueva." (texto a confirmar en la etapa 4).
   - `400` en `actual` → error en el campo "Contraseña temporal".
   - `400` en `nueva` (largo, lista de bloqueo, contexto) → error en el campo "Contraseña nueva" con el mensaje del servidor si está pensado para personas; si no, uno propio.
   - `429` → `Alert` de advertencia con el tiempo de espera.
   - `401` → la sesión venció en el medio: a `/login` con el aviso de sesión vencida.
   - `503`/red → `Alert` de error "No pudimos guardar la contraseña. Probá de nuevo." Los campos se conservan.
4. **Contrato implementado (etapa 2):** la contraseña actual incorrecta responde `400 VALIDATION_ERROR` con `campo: "actual"` (nunca `401`) y cuenta para la demora por cuenta. `429` puede traer `motivo: "INTENTO_EN_CURSO"` (doble envío) además de `DEMASIADOS_INTENTOS`.

### 2.7 Volver a la página solicitada

- `volverA` lleva ruta **y** query (`/rendiciones?mes=2026-10&estado=…`): los filtros que viven en la URL se recuperan.
- Se conserva a través de login → cambio obligatorio → destino.
- Si la página de destino responde `403` (la persona no tiene permiso para esa sección), se muestra "Acceso denegado" (3.8), no un bucle.
- El fragmento (`#…`) no se conserva (las páginas no lo usan).

### 2.8 Cambio voluntario de contraseña

1. Desde el menú de cuenta → "Cambiar contraseña" abre un `Sheet` (3.4) sobre la pantalla actual.
2. `PUT /api/auth/password` con `{ actual, nueva }`.
3. Éxito: `LoadingButton` en verde ("Contraseña cambiada"), el panel se cierra y la página muestra el aviso "Cambiaste tu contraseña. Cerramos tus otras sesiones abiertas." La pantalla y sus datos no se recargan (la sesión actual sigue, rotada). **Pendiente de decisión para HU4.2:** el endpoint implementado en la etapa 2 revoca todas las sesiones, también la actual, y exige volver a entrar; si HU4.2 quiere conservar la sesión actual, hay que agregar la rotación.
4. Errores: como en 2.6. Cerrar el panel con cambios sin guardar descarta lo escrito (son contraseñas: no se guardan borradores).

### 2.9 Cerrar sesión

1. Menú de cuenta → "Cerrar sesión". Sin confirmación.
2. `POST /api/auth/logout`.
3. Con `204` **o con cualquier error**: se limpia la caché de TanStack Query y se navega con **recarga completa** a `/login?motivo=cerrada` (descarta todo el estado en memoria). Si el pedido falló, el aviso dice "Cerraste la sesión en este navegador. No pudimos confirmarlo con el servidor; la sesión vencerá sola." En el caso normal: "Cerraste la sesión."
4. Si la página vuelve desde la caché de atrás/adelante del navegador (`pageshow` con `persisted`), se recarga y la guarda manda a `/login`.
5. Otras pestañas abiertas se enteran en su próximo pedido (401 → login).

### 2.10 Expiración por inactividad

- Disparador: cualquier pedido (query, refetch al volver a la pestaña, mutation) recibe `401 SESION_VENCIDA`.
- Interfaz: se limpia la caché y se navega con `replace` a `/login?motivo=vencida&volverA=<ruta actual>`. En `/login`, `Alert` de advertencia: "Tu sesión venció por inactividad. Ingresá de nuevo para continuar."
- Si la expiración ocurrió **al enviar un formulario** (mutation), lo escrito se pierde en este sprint; el aviso agrega: "Lo que estabas guardando no se guardó." (La reautenticación en un diálogo sin perder el formulario queda para después.)
- Varios pedidos con 401 a la vez: una sola redirección (se ignoran los siguientes si ya se está navegando a `/login`).
- `401 SESION_REQUERIDA` (revocada, por ejemplo por un cambio de rol o de contraseña en otro lado) sigue el mismo camino con el aviso genérico "Tu sesión terminó. Ingresá de nuevo."

### 2.11 API o PostgreSQL no disponibles

| Momento               | Señal                                   | Interfaz                                                                                                                           | Datos y navegación                                    |
| --------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Al entrar (guarda)    | `503`, red caída, `502`/`504` del proxy | Pantalla completa "Servicio no disponible" (3.7) con Reintentar                                                                    | Sin shell; no se redirige a login; la URL queda igual |
| Login                 | `503` o red                             | `Alert` de error en el formulario: "El servicio no está disponible en este momento. Probá de nuevo en unos minutos."               | Se conservan los campos (menos la contraseña)         |
| Navegando (queries)   | `503`, 5xx, red                         | Estados de error existentes de cada pantalla (causa `servidor` o `conexion`, con Reintentar). La política actual reintenta una vez | La sesión **no** se cierra; la caché no se borra      |
| Guardando (mutations) | `503`, 5xx, red                         | `Alert` en el panel o diálogo: "No pudimos guardar. Tus datos siguen acá; probá de nuevo."                                         | El formulario conserva lo escrito                     |

La red caída (`network`) y el 503 se comunican distinto: "No pudimos conectarnos. Revisá tu conexión." frente a "El servicio no está disponible."

## 3. Interfaces

Rutas nuevas propuestas: `/login` y `/cambiar-contrasena`, ambas **fuera** de `AppLayout`, con un layout mínimo común ("layout de acceso").

### 3.1 Inicio de sesión

| Aspecto              | Especificación                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido            | Marca "Realpolitik Manager •" (texto en `--foreground` sobre fondo claro, punto `--brand-accent`); `h1` "Iniciar sesión"; aviso contextual opcional (sesión vencida, cerrada, terminada); formulario; texto de ayuda "¿Olvidaste tu contraseña? Pedile a un administrador que la restablezca." (los `ADMINISTRADOR` restablecen contraseñas desde HU4.5; antes, por el procedimiento técnico) |
| Campos               | **Email** (`type="email"`, `autocomplete="username"`, `inputMode="email"`, sin autocorrección ni mayúscula inicial). **Contraseña** (`type="password"`, `autocomplete="current-password"`, con botón mostrar/ocultar)                                                                                                                                                                         |
| Botones              | "Ingresar" (`LoadingButton`, ancho completo, texto de carga "Ingresando…"). Botón de mostrar/ocultar contraseña dentro del campo                                                                                                                                                                                                                                                              |
| Validación (cliente) | Email obligatorio y con formato; contraseña obligatoria. Sin validar largo mínimo en el login (podría ser una contraseña vieja o temporal; decide el servidor). Al enviar, como el resto del sistema                                                                                                                                                                                          |
| Carga                | Botón bloqueado y enfocable con spinner; campos no editables durante el envío                                                                                                                                                                                                                                                                                                                 |
| Errores              | 2.3, 2.4 y 2.11. Errores de validación debajo de cada campo con `FormField`                                                                                                                                                                                                                                                                                                                   |
| Responsive           | Columna única centrada; tarjeta de ancho máximo ~400 px en escritorio; en mobile ocupa el ancho con 16 px de margen, sin tarjeta flotante si no entra; inputs de 44 px; el teclado virtual no tapa el botón (scroll natural)                                                                                                                                                                  |
| Accesibilidad        | `h1` visible; etiquetas visibles (no solo placeholder); `Alert` con `role="alert"` y foco; botón de mostrar contraseña con `aria-label` "Mostrar contraseña"/"Ocultar contraseña" y `aria-pressed`; Enter envía; orden de tabulación natural; el foco inicial va al email                                                                                                                     |
| Reutilizable         | `Input`, `FormField`, `describirCampo`, `LoadingButton`, `Alert`, tokens, marca del sidebar                                                                                                                                                                                                                                                                                                   |
| Nuevo                | Layout de acceso; campo de contraseña con mostrar/ocultar. **Validar con el handoff**                                                                                                                                                                                                                                                                                                         |

### 3.2 Información del usuario autenticado

| Aspecto       | Especificación                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contenido     | En el pie del sidebar: monograma con iniciales, nombre y el rol como etiqueta discreta ("Administrador", "Administrativo" o "Consulta"). En colapsado: solo el monograma, con tooltip del nombre |
| Botones       | Todo el bloque es el disparador del menú de cuenta (3.3)                                                                                                                                         |
| Carga         | La sesión ya está resuelta antes de mostrar el shell: no hay estado de carga propio                                                                                                              |
| Responsive    | Escritorio: pie del sidebar expandido o colapsado. Mobile: pie del cajón (se ve al abrirlo); el `AppHeader` no cambia                                                                            |
| Accesibilidad | Botón con nombre accesible "Cuenta de {nombre}"; `aria-haspopup="menu"`; foco visible blanco sobre el sidebar oscuro (`--sidebar-ring`)                                                          |
| Reutilizable  | `SidebarFooter`, `SidebarMenuButton` (`size="nav"`), `Tooltip`, monograma al estilo `ClienteMonogram`                                                                                            |
| Nuevo         | Ajuste menor del sidebar. **Validar con el handoff**                                                                                                                                             |

### 3.3 Menú de cuenta

| Aspecto       | Especificación                                                                                                                                                 |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido     | Encabezado no interactivo: nombre, email, rol                                                                                                                  |
| Opciones      | "Cambiar contraseña" (abre 3.4); "Usuarios" **solo** si la sesión tiene `usuarios:administrar` (solo `ADMINISTRADOR`, desde HU4.5); separador; "Cerrar sesión" |
| Carga         | "Cerrar sesión" muestra el ítem deshabilitado con spinner mientras se envía (breve)                                                                            |
| Responsive    | Se abre hacia arriba desde el pie; en mobile, dentro del cajón                                                                                                 |
| Accesibilidad | Menú de Base UI (flechas, Escape, foco que vuelve al disparador)                                                                                               |
| Reutilizable  | `DropdownMenu`, `DropdownMenuItem`, `DropdownMenuSeparator`, íconos de lucide (`KeyRoundIcon`, `UsersIcon`, `LogOutIcon`)                                      |
| Nuevo         | No                                                                                                                                                             |

### 3.4 Cambio voluntario de contraseña

| Aspecto              | Especificación                                                                                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido            | `Sheet` "Cambiar contraseña". Texto: "Al cambiarla, se cierran tus otras sesiones abiertas."                                                                                                                                                                                                                                             |
| Campos               | **Contraseña actual** (`autocomplete="current-password"`). **Contraseña nueva** (`autocomplete="new-password"`, ayuda: "Al menos 8 caracteres. Podés usar una frase con espacios."; el mínimo es 8, decidido por el usuario, ADR-0006 P5). **Repetir la contraseña nueva** (`autocomplete="new-password"`). Los tres con mostrar/ocultar |
| Botones              | "Cambiar contraseña" (`LoadingButton`, "Guardando…", éxito "Contraseña cambiada"); "Cancelar"                                                                                                                                                                                                                                            |
| Validación (cliente) | Todos obligatorios; nueva de 8 a 128 caracteres (contados después de NFC, igual que el servidor); repetir = nueva; nueva ≠ actual. La lista de bloqueo la aplica solo el servidor                                                                                                                                                        |
| Errores del servidor | Actual incorrecta → en "Contraseña actual"; política → en "Contraseña nueva" con "Esa contraseña es muy común o fácil de adivinar. Elegí otra."; 429, 503, red → `Alert` en el panel                                                                                                                                                     |
| Responsive           | El `Sheet` ocupa el ancho en mobile, como los demás                                                                                                                                                                                                                                                                                      |
| Accesibilidad        | Como el resto de los formularios: foco al primer campo inválido, errores conectados, título del panel como nombre del diálogo                                                                                                                                                                                                            |
| Reutilizable         | `Sheet`, `FormField`, `LoadingButton`, `useExitoBreve`, `useAvisoDePagina`, campo de contraseña de 3.1                                                                                                                                                                                                                                   |
| Nuevo                | No                                                                                                                                                                                                                                                                                                                                       |

### 3.5 Cambio obligatorio de contraseña

| Aspecto                    | Especificación                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido                  | Layout de acceso (como 3.1). `h1` "Elegí tu contraseña". Texto: "Ingresaste con una contraseña temporal. Para seguir, elegí una propia." Nombre de la persona para confirmar la cuenta |
| Campos                     | **Contraseña temporal** (la recibida; ver nota). **Contraseña nueva** y **Repetir**, con la misma ayuda y reglas que 3.4                                                               |
| Botones                    | "Guardar y continuar" (`LoadingButton`); enlace "Cerrar sesión" (para quien entró con la cuenta equivocada)                                                                            |
| Validación y errores       | Como 3.4 (2.6)                                                                                                                                                                         |
| Responsive y accesibilidad | Como 3.1                                                                                                                                                                               |
| Reutilizable               | Layout de acceso y campos de 3.1/3.4                                                                                                                                                   |
| Nuevo                      | Comparte el layout nuevo de 3.1                                                                                                                                                        |

Nota: pedir de nuevo la contraseña temporal es coherente con el contrato del ADR (`{ actual, nueva }`) y protege una sesión abandonada en ese estado. Si el equipo prefiere no pedirla justo después del login, hace falta una regla de backend explícita; se decide en la implementación.

### 3.6 Sesión expirada

| Aspecto       | Especificación                                                                                                                                                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido     | No es una pantalla propia: es `/login` con un `Alert` de advertencia según `motivo` (`vencida`, `cerrada`, `terminada`)                                                                                                             |
| Textos        | Vencida: "Tu sesión venció por inactividad. Ingresá de nuevo para continuar." (+ "Lo que estabas guardando no se guardó." si ocurrió en un envío). Terminada: "Tu sesión terminó. Ingresá de nuevo." Cerrada: "Cerraste la sesión." |
| Accesibilidad | El aviso es `status` (advertencia/éxito), no interrumpe; el foco va al email                                                                                                                                                        |
| Reutilizable  | `Alert`                                                                                                                                                                                                                             |
| Nuevo         | No                                                                                                                                                                                                                                  |

`motivo` es solo presentación: un valor desconocido no muestra aviso.

### 3.7 Servicio temporalmente no disponible

| Aspecto          | Especificación                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contenido        | Al entrar: pantalla en el layout de acceso con píldora "Servicio no disponible", `h1` "No pudimos conectarnos con el sistema", detalle según causa (servidor / conexión), código de diagnóstico en mono (`HTTP_503`, `NETWORK_ERROR`) |
| Botones          | "Reintentar" (repite `GET /auth/sesion`; `LoadingButton`)                                                                                                                                                                             |
| Dentro del shell | Los estados de error existentes de cada pantalla; los textos de causa ya distinguen servidor y conexión                                                                                                                               |
| Accesibilidad    | `role="alert"` en el bloque, como `ClientesErrorState`                                                                                                                                                                                |
| Reutilizable     | Estructura de `ClientesErrorState` (píldora, título, detalle, diagnóstico, Reintentar), con textos generales                                                                                                                          |
| Nuevo            | Solo la versión fuera del shell                                                                                                                                                                                                       |

### 3.8 Acceso denegado

| Variante                                          | Cuándo                                                                                                                                                                     | Interfaz                                                                                                                                                                                               |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sección                                           | La ruta pide un permiso que la persona no tiene (por ejemplo, `/usuarios` sin `usuarios:administrar`) o la primera consulta de la página recibe `403 PERMISO_INSUFICIENTE` | Dentro del shell, como `NotFoundPage`: `h1` "No tenés acceso a esta sección", "Si creés que deberías tenerlo, consultalo con quien administra las cuentas.", enlace "Ir a Rendiciones"                 |
| Acción                                            | Una mutation recibe `403 PERMISO_INSUFICIENTE` (por ejemplo, cambiaron el rol con la página abierta)                                                                       | `Alert` en el panel o aviso de página: "No tenés permiso para esta acción." Se vuelve a pedir `GET /auth/sesion` para actualizar lo que se muestra; la sesión sigue                                    |
| Rol no habilitado (durante HU4.1, antes de HU4.3) | Una cuenta `CONSULTA` inicia sesión                                                                                                                                        | La variante "Sección" a pantalla completa con "Tu cuenta todavía no tiene acceso al sistema." y "Cerrar sesión". En la práctica no debería pasar: el script no crea usuarios `CONSULTA` antes de HU4.3 |

Reutilizable: `NotFoundPage` como molde, `Alert`, `useAvisoDePagina`. Nuevo: no.

### 3.9 Administración de usuarios (HU4.5)

Solo para `ADMINISTRADOR` (`usuarios:administrar`). La administración en el sistema está aprobada como HU4.5; los detalles de pantalla se refinan en esa historia.

| Aspecto             | Especificación                                                                                                                                                                                                                                                                                                                                                        |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Acceso              | Desde el menú de cuenta ("Usuarios"), no como destino principal del sidebar (la mayoría no lo usa). Ruta `/usuarios` dentro del shell                                                                                                                                                                                                                                 |
| Contenido           | `h1` "Usuarios"; listado con nombre, email, rol, estado (activo/desactivado), "Debe cambiar la contraseña" y último acceso. Filtro "Mostrar desactivados", como en tipos de documento                                                                                                                                                                                 |
| Acciones            | "Nuevo usuario" (`Sheet`: nombre, email, rol entre `ADMINISTRADOR`, `ADMINISTRATIVO` y `CONSULTA`); menú "⋯" por fila: Editar (nombre, rol), Restablecer contraseña (confirmación), Desactivar / Reactivar (confirmación). Sin borrar. En la fila propia no se ofrecen cambiar el rol, desactivarse ni restablecer la contraseña (para eso está el cambio voluntario) |
| Contraseña temporal | Al crear o restablecer, un `AlertDialog` la muestra **una sola vez**, en mono, con botón "Copiar" y el texto "Entregásela por un canal seguro. No la vas a poder ver de nuevo." Al cerrarlo no se recupera                                                                                                                                                            |
| Validaciones        | Nombre obligatorio (hasta 150); email válido y único (409 → error en el campo); rol obligatorio. Autoprotección (409): nadie cambia su propio rol ni se desactiva; siempre queda al menos un `ADMINISTRADOR` activo → aviso explicativo                                                                                                                               |
| Estados             | Carga con `Skeleton`, error con Reintentar, vacío (imposible en la práctica: al menos está quien mira)                                                                                                                                                                                                                                                                |
| Responsive          | Tabla en escritorio, tarjetas en mobile (como clientes y tipos)                                                                                                                                                                                                                                                                                                       |
| Accesibilidad       | Como los listados actuales; el diálogo de la contraseña enfoca el botón Copiar y anuncia el resultado de copiar                                                                                                                                                                                                                                                       |
| Reutilizable        | Módulo `tipos-documento` como molde (listado, tarjeta, menú de acciones, diálogo de cambio de estado, filtro de desactivados), `Sheet`, `AlertDialog`, `Badge`, `FormField`, `LoadingButton`                                                                                                                                                                          |
| Nuevo               | El diálogo de contraseña temporal. **Validar con el handoff**                                                                                                                                                                                                                                                                                                         |

## 4. Rol Consulta: impacto en las pantallas actuales (HU4.3)

La seguridad la garantiza el backend (403). Esta sección trata de que la interfaz sea coherente para quien no puede escribir. **Decisión aprobada:** `CONSULTA` lee todo (contactos, observaciones internas, montos, órdenes de compra, documentos y su descarga) y no modifica nada. Durante HU4.1, `CONSULTA` no tiene acceso; la experiencia de esta sección llega con HU4.3.

### 4.1 Acciones a ocultar, por pantalla

| Pantalla                                                                 | Acciones de escritura que hay hoy                                                                                                                                                           | Para Consulta                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clientes (`ClientesPage`)                                                | "Nuevo cliente"; menú "⋯" con Editar, Contactos, Ver requisitos, Desactivar/Reactivar                                                                                                       | Ocultar "Nuevo cliente" y las acciones de escritura. El menú se reemplaza por accesos de lectura: "Ver ficha" y "Ver contactos" (vistas de 4.3) y "Ver requisitos" (que ya está en el nombre del cliente) |
| Contactos (`GestionarContactosSheet`)                                    | Solo existe como formulario de edición                                                                                                                                                      | No se abre en modo edición: hace falta la vista de lectura (4.3)                                                                                                                                          |
| Requisitos (`MatricesPage`)                                              | "Carga masiva"                                                                                                                                                                              | Ocultar                                                                                                                                                                                                   |
| Matriz de un cliente (`MatrizPage`)                                      | "Agregar requisito"; menú del requisito (Editar, Quitar); editar indicaciones y observaciones (abre la ficha); "Abrir rendición"; sumar requisito y propagar canal (diálogos)               | Ocultar todas. Indicaciones y observaciones se leen en sus paneles, que ya existen                                                                                                                        |
| Rendiciones del cliente (`RendicionesSection`, `RendicionCard`)          | "Abrir rendición"; "Anular" en cada tarjeta                                                                                                                                                 | Ocultar ambas                                                                                                                                                                                             |
| Rendiciones del mes (`RendicionesPage`)                                  | Ninguna de escritura                                                                                                                                                                        | Sin cambios de acciones (ver textos en 4.2)                                                                                                                                                               |
| Detalle de rendición (`RendicionDetallePage`, `ItemChecklistFila`)       | "Editar OC"; casillas de selección y "Preparar envío"; por ítem: asociar documento, reemplazar, corregir canal; abrir la ficha del cliente para editar; futuros cambios de estado (épica 3) | Ocultar todas. Quedan el bloque de OC y montos (lectura), el filtro "Solo faltantes", "Ver historial" y "Descargar" de cada ítem                                                                          |
| Repositorio (`ArchivosPage`, `ArchivosListado`, `DocumentoDetalleSheet`) | "Cargar documento" (encabezado y vacío); "Aplicar" por documento y en el detalle                                                                                                            | Ocultar. Quedan "Ver detalle" y "Descargar"                                                                                                                                                               |
| Tipos de documento (`TiposDocumentoPage`)                                | "Nuevo tipo" (encabezado y vacío); el **nombre** es un botón que abre la edición; menú "⋯" (Editar, Desactivar/Reactivar)                                                                   | Ocultar el botón y el menú; el nombre pasa a ser texto                                                                                                                                                    |
| Sidebar                                                                  | —                                                                                                                                                                                           | Sin cambios: las tres secciones son de lectura                                                                                                                                                            |

### 4.2 Componentes que hoy asumen que se puede escribir

| Componente                                                                  | Suposición                                                                                                      | Efecto si solo se oculta el botón                                                                                                       |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientesEmptyState`                                                        | Texto y botón para cargar el primer cliente                                                                     | Invita a una acción imposible: necesita texto neutro ("Todavía no hay clientes cargados") sin botón                                     |
| `ArchivosPage` (vacío)                                                      | "Cargá un archivo una sola vez y aplicalo…" + "Cargar documento"                                                | Ídem: texto neutro                                                                                                                      |
| `TiposDocumentoVacio`                                                       | Botón "Nuevo tipo"                                                                                              | Ídem                                                                                                                                    |
| `RendicionesPage` (mes vacío)                                               | "Las rendiciones se abren desde la ficha de cada cliente" + "Ir a Clientes"                                     | El texto instruye a abrir rendiciones: cambiarlo para Consulta                                                                          |
| `RendicionesSection`                                                        | Sin "Abrir rendición", muestra "El cliente no está activo: no se pueden abrir rendiciones nuevas."              | **Mensaje falso** para un cliente activo visto por Consulta: el motivo tiene que distinguir rol y estado (o no mostrar nada a Consulta) |
| `NombreTipoDocumento`                                                       | Siempre es un `button` que edita                                                                                | Botón que no hace nada o falla: debe renderizar texto                                                                                   |
| `ClienteAccionesMenu`, `TipoDocumentoAccionesMenu`, `RequisitoAccionesMenu` | Siempre tienen ítems de escritura                                                                               | Menús vacíos o con ítems inútiles: se reemplazan por accesos de lectura o no se renderizan                                              |
| `EditarClienteSheet`                                                        | Es la **única** vista completa de la ficha (contacto, canal, periodicidad, emisor, indicaciones, observaciones) | Consulta no tendría dónde ver datos que **sí** puede ver (4.3)                                                                          |
| `GestionarContactosSheet`                                                   | Única vista de los contactos, en modo edición                                                                   | Ídem                                                                                                                                    |
| `ItemChecklistFila`                                                         | La casilla de envío está siempre                                                                                | Casillas sin acción; el patrón de callbacks opcionales ya cubre asociar/reemplazar, no la casilla                                       |
| `RendicionDetallePage`                                                      | Barra de envío y "Editar OC" siempre visibles en una rendición activa                                           | Deben desaparecer como bloque; el bloque de OC queda en lectura                                                                         |
| Tests de componentes                                                        | Montan las pantallas sin sesión y con todas las acciones                                                        | Necesitarán una sesión de prueba (por defecto con un rol operativo)                                                                     |

### 4.3 Pantallas que quedarían vacías, confusas o inutilizables

1. **Ficha del cliente y contactos (bloqueante para HU4.3).** Como `CONSULTA` puede ver contactos y observaciones, y hoy esos datos solo se ven en paneles de **edición**, HU4.3 necesita vistas de solo lectura: una ficha (puede reutilizar la estructura de `FormSection` como secciones de lectura) y una lista de contactos. Es diseño nuevo, a validar con el handoff.
2. **Detalle de rendición.** Sin acciones queda útil (checklist, avance, historial, OC y montos), pero la barra de envío y las casillas tienen que desaparecer como bloque.
3. **Estados vacíos** con llamados a la acción (4.2): todos necesitan una variante neutra.
4. **Menús "⋯"**: con accesos de lectura donde haga falta; si no queda ninguno, no se renderizan.

Patrón propuesto: un hook de permisos (por ejemplo, `usePermiso('clientes:editar')`) a partir de la sesión en caché, y pasar o no los callbacks opcionales como ya se hace con `puedeModificar`. Sin componentes "envoltorio" ni un sistema nuevo.

## 5. Administración de usuarios

**Decisión aprobada:** la administración de cuentas es una función del sistema reservada a `ADMINISTRADOR` (HU4.5). El procedimiento técnico queda para el primer `ADMINISTRADOR` y como vía transitoria hasta HU4.5 (y de recuperación si se perdiera el acceso administrativo).

|                           | Procedimiento técnico (script)                                                                                          | Pantalla del sistema (HU4.5)                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Cuándo se usa             | Alta del primer `ADMINISTRADOR` (HU4.1); altas, bajas y restablecimientos hasta HU4.5; recuperación                     | Desde HU4.5, toda la administración cotidiana                                                                                                 |
| Experiencia de la agencia | Pide el cambio al equipo técnico y espera                                                                               | Lo hace un `ADMINISTRADOR` desde el menú de cuenta                                                                                            |
| Trabajo                   | Script `usuarios:crear` (y, si hace falta antes de HU4.5, restablecer y desactivar), documentación, registro de eventos | Endpoints `/usuarios`, autoprotección con transacción serializable, pantalla, diálogo de contraseña temporal, tests de permisos y de interfaz |
| Riesgos                   | Dependencia del equipo técnico; manejo operativo de contraseñas temporales; acceso a la shell de producción             | Una sesión de `ADMINISTRADOR` robada puede crear cuentas (mitigado por la revocación inmediata y los eventos registrados); error humano       |
| Componentes reutilizables | Ninguno de interfaz                                                                                                     | Módulo `tipos-documento` como molde, `Sheet`, `AlertDialog`, `DropdownMenu`, `Badge`, `FormField`, `LoadingButton`                            |

En ambos casos: sin registro público, contraseñas temporales generadas por el sistema y cambio obligatorio en el primer ingreso.

## 6. Historias y capacidades

Las historias están aprobadas (HU4.1–HU4.6). Sin estimación. Detalle técnico y dependencias en ADR-0006, "Estrategia de implementación".

### HU4.1 — Inicio de sesión y primer acceso

- **Valor:** solo las personas autorizadas ven y modifican los datos.
- **Interfaces:** 3.1 (login), 3.5 (cambio obligatorio), 3.6 (aviso de sesión vencida o cerrada), 3.7 (servicio no disponible), 3.8 (acceso denegado y rol no habilitado), una versión mínima de 3.2/3.3 (usuario identificado y "Cerrar sesión").
- **Incluye como dependencia técnica identificada:** el cierre de sesión básico y la identificación del usuario en el shell (ver la delimitación del ADR).
- **Criterios preliminares:** sin sesión, cualquier URL lleva a `/login` y, después de entrar, a la URL pedida con su query o a Rendiciones; credenciales incorrectas muestran un mensaje genérico y conservan el email; 429 muestra el tiempo de espera; con contraseña temporal solo se puede cambiarla o salir; la API no responde datos sin sesión, tampoco llamada directamente; `CONSULTA` no accede todavía.
- **Pendiente:** P2 (tiempos de sesión) y P5 (largo mínimo) no bloquean: son valores configurables.

### HU4.2 — Gestión de sesión y contraseña

- **Valor:** cada persona controla su contraseña y entiende cuándo y por qué se cerró su sesión.
- **Interfaces:** 3.4 (cambio voluntario), 3.3 completo (menú de cuenta), 3.6 con regreso a la página, cierre de otras sesiones si se decide.
- **Criterios preliminares:** se pide la actual; se cierran las otras sesiones y la actual sigue; los errores se muestran en el campo correspondiente; tras vencer la sesión se vuelve a la página donde se estaba.

### HU4.3 — Acceso de Consulta en modo lectura

- **Valor:** dar visibilidad completa a quienes no deben modificar nada.
- **Interfaces:** todas las de la sección 4, más las vistas de solo lectura de la ficha y los contactos.
- **Dependencias:** infraestructura de permisos (si no la trajo HU4.5), hook de permisos en el frontend.
- **Riesgos:** toca casi todas las pantallas y sus tests; vistas de lectura nuevas a validar con el handoff.
- **Criterios preliminares:** `CONSULTA` ve todos los datos, incluidos contactos, observaciones, montos y descargas; no ve acciones de escritura ni menús vacíos; ningún texto la invita a hacer algo que no puede; cualquier escritura directa recibe 403.

### HU4.4 — Protección y acceso a documentos

- **Valor:** usar el repositorio documental con datos reales sin exponerlo.
- **Interfaces:** repositorio, detalle y descargas existentes, con acciones según el rol.
- **Criterios preliminares:** los tres roles ven y descargan; solo los roles operativos cargan, aplican y reemplazan; la descarga sin sesión responde 401 y no toca el almacenamiento; se cumplen las condiciones de la política de habilitación antes de activar documentos en producción.

### HU4.5 — Administración de usuarios

- **Valor:** autonomía de la agencia para altas, bajas, roles y restablecimientos.
- **Interfaces:** 3.9.
- **Criterios preliminares:** solo `ADMINISTRADOR` accede; la contraseña temporal se ve una sola vez; nadie cambia su propio rol ni se desactiva; siempre queda un `ADMINISTRADOR` activo; desactivar o cambiar el rol de alguien cierra sus sesiones.

### HU4.6 — Responsable de los cambios de estado

- **Valor:** saber quién registró cada paso de una rendición.
- **Interfaces:** historial de estados en el detalle de rendición (nombre junto a la fecha; "sin registro" en los anteriores).
- **Dependencias:** HU4.1 y los endpoints de cambio de estado de la épica 3.

## 7. Decisiones

**Aprobadas:** tres roles; lectura completa de `CONSULTA`, incluida la descarga; solo `ADMINISTRADOR` administra usuarios; administración de usuarios en el sistema (HU4.5); registro del responsable de los cambios de estado (HU4.6).

**Pendientes que afectan a la experiencia:**

| #   | Pregunta                                                                                                             | Afecta a                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2  | Tiempos de sesión (propuesta: 24 h de inactividad y 7 días máximo, sin confirmar)                                    | Textos de sesión vencida; si la sesión sobrevive al cierre del navegador (P16)                                                                            |
| P5  | Largo mínimo de contraseña (decidido por el usuario: 8; la propuesta técnica era 15 y las versiones 0A/0B decían 12) | Ayuda y validación de 3.4 y 3.5                                                                                                                           |
| —   | Handoff visual de Design                                                                                             | Layout de acceso, pie del sidebar, campo de contraseña con mostrar/ocultar, diálogo de contraseña temporal, vistas de lectura de la ficha y los contactos |

## 8. Observaciones para el contrato de API

- La contraseña actual incorrecta en `PUT /auth/password` responde `400` con `campo: "actual"`, nunca `401` (dispararía el cierre global de sesión). Implementado en la etapa 2 (ADR-0006 §1 y §3).
- La política de contraseñas necesita un mensaje de error de campo único para la lista de bloqueo y el contexto; el contrato debe decir en qué `campo` llega.
- 502/504 del proxy de Vercel (Railway caído) llegan sin el formato de error del contrato: la interfaz los trata como "servicio no disponible".
