# ADR-0005 — Estados de la rendición

## Estado

Proposed

## Fecha

2026-11-03

## Contexto

La épica 3 sigue cada rendición por los pasos de su proceso: se abre, se reúne la documentación, se envía al organismo y el organismo la aprueba o la rechaza (y una rechazada se corrige). Hoy la operadora lleva ese seguimiento de memoria o en un Excel. La HU3.1 agrega el estado y su historial y los muestra; los cambios de estado los hacen las HU siguientes: Completa (HU3.6), Enviada (HU3.7), Aprobada o Rechazada (HU3.8) y la corrección de una rechazada (HU3.9).

Restricciones:

- Una rendición ya tenía una baja lógica (`isDeleted`, HU2.5) que la API mostraba como `estado: ACTIVA | ANULADA`. Era un valor derivado, no una columna, pero ocupaba el nombre `estado` en la respuesta y en el filtro del listado (`?estado=`).
- Las rendiciones atrasadas tienen que verse marcadas (HU3.4), pero "atrasada" depende de la fecha de hoy y del día límite del cliente.
- Las rendiciones existentes no tienen estado ni historial.

## Decisión

1. **Un enum de PostgreSQL más una tabla de historial.**
   - `EstadoRendicion` (`EN_CURSO`, `COMPLETA`, `ENVIADA`, `APROBADA`, `RECHAZADA`) es un enum de la base, isomorfo con el de `@realpolitik/shared`, como `Emisor` y `CanalEntrega` (ADR-0002). `Rendicion.estado` es obligatorio, con default `EN_CURSO`: el estado actual se lee y se filtra con una columna, sin recorrer el historial.
   - `HistorialEstadoRendicion` guarda cada cambio: `estadoAnterior` (`NULL` en la primera entrada), `estadoNuevo`, `fecha` (cuándo ocurrió), `motivo` (opcional, para el rechazo de la HU3.8) y `createdAt`. Índice por `(rendicionId, fecha)`, porque el historial se lee por rendición y en orden. La FK es `onDelete: Cascade`: el historial es parte de la rendición, que no se borra físicamente (se anula).
   - La API devuelve `estado` en el listado, en el detalle y en la anulación, y el `historial` (sin `motivo`, que todavía no se usa) en las respuestas que traen la rendición con su checklist, del cambio más viejo al más nuevo.
2. **Un punto único para cambiar el estado.** `registrarCambioDeEstado` (en `rendiciones.service.ts`) actualiza `estado` y agrega la entrada de historial en una sola transacción serializable, con el estado anterior leído en esa misma transacción. No tiene endpoint: lo van a usar las HU3.6 a HU3.9, cada una con sus reglas (qué transiciones permite, si acepta una anulada). El alta no pasa por ahí: crea la rendición en `EN_CURSO` y su primera entrada en la misma escritura.
3. **"Atrasada" se calcula, no se guarda.** No es un paso del proceso sino una condición que cambia sola con el calendario: una rendición en curso pasa a estar atrasada a medianoche sin que nadie haga nada, y deja de estarlo si cambia el día límite del cliente. Guardarla obligaría a un proceso programado que la actualice y podría quedar desfasada. La calcula el sistema en la HU3.4, a partir del estado, el período y la periodicidad del cliente; el rojo de la interfaz queda reservado para esa marca.
4. **La anulación es independiente del estado.** Anular sigue siendo la baja lógica de HU2.5: la rendición conserva el último estado que tenía y anular no agrega una entrada al historial. Para que los dos conceptos no compartan nombre, el valor derivado de la baja lógica pasa a llamarse `vigencia` (`ACTIVA` o `ANULADA`, filtro `?vigencia=`), y `estado` queda para el estado del proceso. El endpoint de anulación (`PATCH /rendiciones/:id/estado` con `{ "estado": "ANULADA" }`) no cambió.
5. **Migración.** `20261103120000_hu3_1_estado_rendicion` crea el enum, la columna y la tabla, y le da a cada rendición existente, también a las anuladas, el estado `EN_CURSO` (el default) y una entrada inicial `NULL → EN_CURSO` fechada en su `createdAt`. Así toda rendición tiene historial desde su alta.

## Alternativas consideradas

- **Solo el historial, sin columna de estado**: el estado actual sería la última entrada. Filtrar el listado por estado y mostrarlo en cada fila exigiría buscar la última entrada de cada rendición en cada consulta. La columna es redundante con el historial, pero por eso los dos se escriben siempre juntos, en el mismo punto.
- **Solo la columna, sin historial**: no cumple el criterio de ver el historial de cambios con sus fechas, y se pierde cuándo se envió o se rechazó una rendición.
- **Una tabla de estados en lugar de un enum**: son cinco valores fijos y de negocio, como el emisor (ADR-0003, punto 11). Una tabla agregaría una FK, un seed y una administración sin beneficio.
- **Guardar "Atrasada" como un estado más**: descartado por el punto 3.
- **Que la anulación sea un estado (`ANULADA`)**: mezclaría la corrección de un error de carga (anular) con el avance del proceso, y se perdería en qué paso estaba la rendición al anularla.
- **Mantener `estado` para la baja lógica y dar otro nombre al del proceso**: no cambiaba código existente, pero la HU y las siguientes de la épica hablan de "estado" para el proceso. Se renombró la baja lógica a `vigencia` en un commit propio, antes de esta HU.

## Consecuencias

- **Positivas**: el estado actual se filtra y se muestra con una columna; el historial guarda cada cambio con su fecha; hay un solo lugar donde se cambia el estado, así la columna y el historial no se desincronizan; la anulación y el estado no se confunden.
- **Negativas**: el estado se guarda dos veces (columna y última entrada del historial). Un cambio escrito por fuera de `registrarCambioDeEstado` (SQL manual, Prisma Studio) los desincronizaría: la base no lo impide.
- **Cambio de contrato**: el campo y el filtro `estado` de la baja lógica pasaron a llamarse `vigencia`. El frontend y el backend se actualizaron juntos; no hay otros consumidores de la API.
- **A resolver** (en las HU que cambian el estado): qué transiciones se permiten, si se puede cambiar el estado de una rendición anulada o de un cliente inactivo, si se rechaza un cambio al mismo estado, y el largo máximo del motivo del rechazo.
